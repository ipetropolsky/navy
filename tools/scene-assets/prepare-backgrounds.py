"""Готовит рабочие копии фонов сцены из оригиналов в src/assets/sources/.

Оригиналы не изменяются: сюда кладутся только уменьшенные версии для сборки.
Дополнительно вырезает месяц из картинки неба отдельным слоем — так его можно
двигать независимо и не терять при обрезке неба по высоте.

Запуск: python3 tools/scene-assets/prepare-backgrounds.py
Зависимости: Pillow, numpy, scipy (ставятся ad hoc, в проект не входят).
"""

import pathlib

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'src/assets/sources'
OUT = ROOT / 'src/assets/scene'

# Исходник -> (имя ассета, ширина рабочей копии).
BACKGROUNDS = {
    'sky_clean_3296x1028.png': ('sky', 1800),
    'sea_clean_3296x788.png': ('sea', 1800),
}

MOON_SOURCE = 'sky_clean_3296x1028.png'
# Половина стороны квадрата, который вырезаем вокруг месяца, и ширина готового ассета.
MOON_REACH = 230
MOON_WIDTH = 320
# Насколько сильно свечение должно отличаться от неба, чтобы попасть в альфу.
MOON_CONTRAST = 55


def prepare_moon() -> None:
    img = Image.open(SOURCES / MOON_SOURCE).convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    grey = arr.mean(axis=2)

    # Месяц — самое яркое пятно на небе.
    labels, count = ndimage.label(ndimage.binary_dilation(grey > grey.max() * 0.93, np.ones((5, 5))))
    sizes = ndimage.sum(grey > grey.max() * 0.93, labels, range(1, count + 1))
    ys, xs = np.where(labels == int(np.argmax(sizes)) + 1)
    center = (int(xs.mean()), int(ys.mean()))

    box = (
        max(center[0] - MOON_REACH, 0),
        max(center[1] - MOON_REACH, 0),
        min(center[0] + MOON_REACH, img.width),
        min(center[1] + MOON_REACH, img.height),
    )
    crop = arr[box[1] : box[3], box[0] : box[2]]

    # Небо вокруг месяца — плавный градиент: оцениваем его сильным размытием без яркой части.
    bright = crop.mean(axis=2) > np.percentile(crop.mean(axis=2), 80)
    background = crop.copy()
    for _ in range(120):
        blurred = np.dstack([ndimage.gaussian_filter(background[..., c], 6) for c in range(3)])
        background[bright] = blurred[bright]

    alpha = np.clip(np.abs(crop - background).max(axis=2) / MOON_CONTRAST, 0, 1)

    # Гасим всё за пределами круга вокруг месяца, чтобы не тащить соседние звёзды и дымку.
    rows, cols = np.ogrid[: crop.shape[0], : crop.shape[1]]
    distance = np.hypot(rows - crop.shape[0] / 2, cols - crop.shape[1] / 2)
    alpha *= np.clip((MOON_REACH * 0.8 - distance) / (MOON_REACH * 0.3), 0, 1)
    moon = Image.fromarray(crop.astype(np.uint8), 'RGB').convert('RGBA')
    moon.putalpha(Image.fromarray((alpha * 255).astype(np.uint8)))

    height = round(moon.height * MOON_WIDTH / moon.width)
    moon.resize((MOON_WIDTH, height), Image.LANCZOS).save(OUT / 'moon.png', optimize=True)
    print('moon', (MOON_WIDTH, height))


def main() -> None:
    for source, (name, width) in BACKGROUNDS.items():
        img = Image.open(SOURCES / source).convert('RGB')
        height = round(img.height * width / img.width)
        img.resize((width, height), Image.LANCZOS).save(OUT / f'{name}.png', optimize=True)
        print(name, (width, height))
    prepare_moon()


if __name__ == '__main__':
    main()
