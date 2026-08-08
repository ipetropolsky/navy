"""Готовит рабочие копии фонов сцены из оригиналов в src/assets/sources/.

Оригиналы не изменяются: сюда кладутся только уменьшенные версии для сборки.
Запуск: python3 tools/scene-assets/prepare-backgrounds.py
"""

import pathlib

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ROOT / 'src/assets/sources'
OUT = ROOT / 'src/assets/scene'

# Исходник -> (имя ассета, ширина рабочей копии).
BACKGROUNDS = {
    'sky_clean_3296x1028.png': ('sky', 1800),
    'sea_clean_3296x788.png': ('sea', 1800),
}


def main() -> None:
    for source, (name, width) in BACKGROUNDS.items():
        img = Image.open(SOURCES / source).convert('RGB')
        height = round(img.height * width / img.width)
        img.resize((width, height), Image.LANCZOS).save(OUT / f'{name}.png', optimize=True)
        print(name, (width, height))


if __name__ == '__main__':
    main()
