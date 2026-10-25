# Sprite spec

Every sprite lives in `client/assets/sprites/` and is described by `manifest.json`.
The placeholder generator (`npm run sprites`) and the Codex generator
(`npm run sprites:codex`) must both produce files that match this spec exactly,
because the client slices them on a fixed grid. `npm run sprites:check` verifies sizes.

Style: cute chibi pixel art, top-down 3/4 view like Gather.town, 1px dark outline
(`#2b2135`), soft pastel palette, transparent background (except `office.png`).

## Characters: `char_0.png` … `char_7.png` (128 × 224)

A 4 × 7 grid of 32 × 32 frames. Feet touch the bottom of each frame (y ≈ 30),
character centered horizontally. Rows, top to bottom:

| Row | Name         | Frames                                              |
|-----|--------------|-----------------------------------------------------|
| 0   | `walk_down`  | 4-step walk cycle facing the viewer                 |
| 1   | `walk_left`  | 4-step walk cycle facing left                       |
| 2   | `walk_right` | 4-step walk cycle facing right                      |
| 3   | `walk_up`    | 4-step walk cycle, back to the viewer               |
| 4   | `work_down`  | typing at a desk, facing the viewer (arms moving)   |
| 5   | `work_up`    | working at a shelf or rack, back to the viewer      |
| 6   | `idle_down`  | breathing idle; frame 3 has eyes closed (sleeping)  |

`char_0`–`char_3` are used for Claude Code agents (warm colors: orange, amber, coral, pink shirts).
`char_4`–`char_7` are used for Codex agents (cool colors: blue, teal, violet, cyan shirts).

## Status icons: `fx.png` (32 × 160)

A 2 × 10 grid of 16 × 16 icons, two animation frames per row, shown above a
character's head. Rows: `thinking` (thought cloud), `talking` (speech bubble),
`reading` (open book), `editing` (pencil), `searching` (magnifier), `running`
(terminal `>_`), `mcp` (lightning bolt / plug), `subagent` (two small people),
`waiting` (steaming coffee), `idle` (Zz).

## Office: `office.png` (1088 × 768)

The whole office floor plan on a 34 × 24 grid of 32 px tiles, drawn to match the
zones and furniture in `client/office-map.js` (furniture positions must line up
with the tiles listed there, because characters stand at fixed spots next to them):

- Top two rows: wall with windows.
- Workstations (tiles 1–13, 3–10): six desks with monitors.
- Library (15–32, 3–10): bookshelves along the wall, three reading tables.
- Think Tank (1–8, 12–22): whiteboard, beanbags.
- Meeting Room (10–19, 12–22): one long table.
- Server Room (21–26, 12–16): three server racks.
- MCP Portal (21–26, 18–22): a glowing round portal machine.
- Lounge (28–32, 12–22): coffee machine, two sofas.
