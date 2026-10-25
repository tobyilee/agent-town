"""Fits the raw Codex images in sprites/raw/ to the grid the client expects.

Reads sprites/assets.json, removes the magenta background, slices the sheets,
aligns every character frame (feet on one baseline, head on one center line),
and writes client/assets/sprites/ plus manifest.json. See sprites/SPEC.md.
Run through `npm run sprites:codex -- --fit`.
"""
import json
import os
import sys

import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
RAW = os.path.join(ROOT, 'sprites', 'raw')
OUT = os.path.join(ROOT, 'client', 'assets', 'sprites')
SCALE = 2          # sprite pixels per world pixel (sharp on retina screens)
TILE = 32 * SCALE  # one office tile in sprite pixels
FRAME = 128        # character frame: 64 x 64 world pixels
FIGURE_H = 116     # character height inside a frame
FEET_Y = 124       # baseline the feet stand on
FX = 64            # status icon cell
TEX_TILES = 4      # a floor texture covers 4 x 4 office tiles
ROWS = ['walk_down', 'walk_left', 'walk_right', 'walk_up', 'work_down', 'work_up', 'idle_down']


def key(img):
    """Magenta background -> transparency, with the magenta fringe removed from soft edges."""
    rgb = np.asarray(img.convert('RGB')).astype(np.float32)
    bg = np.array([255, 0, 255], np.float32)
    d = np.sqrt(((rgb - bg) ** 2).sum(axis=2))
    a = np.clip((d - 50) / 60, 0, 1)
    a[a < 0.08] = 0
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.clip((rgb - (1 - a[..., None]) * bg) / safe, 0, 255)
    # Opaque pixels next to the background still carry a purple tint from the
    # anti-aliased outline: pull red and blue back toward green there.
    clear = a < 0.5
    near = np.zeros_like(clear)
    for dy, dx in [(-2, 0), (2, 0), (0, -2), (0, 2), (-1, -1), (1, 1), (-1, 1), (1, -1)]:
        near |= np.roll(np.roll(clear, dy, axis=0), dx, axis=1)
    r, g, b = col[..., 0], col[..., 1], col[..., 2]
    spill = near & ~clear & (np.minimum(r, b) > g + 20)
    col[..., 0] = np.where(spill, g + (r - g) * 0.35, r)
    col[..., 2] = np.where(spill, g + (b - g) * 0.35, b)
    out = np.dstack([col, a * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def main_run(profile, gap=3):
    """The run of non-empty entries (allowing small gaps) that holds the most mass."""
    best, start, end, mass, empty = None, None, None, 0, 0
    for i, v in enumerate(list(profile) + [0] * (gap + 1)):
        if v > 0:
            start = i if start is None else start
            end, mass, empty = i, mass + v, 0
        elif start is not None:
            empty += 1
            if empty > gap:
                if best is None or mass > best[2]:
                    best = (start, end, mass)
                start, mass = None, 0
    return best


def bbox(img, min_count=3):
    """Bounding box of the main object, ignoring stray pixels and bits of neighbouring cells."""
    a = np.asarray(img)[..., 3] > 128
    rows = main_run(np.where(a.sum(axis=1) >= min_count, a.sum(axis=1), 0))
    if rows is None:
        return None
    band = a[rows[0]:rows[1] + 1]
    cols = main_run(np.where(band.sum(axis=0) >= min_count, band.sum(axis=0), 0))
    if cols is None:
        return None
    return cols[0], rows[0], cols[1] + 1, rows[1] + 1


def head_center(img, box):
    """Horizontal center of the top 35% of the figure: steadier than the bbox while legs swing."""
    x0, y0, x1, y1 = box
    a = np.asarray(img)[y0:y0 + max(1, int((y1 - y0) * 0.35)), x0:x1, 3].astype(np.float32)
    xs = a.sum(axis=0)
    return x0 + float((xs * np.arange(len(xs))).sum() / max(xs.sum(), 1))


def resize(img, w, h):
    # Premultiplied alpha, so edges do not pick up dark halos.
    return img.convert('RGBa').resize((max(1, round(w)), max(1, round(h))), Image.LANCZOS).convert('RGBA')


def cells(img, cols, rows):
    w, h = img.size
    return [[img.crop((round(c * w / cols), round(r * h / rows), round((c + 1) * w / cols), round((r + 1) * h / rows)))
             for c in range(cols)] for r in range(rows)]


def fit_character(name):
    sheet = key(Image.open(os.path.join(RAW, f'{name}.png')))
    grid = cells(sheet, 4, 4)
    boxes = [[bbox(c) for c in row] for row in grid]
    if any(b is None for row in boxes for b in row):
        raise ValueError(f'{name}: a cell of the 4x4 sheet is empty')
    # One scale for the whole sheet, from the front-facing frames.
    front_h = sorted(b[3] - b[1] for b in boxes[0] + boxes[3][:1])
    s = FIGURE_H / front_h[len(front_h) // 2]
    widest = max(b[2] - b[0] for row in boxes for b in row) * s
    tallest = max(b[3] - b[1] for row in boxes for b in row) * s
    s *= min(1, (FRAME - 4) / widest, (FEET_Y - 2) / tallest)

    def frame(r, c, dy=0, mirror=False):
        cell, box = grid[r][c], boxes[r][c]
        fig = resize(cell.crop(box), (box[2] - box[0]) * s, (box[3] - box[1]) * s)
        cx = (head_center(cell, box) - box[0]) * s
        out = Image.new('RGBA', (FRAME, FRAME))
        out.alpha_composite(fig, (round(FRAME / 2 - cx), FEET_Y - fig.size[1] + dy))
        return out.transpose(Image.FLIP_LEFT_RIGHT) if mirror else out

    rows = {
        'walk_down': [frame(0, c) for c in range(4)],
        'walk_left': [frame(1, c, mirror=True) for c in range(4)],
        'walk_right': [frame(1, c) for c in range(4)],
        'walk_up': [frame(2, c) for c in range(4)],
        'work_down': [frame(3, 1), frame(3, 2), frame(3, 1), frame(3, 2)],
        'work_up': [frame(2, 0), frame(2, 0, dy=2), frame(2, 0), frame(2, 0, dy=2)],
        'idle_down': [frame(3, 0), frame(3, 0, dy=1), frame(3, 0), frame(3, 3)],
    }
    out = Image.new('RGBA', (FRAME * 4, FRAME * len(ROWS)))
    for r, row in enumerate(ROWS):
        for c, f in enumerate(rows[row]):
            out.alpha_composite(f, (c * FRAME, r * FRAME))
    out.save(os.path.join(OUT, 'chars', f'{name}.png'), optimize=True)


def fit_fx(rows):
    grid = cells(key(Image.open(os.path.join(RAW, 'fx.png'))), 5, 2)
    out = Image.new('RGBA', (FX, FX * len(rows)))
    for i in range(len(rows)):
        cell = grid[i // 5][i % 5]
        box = bbox(cell)
        if box is None:
            raise ValueError(f'fx: icon {rows[i]} is empty')
        bw, bh = box[2] - box[0], box[3] - box[1]
        s = (FX - 6) / max(bw, bh)
        icon = resize(cell.crop(box), bw * s, bh * s)
        out.alpha_composite(icon, ((FX - icon.size[0]) // 2, i * FX + (FX - icon.size[1]) // 2))
    out.save(os.path.join(OUT, 'fx.png'), optimize=True)


def fit_texture(name):
    """Square floor texture covering TEX_TILES x TEX_TILES office tiles, made seamless.

    The image is blended with a copy of itself shifted by half its size; near the
    edges only the shifted copy shows, and its edges come from the middle of the
    original, so opposite edges match.
    """
    img = Image.open(os.path.join(RAW, f'tex_{name}.png')).convert('RGB')
    w, h = img.size
    m = min(w, h) * 0.86  # skip borders, where generators like to fade out
    img = img.crop(((w - m) / 2, (h - m) / 2, (w + m) / 2, (h + m) / 2))
    size = TEX_TILES * TILE
    a = np.asarray(img.resize((size, size), Image.LANCZOS)).astype(np.float32)
    b = np.roll(np.roll(a, size // 2, axis=0), size // 2, axis=1)
    ramp = np.clip(np.minimum(np.arange(size), size - 1 - np.arange(size)) / (size * 0.22), 0, 1)
    wgt = np.minimum.outer(ramp, ramp)[..., None]
    out = (a * wgt + b * (1 - wgt)).clip(0, 255).astype(np.uint8)
    Image.fromarray(out, 'RGB').save(os.path.join(OUT, 'textures', f'{name}.png'), optimize=True)
    return {'file': f'textures/{name}.png', 'size': size, 'tiles': TEX_TILES}


def fit_prop(name, p):
    img = key(Image.open(os.path.join(RAW, f'{name}.png')))
    box = bbox(img)
    if box is None:
        raise ValueError(f'{name}: nothing left after removing the background')
    bw, bh = box[2] - box[0], box[3] - box[1]
    s = min(p['size'][0] * TILE / bw, p['size'][1] * TILE / bh)
    out = resize(img.crop(box), bw * s, bh * s)
    out.save(os.path.join(OUT, 'props', f'{name}.png'), optimize=True)
    return {'file': f'props/{name}.png', 'w': out.size[0], 'h': out.size[1], 'flat': bool(p.get('flat'))}


def main():
    spec = json.load(open(os.path.join(ROOT, 'sprites', 'assets.json')))
    os.makedirs(os.path.join(OUT, 'chars'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'props'), exist_ok=True)
    os.makedirs(os.path.join(OUT, 'textures'), exist_ok=True)
    manifest = {
        'generator': 'codex',
        'scale': SCALE,
        'character': {'frame': FRAME, 'framesPerRow': 4, 'rows': ROWS, 'list': []},
        'fx': {'file': 'fx.png', 'size': FX, 'rows': spec['fx']['rows']},
        'textures': {},
        'props': {},
    }
    failed = []

    def step(label, fn, raw=None):
        if not os.path.exists(os.path.join(RAW, f'{raw or label}.png')):
            failed.append(f'{label} (no raw image)')
            return None
        try:
            r = fn()
            print(f'✓ {label}')
            return r
        except Exception as e:  # keep going so one bad image does not block the rest
            failed.append(f'{label} ({e})')
            return None

    for c in spec['character']['list']:
        step(c['file'], lambda c=c: fit_character(c['file']))
        manifest['character']['list'].append({'file': f"chars/{c['file']}.png", 'family': c['family']})
    step('fx', lambda: fit_fx(spec['fx']['rows']))
    for name in spec['texture']['list']:
        r = step(name, lambda name=name: fit_texture(name), raw=f'tex_{name}')
        if r:
            manifest['textures'][name] = r
    for name, p in spec['props'].items():
        r = step(name, lambda name=name, p=p: fit_prop(name, p))
        if r:
            manifest['props'][name] = r
        elif os.path.exists(os.path.join(OUT, 'props', f'{name}.png')):
            # Keep the previous fit of this prop.
            old = json.load(open(os.path.join(OUT, 'manifest.json'))).get('props', {}).get(name)
            if old:
                manifest['props'][name] = old

    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
        f.write('\n')
    if failed:
        print('✗ not fitted: ' + '; '.join(failed))
        sys.exit(1)


if __name__ == '__main__':
    main()
