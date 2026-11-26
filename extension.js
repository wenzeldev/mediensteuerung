import Graphene from 'gi://Graphene';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {Slider} from 'resource:///org/gnome/shell/ui/slider.js';

import {Media, property} from './media.js';
import {paintAnimation, STYLES} from './animations.js';
import {parseColor, PRESETS} from './palette.js';

import {loadArtwork} from './artwork.js';
import {SHORTCUTS as ACTIONS} from './shortcuts.js';

const COVER_SIZE = 96;
const ANIMATION_MS = 12_000;
const PIXEL_FRAMES_PER_SECOND = 12;
const GROUP_BACKGROUND = 'background-color: rgba(128, 128, 128, 0.18);';
const PROGRESS_WIDTH = 18;
const DEFAULT_ICON_SIZE = 16;
const CONTROL_INSET = 6;
const ANIMATION_WIDTH_RATIO = 3.5;
const CONTROL_ICON_SCALE = 0.875;

function formatTime(microseconds) {
    const seconds = Math.floor(microseconds / 1_000_000);
    const parts = [Math.floor(seconds / 60), seconds % 60];
    if (parts[0] >= 60) {
        const minutes = parts[0];
        parts.splice(0, 1, Math.floor(minutes / 60), minutes % 60);
    }
    return parts.map((part, i) => i === 0 ? String(part) : String(part).padStart(2, '0')).join(':');
}

export default class Mediensteuerung extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._bindings = new Set();
        this._items = new Map();
        this._seekButtons = new Map();
        this._button = new PanelMenu.Button(0, 'Mediensteuerung');
        this._button.set_style('-minimum-hpadding: 0px; -natural-hpadding: 0px;');
        const indicator = new St.Widget({
            layout_manager: new Clutter.BinLayout(),
            y_align: Clutter.ActorAlign.CENTER,
            height: DEFAULT_ICON_SIZE + CONTROL_INSET,
            style: `${GROUP_BACKGROUND} padding: 0 3px;`,
        });
        this._indicator = indicator;
        this._visual = {
            style: this._settings.get_string('animation-style'),
            phase: 0,
            pixelFrame: 0,
            progress: 0,
            playing: false,
        };

        this._animation = new St.DrawingArea({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
            width: DEFAULT_ICON_SIZE * ANIMATION_WIDTH_RATIO,
            height: DEFAULT_ICON_SIZE,
        });
        this._animation.connect('repaint', area => {
            const cr = area.get_context();
            try {
                paintAnimation(cr, ...area.get_surface_size(), this._visual);
            } finally {
                cr.$dispose();
            }
        });
        indicator.add_child(this._animation);
        this._progress = new St.Bin({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.END,
            width: PROGRESS_WIDTH,
            height: 2,
            style: 'border-radius: 1px; background-color: rgba(255, 255, 255, 0.20);',
            opacity: 0,
        });
        this._progressFill = new St.Widget({
            x_align: Clutter.ActorAlign.START,
            style: 'border-radius: 1px;',
        });
        this._progress.child = this._progressFill;
        indicator.add_child(this._progress);
        this._button.add_child(indicator);
        this._interface = new Gio.Settings({schema_id: 'org.gnome.desktop.interface'});
        this._timeline = Clutter.Timeline.new_for_actor(this._animation, ANIMATION_MS);
        this._timeline.set_repeat_count(-1);
        this._timeline.connect('new-frame', (_timeline, elapsed) => {
            const turn = 2 * Math.PI;
            const phase = (this._phaseStart + elapsed / ANIMATION_MS * turn) % turn;
            const delta = (phase - this._visual.phase + turn) % turn;
            this._visual.pixelFrame += delta / turn * ANIMATION_MS / 1000 * PIXEL_FRAMES_PER_SECOND;
            this._visual.phase = phase;
            this._animation.queue_repaint();
        });
        this._animationId = this._interface.connect('changed::enable-animations',
            () => this._updateAnimation());
        this._animation.connect('notify::mapped', () => this._updateAnimation());
        this._focusCancel = new Gio.Cancellable();
        this._button.menu.box.set_style('min-width: 510px;');
        this._addColorMenu();
        this._addAnimationMenu();
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._artworkSession = new Soup.Session({timeout: 8});
        const coverRow = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        this._cover = new St.Icon({
            icon_name: 'audio-x-generic-symbolic',
            icon_size: COVER_SIZE,
            accessible_name: 'Songcover',
        });
        coverRow.add_child(this._cover);
        this._button.menu.addMenuItem(coverRow);
        coverRow.hide();
        this._coverRow = coverRow;
        this._status = new PopupMenu.PopupMenuItem('Kein steuerbarer Player', {
            reactive: false,
        });
        this._status.label.set_style('max-width: 320px; font-weight: bold;');
        this._button.menu.addMenuItem(this._status);
        this._details = new PopupMenu.PopupMenuItem('', {reactive: false});
        this._details.label.set_style('max-width: 320px;');
        this._details.label.clutter_text.line_wrap = true;
        this._button.menu.addMenuItem(this._details);
        this._button.menu.connect('open-state-changed', (_menu, open) => {
            if (open) {
                this._refreshPosition();
                this._updateArtwork();
            }
        });
        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        for (const [key, label] of Object.entries(ACTIONS)) {
            const item = new PopupMenu.PopupMenuItem(label);
            item.connect('activate', () => this._activate(key));
            this._button.menu.addMenuItem(item);
            this._items.set(key, item);
        }

        this._button.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        this._shortcuts = new PopupMenu.PopupSwitchMenuItem('Globale Tastenkürzel',
            this._settings.get_boolean('shortcuts'));
        this._shortcuts.connect('toggled', (_item, state) =>
            this._settings.set_boolean('shortcuts', state));
        this._button.menu.addMenuItem(this._shortcuts);
        const editShortcuts = new PopupMenu.PopupMenuItem('Tastenkürzel bearbeiten …');
        editShortcuts.connect('activate', () => this.openPreferences());
        this._button.menu.addMenuItem(editShortcuts);
        const syncColors = () => {
            this._visual.color = parseColor(this._settings.get_string('primary-color'), PRESETS[0][1]);
            this._visual.secondary = parseColor(this._settings.get_string('secondary-color'), PRESETS[0][2]);
            const rgb = this._visual.secondary.map(channel => Math.round(channel * 255)).join(', ');
            this._progressFill.set_style(`border-radius: 1px; background-color: rgb(${rgb});`);
            this._syncColorMenu();
            for (const preview of this._previews)
                preview.queue_repaint();
            this._animation.queue_repaint();
        };
        this._colorIds = ['primary-color', 'secondary-color'].map(key =>
            this._settings.connect(`changed::${key}`, syncColors));
        syncColors();
        this._shortcutIds = [this._settings.connect('changed::shortcuts', () => this._update())];
        for (const key of Object.keys(ACTIONS)) {
            this._shortcutIds.push(this._settings.connect(`changed::${key}`, () => {
                if (this._bindings.delete(key))
                    Main.wm.removeKeybinding(key);
                this._update();
            }));
        }

        this._addSeekButton('seek-back', 'media-skip-backward-symbolic', 0);
        Main.panel.addToStatusArea(this.uuid, this._button, 1, 'right');
        this._addSeekButton('seek-forward', 'media-skip-forward-symbolic', 2);
        this._syncIconSize();
        this._media = new Media(() => this._update(), error => {
            console.warn(`Mediensteuerung: ${error.message}`);
            Main.notify('Mediensteuerung', 'Der Player konnte den Befehl nicht ausführen.');
        });
        this._update();
    }

    _addSeekButton(key, icon, position) {
        const container = new PanelMenu.Button(0, ACTIONS[key], true);
        container.setSensitive(false);
        container.set_style('-minimum-hpadding: 0px; -natural-hpadding: 0px;');
        const edge = position === 0 ? '10px 0 0 10px' : '0 10px 10px 0';
        const button = new St.Button({
            accessible_name: ACTIONS[key],
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
            height: DEFAULT_ICON_SIZE + CONTROL_INSET,
            style: `${GROUP_BACKGROUND} border-radius: ${edge}; padding: 0 4px;`,
            child: new St.Icon({
                icon_name: icon,
                style_class: 'system-status-icon',
                style: 'padding: 0; margin: 0;',
                pivot_point: new Graphene.Point({x: 0.5, y: 0.5}),
                scale_x: CONTROL_ICON_SCALE,
                scale_y: CONTROL_ICON_SCALE,
            }),
        });
        button.connect('clicked', () => this._activate(key));
        container.add_child(button);
        this._seekButtons.set(key, {container, button});
        Main.panel.addToStatusArea(`${this.uuid}-${key}`, container, position, 'right');
        if (position === 0)
            button.child.connect('style-changed', () => this._syncIconSize());
    }

    _syncIconSize() {
        const reference = this._seekButtons.get('seek-back')?.button.child;
        const size = reference?.get_stage()
            ? reference.get_theme_node().get_length('icon-size') || DEFAULT_ICON_SIZE
            : DEFAULT_ICON_SIZE;
        const groupHeight = size + CONTROL_INSET;
        this._indicator.height = groupHeight;
        this._animation.set_size(Math.round(size * ANIMATION_WIDTH_RATIO), size);
        for (const {button} of this._seekButtons.values())
            button.height = groupHeight;
    }

    _addColorMenu() {
        const menu = new PopupMenu.PopupSubMenuMenuItem('');
        menu.accessible_name = 'Primär- und Sekundärfarbe ändern';
        const summary = new St.BoxLayout({style: 'spacing: 18px;', x_expand: true});
        menu.insert_child_above(summary, menu.label);
        this._button.menu.addMenuItem(menu);

        this._colorRows = ['Primärfarbe', 'Sekundärfarbe'].map((label, index) => {
            const key = index === 0 ? 'primary-color' : 'secondary-color';
            const pair = new St.BoxLayout({style: 'spacing: 7px;', x_expand: true});
            const swatch = new St.Widget({
                width: 18, height: 18, y_align: Clutter.ActorAlign.CENTER,
            });
            const value = new St.Label({y_align: Clutter.ActorAlign.CENTER});
            pair.add_child(swatch);
            pair.add_child(new St.Label({text: label, y_align: Clutter.ActorAlign.CENTER}));
            pair.add_child(value);
            summary.add_child(pair);

            const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const panel = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                style: 'spacing: 2px;',
            });
            const title = new St.Label({text: label});
            panel.add_child(title);
            row.add_child(panel);
            menu.menu.addMenuItem(row);

            const sliders = ['Rot', 'Grün', 'Blau'].map(name => {
                const line = new St.BoxLayout({style: 'spacing: 8px;'});
                line.add_child(new St.Label({
                    text: name, width: 48, y_align: Clutter.ActorAlign.CENTER,
                }));
                const slider = new Slider(0);
                slider.accessible_name = `${label} – ${name}`;
                line.add_child(slider);
                panel.add_child(line);
                return slider;
            });
            for (const slider of sliders) {
                slider.connect('notify::value', () => {
                    if (this._syncingColorControls)
                        return;
                    const hex = '#' + sliders.map(control =>
                        Math.round(control.value * 255).toString(16).padStart(2, '0')).join('');
                    this._settings.set_string(key, hex);
                });
            }
            return {swatch, value, sliders};
        });

        const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        const presets = new St.BoxLayout({style: 'spacing: 6px;', x_expand: true});
        row.add_child(presets);
        for (const [name, primary, secondary] of PRESETS) {
            const colors = new St.BoxLayout({style: 'spacing: 3px;'});
            for (const color of [primary, secondary]) {
                colors.add_child(new St.Widget({
                    width: 16, height: 16,
                    style: `background-color: ${color}; border-radius: 4px;`,
                }));
            }
            const button = new St.Button({
                child: colors, accessible_name: name, can_focus: true,
                style_class: 'button', style: 'padding: 6px;',
            });
            button.connect('clicked', () => {
                this._settings.set_string('primary-color', primary);
                this._settings.set_string('secondary-color', secondary);
            });
            presets.add_child(button);
        }
        menu.menu.addMenuItem(row);
    }

    _syncColorMenu() {
        this._syncingColorControls = true;
        for (const [index, rgb] of [this._visual.color, this._visual.secondary].entries()) {
            const {swatch, value, sliders} = this._colorRows[index];
            const hex = '#' + rgb.map(channel => Math.round(channel * 255)
                .toString(16).padStart(2, '0')).join('');
            swatch.style = `background-color: ${hex}; border-radius: 5px;`;
            value.text = hex.toUpperCase();
            sliders.forEach((slider, channel) => slider.value = rgb[channel]);
        }
        this._syncingColorControls = false;
    }

    _addAnimationMenu() {
        const submenu = new PopupMenu.PopupSubMenuMenuItem('Animation');
        const options = new Map();
        this._previews = [];
        const groups = Object.entries(STYLES);
        for (let index = 0; index < groups.length; index += 3) {
            const row = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
            const grid = new St.BoxLayout({style: 'spacing: 6px;', x_expand: true});
            row.add_child(grid);
            submenu.menu.addMenuItem(row);
            for (const [style, label] of groups.slice(index, index + 3)) {
                const preview = new St.DrawingArea({
                    width: 56, height: 16, x_align: Clutter.ActorAlign.CENTER,
                });
                preview.connect('repaint', area => {
                    if (!this._visual.color)
                        return;
                    const cr = area.get_context();
                    try {
                        paintAnimation(cr, ...area.get_surface_size(),
                            {...this._visual, style, playing: true, phase: 1.3, pixelFrame: 5});
                    } finally {
                        cr.$dispose();
                    }
                });
                this._previews.push(preview);

                const content = new St.BoxLayout({
                    orientation: Clutter.Orientation.VERTICAL,
                    style: 'spacing: 4px;',
                });
                content.add_child(preview);
                const caption = new St.Label({
                    text: label, width: 140, height: 35,
                    x_align: Clutter.ActorAlign.CENTER,
                });
                caption.clutter_text.line_wrap = true;
                caption.clutter_text.line_wrap_mode = Pango.WrapMode.WORD_CHAR;
                caption.clutter_text.line_alignment = Pango.Alignment.CENTER;
                content.add_child(caption);
                const tile = new St.Button({
                    child: content, accessible_name: label, can_focus: true,
                    toggle_mode: true, x_expand: true, style_class: 'button',
                    style: 'padding: 7px 6px; min-width: 138px;',
                });
                tile.connect('clicked', () => {
                    this._settings.set_string('animation-style', style);
                    tile.checked = true;
                });
                grid.add_child(tile);
                options.set(style, tile);
            }
        }
        this._button.menu.addMenuItem(submenu);

        const syncStyle = () => {
            const style = this._settings.get_string('animation-style');
            this._visual.style = style;
            submenu.label.text = `Animation · ${STYLES[style] ?? STYLES.scope}`;
            for (const [key, tile] of options)
                tile.checked = key === style;
            this._animation.queue_repaint();
        };
        this._styleId = this._settings.connect('changed::animation-style', syncStyle);
        syncStyle();
    }

    _updateAnimation() {
        const playing = this._media?.current?.status === 'Playing';
        this._visual.playing = playing;
        const animate = playing && this._animation.mapped &&
            this._interface.get_boolean('enable-animations');
        if (animate && !this._timeline.is_playing()) {
            this._phaseStart = this._visual.phase;
            this._timeline.start();
        } else if (!animate && this._timeline.is_playing()) {
            this._timeline.stop();
        }
        this._animation.queue_repaint();
    }

    _app(entry) {
        const desktop = property(entry?.root, 'DesktopEntry');
        const app = desktop ? Shell.AppSystem.get_default().lookup_app(
            desktop.endsWith('.desktop') ? desktop : desktop + '.desktop') : null;
        return app ?? (entry?.pid
            ? Shell.WindowTracker.get_default().get_app_from_pid(entry.pid) : null);
    }

    _enabled(key, entry) {
        if (!entry)
            return false;
        switch (key) {
        // Keep the existing settings keys so customized shortcuts survive the update.
        case 'seek-back':
            return !!property(entry.player, 'CanGoPrevious');
        case 'seek-forward':
            return !!property(entry.player, 'CanGoNext');
        case 'toggle-playback':
            return !!property(entry.player, entry.status === 'Playing' ? 'CanPause' : 'CanPlay');
        case 'like-soundcloud': {
            const metadata = property(entry.player, 'Metadata');
            const url = metadata?.['xesam:url']?.deepUnpack() ?? '';
            return !!entry.pid && entry.status === 'Playing' &&
                entry.player.get_name().toLowerCase().includes('firefox') &&
                (!url || /^https:\/\/(?:www\.)?soundcloud\.com(?:[/?#]|$)/i.test(url)) &&
                !!metadata?.['xesam:title']?.deepUnpack();
        }
        case 'open-player':
            return !!property(entry.root, 'CanRaise') || !!this._app(entry);
        default:
            return false;
        }
    }

    _update() {
        const entry = this._media.current;
        this._updateTrack(entry);
        this._items.get('toggle-playback').label.text = entry?.status === 'Playing'
            ? 'Pause' : 'Wiedergabe starten';
        const shortcuts = this._settings.get_boolean('shortcuts');
        this._shortcuts.setToggleState(shortcuts);
        this._updateAnimation();

        for (const [key, item] of this._items) {
            const available = this._enabled(key, entry);
            item.setSensitive(available);
            const control = this._seekButtons.get(key);
            if (control) {
                control.button.reactive = available;
                control.button.can_focus = available;
                control.button.opacity = available ? 255 : 100;
            }
            const shouldBind = available && shortcuts && this._settings.get_strv(key).some(Boolean);
            if (shouldBind && !this._bindings.has(key)) {
                const action = Main.wm.addKeybinding(key, this._settings,
                    Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                    Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                    () => this._activate(key, true));
                if (action !== Meta.KeyBindingAction.NONE) {
                    this._bindings.add(key);
                } else {
                    Main.notify('Mediensteuerung', `Tastenkürzel konnte nicht registriert werden: ${ACTIONS[key]}`);
                }
            } else if (!shouldBind && this._bindings.delete(key)) {
                Main.wm.removeKeybinding(key);
            }
        }
    }

    _updateTrack(entry) {
        const metadata = property(entry?.player, 'Metadata') ?? {};
        const value = key => metadata[key]?.deepUnpack();
        const title = value('xesam:title');
        const artist = value('xesam:artist')?.filter(Boolean).join(', ');
        const album = value('xesam:album');
        const identity = property(entry?.root, 'Identity') || this._app(entry)?.get_name();
        const track = [value('mpris:trackid'), value('xesam:url'), title, artist]
            .filter(Boolean).join('\n');
        const length = value('mpris:length');
        if (this._progressPlayer !== entry || this._track !== track ||
            this._duration !== length || entry?.status === 'Stopped') {
            this._progressPlayer = entry;
            this._track = track;
            this._duration = length;
            this._position = null;
            this._positionRequest = null;
        }

        this._status.label.text = title || identity || (entry
            ? 'Aktiver Player' : 'Kein steuerbarer Player');
        this._artworkUri = entry?.status !== 'Stopped' ? value('mpris:artUrl') : null;
        this._updateArtwork();
        this._trackInfo = [
            [artist, album].filter(Boolean).join(' · '),
            [title && identity, {
                Playing: 'Wiedergabe', Paused: 'Pausiert', Stopped: 'Gestoppt',
            }[entry?.status]].filter(Boolean).join(' · '),
        ].filter(Boolean);
        this._renderProgress();
        this._refreshPosition();

        const playing = entry?.status === 'Playing' && length > 0;
        if (playing && !this._progressTimer) {
            this._progressTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
                this._refreshPosition();
                return GLib.SOURCE_CONTINUE;
            });
        } else if (!playing && this._progressTimer) {
            GLib.Source.remove(this._progressTimer);
            this._progressTimer = 0;
        }
    }

    _updateArtwork() {
        if (!this._button.menu.isOpen)
            return;

        this._coverRow.visible = !!this._progressPlayer && this._progressPlayer.status !== 'Stopped';
        const uri = this._artworkUri || null;
        if (uri === this._loadedArtworkUri)
            return;

        this._artworkRequest?.cancel();
        this._artworkRequest = null;
        this._loadedArtworkUri = uri;
        this._cover.icon_name = 'audio-x-generic-symbolic';
        if (!uri)
            return;

        const request = new Gio.Cancellable();
        this._artworkRequest = request;
        const scale = St.ThemeContext.get_for_stage(global.stage).scale_factor;
        loadArtwork(uri, this._artworkSession, COVER_SIZE * scale, request).then(icon => {
            if (this._artworkRequest === request && icon)
                this._cover.gicon = icon;
        }).catch(() => {
            // Keep the music icon if the player supplies unavailable artwork.
            if (this._artworkRequest === request)
                this._loadedArtworkUri = null;
        }).finally(() => {
            if (this._artworkRequest === request)
                this._artworkRequest = null;
        });
    }

    _refreshPosition() {
        const entry = this._progressPlayer;
        if (!entry || entry.status === 'Stopped' || !(this._duration > 0) ||
            this._positionRequest)
            return;
        const request = {};
        this._positionRequest = request;
        this._media.readPosition(entry, position => {
            if (this._positionRequest !== request)
                return;
            this._positionRequest = null;
            this._position = Number.isFinite(position)
                ? Math.max(0, Math.min(position, this._duration)) : null;
            this._renderProgress();
        });
    }

    _renderProgress() {
        const known = this._position != null && this._duration > 0;
        this._progress.opacity = known ? 255 : 0;
        this._progressFill.width = known
            ? Math.round(this._position / this._duration * PROGRESS_WIDTH) : 0;
        this._visual.progress = known ? this._position / this._duration : 0;
        this._animation.queue_repaint();
        const lines = [...this._trackInfo];
        if (known)
            lines.push(`${formatTime(this._position)} / ${formatTime(this._duration)}`);
        this._details.label.text = lines.join('\n');
        this._details.visible = lines.length > 0;
    }

    _activate(key, shortcut = false) {
        const entry = this._media.current;
        if (!this._enabled(key, entry))
            return;
        if (key === 'like-soundcloud') {
            this._likeSoundCloud(entry);
        } else if (key === 'open-player') {
            this._openPlayer(entry, shortcut);
        } else if (key === 'toggle-playback') {
            this._media.call(entry.player, entry.status === 'Playing' ? 'Pause' : 'Play');
        } else {
            this._media.call(entry.player, key === 'seek-back' ? 'Previous' : 'Next');
        }
    }

    _likeSoundCloud(entry) {
        if (this._liking)
            return;
        const title = property(entry.player, 'Metadata')['xesam:title'].deepUnpack();
        let process;
        try {
            process = Gio.Subprocess.new(['/usr/bin/python3',
                this.dir.get_child('firefox-tabs.py').get_path(), String(entry.pid), title, 'like'],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (error) {
            Main.notify('SoundCloud', 'Die Firefox-Hilfe konnte nicht gestartet werden.');
            return;
        }

        this._liking = process;
        const cancel = this._focusCancel;
        let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 10000, () => {
            timeout = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        process.communicate_utf8_async(null, cancel, (source, result) => {
            if (timeout)
                GLib.Source.remove(timeout);
            let status;
            try {
                const [, output] = source.communicate_utf8_finish(result);
                if (source.get_successful())
                    status = JSON.parse(output);
            } catch {
                // The helper may have been cancelled while Firefox closed.
            }
            if (cancel.is_cancelled())
                return;

            this._liking = null;
            const messages = {
                liked: `Gefällt mir: ${title}`,
                'already-liked': `Bereits gelikt: ${title}`,
                unconfirmed: 'SoundCloud hat den Like noch nicht bestätigt.',
                'firefox-unavailable': 'Firefox antwortet nicht über die Bedienungshilfen.',
                'tab-unavailable': 'Kein SoundCloud-Tab in Firefox gefunden.',
                'track-unavailable': 'Der Firefox-Miniplayer zeigt den laufenden Titel nicht an.',
                'button-unavailable': 'Der Like-Knopf des laufenden Titels ist nicht verfügbar.',
            };
            Main.notify('SoundCloud', messages[status] ??
                'Der laufende SoundCloud-Titel wurde in Firefox nicht eindeutig gefunden.');
        });
    }

    _openPlayer(entry, shortcut) {
        if (this._openingPlayer)
            return;
        const current = global.display.focus_window;
        const app = this._app(entry);
        const windows = () => (app?.get_windows() ?? [])
            .filter(window => !window.skip_taskbar && window.get_workspace())
            .sort((a, b) => b.get_user_time() - a.get_user_time());

        if (shortcut && current === this._playerWindow && this._returnWindow &&
            global.get_window_actors().some(actor => actor.meta_window === this._returnWindow)) {
            const previous = this._returnWindow;
            this._returnWindow = this._playerWindow = null;
            Main.activateWindow(previous);
            return;
        }

        const focus = tab => {
            const candidates = windows();
            const target = (tab?.window && candidates.find(window => window.get_title() === tab.window)) ||
                (tab?.tab && candidates.find(window => window.get_title()?.includes(tab.tab))) ||
                candidates[0];
            if (target) {
                if (shortcut && current && current !== target) {
                    this._returnWindow = current;
                    this._playerWindow = target;
                }
                Main.activateWindow(target);
            } else if (app) {
                app.activate();
            } else if (property(entry.root, 'CanRaise')) {
                this._media.call(entry.root, 'Raise');
            }
        };

        const desktop = property(entry.root, 'DesktopEntry') ?? app?.get_id() ?? '';
        const busName = entry.player.get_name();
        if (!entry.pid || ![desktop, busName].some(name => name.toLowerCase().includes('firefox'))) {
            focus(null);
            return;
        }

        const title = property(entry.player, 'Metadata')?.['xesam:title']?.deepUnpack() ?? '';
        let process;
        try {
            process = Gio.Subprocess.new(['/usr/bin/python3',
                this.dir.get_child('firefox-tabs.py').get_path(), String(entry.pid), title],
            Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE);
        } catch (error) {
            console.warn(`Mediensteuerung: ${error.message}`);
            focus(null);
            return;
        }

        this._openingPlayer = true;
        const cancel = this._focusCancel;
        let timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2800, () => {
            timeout = 0;
            process.force_exit();
            return GLib.SOURCE_REMOVE;
        });
        process.communicate_utf8_async(null, cancel, (source, result) => {
            if (timeout)
                GLib.Source.remove(timeout);
            let tab = null;
            try {
                const [, output] = source.communicate_utf8_finish(result);
                if (source.get_successful())
                    tab = JSON.parse(output);
            } catch (error) {
                if (!cancel.is_cancelled())
                    console.debug(`Mediensteuerung: ${error.message}`);
            }
            if (cancel.is_cancelled()) {
                process.force_exit();
                return;
            }
            this._openingPlayer = false;
            focus(tab);
        });
    }

    disable() {
        this._artworkRequest?.cancel();
        this._artworkRequest = this._loadedArtworkUri = this._artworkUri = null;
        this._artworkSession.abort();
        this._artworkSession = this._cover = this._coverRow = null;
        this._focusCancel?.cancel();
        this._liking?.force_exit();
        this._liking = null;
        this._openingPlayer = false;
        this._returnWindow = this._playerWindow = null;
        if (this._progressTimer) {
            GLib.Source.remove(this._progressTimer);
            this._progressTimer = 0;
        }
        this._media?.destroy();
        this._media = null;
        this._progressPlayer = this._positionRequest = this._position = null;
        this._timeline.stop();
        for (const key of this._bindings)
            Main.wm.removeKeybinding(key);
        for (const id of this._shortcutIds)
            this._settings.disconnect(id);
        this._settings.disconnect(this._styleId);
        for (const id of this._colorIds)
            this._settings.disconnect(id);
        this._interface.disconnect(this._animationId);
        for (const {container} of this._seekButtons.values())
            container.destroy();
        this._button.destroy();
        this._bindings = this._items = this._settings = this._seekButtons =
            this._button = this._status = this._shortcuts = this._interface =
            this._animation = this._timeline = this._focusCancel = null;
        this._visual = this._indicator = null;
        this._colorRows = this._previews = null;
        this._progress = this._progressFill = this._details = null;
    }
}
