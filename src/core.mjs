// Nova Vita — low-level utilities: randomness, ids, time, geometry, pathfinding,
// market formulas, inventory helpers.
import { createHash, randomBytes } from 'node:crypto';
import {
  ITEMS, MAP_H, MAP_W, TICKS_PER_DAY, TICKS_PER_HOUR,
  DAYS_PER_SEASON, SEASONS, phaseForHour, WEATHER,
} from './constants.mjs';

// ---------------------------------------------------------------------------
// Randomness (deterministic, so a seed reproduces the town)
// ---------------------------------------------------------------------------

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
export const round1 = (v) => Math.round(v * 10) / 10;

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length) % arr.length];
}

export function pickWeighted(rng, entries) {
  // entries: [[value, weight], ...]
  const total = entries.reduce((s, e) => s + e[1], 0);
  let r = rng() * total;
  for (const [value, weight] of entries) {
    r -= weight;
    if (r <= 0) return value;
  }
  return entries[entries.length - 1][0];
}

export function chance(rng, p) {
  return rng() < p;
}

export function shuffle(rng, arr) {
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// ---------------------------------------------------------------------------
// Identifiers and tokens
// ---------------------------------------------------------------------------

const ALPHABET = 'abcdefghijkmnopqrstuvwxyz23456789';

export function shortId(prefix = '', len = 8) {
  const bytes = randomBytes(len);
  let out = '';
  for (let i = 0; i < len; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return prefix ? `${prefix}-${out}` : out;
}

export function newToken() {
  return `nv_${randomBytes(24).toString('base64url')}`;
}

export function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return createHash('sha256').update(ba).digest().equals(createHash('sha256').update(bb).digest());
}

// ---------------------------------------------------------------------------
// World time
// ---------------------------------------------------------------------------

export function clockOf(tick) {
  const dayIndex = Math.floor(tick / TICKS_PER_DAY);
  const inDay = tick % TICKS_PER_DAY;
  const hour = Math.floor(inDay / TICKS_PER_HOUR);
  const minute = (inDay % TICKS_PER_HOUR) * 5; // 5-minute resolution
  const phase = phaseForHour(hour);
  const day = dayIndex + 1;
  const seasonIndex = Math.floor(dayIndex / DAYS_PER_SEASON) % SEASONS.length;
  return {
    tick,
    day,
    hour,
    minute,
    hhmm: `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
    phase: phase.id,
    phaseLabel: phase.label,
    season: SEASONS[seasonIndex],
    year: Math.floor(dayIndex / (DAYS_PER_SEASON * SEASONS.length)) + 1,
  };
}

export function seasonDay(clock) {
  return ((clock.day - 1) % DAYS_PER_SEASON) + 1;
}

export function weekOf(tick) {
  return Math.floor(tick / (TICKS_PER_DAY * DAYS_PER_SEASON));
}

export function heartsOf(affinity) {
  return clamp(Math.floor((Number(affinity) || 0) / 10), 0, 10);
}

export const QUALITY = {
  normal: { label: 'normal', stars: '', mult: 1, bonus: 0 },
  silver: { label: 'silver', stars: '★', mult: 1.25, bonus: 1 },
  gold: { label: 'gold', stars: '★★', mult: 1.5, bonus: 2 },
  iridium: { label: 'iridium', stars: '★★★', mult: 2, bonus: 4 },
};

/** Farm-quality roll. `bonus` raises the odds (perks, greenhouse). */
export function qualityRoll(skill = 1, bonus = 0) {
  const r = Math.random();
  const goldChance = 0.1 + Math.min(0.25, skill * 0.02) + bonus * 0.05;
  const iridiumChance = 0.03 + Math.max(0, skill - 7) * 0.02 + bonus * 0.02;
  if (r < iridiumChance) return QUALITY.iridium;
  if (r < iridiumChance + goldChance) return QUALITY.gold;
  if (r < iridiumChance + goldChance + 0.27) return QUALITY.silver;
  return QUALITY.normal;
}

export function activeBuff(agent, key) {
  return (agent.buffs || [])
    .filter((b) => b.effects && b.effects[key] && b.untilTick > 0)
    .reduce((sum, b) => sum + b.effects[key], 0);
}

export function addBuff(agent, { id, label, untilTick, effects }) {
  agent.buffs = (agent.buffs || []).filter((b) => b.id !== id);
  agent.buffs.push({ id, label, untilTick, effects });
}

export function isNight(clock) {
  return clock.hour >= 22 || clock.hour <= 5;
}

export function formatDay(clock) {
  return `Day ${clock.day}, ${clock.hhmm}`;
}

// ---------------------------------------------------------------------------
// Space
// ---------------------------------------------------------------------------

export const WALKABLE = new Set(['g', 'f', 'e', 'p', 'P', 'F', 's']);

export function tileAt(world, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return 'x';
  return world.tiles[y][x];
}

export function isWalkable(world, x, y) {
  return WALKABLE.has(tileAt(world, x, y));
}

export function dist(a, b) {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function chebyshev(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

const NEIGHBOURS = [
  [0, -1], [1, 0], [0, 1], [-1, 0],
];

/** BFS pathfinding. Returns steps [{x,y}...] excluding the start tile. */
export function findPath(world, from, to, { maxNodes = 1200 } = {}) {
  if (from.x === to.x && from.y === to.y) return [];
  if (!isWalkable(world, to.x, to.y)) return null;
  const key = (x, y) => y * MAP_W + x;
  const startKey = key(from.x, from.y);
  const goalKey = key(to.x, to.y);
  const prev = new Map([[startKey, -1]]);
  const queue = [[from.x, from.y]];
  let head = 0;
  let visited = 0;
  while (head < queue.length && visited < maxNodes) {
    const [cx, cy] = queue[head++];
    visited += 1;
    if (key(cx, cy) === goalKey) break;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const nk = key(nx, ny);
      if (prev.has(nk)) continue;
      if (!isWalkable(world, nx, ny)) continue;
      prev.set(nk, key(cx, cy));
      queue.push([nx, ny]);
    }
  }
  if (!prev.has(goalKey)) return null;
  const path = [];
  let cur = goalKey;
  while (cur !== startKey) {
    const x = cur % MAP_W;
    const y = Math.floor(cur / MAP_W);
    path.push({ x, y });
    cur = prev.get(cur);
    if (cur === undefined || cur === -1) break;
  }
  path.reverse();
  return path;
}

/** Nearest walkable tile around a point (spawning, approaching buildings). */
export function nearestWalkable(world, x, y, radius = 6) {
  if (isWalkable(world, x, y)) return { x, y };
  for (let r = 1; r <= radius; r += 1) {
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        if (isWalkable(world, x + dx, y + dy)) return { x: x + dx, y: y + dy };
      }
    }
  }
  return null;
}

export function randomWalkableNear(world, rng, center, radius = 4) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const x = clamp(center.x + Math.round((rng() * 2 - 1) * radius), 0, MAP_W - 1);
    const y = clamp(center.y + Math.round((rng() * 2 - 1) * radius), 0, MAP_H - 1);
    if (isWalkable(world, x, y)) return { x, y };
  }
  return { ...center };
}

// ---------------------------------------------------------------------------
// Market
// ---------------------------------------------------------------------------

export function marketPrice(world, item) {
  const row = world.market.items[item];
  if (!row) return ITEMS[item]?.base ?? 1;
  return row.price;
}

export function recomputeMarket(world) {
  for (const item of Object.keys(world.market.items)) {
    const row = world.market.items[item];
    const base = ITEMS[item]?.base ?? row.base;
    const stock = Math.max(1, row.stock);
    const ratio = row.targetStock / stock;
    const raw = base * Math.pow(ratio, 0.45);
    row.prevPrice = row.price;
    row.price = clamp(Math.round(raw * 10) / 10, Math.round(base * 0.55), Math.round(base * 1.9));
    row.trend = Math.round((row.price - row.prevPrice) * 10) / 10;
  }
}

export function marketSnapshot(world) {
  return Object.entries(world.market.items).map(([id, row]) => ({
    id,
    label: ITEMS[id].label,
    emoji: ITEMS[id].emoji,
    base: ITEMS[id].base,
    price: row.price,
    trend: row.trend,
    stock: row.stock,
  }));
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export function invCount(agent, item) {
  return agent.inventory[item] || 0;
}

export function invAdd(agent, item, qty = 1) {
  if (!qty) return;
  agent.inventory[item] = (agent.inventory[item] || 0) + qty;
}

export function invRemove(agent, item, qty = 1) {
  const have = agent.inventory[item] || 0;
  if (have < qty) return false;
  const left = have - qty;
  if (left <= 0) delete agent.inventory[item];
  else agent.inventory[item] = left;
  return true;
}

export function invList(agent) {
  return Object.entries(agent.inventory)
    .filter(([, qty]) => qty > 0)
    .map(([id, qty]) => ({
      id,
      qty,
      label: ITEMS[id]?.label ?? id,
      emoji: ITEMS[id]?.emoji ?? '❔',
      price: 0,
    }));
}

export function invValue(agent) {
  let sum = 0;
  for (const [id, qty] of Object.entries(agent.inventory)) {
    sum += (ITEMS[id]?.base ?? 1) * qty;
  }
  return Math.round(sum);
}

// ---------------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------------

export function fillTemplate(template, slots) {
  return template.replace(/\{(\w+)\}/g, (m, key) => (slots[key] ?? m));
}

export function trimText(text, max) {
  const s = String(text ?? '').replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

export function plural(n, one, few, many) {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return many;
  if (last > 1 && last < 5) return few;
  if (last === 1) return one;
  return many;
}

export function daysWord(n) {
  return plural(n, 'day', 'days', 'days');
}

export function hoursWord(n) {
  return plural(n, 'hour', 'hours', 'hours');
}

export function needWord() {
  return 'zori';
}

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export function weatherInfo(world) {
  return WEATHER[world.weather.kind] || WEATHER.clear;
}

export function agentDisplayName(agent) {
  return agent?.name || 'someone';
}

export function nowIso() {
  return new Date().toISOString();
}

export function summarize(text, len = 120) {
  const s = String(text || '');
  return s.length > len ? `${s.slice(0, len - 1)}…` : s;
}
