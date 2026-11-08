// Unit tests for the journal's catch-up contract (no server needed).
// Covers the cases raised in ai-village-external-agents#116: a gap that must stay visible
// after the client pages past the floor, the floor boundary, and an epoch from another journal.
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initJournal, appendJournal, journalPage } from '../src/journal.mjs';

let pass = 0;
let fail = 0;
function check(name, ok, detail = '') {
  if (ok) { pass += 1; return; }
  fail += 1;
  console.log(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

const dir = mkdtempSync(join(tmpdir(), 'nv-journal-'));
const path = join(dir, 'journal.jsonl');

initJournal(path, { reset: true });
const epoch = journalPage().epoch;
check('a fresh journal mints a 16-hex epoch', typeof epoch === 'string' && /^[0-9a-f]{16}$/.test(epoch));

// 3100 events: the served window keeps the last 3000, so floor = 101.
for (let i = 1; i <= 3100; i += 1) {
  appendJournal({ seq: i, tick: i, type: 'move', actorId: 'a1', actorName: 'A' });
}

const first = journalPage({ since: 50, from: 50, limit: 50 });
check('floor reflects the trimmed window', first.floor === 101, `floor=${first.floor}`);
check('a gap before the floor is reported with both ends', first.gap === true && first.missing?.from === 51 && first.missing?.to === 100, JSON.stringify(first.missing));
check('the page itself starts at the floor', first.events[0]?.seq === 101 && first.events.length === 50);
check('more is true while events remain', first.more === true && first.nextSince === 150);

const middle = journalPage({ since: first.nextSince, from: 50, limit: 50 });
check('the missing interval survives paging past the floor', middle.gap === true && middle.missing?.from === 51 && middle.missing?.to === 100, JSON.stringify(middle.missing));
check('the missing interval is not cleared by a later page', middle.complete === false);

const tail = journalPage({ since: 3050, from: 50, limit: 50 });
check('the tail still reports the original gap', tail.more === false && tail.gap === true && tail.missing?.to === 100, JSON.stringify(tail.missing));
check('a catch-up with a gap is never complete', tail.complete === false);

const noGap = journalPage({ since: 100, from: 100, limit: 50 });
check('a cursor at the floor needs no gap (lastSeen=9, floor=10 case)', noGap.gap === false && noGap.missing === null);
check('a cursor below the floor needs a gap', journalPage({ since: 99, from: 99 }).gap === true);

const full = journalPage({ since: 2100, from: 2100, limit: 1000 });
check('an uncut page that reaches the head with no gap is complete', full.more === false && full.complete === true && full.gap === false);

const foreign = journalPage({ since: 500, epoch: 'deadbeefdeadbeef', limit: 10 });
check('a foreign epoch is a reset, not a position', foreign.reset === true && foreign.gap === true && foreign.ahead === false);
check('a reset hands back the retained window from its start', foreign.events[0]?.seq === 101 && foreign.more === true);

const ahead = journalPage({ since: 9999 });
check('a cursor ahead of the head is a reset marked ahead', ahead.reset === true && ahead.ahead === true && ahead.gap === true);

// A journal that disappears from disk is a new history even if the epoch file survives.
rmSync(path);
initJournal(path, { reset: false });
const reborn = journalPage();
check('a missing journal file mints a new epoch', reborn.epoch !== epoch);
check('a reborn journal serves the floor from scratch', reborn.floor === 1 && reborn.lastSeq === 0 && reborn.nextSince === 0);

rmSync(dir, { recursive: true, force: true });
console.log(`journal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
