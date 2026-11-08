// Nova Vita — achievements (badges). Small, server-side, no external storage:
// they are derived from counters the actions already update.
import { ACHIEVEMENTS, ITEMS } from './constants.mjs';
import { logEvent } from './model.mjs';

export const ACHIEVEMENT_INFO = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

const CHECKS = {
  first_steps: (world, agent) => Boolean(agent.quest?.claimed),
  homeowner: (world, agent) => Object.values(world.buildings)
    .some((b) => b.type === 'house' && b.state === 'done' && b.ownerId === agent.id),
  builder: (world, agent) => (agent.stats?.buildContributions || 0) >= 10,
  trader: (world, agent) => (agent.stats?.trades || 0) >= 5,
  merchant: (world, agent) => (agent.stats?.salesCoins || 0) >= 150,
  socialite: (world, agent) => Object.values(agent.relationships || {})
    .filter((rel) => rel.affinity >= 35).length >= 5,
  caretaker: (world, agent) => (agent.stats?.careActions || 0) >= 10,
  chronicler: (world, agent) => (agent.stats?.diaryEntries || 0) >= 3
    && (agent.stats?.lettersSent || 0) >= 3,
  explorer: (world, agent) => (agent.stats?.explores || 0) >= 3,
  host: (world, agent) => (agent.stats?.hostedEvents || 0) >= 1,
  legend: (world, agent) => agent.fame >= 100,
  confidant: (world, agent) => Object.values(agent.relationships || {})
    .some((rel) => rel.affinity >= 100),
  festival_goer: (world, agent) => new Set(agent.festivals || []).size >= 4,
  contractor: (world, agent) => (agent.stats?.contractsDone || 0) >= 3,
  farmer: (world, agent) => (agent.stats?.cropsHarvested || 0) >= 20,
  chef: (world, agent) => (agent.stats?.cooked || 0) >= 5,
  rancher: (world, agent) => Object.values(world.animals || {})
    .filter((a) => a.ownerId === agent.id).length >= 2,
  project_hero: (world, agent) => Object.values(world.projects || {})
    .some((p) => p.status === 'done' && (p.contributors?.[agent.id] || 0) > 0),
  perk: (world, agent) => (agent.perks || []).length >= 1,
};

/** Awards any newly earned badges. Returns the list of awarded ids. */
export function evaluateAchievements(world, agent) {
  if (!agent.achievements) agent.achievements = [];
  const earned = new Set(agent.achievements);
  const awarded = [];
  for (const def of ACHIEVEMENTS) {
    if (earned.has(def.id)) continue;
    const check = CHECKS[def.id];
    if (!check || !check(world, agent)) continue;
    earned.add(def.id);
    awarded.push(def.id);
    agent.fame += 3;
    agent.needs.joy = Math.min(100, agent.needs.joy + 5);
    logEvent(world, {
      type: 'achievement', importance: 2, actorId: agent.id, actorName: agent.name,
      text: `${agent.name} earns the "${def.title}" badge ${def.icon}`,
      x: agent.pos.x, y: agent.pos.y,
      meta: { achievement: def.id },
    });
  }
  agent.achievements = [...earned];
  return awarded;
}

export function badgesOf(agent) {
  return (agent.achievements || [])
    .map((id) => ACHIEVEMENT_INFO[id])
    .filter(Boolean)
    .map((a) => ({ id: a.id, title: a.title, icon: a.icon, desc: a.desc }));
}

/** Daily-ish sweep so residents and idle agents also collect what they earned. */
export function evaluateAll(world) {
  for (const agent of Object.values(world.agents)) {
    try { evaluateAchievements(world, agent); } catch { /* keep the world running */ }
  }
}

export { ITEMS };
