// Shared office layout. Imported by the browser client (rendering, pathfinding,
// spot assignment) and by scripts/gen-placeholder-sprites.js (to paint office.png).
// All coordinates are in tiles; TILE pixels per tile.

export const TILE = 32;
export const COLS = 34;
export const ROWS = 24;

// Each zone hosts one or more activities. Spots are tile coordinates where a
// character stands (feet at the bottom-center of the tile) and the direction it faces.
export const ZONES = [
  {
    id: 'desks', label: 'Workstations', activities: ['editing', 'talking'],
    rect: [1, 3, 13, 8], floor: 'carpetBlue',
    spots: [[2, 4, 'down'], [6, 4, 'down'], [10, 4, 'down'], [2, 8, 'down'], [6, 8, 'down'], [10, 8, 'down'],
            [3, 4, 'down'], [7, 4, 'down'], [11, 4, 'down'], [3, 8, 'down'], [7, 8, 'down'], [11, 8, 'down']],
  },
  {
    id: 'library', label: 'Library', activities: ['reading', 'searching'],
    rect: [15, 3, 18, 8], floor: 'carpetGreen',
    spots: [[17, 5, 'up'], [20, 5, 'up'], [23, 5, 'up'], [26, 5, 'up'], [29, 5, 'up'],
            [18, 8, 'down'], [23, 8, 'down'], [28, 8, 'down'], [19, 8, 'down'], [24, 8, 'down'], [29, 8, 'down']],
  },
  {
    id: 'think', label: 'Think Tank', activities: ['thinking'],
    rect: [1, 12, 8, 11], floor: 'carpetPurple',
    spots: [[2, 15, 'up'], [4, 15, 'up'], [6, 15, 'up'], [2, 19, 'down'], [4, 19, 'down'], [6, 19, 'down'],
            [3, 21, 'up'], [5, 21, 'up'], [7, 21, 'up']],
  },
  {
    id: 'meeting', label: 'Meeting Room', activities: ['subagent'],
    rect: [10, 12, 10, 11], floor: 'carpetOrange',
    spots: [[12, 15, 'down'], [14, 15, 'down'], [16, 15, 'down'], [18, 15, 'down'],
            [12, 18, 'up'], [14, 18, 'up'], [16, 18, 'up'], [18, 18, 'up'],
            [11, 17, 'right'], [19, 17, 'left'], [13, 21, 'up'], [17, 21, 'up']],
  },
  {
    id: 'servers', label: 'Server Room', activities: ['running'],
    rect: [21, 12, 6, 5], floor: 'tileGray',
    spots: [[22, 15, 'up'], [24, 15, 'up'], [26, 15, 'up'], [23, 16, 'up'], [25, 16, 'up']],
  },
  {
    id: 'mcp', label: 'MCP Portal', activities: ['mcp'],
    rect: [21, 18, 6, 5], floor: 'tileTeal',
    spots: [[22, 21, 'up'], [24, 22, 'up'], [26, 21, 'up'], [22, 19, 'right'], [26, 19, 'left']],
  },
  {
    id: 'lounge', label: 'Lounge', activities: ['waiting', 'idle'],
    rect: [28, 12, 5, 11], floor: 'wood',
    spots: [[29, 15, 'down'], [31, 15, 'down'], [29, 18, 'down'], [31, 18, 'down'],
            [29, 20, 'down'], [31, 20, 'down'], [30, 22, 'up'], [32, 22, 'up']],
  },
];

// Furniture blocks movement, except seats (sofa, beanbag) which characters sit on. [type, x, y, w, h]
export const FURNITURE = [
  // Workstations
  ['desk', 2, 5, 2, 1], ['desk', 6, 5, 2, 1], ['desk', 10, 5, 2, 1],
  ['desk', 2, 9, 2, 1], ['desk', 6, 9, 2, 1], ['desk', 10, 9, 2, 1],
  ['plant', 13, 3, 1, 1],
  // Library
  ['shelf', 16, 2, 2, 2], ['shelf', 19, 2, 2, 2], ['shelf', 22, 2, 2, 2], ['shelf', 25, 2, 2, 2], ['shelf', 28, 2, 2, 2],
  ['table', 18, 9, 2, 1], ['table', 23, 9, 2, 1], ['table', 28, 9, 2, 1],
  ['plant', 32, 3, 1, 1],
  // Think tank
  ['whiteboard', 2, 12, 5, 2], ['beanbag', 2, 19, 1, 1], ['beanbag', 4, 19, 1, 1], ['beanbag', 6, 19, 1, 1],
  ['plant', 8, 12, 1, 1],
  // Meeting room
  ['meeting', 12, 16, 7, 2],
  // Servers
  ['server', 22, 12, 1, 2], ['server', 24, 12, 1, 2], ['server', 26, 12, 1, 2],
  // MCP portal
  ['portal', 23, 18, 3, 2],
  // Lounge
  ['coffee', 32, 12, 1, 2], ['sofa', 29, 15, 3, 1], ['sofa', 29, 18, 3, 1], ['plant', 28, 22, 1, 1],
];

// Where characters appear when a session starts (the front door).
export const DOOR = [16, 11];

export const SEATS = new Set(['sofa', 'beanbag']);
