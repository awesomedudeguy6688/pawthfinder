// Pawthfinder accounts: sign in, sign up and the paste kit.
// Prototype only: accounts live in this browser's localStorage, next to the extension's data,
// so nothing is sent to a server. Passwords are salted and hashed, but this is not real security.
(function () {
  'use strict';

  const N = window.PF_NEEDS;
  const K = window.PF_KNOWLEDGE;
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const page = document.body.dataset.page;

  // ---------- storage ----------
  const read = (store, k, d) => { try { const v = store.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } };
  const accounts = () => read(localStorage, 'pf-accounts', {});
  const saveAccounts = all => localStorage.setItem('pf-accounts', JSON.stringify(all));
  const sessionEmail = () => read(sessionStorage, 'pf-session', null) || read(localStorage, 'pf-session', null);
  const me = () => { const e = sessionEmail(); return e ? accounts()[e] || null : null; };
  function signIn(email, remember) {
    sessionStorage.setItem('pf-session', JSON.stringify(email));
    if (remember) localStorage.setItem('pf-session', JSON.stringify(email));
    sessionStorage.removeItem('pf-onboarded'); // show the picker again, with this account's choices
    syncToExtension(accounts()[email]);
  }
  function signOut() {
    sessionStorage.removeItem('pf-session');
    localStorage.removeItem('pf-session');
  }
  // Copy what the extension's Fetch and Speak up tabs use into its own profile.
  function syncToExtension(a) {
    if (!a) return;
    const prof = read(localStorage, 'pf-profile', {});
    ['name', 'email', 'phone', 'acc', 'accNotes', 'conditions', 'conditionsText', 'needs'].forEach(k => { prof[k] = a[k]; });
    localStorage.setItem('pf-profile', JSON.stringify(prof));
  }
  const afterAuth = () => (params.get('return') === 'portal' ? '../portal/' : 'profile.html');

  async function hash(password, salt) {
    if (!(window.crypto && crypto.subtle)) throw new Error('insecure');
    const data = new TextEncoder().encode(salt + ':' + password);
    const buf = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const newSalt = () => Array.from(crypto.getRandomValues(new Uint8Array(12))).map(b => b.toString(16).padStart(2, '0')).join('');

  // Show the account pages in the look the person picked.
  function applyLook(needs) {
    ['large', 'hc', 'dys', 'rm'].forEach(id => document.documentElement.classList.toggle('pf-' + id, (needs || []).includes(id)));
  }

  const live = text => { const r = $('#live'); r.textContent = ''; setTimeout(() => { r.textContent = text; }, 50); };

  // ---------- form errors ----------
  function showErrors(form, errors) {
    const summary = $('.err-summary', form.closest('section, main'));
    $$('[aria-invalid]', form).forEach(i => i.removeAttribute('aria-invalid'));
    $$('.field-err', form).forEach(p => { p.hidden = true; p.textContent = ''; });
    if (!errors.length) { summary.hidden = true; return true; }
    errors.forEach(([id, msg]) => {
      const input = document.getElementById(id);
      input.setAttribute('aria-invalid', 'true');
      const p = document.getElementById(id + '-err');
      p.textContent = msg;
      p.hidden = false;
    });
    summary.innerHTML = `<h2>${errors.length === 1 ? 'One thing needs fixing' : errors.length + ' things need fixing'}</h2>
      <ul>${errors.map(([id, msg]) => `<li><a href="#${id}">${esc(msg)}</a></li>`).join('')}</ul>`;
    summary.hidden = false;
    summary.focus();
    return false;
  }
  document.addEventListener('click', e => {
    const a = e.target.closest('.err-summary a');
    if (a) { e.preventDefault(); document.getElementById(a.getAttribute('href').slice(1)).focus(); }
  });

  // Show/hide password buttons.
  $$('.show-pw').forEach(b => b.addEventListener('click', () => {
    const input = document.getElementById(b.getAttribute('aria-controls'));
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    b.setAttribute('aria-pressed', String(show));
    b.textContent = show ? 'Hide' : 'Show';
  }));
  // Big on/off buttons instead of checkboxes.
  $$('.big-toggle').forEach(b => b.addEventListener('click', () => b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true'))));

  function tileHTML(kind, id, icon, label, desc) {
    return `<button type="button" class="pf-tile" data-${kind}="${id}" aria-pressed="false">
      <span class="pf-tile-icon" aria-hidden="true">${icon}</span><span class="pf-tile-label">${esc(label)}</span>${desc ? `<span class="pf-tile-desc">${esc(desc)}</span>` : ''}</button>`;
  }

  // ---------- sign in ----------
  if (page === 'login') {
    if (me()) { location.replace(afterAuth()); return; }
    if (params.get('return') === 'portal') $('#to-signup').href = 'signup.html?return=portal';
    const form = $('#login-form');
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const email = $('#email').value.trim().toLowerCase(), password = $('#password').value;
      const errors = [];
      if (!email) errors.push(['email', 'Type your email address.']);
      if (!password) errors.push(['password', 'Type your password.']);
      if (!showErrors(form, errors)) return;
      const a = accounts()[email];
      try {
        if (!a || (await hash(password, a.salt)) !== a.passHash) {
          showErrors(form, [['password', 'That email and password don’t match an account on this device. Check them and try again.']]);
          return;
        }
      } catch (err) {
        showErrors(form, [['password', 'Please open this page from http://localhost or an https:// address. Your browser blocks password safety features on files.']]);
        return;
      }
      signIn(email, $('#remember').getAttribute('aria-pressed') === 'true');
      live('Signed in. Taking you there now.');
      location.href = afterAuth();
    });
    $('#demo-account').addEventListener('click', async () => {
      const email = 'jordan@example.com', all = accounts();
      if (!all[email]) {
        const salt = newSalt();
        all[email] = {
          email, name: 'Jordan Rivera', phone: '555-014-2290', salt, passHash: await hash('pawthfinder', salt),
          conditions: ['fatigue', 'memory'], conditionsText: '', needs: ['plain', 'oneStep', 'large', 'moreTime'],
          acc: ['quiet', 'longer', 'plain'], accNotes: 'Please give me written notes after the visit.', created: Date.now()
        };
        saveAccounts(all);
      }
      $('#email').value = email;
      $('#password').value = 'pawthfinder';
      live('Demo account filled in. Press Sign in.');
      $('#login-form button[type=submit]').focus();
    });
  }

  // ---------- sign up (and edit) ----------
  if (page === 'signup') {
    const editing = params.get('edit') === '1';
    const current = me();
    if (editing && !current) { location.replace('login.html'); return; }
    if (!editing && current) { location.replace('profile.html'); return; }
    if (params.get('return') === 'portal') $('#to-login').href = 'login.html?return=portal';

    const draft = editing
      ? JSON.parse(JSON.stringify(current))
      : { name: '', email: '', phone: '', conditions: [], conditionsText: '', needs: [], acc: [], accNotes: '' };

    $('#conditions').innerHTML = N.conditions.map(c => tileHTML('cond', c.id, c.icon, c.label)).join('');
    $('#features').innerHTML = N.features.map(f => tileHTML('need', f.id, f.icon, f.label, f.desc)).join('');
    $('#accs').innerHTML = K.accommodations.map(([k, l]) => tileHTML('acc', k, N.accIcons[k] || '✔️', l)).join('');

    const lists = { cond: 'conditions', need: 'needs', acc: 'acc' };
    function renderTiles() {
      Object.entries(lists).forEach(([kind, key]) => $$(`[data-${kind}]`).forEach(b => b.setAttribute('aria-pressed', String(draft[key].includes(b.dataset[kind])))));
      applyLook(draft.needs);
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('.pf-tile');
      if (!b) return;
      const kind = Object.keys(lists).find(k => b.dataset[k] != null);
      const key = lists[kind], id = b.dataset[kind];
      draft[key] = draft[key].includes(id) ? draft[key].filter(x => x !== id) : draft[key].concat(id);
      renderTiles();
      live(`${$('.pf-tile-label', b).textContent}: ${draft[key].includes(id) ? 'picked' : 'not picked'}`);
    });

    if (editing) {
      document.title = 'Change my needs — Pawthfinder';
      $('#page-title').textContent = 'Change my details and needs';
      $('#password-hint').textContent = 'Leave this empty to keep your current password.';
      $('#finish').textContent = 'Save changes';
      $('#email').readOnly = true;
      $('#email-hint').textContent = 'Your email is how you sign in, so it can’t be changed here.';
    }
    $('#name').value = draft.name;
    $('#email').value = draft.email;
    $('#phone').value = draft.phone || '';
    $('#conditions-text').value = draft.conditionsText || '';
    $('#acc-notes').value = draft.accNotes || '';
    renderTiles();

    const steps = $$('.step');
    let at = 0;
    function show(i, focus = true) {
      at = Math.max(0, Math.min(steps.length - 1, i));
      steps.forEach((s, n) => { s.hidden = n !== at; });
      $$('.stepper li').forEach((li, n) => {
        li.classList.toggle('done', n < at);
        li.classList.toggle('now', n === at);
        if (n === at) li.setAttribute('aria-current', 'step'); else li.removeAttribute('aria-current');
      });
      $('#step-count').textContent = `Step ${at + 1} of ${steps.length}`;
      if (steps[at].id === 'step-review') renderReview();
      if (focus) $('h2', steps[at]).focus();
      history.replaceState(null, '', '#' + steps[at].id);
    }
    function collectText() {
      draft.name = $('#name').value.trim();
      draft.email = $('#email').value.trim().toLowerCase();
      draft.phone = $('#phone').value.trim();
      draft.conditionsText = $('#conditions-text').value.trim();
      draft.accNotes = $('#acc-notes').value.trim();
    }
    function checkAbout() {
      collectText();
      const form = $('#about-form'), pw = $('#password').value, errors = [];
      if (!draft.name) errors.push(['name', 'Type your name, or the name you like to be called.']);
      if (!draft.email) errors.push(['email', 'Type your email address.']);
      else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email)) errors.push(['email', 'That email doesn’t look complete. It should look like name@example.com.']);
      else if (!editing && accounts()[draft.email]) errors.push(['email', 'There’s already an account with this email on this device. Sign in instead.']);
      if ((!editing || pw) && pw.length < 8) errors.push(['password', 'Make your password at least 8 characters long.']);
      return showErrors(form, errors);
    }
    $('#about-form').addEventListener('submit', e => { e.preventDefault(); if (checkAbout()) show(1); });
    $$('[data-next]').forEach(b => b.addEventListener('click', () => { collectText(); show(at + 1); }));
    $$('[data-back]').forEach(b => b.addEventListener('click', () => { collectText(); show(at - 1); }));
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-goto]');
      if (b) show(steps.findIndex(s => s.id === b.dataset.goto));
    });

    function listOr(items, none) { return items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : `<p class="muted">${none}</p>`; }
    function renderReview() {
      collectText();
      const conds = N.conditions.filter(c => draft.conditions.includes(c.id)).map(c => c.label).concat(draft.conditionsText ? [draft.conditionsText] : []);
      const feats = N.features.filter(f => draft.needs.includes(f.id)).map(f => f.label);
      const accs = K.accommodations.filter(([k]) => draft.acc.includes(k)).map(([, l]) => l).concat(draft.accNotes ? [draft.accNotes] : []);
      $('#review').innerHTML = `
        <div class="review-block"><h3>About you</h3><p>${esc(draft.name)}<br>${esc(draft.email)}${draft.phone ? '<br>' + esc(draft.phone) : ''}</p>
          <button type="button" class="btn small" data-goto="step-about">Change</button></div>
        <div class="review-block"><h3>About your disabilities</h3>${listOr(conds, 'You chose not to share this. That’s fine.')}
          <button type="button" class="btn small" data-goto="step-conditions">Change</button></div>
        <div class="review-block"><h3>What helps you online</h3>${listOr(feats, 'Nothing picked yet.')}
          <button type="button" class="btn small" data-goto="step-features">Change</button></div>
        <div class="review-block"><h3>What helps you at appointments</h3>${listOr(accs, 'Nothing picked yet.')}
          <button type="button" class="btn small" data-goto="step-accs">Change</button></div>`;
    }

    $('#finish').addEventListener('click', async () => {
      collectText();
      const all = accounts();
      const record = Object.assign({}, editing ? all[draft.email] : { created: Date.now() }, draft);
      const pw = $('#password').value;
      try {
        if (!editing || pw) { record.salt = newSalt(); record.passHash = await hash(pw, record.salt); }
      } catch (err) {
        live('Please open this page from http://localhost or an https:// address to create an account.');
        alert('Please open this page from http://localhost or an https:// address to create an account.');
        return;
      }
      all[draft.email] = record;
      saveAccounts(all);
      signIn(draft.email, false);
      location.href = params.get('return') === 'portal' ? '../portal/' : 'profile.html' + (editing ? '?saved=1' : '?new=1');
    });

    const start = steps.findIndex(s => '#' + s.id === location.hash);
    if (start > 0) {
      // Deep links (e.g. "Change" from the profile page) are only allowed once the first step is valid.
      if (editing) show(start); else show(0, false);
    } else show(0, false);
  }

  // ---------- profile + paste kit ----------
  if (page === 'profile') {
    const a = me();
    if (!a) { location.replace('login.html'); return; }
    applyLook(a.needs);
    $('#hello').textContent = `Hi, ${a.name || 'there'}!`;
    if (params.get('new') === '1') $('#banner').innerHTML = '<p><strong>Your account is ready.</strong> Below is your paste kit: your needs, already written out. Copy them into any form that asks.</p>';
    if (params.get('saved') === '1') $('#banner').innerHTML = '<p><strong>Saved.</strong> Your paste kit is up to date.</p>';
    if (!$('#banner').innerHTML) $('#banner').hidden = true;

    const kit = N.pasteKit(a);
    $('#kit').innerHTML = kit.length ? kit.map(k => `
      <div class="kit-item">
        <label for="kit-${k.id}"><h3>${esc(k.title)}</h3></label>
        <textarea id="kit-${k.id}" rows="${Math.min(8, Math.max(3, Math.ceil(k.text.length / 60) + (k.text.match(/\n/g) || []).length))}">${esc(k.text)}</textarea>
        <button type="button" class="btn primary" data-copy="kit-${k.id}"><span aria-hidden="true">📋</span> Copy</button>
      </div>`).join('')
      : '<p>You haven’t picked any needs yet. <a href="signup.html?edit=1#step-conditions">Add them now</a> and your paste kit will appear here.</p>';
    $('#copy-all').hidden = !kit.length;

    async function copyText(text, btn) {
      try {
        await navigator.clipboard.writeText(text);
      } catch (e) {
        const t = document.createElement('textarea');
        t.value = text; document.body.appendChild(t); t.select();
        document.execCommand('copy'); t.remove();
      }
      if (btn) { const old = btn.innerHTML; btn.innerHTML = '<span aria-hidden="true">✅</span> Copied!'; setTimeout(() => { btn.innerHTML = old; }, 2000); }
      live('Copied. Now paste it where you need it, with Control V, or Command V on a Mac.');
    }
    document.addEventListener('click', e => {
      const b = e.target.closest('[data-copy]');
      if (b) copyText(document.getElementById(b.dataset.copy).value, b);
    });
    $('#copy-all').addEventListener('click', e => copyText(kit.map(k => `${k.title}:\n${k.text}`).join('\n\n'), e.currentTarget));

    const chips = (items) => items.length ? items.map(([icon, label]) => `<li><span aria-hidden="true">${icon}</span> ${esc(label)}</li>`).join('') : '<li class="muted">Nothing picked</li>';
    $('#my-conditions').innerHTML = chips(N.conditions.filter(c => a.conditions.includes(c.id)).map(c => [c.icon, c.label]).concat(a.conditionsText ? [['✏️', a.conditionsText]] : []));
    $('#my-features').innerHTML = chips(N.features.filter(f => a.needs.includes(f.id)).map(f => [f.icon, f.label]));
    $('#my-accs').innerHTML = chips(K.accommodations.filter(([k]) => a.acc.includes(k)).map(([k, l]) => [N.accIcons[k] || '✔️', l]));

    $('#sign-out').addEventListener('click', () => { signOut(); location.href = 'login.html'; });
    const del = $('#delete');
    del.addEventListener('click', () => {
      if (del.dataset.confirm !== '1') {
        del.dataset.confirm = '1';
        del.textContent = 'Yes, delete my account from this device';
        $('#delete-msg').textContent = 'Are you sure? This removes your account and paste kit from this device. Press again to delete, or leave the page to keep it.';
        live($('#delete-msg').textContent);
        return;
      }
      const all = accounts();
      delete all[a.email];
      saveAccounts(all);
      signOut();
      location.href = 'login.html?deleted=1';
    });
  }

  if (page === 'login' && params.get('deleted') === '1') live('Your account was deleted from this device.');
})();
