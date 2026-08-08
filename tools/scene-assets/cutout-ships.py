"""Вырезает силуэты кораблей из исходных картинок (серый фон + свечение -> прозрачность).

Оригиналы в src/assets/sources/ не изменяются; результат — src/assets/scene/ship-*.png.
Запуск: python3 tools/scene-assets/cutout-ships.py
Зависимости: Pillow, numpy, scipy (ставятся ad hoc, в проект не входят).

Метод: корабль обведён жёстким контуром, а фон и свечение вокруг него — гладкие градиенты.
Ищем сильные градиенты (Собель), замыкаем контур, заливаем внутренность и берём крупнейшую
область. Так свечение остаётся снаружи, а тонкие мачты и леера — внутри силуэта.
"""

import json
import pathlib

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'src/assets/sources'
OUT = ROOT / 'src/assets/scene'

# Исходник -> имя ассета. Корабли на картинках смотрят носом влево.
SHIPS = {
    'ChatGPT Image Aug 8, 2026, 06_43_01 PM.png': 'ship-corvette',
    'ChatGPT Image Aug 8, 2026, 06_06_32 PM.png': 'ship-frigate',
    'ChatGPT Image Aug 8, 2026, 06_38_31 PM.png': 'ship-patrol',
}

TARGET_WIDTH = 1100
EDGE_LEVEL = 25
# Насколько расширяем контур, чтобы замкнуть разрывы (и на столько же сжимаем обратно).
EDGE_CLOSE = 4


def cutout(path: pathlib.Path) -> tuple[Image.Image, dict]:
    img = Image.open(path).convert('RGB')
    grey = np.asarray(img).astype(np.float32).mean(axis=2)

    edges = np.hypot(ndimage.sobel(grey, axis=0), ndimage.sobel(grey, axis=1)) > EDGE_LEVEL
    closed = ndimage.binary_dilation(edges, np.ones((3, 3)), iterations=EDGE_CLOSE)
    body = largest_blob(ndimage.binary_fill_holes(closed))
    body = ndimage.binary_erosion(body, np.ones((3, 3)), iterations=EDGE_CLOSE)
    body = largest_blob(ndimage.binary_fill_holes(body))

    # Внутрь силуэта иногда попадают куски фона, замкнутые леерами: они серые и светлее контуров.
    arr = np.asarray(img).astype(np.int16)
    blueness = arr[..., 2] - (arr[..., 0] + arr[..., 1]) / 2
    trapped = body & (blueness < 8) & (grey > 30)
    trapped = ndimage.binary_opening(trapped, np.ones((5, 5)))
    body = body & ~ndimage.binary_dilation(trapped, np.ones((3, 3)))

    out = img.convert('RGBA')
    out.putalpha(Image.fromarray((body * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))

    out = out.crop(out.getbbox())
    scale = TARGET_WIDTH / out.width
    out = out.resize((TARGET_WIDTH, max(1, round(out.height * scale))), Image.LANCZOS)

    return out, measure(out)


def largest_blob(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if not count:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def measure(sprite: Image.Image) -> dict:
    """Ключевые точки спрайта в процентах: верх мачты, нос, корма."""
    alpha = np.asarray(sprite.split()[-1]) > 40
    h, w = alpha.shape
    top = int(np.where(alpha.any(axis=1))[0][0])
    mast_x = int(np.argmax(alpha[top : top + 4].any(axis=0)))

    hull_row = int(h * 0.7)
    hull = np.where(alpha[hull_row])[0]
    bow = int(hull[0]) if hull.size else 0
    stern = int(hull[-1]) if hull.size else w - 1

    return {
        'width': w,
        'height': h,
        'lamp': [round(mast_x / w * 100, 2), round((top + 2) / h * 100, 2)],
        'bow': [round(bow / w * 100, 2), round(hull_row / h * 100, 2)],
        'stern': [round(stern / w * 100, 2), round(hull_row / h * 100, 2)],
    }


def main() -> None:
    meta = {}
    for source, name in SHIPS.items():
        sprite, points = cutout(SOURCES / source)
        sprite.save(OUT / f'{name}.png', optimize=True)
        meta[name] = points
    print(json.dumps(meta, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
