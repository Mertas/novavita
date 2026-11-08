// Nova Vita — durable, append-only event journal (JSONL) with catch-up.
// The in-memory `world.events` stays the hot cache for the observer; this file is the
// long memory agents can replays with `?since=`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

let file = null;
let buffer = [];
let floor = 1;

export function initJournal(path, { reset = false } = {}) {
  file = path;
  buffer = [];
  floor = 1;
  mkdirSync(dirname(path), { recursive: true });
  if (reset) {
    writeFileSync(path, '', 'utf8');
    return;
  }
  if (!existsSync(path)) return;
  try {
    const lines = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).slice(-3000);
    buffer = lines.map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
    if (buffer.length) floor = buffer[0].seq || 1;
  } catch { /* a broken journal must not stop the world */ }
}

export function appendJournal(event) {
  if (!file) return;
  try {
    appendFileSync(file, `${JSON.stringify(event)}\n`);
    buffer.push(event);
    if (buffer.length > 3000) {
      buffer.shift();
      floor = buffer[0]?.seq ?? floor;
    }
  } catch { /* the journal is not critical for the tick */ }
}

export function readJournal({ since = 0, kinds = null, limit = 200 } = {}) {
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  return buffer
    .filter((e) => e.seq > since)
    .filter((e) => !kindSet || kindSet.has(e.type))
    .slice(-Math.max(1, Math.min(1000, limit)));
}

export function journalInfo() {
  return { floor, lastSeq: buffer.length ? buffer[buffer.length - 1].seq : 0 };
}

export function latestJournal(limit = 50) {
  return buffer.slice(-limit);
}
