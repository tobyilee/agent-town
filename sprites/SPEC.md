# Sprite spec

The art lives in `client/assets/sprites/` and is described by `manifest.json`.
It is drawn by **Codex headless image generation** and fitted to a fixed grid:

1. `sprites/assets.json` lists every image: the shared style, one look per
   character, the status icon sheet, and one prompt plus a size box per prop.
2. `npm run sprites:codex` sends the prompts to `codex exec` (several workers in
   parallel). Codex saves each raw image to `sprites/raw/<name>.png`, on a flat
   magenta `#FF00FF` background. Images that already exist are skipped, so a
   rerun only draws what is missing. Name images to redraw them:
   `npm run sprites:codex -- desk char_3`, or pass `--all`.
3. `scripts/fit-sprites.py` (Pillow + numpy in `sprites/.venv`) removes the
   magenta, slices the sheets, aligns the frames and writes the files below plus
   `manifest.json`. Run it alone with `npm run sprites:fit`.
4. `npm run sprites:check` verifies every file has the size the manifest says,
   and that every prop in `client/office-map.js` has art.

Sprites are stored at 2× (`"scale": 2` in the manifest): 2 sprite pixels per
world pixel, so they stay sharp on retina screens and when zoomed in.

Style: cute 2D virtual-office art like Gather.town and ZEP: top-down 3/4 view,
chibi characters with big heads, clean rounded shapes, soft cel shading, thin
dark outline, warm palette.

## Characters: `chars/char_0.png` … `chars/char_7.png` (512 × 896)

A 4 × 7 grid of 128 × 128 frames (64 × 64 world px). Feet stand on y = 124,
the head is centered horizontally. Codex draws a 4 × 4 sheet (front walk, side
walk, back walk, then idle / typing A / typing B / asleep); the fitter builds:

| Row | Name         | Frames                                               |
|-----|--------------|------------------------------------------------------|
| 0   | `walk_down`  | 4-step walk cycle facing the viewer                  |
| 1   | `walk_left`  | the side walk, mirrored                              |
| 2   | `walk_right` | 4-step walk cycle facing right                       |
| 3   | `walk_up`    | 4-step walk cycle, back to the viewer                |
| 4   | `work_down`  | typing, facing the viewer (two poses, alternating)   |
| 5   | `work_up`    | back to the viewer, small bob                        |
| 6   | `idle_down`  | frames 0–2 breathing idle; frame 3 asleep            |

`char_0`–`char_3` are Claude Code agents (warm colors), `char_4`–`char_7` are
Codex agents (cool colors).

## Status icons: `fx.png` (64 × 640)

One column of ten 64 × 64 icons, drawn in a white speech bubble above a
character's head. Rows: `thinking`, `talking`, `reading`, `editing`,
`searching`, `running`, `mcp`, `subagent`, `waiting`, `idle`.

## Floor textures: `textures/<name>.png` (256 × 256)

One square texture per floor type, covering 4 × 4 office tiles. The fitter crops
the middle of the raw image and blends it with a half-shifted copy of itself so it
tiles without seams. `client/floor.js` fills each room with its texture and a soft
white wash. The tiled floor (`tileTeal`) is painted in code.

## Props: `props/<name>.png`

One trimmed image per prop type, scaled to fit the size box (in tiles) given in
`sprites/assets.json`. The client draws each prop centered on its footprint in
`client/office-map.js`, standing on the footprint's bottom edge, depth-sorted
with the characters. Flat props (`window`, `clock`, `painting`) are painted
onto the wall instead. Walls, rugs and the garden path are painted in code
(`client/floor.js`), not drawn by Codex.
