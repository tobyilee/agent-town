#!/usr/bin/env bash
# Regenerates the sprites with Codex headless image generation.
#
#   npm run sprites:codex             # everything
#   npm run sprites:codex -- office   # only one group: characters | fx | office
#
# Needs the Codex CLI (`npm i -g @openai/codex`) signed in, with image generation
# available to it. Extra flags for `codex exec` can be passed in CODEX_FLAGS, e.g.
#   CODEX_FLAGS="--full-auto -c some.feature=true" npm run sprites:codex
# Codex writes the raw images to sprites/raw/, then resizes and quantizes them to
# the exact grid in sprites/SPEC.md. Run `npm run sprites` to go back to placeholders.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v codex >/dev/null || { echo "codex CLI not found. Install it with: npm i -g @openai/codex"; exit 1; }
CODEX_FLAGS=${CODEX_FLAGS:---full-auto}
mkdir -p sprites/raw
ONLY=${1:-all}

run() {
  echo "▶ codex: $1"
  # shellcheck disable=SC2086
  codex exec $CODEX_FLAGS "$(cat <<PROMPT
You are generating game art for Agent Town, a Gather.town-style pixel office.
Read sprites/SPEC.md and client/office-map.js first; they are the source of truth for sizes and layout.

Task: $2

Steps:
1. Use your image generation tool to create the image(s) at a generous size. Save the raw outputs in sprites/raw/.
2. Post-process each raw image into the exact size in sprites/SPEC.md with a small Python script
   (Pillow; install it with pip if missing): crop to the art, resize with NEAREST to the exact grid,
   reduce to a limited palette (<= 32 colors), and keep the background transparent for characters and icons.
   Every frame must sit inside its own grid cell, feet at the bottom of the cell, character centered.
3. Write the results into client/assets/sprites/ with the file names from the spec, overwriting the placeholders.
4. Run: node scripts/check-sprites.js   and fix anything it reports.
5. Set "generator": "codex" in client/assets/sprites/manifest.json. Do not change any other file.
PROMPT
)"
}

if [[ $ONLY == all || $ONLY == characters ]]; then
  run characters "Create the eight character sheets char_0.png … char_7.png (4 columns × 7 rows of 32×32 frames). Generate one consistent cute chibi office worker design and vary hair and shirt colors per the spec (char_0–3 warm, char_4–7 cool). Walk cycles must loop smoothly."
fi
if [[ $ONLY == all || $ONLY == fx ]]; then
  run fx "Create fx.png: ten 16×16 status icons with two animation frames each, in the row order from the spec."
fi
if [[ $ONLY == all || $ONLY == office ]]; then
  run office "Create office.png (1088×768): the top-down office floor plan with every zone and piece of furniture placed on the tiles listed in client/office-map.js. Leave walkable floor where the map has no furniture."
fi
node scripts/check-sprites.js
