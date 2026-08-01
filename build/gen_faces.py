#!/usr/bin/env python3
"""Six Marvel faces in the CardVault house style: full-square coloured
background + black corner webbing + bold-ringed circular face badge.
Same geometry/ink language as the app icon. Output: scalable SVGs."""
import math, os

INK = '#17141f'
RED = '#e01f2f'
SKIN = '#f2c9a0'
SKIN_PALE = '#ecd9be'
GOLD = '#e8b431'
GOLD_DARK = '#c4901c'
WHITE = '#f4f4f8'

CX, CY, R = 512.0, 512.0, 400.0
SAG = 0.90

OUT = os.path.expanduser('~/programming/mtg-cardvault/src/renderer/src/assets/faces')


def pt(cx, cy, r, deg):
    a = math.radians(deg)
    return cx + r * math.cos(a), cy + r * math.sin(a)


def web(cx, cy, angles, spoke_len, ring_radii, width, opacity=None):
    parts = []
    op = f' opacity="{opacity}"' if opacity is not None else ''
    parts.append(f'<g stroke="{INK}" fill="none"{op}>')
    for deg in angles:
        x, y = pt(cx, cy, spoke_len, deg)
        parts.append(f'<line x1="{cx:.0f}" y1="{cy:.0f}" x2="{x:.0f}" y2="{y:.0f}" stroke-width="{width}"/>')
    for r in ring_radii:
        for i in range(len(angles) - 1):
            a1, a2 = angles[i], angles[i + 1]
            x1, y1 = pt(cx, cy, r, a1)
            x2, y2 = pt(cx, cy, r, a2)
            xm, ym = pt(cx, cy, r * SAG, (a1 + a2) / 2)
            parts.append(f'<path d="M {x1:.0f} {y1:.0f} Q {xm:.0f} {ym:.0f} {x2:.0f} {y2:.0f}" stroke-width="{width - 1}"/>')
    parts.append('</g>')
    return parts


def scaffold(bg, face_fill, inner, overlay=None):
    """Background + corner webs + ringed circle containing `inner` art.
    `overlay` parts render after the ring and may overflow the circle."""
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">']
    svg.append(f'<rect x="0" y="0" width="1024" height="1024" fill="{bg}"/>')
    svg += web(-14, -14, list(range(0, 91, 15)), 900, [130, 260, 390, 520, 650], 9, 0.55)
    svg += web(1038, 1038, list(range(180, 271, 15)), 900, [130, 260, 390, 520, 650], 9, 0.55)
    svg.append(f'<clipPath id="face"><circle cx="{CX:.0f}" cy="{CY:.0f}" r="{R:.0f}"/></clipPath>')
    svg.append(f'<circle cx="{CX:.0f}" cy="{CY:.0f}" r="{R:.0f}" fill="{face_fill}"/>')
    svg.append(f'<g clip-path="url(#face)" stroke-linejoin="round" stroke-linecap="round">')
    svg += inner
    svg.append('</g>')
    svg.append(f'<circle cx="{CX:.0f}" cy="{CY:.0f}" r="{R:.0f}" fill="none" stroke="{INK}" stroke-width="30"/>')
    if overlay:
        svg.append('<g stroke-linejoin="round" stroke-linecap="round">')
        svg += overlay
        svg.append('</g>')
    svg.append('</svg>')
    return '\n'.join(svg)


def E(cx, cy, rx, ry, fill, sw=0, stroke=INK, extra=''):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if sw else ''
    return f'<ellipse cx="{cx}" cy="{cy}" rx="{rx}" ry="{ry}" fill="{fill}"{s}{extra}/>'


def P(d, fill='none', sw=0, stroke=INK):
    s = f' stroke="{stroke}" stroke-width="{sw}"' if sw else ''
    return f'<path d="{d}" fill="{fill}"{s}/>'


# ---------------------------------------------------------------- Loki
def loki():
    a = []
    # swept-back black hair filling the upper circle and down the sides
    a.append(P('M 512 132 C 310 132, 210 300, 218 560 C 228 700, 262 800, 310 860 '
               'C 292 700, 296 590, 314 500 C 330 380, 400 320, 512 320 '
               'C 624 320, 694 380, 710 500 C 728 590, 732 700, 714 860 '
               'C 762 800, 796 700, 806 560 C 814 300, 714 132, 512 132 Z', INK))
    # face
    a.append(E(512, 560, 240, 290, SKIN_PALE, 12))
    # hairline fringe
    a.append(P('M 292 470 C 330 350, 420 300, 512 300 C 604 300, 694 350, 732 470 '
               'C 700 400, 620 368, 512 368 C 404 368, 324 400, 292 470 Z', INK))
    # gold horned helmet band
    a.append(P('M 300 372 C 370 320, 654 320, 724 372 L 724 320 C 654 268, 370 268, 300 320 Z',
               GOLD, 10))
    # sly eyes: narrow almonds + green iris
    for sx in (1, -1):
        x = 512 + sx * 105
        a.append(P(f'M {x-70} 520 Q {x} 480 {x+70} 520 Q {x} 545 {x-70} 520 Z', WHITE, 9))
        a.append(E(x, 516, 17, 17, '#2f9e4f', 6))
        a.append(P(f'M {x-75} 488 Q {x} 452 {x+75} 488', 'none', 11))
    # nose + smirk
    a.append(P('M 512 540 Q 500 610 486 632 Q 512 648 538 632', 'none', 9))
    a.append(P('M 420 706 Q 512 760 620 690 Q 560 742 470 730 Z', INK))
    # chin shadow
    a.append(P('M 452 800 Q 512 826 572 800', 'none', 8))
    return a


# ---------------------------------------------------------------- Dr Doom
def doom():
    a = []
    hood = '#2c6b3f'
    steel = '#b9c2cf'
    steel_dark = '#8d97a8'
    # green hood framing everything
    a.append(P('M 512 118 C 300 118, 210 300, 210 560 L 180 906 L 844 906 L 814 560 '
               'C 814 300, 724 118, 512 118 Z', hood, 14))
    # hood opening (shadow)
    a.append(E(512, 540, 235, 300, INK))
    # silver mask
    a.append(P('M 512 262 C 380 262, 320 350, 320 470 C 320 640, 380 790, 512 790 '
               'C 644 790, 704 640, 704 470 C 704 350, 644 262, 512 262 Z', steel, 12))
    # brow plate
    a.append(P('M 330 452 C 380 400, 644 400, 694 452 L 694 480 C 640 440, 384 440, 330 480 Z',
               steel_dark, 8))
    # eye slits: dark rounded rects
    a.append(f'<rect x="372" y="470" width="110" height="44" rx="22" fill="{INK}"/>')
    a.append(f'<rect x="542" y="470" width="110" height="44" rx="22" fill="{INK}"/>')
    # nose ridge
    a.append(P('M 512 470 L 512 610', 'none', 9, steel_dark))
    a.append(P('M 484 612 Q 512 630 540 612', 'none', 9, steel_dark))
    # mouth grille
    a.append(f'<rect x="422" y="662" width="180" height="64" rx="18" fill="{steel_dark}" stroke="{INK}" stroke-width="9"/>')
    for i in range(4):
        x = 452 + i * 40
        a.append(f'<line x1="{x}" y1="674" x2="{x}" y2="714" stroke="{INK}" stroke-width="9"/>')
    # rivets
    for rx, ry in [(360, 330), (664, 330), (338, 560), (686, 560), (398, 748), (626, 748)]:
        a.append(E(rx, ry, 9, 9, steel_dark, 5))
    return a


# ---------------------------------------------------------------- Lady Loki
def lady_loki():
    a = []
    # long black hair: full backdrop down both sides
    a.append(P('M 512 128 C 290 128, 200 320, 205 570 C 200 720, 240 850, 300 920 '
               'C 280 760, 285 640, 300 560 C 300 380, 380 330, 512 330 '
               'C 644 330, 724 380, 724 560 C 739 640, 744 760, 724 920 '
               'C 784 850, 824 720, 819 570 C 824 320, 734 128, 512 128 Z', INK))
    # face
    a.append(E(512, 560, 220, 280, SKIN_PALE, 12))
    # fringe parted
    a.append(P('M 305 500 C 320 360, 400 310, 512 310 C 624 310, 704 360, 719 500 '
               'C 680 420, 600 385, 512 385 C 424 385, 344 420, 305 500 Z', INK))
    # gold tiara band + slim upswept horns
    a.append(P('M 330 392 C 400 348, 624 348, 694 392 L 694 350 C 624 306, 400 306, 330 350 Z',
               GOLD, 9))
    # eyes: larger almonds, green iris, lashes
    for sx in (1, -1):
        x = 512 + sx * 95
        a.append(P(f'M {x-62} 520 Q {x} 470 {x+62} 520 Q {x} 552 {x-62} 520 Z', WHITE, 9))
        a.append(E(x, 512, 19, 19, '#2f9e4f', 6))
        a.append(P(f'M {x-66} 500 Q {x} 458 {x+66} 500', 'none', 12))
        lash = 8 if sx == 1 else -8
        a.append(P(f'M {x+sx*62} 508 L {x+sx*82} 496', 'none', 10))
    # nose + smiling lips
    a.append(P('M 512 545 Q 504 600 494 618 Q 512 630 530 618', 'none', 8))
    a.append(P('M 438 690 Q 512 742 586 690 Q 512 718 438 690 Z', '#a8253f', 9))
    return a


# ---------------------------------------------------------------- Spider-Ham
def ham():
    a = []
    pink = '#f2a7bb'
    pink_dark = '#d97f98'
    # red mask fills the circle, with web (house language!)
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{RED}"/>')
    a += web(512, 512, list(range(0, 361, 30)), R, [120, 240, 360], 10)
    # Spidey eyes (small teardrops)
    for sx, x0 in ((1, 402), (-1, 622)):
        a.append(f'<g transform="translate({x0},404) scale({sx * 0.88},0.88) rotate(-20)">')
        a.append(P('M 0 195 C -70 170, -86 50, -80 0 C -74 -66, 74 -66, 80 0 '
                   'C 86 50, 70 170, 0 195 Z', WHITE, 30))
        a.append('</g>')
    # snout: big pink ellipse with nostrils
    a.append(E(512, 640, 150, 105, pink, 12))
    a.append(E(462, 640, 26, 40, pink_dark, 8))
    a.append(E(562, 640, 26, 40, pink_dark, 8))
    # little grin under snout
    a.append(P('M 440 772 Q 512 812 584 772', 'none', 10))
    return a


# ---------------------------------------------------------------- Fisk
def fisk():
    a = []
    suit = '#f4f4f8'
    cravat = '#7a4ea8'
    # white suit shoulders
    a.append(P('M 150 920 C 220 760, 340 700, 512 700 C 684 700, 804 760, 874 920 Z', suit, 12))
    # cravat
    a.append(P('M 430 700 C 460 760, 564 760, 594 700 L 594 860 C 540 900, 484 900, 430 860 Z',
               cravat, 10))
    a.append(E(512, 790, 14, 14, GOLD, 6))
    # massive bald head
    a.append(P('M 512 190 C 350 190, 290 320, 300 480 C 306 620, 360 730, 512 730 '
               'C 664 730, 718 620, 724 480 C 734 320, 674 190, 512 190 Z', SKIN, 12))
    # tiny ears
    a.append(E(296, 500, 26, 42, SKIN, 10))
    a.append(E(728, 500, 26, 42, SKIN, 10))
    # heavy scowl brows
    a.append(P('M 360 452 L 480 470 L 476 500 L 364 484 Z', INK))
    a.append(P('M 664 452 L 544 470 L 548 500 L 660 484 Z', INK))
    # small hard eyes
    a.append(E(430, 512, 26, 15, WHITE, 8))
    a.append(E(594, 512, 26, 15, WHITE, 8))
    a.append(E(430, 512, 8, 8, INK))
    a.append(E(594, 512, 8, 8, INK))
    # broad nose + deep frown
    a.append(P('M 512 500 Q 500 570 482 592 Q 512 606 542 592', 'none', 9))
    a.append(P('M 430 668 Q 512 630 594 668', 'none', 12))
    # jaw crease
    a.append(P('M 372 600 Q 380 660 420 700', 'none', 7))
    a.append(P('M 652 600 Q 644 660 604 700', 'none', 7))
    return a


# ---------------------------------------------------------------- Daredevil
def daredevil():
    a = []
    dd = '#c01a28'
    dd_dark = '#8f1220'
    # red cowl fills the circle
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{dd}"/>')
    # eye lenses: blank angular dark red
    a.append(P('M 330 470 Q 400 420 480 462 Q 478 530 400 534 Q 344 528 330 470 Z', dd_dark, 12))
    a.append(P('M 694 470 Q 624 420 544 462 Q 546 530 624 534 Q 680 528 694 470 Z', dd_dark, 12))
    # exposed jaw: wide skin band across the bottom of the circle
    a.append(P('M 340 700 C 400 660, 624 660, 684 700 L 684 940 L 340 940 Z', SKIN, 12))
    # grim mouth + chin crease
    a.append(P('M 440 790 Q 512 812 584 790', 'none', 11))
    a.append(P('M 480 862 Q 512 876 544 862', 'none', 8))
    return a


def loki_overlay():
    # crescent horns sweeping outward from the helmet band
    left = ('M 408 332 C 310 306, 244 240, 230 124 '
            'C 227 104, 238 94, 252 106 '
            'C 306 202, 366 266, 442 318 Z')
    right = ('M 616 332 C 714 306, 780 240, 794 124 '
             'C 797 104, 786 94, 772 106 '
             'C 718 202, 658 266, 582 318 Z')
    return [P(left, GOLD, 13), P(right, GOLD, 13)]


def lady_loki_overlay():
    # slimmer crescents, same outward sweep
    left = ('M 418 344 C 340 316, 292 250, 284 140 '
            'C 282 122, 292 114, 304 126 '
            'C 348 216, 396 278, 452 330 Z')
    right = ('M 606 344 C 684 316, 732 250, 740 140 '
             'C 742 122, 732 114, 720 126 '
             'C 676 216, 628 278, 572 330 Z')
    return [P(left, GOLD, 11), P(right, GOLD, 11)]


def ham_overlay():
    return [
        P('M 330 250 C 296 164, 318 106, 372 80 C 424 118, 436 186, 424 262 Z', '#f2a7bb', 13),
        P('M 694 250 C 728 164, 706 106, 652 80 C 600 118, 588 186, 600 262 Z', '#f2a7bb', 13),
    ]


def dd_overlay():
    return [
        P('M 386 200 C 348 138, 348 84, 380 34 C 424 74, 440 138, 436 196 Z', '#c01a28', 12),
        P('M 638 200 C 676 138, 676 84, 644 34 C 600 74, 584 138, 588 196 Z', '#c01a28', 12),
    ]


OVERLAYS = {'loki': loki_overlay, 'lady-loki': lady_loki_overlay,
            'spider-ham': ham_overlay, 'daredevil': dd_overlay}

CHARS = [
    ('loki',       '#6a2d9c', SKIN_PALE, loki),
    ('doom',       '#16697a', '#0e3a2c', doom),
    ('lady-loki',  '#a1237a', SKIN_PALE, lady_loki),
    ('spider-ham', '#e2a41f', RED, ham),
    ('fisk',       '#8f1d2c', '#f4f4f8', fisk),
    ('daredevil',  '#d2611f', '#3a3f4d', daredevil),
]

os.makedirs('faces', exist_ok=True)
for name, bg, fill, fn in CHARS:
    ov = OVERLAYS.get(name)
    svg = scaffold(bg, fill, fn(), ov() if ov else None)
    with open(f'faces/{name}.svg', 'w') as f:
        f.write(svg + '\n')
    print('wrote', name)
