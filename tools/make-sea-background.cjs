#!/usr/bin/env node

/**
 * Собирает «средний фон» для режима с бликами из src/assets/sources/sea.png:
 * сильно размытую воду и плитку лёгкого шума.
 *
 * Размытие сделано уменьшением с усреднением до 32×10 и обратной билинейной
 * растяжкой — так не возникает краевых артефактов, как у гауссова ядра, и
 * остаётся ровно то, что нужно: вертикальный градиент воды и пятно луны.
 * Шум лежит отдельной мелкой плиткой: если запечь его в фон, PNG перестаёт
 * сжиматься и вырастает в полсотни раз.
 *
 * Usage:
 *   node tools/make-sea-background.cjs
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'src/assets/sources/sea.png');
const OUT_DIR = path.join(ROOT, 'src/assets/scene');

const SMALL_WIDTH = 32;
const SMALL_HEIGHT = 10;
const NOISE_SIZE = 64;
const NOISE_STRENGTH = 10;

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});

function crc32(buffer) {
    let c = 0xffffffff;
    for (const byte of buffer) {
        c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
    }
    return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
}

function decodePng(file) {
    const buf = fs.readFileSync(file);
    let pos = 8;
    let width = 0;
    let height = 0;
    let bitDepth = 8;
    let colorType = 2;
    const idat = [];
    while (pos < buf.length) {
        const length = buf.readUInt32BE(pos);
        const type = buf.toString('ascii', pos + 4, pos + 8);
        const data = buf.subarray(pos + 8, pos + 8 + length);
        if (type === 'IHDR') {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            bitDepth = data[8];
            colorType = data[9];
            if (bitDepth !== 8 || (colorType !== 2 && colorType !== 6) || data[12] !== 0) {
                throw new Error(`Поддерживается только 8-битный RGB/RGBA без интерлейса: ${file}`);
            }
        } else if (type === 'IDAT') {
            idat.push(Buffer.from(data));
        } else if (type === 'IEND') {
            break;
        }
        pos += 12 + length;
    }

    const channels = colorType === 6 ? 4 : 3;
    const stride = width * channels;
    const raw = zlib.inflateSync(Buffer.concat(idat));
    const pixels = Buffer.alloc(width * height * channels);
    let read = 0;
    for (let y = 0; y < height; y++) {
        const filter = raw[read++];
        const line = raw.subarray(read, read + stride);
        read += stride;
        const current = pixels.subarray(y * stride, (y + 1) * stride);
        const prior = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : Buffer.alloc(stride);
        for (let x = 0; x < stride; x++) {
            const a = x >= channels ? current[x - channels] : 0;
            const b = prior[x];
            const c = x >= channels ? prior[x - channels] : 0;
            let value = line[x];
            if (filter === 1) {
                value += a;
            } else if (filter === 2) {
                value += b;
            } else if (filter === 3) {
                value += (a + b) >> 1;
            } else if (filter === 4) {
                const p = a + b - c;
                const pa = Math.abs(p - a);
                const pb = Math.abs(p - b);
                const pc = Math.abs(p - c);
                value += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
            }
            current[x] = value & 0xff;
        }
    }
    return { width, height, channels, pixels };
}

function encodePng({ width, height, channels, pixels }) {
    const stride = width * channels;
    // Фильтр 1 (Sub) хорошо жмёт горизонтальные градиенты, из которых фон и состоит.
    const raw = Buffer.alloc((stride + 1) * height);
    for (let y = 0; y < height; y++) {
        const out = raw.subarray(y * (stride + 1), (y + 1) * (stride + 1));
        out[0] = 1;
        for (let x = 0; x < stride; x++) {
            const left = x >= channels ? pixels[y * stride + x - channels] : 0;
            out[x + 1] = (pixels[y * stride + x] - left) & 0xff;
        }
    }
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8;
    ihdr[9] = channels === 4 ? 6 : 2;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', ihdr),
        chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
        chunk('IEND', Buffer.alloc(0)),
    ]);
}

/** Уменьшение усреднением: каждый пиксель приёмника — среднее по своему блоку. */
function downscale(image, width, height) {
    const { width: sw, height: sh, channels, pixels } = image;
    const out = Buffer.alloc(width * height * channels);
    for (let y = 0; y < height; y++) {
        const y0 = Math.floor((y * sh) / height);
        const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * sh) / height));
        for (let x = 0; x < width; x++) {
            const x0 = Math.floor((x * sw) / width);
            const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * sw) / width));
            const sums = new Array(channels).fill(0);
            let count = 0;
            for (let sy = y0; sy < y1; sy++) {
                for (let sx = x0; sx < x1; sx++) {
                    const offset = (sy * sw + sx) * channels;
                    for (let c = 0; c < channels; c++) {
                        sums[c] += pixels[offset + c];
                    }
                    count++;
                }
            }
            const offset = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) {
                out[offset + c] = Math.round(sums[c] / count);
            }
        }
    }
    return { width, height, channels, pixels: out };
}

/** Билинейная растяжка обратно до полного размера. */
function upscale(image, width, height) {
    const { width: sw, height: sh, channels, pixels } = image;
    const out = Buffer.alloc(width * height * channels);
    const sample = (x, y, c) => pixels[(Math.min(y, sh - 1) * sw + Math.min(x, sw - 1)) * channels + c];
    for (let y = 0; y < height; y++) {
        const fy = Math.max(0, ((y + 0.5) * sh) / height - 0.5);
        const y0 = Math.floor(fy);
        const wy = fy - y0;
        for (let x = 0; x < width; x++) {
            const fx = Math.max(0, ((x + 0.5) * sw) / width - 0.5);
            const x0 = Math.floor(fx);
            const wx = fx - x0;
            const offset = (y * width + x) * channels;
            for (let c = 0; c < channels; c++) {
                const top = sample(x0, y0, c) * (1 - wx) + sample(x0 + 1, y0, c) * wx;
                const bottom = sample(x0, y0 + 1, c) * (1 - wx) + sample(x0 + 1, y0 + 1, c) * wx;
                out[offset + c] = Math.round(top * (1 - wy) + bottom * wy);
            }
        }
    }
    return { width, height, channels, pixels: out };
}

/** Белые точки со слабой альфой: ломают полосы на тёмном градиенте. */
function makeNoise(size, strength) {
    const pixels = Buffer.alloc(size * size * 4);
    let seed = 20260809;
    const random = () => {
        seed = (seed * 1664525 + 1013904223) >>> 0;
        return seed / 4294967296;
    };
    for (let i = 0; i < pixels.length; i += 4) {
        // Приближение нормального распределения суммой трёх равномерных.
        const gauss = (random() + random() + random() - 1.5) / 1.5;
        pixels[i] = 255;
        pixels[i + 1] = 255;
        pixels[i + 2] = 255;
        pixels[i + 3] = Math.max(0, Math.min(255, Math.round(gauss * strength)));
    }
    return { width: size, height: size, channels: 4, pixels };
}

const source = decodePng(SOURCE);
const blurred = upscale(downscale(source, SMALL_WIDTH, SMALL_HEIGHT), source.width, source.height);

fs.mkdirSync(OUT_DIR, { recursive: true });
const targets = [
    ['sea-blur.png', encodePng(blurred)],
    ['sea-noise.png', encodePng(makeNoise(NOISE_SIZE, NOISE_STRENGTH))],
];
for (const [name, data] of targets) {
    fs.writeFileSync(path.join(OUT_DIR, name), data);
    console.log(`${name}: ${(data.length / 1024).toFixed(1)} КБ`);
}
