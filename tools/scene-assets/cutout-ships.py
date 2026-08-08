"""Вырезает силуэты кораблей из исходных картинок (серый фон + свечение -> прозрачность).

Оригиналы в src/assets/sources/ не изменяются; результат — src/assets/scene/ship-*.png.
Запуск: python3 tools/scene-assets/cutout-ships.py
Зависимости: Pillow, numpy, scipy (ставятся ad hoc, в проект не входят).

Метод в два шага:
1. Силуэт. Корабль обведён жёстким контуром, фон и свечение вокруг — гладкие градиенты.
   Ищем сильные градиенты (Собель), замыкаем контур, заливаем внутренность, берём крупнейшую область.
2. Чистка «карманов». Мачты, антенны и леера замыкают куски фона, которые попадают в заливку.
   Восстанавливаем фон диффузией снаружи внутрь и убираем те места выше палубы,
   где картинка совпадает с восстановленным фоном. Ниже палубы не трогаем — там тёмный борт.
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
# Восстановление фона: во сколько раз уменьшаем картинку и сколько шагов диффузии делаем.
BG_SCALE = 4
BG_STEPS = 400
# Совпадение с фоном и минимальный размер «кармана», который стоит вырезать.
BG_MATCH = 20
BG_MIN_AREA = 300


def cutout(path: pathlib.Path) -> tuple[Image.Image, dict]:
    img = Image.open(path).convert('RGB')
    arr = np.asarray(img).astype(np.float32)
    grey = arr.mean(axis=2)

    edges = np.hypot(ndimage.sobel(grey, axis=0), ndimage.sobel(grey, axis=1)) > EDGE_LEVEL
    closed = ndimage.binary_dilation(edges, np.ones((3, 3)), iterations=EDGE_CLOSE)
    body = largest_blob(ndimage.binary_fill_holes(closed))
    body = ndimage.binary_erosion(body, np.ones((3, 3)), iterations=EDGE_CLOSE)
    body = largest_blob(ndimage.binary_fill_holes(body))
    body = drop_background_pockets(arr, body)

    out = img.convert('RGBA')
    out.putalpha(Image.fromarray((body * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.7)))

    out = out.crop(out.getbbox())
    scale = TARGET_WIDTH / out.width
    out = out.resize((TARGET_WIDTH, max(1, round(out.height * scale))), Image.LANCZOS)

    return out, measure(out)


def drop_background_pockets(arr: np.ndarray, body: np.ndarray) -> np.ndarray:
    """Убирает из силуэта куски фона, замкнутые рангоутом."""
    known = ndimage.binary_dilation(body, np.ones((3, 3)), iterations=6)[::BG_SCALE, ::BG_SCALE]
    background = arr[::BG_SCALE, ::BG_SCALE].copy()
    for _ in range(BG_STEPS):
        blurred = np.dstack([ndimage.gaussian_filter(background[..., c], 3) for c in range(3)])
        background[known] = blurred[known]

    full = np.dstack(
        [np.kron(background[..., c], np.ones((BG_SCALE, BG_SCALE)))[: arr.shape[0], : arr.shape[1]] for c in range(3)]
    )
    like_background = np.abs(arr - full).max(axis=2) < BG_MATCH

    # Ниже уровня палубы силуэт сплошной, там чистить нечего (и легко испортить борт).
    widths = body.sum(axis=1)
    deck = int(np.argmax(widths > 0.6 * widths.max()))
    above_deck = np.zeros_like(body)
    above_deck[: deck + 6] = True

    pockets = ndimage.binary_opening(body & like_background & above_deck, np.ones((5, 5)))
    labels, count = ndimage.label(pockets)
    if count:
        sizes = ndimage.sum(pockets, labels, range(1, count + 1))
        big = [index + 1 for index, size in enumerate(sizes) if size > BG_MIN_AREA]
        pockets = np.isin(labels, big)

    return largest_blob(body & ~ndimage.binary_dilation(pockets, np.ones((3, 3))))


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

    hull_row = int(h * 0.85)
    hull = np.where(alpha[hull_row])[0]
    bow = int(hull[0]) if hull.size else 0
    stern = int(hull[-1]) if hull.size else w - 1

    return {
        'ratio': round(w / h, 3),
        'lamp': [round(mast_x / w * 100, 1), round((top + 2) / h * 100, 1)],
        'bow': [round(bow / w * 100, 1), round(hull_row / h * 100, 1)],
        'stern': [round(stern / w * 100, 1), round(hull_row / h * 100, 1)],
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
