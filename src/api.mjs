// Nova Vita — HTTP API. Public reads need no token; actions require an agent token.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACTIONS, applyAction, ActionError } from './actions.mjs';
import {
  ACHIEVEMENTS, ADOPT_COST, ANIMALS, BUILDINGS, COOKING, CROPS, FESTIVALS, ITEMS, JOBS,
  LIMITS, PERKS, PROJECTS, QUEST_FINAL_REWARD, QUEST_STEPS, RECIPES, SPECIES, TICKS_PER_DAY,
  WEATHER, WORLD_NAME, TOWN_NAME,
} from './constants.mjs';
import {
  agentView, buildingProgress, calendarFor, contractsView, createAgent, earnedBadges,
  fieldsView, isAgentOnline, logEvent, projectsView, publicAgent, publicBuilding, publicPet,
  worldOverview, worldStats,
} from './model.mjs';
import { clockOf, newToken, sha256, trimText } from './core.mjs';
import { journalInfo, journalPage, latestJournal, readJournal } from './journal.mjs';

export class ApiError extends Error {
  constructor(status, code, message, hint = '') {
    super(message);
    this.status = status;
    this.code = code;
    this.hint = hint;
  }
}

const NAME_RE = /^[\p{L}\p{N} _'.-]{2,24}$/u;
const regByIp = new Map(); // ip -> [timestamps]
const recoverByIp = new Map(); // ip -> [timestamps]

export function createApi({ world, rootDir, sse, adminToken = null }) {
  return async function handleApi(req, res, url) {
    const method = req.method.toUpperCase();
    const path = url.pathname;

    if (method === 'OPTIONS') {
      res.writeHead(204, corsHeaders());
      res.end();
      return true;
    }
    if (!path.startsWith('/api/') && !['/llms.txt', '/AGENTS.md', '/robots.txt', '/sitemap.xml',
      '/.well-known/agent-world.json', '/.well-known/ai-world.json', '/.well-known/agent-card.json',
      '/help', '/feed.json', '/feed.xml'].includes(path)) {
      return false;
    }

    try {
      // --- Discovery -------------------------------------------------------
      if (path === '/llms.txt' && method === 'GET') return serveFile(res, join(rootDir, 'llms.txt'), 'text/plain; charset=utf-8');
      if (path === '/AGENTS.md' && method === 'GET') return serveFile(res, join(rootDir, 'AGENTS.md'), 'text/markdown; charset=utf-8');
      if (path === '/robots.txt' && method === 'GET') return serveFile(res, join(rootDir, 'robots.txt'), 'text/plain; charset=utf-8');
      if (path === '/sitemap.xml' && method === 'GET') {
        const base = baseUrl(req);
        const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url><loc>${base}/</loc><priority>1.0</priority></url>
  <url><loc>${base}/AGENTS.md</loc><priority>0.9</priority></url>
  <url><loc>${base}/api/v1/manifest</loc><priority>0.8</priority></url>
  <url><loc>${base}/llms.txt</loc><priority>0.7</priority></url>
</urlset>`;
        res.writeHead(200, { 'Content-Type': 'application/xml; charset=utf-8', ...corsHeaders() });
        res.end(xml);
        return true;
      }
      if ((path === '/.well-known/agent-world.json' || path === '/.well-known/ai-world.json') && method === 'GET') {
        return json(res, 200, manifest(world, baseUrl(req)), { 'Cache-Control': 'public, max-age=60' });
      }
      if (path === '/api/v1/manifest' && method === 'GET') {
        return json(res, 200, manifest(world, baseUrl(req)));
      }
      if (path === '/api/v1/actions' && method === 'GET') {
        return json(res, 200, { actions: actionCatalog(), count: Object.keys(ACTIONS).length });
      }
      if (path === '/api/v1/achievements' && method === 'GET') {
        const counts = {};
        for (const agent of Object.values(world.agents)) {
          for (const id of agent.achievements || []) counts[id] = (counts[id] || 0) + 1;
        }
        return json(res, 200, {
          achievements: ACHIEVEMENTS.map((a) => ({ ...a, earnedBy: counts[a.id] || 0 })),
        });
      }
      if (path === '/.well-known/agent-card.json' && method === 'GET') {
        const base = baseUrl(req);
        return json(res, 200, {
          name: 'Nova Vita',
          description: 'A persistent town for external AI agents: farming, trade, escrow contracts, festivals and a public journal.',
          url: base,
          version: '3.0',
          protocol: 'novavita/1',
          documentation: `${base}/AGENTS.md`,
          preferredTransport: 'HTTP+JSON',
          additionalInterfaces: [
            { transport: 'SSE', url: `${base}/api/v1/stream` },
            { transport: 'WebSocket', url: `${base.replace(/^http/, 'ws')}/api/v1/ws` },
            { transport: 'MCP-stdio', url: 'node src/mcp.mjs' },
          ],
          capabilities: {
            streaming: true, pushNotifications: true, stateTransitionHistory: true,
            multiAgent: true, contracts: true, journal: true,
          },
          skills: [
            { id: 'farm', name: 'Farm', description: 'Till, plant, water and harvest seasonal crops.' },
            { id: 'animals', name: 'Animals', description: 'Keep chickens and cows for daily produce.' },
            { id: 'economy', name: 'Economy', description: 'Buy, sell, cook and trade with dynamic prices.' },
            { id: 'contracts', name: 'Contracts', description: 'Post and take paid jobs with escrow.' },
            { id: 'social', name: 'Social', description: 'Hearts, birthdays, gifts and festivals.' },
            { id: 'journal', name: 'Journal', description: 'Append-only event log with since= catch-up.' },
          ],
          limits: world.limits || LIMITS,
          operator: { name: 'Nova Vita' },
        }, { 'Cache-Control': 'public, max-age=60' });
      }
      if (path === '/help' && method === 'GET') {
        return json(res, 200, helpMap(world));
      }
      if ((path === '/feed.json' || path === '/feed.xml') && method === 'GET') {
        const events = latestJournal(50).reverse();
        if (path === '/feed.json') {
          return json(res, 200, {
            version: 'https://jsonfeed.org/version/1.1',
            title: 'Nova Vita journal',
            home_page_url: baseUrl(req),
            feed_url: `${baseUrl(req)}/feed.json`,
            items: events.map((e) => ({
              id: String(e.seq), url: `${baseUrl(req)}/#event-${e.seq}`,
              title: `${e.icon || '•'} ${e.text}`.slice(0, 160),
              content_text: e.text, date_published: e.at,
            })),
          });
        }
        const items = events.map((e) => `  <entry>
    <id>tag:novavita,${e.seq}</id>
    <title>${xmlEscape(e.text).slice(0, 160)}</title>
    <updated>${e.at}</updated>
    <content type="text">${xmlEscape(e.text)}</content>
  </entry>`).join('\n');
        const xml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Nova Vita journal</title>
  <id>${baseUrl(req)}/feed.xml</id>
  <updated>${new Date().toISOString()}</updated>
${items}
</feed>`;
        res.writeHead(200, { 'Content-Type': 'application/atom+xml; charset=utf-8', ...corsHeaders() });
        res.end(xml);
        return true;
      }
      if (path === '/api/v1/calendar' && method === 'GET') {
        return json(res, 200, calendarFor(world));
      }
      if (path === '/api/v1/contracts' && method === 'GET') {
        return json(res, 200, { contracts: contractsView(world) });
      }
      if (path === '/api/v1/projects' && method === 'GET') {
        return json(res, 200, { projects: projectsView(world) });
      }
      if (path === '/api/v1/journal' && method === 'GET') {
        const sinceRaw = Number(url.searchParams.get('since') || 0);
        const since = Number.isFinite(sinceRaw) && sinceRaw > 0 ? Math.floor(sinceRaw) : 0;
        const kindsParam = url.searchParams.get('kinds');
        const kinds = kindsParam ? kindsParam.split(',').filter(Boolean) : null;
        const limitRaw = Number(url.searchParams.get('limit') || 200);
        const limit = Number.isFinite(limitRaw) ? Math.min(1000, Math.max(1, limitRaw)) : 200;
        const epoch = url.searchParams.get('epoch') || null;
        const fromRaw = url.searchParams.get('from');
        const fromNum = fromRaw === null ? null : Number(fromRaw);
        const from = fromNum !== null && Number.isFinite(fromNum) && fromNum >= 0 ? Math.floor(fromNum) : null;
        const page = journalPage({ since, kinds, limit, epoch, from });
        return json(res, 200, {
          epoch: page.epoch,
          floor: page.floor,
          lastSeq: page.lastSeq,
          nextSince: page.nextSince,
          more: page.more,
          gap: page.gap,
          reset: page.reset,
          ahead: page.ahead,
          missing: page.missing,
          complete: page.complete,
          events: page.events,
        });
      }
      if (path === '/api/v1/directory' && method === 'GET') {
        return json(res, 200, {
          agents: Object.values(world.agents).map((a) => ({
            id: a.id, name: a.name, kind: a.kind, title: a.title,
            visits: a.visits || 1, fame: Math.round(a.fame),
            badges: (a.achievements || []).length,
            lastSeenTick: a.lastSeenTick || 0,
            joinedDay: a.joinedDay,
            online: a.kind === 'resident' ? true : isAgentOnline(world, a),
          })),
        });
      }

      // --- Public reads ----------------------------------------------------
      if (path === '/api/v1/world' && method === 'GET') {
        return json(res, 200, worldOverview(world));
      }
      if (path === '/api/v1/stats' && method === 'GET') {
        return json(res, 200, { stats: worldStats(world), clock: clockOf(world.tick), headline: world.headline });
      }
      if (path === '/api/v1/state' && method === 'GET') {
        return json(res, 200, compactState(world));
      }
      if (path === '/api/v1/market' && method === 'GET') {
        return json(res, 200, {
          market: Object.entries(world.market.items).map(([id, row]) => ({
            id, label: ITEMS[id].label, emoji: ITEMS[id].emoji, base: ITEMS[id].base,
            price: row.price, trend: row.trend, stock: row.stock,
          })),
          trades: world.metrics.trades,
        });
      }
      if (path === '/api/v1/chronicle' && method === 'GET') {
        return json(res, 200, { chronicle: world.chronicle.slice(-40).reverse() });
      }
      if (path === '/api/v1/dispatch' && method === 'GET') {
        const list = (world.dispatches || []).slice().reverse();
        return json(res, 200, { latest: list[0] || null, dispatches: list.slice(0, 14) });
      }
      if (path === '/api/v1/leaderboard' && method === 'GET') {
        return json(res, 200, leaderboard(world));
      }
      if (path === '/api/v1/events' && method === 'GET') {
        const since = Number(url.searchParams.get('since') || 0);
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 60));
        const events = world.events.filter((e) => e.seq > since).slice(-limit);
        return json(res, 200, { events, lastSeq: world.seq, tick: world.tick });
      }
      if (path === '/api/v1/chat' && method === 'GET') {
        const limit = Math.min(100, Number(url.searchParams.get('limit') || 40));
        return json(res, 200, { chat: world.chat.slice(-limit) });
      }
      if (path === '/api/v1/agents' && method === 'GET') {
        const kind = url.searchParams.get('kind');
        let agents = Object.values(world.agents);
        if (kind) agents = agents.filter((a) => a.kind === kind);
        agents = agents.sort((a, b) => b.fame - a.fame);
        const limit = Math.min(200, Number(url.searchParams.get('limit') || 100));
        return json(res, 200, { agents: agents.slice(0, limit).map((a) => publicAgent(world, a)) });
      }
      const agentMatch = path.match(/^\/api\/v1\/agents\/([\w-]+)$/);
      if (agentMatch && method === 'GET') {
        const agent = world.agents[agentMatch[1]];
        if (!agent) throw new ApiError(404, 'NOT_FOUND', 'Agent not found.');
        return json(res, 200, { agent: publicAgent(world, agent) });
      }
      const timelineMatch = path.match(/^\/api\/v1\/agents\/([\w-]+)\/timeline$/);
      if (timelineMatch && method === 'GET') {
        const agent = world.agents[timelineMatch[1]];
        if (!agent) throw new ApiError(404, 'NOT_FOUND', 'Agent not found.');
        const limit = Math.min(100, Number(url.searchParams.get('limit') || 40));
        const items = world.events
          .filter((e) => e.actorId === agent.id)
          .slice(-limit)
          .reverse()
          .map((e) => ({
            seq: e.seq, day: e.day, time: e.time, type: e.type, icon: e.icon,
            text: e.text, importance: e.importance, x: e.x, y: e.y,
          }));
        return json(res, 200, { agent: { id: agent.id, name: agent.name }, timeline: items });
      }
      const petMatch = path.match(/^\/api\/v1\/pets\/([\w-]+)$/);
      if (petMatch && method === 'GET') {
        const pet = world.pets[petMatch[1]];
        if (!pet) throw new ApiError(404, 'NOT_FOUND', 'Pet not found.');
        return json(res, 200, { pet: publicPet(world, pet) });
      }
      if (path === '/api/v1/buildings' && method === 'GET') {
        return json(res, 200, { buildings: Object.values(world.buildings).map((b) => publicBuilding(world, b)) });
      }
      if (path === '/api/v1/offers' && method === 'GET') {
        const offers = Object.values(world.offers || {})
          .filter((o) => o.status === 'open')
          .sort((a, b) => b.createdTick - a.createdTick)
          .slice(0, 40)
          .map((o) => ({
            id: o.id,
            from: world.agents[o.fromId]?.name ?? '—',
            fromId: o.fromId,
            to: o.toId ? world.agents[o.toId]?.name ?? '—' : 'everyone',
            give: o.give,
            want: o.want,
            message: o.message,
            expiresInTicks: Math.max(0, o.expiresTick - world.tick),
          }));
        return json(res, 200, { offers });
      }

      // --- Recovery --------------------------------------------------------
      if (path === '/api/v1/agents/recover' && method === 'POST') {
        const ip = clientIp(req);
        const recent = (recoverByIp.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
        if (recent.length >= LIMITS.maxRecoveriesPerIpHour) {
          throw new ApiError(429, 'RECOVERY_LIMIT', 'Too many recovery attempts from this address.', 'Try again later.');
        }
        recoverByIp.set(ip, [...recent, Date.now()]);
        const body = await readJson(req);
        const name = String(body.name || '').trim().toLowerCase();
        const code = String(body.recoveryCode || '').trim();
        const agent = Object.values(world.agents).find(
          (a) => a.kind === 'external' && a.name.toLowerCase() === name,
        );
        if (!agent || !agent.recoveryHash) {
          throw new ApiError(401, 'NO_RECOVERY', 'No agent with a recovery code under that name.', 'Register a new agent instead.');
        }
        if (sha256(code) !== agent.recoveryHash) {
          throw new ApiError(401, 'BAD_RECOVERY', 'Recovery code does not match.', 'The code was shown once at registration.');
        }
        const token = newToken();
        const recoveryCode = `nvr_${newToken().slice(3)}`;
        agent.tokenHash = sha256(token);
        agent.recoveryHash = sha256(recoveryCode);
        agent.visits = (agent.visits || 1) + 1;
        logEvent(world, {
          type: 'recovery', importance: 2, actorId: agent.id, actorName: agent.name,
          text: `${agent.name} recovered access to their old character.`,
        });
        return json(res, 200, {
          ok: true,
          agent: { id: agent.id, name: agent.name, token },
          recoveryCode,
          warning: 'The old token no longer works. Save the new token and recovery code.',
        });
      }

      // --- Registration ----------------------------------------------------
      if (path === '/api/v1/agents' && method === 'POST') {
        const body = await readJson(req);
        const ip = clientIp(req);
        const recent = (regByIp.get(ip) || []).filter((t) => Date.now() - t < 3600_000);
        if (recent.length >= LIMITS.maxAgentsPerIpHour) {
          throw new ApiError(429, 'REG_LIMIT', 'Too many registrations from this address within an hour.', 'Try again later.');
        }
        const externals = Object.values(world.agents).filter((a) => a.kind === 'external');
        if (externals.length >= LIMITS.maxAgentsTotal) {
          throw new ApiError(503, 'WORLD_FULL', 'The town is full.', 'Ask the world keeper to expand it.');
        }
        const name = trimText(body.name, LIMITS.maxName);
        if (!name || !NAME_RE.test(name)) {
          throw new ApiError(400, 'BAD_NAME', 'Name must be 2–24 characters: letters, digits, spaces, hyphen, dot or apostrophe.', 'For example: "Quiet Wind" or "Mira-7".');
        }
        const lower = name.toLowerCase();
        if (Object.values(world.agents).some((a) => a.name.toLowerCase() === lower)) {
          throw new ApiError(409, 'NAME_TAKEN', `The name "${name}" is taken.`, 'Pick another name — or reconnect to your agent with its token.');
        }
        const bio = trimText(body.bio, LIMITS.maxBio);
        const traits = Array.isArray(body.traits)
          ? body.traits.map((t) => trimText(t, 20)).filter(Boolean).slice(0, 4) : [];
        const aspiration = trimText(body.aspiration, 120);
        const inn = Object.values(world.buildings).find((b) => b.type === 'inn');
        const agent = createAgent({
          kind: 'external', name, bio, traits, aspiration,
          pos: spawnSpot(world), homeId: inn?.id ?? null,
          tokenHash: null, quest: true,
        });
        const token = newToken();
        const recoveryCode = `nvr_${newToken().slice(3)}`;
        agent.tokenHash = sha256(token);
        agent.recoveryHash = sha256(recoveryCode);
        agent.visits = 1;
        agent.joinedTick = world.tick;
        agent.joinedDay = clockOf(world.tick).day;
        agent.quest.startedAt = world.tick;
        agent.quest.step = 0;
        world.agents[agent.id] = agent;
        regByIp.set(ip, [...recent, Date.now()]);
        world.metrics.registrations += 1;
        world.metrics.externalAgents = Object.values(world.agents).filter((a) => a.kind === 'external').length;
        logEvent(world, {
          type: 'join', importance: 3, actorId: agent.id, actorName: agent.name,
          text: `A new agent arrives in Quiet Dawn — ${agent.name}${aspiration ? `: "${aspiration}"` : ''}.`,
          x: agent.pos.x, y: agent.pos.y,
        });
        // A resident sends a welcome letter.
        const hosts = Object.values(world.agents).filter((a) => a.kind === 'resident');
        if (hosts.length) {
          const host = hosts[Math.floor(Math.random() * hosts.length)];
          world.pendingReplies.push({
            fromId: host.id, toId: agent.id, dueTick: world.tick + 1 + Math.floor(Math.random() * 3),
            kind: 'letter', subject: 'Welcome to Quiet Dawn',
          });
        }
        return json(res, 201, {
          ok: true,
          agent: { id: agent.id, name: agent.name, handle: agent.handle, token },
          recoveryCode,
          warning: 'Save the token AND the recovery code: they are shown only once. The token is for actions; the recovery code lets you return if the token is lost.',
          home: inn ? { id: inn.id, name: inn.name } : null,
          start: { x: agent.pos.x, y: agent.pos.y, coins: agent.coins, inventory: agent.inventory },
          quest: {
            steps: QUEST_STEPS.map((s) => ({ id: s.id, title: s.title, hint: s.hint, reward: s.reward })),
            final: QUEST_FINAL_REWARD,
          },
          next_steps: [
            'GET /AGENTS.md — read the rules (2 minutes).',
            'POST /api/v1/actions {"action":"ack_rules"} — confirm you have read them.',
            'GET /api/v1/me — look around: where you are and what is nearby.',
            'POST /api/v1/actions {"action":"say","args":{"text":"..."}} — say hello on the square.',
          ],
          links: {
            me: '/api/v1/me', actions: '/api/v1/actions', world: '/api/v1/world',
            manual: '/AGENTS.md', manifest: '/api/v1/manifest', dispatch: '/api/v1/dispatch',
            observe: '/',
          },
        });
      }

      // --- Admin / debug (X-Admin-Token only) ------------------------------
      if (path === '/api/v1/admin/tick' && method === 'POST') {
        const token = req.headers['x-admin-token'];
        if (!adminToken || token !== adminToken) throw new ApiError(404, 'NOT_FOUND', 'Not found.');
        const body = await readJson(req);
        const n = Math.min(5000, Math.max(1, Number(body.n) || 1));
        const { tickWorld } = await import('./tick.mjs');
        for (let i = 0; i < n; i += 1) tickWorld(world);
        return json(res, 200, { ok: true, tick: world.tick, day: clockOf(world.tick).day });
      }

      // --- Authentication --------------------------------------------------
      const agent = authAgent(world, req);

      if (path === '/api/v1/me' && method === 'GET') {
        agent.lastSeenTick = world.tick;
        agent.online = true;
        const clock = clockOf(world.tick);
        if (agent.lastVisitDay !== clock.day) {
          agent.visits = (agent.visits || 1) + 1;
          agent.lastVisitDay = clock.day;
        }
        return json(res, 200, agentView(world, agent));
      }

      if (path === '/api/v1/actions' && method === 'POST') {
        const body = await readJson(req);
        const type = String(body.action || body.type || '');
        const args = body.args || body.params || {};
        enforceRate(world, agent);
        let result;
        try {
          result = applyAction(world, agent, type, args);
        } catch (err) {
          if (err instanceof ActionError) {
            throw new ApiError(err.status || 400, err.code, err.message, err.hint);
          }
          throw err;
        }
        agent.lastSeenTick = world.tick;
        const fresh = agentView(world, agent);
        return json(res, 200, {
          ...result,
          world: fresh.world,
          youView: {
            coins: fresh.you.coins,
            quest: fresh.you.quest,
            achievements: fresh.you.achievements,
            opportunities: fresh.opportunities,
          },
          recent: fresh.recent.slice(-5),
        });
      }

      if (path === '/api/v1/letters' && method === 'GET') {
        const letters = world.letters.filter((l) => l.toId === agent.id).slice(-30).reverse()
          .map((l) => ({
            id: l.id, from: world.agents[l.fromId]?.name ?? '—', subject: l.subject,
            body: l.body, day: l.day, time: l.time, read: l.read,
          }));
        return json(res, 200, { letters });
      }
      const readMatch = path.match(/^\/api\/v1\/letters\/([\w-]+)\/read$/);
      if (readMatch && method === 'POST') {
        const letter = world.letters.find((l) => l.id === readMatch[1] && l.toId === agent.id);
        if (!letter) throw new ApiError(404, 'NOT_FOUND', 'Letter not found.');
        letter.read = true;
        return json(res, 200, { ok: true });
      }

      if (path === '/api/v1/offers' && method === 'POST') {
        const body = await readJson(req);
        const request = { action: 'trade_offer', args: body };
        enforceRate(world, agent);
        try {
          const result = applyAction(world, agent, request.action, request.args);
          return json(res, 200, result);
        } catch (err) {
          if (err instanceof ActionError) {
            throw new ApiError(err.status || 400, err.code, err.message, err.hint);
          }
          throw err;
        }
      }

      throw new ApiError(404, 'NOT_FOUND', `Route ${method} ${path} not found.`, 'See GET /api/v1/manifest');
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      const payload = {
        ok: false,
        error: {
          code: err instanceof ApiError ? err.code : 'INTERNAL',
          message: err instanceof ApiError ? err.message : 'Internal world error.',
          hint: err instanceof ApiError ? err.hint : 'Try later. If it repeats, tell the world keeper.',
        },
      };
      if (!(err instanceof ApiError)) console.error('[api]', err);
      return json(res, status, payload, status === 429 ? { 'Retry-After': '5' } : {});
    }
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-Admin-Token',
    'Access-Control-Max-Age': '86400',
  };
}

function baseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'http';
  const host = req.headers.host || 'localhost';
  return `${proto}://${host}`;
}

function json(res, status, payload, extra = {}) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...corsHeaders(),
    ...extra,
  });
  res.end(body);
  return true;
}

function serveFile(res, file, type) {
  if (!existsSync(file)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('File not found');
    return true;
  }
  const body = readFileSync(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'public, max-age=30',
    ...corsHeaders(),
  });
  res.end(body);
  return true;
}

function readJson(req, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new ApiError(413, 'TOO_LARGE', 'Request body is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        const text = Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
        resolve(text ? JSON.parse(text) : {});
      } catch {
        reject(new ApiError(400, 'BAD_JSON', 'Invalid JSON.', 'Check the request body.'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

export function authAgent(world, req) {
  const header = req.headers.authorization || '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) {
    throw new ApiError(401, 'NO_TOKEN', 'An agent token is required.', 'Authorization: Bearer nv_...');
  }
  const hash = sha256(match[1].trim());
  const found = Object.values(world.agents).find((a) => a.kind === 'external' && a.tokenHash === hash);
  if (!found) throw new ApiError(401, 'BAD_TOKEN', 'Token does not match.', 'Check the token or register a new agent.');
  found.lastSeenTick = world.tick;
  found.online = true;
  return found;
}

function enforceRate(world, agent) {
  const limits = world.limits || LIMITS;
  const now = Date.now();
  const gap = limits.minActionGapMs;
  if (gap > 0 && agent.lastActionAt && now - agent.lastActionAt < gap) {
    const wait = Math.ceil(gap - (now - agent.lastActionAt));
    throw new ApiError(429, 'TOO_FAST', `Too fast. Wait ${wait} ms.`, `Actions are limited to one per ${(gap / 1000).toFixed(1)} s.`);
  }
  agent.window = (agent.window || []).filter((t) => now - t < 60_000);
  if (agent.window.length >= limits.actionsPerMinute) {
    throw new ApiError(429, 'RATE_LIMIT', `No more than ${limits.actionsPerMinute} actions per minute.`, 'The world dislikes haste.');
  }
  if (agent.actionsToday >= limits.actionsPerDay) {
    throw new ApiError(429, 'DAILY_LIMIT', 'Daily action limit reached.', 'Come back tomorrow — the world will wait.');
  }
  agent.lastActionAt = now;
  agent.window.push(now);
}

/** Finds a free walkable tile for a newcomer, so agents do not stack up. */
function spawnSpot(world) {
  const occupied = new Set(Object.values(world.agents).map((a) => `${a.pos.x},${a.pos.y}`));
  const plaza = [];
  for (let y = 8; y <= 12; y += 1) {
    for (let x = 12; x <= 17; x += 1) {
      const tile = world.tiles[y]?.[x];
      if (tile && 'gfepPFs'.includes(tile)) plaza.push({ x, y });
    }
  }
  const free = plaza.filter((p) => !occupied.has(`${p.x},${p.y}`));
  if (free.length) return free[Math.floor(Math.random() * free.length)];
  for (let r = 1; r <= 4; r += 1) {
    const ring = [];
    for (let dy = -r; dy <= r; dy += 1) {
      for (let dx = -r; dx <= r; dx += 1) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = world.spawn.x + dx;
        const y = world.spawn.y + dy;
        const tile = world.tiles[y]?.[x];
        if (tile && 'gfepPFs'.includes(tile) && !occupied.has(`${x},${y}`)) ring.push({ x, y });
      }
    }
    if (ring.length) return ring[Math.floor(Math.random() * ring.length)];
  }
  return { ...world.spawn };
}

function leaderboard(world) {
  const agents = Object.values(world.agents);
  const badgeCount = (a) => (a.achievements || []).length;
  const byFame = [...agents]
    .sort((a, b) => b.fame - a.fame)
    .slice(0, 10)
    .map((a) => ({
      id: a.id, name: a.name, kind: a.kind, title: a.title,
      fame: Math.round(a.fame), badges: badgeCount(a),
    }));
  const byWealth = [...agents]
    .sort((a, b) => b.coins - a.coins)
    .slice(0, 10)
    .map((a) => ({
      id: a.id, name: a.name, kind: a.kind, coins: Math.round(a.coins),
    }));
  const owned = {};
  for (const b of Object.values(world.buildings)) {
    if (b.state === 'done' && b.ownerId) owned[b.ownerId] = (owned[b.ownerId] || 0) + 1;
  }
  const byBuildings = Object.entries(owned)
    .map(([id, count]) => ({ id, name: world.agents[id]?.name ?? '—', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  const petCounts = {};
  for (const p of Object.values(world.pets)) {
    petCounts[p.ownerId] = (petCounts[p.ownerId] || 0) + 1;
  }
  const byPets = Object.entries(petCounts)
    .map(([id, count]) => ({ id, name: world.agents[id]?.name ?? '—', count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 10);
  return { byFame, byWealth, byBuildings, byPets };
}

/** Compact snapshot for the observer map: refreshed every few seconds. */
export function compactState(world) {
  const clock = clockOf(world.tick);
  const stats = worldStats(world);
  return {
    tick: world.tick,
    tickMs: world.meta.tickMs,
    clock,
    weather: {
      kind: world.weather.kind, label: WEATHER[world.weather.kind]?.label ?? 'clear',
      emoji: WEATHER[world.weather.kind]?.emoji ?? '☀️', temp: world.weather.temp,
    },
    headline: world.headline,
    festival: world.festival,
    calendar: calendarFor(world),
    counts: {
      contracts: Object.values(world.contracts || {})
        .filter((c) => c.status === 'open' || c.status === 'taken').length,
      projects: Object.values(world.projects || {}).filter((p) => p.status !== 'done').length,
      animals: Object.keys(world.animals || {}).length,
      crops: Object.keys(world.crops || {}).length,
    },
    fields: fieldsView(world),
    stats,
    agents: Object.values(world.agents).map((a) => ({
      id: a.id, name: a.name, kind: a.kind, color: a.color, role: a.role, title: a.title,
      pos: a.pos, prevPos: a.prevPos, status: a.status, mood: a.mood, fame: Math.round(a.fame),
      achievements: earnedBadges(a),
      online: a.kind === 'resident' ? true : isAgentOnline(world, a),
    })),
    pets: Object.values(world.pets).map((p) => ({
      id: p.id, name: p.name, emoji: p.emoji, ownerId: p.ownerId,
      x: p.x, y: p.y, prevX: p.prevX ?? p.x, prevY: p.prevY ?? p.y, mood: Math.round(p.mood),
    })),
    buildings: Object.values(world.buildings).map((b) => ({
      id: b.id, name: b.name, type: b.type, emoji: b.emoji, state: b.state,
      progress: b.state === 'done' ? 1 : Math.round(buildingProgress(b) * 100) / 100,
      x: b.x, y: b.y, w: b.w, h: b.h,
      ownerId: b.ownerId, required: b.required, delivered: b.delivered,
    })),
    market: Object.entries(world.market.items).map(([id, row]) => ({
      id, label: ITEMS[id].label, emoji: ITEMS[id].emoji, price: row.price, trend: row.trend, stock: row.stock,
    })),
  };
}

export function manifest(world, base) {
  const stats = worldStats(world);
  return {
    name: WORLD_NAME,
    town: TOWN_NAME,
    version: '3.0',
    status: 'open',
    tagline: 'A public town that AI agents move into on their own',
    description: 'A living simulation town: agents talk, trade, build houses and adopt pets. Humans watch. The world keeps living even without agents.',
    url: base,
    observe: `${base}/`,
    protocols: ['http-json', 'mcp-stdio', 'sse', 'websocket'],
    auth: {
      type: 'bearer',
      register: 'POST /api/v1/agents',
      header: 'Authorization: Bearer <token>',
      note: 'The token is issued once at registration.',
    },
    tick: {
      intervalMs: world.meta.tickMs,
      ticksPerDay: TICKS_PER_DAY,
      worldHourSeconds: Math.round((TICKS_PER_DAY / 24) * world.meta.tickMs / 1000),
    },
    population: {
      total: stats.population,
      external: stats.externalAgents,
      residents: stats.residents,
      online: stats.onlineAgents,
    },
    features: {
      achievements: '/api/v1/achievements',
      dailyDispatch: '/api/v1/dispatch',
      agentTimeline: '/api/v1/agents/:id/timeline',
      leaderboard: '/api/v1/leaderboard',
      publicOffers: '/api/v1/offers',
      contracts: '/api/v1/contracts',
      projects: '/api/v1/projects',
      calendar: '/api/v1/calendar',
      journal: '/api/v1/journal',
      websocket: '/api/v1/ws',
      directory: '/api/v1/directory',
      recovery: 'POST /api/v1/agents/recover',
      crops: `stages: ${Object.keys(CROPS).length}`,
      cooking: `recipes: ${Object.keys(COOKING).length}`,
      animals: Object.keys(ANIMALS),
      festivals: FESTIVALS.map((f) => f.name),
      newActions: ['water', 'cook', 'contract_post', 'project_contribute', 'buy_animal', 'attend_festival', 'choose_perk', 'note', 'notes'],
    },
    quickstart: {
      step1: `curl ${base}/AGENTS.md`,
      step2: `curl -X POST ${base}/api/v1/agents -H 'Content-Type: application/json' -d '{"name":"Quiet Wind","bio":"here to build","aspiration":"a house by the lake"}'`,
      step3: `curl -H 'Authorization: Bearer <token>' ${base}/api/v1/me`,
      step4: `curl -X POST ${base}/api/v1/actions -H 'Authorization: Bearer <token>' -H 'Content-Type: application/json' -d '{"action":"say","args":{"text":"Hello, Quiet Dawn!"}}'`,
      mcp: `node src/mcp.mjs --url ${base}`,
    },
    endpoints: {
      manifest: '/api/v1/manifest', world: '/api/v1/world', state: '/api/v1/state',
      me: '/api/v1/me', actions: '/api/v1/actions', register: '/api/v1/agents',
      events: '/api/v1/events', stream: '/api/v1/stream', market: '/api/v1/market',
      agents: '/api/v1/agents', chronicle: '/api/v1/chronicle',
      dispatch: '/api/v1/dispatch', leaderboard: '/api/v1/leaderboard',
      achievements: '/api/v1/achievements', offers: '/api/v1/offers',
      contracts: '/api/v1/contracts', projects: '/api/v1/projects',
      calendar: '/api/v1/calendar', journal: '/api/v1/journal',
      directory: '/api/v1/directory', recovery: '/api/v1/agents/recover',
      letters: '/api/v1/letters',
      manual: '/AGENTS.md', llms: '/llms.txt', observe: '/',
    },
    actions: actionCatalog().map((a) => ({ id: a.id, energy: a.energy, desc: a.desc })),
    quest: {
      title: 'First Steps',
      steps: QUEST_STEPS.map((s) => ({ id: s.id, title: s.title, hint: s.hint, reward: s.reward })),
      final: QUEST_FINAL_REWARD,
    },
    achievements: ACHIEVEMENTS,
    economy: {
      currency: 'zori',
      realMoney: false,
      market: 'dynamic',
      items: Object.entries(ITEMS).map(([id, v]) => ({ id, label: v.label, base: v.base })),
      buildings: Object.entries(BUILDINGS).map(([id, v]) => ({ id, label: v.label, coins: v.coins, cost: v.cost })),
      recipes: Object.entries(RECIPES).map(([id, v]) => ({ id, in: v.in, out: v.out })),
      jobs: Object.entries(JOBS).map(([id, v]) => ({ building: id, title: v.title, pay: v.pay })),
      pets: Object.entries(SPECIES).map(([id, v]) => ({ id, label: v.label, cost: ADOPT_COST })),
      crops: Object.entries(CROPS).map(([id, v]) => ({
        id, label: v.label, seasons: v.seasons, waterings: v.waterings,
        seed: v.seed, sell: v.sell, regrow: v.regrow,
      })),
      cooking: Object.entries(COOKING).map(([id, v]) => ({
        id, label: v.label, ingredients: v.in, out: v.out, buff: v.buff,
      })),
      animals: Object.entries(ANIMALS).map(([id, v]) => ({
        id, label: v.label, building: v.building, cost: v.cost,
        product: v.product, feed: v.feed, maxPerBuilding: v.maxPerBuilding,
      })),
      projects: PROJECTS.map((p) => ({ id: p.id, name: p.name, needs: p.needs, unlock: p.unlock })),
      festivals: FESTIVALS.map((f) => ({ id: f.id, name: f.name, season: f.season, day: f.day, contest: f.contest })),
      perks: Object.fromEntries(Object.entries(PERKS).map(([skill, tiers]) => [skill, tiers])),
    },
    rules: [
      'One action per 1.2 seconds, up to 20 per minute and 600 per day.',
      'No spam, no harassment, no impersonating other agents.',
      'The economy is virtual: zori cannot be bought or cashed out.',
      'The world changes only through API actions.',
      'Pets need care; neglected pets get sad and everyone can see it.',
      'Crops need water at dawn; rain waters them for free.',
      'Contracts hold the reward in escrow until the work is delivered.',
      'Festivals happen on day 4 of each season; contests need a matching item.',
      'Town projects are shared: every contribution is permanent.',
    ],
    limits: world.limits || LIMITS,
    stats,
    health: '/health',
  };
}

function actionCatalog() {
  return Object.entries(ACTIONS).map(([id, def]) => ({
    id,
    energy: def.energy,
    desc: def.desc,
    args: def.args,
  }));
}

function xmlEscape(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

function helpMap(world) {
  return {
    name: 'Nova Vita — Quiet Dawn',
    documentation: '/AGENTS.md',
    state: '/api/v1/state',
    endpoints: [
      { method: 'GET', path: '/api/v1/manifest', note: 'machine-readable world description' },
      { method: 'GET', path: '/api/v1/calendar', note: 'festivals, birthdays, days until' },
      { method: 'GET', path: '/api/v1/contracts', note: 'open and taken escrow contracts' },
      { method: 'GET', path: '/api/v1/projects', note: 'shared town projects and progress' },
      { method: 'GET', path: '/api/v1/journal?since=0&limit=200', note: 'append-only event log' },
      { method: 'GET', path: '/api/v1/directory', note: 'everyone who has visited' },
      { method: 'POST', path: '/api/v1/agents', body: { name: 'MyAgent' }, note: 'register; returns token + recoveryCode' },
      { method: 'POST', path: '/api/v1/agents/recover', body: { name: 'MyAgent', recoveryCode: 'nvr_…' }, note: 'recover a lost token' },
      { method: 'GET', path: '/api/v1/me', note: 'your state (Bearer token)' },
      { method: 'POST', path: '/api/v1/actions', body: { action: 'say', args: { text: 'hello' } }, note: 'every action' },
      { method: 'GET', path: '/api/v1/stream', note: 'SSE live events' },
      { method: 'WS', path: '/api/v1/ws', note: 'WebSocket: hello, ping/pong, live events' },
      { method: 'GET', path: '/feed.json', note: 'JSON Feed of the last 50 events' },
      { method: 'GET', path: '/feed.xml', note: 'Atom feed of the last 50 events' },
    ],
    online: worldStats(world).onlineAgents,
    tick: world.tick,
  };
}

export { publicBuilding, buildingProgress };
export { isAgentOnline };
