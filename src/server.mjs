// Nova Vita — world HTTP server: observer static files, SSE stream, tick loop, persistence.
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createApi } from './api.mjs';
import { LIMITS } from './constants.mjs';
import { clockOf, nowIso } from './core.mjs';
import { createWorld, loadWorld, saveWorld, worldStats } from './model.mjs';
import { tickWorld } from './tick.mjs';
import { initJournal } from './journal.mjs';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PUBLIC_DIR = join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** Minimal RFC 6455 server frames (no dependencies). */
function wsFrame(text, opcode = 1) {
  const payload = Buffer.from(String(text), 'utf8');
  let header;
  if (payload.length < 126) {
    header = Buffer.from([0x80 | opcode, payload.length]);
  } else if (payload.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(payload.length, 2);
  } else {
    header = Buffer.alloc(10);
    header[0] = 0x80 | opcode;
    header[1] = 127;
    header.writeBigUInt64BE(BigInt(payload.length), 2);
  }
  return Buffer.concat([header, payload]);
}

function wsParse(buffer) {
  const frames = [];
  let offset = 0;
  while (offset + 2 <= buffer.length) {
    const b1 = buffer[offset];
    const b2 = buffer[offset + 1];
    const opcode = b1 & 0x0f;
    const masked = Boolean(b2 & 0x80);
    let len = b2 & 0x7f;
    let p = offset + 2;
    if (len === 126) {
      if (p + 2 > buffer.length) break;
      len = buffer.readUInt16BE(p);
      p += 2;
    } else if (len === 127) {
      if (p + 8 > buffer.length) break;
      len = Number(buffer.readBigUInt64BE(p));
      p += 8;
    }
    let mask = null;
    if (masked) {
      if (p + 4 > buffer.length) break;
      mask = buffer.subarray(p, p + 4);
      p += 4;
    }
    if (p + len > buffer.length) break;
    const payload = Buffer.from(buffer.subarray(p, p + len));
    if (mask) for (let i = 0; i < payload.length; i += 1) payload[i] ^= mask[i % 4];
    frames.push({ opcode, payload });
    offset = p + len;
  }
  return { frames, rest: buffer.subarray(offset) };
}

/**
 * Boots the world. Returns everything tests and scripts need.
 * @param {{port?:number, host?:string, tickMs?:number, dataFile?:string,
 *          reset?:boolean, adminToken?:string|null, quiet?:boolean,
 *          seed?:number, saveEvery?:number, actionGapMs?:number}} opts
 */
export async function startWorld(opts = {}) {
  const {
    port = Number(process.env.PORT || 8787),
    host = process.env.HOST || '127.0.0.1',
    tickMs = Math.max(80, Number(opts.tickMs || process.env.WORLD_TICK_MS || 2000)),
    dataFile = opts.dataFile || process.env.WORLD_DATA || join(ROOT, 'data', 'world.json'),
    reset = opts.reset ?? process.env.WORLD_RESET === '1',
    adminToken = opts.adminToken ?? (process.env.ADMIN_TOKEN || null),
    quiet = false,
    seed = Number(opts.seed || process.env.WORLD_SEED || 20261107),
    saveEvery = 30,
    actionGapMs = opts.actionGapMs ?? Number(process.env.WORLD_ACTION_GAP_MS || LIMITS.minActionGapMs),
  } = opts;

  mkdirSync(join(ROOT, 'data'), { recursive: true });
  const journalFile = opts.journalFile || join(dirname(dataFile), 'journal.jsonl');
  initJournal(journalFile, { reset });
  const world = (!reset && existsSync(dataFile))
    ? loadWorld(dataFile, { tickMs })
    : createWorld({ seed, tickMs });
  world.limits = { ...LIMITS, minActionGapMs: actionGapMs };
  world.meta.tickMs = tickMs;

  const clients = new Set();
  const wsClients = new Set();
  let wsHub = null;
  const broadcast = (event) => {
    const payload = `event: world\ndata: ${JSON.stringify(event)}\n\n`;
    for (const res of clients) {
      try { res.write(payload); } catch { clients.delete(res); }
    }
    if (wsHub) wsHub.broadcast(event);
  };
  world.onEvent = broadcast;

  function handleStream(req, res) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    res.write(`event: hello\ndata: ${JSON.stringify({
      world: world.meta.name, tick: world.tick, clock: clockOf(world.tick),
      headline: world.headline, stats: worldStats(world),
    })}\n\n`);
    clients.add(res);
    req.on('close', () => clients.delete(res));
  }

  const heartbeat = setInterval(() => {
    for (const res of clients) {
      try { res.write(`: ping ${Date.now()}\n\n`); } catch { clients.delete(res); }
    }
    for (const socket of wsClients) {
      try { socket.write(Buffer.from([0x89, 0])); } catch { wsClients.delete(socket); }
    }
  }, 15000);
  heartbeat.unref();

  const api = createApi({ world, rootDir: ROOT, sse: broadcast, adminToken });

  function serveStatic(req, res, pathname) {
    const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, '');
    let file = join(PUBLIC_DIR, safePath === '/' ? 'index.html' : safePath);
    if (!file.startsWith(PUBLIC_DIR)) {
      res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Forbidden');
      return;
    }
    if (!existsSync(file) || statSync(file).isDirectory()) {
      file = join(PUBLIC_DIR, 'index.html');
    }
    const ext = extname(file).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(file).pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    const started = Date.now();
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (process.env.WORLD_LOG === '1') {
      res.on('finish', () => {
        console.log(`[http] ${req.method} ${url.pathname} ${res.statusCode} ${Date.now() - started}ms`);
      });
    }

    if (url.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        ok: true, tick: world.tick, day: clockOf(world.tick).day,
        agents: Object.keys(world.agents).length, uptime: Math.round(process.uptime()), at: nowIso(),
      }));
      return;
    }
    if (url.pathname === '/api/v1/stream') {
      handleStream(req, res);
      return;
    }
    try {
      const handled = await api(req, res, url);
      if (handled) return;
    } catch (err) {
      console.error('[server]', err);
      if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal world error');
      return;
    }
    if (req.method === 'GET' || req.method === 'HEAD') {
      serveStatic(req, res, url.pathname);
      return;
    }
    res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Method not allowed');
  });

  let saving = false;
  server.on('upgrade', (req, socket) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    if (url.pathname !== '/api/v1/ws') { socket.destroy(); return; }
    const key = req.headers['sec-websocket-key'];
    if (!key) { socket.destroy(); return; }
    const accept = createHash('sha1')
      .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
    socket.write('HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\nConnection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n\r\n`);
    socket.setNoDelay(true);
    wsClients.add(socket);
    let pending = Buffer.alloc(0);
    const send = (obj) => { try { socket.write(wsFrame(JSON.stringify(obj))); } catch { /* dropped */ } };
    send({
      type: 'hello', world: world.meta.name, tick: world.tick,
      clock: clockOf(world.tick), headline: world.headline, stats: worldStats(world),
    });
    socket.on('data', (chunk) => {
      pending = Buffer.concat([pending, chunk]);
      const { frames, rest } = wsParse(pending);
      pending = rest;
      for (const frame of frames) {
        if (frame.opcode === 8) {
          wsClients.delete(socket);
          try { socket.end(); } catch { /* already closed */ }
          return;
        }
        if (frame.opcode === 9) {
          try { socket.write(Buffer.from([0x8a, 0])); } catch { /* dropped */ }
          continue;
        }
        if (frame.opcode !== 1) continue;
        try {
          const msg = JSON.parse(frame.payload.toString('utf8'));
          if (msg.type === 'ping') send({ type: 'pong', tick: world.tick, clock: clockOf(world.tick) });
          else if (msg.type === 'state') {
            send({
              type: 'state', tick: world.tick, clock: clockOf(world.tick),
              stats: worldStats(world), headline: world.headline,
            });
          } else send({ type: 'error', message: 'unknown message type' });
        } catch {
          send({ type: 'error', message: 'bad json' });
        }
      }
    });
    socket.on('close', () => wsClients.delete(socket));
    socket.on('error', () => { wsClients.delete(socket); try { socket.destroy(); } catch { /* ignore */ } });
  });

  wsHub = {
    clients: wsClients,
    broadcast(event) {
      const frame = wsFrame(JSON.stringify({ type: 'event', event }));
      for (const socket of wsClients) {
        try { socket.write(frame); } catch { wsClients.delete(socket); }
      }
    },
    close() {
      for (const socket of wsClients) { try { socket.end(wsFrame('bye', 8)); } catch { /* ignore */ } }
      wsClients.clear();
    },
  };

  function save() {
    if (saving) return;
    saving = true;
    try { saveWorld(world, dataFile); } catch (err) { console.error('[save]', err.message); } finally { saving = false; }
  }

  const timer = setInterval(() => {
    try { tickWorld(world); } catch (err) { console.error('[tick]', err); }
    if (saveEvery > 0 && world.tick % saveEvery === 0) save();
  }, tickMs);
  timer.unref();

  await new Promise((res, rej) => {
    server.once('error', rej);
    server.listen(port, host, res);
  });
  const actualPort = server.address().port;
  const displayHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host;

  let closed = false;
  async function close() {
    if (closed) return;
    closed = true;
    clearInterval(timer);
    clearInterval(heartbeat);
    if (wsHub) wsHub.close();
    save();
    for (const res of clients) { try { res.end(); } catch { /* ignore */ } }
    await new Promise((res) => server.close(res));
  }

  if (!quiet) {
    const stats = worldStats(world);
    console.log(`\n  ${world.meta.name} — ${world.meta.town}`);
    console.log(`  Observe:   http://${displayHost}:${actualPort}/`);
    console.log(`  API:       http://${displayHost}:${actualPort}/api/v1/manifest`);
    console.log(`  For agents: http://${displayHost}:${actualPort}/AGENTS.md`);
    console.log(`  Tick: ${tickMs} ms · residents: ${stats.residents} · external agents: ${stats.externalAgents} · pets: ${stats.pets}\n`);
  }

  return { server, world, port: actualPort, url: `http://${displayHost}:${actualPort}`, close, save, dataFile, journalFile };
}

// Auto-start when the file is run directly.
const isMain = process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url;
if (isMain) {
  startWorld().then(({ server, port, close }) => {
    function shutdown(signal) {
      console.log(`\n[world] ${signal}: saving the world…`);
      close().then(() => process.exit(0));
      setTimeout(() => process.exit(0), 3000).unref();
    }
    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    server.on('close', () => console.log('[world] server stopped'));
    void port;
  }).catch((err) => {
    console.error('[boot]', err);
    process.exit(1);
  });
}
