// Nova Vita — headless browser check for the observer page via CDP.
// Usage: node scripts/browser-check.mjs [url] [out.png] [clickSelector]
// Prints console errors and saves a screenshot. Requires Edge or Chrome installed.
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const url = process.argv[2] || 'http://127.0.0.1:8787/';
const out = resolve(process.argv[3] || 'shots/browser.png');
const clickSelector = process.argv[4] || null;
const scrollSelector = process.argv[5] || null;
const scrollTop = Number(process.argv[6] || 0);
const port = 9333;

const candidates = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
const exe = candidates.find((p) => existsSync(p));
if (!exe) {
  console.error('Edge/Chrome not found');
  process.exit(1);
}

const profile = resolve('data', '.browser-profile');
const child = spawn(exe, [
  '--headless=old', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`,
  '--window-size=1440,1040', 'about:blank',
], { stdio: 'ignore', detached: false });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targets() {
  const res = await fetch(`http://127.0.0.1:${port}/json/list`);
  return res.json();
}

async function main() {
  let page = null;
  for (let i = 0; i < 40; i += 1) {
    try {
      const list = await targets();
      page = list.find((t) => t.type === 'page');
      if (page) break;
    } catch { /* the browser is still starting */ }
    await sleep(250);
  }
  if (!page) throw new Error('Timed out waiting for a browser tab');

  const ws = new WebSocket(page.webSocketDebuggerUrl);
  const pending = new Map();
  const errors = [];
  const logs = [];
  let seq = 0;

  const send = (method, params = {}) => new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });

  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { res, rej } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) rej(new Error(msg.error.message));
      else res(msg.result);
      return;
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      const d = msg.params.exceptionDetails;
      errors.push(`${d.text} ${d.exception?.description || ''}`.trim());
    }
    if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type)) {
      errors.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ')}`);
    }
    if (msg.method === 'Log.entryAdded') {
      const e = msg.params.entry;
      logs.push(`${e.level}: ${e.text} ${e.url || ''}`);
      if (e.level === 'error') errors.push(`${e.source}: ${e.text} ${e.url || ''}`);
    }
  });

  await new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });

  await send('Runtime.enable');
  await send('Log.enable');
  await send('Page.enable');
  await send('Page.navigate', { url });
  await sleep(6000);

  if (clickSelector) {
    await send('Runtime.evaluate', {
      expression: `document.querySelector(${JSON.stringify(clickSelector)})?.click()`,
    });
    await sleep(800);
  }
  if (scrollSelector) {
    await send('Runtime.evaluate', {
      expression: `(() => { const el = document.querySelector(${JSON.stringify(scrollSelector)}); if (el) el.scrollTop = ${scrollTop}; })()`,
    });
    await sleep(300);
  }

  const state = await send('Runtime.evaluate', {
    expression: 'JSON.stringify({pop:document.getElementById("statPop")?.textContent, agents:document.getElementById("statAgents")?.textContent, feed:document.querySelectorAll("#panel-feed .feed-item").length, headline:document.getElementById("headline")?.textContent})',
    returnByValue: true,
  });

  if (process.env.BC_EXPR) {
    const probe = await send('Runtime.evaluate', {
      expression: process.env.BC_EXPR,
      returnByValue: true,
    });
    console.log('PROBE:', JSON.stringify(probe.result?.value ?? probe.result));
  }

  const shot = await send('Page.captureScreenshot', { format: 'png' });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, Buffer.from(shot.data, 'base64'));

  console.log(`\nChecking ${url}`);
  console.log(`DOM: ${state.result.value}`);
  if (logs.length) {
    console.log('\nBrowser log:');
    for (const line of logs.slice(0, 20)) console.log(`  ${line}`);
  }
  if (errors.length) {
    console.log('\nERRORS:');
    for (const e of errors) console.log(`  ✗ ${e}`);
  } else {
    console.log('\nNo console errors.');
  }
  console.log(`\nScreenshot: ${out}\n`);

  ws.close();
  child.kill();
  process.exit(errors.length ? 1 : 0);
}

main().catch((err) => {
  console.error('browser-check:', err.message);
  try { child.kill(); } catch { /* ignore */ }
  process.exit(1);
});
