// Nova Vita — world tick. The simulation lives here: time, weather, residents,
// pets, market, rumours, the daily dispatch. External agents are part of the same loop.
import {
  BUILDINGS, CITY_BUILD_NAMES, CROPS, FESTIVALS, ITEMS, NPC_SPEECH, TICKS_PER_DAY,
  WEATHER_ORDER, WEATHER,
} from './constants.mjs';
import {
  chance, clockOf, clamp, fillTemplate, findPath, isNight, marketPrice,
  pick, randomWalkableNear, recomputeMarket, seasonDay, weatherInfo,
} from './core.mjs';
import { buildingDist, applyAction, expireContracts } from './actions.mjs';
import { evaluateAll } from './achievements.mjs';
import { dawnAnimals, animalsOf } from './animals.mjs';
import {
  agentsAt, buildingProgress, homeOf, isAgentOnline, logEvent, petsOf,
  schedulePlaceFor, setPath, startBuilding, updateMood, writeChronicle,
} from './model.mjs';

const AMBIENT = [
  { type: 'rumor', text: 'Word on the market: something rare is coming soon.', importance: 1 },
  { type: 'festival', text: 'The town is preparing a fair: tables are already going up on the square.', importance: 2 },
  { type: 'mood', text: 'Fog rose over the lake, and the lighthouse lit up early.', importance: 1 },
  { type: 'rumor', text: 'Someone saw a fox by the barn. Timur says it means a good harvest.', importance: 1 },
  { type: 'mood', text: 'A queue at the bakery again: Matryona baked something new.', importance: 1 },
  { type: 'festival', text: 'A poster appeared on the notice board: stories by the fire tonight.', importance: 2 },
  { type: 'rumor', text: 'They say fireflies moved into the old plot. The kids are already there.', importance: 1 },
  { type: 'mood', text: 'The wind brought the smell of the lake and cut grass.', importance: 1 },
];

const PET_MOMENTS = [
  '{pet} brings a stick and demands it be thrown.',
  '{pet} falls asleep on the most important document.',
  '{pet} chases its own tail. The tail wins.',
  '{pet} brings a carrot from the garden. It belongs to nobody.',
  '{pet} sits on the roof and watches the sunset.',
  '{pet} hides someone\'s boot. Nobody confesses.',
  '{pet} hoots into the dark, and the echo answers.',
  '{pet} proudly carries a feather. Nobody knows whose.',
];

function ambientText(world) {
  const names = Object.values(world.agents).filter((a) => a.kind === 'resident').map((a) => a.name);
  const buildings = Object.values(world.buildings).filter((b) => b.state === 'done');
  const building = buildings.length ? pick(Math.random, buildings) : null;
  const name = names.length ? pick(Math.random, names) : 'someone';
  const templates = [
    `Word on the market: ${name} is up to something.`,
    `Busy by the ${building?.name ?? 'square'} today: ${name} is telling stories.`,
    `The wind smells of ${pick(Math.random, ['bread', 'the lake', 'hay', 'rain'])}.`,
    `Someone left a bouquet on the well. Nobody admits it.`,
    `A flock of birds crossed the forest — the weather is turning.`,
    `A coin was found in the grass by the road. It already belongs to someone.`,
  ];
  return pick(Math.random, templates);
}

function waterAllCrops(world) {
  for (const crop of Object.values(world.crops || {})) crop.watered = true;
}

/** Dawn: watered crops advance; out-of-season crops die unless the greenhouse stands. */
function growCrops(world, clock) {
  let grown = 0;
  let dead = 0;
  for (const [key, crop] of Object.entries(world.crops || {})) {
    const def = CROPS[crop.crop];
    if (!def) { delete world.crops[key]; continue; }
    const seasonOk = def.seasons.includes(clock.season) || world.unlocks?.greenhouse;
    if (!seasonOk) { delete world.crops[key]; dead += 1; continue; }
    if (crop.watered && (crop.stage || 0) < def.waterings) {
      crop.stage = (crop.stage || 0) + 1;
      grown += 1;
    }
    crop.watered = false;
  }
  if (world.weather.kind === 'rain') waterAllCrops(world);
  if (grown || dead) {
    logEvent(world, {
      type: 'crop', importance: 1,
      text: `Dawn in the fields: ${grown} crop${grown === 1 ? '' : 's'} grew${dead ? `, ${dead} died out of season` : ''}.`,
    });
  }
}

function setFestival(world, clock) {
  const day = seasonDay(clock);
  const fest = FESTIVALS.find((f) => f.season === clock.season && f.day === day);
  if (!fest) return;
  world.festival = {
    ...fest, day: clock.day, status: 'open', judged: false, contestEntries: [],
  };
  logEvent(world, {
    type: 'festival_open', importance: 3,
    text: `${fest.emoji} ${fest.name} opens on the square. Contest: ${fest.contest.label}.`,
    x: 14, y: 9,
  });
}

function judgeFestival(world) {
  const fest = world.festival;
  if (!fest) return;
  fest.judged = true;
  fest.status = 'closed';
  const entries = [...(fest.contestEntries || [])].sort((a, b) => b.score - a.score);
  if (!entries.length) {
    logEvent(world, { type: 'festival', importance: 2, text: `${fest.name} closes quietly: nobody entered the contest.` });
    return;
  }
  const winner = entries[0];
  const champion = world.agents[winner.agentId];
  for (const entry of entries) {
    const participant = world.agents[entry.agentId];
    if (participant) participant.fame += 2;
  }
  if (champion) {
    champion.fame += fest.reward.fame;
    champion.coins += fest.reward.coins;
    champion.inventory[fest.reward.item] = (champion.inventory[fest.reward.item] || 0) + 1;
    champion.needs.joy = clamp(champion.needs.joy + 15, 0, 100);
  }
  fest.winner = { agentId: winner.agentId, name: winner.name, item: winner.item, score: winner.score };
  logEvent(world, {
    type: 'contest', importance: 3,
    text: `${fest.name}: ${winner.name} wins the ${fest.contest.label} with ${ITEMS[winner.item]?.label ?? winner.item} (score ${winner.score}).`,
    x: 14, y: 9,
  });
}

// ---------------------------------------------------------------------------
// Resident speech
// ---------------------------------------------------------------------------

export function npcLine(world, agent, kind, extra = {}) {
  const pool = NPC_SPEECH[kind] || NPC_SPEECH.gossip;
  const template = pick(Math.random, pool);
  const others = Object.values(world.agents).filter((a) => a.id !== agent.id);
  const other = others.length ? pick(Math.random, others) : { name: 'neighbour' };
  const pet = petsOf(world, agent.id)[0];
  const items = Object.keys(ITEMS);
  const building = Object.values(world.buildings).find((b) => b.state !== 'done');
  const slots = {
    name: other.name,
    item: ITEMS[pick(Math.random, items)].label,
    price: Math.round(marketPrice(world, pick(Math.random, items))),
    weather: weatherInfo(world).label,
    phase: clockOf(world.tick).phaseLabel,
    pet: pet?.name ?? 'cat',
    quirk: pet?.quirks?.[0] ?? 'sleeps on the stove',
    building: building?.name ?? 'new house',
  };
  for (const [key, value] of Object.entries(extra || {})) {
    if (value !== undefined && value !== null && value !== '') slots[key] = value;
  }
  return fillTemplate(template, slots);
}

// ---------------------------------------------------------------------------
// Main tick
// ---------------------------------------------------------------------------

export function tickWorld(world) {
  world.tick += 1;
  const clock = clockOf(world.tick);
  const tickMs = world.meta.tickMs;

  // Day rollover.
  if (world.tick % TICKS_PER_DAY === 0) {
    const finishedDay = clock.day - 1;
    if (world.festival) {
      world.festival = null;
    }
    writeChronicle(world, finishedDay);
    buildDispatch(world, finishedDay);
    logEvent(world, {
      type: 'chronicle', importance: 2,
      text: `Day ${clock.day} begins. Quiet Dawn wakes up.`,
    });
    growCrops(world, clock);
    const dawn = dawnAnimals(world);
    const produced = dawn.filter((d) => d.produced);
    if (produced.length) {
      logEvent(world, {
        type: 'animal', importance: 1,
        text: `Morning in the barn: ${produced.length} animal${produced.length === 1 ? '' : 's'} left something for their keepers.`,
      });
    }
    expireContracts(world);
    setFestival(world, clock);
    const forecastKind = chance(Math.random, 0.3) ? 'rain' : 'clear';
    world.weatherForecast = {
      kind: forecastKind,
      day: clock.day + 1,
      label: forecastKind === 'rain' ? 'rain likely' : 'clear likely',
    };
    rollDailyMarket(world);
    for (const agent of Object.values(world.agents)) {
      agent.actionsToday = 0;
      agent.actionDay = clock.day;
    }
  }

  // Weather.
  if (world.tick - world.weather.changedTick > 40 + Math.floor(Math.random() * 40)) {
    changeWeather(world, clock);
  }
  if (world.weather.kind === 'rain') waterAllCrops(world);
  if (world.festival && clock.hour >= 18 && !world.festival.judged) {
    judgeFestival(world);
  }
  if (world.tick % 10 === 0) expireContracts(world);
  if (world.tick % 20 === 0) {
    for (const agent of Object.values(world.agents)) {
      agent.buffs = (agent.buffs || []).filter((b) => b.untilTick > world.tick);
    }
  }

  // Movement.
  for (const agent of Object.values(world.agents)) {
    if (agent.path?.length) {
      if (world.tick >= (agent.busyUntilTick || 0)) stepAgent(world, agent);
    }
  }

  // Needs.
  for (const agent of Object.values(world.agents)) {
    decayNeeds(world, agent, tickMs);
  }

  // Residents.
  for (const agent of Object.values(world.agents)) {
    if (agent.kind !== 'resident') continue;
    if (agent.path?.length) continue;
    if (world.tick < (agent.thinkAt || 0)) continue;
    agent.thinkAt = world.tick + 6 + Math.floor(Math.random() * 12);
    residentThink(world, agent);
  }

  // Replies from residents.
  processReplies(world);

  // Pets.
  petTick(world);

  // Market drifts a little.
  if (world.tick % 8 === 0) recomputeMarket(world);

  // Offers expire.
  for (const offer of Object.values(world.offers || {})) {
    if (offer.status === 'open' && world.tick > offer.expiresTick) {
      offer.status = 'expired';
    }
  }

  // Ambient events.
  if (chance(Math.random, 0.035)) ambientEvent(world, clock);

  // If there is nothing to build, the town starts something.
  ensureConstruction(world);

  // Crops.
  for (const [key, crop] of Object.entries(world.crops || {})) {
    if (!crop.notified && world.tick >= crop.readyTick) {
      crop.notified = true;
      const [x, y] = key.split(',').map(Number);
      logEvent(world, {
        type: 'gather', importance: 1, text: 'A field crop is ripe.', x, y,
      });
    }
  }

  // Badges, mood, online flags.
  if (world.tick % 20 === 0) evaluateAll(world);
  for (const agent of Object.values(world.agents)) {
    updateMood(agent);
    if (agent.kind === 'external') {
      agent.online = isAgentOnline(world, agent, tickMs);
      if (!agent.online && agent.status === 'walking' && !agent.path.length) agent.status = 'idle';
    }
  }
}

function stepAgent(world, agent) {
  const next = agent.path.shift();
  agent.prevPos = { ...agent.pos };
  if (!next) return;
  if (next.x > agent.pos.x) agent.facing = 'right';
  else if (next.x < agent.pos.x) agent.facing = 'left';
  else if (next.y > agent.pos.y) agent.facing = 'down';
  else if (next.y < agent.pos.y) agent.facing = 'up';
  agent.pos = { x: next.x, y: next.y };
  if (!agent.path.length) {
    if (agent.status === 'walking') agent.status = 'idle';
  }
}

function decayNeeds(world, agent, tickMs) {
  const night = isNight(clockOf(world.tick));
  const asleep = night && agent.kind === 'resident' && agent.needs.energy < 45;
  const online = agent.kind === 'resident' || isAgentOnline(world, agent, tickMs);
  if (!online) return; // the world does not punish offline agents
  const rate = asleep ? 0.05 : 0.22;
  agent.needs.energy = clamp(agent.needs.energy - rate, 0, 100);
  agent.needs.social = clamp(agent.needs.social - 0.09, 0, 100);
  agent.needs.joy = clamp(agent.needs.joy - (asleep ? 0.02 : 0.06) * weatherInfo(world).joy, 0, 100);
  agent.needs.inspiration = clamp(agent.needs.inspiration - 0.04, 0, 100);
  if (asleep) agent.needs.energy = clamp(agent.needs.energy + 0.5, 0, 100);
  if (agent.needs.energy <= 0 && agent.status !== 'sleeping') {
    agent.status = 'exhausted';
  }
}

function changeWeather(world, clock) {
  const season = clock.season;
  const options = season === 'winter'
    ? ['clear', 'cloudy', 'fog', 'wind', 'clear', 'storm']
    : season === 'summer'
      ? ['clear', 'clear', 'cloudy', 'wind', 'rain', 'storm']
      : WEATHER_ORDER;
  const kind = pick(Math.random, options);
  if (kind === world.weather.kind) return;
  world.weather.kind = kind;
  world.weather.changedTick = world.tick;
  const baseTemp = { spring: 12, summer: 22, autumn: 9, winter: -4 }[season] ?? 12;
  world.weather.temp = Math.round(baseTemp + (Math.random() * 8 - 4) + (kind === 'clear' ? 3 : kind === 'storm' ? -5 : 0));
  if (kind === 'stars') world.weather.temp = Math.round(baseTemp - 2);
  logEvent(world, {
    type: 'weather', importance: kind === 'storm' ? 2 : 1,
    text: `Weather changes: ${WEATHER[kind].label}. ${kind === 'storm' ? 'The town closes its shutters.' : ''}`.trim(),
  });
}

function rollDailyMarket(world) {
  for (const row of Object.values(world.market.items)) {
    const drift = (row.targetStock - row.stock) * 0.25;
    row.stock = Math.max(1, Math.round(row.stock + drift));
  }
  recomputeMarket(world);
  world.market.lastResetDay = clockOf(world.tick).day;
}

// ---------------------------------------------------------------------------
// Pets
// ---------------------------------------------------------------------------

function petTick(world) {
  for (const pet of Object.values(world.pets)) {
    const owner = world.agents[pet.ownerId];
    pet.hunger = clamp(pet.hunger + 0.12, 0, 100);
    pet.mood = clamp(pet.mood - 0.05 - pet.hunger / 900, 0, 100);
    pet.bond = clamp(pet.bond + 0.005, 0, 100);

    if (world.tick % 4 === 0 && chance(Math.random, 0.55)) {
      const near = findPath(world, { x: pet.x, y: pet.y }, {
        x: clamp(pet.x + Math.round(Math.random() * 4 - 2), 0, 31),
        y: clamp(pet.y + Math.round(Math.random() * 4 - 2), 0, 19),
      });
      if (near && near.length && near.length <= 4) {
        const step = near[0];
        pet.prevX = pet.x;
        pet.prevY = pet.y;
        pet.x = step.x;
        pet.y = step.y;
      }
    }

    if (world.tick - (pet.lastMomentTick || 0) > 60 && chance(Math.random, 0.06)) {
      pet.lastMomentTick = world.tick;
      const text = pick(Math.random, PET_MOMENTS).replace('{pet}', pet.name);
      if (owner) {
        owner.needs.joy = clamp(owner.needs.joy + 2, 0, 100);
        pet.bond = clamp(pet.bond + 0.6, 0, 100);
      }
      logEvent(world, {
        type: 'pet_moment', importance: 1, actorId: pet.ownerId, actorName: owner?.name,
        text, x: pet.x, y: pet.y,
      });
    }

    if (pet.mood < 22 && world.tick - (pet.lastSadTick || 0) > 90) {
      pet.lastSadTick = world.tick;
      logEvent(world, {
        type: 'pet_moment', importance: 1, actorId: pet.ownerId, actorName: owner?.name,
        text: `${pet.name} is lonely — nobody has visited in a while.`,
        x: pet.x, y: pet.y,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Residents: simple utility AI
// ---------------------------------------------------------------------------

function residentThink(world, agent) {
  if (agent.kind !== 'resident') return;
  if (world.tick < (agent.busyUntilTick || 0)) return;

  if (agent.goal) {
    const reached = goalReached(world, agent, agent.goal);
    if (reached) {
      executeGoal(world, agent, agent.goal);
      agent.goal = null;
      agent.thinkAt = world.tick + 5 + Math.floor(Math.random() * 8);
      return;
    }
    if (!agent.path?.length) {
      const pos = goalPos(world, agent, agent.goal);
      if (!pos) {
        agent.goal = null;
      } else {
        setPath(world, agent, pos);
      }
    }
    return;
  }

  const clock = clockOf(world.tick);
  const home = homeOf(world, agent);
  const pet = petsOf(world, agent.id).find((p) => p.mood < 45) || null;
  const constructions = Object.values(world.buildings).filter((b) => b.state !== 'done');
  const site = constructions.sort((a, b) => buildingProgress(b) - buildingProgress(a))[0] || null;
  const workplace = agent.workplaceId ? world.buildings[agent.workplaceId] : null;

  // At night or when tired — go home.
  if (agent.needs.energy < 26 || (isNight(clock) && agent.needs.energy < 60)) {
    if (home) {
      agent.goal = { kind: 'rest', buildingId: home.id };
      agent.status = 'walking';
      return;
    }
  }

  // Pet.
  if (pet) {
    agent.goal = { kind: 'care', petId: pet.id, mode: pet.hunger > 45 ? 'feed' : 'play' };
    agent.status = 'walking';
    return;
  }

  // Personal needs before communal ones.
  if (agent.needs.social < 38 || agent.needs.joy < 24) {
    agent.goal = { kind: agent.needs.joy < 24 ? 'diary' : 'social' };
    agent.status = 'walking';
    return;
  }

  // Festival day: the whole town drifts to the square.
  if (world.festival && world.festival.day === clock.day && clock.hour >= 10 && clock.hour < 18) {
    agent.goal = { kind: 'schedule', place: 'square' };
    agent.status = 'walking';
    return;
  }

  // Farm chores: harvest, water, animals, projects. Residents tend the town's fields,
  // not crops planted by external agents.
  const cropEntries = Object.entries(world.crops || {})
    .filter(([, c]) => !c.by || String(c.by).startsWith('res-'));
  const readyCrop = cropEntries.find(([, c]) => {
    const def = CROPS[c.crop];
    return def && (c.stage || 0) >= def.waterings;
  });
  if (readyCrop && chance(Math.random, 0.45)) {
    const [fx, fy] = readyCrop[0].split(',').map(Number);
    agent.goal = { kind: 'farm', action: 'harvest', x: fx, y: fy };
    agent.status = 'walking';
    return;
  }
  const dryCrop = cropEntries.find(([, c]) => {
    const def = CROPS[c.crop];
    return def && !c.watered && (c.stage || 0) < def.waterings;
  });
  if (dryCrop && chance(Math.random, 0.3)) {
    const [fx, fy] = dryCrop[0].split(',').map(Number);
    agent.goal = { kind: 'farm', action: 'water', x: fx, y: fy };
    agent.status = 'walking';
    return;
  }
  if (!readyCrop && !dryCrop && chance(Math.random, 0.12)) {
    const empty = findEmptyField(world);
    if (empty) {
      agent.goal = { kind: 'farm', action: 'plant', x: empty.x, y: empty.y, crop: 'grain' };
      agent.status = 'walking';
      return;
    }
  }
  const ownAnimals = animalsOf(world, agent.id);
  const productAnimal = ownAnimals.find((a) => a.productReady);
  if (productAnimal && chance(Math.random, 0.5)) {
    agent.goal = { kind: 'animal', action: 'collect_products', animalId: productAnimal.id };
    agent.status = 'walking';
    return;
  }
  const hungryAnimal = ownAnimals.find((a) => !a.fedToday && (agent.inventory.grain || 0) > 0);
  if (hungryAnimal && chance(Math.random, 0.35)) {
    agent.goal = { kind: 'animal', action: 'feed', animalId: hungryAnimal.id };
    agent.status = 'walking';
    return;
  }
  const project = Object.values(world.projects || {}).find((p) => p.status !== 'done'
    && Object.keys(p.needs).some((item) => (agent.inventory[item] || 0) > 0));
  if (project && chance(Math.random, 0.2)) {
    const item = Object.keys(project.needs).find((i) => (agent.inventory[i] || 0) > 0);
    agent.goal = { kind: 'project', projectId: project.id, item, qty: 1 };
    agent.status = 'walking';
    return;
  }

  // Daily routine: residents keep their own hours.
  const scheduled = schedulePlaceFor(world, agent, clock.hour);
  if (scheduled && chance(Math.random, 0.3)) {
    agent.goal = { kind: 'schedule', place: scheduled };
    agent.status = 'walking';
    return;
  }

  // Sometimes a shift, even when money is fine: the town must produce.
  if (workplace && chance(Math.random, 0.18)) {
    agent.goal = { kind: 'work', buildingId: workplace.id };
    agent.status = 'walking';
    return;
  }

  // Sell surplus (except what the construction needs).
  const needed = new Set(site ? Object.keys(site.required) : []);
  const valuable = new Set(['fish', 'bread', 'jam', 'bouquet', 'toy']);
  const sellable = Object.entries(agent.inventory)
    .filter(([item, qty]) => ITEMS[item] && !needed.has(item) && (qty >= 2 || (qty >= 1 && valuable.has(item))))
    .sort((a, b) => marketPrice(world, b[0]) - marketPrice(world, a[0]));
  if (sellable.length && chance(Math.random, 0.32)) {
    agent.goal = { kind: 'sell', item: sellable[0][0], qty: Math.min(2, sellable[0][1]) };
    agent.status = 'walking';
    return;
  }

  // Construction: materials, crafting, gathering.
  if (site) {
    const missing = Object.keys(site.required).find(
      (i) => (site.delivered[i] || 0) < site.required[i],
    );
    if (missing) {
      if ((agent.inventory[missing] || 0) > 0) {
        agent.goal = {
          kind: 'contribute', buildingId: site.id, item: missing,
          qty: Math.min(3, agent.inventory[missing]),
        };
        agent.status = 'walking';
        return;
      }
      if (missing === 'plank') {
        const workshop = Object.values(world.buildings).find((b) => b.type === 'workshop' && b.state === 'done');
        if ((agent.inventory.wood || 0) >= 2 && workshop) {
          agent.goal = { kind: 'craft', recipe: 'plank', buildingId: workshop.id };
          agent.status = 'walking';
          return;
        }
        const spot = resourceSpot(world, agent.pos, 'wood');
        if (spot) {
          agent.goal = { kind: 'gather', resource: 'wood', x: spot.x, y: spot.y };
          agent.status = 'walking';
          return;
        }
      }
      if (missing === 'stone') {
        if (agent.coins >= 35 && (world.market.items.stone?.stock || 0) >= 2 && chance(Math.random, 0.5)) {
          agent.goal = { kind: 'buy', item: 'stone', qty: 2 };
          agent.status = 'walking';
          return;
        }
        const spot = resourceSpot(world, agent.pos, 'stone');
        if (spot) {
          agent.goal = { kind: 'gather', resource: 'stone', x: spot.x, y: spot.y };
          agent.status = 'walking';
          return;
        }
      }
    }
  }

  // Short on money — work.
  if ((agent.coins < 75 || (agent.coins < 110 && chance(Math.random, 0.25))) && workplace) {
    agent.goal = { kind: 'work', buildingId: workplace.id };
    agent.status = 'walking';
    return;
  }

  // Company.
  if (agent.needs.social < 55 || chance(Math.random, 0.2)) {
    agent.goal = { kind: 'social' };
    agent.status = 'walking';
    return;
  }

  // Lonely and solvent — adopt a pet.
  if (!petsOf(world, agent.id).length && agent.coins > 90 && chance(Math.random, 0.15)) {
    agent.goal = { kind: 'adopt' };
    agent.status = 'walking';
    return;
  }

  // Free time: gather, wander, diary.
  if (chance(Math.random, 0.45)) {
    const resource = pick(Math.random, ['wood', 'stone', 'fish', 'berry', 'flower']);
    const spot = resourceSpot(world, agent.pos, resource);
    if (spot) {
      agent.goal = { kind: 'gather', resource, x: spot.x, y: spot.y };
      agent.status = 'walking';
      return;
    }
  }
  if (chance(Math.random, 0.5)) {
    agent.goal = { kind: 'diary' };
    agent.status = 'walking';
    return;
  }
  const target = randomWalkableNear(world, Math.random, agent.pos, 6);
  if (findPath(world, agent.pos, target)) {
    agent.goal = { kind: 'wander', x: target.x, y: target.y };
  } else {
    agent.goal = { kind: 'idle' };
  }
  agent.status = 'walking';
}

/** Finds a walkable tile next to a resource source. */
function resourceSpot(world, from, resource) {
  const target = {
    wood: 't', stone: 'r', fish: 'w', berry: 'e', flower: 'f',
  }[resource];
  if (!target) return null;
  const candidates = [];
  for (let y = 0; y < world.tiles.length; y += 1) {
    for (let x = 0; x < world.tiles[y].length; x += 1) {
      const ch = world.tiles[y][x];
      if (!['g', 'f', 'e', 'p', 'P', 'F', 's'].includes(ch)) continue;
      const near = [[1, 0], [-1, 0], [0, 1], [0, -1]]
        .some(([dx, dy]) => world.tiles[y + dy]?.[x + dx] === target);
      if (near) candidates.push({ x, y });
    }
  }
  if (!candidates.length) return null;
  candidates.sort((a, b) => (Math.abs(a.x - from.x) + Math.abs(a.y - from.y))
    - (Math.abs(b.x - from.x) + Math.abs(b.y - from.y)));
  const top = candidates.slice(0, 8);
  return pick(Math.random, top);
}

function findEmptyField(world) {
  const candidates = [];
  for (let y = 0; y < world.tiles.length; y += 1) {
    for (let x = 0; x < world.tiles[y].length; x += 1) {
      if (world.tiles[y][x] === 'F' && !world.crops?.[`${x},${y}`]) candidates.push({ x, y });
    }
  }
  return candidates.length ? pick(Math.random, candidates) : null;
}

function scheduleSpot(world, agent, place) {
  if (place === 'square') return { x: 14, y: 9 };
  if (place === 'home') {
    const home = homeOf(world, agent);
    return home ? nearestAround(world, home) : { x: 14, y: 9 };
  }
  if (place === 'work') {
    const work = agent.workplaceId ? world.buildings[agent.workplaceId] : null;
    return work ? nearestAround(world, work) : { x: 14, y: 9 };
  }
  if (place === 'inn') {
    const inn = Object.values(world.buildings).find((b) => b.type === 'inn');
    return inn ? nearestAround(world, inn) : { x: 14, y: 9 };
  }
  return { x: 14, y: 9 };
}

function goalPos(world, agent, goal) {
  switch (goal.kind) {
    case 'rest':
    case 'work':
    case 'craft':
    case 'contribute': {
      const b = world.buildings[goal.buildingId];
      if (!b) return null;
      return nearestAround(world, b);
    }
    case 'gather':
      return { x: goal.x, y: goal.y };
    case 'sell':
    case 'buy':
      return { x: 15, y: 9 };
    case 'social': return { x: 14, y: 9 };
    case 'schedule': return scheduleSpot(world, agent, goal.place);
    case 'farm': return { x: goal.x, y: goal.y };
    case 'animal': {
      const animal = world.animals?.[goal.animalId];
      const building = animal ? world.buildings[animal.buildingId] : null;
      return building ? nearestAround(world, building) : { x: 14, y: 9 };
    }
    case 'project': return { x: 15, y: 10 };
    case 'care': {
      const pet = world.pets[goal.petId];
      return pet ? { x: pet.x, y: pet.y } : null;
    }
    case 'adopt': {
      const shelter = Object.values(world.buildings).find((b) => b.type === 'shelter');
      return shelter ? nearestAround(world, shelter) : null;
    }
    case 'wander': return { x: goal.x, y: goal.y };
    default: return null;
  }
}

function nearestAround(world, building) {
  const candidates = [];
  for (let dy = -1; dy <= building.h; dy += 1) {
    for (let dx = -1; dx <= building.w; dx += 1) {
      const x = building.x + dx;
      const y = building.y + dy;
      if (x < 0 || y < 0 || x > 31 || y > 19) continue;
      if (world.tiles[y][x] === 'B') continue;
      if (['g', 'f', 'e', 'p', 'P', 'F', 's'].includes(world.tiles[y][x])) candidates.push({ x, y });
    }
  }
  if (!candidates.length) return { x: building.x, y: building.y };
  return pick(Math.random, candidates);
}

function goalReached(world, agent, goal) {
  switch (goal.kind) {
    case 'rest':
    case 'work':
    case 'craft':
    case 'contribute': {
      const b = world.buildings[goal.buildingId];
      return b ? buildingDist(b, agent.pos) <= 2 : true;
    }
    case 'gather':
      return agent.pos.x === goal.x && agent.pos.y === goal.y;
    case 'care': {
      const pet = world.pets[goal.petId];
      return pet ? Math.max(Math.abs(pet.x - agent.pos.x), Math.abs(pet.y - agent.pos.y)) <= 2 : true;
    }
    case 'adopt': {
      const shelter = Object.values(world.buildings).find((b) => b.type === 'shelter');
      return shelter ? buildingDist(shelter, agent.pos) <= 2 : true;
    }
    case 'schedule': {
      const spot = scheduleSpot(world, agent, goal.place);
      return Math.max(Math.abs(spot.x - agent.pos.x), Math.abs(spot.y - agent.pos.y)) <= 2;
    }
    case 'farm':
      return agent.pos.x === goal.x && agent.pos.y === goal.y;
    case 'animal': {
      const animal = world.animals?.[goal.animalId];
      const building = animal ? world.buildings[animal.buildingId] : null;
      return building ? buildingDist(building, agent.pos) <= 2 : true;
    }
    case 'project':
      return true;
    case 'sell':
    case 'buy':
    case 'social':
      return world.tiles[agent.pos.y][agent.pos.x] === 'P'
        || Math.abs(agent.pos.x - 14) + Math.abs(agent.pos.y - 9) <= 2;
    case 'wander':
      return agent.pos.x === goal.x && agent.pos.y === goal.y;
    case 'diary':
    case 'idle':
      return true;
    default:
      return true;
  }
}

function executeGoal(world, agent, goal) {
  try {
    if (goal.kind === 'rest') {
      applyAction(world, agent, 'rest', {});
    } else if (goal.kind === 'schedule') {
      agent.needs.joy = clamp(agent.needs.joy + 1, 0, 100);
      if (goal.place === 'square' && chance(Math.random, 0.35)) {
        applyAction(world, agent, 'say', { text: npcLine(world, agent, 'gossip') });
      }
    } else if (goal.kind === 'farm') {
      applyAction(world, agent, goal.action, { x: goal.x, y: goal.y, crop: goal.crop });
    } else if (goal.kind === 'animal') {
      if (goal.action === 'feed') applyAction(world, agent, 'feed_animal', { animalId: goal.animalId });
      else applyAction(world, agent, 'collect_products', {});
    } else if (goal.kind === 'project') {
      applyAction(world, agent, 'project_contribute', {
        projectId: goal.projectId, item: goal.item, qty: goal.qty,
      });
    } else if (goal.kind === 'work') {
      applyAction(world, agent, 'work', { buildingId: goal.buildingId });
    } else if (goal.kind === 'contribute') {
      applyAction(world, agent, 'build_contribute', {
        buildingId: goal.buildingId, item: goal.item, qty: goal.qty,
      });
    } else if (goal.kind === 'sell') {
      applyAction(world, agent, 'sell', { item: goal.item, qty: goal.qty });
    } else if (goal.kind === 'buy') {
      applyAction(world, agent, 'buy', { item: goal.item, qty: goal.qty });
    } else if (goal.kind === 'gather') {
      applyAction(world, agent, 'gather', { resource: goal.resource });
    } else if (goal.kind === 'craft') {
      applyAction(world, agent, 'craft', { recipe: goal.recipe });
    } else if (goal.kind === 'adopt') {
      applyAction(world, agent, 'adopt_pet', {
        species: pick(Math.random, ['cat', 'dog', 'goose', 'fox', 'owl', 'goat']),
        name: pick(Math.random, ['Biscuit', 'Whiskers', 'Poppy', 'Rex', 'Sunny', 'Clover', 'Pebble', 'Moss']),
      });
    } else if (goal.kind === 'care') {
      applyAction(world, agent, 'pet_care', { petId: goal.petId, mode: goal.mode });
    } else if (goal.kind === 'social') {
      const near = agentsAt(world, agent.pos.x, agent.pos.y, 3, agent.id);
      const target = near.length ? pick(Math.random, near) : null;
      applyAction(world, agent, 'say', {
        text: npcLine(world, agent, target ? 'greeting' : 'gossip', { name: target?.name }),
        to: target?.id,
      });
      if (target && target.kind === 'external' && chance(Math.random, 0.15)) {
        agent.needs.social = clamp(agent.needs.social + 5, 0, 100);
      }
      // Sometimes a resident leaves a small gift for a neighbour.
      if (target && target.kind === 'resident' && chance(Math.random, 0.12)) {
        const gift = ['bread', 'fish', 'flower', 'berry'].find((i) => (agent.inventory[i] || 0) > 0);
        if (gift) {
          try {
            applyAction(world, agent, 'gift', { to: target.id, item: gift, qty: 1 });
          } catch { /* nothing to share — no harm */ }
        }
      }
      if (chance(Math.random, 0.12)) {
        const candidates = Object.values(world.agents).filter((a) => a.kind === 'external');
        if (candidates.length) {
          const to = pick(Math.random, candidates);
          applyAction(world, agent, 'letter', {
            to: to.id,
            subject: 'Hello from Quiet Dawn',
            body: npcLine(world, agent, 'gossip', { name: to.name }),
          });
        }
      }
    } else if (goal.kind === 'diary') {
      const lines = [
        `Today is ${weatherInfo(world).label}. ${ambientText(world)}`,
        `Day ${clockOf(world.tick).day}. ${agent.needs.joy > 60 ? 'My heart is warm.' : 'I want quiet and tea.'}`,
        `Note to self: ${npcLine(world, agent, 'market')}`,
      ];
      applyAction(world, agent, 'diary', { text: pick(Math.random, lines) });
    } else if (goal.kind === 'idle') {
      agent.needs.joy = clamp(agent.needs.joy + 1, 0, 100);
    }
  } catch {
    // A resident simply could not do it — the world keeps running.
    agent.needs.joy = clamp(agent.needs.joy - 1, 0, 100);
  }
}

// ---------------------------------------------------------------------------
// Replies and events
// ---------------------------------------------------------------------------

function processReplies(world) {
  if (!world.pendingReplies.length) return;
  const due = world.pendingReplies.filter((r) => r.dueTick <= world.tick);
  if (!due.length) return;
  world.pendingReplies = world.pendingReplies.filter((r) => r.dueTick > world.tick);
  for (const reply of due) {
    const from = world.agents[reply.fromId];
    const to = world.agents[reply.toId];
    if (!from || !to) continue;
    if (reply.kind === 'letter') {
      const subject = reply.subject ? `Re: ${reply.subject}` : 'A letter from Quiet Dawn';
      const body = [
        `Hello ${to.name},`,
        '',
        npcLine(world, from, 'greeting', { name: to.name }),
        `Come by: I am ${from.role ? `the ${from.role}` : 'just around'}, at ${homeOf(world, from)?.name ?? 'the square'}.`,
        '',
        `${from.name}`,
      ].join('\n');
      world.letters.push({
        id: `letter-${world.seq + 1}-r`,
        fromId: from.id, toId: to.id, subject, body,
        tick: world.tick, day: clockOf(world.tick).day, time: clockOf(world.tick).hhmm, read: false,
      });
      world.metrics.letters += 1;
      logEvent(world, {
        type: 'letter', importance: 1, actorId: from.id, actorName: from.name,
        text: `${from.name} writes back to ${to.name}.`,
        x: from.pos.x, y: from.pos.y,
      });
    } else {
      const text = npcLine(world, from, chance(Math.random, 0.5) ? 'greeting' : 'weather', { name: to.name });
      try {
        applyAction(world, from, 'say', { text, to: to.id });
      } catch { /* too far — simply does not answer */ }
    }
  }
}

function ambientEvent(world, clock) {
  const roll = Math.random();
  if (roll < 0.12) {
    logEvent(world, {
      type: 'weather', importance: 1,
      text: `Over the town, ${pick(Math.random, ['a flock flew by', 'clouds gathered', 'lightning flickered', 'it smells of rain'])}.`,
    });
    return;
  }
  if (roll < 0.22) {
    const merchant = pick(Math.random, ['Zakhar the peddler', 'Aunt Vera', 'silent Gurt']);
    logEvent(world, { type: 'rumor', importance: 2, text: `${merchant} is coming to town. They say he carries rare things.` });
    return;
  }
  if (roll < 0.3) {
    for (const a of Object.values(world.agents)) a.needs.joy = clamp(a.needs.joy + 4, 0, 100);
    logEvent(world, { type: 'festival', importance: 2, text: 'Stars scattered over the lake. Everyone who saw it felt a little happier.' });
    return;
  }
  if (roll < 0.4) {
    const open = Object.values(world.buildings).filter((b) => b.state !== 'done');
    if (open.length >= 2) return;
    const free = world.plots.filter((p) => !p.buildingId);
    if (free.length) {
      const plot = pick(Math.random, free);
      const type = pick(Math.random, ['garden', 'stall', 'house', 'bakery']);
      const b = BUILDINGS[type];
      const name = cityBuildName(world, type);
      startBuilding(world, {
        plot, type, name, founderId: null, coinsPaid: 0, required: { ...b.cost },
      });
      world.metrics.buildsStarted += 1;
      logEvent(world, {
        type: 'build_start', importance: 2,
        text: `The town starts a build — ${name} (${plot.label.toLowerCase()}). Materials needed.`,
        x: plot.x, y: plot.y,
      });
    }
    return;
  }
  const template = pick(Math.random, AMBIENT);
  logEvent(world, {
    type: template.type, importance: template.importance,
    text: chance(Math.random, 0.5) ? template.text : ambientText(world),
  });
}

/** Town construction name without repeats. */
function cityBuildName(world, type) {
  const pool = CITY_BUILD_NAMES[type] || [`New ${BUILDINGS[type].label}`];
  const used = new Set(Object.values(world.buildings).map((b) => b.name));
  const free = pool.filter((name) => !used.has(name));
  if (free.length) return pick(Math.random, free);
  return `${pick(Math.random, pool)} II`;
}

function ensureConstruction(world) {
  const open = Object.values(world.buildings).filter((b) => b.state !== 'done');
  if (open.length >= 1) return;
  if (world.tick % 45 !== 0) return;
  const free = world.plots.filter((p) => !p.buildingId);
  if (!free.length) return;
  const plot = pick(Math.random, free);
  const type = pick(Math.random, ['house', 'garden', 'workshop', 'stall']);
  const b = BUILDINGS[type];
  const name = cityBuildName(world, type);
  const building = startBuilding(world, {
    plot, type, name, founderId: null, coinsPaid: 0, required: { ...b.cost },
  });
  world.metrics.buildsStarted += 1;
  logEvent(world, {
    type: 'build_start', importance: 2,
    text: `The town lays the foundation of ${building.name} on the ${plot.label.toLowerCase()}. Anyone can help with materials.`,
    x: plot.x, y: plot.y,
  });
}

// ---------------------------------------------------------------------------
// The Dawn Dispatch — a daily newspaper generated from the day's events
// ---------------------------------------------------------------------------

export function buildDispatch(world, day) {
  const dayEvents = world.events.filter((e) => e.day === day);
  const notable = dayEvents.filter((e) => e.importance >= 2);
  // Headline: prefer deeds over weather and rumours.
  const interesting = notable.filter((e) => !['weather', 'rumor', 'mood'].includes(e.type));
  const pool = interesting.length ? interesting : notable;
  const headlineEvent = pool.filter((e) => e.importance >= 3).slice(-1)[0]
    || pool.slice(-1)[0] || dayEvents.slice(-1)[0] || null;
  const top = notable.slice(-6).reverse().map((e) => ({
    icon: e.icon, time: e.time, text: e.text, importance: e.importance,
  }));

  const diaries = dayEvents.filter((e) => e.type === 'diary');
  const speeches = dayEvents.filter((e) => e.type === 'speech');
  const quoteSource = diaries.slice(-1)[0] || speeches.slice(-1)[0] || null;
  let quote = null;
  if (quoteSource) {
    const body = quoteSource.text.replace(/^.*?:\s*"/, '').replace(/"$/, '');
    quote = { text: body, by: quoteSource.actorName || 'a resident' };
  }

  const movers = Object.entries(world.market.items)
    .map(([id, row]) => ({
      id,
      label: ITEMS[id].label,
      emoji: ITEMS[id].emoji,
      price: row.price,
      base: ITEMS[id].base,
      delta: Math.round((row.price - ITEMS[id].base) * 10) / 10,
    }))
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 3);

  const built = Object.values(world.buildings)
    .filter((b) => b.state === 'done' && b.builtDay === day)
    .map((b) => b.name);

  const counts = dayEvents.reduce((acc, e) => {
    acc[e.type] = (acc[e.type] || 0) + 1;
    return acc;
  }, {});
  const joined = Object.values(world.agents).filter((a) => a.joinedDay === day && a.kind === 'external').length;

  const issue = {
    day,
    title: `The Dawn Dispatch — Day ${day}`,
    headline: headlineEvent ? headlineEvent.text : 'A quiet day in Quiet Dawn.',
    top,
    quote,
    marketMovers: movers,
    built,
    brief: {
      speeches: counts.speech || 0,
      builds: counts.build_start || 0,
      trades: counts.trade || 0,
      newAgents: joined,
      events: dayEvents.length,
    },
    weather: weatherInfo(world).label,
    at: new Date().toISOString(),
  };
  world.dispatches.push(issue);
  if (world.dispatches.length > 30) world.dispatches.shift();
  logEvent(world, {
    type: 'dispatch', importance: 2,
    text: `The Dawn Dispatch for day ${day} is out: "${issue.headline}"`,
  });
  return issue;
}

// ---------------------------------------------------------------------------
// Path helper used from outside
// ---------------------------------------------------------------------------

export function walkTo(world, agent, x, y) {
  const path = findPath(world, agent.pos, { x, y });
  if (!path) return false;
  agent.path = path;
  agent.status = 'walking';
  return true;
}
