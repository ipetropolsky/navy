import { clamp, fastSin, mix, smoothstep, TAU } from '@/components/Sea/math';
import {
    BUFFER_MAX_HEIGHT,
    BUFFER_MAX_WIDTH,
    BUFFER_SCALE,
    CREST_CONTRAST_FAR,
    CREST_CONTRAST_NEAR,
    CREST_SHEEN,
    CREST_TINT,
    CROSS_SWELL,
    EDGE_SHADOW,
    MOON_BREAKUP,
    MOON_DASH_FROM,
    MOON_DASH_TO,
    MOON_FADE_AMOUNT,
    MOON_FADE_FROM,
    MOON_GLINT_SHARPNESS,
    MOON_GLINT_STRENGTH,
    MOON_GLINT_TINT,
    MOON_HALO_FALLOFF,
    MOON_HALO_STRENGTH,
    MOON_HALO_TINT,
    MOON_HALO_WIDTH_FAR,
    MOON_HALO_WIDTH_NEAR,
    MOON_PATH_WIDTH_FAR,
    MOON_PATH_WIDTH_NEAR,
    MOON_PATH_X,
    MOON_STREAK,
    PERSPECTIVE_CROSS,
    PERSPECTIVE_NEAR,
    WATER_GRADIENT,
    WAVE_DETAIL_CUTOFF,
    WAVE_MIN_CONTRIBUTION,
    WAVE_SAMPLE_MAX,
    WAVE_SAMPLE_STEP,
    WAVE_SPEED,
    WAVES,
} from '@/components/Sea/seaConfig';

export interface SeaRenderer {
    /** Подогнать буферы под новый размер. Размеры — в CSS-пикселях. */
    resize(width: number, height: number, pixelRatio: number): void;
    /** Нарисовать кадр для момента времени time (в секундах). */
    draw(time: number): void;
}

const TOTAL_AMPLITUDE = WAVES.reduce((sum, wave) => sum + wave.amplitude, 0);

/** Глубина (расстояние до наблюдателя) для доли высоты моря t. */
function depthAt(t: number): number {
    return 1 / (t + PERSPECTIVE_NEAR);
}

function gradientAt(t: number, channel: number): number {
    const last = WATER_GRADIENT.length - 1;
    if (t <= WATER_GRADIENT[0].at) {
        return WATER_GRADIENT[0].color[channel];
    }
    for (let i = 1; i <= last; i++) {
        const to = WATER_GRADIENT[i];
        if (t <= to.at) {
            const from = WATER_GRADIENT[i - 1];
            const amount = (t - from.at) / (to.at - from.at);
            return mix(from.color[channel], to.color[channel], amount);
        }
    }
    return WATER_GRADIENT[last].color[channel];
}

/**
 * Гашение волны, которая на этой строке стала мельче пикселя буфера.
 * Без него у горизонта, где перспектива сжимает волны почти в точку,
 * появлялся бы мелкий мусор и мерцание; с ним детали плавно тают в дымке.
 */
function antialias(phaseByRow: number, phaseByColumn: number): number {
    const gradient =
        (phaseByRow * phaseByRow + phaseByColumn * phaseByColumn) / (WAVE_DETAIL_CUTOFF * WAVE_DETAIL_CUTOFF);
    const falloff = 1 + gradient;
    return 1 / (falloff * falloff);
}

export function createSeaRenderer(canvas: HTMLCanvasElement): SeaRenderer {
    const context = canvas.getContext('2d', { alpha: false });
    const buffer = document.createElement('canvas');
    const bufferContext = buffer.getContext('2d', { alpha: false });

    let bufferWidth = 0;
    let bufferHeight = 0;
    let image: ImageData | null = null;
    let pixels: Uint8ClampedArray = new Uint8ClampedArray(0);

    // Таблицы, зависящие только от размера кадра.
    let rowDepth = new Float32Array(0);
    let rowRed = new Float32Array(0);
    let rowGreen = new Float32Array(0);
    let rowBlue = new Float32Array(0);
    let rowContrast = new Float32Array(0);
    let rowCrossScale = new Float32Array(0);
    let rowAttenuation = new Float32Array(0);
    let rowWaveCount = new Uint8Array(0);
    let rowSampleStride = new Uint16Array(0);
    let elevationSamples = new Float32Array(0);
    let rowPathHalfWidth = new Float32Array(0);
    let rowHaloHalfWidth = new Float32Array(0);
    let rowHaloAmount = new Float32Array(0);
    let rowPathFade = new Float32Array(0);
    let rowDashiness = new Float32Array(0);
    let columnShadow = new Float32Array(0);

    // Буферы под значения текущей строки.
    const waveAmplitude = new Float32Array(WAVES.length);
    const wavePhase = new Float32Array(WAVES.length);
    const waveBend = new Float32Array(WAVES.length);
    const swellPhase = new Float32Array(CROSS_SWELL.length);
    const swellStep = new Float32Array(CROSS_SWELL.length);
    const breakupPhase = new Float32Array(MOON_BREAKUP.length);
    const breakupStep = new Float32Array(MOON_BREAKUP.length);

    let moonCenter = 0;
    let center = 0;

    function resize(width: number, height: number, pixelRatio: number): void {
        if (!context || !bufferContext || width <= 0 || height <= 0) {
            return;
        }

        canvas.width = Math.max(1, Math.round(width * pixelRatio));
        canvas.height = Math.max(1, Math.round(height * pixelRatio));
        // Изменение размера сбрасывает состояние контекста, поэтому настраиваем его заново.
        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = 'high';

        const scale = Math.min(BUFFER_SCALE, BUFFER_MAX_WIDTH / width, BUFFER_MAX_HEIGHT / height);
        bufferWidth = Math.max(2, Math.round(width * scale));
        bufferHeight = Math.max(2, Math.round(height * scale));
        buffer.width = bufferWidth;
        buffer.height = bufferHeight;

        image = bufferContext.createImageData(bufferWidth, bufferHeight);
        pixels = image.data;
        for (let i = 3; i < pixels.length; i += 4) {
            pixels[i] = 255;
        }

        moonCenter = MOON_PATH_X * bufferWidth;
        center = bufferWidth / 2;

        rowDepth = new Float32Array(bufferHeight);
        rowRed = new Float32Array(bufferHeight);
        rowGreen = new Float32Array(bufferHeight);
        rowBlue = new Float32Array(bufferHeight);
        rowContrast = new Float32Array(bufferHeight);
        rowCrossScale = new Float32Array(bufferHeight);
        rowAttenuation = new Float32Array(bufferHeight * WAVES.length);
        rowWaveCount = new Uint8Array(bufferHeight);
        rowSampleStride = new Uint16Array(bufferHeight);
        elevationSamples = new Float32Array(bufferWidth + 2);
        rowPathHalfWidth = new Float32Array(bufferHeight);
        rowHaloHalfWidth = new Float32Array(bufferHeight);
        rowHaloAmount = new Float32Array(bufferHeight);
        rowPathFade = new Float32Array(bufferHeight);
        rowDashiness = new Float32Array(bufferHeight);

        for (let y = 0; y < bufferHeight; y++) {
            const t = (y + 0.5) / bufferHeight;
            const depth = depthAt(t);
            rowDepth[y] = depth;
            rowRed[y] = gradientAt(t, 0);
            rowGreen[y] = gradientAt(t, 1);
            rowBlue[y] = gradientAt(t, 2);
            rowContrast[y] = mix(CREST_CONTRAST_FAR, CREST_CONTRAST_NEAR, t);

            // Сколько мировых единиц приходится на пиксель буфера по горизонтали.
            const crossScale = Math.pow(depth, PERSPECTIVE_CROSS) / bufferWidth;
            rowCrossScale[y] = crossScale;

            // Производная глубины по строке — на неё опирается сглаживание.
            const depthByRow = (depth * depth) / bufferHeight;
            // Насколько круто изгиб меняет фазу по горизонтали — на строку целиком.
            let bendGradient = 0;
            for (const swell of CROSS_SWELL) {
                bendGradient += swell.amplitude * swell.crossFrequency * crossScale;
            }

            let waveCount = 0;
            let maxBend = 0;
            for (let i = 0; i < WAVES.length; i++) {
                const wave = WAVES[i];
                const attenuation = antialias(wave.depthFrequency * depthByRow, wave.bend * bendGradient);
                rowAttenuation[y * WAVES.length + i] = attenuation;
                if (attenuation * wave.amplitude > WAVE_MIN_CONTRIBUTION) {
                    waveCount = i + 1;
                    maxBend = Math.max(maxBend, wave.bend);
                }
            }
            // Ближе к горизонту почти все волны погашены — там их можно не считать.
            rowWaveCount[y] = waveCount;

            // Самая быстрая горизонтальная фаза на строке задаёт шаг выборки.
            const phaseByColumn = maxBend * bendGradient;
            rowSampleStride[y] =
                phaseByColumn > 0
                    ? clamp(Math.floor(WAVE_SAMPLE_STEP / phaseByColumn), 1, WAVE_SAMPLE_MAX)
                    : WAVE_SAMPLE_MAX;

            rowPathHalfWidth[y] = bufferWidth * (MOON_PATH_WIDTH_FAR + MOON_PATH_WIDTH_NEAR * Math.pow(t, 1.25));
            rowHaloHalfWidth[y] = bufferWidth * mix(MOON_HALO_WIDTH_FAR, MOON_HALO_WIDTH_NEAR, t);
            rowHaloAmount[y] = MOON_HALO_STRENGTH * Math.exp(-t * MOON_HALO_FALLOFF);
            rowPathFade[y] = smoothstep(0, 0.025, t) * (1 - MOON_FADE_AMOUNT * smoothstep(MOON_FADE_FROM, 1, t));
            rowDashiness[y] = smoothstep(MOON_DASH_FROM, MOON_DASH_TO, t);
        }

        columnShadow = new Float32Array(bufferWidth);
        for (let x = 0; x < bufferWidth; x++) {
            const fromCenter = Math.abs(((x + 0.5) / bufferWidth) * 2 - 1);
            columnShadow[x] = 1 - EDGE_SHADOW * smoothstep(0.45, 1, fromCenter);
        }
    }

    function draw(time: number): void {
        if (!context || !bufferContext || !image) {
            return;
        }

        const [crestRed, crestGreen, crestBlue] = CREST_TINT;
        const [haloRed, haloGreen, haloBlue] = MOON_HALO_TINT;
        const [glintRed, glintGreen, glintBlue] = MOON_GLINT_TINT;

        for (let y = 0; y < bufferHeight; y++) {
            const depth = rowDepth[y];
            const crossScale = rowCrossScale[y];
            const attenuationOffset = y * WAVES.length;

            const waveCount = rowWaveCount[y];
            for (let i = 0; i < waveCount; i++) {
                const wave = WAVES[i];
                // Гребень бежит к наблюдателю: со временем та же фаза оказывается
                // на меньшей глубине, то есть ниже по кадру. Фазу сворачиваем в
                // один оборот — анимация бесконечная, и расти ей незачем.
                waveAmplitude[i] = wave.amplitude * rowAttenuation[attenuationOffset + i];
                waveBend[i] = wave.bend;
                wavePhase[i] = (wave.depthFrequency * (depth + WAVE_SPEED * wave.speed * time) + wave.phase) % TAU;
            }

            for (let j = 0; j < CROSS_SWELL.length; j++) {
                const swell = CROSS_SWELL[j];
                const step = swell.crossFrequency * crossScale;
                swellStep[j] = step;
                swellPhase[j] = (swell.depthFrequency * depth + swell.speed * time + swell.phase - step * center) % TAU;
            }

            const contrast = rowContrast[y];
            const pathHalfWidth = rowPathHalfWidth[y];
            const haloHalfWidth = rowHaloHalfWidth[y];
            const haloAmount = rowHaloAmount[y];
            const pathFade = rowPathFade[y];
            const dashiness = rowDashiness[y];
            for (let j = 0; j < MOON_BREAKUP.length; j++) {
                const component = MOON_BREAKUP[j];
                const step = component.crossFrequency * crossScale;
                breakupStep[j] = step;
                breakupPhase[j] =
                    (component.depthFrequency * depth + component.speed * time + component.phase - step * moonCenter) %
                    TAU;
            }

            const baseRed = rowRed[y];
            const baseGreen = rowGreen[y];
            const baseBlue = rowBlue[y];

            // Рельеф строки: считаем его с шагом и потом интерполируем.
            const stride = rowSampleStride[y];
            const sampleCount = Math.ceil(bufferWidth / stride) + 1;
            for (let s = 0; s < sampleCount; s++) {
                const sampleX = s * stride;
                // Поперечная зыбь одна на все валы: она ведёт их гребни
                // из стороны в сторону, вместо того чтобы наклонять картинку.
                let bend = 0;
                for (let j = 0; j < CROSS_SWELL.length; j++) {
                    bend += CROSS_SWELL[j].amplitude * fastSin(swellPhase[j] + swellStep[j] * sampleX);
                }

                let elevation = 0;
                for (let i = 0; i < waveCount; i++) {
                    elevation += waveAmplitude[i] * fastSin(wavePhase[i] + waveBend[i] * bend);
                }
                elevationSamples[s] = elevation / TOTAL_AMPLITUDE;
            }

            let offset = y * bufferWidth * 4;
            let sampleIndex = 0;
            let sampleFrom = elevationSamples[0];
            let sampleStep = (elevationSamples[1] - sampleFrom) / stride;
            let sampleOffset = 0;

            for (let x = 0; x < bufferWidth; x++) {
                if (sampleOffset === stride) {
                    sampleIndex += 1;
                    sampleFrom = elevationSamples[sampleIndex];
                    sampleStep = (elevationSamples[sampleIndex + 1] - sampleFrom) / stride;
                    sampleOffset = 0;
                }
                const elevation = sampleFrom + sampleStep * sampleOffset;
                sampleOffset += 1;

                // Свет ложится на воду множителем: у тёмной воды вблизи волны
                // не проваливаются в чёрный, у светлой у горизонта не выбеливаются.
                const shadow = columnShadow[x];
                const light = (1 + elevation * contrast) * shadow;
                // На гребне добавляется отблеск неба: широкий по всей вершине
                // и узкий у самого её верха — от него на воде тонкие светлые нити.
                const crest = elevation > 0 ? elevation : 0;
                const sheen = mix(crest, crest * crest * crest, CREST_SHEEN);
                let red = baseRed * light + sheen * crestRed;
                let green = baseGreen * light + sheen * crestGreen;
                let blue = baseBlue * light + sheen * crestBlue;

                const fromMoon = x - moonCenter;
                const distance = fromMoon < 0 ? -fromMoon : fromMoon;

                if (distance < haloHalfWidth) {
                    const falloff = 1 - (fromMoon / haloHalfWidth) ** 2;
                    const halo = falloff * falloff * haloAmount;
                    red += halo * haloRed;
                    green += halo * haloGreen;
                    blue += halo * haloBlue;
                }

                if (distance < pathHalfWidth && pathFade > 0) {
                    const falloff = 1 - (fromMoon / pathHalfWidth) ** 2;
                    let breakup = 0;
                    for (let j = 0; j < MOON_BREAKUP.length; j++) {
                        breakup += MOON_BREAKUP[j].amplitude * fastSin(breakupPhase[j] + breakupStep[j] * x);
                    }
                    breakup = 0.55 + 0.45 * breakup;
                    const sparkle = MOON_GLINT_STRENGTH * breakup * Math.pow(crest, MOON_GLINT_SHARPNESS);
                    const glint = falloff * falloff * mix(MOON_STREAK, sparkle, dashiness) * pathFade;
                    red += glint * glintRed;
                    green += glint * glintGreen;
                    blue += glint * glintBlue;
                }

                pixels[offset] = red;
                pixels[offset + 1] = green;
                pixels[offset + 2] = blue;
                offset += 4;
            }
        }

        bufferContext.putImageData(image, 0, 0);
        context.drawImage(buffer, 0, 0, bufferWidth, bufferHeight, 0, 0, canvas.width, canvas.height);
    }

    return { resize, draw };
}
