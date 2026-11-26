import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

Gio._promisify(Gio.File.prototype, 'read_async', 'read_finish');
Gio._promisify(Gio.InputStream.prototype, 'close_async', 'close_finish');
Gio._promisify(Soup.Session.prototype, 'send_async', 'send_finish');
Gio._promisify(GdkPixbuf.Pixbuf, 'new_from_stream_at_scale_async', 'new_from_stream_finish');

export async function loadArtwork(uri, session, size, cancellable) {
    const scheme = GLib.Uri.parse_scheme(uri)?.toLowerCase();
    let stream;
    if (scheme === 'file') {
        stream = await Gio.File.new_for_uri(uri).read_async(GLib.PRIORITY_DEFAULT, cancellable);
    } else if (scheme === 'https' || scheme === 'http') {
        const message = Soup.Message.new('GET', uri);
        stream = await session.send_async(message, GLib.PRIORITY_DEFAULT, cancellable);
        if (message.status_code < 200 || message.status_code >= 300) {
            await stream.close_async(GLib.PRIORITY_DEFAULT, null);
            return null;
        }
    } else if (scheme === 'data') {
        const match = /^data:image\/[^,;]+;base64,([a-z0-9+/=]+)$/i.exec(uri);
        if (!match)
            return null;
        stream = Gio.MemoryInputStream.new_from_bytes(new GLib.Bytes(GLib.base64_decode(match[1])));
    } else {
        return null;
    }

    try {
        const pixbuf = await GdkPixbuf.Pixbuf.new_from_stream_at_scale_async(
            stream, size, size, true, cancellable);
        const [, png] = pixbuf.save_to_bufferv('png', [], []);
        return Gio.BytesIcon.new(new GLib.Bytes(png));
    } finally {
        await stream.close_async(GLib.PRIORITY_DEFAULT, null);
    }
}
