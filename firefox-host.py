#!/usr/bin/python3
"""Native Messaging connection between Firefox and the GNOME extension."""
import itertools
import json
import struct
import sys
import threading

from gi.repository import Gio, GLib

BUS_NAME = "org.gnome.MediaControlsFirefox"
OBJECT_PATH = "/org/gnome/MediaControlsFirefox"
INTERFACE = Gio.DBusNodeInfo.new_for_xml(f"""
<node><interface name="{BUS_NAME}">
  <method name="FocusAudibleTab">
    <arg type="s" direction="in"/>
    <arg type="s" direction="out"/>
  </method>
</interface></node>
""").interfaces[0]
loop = GLib.MainLoop()
pending = {}
ids = itertools.count(1)


def reply(message):
    request = pending.pop(message.get("id"), None)
    if request:
        invocation, timeout = request
        GLib.Source.remove(timeout)
        invocation.return_value(GLib.Variant("(s)", (str(message.get("title", "")),)))
    return GLib.SOURCE_REMOVE


def read_messages():
    try:
        while header := sys.stdin.buffer.read(4):
            size, = struct.unpack("=I", header)
            if size > 1_048_576:
                break
            message = json.loads(sys.stdin.buffer.read(size))
            if isinstance(message, dict) and isinstance(message.get("id"), int):
                GLib.idle_add(reply, message)
    except (ValueError, OSError, struct.error):
        pass
    finally:
        GLib.idle_add(loop.quit)


def focus(_connection, _sender, _path, _interface, _method, parameters, invocation):
    request_id = next(ids)

    def expired():
        pending.pop(request_id, None)
        invocation.return_value(GLib.Variant("(s)", ("",)))
        return GLib.SOURCE_REMOVE

    title, = parameters.unpack()
    payload = json.dumps({"id": request_id, "title": title}).encode()
    try:
        sys.stdout.buffer.write(struct.pack("=I", len(payload)) + payload)
        sys.stdout.buffer.flush()
    except OSError:
        invocation.return_value(GLib.Variant("(s)", ("",)))
        return
    pending[request_id] = invocation, GLib.timeout_add(1500, expired)


def start():
    bus = Gio.bus_get_sync(Gio.BusType.SESSION)
    bus.register_object(OBJECT_PATH, INTERFACE, focus, None, None)
    owner = Gio.bus_own_name_on_connection(
        bus, BUS_NAME, Gio.BusNameOwnerFlags.DO_NOT_QUEUE, None, None)
    threading.Thread(target=read_messages, daemon=True).start()
    loop.run()
    Gio.bus_unown_name(owner)


if __name__ == "__main__":
    start()
