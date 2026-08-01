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


def scaffold(bg, face_fill, inner, overlay=None, badge=True):
    """Background + corner webs + ringed circle containing `inner` art.
    `overlay` parts render after the ring and may overflow the circle."""
    svg = ['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">']
    svg.append(f'<rect x="0" y="0" width="1024" height="1024" fill="{bg}"/>')
    svg += web(-14, -14, list(range(0, 91, 15)), 900, [130, 260, 390, 520, 650], 9, 0.55)
    svg += web(1038, 1038, list(range(180, 271, 15)), 900, [130, 260, 390, 520, 650], 9, 0.55)
    if badge:
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
    gdark = '#37903c'
    steel = '#e2e7ef'
    sdark = '#9aa6b8'
    bright = '#f4f7fa'
    a = []
    # (circle fill is the green hood back)
    # black hood-opening shadow behind the face
    a.append(P('M 512 190 C 400 210, 318 300, 300 450 '
               'C 285 590, 320 740, 420 850 C 470 900, 554 900, 604 850 '
               'C 704 740, 739 590, 724 450 C 706 300, 624 210, 512 190 Z', INK))
    # the mask, drawn big in the middle
    a.append(P('M 512 255 C 420 260, 348 320, 338 440 '
               'C 328 570, 360 700, 436 800 C 472 844, 552 844, 588 800 '
               'C 664 700, 696 570, 686 440 C 676 320, 604 260, 512 255 Z', steel, 11))
    # forehead rivets
    for x, y in [(436, 330), (512, 308), (588, 330)]:
        a.append(E(x, y, 8, 8, bright, 5))
    # bright angled brow plates dipping to the nose
    a.append(P('M 336 560 L 336 480 L 492 445 L 502 525 L 420 545 Z', bright, 10))
    a.append(P('M 688 560 L 688 480 L 532 445 L 522 525 L 604 545 Z', bright, 10))
    for x, y in [(372, 522), (412, 508), (452, 494), (652, 522), (612, 508), (572, 494)]:
        a.append(E(x, y, 7, 7, bright, 5))
    # dark angular eyes
    a.append(P('M 386 578 L 468 560 L 462 624 L 398 627 Z', INK))
    a.append(P('M 638 578 L 556 560 L 562 624 L 626 627 Z', INK))
    # nose ridge widening downward
    a.append(P('M 494 472 L 530 472 L 548 675 L 476 675 Z', steel, 9))
    a.append(P('M 512 488 L 512 662', 'none', 6, sdark))
    # mouth: lip plate, grille, chin plate
    a.append(f'<rect x="424" y="680" width="176" height="32" rx="9" fill="{steel}" stroke="{INK}" stroke-width="9"/>')
    a.append(f'<rect x="420" y="710" width="184" height="64" rx="15" fill="{INK}"/>')
    a.append(f'<rect x="468" y="726" width="88" height="30" rx="7" fill="{sdark}" stroke="{INK}" stroke-width="6"/>')
    a.append(P('M 428 772 C 428 830, 464 856, 512 860 C 560 856, 596 830, 596 772 Z', steel, 9))
    for x, y in [(464, 804), (512, 818), (560, 804)]:
        a.append(E(x, y, 7, 7, bright, 5))
    a.append(E(512, 848, 24, 12, INK))
    # hood drawn OVER the face in parts: left and right front flaps
    # crossing the mask's upper corners, leaving black at the peak
    a.append(P('M 486 205 C 420 250, 360 340, 332 450 '
               'C 316 520, 306 580, 302 645 '
               'C 250 610, 205 560, 165 495 '
               'C 180 340, 260 215, 380 148 C 428 128, 464 158, 486 205 Z', '#4fae4a', 12))
    a.append(P('M 538 205 C 604 250, 664 340, 692 450 '
               'C 708 520, 718 580, 722 645 '
               'C 774 610, 819 560, 859 495 '
               'C 844 340, 764 215, 644 148 C 596 128, 560 158, 538 205 Z', '#4fae4a', 12))
    # bottom drape wrapping under the chin
    a.append(P('M 160 930 C 330 842, 694 842, 864 930 L 920 1040 L 110 1040 Z', '#4fae4a', 12))
    # fold creases in the fabric
    a.append(P('M 250 700 C 270 760, 300 820, 345 870', 'none', 9))
    a.append(P('M 774 700 C 754 760, 724 820, 679 870', 'none', 9))
    return a


# ---------------------------------------------------------------- Venom
def venom():
    a = []
    maw = '#3a0d16'
    # round grey symbiote head fills the circle
    a.append(f'<circle cx="512" cy="512" r="{R:.0f}" fill="#5c5c64"/>')
    # big check-mark eyes, notched, nearly meeting at the top
    a.append(P('M 496 252 '
               'C 424 226, 336 252, 274 330 '
               'C 242 386, 234 452, 252 506 '
               'C 300 548, 352 566, 396 564 '
               'L 432 430 L 476 530 '
               'C 496 432, 492 326, 496 252 Z', WHITE, 13))
    a.append(P('M 528 252 '
               'C 600 226, 688 252, 750 330 '
               'C 782 386, 790 452, 772 506 '
               'C 724 548, 672 566, 628 564 '
               'L 592 430 L 548 530 '
               'C 528 432, 532 326, 528 252 Z', WHITE, 13))
    # huge maw spanning the head, slight dip at the centre of the lip
    a.append(P('M 218 618 C 340 585, 450 602, 512 612 '
               'C 574 602, 684 585, 806 618 '
               'C 768 798, 650 888, 512 888 C 374 888, 256 798, 218 618 Z', maw, 14))
    # top row of big fangs
    for i in range(8):
        x0 = 240 + i * 68
        a.append(P(f'M {x0} {608 + (i%2)*6} L {x0+34} {718 + (i%2)*10} L {x0+68} {606 + (i%2)*6} Z',
                   WHITE, 8))
    # bottom row rising from the jaw
    for i in range(6):
        x0 = 326 + i * 62
        a.append(P(f'M {x0} {872 - (i%2)*4} L {x0+31} {788 - (i%2)*8} L {x0+62} {874 - (i%2)*4} Z',
                   WHITE, 8))
    return a


def venom_overlay():
    # fat tongue lolling out and curling past the badge ring
    return [
        P('M 420 812 '
          'C 398 902, 438 1002, 540 1032 '
          'C 622 1054, 684 1012, 670 950 '
          'C 702 968, 724 936, 708 902 '
          'C 680 848, 618 820, 568 814 Z', '#d3557a', 12),
        P('M 498 862 C 548 922, 600 972, 658 988', 'none', 9),
    ]


# ---------------------------------------------------------------- Spider-Gwen
def gwen():
    pink = '#e83a8c'
    cyan = '#3fb9e6'
    a = ['<g transform="translate(66.6,56.3) scale(0.87)">']
    hood = ('M 470 148 '
            'C 430 168, 340 224, 262 312 '
            'C 172 422, 112 560, 98 706 '
            'C 90 822, 100 940, 122 1060 '
            'L 936 1060 '
            'C 962 920, 972 800, 956 664 '
            'C 934 480, 848 302, 700 212 '
            'C 628 158, 528 150, 470 148 Z')
    a.append(P(hood, WHITE, 26))
    edge_top = ('M 302 430 C 350 350, 430 315, 512 310 C 594 315, 674 350, 722 430')
    opening = (edge_top +
               ' C 740 560, 738 700, 724 830 '
               'C 708 908, 680 962, 646 1002 '
               'L 378 1002 '
               'C 344 962, 316 908, 300 830 '
               'C 286 700, 284 560, 302 430 Z')
    a.append(P(opening, pink, 14))
    a.append(f'<clipPath id="lin"><path d="{opening}"/></clipPath>')
    a.append(f'<g clip-path="url(#lin)" stroke="{cyan}" stroke-width="7" fill="none">')
    for row in range(12):
        y = 330 + row * 64
        off = 0 if row % 2 == 0 else 44
        for i in range(10):
            x = 250 + off + i * 88
            a.append(f'<path d="M {x} {y} A 44 44 0 0 0 {x + 88} {y}"/>')
    a.append('</g>')
    a.append(P('M 150 1060 '
               'C 250 924, 380 894, 446 886 '
               'C 458 862, 462 830, 464 800 '
               'L 562 800 '
               'C 564 830, 568 862, 580 886 '
               'C 646 894, 774 924, 874 1060 Z', WHITE, 12))
    a.append(P('M 512 276 '
               'C 400 278, 310 350, 292 470 '
               'C 276 580, 300 680, 356 760 '
               'C 400 818, 460 838, 512 840 '
               'C 564 838, 624 818, 668 760 '
               'C 724 680, 748 580, 732 470 '
               'C 714 350, 624 278, 512 276 Z', WHITE, 12))
    left = 'M 478 575 Q 344 582 330 445 Q 432 464 478 575 Z'
    right = 'M 546 575 Q 680 582 694 445 Q 592 464 546 575 Z'
    for eye in (left, right):
        a.append(P(eye, 'none', 44, INK))
        a.append(P(eye, 'none', 30, pink))
        a.append(P(eye, WHITE))
    a.append(P('M 493 660 Q 512 682 531 660 Q 512 670 493 660 Z', '#c8dcec'))
    a.append(f'<clipPath id="hoodclip"><path d="{hood}"/></clipPath>')
    a.append(f'<g clip-path="url(#hoodclip)">')
    a.append(P(edge_top + ' L 980 430 L 980 10 L 44 10 L 44 430 Z', WHITE))
    a.append('</g>')
    a.append(P(edge_top, 'none', 14))
    a.append(P(hood, 'none', 26))
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
    # massive bald head fills the badge
    a.append(P('M 512 128 C 330 128, 218 262, 224 452 '
               'C 228 624, 300 764, 512 786 '
               'C 724 764, 796 624, 800 452 '
               'C 806 262, 694 128, 512 128 Z', SKIN, 12))
    # ears at the ring edges
    a.append(E(196, 480, 34, 58, SKIN, 10))
    a.append(E(828, 480, 34, 58, SKIN, 10))
    # heavy scowl brows
    a.append(P('M 296 420 L 470 448 L 464 494 L 302 470 Z', INK))
    a.append(P('M 728 420 L 554 448 L 560 494 L 722 470 Z', INK))
    # small hard eyes
    a.append(E(392, 528, 38, 21, WHITE, 9))
    a.append(E(632, 528, 38, 21, WHITE, 9))
    a.append(E(392, 528, 11, 11, INK))
    a.append(E(632, 528, 11, 11, INK))
    # broad nose + deep frown
    a.append(P('M 512 510 Q 494 606 468 642 Q 512 664 560 642', 'none', 11))
    a.append(P('M 398 726 Q 512 672 626 726', 'none', 14))
    # jaw creases
    a.append(P('M 318 606 Q 330 690 386 742', 'none', 8))
    a.append(P('M 706 606 Q 694 690 638 742', 'none', 8))
    # white suit shoulders + cravat with pin
    a.append(P('M 160 1000 C 268 828, 386 782, 512 782 '
               'C 638 782, 756 828, 864 1000 Z', suit, 12))
    a.append(P('M 436 790 C 464 848, 560 848, 588 790 L 588 940 '
               'C 536 976, 488 976, 436 940 Z', cravat, 10))
    a.append(E(512, 884, 15, 15, GOLD, 6))
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


OVERLAYS = {'spider-ham': ham_overlay, 'daredevil': dd_overlay, 'venom': venom_overlay, 
            'noir': noir_overlay, 'goblin': goblin_overlay}

CHARS = [
    ('venom',      '#6a2d9c', '#241e33', venom),
    ('doom',       '#16697a', '#4fae4a', doom),
    ('spider-gwen','#a1237a', '#701850', gwen),
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
    svg = scaffold(bg, fill, fn(), ov() if ov else None, badge=True)
    with open(f'faces/{name}.svg', 'w') as f:
        f.write(svg + '\n')
    print('wrote', name)
