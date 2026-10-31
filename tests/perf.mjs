// Performance run: how fast every page loads and how much work the app does, on a normal
// machine and on a slow device (4× CPU slowdown + a slow 4G-like network).
// Writes tests/reports/perf-latest.md and perf-latest.json.
//
//   npm run test:perf             3 runs per page per profile, medians reported
//   npm run test:perf -- 5        5 runs
import { chromium } from 'playwright';
import http from 'node:http';
import zlib from 'node:zlib';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'reports');
const RUNS = +process.argv[2] || 3;

// Static server like a typical host (gzip, no caching headers), so results resemble GitHub Pages.
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
  try {
    let body = await fs.readFile(file);
    const headers = { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' };
    if (/gzip/.test(req.headers['accept-encoding'] || '') && /text|javascript|json|svg/.test(headers['content-type'])) {
      body = zlib.gzipSync(body);
      headers['content-encoding'] = 'gzip';
    }
    res.writeHead(200, headers).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

const PROFILES = {
  'Normal machine': null,
  'Slow device': { cpu: 4, net: { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 } }
};
const PAGES = [
  ['Landing page', '/'],
  ['Sign in', '/account/login.html'],
  ['Sign up', '/account/signup.html'],
  ['Portal without Pawthfinder', '/portal/?pf=0&reset=1'],
  ['Portal with Pawthfinder', '/portal/?reset=1', '.pf-onboard:not([hidden])']
];

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.floor(s.length / 2)] : 0; };
const ms = v => (v == null ? '–' : `${Math.round(v)} ms`);
const kb = v => `${(v / 1024).toFixed(1)} KB`;

async function setup(browser, profile) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await ctx.addInitScript(() => {
    window.__lcp = 0; window.__cls = 0; window.__long = 0;
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    new PerformanceObserver(l => { for (const e of l.getEntries()) window.__long += e.duration - 50; }).observe({ type: 'longtask', buffered: true });
  });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await cdp.send('Network.enable');
  await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
  if (profile) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: profile.cpu });
    await cdp.send('Network.emulateNetworkConditions', profile.net);
  }
  let bytes = 0, requests = 0;
  const byType = {};
  cdp.on('Network.loadingFinished', e => { bytes += e.encodedDataLength; requests++; });
  cdp.on('Network.responseReceived', e => { byType[e.type] = (byType[e.type] || 0) + 1; });
  return { ctx, page, cdp, counters: () => ({ bytes, requests, byType: { ...byType } }), reset: () => { bytes = 0; requests = 0; for (const k in byType) delete byType[k]; } };
}
const metric = async cdp => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m => [m.name, m.value]));

const results = [];
const browser = await chromium.launch();

for (const [profileName, profile] of Object.entries(PROFILES)) {
  console.log(`\n▶ ${profileName}`);
  for (const [label, url, readySel] of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const s = await setup(browser, profile);
      const before = await metric(s.cdp);
      const t0 = Date.now();
      await s.page.goto(BASE + url, { waitUntil: 'load' });
      if (readySel) await s.page.waitForSelector(readySel);
      const ready = Date.now() - t0;
      await s.page.waitForTimeout(300);
      const after = await metric(s.cdp);
      const nav = await s.page.evaluate(() => {
        const n = performance.getEntriesByType('navigation')[0];
        const fcp = performance.getEntriesByName('first-contentful-paint')[0];
        return { ttfb: n.responseStart, dcl: n.domContentLoadedEventEnd, load: n.loadEventEnd, fcp: fcp ? fcp.startTime : null, lcp: window.__lcp, cls: window.__cls, long: window.__long, domNodes: document.getElementsByTagName('*').length };
      });
      runs.push({
        ...nav, ready, ...s.counters(),
        script: (after.ScriptDuration - before.ScriptDuration) * 1000,
        style: (after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000,
        layout: (after.LayoutDuration - before.LayoutDuration) * 1000,
        heap: after.JSHeapUsedSize
      });
      await s.ctx.close();
    }
    const m = k => median(runs.map(r => r[k]));
    const row = { profile: profileName, label, url, fcp: m('fcp'), lcp: m('lcp'), dcl: m('dcl'), load: m('load'), ready: readySel ? m('ready') : null, cls: m('cls'), long: m('long'), script: m('script'), style: m('style'), layout: m('layout'), bytes: m('bytes'), requests: m('requests'), domNodes: m('domNodes'), heap: m('heap'), byType: runs[0].byType };
    results.push(row);
    console.log(`  ${label}: FCP ${ms(row.fcp)}, load ${ms(row.load)}${readySel ? `, ready ${ms(row.ready)}` : ''}, ${row.requests} requests, ${kb(row.bytes)}`);
  }
}

// How the app behaves once it's running: idle cost and how fast it reacts.
console.log('\n▶ Running the app');
const runtime = [];
for (const [profileName, profile] of Object.entries(PROFILES)) {
  const s = await setup(browser, profile);
  await s.page.goto(BASE + '/portal/?reset=1&onboard=0');
  await s.page.waitForSelector('.pf-panel');
  await s.page.waitForTimeout(500);
  // Idle on the logged-in dashboard for 10 s (timers and observers keep running).
  await s.page.fill('.portal [placeholder="ID"]', 'perf');
  await s.page.fill('.portal [type=password]', 'perf');
  await s.page.click('.portal [data-act=login]');
  await s.page.waitForSelector('.portal .tiles');
  const i0 = await metric(s.cdp);
  await s.page.waitForTimeout(10000);
  const i1 = await metric(s.cdp);
  const idleScript = (i1.ScriptDuration - i0.ScriptDuration) * 1000;
  const idleTask = (i1.TaskDuration - i0.TaskDuration) * 1000;
  // Time from typing a goal to the dog showing the first step.
  const react = await s.page.evaluate(async () => {
    const input = document.getElementById('pf-cmd');
    const say = () => (document.querySelector('.pf-say') || {}).textContent || '';
    const before = say();
    input.value = 'Book a follow-up with my cardiologist';
    const t0 = performance.now();
    input.form.requestSubmit();
    while (say() === before && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 5));
    return performance.now() - t0;
  });
  // Time for a page change in the portal to be picked up (re-plan, repair, translate, hazards).
  const nav = await s.page.evaluate(async () => {
    const say = () => (document.querySelector('.pf-say') || {}).textContent || '';
    const before = say();
    const t0 = performance.now();
    document.querySelector('.portal [data-go=encounters]').click();
    while (say() === before && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 5));
    return performance.now() - t0;
  });
  runtime.push({ profile: profileName, idleScript, idleTask, react, nav });
  console.log(`  ${profileName}: idle CPU ${ms(idleTask)} per 10 s, goal → first step ${ms(react)}, page change → next step ${ms(nav)}`);
  await s.ctx.close();
}

await browser.close();
server.close();

// Files that ship to the browser, biggest first.
const files = [];
for (const dir of ['', 'account', 'pawthfinder', 'portal']) {
  for (const f of await fs.readdir(path.join(ROOT, dir))) {
    if (!/\.(html|css|js)$/.test(f)) continue;
    const buf = await fs.readFile(path.join(ROOT, dir, f));
    files.push({ file: path.join(dir, f), raw: buf.length, gz: zlib.gzipSync(buf).length });
  }
}
files.sort((a, b) => b.raw - a.raw);

const table = (rows, cols) => [`| ${cols.map(c => c[0]).join(' | ')} |`, `| ${cols.map(() => '---').join(' | ')} |`, ...rows.map(r => `| ${cols.map(c => c[1](r)).join(' | ')} |`)].join('\n');
const md = [
  `# Performance run`,
  ``,
  `Run on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC, headless Chromium, cache off, gzip on. Medians of ${RUNS} runs. **Slow device** = 4× CPU slowdown + 1.6 Mbps / 150 ms network (roughly an older phone on weak mobile data).`,
  ``,
  `## Page loads`,
  ``,
  table(results, [
    ['Profile', r => r.profile], ['Page', r => r.label], ['First paint', r => ms(r.fcp)], ['Largest paint', r => ms(r.lcp)],
    ['Load', r => ms(r.load)], ['Ready*', r => ms(r.ready)], ['Requests', r => r.requests], ['Transferred', r => kb(r.bytes)],
    ['Script', r => ms(r.script)], ['Style + layout', r => ms(r.style + r.layout)], ['Long tasks', r => ms(r.long)], ['Layout shift', r => r.cls.toFixed(3)], ['DOM nodes', r => r.domNodes]
  ]),
  ``,
  `\\* Ready = until the session-start picker is on screen.`,
  ``,
  `## Running the app`,
  ``,
  table(runtime, [
    ['Profile', r => r.profile], ['Idle CPU per 10 s', r => ms(r.idleTask)], ['…of which script', r => ms(r.idleScript)],
    ['Goal → first step shown', r => ms(r.react)], ['Page change → next step shown', r => ms(r.nav)]
  ]),
  ``,
  `## What ships to the browser`,
  ``,
  table(files, [['File', r => r.file], ['Size', r => kb(r.raw)], ['Gzipped', r => kb(r.gz)]]),
  ``
].join('\n');
await fs.mkdir(OUT, { recursive: true });
await fs.writeFile(path.join(OUT, 'perf-latest.md'), md);
await fs.writeFile(path.join(OUT, 'perf-latest.json'), JSON.stringify({ runs: RUNS, results, runtime, files }, null, 2));
console.log('\n→ tests/reports/perf-latest.md');
