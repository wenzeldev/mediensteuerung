import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ROOT = 'org.mpris.MediaPlayer2';
const PLAYER = ROOT + '.Player';
const PATH = '/org/mpris/MediaPlayer2';
const BUS = 'org.freedesktop.DBus';

export class Media {
    constructor(changed, failed) {
        this.changed = changed;
        this.failed = failed;
        this.bus = Gio.DBus.session;
        this.cancel = new Gio.Cancellable();
        this.players = new Map();

        // Listen before listing so players started during discovery are seen.
        this.subscription = this.bus.signal_subscribe(
            BUS, BUS, 'NameOwnerChanged', '/org/freedesktop/DBus', ROOT,
            Gio.DBusSignalFlags.MATCH_ARG0_NAMESPACE,
            (_bus, _sender, _path, _iface, _signal, parameters) => {
                const [name, oldOwner, newOwner] = parameters.deepUnpack();
                if (!name.startsWith(ROOT + '.'))
                    return;
                if (oldOwner)
                    this.remove(name);
                if (newOwner)
                    this.add(name);
                this.changed();
            });

        this.bus.call(BUS, '/org/freedesktop/DBus', BUS, 'ListNames', null,
            new GLib.VariantType('(as)'), Gio.DBusCallFlags.NONE, 3000,
            this.cancel, (bus, result) => {
                try {
                    const [names] = bus.call_finish(result).deepUnpack();
                    if (!this.cancel.is_cancelled())
                        names.filter(name => name.startsWith(ROOT + '.'))
                            .forEach(name => this.add(name));
                } catch (error) {
                    if (!this.cancel.is_cancelled())
                        this.failed(error);
                }
            });
    }

    add(name) {
        if (this.players.has(name))
            return;
        const entry = {signals: [], activity: 0};
        this.players.set(name, entry);

        for (const [key, iface] of [['player', PLAYER], ['root', ROOT]]) {
            Gio.DBusProxy.new(this.bus, Gio.DBusProxyFlags.DO_NOT_AUTO_START,
                null, name, PATH, iface, this.cancel, (_source, result) => {
                    let proxy;
                    try {
                        proxy = Gio.DBusProxy.new_finish(result);
                    } catch (error) {
                        if (this.players.get(name) === entry)
                            this.failed(error);
                        return;
                    }
                    if (this.players.get(name) !== entry)
                        return;
                    entry[key] = proxy;
                    if (key === 'player')
                        this.findProcess(name, entry, proxy.get_name_owner());
                    const update = () => {
                        if (key === 'player') {
                            const status = property(proxy, 'PlaybackStatus');
                            if (status !== entry.status && status === 'Playing')
                                entry.activity = GLib.get_monotonic_time();
                            entry.status = status;
                        }
                        this.changed();
                    };
                    entry.signals.push([proxy, proxy.connect('g-properties-changed', update)]);
                    if (key === 'player') {
                        entry.signals.push([proxy, proxy.connect('g-signal',
                            (_proxy, _sender, signal) => {
                                if (signal === 'Seeked')
                                    this.changed();
                            })]);
                    }
                    update();
                });
        }
    }

    findProcess(name, entry, owner) {
        if (!owner)
            return;
        this.bus.call(BUS, '/org/freedesktop/DBus', BUS, 'GetConnectionUnixProcessID',
            new GLib.Variant('(s)', [owner]), new GLib.VariantType('(u)'),
            Gio.DBusCallFlags.NONE, 3000, this.cancel, (bus, result) => {
                try {
                    const [pid] = bus.call_finish(result).deepUnpack();
                    if (this.players.get(name) === entry) {
                        entry.pid = pid;
                        this.changed();
                    }
                } catch (error) {
                    // A disappearing player or a proxy without a local PID
                    // can still be handled through DesktopEntry or Raise.
                    if (this.players.get(name) === entry)
                        console.debug(`Mediensteuerung: ${error.message}`);
                }
            });
    }

    remove(name) {
        const entry = this.players.get(name);
        if (!entry)
            return;
        this.players.delete(name);
        for (const [proxy, signal] of entry.signals)
            proxy.disconnect(signal);
    }

    get current() {
        const rank = {Playing: 2, Paused: 1, Stopped: 0};
        return [...this.players.values()]
            .filter(entry => entry.player?.get_name_owner() &&
                property(entry.player, 'CanControl'))
            .sort((a, b) => (rank[b.status] ?? -1) - (rank[a.status] ?? -1) ||
                b.activity - a.activity)[0];
    }

    call(proxy, method, parameters = null) {
        proxy.call(method, parameters, Gio.DBusCallFlags.NONE, 3000,
            this.cancel, (source, result) => {
                try {
                    source.call_finish(result);
                } catch (error) {
                    if (!this.cancel.is_cancelled())
                        this.failed(error);
                }
            });
    }

    readPosition(entry, callback) {
        this.bus.call(entry.player.get_name_owner(), PATH,
            'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', [PLAYER, 'Position']), new GLib.VariantType('(v)'),
            Gio.DBusCallFlags.NONE, 2500, this.cancel, (bus, result) => {
                let position = null;
                try {
                    const [value] = bus.call_finish(result).deepUnpack();
                    position = value.deepUnpack();
                } catch {
                    // Some players do not expose the current position.
                }
                if (!this.cancel.is_cancelled())
                    callback(position);
            });
    }

    destroy() {
        this.cancel.cancel();
        this.bus.signal_unsubscribe(this.subscription);
        for (const name of this.players.keys())
            this.remove(name);
    }
}

export function property(proxy, name) {
    return proxy?.get_cached_property(name)?.deepUnpack();
}
