"""Готовит рабочие копии слоёв сцены из оригиналов в src/assets/sources/.

Оригиналы не изменяются: сюда кладутся только уменьшенные версии для сборки.
Кроме уменьшения:
- месяц вырезается из старой картинки неба отдельным слоем (в новом небе месяца нет);
- остров вырезается из своей картинки (силуэт по контуру, серый фон уходит в прозрачность).

Запуск: python3 tools/scene-assets/prepare-backgrounds.py
Зависимости: Pillow, numpy, scipy (ставятся ad hoc, в проект не входят).
"""

import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'src/assets/sources'
OUT = ROOT / 'src/assets/scene'

# Исходник -> (имя ассета, ширина рабочей копии).
BACKGROUNDS = {
    'sky.png': ('sky', 1800),
    'sea.png': ('sea', 1800),
}

ISLAND_SOURCE = 'island.png'
ISLAND_WIDTH = 900
ISLAND_EDGE = 14

# В новом небе месяца нет, берём его из первой присланной картинки неба.
MOON_SOURCE = 'sky_clean_3296x1028.png'
MOON_REACH = 230
MOON_WIDTH = 320
MOON_CONTRAST = 55


def prepare_island() -> None:
    img = Image.open(SOURCES / ISLAND_SOURCE).convert('RGB')
    grey = np.asarray(img).astype(np.float32).mean(axis=2)

    edges = np.hypot(ndimage.sobel(grey, axis=0), ndimage.sobel(grey, axis=1)) > ISLAND_EDGE
    closed = ndimage.binary_dilation(edges, np.ones((3, 3)), iterations=3)
    body = largest_blob(ndimage.binary_fill_holes(closed))
    body = largest_blob(ndimage.binary_erosion(body, np.ones((3, 3)), iterations=3))

    island = img.convert('RGBA')
    island.putalpha(Image.fromarray((body * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6)))
    island = island.crop(island.getbbox())

    height = round(island.height * ISLAND_WIDTH / island.width)
    island.resize((ISLAND_WIDTH, height), Image.LANCZOS).save(OUT / 'island.png', optimize=True)
    print('island', (ISLAND_WIDTH, height))


def prepare_moon() -> None:
    img = Image.open(SOURCES / MOON_SOURCE).convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    grey = arr.mean(axis=2)

    # Месяц — самое яркое пятно на небе.
    bright = grey > grey.max() * 0.93
    labels, count = ndimage.label(ndimage.binary_dilation(bright, np.ones((5, 5))))
    sizes = ndimage.sum(bright, labels, range(1, count + 1))
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
    lit = crop.mean(axis=2) > np.percentile(crop.mean(axis=2), 80)
    background = crop.copy()
    for _ in range(120):
        blurred = np.dstack([ndimage.gaussian_filter(background[..., c], 6) for c in range(3)])
        background[lit] = blurred[lit]

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


def largest_blob(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if not count:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def main() -> None:
    for source, (name, width) in BACKGROUNDS.items():
        img = Image.open(SOURCES / source).convert('RGB')
        height = round(img.height * width / img.width)
        img.resize((width, height), Image.LANCZOS).save(OUT / f'{name}.png', optimize=True)
        print(name, (width, height))
    prepare_island()
    prepare_moon()


if __name__ == '__main__':
    main()
