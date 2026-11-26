import {parseColor} from './palette.js';

const {round: int, sin} = Math;
const TURN = 2 * Math.PI;
const fixedColors = new Map();

function rgb(value) {
    if (typeof value !== 'string')
        return value;
    if (!fixedColors.has(value))
        fixedColors.set(value, parseColor(value, '#ffffff'));
    return fixedColors.get(value);
}

const bitmaps = {
    ship: [
        '.....22.....', '....2112....', '...211112...', '..21111112..',
        '.2111221112.', '211112211112', '22.111111.22', '...22..22...',
    ],
    sat: [
        '11...2222...11', '121..2112..121', '12211222211221',
        '121..2112..121', '11...2222...11',
    ],
    crab: [
        '12.......21', '112.....211', '.111111111.', '..1212121..',
        '.111111111.', '11.11111.11', '1.11...11.1',
    ],
};

function brushes(cr, A, B) {
    let previousColor;
    function r(x, y, width = 1, height = 1, color = A) {
        if (color !== previousColor) {
            cr.setSourceRGBA(...rgb(color), 1);
            previousColor = color;
        }
        cr.rectangle(int(x), int(y), width, height);
        cr.fill();
    }

    const p = (x, y, color = A) => r(x, y, 1, 1, color);

    function line(x, y, endX, endY, color = A) {
        x = int(x);
        y = int(y);
        endX = int(endX);
        endY = int(endY);
        const dx = Math.abs(endX - x);
        const dy = -Math.abs(endY - y);
        const stepX = x < endX ? 1 : -1;
        const stepY = y < endY ? 1 : -1;
        let error = dx + dy;
        while (true) {
            p(x, y, color);
            if (x === endX && y === endY)
                break;
            const doubled = 2 * error;
            if (doubled >= dy) {
                error += dy;
                x += stepX;
            }
            if (doubled <= dx) {
                error += dx;
                y += stepY;
            }
        }
    }

    function orb(x, y, radiusX, radiusY, color = A) {
        for (let k = 0; k < 48; k++) {
            const angle = k * TURN / 48;
            p(x + radiusX * sin(angle), y + radiusY * Math.cos(angle), color);
        }
    }

    function sprite(id, x, y) {
        for (const [dy, row] of bitmaps[id].entries()) {
            for (const [dx, pixel] of [...row].entries()) {
                if (pixel !== '.')
                    p(x + dx, y + dy, pixel === '1' ? A : B);
            }
        }
    }

    function star(x, y, color = B) {
        p(x, y - 1, color);
        r(x - 1, y, 3, 1, color);
        p(x, y + 1, color);
    }

    return {r, p, line, orb, sprite, star, A, B};
}

function segmentMeter({r, A, B}, t) {
    for (let i = 0; i < 18; i++) {
        const height = 1 + int(5 * Math.abs(sin(i * 0.39 - t * 0.22) * sin(i * 0.17 + t * 0.12)));
        for (let j = 0; j < height; j++) {
            r(2 + i * 3, 6 - j, 2, 1, A);
            r(2 + i * 3, 9 + j, 2, 1, B);
        }
    }
}

function squareWave({line, A, B}, t) {
    for (let x = 0; x < 54; x += 3) {
        const y = 8 + int(5 * sin(x * 0.26 - t * 0.18));
        const z = 8 - int(5 * sin(x * 0.2 + t * 0.16));
        line(x, y, x + 2, y, A);
        line(x, z, x + 2, z, B);
    }
}

function satelliteOrbit({orb, sprite, star}, t) {
    orb(28, 8, 22, 6);
    sprite('sat', 21 + 17 * sin(t * 0.093), 5 + 4 * Math.cos(t * 0.093));
    star(8, 3);
    star(48, 12);
}

function rocketLaunch({sprite, r, p, B}, t) {
    sprite('ship', 21 + sin(t * 0.19) * 8, 1 + sin(t * 0.1) * 2);
    for (let j = 0; j < 12; j++)
        p(25 + int(sin(j + t * 0.37) * j * 0.35), 11 + (j + t) % 5, B);
    r(23 + t % 5, 14, 4, 1);
}

function asteroidPass({orb, sprite, B}, t) {
    for (let i = 0; i < 5; i++)
        orb(57 - (t + i * 12) % 60, 3 + i * 7 % 12, 2 + i % 3, 1 + i % 2, B);
    sprite('ship', 18 + 7 * sin(t * 0.18), 3 + 3 * sin(t * 0.13));
}

function reefCrab({sprite, p, B}, t) {
    sprite('crab', 21 + 12 * sin(t * 0.11), 7 + sin(t * 0.3));
    for (let i = 0; i < 11; i++)
        p(2 + 5 * i, 15 - (i + t) % 3, B);
}

function catEyes({r, line, p}, t) {
    const phase = t;
    const blink = phase >= 72 ? phase - 72 : phase >= 34 && phase < 42 ? phase - 34 : -1;
    const opening = blink < 0 ? 3 : [3, 2, 1, 1, 0, 1, 2, 3, 3, 3, 3, 3][blink];
    const twitch = start => [0, 1, 2, 1, 0][phase - start] ?? 0;
    const dark = '#472638', coat = '#eaa77c', ear = '#ee8291', cream = '#ffe7bb';
    const left = twitch(12), right = twitch(54);
    for (const [x, dir, kick] of [[13, 1, left], [42, -1, right]]) {
        for (let y = 0; y < 7; y++) {
            const row = y + kick % 2;
            line(x + dir * kick, row, x + dir * (y + kick), row, dark);
        }
        for (let y = 2; y < 7; y++)
            line(x + dir * (kick + 1), y, x + dir * (y + kick), y, coat);
        line(x + dir * (kick + 2), 4, x + dir * (kick + 4), 6, ear);
    }
    const half = [9, 13, 16, 17, 18, 18, 18, 18, 17, 16, 14, 11];
    half.forEach((w, y) => {
        r(28 - w, y + 4, w * 2, 1, dark);
        if (y > 0 && y < half.length - 1)
            r(29 - w, y + 4, w * 2 - 2, 1, coat);
    });
    for (const x of [20, 35]) {
        if (opening === 0) {
            line(x - 3, 10, x - 1, 11, dark);
            line(x - 1, 11, x + 1, 11, dark);
            line(x + 1, 11, x + 3, 10, dark);
            continue;
        }
        for (let y = -opening; y <= opening; y++) {
            const width = Math.abs(y) === opening ? 2 : 4;
            r(x - width, 10 + y, width * 2 + 1, 1, cream);
        }
        const gaze = phase >= 46 && phase < 66 ? 1 : phase >= 21 && phase < 33 ? -1 : 0;
        const iris = x + gaze;
        if (opening >= 2) {
            r(iris - 1, 8, 3, 5, '#512b49');
            r(iris - 2, 9, 5, 3, '#512b49');
            r(iris - 1, 8, 2, 2, '#fffdf2');
            p(iris + 1, 11, '#edbad0');
        } else {
            r(iris - 1, 10, 3, 1, dark);
        }
    }
    r(25, 12, 6, 2, cream);
    r(27, 11, 2, 1, '#ae4e69');
    p(28, 12, dark);
    p(27, 13, dark);
    p(29, 13, dark);
    const w = opening <= 1 ? 1:0;
    line(5, 9 - w, 12, 11, cream);
    line(5, 13, 12, 13, cream);
    line(50, 9 - w, 43, 11, cream);
    line(50, 13, 43, 13, cream);
}

const jumpingFrog = [
    '..11...1...', '.12211111..', '1111111211.', '.1112221111',
    '..1111111..', '.11....111.', '11......1..',
];
const sittingFrog = [
    '..11...1...', '.12211111..', '1111111211.', '11121111111',
    '.111222111.', '..1111111..', '.11.....11.',
];

function frogJump({r, p, A, B}, frame) {
    r(3, 15, 15, 1, B);
    r(38, 15, 15, 1, B);
    const goingRight = frame < 32;
    const step = frame % 32;
    const flight = Math.min(1, Math.max(0, (step - 5) / 22));
    const x = (goingRight ? 4 : 40) + (goingRight ? 1 : -1) * 36 * flight;
    const y = 8 - 7 * sin(Math.PI * flight);
    const pose = flight > 0 && flight < 1 ? jumpingFrog : sittingFrog;
    for (const [dy, row] of pose.entries()) {
        for (const [dx, pixel] of [...row].entries()) {
            if (pixel !== '.') {
                const offsetX = goingRight ? dx : row.length - 1 - dx;
                p(x + offsetX, y + dy, pixel === '1' ? A : B);
            }
        }
    }
}

function origamiFold({line, A, B}, t) {
    for (let i = 0; i < 8; i++) {
        const x = 3 + i * 7;
        const d = 1 + int(6 * Math.abs(sin(t * 0.18 + i * 0.5)));
        line(x - 4, 8, x, 8 - d, A);
        line(x, 8 - d, x + 4, 8, A);
        line(x - 4, 8, x, 8 + d, B);
        line(x, 8 + d, x + 4, 8, B);
    }
}

function sleepingCat({r, line, p}, t) {
    const phase = t;
    const breath = phase % 36 >= 10 && phase % 36 <= 25 ? 1 : 0;
    const tail = phase >= 68 && phase <= 82 ? [0, 0, 1, 2, 3, 3, 2, 1, 0, 0, 1, 1, 0, 0, 0][phase - 68] : 0;
    const ear = phase >= 49 && phase <= 53 ? 1 : 0;
    const ink = '#573243', fur = '#eead7a', light = '#ffd398', stripe = '#a85852', cream = '#fff0c7';
    line(6, 15, 51, 15, '#976c96');
    const body = [7, 12, 17, 21, 24, 25, 26, 25, 23, 20, 17];
    body.forEach((w, i) => {
        const y = 4 + i - (i < 4 ? breath : 0);
        const x = 36 - Math.floor(w / 2);
        r(x, y, w, 1, ink);
        if (i > 0 && i < body.length - 1)
            r(x + 1, y, w - 2, 1, i <= 3 ? light : fur);
    });
    if (breath) {
        r(24, 7, 24, 1, ink);
        r(25, 7, 22, 1, fur);
    }
    line(33, 5 - breath, 35, 8, stripe);
    line(38, 5 - breath, 40, 8, stripe);
    line(43, 7, 44, 9, stripe);
    const head = [
      '...11........11..', '...121......121..', '..1222111111221..',
      '..12222222222221.', '.1222222222222221', '12222222222222221',
      '12222222222222221', '.122222222222221.', '..1111111111111..',
    ];
    for (const [dy, row] of head.entries()) {
        for (const [dx, pixel] of [...row].entries()) {
            if (pixel === '.')
                continue;
            const offset = ear && dy === 0 && dx > 9 ? 1 : 0;
            p(8 + dx, 5 + dy - offset, pixel === '1' ? ink : fur);
        }
    }
    p(12, 7, '#ed8791');
    p(21, 7 - ear, '#ed8791');
    line(12, 10, 14, 11, ink);
    line(14, 11, 16, 10, ink);
    line(19, 10, 20, 11, ink);
    line(20, 11, 22, 10, ink);
    r(13, 12, 8, 1, cream);
    r(16, 11, 3, 1, cream);
    p(17, 11, '#b85d6b');
    p(17, 12, ink);
    r(9, 14, 17, 1, ink);
    r(11, 13, 12, 1, light);
    p(13, 13, stripe);
    p(16, 13, stripe);
    line(46, 9, 49, 11, ink);
    line(49, 11, 47, 13, ink);
    line(47, 13, 42, 14, ink);
    line(42, 14, 35, 14, ink);
    line(35, 14, 29, 13 - tail, ink);
    line(46, 10, 48, 11, fur);
    line(48, 11, 46, 12, fur);
    line(46, 12, 41, 13, fur);
    line(41, 13, 35, 13, fur);
    line(35, 13, 29, 12 - tail, light);
    p(29, 12 - tail, cream);
}

export const SELECTED_PIXEL_STYLES = {
    'segment-meter': 'Segmentpegel',
    'square-wave': 'Kubikwelle',
    'satellite-orbit': 'Satellitenbahn',
    'rocket-launch': 'Startsequenz',
    'asteroid-pass': 'Asteroidenpassage',
    'reef-crab': 'Riffkrabbe',
    'cat-eyes': 'Katzenaugen',
    'frog-jump': 'Froschsprung',
    'origami-fold': 'Origami-Falte',
    'sleeping-cat': 'Schlafkatze',
};

const draw = {
    'segment-meter': segmentMeter,
    'square-wave': squareWave,
    'satellite-orbit': satelliteOrbit,
    'rocket-launch': rocketLaunch,
    'asteroid-pass': asteroidPass,
    'reef-crab': reefCrab,
    'cat-eyes': catEyes,
    'frog-jump': frogJump,
    'origami-fold': origamiFold,
    'sleeping-cat': sleepingCat,
};

const lengths = {
    'segment-meter': 34,
    'square-wave': 54,
    'satellite-orbit': 34,
    'rocket-launch': 39,
    'asteroid-pass': 54,
    'reef-crab': 34,
    'cat-eyes': 84,
    'frog-jump': 64,
    'origami-fold': 39,
    'sleeping-cat': 120,
};

export function paintSelectedPixel(cr, model) {
    const length = lengths[model.style];
    const time = Math.floor(model.pixelFrame ?? 0);
    const continuous = ['cat-eyes', 'frog-jump', 'sleeping-cat'].includes(model.style);
    const phase = time % (continuous ? length : length * 2);
    const frame = phase <= length ? phase : length * 2 - phase;
    draw[model.style](brushes(cr, model.color, model.secondary), frame);
}
