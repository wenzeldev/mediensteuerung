#!/usr/bin/python3
"""Find and select Firefox's media tab through its native accessibility tree."""
import json
import sys
import time
import unicodedata
from urllib.parse import urlsplit

import gi
gi.require_version("Atspi", "2.0")
from gi.repository import Atspi, Gio, GLib

MUTE_LABELS = ("mute tab", "tab stummschalten", "mute audio", "audio stummschalten")
LIKE_LABELS = {"like", "gefällt mir"}
LIKED_LABELS = {"unlike", "liked", "gefällt mir nicht mehr"}


def children(node):
    for index in range(node.get_child_count()):
        child = node.get_child_at_index(index)
        if child is not None:
            yield child


def tabs(node, depth=0):
    if depth > 18:
        return
    role = node.get_role()
    if role == Atspi.Role.PAGE_TAB:
        if "tabbrowser-tab" in node.get_attributes().get("class", "").split():
            yield node
        return
    if role in {Atspi.Role.DOCUMENT_WEB, Atspi.Role.DOCUMENT_FRAME,
                Atspi.Role.DOCUMENT_TEXT, Atspi.Role.MENU_BAR, Atspi.Role.MENU}:
        return
    for child in children(node):
        yield from tabs(child, depth + 1)


def firefox_application(pid):
    for app in children(Atspi.get_desktop(0)):
        if app.get_process_id() == pid and "firefox" in app.get_name().casefold():
            return app
    return None


def enable_accessibility():
    Gio.bus_get_sync(Gio.BusType.SESSION).call_sync(
        "org.a11y.Bus", "/org/a11y/bus", "org.freedesktop.DBus.Properties",
        "Set", GLib.Variant("(ssv)", ("org.a11y.Status", "IsEnabled",
                                      GLib.Variant("b", True))),
        None, Gio.DBusCallFlags.NONE, 800, None)


def normalize(value):
    return unicodedata.normalize("NFKC", value).strip().casefold()


def find_tab(app, media_title):
    candidates = []
    wanted = normalize(media_title)
    for frame in children(app):
        if frame.get_role() != Atspi.Role.FRAME:
            continue
        for tab in tabs(frame):
            name = tab.get_name()
            matches = bool(wanted and wanted in normalize(name))
            has_audio = any(child.get_role() == Atspi.Role.PUSH_BUTTON and
                            normalize(child.get_name()).startswith(MUTE_LABELS)
                            for child in children(tab))
            if matches or has_audio:
                candidates.append((2 * has_audio + matches, frame, tab, name))
    if not candidates:
        return None
    candidates.sort(key=lambda item: item[0], reverse=True)
    if len(candidates) > 1 and candidates[0][0] == candidates[1][0]:
        return None
    return candidates[0][1:]


def connect_firefox(pid):
    Atspi.init()
    Atspi.set_timeout(350, 800)
    app = firefox_application(pid)
    if app is None:
        enable_accessibility()
        for _ in range(8):
            time.sleep(0.15)
            app = firefox_application(pid)
            if app is not None:
                break
    return app


def select_tab(pid, media_title):
    app = connect_firefox(pid)
    match = find_tab(app, media_title) if app is not None else None
    if not match:
        return None

    frame, tab, name = match
    frame_title = frame.get_name()
    if not tab.get_state_set().contains(Atspi.StateType.SELECTED):
        action = tab.get_action_iface()
        if action is None or action.get_n_actions() != 1 or not action.do_action(0):
            return None
    return {"tab": name, "window": frame_title}


def walk(node, remaining=32, reverse=False):
    if remaining < 0:
        return
    yield node
    descendants = list(children(node))
    if reverse:
        descendants.reverse()
    for child in descendants:
        yield from walk(child, remaining - 1, reverse)


def web_documents(node, remaining=32):
    if remaining < 0:
        return
    role = node.get_role()
    if role == Atspi.Role.DOCUMENT_WEB:
        yield node
        return
    if role in {Atspi.Role.MENU_BAR, Atspi.Role.MENU, Atspi.Role.PAGE_TAB_LIST}:
        return
    for child in children(node):
        yield from web_documents(child, remaining - 1)


def soundcloud_documents(frame):
    for node in web_documents(frame):
        document = node.get_document_iface()
        if document is None:
            continue
        attributes = document.get_document_attributes()
        url = next((value for key, value in attributes.items()
                    if key.casefold() in {"docurl", "url"}), "")
        parsed = urlsplit(url)
        if parsed.scheme == "https" and parsed.hostname in {"soundcloud.com", "www.soundcloud.com"}:
            yield node


def soundcloud_document(frame, tab):
    matches = list(soundcloud_documents(frame))
    tab_name = normalize(tab.get_name())
    exact = [document for document in matches if normalize(document.get_name()) == tab_name]
    if exact:
        matches = exact
    elif "soundcloud" not in tab_name:
        return None
    return matches[0] if len(matches) == 1 else None


def player_controls(document, title, require_playing=False):
    # Firefox exposes the named landmark even when it omits CSS classes
    # from unstyled links in the web accessibility tree.
    for node in walk(document, reverse=True):
        if node.get_role() == Atspi.Role.LANDMARK and normalize(node.get_name()) in {
                "miniplayer", "mini player", "mini-player"}:
            controls = list(walk(node))
            track_matches = any(item.get_role() in {Atspi.Role.LINK, Atspi.Role.STATIC,
                                                      Atspi.Role.TEXT} and
                                normalize(item.get_name()) == normalize(title)
                                for item in controls)
            if not track_matches:
                return None

            buttons = [item for item in controls
                       if item.get_role() in {Atspi.Role.PUSH_BUTTON, Atspi.Role.TOGGLE_BUTTON}]
            if require_playing and not any(
                    normalize(button.get_name()).startswith(("pause", "pausieren"))
                    or normalize(button.get_description()).startswith(("pause", "pausieren"))
                    for button in buttons):
                return None
            explicit = [button for button in buttons
                        if "playbackSoundBadge__like" in button.get_attributes().get("class", "").split()]
            matches = explicit or [button for button in buttons
                                   if {normalize(button.get_name()), normalize(button.get_description())}
                                   & (LIKE_LABELS | LIKED_LABELS)]
            return matches[0] if len(matches) == 1 else None
    return None


def like_state(button):
    states = button.get_state_set()
    attributes = button.get_attributes()
    classes = attributes.get("class", "").split()
    labels = {normalize(button.get_name()), normalize(button.get_description())}
    if (states.contains(Atspi.StateType.CHECKED) or
            states.contains(Atspi.StateType.PRESSED) or attributes.get("pressed") == "true" or
            "sc-button-selected" in classes or labels & LIKED_LABELS):
        return "already-liked"
    if labels & LIKE_LABELS and states.contains(Atspi.StateType.SENSITIVE):
        return "ready"
    return "unavailable"


def is_selected(tab):
    return tab.get_state_set().contains(Atspi.StateType.SELECTED)


def activate(node):
    action = node.get_action_iface()
    if action is None:
        return False
    count = action.get_n_actions()
    if count == 1:
        return action.do_action(0)
    for index in range(count):
        if normalize(action.get_action_name(index)) in {"switch", "activate", "click", "press"}:
            return action.do_action(index)
    return False


def select_browser_tab(tab):
    # Firefox versions differ in which of the tab actions they expose.
    if activate(tab):
        return True
    parent = tab.get_parent()
    selection = parent.get_selection_iface() if parent is not None else None
    return selection is not None and selection.select_child(tab.get_index_in_parent())


def click_like(document, button, title):
    state = like_state(button)
    if state == "already-liked":
        return state
    if state != "ready" or not activate(button):
        return "button-unavailable"

    # An accepted click may replace its control. Recheck without clicking again.
    for attempt in range(9):
        time.sleep(0.1)
        try:
            if button is None or attempt in {2, 5}:
                button = player_controls(document, title)
            if button is not None and like_state(button) == "already-liked":
                return "liked"
        except (GLib.Error, RuntimeError):
            button = None
    return "unconfirmed"


def like_soundcloud(pid, title):
    if not title.strip():
        return "unavailable"
    app = connect_firefox(pid)
    if app is None:
        return "firefox-unavailable"

    frames = [frame for frame in children(app) if frame.get_role() == Atspi.Role.FRAME]
    direct = []
    for frame in frames:
        for document in soundcloud_documents(frame):
            button = player_controls(document, title, require_playing=True)
            if button is not None:
                direct.append((document, button))
    if len(direct) > 1:
        return "track-unavailable"
    if direct:
        document, button = direct[0]
        result = click_like(document, button, title)
        if result != "button-unavailable":
            return result

    candidates = []
    for frame in frames:
        frame_tabs = list(tabs(frame))
        selected = next((tab for tab in frame_tabs if is_selected(tab)), None)
        for tab in frame_tabs:
            name = normalize(tab.get_name())
            audible = any(normalize(child.get_name()).startswith(MUTE_LABELS)
                          for child in children(tab))
            soundcloud = "soundcloud" in name
            title_match = normalize(title) in name
            if audible or soundcloud:
                score = 4 * audible + 2 * title_match + soundcloud
                candidates.append((score, frame, tab, selected))

    if not candidates:
        return "tab-unavailable"
    candidates.sort(key=lambda entry: entry[0], reverse=True)
    # When the playing badge is missing, inspect at most three named tabs.
    # Never use a track from a dormant tab as a fallback for a detected audible tab.
    if candidates[0][0] >= 4:
        candidates = [entry for entry in candidates if entry[0] >= 4]

    for score, frame, tab, original in candidates[:3]:
        switched = not is_selected(tab)
        if switched and (original is None or not select_browser_tab(tab)):
            continue
        try:
            document = None
            for _ in range(6):
                if is_selected(tab):
                    document = soundcloud_document(frame, tab)
                if document is not None:
                    break
                time.sleep(0.08)
            if document is None:
                continue
            button = player_controls(document, title, require_playing=score < 4)
            if button is None:
                continue
            return click_like(document, button, title)
        finally:
            if switched and is_selected(tab):
                select_browser_tab(original)

    return "track-unavailable"


if __name__ == "__main__":
    try:
        pid, title = int(sys.argv[1]), sys.argv[2]
        result = like_soundcloud(pid, title) if sys.argv[3:] == ["like"] else select_tab(pid, title)
        print(json.dumps(result))
    except (GLib.Error, RuntimeError, ValueError):
        print("null")
