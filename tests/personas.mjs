// Persona test run: drives the whole app in a real (headless) Chromium the way disabled users would,
// and writes what went wrong to tests/reports/latest.md (+ latest.json, screenshots).
//
//   npm run test:personas            all personas
//   npm run test:personas -- alex    one persona (alex | sam | riley | morgan | scan)
//
// Each persona only uses the input they really have: Alex never clicks, Sam only "speaks"
// (voice-control software pressing things by their visible name, plus Pawthfinder voice
// commands typed into its command box), Riley follows the dog's highlight, Morgan works at
// 200% zoom. This is a proxy for real users and real assistive tech, not a replacement.
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'tests', 'reports');
const SHOTS = path.join(OUT, 'screens');
const only = process.argv[2];

// ---------- tiny static server ----------
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json' };
function serve() {
  const server = http.createServer(async (req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT)) { res.writeHead(403).end(); return; }
    try {
      const body = await fs.readFile(file);
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' }).end(body);
    } catch { res.writeHead(404).end('not found'); }
  });
  return new Promise(r => server.listen(0, '127.0.0.1', () => r(server)));
}

// ---------- findings ----------
const findings = [];
const journeys = [];
const axeResults = [];
let shotNo = 0;
function find(persona, severity, where, what, expected, extra = {}) {
  findings.push({ persona, severity, where, what, expected, ...extra });
  console.log(`  [${severity}] ${persona} @ ${where}: ${what}`);
}
async function shot(page, name) {
  const file = `${String(++shotNo).padStart(2, '0')}-${name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.png`;
  await page.screenshot({ path: path.join(SHOTS, file) }).catch(() => {});
  return `screens/${file}`;
}

// ---------- page helpers ----------
const RECORDER = () => {
  // Keep every screen-reader announcement Pawthfinder or the account pages make.
  window.__said = [];
  new MutationObserver(recs => {
    for (const r of recs) {
      const el = r.target.nodeType === 3 ? r.target.parentElement : r.target;
      const region = el && el.closest && el.closest('[aria-live], [role=status], [role=alert]');
      if (region && region.textContent.trim()) window.__said.push(region.textContent.trim());
    }
  }).observe(document, { subtree: true, childList: true, characterData: true });
};
async function newPersonaPage(browser, opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 }, ...opts, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript(RECORDER);
  const page = await ctx.newPage();
  page.on('pageerror', e => find(opts.persona || '?', 'major', page.url(), `JavaScript error: ${e.message}`, 'No script errors'));
  return { ctx, page };
}
const say = page => page.locator('.pf-say').textContent({ timeout: 1500 }).catch(() => '');
const announced = page => page.evaluate(() => window.__said.slice());
async function focused(page) {
  return page.evaluate(() => {
    const a = document.activeElement;
    if (!a || a === document.body) return null;
    const cs = getComputedStyle(a), r = a.getBoundingClientRect();
    const visibleText = node => { const c = node.cloneNode(true); c.querySelectorAll('[aria-hidden=true]').forEach(x => x.remove()); return c.textContent; };
    const name = (a.getAttribute('aria-label') || (a.labels && a.labels[0] && visibleText(a.labels[0])) || visibleText(a) || a.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ');
    return {
      tag: a.tagName.toLowerCase(), type: a.type || '', role: a.getAttribute('role') || '', name: name.slice(0, 80),
      hint: a.dataset && (a.dataset.pfPh || a.getAttribute('placeholder') || ''),
      visibleFocus: (cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== 'none',
      w: Math.round(r.width), h: Math.round(r.height),
      inPf: !!a.closest('.pf-ui'), inPortal: !!a.closest('.portal'), inDialog: !!a.closest('[role=dialog]')
    };
  });
}
const noFocusRing = new Set();
async function tabTo(page, test, label, max = 70) {
  for (let i = 1; i <= max; i++) {
    await page.keyboard.press('Tab');
    const a = await focused(page);
    if (a && !a.visibleFocus) noFocusRing.add(`${label} → ${a.tag}${a.role ? `[role=${a.role}]` : ''} “${a.name}”`);
    if (a && test(a)) return { a, presses: i };
  }
  return null;
}
const nameIs = re => a => re.test(a.name);

async function axe(page, label, include) {
  try {
    let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']);
    if (include) b = b.include(include);
    const r = await b.analyze();
    const v = r.violations.map(x => ({ id: x.id, impact: x.impact, help: x.help, nodes: x.nodes.length, sample: x.nodes[0] && x.nodes[0].target.join(' ') }));
    axeResults.push({ label, violations: v });
    return v;
  } catch (e) {
    axeResults.push({ label, error: e.message });
    return [];
  }
}
function axeToFindings(persona, where, violations, ours = true) {
  for (const v of violations) {
    const sev = v.impact === 'critical' ? (ours ? 'blocker' : 'major') : v.impact === 'serious' ? 'major' : 'minor';
    find(persona, sev, where, `axe: ${v.help} (${v.id}, ${v.nodes} element${v.nodes > 1 ? 's' : ''}, e.g. ${v.sample})`, 'No WCAG 2.2 AA violations', { kind: 'axe' });
  }
}
// Words and reading grade (Flesch–Kincaid) of a text.
function readability(text) {
  const words = text.match(/[A-Za-z’']+/g) || [];
  const sentences = Math.max(1, (text.match(/[.!?]+(\s|$)/g) || []).length);
  const syll = w => Math.max(1, (w.toLowerCase().replace(/e$/, '').match(/[aeiouy]+/g) || []).length);
  const s = words.reduce((n, w) => n + syll(w), 0);
  return { words: words.length, grade: words.length ? +(0.39 * (words.length / sentences) + 11.8 * (s / words.length) - 15.59).toFixed(1) : 0 };
}
async function journey(name, persona, fn) {
  if (only && only !== persona.toLowerCase().split(' ')[0]) return;
  console.log(`\n▶ ${name}`);
  const j = { name, persona, ok: false, notes: [], started: Date.now() };
  journeys.push(j);
  try { await fn(j); } catch (e) {
    j.notes.push(`Stopped early: ${e.message.split('\n')[0]}`);
    find(persona, 'blocker', name, `Journey could not finish: ${e.message.split('\n')[0]}`, 'The persona can finish the task');
  }
  j.secs = Math.round((Date.now() - j.started) / 1000);
}

// ---------- run ----------
const server = await serve();
const BASE = `http://127.0.0.1:${server.address().port}`;
await fs.rm(SHOTS, { recursive: true, force: true });
await fs.mkdir(SHOTS, { recursive: true });
const browser = await chromium.launch();

// Automated scan of every page, as a baseline for everyone.
await journey('Automated WCAG scan of every page', 'Scan', async j => {
  const { ctx, page } = await newPersonaPage(browser, { persona: 'Scan' });
  for (const [label, url] of [['Landing page', '/'], ['Sign in', '/account/login.html'], ['Sign up: step 1', '/account/signup.html']]) {
    await page.goto(BASE + url);
    axeToFindings('Scan', label, await axe(page, label));
  }
  await page.goto(BASE + '/portal/?reset=1');
  await page.waitForSelector('.pf-onboard:not([hidden])');
  axeToFindings('Scan', 'Session-start picker', await axe(page, 'Session-start picker', '.pf-onboard'));
  await page.getByRole('button', { name: /^skip for now$/i }).click();
  axeToFindings('Scan', 'Pawthfinder panel', await axe(page, 'Pawthfinder panel', '.pf-panel'));
  const left = await axe(page, 'Portal after Pawthfinder repairs', '.portal');
  await page.goto(BASE + '/portal/?pf=0');
  const before = await axe(page, 'Portal without Pawthfinder (baseline)', '.portal');
  const count = v => v.reduce((n, x) => n + x.nodes, 0);
  j.notes.push(`Portal problems found by axe: ${count(before)} without Pawthfinder, ${count(left)} with it.`);
  for (const v of left) {
    if (v.impact === 'critical' || v.impact === 'serious') {
      find('Scan', 'minor', 'Portal (with Pawthfinder on)', `Pawthfinder doesn’t repair: ${v.help} (${v.id}, ${v.nodes}×, e.g. ${v.sample})`, 'Pawthfinder repairs common portal barriers', { kind: 'axe' });
    }
  }
  j.ok = true;
  await ctx.close();
});

// Alex: keyboard only, with a screen reader. Never clicks.
await journey('Alex signs up and books a follow-up using only the keyboard', 'Alex', async j => {
  const { ctx, page } = await newPersonaPage(browser, { persona: 'Alex' });
  const email = `alex${Date.now()}@example.com`;
  await page.goto(BASE + '/account/signup.html');
  const steps = [
    [/your name/i, 'Alex Kim'], [/^email/i, email], [/^password/i, 'correct horse battery']
  ];
  for (const [re, text] of steps) {
    const hit = await tabTo(page, nameIs(re), 'Sign-up');
    if (!hit) throw new Error(`could not reach the “${re.source}” field with Tab`);
    await page.keyboard.type(text);
  }
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  const step2 = await focused(page);
  if (!step2 || !/disabilities/i.test(step2.name)) find('Alex', 'major', 'Sign-up step 2', `After pressing Next, focus went to “${step2 && step2.name}”`, 'Focus moves to the new step’s heading so screen readers read it');
  for (const re of [/^Blind or low vision$/, /^Next/]) {
    const hit = await tabTo(page, a => re.test(a.name.replace(/\s*→$/, '')), 'Sign-up');
    if (!hit) throw new Error(`could not reach “${re.source}” on step 2`);
    await page.keyboard.press(re.source.includes('Next') ? 'Enter' : 'Space');
  }
  for (const re of [/I use a screen reader/, /I use a keyboard/]) {
    const hit = await tabTo(page, nameIs(re), 'Sign-up');
    if (!hit) throw new Error(`could not reach tile ${re.source}`);
    await page.keyboard.press('Space');
  }
  for (let s = 0; s < 3; s++) {
    const hit = await tabTo(page, a => /^(Next|Make my account)/.test(a.name), 'Sign-up');
    if (!hit) throw new Error('could not reach Next / Make my account');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);
    if (/profile\.html/.test(page.url())) break;
  }
  await page.waitForURL(/profile\.html/, { timeout: 4000 });
  j.notes.push('Signed up with the keyboard only.');
  const copy = await tabTo(page, nameIs(/^Copy$/), 'Profile');
  if (!copy) find('Alex', 'major', 'Profile', 'Could not reach a Copy button with Tab', 'Every Copy button is reachable');
  else {
    await page.keyboard.press('Enter');
    await page.waitForTimeout(500);
    const said = await announced(page);
    if (!said.some(s => /copied/i.test(s))) find('Alex', 'major', 'Profile', 'Copying was not announced to the screen reader', 'A “Copied” announcement');
    const clip = await page.evaluate(() => navigator.clipboard.readText()).catch(() => '');
    j.notes.push(`Copied from the paste kit: “${clip.slice(0, 90)}…”`);
  }

  // The patient portal, with Pawthfinder.
  await page.goto(BASE + '/portal/?reset=1');
  await page.waitForSelector('.pf-onboard:not([hidden])');
  const f0 = await focused(page);
  if (!f0 || !f0.inDialog) find('Alex', 'major', 'Session-start picker', 'Focus did not start inside the picker', 'Focus starts on the first choice');
  const picked = await page.locator('.pf-onboard [aria-pressed=true]').allTextContents();
  j.notes.push(`Picker opened with ${picked.length} choices already picked from Alex’s account.`);
  if (!picked.length) find('Alex', 'minor', 'Session-start picker', 'Alex’s saved account choices were not pre-picked', 'Signed-in users see their saved choices');
  // Tab must stay inside the dialog.
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press('Tab');
    const a = await focused(page);
    if (!a || !a.inDialog) { find('Alex', 'major', 'Session-start picker', `Tab left the dialog (to ${a ? a.name : 'the page'})`, 'Focus stays in the dialog until it closes'); break; }
  }
  const start = await tabTo(page, nameIs(/^Start/), 'Picker', 20);
  if (!start) throw new Error('could not reach Start in the picker');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  const afterPick = await focused(page);
  if (!afterPick || afterPick.tag !== 'input' || !afterPick.inPf) find('Alex', 'minor', 'After the picker', `Focus went to ${afterPick ? afterPick.name : 'nowhere'}`, 'Focus goes to the “What do you want to do?” box');
  await page.keyboard.type('Book a follow-up with my cardiologist');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(600);

  const values = { ID: 'alexk', PW: 'secret123', 'CC / RFV': 'Follow-up visit', 'MBR ID': 'XZP448', 'Contact #': '555-0100' };
  let last = '', same = 0, actions = 0;
  for (let i = 0; i < 40; i++) {
    const s = await say(page);
    if (/^Done!/.test(s)) { j.ok = true; break; }
    same = s === last ? same + 1 : 0;
    last = s;
    if (same >= 3) { find('Alex', 'blocker', 'Portal booking', `Stuck on: “${s}”`, 'Each step can be done with the keyboard', { shot: await shot(page, 'alex-stuck') }); break; }
    await page.keyboard.press('Alt+Shift+N');
    await page.waitForTimeout(350);
    const a = await focused(page);
    if (!a || !a.inPortal) {
      find('Alex', 'major', 'Portal booking', `Alt+Shift+N didn’t move focus to the step “${s}” (focus: ${a ? a.name : 'none'})`, 'The shortcut puts focus on the thing to use');
      continue;
    }
    actions++;
    if (a.tag === 'select') {
      const want = (s.match(/choose ([A-Z][a-z]+(?: Care)?)/) || [])[1];
      if (want) await page.keyboard.type(want.slice(0, 4)); else await page.keyboard.press('ArrowDown');
    } else if ((a.tag === 'input' && !['radio', 'checkbox'].includes(a.type)) || a.tag === 'textarea') {
      await page.keyboard.type(values[a.hint] || 'test');
    } else if (a.type === 'radio' || a.type === 'checkbox' || a.role === 'checkbox') {
      await page.keyboard.press('Space');
    } else {
      await page.keyboard.press('Enter');
    }
    await page.waitForTimeout(500);
  }
  const said = await announced(page);
  j.notes.push(`${actions} keyboard actions; ${said.length} screen-reader announcements.`);
  if (!said.some(s => /Step \d+ of \d+/.test(s))) find('Alex', 'major', 'Portal booking', 'Steps were not announced to the screen reader', '“Step N of M …” announced on each step');
  if (!j.ok) find('Alex', 'blocker', 'Portal booking', `Didn’t reach the confirmation. Last step: “${last}”`, 'Booking finishes', { shot: await shot(page, 'alex-end') });
  else await shot(page, 'alex-done');
  for (const n of [...noFocusRing].slice(0, 8)) find('Alex', 'major', 'Focus ring', `No visible focus indicator on ${n}`, 'Every focused control shows a visible outline');
  noFocusRing.clear();
  await ctx.close();
});

// Sam: voice only. Uses voice-control software (presses things by their visible name) and Pawthfinder's voice commands.
await journey('Sam books a follow-up by voice only', 'Sam', async j => {
  const { ctx, page } = await newPersonaPage(browser, { persona: 'Sam' });
  await page.goto(BASE + '/portal/?reset=1&mode=voice');
  await page.waitForSelector('.pf-onboard:not([hidden])');
  // "Click Start with 3 choices": voice-control software matches what's on screen.
  const startLabel = (await page.locator('.pf-ob-start').innerText()).replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim();
  const byName = page.getByRole('button', { name: startLabel });
  if (await byName.count() !== 1) find('Sam', 'major', 'Session-start picker', `The visible label “${startLabel}” doesn’t match the button’s accessible name`, 'Label in name (WCAG 2.5.3) so voice control can press it');
  await page.locator('.pf-ob-start').click();
  const commands = ['Book a follow-up with my cardiologist', 'type sam', 'type secret123', 'press it', 'press it', 'press it', 'choose cardiology', 'choose patel',
    'choose follow', 'type Follow-up visit', 'type XZP448', 'type 555-0100', 'tick it', 'press it', 'choose first', 'tick it', 'press it'];
  const heard = [];
  for (const c of commands) {
    const input = page.locator('#pf-cmd');
    await input.fill(c);
    await input.press('Enter');
    await page.waitForTimeout(550);
    const s = await say(page);
    heard.push(`“${c}” → ${s.slice(0, 70)}`);
    if (/^Done!/.test(s)) { j.ok = true; break; }
  }
  j.notes.push(`${heard.length} spoken commands.`);
  const bubble = await page.locator('.pf-bubble').textContent();
  if (/didn’t understand/.test(bubble)) find('Sam', 'major', 'Voice commands', `A command wasn’t understood: ${bubble}`, 'All standard commands work');
  if (!j.ok) find('Sam', 'blocker', 'Voice booking', `Didn’t finish. Last: ${heard[heard.length - 1]}`, 'Booking finishes by voice', { shot: await shot(page, 'sam-end') });
  else await shot(page, 'sam-done');
  j.notes.push(...heard.slice(-3));
  await ctx.close();
});

// Riley: brain fog. Follows the dog's highlight with a mouse, goes slowly, takes a rest stop.
await journey('Riley follows the dog, gets timed out, takes a rest stop', 'Riley', async j => {
  const { ctx, page } = await newPersonaPage(browser, { persona: 'Riley' });
  await page.goto(BASE + '/portal/?reset=1&mode=cognitive&session=30');
  await page.waitForSelector('.pf-onboard:not([hidden])');
  const tiles = await page.locator('.pf-ob-tiles .pf-tile').count();
  j.notes.push(`Picker shows ${tiles} choices.`);
  if (tiles > 9) find('Riley', 'minor', 'Session-start picker', `${tiles} choices on one screen is a lot on a brain-fog day`, 'A short first screen, with “more choices” for the rest');
  await shot(page, 'riley-picker');
  await page.locator('.pf-ob-start').click();
  await page.getByRole('button', { name: 'Book a follow-up with my cardiologist' }).click();
  await page.waitForTimeout(500);
  const instructions = new Set();
  const typed = { ID: 'riley', PW: 'pw12345', 'CC / RFV': 'Check-up on my heart', 'MBR ID': 'XZP448', 'Contact #': '555-0100' };
  let timedOut = false, restoreOffered = false, warnedTimeout = false, last = '', same = 0;
  for (let i = 0; i < 40; i++) {
    const s = await say(page);
    if (s) instructions.add(s);
    if (/^Done!/.test(s)) { j.ok = true; break; }
    same = s === last ? same + 1 : 0; last = s;
    if (same >= 3) { find('Riley', 'blocker', 'Following the highlight', `Stuck on: “${s}”`, 'Doing what the highlight shows moves on to the next step', { shot: await shot(page, 'riley-stuck') }); break; }
    const notices = (await page.locator('.pf-notice').allTextContents()).join(' ');
    if (/time limit|sign you out|signs you out/i.test(notices)) warnedTimeout = true;
    const restore = page.getByRole('button', { name: 'Put them back' });
    if (await restore.count()) { restoreOffered = true; await restore.click(); await page.waitForTimeout(900); continue; }
    // What's under the highlight ring?
    const target = await page.evaluate(() => {
      const ring = document.querySelector('.pf-ring');
      if (!ring || ring.hidden) return null;
      const r = ring.getBoundingClientRect();
      const el = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!el || !el.closest('.portal')) return { miss: true };
      document.querySelectorAll('[data-riley]').forEach(x => x.removeAttribute('data-riley'));
      el.setAttribute('data-riley', '1');
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, tag: el.tagName.toLowerCase(), type: el.type || '', hint: el.dataset.pfPh || el.getAttribute('placeholder') || '', w: r.width - 12, h: r.height - 12 };
    });
    if (!target || target.miss) {
      find('Riley', 'major', 'Following the highlight', `The highlight isn’t over anything usable for: “${s}”`, 'The ring sits on the thing to use', { shot: await shot(page, 'riley-ring-miss') });
      break;
    }
    if (target.h < 24 || target.w < 24) find('Riley', 'minor', 'Following the highlight', `Highlighted target is only ${Math.round(target.w)}×${Math.round(target.h)}px for “${s.slice(0, 50)}”`, 'Targets at least 24×24px (44px in big-button mode)');
    if (target.tag === 'select') {
      const sel = page.locator('[data-riley]');
      await page.mouse.click(target.x, target.y);
      const labels = await sel.evaluate(x => [...x.options].map(o => o.textContent.trim()));
      const want = labels.find((l, i) => i > 0 && s.toLowerCase().includes(l.toLowerCase().split(',')[0]));
      await sel.selectOption(want ? { label: want } : { index: 1 }, { timeout: 3000 });
    } else if ((target.tag === 'input' && !['radio', 'checkbox'].includes(target.type)) || target.tag === 'textarea') {
      await page.mouse.click(target.x, target.y);
      await page.keyboard.type(typed[target.hint] || 'ok');
    } else {
      await page.mouse.click(target.x, target.y);
    }
    // Riley goes slowly on the request form; the portal's 30-second limit runs out.
    if (/insurance/i.test(s) && !timedOut) {
      timedOut = true;
      await page.waitForTimeout(31000);
      j.notes.push('Waited 31 s on the form (the portal signs out after 30 s).');
    }
    await page.waitForTimeout(600);
  }
  const words = [...instructions].map(t => readability(t));
  const longest = Math.max(...words.map(w => w.words));
  j.notes.push(`${instructions.size} different instructions; longest ${longest} words; average grade ${(words.reduce((n, w) => n + w.grade, 0) / words.length).toFixed(1)}.`);
  if (longest > 25) find('Riley', 'minor', 'Step instructions', `Longest instruction is ${longest} words`, 'In one-step mode, instructions stay under ~20 words');
  if (!warnedTimeout) find('Riley', 'major', 'Hidden time limit', 'Riley was never warned about the 30-second sign-out', 'A warning before the time limit');
  if (timedOut && !restoreOffered) find('Riley', 'major', 'After sign-out', 'After the portal signed Riley out, putting answers back was never offered', 'Saved answers are offered back');
  const text = await page.locator('.portal .main').innerText().catch(() => '');
  const r = readability(text);
  j.notes.push(`Confirmation page at “Simplest”: ${r.words} words, grade ${r.grade}.`);
  if (r.grade > 8) find('Riley', 'minor', 'Confirmation page', `Reading grade ${r.grade} even at the “Simplest” level`, 'Grade 6–8 or lower');
  if (!j.ok) find('Riley', 'blocker', 'Booking', `Didn’t reach the confirmation. Last: “${last}”`, 'Booking finishes', { shot: await shot(page, 'riley-end') });
  // Rest stop survives a reload.
  await page.getByRole('button', { name: /^rest stop$/i }).click();
  await page.reload();
  await page.waitForTimeout(800);
  const back = await page.getByRole('button', { name: 'Pick up where I left off' }).count();
  if (!back) find('Riley', 'major', 'Rest stop', 'After reloading, there was no “Pick up where I left off”', 'Rest stops survive closing and reopening the page');
  await shot(page, 'riley-rest');
  await ctx.close();
});

// Morgan: low vision. 200% zoom (half the CSS viewport), picks bigger text and strong contrast.
await journey('Morgan uses the app at 200% zoom with bigger text and strong contrast', 'Morgan', async j => {
  const { ctx, page } = await newPersonaPage(browser, { persona: 'Morgan', viewport: { width: 683, height: 450 }, deviceScaleFactor: 2 });
  for (const [label, url] of [['Landing page', '/'], ['Sign in', '/account/login.html'], ['Sign up', '/account/signup.html']]) {
    await page.goto(BASE + url);
    const over = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    if (over > 2) find('Morgan', 'major', label, `Page scrolls sideways by ${over}px at 200% zoom`, 'No sideways scrolling at 200% zoom (WCAG 1.4.10 Reflow)', { shot: await shot(page, 'morgan-' + label) });
  }
  await page.goto(BASE + '/portal/?reset=1');
  await page.waitForSelector('.pf-onboard:not([hidden])');
  await page.getByRole('button', { name: /Bigger text and buttons/ }).click();
  await page.getByRole('button', { name: /Strong contrast/ }).click();
  const startVisible = await page.locator('.pf-ob-start').isVisible();
  const startInView = await page.locator('.pf-ob-start').evaluate(b => { const r = b.getBoundingClientRect(); return r.bottom <= innerHeight && r.top >= 0; });
  await shot(page, 'morgan-picker');
  if (!startVisible) find('Morgan', 'blocker', 'Session-start picker', 'Start button not visible at 200% zoom', 'Start is reachable');
  else if (!startInView) j.notes.push('Had to scroll to find Start in the picker.');
  await page.locator('.pf-ob-start').click();
  await page.waitForTimeout(400);
  const space = await page.evaluate(() => {
    const panel = document.querySelector('.pf-panel').getBoundingClientRect();
    const side = panel.top < 10;
    const share = side ? panel.left / innerWidth : panel.top / innerHeight;
    return { side, share: Math.round(share * 100), size: side ? `${Math.round(panel.width)}px of ${innerWidth}px wide` : `${Math.round(panel.height)}px of ${innerHeight}px tall` };
  });
  j.notes.push(`Panel docks ${space.side ? 'at the side' : 'at the bottom'} (${space.size}); ${space.share}% of the view is left for the website.`);
  await shot(page, 'morgan-panel');
  if (space.share < 50) find('Morgan', 'major', 'Pawthfinder panel', `At 200% zoom the panel leaves only ${space.share}% of the view for the website (${space.size})`, 'The panel shrinks or docks so the website stays usable');
  const small = await page.evaluate(() => [...document.querySelectorAll('.pf-ui button, .pf-ui a, .pf-ui input')]
    .filter(b => b.offsetParent !== null).map(b => { const r = b.getBoundingClientRect(); return { t: (b.getAttribute('aria-label') || b.textContent).trim().slice(0, 30), w: r.width, h: r.height }; })
    .filter(x => x.w > 0 && (x.h < 44 || x.w < 44)));
  if (small.length) find('Morgan', 'minor', 'Pawthfinder panel', `${small.length} controls are under 44×44px in big-button mode (e.g. ${small.slice(0, 4).map(s => `“${s.t}” ${Math.round(s.w)}×${Math.round(s.h)}`).join(', ')})`, 'Everything at least 44×44px when “Bigger text and buttons” is on');
  axeToFindings('Morgan', 'Panel in strong contrast', (await axe(page, 'Panel, strong contrast', '.pf-panel')).filter(v => v.id === 'color-contrast'));
  j.ok = true;
  await ctx.close();
});

await browser.close();
server.close();

// ---------- report ----------
const order = { blocker: 0, major: 1, minor: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity]);
const counts = s => findings.filter(f => f.severity === s).length;
const md = [
  `# Persona test run`,
  ``,
  `Run on ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC with headless Chromium. Personas are simulated: keyboard and voice input are scripted, and “screen reader” means the accessibility tree and live-region announcements, not a real screen reader.`,
  ``,
  `**${counts('blocker')} blockers · ${counts('major')} major · ${counts('minor')} minor**`,
  ``,
  `## Journeys`,
  ``,
  `| Journey | Finished? | Time | Notes |`,
  `| --- | --- | --- | --- |`,
  ...journeys.map(j => `| ${j.name} | ${j.ok ? '✅' : '❌'} | ${j.secs}s | ${j.notes.join('<br>').replace(/\|/g, '\\|')} |`),
  ``,
  `## Findings`,
  ``,
  findings.length ? `| # | Severity | Persona | Where | What happened | Expected | Evidence |\n| --- | --- | --- | --- | --- | --- | --- |\n` +
    findings.map((f, i) => `| ${i + 1} | ${f.severity} | ${f.persona} | ${f.where} | ${f.what.replace(/\|/g, '\\|')} | ${f.expected} | ${f.shot ? `[screenshot](${f.shot})` : ''} |`).join('\n') : 'No findings. 🎉',
  ``,
  `## Automated scan detail`,
  ``,
  ...axeResults.map(r => `- **${r.label}:** ${r.error ? 'scan failed: ' + r.error : r.violations.length ? r.violations.map(v => `${v.id} (${v.impact}, ${v.nodes})`).join(', ') : 'no violations'}`),
  ``
].join('\n');
await fs.writeFile(path.join(OUT, 'latest.md'), md);
await fs.writeFile(path.join(OUT, 'latest.json'), JSON.stringify({ journeys, findings, axe: axeResults }, null, 2));
console.log(`\n${counts('blocker')} blockers, ${counts('major')} major, ${counts('minor')} minor → tests/reports/latest.md`);
