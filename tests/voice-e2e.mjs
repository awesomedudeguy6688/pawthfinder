// Voice-only booking: a simulated microphone "hears" each phrase (with alternatives and
// confidence, like real speech recognition). No typing, no clicks.  npm run test:voice-e2e
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = http.createServer(async (req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  try { res.writeHead(200, { 'content-type': MIME[path.extname(p)] || 'application/octet-stream' }).end(await fs.readFile(path.join(ROOT, p))); }
  catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const FAKE_SR = () => {
  // A stand-in microphone: window.__hear(['what was heard', ...alternatives], confidence)
  class FakeSR {
    constructor() { window.__rec = this; this.started = false; }
    start() { if (this.started) throw new Error('already'); this.started = true; setTimeout(() => this.onstart && this.onstart(), 0); }
    stop() { this.started = false; this.onend && this.onend(); }
    abort() { this.stop(); }
  }
  window.SpeechRecognition = window.webkitSpeechRecognition = FakeSR;
  window.__hear = (alts, conf = 0.9) => {
    const r = window.__rec; if (!r || !r.started) return 'not listening';
    const interim = [{ transcript: alts[0].slice(0, 6), confidence: 0 }]; interim.isFinal = false;
    r.onresult({ resultIndex: 0, results: [interim] });
    const res = alts.map((t, i) => ({ transcript: t, confidence: i ? conf * 0.7 : conf })); res.isFinal = true;
    r.onresult({ resultIndex: 0, results: [res] });
    return 'ok';
  };
};
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, permissions: ['microphone'] });
await ctx.addInitScript(FAKE_SR);
const p = await ctx.newPage();
p.on('pageerror', e => console.log('PAGE ERROR', e.message));
await p.goto(BASE + '/portal/?reset=1');
await p.waitForSelector('.pf-onboard:not([hidden])');
await p.waitForTimeout(400);
const bubble = () => p.locator('.pf-bubble').textContent();
const step = () => p.locator('.pf-say').textContent({ timeout: 500 }).catch(() => '(no step)');
async function hear(alts, conf, wait = 500) {
  const r = await p.evaluate(([a, c]) => window.__hear(a, c), [Array.isArray(alts) ? alts : [alts], conf ?? 0.9]);
  await p.waitForTimeout(wait);
  console.log(`🗣  ${JSON.stringify(Array.isArray(alts) ? alts[0] : alts)}${r !== 'ok' ? ' [' + r + ']' : ''}\n     bubble: ${(await bubble()).slice(0, 110)}\n     step:   ${(await step()).slice(0, 90)}`);
}
console.log('mic listening at start:', await p.evaluate(() => !!(window.__rec && window.__rec.started)));
await hear('I talk instead of typing');
await hear('read things out loud');
await hear('bigger text');
await hear("okay I'm done");
console.log('picker closed:', await p.locator('.pf-onboard').isHidden(), '| big text on:', await p.evaluate(() => document.documentElement.classList.contains('pf-large')));
await hear('I need to see my heart doctor for a follow up', 0.9, 700);
await hear('spell j r i v e r a');
await hear('type secret password');
await hear('do it', 0.9, 700);
await hear(['open appointment', 'open a point meant'], 0.9, 700);
await hear('press it', 0.9, 700);
await hear('choose cardiology', 0.9, 600);
await hear(['pick doctor patel', 'pick doctor petal'], 0.9, 600);
await hear('choose follow up');
await hear('start dictation');
await hear('my heart races at night');
await hear('and I feel dizzy');
await hear("that's all");
await hear('type my insurance number');
await hear('type my phone number');
await hear('what does ABN mean');
await hear('I agree');
await hear(['click continue', 'click can tin you'], 0.35, 600);
await hear('yes', 0.9, 700);
await hear('choose nine forty', 0.9, 600);
await hear(['take it', 'tick it'], 0.9, 600);
await hear('show numbers');
const nums = await p.locator('.pf-num').count();
console.log('number labels shown:', nums);
await hear('hide numbers');
await hear('submit the request', 0.9, 900);
await hear('when is my appointment');
await hear('blah blah fish');
console.log('\nfinal url:', p.url(), '| req:', await p.evaluate(() => JSON.stringify((JSON.parse(sessionStorage.getItem('mhl')).last || {}))));
const ok = /#\/confirmed$/.test(p.url());
await b.close();
server.close();
console.log(ok ? '\n✅ Booked by voice alone.' : '\n❌ Voice-only booking did not finish.');
process.exit(ok ? 0 : 1);
