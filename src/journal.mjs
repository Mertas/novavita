// Nova Vita — durable, append-only event journal (JSONL) with catch-up.
// The in-memory `world.events` stays the hot cache for the observer; this file is the
// long memory agents can replays with `?since=`.
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname } from 'node:path';

let file = null;
let buffer = [];
let floor = 1;
// Journal epoch: changes whenever the journal is reset. A cursor from another epoch is not a
// position in this history, so a client must rebuild instead of believing it has caught up.
let epoch = null;

function epochFile() { return `${file}.epoch`; }

function initEpoch(reset) {
  if (reset) {
    epoch = randomBytes(8).toString('hex');
    try { writeFileSync(epochFile(), epoch, 'utf8'); } catch { /* non-critical */ }
    return;
  }
  try {
    const saved = readFileSync(epochFile(), 'utf8').trim();
    if (saved) { epoch = saved; return; }
  } catch { /* first run: fall through and mint one */ }
  epoch = randomBytes(8).toString('hex');
  try { writeFileSync(epochFile(), epoch, 'utf8'); } catch { /* non-critical */ }
}

export function initJournal(path, { reset = false } = {}) {
  file = path;
  buffer = [];
  floor = 1;
  mkdirSync(dirname(path), { recursive: true });
  initEpoch(reset);
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

// Oldest-first page of events after `since`. `more` tells a catching-up agent that the
// page was capped, so it can ask again instead of silently losing the middle of its gap.
export function journalPage({ since = 0, kinds = null, limit = 200, epoch: clientEpoch = null } = {}) {
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const lim = Math.max(1, Math.min(1000, limit));
  const head = buffer.length ? buffer[buffer.length - 1].seq : 0;
  const fromStart = Math.max(0, floor - 1);
  const base = { epoch, floor, lastSeq: head };

  // A cursor minted for another journal (or one ahead of the head) cannot be trusted as a
  // position: report it as a reset and hand back the retained window from its start.
  const stale = (clientEpoch && clientEpoch !== epoch) || since > head;
  if (stale) {
    const events = buffer
      .filter((e) => e.seq > fromStart)
      .filter((e) => !kindSet || kindSet.has(e.type))
      .slice(0, lim);
    return {
      ...base,
      events,
      more: events.length < buffer.filter((e) => e.seq > fromStart).length,
      nextSince: events.length ? events[events.length - 1].seq : head,
      gap: true,
      reset: true,
      ahead: since > head,
      missing: null,
    };
  }

  const matched = buffer
    .filter((e) => e.seq > since)
    .filter((e) => !kindSet || kindSet.has(e.type));
  const events = matched.slice(0, lim);
  const missingFrom = since + 1;
  const missingTo = floor - 1;
  const hasMissing = missingTo >= missingFrom;
  return {
    ...base,
    events,
    more: matched.length > events.length,
    nextSince: events.length ? events[events.length - 1].seq : Math.max(since, head),
    gap: hasMissing,
    reset: false,
    ahead: false,
    // The interval the server cannot supply. A client must keep the first one it is given in
    // its reconstruction: reaching `more: false` does not mean the missing past was recovered.
    missing: hasMissing ? { from: missingFrom, to: missingTo } : null,
  };
}

export function readJournal(options = {}) {
  return journalPage(options).events;
}

export function journalInfo() {
  return { floor, lastSeq: buffer.length ? buffer[buffer.length - 1].seq : 0 };
}

export function latestJournal(limit = 50) {
  return buffer.slice(-limit);
}
