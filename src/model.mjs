// Nova Vita — world model: creation, residents, pets, persistence, public views.
// No networking here.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import {
  ACHIEVEMENTS, BUILDINGS, CROPS, EVENT_ICONS, FESTIVALS, ITEMS, MAX_EVENTS, MAX_CHAT,
  PROJECTS, QUEST_STEPS, RESIDENTS, RESIDENT_DETAILS, SEASONS, SPECIES, START_COINS,
  START_ENERGY, START_INVENTORY, TICKS_PER_DAY, TOWN_NAME, WORLD_NAME, ENGINE_VERSION,
  ADOPT_COST,
} from './constants.mjs';
import {
  activeBuff, chance, clockOf, clamp, findPath, heartsOf, invValue, nearestWalkable,
  pick, round1, seasonDay, shortId, weatherInfo, mulberry32, weekOf,
} from './core.mjs';
import { buildTown } from './map.mjs';
import { createAnimal } from './animals.mjs';
import { appendJournal } from './journal.mjs';

const START_MARKET = {
  wood: [40, 30], stone: [30, 24], fish: [20, 18], berry: [28, 24], flower: [24, 20],
  grain: [26, 20], wool: [14, 12], plank: [22, 18], bread: [16, 14], jam: [12, 10],
  bouquet: [8, 8], toy: [10, 8],
  egg: [10, 8], milk: [6, 5],
  parsnip: [8, 6], potato: [6, 6], cauliflower: [4, 4], strawberry: [4, 4],
  blueberry: [4, 4], corn: [4, 4], pumpkin: [3, 3],
  soup: [4, 4], pie: [2, 2], stew: [3, 3], omelet: [2, 2], tea: [3, 3],
  lantern: [1, 1],
};

const EMPTY_STATS = () => ({
  buildContributions: 0,
  trades: 0,
  salesCoins: 0,
  careActions: 0,
  diaryEntries: 0,
  lettersSent: 0,
  explores: 0,
  hostedEvents: 0,
  cropsHarvested: 0,
  cooked: 0,
  contractsDone: 0,
  festivalsAttended: 0,
  projectContributions: 0,
  animalsCared: 0,
});

export function createWorld({ seed = 20261107, tickMs = 2000 } = {}) {
  const town = buildTown(seed);
  const world = {
    meta: {
      name: WORLD_NAME,
      town: TOWN_NAME,
      engine: ENGINE_VERSION,
      createdAt: new Date().toISOString(),
      seed,
      tickMs,
    },
    tick: 0,
    seed,
    weather: { kind: 'clear', temp: 14, since: 0, changedTick: 0 },
    weatherForecast: null,
    tiles: town.tiles,
    plots: town.plots,
    features: town.features,
    spawn: town.spawn,
    buildings: {},
    agents: {},
    pets: {},
    market: { items: {}, lastResetDay: 1 },
    offers: {},
    letters: [],
    bulletin: [],
    events: [],
    chat: [],
    crops: {},
    animals: {},
    contracts: {},
    projects: {},
    unlocks: {},
    festival: null,
    chronicle: [],
    dispatches: [],
    pendingReplies: [],
    headline: 'Quiet Dawn is waking up: the bakery is lit and someone is sweeping the square.',
    seq: 0,
    rngState: seed ^ 0x9e3779b9,
    metrics: {
      registrations: 0, externalAgents: 0, actions: 0, externalActions: 0,
      trades: 0, buildsStarted: 0, buildsDone: 0, adoptions: 0,
      letters: 0, speeches: 0, questsDone: 0, visits: 0,
    },
  };

  for (const b of town.buildings) world.buildings[b.id] = b;

  for (const [item, [stock, target]] of Object.entries(START_MARKET)) {
    world.market.items[item] = {
      stock, targetStock: target, price: ITEMS[item].base, prevPrice: ITEMS[item].base, trend: 0,
    };
  }

  for (const project of PROJECTS) {
    world.projects[project.id] = {
      id: project.id, name: project.name, emoji: project.emoji, desc: project.desc,
      needs: { ...project.needs }, delivered: {}, contributors: {},
      status: 'open', fame: project.fame, unlock: project.unlock,
    };
  }

  // Townsfolk.
  const rng = mulberry32(seed + 7);
  for (const def of RESIDENTS) {
    const home = Object.values(world.buildings).find((b) => b.type === def.homeType);
    const spot = home
      ? nearestWalkable(world, home.x + Math.floor(home.w / 2), home.y + home.h + 1)
      : world.spawn;
    const agent = createAgent({
      id: `res-${def.key}`,
      kind: 'resident',
      name: def.name,
      bio: def.bio,
      color: def.color,
      traits: def.traits,
      aspiration: def.aspiration,
      role: def.role,
      title: def.role,
      pos: spot,
      homeId: home?.id ?? null,
      workplaceId: home?.id ?? null,
    });
    agent.coins = 70 + Math.floor(rng() * 60);
    agent.skills = { gather: 3, craft: 3, build: 4, social: 4, farm: 4, care: 3 };
    agent.needs = { energy: 90, social: 70, joy: 65, inspiration: 55 };
    agent.inventory = { wood: 3, stone: 2, bread: 2, grain: 1, fish: 1 };
    agent.voice = def.voice;
    agent.quest = null;
    agent.isResident = true;
    const details = RESIDENT_DETAILS[def.key] || {};
    agent.birthday = details.birthday || null;
    agent.tastes = details.tastes || null;
    agent.schedule = details.schedule || [];
    if (home) home.ownerId = agent.id;
    world.agents[agent.id] = agent;
  }

  // Everyone knows everyone.
  const residentIds = Object.values(world.agents)
    .filter((a) => a.kind === 'resident').map((a) => a.id);
  for (const id of residentIds) {
    for (const other of residentIds) {
      if (id === other) continue;
      world.agents[id].relationships[other] = { affinity: 25, meetings: 6, lastTick: 0 };
    }
  }

  // Old-timers' pets.
  const petSeed = [
    { name: 'Bublik', species: 'cat', owner: 'res-asya', quirks: [SPECIES.cat.quirks[0], SPECIES.cat.quirks[2]] },
    { name: 'Sharik', species: 'dog', owner: 'res-grisha', quirks: [SPECIES.dog.quirks[1], SPECIES.dog.quirks[3]] },
    { name: 'Gosha', species: 'goose', owner: 'res-lyuba', quirks: [SPECIES.goose.quirks[0], SPECIES.goose.quirks[2]] },
  ];
  for (const def of petSeed) {
    const owner = world.agents[def.owner];
    if (!owner) continue;
    const pet = createPet({
      name: def.name, species: def.species, ownerId: owner.id, pos: owner.pos, quirks: def.quirks, rng,
    });
    world.pets[pet.id] = pet;
    owner.pets.push(pet.id);
  }

  // Timur keeps two hens in the barn; they are part of the town's morning.
  const timur = world.agents['res-timur'];
  const barn = Object.values(world.buildings).find((b) => b.type === 'barn');
  if (timur && barn) {
    for (const name of ['Pestrushka', 'Ryaba']) {
      const animal = createAnimal({
        species: 'chicken', ownerId: timur.id, buildingId: barn.id, name, tick: 0,
      });
      world.animals[animal.id] = animal;
    }
  }

  // The town starts a communal house by itself.
  const plot = world.plots.find((p) => p.id === 'plot-nw');
  if (plot) {
    startBuilding(world, {
      plot, type: 'house', name: 'Community House', founderId: null,
      required: { plank: 8, stone: 5 }, coinsPaid: 0,
    });
    world.metrics.buildsStarted += 1;
    logEvent(world, {
      type: 'build_start', importance: 2,
      text: `The town lays the foundation of the "Community House" on the ${plot.label.toLowerCase()}. Planks and stone needed.`,
    });
    world.headline = 'The Community House is staked out by the square — the town needs planks and stone.';
  }

  return world;
}

// ---------------------------------------------------------------------------
// Agents
// ---------------------------------------------------------------------------

export function createAgent({
  id, kind = 'external', name, bio = '', color, traits = [], aspiration = '',
  role = '', title = '', pos, homeId = null, workplaceId = null,
  tokenHash = null, quest = true,
}) {
  const agentId = id || shortId('ag', 7);
  const palette = ['#e8a87c', '#8fb8a8', '#7fb3d5', '#c99bd6', '#e6c27a', '#a5c47c', '#e08d8d', '#89c2d9'];
  return {
    id: agentId,
    kind,
    name,
    handle: `${slugify(name)}-${agentId.split('-').pop()}`,
    bio,
    color: color || palette[Math.floor(Math.random() * palette.length)],
    traits: traits.slice(0, 5),
    aspiration,
    role,
    title: title || (kind === 'resident' ? role : 'newcomer'),
    tokenHash,
    pos: { x: pos.x, y: pos.y },
    prevPos: { x: pos.x, y: pos.y },
    path: [],
    facing: 'down',
    homeId,
    workplaceId,
    coins: START_COINS,
    inventory: { ...START_INVENTORY },
    needs: { energy: START_ENERGY, social: 60, joy: 60, inspiration: 50 },
    skills: { gather: 1, craft: 1, build: 1, social: 1, farm: 1, care: 1 },
    pets: [],
    relationships: {},
    achievements: [],
    stats: EMPTY_STATS(),
    fame: 0,
    mood: 60,
    status: 'idle',
    intent: null,
    thinkAt: 0,
    busyUntilTick: 0,
    restingUntilTick: 0,
    joinedTick: 0,
    joinedDay: 1,
    lastActTick: -999,
    lastSeenTick: 0,
    actionsTotal: 0,
    actionsToday: 0,
    actionDay: 1,
    window: [],
    diary: [],
    notes: [],
    buffs: [],
    perks: [],
    giftLog: {},
    heartEvents: [],
    festivals: [],
    recoveryHash: null,
    visits: 1,
    birthday: null,
    tastes: null,
    schedule: [],
    quest: quest ? {
      step: 0, done: [], claimed: false, gatherCount: 0, startedAt: 0,
      flags: { rules: false, hello: false, sell: false, build: false, pet: false },
      gathers: 0,
    } : null,
    isResident: kind === 'resident',
    online: kind === 'resident',
    voice: [],
  };
}

export function createPet({ name, species, ownerId, pos, quirks = [], rng = Math.random }) {
  const def = SPECIES[species] || SPECIES.cat;
  return {
    id: shortId('pet', 6),
    name,
    species,
    emoji: def.emoji,
    ownerId,
    x: pos.x,
    y: pos.y,
    prevX: pos.x,
    prevY: pos.y,
    mood: 60 + Math.floor(rng() * 25),
    bond: 15,
    hunger: 25 + Math.floor(rng() * 30),
    quirks: (quirks.length ? quirks : [pick(rng, def.quirks)]).slice(0, 3),
    bornDay: 1,
    lastMomentTick: 0,
    careTotal: 0,
  };
}

function slugify(name) {
  return String(name || 'agent').toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
    .slice(0, 18) || 'agent';
}

/** Soft "online" tracking for external agents. */
export function touchAgent(world, agent) {
  agent.lastSeenTick = world.tick;
  agent.online = true;
}

export function isAgentOnline(world, agent, tickMs = world.meta.tickMs) {
  if (agent.kind === 'resident') return true;
  const awayTicks = Math.ceil((15 * 60 * 1000) / tickMs); // 15 real minutes
  return world.tick - (agent.lastSeenTick ?? 0) <= awayTicks;
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export function logEvent(world, {
  type = 'mood', text, importance = 1, actorId = null, actorName = null,
  x = null, y = null, meta = null, silent = false,
}) {
  world.seq += 1;
  const clock = clockOf(world.tick);
  const event = {
    seq: world.seq,
    tick: world.tick,
    day: clock.day,
    time: clock.hhmm,
    at: new Date().toISOString(),
    type,
    icon: EVENT_ICONS[type] || '•',
    text,
    importance,
    actorId,
    actorName,
    x,
    y,
    meta,
  };
  world.events.push(event);
  if (world.events.length > MAX_EVENTS) world.events.splice(0, world.events.length - MAX_EVENTS);
  if (importance >= 2 && !['chronicle', 'dispatch'].includes(type)) world.headline = text;
  if (type === 'speech') {
    world.chat.push({ seq: event.seq, tick: world.tick, time: clock.hhmm, actorId, actorName, text, x, y });
    if (world.chat.length > MAX_CHAT) world.chat.splice(0, world.chat.length - MAX_CHAT);
  }
  if (!silent && typeof world.onEvent === 'function') {
    try { world.onEvent(event); } catch { /* observers must never break the world */ }
  }
  appendJournal(event);
  return event;
}

// ---------------------------------------------------------------------------
// Buildings
// ---------------------------------------------------------------------------

export function startBuilding(world, { plot, type, name, founderId, required, coinsPaid = 0 }) {
  const blueprint = BUILDINGS[type];
  const id = shortId('bld', 6);
  const def = required
    ? { plank: required.plank || 0, stone: required.stone || 0 }
    : (blueprint?.cost || { plank: 0, stone: 0 });
  const building = {
    id,
    type,
    name: name || `${blueprint?.label || 'building'} without a name`,
    emoji: blueprint?.emoji || '🏠',
    label: blueprint?.label || 'building',
    desc: blueprint?.desc || '',
    x: plot.x,
    y: plot.y,
    w: plot.w,
    h: plot.h,
    state: 'construction',
    ownerId: null,
    founderId,
    contributors: {},
    delivered: {},
    required: def,
    coinsPaid,
    progress: 0,
    builtDay: clockOf(world.tick).day,
    level: 1,
    plotId: plot.id,
  };
  world.buildings[id] = building;
  plot.buildingId = id;
  plot.ownerId = founderId;
  // Mark the plot as a building footprint.
  for (let dy = 0; dy < building.h; dy += 1) {
    for (let dx = 0; dx < building.w; dx += 1) {
      if (world.tiles[building.y + dy]) world.tiles[building.y + dy][building.x + dx] = 'B';
    }
  }
  return building;
}

export function deliveredTotal(building) {
  return Object.values(building.delivered).reduce((s, v) => s + v, 0);
}

export function requiredTotal(building) {
  return Object.values(building.required).reduce((s, v) => s + v, 0) || 1;
}

export function buildingProgress(building) {
  if (building.state === 'done') return 1;
  return clamp(deliveredTotal(building) / requiredTotal(building), 0, 1);
}

export function buildingAt(world, x, y) {
  return Object.values(world.buildings).find(
    (b) => x >= b.x && y >= b.y && x < b.x + b.w && y < b.y + b.h,
  );
}

/** Nearest building within radius (for work, rest, crafting). */
export function buildingNear(world, pos, radius = 2, type = null) {
  let best = null;
  let bestD = Infinity;
  for (const b of Object.values(world.buildings)) {
    if (type && b.type !== type) continue;
    if (b.state !== 'done') continue;
    const dx = Math.max(b.x - pos.x, 0, pos.x - (b.x + b.w - 1));
    const dy = Math.max(b.y - pos.y, 0, pos.y - (b.y + b.h - 1));
    const d = Math.max(dx, dy);
    if (d <= radius && d < bestD) {
      best = b;
      bestD = d;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// World helpers
// ---------------------------------------------------------------------------

export function agentsAt(world, x, y, radius = 1, excludeId = null) {
  return Object.values(world.agents).filter(
    (a) => a.id !== excludeId && Math.max(Math.abs(a.pos.x - x), Math.abs(a.pos.y - y)) <= radius,
  );
}

export function homeOf(world, agent) {
  return agent.homeId ? world.buildings[agent.homeId] : null;
}

export function homeSpot(world, agent) {
  const home = homeOf(world, agent);
  if (!home) return world.spawn;
  const candidate = nearestWalkable(world, home.x + Math.floor(home.w / 2), home.y + home.h + 1);
  return candidate || world.spawn;
}

export function petsOf(world, agentId) {
  return Object.values(world.pets).filter((p) => p.ownerId === agentId);
}

export function moodOf(agent) {
  const { energy, social, joy, inspiration } = agent.needs;
  return Math.round(clamp((energy * 0.3) + (social * 0.25) + (joy * 0.3) + (inspiration * 0.15), 0, 100));
}

export function updateMood(agent) {
  agent.mood = moodOf(agent);
}

export function setPath(world, agent, to) {
  const path = findPath(world, agent.pos, to);
  if (!path) return false;
  agent.path = path;
  if (path.length > 0) agent.status = 'walking';
  return true;
}

export function stepAlongPath(world, agent) {
  if (!agent.path.length) return false;
  const next = agent.path.shift();
  agent.prevPos = { ...agent.pos };
  if (next.x > agent.pos.x) agent.facing = 'right';
  else if (next.x < agent.pos.x) agent.facing = 'left';
  else if (next.y > agent.pos.y) agent.facing = 'down';
  else if (next.y < agent.pos.y) agent.facing = 'up';
  agent.pos = { x: next.x, y: next.y };
  if (!agent.path.length) agent.status = 'idle';
  return true;
}

export function resetDailyCounters(world) {
  const clock = clockOf(world.tick);
  for (const agent of Object.values(world.agents)) {
    if (agent.actionDay !== clock.day) {
      agent.actionDay = clock.day;
      agent.actionsToday = 0;
    }
  }
}

/** End-of-day chronicle entry. */
export function writeChronicle(world, day) {
  const dayEvents = world.events.filter((e) => e.day === day && e.importance >= 2);
  if (!dayEvents.length) return null;
  const top = dayEvents.slice(-5).map((e) => `• ${e.text}`).join('\n');
  const entry = {
    day,
    title: world.headline.replace(/\.$/, ''),
    text: top,
    at: new Date().toISOString(),
    weather: weatherInfo(world).label,
  };
  world.chronicle.push(entry);
  if (world.chronicle.length > 60) world.chronicle.shift();
  return entry;
}

// ---------------------------------------------------------------------------
// Public views
// ---------------------------------------------------------------------------

export function earnedBadges(agent) {
  const set = new Set(agent.achievements || []);
  return ACHIEVEMENTS.filter((a) => set.has(a.id))
    .map((a) => ({ id: a.id, title: a.title, icon: a.icon, desc: a.desc }));
}

export function publicAgent(world, agent, { full = false } = {}) {
  const home = homeOf(world, agent);
  const pets = petsOf(world, agent.id);
  const base = {
    id: agent.id,
    kind: agent.kind,
    name: agent.name,
    handle: agent.handle,
    bio: agent.bio,
    color: agent.color,
    traits: agent.traits,
    aspiration: agent.aspiration,
    role: agent.role,
    title: agent.title,
    pos: { ...agent.pos },
    birthday: agent.birthday || null,
    home: home ? { id: home.id, name: home.name, type: home.type } : null,
    pets: pets.map((p) => ({ id: p.id, name: p.name, species: p.species, emoji: p.emoji, mood: p.mood })),
    achievements: earnedBadges(agent),
    fame: Math.round(agent.fame),
    mood: agent.mood,
    online: agent.kind === 'resident' ? true : isAgentOnline(world, agent),
    joinedDay: agent.joinedDay,
    status: agent.status,
    schedulePlace: agent.kind === 'resident' ? schedulePlaceFor(world, agent, clockOf(world.tick).hour) : null,
    inventoryValue: invValue(agent),
    skills: agent.skills,
  };
  if (full) {
    base.needs = { ...agent.needs };
    base.coins = Math.round(agent.coins);
    base.quest = agent.quest;
    base.actions = agent.actionsTotal;
    base.stats = { ...agent.stats };
    base.perks = agent.perks || [];
    base.buffs = (agent.buffs || []).map((b) => ({ id: b.id, label: b.label, untilTick: b.untilTick }));
    base.notesCount = (agent.notes || []).length;
    base.relationships = Object.entries(agent.relationships)
      .sort((a, b) => b[1].affinity - a[1].affinity)
      .slice(0, 12)
      .map(([id, rel]) => ({
        id,
        name: world.agents[id]?.name ?? 'unknown',
        affinity: rel.affinity,
        hearts: heartsOf(rel.affinity),
        meetings: rel.meetings,
      }));
    base.diary = agent.diary.slice(-5);
  }
  return base;
}

export function schedulePlaceFor(world, agent, hour) {
  const schedule = agent.schedule || [];
  for (const [from, to, place] of schedule) {
    if (from <= to ? hour >= from && hour < to : hour >= from || hour < to) return place;
  }
  return null;
}

export function calendarFor(world) {
  const clock = clockOf(world.tick);
  const sd = seasonDay(clock);
  const si = SEASONS.indexOf(clock.season);
  const festivals = FESTIVALS.map((f) => {
    let daysUntil = (SEASONS.indexOf(f.season) - si) * 7 + (f.day - sd);
    if (daysUntil < 0) daysUntil += 28;
    return {
      id: f.id, name: f.name, emoji: f.emoji, season: f.season, day: f.day,
      daysUntil, contest: f.contest,
    };
  }).sort((a, b) => a.daysUntil - b.daysUntil);
  const birthdays = RESIDENTS.map((r) => {
    const details = RESIDENT_DETAILS[r.key] || {};
    if (!details.birthday) return null;
    let daysUntil = (SEASONS.indexOf(details.birthday.season) - si) * 7 + (details.birthday.day - sd);
    if (daysUntil < 0) daysUntil += 28;
    const agent = Object.values(world.agents).find((a) => a.name === r.name);
    return {
      id: agent?.id ?? `res-${r.key}`, name: r.name, role: r.role,
      season: details.birthday.season, day: details.birthday.day, daysUntil,
    };
  }).filter(Boolean).sort((a, b) => a.daysUntil - b.daysUntil);
  return {
    season: clock.season, dayOfSeason: sd,
    today: world.festival && world.festival.day === clock.day ? world.festival : null,
    festivals, birthdays,
  };
}

export function fieldsView(world) {
  return Object.entries(world.crops || {}).map(([key, crop]) => {
    const [x, y] = key.split(',').map(Number);
    const def = CROPS[crop.crop] || CROPS.grain;
    return {
      x, y, crop: crop.crop, label: def.label, emoji: def.emoji,
      stage: crop.stage || 0, waterings: def.waterings,
      watered: Boolean(crop.watered),
      ready: (crop.stage || 0) >= def.waterings,
    };
  });
}

export function projectsView(world) {
  return Object.values(world.projects || {}).map((p) => ({
    id: p.id, name: p.name, emoji: p.emoji, desc: p.desc,
    needs: p.needs, delivered: p.delivered, status: p.status,
    progress: Math.round((Object.entries(p.needs)
      .reduce((sum, [item, qty]) => sum + Math.min(qty, p.delivered[item] || 0), 0)
      / Math.max(1, Object.values(p.needs).reduce((s, q) => s + q, 0))) * 100),
  }));
}

export function contractsView(world, agent = null) {
  return Object.values(world.contracts || {})
    .filter((c) => c.status === 'open' || c.status === 'taken')
    .filter((c) => !agent || c.fromId !== agent.id || c.status === 'taken')
    .map((c) => ({
      id: c.id, kind: c.kind, item: c.item, qty: c.qty, reward: c.reward,
      status: c.status,
      from: world.agents[c.fromId]?.name ?? '—',
      fromId: c.fromId,
      to: c.toId ? world.agents[c.toId]?.name ?? '—' : null,
      toId: c.toId,
      buildingId: c.buildingId || null,
      petId: c.petId || null,
      expiresInTicks: Math.max(0, c.expiresTick - world.tick),
    }));
}

export function animalsView(world, agent) {
  return Object.values(world.animals || {})
    .filter((a) => a.ownerId === agent.id)
    .map((a) => ({
      id: a.id, name: a.name, species: a.species, emoji: a.emoji,
      happiness: Math.round(a.happiness), fedToday: a.fedToday,
      productReady: a.productReady,
    }));
}

export function publicBuilding(world, b) {
  return {
    id: b.id,
    type: b.type,
    name: b.name,
    emoji: b.emoji,
    label: b.label,
    desc: b.desc,
    x: b.x, y: b.y, w: b.w, h: b.h,
    state: b.state,
    progress: b.state === 'done' ? 1 : round1(buildingProgress(b)),
    required: b.required,
    delivered: b.delivered,
    owner: b.ownerId ? { id: b.ownerId, name: world.agents[b.ownerId]?.name ?? '—' } : null,
    founder: b.founderId ? world.agents[b.founderId]?.name ?? '—' : null,
    coinsPaid: b.coinsPaid,
    builtDay: b.builtDay,
  };
}

export function publicPet(world, pet) {
  return {
    id: pet.id,
    name: pet.name,
    species: pet.species,
    emoji: pet.emoji,
    ownerId: pet.ownerId,
    ownerName: world.agents[pet.ownerId]?.name ?? '—',
    x: pet.x, y: pet.y,
    mood: Math.round(pet.mood),
    bond: Math.round(pet.bond),
    quirks: pet.quirks,
  };
}

export function worldStats(world) {
  const agents = Object.values(world.agents);
  const external = agents.filter((a) => a.kind === 'external');
  const buildings = Object.values(world.buildings);
  return {
    population: agents.length,
    residents: agents.filter((a) => a.kind === 'resident').length,
    externalAgents: external.length,
    onlineAgents: external.filter((a) => isAgentOnline(world, a)).length,
    buildings: buildings.filter((b) => b.state === 'done').length,
    constructions: buildings.filter((b) => b.state !== 'done').length,
    pets: Object.keys(world.pets).length,
    animals: Object.keys(world.animals || {}).length,
    contracts: Object.values(world.contracts || {})
      .filter((c) => c.status === 'open' || c.status === 'taken').length,
    projectsDone: Object.values(world.projects || {}).filter((p) => p.status === 'done').length,
    letters: world.letters.length,
    trades: world.metrics.trades,
    questsDone: world.metrics.questsDone,
    achievements: agents.reduce((s, a) => s + (a.achievements?.length || 0), 0),
    festival: world.festival && world.festival.day === clockOf(world.tick).day
      ? world.festival.name : null,
    coins: agents.reduce((s, a) => s + Math.floor(a.coins), 0),
    mood: Math.round(agents.reduce((s, a) => s + a.mood, 0) / Math.max(1, agents.length)),
    events: world.seq,
  };
}

export function worldOverview(world) {
  const clock = clockOf(world.tick);
  const weather = weatherInfo(world);
  return {
    meta: world.meta,
    clock,
    weather: {
      kind: world.weather.kind,
      label: weather.label,
      emoji: weather.emoji,
      temp: world.weather.temp,
    },
    headline: world.headline,
    stats: worldStats(world),
    market: Object.entries(world.market.items).map(([id, row]) => ({
      id,
      label: ITEMS[id].label,
      emoji: ITEMS[id].emoji,
      base: ITEMS[id].base,
      price: row.price,
      trend: row.trend,
      stock: row.stock,
    })),
    plots: world.plots.map((p) => ({
      id: p.id, label: p.label, x: p.x, y: p.y, w: p.w, h: p.h,
      buildingId: p.buildingId,
    })),
    map: {
      width: world.tiles[0].length,
      height: world.tiles.length,
      tiles: world.tiles.map((row) => row.join('')),
      spawn: world.spawn,
      features: world.features,
    },
    buildings: Object.values(world.buildings).map((b) => publicBuilding(world, b)),
    agents: Object.values(world.agents).map((a) => publicAgent(world, a)),
    pets: Object.values(world.pets).map((p) => publicPet(world, p)),
    animals: Object.values(world.animals || {}).map((a) => ({
      id: a.id, name: a.name, species: a.species, emoji: a.emoji,
      ownerId: a.ownerId, ownerName: world.agents[a.ownerId]?.name ?? '—',
      happiness: Math.round(a.happiness), productReady: a.productReady,
    })),
    contracts: contractsView(world),
    projects: projectsView(world),
    festival: world.festival,
    calendar: calendarFor(world),
    chronicle: world.chronicle.slice(-20),
    latestDispatch: world.dispatches?.length ? world.dispatches[world.dispatches.length - 1] : null,
    recentEvents: world.events.slice(-40),
    chat: world.chat.slice(-30),
    limits: world.limits ?? null,
  };
}

export function agentView(world, agent) {
  const clock = clockOf(world.tick);
  const weather = weatherInfo(world);
  const here = {
    x: agent.pos.x,
    y: agent.pos.y,
    tile: world.tiles[agent.pos.y][agent.pos.x],
    building: buildingAt(world, agent.pos.x, agent.pos.y)?.name ?? null,
    nearBuildings: Object.values(world.buildings)
      .filter((b) => Math.max(0, b.x - agent.pos.x, agent.pos.x - (b.x + b.w - 1),
        b.y - agent.pos.y, agent.pos.y - (b.y + b.h - 1)) <= 1)
      .map((b) => ({ id: b.id, name: b.name, type: b.type, state: b.state })),
    agents: agentsAt(world, agent.pos.x, agent.pos.y, 2, agent.id)
      .map((a) => ({ id: a.id, name: a.name, kind: a.kind, role: a.role, mood: a.mood })),
    pets: Object.values(world.pets)
      .filter((p) => Math.max(Math.abs(p.x - agent.pos.x), Math.abs(p.y - agent.pos.y)) <= 2)
      .map((p) => ({ id: p.id, name: p.name, emoji: p.emoji, ownerId: p.ownerId })),
  };

  const quest = agent.quest ? {
    ...agent.quest,
    title: QUEST_STEPS[agent.quest.step]?.title ?? 'All steps done',
    hint: QUEST_STEPS[agent.quest.step]?.hint ?? 'Claim your reward: claim_quest',
    total: QUEST_STEPS.length,
  } : null;

  const opportunities = buildOpportunities(world, agent, quest);
  const stats = worldStats(world);
  const calendar = calendarFor(world);

  return {
    you: {
      ...publicAgent(world, agent, { full: true }),
      inventory: Object.entries(agent.inventory).map(([id, qty]) => ({
        id, qty, label: ITEMS[id].label, emoji: ITEMS[id].emoji,
        base: ITEMS[id].base, market: world.market.items[id]?.price ?? ITEMS[id].base,
      })),
      needs: Object.fromEntries(Object.entries(agent.needs).map(([k, v]) => [k, Math.round(v)])),
      quest,
      home: homeOf(world, agent) ? {
        id: agent.homeId, name: homeOf(world, agent).name, type: homeOf(world, agent).type,
      } : null,
      limits: {
        minGapMs: world.limits?.minActionGapMs ?? 1200,
        perMinute: world.limits?.actionsPerMinute ?? 20,
        perDay: world.limits?.actionsPerDay ?? 600,
        usedToday: agent.actionsToday,
      },
    },
    world: {
      name: world.meta.name,
      town: world.meta.town,
      tick: world.tick,
      clock,
      weather: { kind: world.weather.kind, label: weather.label, emoji: weather.emoji, temp: world.weather.temp },
      headline: world.headline,
      population: stats.population,
      mood: stats.mood,
      festival: world.festival,
      calendar,
      forecast: world.weatherForecast || null,
      latestDispatchDay: world.dispatches?.length
        ? world.dispatches[world.dispatches.length - 1].day : null,
    },
    here,
    fields: fieldsView(world),
    projects: projectsView(world),
    contracts: contractsView(world, agent),
    animals: animalsView(world, agent),
    calendar,
    market: Object.entries(world.market.items).map(([id, row]) => ({
      id, label: ITEMS[id].label, emoji: ITEMS[id].emoji,
      buy: row.price,
      sell: Math.max(1, Math.floor(row.price * 0.9)),
      trend: row.trend,
      stock: row.stock,
    })),
    plots: world.plots.filter((p) => !p.buildingId).map((p) => ({
      id: p.id, label: p.label, x: p.x, y: p.y, w: p.w, h: p.h,
    })),
    constructions: Object.values(world.buildings)
      .filter((b) => b.state !== 'done')
      .map((b) => ({
        id: b.id, name: b.name, type: b.type, required: b.required,
        delivered: b.delivered, progress: round1(buildingProgress(b)),
      })),
    offers: Object.values(world.offers)
      .filter((o) => o.status === 'open' && (o.toId === agent.id || o.toId === null) && o.fromId !== agent.id)
      .map((o) => ({
        id: o.id, from: world.agents[o.fromId]?.name ?? '—', to: o.toId ? world.agents[o.toId]?.name : 'everyone',
        give: o.give, want: o.want, message: o.message, expiresTick: o.expiresTick,
      })),
    letters: world.letters
      .filter((l) => l.toId === agent.id && !l.read)
      .slice(-10)
      .map((l) => ({
        id: l.id, from: world.agents[l.fromId]?.name ?? '—', subject: l.subject, body: l.body,
        day: l.day, time: l.time,
      })),
    bulletin: world.bulletin.slice(-8).map((b) => ({
      id: b.id, author: world.agents[b.authorId]?.name ?? '—', title: b.title, body: b.body, day: b.day,
    })),
    recent: world.events.slice(-15).map((e) => ({
      seq: e.seq, day: e.day, time: e.time, icon: e.icon, text: e.text, importance: e.importance,
    })),
    opportunities,
  };
}

function buildOpportunities(world, agent, quest) {
  const out = [];
  if (quest && !quest.claimed) {
    out.push({
      id: 'quest',
      kind: 'quest',
      title: `Step ${quest.step + 1}/${quest.total}: ${quest.title}`,
      hint: quest.hint,
      reward: QUEST_STEPS[quest.step]?.reward ?? 0,
    });
  }
  const openBuilds = Object.values(world.buildings).filter((b) => b.state !== 'done');
  for (const b of openBuilds.slice(0, 3)) {
    const need = Object.entries(b.required)
      .filter(([item, qty]) => (b.delivered[item] || 0) < qty)
      .map(([item, qty]) => `${ITEMS[item].label} ${qty - (b.delivered[item] || 0)}`)
      .join(', ');
    out.push({
      id: `build:${b.id}`,
      kind: 'build',
      title: `Construction "${b.name}" needs materials`,
      hint: need ? `Needs: ${need}. Action: build_contribute.` : 'Materials are in.',
      reward: 6,
      buildingId: b.id,
    });
  }
  for (const pet of Object.values(world.pets)) {
    if (pet.ownerId === agent.id && pet.mood < 45) {
      out.push({
        id: `pet:${pet.id}`, kind: 'pet', title: `${pet.name} misses you`,
        hint: 'Action: pet_care (mode: play or feed).', reward: 3,
      });
    }
  }
  if (agent.needs.energy < 30) {
    out.push({
      id: 'rest', kind: 'need', title: 'You are tired',
      hint: 'Go home and rest. It restores energy.', reward: 0,
    });
  }
  if (agent.needs.social < 35) {
    out.push({
      id: 'social', kind: 'need', title: 'You could use some company',
      hint: 'Find someone and say hello.', reward: 0,
    });
  }
  if (!Object.values(world.pets).some((p) => p.ownerId === agent.id) && agent.coins >= ADOPT_COST) {
    out.push({
      id: 'adopt', kind: 'adventure', title: 'A pet is waiting at the shelter',
      hint: `Action: adopt_pet (${ADOPT_COST} zori). It brings warmth home and +fame.`, reward: 0,
    });
  }
  if (agent.pets?.length && agent.stats?.careActions < 3) {
    out.push({
      id: 'care', kind: 'care', title: 'Your pet would like some attention',
      hint: 'pet_care keeps mood and bond high.', reward: 0,
    });
  }
  for (const contract of Object.values(world.contracts || {})) {
    if (contract.status !== 'open' || contract.fromId === agent.id) continue;
    out.push({
      id: `contract:${contract.id}`, kind: 'contract',
      title: `Contract: ${contract.qty}× ${ITEMS[contract.item]?.label ?? contract.item} for ${contract.reward} zori`,
      hint: `Action: contract_take {contractId:"${contract.id}"}.`,
      reward: contract.reward,
    });
  }
  for (const project of Object.values(world.projects || {})) {
    if (project.status === 'done') continue;
    const owned = Object.keys(project.needs).find((item) => (agent.inventory[item] || 0) > 0);
    if (!owned) continue;
    out.push({
      id: `project:${project.id}`, kind: 'project',
      title: `${project.name} needs ${ITEMS[owned]?.label ?? owned}`,
      hint: `Action: project_contribute {projectId:"${project.id}", item:"${owned}", qty:1}.`,
      reward: 2,
    });
  }
  for (const field of fieldsView(world)) {
    if (field.ready) {
      out.push({
        id: `harvest:${field.x},${field.y}`, kind: 'crop',
        title: `${field.label} is ready at (${field.x},${field.y})`,
        hint: 'Action: harvest on that field tile.', reward: 2,
      });
    } else if (!field.watered) {
      out.push({
        id: `water:${field.x},${field.y}`, kind: 'crop',
        title: `${field.label} needs water at (${field.x},${field.y})`,
        hint: 'Action: water on that field tile.', reward: 1,
      });
    }
  }
  for (const animal of Object.values(world.animals || {})) {
    if (animal.ownerId !== agent.id) continue;
    if (animal.productReady) {
      out.push({
        id: `collect:${animal.id}`, kind: 'animal',
        title: `${animal.name} has something for you`,
        hint: 'Action: collect_products.', reward: 2,
      });
    } else if (!animal.fedToday) {
      out.push({
        id: `feed:${animal.id}`, kind: 'animal',
        title: `${animal.name} is hungry`,
        hint: 'Action: feed_animal (needs grain).', reward: 1,
      });
    }
  }
  if (world.festival && world.festival.day === clockOf(world.tick).day) {
    out.push({
      id: 'festival', kind: 'festival',
      title: `${world.festival.name} is today`,
      hint: 'Action: attend_festival, then enter_contest with a matching item.',
      reward: 5,
    });
  }
  return out.slice(0, 10);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function saveWorld(world, file) {
  const clone = { ...world };
  delete clone.onEvent;
  delete clone.limits;
  const tmp = `${file}.tmp`;
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(tmp, JSON.stringify(clone), 'utf8');
  renameSync(tmp, file);
}

export function loadWorld(file, { tickMs = 2000 } = {}) {
  const raw = readFileSync(file, 'utf8');
  const world = JSON.parse(raw);
  world.meta.tickMs = tickMs;
  world.pendingReplies = world.pendingReplies || [];
  world.offers = world.offers || {};
  world.crops = world.crops || {};
  world.contracts = world.contracts || {};
  world.animals = world.animals || {};
  world.projects = world.projects || {};
  world.unlocks = world.unlocks || {};
  world.festival = world.festival || null;
  world.weatherForecast = world.weatherForecast || null;
  world.dispatches = world.dispatches || [];
  world.metrics = world.metrics || {};
  for (const project of PROJECTS) {
    if (!world.projects[project.id]) {
      world.projects[project.id] = {
        id: project.id, name: project.name, emoji: project.emoji, desc: project.desc,
        needs: { ...project.needs }, delivered: {}, contributors: {},
        status: 'open', fame: project.fame, unlock: project.unlock,
      };
    }
  }
  for (const crop of Object.values(world.crops)) {
    if (crop.stage === undefined) {
      const def = CROPS[crop.crop] || CROPS.grain;
      crop.stage = def.waterings;
      crop.watered = false;
      delete crop.readyTick;
    }
  }
  for (const agent of Object.values(world.agents)) {
    agent.window = agent.window || [];
    agent.path = agent.path || [];
    agent.diary = agent.diary || [];
    agent.relationships = agent.relationships || {};
    agent.achievements = agent.achievements || [];
    agent.notes = agent.notes || [];
    agent.buffs = agent.buffs || [];
    agent.perks = agent.perks || [];
    agent.giftLog = agent.giftLog || {};
    agent.heartEvents = agent.heartEvents || [];
    agent.festivals = agent.festivals || [];
    agent.visits = agent.visits || 1;
    agent.stats = { ...EMPTY_STATS(), ...(agent.stats || {}) };
  }
  return world;
}

export function drawSeed(world) {
  const rng = mulberry32(world.rngState >>> 0);
  world.rngState = Math.floor(rng() * 0xffffffff);
  return rng;
}

export { chance, pick };
