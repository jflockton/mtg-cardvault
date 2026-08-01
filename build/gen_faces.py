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


def web(cx, cy, angles, spoke_len, ring_radii, width, opacity=None, color=INK):
    parts = []
    op = f' opacity="{opacity}"' if opacity is not None else ''
    parts.append(f'<g stroke="{color}" fill="none"{op}>')
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



# ---------------------------------------------------------------- Doc Ock
def ock():
    a = []
    hair = '#4a3320'
    # green jumpsuit shoulders
    a.append(P('M 150 920 C 230 770, 350 710, 512 710 C 674 710, 794 770, 874 920 Z',
               '#3e8f3a', 12))
    # round face
    a.append(E(512, 520, 235, 265, SKIN, 12))
    # bowl cut
    a.append(P('M 277 520 C 270 330, 380 240, 512 240 C 644 240, 754 330, 747 520 '
               'C 740 430, 700 392, 660 392 L 364 392 C 324 392, 284 430, 277 520 Z', hair))
    # goggles: joined round frames, amber lenses
    a.append(P('M 462 470 L 562 470', 'none', 16))
    a.append(E(408, 480, 78, 78, '#8d97a8', 12))
    a.append(E(616, 480, 78, 78, '#8d97a8', 12))
    a.append(E(408, 480, 52, 52, '#d9822b', 10))
    a.append(E(616, 480, 52, 52, '#d9822b', 10))
    # smug mouth + jaw
    a.append(P('M 430 660 Q 512 640 594 660', 'none', 11))
    a.append(P('M 452 720 Q 512 742 572 720', 'none', 8))
    return a


def ock_overlay():
    steel = '#8d97a8'
    parts = []
    for sx in (1, -1):
        m = (lambda x: x) if sx == 1 else (lambda x: 1024 - x)
        parts.append(P(f'M {m(196)} 780 C {m(60)} 640, {m(52)} 420, {m(150)} 250 '
                       f'C {m(162)} 226, {m(196)} 232, {m(196)} 262 '
                       f'C {m(120)} 420, {m(128)} 610, {m(252)} 736 Z', steel, 11))
        parts.append(E(m(172), 240, 40, 40, steel, 11))
        parts.append(E(m(172), 240, 15, 15, '#d9822b', 8))
    return parts


# ---------------------------------------------------------------- Spider-Man Noir
def noir():
    a = []
    coat = '#343845'
    maskc = '#4a5162'
    # trench collar
    a.append(P('M 170 920 C 250 780, 360 730, 512 730 C 664 730, 774 780, 854 920 Z', coat, 12))
    a.append(P('M 330 780 L 440 900 L 300 900 Z', '#20232b', 8))
    a.append(P('M 694 780 L 584 900 L 724 900 Z', '#20232b', 8))
    # mask head
    a.append(f'<circle cx="512" cy="470" r="270" fill="{maskc}" stroke="{INK}" stroke-width="12"/>')
    # stitched seam
    a.append(P('M 512 210 L 512 330', 'none', 8))
    # round goggles: pale rims, dark glass, white shine
    a.append(E(410, 500, 84, 88, '#171a21', 16, '#7d8596'))
    a.append(E(614, 500, 84, 88, '#171a21', 16, '#7d8596'))
    a.append(P('M 366 468 Q 398 442 436 456', 'none', 11, WHITE))
    a.append(P('M 570 468 Q 602 442 640 456', 'none', 11, WHITE))
    return a


def noir_overlay():
    hat = '#20232b'
    band = '#3a3f4a'
    return [
        # fedora: brim sweeping past the ring + dented crown
        P('M 118 330 C 210 290, 814 290, 906 330 C 830 372, 194 372, 118 330 Z', hat, 12),
        P('M 300 322 C 296 210, 360 130, 470 118 C 450 160, 460 200, 452 240 '
          'C 500 150, 600 130, 700 160 C 736 200, 742 270, 730 322 Z', hat, 12),
        P('M 306 300 C 450 268, 590 268, 724 300 L 724 322 L 306 322 Z', band, 8),
    ]


# ---------------------------------------------------------------- J. Jonah Jameson
def jjj():
    a = []
    hair = '#26222e'
    grey = '#b9bec9'
    # shirt + tie
    a.append(P('M 160 920 C 240 780, 360 724, 512 724 C 664 724, 784 780, 864 920 Z', WHITE, 12))
    a.append(P('M 472 724 L 552 724 L 534 790 L 512 900 L 490 790 Z', '#8f1d2c', 9))
    # boxy face
    a.append(P('M 512 230 C 370 230, 300 330, 306 480 C 310 640, 380 730, 512 730 '
               'C 644 730, 714 640, 718 480 C 724 330, 654 230, 512 230 Z', SKIN, 12))
    # flat-top hair with grey temples
    a.append(P('M 296 400 L 296 302 C 300 262, 340 240, 400 238 L 624 238 '
               'C 684 240, 724 262, 728 302 L 728 400 C 700 330, 660 306, 620 306 '
               'L 404 306 C 364 306, 324 330, 296 400 Z', hair))
    a.append(P('M 296 400 L 296 330 C 316 322, 336 330, 344 356 C 330 372, 312 386, 296 400 Z', grey))
    a.append(P('M 728 400 L 728 330 C 708 322, 688 330, 680 356 C 694 372, 712 386, 728 400 Z', grey))
    # stern brows + narrow eyes
    a.append(P('M 366 440 L 476 452 L 472 482 L 370 470 Z', INK))
    a.append(P('M 658 440 L 548 452 L 552 482 L 654 470 Z', INK))
    a.append(E(424, 500, 24, 13, WHITE, 8))
    a.append(E(600, 500, 24, 13, WHITE, 8))
    a.append(E(424, 500, 7, 7, INK))
    a.append(E(600, 500, 7, 7, INK))
    # nose + toothbrush moustache
    a.append(P('M 512 490 Q 502 550 490 570 Q 512 582 536 570', 'none', 9))
    a.append(f'<rect x="452" y="592" width="120" height="30" rx="10" fill="{hair}"/>')
    # shouting mouth: open with a strip of teeth
    a.append(P('M 430 650 C 470 636, 554 636, 594 650 C 586 706, 540 730, 512 730 '
               'C 484 730, 438 706, 430 650 Z', '#42101b', 10))
    a.append(P('M 442 652 C 480 644, 544 644, 582 652 L 578 672 C 540 664, 484 664, 446 672 Z',
               WHITE, 6))
    # cigar jutting from the corner
    a.append(f'<rect x="580" y="676" width="150" height="40" rx="18" fill="#5c3a1e" stroke="{INK}" stroke-width="9" transform="rotate(-12 580 696)"/>')
    a.append(E(736, 652, 12, 12, '#d9822b', 7))
    return a


# ---------------------------------------------------------------- Green Goblin
def goblin():
    a = []
    gskin = '#46b25c'
    purple = '#5b2d8c'
    # green mask fills the circle
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{gskin}"/>')
    # purple hood cap with zigzag edge
    a.append(P('M 512 112 C 330 112, 230 240, 226 400 '
               'L 306 356 L 366 420 L 442 352 L 512 424 L 582 352 L 658 420 L 718 356 L 798 400 '
               'C 794 240, 694 112, 512 112 Z', purple, 12))
    # crazed yellow eyes, slanted
    a.append(P('M 320 500 C 360 440, 440 430, 480 470 C 486 510, 460 540, 410 546 '
               'C 370 542, 336 526, 320 500 Z', '#f2d33c', 11))
    a.append(P('M 704 500 C 664 440, 584 430, 544 470 C 538 510, 564 540, 614 546 '
               'C 654 542, 688 526, 704 500 Z', '#f2d33c', 11))
    a.append(E(444, 500, 12, 12, INK))
    a.append(E(580, 500, 12, 12, INK))
    # angry brow slashes over the eyes
    a.append(P('M 316 452 L 478 492 L 470 524 L 320 478 Z', INK))
    a.append(P('M 708 452 L 546 492 L 554 524 L 704 478 Z', INK))
    # pointed nose
    a.append(P('M 512 520 L 486 618 Q 512 636 538 618 Z', 'none', 9))
    # sinister grin: corners hooked up, jagged teeth
    a.append(P('M 316 654 C 350 700, 430 738, 512 738 C 594 738, 674 700, 708 654 '
               'C 700 724, 640 790, 512 790 C 384 790, 324 724, 316 654 Z', '#1d4e2a', 11))
    a.append(P('M 334 668 L 380 700 L 408 676 L 448 712 L 484 684 L 512 716 L 540 684 '
               'L 576 712 L 616 676 L 644 700 L 690 668 L 686 690 C 630 744, 394 744, 338 690 Z',
               WHITE, 6))
    return a


def goblin_overlay():
    gskin = '#46b25c'
    purple = '#5b2d8c'
    return [
        # pointed ears
        P('M 210 430 C 130 380, 86 300, 92 210 C 170 250, 224 330, 244 414 Z', gskin, 12),
        P('M 814 430 C 894 380, 938 300, 932 210 C 854 250, 800 330, 780 414 Z', gskin, 12),
        # nightcap tail flopping off the hood
        P('M 700 160 C 800 96, 900 100, 950 170 C 960 196, 940 216, 912 206 '
          'C 860 180, 800 190, 742 232 Z', purple, 12),
        f'<circle cx="936" cy="188" r="26" fill="{purple}" stroke="{INK}" stroke-width="10"/>',
    ]


# ---------------------------------------------------------------- Miles Morales
def miles():
    a = []
    suit = '#221d30'
    # black suit mask with red webbing
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{suit}"/>')
    a += web(512, 512, list(range(0, 361, 30)), R, [120, 240, 360], 9, color=RED)
    # house teardrop eyes with a red accent rim
    for sx, x0 in ((1, 396), (-1, 628)):
        a.append(f'<g transform="translate({x0},420) scale({sx},1) rotate(-18)">')
        a.append(P('M 0 205 C -76 178, -94 52, -86 0 C -78 -70, 78 -70, 86 0 '
                   'C 94 52, 76 178, 0 205 Z', 'none', 68, RED))
        a.append(P('M 0 205 C -76 178, -94 52, -86 0 C -78 -70, 78 -70, 86 0 '
                   'C 94 52, 76 178, 0 205 Z', WHITE, 26))
        a.append('</g>')
    return a


OVERLAYS = {'spider-ham': ham_overlay, 'daredevil': dd_overlay,
            'doc-ock': ock_overlay, 'noir': noir_overlay, 'goblin': goblin_overlay}

CHARS = [
    ('venom',      '#6a2d9c', '#241e33', venom),
    ('doom',       '#16697a', '#0e3a2c', doom),
    ('spider-gwen','#a1237a', '#221d30', gwen),
    ('spider-ham', '#e2a41f', RED, ham),
    ('fisk',       '#8f1d2c', '#f4f4f8', fisk),
    ('daredevil',  '#d2611f', '#3a3f4d', daredevil),
    ('doc-ock',    '#5a9e21', SKIN, ock),
    ('noir',       '#565d6d', '#2c2f38', noir),
    ('jjj',        '#7a4a26', SKIN, jjj),
    ('goblin',     '#2e9bc0', '#46b25c', goblin),
    ('miles',      '#d8437a', '#221d30', miles),
]

os.makedirs('faces', exist_ok=True)
for name, bg, fill, fn in CHARS:
    ov = OVERLAYS.get(name)
    svg = scaffold(bg, fill, fn(), ov() if ov else None)
    with open(f'faces/{name}.svg', 'w') as f:
        f.write(svg + '\n')
    print('wrote', name)
