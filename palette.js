export const PRESETS = [
    ['Zinnober & Eis', '#ff704f', '#71cfd4'],
    ['Pfirsich & Flieder', '#ffbe91', '#b697ff'],
    ['Limette & Petrol', '#d9f578', '#38b5a5'],
    ['Kirschrot & Gold', '#ff5b72', '#ffcc67'],
    ['Mondlicht', '#f4f5ff', '#8c9fc6'],
];

export function parseColor(value, fallback) {
    const hex = /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
    return [1, 3, 5].map(offset => Number.parseInt(hex.slice(offset, offset + 2), 16) / 255);
}
