// Nova Vita — run the world without external agents: a liveness and balance check.
// Usage: node scripts/simulate.mjs --days 3 [--seed 20261107]
import { createWorld, worldStats, worldOverview } from '../src/model.mjs';
import { tickWorld, buildDispatch } from '../src/tick.mjs';
import { clockOf } from '../src/core.mjs';
import { TICKS_PER_DAY } from '../src/constants.mjs';

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const days = Number(arg('days', 3));
const seed = Number(arg('seed', 20261107));
const ticks = Math.round(days * TICKS_PER_DAY);

const world = createWorld({ seed, tickMs: 2000 });
console.log(`\nNova Vita · ${days} day(s) (${ticks} ticks), seed ${seed}\n`);

const t0 = Date.now();
for (let i = 0; i < ticks; i += 1) {
  try { tickWorld(world); } catch (err) {
    console.error(`tick ${world.tick}:`, err.message);
    break;
  }
}
const ms = Date.now() - t0;

const stats = worldStats(world);
const clock = clockOf(world.tick);
const overview = worldOverview(world);

console.log(`Time: day ${clock.day}, ${clock.hhmm}, ${clock.season}. Run: ${ms} ms (${(ms / ticks).toFixed(2)} ms/tick)`);
console.log(`Population: ${stats.population} · pets: ${stats.pets} · buildings: ${stats.buildings} · constructions: ${stats.constructions}`);
console.log(`Events: ${world.seq} · letters: ${world.letters.length} · trades: ${world.metrics.trades} · badges: ${stats.achievements}`);

console.log('\nBuildings:');
for (const b of Object.values(world.buildings)) {
  console.log(`  ${b.state === 'done' ? '✓' : '…'} ${b.name.padEnd(28)} ${b.type.padEnd(11)} ${b.state === 'done' ? '' : `${Math.round((b.progress || 0) * 100)}%`} ${b.ownerId ? `· ${world.agents[b.ownerId]?.name}` : ''}`);
}

console.log('\nEvents by type:');
const byType = {};
for (const e of world.events) byType[e.type] = (byType[e.type] || 0) + 1;
Object.entries(byType).sort((a, b) => b[1] - a[1]).forEach(([t, n]) => console.log(`  ${t.padEnd(16)} ${n}`));

console.log('\nResidents:');
for (const a of Object.values(world.agents)) {
  console.log(`  ${a.name.padEnd(9)} ${String(Math.round(a.coins)).padStart(4)} zori · fame ${String(a.fame).padStart(3)} · actions ${String(a.actionsTotal).padStart(3)} · ${a.goal?.kind || a.status} · badges ${a.achievements?.length || 0}`);
}

console.log('\nMarket:');
for (const m of overview.market) {
  const delta = m.price - m.base;
  console.log(`  ${m.emoji} ${m.label.padEnd(9)} ${String(m.price).padStart(5)} (base ${m.base}${delta ? `, ${delta > 0 ? '+' : ''}${delta.toFixed(1)}` : ''}) stock ${m.stock}`);
}

console.log('\nLatest dispatch:');
if (world.dispatches.length) {
  const d = world.dispatches[world.dispatches.length - 1];
  console.log(`  ${d.title}`);
  console.log(`  ${d.headline}`);
  for (const t of d.top.slice(0, 4)) console.log(`    ${t.time} ${t.icon} ${t.text}`);
  if (d.quote) console.log(`    "${d.quote.text}" — ${d.quote.by}`);
} else {
  console.log('  (none yet)');
}

console.log('\nLast events:');
for (const e of world.events.slice(-12)) {
  console.log(`  [${String(e.day).padStart(2)} ${e.time}] ${e.icon} ${e.text}`);
}

console.log('\nChronicle:');
for (const c of world.chronicle.slice(-3)) console.log(`  Day ${c.day}: ${c.title}`);
if (world.chronicle.length === 0) console.log('  (empty)');
console.log('');
