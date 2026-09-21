# -*- coding: utf-8 -*-
"""Each service's logo as a one-colour glyph: the mark itself, white, on nothing.

The logos under assets/svc are app icons - the mark on its own coloured tile. A row of tiles in eight
colours reads as noise; the same marks in one colour, without their tiles, read as a row of names. The
mark is lifted out of its tile by what sets it apart there: most are white on a colour (whiteness),
Netflix's N and Curiosity Stream's disc are a colour on black (saturation). Specks smaller than a
mark's detail are dropped, the glyph is trimmed to its own edges, and written white with the lifted
shape as its alpha - so CSS can use it as an image or as a mask."""
import os, sys
from collections import deque
from PIL import Image

SRC = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'app', 'src', 'main', 'assets', 'svc')
OUT = os.path.join(SRC, 'g')
MODE = {'nfx': 'sat', 'cts': 'sat', 'atp': 'white', 'dnp': 'white', 'amp': 'white', 'hbm': 'white', 'pmp': 'white'}
SCALE = 2                                           # lift at twice the size: smoother edges once trimmed


def lift(px, mode):
    r, g, b, a = px
    if a < 40:
        return 0
    if mode == 'white':                             # white on a colour
        v = (min(r, g, b) - 110) / 90
    else:                                           # a colour on black or white
        v = ((max(r, g, b) - min(r, g, b)) - 30) / 60
    return max(0.0, min(1.0, v)) * (a / 255)


def drop_specks(alpha, w, h, min_px):
    seen = [False] * (w * h)
    for start in range(w * h):
        if seen[start] or alpha[start] < 0.5:
            continue
        comp, q = [], deque([start])
        seen[start] = True
        while q:
            i = q.popleft()
            comp.append(i)
            x, y = i % w, i // w
            for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                if 0 <= nx < w and 0 <= ny < h:
                    j = ny * w + nx
                    if not seen[j] and alpha[j] >= 0.5:
                        seen[j] = True
                        q.append(j)
        if len(comp) < min_px:
            for i in comp:
                alpha[i] = 0.0
                x, y = i % w, i // w          # and the soft edge around it
                for dx in (-1, 0, 1):
                    for dy in (-1, 0, 1):
                        nx, ny = x + dx, y + dy
                        if 0 <= nx < w and 0 <= ny < h and alpha[ny * w + nx] < 0.5:
                            alpha[ny * w + nx] = 0.0


os.makedirs(OUT, exist_ok=True)
for sid, mode in MODE.items():
    im = Image.open(os.path.join(SRC, sid + '.png')).convert('RGBA')
    im = im.resize((im.width * SCALE, im.height * SCALE), Image.LANCZOS)
    w, h = im.size
    data = list(im.getdata())
    alpha = [lift(p, mode) for p in data]
    drop_specks(alpha, w, h, min_px=60 * SCALE * SCALE)
    mask = Image.new('L', (w, h))
    mask.putdata([int(round(v * 255)) for v in alpha])
    box = mask.point(lambda v: 255 if v > 24 else 0).getbbox()
    mask = mask.crop(box)
    glyph = Image.new('RGBA', mask.size, (255, 255, 255, 0))
    glyph.putalpha(mask)
    glyph.save(os.path.join(OUT, sid + '.png'), optimize=True)
    print(sid, mode, glyph.size, round(glyph.width / glyph.height, 3))

# a sheet to look at: every glyph on the page colour and on a light chip
if len(sys.argv) > 1:
    gs = [Image.open(os.path.join(OUT, s + '.png')) for s in MODE]
    H = 64
    gs = [g.resize((max(1, round(g.width * H / g.height)), H), Image.LANCZOS) for g in gs]
    W = sum(g.width for g in gs) + 40 * (len(gs) + 1)
    sheet = Image.new('RGBA', (W, H * 2 + 60), (5, 10, 22, 255))
    sheet.paste(Image.new('RGBA', (W, H + 30), (233, 240, 255, 255)), (0, H + 30))
    x = 40
    for g in gs:
        sheet.paste(g, (x, 15), g)
        sheet.paste(Image.new('RGBA', g.size, (5, 10, 22, 255)), (x, H + 45), g)
        x += g.width + 40
    sheet.save(sys.argv[1])
