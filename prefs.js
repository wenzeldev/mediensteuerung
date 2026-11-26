import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gtk from 'gi://Gtk';
import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {parseColor, PRESETS} from './palette.js';

import {SHORTCUTS} from './shortcuts.js';

function addShortcuts(window, settings, connections) {
    const page = new Adw.PreferencesPage({title: 'Tastenkürzel', icon_name: 'input-keyboard-symbolic'});
    const group = new Adw.PreferencesGroup({
        title: 'Globale Tastenkürzel',
        description: 'Kombinationen mit Kommas trennen, zum Beispiel <Super>p, XF86AudioPlay. Ein leeres Feld deaktiviert die Aktion.',
    });
    window.add(page);
    page.add(group);
    const enabled = new Adw.SwitchRow({title: 'Globale Tastenkürzel verwenden'});
    settings.bind('shortcuts', enabled, 'active', 0);
    group.add(enabled);

    for (const [key, title] of Object.entries(SHORTCUTS)) {
        const row = new Adw.EntryRow({title, show_apply_button: true});
        const sync = () => { row.text = settings.get_strv(key).join(', '); };
        sync();
        connections.push(settings.connect(`changed::${key}`, sync));
        row.connect('apply', () => {
            const values = [];
            for (const part of row.text.split(',').map(text => text.trim()).filter(Boolean)) {
                const [parsed, keyval, modifiers] = Gtk.accelerator_parse(part);
                if (!parsed || !Gtk.accelerator_valid(keyval, modifiers)) {
                    const dialog = new Adw.AlertDialog({
                        heading: 'Ungültiges Tastenkürzel',
                        body: part,
                    });
                    dialog.add_response('close', 'Schließen');
                    dialog.present(window);
                    return;
                }
                values.push(Gtk.accelerator_name(keyval, modifiers));
            }
            const shortcuts = [...new Set(values)];
            const conflict = Object.entries(SHORTCUTS).find(([other]) =>
                other !== key && settings.get_strv(other).some(value => {
                    const [parsed, keyval, modifiers] = Gtk.accelerator_parse(value);
                    return parsed && shortcuts.includes(Gtk.accelerator_name(keyval, modifiers));
                }));
            if (conflict) {
                const dialog = new Adw.AlertDialog({
                    heading: 'Tastenkürzel bereits vergeben',
                    body: `Die Kombination wird bereits für „${conflict[1]}“ verwendet.`,
                });
                dialog.add_response('close', 'Schließen');
                dialog.present(window);
                return;
            }
            settings.set_strv(key, shortcuts);
            sync();
        });
        const reset = new Gtk.Button({
            icon_name: 'edit-undo-symbolic',
            tooltip_text: 'Standard wiederherstellen',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        reset.connect('clicked', () => {
            row.text = settings.get_default_value(key).deepUnpack().join(', ');
            row.emit('apply');
        });
        row.add_suffix(reset);
        group.add(row);
    }
}

export default class MediaPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const connections = [];
        addShortcuts(window, settings, connections);
        const page = new Adw.PreferencesPage({title: 'Animation'});
        const colors = new Adw.PreferencesGroup({
            title: 'Globale Farben',
            description: 'Der weiße Schwertreiter behält seine feste Farbe.',
        });
        const presets = new Adw.PreferencesGroup({title: 'Empfohlene Farbschemata'});
        page.add(colors);
        page.add(presets);
        window.add(page);

        for (const [index, title] of ['Primärfarbe', 'Sekundärfarbe'].entries()) {
            const key = index === 0 ? 'primary-color' : 'secondary-color';
            const row = new Adw.ActionRow({title});
            const button = new Gtk.ColorDialogButton({
                dialog: new Gtk.ColorDialog({title, with_alpha: false}),
                valign: Gtk.Align.CENTER,
            });
            const sync = () => {
                const [red, green, blue] = parseColor(settings.get_string(key), PRESETS[0][index + 1]);
                button.rgba = new Gdk.RGBA({red, green, blue, alpha: 1});
            };
            sync();
            connections.push(settings.connect(`changed::${key}`, sync));
            button.connect('notify::rgba', () => {
                const {red, green, blue} = button.rgba;
                const value = '#' + [red, green, blue]
                    .map(channel => Math.round(channel * 255).toString(16).padStart(2, '0')).join('');
                if (settings.get_string(key).toLowerCase() !== value)
                    settings.set_string(key, value);
            });
            row.add_suffix(button);
            row.activatable_widget = button;
            colors.add(row);
        }

        for (const [title, primary, secondary] of PRESETS) {
            const row = new Adw.ActionRow({title, subtitle: `${primary} / ${secondary}`});
            const button = new Gtk.Button({label: 'Übernehmen', valign: Gtk.Align.CENTER});
            button.connect('clicked', () => {
                settings.set_string('primary-color', primary);
                settings.set_string('secondary-color', secondary);
            });
            row.add_suffix(button);
            row.activatable_widget = button;
            presets.add(row);
        }
        window.connect('close-request', () => {
            for (const id of connections)
                settings.disconnect(id);
            return false;
        });
    }
}
