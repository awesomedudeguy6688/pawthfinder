// MyHealthLink mock portal. A tiny hash-routed app. It knows nothing about Pawthfinder.
(function () {
  'use strict';

  var app = document.getElementById('app');
  var q = new URLSearchParams(location.search);
  if (q.get('reset') === '1') sessionStorage.removeItem('mhl');

  // Hostile on purpose: a hard session limit that ignores activity and wipes unsaved form data.
  var SESSION_MS = (parseInt(q.get('session'), 10) || 240) * 1000;

  var DEPTS = {
    'Cardiology': ['PATEL, ANITA R MD FACC', 'OKONKWO, DAVID MD'],
    'Dermatology': ['LINDQVIST, SARA MD'],
    'Endocrinology': ['NAKAMURA, KEN MD PHD'],
    'Orthopaedics': ['REYES, MARCO MD', 'BAKER, LIN DO'],
    'Primary Care': ['ADEYEMI, GRACE MD', 'COHEN, RUTH NP']
  };
  var TYPES = [['FU', 'F/U - EST PT'], ['NP', 'NP CONSULT'], ['TH', 'TELEHEALTH (SYNC A/V)']];
  var DAYS = [
    ['Tue 11/10', ['08:20', '09:40', '13:00', '15:20']],
    ['Thu 11/12', ['07:40', '11:00', '14:40']],
    ['Mon 11/16', ['10:20', '16:00']]
  ];
  var MEDS = [
    ['ATORVASTATIN', 'ATORVASTATIN CALCIUM 20 MG PO TAB', '1 TAB PO QHS', 0],
    ['LISINOPRIL', 'LISINOPRIL 10 MG PO TAB', '1 TAB PO QD', 2]
  ];
  var NAV = [['home', 'Dashboard'], ['encounters', 'Encounter Mgmt'], ['rx', 'Rx Mgmt'], ['results', 'Dx Results'], ['msgs', 'Correspondence'], ['billing', 'Fin. Responsibility']];

  function fresh() {
    return {
      user: null, ends: 0, req: {}, msg: '', last: null, rx: {}, open: false,
      appts: [{ dos: '12/03/2026 09:00', prov: 'ADEYEMI, GRACE MD', dept: 'Primary Care', type: 'ANNUAL WELLNESS (AWV)', status: 'SCHED' }]
    };
  }
  var S;
  try { S = JSON.parse(sessionStorage.getItem('mhl')) || fresh(); } catch (e) { S = fresh(); }

  function save() { sessionStorage.setItem('mhl', JSON.stringify(S)); }
  function route() { return location.hash.replace(/^#\/?/, '') || 'home'; }
  function go(r) { location.hash = '#/' + r; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function left() { return Math.max(0, S.ends - Date.now()); }
  function fmt(ms) { var s = Math.ceil(ms / 1000); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
  function takeMsg() { var m = S.msg; S.msg = ''; save(); return m ? '<div class="err">' + esc(m) + '</div>' : ''; }

  function shell(inner) {
    return '<div class="hdr"><span class="brand">MyHealthLink<sup>®</sup></span>' +
      '<span class="sess">Session: <b id="sess-t">' + fmt(left()) + '</b> <span class="lnk xs" data-act="extend">[extend]</span></span></div>' +
      '<div class="nav">' + NAV.map(function (n) { return '<span class="lnk" data-go="' + n[0] + '">' + n[1] + '</span>'; }).join(' | ') +
      ' | <span class="lnk" data-act="logout">Log off</span></div>' +
      '<div class="main">' + inner + '</div>' +
      '<div class="ftr">© 2026 MyHealthLink Patient Engagement Platform v4.2.1 build 20190312. Best viewed in Internet Explorer 11 at 1024×768.</div>';
  }

  var VIEWS = {
    login: function () {
      return '<div class="login"><div class="brand big">MyHealthLink<sup>®</sup></div>' +
        '<div class="sub">Patient Engagement Platform</div>' + takeMsg() +
        '<div class="row"><input class="f" data-k="u" placeholder="ID" autocomplete="off"></div>' +
        '<div class="row"><input class="f" data-k="p" type="password" placeholder="PW"></div>' +
        '<div class="row"><div class="btn" data-act="login">Sign In</div> <span class="lnk xs">Forgot PW?</span></div>' +
        '<p class="fine">Authorized users only. Use of this system constitutes consent to monitoring. Unauthorized access is prohibited and may be subject to civil and criminal penalties.</p>' +
        '<p class="fine">Demo: any ID and PW will work.</p></div>';
    },
    home: function () {
      return '<h2 class="h">Welcome back, ' + esc(String(S.user).toUpperCase()) + '</h2>' +
        '<div class="notice">ATTN: Effective 01/01, all non-emergent encounters require prior authorization (PA) from your payer. Failure to obtain PA may result in claim denial and patient financial responsibility for the full allowable amount.</div>' +
        '<div class="notice">Your EOB for DOS 08/14/2026 is available. The adjudicated amount reflects application of your deductible and coinsurance; this is not a bill.</div>' +
        '<div class="tiles">' +
        '<div class="tile"><b>' + S.appts.length + '</b>Upcoming encounters</div>' +
        '<div class="tile"><b>1</b>Pending Dx results</div>' +
        '<div class="tile"><b>1</b>Rx renewals due</div>' +
        '<div class="tile"><b>0</b>Unread correspondence</div></div>';
    },
    encounters: function () {
      return '<h2 class="h">Encounter Management</h2>' +
        '<h3 class="h3">Upcoming Encounters</h3>' +
        '<table class="tbl"><tr><th>DOS</th><th>Provider</th><th>Dept</th><th>Type</th><th>Status</th></tr>' +
        S.appts.map(function (a) { return '<tr><td>' + esc(a.dos) + '</td><td>' + esc(a.prov) + '</td><td>' + esc(a.dept) + '</td><td>' + esc(a.type) + '</td><td>' + esc(a.status) + '</td></tr>'; }).join('') +
        '</table>' +
        '<p class="fine">To modify or cancel an existing encounter, contact Patient Access Services at 1-800-555-0142 (M–F 08:00–16:30 CST). Online modification is not supported.</p>' +
        '<p class="fine">Pre-encounter documentation: <a href="#" class="lnk" data-act="pdf">Pt_Intake_Packet_rev7_SCANNED.pdf</a> (4.8 MB)</p>' +
        '<div class="btn" data-act="new-req">Initiate Encounter Request</div>';
    },
    request: function () {
      var r = S.req, d = r.dept || '', provs = DEPTS[d] || [];
      return '<h2 class="h">New Encounter Request <span class="xs">(Step 1 of 2)</span></h2>' +
        '<p class="fine">Complete all required (*) fields. Requests submitted less than 48 business hrs prior to DOS may not be accommodated.</p>' +
        '<div class="row"><select class="f" data-k="dept"><option value="">-- Select Svc Line --</option>' +
        Object.keys(DEPTS).map(function (x) { return '<option' + (x === d ? ' selected' : '') + '>' + x + '</option>'; }).join('') +
        '</select> *</div>' +
        '<div class="row"><select class="f" data-k="prov"' + (d ? '' : ' disabled') + '><option value="">-- Rendering Provider --</option>' +
        provs.map(function (p) { return '<option' + (p === r.prov ? ' selected' : '') + '>' + p + '</option>'; }).join('') +
        '</select> *</div>' +
        '<div class="row">' + TYPES.map(function (t) {
          return '<input type="radio" name="vt" data-k="type" value="' + t[0] + '"' + (r.type === t[0] ? ' checked' : '') + '><span class="xs">' + t[1] + '</span>';
        }).join(' ') + ' *</div>' +
        '<div class="row"><textarea class="f" data-k="cc" placeholder="CC / RFV" rows="2">' + esc(r.cc) + '</textarea> *</div>' +
        '<div class="row"><input class="f" data-k="mbr" placeholder="MBR ID" value="' + esc(r.mbr) + '"> * ' +
        '<input class="f" data-k="ph" placeholder="Contact #" value="' + esc(r.ph) + '"> *</div>' +
        '<div class="row ack"><input type="checkbox" data-k="ack"' + (r.ack ? ' checked' : '') + '><span class="xs">I acknowledge receipt of the ABN and accept financial responsibility for non-covered services, including amounts applied to deductible, coinsurance, or copay, as determined by payer adjudication.</span> *</div>' +
        takeMsg() +
        '<div class="row"><div class="btn" data-act="cont">Continue &gt;&gt;</div></div>';
    },
    slots: function () {
      var r = S.req;
      return '<h2 class="h">Select Available Slot <span class="xs">(Step 2 of 2)</span></h2>' +
        '<p class="fine">Slots displayed in facility local time. Slot availability is not guaranteed until request is adjudicated by scheduling.</p>' +
        DAYS.map(function (d) {
          return '<div class="day"><div class="dlabel">' + d[0] + '</div>' + d[1].map(function (t) {
            var v = d[0] + ' ' + t;
            return '<span class="slot' + (r.slot === v ? ' sel' : '') + '" data-act="slot" data-v="' + v + '">' + t + '</span>';
          }).join('') + '</div>';
        }).join('') +
        '<p class="fine">Selected slot: ' + esc(r.slot || 'none') + '</p>' +
        '<div class="robot"><span class="rbox" data-act="robot">' + (r.robot ? '✓' : '') + '</span> I am not a robot</div>' +
        takeMsg() +
        '<div class="btn" data-act="back">&lt;&lt; Back</div> <div class="btn" data-act="submit">Submit Request</div>';
    },
    confirmed: function () {
      var a = S.last || {};
      return '<h2 class="h">Encounter Request Submitted</h2>' +
        '<p>Encounter request submitted. Status: pending adjudication by scheduling.</p>' +
        '<table class="tbl">' +
        '<tr><td>Requested DOS/Time</td><td>' + esc(a.dos) + '</td></tr>' +
        '<tr><td>Rendering Provider</td><td>' + esc(a.prov) + '</td></tr>' +
        '<tr><td>Svc Line</td><td>' + esc(a.dept) + '</td></tr>' +
        '<tr><td>Ref #</td><td>' + esc(a.ref) + '</td></tr></table>' +
        '<p class="fine">Pt to present 15 min prior to scheduled time for registration and copay collection. NPO not required unless otherwise indicated.</p>';
    },
    rx: function () {
      return '<h2 class="h">Medication List</h2>' +
        '<table class="tbl"><tr><th>Medication</th><th>Sig</th><th>Refills</th><th></th></tr>' +
        MEDS.map(function (m) {
          var action = S.rx[m[0]]
            ? '<span class="xs">Renewal request transmitted to prescriber. Allow 72 business hrs for adjudication.</span>'
            : '<span class="lnk xs" data-act="renew" data-v="' + m[0] + '">Req Renewal</span>';
          return '<tr><td>' + m[1] + '</td><td>' + m[2] + '</td><td>' + m[3] + '</td><td>' + action + '</td></tr>';
        }).join('') + '</table>';
    },
    results: function () {
      return '<h2 class="h">Diagnostic Results</h2>' +
        '<table class="tbl"><tr><th>Test</th><th>Resulted</th><th></th></tr>' +
        '<tr><td>LIPID PANEL W/ REFLEX DIRECT LDL</td><td>10/28/2026</td><td><span class="lnk xs" data-act="view">' + (S.open ? 'Hide' : 'View') + '</span></td></tr></table>' +
        (S.open ? '<table class="tbl"><tr><th>Component</th><th>Value</th><th>Flag</th><th>Ref Range</th></tr>' +
          '<tr><td>TOTAL CHOLESTEROL</td><td>238 mg/dL</td><td class="flag">H</td><td>&lt;200</td></tr>' +
          '<tr><td>LDL-C (CALC)</td><td>162 mg/dL</td><td class="flag">H</td><td>&lt;100</td></tr>' +
          '<tr><td>HDL-C</td><td>44 mg/dL</td><td></td><td>&gt;39</td></tr>' +
          '<tr><td>TRIGLYCERIDES</td><td>160 mg/dL</td><td class="flag">H</td><td>&lt;150</td></tr></table>' +
          '<p class="fine">Pt w/ hyperlipidemia; recommend continue statin therapy, TLC, and repeat FLP in 3 mo. F/U w/ cardiology PRN.</p>' : '');
    },
    other: function () {
      return '<h2 class="h">Module Unavailable</h2><p class="err">An unexpected error has occurred. (0x80070057)</p>';
    }
  };

  function render() {
    var r = route();
    if (!S.user && r !== 'login') { location.replace('#/login'); return; }
    if (S.user && r === 'login') { location.replace('#/home'); return; }
    var v = VIEWS[r] || VIEWS.other;
    app.innerHTML = r === 'login' ? v() : shell(v());
  }

  var ACTS = {
    login: function () {
      var u = app.querySelector('[data-k=u]').value.trim(), p = app.querySelector('[data-k=p]').value;
      if (!u || !p) { S.msg = 'ERR-401: Invalid credential payload.'; save(); render(); return; }
      S.user = u; S.ends = Date.now() + SESSION_MS; save(); go('home');
    },
    logout: function () { S.user = null; S.req = {}; save(); go('login'); },
    extend: function () {
      S.ends = Date.now() + SESSION_MS; save();
      var t = document.getElementById('sess-t'); if (t) t.textContent = fmt(left());
    },
    'new-req': function () { S.req = {}; save(); go('request'); },
    pdf: function (el) {
      if (!el.nextElementSibling || !el.nextElementSibling.classList.contains('err')) {
        el.insertAdjacentHTML('afterend', ' <span class="err">Unable to render document. Adobe Reader 9+ plug-in required.</span>');
      }
    },
    cont: function () {
      var r = S.req;
      if (!r.dept || !r.prov || !r.type || !(r.cc || '').trim() || !(r.mbr || '').trim() || !(r.ph || '').trim() || !r.ack) {
        S.msg = 'ERR: Required field(s) missing.'; save(); render(); return;
      }
      go('slots');
    },
    slot: function (el) { S.req.slot = el.dataset.v; save(); render(); },
    robot: function () { S.req.robot = !S.req.robot; save(); render(); },
    back: function () { go('request'); },
    submit: function () {
      var r = S.req;
      if (!r.slot || !r.robot) { S.msg = 'ERR: Slot selection and verification required.'; save(); render(); return; }
      var type = TYPES.filter(function (t) { return t[0] === r.type; })[0];
      S.last = { dos: r.slot, prov: r.prov, dept: r.dept, ref: 'ENC-' + (40000 + Math.floor(Math.random() * 9999)) };
      S.appts.unshift({ dos: r.slot, prov: r.prov, dept: r.dept, type: type ? type[1] : '', status: 'PENDING ADJ' });
      S.req = {}; save(); go('confirmed');
    },
    renew: function (el) { S.rx[el.dataset.v] = true; save(); render(); },
    view: function () { S.open = !S.open; save(); render(); }
  };

  app.addEventListener('click', function (e) {
    var t = e.target.closest('[data-act],[data-go]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.go) { go(t.dataset.go); return; }
    if (ACTS[t.dataset.act]) ACTS[t.dataset.act](t);
  });

  function onField(e) {
    var el = e.target, k = el.dataset && el.dataset.k;
    if (!k || k === 'u' || k === 'p') return;
    S.req[k] = el.type === 'checkbox' ? el.checked : el.value;
    if (k === 'dept' && e.type === 'change') { S.req.prov = ''; save(); render(); return; }
    save();
  }
  app.addEventListener('input', onField);
  app.addEventListener('change', onField);

  setInterval(function () {
    if (!S.user) return;
    var t = document.getElementById('sess-t');
    if (t) t.textContent = fmt(left());
    if (left() <= 0) {
      S.user = null; S.req = {};
      S.msg = 'Your session has been terminated due to inactivity. Unsaved data has been discarded. (SESS-EXP-09)';
      save(); go('login');
    }
  }, 1000);

  window.addEventListener('hashchange', render);
  render();
})();
