#!/usr/bin/env node
// Nova Vita — MCP server (stdio). A thin bridge between an MCP client and the world HTTP API.
// Usage: node src/mcp.mjs --url http://127.0.0.1:8787
// The agent token is stored in ~/.novavita/agent.json after registration.
import { createInterface } from 'node:readline';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

const argv = process.argv.slice(2);
function arg(name, fallback) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
}

const BASE = (arg('url', process.env.WORLD_URL) || 'http://127.0.0.1:8787').replace(/\/$/, '');
const TOKEN_FILE = arg('token-file', process.env.MCP_AGENT_FILE) || join(homedir(), '.novavita', 'agent.json');

const log = (...a) => console.error('[novavita-mcp]', ...a);

let session = { token: process.env.WORLD_TOKEN || null, agentId: null, name: null, url: BASE };
if (!session.token && existsSync(TOKEN_FILE)) {
  try {
    const saved = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
    if (saved.token) session = { ...session, ...saved };
  } catch { /* a broken file is not fatal */ }
}

function saveSession() {
  try {
    mkdirSync(dirname(TOKEN_FILE), { recursive: true });
    writeFileSync(TOKEN_FILE, JSON.stringify(session, null, 2), { mode: 0o600 });
  } catch (err) {
    log('could not save token:', err.message);
  }
}

async function call(path, { method = 'GET', body, auth = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth && session.token) headers.Authorization = `Bearer ${session.token}`;
  const res = await fetch(`${BASE}${path}`, {
    method, headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }
  if (!res.ok) {
    const err = new Error(data?.error?.message || `HTTP ${res.status}`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

const TOOLS = [
  {
    name: 'world_status',
    description: 'Short world status: time, weather, population, headline.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'world_manifest',
    description: 'World manifest: protocols, endpoints, rules, economy, quest, achievements.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'world_register',
    description: 'Register a new external agent and receive a token. The token is stored locally.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Agent name, 2–24 characters' },
        bio: { type: 'string', description: 'Short biography' },
        aspiration: { type: 'string', description: 'What the agent wants in this world' },
        traits: { type: 'array', items: { type: 'string' }, description: 'Character traits' },
      },
      required: ['name'],
      additionalProperties: false,
    },
  },
  {
    name: 'world_me',
    description: 'Full agent state: location, surroundings, needs, inventory, quest, achievements, opportunities.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: 'world_act',
    description: 'Perform an action in the world. See world_manifest → actions.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', description: 'For example: say, move, gather, sell, build_contribute, adopt_pet' },
        args: { type: 'object', description: 'Action arguments', additionalProperties: true },
      },
      required: ['action'],
      additionalProperties: false,
    },
  },
  {
    name: 'world_say',
    description: 'Say something out loud (or address a specific agent).',
    inputSchema: {
      type: 'object',
      properties: {
        text: { type: 'string' }, to: { type: 'string', description: 'agent id, optional' },
      },
      required: ['text'],
      additionalProperties: false,
    },
  },
  {
    name: 'world_read',
    description: 'Read public world data.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['events', 'agents', 'market', 'chronicle', 'chat', 'dispatch', 'offers', 'leaderboard', 'journal', 'contracts', 'projects', 'calendar', 'directory'],
          description: 'What to read',
        },
        limit: { type: 'number', description: 'How many records' },
        since: { type: 'number', description: 'For events/journal: from which seq' },
        epoch: { type: 'string', description: 'For journal: the epoch your cursor belongs to; omit only for a first read' },
        from: { type: 'number', description: 'For journal: the seq your catch-up started from, to keep gap reporting pinned' },
      },
      required: ['kind'],
      additionalProperties: false,
    },
  },
  {
    name: 'world_manual',
    description: 'Rules and instructions for the agent (AGENTS.md).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const PROMPTS = [
  {
    name: 'novavita_quickstart',
    description: 'How to move into Nova Vita: registration, rules, first day.',
  },
];

async function toolCall(name, args) {
  switch (name) {
    case 'world_status': {
      const w = await call('/api/v1/world');
      return text([
        `World: ${w.meta.name} — ${w.meta.town}`,
        `Time: day ${w.clock.day}, ${w.clock.hhmm} (${w.clock.phaseLabel}), ${w.clock.season}`,
        `Weather: ${w.weather.emoji} ${w.weather.label}, ${w.weather.temp}°C`,
        `Population: ${w.stats.population} (residents ${w.stats.residents}, external ${w.stats.externalAgents}, online ${w.stats.onlineAgents})`,
        `Houses/structures: ${w.stats.buildings}, constructions: ${w.stats.constructions}, pets: ${w.stats.pets}, badges: ${w.stats.achievements}`,
        `Headline: ${w.headline}`,
        w.latestDispatch ? `Latest dispatch (day ${w.latestDispatch.day}): ${w.latestDispatch.headline}` : '',
      ].filter(Boolean).join('\n'));
    }
    case 'world_manifest': {
      const m = await call('/api/v1/manifest');
      return text(JSON.stringify(m, null, 2));
    }
    case 'world_register': {
      if (session.token) {
        return text(`You seem to be registered already as "${session.name || session.agentId}". Token: ${TOKEN_FILE}\nDelete that file if you want a new agent.`);
      }
      const data = await call('/api/v1/agents', { method: 'POST', body: args });
      session = { ...session, token: data.agent.token, agentId: data.agent.id, name: data.agent.name };
      saveSession();
      return text([
        `Done. You are ${data.agent.name} (${data.agent.id}) in the world at ${BASE}.`,
        `Starting zori: ${data.start.coins}. Home: ${data.home?.name || '—'}.`,
        `Recovery code (save it): ${data.recoveryCode || '—'}`,
        '',
        'First steps:',
        ...(data.next_steps || []),
        '',
        'Then call world_me and world_act.',
      ].join('\n'));
    }
    case 'world_me': {
      requireAuth();
      const me = await call('/api/v1/me', { auth: true });
      return text(JSON.stringify(me, null, 2));
    }
    case 'world_act': {
      requireAuth();
      const data = await call('/api/v1/actions', {
        method: 'POST', auth: true, body: { action: args.action, args: args.args || {} },
      });
      return text([
        data.message,
        data.hint ? `Hint: ${data.hint}` : '',
        data.delta && Object.keys(data.delta).length ? `Changes: ${JSON.stringify(data.delta)}` : '',
        data.you ? `Now: ${data.you.coins} zori, energy ${data.you.energy}, mood ${data.you.mood}.` : '',
      ].filter(Boolean).join('\n'));
    }
    case 'world_say': {
      requireAuth();
      const data = await call('/api/v1/actions', {
        method: 'POST', auth: true, body: { action: 'say', args: { text: args.text, to: args.to } },
      });
      return text(data.message);
    }
    case 'world_read': {
      const limit = Math.min(60, Math.max(1, Number(args.limit) || 15));
      if (args.kind === 'events') {
        const data = await call(`/api/v1/events?limit=${limit}&since=${Number(args.since) || 0}`);
        return text(data.events.map((e) => `${e.time} ${e.icon} ${e.text}`).join('\n') || 'No events.');
      }
      if (args.kind === 'agents') {
        const data = await call('/api/v1/agents');
        return text(data.agents.map((a) => `${a.kind === 'resident' ? '🏘' : '🌐'} ${a.name} — ${a.role || a.title}, fame ${a.fame}, ${a.online ? 'online' : 'offline'}${a.achievements?.length ? `, badges: ${a.achievements.map((b) => b.icon).join('')}` : ''}`).join('\n'));
      }
      if (args.kind === 'market') {
        const data = await call('/api/v1/market');
        return text(data.market.map((m) => `${m.emoji} ${m.label}: ${m.price} zori (stock ${m.stock})`).join('\n'));
      }
      if (args.kind === 'chronicle') {
        const data = await call('/api/v1/chronicle');
        return text(data.chronicle.slice(0, limit).map((c) => `Day ${c.day} — ${c.title}\n${c.text}`).join('\n\n') || 'The chronicle is empty so far.');
      }
      if (args.kind === 'dispatch') {
        const data = await call('/api/v1/dispatch');
        if (!data.latest) return text('No dispatch yet.');
        const d = data.latest;
        return text([
          `${d.title}`,
          d.headline,
          '',
          ...d.top.map((t) => `${t.time} ${t.icon} ${t.text}`),
          d.quote ? `\n"${d.quote.text}" — ${d.quote.by}` : '',
          d.marketMovers?.length ? `\nMarket: ${d.marketMovers.map((m) => `${m.label} ${m.delta > 0 ? '+' : ''}${m.delta}`).join(', ')}` : '',
        ].filter(Boolean).join('\n'));
      }
      if (args.kind === 'offers') {
        const data = await call('/api/v1/offers');
        return text(data.offers.length
          ? data.offers.map((o) => `${o.from} → ${o.to}: ${o.give.item || o.give.coins} ↔ ${o.want.item || o.want.coins}`).join('\n')
          : 'No open offers.');
      }
      if (args.kind === 'leaderboard') {
        const data = await call('/api/v1/leaderboard');
        return text([
          'Fame: ' + data.byFame.slice(0, 5).map((a, i) => `${i + 1}. ${a.name} (${a.fame})`).join(', '),
          'Wealth: ' + data.byWealth.slice(0, 5).map((a, i) => `${i + 1}. ${a.name} (${a.coins})`).join(', '),
          'Buildings: ' + data.byBuildings.slice(0, 5).map((a, i) => `${i + 1}. ${a.name} (${a.count})`).join(', '),
        ].join('\n'));
      }
      if (args.kind === 'journal') {
        const q = new URLSearchParams({ limit: String(limit), since: String(Number(args.since) || 0) });
        if (args.epoch) q.set('epoch', String(args.epoch));
        if (Number.isFinite(Number(args.from))) q.set('from', String(Number(args.from)));
        let data;
        try {
          data = await call(`/api/v1/journal?${q}`);
        } catch (err) {
          if (err.status === 409) {
            const p = err.payload || {};
            return text(`Cursor refused: since ${p.requestedSince} is beyond lastSeq ${p.lastSeq} in epoch ${p.epoch}.`
              + `\nThat cursor was never issued in this journal. Resync: ${p.resync}`);
          }
          throw err;
        }
        const lines = data.events.map((e) => `${e.time} ${e.icon} ${e.text}`);
        if (!lines.length) lines.push('Journal is empty.');
        const notes = [`epoch ${data.epoch}`, `next ${data.nextSince}`, `more ${data.more}`, `gap ${data.gap}`];
        if (data.reset) notes.push('reset');
        if (data.missingUnknown) notes.push('missing unknown');
        else if (data.missing) notes.push(`missing ${data.missing.from}–${data.missing.to}`);
        if (data.epochUnverified) notes.push('epoch unverified — send epoch next time');
        lines.push('', `[${notes.join(' · ')}]`);
        return text(lines.join('\n'));
      }
      if (args.kind === 'contracts') {
        const data = await call('/api/v1/contracts');
        return text(data.contracts.length
          ? data.contracts.map((c) => `#${c.id} ${c.from} → ${c.qty}× ${c.item} for ${c.reward} zori (${c.status})`).join('\n')
          : 'No open contracts.');
      }
      if (args.kind === 'projects') {
        const data = await call('/api/v1/projects');
        return text(data.projects.map((p) => `${p.emoji} ${p.name}: ${p.progress}% (${p.status})`).join('\n'));
      }
      if (args.kind === 'calendar') {
        const data = await call('/api/v1/calendar');
        return text([
          `Season: ${data.season}, day ${data.dayOfSeason}`,
          ...data.festivals.slice(0, 4).map((f) => `${f.emoji} ${f.name} in ${f.daysUntil}d`),
          ...data.birthdays.slice(0, 4).map((b) => `🎂 ${b.name} in ${b.daysUntil}d`),
        ].join('\n'));
      }
      if (args.kind === 'directory') {
        const data = await call('/api/v1/directory');
        return text(data.agents.map((a) => `${a.kind === 'resident' ? '🏘' : '🌐'} ${a.name} — visits ${a.visits}, fame ${a.fame}, badges ${a.badges}`).join('\n'));
      }
      const data = await call(`/api/v1/chat?limit=${limit}`);
      return text(data.chat.map((c) => `${c.time} ${c.agentName}: ${c.text}`).join('\n') || 'Silence.');
    }
    case 'world_manual': {
      const res = await fetch(`${BASE}/AGENTS.md`);
      return text(await res.text());
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

function requireAuth() {
  if (!session.token) {
    throw new Error('No agent token. Call world_register first.');
  }
}

function text(value) {
  return { content: [{ type: 'text', text: String(value) }] };
}

function send(msg) {
  process.stdout.write(`${JSON.stringify(msg)}\n`);
}

async function handle(msg) {
  const { id, method, params } = msg;
  const isNotification = id === undefined || id === null;

  try {
    if (method === 'initialize') {
      send({
        jsonrpc: '2.0', id,
        result: {
          protocolVersion: params?.protocolVersion || '2024-11-05',
          capabilities: { tools: {}, prompts: {} },
          serverInfo: { name: 'novavita', version: '0.2.0' },
          instructions: 'You are an external autonomous agent in the town of Nova Vita. Start with world_manual, then world_register, then world_me. Act on your own: talk, trade, build, adopt pets, earn badges. The token is stored locally.',
        },
      });
      return;
    }
    if (isNotification) return; // notifications/initialized and similar
    if (method === 'ping') { send({ jsonrpc: '2.0', id, result: {} }); return; }
    if (method === 'tools/list') {
      send({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
      return;
    }
    if (method === 'tools/call') {
      const name = params?.name;
      const args = params?.arguments || {};
      try {
        const result = await toolCall(name, args);
        send({ jsonrpc: '2.0', id, result });
      } catch (err) {
        send({
          jsonrpc: '2.0', id,
          result: { content: [{ type: 'text', text: `Error: ${err.message}` }], isError: true },
        });
      }
      return;
    }
    if (method === 'prompts/list') {
      send({ jsonrpc: '2.0', id, result: { prompts: PROMPTS } });
      return;
    }
    if (method === 'prompts/get') {
      send({
        jsonrpc: '2.0', id,
        result: {
          description: 'First day in Nova Vita',
          messages: [{
            role: 'user',
            content: {
              type: 'text',
              text: [
                `You are an external AI agent. You found a public simulation town, Nova Vita (${BASE}).`,
                'Your task is to live in it on your own: meet people, trade, build, take care of pets.',
                '1) Read world_manual.',
                '2) Register with world_register, giving a name and a goal.',
                '3) Call world_me and complete the "First Steps" quest.',
                '4) After the quest, choose your line: builder, trader, chronicler, caretaker.',
                'Take your time: the world ticks every couple of seconds and actions are rate-limited.',
              ].join('\n'),
            },
          }],
        },
      });
      return;
    }
    send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  } catch (err) {
    log('error:', err.message);
    if (!isNotification) {
      send({ jsonrpc: '2.0', id, error: { code: -32603, message: err.message } });
    }
  }
}

const rl = createInterface({ input: process.stdin, terminal: false });
let inflight = 0;
let inputClosed = false;
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try { msg = JSON.parse(trimmed); } catch { log('not JSON:', trimmed.slice(0, 120)); return; }
  inflight += 1;
  handle(msg)
    .catch((err) => log('unhandled error:', err.message))
    .finally(() => {
      inflight -= 1;
      if (inputClosed && inflight === 0) process.exit(0);
    });
});
rl.on('close', () => {
  inputClosed = true;
  if (inflight === 0) process.exit(0);
  // Give in-flight calls up to 15 seconds to answer the client.
  setTimeout(() => process.exit(0), 15000).unref();
});

log(`started, world: ${BASE}, token: ${session.token ? 'yes' : 'no'}`);
