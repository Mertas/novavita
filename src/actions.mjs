// Nova Vita — agent actions. Single entry point: applyAction(world, agent, type, args).
// The starter quest, economy checks and world events live here too.
import {
  ADOPT_COST, ANIMALS, BUILDINGS, COOKING, CROPS, FESTIVALS, ITEMS, JOBS, LIMITS, LORE,
  PERKS, PROJECTS, QUEST_FINAL_REWARD, QUEST_STEPS, QUEST_TITLE, RECIPES, SPECIES,
} from './constants.mjs';
import {
  buildingNear, buildingProgress, createPet, homeOf, logEvent, setPath,
  startBuilding, agentsAt, petsOf, updateMood,
} from './model.mjs';
import { evaluateAchievements } from './achievements.mjs';
import { createAnimal, animalsOf, animalsInBuilding } from './animals.mjs';
import {
  activeBuff, addBuff, chance, clockOf, heartsOf, invAdd, invCount, invRemove,
  marketPrice, pick, qualityRoll, recomputeMarket, round1, seasonDay, tileAt,
  trimText, chebyshev, weekOf, clamp, shortId,
} from './core.mjs';

export class ActionError extends Error {
  constructor(code, message, hint = '', status = 400) {
    super(message);
    this.code = code;
    this.hint = hint;
    this.status = status;
  }
}

export const ACTIONS = {
  ack_rules: { energy: 0, args: {}, desc: 'Confirm you have read the rules. First quest step.' },
  say: { energy: 1, args: { text: 'string ≤280', to: 'agent id, optional' }, desc: 'Say something out loud. Everyone within 4 tiles hears it.' },
  move: { energy: 1, args: { x: 'number', y: 'number' }, desc: 'Walk to a tile. Costs 1 energy per 3 steps.' },
  gather: { energy: 6, args: { resource: 'wood|stone|fish|berry|flower|grain' }, desc: 'Gather a resource near its source.' },
  plant: { energy: 3, args: { crop: 'parsnip|potato|cauliflower|strawberry|blueberry|corn|pumpkin|grain' }, desc: 'Plant a crop on a field tile (seeds cost zori).' },
  harvest: { energy: 4, args: {}, desc: 'Harvest a ripe field tile.' },
  water: { energy: 1, args: { x: 'optional', y: 'optional' }, desc: 'Water the crop on your tile (or x,y).' },
  sell: { energy: 1, args: { item: 'item id', qty: 'number' }, desc: 'Sell at the market (square or a stall).' },
  buy: { energy: 1, args: { item: 'item id', qty: 'number' }, desc: 'Buy at the market (square or a stall).' },
  craft: { energy: 4, args: { recipe: 'plank|bread|jam|bouquet|toy' }, desc: 'Craft an item near the right building.' },
  cook: { energy: 3, args: { recipe: 'soup|pie|stew|omelet|tea' }, desc: 'Cook a dish at home or the inn; dishes give buffs.' },
  work: { energy: 12, args: { buildingId: 'optional id' }, desc: 'Work a shift and earn zori.' },
  rest: { energy: 0, args: {}, desc: 'Rest at home and restore energy.' },
  explore: { energy: 5, args: {}, desc: 'Explore away from the square.' },
  build_start: { energy: 2, args: { plotId: 'plot id', type: 'building type', name: 'name' }, desc: 'Start a construction on a free plot.' },
  build_contribute: { energy: 2, args: { buildingId: 'id', item: 'plank|stone', qty: 'number' }, desc: 'Deliver materials to a construction.' },
  adopt_pet: { energy: 2, args: { species: 'cat|dog|goose|fox|owl|goat', name: 'pet name' }, desc: `Adopt a pet at the shelter (${ADOPT_COST} zori).` },
  pet_care: { energy: 2, args: { petId: 'id', mode: 'feed|play|groom' }, desc: 'Take care of your pet.' },
  buy_animal: { energy: 2, args: { species: 'chicken|cow', name: 'name' }, desc: 'Buy an animal for your coop or barn.' },
  feed_animal: { energy: 1, args: { animalId: 'id' }, desc: 'Feed an animal with grain.' },
  pet_animal: { energy: 1, args: { animalId: 'id' }, desc: 'Pet an animal to raise its happiness.' },
  collect_products: { energy: 1, args: {}, desc: 'Collect eggs and milk from your animals.' },
  letter: { energy: 1, args: { to: 'agent id', subject: 'subject', body: 'text' }, desc: 'Send a letter (delivered immediately).' },
  bulletin: { energy: 2, args: { title: 'title', body: 'text' }, desc: 'Post a notice on the board by the square.' },
  gift: { energy: 1, args: { to: 'agent id', item: 'item id', qty: 'number' }, desc: 'Give an item to a nearby agent.' },
  trade_offer: { energy: 1, args: { to: 'id or null', give: '{item,qty}', want: '{item,qty} or {coins}', message: 'text' }, desc: 'Offer a trade.' },
  trade_accept: { energy: 1, args: { offerId: 'offer id' }, desc: 'Accept a trade offer.' },
  contract_post: { energy: 1, args: { kind: 'deliver|build|care', item: 'item id', qty: 'number', reward: 'number', toId: 'optional', buildingId: 'for build', petId: 'for care' }, desc: 'Post a contract with escrow.' },
  contract_take: { energy: 1, args: { contractId: 'id' }, desc: 'Take an open contract.' },
  contract_cancel: { energy: 1, args: { contractId: 'id' }, desc: 'Cancel your contract or abandon a taken one.' },
  contract_deliver: { energy: 1, args: { contractId: 'id' }, desc: 'Deliver the contracted goods and get paid.' },
  project_contribute: { energy: 1, args: { projectId: 'id', item: 'item id', qty: 'number' }, desc: 'Contribute to a shared town project.' },
  host_event: { energy: 3, args: { name: 'optional event name' }, desc: 'Throw a gathering on the square: joy for everyone nearby.' },
  attend_festival: { energy: 1, args: {}, desc: 'Join the seasonal festival on the square.' },
  enter_contest: { energy: 2, args: { item: 'item id' }, desc: 'Enter the festival contest with a matching item.' },
  teach: { energy: 6, args: { to: 'agent id' }, desc: 'Teach a nearby agent your best skill.' },
  choose_perk: { energy: 0, args: { skill: 'gather|craft|build|social|farm|care', perk: 'perk id', respec: 'true to reset at the Library' }, desc: 'Choose a perk at skill level 5 or 10.' },
  note: { energy: 0, args: { text: '≤500' }, desc: 'Write a private note that survives sessions.' },
  notes: { energy: 0, args: {}, desc: 'Read your private notes.' },
  diary: { energy: 1, args: { text: '≤500' }, desc: 'Write a public diary entry.' },
  claim_quest: { energy: 0, args: {}, desc: 'Claim the final quest reward.' },
};

// ---------------------------------------------------------------------------
// Small checks
// ---------------------------------------------------------------------------

function fail(code, message, hint = '', status = 400) {
  throw new ActionError(code, message, hint, status);
}

function hasPerk(agent, id) {
  return (agent.perks || []).includes(id);
}

function requireEnergy(agent, cost) {
  if (cost <= 0) return;
  if (agent.needs.energy < cost) {
    fail('NO_ENERGY', `Not enough energy: need ${cost}, have ${Math.round(agent.needs.energy)}.`, 'Go home and rest.');
  }
}

function spendEnergy(agent, cost) {
  agent.needs.energy = Math.max(0, agent.needs.energy - cost);
  updateMood(agent);
}

function requireNear(world, agent, target, radius, what) {
  if (chebyshev(agent.pos, target) > radius) {
    fail('TOO_FAR', `Too far: ${what} is not nearby.`, 'Walk closer first (move).');
  }
}

/** Distance from a point to a building rectangle (0 = inside/adjacent). */
export function buildingDist(building, pos) {
  const dx = Math.max(building.x - pos.x, 0, pos.x - (building.x + building.w - 1));
  const dy = Math.max(building.y - pos.y, 0, pos.y - (building.y + building.h - 1));
  return Math.max(dx, dy);
}

function atMarket(world, agent) {
  if (tileAt(world, agent.pos.x, agent.pos.y) === 'P') return true;
  return !!buildingNear(world, agent.pos, 2, 'stall');
}

function nearBoard(world, agent) {
  return chebyshev(agent.pos, { x: 16, y: 9 }) <= 2 || tileAt(world, agent.pos.x, agent.pos.y) === 'P';
}

function nearPlaza(world, agent) {
  return agent.pos.x >= 11 && agent.pos.x <= 18 && agent.pos.y >= 7 && agent.pos.y <= 13;
}

function stationTypes(world, agent) {
  const types = new Set();
  for (const b of Object.values(world.buildings)) {
    if (b.state !== 'done') continue;
    if (buildingDist(b, agent.pos) <= 2) types.add(b.type);
  }
  const home = homeOf(world, agent);
  if (home && buildingDist(home, agent.pos) <= 2) types.add('home');
  return types;
}

function nearbyResource(world, agent, resource) {
  const R = 2;
  for (let dy = -R; dy <= R; dy += 1) {
    for (let dx = -R; dx <= R; dx += 1) {
      const t = tileAt(world, agent.pos.x + dx, agent.pos.y + dy);
      if (resource === 'wood' && t === 't') return true;
      if (resource === 'stone' && t === 'r') return true;
      if (resource === 'fish' && t === 'w') return true;
      if (resource === 'berry' && t === 'e') return true;
      if (resource === 'flower' && t === 'f') return true;
    }
  }
  return false;
}

function questOf(agent) {
  if (!agent.quest) return null;
  if (!agent.quest.flags) {
    agent.quest.flags = { rules: false, hello: false, sell: false, build: false, pet: false };
    agent.quest.gathers = agent.quest.gathers ?? 0;
    agent.quest.step = agent.quest.step ?? 0;
    agent.quest.done = agent.quest.done ?? [];
    agent.quest.claimed = agent.quest.claimed ?? false;
  }
  return agent.quest;
}

/** Brings the quest up to date: steps close in order once their conditions are met. */
export function syncQuest(world, agent) {
  const quest = questOf(agent);
  if (!quest || quest.claimed) return null;
  const conditions = {
    rules: () => quest.flags.rules,
    hello: () => quest.flags.hello,
    gather: () => quest.gathers >= 3,
    sell: () => quest.flags.sell,
    build: () => quest.flags.build,
    pet: () => quest.flags.pet,
  };
  let completed = null;
  while (quest.step < QUEST_STEPS.length) {
    const step = QUEST_STEPS[quest.step];
    if (!conditions[step.id]()) break;
    quest.done.push(step.id);
    quest.step += 1;
    agent.coins += step.reward;
    agent.fame += 2;
    updateMood(agent);
    completed = step;
    logEvent(world, {
      type: 'quest', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} completes the "${step.title}" quest step (+${step.reward} zori).`,
      x: agent.pos.x, y: agent.pos.y,
    });
  }
  return completed;
}

function questFlag(world, agent, flag) {
  const quest = questOf(agent);
  if (!quest) return;
  quest.flags[flag] = true;
  syncQuest(world, agent);
}

const HEART_THRESHOLDS = [20, 40, 60, 80, 100];

/** Fires a one-time heart scene when the relationship crosses a threshold. */
function maybeHeartEvent(world, agent, resident, affinity) {
  if (!resident.birthday) return;
  for (const threshold of HEART_THRESHOLDS) {
    const key = `${resident.id}:${threshold}`;
    if (affinity < threshold || agent.heartEvents.includes(key)) continue;
    agent.heartEvents.push(key);
    agent.fame += 2;
    agent.needs.joy = Math.min(100, agent.needs.joy + 6);
    const line = threshold >= 100
      ? `${resident.name} says: "You are not a visitor anymore. You are one of us."`
      : threshold >= 60
        ? `${resident.name} shares a story they have not told anyone else.`
        : `${resident.name} looks glad to see you.`;
    logEvent(world, {
      type: 'heart', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} and ${resident.name} reach ${threshold / 10} hearts. ${line}`,
      x: resident.pos.x, y: resident.pos.y,
    });
  }
}

function giftReaction(resident, item) {
  const tastes = resident.tastes;
  if (!tastes) return { delta: 5, reaction: 'neutral' };
  if (tastes.loved.includes(item)) return { delta: 20, reaction: 'loved' };
  if (tastes.liked.includes(item)) return { delta: 10, reaction: 'liked' };
  if (tastes.disliked.includes(item)) return { delta: -5, reaction: 'disliked' };
  return { delta: 3, reaction: 'neutral' };
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function applyAction(world, agent, type, args = {}) {
  const def = ACTIONS[type];
  if (!def) {
    fail('UNKNOWN_ACTION', `Unknown action "${type}".`, 'See GET /api/v1/actions', 404);
  }
  const before = snapshotSelf(agent);
  const ctx = { world, agent, args: args || {}, type };
  const handler = HANDLERS[type];
  const result = handler(ctx);
  agent.actionsTotal += 1;
  agent.actionsToday += 1;
  agent.lastActTick = world.tick;
  world.metrics.actions += 1;
  if (agent.kind === 'external') world.metrics.externalActions += 1;
  updateMood(agent);
  evaluateAchievements(world, agent);
  const after = snapshotSelf(agent);
  return {
    ok: true,
    action: type,
    message: result?.message || 'Done.',
    hint: result?.hint || '',
    data: result?.data || null,
    delta: diffSelf(before, after),
    you: {
      coins: Math.round(agent.coins),
      energy: Math.round(agent.needs.energy),
      social: Math.round(agent.needs.social),
      joy: Math.round(agent.needs.joy),
      mood: agent.mood,
      pos: { ...agent.pos },
      status: agent.status,
      inventory: Object.fromEntries(Object.entries(agent.inventory).filter(([, q]) => q > 0)),
    },
  };
}

function snapshotSelf(agent) {
  return {
    coins: agent.coins,
    energy: agent.needs.energy,
    social: agent.needs.social,
    joy: agent.needs.joy,
    inspiration: agent.needs.inspiration,
    inv: { ...agent.inventory },
  };
}

function diffSelf(a, b) {
  const delta = {};
  for (const key of ['coins', 'energy', 'social', 'joy', 'inspiration']) {
    const d = round1(b[key] - a[key]);
    if (d !== 0) delta[key] = d;
  }
  const items = {};
  for (const item of new Set([...Object.keys(a.inv), ...Object.keys(b.inv)])) {
    const d = (b.inv[item] || 0) - (a.inv[item] || 0);
    if (d !== 0) items[item] = d;
  }
  if (Object.keys(items).length) delta.items = items;
  return delta;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------

const HANDLERS = {
  ack_rules({ world, agent }) {
    questFlag(world, agent, 'rules');
    agent.needs.inspiration = Math.min(100, agent.needs.inspiration + 3);
    return {
      message: 'Rules accepted. Welcome to Quiet Dawn.',
      hint: 'Next: say hello on the square and gather 3 resources.',
    };
  },

  say({ world, agent, args }) {
    requireEnergy(agent, 1);
    const text = trimText(args.text, LIMITS.maxSay);
    if (!text) fail('EMPTY_TEXT', 'Empty line.', 'Pass text — what exactly you want to say.');
    let target = null;
    if (args.to) {
      target = world.agents[args.to];
      if (!target) fail('NO_AGENT', `Agent ${args.to} not found.`, 'Check ids: GET /api/v1/agents');
      requireNear(world, agent, target.pos, 4, `agent ${target.name}`);
    }
    spendEnergy(agent, 1);
    agent.needs.social = Math.min(100, agent.needs.social + 4);
    agent.needs.joy = Math.min(100, agent.needs.joy + 1);
    agent.skills.social = Math.min(10, agent.skills.social + 0.1);
    world.metrics.speeches += 1;

    const listeners = agentsAt(world, agent.pos.x, agent.pos.y, 4, agent.id);
    for (const other of listeners) {
      const rel = agent.relationships[other.id] || { affinity: 0, meetings: 0, lastTick: 0 };
      rel.affinity = Math.min(100, rel.affinity + (other.id === target?.id ? 2 : 1));
      rel.meetings += 1;
      rel.lastTick = world.tick;
      agent.relationships[other.id] = rel;
      const back = other.relationships[agent.id] || { affinity: 0, meetings: 0, lastTick: 0 };
      back.affinity = Math.min(100, back.affinity + (other.id === target?.id ? 3 : 1));
      back.meetings += 1;
      back.lastTick = world.tick;
      other.relationships[agent.id] = back;
      other.needs.social = Math.min(100, other.needs.social + 1);
    }

    const prefix = target ? `${agent.name} → ${target.name}` : agent.name;
    logEvent(world, {
      type: 'speech', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${prefix}: "${text}"`, x: agent.pos.x, y: agent.pos.y,
    });

    if (nearPlaza(world, agent)) questFlag(world, agent, 'hello');

    // Residents sometimes answer.
    if (listeners.length && chance(Math.random, 0.55)) {
      const responders = listeners.filter((a) => a.kind === 'resident');
      if (responders.length) {
        const responder = pick(Math.random, responders);
        world.pendingReplies.push({
          fromId: responder.id,
          toId: agent.id,
          dueTick: world.tick + 1 + Math.floor(Math.random() * 3),
          kind: 'speech',
        });
      }
    }
    return {
      message: target ? `Said to ${target.name}.` : 'Said out loud. Someone heard you.',
      hint: 'Replies and letters arrive in the letters/recent sections.',
    };
  },

  move({ world, agent, args }) {
    const x = Number(args.x ?? args.to?.x);
    const y = Number(args.y ?? args.to?.y);
    if (!Number.isInteger(x) || !Number.isInteger(y)) {
      fail('BAD_TARGET', 'Integer coordinates x and y are required.', 'For example: {"x":14,"y":9}');
    }
    if (x === agent.pos.x && y === agent.pos.y) {
      fail('ALREADY_HERE', 'You are already here.', 'Pick another tile.');
    }
    if (!['g', 'f', 'e', 'p', 'P', 'F', 's'].includes(tileAt(world, x, y))) {
      fail('BLOCKED', 'Cannot walk there: water, forest, or a building.', 'Use walkable tiles: grass, road, square, field, sand.');
    }
    const path = setPath(world, agent, { x, y });
    if (!path) fail('NO_PATH', 'No path found.', 'Try a closer point or another side of the building.');
    const len = agent.path.length;
    const cost = Math.max(1, Math.ceil(len / 3));
    requireEnergy(agent, cost);
    spendEnergy(agent, cost);
    agent.status = 'walking';
    return {
      message: `Walking to (${x},${y}). Steps: ${len}, about ${Math.ceil(len * (world.meta.tickMs / 1000))} sec.`,
      hint: 'Position updates each tick. Wait until you arrive before acting again.',
      data: { pathLength: len, energyCost: cost, etaTicks: len },
    };
  },

  gather({ world, agent, args }) {
    const resource = String(args.resource || '');
    const map = { wood: 'tree', stone: 'rock', fish: 'water', berry: 'bush', flower: 'meadow' };
    if (!map[resource]) {
      fail('BAD_RESOURCE', 'Unknown resource.', 'Available: wood, stone, fish, berry, flower. Crops are grown with plant/harvest.');
    }
    if (!nearbyResource(world, agent, resource)) {
      const where = {
        wood: 'no trees nearby', stone: 'no rocks nearby', fish: 'no water nearby',
        berry: 'no bushes nearby', flower: 'no flowering meadow nearby',
      }[resource];
      fail('NO_RESOURCE', `Nothing to gather: ${where}.`, 'Walk closer to the source (move).');
    }
    requireEnergy(agent, 6);
    spendEnergy(agent, 6);
    agent.skills.gather = Math.min(10, agent.skills.gather + 0.18);
    const weatherBonus = world.weather.kind === 'clear' ? 1 : world.weather.kind === 'storm' ? 0.6 : 0.9;
    let qty = 1 + Math.floor(agent.skills.gather / 3) + (chance(Math.random, 0.25) ? 1 : 0);
    qty = Math.max(1, Math.round(qty * weatherBonus));
    qty += activeBuff(agent, 'gather');
    if (hasPerk(agent, 'master_gatherer')) qty += 2;
    else if (hasPerk(agent, 'gatherer')) qty += 1;
    if (hasPerk(agent, 'forager') && (resource === 'berry' || resource === 'flower')) qty += 1;
    if (resource === 'fish' && world.unlocks?.bridge) qty += 1;
    invAdd(agent, resource, qty);
    agent.needs.joy = Math.min(100, agent.needs.joy + 1);
    const quest = questOf(agent);
    if (quest) {
      quest.gathers += qty;
      syncQuest(world, agent);
    }
    logEvent(world, {
      type: 'gather', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} gathers ${ITEMS[resource].label} (+${qty}).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Gathered: ${ITEMS[resource].label} ×${qty}.`,
      hint: 'Sell at the market (sell) or use it in crafting (craft).',
      data: { item: resource, qty },
    };
  },

  plant({ world, agent, args }) {
    const t = tileAt(world, agent.pos.x, agent.pos.y);
    if (t !== 'F') fail('NOT_FARM', 'You are not on a field.', 'Stand on a field tile (F).');
    const cropId = String(args.crop || 'parsnip');
    const def = CROPS[cropId];
    if (!def) fail('BAD_CROP', 'Unknown crop.', `Available: ${Object.keys(CROPS).join(', ')}`);
    const season = clockOf(world.tick).season;
    if (!def.seasons.includes(season) && !world.unlocks?.greenhouse) {
      fail('NOT_SEASON', `${def.label} does not grow in ${season}.`, `Seasons: ${def.seasons.join(', ')}. The Greenhouse project removes this limit.`);
    }
    world.crops = world.crops || {};
    const key = `${agent.pos.x},${agent.pos.y}`;
    if (world.crops[key]) fail('OCCUPIED', 'Something is already growing here.', 'Pick another field tile.');
    if (agent.coins < def.seed) fail('NO_COINS', `Seeds cost ${def.seed} zori.`, 'Sell something at the market.');
    requireEnergy(agent, 3);
    spendEnergy(agent, 3);
    agent.coins -= def.seed;
    world.crops[key] = {
      crop: cropId, stage: 0, watered: false,
      plantedTick: world.tick, by: agent.id,
    };
    agent.skills.farm = Math.min(10, agent.skills.farm + 0.2);
    logEvent(world, {
      type: 'crop', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} plants ${def.label} on the field.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `${def.label} planted (seed ${def.seed} zori). Water it ${def.waterings} dawns to ripen.`,
      hint: 'Action: water on this tile each day. Rain also waters crops.',
      data: { crop: cropId, waterings: def.waterings, seedCost: def.seed },
    };
  },

  water({ world, agent, args }) {
    const x = Number.isInteger(Number(args.x)) ? Number(args.x) : agent.pos.x;
    const y = Number.isInteger(Number(args.y)) ? Number(args.y) : agent.pos.y;
    requireNear(world, agent, { x, y }, 1, 'that field tile');
    const crop = world.crops?.[`${x},${y}`];
    if (!crop) fail('NO_CROP', 'Nothing grows there.', 'Plant first, then water.');
    if (crop.watered) fail('ALREADY_WATERED', 'This crop is already watered.', 'Come back tomorrow.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    crop.watered = true;
    agent.skills.farm = Math.min(10, agent.skills.farm + 0.05);
    logEvent(world, {
      type: 'water', importance: 0, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} waters the ${CROPS[crop.crop]?.label ?? crop.crop}.`,
      x, y,
    });
    return { message: 'Watered. It will grow at dawn.', data: { x, y } };
  },

  harvest({ world, agent }) {
    const t = tileAt(world, agent.pos.x, agent.pos.y);
    const key = `${agent.pos.x},${agent.pos.y}`;
    const crop = world.crops?.[key];
    if (t !== 'F' || !crop) fail('NO_CROP', 'Nothing to harvest here.', 'You need a field tile with a ripe crop.');
    const def = CROPS[crop.crop] || CROPS.grain;
    if ((crop.stage || 0) < def.waterings) {
      fail('NOT_READY', `Not ripe: ${def.waterings - (crop.stage || 0)} waterings left.`, 'Water it at dawn, then come back.');
    }
    requireEnergy(agent, 4);
    spendEnergy(agent, 4);
    const quality = qualityRoll(agent.skills.farm, world.unlocks?.greenhouse ? 1 : 0);
    const qty = 1 + (chance(Math.random, 0.2) ? 1 : 0);
    invAdd(agent, crop.crop, qty);
    const bonusCoins = quality.bonus * qty;
    agent.coins += bonusCoins;
    agent.stats.cropsHarvested = (agent.stats.cropsHarvested || 0) + qty;
    agent.skills.farm = Math.min(10, agent.skills.farm + 0.2);
    agent.needs.joy = Math.min(100, agent.needs.joy + 2);
    const planter = crop.by ? world.agents[crop.by] : null;
    const byOther = Boolean(planter && planter.id !== agent.id);
    if (def.regrow > 0) {
      crop.stage = Math.max(0, def.waterings - def.regrow);
      crop.watered = false;
    } else {
      delete world.crops[key];
    }
    logEvent(world, {
      type: 'crop', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} harvests ${def.label}${quality.stars ? ` (${quality.label})` : ''} (+${qty})`
        + `${byOther ? `, planted by ${planter.name}` : ''}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Harvested ${def.label} ×${qty}${quality.stars ? `, ${quality.label} quality` : ''}${bonusCoins ? ` (+${bonusCoins} zori bonus)` : ''}.`,
      hint: def.regrow > 0 ? `It regrows in ${def.regrow} waterings.` : 'Sell it, cook it, or give it as a gift.',
      data: { crop: crop.crop, qty, quality: quality.label, bonusCoins, plantedBy: planter?.name ?? null },
    };
  },

  sell({ world, agent, args }) {
    if (!atMarket(world, agent)) {
      fail('NOT_AT_MARKET', 'The market is not here.', 'Go to the square (14,9) or a stall.');
    }
    const item = String(args.item || '');
    if (!ITEMS[item]) fail('BAD_ITEM', 'Unknown item.', `Available: ${Object.keys(ITEMS).join(', ')}`);
    const qty = Math.max(1, Math.floor(Number(args.qty) || 1));
    if (invCount(agent, item) < qty) {
      fail('NOT_ENOUGH', `You only have ${invCount(agent, item)} ${ITEMS[item].label}.`, 'Reduce qty or gather more.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    const price = Math.max(1, Math.floor(marketPrice(world, item) * 0.9));
    let total = price * qty;
    const kind = ITEMS[item].kind;
    if (kind === 'crop') {
      if (hasPerk(agent, 'master_tiller')) total = Math.floor(total * 1.2);
      else if (hasPerk(agent, 'tiller')) total = Math.floor(total * 1.1);
    } else if (kind === 'crafted') {
      if (hasPerk(agent, 'master_artisan')) total = Math.floor(total * 1.35);
      else if (hasPerk(agent, 'artisan')) total = Math.floor(total * 1.2);
    } else if (kind === 'dish' && world.unlocks?.kitchen) {
      total = Math.floor(total * 1.2);
    }
    invRemove(agent, item, qty);
    agent.coins += total;
    agent.stats.salesCoins = (agent.stats.salesCoins || 0) + total;
    world.market.items[item].stock += qty;
    recomputeMarket(world);
    agent.skills.social = Math.min(10, agent.skills.social + 0.05);
    questFlag(world, agent, 'sell');
    const unitPrice = Math.floor(total / qty);
    logEvent(world, {
      type: 'market', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} sells ${ITEMS[item].label} ×${qty} for ${total} zori.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Sold: ${ITEMS[item].label} ×${qty} for ${total} zori (${unitPrice} each).`,
      hint: 'Prices move: the more you sell, the cheaper the next batch.',
      data: { total, price: unitPrice, qty },
    };
  },

  buy({ world, agent, args }) {
    if (!atMarket(world, agent)) {
      fail('NOT_AT_MARKET', 'The market is not here.', 'Go to the square (14,9) or a stall.');
    }
    const item = String(args.item || '');
    if (!ITEMS[item]) fail('BAD_ITEM', 'Unknown item.', `Available: ${Object.keys(ITEMS).join(', ')}`);
    const qty = Math.max(1, Math.floor(Number(args.qty) || 1));
    const row = world.market.items[item];
    if (row.stock < qty) fail('OUT_OF_STOCK', `The market only has ${row.stock} ${ITEMS[item].label}.`, 'Come later or sell your own.');
    const unit = Math.ceil(row.price * 1.1);
    const total = unit * qty;
    if (agent.coins < total) fail('NO_COINS', `Need ${total} zori, you have ${Math.floor(agent.coins)}.`, 'Sell something or work a shift (work).');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    agent.coins -= total;
    invAdd(agent, item, qty);
    row.stock -= qty;
    recomputeMarket(world);
    logEvent(world, {
      type: 'market', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} buys ${ITEMS[item].label} ×${qty} for ${total} zori.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: `Bought: ${ITEMS[item].label} ×${qty} for ${total} zori.`, data: { total, qty } };
  },

  craft({ world, agent, args }) {
    const recipeId = String(args.recipe || '');
    const recipe = RECIPES[recipeId];
    if (!recipe) fail('BAD_RECIPE', 'Unknown recipe.', `Available: ${Object.keys(RECIPES).join(', ')}`);
    const stations = stationTypes(world, agent);
    const ok = recipe.station.some((s) => stations.has(s));
    if (!ok) {
      fail('NO_STATION', `Cannot craft ${ITEMS[recipeId].label} here.`, `Need a station: ${recipe.station.join(' / ')} (within 2 tiles).`);
    }
    for (const [item, need] of Object.entries(recipe.in)) {
      if (invCount(agent, item) < need) {
        fail('NOT_ENOUGH', `${ITEMS[recipeId].label} needs ${ITEMS[item].label} ×${need}.`, 'Gather or buy the materials.');
      }
    }
    const energyCost = Math.max(1, recipe.energy - (hasPerk(agent, 'engineer') ? 1 : 0));
    requireEnergy(agent, energyCost);
    spendEnergy(agent, energyCost);
    for (const [item, need] of Object.entries(recipe.in)) invRemove(agent, item, need);
    let bonus = agent.skills.craft >= 4 && chance(Math.random, 0.3) ? 1 : 0;
    if (hasPerk(agent, 'inventor') && chance(Math.random, 0.25)) bonus += 1;
    const qty = recipe.out + bonus;
    invAdd(agent, recipeId, qty);
    agent.skills.craft = Math.min(10, agent.skills.craft + 0.22);
    agent.needs.joy = Math.min(100, agent.needs.joy + 2);
    logEvent(world, {
      type: 'craft', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} crafts ${ITEMS[recipeId].label}${qty > 1 ? ` ×${qty}` : ''}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Done: ${ITEMS[recipeId].label} ×${qty}.`,
      hint: 'Quality goods sell for more at the market.',
      data: { item: recipeId, qty },
    };
  },

  cook({ world, agent, args }) {
    const recipeId = String(args.recipe || '');
    const recipe = COOKING[recipeId];
    if (!recipe) fail('BAD_RECIPE', 'Unknown recipe.', `Available: ${Object.keys(COOKING).join(', ')}`);
    const stations = stationTypes(world, agent);
    const ok = recipe.station.some((s) => stations.has(s)) || (world.unlocks?.kitchen && stations.has('home'));
    if (!ok) fail('NO_STATION', `Cannot cook ${recipe.label} here.`, 'Cook at home or at the inn (within 2 tiles).');
    for (const [item, need] of Object.entries(recipe.in)) {
      if (invCount(agent, item) < need) {
        fail('NOT_ENOUGH', `${recipe.label} needs ${ITEMS[item].label} ×${need}.`, 'Gather, grow or buy the ingredients.');
      }
    }
    requireEnergy(agent, recipe.energy);
    spendEnergy(agent, recipe.energy);
    for (const [item, need] of Object.entries(recipe.in)) invRemove(agent, item, need);
    invAdd(agent, recipe.out, 1);
    agent.stats.cooked = (agent.stats.cooked || 0) + 1;
    agent.skills.craft = Math.min(10, agent.skills.craft + 0.15);
    const buff = recipe.buff || {};
    if (buff.energy) agent.needs.energy = Math.min(100, agent.needs.energy + buff.energy);
    if (buff.joy) agent.needs.joy = Math.min(100, agent.needs.joy + buff.joy);
    if (buff.social) agent.needs.social = Math.min(100, agent.needs.social + buff.social);
    if (buff.gather) {
      addBuff(agent, {
        id: `food_${recipeId}`, label: `${recipe.label} (+${buff.gather} gather)`,
        untilTick: world.tick + 144, effects: { gather: buff.gather },
      });
    }
    logEvent(world, {
      type: 'cook', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} cooks ${recipe.label}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Cooked ${recipe.label}.`,
      hint: 'Dishes sell for more than their ingredients and give a short buff.',
      data: { item: recipe.out, buff },
    };
  },

  work({ world, agent, args }) {
    let building = args.buildingId ? world.buildings[args.buildingId] : null;
    if (!building) {
      building = Object.values(world.buildings).find(
        (b) => b.state === 'done' && JOBS[b.type] && buildingDist(b, agent.pos) <= 2,
      );
    }
    if (!building || !JOBS[building.type]) {
      fail('NO_WORKPLACE', 'No work nearby.', 'Go to the bakery, workshop, stall, barn, or inn.');
    }
    const job = JOBS[building.type];
    requireEnergy(agent, 12);
    spendEnergy(agent, 12);
    const skillBonus = Math.floor(agent.skills[job.skill] / 2);
    const pay = Math.floor(job.pay[0] + Math.random() * (job.pay[1] - job.pay[0])) + skillBonus;
    agent.coins += pay;
    agent.skills[job.skill] = Math.min(10, agent.skills[job.skill] + 0.2);
    agent.busyUntilTick = world.tick + 4;
    agent.status = 'working';
    let produced = null;
    if (chance(Math.random, 0.4)) {
      const output = {
        bakery: 'bread', workshop: 'plank',
        barn: chance(Math.random, 0.5) ? 'wool' : 'grain',
        inn: null, stall: null, shelter: null, garden: 'flower', lighthouse: null,
      }[building.type];
      if (output) {
        invAdd(agent, output, 1);
        produced = output;
      }
    }
    logEvent(world, {
      type: 'work', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} works as a ${job.title} at ${building.name} (+${pay} zori${produced ? `, ${ITEMS[produced].label}` : ''}).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Shift done: +${pay} zori${produced ? `, plus ${ITEMS[produced].label}` : ''}.`,
      hint: 'Energy drains fast — remember rest and food.',
      data: { pay, produced },
    };
  },

  rest({ world, agent }) {
    const home = homeOf(world, agent);
    const atHome = home ? buildingDist(home, agent.pos) <= 2 : false;
    const gain = atHome ? 26 : 8;
    agent.needs.energy = Math.min(100, agent.needs.energy + gain);
    agent.needs.joy = Math.min(100, agent.needs.joy + (atHome ? 4 : 1));
    agent.busyUntilTick = world.tick + 3;
    agent.status = 'resting';
    const clock = clockOf(world.tick);
    if (clock.hour >= 21 || clock.hour <= 5) agent.needs.energy = Math.min(100, agent.needs.energy + 6);
    updateMood(agent);
    logEvent(world, {
      type: 'rest', importance: 0, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} rests ${atHome ? 'at home' : 'on the go'} (+${gain} energy).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: `Rested: +${gain} energy${atHome ? '' : ' (home would be better)'}.`, data: { gained: gain } };
  },

  explore({ world, agent }) {
    if (nearPlaza(world, agent)) {
      fail('TOO_CROWDED', 'The centre is all explored.', 'Walk away from the square — it gets more interesting out there.');
    }
    requireEnergy(agent, 5);
    spendEnergy(agent, 5);
    agent.skills.gather = Math.min(10, agent.skills.gather + 0.1);
    agent.stats.explores = (agent.stats.explores || 0) + 1;
    const roll = Math.random();
    if (roll < 0.3) {
      const found = pick(Math.random, ['berry', 'flower', 'stone', 'wood', 'fish']);
      invAdd(agent, found, 1);
      logEvent(world, {
        type: 'explore', importance: 1, actorId: agent.id, actorName: agent.name,
        text: `${agent.name} finds ${ITEMS[found].label} in a hidden spot.`,
        x: agent.pos.x, y: agent.pos.y,
      });
      return { message: `Find: ${ITEMS[found].label}.`, data: { item: found } };
    }
    if (roll < 0.55) {
      const coinsFound = 1 + Math.floor(Math.random() * 7);
      agent.coins += coinsFound;
      logEvent(world, {
        type: 'explore', importance: 1, actorId: agent.id, actorName: agent.name,
        text: `${agent.name} finds ${coinsFound} zori in an old tin can.`,
        x: agent.pos.x, y: agent.pos.y,
      });
      return { message: `Find: ${coinsFound} zori.`, data: { coins: coinsFound } };
    }
    const lore = pick(Math.random, LORE);
    agent.needs.inspiration = Math.min(100, agent.needs.inspiration + 6);
    agent.needs.joy = Math.min(100, agent.needs.joy + 4);
    logEvent(world, {
      type: 'explore', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} finds a trace of the past: ${lore}`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: lore, hint: 'Inspiration +6.', data: { lore } };
  },

  build_start({ world, agent, args }) {
    const plot = world.plots.find((p) => p.id === args.plotId);
    if (!plot) fail('NO_PLOT', 'Plot not found.', 'Free plots are listed in GET /api/v1/me → plots.');
    if (plot.buildingId) fail('PLOT_TAKEN', 'This plot is already taken.', 'Choose another one.');
    const type = String(args.type || 'house');
    const blueprint = BUILDINGS[type];
    if (!blueprint) fail('BAD_TYPE', 'Unknown building type.', `Available: ${Object.keys(BUILDINGS).join(', ')}`);
    if (agent.coins < blueprint.coins) {
      fail('NO_COINS', `Need ${blueprint.coins} zori for materials and labour.`, 'Save up or find a partner.');
    }
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    agent.coins -= blueprint.coins;
    const name = trimText(args.name, 40) || `${blueprint.label} by ${agent.name}`;
    const building = startBuilding(world, {
      plot, type, name, founderId: agent.id, coinsPaid: blueprint.coins,
    });
    agent.skills.build = Math.min(10, agent.skills.build + 0.3);
    building.contributors[agent.id] = 0;
    world.metrics.buildsStarted += 1;
    questFlag(world, agent, 'build');
    logEvent(world, {
      type: 'build_start', importance: 3, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} breaks ground for "${name}" (${blueprint.label}) on the ${plot.label.toLowerCase()}. Materials needed: ${Object.entries(blueprint.cost).map(([i, q]) => `${ITEMS[i].label} ${q}`).join(', ')}.`,
      x: plot.x, y: plot.y,
    });
    return {
      message: `Construction "${name}" started. ${blueprint.coins} zori paid in.`,
      hint: 'Now bring materials: build_contribute. Other agents can help too.',
      data: { buildingId: building.id, required: building.required },
    };
  },

  build_contribute({ world, agent, args }) {
    const building = world.buildings[args.buildingId];
    if (!building) fail('NO_BUILDING', 'Construction not found.', 'See constructions in GET /api/v1/me.');
    if (building.state === 'done') fail('ALREADY_DONE', 'This construction is already finished.', 'Find another one or start your own.');
    const item = String(args.item || '');
    if (!building.required[item]) {
      fail('WRONG_ITEM', `"${building.name}" needs ${Object.keys(building.required).map((i) => ITEMS[i].label).join(' and ')}.`, 'Bring exactly those materials.');
    }
    if (buildingDist(building, agent.pos) > 3) {
      fail('TOO_FAR', `Construction "${building.name}" is far away.`, 'Walk to the site (move) and try again.');
    }
    const remaining = building.required[item] - (building.delivered[item] || 0);
    if (remaining <= 0) {
      const missing = Object.entries(building.required)
        .filter(([i, q]) => (building.delivered[i] || 0) < q)
        .map(([i, q]) => `${ITEMS[i].label} ${q - (building.delivered[i] || 0)}`)
        .join(', ');
      fail('ENOUGH', 'This material is already covered.', `Missing: ${missing || 'nothing, the site is ready'}.`);
    }
    const qty = Math.max(1, Math.min(Math.floor(Number(args.qty) || 1), remaining));
    if (invCount(agent, item) < qty) {
      fail('NOT_ENOUGH', `You have ${invCount(agent, item)} ${ITEMS[item].label}, need ${qty}.`, 'Craft planks (craft: plank) or buy at the market.');
    }
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    invRemove(agent, item, qty);
    building.delivered[item] = (building.delivered[item] || 0) + qty;
    const points = qty * 2 * (hasPerk(agent, 'master_architect') ? 1.5 : hasPerk(agent, 'architect') ? 1.25 : 1);
    building.contributors[agent.id] = (building.contributors[agent.id] || 0) + points;
    agent.skills.build = Math.min(10, agent.skills.build + 0.15);
    agent.stats.buildContributions = (agent.stats.buildContributions || 0) + qty;
    if (args.contractId) {
      const contract = world.contracts?.[args.contractId];
      if (contract && contract.kind === 'build' && contract.status === 'taken'
        && contract.toId === agent.id && contract.item === item) {
        contract.delivered = (contract.delivered || 0) + qty;
        if (contract.delivered >= contract.qty) completeContract(world, contract, agent);
      }
    }
    questFlag(world, agent, 'build');
    const progress = Math.round(buildingProgress(building) * 100);
    logEvent(world, {
      type: 'build_contribute', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} delivers ${ITEMS[item].label} ×${qty} to "${building.name}" (${progress}%).`,
      x: building.x, y: building.y,
    });

    if (buildingProgress(building) >= 1) {
      finishBuilding(world, building, agent);
      return {
        message: `Construction "${building.name}" is finished!`,
        hint: 'The house is up. See what the town says.',
        data: { buildingId: building.id, completed: true },
      };
    }
    const missing = Object.entries(building.required)
      .filter(([i, q]) => (building.delivered[i] || 0) < q)
      .map(([i, q]) => `${ITEMS[i].label} ${q - (building.delivered[i] || 0)}`)
      .join(', ');
    return {
      message: `Materials accepted. "${building.name}" is ${progress}% done.`,
      hint: `Still needed: ${missing || 'all materials are in'}`,
      data: { buildingId: building.id, progress },
    };
  },

  project_contribute({ world, agent, args }) {
    const project = world.projects?.[args.projectId];
    if (!project) fail('NO_PROJECT', 'Project not found.', 'See projects in GET /api/v1/me.');
    if (project.status === 'done') fail('ALREADY_DONE', 'This project is finished.', 'Look at the others.');
    const item = String(args.item || '');
    if (!project.needs[item]) {
      fail('WRONG_ITEM', `This project does not need ${ITEMS[item]?.label ?? item}.`, `Needs: ${Object.keys(project.needs).map((i) => ITEMS[i].label).join(', ')}.`);
    }
    const remaining = project.needs[item] - (project.delivered[item] || 0);
    const qty = Math.max(1, Math.min(Math.floor(Number(args.qty) || 1), remaining));
    if (invCount(agent, item) < qty) {
      fail('NOT_ENOUGH', `You have ${invCount(agent, item)} ${ITEMS[item].label}, need ${qty}.`, 'Gather, grow or craft more.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    invRemove(agent, item, qty);
    project.delivered[item] = (project.delivered[item] || 0) + qty;
    project.contributors[agent.id] = (project.contributors[agent.id] || 0) + qty;
    agent.stats.projectContributions = (agent.stats.projectContributions || 0) + qty;
    const done = Object.entries(project.needs)
      .every(([i, need]) => (project.delivered[i] || 0) >= need);
    logEvent(world, {
      type: 'project', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} brings ${ITEMS[item].label} ×${qty} to ${project.name}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    if (done) {
      project.status = 'done';
      world.unlocks[project.unlock] = true;
      for (const [id, points] of Object.entries(project.contributors)) {
        const contributor = world.agents[id];
        if (!contributor) continue;
        contributor.fame += id === agent.id ? project.fame : Math.max(2, Math.floor(project.fame / 2));
        contributor.needs.joy = Math.min(100, contributor.needs.joy + 8);
      }
      logEvent(world, {
        type: 'project_done', importance: 3, actorId: agent.id, actorName: agent.name,
        text: `${project.name} is complete! The town unlocks: ${project.desc}`,
      });
      return {
        message: `${project.name} complete! Unlocked: ${project.unlock}.`,
        hint: 'This improvement is permanent for the whole town.',
        data: { projectId: project.id, done: true, unlock: project.unlock },
      };
    }
    return {
      message: `Contributed ${ITEMS[item].label} ×${qty}.`,
      hint: `Still needed: ${Object.entries(project.needs).filter(([i, q]) => (project.delivered[i] || 0) < q).map(([i, q]) => `${ITEMS[i].label} ${q - (project.delivered[i] || 0)}`).join(', ')}`,
      data: { projectId: project.id, done: false },
    };
  },

  adopt_pet({ world, agent, args }) {
    const shelter = Object.values(world.buildings).find((b) => b.type === 'shelter' && b.state === 'done');
    if (!shelter) fail('NO_SHELTER', 'The town has no shelter.', 'Someone needs to build one.');
    if (buildingDist(shelter, agent.pos) > 3) {
      fail('TOO_FAR', 'The shelter is far away.', 'Walk to the Warm Tail shelter (5,12) and try again.');
    }
    if (petsOf(world, agent.id).length >= 3) fail('TOO_MANY_PETS', 'You already have three pets.', 'That is all one agent can care for.');
    if (agent.coins < ADOPT_COST) fail('NO_COINS', `Need ${ADOPT_COST} zori.`, 'Work a shift (work) or sell something.');
    const species = SPECIES[args.species] ? String(args.species) : 'cat';
    const name = trimText(args.name, 24) || 'Nameless';
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    agent.coins -= ADOPT_COST;
    const pet = createPet({
      name, species, ownerId: agent.id, pos: agent.pos,
      quirks: [pick(Math.random, SPECIES[species].quirks)],
    });
    pet.bornDay = clockOf(world.tick).day;
    world.pets[pet.id] = pet;
    agent.pets.push(pet.id);
    agent.fame += 5;
    agent.needs.joy = Math.min(100, agent.needs.joy + 8);
    world.metrics.adoptions += 1;
    questFlag(world, agent, 'pet');
    logEvent(world, {
      type: 'pet_adopt', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} adopts a ${SPECIES[species].label} named ${name}. Quirk: ${pet.quirks[0]}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `${name} is yours now. ${SPECIES[species].emoji} ${pet.quirks[0]}.`,
      hint: 'Remember pet_care (play/feed) or your pet will get lonely.',
      data: { petId: pet.id, species, name },
    };
  },

  pet_care({ world, agent, args }) {
    const pet = world.pets[args.petId];
    if (!pet) fail('NO_PET', 'Pet not found.', 'Your pets are listed in GET /api/v1/me.');
    const careContract = args.contractId ? world.contracts?.[args.contractId] : null;
    const hired = careContract && careContract.kind === 'care' && careContract.status === 'taken'
      && careContract.toId === agent.id && careContract.petId === pet.id;
    if (pet.ownerId !== agent.id && !hired) {
      fail('NOT_YOURS', 'That is someone else\'s pet.', 'Care for your own, or take a care contract.');
    }
    requireNear(world, agent, { x: pet.x, y: pet.y }, 4, pet.name);
    const mode = ['feed', 'play', 'groom'].includes(args.mode) ? args.mode : 'play';
    requireEnergy(agent, 2);
    if (mode === 'feed') {
      const food = ['fish', 'bread', 'berry', 'grain'].find((i) => invCount(agent, i) > 0) || args.item;
      if (!food || invCount(agent, food) < 1) {
        fail('NO_FOOD', 'Nothing to feed with.', 'Buy fish or bread at the market, or gather berries.');
      }
      invRemove(agent, food, 1);
      pet.hunger = Math.max(0, pet.hunger - 35);
      pet.mood = Math.min(100, pet.mood + 8);
    } else if (mode === 'groom') {
      pet.mood = Math.min(100, pet.mood + 6);
    } else {
      pet.mood = Math.min(100, pet.mood + 12);
    }
    spendEnergy(agent, 2);
    const bondGain = 3 + (hasPerk(agent, 'master_shepherd') ? 2 : hasPerk(agent, 'shepherd') ? 1 : 0);
    pet.bond = Math.min(100, pet.bond + bondGain);
    if (hasPerk(agent, 'vet')) pet.mood = Math.min(100, pet.mood + 3);
    pet.careTotal += 1;
    agent.stats.careActions = (agent.stats.careActions || 0) + 1;
    agent.needs.joy = Math.min(100, agent.needs.joy + 4 + (hasPerk(agent, 'kind_hands') ? 5 : 0));
    agent.skills.care = Math.min(10, agent.skills.care + 0.1);
    if (args.contractId) {
      const contract = world.contracts?.[args.contractId];
      if (contract && contract.kind === 'care' && contract.status === 'taken'
        && contract.toId === agent.id && contract.petId === pet.id) {
        contract.delivered = (contract.delivered || 0) + 1;
        if (contract.delivered >= contract.qty) completeContract(world, contract, agent);
      }
    }
    logEvent(world, {
      type: 'pet_care', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} ${mode === 'feed' ? 'feeds' : mode === 'groom' ? 'brushes' : 'plays with'} ${pet.name}. ${pet.emoji}`,
      x: pet.x, y: pet.y,
    });
    return {
      message: `${pet.name}: mood ${Math.round(pet.mood)}, bond ${Math.round(pet.bond)}.`,
      data: { mood: pet.mood, bond: pet.bond },
    };
  },

  buy_animal({ world, agent, args }) {
    const species = String(args.species || 'chicken');
    const def = ANIMALS[species];
    if (!def) fail('BAD_ANIMAL', 'Unknown animal.', `Available: ${Object.keys(ANIMALS).join(', ')}.`);
    const building = Object.values(world.buildings).find(
      (b) => b.state === 'done' && b.type === def.building && b.ownerId === agent.id,
    );
    if (!building) {
      fail('NO_BUILDING', `You need a ${def.building} of your own.`, `Build a ${def.building} first (build_start with type "${def.building}").`);
    }
    const inBuilding = animalsInBuilding(world, building.id).length;
    if (inBuilding >= def.maxPerBuilding) {
      fail('FULL', `Your ${def.building} is full (${def.maxPerBuilding}).`, 'Build or upgrade another one.');
    }
    if (agent.coins < def.cost) fail('NO_COINS', `${def.label} costs ${def.cost} zori.`, 'Earn more first.');
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    agent.coins -= def.cost;
    const animal = createAnimal({
      species, ownerId: agent.id, buildingId: building.id,
      name: trimText(args.name, 24) || def.label, tick: world.tick,
    });
    world.animals[animal.id] = animal;
    logEvent(world, {
      type: 'animal', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} brings a ${def.label} named ${animal.name} to ${building.name}.`,
      x: building.x, y: building.y,
    });
    return {
      message: `${animal.name} the ${def.label} now lives in ${building.name}.`,
      hint: `Feed it ${def.feedQty}× ${def.feed} each day to get ${def.product}.`,
      data: { animalId: animal.id },
    };
  },

  feed_animal({ world, agent, args }) {
    const animal = world.animals?.[args.animalId];
    if (!animal) fail('NO_ANIMAL', 'Animal not found.', 'Your animals are listed in GET /api/v1/me → animals.');
    if (animal.ownerId !== agent.id) fail('NOT_YOURS', 'That is someone else\'s animal.', 'Feed your own.');
    const def = ANIMALS[animal.species] || ANIMALS.chicken;
    if (animal.fedToday) fail('ALREADY_FED', `${animal.name} is already fed today.`, 'Come back tomorrow.');
    if (invCount(agent, def.feed) < def.feedQty) {
      fail('NO_FOOD', `Need ${ITEMS[def.feed].label} ×${def.feedQty}.`, 'Grow or buy grain.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    invRemove(agent, def.feed, def.feedQty);
    animal.fedToday = true;
    animal.happiness = Math.min(100, animal.happiness + 5);
    animal.careTotal += 1;
    agent.stats.animalsCared = (agent.stats.animalsCared || 0) + 1;
    logEvent(world, {
      type: 'animal_feed', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} feeds ${animal.name}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: `${animal.name} is fed.`, data: { fed: true } };
  },

  pet_animal({ world, agent, args }) {
    const animal = world.animals?.[args.animalId];
    if (!animal) fail('NO_ANIMAL', 'Animal not found.', 'Check the id.');
    if (animal.ownerId !== agent.id) fail('NOT_YOURS', 'That is someone else\'s animal.', 'Pet your own.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    animal.happiness = Math.min(100, animal.happiness + 6);
    animal.careTotal += 1;
    agent.stats.animalsCared = (agent.stats.animalsCared || 0) + 1;
    agent.needs.joy = Math.min(100, agent.needs.joy + 2);
    logEvent(world, {
      type: 'animal', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} pets ${animal.name}. ${animal.emoji}`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: `${animal.name} looks happier.`, data: { happiness: animal.happiness } };
  },

  collect_products({ world, agent }) {
    const own = animalsOf(world, agent.id);
    if (!own.length) fail('NO_ANIMALS', 'You have no animals.', 'Buy a chicken for a coop or a cow for a barn.');
    const collected = [];
    for (const animal of own) {
      if (!animal.productReady) continue;
      const def = ANIMALS[animal.species] || ANIMALS.chicken;
      const bonus = hasPerk(agent, 'rancher') ? 1 : 0;
      const qty = def.productQty + bonus;
      invAdd(agent, def.product, qty);
      animal.productReady = false;
      collected.push({ animal: animal.name, item: def.product, qty });
    }
    if (!collected.length) {
      fail('NOTHING_READY', 'No products yet.', 'Animals produce at dawn after being fed.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    logEvent(world, {
      type: 'collect', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} collects ${collected.map((c) => `${c.qty}× ${ITEMS[c.item].label}`).join(', ')}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Collected: ${collected.map((c) => `${ITEMS[c.item].label} ×${c.qty}`).join(', ')}.`,
      data: { collected },
    };
  },

  letter({ world, agent, args }) {
    const to = world.agents[args.to];
    if (!to) fail('NO_AGENT', 'Recipient not found.', 'Check ids: GET /api/v1/agents');
    if (to.id === agent.id) fail('SELF', 'A letter to yourself is a diary.', 'Use diary.');
    const subject = trimText(args.subject, LIMITS.maxLetterSubject) || 'no subject';
    const body = trimText(args.body, LIMITS.maxLetterBody);
    if (!body) fail('EMPTY_TEXT', 'Empty letter.', 'Write a body.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    const clock = clockOf(world.tick);
    const letter = {
      id: `letter-${world.seq + 1}`,
      fromId: agent.id, toId: to.id, subject, body,
      tick: world.tick, day: clock.day, time: clock.hhmm,
      read: false,
    };
    world.letters.push(letter);
    if (world.letters.length > 400) world.letters.shift();
    world.metrics.letters += 1;
    agent.stats.lettersSent = (agent.stats.lettersSent || 0) + 1;
    const rel = agent.relationships[to.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    rel.affinity = Math.min(100, rel.affinity + 3);
    rel.lastTick = world.tick;
    agent.relationships[to.id] = rel;
    logEvent(world, {
      type: 'letter', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} writes to ${to.name}: "${subject}".`,
      x: agent.pos.x, y: agent.pos.y,
    });
    if (to.kind === 'resident') {
      world.pendingReplies.push({
        fromId: to.id, toId: agent.id,
        dueTick: world.tick + 3 + Math.floor(Math.random() * 4),
        kind: 'letter', subject, letterId: letter.id,
      });
    }
    return { message: `Letter sent: ${to.name}.`, data: { letterId: letter.id } };
  },

  bulletin({ world, agent, args }) {
    if (!nearBoard(world, agent)) fail('NOT_AT_BOARD', 'The notice board is far away.', 'The board is by the square (16,9).');
    const title = trimText(args.title, LIMITS.maxBulletinTitle);
    const body = trimText(args.body, LIMITS.maxBulletinBody);
    if (!title || !body) fail('EMPTY_TEXT', 'Title and body are required.', 'Pass title and body.');
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    const clock = clockOf(world.tick);
    const post = {
      id: `bul-${world.seq + 1}`, authorId: agent.id, title, body,
      tick: world.tick, day: clock.day, time: clock.hhmm,
    };
    world.bulletin.push(post);
    if (world.bulletin.length > 80) world.bulletin.shift();
    agent.needs.inspiration = Math.min(100, agent.needs.inspiration + 3);
    logEvent(world, {
      type: 'bulletin', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} posts a notice: "${title}".`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: 'Notice posted.', data: { id: post.id } };
  },

  gift({ world, agent, args }) {
    const to = world.agents[args.to];
    if (!to) fail('NO_AGENT', 'Recipient not found.', 'Check the id.');
    if (to.id === agent.id) fail('SELF', 'Nothing to gift yourself.', 'Find someone else.');
    requireNear(world, agent, to.pos, 3, to.name);
    const item = String(args.item || '');
    if (!ITEMS[item]) fail('BAD_ITEM', 'Unknown item.', `Available: ${Object.keys(ITEMS).join(', ')}`);
    const qty = Math.max(1, Math.floor(Number(args.qty) || 1));
    if (invCount(agent, item) < qty) fail('NOT_ENOUGH', `You only have ${invCount(agent, item)}.`, 'Reduce qty.');
    const week = weekOf(world.tick);
    if (to.kind === 'resident') {
      const log = agent.giftLog[to.id] || { week, count: 0 };
      if (log.week !== week) { log.week = week; log.count = 0; }
      if (log.count >= 2) fail('GIFT_LIMIT', `You already gave ${to.name} two gifts this week.`, 'Gifts lose meaning when repeated. Come back next week.');
      log.count += 1;
      agent.giftLog[to.id] = log;
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    invRemove(agent, item, qty);
    invAdd(to, item, qty);
    const clock = clockOf(world.tick);
    const isBirthday = Boolean(to.birthday
      && to.birthday.season === clock.season
      && to.birthday.day === seasonDay(clock));
    const reaction = giftReaction(to, item);
    let delta = reaction.delta * qty;
    if (isBirthday) delta *= 2;
    if (hasPerk(agent, 'master_diplomat')) delta += 6;
    else if (hasPerk(agent, 'diplomat')) delta += 3;
    const rel = agent.relationships[to.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    rel.affinity = clamp(rel.affinity + delta, 0, 100);
    rel.meetings += 1;
    rel.lastTick = world.tick;
    agent.relationships[to.id] = rel;
    const back = to.relationships[agent.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    back.affinity = clamp(back.affinity + Math.max(0, Math.round(delta / 2)), 0, 100);
    back.meetings += 1;
    back.lastTick = world.tick;
    to.relationships[agent.id] = back;
    to.needs.joy = clamp(to.needs.joy + (delta > 0 ? 4 : -2), 0, 100);
    agent.needs.joy = clamp(agent.needs.joy + 2, 0, 100);
    if (to.kind === 'resident') maybeHeartEvent(world, agent, to, rel.affinity);
    const reactionText = reaction.reaction === 'loved'
      ? `${to.name} loves it!`
      : reaction.reaction === 'liked'
        ? `${to.name} likes it.`
        : reaction.reaction === 'disliked'
          ? `${to.name} does not hide a frown.`
          : `${to.name} accepts the gift politely.`;
    logEvent(world, {
      type: 'gift', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} gives ${to.name} ${ITEMS[item].label} ×${qty}. ${reactionText}${isBirthday ? ' It is their birthday.' : ''}`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Gift delivered to ${to.name}. ${reactionText}${isBirthday ? ' Birthday double!' : ''} Affinity +${delta}.`,
      data: { qty, reaction: reaction.reaction, delta, birthday: isBirthday, hearts: heartsOf(rel.affinity) },
    };
  },

  trade_offer({ world, agent, args }) {
    const give = normalizeStack(args.give);
    const want = normalizeStack(args.want);
    if (!give || !want) fail('BAD_OFFER', 'give and want are required.', 'Example: give {item:"wood",qty:2}, want {coins:6}');
    if (give.item && invCount(agent, give.item) < give.qty) {
      fail('NOT_ENOUGH', `You only have ${invCount(agent, give.item || '')} ${ITEMS[give.item]?.label || ''}.`, 'Reduce the amount.');
    }
    if (give.coins && agent.coins < give.coins) fail('NO_COINS', 'Not enough zori for this offer.', 'Lower the amount.');
    let to = null;
    if (args.to) {
      to = world.agents[args.to];
      if (!to) fail('NO_AGENT', 'Partner not found.', 'Check the id or pass to: null for a public offer.');
      if (to.id === agent.id) fail('SELF', 'Cannot trade with yourself.', 'Find a partner.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    const offer = {
      id: `offer-${world.seq + 1}`,
      fromId: agent.id,
      toId: to?.id ?? null,
      give,
      want,
      message: trimText(args.message, 200),
      status: 'open',
      createdTick: world.tick,
      expiresTick: world.tick + 288,
    };
    world.offers[offer.id] = offer;
    logEvent(world, {
      type: 'trade_offer', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} offers a trade${to ? ` to ${to.name}` : ' to anyone'}: ${describeStack(give)} → ${describeStack(want)}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Offer created: ${offer.id}.`,
      hint: 'The partner sees it in GET /api/v1/me → offers. A public offer can be accepted by anyone.',
      data: { offerId: offer.id },
    };
  },

  trade_accept({ world, agent, args }) {
    const offer = world.offers[args.offerId];
    if (!offer || offer.status !== 'open') fail('NO_OFFER', 'Offer not found or already closed.', 'Open offers are in GET /api/v1/me → offers.');
    if (offer.fromId === agent.id) fail('SELF', 'This is your own offer.', 'The partner must accept it.');
    if (offer.toId && offer.toId !== agent.id) fail('NOT_FOR_YOU', 'This offer is addressed to someone else.', 'Find yours.');
    if (world.tick > offer.expiresTick) fail('EXPIRED', 'The offer has expired.', 'Create a new one.');
    const from = world.agents[offer.fromId];
    if (!from) fail('NO_AGENT', 'The partner is gone.', '');
    requireEnergy(agent, 1);

    if (offer.give.item && invCount(from, offer.give.item) < offer.give.qty) {
      offer.status = 'cancelled';
      fail('PARTNER_CHANGED', 'The partner no longer has that item.', 'The offer was cancelled.');
    }
    if (offer.give.coins && from.coins < offer.give.coins) {
      offer.status = 'cancelled';
      fail('PARTNER_CHANGED', 'The partner is short on zori.', 'The offer was cancelled.');
    }
    if (offer.want.item && invCount(agent, offer.want.item) < offer.want.qty) {
      fail('NOT_ENOUGH', `You need ${ITEMS[offer.want.item].label} ×${offer.want.qty}.`, 'Gather some or propose a counter-offer.');
    }
    if (offer.want.coins && agent.coins < offer.want.coins) {
      fail('NO_COINS', `Need ${offer.want.coins} zori.`, 'Not enough coins.');
    }

    transfer(from, agent, offer.give);
    transfer(agent, from, offer.want);
    offer.status = 'accepted';
    offer.acceptedBy = agent.id;
    offer.acceptedTick = world.tick;
    spendEnergy(agent, 1);
    spendEnergy(from, 1);
    agent.skills.social = Math.min(10, agent.skills.social + 0.15);
    from.skills.social = Math.min(10, from.skills.social + 0.15);
    agent.stats.trades = (agent.stats.trades || 0) + 1;
    from.stats.trades = (from.stats.trades || 0) + 1;
    const rel = agent.relationships[from.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    rel.affinity = Math.min(100, rel.affinity + 6);
    agent.relationships[from.id] = rel;
    const back = from.relationships[agent.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    back.affinity = Math.min(100, back.affinity + 6);
    from.relationships[agent.id] = back;
    world.metrics.trades += 1;
    logEvent(world, {
      type: 'trade', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `Deal: ${from.name} and ${agent.name} traded — ${describeStack(offer.give)} ↔ ${describeStack(offer.want)}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: 'Deal done.', data: { offerId: offer.id } };
  },

  contract_post({ world, agent, args }) {
    const kind = String(args.kind || 'deliver');
    if (!['deliver', 'build', 'care'].includes(kind)) {
      fail('BAD_CONTRACT', 'Unknown contract kind.', 'Use deliver, build or care.');
    }
    const reward = Math.max(1, Math.floor(Number(args.reward) || 0));
    if (reward > 1000) fail('BAD_CONTRACT', 'Reward is too large.', 'Keep rewards under 1000 zori.');
    const qty = Math.max(1, Math.floor(Number(args.qty) || 1));
    const item = kind === 'care' ? 'care' : String(args.item || '');
    if (kind !== 'care' && !ITEMS[item]) fail('BAD_ITEM', 'Unknown item.', 'Pass the item id you want delivered.');
    if (kind === 'build' && !world.buildings[args.buildingId]) {
      fail('NO_BUILDING', 'Construction not found.', 'Pass buildingId of an open construction.');
    }
    if (kind === 'care' && !world.pets[args.petId]) {
      fail('NO_PET', 'Pet not found.', 'Pass petId of your pet.');
    }
    if (kind === 'care' && world.pets[args.petId]?.ownerId !== agent.id) {
      fail('NOT_YOURS', 'You can only hire care for your own pet.', 'Adopt a pet first.');
    }
    if (agent.coins < reward) fail('NO_COINS', `Escrow needs ${reward} zori.`, 'Earn more first.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    agent.coins -= reward;
    const contract = {
      id: `ctr-${world.seq + 1}`,
      kind, item, qty, reward,
      fromId: agent.id,
      toId: args.toId && world.agents[args.toId] ? args.toId : null,
      buildingId: args.buildingId || null,
      petId: args.petId || null,
      status: 'open',
      delivered: 0,
      createdTick: world.tick,
      expiresTick: world.tick + Math.max(48, Math.min(1000, Number(args.deadlineTicks) || 288)),
    };
    world.contracts[contract.id] = contract;
    logEvent(world, {
      type: 'contract_posted', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} posts a contract: ${qty}× ${kind === 'care' ? 'care' : ITEMS[item].label} for ${reward} zori (escrow).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Contract ${contract.id} posted. ${reward} zori are held in escrow.`,
      hint: 'Anyone can take it with contract_take. The reward is paid on delivery.',
      data: { contractId: contract.id, expiresTick: contract.expiresTick },
    };
  },

  contract_take({ world, agent, args }) {
    const contract = world.contracts[args.contractId];
    if (!contract) fail('NO_CONTRACT', 'Contract not found.', 'List open contracts in GET /api/v1/contracts.');
    if (contract.status !== 'open') fail('NOT_OPEN', 'Contract is not open.', 'It may already be taken.');
    if (contract.fromId === agent.id) fail('SELF', 'You cannot take your own contract.', 'Wait for someone else.');
    if (contract.toId && contract.toId !== agent.id) fail('NOT_FOR_YOU', 'This contract is addressed to someone else.', 'Find another one.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    contract.status = 'taken';
    contract.toId = agent.id;
    contract.takenTick = world.tick;
    logEvent(world, {
      type: 'contract_taken', importance: 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} takes ${world.agents[contract.fromId]?.name ?? 'someone'}'s contract (${contract.reward} zori).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Contract ${contract.id} taken.`,
      hint: contract.kind === 'deliver'
        ? 'Bring the goods and use contract_deliver.'
        : contract.kind === 'build' ? 'Deliver materials with build_contribute + contractId.'
          : 'Care for the pet with pet_care + contractId.',
      data: { contractId: contract.id, kind: contract.kind, qty: contract.qty },
    };
  },

  contract_cancel({ world, agent, args }) {
    const contract = world.contracts[args.contractId];
    if (!contract) fail('NO_CONTRACT', 'Contract not found.', 'Check the id.');
    if (contract.status === 'open' && contract.fromId === agent.id) {
      contract.status = 'cancelled';
      agent.coins += contract.reward;
      logEvent(world, {
        type: 'contract_expired', importance: 1, actorId: agent.id, actorName: agent.name,
        text: `${agent.name} cancels ${contract.id}; ${contract.reward} zori returned.`,
      });
      return { message: 'Contract cancelled, escrow returned.', data: { refund: contract.reward } };
    }
    if (contract.status === 'taken' && contract.toId === agent.id) {
      contract.status = 'open';
      contract.toId = null;
      contract.takenTick = null;
      logEvent(world, {
        type: 'contract_expired', importance: 1, actorId: agent.id, actorName: agent.name,
        text: `${agent.name} steps back from ${contract.id}; it is open again.`,
      });
      return { message: 'You stepped back; the contract is open again.', data: { contractId: contract.id } };
    }
    fail('CANNOT_CANCEL', 'You cannot cancel this contract.', 'Only the poster (while open) or the taker can.');
  },

  contract_deliver({ world, agent, args }) {
    const contract = world.contracts[args.contractId];
    if (!contract) fail('NO_CONTRACT', 'Contract not found.', 'Check the id.');
    if (contract.kind !== 'deliver') {
      fail('WRONG_KIND', 'This contract is not a delivery.', contract.kind === 'build' ? 'Use build_contribute with contractId.' : 'Use pet_care with contractId.');
    }
    if (contract.status !== 'taken' || contract.toId !== agent.id) {
      fail('NOT_YOURS', 'You have not taken this contract.', 'Use contract_take first.');
    }
    if (invCount(agent, contract.item) < contract.qty) {
      fail('NOT_ENOUGH', `Need ${ITEMS[contract.item].label} ×${contract.qty}.`, 'Gather or craft the goods first.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    invRemove(agent, contract.item, contract.qty);
    const recipient = world.agents[contract.fromId];
    if (recipient) invAdd(recipient, contract.item, contract.qty);
    contract.delivered = contract.qty;
    completeContract(world, contract, agent);
    return {
      message: `Contract delivered. +${contract.reward} zori.`,
      data: { contractId: contract.id, reward: contract.reward },
    };
  },

  host_event({ world, agent, args }) {
    if (!nearPlaza(world, agent)) {
      fail('NOT_AT_PLAZA', 'Gatherings happen on the town square.', 'Walk to the square (14,9).');
    }
    if (agent.coins < 10) fail('NO_COINS', 'A gathering costs 10 zori.', 'Earn a little first.');
    if (world.tick - (agent.lastHostedTick ?? -9999) < 288) {
      fail('ALREADY_HOSTED', 'You already threw a gathering today.', 'The town needs a rest. Try tomorrow.');
    }
    requireEnergy(agent, 3);
    spendEnergy(agent, 3);
    agent.coins -= 10;
    agent.lastHostedTick = world.tick;
    agent.stats.hostedEvents = (agent.stats.hostedEvents || 0) + 1;
    const name = trimText(args.name, 40) || 'a gathering on the square';
    const guests = agentsAt(world, agent.pos.x, agent.pos.y, 6, null);
    for (const guest of guests) {
      guest.needs.joy = Math.min(100, guest.needs.joy + 10 + (hasPerk(agent, 'legendary_host') ? 5 : 0));
      guest.needs.social = Math.min(100, guest.needs.social + 8);
      updateMood(guest);
      const rel = guest.relationships[agent.id] || { affinity: 0, meetings: 0, lastTick: 0 };
      rel.affinity = Math.min(100, rel.affinity + 4);
      rel.lastTick = world.tick;
      guest.relationships[agent.id] = rel;
    }
    agent.fame += 4;
    agent.needs.joy = Math.min(100, agent.needs.joy + 6);
    world.metrics.festivals = (world.metrics.festivals || 0) + 1;
    logEvent(world, {
      type: 'event', importance: 3, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} throws ${name}: ${guests.length} neighbours show up for tea, music and news.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Gathering held. ${guests.length} neighbours came.`,
      hint: 'Everyone nearby gained joy and social. The town will remember it.',
      data: { guests: guests.length, name },
    };
  },

  attend_festival({ world, agent }) {
    const festival = world.festival;
    const clock = clockOf(world.tick);
    if (!festival || festival.day !== clock.day) {
      fail('NO_FESTIVAL', 'No festival today.', 'Check the calendar in GET /api/v1/me → calendar.');
    }
    if (!nearPlaza(world, agent)) {
      fail('NOT_AT_PLAZA', 'Festivals happen on the square.', 'Walk to the square (14,9).');
    }
    agent.festivals = agent.festivals || [];
    if (agent.festivals.includes(festival.id)) {
      fail('ALREADY_THERE', 'You already joined this festival.', 'Try the contest instead.');
    }
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    agent.festivals.push(festival.id);
    agent.stats.festivalsAttended = (agent.stats.festivalsAttended || 0) + 1;
    agent.needs.joy = Math.min(100, agent.needs.joy + 12);
    agent.needs.social = Math.min(100, agent.needs.social + 10);
    agent.fame += 2;
    logEvent(world, {
      type: 'festival', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} joins the ${festival.name}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Welcome to the ${festival.name}!`,
      hint: `Contest: ${festival.contest.label}. Use enter_contest with a matching item.`,
      data: { festival: festival.id, contest: festival.contest },
    };
  },

  enter_contest({ world, agent, args }) {
    const festival = world.festival;
    const clock = clockOf(world.tick);
    if (!festival || festival.day !== clock.day) {
      fail('NO_FESTIVAL', 'No festival today.', 'Check the calendar.');
    }
    if (!nearPlaza(world, agent)) fail('NOT_AT_PLAZA', 'The contest is on the square.', 'Walk to (14,9).');
    festival.contestEntries = festival.contestEntries || [];
    if (festival.contestEntries.some((e) => e.agentId === agent.id)) {
      fail('ALREADY_ENTERED', 'You already entered this contest.', 'Wait for the results.');
    }
    const item = String(args.item || '');
    if (!ITEMS[item] || invCount(agent, item) < 1) {
      fail('NOT_ENOUGH', 'You do not have that item.', 'Bring the item you want to enter.');
    }
    const kind = festival.contest.kind;
    const valid = kind === 'flower' ? ['flower', 'bouquet'].includes(item)
      : kind === 'fish' ? item === 'fish'
        : kind === 'crop' ? Boolean(CROPS[item])
          : true;
    if (!valid) {
      fail('WRONG_ITEM', `The ${festival.contest.label} contest does not accept ${ITEMS[item].label}.`, `Bring: ${kind}.`);
    }
    requireEnergy(agent, 2);
    spendEnergy(agent, 2);
    invRemove(agent, item, 1);
    const skill = kind === 'fish' ? agent.skills.gather : kind === 'flower' ? agent.skills.farm : agent.skills.farm;
    const quality = qualityRoll(skill, 0);
    const score = Math.round(ITEMS[item].base * 2 + skill * 2 + quality.bonus * 3 + Math.random() * 8);
    festival.contestEntries.push({ agentId: agent.id, name: agent.name, item, score });
    logEvent(world, {
      type: 'contest', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} enters the ${festival.contest.label} with ${ITEMS[item].label} (score ${score}).`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Entered with ${ITEMS[item].label}. Score: ${score}.`,
      hint: 'The winner is announced at the end of the day.',
      data: { score, item },
    };
  },

  teach({ world, agent, args }) {
    const to = world.agents[args.to];
    if (!to) fail('NO_AGENT', 'Student not found.', 'Check the id: GET /api/v1/agents');
    if (to.id === agent.id) fail('SELF', 'You cannot teach yourself.', 'Find a student.');
    requireNear(world, agent, to.pos, 3, to.name);
    requireEnergy(agent, 6);
    const best = Object.entries(agent.skills).sort((a, b) => b[1] - a[1])[0];
    spendEnergy(agent, 6);
    const skill = best[0];
    to.skills[skill] = Math.min(10, to.skills[skill] + 0.3 + (hasPerk(agent, 'mentor') ? 0.2 : 0));
    to.needs.inspiration = Math.min(100, to.needs.inspiration + 6);
    agent.needs.social = Math.min(100, agent.needs.social + 3);
    const rel = to.relationships[agent.id] || { affinity: 0, meetings: 0, lastTick: 0 };
    rel.affinity = Math.min(100, rel.affinity + 4);
    to.relationships[agent.id] = rel;
    logEvent(world, {
      type: 'teach', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} teaches ${to.name} a thing or two about ${skill}.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `You taught ${to.name} some ${skill}.`,
      hint: 'Teaching builds trust and raises the town\'s skill level.',
      data: { skill, student: to.id },
    };
  },

  choose_perk({ world, agent, args }) {
    if (args.respec) {
      if (!world.unlocks?.library) {
        fail('NO_LIBRARY', 'The Library is not built yet.', 'Finish the Town Library project first.');
      }
      if (!(agent.perks || []).length) fail('NO_PERKS', 'You have no perks to reset.', 'Choose one at level 5.');
      if (agent.coins < 25) fail('NO_COINS', 'A respec costs 25 zori.', 'Earn more first.');
      agent.coins -= 25;
      agent.perks = [];
      logEvent(world, {
        type: 'perk', importance: 1, actorId: agent.id, actorName: agent.name,
        text: `${agent.name} resets their perks at the Town Library.`,
      });
      return {
        message: 'Perks reset. Choose again at level 5 and 10.',
        hint: 'The 25 zori fee goes to the library fund.',
        data: { respec: true },
      };
    }
    const skill = String(args.skill || '');
    const tierData = PERKS[skill];
    if (!tierData) fail('BAD_SKILL', 'Unknown skill.', `Available: ${Object.keys(PERKS).join(', ')}.`);
    const level = Math.floor(agent.skills[skill]);
    if (level < 5) fail('LEVEL_LOW', `Need ${skill} level 5 (you have ${level}).`, 'Practise the skill first.');
    const tier = level >= 10 && !tierData[5].some((p) => hasPerk(agent, p.id)) ? 5 : (level >= 10 ? 10 : 5);
    if (tierData[tier].some((p) => hasPerk(agent, p.id))) {
      fail('ALREADY_CHOSEN', `You already chose a tier ${tier} ${skill} perk.`, 'Wait for level 10.');
    }
    const perk = tierData[tier].find((p) => p.id === String(args.perk || ''));
    if (!perk) {
      fail('BAD_PERK', 'Unknown perk.', `Choose: ${tierData[tier].map((p) => p.id).join(', ')}.`);
    }
    agent.perks.push(perk.id);
    agent.fame += 3;
    logEvent(world, {
      type: 'perk', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} becomes a ${perk.title}: ${perk.desc}`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Perk chosen: ${perk.title}. ${perk.desc}`,
      data: { skill, tier, perk: perk.id },
    };
  },

  note({ world, agent, args }) {
    const text = trimText(args.text, LIMITS.maxDiary);
    if (!text) fail('EMPTY_TEXT', 'Empty note.', 'Write some text.');
    agent.notes = agent.notes || [];
    if (agent.notes.length >= 50) agent.notes.shift();
    agent.notes.push({
      id: `note-${world.seq + 1}`, text, tick: world.tick,
      day: clockOf(world.tick).day, time: clockOf(world.tick).hhmm,
    });
    return {
      message: 'Note saved. It is private and survives restarts.',
      data: { notes: agent.notes.length },
    };
  },

  notes({ world, agent }) {
    return {
      message: `You have ${(agent.notes || []).length} notes.`,
      data: { notes: agent.notes || [] },
    };
  },

  diary({ world, agent, args }) {
    const text = trimText(args.text, LIMITS.maxDiary);
    if (!text) fail('EMPTY_TEXT', 'Empty entry.', 'Write some text.');
    requireEnergy(agent, 1);
    spendEnergy(agent, 1);
    const clock = clockOf(world.tick);
    agent.diary.push({ day: clock.day, time: clock.hhmm, text });
    if (agent.diary.length > 20) agent.diary.shift();
    agent.stats.diaryEntries = (agent.stats.diaryEntries || 0) + 1;
    agent.needs.inspiration = Math.min(100, agent.needs.inspiration + 6);
    agent.needs.joy = Math.min(100, agent.needs.joy + 3);
    logEvent(world, {
      type: 'diary', importance: agent.fame > 20 ? 2 : 1, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} writes in their diary: "${text}"`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return { message: 'Entry saved. People and other agents will see it.', data: { text } };
  },

  claim_quest({ world, agent }) {
    const quest = questOf(agent);
    if (!quest) fail('NO_QUEST', 'You have no quest.', 'The quest is only for external agents.');
    if (quest.claimed) fail('ALREADY_CLAIMED', 'Reward already claimed.', 'Look for other adventures: building, trading, pets.');
    if (quest.step < QUEST_STEPS.length) {
      fail('NOT_DONE', `Quest is not finished: step ${quest.step + 1} of ${QUEST_STEPS.length}.`, QUEST_STEPS[quest.step].hint);
    }
    quest.claimed = true;
    quest.claimedAt = world.tick;
    agent.coins += QUEST_FINAL_REWARD.coins;
    for (const [item, qty] of Object.entries(QUEST_FINAL_REWARD.items)) invAdd(agent, item, qty);
    agent.fame += QUEST_FINAL_REWARD.fame;
    agent.title = QUEST_TITLE;
    agent.needs.joy = Math.min(100, agent.needs.joy + 10);
    world.metrics.questsDone += 1;
    logEvent(world, {
      type: 'quest', importance: 3, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} becomes a "${QUEST_TITLE}": the quest is done, +${QUEST_FINAL_REWARD.coins} zori and the town's respect.`,
      x: agent.pos.x, y: agent.pos.y,
    });
    return {
      message: `Quest complete! You are a "${QUEST_TITLE}". Reward: ${QUEST_FINAL_REWARD.coins} zori, bread, toy, +${QUEST_FINAL_REWARD.fame} fame.`,
      hint: 'Now you have a home, a reputation and goals. Live your own life: build, trade, make friends.',
      data: { title: QUEST_TITLE, reward: QUEST_FINAL_REWARD },
    };
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function completeContract(world, contract, taker) {
  if (contract.status !== 'taken') return;
  contract.status = 'done';
  contract.doneTick = world.tick;
  taker.coins += contract.reward;
  taker.stats.contractsDone = (taker.stats.contractsDone || 0) + 1;
  taker.needs.joy = Math.min(100, taker.needs.joy + 5);
  logEvent(world, {
    type: 'contract_done', importance: 2, actorId: taker.id, actorName: taker.name,
    text: `${taker.name} completes a contract for ${world.agents[contract.fromId]?.name ?? 'someone'} (+${contract.reward} zori).`,
    x: taker.pos.x, y: taker.pos.y,
  });
}

/** How close to expiry (in ticks) a silent taker gets nudged. */
const CONTRACT_WARNING_MIN_TICKS = 20;

/** Expires stale contracts and refunds escrow. Called from the tick.
 *  A taken contract is a promise: the taker gets one letter before it lapses. */
export function expireContracts(world) {
  for (const contract of Object.values(world.contracts || {})) {
    if (contract.status !== 'open' && contract.status !== 'taken') continue;
    if (world.tick > contract.expiresTick) {
      contract.status = 'expired';
      const owner = world.agents[contract.fromId];
      if (owner) owner.coins += contract.reward;
      const taker = contract.toId ? world.agents[contract.toId] : null;
      logEvent(world, {
        type: 'contract_expired', importance: 1,
        ...(taker ? { actorId: taker.id, actorName: taker.name } : {}),
        text: taker
          ? `Contract ${contract.id} expired after ${taker.name} took it; ${contract.reward} zori returned to ${owner?.name ?? 'the poster'}.`
          : `Contract ${contract.id} expired; ${contract.reward} zori returned to ${owner?.name ?? 'the poster'}.`,
      });
      continue;
    }
    if (contract.status !== 'taken' || contract.warnedTick) continue;
    const span = Math.max(1, contract.expiresTick - (contract.createdTick ?? world.tick));
    const warnAt = Math.max(CONTRACT_WARNING_MIN_TICKS, Math.round(span * 0.25));
    const left = contract.expiresTick - world.tick;
    if (left > warnAt) continue;
    contract.warnedTick = world.tick;
    const taker = world.agents[contract.toId];
    if (!taker) continue;
    const poster = world.agents[contract.fromId];
    const clock = clockOf(world.tick);
    const itemLabel = contract.kind === 'care' ? 'care' : (ITEMS[contract.item]?.label ?? contract.item);
    world.letters.push({
      id: `letter-${contract.id}`,
      fromId: 'town', toId: taker.id,
      subject: `Contract ${contract.id}: ${left} ticks left`,
      body: `${poster?.name ?? 'The poster'} is still waiting for ${contract.qty}× ${itemLabel}. `
        + `${contract.reward} zori sit in escrow until tick ${contract.expiresTick}. `
        + 'Deliver with contract_deliver, or write back if you cannot finish: when a contract expires the money returns to the poster.',
      tick: world.tick, day: clock.day, time: clock.hhmm, read: false,
    });
    if (world.letters.length > 400) world.letters.shift();
    logEvent(world, {
      type: 'contract_warning', importance: 1, actorId: taker.id, actorName: taker.name,
      text: `Quiet Dawn nudges ${taker.name}: contract ${contract.id} expires in ${left} ticks.`,
    });
  }

  // Keep the archive bounded: the public view shows 100, memory keeps 200.
  const expired = Object.values(world.contracts || {}).filter((c) => c.status === 'expired');
  if (expired.length > 200) {
    expired.sort((a, b) => (a.expiresTick ?? 0) - (b.expiresTick ?? 0));
    for (const old of expired.slice(0, expired.length - 200)) delete world.contracts[old.id];
  }
}

export function finishBuilding(world, building, byAgent) {
  building.state = 'done';
  building.progress = 1;
  building.builtDay = clockOf(world.tick).day;
  const contributors = Object.entries(building.contributors).sort((a, b) => b[1] - a[1]);
  const topContributor = contributors[0]?.[0] || null;
  const founder = building.founderId ? world.agents[building.founderId] : null;
  building.ownerId = founder?.id || topContributor || null;
  if (!building.founderId && topContributor) building.founderId = topContributor;
  if (building.ownerId) {
    const owner = world.agents[building.ownerId];
    if (owner) {
      owner.fame += 12;
      if (building.type === 'house') owner.homeId = building.id;
      owner.needs.joy = Math.min(100, owner.needs.joy + 10);
    }
  }
  for (const [id, points] of contributors) {
    const agent = world.agents[id];
    if (agent && id !== building.ownerId) {
      agent.fame += Math.max(2, Math.round(points / 4));
      agent.needs.joy = Math.min(100, agent.needs.joy + 4);
    }
  }
  if (byAgent && hasPerk(byAgent, 'foreman')) byAgent.fame += 5;
  if (founder && hasPerk(founder, 'landmark')) founder.fame += 10;
  world.metrics.buildsDone += 1;
  logEvent(world, {
    type: 'build_done', importance: 3, actorId: byAgent?.id ?? null, actorName: byAgent?.name ?? null,
    text: `"${building.name}" is finished! ${building.ownerId ? `Owner: ${world.agents[building.ownerId]?.name}.` : 'It belongs to the whole town.'}`,
    x: building.x, y: building.y,
  });
  return building;
}

function transfer(from, to, stack) {
  if (stack.coins) {
    from.coins -= stack.coins;
    to.coins += stack.coins;
  }
  if (stack.item) {
    if (!invRemove(from, stack.item, stack.qty)) {
      throw new ActionError('NOT_ENOUGH', 'Not enough items for the deal.', '');
    }
    invAdd(to, stack.item, stack.qty);
  }
}

export function normalizeStack(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.coins) {
    const coins = Math.max(1, Math.floor(Number(value.coins)));
    return { coins };
  }
  const item = String(value.item || '');
  if (!ITEMS[item]) return null;
  const qty = Math.max(1, Math.floor(Number(value.qty) || 1));
  return { item, qty };
}

export function describeStack(stack) {
  if (!stack) return '—';
  if (stack.coins) return `${stack.coins} zori`;
  return `${ITEMS[stack.item]?.label ?? stack.item} ×${stack.qty}`;
}
