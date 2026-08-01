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



# ---------------------------------------------------------------- Venom
def venom():
    a = []
    maw = '#42101b'
    tongue = '#c2264a'
    # symbiote head fills the circle
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="#241e33"/>')
    # huge slanted eyes: rounded at the outer edge, sharp point at the nose
    a.append(P('M 456 528 C 340 560, 218 528, 176 450 '
               'C 148 376, 190 296, 284 276 '
               'C 386 258, 452 338, 456 528 Z', WHITE, 15))
    a.append(P('M 568 528 C 684 560, 806 528, 848 450 '
               'C 876 376, 834 296, 740 276 '
               'C 638 258, 572 338, 568 528 Z', WHITE, 15))
    # grinning maw
    a.append(P('M 232 640 C 340 596, 684 596, 792 640 C 750 780, 640 856, 512 856 '
               'C 384 856, 274 780, 232 640 Z', maw, 14))
    # tongue lolling along the lower jaw
    a.append(P('M 400 820 C 450 780, 574 780, 624 820 C 590 852, 434 852, 400 820 Z',
               tongue, 9))
    # top row of fangs hanging from the upper lip
    import math as _m
    for i in range(9):
        x0 = 268 + i * 56
        a.append(P(f'M {x0} {622 + (i%2)*4} L {x0+28} {706 + (i%2)*10} L {x0+56} {620 + (i%2)*4} Z',
                   WHITE, 7))
    # bottom row of fangs rising from the jaw
    for i in range(7):
        x0 = 330 + i * 52
        a.append(P(f'M {x0} {836 - (i%2)*4} L {x0+26} {762 - (i%2)*8} L {x0+52} {838 - (i%2)*4} Z',
                   WHITE, 7))
    return a


# ---------------------------------------------------------------- Spider-Gwen
def gwen():
    a = []
    pink = '#e83a8c'
    mask = '#221d30'
    # masked face fills the circle
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{mask}"/>')
    # white hood: full circle with the face opening cut back out
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{WHITE}"/>')
    a.append(E(512, 545, 225, 285, mask, 0))
    # pink hood lining around the opening
    a.append(E(512, 545, 225, 285, 'none', 24, pink))
    # hood folds
    a.append(P('M 300 800 Q 340 840 400 862', 'none', 10))
    a.append(P('M 724 800 Q 684 840 624 862', 'none', 10))
    a.append(P('M 512 118 Q 500 160 512 205', 'none', 10))
    # big rounded white eyes, ink-rimmed (house teardrop, gentler tilt)
    for sx, x0 in ((1, 390), (-1, 634)):
        a.append(f'<g transform="translate({x0},436) scale({sx * 1.3},1.3) rotate(-14)">')
        a.append(P('M 0 190 C -74 165, -92 45, -84 -5 C -76 -70, 76 -70, 84 -5 '
                   'C 92 45, 74 165, 0 190 Z', WHITE, 24))
        a.append('</g>')
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


OVERLAYS = {'spider-ham': ham_overlay, 'daredevil': dd_overlay}

CHARS = [
    ('venom',      '#6a2d9c', '#241e33', venom),
    ('doom',       '#16697a', '#0e3a2c', doom),
    ('spider-gwen','#a1237a', '#221d30', gwen),
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
