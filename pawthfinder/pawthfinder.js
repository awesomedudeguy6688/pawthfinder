// Pawthfinder: a guide dog for medical websites.
// Written like a browser-extension content script: it only reads and adjusts the page's DOM,
// and keeps everything it stores (settings, profile, progress) in this browser.
(function () {
  'use strict';

  const K = window.PF_KNOWLEDGE;
  const portal = document.querySelector('.portal') || document.body;
  const q = new URLSearchParams(location.search);

  // ---------- storage (on-device only) ----------
  const store = {
    get(k, d) { try { const v = localStorage.getItem('pf-' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('pf-' + k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
    del(k) { try { localStorage.removeItem('pf-' + k); } catch (e) { /* private mode */ } }
  };
  if (q.get('reset') === '1') {
    ['settings', 'profile', 'plan', 'form', 'rest', 'appt', 'letter'].forEach(store.del);
    try { sessionStorage.removeItem('pf-onboarded'); } catch (e) { /* private mode */ }
    q.delete('reset');
    history.replaceState(null, '', location.pathname + (q.toString() ? '?' + q : '') + location.hash);
  }

  const DEFAULTS = {
    speak: false, listen: false, sounds: false, haptic: false, captions: true,
    level: 0, oneStep: false, large: false, hc: false, dys: false,
    rm: matchMedia('(prefers-reduced-motion: reduce)').matches,
    repair: true, focusFollow: false, keepAlive: false, rate: 1, collapsed: false, needs: []
  };
  const N = window.PF_NEEDS;
  const DEMO_PROFILE = {
    name: 'Jordan Rivera', username: 'jrivera', dob: '1984-03-09', memberId: 'XZP448120977',
    phone: '555-014-2290', email: 'jordan.rivera@example.com',
    doctors: 'Cardiology: Dr. Anita Patel\nPrimary Care: Dr. Grace Adeyemi',
    meds: 'Atorvastatin 20 mg at bedtime\nLisinopril 10 mg once a day',
    acc: ['quiet', 'longer', 'plain'], accNotes: '', conditions: [], conditionsText: '', needs: []
  };

  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  const profile = Object.assign({}, DEMO_PROFILE, store.get('profile', {}));
  // A Pawthfinder account (made on ../account/) lives on this device too.
  function currentAccount() {
    let email = null;
    try { email = JSON.parse(sessionStorage.getItem('pf-session') || localStorage.getItem('pf-session') || 'null'); } catch (e) { /* none */ }
    const all = store.get('accounts', {});
    return email && all[email] ? all[email] : null;
  }
  const account = currentAccount();
  if (account) {
    ['name', 'email', 'phone', 'acc', 'accNotes', 'conditions', 'conditionsText', 'needs']
      .forEach(k => { if (account[k] != null && account[k] !== '') profile[k] = account[k]; });
  }
  let plan = store.get('plan', null);

  const state = {
    page: null, steps: [], cur: null, stepKey: '', leadSig: '', target: null,
    resting: !!store.get('rest', null), notices: [], seenHazards: new Set(),
    restoreDismissed: false, tinyByPage: {}, lastFocusHint: '', lastFocusAt: 0, warned60: false, hazards: []
  };

  // ---------- small helpers ----------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const origText = el => norm((el.dataset && el.dataset.pfO) || el.textContent);
  const visible = el => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const pageText = () => norm(portal.textContent);
  let uid = 0;

  const GLOSS = K.glossary
    .map(([term, plain, ci]) => ({
      term, plain,
      re: new RegExp('(?<![A-Za-z0-9_])' + term.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&') + '(?![A-Za-z0-9_])', ci ? 'gi' : 'g')
    }))
    .sort((a, b) => b.term.length - a.term.length);

  function rewrite(text, lvl) {
    if (!lvl) return text;
    if (lvl >= 2) for (const [key, simple] of K.sentences) if (text.includes(key)) return simple;
    let out = text;
    for (const g of GLOSS) out = out.replace(g.re, g.plain);
    return out;
  }

  // ---------- page understanding ----------
  // Heuristic version of "DOM + accessibility tree + LLM": find things by what they say, not by ids.
  const F = {
    clickables() { return $$('[data-pf-click], a[href], button', portal).filter(visible); },
    click(re) { return F.clickables().find(el => re.test(origText(el)) || re.test(norm(el.textContent))) || null; },
    fields() { return $$('input:not([type=hidden]), select, textarea', portal); },
    field(re) { return F.fields().find(el => re.test(fieldHint(el))) || null; },
    radio(re) { return F.fields().find(el => el.type === 'radio' && re.test(sibText(el))) || null; },
    textEl(re) {
      let best = null;
      for (const el of $$('*', portal)) {
        if (el.closest('.pf-ui') || !re.test(origText(el))) continue;
        if (!best || el.textContent.length < best.textContent.length) best = el;
      }
      return best;
    },
    clickIn(re) { const box = F.textEl(re); return box ? $('[data-pf-click]', box) : null; },
    rowAction(rowRe, actRe) {
      const row = $$('tr', portal).find(tr => rowRe.test(origText(tr)));
      return row ? $$('[data-pf-click]', row).find(el => actRe.test(origText(el))) || null : null;
    }
  };
  function sibText(el) {
    let s = el.nextElementSibling;
    while (s && s.classList.contains('pf-label')) s = s.nextElementSibling;
    return s ? origText(s) : '';
  }
  function fieldHint(el) {
    const parts = [el.dataset.pfPh || el.getAttribute('placeholder') || ''];
    if (el.tagName === 'SELECT' && el.options[0]) parts.push(origText(el.options[0]));
    if (el.type === 'radio' || el.type === 'checkbox') parts.push(sibText(el));
    if (el.type === 'password') parts.push('password');
    return parts.filter(Boolean).join(' | ');
  }
  const optText = el => (el && el.selectedOptions && el.selectedOptions[0] ? origText(el.selectedOptions[0]) : '');

  const PAGE_RULES = [
    [/^welcome back/i, 'home'], [/^encounter management/i, 'encounters'], [/^new encounter request/i, 'request'],
    [/^select available slot/i, 'slots'], [/^encounter request submitted/i, 'confirmed'],
    [/^medication list/i, 'rx'], [/^diagnostic results/i, 'results']
  ];
  function detectPage() {
    if ($('input[type=password]', portal)) return 'login';
    const h = $('h1, h2', portal);
    const t = h ? origText(h) : '';
    for (const [re, page] of PAGE_RULES) if (re.test(t)) return page;
    return 'other';
  }
  const NAV_TO = {
    home: /^dashboard$/i, encounters: /^encounter mgmt$/i, rx: /^rx mgmt$/i, results: /^dx results$/i
  };
  const NAV_NAME = { home: 'Dashboard', encounters: 'Encounter Mgmt', rx: 'Rx Mgmt', results: 'Dx Results' };

  // ---------- task planner ----------
  const DEPT_WORDS = [
    [/cardio|heart/i, 'Cardiology'], [/derm|skin|rash|mole/i, 'Dermatology'],
    [/endo|diabet|thyroid|hormone/i, 'Endocrinology'], [/ortho|bone|knee|hip|joint|back pain/i, 'Orthopaedics'],
    [/primary|family|\bgp\b|check.?up|general|regular doctor/i, 'Primary Care']
  ];
  const TYPE_RE = { FU: /^F\/U - EST PT$/, NP: /^NP CONSULT$/, TH: /^TELEHEALTH/ };
  const TYPE_PLAIN = { FU: 'Follow-up', NP: 'First visit', TH: 'Video visit' };
  const TYPE_SAY = {
    FU: 'Choose “F/U - EST PT”. That means a follow-up for someone who has been there before.',
    NP: 'Choose “NP CONSULT”. That means a first visit with this doctor.',
    TH: 'Choose “TELEHEALTH (SYNC A/V)”. That means a video visit.'
  };

  function parseGoal(text) {
    const t = text.toLowerCase();
    if (/refill|renew|prescription|medicine|medication|\bmeds\b|\brx\b|pills?/.test(t)) {
      return { task: 'refill', goal: text, med: /blood pressure|lisinopril/.test(t) ? 'LISINOPRIL' : 'ATORVASTATIN' };
    }
    if (/result|\blabs?\b|test|blood work/.test(t)) return { task: 'results', goal: text };
    if (/book|schedule|appointment|\bappt|follow.?up|see (a|my|the)|visit|make an|doctor/.test(t)) {
      const d = DEPT_WORDS.find(([re]) => re.test(t));
      const type = /new doctor|first (time|visit)|\bnew\b/.test(t) ? 'NP' : /video|tele|online|virtual/.test(t) ? 'TH' : 'FU';
      return { task: 'book', goal: text, dept: d ? d[1] : (profileDept() || 'Primary Care'), type };
    }
    return null;
  }
  function profileDept() {
    const line = (profile.doctors || '').split('\n')[0] || '';
    return DEPT_WORDS.map(([, v]) => v).find(v => line.startsWith(v)) || null;
  }
  function preferredDoctor(dept) {
    const line = (profile.doctors || '').split('\n').find(l => l.toLowerCase().startsWith((dept || '').toLowerCase()));
    if (!line) return null;
    const name = line.split(':').slice(1).join(':').trim();
    const last = name.split(/\s+/).pop();
    return name ? { name, last } : null;
  }
  function reasonText() {
    if (!plan) return '';
    const typ = TYPE_PLAIN[plan.type] || 'Follow-up';
    return `${typ} visit${plan.dept ? ' with ' + plan.dept.toLowerCase() : ''}.`;
  }

  function loginSteps() {
    return [
      { part: 'Sign in', page: 'login', say: 'Type your username in the first box (it says “ID”).', plain: 'Type your username.',
        target: () => F.field(/^ID\b/), done: el => el && el.value.trim(), kind: 'text' },
      { part: 'Sign in', page: 'login', say: 'Type your password in the second box (“PW”). I never see or save passwords.', plain: 'Type your password. I never save it.',
        target: () => F.field(/password/), done: el => el && el.value, kind: 'text' },
      { part: 'Sign in', page: 'login', say: 'Press “Sign In”.', plain: 'Press Sign In.', target: () => F.click(/^sign in$/i), kind: 'press' }
    ];
  }

  function buildSteps(p) {
    if (!p) return [];
    if (p.task === 'book') {
      const doc = preferredDoctor(p.dept);
      return loginSteps().concat([
        { part: 'Find appointments', page: 'home', say: 'Open “Encounter Mgmt” in the menu at the top. This website calls appointments “encounters”.',
          plain: 'Open Appointments. (The menu calls it “Encounter Mgmt”.)', target: () => F.click(NAV_TO.encounters), kind: 'press' },
        { part: 'Find appointments', page: 'encounters', say: 'Press “Initiate Encounter Request”. That means “ask for a new appointment”.',
          plain: 'Press the button to ask for a new appointment.', target: () => F.click(/^initiate encounter request$/i), kind: 'press' },
        { part: 'Fill in the request', page: 'request', say: `In the first drop-down (“Select Svc Line”), choose ${p.dept}. That is the type of care.`,
          plain: `Choose ${p.dept}.`, target: () => F.field(/svc line/i), done: el => optText(el) === p.dept, kind: 'select', choose: p.dept },
        { part: 'Fill in the request', page: 'request', say: 'In the second drop-down, choose your doctor.' + (doc ? ` Your profile says ${doc.name}.` : ''),
          plain: doc ? `Choose ${doc.name}.` : 'Choose a doctor.', target: () => F.field(/rendering provider/i), done: el => el && el.value, kind: 'select', choose: doc ? doc.last : '' },
        { part: 'Fill in the request', page: 'request', say: TYPE_SAY[p.type], plain: `Choose “${TYPE_PLAIN[p.type]}”.`,
          target: () => F.radio(TYPE_RE[p.type]), done: el => el && el.checked, kind: 'press' },
        { part: 'Fill in the request', page: 'request', say: 'In the “CC / RFV” box, write why you want this visit. CC / RFV is short for “reason for visit”.',
          plain: 'Write why you want the visit.', target: () => F.field(/CC \/ RFV/), done: el => el && el.value.trim(), kind: 'text' },
        { part: 'Fill in the request', page: 'request', say: 'Type your insurance member ID in the “MBR ID” box. It is on your insurance card. (The Fetch tab can fill it for you.)',
          plain: 'Type your insurance ID. It is on your card.', target: () => F.field(/MBR ID/), done: el => el && el.value.trim(), kind: 'text' },
        { part: 'Fill in the request', page: 'request', say: 'Type a phone number in the “Contact #” box.',
          plain: 'Type your phone number.', target: () => F.field(/Contact #/), done: el => el && el.value.trim(), kind: 'text' },
        { part: 'Fill in the request', page: 'request',
          say: 'Read the agreement next to the small checkbox, and tick it if you agree. In plain words it says: “If my insurance does not pay, I may have to pay.” This is your decision, so I won’t tick it for you.',
          plain: 'Tick the box if you agree. It says: if insurance does not pay, you may have to. This is your choice.',
          target: () => F.field(/acknowledge receipt of the ABN/), done: el => el && el.checked, kind: 'consent' },
        { part: 'Fill in the request', page: 'request', say: 'Press “Continue”.', plain: 'Press Continue.', target: () => F.click(/^continue/i), kind: 'press' },
        { part: 'Pick a time', page: 'slots', say: 'Pick a time that works for you. Each small box is a start time, under its date.',
          plain: 'Pick a time.', target: () => F.click(/^\d{2}:\d{2}$/), done: () => !/selected slot: none/i.test(pageText()), kind: 'slot' },
        { part: 'Pick a time', page: 'slots', say: 'Tick the “I am not a robot” box.', plain: 'Tick “I am not a robot”.',
          target: () => F.clickIn(/i am not a robot$/i), done: el => el && /✓/.test(el.textContent), kind: 'press' },
        { part: 'Pick a time', page: 'slots', say: 'Press “Submit Request”.', plain: 'Press Submit.', target: () => F.click(/^submit request$/i), kind: 'press' },
        { part: 'Done', page: 'confirmed', final: true,
          say: 'Done! Your appointment request was sent. The clinic still has to approve it. Want me to read the confirmation in plain words?',
          plain: 'Done! Your request was sent.', target: () => F.textEl(/^encounter request submitted$/i) }
      ]);
    }
    if (p.task === 'refill') {
      const medName = p.med === 'LISINOPRIL' ? 'LISINOPRIL (blood pressure)' : 'ATORVASTATIN (cholesterol)';
      const rowRe = new RegExp(p.med);
      return loginSteps().concat([
        { part: 'Find your medicines', page: 'home', say: 'Open “Rx Mgmt” in the top menu. That means your medicines.', plain: 'Open Medicines (“Rx Mgmt”).',
          target: () => F.click(NAV_TO.rx), kind: 'press' },
        { part: 'Ask for a refill', page: 'rx', say: `Find ${medName} and press “Req Renewal” next to it. That asks your doctor for a refill.`,
          plain: `Press “Ask for a refill” next to ${p.med.toLowerCase()}.`, target: () => F.rowAction(rowRe, /req renewal/i),
          done: () => { const row = $$('tr', portal).find(tr => rowRe.test(origText(tr))); return row && /transmitted/i.test(origText(row)); }, kind: 'press' },
        { part: 'Done', page: 'rx', final: true, say: 'Done! Your refill request went to your doctor. It can take about 3 workdays.',
          plain: 'Done! Refill asked for.', target: () => F.textEl(/renewal request transmitted/i) }
      ]);
    }
    if (p.task === 'results') {
      return loginSteps().concat([
        { part: 'Find your results', page: 'home', say: 'Open “Dx Results” in the top menu. That means test results.', plain: 'Open Test results (“Dx Results”).',
          target: () => F.click(NAV_TO.results), kind: 'press' },
        { part: 'Open the result', page: 'results', say: 'Press “View” next to LIPID PANEL. That is your cholesterol test.', plain: 'Press View to open your cholesterol test.',
          target: () => F.rowAction(/LIPID PANEL/, /^view$/i), done: () => /TOTAL CHOLESTEROL/.test(pageText()), kind: 'press' },
        { part: 'Understand it', page: 'results', final: true,
          say: 'Here are your results. Three numbers are marked “H”, which means higher than the healthy range. Your doctor suggests keeping your cholesterol medicine and testing again in 3 months. Want this in plain words?',
          plain: 'Three numbers are high. Keep taking your medicine. Test again in 3 months.', target: () => F.textEl(/^Pt w\/ hyperlipidemia/) }
      ]);
    }
    return [];
  }
  const ENTRY = { book: 'encounters', refill: 'rx', results: 'results' };

  function isDone(s) {
    if (!s.done) return false;
    try { return !!s.done(s.target()); } catch (e) { return false; }
  }
  function computeCurrent() {
    const i = state.steps.findIndex(s => s.page === state.page && !isDone(s));
    if (i >= 0) return { i, step: state.steps[i] };
    // Page isn't on the path (or something unexpected happened): re-plan from here.
    const entry = ENTRY[plan.task];
    const firstOnPath = state.steps.findIndex(s => s.page === entry);
    return {
      i: firstOnPath, reroute: true,
      step: {
        part: 'Back on the path', page: state.page, kind: 'press',
        say: `This page isn’t on our path. Let’s go back: press “${NAV_NAME[entry]}” in the top menu.`,
        plain: `Press “${NAV_NAME[entry]}” in the top menu.`, target: () => F.click(NAV_TO[entry])
      }
    };
  }
  const stepText = s => (settings.oneStep || settings.level >= 2) && s.plain ? s.plain : s.say;

  // ---------- UI ----------
  const ui = document.createElement('div');
  ui.className = 'pf-ui';
  ui.innerHTML = `
    <div class="pf-ring" aria-hidden="true" hidden></div>
    <div class="pf-dog" aria-hidden="true">
      <div class="pf-bubble" hidden></div>
      <div class="pf-dog-body">${window.PF_DOG_SVG}</div>
    </div>
    <button class="pf-fab" type="button" aria-label="Show Pawthfinder">🐾 Pawthfinder</button>
    <aside class="pf-panel" aria-label="Pawthfinder guide dog">
      <header class="pf-head">
        <h2 class="pf-title"><span aria-hidden="true">🐾</span> Pawthfinder</h2>
        <button type="button" class="pf-btn pf-rest-btn">Rest stop</button>
        <button type="button" class="pf-icon pf-collapse" aria-label="Hide Pawthfinder panel" title="Hide (Alt+Shift+H)">✕</button>
      </header>
      <div class="pf-tabs" role="tablist" aria-label="Pawthfinder skills">
        ${[['lead', 'Lead'], ['sniff', 'Sniff ahead'], ['translate', 'Translate'], ['fetch', 'Fetch'], ['speak', 'Speak up'], ['settings', 'Stay close']]
          .map(([k, l], n) => `<button type="button" role="tab" id="pf-tab-${k}" aria-controls="pf-pane-${k}" aria-selected="${n === 0}" tabindex="${n === 0 ? 0 : -1}" data-tab="${k}">${l}${k === 'sniff' ? ' <span class="pf-badge" hidden></span>' : ''}</button>`).join('')}
      </div>
      <div class="pf-panes">
        <section class="pf-pane" role="tabpanel" id="pf-pane-lead" aria-labelledby="pf-tab-lead">
          <form class="pf-goal">
            <label for="pf-cmd">What do you want to do? You can also type a command.</label>
            <div class="pf-row">
              <input id="pf-cmd" autocomplete="off" placeholder="Book a follow-up with my cardiologist">
              <button type="submit" class="pf-btn pf-primary">Go</button>
              <button type="button" class="pf-btn pf-mic" aria-pressed="false" aria-label="Talk to Pawthfinder"><span aria-hidden="true">🎤</span></button>
            </div>
            <div class="pf-chips" role="group" aria-label="Examples">
              <button type="button" class="pf-chip">Book a follow-up with my cardiologist</button>
              <button type="button" class="pf-chip">Refill my cholesterol medicine</button>
              <button type="button" class="pf-chip">Understand my test results</button>
            </div>
          </form>
          <div class="pf-heard" aria-live="polite"></div>
          <details class="pf-saycard">
            <summary>What you can say <small>(or type)</small></summary>
            ${Object.entries(window.PF_VOICE.EXAMPLES).map(([g, list]) => `<h4>${g}</h4><p>${list.map(x => `“${x}”`).join(' · ')}</p>`).join('')}
          </details>
          <div class="pf-notices"></div>
          <div class="pf-lead"></div>
        </section>
        <section class="pf-pane" role="tabpanel" id="pf-pane-sniff" aria-labelledby="pf-tab-sniff" hidden>
          <p class="pf-help">I sniff each page for things that could trip you up, and offer a way around them.</p>
          <div class="pf-hazards"></div>
        </section>
        <section class="pf-pane" role="tabpanel" id="pf-pane-translate" aria-labelledby="pf-tab-translate" hidden>
          <h3 class="pf-h3" id="pf-level-h">Reading level</h3>
          <div class="pf-tiles pf-tiles-3" role="group" aria-labelledby="pf-level-h">
            <button type="button" class="pf-tile" data-level="0" aria-pressed="false"><span class="pf-tile-icon" aria-hidden="true">📄</span><span class="pf-tile-label">Original</span><span class="pf-tile-desc">As the website wrote it</span></button>
            <button type="button" class="pf-tile" data-level="1" aria-pressed="false"><span class="pf-tile-icon" aria-hidden="true">💡</span><span class="pf-tile-label">Plain words</span><span class="pf-tile-desc">Jargon swapped out</span></button>
            <button type="button" class="pf-tile" data-level="2" aria-pressed="false"><span class="pf-tile-icon" aria-hidden="true">📖</span><span class="pf-tile-label">Simplest</span><span class="pf-tile-desc">Short, clear sentences</span></button>
          </div>
          <div class="pf-row pf-wrap">
            <button type="button" class="pf-btn" data-do="read">Read page aloud</button>
            <button type="button" class="pf-btn" data-do="summary">Summarize page</button>
            <button type="button" class="pf-btn" data-do="hush">Stop reading</button>
          </div>
          <div class="pf-summary" aria-live="polite"></div>
          <h3 class="pf-h3">Words on this page</h3>
          <dl class="pf-words"></dl>
        </section>
        <section class="pf-pane" role="tabpanel" id="pf-pane-fetch" aria-labelledby="pf-tab-fetch" hidden>
          <p class="pf-help">I can fill boxes from your profile. I always show you what I’ll fill first, I never fill passwords, and I never agree to things for you.</p>
          <button type="button" class="pf-btn pf-primary" data-do="fill">Fill this page from my profile</button>
          <div class="pf-fill"></div>
          <h3 class="pf-h3">My needs, ready to paste</h3>
          <p class="pf-help">Click in any box on the website, then press “Put it in that box” — or copy it and paste it yourself.</p>
          <div class="pf-paste"></div>
          <details class="pf-profile">
            <summary>My profile <small>(stored only on this device)</small></summary>
            <form class="pf-profile-form">
              ${[['name', 'Full name'], ['username', 'Portal username'], ['dob', 'Date of birth', 'date'], ['memberId', 'Insurance member ID'], ['phone', 'Phone', 'tel'], ['email', 'Email', 'email']]
                .map(([k, l, t]) => `<label>${l}<input name="${k}" type="${t || 'text'}"></label>`).join('')}
              <label>My doctors <small>(one per line, “Type of care: Name”)</small><textarea name="doctors" rows="2"></textarea></label>
              <label>My medicines<textarea name="meds" rows="2"></textarea></label>
              <div class="pf-row pf-wrap">
                <button type="submit" class="pf-btn pf-primary">Save profile</button>
                <button type="button" class="pf-btn" data-do="erase">Erase my profile</button>
              </div>
            </form>
          </details>
        </section>
        <section class="pf-pane" role="tabpanel" id="pf-pane-speak" aria-labelledby="pf-tab-speak" hidden>
          <p class="pf-help">I can write a request for the help you need at your visit, or a card to send the clinic before you go.</p>
          <h3 class="pf-h3" id="pf-acc-h">What would help you at the visit?</h3>
          <div class="pf-tiles pf-tiles-sm pf-acc" role="group" aria-labelledby="pf-acc-h">
            ${K.accommodations.map(([k, l]) => `<button type="button" class="pf-tile" data-acc="${k}" aria-pressed="false"><span class="pf-tile-icon" aria-hidden="true">${N.accIcons[k] || '✔️'}</span><span class="pf-tile-label">${l}</span></button>`).join('')}
          </div>
          <label class="pf-block">Anything else they should know?<textarea class="pf-acc-notes" rows="2"></textarea></label>
          <div class="pf-row pf-wrap">
            <button type="button" class="pf-btn pf-primary" data-do="letter">Write my request</button>
            <button type="button" class="pf-btn" data-do="card">Make an accessibility card</button>
          </div>
          <label class="pf-block" for="pf-letter">Your letter <small>(edit anything)</small></label>
          <textarea id="pf-letter" rows="12"></textarea>
          <div class="pf-row pf-wrap">
            <button type="button" class="pf-btn" data-do="copy">Copy</button>
            <button type="button" class="pf-btn" data-do="download">Download</button>
          </div>
        </section>
        <section class="pf-pane" role="tabpanel" id="pf-pane-settings" aria-labelledby="pf-tab-settings" hidden>
          <p class="pf-help pf-needs-desc"></p>
          <p class="pf-account-line"></p>
          <h3 class="pf-h3" id="pf-needs-h">What helps you?</h3>
          <div class="pf-tiles pf-tiles-sm" role="group" aria-labelledby="pf-needs-h">${needTiles()}</div>
          <details class="pf-more">
            <summary>More options</summary>
            <fieldset class="pf-field pf-toggles">
              <legend>Fine-tuning</legend>
              ${toggle('captions', 'Show my speech bubble (captions)')}${toggle('haptic', 'Vibrate on new steps (phones)')}
              ${toggle('repair', 'Fix labels and keyboard access on this site')}${toggle('focusFollow', 'Move keyboard focus to each step')}
              <label class="pf-range">Speaking speed <input type="range" min="0.6" max="1.6" step="0.1" data-set="rate"></label>
            </fieldset>
          </details>
          <h3 class="pf-h3">Keyboard shortcuts</h3>
          <ul class="pf-keys">
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>N</kbd> go to the current step</li>
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>R</kbd> repeat the current step</li>
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>P</kbd> talk to Pawthfinder</li>
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>B</kbd> rest stop</li>
            <li><kbd>Alt</kbd>+<kbd>Shift</kbd>+<kbd>H</kbd> hide or show this panel</li>
          </ul>
          <h3 class="pf-h3">Voice commands</h3>
          <p class="pf-help">Say “help” any time, or open “What you can say” in the Lead tab. Say “show numbers” to put a number on everything you can press.</p>
          <p class="pf-help"><a href="?pf=0${location.hash}">See this site without Pawthfinder</a> · <a href="?reset=1">Reset the demo</a></p>
        </section>
      </div>
    </aside>
    <div class="pf-onboard" role="dialog" aria-modal="true" aria-labelledby="pf-ob-title" aria-describedby="pf-ob-desc" hidden>
      <div class="pf-ob-box">
        <div class="pf-ob-head">
          <div class="pf-ob-dog" aria-hidden="true">${window.PF_DOG_SVG}</div>
          <div>
            <h2 id="pf-ob-title">Hi, I’m Pawthfinder. What helps you use websites?</h2>
            <p id="pf-ob-desc">Pick everything that helps — or nothing at all. You can change this any time.</p>
            <p class="pf-ob-who"></p>
          </div>
          <div class="pf-ob-voice">
            <button type="button" class="pf-btn pf-ob-read"><span aria-hidden="true">🔊</span> Read this to me</button>
            <button type="button" class="pf-btn pf-ob-listen" aria-pressed="false"><span aria-hidden="true">🎤</span> Answer by voice</button>
          </div>
        </div>
        <div class="pf-tiles pf-ob-tiles" role="group" aria-label="What helps you">${needTiles()}</div>
        <div class="pf-ob-foot">
          <a class="pf-ob-account" href="../account/login.html?return=portal">Have a Pawthfinder account? Sign in to load your choices</a>
          <button type="button" class="pf-btn pf-ob-skip">Skip for now</button>
          <button type="button" class="pf-btn pf-primary pf-ob-start">Start <span aria-hidden="true">🐾</span></button>
        </div>
      </div>
    </div>
    <div class="pf-sr" role="status" aria-live="polite"></div>
    <div class="pf-sr" role="alert" aria-live="assertive"></div>`;
  document.body.appendChild(ui);

  function needTiles() {
    return N.features.map(f => `<button type="button" class="pf-tile" data-need="${f.id}" aria-pressed="false">
      <span class="pf-tile-icon" aria-hidden="true">${f.icon}</span><span class="pf-tile-label">${f.label}</span><span class="pf-tile-desc">${f.desc}</span></button>`).join('');
  }
  function toggle(k, label) {
    return `<label class="pf-switch"><input type="checkbox" data-set="${k}"> <span>${label}</span></label>`;
  }

  const el = {
    ring: $('.pf-ring', ui), dog: $('.pf-dog', ui), dogBody: $('.pf-dog-body', ui), bubble: $('.pf-bubble', ui),
    panel: $('.pf-panel', ui), fab: $('.pf-fab', ui), lead: $('.pf-lead', ui), notices: $('.pf-notices', ui),
    cmd: $('#pf-cmd', ui), mic: $('.pf-mic', ui), heard: $('.pf-heard', ui), hazards: $('.pf-hazards', ui),
    badge: $('.pf-badge', ui), words: $('.pf-words', ui), summary: $('.pf-summary', ui), fill: $('.pf-fill', ui),
    letter: $('#pf-letter', ui), livePolite: $$('.pf-sr', ui)[0], liveAssert: $$('.pf-sr', ui)[1]
  };

  // ---------- output: bubble, live regions, speech, sounds ----------
  let bubbleTimer = null;
  function bubble(text, ms) {
    clearTimeout(bubbleTimer);
    el.bubble.textContent = text;
    el.bubble.hidden = !text || !settings.captions;
    if (ms) bubbleTimer = setTimeout(() => bubble(state.cur && plan && !state.resting ? stepText(state.cur.step) : ''), ms);
  }
  function live(text, assertive) {
    const r = assertive ? el.liveAssert : el.livePolite;
    r.textContent = '';
    setTimeout(() => { r.textContent = text; }, 60);
  }
  function speak(text, force, interrupt) {
    if (!(settings.speak || force) || !('speechSynthesis' in window)) return;
    if (interrupt) speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.rate = settings.rate;
    u.lang = 'en-US';
    voice.speakingText = (interrupt ? '' : voice.speakingText + ' ') + text;
    u.onend = u.onerror = () => { voice.ttsEnd = Date.now(); if (!speechSynthesis.pending) voice.speakingText = ''; };
    speechSynthesis.speak(u);
  }
  function say(text, opts = {}) {
    bubble(text, opts.ms);
    live(text, opts.assertive);
    speak(text, opts.forceSpeak);
  }
  let audio = null;
  function tone(freqs, dur = 0.12, type = 'sine', gap = 0.1) {
    if (!settings.sounds) return;
    try {
      audio = audio || new (window.AudioContext || window.webkitAudioContext)();
      freqs.forEach((f, i) => {
        const o = audio.createOscillator(), g = audio.createGain(), t0 = audio.currentTime + i * gap;
        o.type = type; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.18, t0 + 0.015);
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        o.connect(g).connect(audio.destination);
        o.start(t0); o.stop(t0 + dur + 0.03);
      });
    } catch (e) { /* audio unavailable */ }
  }
  const chime = () => tone([660, 880]);
  const bark = () => tone([240, 190], 0.09, 'square', 0.13);
  const yay = () => tone([523, 659, 784], 0.2);
  const buzz = pattern => { if (settings.haptic && navigator.vibrate) navigator.vibrate(pattern); };

  function dogMood(mood, ms) {
    el.dog.classList.remove('pf-alert', 'pf-happy', 'pf-sleep', 'pf-sniff');
    if (mood) el.dog.classList.add('pf-' + mood);
    if (ms) setTimeout(() => el.dog.classList.remove('pf-' + mood), ms);
  }

  // ---------- notices (Lead tab) ----------
  function notice(id, text, kind, actions = []) {
    state.notices = state.notices.filter(n => n.id !== id);
    state.notices.push({ id, text, kind, actions });
    renderNotices();
  }
  function clearNotice(id) {
    const before = state.notices.length;
    state.notices = state.notices.filter(n => n.id !== id);
    if (state.notices.length !== before) renderNotices();
  }
  function renderNotices() {
    el.notices.innerHTML = state.notices.map(n => `
      <div class="pf-notice pf-${n.kind || 'info'}" data-id="${n.id}">
        <button type="button" class="pf-icon pf-x" data-dismiss="${n.id}" aria-label="Dismiss this message">✕</button>
        <p>${esc(n.text)}</p>
        ${n.actions.length ? `<div class="pf-row pf-wrap">${n.actions.map((a, i) => `<button type="button" class="pf-btn ${i ? '' : 'pf-primary'}" data-n="${n.id}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
      </div>`).join('');
  }
  el.notices.addEventListener('click', e => {
    const x = e.target.closest('[data-dismiss]');
    if (x) { clearNotice(x.dataset.dismiss); return; }
    const b = e.target.closest('[data-n]');
    if (!b) return;
    const n = state.notices.find(x => x.id === b.dataset.n);
    if (n && n.actions[b.dataset.a]) n.actions[b.dataset.a].fn();
    clearNotice(b.dataset.n);
  });

  // ---------- Lead: plan + steps ----------
  function startPlan(p) {
    plan = p;
    store.set('plan', plan);
    store.del('rest');
    state.resting = false;
    state.steps = buildSteps(plan);
    state.stepKey = '';
    state.leadSig = '';
    state.restoreDismissed = false;
    switchTab('lead');
    tick();
    const ahead = new Set(state.steps.map(s => s.page));
    const warn = [...ahead].flatMap(pg => K.ahead[pg] || []);
    if (warn.length) {
      setTimeout(() => notice('ahead', `I sniffed ahead on this path: ${warn.length} bumps to watch for (see “Sniff ahead”). I’ll warn you before each one.`, 'info'), 400);
    }
  }
  function endPlan() {
    plan = null;
    store.del('plan');
    state.steps = [];
    state.cur = null;
    state.stepKey = '';
    state.target = null;
    dogMood(null);
    bubble('');
    say('Okay, I stopped guiding. Tell me a new goal whenever you like.');
    renderLead(true);
    positionDog();
  }

  function renderLead(force) {
    if (state.resting) {
      const total = state.steps.length, done = state.cur ? Math.max(0, state.cur.i) : 0;
      const sig = 'rest' + done;
      if (!force && sig === state.leadSig) return;
      state.leadSig = sig;
      el.lead.innerHTML = `
        <div class="pf-card pf-rest">
          <h3>Rest stop <span aria-hidden="true">💤</span></h3>
          ${plan ? `<p>You were working on: <strong>${esc(plan.goal)}</strong></p>
          <p>You’ve done ${done} of ${total} steps. Your place and your answers are saved on this device.</p>
          <p>If the website signs you out while you rest, that’s okay — I’ll help you sign back in and put your answers back.</p>` : '<p>Take all the time you need.</p>'}
          <div class="pf-row pf-wrap">
            <button type="button" class="pf-btn pf-primary" data-do="resume">Pick up where I left off</button>
            ${plan ? '<button type="button" class="pf-btn" data-do="end">Start something new</button>' : ''}
          </div>
        </div>`;
      return;
    }
    if (!plan) {
      if (!force && state.leadSig === 'none') return;
      state.leadSig = 'none';
      el.lead.innerHTML = `<div class="pf-card"><p>Tell me your goal and I’ll lead the way, one step at a time.</p>
        <p>You stay in charge: I point, explain and warn you about bumps. I won’t click anything unless you ask.</p></div>`;
      return;
    }
    const cur = state.cur;
    if (!cur) return;
    const s = cur.step, total = state.steps.length;
    const doneFlags = state.steps.map((x, i) => (i < cur.i ? 1 : 0)).join('');
    const sig = [state.stepKey, doneFlags, settings.oneStep, settings.level, plan.complete].join('|');
    if (!force && sig === state.leadSig) return;
    state.leadSig = sig;
    const n = Math.max(0, cur.i) + (s.final ? 1 : 0);
    const parts = [...new Set(state.steps.map(x => x.part))];
    const partNo = parts.indexOf(s.part) + 1;
    const canPress = ['press', 'slot'].includes(s.kind) && !s.final;
    el.lead.innerHTML = `
      <div class="pf-card pf-now ${s.final ? 'pf-final' : ''}">
        <p class="pf-goaltext">Goal: <strong>${esc(plan.goal)}</strong></p>
        <div class="pf-progress" role="progressbar" aria-label="Progress" aria-valuemin="0" aria-valuemax="${total}" aria-valuenow="${n}" aria-valuetext="Step ${Math.min(n + 1, total)} of ${total}">
          <span style="width:${Math.round((n / total) * 100)}%"></span>
        </div>
        <p class="pf-part">${cur.reroute ? 'A small detour' : `Part ${partNo} of ${parts.length}: ${esc(s.part)}`}</p>
        <p class="pf-say">${esc(stepText(s))}</p>
        <div class="pf-row pf-wrap">
          ${s.final ? '' : '<button type="button" class="pf-btn pf-primary" data-do="show">Show me</button>'}
          <button type="button" class="pf-btn" data-do="repeat">Read it aloud</button>
          ${canPress ? '<button type="button" class="pf-btn" data-do="press">Press it for me</button>' : ''}
          ${s.final && settings.level < 2 ? '<button type="button" class="pf-btn pf-primary" data-do="simplest">Put it in plain words</button>' : ''}
          ${s.final ? '<button type="button" class="pf-btn" data-do="end">New goal</button>' : '<button type="button" class="pf-btn pf-quiet" data-do="end">Stop guiding</button>'}
        </div>
      </div>
      ${settings.oneStep ? '' : `<ol class="pf-steps">${state.steps.map((x, i) => {
        const st = i < cur.i || (s.final && i === cur.i) ? 'done' : i === cur.i && !cur.reroute ? 'now' : 'todo';
        const head = i === 0 || state.steps[i - 1].part !== x.part ? `<li class="pf-parthead" aria-hidden="true">${esc(x.part)}</li>` : '';
        return `${head}<li class="pf-${st}" ${st === 'now' ? 'aria-current="step"' : ''}><span class="pf-sr">${st === 'done' ? 'Done: ' : st === 'now' ? 'Now: ' : ''}</span>${esc(x.plain || x.say)}</li>`;
      }).join('')}</ol>`}`;
  }

  function onStepChange(cur, prevPage) {
    const s = cur.step;
    if (!voice.dictating) voice.field = null;
    const text = stepText(s);
    if (s.final && !plan.complete) {
      plan.complete = true;
      store.set('plan', plan);
      store.del('form');
      dogMood('happy');
      yay();
      buzz([60, 40, 60, 40, 120]);
      setTimeout(() => promptAccount('done'), 1500);
    } else {
      dogMood(cur.reroute ? 'alert' : 'sniff', 900);
      chime();
      buzz(40);
    }
    const prefix = cur.reroute ? '' : s.final ? '' : `Step ${cur.i + 1} of ${state.steps.length}. `;
    bubble(text);
    live(prefix + text);
    speak(text, false, true);
    const t = state.target;
    if (t && visible(t)) {
      t.scrollIntoView({ block: 'center', behavior: settings.rm ? 'auto' : 'smooth' });
      if (settings.focusFollow && !s.final) setTimeout(() => focusTarget(t), settings.rm ? 0 : 350);
    }
    if (prevPage && prevPage !== 'login' && state.page === 'login' && /session has been terminated/i.test(pageText())) {
      notice('signedout', 'The website signed you out (it does that after a few minutes, even while you’re busy). Not your fault. Sign in again — I saved what you typed and will offer to put it back.', 'warn');
    }
  }
  function focusTarget(t) {
    if (!t) return;
    if (!t.matches('input, select, textarea, a[href], button, [tabindex]')) t.setAttribute('tabindex', '-1');
    t.focus({ preventScroll: true });
  }

  function trackPlan(prevPage) {
    if (!plan) { state.target = null; renderLead(); return; }
    if (!state.steps.length) state.steps = buildSteps(plan);
    if (plan.complete && state.page !== state.steps[state.steps.length - 1].page) {
      // Finished earlier; don't drag the user back through it.
      state.target = null;
      el.lead.innerHTML = `<div class="pf-card"><p>All done with: <strong>${esc(plan.goal)}</strong> 🎉</p>
        <div class="pf-row"><button type="button" class="pf-btn pf-primary" data-do="end">New goal</button></div></div>`;
      state.leadSig = 'complete';
      return;
    }
    const cur = computeCurrent();
    state.cur = cur;
    state.target = state.resting ? null : (cur.step.target ? cur.step.target() : null);
    const key = `${cur.i}|${cur.reroute ? 'r' : ''}|${cur.step.say}`;
    if (key !== state.stepKey && !state.resting) {
      state.stepKey = key;
      onStepChange(cur, prevPage);
      renderLead();
    } else {
      renderLead();
    }
  }

  function showMe() {
    const t = state.target;
    if (!t) { say('There’s nothing to point at right now.'); return; }
    t.scrollIntoView({ block: 'center', behavior: settings.rm ? 'auto' : 'smooth' });
    focusTarget(t);
    el.ring.classList.remove('pf-pulse');
    void el.ring.offsetWidth;
    el.ring.classList.add('pf-pulse');
    say(stepText(state.cur.step));
  }
  function announceStep(aloud) {
    if (!plan || !state.cur) { say('Tell me what you want to do, like “book a follow-up with my cardiologist”.', { forceSpeak: aloud }); return; }
    const s = state.cur.step;
    say((s.final ? '' : `Step ${Math.max(0, state.cur.i) + 1} of ${state.steps.length}. `) + stepText(s), { forceSpeak: aloud });
  }
  function pressIt() {
    const s = state.cur && state.cur.step, t = state.target;
    if (!s || !t) { say('There’s nothing to press right now.'); return; }
    if (s.kind === 'consent') { say('That box is your decision, so I won’t tick it unless you tell me to. Say “tick it” if you agree.'); return; }
    if (s.kind === 'text') { focusTarget(t); say('This one needs typing. Say “type” and then the words, or type it yourself.'); return; }
    if (s.kind === 'select') { focusTarget(t); say('Say “choose” and then the option, or pick it yourself.'); return; }
    t.click();
  }
  function typeIt(text) {
    let t = state.target;
    if (!t || !t.matches('input:not([type=radio]):not([type=checkbox]), textarea')) {
      t = document.activeElement && portal.contains(document.activeElement) && document.activeElement.matches('input, textarea') ? document.activeElement : null;
    }
    if (!t) { say('There isn’t a box to type in right now.'); return; }
    setValue(t, text);
    say(`I typed “${t.type === 'password' ? '•'.repeat(text.length) : text}”. Say “next” when you’re ready.`);
  }
  const ORDINAL = { first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1 };
  function chooseIt(what, time) {
    const w = what.toLowerCase().replace(/^(the|a|an)\s+/, '').replace(/\s+(one|option)$/, '');
    const ord = ORDINAL[w];
    const pickFrom = (items, names) => {
      if (ord != null) return items[ord < 0 ? items.length - 1 : ord] || null;
      const hit = V.bestMatch(w, items.map(x => ({ x, names: names(x) })));
      return hit && hit.score >= 0.55 ? hit.item.x : null;
    };
    let sel = state.target && state.target.tagName === 'SELECT' ? state.target : null;
    if (!sel) {
      // Any drop-down on the page that has a matching option.
      sel = F.fields().filter(f => f.tagName === 'SELECT' && !f.disabled).find(f => pickFrom([...f.options].filter(o => o.value), o => [origText(o), norm(o.textContent)]));
    }
    if (sel) {
      const opts = [...sel.options].filter(o => o.value);
      const opt = pickFrom(opts, o => [origText(o), norm(o.textContent)]);
      if (!opt) { say(`I couldn’t find “${what}”. The choices are: ${opts.map(o => norm(o.textContent)).join(', ')}.`, { forceSpeak: settings.listen }); return; }
      sel.value = opt.value;
      sel.dispatchEvent(new Event('change', { bubbles: true }));
      say(`Chose ${norm(opt.textContent)}.`, { ms: 3000 });
      return;
    }
    const times = $$('[data-pf-click]', portal).filter(x => /^\d{2}:\d{2}$/.test(origText(x)));
    if (times.length) {
      const t = time || V.spokenTime(w);
      const slot = /first|earliest|soonest/.test(w) ? times[0] : /last|latest/.test(w) ? times[times.length - 1]
        : t ? times.find(x => origText(x) === t.exact) || (t.alt && times.find(x => origText(x) === t.alt)) : null;
      if (!slot) { say(`I couldn’t find that time. Open times are: ${times.map(origText).join(', ')}.`, { forceSpeak: settings.listen }); return; }
      slot.click();
      say(`Picked ${origText(slot)}.`, { ms: 3000 });
      return;
    }
    const radios = F.fields().filter(x => x.type === 'radio');
    const radio = radios.length && pickFrom(radios, x => [sibText(x), rewrite(sibText(x), 1), rewrite(sibText(x), 2)]);
    if (radio) { radio.click(); say(`Chose “${rewrite(sibText(radio), 1)}”.`, { ms: 3000 }); return; }
    say('There’s nothing to choose right now.', { forceSpeak: settings.listen });
  }
  function tickIt(on = true) {
    let t = state.target;
    const isBox = x => x && (x.type === 'checkbox' || x.type === 'radio' || x.getAttribute('role') === 'checkbox');
    if (!isBox(t)) {
      const boxes = F.fields().filter(x => x.type === 'checkbox').concat($$('[role=checkbox]', portal));
      t = boxes.length === 1 ? boxes[0] : null;
    }
    if (t) {
      const checked = t.type ? t.checked : t.getAttribute('aria-checked') === 'true' || /✓/.test(t.textContent);
      if (checked !== on) t.click();
      say(on ? 'Ticked.' : 'Unticked.', { ms: 2500 });
      return;
    }
    if (state.target && state.cur && state.cur.step.kind === 'press') { state.target.click(); return; }
    say('There’s no box to tick right now.', { forceSpeak: settings.listen });
  }
  function setValue(t, v) {
    const proto = t.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(t, v);
    t.dispatchEvent(new Event('input', { bubbles: true }));
    t.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // ---------- the dog follows the current step ----------
  const DOG_W = () => (settings.large ? 132 : 110), DOG_H = () => (settings.large ? 106 : 88);
  let lastXY = [0, 0];
  function positionDog() {
    // The panel is a side column on wide screens and a bottom sheet when zoomed in or narrow.
    const pr = el.panel.getBoundingClientRect();
    const docked = !settings.collapsed && pr.height > 0;
    const panelLeft = docked && pr.top < 10 ? pr.left : window.innerWidth;
    const floorY = docked && pr.top >= 10 ? pr.top : window.innerHeight;
    const t = state.target && visible(state.target) && !state.resting ? state.target : null;
    let x, y, face = 1;
    if (!t) {
      el.ring.hidden = true;
      x = panelLeft - DOG_W() - 24;
      y = floorY - DOG_H() - 18;
      face = -1;
    } else {
      const r = t.getBoundingClientRect();
      Object.assign(el.ring.style, { left: r.left - 6 + 'px', top: r.top - 6 + 'px', width: r.width + 12 + 'px', height: r.height + 12 + 'px' });
      el.ring.hidden = state.cur && state.cur.step.final;
      x = r.left - DOG_W() - 10;
      if (x < 6) { x = r.right + 10; face = -1; }
      x = Math.min(x, panelLeft - DOG_W() - 6);
      y = Math.max(8, Math.min(floorY - DOG_H() - 8, r.top + r.height / 2 - DOG_H() * 0.62));
    }
    const moved = Math.hypot(x - lastXY[0], y - lastXY[1]) > 40;
    lastXY = [x, y];
    el.dog.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dogBody.style.transform = `scaleX(${face})`;
    el.bubble.classList.toggle('pf-below', y < 140);
    el.bubble.style.left = Math.min(0, panelLeft - x - 250) + 'px';
    if (moved && !settings.rm) {
      el.dog.classList.add('pf-walk');
      clearTimeout(positionDog.t);
      positionDog.t = setTimeout(() => el.dog.classList.remove('pf-walk'), 700);
    }
  }
  let rafPending = false;
  const queuePosition = () => { if (!rafPending) { rafPending = true; requestAnimationFrame(() => { rafPending = false; positionDog(); }); } };
  window.addEventListener('scroll', queuePosition, true);
  window.addEventListener('resize', queuePosition);

  // ---------- repair: labels, keyboard access ----------
  function markClickables() {
    for (const node of $$('span, div, a, td, li, img', portal)) {
      if (node.dataset.pfClick || node.dataset.pfLbl || node.closest('.pf-ui')) continue;
      if (getComputedStyle(node).cursor !== 'pointer') continue;
      const p = node.parentElement;
      if (p && getComputedStyle(p).cursor === 'pointer') continue;
      node.dataset.pfClick = '1';
    }
  }
  const stats = { labels: 0, buttons: 0, tiny: 0 };
  function repair() {
    stats.labels = 0; stats.buttons = 0; stats.tiny = 0;
    // Measure every field before adding any labels: reading a size right after inserting a label
    // forces a fresh layout, once per field.
    const fields = F.fields();
    const heights = fields.map(f => f.getBoundingClientRect().height);
    fields.forEach((f, i) => {
      const native = [...(f.labels || [])].some(l => !l.classList.contains('pf-label')) || (f.getAttribute('aria-label') && !f.dataset.pfLabeled) || f.getAttribute('aria-labelledby');
      if (!native) stats.labels++;
      if (heights[i] < 24) stats.tiny++;
      if (native || !settings.repair || f.dataset.pfLabeled) return;
      const hint = f.dataset.pfPh || f.getAttribute('placeholder') || (f.tagName === 'SELECT' && f.options[0] ? origText(f.options[0]) : '');
      let name = K.fieldLabels[hint];
      if (f.type === 'radio' || f.type === 'checkbox') {
        name = rewrite(sibText(f), 1);
        const s = f.nextElementSibling;
        if (s) s.dataset.pfLbl = '1';
      }
      name = name || rewrite(hint, 1) || 'Field';
      f.setAttribute('aria-label', name);
      f.dataset.pfLabeled = '1';
      if (f.type !== 'radio' && f.type !== 'checkbox') {
        if (!f.id) f.id = 'pf-f' + (++uid);
        const l = document.createElement('label');
        l.className = 'pf-label';
        l.htmlFor = f.id;
        l.textContent = name;
        f.before(l);
      }
    });
    for (const c of $$('[data-pf-click]', portal)) {
      stats.buttons++;
      if (c.getBoundingClientRect().height < 24) stats.tiny++;
      if (!settings.repair || c.dataset.pfKbd) continue;
      c.dataset.pfKbd = '1';
      c.setAttribute('role', c.closest('.nav') || c.tagName === 'A' ? 'link' : 'button');
      c.setAttribute('tabindex', '0');
      if (!norm(c.textContent)) {
        c.setAttribute('aria-label', norm(c.parentElement.textContent) || 'Button');
        if (/robot/i.test(c.parentElement.textContent)) {
          c.setAttribute('role', 'checkbox');
          c.setAttribute('aria-checked', /✓/.test(c.textContent));
        }
      }
    }
  }
  function unrepair() {
    $$('.pf-label', portal).forEach(l => l.remove());
    $$('[data-pf-labeled]', portal).forEach(f => { f.removeAttribute('aria-label'); delete f.dataset.pfLabeled; });
    $$('[data-pf-kbd]', portal).forEach(c => { ['role', 'tabindex', 'aria-label', 'aria-checked'].forEach(a => c.removeAttribute(a)); delete c.dataset.pfKbd; });
    $$('[data-pf-lbl]', portal).forEach(s => delete s.dataset.pfLbl);
  }
  portal.addEventListener('keydown', e => {
    if (!settings.repair) return;
    const c = e.target.closest && e.target.closest('[data-pf-kbd]');
    if (c && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); c.click(); }
  });
  portal.addEventListener('click', e => {
    const s = e.target.closest && e.target.closest('[data-pf-lbl]');
    if (s && settings.repair && s.previousElementSibling && s.previousElementSibling.matches('input')) s.previousElementSibling.click();
  });

  // ---------- translate ----------
  const txNodes = new Set();
  function applyTranslate() {
    const lvl = +settings.level;
    for (const n of txNodes) {
      if (!n.isConnected) { txNodes.delete(n); continue; }
      if (n.__pfLvl !== lvl) { n.nodeValue = n.__pfOrig; n.__pfLvl = 0; }
    }
    for (const f of $$('[placeholder]', portal)) {
      if (!f.dataset.pfPh) f.dataset.pfPh = f.getAttribute('placeholder');
      f.setAttribute('placeholder', rewrite(f.dataset.pfPh, lvl));
    }
    if (!lvl) {
      $$('.pf-tx', portal).forEach(p => { p.classList.remove('pf-tx'); p.removeAttribute('title'); });
      $$('[data-pf-o]', portal).forEach(p => delete p.dataset.pfO);
      return;
    }
    const walker = document.createTreeWalker(portal, NodeFilter.SHOW_TEXT, {
      acceptNode: n => (!n.nodeValue.trim() || n.parentElement.closest('script, style, .pf-ui, .pf-label, .sess')) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    for (const n of nodes) {
      if (n.__pfLvl === lvl) continue;
      const orig = n.__pfOrig != null ? n.__pfOrig : n.nodeValue;
      const out = rewrite(orig, lvl);
      if (out === orig) continue;
      const p = n.parentElement;
      if (!p.dataset.pfO) p.dataset.pfO = norm(p.textContent);
      n.__pfOrig = orig;
      n.__pfLvl = lvl;
      n.nodeValue = out;
      txNodes.add(n);
      if (p.tagName !== 'OPTION') { p.classList.add('pf-tx'); p.title = 'Original: ' + norm(orig); }
    }
  }
  function setLevel(n, announce) {
    settings.level = n;
    saveSettings();
    tick();
    if (announce) say(['Showing the original words.', 'Plain words on. Jargon is swapped for everyday words. Hover any underlined text to see the original.', 'Simplest words on. Long sentences are now short and clear.'][n], { ms: 5000 });
  }
  function renderWords() {
    const text = $$('.main, .login', portal).map(m => {
      const c = m.cloneNode(true);
      c.querySelectorAll('[data-pf-o]').forEach(x => { x.textContent = x.dataset.pfO; });
      return c.textContent;
    }).join(' ');
    const found = GLOSS.filter(g => { g.re.lastIndex = 0; return g.re.test(text) && g.term.length < 30; });
    el.words.innerHTML = found.length
      ? found.map(g => `<div><dt>${esc(g.term)}</dt><dd>${esc(g.plain)}</dd></div>`).join('')
      : '<p class="pf-help">No tricky words found on this page.</p>';
  }
  function readPage() {
    const m = $('.main', portal) || $('.login', portal) || portal;
    const text = norm(m.innerText);
    if (!('speechSynthesis' in window)) { say('Reading aloud isn’t available in this browser.'); return; }
    say(settings.level ? 'Reading the page in plain words.' : 'Reading the page.', { ms: 3000 });
    setTimeout(() => speak(text, true), 900);
  }
  function summarize() {
    const s = K.summaries[state.page] || K.summaries.other;
    el.summary.innerHTML = `<div class="pf-card"><strong>In short:</strong> ${esc(s)}</div>`;
    say(s, { ms: 9000 });
  }

  // ---------- sniff ahead: hazards ----------
  function sessionLeft() {
    const m = norm(($('.sess', portal) || {}).textContent || '').match(/Session:\s*(\d+):(\d{2})/) || pageText().match(/Session:\s*(\d+):(\d{2})/);
    return m ? +m[1] * 60 + +m[2] : null;
  }
  const fmtS = s => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  function scanHazards() {
    const H = [], text = pageText();
    const sl = sessionLeft();
    if (sl != null) {
      H.push({
        id: 'timeout', icon: '⏱️', loud: true, title: 'Hidden time limit',
        text: `This website signs you out in about ${fmtS(sl)} — even while you’re using it — and erases anything you’ve typed.`,
        fixed: settings.keepAlive ? 'I’m keeping you signed in, and I save what you type on this device just in case.' : '',
        actions: settings.keepAlive ? [] : [{ label: 'Keep me signed in', fn: () => setSetting('keepAlive', true, 'I’ll keep you signed in. I’m also saving what you type, just in case.') }]
      });
    }
    if (stats.labels) {
      H.push({
        id: 'labels', icon: '🏷️', title: 'Boxes with no names',
        text: `${stats.labels} box${stats.labels > 1 ? 'es have' : ' has'} no label. Screen readers just say “edit text”, and the hint disappears once you start typing.`,
        fixed: settings.repair ? 'I added clear labels above each box and named them for screen readers.' : '',
        actions: settings.repair ? [] : [{ label: 'Add labels', fn: () => setSetting('repair', true) }]
      });
    }
    if (stats.buttons) {
      H.push({
        id: 'mouse', icon: '🖱️', title: 'Mouse-only buttons',
        text: `${stats.buttons} buttons and links here only work with a mouse. Keyboard, switch and voice users can’t reach them.`,
        fixed: settings.repair ? 'I made them work with the keyboard (Tab, then Enter or Space) and with voice.' : '',
        actions: settings.repair ? [] : [{ label: 'Make them keyboard-friendly', fn: () => setSetting('repair', true) }]
      });
    }
    state.tinyByPage[state.page] = Math.max(state.tinyByPage[state.page] || 0, stats.tiny);
    const tiny = state.tinyByPage[state.page];
    if (tiny) {
      H.push({
        id: 'tiny', icon: '🔍', title: 'Tiny buttons and text',
        text: `${tiny} things to click are smaller than 24 pixels — hard to see and hard to hit.`,
        fixed: settings.large ? 'I made the text and buttons bigger.' : '',
        actions: settings.large ? [] : [{ label: 'Make them bigger', fn: () => setSetting('large', true) }]
      });
    }
    const phone = text.match(/(1-\d{3}-\d{3}-\d{4})[^.]*\.\s*Online modification is not supported/);
    if (phone) {
      H.push({
        id: 'phone', icon: '📞', loud: true, title: 'Phone call required',
        text: `Changing or cancelling a visit only works by phone (${phone[1]}, weekdays 8–4:30 Central). That’s a barrier if phone calls are hard for you.`,
        actions: [{ label: 'Write a message instead', fn: () => draft('phone') }, { label: 'Copy the number', fn: () => copy(phone[1]) }]
      });
    }
    if (/\.pdf/i.test(text)) {
      H.push({
        id: 'pdf', icon: '📄', loud: true, title: 'Unreadable PDF',
        text: 'The intake packet is a scanned PDF (a picture of paper). Screen readers and zoom can’t read it, and it needs an old plug-in.',
        actions: [{ label: 'Ask for an accessible copy', fn: () => draft('pdf') }]
      });
    }
    if (/not a robot|captcha/i.test(text)) {
      H.push({
        id: 'robot', icon: '🤖', loud: true, title: 'Robot check',
        text: 'There’s an “I am not a robot” box. It’s tiny, has no name, and only works with a mouse.',
        fixed: settings.repair ? 'I made it a proper checkbox you can reach with Tab, Space, or by saying “tick it”.' : '',
        actions: settings.repair ? [] : [{ label: 'Make it accessible', fn: () => setSetting('repair', true) }]
      });
    }
    if (/acknowledge receipt of the ABN/.test(text)) {
      H.push({
        id: 'consent', icon: '💵', loud: true, title: 'Money agreement in fine print',
        text: 'The small checkbox is an agreement: if insurance doesn’t pay, you may have to. I’ll explain it, but I’ll never tick it for you.',
        fixed: settings.level >= 2 ? 'It’s shown in plain words now.' : '',
        actions: settings.level >= 2 ? [] : [{ label: 'Show it in plain words', fn: () => setLevel(2, true) }]
      });
    }
    return H;
  }
  function aheadList() {
    if (!plan || plan.complete) return [];
    const pagesOnPath = [...new Set(state.steps.map(s => s.page))];
    const here = pagesOnPath.indexOf(state.page);
    return pagesOnPath.slice(here + 1).flatMap(pg => (K.ahead[pg] || []).map(t => ({ pg, t })));
  }
  const PAGE_PLAIN = { encounters: 'Appointments page', request: 'Request form', slots: 'Time picker' };
  function renderHazards() {
    state.hazards = scanHazards();
    const open = state.hazards.filter(h => !h.fixed);
    el.badge.hidden = !open.length;
    el.badge.textContent = open.length;
    el.badge.setAttribute('aria-label', `${open.length} warnings`);
    const ahead = aheadList();
    // Rebuild the pane only when its shape changes. The time-limit sentence changes every second, so
    // that only updates the text in place (rebuilding would also throw away keyboard focus each second).
    const shape = JSON.stringify([state.hazards.map(h => [h.id, h.icon, h.title, h.fixed, h.actions.map(a => a.label)]), ahead]);
    const texts = state.hazards.map(h => h.text);
    if (shape === renderHazards.shape) {
      const boxes = $$('.pf-hazard', el.hazards);
      texts.forEach((t, i) => { if (t !== renderHazards.texts[i] && boxes[i]) $('p', boxes[i]).textContent = t; });
      renderHazards.texts = texts;
    } else {
      renderHazards.shape = shape;
      renderHazards.texts = texts;
      el.hazards.innerHTML = (state.hazards.length ? `<h3 class="pf-h3">On this page</h3>` + state.hazards.map(h => `
        <div class="pf-hazard ${h.fixed ? 'pf-fixed' : ''}">
          <h4><span aria-hidden="true">${h.icon}</span> ${esc(h.title)} ${h.fixed ? '<span class="pf-ok">handled</span>' : ''}</h4>
          <p>${esc(h.text)}</p>
          ${h.fixed ? `<p class="pf-fixnote">✓ ${esc(h.fixed)}</p>` : ''}
          ${h.actions.length ? `<div class="pf-row pf-wrap">${h.actions.map((a, i) => `<button type="button" class="pf-btn ${i ? '' : 'pf-primary'}" data-h="${h.id}" data-a="${i}">${esc(a.label)}</button>`).join('')}</div>` : ''}
        </div>`).join('') : '<p class="pf-help">Nothing worrying on this page. 🐾</p>') +
        (ahead.length ? `<h3 class="pf-h3">Sniffed ahead on your path</h3><ul class="pf-ahead">${ahead.map(a => `<li><strong>${esc(PAGE_PLAIN[a.pg] || a.pg)}:</strong> ${esc(a.t)}</li>`).join('')}</ul>` : '');
    }
    // Drop warnings that no longer apply here.
    const active = new Set(state.hazards.filter(h => !h.fixed).map(h => 'hz-' + h.id));
    if (state.notices.some(n => n.id.startsWith('hz-') && !active.has(n.id))) {
      state.notices = state.notices.filter(n => !n.id.startsWith('hz-') || active.has(n.id));
      renderNotices();
    }
    // Bark once per hazard per page, for the ones that can really trip someone up.
    for (const h of state.hazards) {
      const seenKey = h.id === 'timeout' ? h.id : h.id + '@' + state.page;
      if (!h.loud || h.fixed || state.seenHazards.has(seenKey) || state.resting) continue;
      state.seenHazards.add(seenKey);
      warn(h);
      break;
    }
  }
  el.hazards.addEventListener('click', e => {
    const b = e.target.closest('[data-h]');
    if (!b) return;
    const h = state.hazards.find(x => x.id === b.dataset.h);
    if (h && h.actions[b.dataset.a]) h.actions[b.dataset.a].fn();
  });
  function warn(h) {
    dogMood('alert', 2500);
    bark();
    buzz([30, 60, 30]);
    const msg = `Heads up! ${h.title}. ${h.text}`;
    say(msg, { ms: 7000, assertive: true });
    notice('hz-' + h.id, msg, 'warn', h.actions);
  }

  // Keep-alive: watches the session countdown and presses "extend" before it runs out.
  setInterval(() => {
    const sl = sessionLeft();
    if (sl == null) { state.warned60 = false; return; }
    if (settings.keepAlive && sl <= 60) {
      const ext = F.click(/extend/i);
      if (ext) { ext.click(); live('I kept you signed in.'); bubble('I kept you signed in. 🐾', 2500); }
    } else if (!settings.keepAlive && sl <= 60 && !state.warned60) {
      state.warned60 = true;
      warn({ id: 'timeout', title: 'Less than a minute left', text: 'This website will sign you out very soon and erase what you typed.', actions: [{ label: 'Keep me signed in', fn: () => setSetting('keepAlive', true) }] });
    }
    if (sl > 60) state.warned60 = false;
    if (!$('#pf-pane-sniff', ui).hidden) renderHazards();
  }, 1000);

  // ---------- fetch: form filling + saving what the user typed ----------
  function fillItems() {
    const items = [], skipped = [];
    if (state.page === 'login') {
      items.push({ label: 'Username', value: profile.username, find: () => F.field(/^ID\b/) });
      skipped.push('Password — I never store or fill passwords.');
    } else if (state.page === 'request') {
      const dept = (plan && plan.dept) || profileDept();
      const type = (plan && plan.type) || 'FU';
      const doc = preferredDoctor(dept);
      if (dept) items.push({ label: 'Type of care', value: dept, match: dept, find: () => F.field(/svc line/i) });
      if (doc) items.push({ label: 'Doctor', value: doc.name, match: doc.last, find: () => F.field(/rendering provider/i) });
      items.push({ label: 'Kind of visit', value: TYPE_PLAIN[type], find: () => F.radio(TYPE_RE[type]) });
      if (plan) items.push({ label: 'Reason for visit', value: reasonText(), find: () => F.field(/CC \/ RFV/) });
      items.push({ label: 'Insurance member ID', value: profile.memberId, find: () => F.field(/MBR ID/) });
      items.push({ label: 'Phone', value: profile.phone, find: () => F.field(/Contact #/) });
      skipped.push('The payment agreement — that’s your decision.');
    }
    return { items: items.filter(i => i.value && i.find()), skipped };
  }
  function previewFill() {
    switchTab('fetch');
    const { items, skipped } = fillItems();
    if (!items.length) {
      el.fill.innerHTML = '<p class="pf-help">There’s nothing on this page I can fill from your profile.</p>';
      say('There’s nothing on this page I can fill from your profile.', { ms: 4000 });
      return;
    }
    el.fill.innerHTML = `<div class="pf-card">
      <p><strong>Here’s what I’d fill.</strong> Untick anything you want to do yourself.</p>
      <ul class="pf-checklist">${items.map((it, i) => `<li><label><input type="checkbox" checked data-i="${i}"> <span>${esc(it.label)}:</span> <strong>${esc(it.value)}</strong></label></li>`).join('')}</ul>
      ${skipped.map(s => `<p class="pf-help">✋ Skipping: ${esc(s)}</p>`).join('')}
      <div class="pf-row pf-wrap"><button type="button" class="pf-btn pf-primary" data-do="fill-go">Fill the ticked boxes</button><button type="button" class="pf-btn" data-do="fill-cancel">Cancel</button></div>
    </div>`;
    el.fill.__items = items;
    say(`I can fill ${items.length} boxes. Check the list, then press “Fill the ticked boxes”.`, { ms: 5000 });
  }
  async function fillAll(items) {
    const done = [];
    for (const it of items) {
      const f = it.find();
      if (!f) continue;
      if (f.tagName === 'SELECT') {
        const m = (it.match || it.value).toLowerCase();
        const opt = [...f.options].find(o => o.value && origText(o).toLowerCase().includes(m));
        if (!opt) continue;
        f.value = opt.value;
        f.dispatchEvent(new Event('change', { bubbles: true }));
      } else if (f.type === 'radio') {
        if (!f.checked) f.click();
      } else {
        setValue(f, it.value);
      }
      done.push(it);
      await sleep(90);
    }
    tick();
    done.forEach(it => { const f = it.find(); if (f) f.classList.add('pf-filled'); });
    return done;
  }

  function snapshotForm() {
    if (state.page !== 'request') return;
    const entries = F.fields()
      .filter(f => f.type !== 'password' && f.type !== 'checkbox' && (f.type === 'radio' ? f.checked : f.value))
      .map(f => ({ hint: fieldHint(f), value: f.tagName === 'SELECT' ? optText(f) : f.type === 'radio' ? 'checked' : f.value, label: f.getAttribute('aria-label') || fieldHint(f) }));
    if (entries.length) store.set('form', { page: 'request', entries, at: Date.now() });
  }
  function checkRestore() {
    const snap = store.get('form', null);
    const dept = F.field(/svc line/i);
    if (state.page !== 'request' || !snap || !snap.entries.length || !dept || dept.value || state.restoreDismissed) { clearNotice('restore'); return; }
    if (state.notices.some(n => n.id === 'restore')) return;
    say('This form is empty, but I saved what you typed before. Want me to put it back?', { ms: 6000 });
    notice('restore', `I saved ${snap.entries.length} answers you typed earlier on this device. Want me to put them back? You can check each one after.`, 'info', [
      { label: 'Put them back', fn: restoreForm },
      { label: 'No thanks', fn: () => { state.restoreDismissed = true; store.del('form'); } }
    ]);
  }
  async function restoreForm() {
    const snap = store.get('form', null);
    if (!snap) return;
    const items = snap.entries.map(e => ({
      label: e.label, value: e.value, match: e.value,
      find: () => F.fields().find(f => fieldHint(f) === e.hint) || null
    }));
    const done = await fillAll(items);
    clearNotice('signedout');
    say(`I put back ${done.length} answers. Please check them. The payment agreement box is still yours to tick.`, { ms: 6000 });
  }

  // ---------- speak up: accommodation letters + card ----------
  function apptLine() {
    const a = store.get('appt', null);
    return a && a.when ? ` on ${a.when}${a.prov ? ' with ' + a.prov : ''}${a.dept ? ' (' + a.dept + ')' : ''}${a.ref ? ', reference ' + a.ref : ''}` : '';
  }
  function captureAppt() {
    const a = {};
    for (const tr of $$('tr', portal)) {
      const [k, v] = $$('td', tr).map(td => origText(td));
      if (!k) continue;
      if (/DOS|Time/.test(k)) a.when = v;
      else if (/Provider/.test(k)) a.prov = v;
      else if (/Svc/.test(k)) a.dept = v;
      else if (/Ref/.test(k)) a.ref = v;
    }
    if (a.when) store.set('appt', a);
  }
  function selectedAcc() {
    return K.accommodations.filter(([k]) => (profile.acc || []).includes(k)).map(([, l]) => l);
  }
  function letterFor(kind) {
    const P = profile, date = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
    const reach = [P.phone, P.email].filter(Boolean).join(' or ');
    const sign = `\n\nThank you,\n${P.name}${P.dob ? '\nDate of birth: ' + P.dob : ''}${P.memberId ? '\nMember ID: ' + P.memberId : ''}`;
    if (kind === 'pdf') {
      return `${date}\n\nTo: Patient Access Services\nRe: Accessible copy of the intake packet\n\nHello,\n\nThe intake packet on the patient portal (Pt_Intake_Packet_rev7_SCANNED.pdf) is a scanned image, so I can’t read or fill it with the tools I use.\n\nPlease send me an accessible version — for example a fillable, tagged PDF, a Word document, or an online form — or let me give the information by secure message instead.\n\nYou can reach me at ${reach}.${sign}`;
    }
    if (kind === 'phone') {
      return `${date}\n\nTo: Patient Access Services\nRe: Request to manage my appointments in writing\n\nHello,\n\nThe portal says appointments can only be changed or cancelled by phone. Because of my disability, phone calls are difficult for me.\n\nPlease let me manage my appointments by secure portal message or email instead, as a reasonable accommodation.\n\nI would like to: [change / cancel] my appointment${apptLine() || ' on [date]'}.\n\nYou can reach me in writing at ${P.email || reach}.${sign}`;
    }
    const acc = selectedAcc();
    const notes = $('.pf-acc-notes', ui).value.trim();
    if (!acc.length && !notes) return '';
    return `${date}\n\nTo: Patient Access / Scheduling\nRe: Accessibility request for ${P.name}\n\nHello,\n\nI have an appointment${apptLine() || ' coming up'}. So that I can take part fully in my care, I’m asking for the following:\n\n${acc.map(a => '  • ' + a).join('\n')}${notes ? '\n\n' + notes : ''}\n\nI’m making this request under the Americans with Disabilities Act and Section 504 of the Rehabilitation Act. Please confirm in writing that these will be in place, or contact me to talk about other options.\n\nThe best way to reach me is ${reach}.${sign}`;
  }
  function draft(kind) {
    switchTab('speak');
    const text = letterFor(kind);
    if (!text) { say('Tick at least one thing that would help, then press “Write my request”.', { ms: 4000 }); return; }
    el.letter.value = text;
    store.set('letter', text);
    el.letter.focus();
    say('I wrote a draft. Read it over and change anything you like, then copy or download it.', { ms: 5000 });
  }
  function accessibilityCard() {
    const acc = selectedAcc();
    const notes = $('.pf-acc-notes', ui).value.trim();
    const w = window.open('', '_blank');
    if (!w) { say('Your browser blocked the card window. Allow pop-ups for this page and try again.'); return; }
    w.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Accessibility card — ${esc(profile.name)}</title>
      <style>body{font:18px/1.5 system-ui,sans-serif;color:#1d2433;margin:2rem}
      .card{max-width:34rem;border:3px solid #0B5563;border-radius:16px;padding:1.5rem 1.75rem}
      h1{margin:0 0 .25rem;font-size:1.6rem;color:#0B5563}.sub{margin:0 0 1rem;color:#4a5568}
      li{margin:.3rem 0}button{font:inherit;margin-top:1rem;padding:.5rem 1rem}@media print{button{display:none}}</style></head>
      <body><div class="card"><h1>🐾 Accessibility card</h1><p class="sub">${esc(profile.name)}${apptLine() ? ' · Appointment' + esc(apptLine()) : ''}</p>
      <h2>What helps me</h2><ul>${(acc.length ? acc : ['(nothing selected yet)']).map(a => `<li>${esc(a)}</li>`).join('')}</ul>
      ${notes ? `<h2>Good to know</h2><p>${esc(notes)}</p>` : ''}
      <h2>How to reach me</h2><p>${esc([profile.phone, profile.email].filter(Boolean).join(' · '))}</p></div>
      <button onclick="print()">Print or save as PDF</button></body></html>`);
    w.document.close();
  }
  function copy(text) {
    (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject())
      .then(() => say('Copied.', { ms: 2000 }))
      .catch(() => say('I couldn’t copy automatically. Select the text and copy it yourself.', { ms: 4000 }));
  }

  function renderPasteKit() {
    const box = $('.pf-paste', ui);
    if (!box) return;
    const kit = N.pasteKit(Object.assign({}, profile, { needs: profile.needs && profile.needs.length ? profile.needs : settings.needs }));
    box.__kit = kit;
    box.innerHTML = kit.length ? kit.map(k => `
      <div class="pf-card pf-kit">
        <h4>${esc(k.title)}</h4>
        <p class="pf-kit-text">${esc(k.text).replace(/\n/g, '<br>')}</p>
        <div class="pf-row pf-wrap">
          <button type="button" class="pf-btn pf-primary" data-paste="${k.id}">Put it in that box</button>
          <button type="button" class="pf-btn" data-copykit="${k.id}">Copy</button>
        </div>
      </div>`).join('')
      : `<p class="pf-help">Pick what helps you in “Speak up”, or <a href="../account/signup.html?return=portal">make an account</a> with your needs, and they’ll show up here.</p>`;
  }
  function pasteInto(id) {
    const kit = $('.pf-paste', ui).__kit || [];
    const k = kit.find(x => x.id === id) || kit[0];
    if (!k) { say('I don’t know your needs yet. Pick them in “Speak up” first.', { ms: 4000 }); return; }
    const f = state.lastFocusHint && F.fields().find(x => fieldHint(x) === state.lastFocusHint && x.matches('textarea, input:not([type=radio]):not([type=checkbox]):not([type=password])'));
    if (!f) { say('Click in a box on the website first, then press this again.', { ms: 4000 }); return; }
    setValue(f, f.value ? f.value.replace(/\s*$/, ' ') + k.text : k.text);
    f.classList.add('pf-filled');
    f.focus();
    say(`I put your needs in the “${f.getAttribute('aria-label') || 'selected'}” box. Please check it.`, { ms: 5000 });
  }
  ui.addEventListener('click', e => {
    const p = e.target.closest('[data-paste]');
    if (p) pasteInto(p.dataset.paste);
    const c = e.target.closest('[data-copykit]');
    if (c) { const k = ($('.pf-paste', ui).__kit || []).find(x => x.id === c.dataset.copykit); if (k) copy(k.text); }
  });

  // ---------- nudge to make an account (only when signed out, at most twice a session) ----------
  function promptAccount(when) {
    if (account) return;
    const key = 'pf-account-nudge';
    let seen = [];
    try { seen = JSON.parse(sessionStorage.getItem(key) || '[]'); } catch (e) { /* none */ }
    if (seen.includes(when) || seen.includes('never')) return;
    seen.push(when);
    try { sessionStorage.setItem(key, JSON.stringify(seen)); } catch (e) { /* private mode */ }
    const text = when === 'done'
      ? 'Nice work! Want me to remember what helps you next time? A free account keeps your choices and writes your needs out, ready to paste into any form.'
      : 'Want me to remember these choices? Make a free account and they’ll be ready every time. You’ll also get your needs written out, ready to paste into any form. I’ll keep your place here.';
    notice('account', text, 'info', [
      { label: 'Make my free account', fn: () => { location.href = '../account/signup.html?return=portal'; } },
      { label: 'I already have one', fn: () => { location.href = '../account/login.html?return=portal'; } },
      { label: 'Not now', fn: () => { try { sessionStorage.setItem(key, JSON.stringify(['never'])); } catch (e) { /* private mode */ } } }
    ]);
  }

  // ---------- session-start picker ----------
  const ob = $('.pf-onboard', ui);
  let obPicked = new Set();
  function openOnboarding() {
    const start = account && account.needs ? account.needs : settings.needs || [];
    obPicked = new Set(start);
    renderObTiles();
    $('.pf-ob-who', ob).textContent = account ? `Welcome back, ${account.name || account.email}! I picked the choices saved in your account.` : '';
    $('.pf-ob-account', ob).hidden = !!account;
    ob.hidden = false;
    portal.inert = true;
    el.panel.inert = true;
    document.documentElement.classList.add('pf-ob-open');
    setTimeout(() => $('.pf-tile', ob).focus(), 50);
    if (SR && navigator.permissions && navigator.permissions.query) {
      navigator.permissions.query({ name: 'microphone' }).then(p => { if (p.state === 'granted' && !ob.hidden) listenInPicker(false); }).catch(() => {});
    }
  }
  function renderObTiles() {
    $$('[data-need]', ob).forEach(b => b.setAttribute('aria-pressed', String(obPicked.has(b.dataset.need))));
    $('.pf-ob-start', ob).innerHTML = obPicked.size ? `Start with ${obPicked.size} choice${obPicked.size > 1 ? 's' : ''} <span aria-hidden="true">🐾</span>` : 'Start <span aria-hidden="true">🐾</span>';
  }
  function closeOnboarding(apply) {
    try { sessionStorage.setItem('pf-onboarded', '1'); } catch (e) { /* private mode */ }
    // Stop the microphone again unless they asked for voice control.
    if (obListening && !obPicked.has('voice')) stopListening();
    obListening = false;
    ob.hidden = true;
    portal.inert = false;
    el.panel.inert = false;
    document.documentElement.classList.remove('pf-ob-open');
    if (apply) {
      const ids = [...obPicked];
      applyNeeds(ids);
      clearNotice('start-voice');
      const names = N.features.filter(f => ids.includes(f.id)).map(f => f.label.toLowerCase());
      say(names.length ? `Got it: ${names.join(', ')}. Now tell me what you want to do.` : 'Okay! Tell me what you want to do.', { ms: 6000, forceSpeak: ids.includes('voice') || ids.includes('readAloud') });
    }
    renderPasteKit();
    promptAccount('start');
    el.cmd.focus();
  }
  $$('[data-need]', ob).forEach(b => b.addEventListener('click', () => {
    const id = b.dataset.need;
    obPicked.has(id) ? obPicked.delete(id) : obPicked.add(id);
    renderObTiles();
    // Preview the look right away so people can tell what each one does.
    if (['large', 'hc', 'dys', 'rm'].includes(id)) document.documentElement.classList.toggle('pf-' + id, obPicked.has(id));
    const f = N.features.find(x => x.id === id);
    live(`${f.label}: ${obPicked.has(id) ? 'picked' : 'not picked'}`);
  }));
  // Answering the picker by voice. If the microphone was allowed before, listen straight away.
  let obListening = false;
  function listenInPicker(announce) {
    if (!SR) { say('Voice isn’t available in this browser. Chrome, Edge and Safari support it.', { ms: 5000 }); return; }
    if (!listening) { startListening(); obListening = !settings.listen; }
    $('.pf-ob-listen', ob).setAttribute('aria-pressed', 'true');
    if (announce) say('I’m listening. Say what helps you, like “bigger text” or “I talk instead of typing”. Then say “start”.', { ms: 8000, forceSpeak: true });
  }
  $('.pf-ob-listen', ob).addEventListener('click', () => listenInPicker(true));
  $('.pf-ob-start', ob).addEventListener('click', () => closeOnboarding(true));
  $('.pf-ob-skip', ob).addEventListener('click', () => { applyModes(); closeOnboarding(false); });
  $('.pf-ob-read', ob).addEventListener('click', () => {
    speak('What helps you use websites? Pick everything that helps. Press Tab to move between choices and Space to pick one. The choices are: ' +
      N.features.map((f, i) => `${i + 1}. ${f.label}.`).join(' ') + ' When you are done, press Start.', true, true);
  });
  ob.addEventListener('keydown', e => {
    if (e.key === 'Escape') { e.preventDefault(); applyModes(); closeOnboarding(false); return; }
    if (e.key !== 'Tab') return;
    const items = $$('button, a[href]', ob).filter(x => !x.hidden && x.offsetParent !== null);
    const first = items[0], last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });

  // ---------- rest stops ----------
  function restStop() {
    store.set('rest', { at: Date.now() });
    state.resting = true;
    state.target = null;
    dogMood('sleep');
    switchTab('lead');
    renderLead(true);
    positionDog();
    say('Rest stop. I saved your place and your answers on this device. Come back whenever you’re ready.', { ms: 6000 });
  }
  function resume() {
    store.del('rest');
    state.resting = false;
    state.stepKey = '';
    dogMood('happy', 1500);
    tick();
    if (state.cur) announceStep(settings.speak);
  }

  // ---------- commands (typed or spoken) ----------
  // Everything the user says or types goes through here. voice.js works out what they meant;
  // this carries it out on the page.
  const V = window.PF_VOICE;
  const voice = { pending: null, dictating: false, field: null, numbers: null, ttsEnd: 0, speakingText: '' };
  const textLike = f => f && f.matches && f.matches('textarea, input:not([type=radio]):not([type=checkbox]):not([type=button]):not([type=submit])');
  function fieldLabel(f) {
    return f.getAttribute('aria-label') || K.fieldLabels[f.dataset.pfPh || f.getAttribute('placeholder') || ''] || fieldHint(f);
  }
  // Every thing on screen that can be pressed or typed into, with the names someone might say.
  function pageLabels() {
    const out = [];
    const add = (node, names) => { names = [...new Set(names.map(norm).filter(Boolean))]; if (names.length) out.push({ node, names }); };
    // Match the portal's own wording and the everyday words for it ("Encounter Mgmt" → "appointments").
    for (const c of F.clickables()) add(c, [origText(c), c.textContent, c.getAttribute('aria-label') || '', rewrite(origText(c), 1), rewrite(origText(c), 2)]);
    for (const f of F.fields()) if (visible(f)) add(f, [fieldLabel(f), f.type === 'radio' || f.type === 'checkbox' ? rewrite(sibText(f), 1) : '']);
    if (!settings.collapsed) {
      for (const b of $$('button, a[href], [role=tab]', el.panel)) {
        if (!visible(b)) continue;
        const c = b.cloneNode(true);
        c.querySelectorAll('[aria-hidden=true], .pf-badge').forEach(x => x.remove());
        add(b, [b.getAttribute('aria-label') || '', c.textContent]);
      }
    }
    return out;
  }
  function voiceCtx() {
    return {
      pending: !!voice.pending, dictating: voice.dictating, numbersShown: !!voice.numbers, dialogOpen: !ob.hidden,
      tiles: N.features.map(f => ({ id: f.id, names: [f.label, f.desc] })),
      labels: ob.hidden ? pageLabels().flatMap(x => x.names) : [],
      fieldNames: F.fields().filter(visible).map(fieldLabel)
    };
  }
  function currentTextField() {
    // While dictating, stay in the same box. Otherwise follow the current step.
    if (voice.dictating && voice.field && voice.field.isConnected) return voice.field;
    if (textLike(state.target)) return state.target;
    if (voice.field && voice.field.isConnected) return voice.field;
    const a = document.activeElement;
    if (textLike(a) && portal.contains(a)) return a;
    return state.lastFocusHint ? F.fields().find(x => fieldHint(x) === state.lastFocusHint && textLike(x)) || null : null;
  }
  function findField(name) {
    const hit = V.bestMatch(name, F.fields().filter(visible).map(f => ({ f, names: [fieldLabel(f), fieldHint(f)] })));
    return hit && hit.score >= 0.55 ? hit.item.f : null;
  }
  const PROFILE_KEYS = [
    [/member|insurance/, 'memberId'], [/phone|number/, 'phone'], [/e-?mail/, 'email'], [/user ?name|^id$/, 'username'],
    [/birth|dob/, 'dob'], [/need|accessib/, 'needs'], [/name/, 'name']
  ];
  function profileValue(what) {
    const key = (PROFILE_KEYS.find(([re]) => re.test(what)) || [])[1];
    if (key === 'needs') { const kit = ($('.pf-paste', ui).__kit || [])[0]; return kit ? kit.text : ''; }
    return key ? profile[key] || '' : '';
  }
  function askConfirm(question, yes, no) {
    voice.pending = { yes, no, until: Date.now() + 20000 };
    notice('confirm', question, 'info', [
      { label: 'Yes', fn: () => { voice.pending = null; yes(); } },
      { label: 'No', fn: () => { voice.pending = null; if (no) no(); } }
    ]);
    say(`${question} Say yes or no.`, { forceSpeak: settings.listen });
  }
  function activate(node, name) {
    if (node.matches('input, select, textarea')) {
      node.focus();
      if (node.type === 'checkbox' || node.type === 'radio') { node.click(); return; }
      voice.field = textLike(node) ? node : null;
      if (node.tagName === 'SELECT') {
        say(`In “${fieldLabel(node)}”. The choices are: ${[...node.options].filter(o => o.value).map(o => norm(o.textContent)).join(', ')}. Say “choose” and one of them.`, { forceSpeak: settings.listen });
      } else {
        say(`I’m in the “${fieldLabel(node)}” box. Say “type” and the words, or “start dictation”.`, { forceSpeak: settings.listen });
      }
      return;
    }
    bubble(`Pressed “${name}”.`, 2500);
    live(`Pressed ${name}.`);
    node.click();
  }
  function showHelp(stuck) {
    const s = plan && state.cur && !state.resting ? state.cur.step : null;
    const tip = !s ? 'Tell me what you want to do, like “book a follow-up with my cardiologist”, “refill my medicine” or “understand my test results”.'
      : s.final ? 'You’re done with this task. Say “read this” to hear the page, or tell me something new to do.'
      : { press: 'Say “do it” and I’ll press it for you, or “show me” to see where it is.',
          slot: 'Say “choose” and a time, like “choose nine forty”, or “choose the first one”.',
          text: 'Say “type” and then the words, like “type follow-up visit”. Or say “start dictation” and just talk.',
          select: 'Say “choose” and the option. Say “what are the options” to hear them.',
          consent: 'Say “read this” to hear it. If you agree, say “tick it”. It’s your choice.' }[s.kind] || 'Say “do it” or “show me”.';
    const text = (s && !s.final ? `Right now: ${stepText(s)} ` : '') + tip +
      ' You can also say “show numbers” to put a number on everything you can press, then say the number. Say “stop” to stop me talking.';
    say(text, { ms: 12000, forceSpeak: settings.listen || stuck });
    switchTab('lead');
    const h = $('.pf-saycard', ui);
    if (h) h.open = true;
  }
  function explain(term) {
    const hit = V.bestMatch(term.replace(/^(?:an?|the)\s+/, ''), GLOSS.map(g => ({ g, names: [g.term] })));
    if (hit && hit.score >= 0.7) say(`“${hit.item.g.term}” means: ${hit.item.g.plain}.`, { ms: 8000, forceSpeak: settings.listen });
    else say(`I don’t know “${term}” yet. Say “simpler” and I’ll rewrite this page in easier words.`, { ms: 6000, forceSpeak: settings.listen });
  }
  function answer(about) {
    const tell = t => say(t, { ms: 10000, forceSpeak: settings.listen });
    if (about === 'appointment') {
      const a = store.get('appt', null);
      const row = $$('tr', portal).find(tr => /\d{2}\/\d{2}\/\d{4}|\w{3} \d{1,2}\/\d{1,2}/.test(origText(tr)) && !/DOS/.test(origText(tr)));
      if (a && a.when) return tell(`You asked for ${a.when}${a.prov ? ' with ' + a.prov : ''}. The clinic still has to approve it.`);
      if (row) return tell(`Your next appointment: ${$$('td', row).map(origText).join(', ')}.`);
      return tell('I don’t know yet. Say “open appointments” and I’ll read them to you.');
    }
    if (about === 'doctor') return tell(profile.doctors ? `Your profile lists: ${profile.doctors.replace(/\n/g, '. ')}.` : 'I don’t know your doctors yet. You can add them in the Fetch tab.');
    if (about === 'meds') return tell(profile.meds ? `Your profile lists: ${profile.meds.replace(/\n/g, '. ')}.` : 'I don’t know your medicines yet. You can add them in the Fetch tab.');
    if (about === 'time') {
      const sl = sessionLeft();
      return tell(sl == null ? 'This page doesn’t show a time limit.' : `This website will sign you out in about ${Math.floor(sl / 60)} minutes ${sl % 60} seconds.${settings.keepAlive ? ' I’m keeping you signed in.' : ' Say “keep me signed in” and I’ll stop that.'}`);
    }
    if (about === 'phone') return askConfirm('If phone calls are hard, I can write a message to the clinic instead. Want me to write it?', () => draft('phone'));
    if (about === 'accommodation') {
      if (/interpreter|sign language|\basl\b/i.test(voice.lastSaid || '')) { profile.acc = [...new Set([...(profile.acc || []), 'asl'])]; store.set('profile', profile); renderAccTiles(); renderPasteKit(); }
      setSetting('collapsed', false);
      switchTab('speak');
      return tell('Pick what helps you at the visit in Speak up, then say “write my request” and I’ll write it for you.');
    }
    if (about === 'privacy') return tell('Everything I know about you stays on this device, in this browser. I don’t send it anywhere, and I never save passwords.');
    return tell('I’m Pawthfinder, your guide dog for medical websites. I lead you step by step, warn you about problems ahead, explain hard words, fill in forms with you and help you ask for what you need. Say “help” any time.');
  }

  // Number labels on everything you can press or type into ("show numbers", then "click 5").
  const numLayer = document.createElement('div');
  numLayer.className = 'pf-nums';
  numLayer.setAttribute('aria-hidden', 'true');
  ui.appendChild(numLayer);
  function showNumbers(quiet) {
    const items = pageLabels().map(x => x.node).filter(n => {
      const r = n.getBoundingClientRect();
      return r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
    });
    voice.numbers = {};
    numLayer.innerHTML = items.map((n, i) => {
      voice.numbers[i + 1] = n;
      const r = n.getBoundingClientRect();
      return `<span class="pf-num" style="left:${Math.max(0, r.left - 6)}px;top:${Math.max(0, r.top - 10)}px">${i + 1}</span>`;
    }).join('');
    if (!quiet) say(`I put a number on ${items.length} things you can use. Say a number to press it, or “hide numbers”.`, { ms: 5000, forceSpeak: settings.listen });
  }
  function hideNumbers() { voice.numbers = null; numLayer.innerHTML = ''; }
  // Opening a section or switching tabs moves things in the panel; redraw the labels.
  const renumber = () => { if (voice.numbers) setTimeout(() => showNumbers(true), 60); };
  ui.addEventListener('click', renumber);
  ui.addEventListener('toggle', renumber, true);
  window.addEventListener('resize', renumber);

  const DISPATCH = {
    empty: () => {},
    yes: () => { const p = voice.pending; voice.pending = null; clearNotice('confirm'); if (p) p.yes(); },
    no: () => { const p = voice.pending; voice.pending = null; clearNotice('confirm'); if (p && p.no) p.no(); say('Okay.', { ms: 2000 }); },
    'listen-off': () => { setSetting('listen', false); say('I stopped listening. Press the microphone button, or click “Talk to Pawthfinder”, to talk to me again.', { ms: 7000, forceSpeak: true }); },
    hush: () => { if ('speechSynthesis' in window) speechSynthesis.cancel(); },
    'dialog-start': () => closeOnboarding(true),
    'dialog-skip': () => { applyModes(); closeOnboarding(false); },
    'dialog-read': () => $('.pf-ob-read', ob).click(),
    'dialog-tile': i => {
      const b = $(`[data-need="${i.id}"]`, ob);
      if (b && obPicked.has(i.id) !== i.on) b.click();
      const f = N.features.find(x => x.id === i.id);
      say(`${f.label}: ${i.on ? 'picked' : 'not picked'}. Say “start” when you’re done.`, { ms: 4000, forceSpeak: settings.listen });
    },
    help: i => showHelp(i.stuck),
    where: () => { summarize(); if (plan && state.cur) setTimeout(() => announceStep(true), 200); },
    step: () => announceStep(true),
    show: () => showMe(),
    'do-step': () => {
      const s = state.cur && state.cur.step;
      if (s && s.kind === 'select' && s.choose) return chooseIt(s.choose);
      pressIt();
    },
    'numbers-on': () => showNumbers(),
    'numbers-off': () => { hideNumbers(); say('Numbers hidden.', { ms: 2000 }); },
    number: i => {
      if (!voice.numbers) showNumbers(true);
      const n = voice.numbers[i.n];
      if (!n) return say(`There’s no number ${i.n}. Say “show numbers” to see them again.`, { forceSpeak: settings.listen });
      hideNumbers();
      if (i.value != null && textLike(n)) { setValue(n, i.value); n.focus(); return say(`Typed “${i.value}”.`, { ms: 3000 }); }
      const entry = pageLabels().find(x => x.node === n);
      activate(n, entry ? entry.names[0] : `number ${i.n}`);
    },
    'dictate-start': () => {
      const f = currentTextField();
      if (!f) return say('Which box should I type in? Say “click” and the box name, like “click reason for visit”, or say “show numbers”.', { forceSpeak: settings.listen });
      voice.dictating = true;
      voice.field = f;
      f.focus();
      updateMic();
      say(`Dictation on. I’ll type everything you say into “${fieldLabel(f)}”. Say “stop dictation” when you’re done.`, { ms: 6000, forceSpeak: settings.listen });
    },
    'dictate-text': i => {
      const f = currentTextField();
      if (!f) { voice.dictating = false; updateMic(); return; }
      let add = i.value.trim() || i.value;
      if (!f.value) add = add.charAt(0).toUpperCase() + add.slice(1);
      setValue(f, f.value + (f.value && add !== '\n' && !/\s$/.test(f.value) ? ' ' : '') + add);
      live(`Typed: ${add}`);
    },
    'dictate-stop': () => {
      const f = currentTextField();
      voice.dictating = false;
      updateMic();
      say(f ? `Dictation off. The box says: “${f.type === 'password' ? 'hidden' : f.value}”.` : 'Dictation off.', { ms: 6000, forceSpeak: settings.listen });
    },
    clear: () => { const f = currentTextField(); if (f) { setValue(f, ''); say('Cleared.', { ms: 2000 }); } else say('There’s no box to clear.'); },
    'delete-word': () => { const f = currentTextField(); if (f) { setValue(f, f.value.replace(/\s*\S+\s*$/, '')); say('Deleted the last word.', { ms: 2000 }); } },
    type: i => {
      const f = i.n != null && voice.numbers ? voice.numbers[i.n] : i.field ? findField(i.field) : currentTextField();
      if (!textLike(f)) {
        return say(i.field ? `I couldn’t find a “${i.field}” box here.` : 'Which box? Say “click” and the box name, or “show numbers”.', { forceSpeak: settings.listen });
      }
      const value = i.fromProfile ? profileValue(i.fromProfile) : i.value;
      if (!value) return say(`I don’t know your ${i.fromProfile} yet. Add it in the Fetch tab, or say “type” and then the words.`, { forceSpeak: settings.listen });
      setValue(f, value);
      voice.field = f;
      f.focus();
      say(`Typed “${f.type === 'password' ? '•'.repeat(value.length) : value}” in “${fieldLabel(f)}”.${i.spelled ? '' : ' Say “spell” and the letters if it’s not right.'}`, { ms: 5000 });
    },
    choose: i => chooseIt(i.value, i.time),
    tick: i => tickIt(i.on),
    options: () => {
      const t = state.target && state.target.tagName === 'SELECT' ? state.target : F.fields().find(f => f.tagName === 'SELECT' && !f.disabled && !f.value);
      const times = $$('[data-pf-click]', portal).filter(x => /^\d{2}:\d{2}$/.test(origText(x)));
      const radios = F.fields().filter(x => x.type === 'radio');
      const list = t ? [...t.options].filter(o => o.value).map(o => norm(o.textContent)) : times.length ? times.map(origText) : radios.map(r => rewrite(sibText(r), 1));
      say(list.length ? `The choices are: ${list.join(', ')}.` : 'There’s nothing to choose here.', { ms: 9000, forceSpeak: settings.listen });
    },
    scroll: i => {
      const behavior = settings.rm ? 'auto' : 'smooth';
      if (i.dir === 'top') window.scrollTo({ top: 0, behavior });
      else if (i.dir === 'bottom') window.scrollTo({ top: document.documentElement.scrollHeight, behavior });
      else window.scrollBy({ top: (i.dir === 'down' ? 0.7 : -0.7) * innerHeight, behavior });
      if (voice.numbers) setTimeout(() => showNumbers(true), 400);
    },
    back: () => history.back(),
    home: () => { const h = F.click(NAV_TO.home); if (h) h.click(); else say('I can’t find the home page link here.'); },
    panel: i => setSetting('collapsed', !i.show),
    tab: i => { setSetting('collapsed', false); switchTab(i.tab); say(`Opened ${$(`#pf-tab-${i.tab}`, ui).textContent.replace(/\d+$/, '').trim()}.`, { ms: 2500 }); },
    read: () => readPage(),
    'read-letter': () => speak(el.letter.value || 'There’s no letter yet. Say “write my request” first.', true, true),
    summary: () => summarize(),
    explain: i => explain(i.term),
    setting: i => {
      if (i.key === 'level') return setLevel(i.value === 'up' ? Math.min(2, +settings.level + 1) : 0, true);
      if (i.key === 'rate') {
        const r = Math.max(0.6, Math.min(1.6, Math.round((settings.rate + (i.value === 'up' ? 0.2 : -0.2)) * 10) / 10));
        setSetting('rate', r);
        return say(i.value === 'up' ? 'Okay, I’ll talk faster.' : 'Okay, I’ll talk slower.', { ms: 3000, forceSpeak: true });
      }
      const names = { large: 'Bigger text and buttons', hc: 'Strong contrast', speak: 'Reading aloud', rm: 'Less movement', oneStep: 'One step at a time', keepAlive: 'Keeping you signed in', dys: 'Easier-to-read letters', sounds: 'Sound cues' };
      setSetting(i.key, i.value);
      say(`${names[i.key]}: ${i.value ? 'on' : 'off'}.`, { ms: 3000, forceSpeak: i.key === 'speak' || settings.listen });
    },
    fill: () => {
      previewFill();
      const n = (el.fill.__items || []).length;
      if (n) askConfirm(`I can fill ${n} boxes from your profile. Should I fill them?`, () => DO['fill-go'](), () => DO['fill-cancel']());
    },
    paste: () => { const f = currentTextField(); if (f) f.focus(); pasteInto('short'); },
    letter: () => draft('acc'),
    card: () => accessibilityCard(),
    copy: () => copy(el.letter.value),
    rest: () => restStop(),
    resume: () => resume(),
    cancel: () => (plan ? endPlan() : say('Okay.', { ms: 2000 })),
    ask: i => answer(i.about),
    click: (i, raw) => {
      const hit = V.bestMatch(i.name, pageLabels());
      if (hit && hit.score >= 0.72) return activate(hit.item.node, hit.name);
      const g = parseGoal(raw);
      if (g && (!hit || hit.score < 0.6)) return startPlan(g);
      if (hit && hit.score >= 0.5) return askConfirm(`Did you mean “${hit.name}”?`, () => activate(hit.item.node, hit.name));
      say(`I can’t find “${i.name}” on this page. Say “show numbers” to see everything you can press.`, { ms: 6000, forceSpeak: settings.listen });
    },
    unknown: (i, raw, via) => {
      const g = parseGoal(raw);
      if (g) return startPlan(g);
      const hit = V.bestMatch(i.text, pageLabels());
      if (hit && hit.score >= 0.85) return activate(hit.item.node, hit.name);
      if (hit && hit.score >= 0.6) return askConfirm(`Did you mean “${hit.name}”?`, () => activate(hit.item.node, hit.name));
      const ideas = V.suggest(i.text).map(x => `“${x}”`).join(', ');
      say(`Sorry, I didn’t catch that. You could say ${ideas}. Say “help” for more.`, { ms: 8000, forceSpeak: via === 'voice' });
    }
  };
  function handleCommand(raw, via, intent) {
    raw = String(raw || '').trim();
    if (!raw) return;
    if (voice.pending && Date.now() > voice.pending.until) { voice.pending = null; clearNotice('confirm'); }
    intent = intent || V.parse(raw, voiceCtx());
    voice.lastSaid = raw;
    if (via === 'voice' && intent.type !== 'dictate-text') el.heard.textContent = `You said: “${raw}”`;
    if (voice.pending && intent.type !== 'yes' && intent.type !== 'no') { voice.pending = null; clearNotice('confirm'); }
    (DISPATCH[intent.type] || DISPATCH.unknown)(intent, raw, via);
  }

  // ---------- voice input ----------
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false, restartDelay = 250;
  const speakingNow = () => ('speechSynthesis' in window && speechSynthesis.speaking) || Date.now() - voice.ttsEnd < 450;
  function heard(text, kind) {
    el.heard.textContent = text;
    el.heard.dataset.state = kind || '';
  }
  function startListening() {
    if (!SR) {
      notice('novoice', 'Voice commands aren’t available in this browser. Chrome, Edge and Safari support them. You can type the same commands in the box above.', 'warn');
      setSetting('listen', false);
      return;
    }
    if (listening) return;
    rec = new SR();
    rec.lang = /^en/i.test(navigator.language || '') ? navigator.language : 'en-US';
    rec.continuous = true;
    rec.interimResults = true; // show words as they're heard
    rec.maxAlternatives = 5;   // and choose the version that makes sense on this page
    try {
      // Chrome's contextual biasing, where available: favor words that are on screen.
      if ('phrases' in rec && window.SpeechRecognitionPhrase) {
        rec.phrases = [...new Set(pageLabels().flatMap(x => x.names).concat(Object.values(V.EXAMPLES).flat()))].slice(0, 300).map(p => new window.SpeechRecognitionPhrase(p, 3));
      }
    } catch (err) { /* not supported */ }
    rec.onstart = () => { restartDelay = 250; heard(voice.dictating ? `✍️ Dictating into “${fieldLabel(currentTextField() || document.body)}”. Say “stop dictation” when you’re done.` : '🎤 Listening. Say “help” any time.', 'listening'); };
    rec.onresult = e => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!r.isFinal) { if (!speakingNow()) heard(`👂 “${r[0].transcript.trim()}…”`, 'hearing'); continue; }
        onHeard(Array.from(r).map(x => ({ transcript: x.transcript, confidence: x.confidence })));
      }
    };
    rec.onend = () => {
      if (!listening) return;
      // Recognition stops on silence; start again, backing off if it keeps failing.
      setTimeout(() => { if (listening) try { rec.start(); } catch (err) { /* already started */ } }, restartDelay);
      restartDelay = Math.min(restartDelay * 2, 4000);
    };
    rec.onerror = e => {
      const tell = (msg, actions) => notice('novoice', msg, 'warn', actions || []);
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        listening = false;
        settings.listen = false;
        saveSettings();
        updateMic();
        tell('I can’t use the microphone. Allow microphone access for this page (the icon at the left of the address bar), then press “Try again”.', [{ label: 'Try again', fn: () => setSetting('listen', true) }]);
      } else if (e.error === 'audio-capture') {
        tell('I can’t find a microphone. Check that one is plugged in and not muted, then press “Try again”.', [{ label: 'Try again', fn: () => { stopListening(); setSetting('listen', true); } }]);
      } else if (e.error === 'network') {
        tell('Voice commands in this browser need an internet connection. I’ll keep trying. You can type commands in the box meanwhile.');
      } else if (e.error === 'language-not-supported') {
        rec.lang = 'en-US';
      }
      // 'no-speech' and 'aborted' are normal; onend restarts.
    };
    listening = true;
    try { rec.start(); } catch (err) { /* already started */ }
    clearNotice('start-voice');
    updateMic();
  }
  function onHeard(alts) {
    const best = V.pickAlternative(alts.filter(a => a.transcript.trim()), voiceCtx());
    if (!best) return;
    // While I'm talking, the microphone can hear me through the speakers. Ignore anything that
    // sounds like what I'm saying; anything else is the user talking over me, so stop and listen.
    if (speakingNow()) {
      const heardText = best.transcript.toLowerCase().trim();
      const mine = (voice.speakingText || '').toLowerCase();
      const echo = mine && (mine.includes(heardText) || V.similarity(heardText, mine) >= 0.55);
      if (echo && best.intent.type !== 'hush' && best.intent.type !== 'listen-off') return;
      if ('speechSynthesis' in window) speechSynthesis.cancel();
      voice.speakingText = '';
      if (best.intent.type === 'hush') return;
    }
    // Not sure what was heard, and it would do something? Check first.
    const acts = ['click', 'number', 'do-step', 'tick', 'type', 'fill', 'cancel', 'unknown', 'dialog-start', 'dialog-skip', 'back'];
    if (!voice.dictating && !voice.pending && best.confidence > 0 && best.confidence < 0.5 && acts.includes(best.intent.type)) {
      heard(`🤔 I think you said “${best.transcript.trim()}”`, 'unsure');
      askConfirm(`Did you say “${best.transcript.trim()}”?`, () => handleCommand(best.transcript, 'voice', best.intent));
      return;
    }
    handleCommand(best.transcript, 'voice', best.intent);
    if (listening && !voice.dictating) setTimeout(() => { if (el.heard.dataset.state !== 'hearing') heard(`${el.heard.textContent}  ·  🎤 listening`, 'listening'); }, 1500);
  }
  function stopListening() {
    listening = false;
    voice.dictating = false;
    if (rec) try { rec.abort(); } catch (err) { /* not started */ }
    heard('');
    updateMic();
  }
  function updateMic() {
    el.mic.setAttribute('aria-pressed', String(listening));
    el.mic.classList.toggle('pf-on', listening);
    el.mic.classList.toggle('pf-dictating', listening && voice.dictating);
    el.mic.setAttribute('aria-label', listening ? 'Stop listening' : 'Talk to Pawthfinder');
  }

  // ---------- settings & modes ----------
  function saveSettings() { store.set('settings', settings); applyModes(); renderSettings(); }
  function setSetting(k, v, msg) {
    settings[k] = v;
    saveSettings();
    if (k === 'repair' && !v) unrepair();
    if (k === 'listen') v ? startListening() : stopListening();
    if (msg) say(msg, { ms: 4000 });
    tick();
  }
  function applyNeeds(ids) {
    const wasListening = settings.listen;
    Object.assign(settings, N.settingsFor(ids, settings));
    if (!settings.repair) unrepair();
    saveSettings();
    if (settings.listen && !wasListening) startListening();
    if (!settings.listen && wasListening) stopListening();
    tick();
  }
  function applyModes() {
    const h = document.documentElement.classList;
    h.add('pf-on');
    h.toggle('pf-hc', settings.hc);
    h.toggle('pf-large', settings.large);
    h.toggle('pf-dys', settings.dys);
    h.toggle('pf-rm', settings.rm);
    h.toggle('pf-repair', settings.repair);
    h.toggle('pf-collapsed', settings.collapsed);
    if (!settings.captions) el.bubble.hidden = true;
  }
  function renderSettings() {
    $$('[data-set]', ui).forEach(i => {
      if (i.type === 'checkbox') i.checked = !!settings[i.dataset.set];
      else i.value = settings[i.dataset.set];
    });
    $$('[data-level]', ui).forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.level === +settings.level)));
    $$('.pf-panel [data-need]', ui).forEach(b => b.setAttribute('aria-pressed', String((settings.needs || []).includes(b.dataset.need))));
    const line = $('.pf-account-line', ui);
    if (line) line.innerHTML = account
      ? `Signed in as <strong>${esc(account.name || account.email)}</strong> · <a href="../account/profile.html">My account</a>`
      : `<a href="../account/login.html?return=portal">Sign in</a> or <a href="../account/signup.html?return=portal">make a free account</a> to save your choices.`;
    $('.pf-needs-desc', ui).textContent = account
      ? 'These come from your account. Change anything here for this visit.'
      : 'Pick what helps you. Make an account to have these ready every time.';
  }

  // ---------- tabs ----------
  function switchTab(name, focus) {
    $$('[role=tab]', ui).forEach(t => {
      const on = t.dataset.tab === name;
      t.setAttribute('aria-selected', String(on));
      t.tabIndex = on ? 0 : -1;
      if (on && focus) t.focus();
    });
    $$('.pf-pane', ui).forEach(p => { p.hidden = p.id !== 'pf-pane-' + name; });
    if (name === 'translate') renderWords();
    if (name === 'sniff') renderHazards();
  }

  // ---------- wire up the panel ----------
  $('.pf-tabs', ui).addEventListener('click', e => { const t = e.target.closest('[role=tab]'); if (t) switchTab(t.dataset.tab); });
  $('.pf-tabs', ui).addEventListener('keydown', e => {
    const tabs = $$('[role=tab]', ui), i = tabs.indexOf(document.activeElement);
    if (i < 0) return;
    const go = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
    if (go == null) return;
    e.preventDefault();
    switchTab(tabs[(go + tabs.length) % tabs.length].dataset.tab, true);
  });
  $('.pf-goal', ui).addEventListener('submit', e => {
    e.preventDefault();
    const v = el.cmd.value;
    el.cmd.value = '';
    handleCommand(v, 'text');
  });
  $$('.pf-chip', ui).forEach(c => c.addEventListener('click', () => handleCommand(c.textContent, 'text')));
  el.mic.addEventListener('click', () => setSetting('listen', !listening));
  $('.pf-rest-btn', ui).addEventListener('click', () => (state.resting ? resume() : restStop()));
  $('.pf-collapse', ui).addEventListener('click', () => { setSetting('collapsed', true); el.fab.focus(); });
  el.fab.addEventListener('click', () => { setSetting('collapsed', false); el.cmd.focus(); });
  $$('[data-set]', ui).forEach(i => i.addEventListener('change', () => setSetting(i.dataset.set, i.type === 'checkbox' ? i.checked : +i.value)));
  $$('[data-level]', ui).forEach(b => b.addEventListener('click', () => setLevel(+b.dataset.level, true)));
  $$('.pf-panel [data-need]', ui).forEach(b => b.addEventListener('click', () => {
    const ids = new Set(settings.needs || []);
    ids.has(b.dataset.need) ? ids.delete(b.dataset.need) : ids.add(b.dataset.need);
    applyNeeds([...ids]);
    const f = N.features.find(x => x.id === b.dataset.need);
    say(`${f.label}: ${ids.has(f.id) ? 'on' : 'off'}.`, { ms: 2500 });
  }));

  const DO = {
    show: showMe, repeat: () => announceStep(true), press: pressIt, end: endPlan, resume,
    simplest: () => setLevel(2, true),
    read: readPage, summary: summarize, hush: () => 'speechSynthesis' in window && speechSynthesis.cancel(),
    fill: previewFill,
    'fill-go': async () => {
      const items = (el.fill.__items || []).filter((_, i) => { const c = $(`input[data-i="${i}"]`, el.fill); return c && c.checked; });
      el.fill.innerHTML = '';
      const done = await fillAll(items);
      say(done.length ? `I filled ${done.length} boxes: ${done.map(d => d.label).join(', ')}. They’re outlined in green — please check them.` : 'I didn’t fill anything.', { ms: 7000 });
    },
    'fill-cancel': () => { el.fill.innerHTML = ''; },
    erase: () => {
      store.del('profile');
      Object.keys(profile).forEach(k => { profile[k] = Array.isArray(profile[k]) ? [] : ''; });
      store.set('profile', profile);
      loadProfileForm();
      say('Your profile is erased from this device.', { ms: 4000 });
    },
    letter: () => draft('acc'),
    card: accessibilityCard,
    copy: () => copy(el.letter.value),
    download: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([el.letter.value], { type: 'text/plain' }));
      a.download = 'accessibility-request.txt';
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };
  ui.addEventListener('click', e => { const b = e.target.closest('[data-do]'); if (b && DO[b.dataset.do]) DO[b.dataset.do](); });

  const pform = $('.pf-profile-form', ui);
  function loadProfileForm() { $$('[name]', pform).forEach(i => { i.value = profile[i.name] || ''; }); }
  pform.addEventListener('submit', e => {
    e.preventDefault();
    $$('[name]', pform).forEach(i => { profile[i.name] = i.value.trim(); });
    store.set('profile', profile);
    state.steps = buildSteps(plan);
    say('Profile saved on this device.', { ms: 3000 });
  });
  function renderAccTiles() { $$('[data-acc]', ui).forEach(b => b.setAttribute('aria-pressed', String((profile.acc || []).includes(b.dataset.acc)))); }
  $$('[data-acc]', ui).forEach(b => b.addEventListener('click', () => {
    const k = b.dataset.acc, acc = new Set(profile.acc || []);
    acc.has(k) ? acc.delete(k) : acc.add(k);
    profile.acc = [...acc];
    store.set('profile', profile);
    renderAccTiles();
    renderPasteKit();
  }));
  renderAccTiles();
  $('.pf-acc-notes', ui).value = profile.accNotes || '';
  $('.pf-acc-notes', ui).addEventListener('change', e => { profile.accNotes = e.target.value; store.set('profile', profile); });
  el.letter.value = store.get('letter', '');

  document.addEventListener('keydown', e => {
    if (!e.altKey || !e.shiftKey) return;
    const act = { KeyN: showMe, KeyR: () => announceStep(settings.speak), KeyB: () => (state.resting ? resume() : restStop()),
      KeyP: () => { setSetting('collapsed', false); switchTab('lead'); el.cmd.focus(); },
      KeyH: () => setSetting('collapsed', !settings.collapsed) }[e.code];
    if (act) { e.preventDefault(); act(); }
  });

  // ---------- watch the page ----------
  portal.addEventListener('focusin', e => {
    if (e.target.matches('input, select, textarea')) { state.lastFocusHint = fieldHint(e.target); state.lastFocusAt = Date.now(); }
  });
  function restoreFocus() {
    // The portal re-renders whole views on some changes, which throws keyboard focus to the top.
    if (document.activeElement !== document.body || !state.lastFocusHint || Date.now() - state.lastFocusAt > 1500) return;
    const f = F.fields().find(x => fieldHint(x) === state.lastFocusHint);
    if (f) f.focus({ preventScroll: true });
  }
  portal.addEventListener('input', () => { snapshotForm(); schedule(); });
  portal.addEventListener('change', () => { snapshotForm(); schedule(); });

  let tickTimer = null;
  // Typing fires many events, so wait for a pause (120 ms). A portal page change is one render,
  // so react on the next frame (16 ms) instead; that still merges a redirect's back-to-back renders.
  function schedule(ms = 120) { clearTimeout(tickTimer); tickTimer = setTimeout(tick, ms); }
  function tick() {
    const prev = state.page;
    state.page = detectPage();
    if (prev !== state.page) state.restoreDismissed = false;
    markClickables();
    applyTranslate();
    repair();
    restoreFocus();
    if (state.page === 'confirmed') captureAppt();
    trackPlan(prev);
    renderHazards();
    checkRestore();
    if (!$('#pf-pane-translate', ui).hidden) renderWords();
    positionDog();
    if (voice.numbers) showNumbers(true);
    mo.takeRecords(); // ignore the changes we just made ourselves
  }
  const mo = new MutationObserver(recs => {
    const outsideTimer = recs.some(r => {
      const n = r.target.nodeType === 3 ? r.target.parentElement : r.target;
      return !(n && n.closest && n.closest('.sess'));
    });
    if (outsideTimer) schedule(16);
  });
  mo.observe(portal, { childList: true, subtree: true, characterData: true });

  // ---------- start ----------
  applyModes();
  renderSettings();
  loadProfileForm();
  renderPasteKit();
  if (plan) state.steps = buildSteps(plan);
  tick();
  let onboarded = q.get('onboard') === '0';
  try { onboarded = onboarded || sessionStorage.getItem('pf-onboarded') === '1'; } catch (e) { /* private mode */ }
  if (!onboarded) openOnboarding();
  if (state.resting) {
    dogMood('sleep');
    const r = store.get('rest', {});
    const mins = r.at ? Math.round((Date.now() - r.at) / 60000) : 0;
    notice('welcome', `Welcome back${mins ? ` — you rested for ${mins < 60 ? mins + ' minutes' : Math.round(mins / 60) + ' hours'}` : ''}. Ready to pick up where you left off?`, 'info', [{ label: 'Pick up where I left off', fn: resume }]);
  } else if (!plan) {
    bubble(settings.listen ? 'Hi! I’m Pawthfinder. Tell me what you want to do.' : 'Hi! I’m Pawthfinder, your guide dog for this website. What do you want to do?');
  }
  // Voice users: start listening right away if the microphone is already allowed, even while
  // the session-start picker is open ("bigger text", "start"). Otherwise one press is needed,
  // because browsers only ask for the microphone after a click.
  if (settings.listen && SR) {
    const ask = () => notice('start-voice', 'Voice is ready. Press “Start talking” once, then you can do everything by voice.', 'info', [{ label: '🎤 Start talking', fn: () => startListening() }]);
    (navigator.permissions && navigator.permissions.query ? navigator.permissions.query({ name: 'microphone' }) : Promise.reject())
      .then(p => (p.state === 'granted' ? startListening() : ask()))
      .catch(ask);
  }
})();
