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
    # everything lives in the overlay: the pointed hood IS her silhouette,
    # drawn over the badge ring like the other characters' overflow parts
    return []


def gwen_overlay():
    pink = '#e83a8c'
    cyan = '#3fb9e6'
    a = []
    # pointed hood: peak past the ring, wide cheeks, draped bottom
    a.append(P('M 512 42 '
               'C 430 92, 258 300, 172 560 '
               'C 142 700, 192 848, 262 928 '
               'Q 512 998, 762 928 '
               'C 832 848, 882 700, 852 560 '
               'C 766 300, 594 92, 512 42 Z', WHITE, 30))
    # pink lining arch with cyan scalloped webbing
    lining = ('M 512 150 C 386 195, 296 330, 290 505 '
              'C 286 655, 376 776, 512 806 '
              'C 648 776, 738 655, 734 505 '
              'C 728 330, 638 195, 512 150 Z')
    a.append(P(lining, pink, 12))
    a.append(f'<clipPath id="lin"><path d="{lining}"/></clipPath>')
    a.append(f'<g clip-path="url(#lin)" stroke="{cyan}" stroke-width="7" fill="none">')
    for row in range(10):
        y = 170 + row * 68
        off = 0 if row % 2 == 0 else 45
        for i in range(9):
            x = 260 + off + i * 90
            a.append(f'<path d="M {x} {y} A 45 45 0 0 0 {x + 90} {y}"/>')
    a.append('</g>')
    # white mask face
    a.append(P('M 512 230 C 380 250, 300 365, 306 515 '
               'C 310 645, 392 738, 512 760 '
               'C 632 738, 714 645, 718 515 '
               'C 724 365, 644 250, 512 230 Z', WHITE, 12))
    # sharp upswept eyes: pink-dominant rim over a thin ink edge
    left = 'M 486 590 Q 330 580 312 405 Q 466 428 486 590 Z'
    right = 'M 538 590 Q 694 580 712 405 Q 558 428 538 590 Z'
    for eye in (left, right):
        a.append(P(eye, 'none', 54, INK))
        a.append(P(eye, 'none', 36, pink))
        a.append(P(eye, WHITE))
    # tiny nose shadow
    a.append(P('M 502 655 Q 512 665 522 655', 'none', 8))
    # hood drape folds
    a.append(P('M 300 880 Q 400 930 512 938', 'none', 10))
    a.append(P('M 724 880 Q 624 930 512 938', 'none', 10))
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
    # angry mask brows angling down toward the nose
    a.append(P('M 308 424 L 488 466', 'none', 18, dd_dark))
    a.append(P('M 716 424 L 536 466', 'none', 18, dd_dark))
    # sharp angry eyes: ink almonds with white pupil glints
    a.append(P('M 326 464 C 356 440, 420 438, 474 474 '
               'C 482 508, 458 534, 412 536 C 368 532, 336 502, 326 464 Z', INK))
    a.append(P('M 698 464 C 668 440, 604 438, 550 474 '
               'C 542 508, 566 534, 612 536 C 656 532, 688 502, 698 464 Z', INK))
    a.append(E(438, 498, 13, 13, WHITE))
    a.append(E(586, 498, 13, 13, WHITE))
    # exposed jaw: wide skin band across the bottom of the circle
    a.append(P('M 340 700 C 400 660, 624 660, 684 700 L 684 940 L 340 940 Z', SKIN, 12))
    # gritted teeth + chin crease
    a.append(f'<rect x="436" y="762" width="152" height="48" rx="16" fill="{WHITE}" stroke="{INK}" stroke-width="10"/>')
    for x in (478, 512, 546):
        a.append(f'<line x1="{x}" y1="770" x2="{x}" y2="802" stroke="{INK}" stroke-width="7"/>')
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
    hair = '#3a2a18'
    steel = '#8d97a8'
    # face fills the whole badge (circle fill is skin)
    # big mushroom bowl cut spanning ring to ring
    a.append(P('M 112 560 C 100 280, 280 96, 512 96 C 744 96, 924 280, 912 560 '
               'C 884 440, 844 386, 812 370 C 822 440, 814 500, 798 545 '
               'C 782 440, 754 380, 730 360 L 294 360 C 270 380, 242 440, 226 545 '
               'C 210 500, 202 440, 212 370 C 180 386, 140 440, 112 560 Z', hair))
    # fused goggle visor: bridge + arms into the hair
    a.append(f'<rect x="464" y="524" width="96" height="30" rx="14" fill="{steel}" stroke="{INK}" stroke-width="9"/>')
    a.append(P('M 254 540 L 176 500', 'none', 13))
    a.append(P('M 770 540 L 848 500', 'none', 13))
    # big round lenses
    a.append(E(376, 548, 118, 118, steel, 14))
    a.append(E(648, 548, 118, 118, steel, 14))
    a.append(E(376, 548, 80, 80, '#d9822b', 11))
    a.append(E(648, 548, 80, 80, '#d9822b', 11))
    a.append(P('M 330 500 Q 366 478 402 490', 'none', 10, WHITE))
    a.append(P('M 602 500 Q 638 478 674 490', 'none', 10, WHITE))
    # nose hint + smug sneer
    a.append(P('M 512 660 Q 504 704 494 720', 'none', 9))
    a.append(P('M 402 780 C 444 808, 556 806, 600 766', 'none', 12))
    a.append(P('M 600 766 Q 620 776 618 796', 'none', 10))
    # green jumpsuit shoulders across the bottom of the badge
    a.append(P('M 232 1010 C 300 878, 400 838, 512 838 C 624 838, 724 878, 792 1010 Z',
               '#3e8f3a', 12))
    a.append(P('M 452 848 L 512 908 L 572 848', 'none', 10))
    return a


def ock_overlay():
    steel = '#8d97a8'
    parts = []
    def claw(cx, cy, ang):
        import math as m
        out = [f'<circle cx="{cx}" cy="{cy}" r="34" fill="{steel}" stroke="{INK}" stroke-width="10"/>']
        for d in (-52, 0, 52):
            t = m.radians(ang + d)
            x2, y2 = cx + 58 * m.cos(t), cy + 58 * m.sin(t)
            x1, y1 = cx + 20 * m.cos(m.radians(ang + d - 26)), cy + 20 * m.sin(m.radians(ang + d - 26))
            x3, y3 = cx + 20 * m.cos(m.radians(ang + d + 26)), cy + 20 * m.sin(m.radians(ang + d + 26))
            out.append(P(f'M {x1:.0f} {y1:.0f} L {x2:.0f} {y2:.0f} L {x3:.0f} {y3:.0f} Z', steel, 9))
        out.append(f'<circle cx="{cx}" cy="{cy}" r="12" fill="#d9822b" stroke="{INK}" stroke-width="7"/>')
        return out
    for sx in (1, -1):
        m_ = (lambda x: x) if sx == 1 else (lambda x: 1024 - x)
        # tall tentacle arcing over the shoulder to the upper corner
        parts.append(P(f'M {m_(230)} 840 C {m_(70)} 700, {m_(60)} 430, {m_(140)} 230 '
                       f'C {m_(150)} 206, {m_(184)} 210, {m_(186)} 240 '
                       f'C {m_(122)} 430, {m_(140)} 640, {m_(282)} 780 Z', '#8d97a8', 11))
        # lower tentacle: rooted behind the shoulder, reaching down and out
        parts.append(P(f'M {m_(258)} 806 C {m_(180)} 828, {m_(118)} 866, {m_(86)} 918 '
                       f'C {m_(72)} 944, {m_(98)} 968, {m_(122)} 950 '
                       f'C {m_(154)} 912, {m_(210)} 878, {m_(272)} 860 Z', '#8d97a8', 11))
        parts += claw(m_(162), 210, -95 if sx == 1 else -85)
        parts += claw(m_(98), 936, 142 if sx == 1 else 38)
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
    suit = '#1e1a29'
    red = '#c01a28'
    # black suit mask with fine dark-red webbing
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="{suit}"/>')
    a += web(512, 512, list(range(0, 361, 30)), R, [130, 260, 385], 6, color=red)
    # big Spider-Verse eyes: bold red rim, ink gap, white glass
    for sx, x0 in ((1, 348), (-1, 676)):
        a.append(f'<g transform="translate({x0},430) scale({sx * 0.98},0.98) rotate(-10)">')
        eye = ('M 0 200 C -78 172, -96 50, -88 -2 C -80 -72, 80 -72, 88 -2 '
               'C 96 50, 78 172, 0 200 Z')
        a.append(P(eye, 'none', 74, red))
        a.append(P(eye, WHITE, 30))
        a.append('</g>')
    return a


OVERLAYS = {'spider-ham': ham_overlay, 'daredevil': dd_overlay, 'spider-gwen': gwen_overlay,
            'doc-ock': ock_overlay, 'noir': noir_overlay, 'goblin': goblin_overlay}

CHARS = [
    ('venom',      '#6a2d9c', '#241e33', venom),
    ('doom',       '#16697a', '#0e3a2c', doom),
    ('spider-gwen','#a1237a', WHITE, gwen),
    ('spider-ham', '#e2a41f', RED, ham),
    ('fisk',       '#8f1d2c', '#f4f4f8', fisk),
    ('daredevil',  '#d2611f', '#3a3f4d', daredevil),
    ('doc-ock',    '#5a9e21', SKIN, ock),
    ('noir',       '#565d6d', '#2c2f38', noir),
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
