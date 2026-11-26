import {paintSprite, PIXEL_STYLES} from './sprites.js';
import {paintSelectedPixel, SELECTED_PIXEL_STYLES} from './selected-pixels.js';

export const STYLES = {
    scope: 'Oszilloskop',
    ...PIXEL_STYLES,
    'pixel-rain': 'Pixelregen',
    moire: 'Moiré-Gewebe',
    eclipse: 'Mini-Finsternis',
    ...SELECTED_PIXEL_STYLES,
};

const TURN = 2 * Math.PI;

function line(cr, points, width, color, alpha = 1) {
    cr.setSourceRGBA(...color, alpha);
    cr.setLineWidth(width);
    for (const [index, [x, y]] of points.entries()) {
        if (index === 0)
            cr.moveTo(x, y);
        else
            cr.lineTo(x, y);
    }
    cr.stroke();
}

function scope(cr, {phase, playing, color, secondary}) {
    for (const trail of [1, 0]) {
        const wave = Array.from({length: 51}, (_, index) => {
            const x = index - 25;
            const travel = phase * 3 + trail * 0.62;
            const y = playing ? 4.85 * Math.sin(x * 0.25 - travel) +
                1.35 * Math.sin(x * 0.49 + phase * 2) : 0;
            return [x, y];
        });
        line(cr, wave, trail === 0 ? 1.5 : 1, trail === 0 ? color : secondary, trail === 0 ? 1 : 0.5);
    }
}

function pixelRain(cr, {phase, color, secondary}) {
    const frame = Math.floor(phase / TURN * 72);
    for (let column = 0; column < 17; column++) {
        const x = 3 + 3 * column;
        const speed = 1 + column % 3;
        const head = (Math.floor(frame * speed / 6) + column * 7) % 12 - 3;
        for (let tail = 3; tail >= 0; tail--) {
            const row = head - tail;
            if (row < 0 || row > 6)
                continue;
            cr.setSourceRGBA(...(tail === 0 ? color : secondary), [1, 0.62, 0.35, 0.18][tail]);
            cr.rectangle(x, 1 + 2 * row, 2, 2);
            cr.fill();
        }
    }
}

function moire(cr, {phase, color, secondary}) {
    for (let strand = 0; strand < 13; strand++) {
        const x = -24 + strand * 4;
        const fold = 7.7 * Math.sin(phase + strand * 0.48);
        cr.setSourceRGBA(...secondary, 0.55);
        cr.setLineWidth(0.8);
        cr.moveTo(x, -6.3);
        cr.curveTo(x + fold, -1.5, x + fold, 1.5, x, 6.3);
        cr.stroke();

        cr.setSourceRGBA(...color, 0.75);
        cr.moveTo(x, -6.3);
        cr.curveTo(x - fold, -1.5, x - fold, 1.5, x, 6.3);
        cr.stroke();
    }
}

function eclipse(cr, {phase, color, secondary}) {
    const shadowX = 19 * Math.cos(phase);
    const stars = [[-24, -4], [-19, 5], [-12, -5], [12, 5], [18, -4], [23, 2]];
    for (const [index, [x, y]] of stars.entries()) {
        const intensity = 0.45 + 0.2 * Math.cos(phase * 2 + index);
        cr.setSourceRGBA(...secondary, intensity);
        cr.rectangle(x, y, 1.3, 1.3);
        cr.fill();
    }

    // Exclude the moving disk from the sun to leave a transparent crescent.
    cr.save();
    cr.rectangle(-8, -8, 16, 16);
    cr.newSubPath();
    cr.arcNegative(shadowX, -1.5, 5.4, TURN, 0);
    cr.clip();
    for (const [radius, alpha] of [[7.2, 0.25], [6.0, 0.48], [5.1, 1]]) {
        cr.setSourceRGBA(...color, alpha);
        cr.arc(0, 0, radius, 0, TURN);
        cr.fill();
    }
    cr.restore();
    cr.setSourceRGBA(...secondary, 0.36);
    cr.setLineWidth(0.55);
    cr.arc(shadowX, -1.5, 5.4, -1.55, 0.16);
    cr.stroke();
}

export function paintAnimation(cr, width, height, model) {
    const style = Object.hasOwn(STYLES, model.style) ? model.style : 'scope';
    const selectedPixel = Object.hasOwn(SELECTED_PIXEL_STYLES, style);
    if (style === 'pixel-rain' || selectedPixel || Object.hasOwn(PIXEL_STYLES, style)) {
        const scale = Math.min(width / 56, height / 16);
        const pixel = scale >= 1 ? Math.floor(scale) : scale;
        cr.translate(Math.floor((width - 56 * pixel) / 2), Math.floor((height - 16 * pixel) / 2));
        cr.scale(pixel, pixel);
        if (style === 'pixel-rain')
            pixelRain(cr, model);
        else if (selectedPixel)
            paintSelectedPixel(cr, model);
        else
            paintSprite(cr, model);
        return;
    }

    cr.translate(width / 2, height / 2);
    if (style === 'eclipse') {
        const scale = Math.min(width / 56, height / 16);
        cr.scale(scale, scale);
        eclipse(cr, model);
    } else if (style === 'moire') {
        cr.scale(width / 56, height / 16);
        moire(cr, model);
    } else {
        cr.scale(width / 56, height / 16);
        scope(cr, model);
    }
}
