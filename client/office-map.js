// Shared office layout. Imported by the browser client (floor painting,
// pathfinding, spot assignment) and by the tests that check every spot is reachable.
// All coordinates are in tiles; TILE world pixels per tile.
//
// The layout follows how agents really work (measured on real Claude Code and
// Codex logs): most time goes to thinking, and the most common moves are
// Think Tank <-> Server Room, Library and Workstations. So the Think Tank is
// the big room in the middle, and those rooms open onto the corridor right
// above it. MCP calls and reading are rare and short, so their rooms are smaller.

export const TILE = 32;
export const COLS = 40;
export const ROWS = 27;

// The building: everything outside it is garden. The top wall is two tiles tall.
export const BUILDING = { x: 2, y: 3, w: 36, h: 22 };
export const DOOR_GAP = [19, 20]; // front door columns in the bottom wall
// Where characters appear when a session starts, outside the front door.
export const DOOR = [19, 26];

// Interior walls, one tile thick. Horizontal walls show their face to the room
// below them; vertical walls are seen from above. [x1, y1, x2, y2] inclusive.
export const WALLS = [
  [3, 11, 36, 11],  // north rooms | corridor
  [3, 14, 36, 14],  // corridor | middle rooms
  [13, 5, 13, 10], [21, 5, 21, 10], [30, 5, 30, 10],
  [11, 15, 11, 23], [29, 15, 29, 23],
];
// Openings in those walls, as [x, y] tiles.
export const DOORS = [
  ...[11, 12, 16, 17, 25, 26, 33, 34].map((x) => [x, 11]),
  ...[4, 5, 13, 14, 15, 22, 23, 24, 31, 32].map((x) => [x, 14]),
  [13, 7], [13, 8], [21, 6], [21, 7], [30, 6], [30, 7],
  [11, 18], [11, 19], [29, 19], [29, 20],
];

// Each zone hosts one or more activities. Spots are tile coordinates where a
// character stands (feet at the bottom-center of the tile) and the direction it faces.
export const ZONES = [
  {
    id: 'desks', label: 'Workstations', activities: ['editing', 'talking'],
    rect: [3, 5, 10, 6], floor: 'carpetBlue',
    spots: [3, 6, 9].flatMap((x) => [6, 9].flatMap((y) => [[x, y, 'down'], [x + 1, y, 'down']])),
  },
  {
    id: 'library', label: 'Library', activities: ['reading', 'searching'],
    rect: [14, 5, 7, 6], floor: 'carpetGreen',
    spots: [...[14, 15, 16, 17, 18, 19].map((x) => [x, 6, 'up']), [16, 8, 'down'], [16, 10, 'up']],
  },
  {
    id: 'servers', label: 'Server Room', activities: ['running'],
    rect: [22, 5, 8, 6], floor: 'concrete',
    spots: [22, 24, 26, 28].flatMap((x) => [[x, 6, 'up'], [x, 9, 'up']]),
  },
  {
    id: 'mcp', label: 'MCP Portal', activities: ['mcp'],
    rect: [31, 5, 6, 6], floor: 'tileTeal',
    spots: [[32, 7, 'right'], [32, 8, 'right'], [36, 7, 'left'], [36, 8, 'left'], [33, 9, 'up'], [35, 9, 'up']],
  },
  {
    id: 'meeting', label: 'Meeting Room', activities: ['subagent'],
    rect: [3, 15, 8, 9], floor: 'carpetOrange',
    spots: [
      [4, 17, 'down'], [6, 17, 'down'], [8, 17, 'down'],
      [5, 20, 'up'], [7, 20, 'up'], [9, 20, 'up'],
      [3, 18, 'right'], [3, 19, 'right'], [10, 18, 'left'], [10, 19, 'left'],
    ],
  },
  {
    id: 'think', label: 'Think Tank', activities: ['thinking'],
    rect: [12, 15, 17, 9], floor: 'carpetPurple',
    spots: [
      // at the whiteboards
      [16, 16, 'up'], [18, 16, 'up'], [25, 16, 'up'], [27, 16, 'up'],
      // beanbag circle
      ...[13, 15, 17].flatMap((x) => [[x, 19, 'down'], [x, 22, 'down']]),
      // the sofa corner and the people standing at its coffee tables
      ...[22, 23, 24, 25, 26, 27].map((x) => [x, 18, 'down']),
      [22, 21, 'up'], [24, 21, 'up'], [25, 21, 'up'], [27, 21, 'up'],
      // armchairs and a few standing spots
      [28, 17, 'down'], [28, 22, 'down'], [20, 17, 'down'], [21, 21, 'down'],
    ],
  },
  {
    id: 'lounge', label: 'Lounge', activities: ['waiting', 'idle'],
    rect: [30, 15, 7, 9], floor: 'woodWarm',
    spots: [
      [34, 16, 'up'], [35, 16, 'up'],
      ...[31, 32, 33].flatMap((x) => [[x, 18, 'down'], [x, 22, 'down']]),
      [35, 18, 'down'], [35, 20, 'down'], [35, 22, 'down'],
    ],
  },
];

// Floor outside zones but inside the building (the corridor).
export const HALL_FLOOR = 'herringbone';

// Props drawn from client/assets/sprites/props/<type>.png. [type, x, y, w, h]
// is the footprint in tiles. The art is drawn centered on the footprint and
// standing on its bottom edge. Footprints block walking, except for the types below.
export const SEATS = new Set(['sofa', 'beanbag', 'armchair']);         // characters sit on them
export const FLAT = new Set(['rug', 'rugRound', 'window', 'painting', 'clock', 'pathStone']); // painted with the floor

export const FURNITURE = [
  // Building wall: windows and wall art
  ['window', 4, 3, 2, 2], ['window', 8, 3, 2, 2], ['clock', 12, 3, 1, 2], ['painting', 20, 3, 1, 2],
  ['window', 33, 3, 2, 2],
  // Art on the interior walls
  ...[[7, 11], [19, 11], [35, 11], [20, 14]].map(([x, y]) => ['painting', x, y, 1, 1]),
  ['clock', 28, 11, 1, 1], ['clock', 9, 14, 1, 1], ['clock', 35, 14, 1, 1],

  // Workstations
  ...[3, 6, 9].flatMap((x) => [7, 10].map((y) => ['desk', x, y, 2, 1])),
  ['waterCooler', 11, 5, 1, 1], ['plant', 12, 5, 1, 1],

  // Library
  ...[14, 16, 18].map((x) => ['shelf', x, 5, 2, 1]),
  ['readingTable', 15, 9, 3, 1], ['plant', 20, 10, 1, 1], ['floorLamp', 14, 10, 1, 1],

  // Server room
  ...[22, 24, 26, 28].flatMap((x) => [['server', x, 5, 1, 1], ['server', x, 8, 1, 1]]),
  ['plant', 29, 10, 1, 1],

  // MCP portal
  ['portal', 33, 7, 3, 2], ['crystal', 31, 5, 1, 1], ['crystal', 36, 5, 1, 1], ['crystal', 31, 10, 1, 1], ['plant', 36, 10, 1, 1],

  // Meeting room
  ['meetingTable', 4, 18, 6, 2], ['tv', 6, 15, 3, 1], ['plant', 3, 23, 1, 1], ['plant', 10, 23, 1, 1],

  // Think tank
  ['whiteboard', 16, 15, 3, 1], ['whiteboard', 25, 15, 3, 1],
  ['rugRound', 12, 18, 7, 6],
  ...[13, 15, 17].flatMap((x) => [['beanbag', x, 19, 1, 1], ['beanbag', x, 22, 1, 1]]),
  ['rug', 21, 17, 8, 5],
  ['sofa', 22, 18, 3, 1], ['sofa', 25, 18, 3, 1], ['coffeeTable', 22, 20, 3, 1], ['coffeeTable', 25, 20, 3, 1],
  ['armchair', 28, 17, 1, 1], ['armchair', 28, 22, 1, 1],
  ['plant', 12, 15, 1, 1], ['plant', 21, 15, 1, 1], ['plant', 12, 23, 1, 1], ['plant', 28, 15, 1, 1],

  // Lounge
  ['coffeeBar', 34, 15, 2, 1], ['vending', 36, 15, 1, 1],
  ['rug', 30, 17, 5, 7],
  ['sofa', 31, 18, 3, 1], ['coffeeTable', 31, 20, 3, 1], ['sofa', 31, 22, 3, 1],
  ['armchair', 35, 18, 1, 1], ['armchair', 35, 20, 1, 1], ['armchair', 35, 22, 1, 1],
  ['plant', 30, 15, 1, 1], ['floorLamp', 36, 23, 1, 1],

  // Corridor
  ['plant', 3, 12, 1, 1], ['plant', 36, 12, 1, 1],

  // Garden (outside the building)
  ['pathStone', 19, 25, 2, 2],
  ...[3, 8, 13, 24, 29, 34].map((x) => ['tree', x, 0, 2, 2]),
  ...[0, 38].flatMap((x) => [7, 13, 19].map((y) => ['tree', x, y, 2, 2])),
  ...[4, 8, 12, 25, 29, 33].map((x) => ['bush', x, 25, 2, 1]),
  ['flowers', 16, 25, 2, 1], ['flowers', 22, 25, 2, 1],
];

const doorSet = new Set(DOORS.map(([x, y]) => `${x},${y}`));
const wallSet = new Set();
for (const [x1, y1, x2, y2] of WALLS) {
  for (let y = y1; y <= y2; y++) for (let x = x1; x <= x2; x++) if (!doorSet.has(`${x},${y}`)) wallSet.add(`${x},${y}`);
}

export function isBuildingWall(x, y) {
  const { x: bx, y: by, w, h } = BUILDING;
  const inside = x >= bx && x < bx + w && y >= by && y < by + h;
  if (!inside) return false;
  if (y < by + 2) return true; // top wall, two tiles tall
  if (y === by + h - 1) return !DOOR_GAP.includes(x);
  return x === bx || x === bx + w - 1;
}

export function isInteriorWall(x, y) {
  return wallSet.has(`${x},${y}`);
}

export function isDoor(x, y) {
  return doorSet.has(`${x},${y}`);
}

export function isWall(x, y) {
  return isBuildingWall(x, y) || isInteriorWall(x, y);
}

export function zoneAt(x, y) {
  return ZONES.find(({ rect: [zx, zy, zw, zh] }) => x >= zx && x < zx + zw && y >= zy && y < zy + zh) || null;
}

// Walkable grid shared by pathfinding and the tests: walls and solid furniture block.
export function buildBlocked() {
  const blocked = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => isWall(x, y)));
  for (const [type, x, y, w, h] of FURNITURE) {
    if (SEATS.has(type) || FLAT.has(type)) continue;
    for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) if (blocked[j]?.[i] !== undefined) blocked[j][i] = true;
  }
  return blocked;
}
