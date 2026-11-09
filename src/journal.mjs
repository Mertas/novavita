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
  const existed = existsSync(path);
  // A journal that is not on disk is a new history, whatever the old epoch file says.
  initEpoch(reset || !existed);
  if (reset) {
    writeFileSync(path, '', 'utf8');
    return;
  }
  if (!existed) return;
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
export function journalPage({ since = 0, kinds = null, limit = 200, epoch: clientEpoch = null, from = null } = {}) {
  const kindSet = kinds && kinds.length ? new Set(kinds) : null;
  const lim = Math.max(1, Math.min(1000, limit));
  const head = buffer.length ? buffer[buffer.length - 1].seq : 0;
  const fromStart = Math.max(0, floor - 1);
  const base = { epoch, floor, lastSeq: head };
  // Without the epoch the server cannot tell a current cursor from one minted before a
  // reset. The page is still served, but it says so instead of implying continuity.
  const epochUnverified = !clientEpoch && since > 0;
  // `from` is the cursor the catch-up STARTED from, carried across pages. Reporting the missing
  // interval relative to it keeps the gap visible after the client pages past the floor.
  const origin = Number.isFinite(from) && from >= 0 ? from : since;

  // A cursor minted for another journal (or one ahead of the head) cannot be trusted as a
  // position: report it as a reset and hand back the retained window from its start.
  const stale = (clientEpoch && clientEpoch !== epoch) || since > head;
  if (stale) {
    const available = buffer.filter((e) => e.seq > fromStart).filter((e) => !kindSet || kindSet.has(e.type));
    const events = available.slice(0, lim);
    return {
      ...base,
      events,
      more: available.length > events.length,
      nextSince: events.length ? events[events.length - 1].seq : head,
      gap: true,
      reset: true,
      ahead: since > head,
      // A foreign history has no interval in this one: the cursor and the lost tail are not
      // numbers here. `missing: null` alone would read as "nothing lost", so say it out loud.
      missing: null,
      missingUnknown: true,
      epochUnverified,
      complete: false,
    };
  }

  const matched = buffer
    .filter((e) => e.seq > since)
    .filter((e) => !kindSet || kindSet.has(e.type));
  const events = matched.slice(0, lim);
  const missingFrom = origin + 1;
  const missingTo = floor - 1;
  const hasMissing = missingTo >= missingFrom;
  const more = matched.length > events.length;
  return {
    ...base,
    events,
    more,
    nextSince: events.length ? events[events.length - 1].seq : Math.max(since, head),
    gap: hasMissing,
    reset: false,
    ahead: false,
    // The interval the server cannot supply, computed from the start of this catch-up.
    // Reaching `more: false` does not mean the missing past was recovered.
    missing: hasMissing ? { from: missingFrom, to: missingTo } : null,
    missingUnknown: false,
    epochUnverified,
    // True only on the page that reaches the head with nothing unavailable since `from`.
    complete: !hasMissing && !more,
  };
}

export function readJournal(options = {}) {
  return journalPage(options).events;
}

export function journalInfo() {
  return { epoch, floor, lastSeq: buffer.length ? buffer[buffer.length - 1].seq : 0 };
}

export function latestJournal(limit = 50) {
  return buffer.slice(-limit);
}
