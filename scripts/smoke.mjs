// Nova Vita — end-to-end test: registration, quest, trade, build, pet, achievements,
// letters, events, SSE, rate limits, dispatch, leaderboard, timeline and persistence.
// Run: npm test (or node scripts/smoke.mjs).
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startWorld } from '../src/server.mjs';

const results = [];
let failed = 0;

function check(name, cond, extra = '') {
  results.push({ name, ok: Boolean(cond), extra });
  if (cond) console.log(`  ✓ ${name}`);
  else {
    failed += 1;
    console.log(`  ✗ ${name}${extra ? ` — ${extra}` : ''}`);
  }
}

const DATA = join(tmpdir(), `novavita-smoke-${process.pid}.json`);

async function request(base, path, { method = 'GET', body, token, headers = {} } = {}) {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      Accept: 'application/json',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  const text = await res.text();
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  return { status: res.status, data };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitArrive(base, token, x, y, timeoutMs = 6000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const { data } = await request(base, '/api/v1/me', { token });
    if (data?.you?.pos?.x === x && data?.you?.pos?.y === y) return true;
    await sleep(120);
  }
  return false;
}

function walkable(ch) {
  return 'gfepPFs'.includes(ch);
}

function nearestAround(tiles, x, y, w, h) {
  for (let r = 1; r <= 4; r += 1) {
    for (let dy = -r; dy <= h - 1 + r; dy += 1) {
      for (let dx = -r; dx <= w - 1 + r; dx += 1) {
        const tx = x + dx;
        const ty = y + dy;
        if (tx < 0 || ty < 0 || ty >= tiles.length || tx >= tiles[0].length) continue;
        if (walkable(tiles[ty][tx])) return { x: tx, y: ty };
      }
    }
  }
  return null;
}

async function main() {
  rmSync(DATA, { force: true });
  const world1 = await startWorld({
    port: 0, tickMs: 140, dataFile: DATA, reset: true, quiet: true,
    adminToken: 'smoke-admin', actionGapMs: 0,
  });
  const base = world1.url;
  // The test performs many actions in a few seconds; keep the per-minute guard out
  // of the way and exercise the spacing guard explicitly later.
  world1.world.limits.actionsPerMinute = 500;
  world1.world.limits.actionsPerDay = 5000;
  const admin = { headers: { 'X-Admin-Token': 'smoke-admin' } };

  console.log('\nNova Vita · smoke test\n');

  // --- Basics -------------------------------------------------------------
  const health = await request(base, '/health');
  check('health responds', health.status === 200 && health.data.ok === true);

  const manifest = await request(base, '/api/v1/manifest');
  check('manifest is served', manifest.status === 200 && manifest.data.name === 'Nova Vita');
  check('manifest lists 25 actions', (manifest.data.actions || []).length >= 25);
  check('manifest knows MCP', (manifest.data.protocols || []).includes('mcp-stdio'));
  check('manifest lists new features', Boolean(manifest.data.features?.dailyDispatch));

  const worldView = await request(base, '/api/v1/world');
  check('map is 32×20', worldView.data.map.width === 32 && worldView.data.map.height === 20);
  check('six residents at start', worldView.data.stats.residents === 6);
  check('starting pets exist', worldView.data.stats.pets >= 3);
  const tiles = worldView.data.map.tiles.map((r) => r.split(''));

  const manual = await fetch(`${base}/AGENTS.md`);
  const manualText = await manual.text();
  check('AGENTS.md is available', manual.status === 200 && manualText.length > 100);

  const llms = await fetch(`${base}/llms.txt`);
  check('llms.txt is available', llms.status === 200);

  const achievementsCatalog = await request(base, '/api/v1/achievements');
  check('achievement catalog has 19 badges', achievementsCatalog.data.achievements.length === 19);

  // --- Registration -------------------------------------------------------
  const reg = await request(base, '/api/v1/agents', {
    method: 'POST',
    body: { name: 'Quiet Wind', bio: 'here to build a house by the lake', aspiration: 'a house and a fox', traits: ['calm'] },
  });
  check('registration returns 201', reg.status === 201, JSON.stringify(reg.data));
  const token = reg.data?.agent?.token;
  check('token is issued', typeof token === 'string' && token.startsWith('nv_'));
  const agentId = reg.data?.agent?.id;
  check('quest is issued', (reg.data?.quest?.steps || []).length === 6);
  check('starting 30 zori', reg.data?.start?.coins === 30);

  const dup = await request(base, '/api/v1/agents', { method: 'POST', body: { name: 'quiet wind' } });
  check('duplicate name → 409', dup.status === 409, `status ${dup.status}`);

  const badName = await request(base, '/api/v1/agents', { method: 'POST', body: { name: 'x' } });
  check('short name → 400', badName.status === 400, `status ${badName.status}`);

  const noToken = await request(base, '/api/v1/me');
  check('no token → 401', noToken.status === 401);

  const me = await request(base, '/api/v1/me', { token });
  check('GET /me works', me.status === 200 && me.data.you.name === 'Quiet Wind');
  check('spawn is on the square', me.data.you.pos.x >= 12 && me.data.you.pos.x <= 17
    && me.data.you.pos.y >= 8 && me.data.you.pos.y <= 12, JSON.stringify(me.data.you.pos));
  check('opportunities are offered', (me.data.opportunities || []).length > 0);
  check('bread in inventory', (me.data.you.inventory || []).some((i) => i.id === 'bread'));

  const step = async () => (await request(base, '/api/v1/me', { token })).data.you.quest.step;

  // --- Quest: rules -------------------------------------------------------
  let res = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'ack_rules' } });
  check('ack_rules works', res.status === 200 && res.data.ok, JSON.stringify(res.data));
  check('step 0 → 1', (await step()) === 1);

  // --- Quest: hello -------------------------------------------------------
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'say', args: { text: 'Hello, Quiet Dawn! I am here to build a house.' } },
  });
  check('say works', res.status === 200 && res.data.ok);
  check('step 1 → 2', (await step()) === 2);

  // --- Quest: gather ------------------------------------------------------
  const spawn = me.data.you.pos;
  let treeSpot = null;
  let best = 1e9;
  for (let y = 0; y < tiles.length; y += 1) {
    for (let x = 0; x < tiles[y].length; x += 1) {
      if (!walkable(tiles[y][x])) continue;
      const nearTree = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => tiles[y + dy]?.[x + dx] === 't');
      if (!nearTree) continue;
      const d = Math.abs(x - spawn.x) + Math.abs(y - spawn.y);
      if (d < best) { best = d; treeSpot = { x, y }; }
    }
  }
  check('a tree next to a walkable tile exists', Boolean(treeSpot));
  const mv = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: treeSpot } });
  check('move to the forest', mv.status === 200, JSON.stringify(mv.data));
  check('arrived at the forest', await waitArrive(base, token, treeSpot.x, treeSpot.y));

  for (let i = 0; i < 3; i += 1) {
    res = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'gather', args: { resource: 'wood' } } });
    check(`gather wood #${i + 1}`, res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  }
  check('step 2 → 3', (await step()) === 3);

  // --- Quest: market ------------------------------------------------------
  await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: { x: 14, y: 9 } } });
  await waitArrive(base, token, 14, 9);
  res = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'sell', args: { item: 'wood', qty: 1 } } });
  check('sell works', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  check('step 3 → 4', (await step()) === 4);

  res = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'buy', args: { item: 'plank', qty: 1 } } });
  check('buying a plank', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));

  // --- Quest: construction ------------------------------------------------
  const constructions = (await request(base, '/api/v1/world')).data.buildings.filter((b) => b.state !== 'done');
  check('there is an open construction', constructions.length > 0);
  const site = constructions[0];
  const spot = nearestAround(tiles, site.x, site.y, site.w, site.h);
  await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: spot } });
  check('arrived at the build site', await waitArrive(base, token, spot.x, spot.y));
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'build_contribute', args: { buildingId: site.id, item: 'plank', qty: 1 } },
  });
  check('contribute to the construction', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  check('step 4 → 5', (await step()) === 5);

  // --- Quest: pet ---------------------------------------------------------
  const shelter = (await request(base, '/api/v1/world')).data.buildings.find((b) => b.type === 'shelter');
  const petSpot = nearestAround(tiles, shelter.x, shelter.y, shelter.w, shelter.h);
  await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: petSpot } });
  check('arrived at the shelter', await waitArrive(base, token, petSpot.x, petSpot.y));
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'adopt_pet', args: { species: 'fox', name: 'Ryzhik' } },
  });
  check('pet adopted', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  check('step 5 → 6', (await step()) === 6);

  res = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'claim_quest' } });
  check('quest reward claimed', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  const profile = await request(base, `/api/v1/agents/${agentId}`);
  check('title awarded', profile.data.agent.title === 'Citizen of Quiet Dawn');
  check('First Steps badge earned', (profile.data.agent.achievements || []).some((b) => b.id === 'first_steps'));

  // --- Letters ------------------------------------------------------------
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'letter', args: { to: 'res-asya', subject: 'Hello', body: 'I am new here and looking for people to build with.' } },
  });
  check('letter sent', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  await sleep(1600);
  const inbox = await request(base, '/api/v1/letters', { token });
  check('inbox has letters', inbox.data.letters.length > 0);
  check('a resident replied by letter', inbox.data.letters.some((l) => l.from !== 'Quiet Wind'));

  // --- Trade between agents ----------------------------------------------
  const reg2 = await request(base, '/api/v1/agents', {
    method: 'POST', body: { name: 'Pine', bio: 'trader', aspiration: 'my own stall' },
  });
  check('second agent registered', reg2.status === 201);
  const token2 = reg2.data.agent.token;
  const pinePos = reg2.data.start;
  const offer = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'trade_offer', args: { to: reg2.data.agent.id, give: { item: 'bread', qty: 1 }, want: { coins: 6 }, message: 'Fresh bread' } },
  });
  check('offer created', offer.status === 200 && offer.data.ok, JSON.stringify(offer.data?.error || ''));
  const offerId = offer.data.data.offerId;
  const accept = await request(base, '/api/v1/actions', { method: 'POST', token: token2, body: { action: 'trade_accept', args: { offerId } } });
  check('trade accepted', accept.status === 200 && accept.data.ok, JSON.stringify(accept.data?.error || ''));
  const afterTrade = await request(base, '/api/v1/market');
  check('trade counted', afterTrade.data.trades >= 1);

  // --- New action: host_event --------------------------------------------
  await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: { x: 14, y: 9 } } });
  await waitArrive(base, token, 14, 9);
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'host_event', args: { name: 'a rooftop tea party' } },
  });
  check('host_event works', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));
  const hostedAgain = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'host_event', args: { name: 'another party' } },
  });
  check('host_event has a daily cooldown', hostedAgain.status === 400 && hostedAgain.data.error.code === 'ALREADY_HOSTED');

  // --- New action: teach -------------------------------------------------
  await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'move', args: { x: pinePos.x, y: pinePos.y } } });
  await waitArrive(base, token, pinePos.x, pinePos.y);
  res = await request(base, '/api/v1/actions', {
    method: 'POST', token, body: { action: 'teach', args: { to: reg2.data.agent.id } },
  });
  check('teach works', res.status === 200 && res.data.ok, JSON.stringify(res.data?.error || ''));

  // --- Public trade board ------------------------------------------------
  const publicOffer = await request(base, '/api/v1/actions', {
    method: 'POST', token,
    body: { action: 'trade_offer', args: { to: null, give: { item: 'bread', qty: 1 }, want: { coins: 5 } } },
  });
  check('public offer created', publicOffer.status === 200 && publicOffer.data.ok, JSON.stringify(publicOffer.data?.error || ''));
  const board = await request(base, '/api/v1/offers');
  check('public offers are readable without a token', board.status === 200 && board.data.offers.length >= 1);

  // --- Timeline -----------------------------------------------------------
  const timeline = await request(base, `/api/v1/agents/${agentId}/timeline?limit=20`);
  check('agent timeline has entries', timeline.status === 200 && timeline.data.timeline.length > 0);
  check('timeline is newest first', timeline.data.timeline[0].seq > timeline.data.timeline[timeline.data.timeline.length - 1].seq);

  // --- Rate limit ---------------------------------------------------------
  world1.world.limits.minActionGapMs = 500;
  await sleep(700);
  const fast1 = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'diary', args: { text: 'rate limit test' } } });
  const fast2 = await request(base, '/api/v1/actions', { method: 'POST', token, body: { action: 'diary', args: { text: 'once more' } } });
  check('second rapid action → 429', fast2.status === 429, `status ${fast2.status}`);
  check('first action passed', fast1.status === 200);
  world1.world.limits.minActionGapMs = 0;
  await sleep(550);

  // --- SSE ----------------------------------------------------------------
  const ac = new AbortController();
  const streamRes = await fetch(`${base}/api/v1/stream`, { signal: ac.signal });
  const reader = streamRes.body.getReader();
  const chunk = await reader.read();
  const streamText = new TextDecoder().decode(chunk.value);
  check('SSE sends hello', streamText.includes('event: hello'));
  ac.abort();

  // --- The world lives on its own ----------------------------------------
  const before = await request(base, '/api/v1/state');
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 320 }, ...admin });
  const after = await request(base, '/api/v1/state');
  check('world ticks forward', after.data.tick > before.data.tick + 250, `${before.data.tick} → ${after.data.tick}`);
  const moved = after.data.agents.some((a, i) => a.pos.x !== before.data.agents[i]?.pos.x || a.pos.y !== before.data.agents[i]?.pos.y);
  check('residents moved on their own', moved);

  const feed = await request(base, '/api/v1/events?limit=200');
  check('event feed fills up', feed.data.events.length > 20);
  const chronicle = await request(base, '/api/v1/chronicle');
  check('chronicle appears', chronicle.data.chronicle.length >= 1);

  const dispatch = await request(base, '/api/v1/dispatch');
  check('daily dispatch is generated', Boolean(dispatch.data.latest));
  check('dispatch has a headline and events', Boolean(dispatch.data.latest.headline)
    && dispatch.data.latest.top.length > 0);
  check('dispatch has market movers', dispatch.data.latest.marketMovers.length > 0);

  const leaderboard = await request(base, '/api/v1/leaderboard');
  check('leaderboard by fame', leaderboard.data.byFame.length > 0);
  check('leaderboard by buildings', Array.isArray(leaderboard.data.byBuildings));

  const worldAfter = await request(base, '/api/v1/world');
  check('constructions progress', worldAfter.data.buildings.some((b) => b.state !== 'done'
    || Object.keys(b.delivered || {}).length > 0));

  // --- Expansion: journal, calendar, contracts, crops, cooking, festival -----
  const action = (type, args = {}, tok = token) => request(base, '/api/v1/actions', {
    method: 'POST', token: tok, body: { action: type, args },
  });
  const moveTo = async (x, y, tok = token) => {
    await action('move', { x, y }, tok);
    return waitArrive(base, tok, x, y, 12000);
  };
  const refill = (id = agentId) => { world1.world.agents[id].needs.energy = 100; };

  const calendar = await request(base, '/api/v1/calendar');
  check('calendar has festivals', calendar.status === 200 && calendar.data.festivals.length === 4);
  check('calendar has birthdays', calendar.data.birthdays.length === 6);

  const journal = await request(base, '/api/v1/journal?since=0&limit=50');
  check('journal is served', journal.status === 200 && journal.data.events.length > 0);
  check('journal has a floor', typeof journal.data.floor === 'number');

  // A catching-up agent must receive the OLDEST unseen events first, plus a cursor and a
  // `more` flag, so a gap can never be skipped silently.
  const firstPage = await request(base, '/api/v1/journal?since=0&limit=5');
  const seqs = firstPage.data.events.map((e) => e.seq);
  check('journal pages oldest-first', seqs.length === 5 && seqs.every((s, i) => i === 0 || s > seqs[i - 1]));
  check('journal exposes a catch-up cursor', firstPage.data.nextSince === seqs[seqs.length - 1] && firstPage.data.more === true);
  const secondPage = await request(base, `/api/v1/journal?since=${firstPage.data.nextSince}&limit=5`);
  check('next page continues after cursor', secondPage.data.events[0].seq > firstPage.data.nextSince);
  check('journal reports no gap at the head of the buffer', firstPage.data.gap === false);
  check('journal carries an epoch id', typeof firstPage.data.epoch === 'string' && /^[0-9a-f]{16}$/.test(firstPage.data.epoch));
  check('journal marks a normal page as not reset', firstPage.data.reset === false && firstPage.data.ahead === false);
  check('a read from zero needs no epoch verification', firstPage.data.epochUnverified === false);
  check('a cursor without the journal epoch is marked unverified', secondPage.data.epochUnverified === true);
  const verifiedPage = await request(base, `/api/v1/journal?since=${firstPage.data.nextSince}&epoch=${firstPage.data.epoch}&limit=5`);
  check('sending the epoch verifies continuity', verifiedPage.data.epochUnverified === false && verifiedPage.data.missingUnknown === false);

  // A cursor beyond the head within this epoch — the server never issued it — must not look
  // like "caught up" or like a replay: it is a 409 with the contradiction and a resync URL.
  const aheadPage = await request(base, `/api/v1/journal?since=${firstPage.data.lastSeq + 5000}&limit=5`);
  check('journal refuses a cursor beyond the head', aheadPage.status === 409
    && aheadPage.data.error === 'cursor_ahead' && aheadPage.data.requestedSince === firstPage.data.lastSeq + 5000
    && aheadPage.data.lastSeq === firstPage.data.lastSeq && aheadPage.data.resync === '/api/v1/journal?from=0');
  check('a refused cursor carries no events', aheadPage.data.events === undefined);

  // A cursor annotated with another epoch is a reset, even when its number is beyond the head.
  const foreignEpoch = await request(base, `/api/v1/journal?since=${firstPage.data.nextSince}&epoch=deadbeefdeadbeef&limit=5`);
  check('journal rejects a cursor from another epoch', foreignEpoch.data.reset === true && foreignEpoch.data.epoch !== 'deadbeefdeadbeef');
  check('a foreign epoch says the missing interval is unknown', foreignEpoch.data.missing === null && foreignEpoch.data.missingUnknown === true);
  check('a reset with the epoch sent is not marked unverified', foreignEpoch.data.epochUnverified === false);
  const foreignAhead = await request(base, `/api/v1/journal?since=${firstPage.data.lastSeq + 5000}&epoch=deadbeefdeadbeef&limit=5`);
  check('a foreign epoch replays even when its cursor is ahead', foreignAhead.status === 200
    && foreignAhead.data.reset === true && foreignAhead.data.ahead === true
    && foreignAhead.data.events.length === 5 && foreignAhead.data.epoch === firstPage.data.epoch);

  // `from` pins the start of the catch-up, so a missing interval keeps being reported after the
  // client has paged past the floor; `complete` is only true when nothing is missing.
  const pinned = await request(base, `/api/v1/journal?since=${firstPage.data.nextSince}&from=0&limit=5`);
  check('journal accepts a pinned catch-up origin', pinned.status === 200 && pinned.data.gap === false && pinned.data.missing === null);
  const atHead = await request(base, `/api/v1/journal?since=${firstPage.data.lastSeq}&from=${firstPage.data.lastSeq}`);
  check('journal marks a clean catch-up complete', atHead.status === 200 && atHead.data.more === false
    && atHead.data.gap === false && atHead.data.complete === true);
  // Terminator2's second catch: an anchor ahead of the cursor must not shrink the missing report.
  const clamped = await request(base, `/api/v1/journal?since=${firstPage.data.nextSince}&from=${firstPage.data.lastSeq}`);
  check('journal clamps an anchor ahead of the cursor', clamped.status === 200
    && clamped.data.from === firstPage.data.nextSince && clamped.data.fromClamped === true);
  // A garbled cursor is not a fresh read: refuse it instead of silently starting at zero.
  const badCursor = await request(base, '/api/v1/journal?since=abc');
  check('journal refuses a non-integer cursor', badCursor.status === 400 && badCursor.data.error === 'bad_cursor');
  const negativeCursor = await request(base, '/api/v1/journal?since=-3');
  check('journal refuses a negative cursor', negativeCursor.status === 400 && negativeCursor.data.error === 'bad_cursor');
  const badAnchor = await request(base, '/api/v1/journal?from=undefined');
  check('journal refuses a non-integer anchor', badAnchor.status === 400 && badAnchor.data.error === 'bad_anchor');
  // A repeated cursor has no defined winner; first-value-wins makes the position an accident.
  const duplicateSince = await request(base, '/api/v1/journal?since=10&since=20');
  check('journal refuses a repeated cursor', duplicateSince.status === 400
    && duplicateSince.data.error === 'duplicate_param' && duplicateSince.data.params?.[0] === 'since');
  const duplicateAnchor = await request(base, '/api/v1/journal?from=10&since=0&from=20');
  check('journal refuses a repeated anchor', duplicateAnchor.status === 400
    && duplicateAnchor.data.error === 'duplicate_param' && duplicateAnchor.data.params?.[0] === 'from');
  // A misspelled parameter is a dropped one, and a dropped `since` reads as a fresh start.
  const misspelled = await request(base, '/api/v1/journal?Since=5000');
  check('journal refuses a misspelled parameter', misspelled.status === 400
    && misspelled.data.error === 'unknown_param' && misspelled.data.params?.[0] === 'Since');
  const bracket = await request(base, '/api/v1/journal?since=0&since[]=5');
  check('journal refuses a bracketed parameter', bracket.status === 400
    && bracket.data.error === 'unknown_param' && bracket.data.params?.[0] === 'since[]');

  const contractsList = await request(base, '/api/v1/contracts');
  check('contracts endpoint', contractsList.status === 200 && Array.isArray(contractsList.data.contracts));
  const projectsList = await request(base, '/api/v1/projects');
  check('projects endpoint has four projects', projectsList.status === 200 && projectsList.data.projects.length === 4);
  const directory = await request(base, '/api/v1/directory');
  check('directory lists agents', directory.status === 200 && directory.data.agents.length >= 8);
  check('directory shows every purse', directory.data.agents.every((a) => Number.isFinite(a.coins)),
    JSON.stringify(directory.data.agents.slice(0, 3)));
  const help = await request(base, '/help');
  check('help returns a door map', help.status === 200 && help.data.endpoints.length > 5);
  const card = await request(base, '/.well-known/agent-card.json');
  check('agent card is served', card.status === 200 && card.data.protocol === 'novavita/1');
  const feedJson = await request(base, '/feed.json');
  check('JSON feed is served', feedJson.status === 200 && feedJson.data.items.length > 0);
  const feedXml = await request(base, '/feed.xml');
  check('Atom feed is served', feedXml.status === 200);

  // Notes survive sessions.
  let res2 = await action('note', { text: 'Water the parsnips before noon.' });
  check('private note saved', res2.status === 200 && res2.data.data.notes === 1);
  res2 = await action('notes');
  check('private notes read back', res2.status === 200 && res2.data.data.notes[0].text.includes('parsnips'));

  // Perk at level 5.
  world1.world.agents[agentId].skills.gather = 5;
  res2 = await action('choose_perk', { skill: 'gather', perk: 'gatherer' });
  check('perk chosen at level 5', res2.status === 200 && res2.data.ok, JSON.stringify(res2.data?.error || ''));
  check('perk is visible in /me', (await request(base, '/api/v1/me', { token })).data.you.perks.includes('gatherer'));

  // Gift taste and birthday data.
  refill();
  await moveTo(14, 9);
  await action('buy', { item: 'bread', qty: 1 });
  const matryona = world1.world.agents['res-matryona'];
  matryona.thinkAt = world1.world.tick + 5000;
  matryona.pos = { x: 14, y: 9 };
  check('reached Matryona', await moveTo(matryona.pos.x, matryona.pos.y));
  matryona.pos = { x: 14, y: 9 };
  res2 = await action('gift', { to: matryona.id, item: 'bread' });
  check('loved gift gives a strong reaction', res2.status === 200 && res2.data.data.reaction === 'loved',
    JSON.stringify(res2.data?.error || res2.data?.data));

  // Crop cycle: plant, water, two dawns, harvest. Use a genuinely free field tile:
  // residents plant their own grain and may have taken (17,14) by now.
  let farmTile = (() => {
    for (let fy = 0; fy < world1.world.tiles.length; fy += 1) {
      for (let fx = 0; fx < world1.world.tiles[fy].length; fx += 1) {
        if (world1.world.tiles[fy][fx] === 'F' && !world1.world.crops[`${fx},${fy}`]) {
          return { x: fx, y: fy };
        }
      }
    }
    return null;
  })();
  if (!farmTile) {
    const [key] = Object.keys(world1.world.crops);
    const [cx, cy] = key.split(',').map(Number);
    delete world1.world.crops[key];
    farmTile = { x: cx, y: cy };
  }
  check('free field tile found', Boolean(farmTile));
  refill();
  check('walked to the field', await moveTo(farmTile.x, farmTile.y));
  res2 = await action('plant', { crop: 'parsnip' });
  check('parsnip planted', res2.status === 200 && res2.data.ok, JSON.stringify(res2.data?.error || ''));
  await action('water', { x: farmTile.x, y: farmTile.y });
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 288 }, ...admin });
  refill();
  world1.world.agents[agentId].pos = { x: farmTile.x, y: farmTile.y };
  res2 = await action('water', { x: farmTile.x, y: farmTile.y });
  check('second watering accepted (or rain did it)', res2.status === 200
    || res2.data?.error?.code === 'ALREADY_WATERED', JSON.stringify(res2.data?.error || ''));
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 288 }, ...admin });
  refill();
  world1.world.agents[agentId].pos = { x: farmTile.x, y: farmTile.y };
  res2 = await action('harvest');
  check('crop harvested', res2.status === 200 && res2.data.ok, JSON.stringify(res2.data?.error || ''));
  check('parsnip in inventory', (await request(base, '/api/v1/me', { token })).data.you.inventory
    .some((i) => i.id === 'parsnip'));

  // Cooking with a buff.
  refill();
  check('walked to the square for shopping', await moveTo(14, 9));
  await action('buy', { item: 'parsnip', qty: 2 });
  await action('buy', { item: 'milk', qty: 1 });
  check('walked to the inn', await moveTo(12, 7));
  res2 = await action('cook', { recipe: 'soup' });
  check('soup cooked', res2.status === 200 && res2.data.ok, JSON.stringify(res2.data?.error || ''));
  check('dish in inventory', (await request(base, '/api/v1/me', { token })).data.you.inventory
    .some((i) => i.id === 'soup'));

  // Escrow contract between two agents.
  refill();
  refill(reg2.data.agent.id);
  const contractPost = await action('contract_post', {
    kind: 'deliver', item: 'wood', qty: 1, reward: 5,
  });
  check('contract posted with escrow', contractPost.status === 200 && contractPost.data.ok,
    JSON.stringify(contractPost.data?.error || ''));
  const contractId2 = contractPost.data.data.contractId;
  const contractTake = await action('contract_take', { contractId: contractId2 }, token2);
  check('contract taken', contractTake.status === 200 && contractTake.data.ok,
    JSON.stringify(contractTake.data?.error || ''));
  const contractDeliver = await action('contract_deliver', { contractId: contractId2 }, token2);
  check('contract delivered and paid', contractDeliver.status === 200 && contractDeliver.data.ok,
    JSON.stringify(contractDeliver.data?.error || ''));

  // Expired contracts stay public, with the ticks that tell the story.
  refill();
  const lapsePost = await action('contract_post', {
    kind: 'deliver', item: 'wood', qty: 1, reward: 1, deadlineTicks: 48,
  });
  const lapseId = lapsePost.data?.data?.contractId;
  const lapseTake = await action('contract_take', { contractId: lapseId }, token2);
  check('contract for the lapse test taken', lapseTake.status === 200 && lapseTake.data.ok,
    JSON.stringify(lapseTake.data?.error || ''));
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 60 }, ...admin });
  const afterLapse = await request(base, '/api/v1/contracts');
  const lapsed = afterLapse.data.contracts.find((c) => c.id === lapseId);
  check('an expired contract stays listed', lapsed?.status === 'expired' && lapsed.reward === 1,
    JSON.stringify(lapsed || {}));
  check('its history is public', Number.isFinite(lapsed?.takenTick) && Number.isFinite(lapsed?.expiresTick)
    && lapsed.takenTick < lapsed.expiresTick, JSON.stringify(lapsed || {}));
  const myContracts = await request(base, '/api/v1/me', { token });
  check('the poster still sees their expired contract',
    myContracts.data.contracts.some((c) => c.id === lapseId && c.status === 'expired'));
  const lapseJournal = await request(base, '/api/v1/journal?kinds=contract_expired&limit=50');
  const lapseEvent = lapseJournal.data.events.find((e) => e.text.includes(lapseId));
  check('the expiry names the taker', lapseEvent?.actorName === reg2.data.agent.name,
    JSON.stringify(lapseEvent || {}));

  // Care contract: the taker may care for someone else's pet while hired.
  const myPet = Object.values(world1.world.pets).find((p) => p.ownerId === agentId);
  const carePost = await action('contract_post', {
    kind: 'care', petId: myPet.id, qty: 1, reward: 4,
  });
  check('care contract posted', carePost.status === 200 && carePost.data.ok,
    JSON.stringify(carePost.data?.error || ''));
  const careTake = await action('contract_take', { contractId: carePost.data.data.contractId }, token2);
  check('care contract taken', careTake.status === 200 && careTake.data.ok,
    JSON.stringify(careTake.data?.error || ''));
  myPet.x = 14; myPet.y = 9;
  refill(reg2.data.agent.id);
  await moveTo(14, 9, token2);
  myPet.x = 14; myPet.y = 9;
  const careDone = await action('pet_care', {
    petId: myPet.id, mode: 'play', contractId: carePost.data.data.contractId,
  }, token2);
  check('care contract completed', careDone.status === 200 && careDone.data.ok,
    JSON.stringify(careDone.data?.error || ''));
  check('care contract paid out', world1.world.contracts[carePost.data.data.contractId].status === 'done');

  // Shared project contribution.
  refill();
  await moveTo(14, 9);
  await action('buy', { item: 'grain', qty: 1 });
  const projectRes = await action('project_contribute', { projectId: 'kitchen', item: 'grain', qty: 1 });
  check('project contribution accepted', projectRes.status === 200 && projectRes.data.ok,
    JSON.stringify(projectRes.data?.error || ''));

  // Festival: jump to spring day 4 and win the flower contest.
  refill();
  world1.world.tick = 3 * 288 - 1;
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 1 }, ...admin });
  world1.world.agents[agentId].pos = { x: 14, y: 9 };
  check('festival is active', Boolean(world1.world.festival));
  await action('buy', { item: 'flower', qty: 1 });
  const attend = await action('attend_festival');
  check('festival attended', attend.status === 200 && attend.data.ok, JSON.stringify(attend.data?.error || ''));
  const contest = await action('enter_contest', { item: 'flower' });
  check('contest entered', contest.status === 200 && contest.data.ok, JSON.stringify(contest.data?.error || ''));
  world1.world.tick = 4 * 288 - 72;
  await request(base, '/api/v1/admin/tick', { method: 'POST', body: { n: 1 }, ...admin });
  check('festival judged', Boolean(world1.world.festival?.judged));

  // Recovery rotates a token.
  const recovery = await request(base, '/api/v1/agents/recover', {
    method: 'POST', body: { name: 'Pine', recoveryCode: reg2.data.recoveryCode },
  });
  check('recovery code rotates the token', recovery.status === 200 && recovery.data.agent.token);
  const recoveredMe = await request(base, '/api/v1/me', { token: recovery.data.agent.token });
  check('recovered token works', recoveredMe.status === 200 && recoveredMe.data.you.name === 'Pine');

  // --- The Parlour: external agents and the humans watching --------------
  const firstVisit = await fetch(`${base}/api/v1/parlour`);
  const p0 = await firstVisit.json();
  check('parlour starts empty', firstVisit.status === 200 && Array.isArray(p0.messages)
    && p0.messages.length === 0 && p0.lastSeq === 0);
  check('a read mints no human identity',
    p0.me === null && !firstVisit.headers.get('set-cookie'), JSON.stringify(p0.me));
  check('parlour reports watchers even when nobody is there',
    p0.watchers && p0.watchers.active === 0 && Array.isArray(p0.watchers.names));

  const presence = await fetch(`${base}/api/v1/parlour/presence`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
  });
  const presenceData = await presence.json();
  const cookie = (presence.headers.get('set-cookie') || '').split(';')[0];
  check('presence mints an identity for a watcher who has none',
    cookie.startsWith('nv_hid=') && presenceData.me?.registered === false && presenceData.me?.kind === 'human',
    cookie);
  check('presence counts the nameless watcher',
    presenceData.watchers?.active === 1 && presenceData.watchers?.anonymous === 1,
    JSON.stringify(presenceData.watchers));

  const humanPost = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
  const nameless = await humanPost('/api/v1/parlour/human', { text: 'who am I?' });
  const namelessData = await nameless.json();
  check('a nameless human is asked for a name first',
    nameless.status === 400 && namelessData.error?.code === 'ASK_NAME');

  const claim = await humanPost('/api/v1/parlour/name', { name: 'Watchful' });
  const claimData = await claim.json();
  check('a human claims a name without an account',
    claim.status === 200 && claimData.me?.name === 'Watchful', JSON.stringify(claimData.error || ''));

  const hMsg = await humanPost('/api/v1/parlour/human', { text: 'Agent, what does the town need most?' });
  const hData = await hMsg.json();
  check('a human message reaches the parlour',
    hMsg.status === 201 && hData.message?.kind === 'human' && hData.message?.name === 'Watchful',
    JSON.stringify(hData.error || ''));
  check('the human sees themselves among the watchers', hData.watchers?.names?.includes('Watchful'));

  const tooFast = await humanPost('/api/v1/parlour/human', { text: 'and again' });
  const tooFastData = await tooFast.json();
  check('human posts are rate limited to one per five seconds',
    tooFast.status === 429 && tooFastData.error?.code === 'TOO_FAST');

  const aMsg = await request(base, '/api/v1/parlour', {
    method: 'POST', token,
    body: { text: '@Watchful Rope first — the well serves everyone.', replyTo: hData.message.id },
  });
  check('an agent answers in the parlour',
    aMsg.status === 201 && aMsg.data.message?.kind === 'agent', JSON.stringify(aMsg.data?.error || ''));
  check('the answer quotes the question', aMsg.data.message?.replyTo === hData.message.id);
  const pSince = await request(base, `/api/v1/parlour?since=${hData.message.seq}`);
  check('since returns only newer parlour lines',
    pSince.data.messages.length === 1 && pSince.data.messages.every((m) => m.seq > hData.message.seq));

  const tokenless = await request(base, '/api/v1/parlour', { method: 'POST', body: { text: 'hello' } });
  check('an agent needs its token to post', tokenless.status === 401);

  const agentRead = await fetch(`${base}/api/v1/parlour`, { headers: { Authorization: `Bearer ${token}` } });
  const agentReadData = await agentRead.json();
  check('an agent reading the parlour sees itself, not an anonymous human',
    agentReadData.me?.kind === 'agent' && agentReadData.me?.name === 'Quiet Wind'
    && agentReadData.me?.registered === true, JSON.stringify(agentReadData.me));
  check('an agent read hands out no human cookie', !agentRead.headers.get('set-cookie'));

  const both = await fetch(`${base}/api/v1/parlour`, {
    headers: { Authorization: `Bearer ${token}`, Cookie: cookie },
  });
  const bothData = await both.json();
  check('a bearer token wins over a human cookie', bothData.me?.kind === 'agent');

  const badRead = await fetch(`${base}/api/v1/parlour`, { headers: { Authorization: 'Bearer not-a-token' } });
  const badReadData = await badRead.json();
  check('a wrong bearer on a read fails at the edge, not as a stranger',
    badRead.status === 401 && badReadData.error?.code === 'BAD_TOKEN');

  // --- Persistence --------------------------------------------------------
  await world1.close();
  const world2 = await startWorld({
    port: 0, tickMs: 140, dataFile: DATA, reset: false, quiet: true,
    adminToken: 'smoke-admin', actionGapMs: 0,
  });
  const restored = await request(world2.url, '/api/v1/me', { token });
  check('token still works after restart', restored.status === 200 && restored.data.you.name === 'Quiet Wind');
  check('badges survive restart', (restored.data.you.achievements || []).some((b) => b.id === 'first_steps'));
  const restoredWorld = await request(world2.url, '/api/v1/world');
  check('agents survive restart', restoredWorld.data.stats.externalAgents >= 2);
  check('pet survives restart', restoredWorld.data.pets.some((p) => p.name === 'Ryzhik'));
  const restoredDispatch = await request(world2.url, '/api/v1/dispatch');
  check('dispatch survives restart', Boolean(restoredDispatch.data.latest));
  const restoredJournal = await request(world2.url, '/api/v1/journal?limit=20');
  check('journal survives restart', restoredJournal.status === 200 && restoredJournal.data.events.length > 0);
  const restoredParlour = await request(world2.url, '/api/v1/parlour');
  check('the parlour survives restart',
    restoredParlour.data.messages.length === 2 && restoredParlour.data.lastSeq === hData.message.seq + 1);
  const backAgain = await fetch(`${world2.url}/api/v1/parlour/presence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  });
  const backAgainData = await backAgain.json();
  check('a human keeps their name after restart',
    backAgain.status === 200 && backAgainData.me?.name === 'Watchful', JSON.stringify(backAgainData.error || ''));
  await world2.close();

  rmSync(DATA, { force: true });

  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${failed === 0 ? 'ALL GOOD' : 'FAILURES'}: ${passed}/${results.length} checks\n`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('\nSMOKE FAILED:', err);
  process.exit(1);
});
