"""Готовит рабочие копии слоёв сцены из оригиналов в src/assets/sources/.

Оригиналы не изменяются: сюда кладутся только уменьшенные версии для сборки.
Кроме уменьшения:
- небо разворачивается по кругу и подгоняется под прежнюю рамку (см. prepare_sky);
- месяц вырезается из старой картинки неба отдельным слоем (в новом небе месяца нет);
- остров вырезается из своей картинки (силуэт по контуру, серый фон уходит в прозрачность);
- вымпел старшего на рейде и стрелка курса обрезаются по своим полям.

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

# Небо. Исходник стыкуется сам с собой по левому и правому краю — из него получается
# повторяющаяся текстура, и зеркалить соседние плитки в сцене больше не нужно.
SKY_SOURCE = 'the_sky_orion_3.png'
SKY_WIDTH = 1800
# Рамка прежнего неба: 1800×559. Держим ту же пропорцию — вся геометрия сцены отмеряна
# от неё, и от смены картинки не должны разъехаться ни звёзды, ни горизонт.
SKY_ASPECT = 1800 / 559
# Пояс Ориона в исходнике, px: середина трёх звёзд в ряд. Замерено по картинке.
SKY_ORION = (341, 367)
# Куда его поставить — доли кадра. Ровно там Орион стоял в прежнем небе (замер: 43.33%
# ширины, 39.66% высоты), а значит и на экране он останется на прежнем месте: сцена
# кладёт плитку по своим правилам, ничего не зная о том, что внутри.
SKY_ORION_PLACE = (0.4333, 0.3966)
# Глубина неба по высоте кадра: медиана строки прежней картинки, сверху вниз, 12 отсчётов
# ровным шагом. Новый исходник заметно светлее — его собственный градиент идёт от #000a39
# к #01388d, — и без этой подгонки небо стало бы вдвое ярче на тех же высотах.
SKY_PROFILE = [
    '#000118',
    '#000118',
    '#00031c',
    '#000623',
    '#000a2a',
    '#000d30',
    '#001138',
    '#001440',
    '#001849',
    '#001d53',
    '#00235e',
    '#012867',
]
# Насколько пиксель должен быть ярче фона, чтобы считаться звездой, а не небом. Небу
# подгонка достаётся целиком, звезде — нисколько, между ними доля: иначе вокруг каждой
# звезды остался бы ореол прежней яркости.
SKY_STAR_EDGE = 60

# Море для анимации «Зеркало»: один снимок, который перетекает в собственное
# отражение и обратно. Уменьшать его нечего — 1585px хватает и на удвоенную
# плотность, а лишнее пережатие только съело бы рябь, ради которой всё и затеяно.
SEA_SOURCE = 'sea_fixed.png'

ISLAND_SOURCE = 'island.png'
ISLAND_WIDTH = 1400

# Вымпел старшего на рейде: снимок настоящего вымпела, уже с прозрачным фоном. Стоит он
# в строчке списка ростом с букву, поэтому и уменьшается сильно — но не до строчки, а вдвое
# с запасом: экраны бывают плотные, и на них картинка берётся из тех же пикселей.
#
# Исходник взят выбеленный: прежний отдавал в жёлто-коричневое (средний цвет непрозрачных
# пикселей 214/189/159), и в строчке рядом с белым текстом вымпел читался выцветшим. У этого
# перекос вчетверо меньше (224/216/205), и в списке он остаётся белым флагом, а не бежевым.
PENNANT_SOURCE = 'senior_white.png'
PENNANT_WIDTH = 320

# Стрелка выбранного курса: лежит на воде под выбранным местом и под своим кораблём.
# Нарисована вправо, влево разворачивается отражением. Исходник — белый силуэт с большими
# полями; в кадре стрелка мелкая, но светится, и запас по плотности ей нужен как и вымпелу.
#
# Силуэт взят налитый (arrow_2), а не прежний тонкий: стрелка лежит на воде трапецией со сходом
# вдаль, и читается этот сход по её кромкам. У тонкой кромки почти сходились сами по себе,
# и разобрать в них перспективу было нечем. Свечения этой полагается меньше — см. .berthDotPicked.
ARROW_SOURCE = 'arrow_2.png'
ARROW_WIDTH = 320

# Месяц: готовая вырезка со свечением, уже с прозрачным фоном и уже в нужном размере.
#
# Раньше его вынимали из первой присланной картинки неба — в новом небе месяца нет, — и
# вынимали тяжело: небо вокруг оценивали многократным размытием, а серп отделяли от него
# порогом по превышению яркости. Порог этот заодно срезал и слабое свечение вокруг серпа,
# которое в кадре читалось не свечением, а мутным кругом. Здесь свечение нарисовано, а не
# осталось от вырезки, и срезать его больше нечем и незачем.
#
# Серп в новой картинке стоит там же, где стоял в вырезанной, — и в том же холсте 320×320,
# — поэтому мерки месяца в стилях (@moon-disc, @moon-image, @moon-image-drop) остались
# прежними: поменялось только то, что вокруг серпа.
MOON_SOURCE = 'moon_glow_320x320.png'


def prepare_sky() -> None:
    """Подгоняет новое небо под рамку прежнего: Орион на прежнем месте, глубина та же.

    Три действия, и каждое выбрано так, чтобы не сломать стыковку по горизонтали, — ради
    неё картинку и рисовали заново.

    1. Круговой сдвиг вдоль ширины. Орион уезжает туда, где стоял в прежнем небе. Сдвиг
       именно круговой, а не обрезка с краю: у стыкующейся картинки левый край продолжает
       правый, поэтому её можно крутить сколько угодно — шва не появится нигде.
    2. Обрезка по высоте до прежней пропорции. Обрезаем сверху и снизу — по вертикали
       картинка ничего не стыкует, там градиент. Место обрезки задаёт тот же Орион: он
       обязан оказаться на своей доле высоты.
    3. Подгонка глубины по строкам. Новый исходник светлее прежнего на всех высотах,
       а сцена вокруг — море, остров, кружок неба под месяцем — размечена по прежнему.
       Поэтому каждой строке возвращаем её прежний цвет фона, а звёзды оставляем как есть.
    """
    source = Image.open(SOURCES / SKY_SOURCE).convert('RGB')
    sky = np.asarray(source).astype(np.float32)
    height, width, _ = sky.shape

    sky = np.roll(sky, round(SKY_ORION_PLACE[0] * width) - SKY_ORION[0], axis=1)

    framed = round(width / SKY_ASPECT)
    top = SKY_ORION[1] - round(SKY_ORION_PLACE[1] * framed)
    if top < 0 or top + framed > height:
        raise SystemExit(f'{SKY_SOURCE}: Ориону не хватает высоты — нужны строки {top}..{top + framed}')
    sky = sky[top : top + framed]

    # Фон строки — её медиана: звёзды в ней тонут, остаётся чистый градиент.
    background = np.median(sky, axis=1, keepdims=True)
    stops = np.array([[int(stop[i : i + 2], 16) for i in (1, 3, 5)] for stop in SKY_PROFILE], dtype=np.float32)
    share = np.linspace(0, 1, framed)
    target = np.stack(
        [np.interp(share, np.linspace(0, 1, len(stops)), stops[:, channel]) for channel in range(3)], axis=1
    )[:, None, :]
    star = np.clip((sky - background).max(axis=2, keepdims=True) / SKY_STAR_EDGE, 0, 1)
    sky = np.clip(sky + (target - background) * (1 - star), 0, 255)

    # Уменьшение — по трём копиям подряд, из которых берётся средняя. Lanczos на краю
    # картинки досчитывает соседей из самого края, и уменьшённая врозь плитка перестала бы
    # стыковаться: у стыка появилась бы полоска шириной в пару пикселей.
    tiled = Image.fromarray(sky.astype(np.uint8), 'RGB')
    tiled = Image.fromarray(np.tile(np.asarray(tiled), (1, 3, 1)), 'RGB')
    out_height = round(SKY_WIDTH / (width / framed))
    tiled = tiled.resize((SKY_WIDTH * 3, out_height), Image.LANCZOS)
    tiled.crop((SKY_WIDTH, 0, SKY_WIDTH * 2, out_height)).save(OUT / 'sky.png', optimize=True)
    print('sky', (SKY_WIDTH, out_height))


def prepare_island() -> None:
    """Остров прислан уже с прозрачным фоном и собственным отражением.

    Ничего не перерисовываем: только срезаем почти прозрачные поля и уменьшаем.
    """
    island = Image.open(SOURCES / ISLAND_SOURCE).convert('RGBA')
    alpha = np.asarray(island)[..., 3] > 8
    rows, cols = np.where(alpha.any(axis=1))[0], np.where(alpha.any(axis=0))[0]
    island = island.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))

    height = round(island.height * ISLAND_WIDTH / island.width)
    island.resize((ISLAND_WIDTH, height), Image.LANCZOS).save(OUT / 'island.png', optimize=True)
    print('island', (ISLAND_WIDTH, height))


def prepare_pennant() -> None:
    """Вымпел прислан с прозрачным фоном: срезаем пустые поля и уменьшаем."""
    pennant = Image.open(SOURCES / PENNANT_SOURCE).convert('RGBA')
    alpha = np.asarray(pennant)[..., 3] > 8
    rows, cols = np.where(alpha.any(axis=1))[0], np.where(alpha.any(axis=0))[0]
    pennant = pennant.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))

    height = round(pennant.height * PENNANT_WIDTH / pennant.width)
    pennant.resize((PENNANT_WIDTH, height), Image.LANCZOS).save(OUT / 'pennant.png', optimize=True)
    print('pennant', (PENNANT_WIDTH, height))


def prepare_arrow() -> None:
    """Стрелка курса: тот же обрез по полям и уменьшение, что и у вымпела."""
    arrow = Image.open(SOURCES / ARROW_SOURCE).convert('RGBA')
    alpha = np.asarray(arrow)[..., 3] > 8
    rows, cols = np.where(alpha.any(axis=1))[0], np.where(alpha.any(axis=0))[0]
    arrow = arrow.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))

    height = round(arrow.height * ARROW_WIDTH / arrow.width)
    arrow.resize((ARROW_WIDTH, height), Image.LANCZOS).save(OUT / 'arrow.png', optimize=True)
    print('arrow', (ARROW_WIDTH, height))


def prepare_moon() -> None:
    """Месяц: перекладываем как есть — вырезка пришла готовой, см. MOON_SOURCE."""
    moon = Image.open(SOURCES / MOON_SOURCE).convert('RGBA')
    moon.save(OUT / 'moon.png', optimize=True)
    print('moon', moon.size)


def prepare_sea() -> None:
    img = Image.open(SOURCES / SEA_SOURCE).convert('RGB')
    img.save(OUT / 'sea.png', optimize=True)
    print('sea', img.size)


def largest_blob(mask: np.ndarray) -> np.ndarray:
    labels, count = ndimage.label(mask)
    if not count:
        return mask
    sizes = ndimage.sum(mask, labels, range(1, count + 1))
    return labels == (int(np.argmax(sizes)) + 1)


def main() -> None:
    prepare_sky()
    prepare_sea()
    prepare_island()
    prepare_moon()
    prepare_pennant()
    prepare_arrow()


if __name__ == '__main__':
    main()
