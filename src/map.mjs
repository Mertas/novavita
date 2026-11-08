// Nova Vita — Quiet Dawn map generation.
// Deterministic: the same seed always produces the same town.
import {
  MAP_W, MAP_H, PRESET_BUILDINGS, PLOTS, BUILDINGS,
} from './constants.mjs';
import { clamp, mulberry32, isWalkable, tileAt } from './core.mjs';

const BUILDING_LABEL = {
  inn: 'inn',
};

/** Checks that a rectangle is free for construction. */
function rectFree(tiles, x, y, w, h) {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      const t = tiles[y + dy]?.[x + dx];
      if (t !== 'g' && t !== 'f' && t !== 'e') return false;
    }
  }
  return true;
}

function fillRect(tiles, x, y, w, h, ch) {
  for (let dy = 0; dy < h; dy += 1) {
    for (let dx = 0; dx < w; dx += 1) {
      if (tiles[y + dy] && tiles[y + dy][x + dx] !== undefined) tiles[y + dy][x + dx] = ch;
    }
  }
}

function addBuilding(tiles, def, index) {
  if (!rectFree(tiles, def.x, def.y, def.w, def.h)) {
    throw new Error(
      `Cannot place "${def.name}" (${def.x},${def.y} ${def.w}x${def.h}): tile is occupied`,
    );
  }
  fillRect(tiles, def.x, def.y, def.w, def.h, 'B');
  const blueprint = BUILDINGS[def.type];
  return {
    id: `b-${index}`,
    type: def.type,
    name: def.name,
    emoji: def.emoji || blueprint?.emoji || '🏠',
    label: def.label || BUILDING_LABEL[def.type] || blueprint?.label || 'building',
    desc: def.desc || blueprint?.desc || '',
    x: def.x,
    y: def.y,
    w: def.w,
    h: def.h,
    state: 'done',
    ownerId: null,
    founderId: null,
    contributors: {},
    delivered: {},
    required: {},
    coinsPaid: 0,
    progress: 1,
    builtDay: 0,
    level: 1,
  };
}

export function buildTown(seed = 20261107) {
  const rng = mulberry32(seed);
  const tiles = Array.from({ length: MAP_H }, () => Array(MAP_W).fill('g'));

  // Forest around the edges.
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const edge = x < 2 || x > MAP_W - 3 || y < 1 || y > MAP_H - 3;
      if (edge && rng() < 0.86) tiles[y][x] = 't';
    }
  }

  // Lake in the southeast.
  const lake = { cx: 28, cy: 16.6, rx: 3.6, ry: 2.9 };
  for (let y = 0; y < MAP_H; y += 1) {
    for (let x = 0; x < MAP_W; x += 1) {
      const nx = (x - lake.cx) / lake.rx;
      const ny = (y - lake.cy) / lake.ry;
      const r = nx * nx + ny * ny;
      if (r <= 1) tiles[y][x] = 'w';
      else if (r <= 1.55 && tiles[y][x] !== 't') tiles[y][x] = 's';
    }
  }

  // Roads: main east-west road and the central north-south road.
  for (let x = 2; x <= MAP_W - 3; x += 1) {
    if (tiles[10][x] !== 'w') tiles[10][x] = tiles[10][x] === 's' ? 's' : 'p';
  }
  for (let y = 2; y <= 17; y += 1) {
    if (tiles[y][14] !== 'w') tiles[y][14] = tiles[y][14] === 's' ? 's' : 'p';
  }

  // Town square.
  fillRect(tiles, 12, 8, 6, 5, 'P');

  // Fields.
  fillRect(tiles, 17, 14, 4, 3, 'F');

  // Preset buildings.
  const buildings = PRESET_BUILDINGS.map((def, i) => addBuilding(tiles, def, i));
  const plots = PLOTS.map((p) => ({ ...p, buildingId: null, ownerId: null, reserved: false }));

  // Decor: trees, bushes, flowers, rocks. Never on roads, square, fields,
  // buildings, plots, or their immediate surroundings.
  const reserved = new Set();
  const mark = (x, y, pad = 0) => {
    for (let dy = -pad; dy <= pad; dy += 1) {
      for (let dx = -pad; dx <= pad; dx += 1) {
        reserved.add(`${x + dx},${y + dy}`);
      }
    }
  };
  for (const b of buildings) {
    for (let dy = 0; dy < b.h; dy += 1) {
      for (let dx = 0; dx < b.w; dx += 1) mark(b.x + dx, b.y + dy, 1);
    }
  }
  for (const p of plots) {
    for (let dy = 0; dy < p.h; dy += 1) {
      for (let dx = 0; dx < p.w; dx += 1) mark(p.x + dx, p.y + dy, 0);
    }
  }
  for (let y = 8; y <= 12; y += 1) {
    for (let x = 12; x <= 17; x += 1) mark(x, y, 1);
  }

  const canDecorate = (x, y) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    if (reserved.has(`${x},${y}`)) return false;
    return tiles[y][x] === 'g';
  };

  // Groves: a few centres with trees around them.
  const groves = [
    { x: 5, y: 5 }, { x: 26, y: 7 }, { x: 6, y: 16 }, { x: 15, y: 3 },
    { x: 27, y: 17 }, { x: 3, y: 12 }, { x: 19, y: 18 }, { x: 23, y: 6 },
  ];
  for (const grove of groves) {
    const count = 4 + Math.floor(rng() * 5);
    for (let i = 0; i < count; i += 1) {
      const x = clamp(grove.x + Math.round((rng() * 2 - 1) * 3), 0, MAP_W - 1);
      const y = clamp(grove.y + Math.round((rng() * 2 - 1) * 2), 0, MAP_H - 1);
      if (canDecorate(x, y)) tiles[y][x] = 't';
    }
  }

  const scatter = (ch, count, pad = 0) => {
    for (let i = 0; i < count; i += 1) {
      const x = 2 + Math.floor(rng() * (MAP_W - 4));
      const y = 2 + Math.floor(rng() * (MAP_H - 4));
      if (canDecorate(x, y) && !reserved.has(`${x + pad},${y}`)) tiles[y][x] = ch;
    }
  };
  scatter('e', 18);
  scatter('f', 26);
  scatter('r', 8);

  // A meadow by the square so newcomers have a place to introduce themselves.
  for (let y = 12; y <= 13; y += 1) {
    for (let x = 12; x <= 16; x += 1) {
      if (tiles[y][x] === 'g') tiles[y][x] = 'f';
    }
  }

  // Keep the square and approaches walkable.
  for (let y = 8; y <= 12; y += 1) {
    for (let x = 12; x <= 17; x += 1) tiles[y][x] = 'P';
  }

  const spawn = { x: 14, y: 9 };
  if (!isWalkable({ tiles }, spawn.x, spawn.y)) {
    throw new Error('Spawn point is not walkable');
  }

  const features = [
    { id: 'f-well', kind: 'well', x: 13, y: 9, label: 'Well' },
    { id: 'f-board', kind: 'board', x: 16, y: 9, label: 'Notice board' },
    { id: 'f-sign', kind: 'sign', x: 12, y: 10, label: 'Signpost' },
  ];

  return { tiles, buildings, plots, features, spawn };
}

/** Walkability check — handy in tests. */
export function walkableAt(town, x, y) {
  return isWalkable({ tiles: town.tiles }, x, y);
}

export function tileLabel(town, x, y) {
  const t = tileAt({ tiles: town.tiles }, x, y);
  const names = {
    g: 'grass', f: 'flowering meadow', e: 'bush', t: 'forest', r: 'rocks',
    w: 'water', s: 'sand', p: 'road', P: 'town square', F: 'field', B: 'building', x: 'edge of the world',
  };
  return names[t] || 'ground';
}
