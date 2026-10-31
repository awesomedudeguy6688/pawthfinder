// Pawthfinder's speech understanding. Turns what was heard into an intent:
// { type, ...details, score }. It never touches the page; pawthfinder.js carries intents out.
// Kept free of DOM code so it can be unit-tested (tests/voice.test.mjs).
(function (root) {
  'use strict';

  // ---------- cleaning up what speech recognition hears ----------
  const WAKE = /^(?:(?:hey|hi|ok|okay|yo)\s+)?(?:pawthfinder|paw\s*finder|pathfinder|path\s*finder|paw\s*path|doggy|doggie|puppy|buddy|good dog)\b[\s,.:!]*/;
  const POLITE = [
    /^(?:um+|uh+|er+|erm|hmm+|so|well|okay|ok|alright|right)\b[\s,]*/,
    /^(?:can|could|would|will) you\s+(?:please\s+)?/,
    /^(?:please|pls|kindly)\s+/,
    /^(?:i want to|i wanna|i'?d like to|i would like to|i need to|i have to|i gotta|let'?s|let me|try to|go ahead and)\s+/
  ];
  // Common mishearings in English speech recognition, fixed before parsing.
  const SOUNDS_LIKE = [
    [/\b(?:pressed|presses|breast|prest)\b/g, 'press'], [/\b(?:clicked|clicks|clique|klick)\b/g, 'click'],
    [/\b(?:typed|types|tight|tipe)\b(?= )/g, 'type'], [/\b(?:chose|choosing|chews)\b/g, 'choose'],
    [/^(?:tik|tic|take|kick|tick tock|check) (?:it|that|the box)\b/, 'tick it'], [/\b(?:untick|un-tick|uncheck)\b/g, 'untick'],
    [/\b(?:nest|necks|text) step\b/g, 'next step'], [/^(?:necks|nets|neck)$/, 'next'],
    [/\b(?:scrawl|scroll's)\b/g, 'scroll'], [/\b(?:sign-in|signing)\b/g, 'sign in'], [/\b(?:log-in|logging)\b/g, 'log in'],
    [/\bcardiologists?\b/g, 'cardiologist'], [/\bwhat'?s\b/g, 'what is'], [/\bwhere'?s\b/g, 'where is'],
    [/\bi'?m\b/g, 'i am'], [/\bi'?ll\b/g, 'i will'], [/\bthat'?s\b/g, 'that is'], [/\bdon'?t\b/g, 'do not'], [/\bcan'?t\b/g, 'cannot'], [/\bit'?s\b/g, 'it is']
  ];
  function normalize(raw) {
    let t = String(raw || '').toLowerCase().replace(/[“”"]/g, '').replace(/[’]/g, "'").replace(/[!?.,;]+$/g, '').replace(/\s+/g, ' ').trim();
    t = t.replace(WAKE, '');
    for (let i = 0; i < 3; i++) for (const re of POLITE) t = t.replace(re, '');
    for (const [re, to] of SOUNDS_LIKE) t = t.replace(re, to);
    return t.replace(/[,]/g, '').replace(/\s+(?:please|for me|thanks|thank you|now)$/g, '').trim();
  }

  // ---------- numbers, times and spelling ----------
  const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const ORDINALS = { first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10, last: -1 };
  const HOMOPHONE_NUM = { to: 2, too: 2, for: 4, fore: 4, won: 1, ate: 8, oh: 0 };
  function wordNumber(words, i = 0, loose = false) {
    // Reads a number starting at words[i]. Returns [value, wordsUsed] or null.
    const w = words[i];
    if (w == null) return null;
    if (/^\d+$/.test(w)) return [+w, 1];
    if (ORDINALS[w] != null) return [ORDINALS[w], 1];
    const m = w.match(/^(\d+)(?:st|nd|rd|th)$/);
    if (m) return [+m[1], 1];
    if (TENS[w] != null) {
      const next = words[i + 1], o = next && ONES.indexOf(next);
      return o > 0 && o < 10 ? [TENS[w] + o, 2] : [TENS[w], 1];
    }
    const o = ONES.indexOf(w);
    if (o >= 0) return [o, 1];
    if (loose && HOMOPHONE_NUM[w] != null) return [HOMOPHONE_NUM[w], 1];
    return null;
  }
  function toNumber(text) {
    const words = normalize(text).replace(/^(?:number|no\.?|item|option)\s+/, '').split(' ');
    const n = wordNumber(words, 0, true);
    return n && n[1] === words.length ? n[0] : null;
  }
  // "nine forty", "9 40", "nine o'clock", "one pm", "3:20 p.m." → "09:40" style (24 h).
  function spokenTime(text) {
    let t = normalize(text).replace(/\bo'?\s?clock\b/g, '').replace(/\b(a|p)\.?\s?m\.?\b/g, '$1m').replace(/\bnoon\b/g, '12:00 pm');
    const pm = /\bpm\b/.test(t), am = /\bam\b/.test(t);
    t = t.replace(/\b[ap]m\b/g, '').trim();
    let h = null, min = 0;
    const digits = t.match(/(\d{1,2})(?::|\s|\.)?(\d{2})?\b/);
    if (digits) { h = +digits[1]; min = +(digits[2] || 0); if (h > 24 && !digits[2] && String(h).length === 3) { min = h % 100; h = Math.floor(h / 100); } }
    else {
      const words = t.replace(/:00/, ' ').split(' ').filter(Boolean);
      const hw = wordNumber(words, 0, true);
      if (!hw) return null;
      h = hw[0];
      const rest = words.slice(hw[1]);
      if (rest[0] === 'oh' || rest[0] === 'o') { const mw = wordNumber(rest, 1); if (mw) min = mw[0]; }
      else if (rest.length) { const mw = wordNumber(rest, 0); if (mw) min = mw[0]; }
    }
    if (h == null || h > 23 || min > 59) return null;
    if (pm && h < 12) h += 12;
    if (am && h === 12) h = 0;
    return { exact: `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`, ambiguous: !pm && !am && h < 12, alt: !pm && !am && h < 12 ? `${String(h + 12).padStart(2, '0')}:${String(min).padStart(2, '0')}` : null };
  }
  const NATO = { alpha: 'a', alfa: 'a', bravo: 'b', charlie: 'c', delta: 'd', echo: 'e', foxtrot: 'f', golf: 'g', hotel: 'h', india: 'i', juliet: 'j', juliett: 'j', kilo: 'k', lima: 'l', mike: 'm', november: 'n', oscar: 'o', papa: 'p', quebec: 'q', romeo: 'r', sierra: 's', tango: 't', uniform: 'u', victor: 'v', whiskey: 'w', whisky: 'w', xray: 'x', 'x-ray': 'x', yankee: 'y', zulu: 'z' };
  const LETTER_SOUNDS = { bee: 'b', be: 'b', see: 'c', sea: 'c', dee: 'd', gee: 'g', jay: 'j', kay: 'k', el: 'l', em: 'm', en: 'n', oh: 'o', pee: 'p', queue: 'q', cue: 'q', are: 'r', ess: 's', tee: 't', tea: 't', you: 'u', vee: 'v', why: 'y', zed: 'z', zee: 'z', ex: 'x', double: '' };
  const SYMBOLS = { at: '@', 'at sign': '@', dot: '.', period: '.', point: '.', dash: '-', hyphen: '-', minus: '-', underscore: '_', 'under score': '_', plus: '+', space: ' ', slash: '/', hash: '#', pound: '#', comma: ',', apostrophe: "'" };
  // "j r i v e r a at example dot com" → "jrivera@example.com"; "capital j" → "J"; "double s" → "ss".
  function spell(text) {
    const words = String(text).toLowerCase().replace(/[.,]/g, ' ').replace(/\bx ray\b/g, 'xray').replace(/\bat sign\b/g, 'at').replace(/\bunder score\b/g, 'underscore').split(/\s+/).filter(Boolean);
    let out = '', upper = false, dbl = false;
    for (let i = 0; i < words.length; i++) {
      const w = words[i];
      if (w === 'capital' || w === 'uppercase' || w === 'cap') { upper = true; continue; }
      if (w === 'double') { dbl = true; continue; }
      let ch = null;
      if (SYMBOLS[w] != null) ch = SYMBOLS[w];
      else if (NATO[w]) ch = NATO[w];
      else if (/^[a-z]$/.test(w)) ch = w;
      else if (/^\d+$/.test(w)) ch = w;
      else if (ONES.indexOf(w) >= 0 && ONES.indexOf(w) < 10) ch = String(ONES.indexOf(w));
      else if (LETTER_SOUNDS[w] != null) ch = LETTER_SOUNDS[w];
      else ch = w; // a whole word, e.g. "example"
      if (upper) { ch = ch.toUpperCase(); upper = false; }
      if (dbl) { ch = ch + ch; dbl = false; }
      out += ch;
    }
    return out;
  }

  // ---------- fuzzy matching against what's on screen ----------
  const STOP = new Set(['the', 'a', 'an', 'button', 'link', 'box', 'field', 'tab', 'option', 'on', 'to', 'my', 'please', 'of', 'for']);
  const TITLES = new Set(['dr', 'doctor', 'mr', 'mrs', 'ms', 'nurse', 'my']);
  const clean = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  const tokens = s => clean(s).split(' ').filter(w => w && !STOP.has(w));
  function lev(a, b) {
    if (a === b) return 0;
    const m = a.length, n = b.length;
    if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) {
      const cur = [i];
      for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = cur;
    }
    return prev[n];
  }
  const wordSim = (a, b) => (a === b ? 1 : a.length > 3 && b.length > 3 && (a.startsWith(b) || b.startsWith(a)) ? 0.9 : 1 - lev(a, b) / Math.max(a.length, b.length));
  // 0..1: how well what was said matches a label. Forgives small mishearings and extra words.
  function similarity(said, label) {
    const a = tokens(said), b = tokens(label);
    if (!a.length || !b.length) return 0;
    const whole = 1 - lev(a.join(' '), b.join(' ')) / Math.max(a.join(' ').length, b.join(' ').length);
    const cover = b.reduce((n, w) => n + Math.max(...a.map(x => wordSim(x, w))), 0) / b.length;
    const precision = a.reduce((n, w) => n + Math.max(...b.map(x => wordSim(x, w))), 0) / a.length;
    // Everything said appears in the label ("dr patel" → "PATEL, ANITA R MD FACC").
    const content = a.filter(w => !TITLES.has(w));
    const contained = content.length && content.every(w => b.some(x => wordSim(x, w) >= 0.85));
    return Math.max(whole, 0.6 * cover + 0.4 * precision, contained ? 0.8 + 0.15 * cover : 0);
  }
  // candidates: [{ names: [...], ...anything }] → best { item, score, name } or null.
  function bestMatch(said, candidates) {
    let best = null;
    for (const c of candidates) for (const name of c.names) {
      if (!name) continue;
      const s = similarity(said, name);
      if (!best || s > best.score) best = { item: c, score: s, name };
    }
    return best;
  }

  // ---------- intents ----------
  const TABS = [
    [/^(?:lead|steps?|guide|guiding|goal)$/, 'lead'], [/^(?:sniff(?: ahead)?|warnings?|hazards?|dangers?|problems?)$/, 'sniff'],
    [/^(?:translate|translation|words|reading level|plain words)$/, 'translate'], [/^(?:fetch|forms?|form filling|fill|autofill|profile|paste kit)$/, 'fetch'],
    [/^(?:speak up|letters?|requests?|accommodations?|advocacy)$/, 'speak'], [/^(?:stay close|settings|options|preferences|setup|set up)$/, 'settings']
  ];
  // [pattern, setting, value] — value 'up'/'down' for steps.
  const SETTINGS = [
    [/^(?:bigger|larger|increase|zoom in|enlarge)(?: (?:the )?(?:text|font|letters|words|buttons|everything|things|it))?$|^make (?:it|things|everything|the text|the words|the buttons) (?:bigger|larger)$|^(?:i cannot see|it is too small|too small|i cannot read (?:it|this))$/, 'large', true],
    [/^(?:smaller|normal size|zoom out|make (?:it|things|everything) smaller)(?: text)?$/, 'large', false],
    [/^(?:(?:high|strong|more|better) contrast|contrast on|dark mode|make it darker|turn on (?:high |strong )?contrast)$/, 'hc', true],
    [/^(?:contrast off|normal colou?rs|light mode|turn off (?:high |strong )?contrast|less contrast)$/, 'hc', false],
    [/^(?:read (?:to me|aloud|out loud|things out loud)|talk to me|speak to me|turn on (?:voice|speech|reading aloud|read aloud)|reading aloud on|read aloud on)$/, 'speak', true],
    [/^(?:stop reading aloud|turn off (?:voice|speech|reading aloud|read aloud)|read aloud off|mute|do not talk|stop talking to me|silent mode)$/, 'speak', false],
    [/^(?:slower|slow down|talk slower|speak slower|too fast|read slower)$/, 'rate', 'down'],
    [/^(?:faster|speed up|talk faster|speak faster|too slow|read faster)$/, 'rate', 'up'],
    [/^(?:less (?:motion|movement|moving)|no (?:motion|movement|animations?)|stop (?:the )?(?:moving|animations?|motion)|reduce motion|reduced motion)$/, 'rm', true],
    [/^(?:one (?:step|thing) at a time|smaller steps|too much(?: on the screen)?|i am overwhelmed|this is overwhelming)$/, 'oneStep', true],
    [/^(?:show (?:all|every) (?:the )?steps|show me everything)$/, 'oneStep', false],
    [/^(?:keep me (?:signed|logged) in|more time|i need more time|do not (?:sign|log) me out|stop (?:the )?time ?out)$/, 'keepAlive', true],
    [/^(?:dyslexia(?: font| mode)?(?: on)?|easier to read letters|reading font|easier font)$/, 'dys', true],
    [/^(?:sounds? on|chimes? on|turn on (?:the )?sounds?)$/, 'sounds', true],
    [/^(?:sounds? off|chimes? off|no sounds?|turn off (?:the )?sounds?|stop (?:the )?(?:barking|chimes?|sounds?))$/, 'sounds', false],
    [/^(?:simpler|simplify(?: (?:it|this|that))?|plain(?:er)? (?:words|english|language)|easier words|use (?:easier|simpler) words|i do not understand (?:this|the|these) words|too (?:hard|complicated|confusing)|what does (?:this|that) (?:say|mean)|explain (?:this|that|it)(?: page)?)$/, 'level', 'up'],
    [/^(?:original (?:words|text|wording)|normal words|real words|show (?:the )?original)$/, 'level', 0]
  ];
  const HELP_RE = /^(?:help|help me|i need help|what can i (?:say|do)|what do i say|commands|voice commands|how does this work|how do i use (?:this|you)|i am (?:stuck|lost|confused)|i do not know(?: what to do)?|i do not understand|what do i do(?: now| next)?|what now\??|now what|huh|hello|hi)$/;

  function parse(raw, ctx = {}) {
    const t = normalize(raw);
    const said = String(raw || '').trim();
    const I = (type, extra = {}, score = 1) => Object.assign({ type, text: t, said }, extra, { score });
    let m;
    if (!t) return I('empty', {}, 0);

    // A pending yes/no question comes first.
    if (ctx.pending) {
      if (/^(?:yes|yeah|yep|yup|sure|correct|right|ok|okay|do it|go ahead|please do|that is right|uh huh|affirmative)$/.test(t)) return I('yes');
      if (/^(?:no|nope|nah|wrong|cancel|never ?mind|do not|stop|not that)$/.test(t)) return I('no');
    }
    // Dictation mode: everything goes into the box, except a few control words.
    if (ctx.dictating) {
      if (/^(?:stop dictat\w*|end dictat\w*|done dictat\w*|finish(?:ed)? dictat\w*|stop typing|i am done|that is all|done)$/.test(t)) return I('dictate-stop');
      if (/^(?:new line|next line|enter|line break)$/.test(t)) return I('dictate-text', { value: '\n' });
      if (/^(?:delete|undo|scratch) (?:that|the last word|last word)$/.test(t)) return I('delete-word');
      if (/^(?:clear|erase|delete) (?:it|all|everything|the box)$/.test(t)) return I('clear');
      return I('dictate-text', { value: said.replace(/^(?:hey )?pawthfinder[,\s]*/i, '') });
    }
    // Stopping speech or listening always works, even mid-sentence.
    if (/^(?:stop listening|stop the mic(?:rophone)?|mic(?:rophone)? off|turn off (?:the )?mic(?:rophone)?|go to sleep|sleep|goodbye|bye)$/.test(t)) return I('listen-off');
    if (/^(?:stop|quiet|be quiet|shh+|hush|shut up|enough|okay stop|stop (?:it|reading|talking|speaking))$/.test(t)) return I('hush');

    // Session-start picker.
    if (ctx.dialogOpen) {
      if (/^(?:start|begin|done|i am done|finished|that is all|that is it|go|let'?s go|ok start|continue|next)$/.test(t)) return I('dialog-start');
      if (/^(?:skip|skip (?:this|it|for now)|not now|later|close|no thanks)$/.test(t)) return I('dialog-skip');
      if (/^(?:read (?:the |my )?(?:choices|options|this|them)(?: to me)?|what are (?:the|my) (?:choices|options))$/.test(t)) return I('dialog-read');
      const remove = /^(?:remove|unpick|un-pick|take off|turn off|no|not|deselect|cancel)\s+/.test(t);
      const name = t.replace(/^(?:pick|choose|select|add|turn on|i want|i need|yes|remove|unpick|un-pick|take off|turn off|no|not|deselect|cancel|tick)\s+/, '');
      const hit = ctx.tiles && bestMatch(name, ctx.tiles);
      if (hit && hit.score >= 0.6) return I('dialog-tile', { id: hit.item.id, on: !remove, label: hit.name }, hit.score);
    }

    if (HELP_RE.test(t)) return I('help', { stuck: /stuck|lost|confused|do not know|do not understand|what do i do|now what|what now|huh/.test(t) });
    if (/^(?:where am i|what (?:page|screen) is this|what is (?:on )?(?:this|the) (?:page|screen)|what can i see|describe (?:this|the) page|what is here)$/.test(t)) return I('where');
    if (/^(?:next|next step|what is next|what next|(?:and )?then what|repeat(?: that)?|say (?:that|it) again|again|pardon|sorry|what|come again|one more time|what (?:was|is) the step|what (?:do|should) i do)$/.test(t)) return I('step');
    if (/^(?:show me|where is it|point(?: at it)?|show me where|where do i (?:click|press|go)|highlight it|find it)$/.test(t)) return I('show');
    if (/^(?:(?:press|click|tap|hit|do|push|select) (?:it|that|this|the button|that one|this one)|do it|go ahead|yes do it|ok do it|do that|that one|you do it|do it for me|press it for me)$/.test(t)) return I('do-step');

    if (/^(?:show|turn on|display) (?:the )?(?:numbers|number labels|labels|grid)$|^(?:number (?:the )?(?:buttons|things|everything)|what can i (?:click|press))$/.test(t)) return I('numbers-on');
    if (/^(?:hide|turn off|remove|clear) (?:the )?(?:numbers|number labels|labels|grid)$/.test(t)) return I('numbers-off');
    if ((m = t.match(/^(?:(?:click|press|tap|choose|pick|select|open|go to)\s+)?(?:number|no\.?|item)\s+(.+)$/)) || (ctx.numbersShown && (m = t.match(/^(?:(?:click|press|tap|choose|pick|select|open)\s+)?(\S+(?: \S+)?)$/)))) {
      const n = toNumber(m[1]);
      if (n != null && n > 0) return I('number', { n });
    }
    if ((m = t.match(/^(?:click|press|tap|select|open|hit)\s+(\S+(?: \S+)?)$/)) && !/^(?:first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth|last|\d+(?:st|nd|rd|th))$/.test(m[1])) {
      const n = toNumber(m[1]);
      if (n != null && n > 0) return I('number', { n });
    }
    if (ctx.numbersShown && (m = t.match(/^(?:type|write|enter|put)\s+(.+?)\s+(?:in|into|on)\s+(?:number\s+)?(\S+(?: \S+)?)$/))) {
      const n = toNumber(m[2]);
      if (n != null) return I('type', { value: m[1], n });
    }

    // Typing, spelling, dictation.
    if (/^(?:write|draft|make) (?:my |a |an )?(?:request|letter|accommodation letter|accommodation(?: request| letter)?)$/.test(t)) return I('letter');
    if (/^(?:make|create|print) (?:my |an? )?(?:accessibility )?card$/.test(t)) return I('card');
    if (/^(?:start dictat\w*|dictat\w*|dictation(?: mode)?|let me (?:type|write|say it)|i will (?:say|spell) it|take dictation)$/.test(t)) return I('dictate-start');
    if ((m = t.match(/^spell(?: out)?\s+(.+)$/))) return I('type', { value: spell(m[1]), spelled: true });
    if ((m = t.match(/^(?:type|write|enter|put|fill(?: in)?|add)\s+(?:in\s+)?my\s+(phone(?: number)?|number|email(?: address)?|e-?mail|name|full name|member id|insurance(?: id| number| member id)?|id|username|user name|date of birth|birthday|dob|needs|accessibility needs)(?:\s+(?:in|into)\s+(?:the\s+)?(.+?))?$/))) {
      return I('type', { fromProfile: m[1], field: m[2] && m[2].replace(/\s+(?:box|field)$/, '') });
    }
    if ((m = t.match(/^(?:type|write|enter|put|add)\s+(.+?)\s+(?:in|into|in to)\s+(?:the\s+)?(.+?)(?:\s+(?:box|field|space))?$/)) && ctx.fieldNames && bestMatch(m[2], ctx.fieldNames.map(n => ({ names: [n] }))) && bestMatch(m[2], ctx.fieldNames.map(n => ({ names: [n] }))).score >= 0.55) {
      return I('type', { value: said.replace(/^.*?\b(?:type|write|enter|put|add)\s+/i, '').replace(/\s+(?:in|into|in to)\s+(?:the\s+)?[^]*$/i, ''), field: m[2] });
    }
    if ((m = t.match(/^(?:fill(?: in)?|set)\s+(?:the\s+)?(.+?)(?:\s+(?:box|field))?\s+(?:with|to|as)\s+(.+)$/))) {
      return I('type', { value: said.replace(/^.*?\s(?:with|to|as)\s+/i, ''), field: m[1] });
    }
    if ((m = t.match(/^(?:type|write|enter|input)\s+(.+)$/))) return I('type', { value: said.replace(/^\s*(?:(?:hey )?pawthfinder[,\s]*)?(?:please\s+|can you\s+|could you\s+)?(?:type|write|enter|input)\s+/i, '').replace(/[.]$/, '') });
    if (/^(?:clear|erase|empty) (?:it|that|the box|this box|everything|all)$|^delete (?:it|the box|this box|everything|all)$|^start (?:the box )?over$/.test(t)) return I('clear');
    if (/^(?:delete|undo|scratch|remove) (?:that|the last word|last word)$|^backspace$/.test(t)) return I('delete-word');

    // Ticking, choosing, options.
    if (/^(?:tick|check|tick it|check it|tick the box|check the box|tick that|i agree|agree|yes i agree)$/.test(t)) return I('tick', { on: true });
    if (/^(?:untick|untick it|uncheck|uncheck it|untick the box|i do not agree|disagree)$/.test(t)) return I('tick', { on: false });
    if (/^(?:what are (?:the|my) (?:options|choices)|(?:read|list|tell me) (?:the )?(?:options|choices)(?: to me)?|what can i (?:choose|pick)|which (?:ones|options) are there)$/.test(t)) return I('options');
    if ((m = t.match(/^(?:choose|pick|select|i(?: will)? (?:want|take|go with)|go with|make it|the)\s+(.+)$/))) {
      const what = m[1].replace(/^(?:the|a|an)\s+/, '').replace(/\s+(?:one|option|please)$/, '');
      const time = /\d|o'?clock|\b(?:am|pm)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/.test(what) ? spokenTime(what) : null;
      return I('choose', { value: what, time });
    }

    // Moving around.
    if ((m = t.match(/^(?:scroll|page|move|go)?\s*(down|up)(?: a (?:bit|little)| more| please)?$/))) return I('scroll', { dir: m[1] });
    if ((m = t.match(/^(?:scroll |go |jump )?(?:to )?(?:the )?(top|bottom|end|start|beginning)(?: of (?:the )?page)?$/))) return I('scroll', { dir: /top|start|beginning/.test(m[1]) ? 'top' : 'bottom' });
    if (/^(?:go back|back|previous page|last page|undo that page|take me back)$/.test(t)) return I('back');
    if (/^(?:(?:go|take me) home|home(?: page)?|main page|dashboard|start over|begin again)$/.test(t)) return I('home');
    if ((m = t.match(/^(?:hide|close|minimi[sz]e|put away) (?:the )?(?:panel|sidebar|side bar|pawthfinder|dog|guide|helper)$/))) return I('panel', { show: false });
    if ((m = t.match(/^(?:show|open|bring back|unhide) (?:the )?(?:panel|sidebar|side bar|pawthfinder|guide|helper)$/))) return I('panel', { show: true });
    if ((m = t.match(/^(?:open|show|go to|switch to)?\s*(?:the\s+)?(.+?)(?:\s+tab)?$/))) {
      const tab = TABS.find(([re]) => re.test(m[1]));
      if (tab && (/tab$/.test(t) || /^(?:open|show|go to|switch to)/.test(t) || t === m[1])) return I('tab', { tab: tab[1] });
    }

    // Questions.
    if (/(?:when|what time|what day) is my (?:next )?(?:appointment|visit)|do i have (?:an|any) appointments?/.test(t)) return I('ask', { about: 'appointment' });
    if (/(?:who|what) (?:is|are) my doctors?|my doctor'?s name/.test(t)) return I('ask', { about: 'doctor' });
    if (/what (?:are|is) my (?:medicines?|meds|medications?|pills|prescriptions?)/.test(t)) return I('ask', { about: 'meds' });
    if (/how (?:long|much time) (?:do i have|is left|until)|when (?:will|do) i get (?:logged|signed|kicked) out|time ?out|time limit/.test(t)) return I('ask', { about: 'time' });
    if (/(?:call|phone|ring) (?:the )?(?:clinic|office|doctor|them)|cannot (?:make )?(?:phone )?calls?|(?:hard|difficult) to (?:call|talk on the phone)|phone number/.test(t)) return I('ask', { about: 'phone' });
    if (/interpreter|sign language|\basl\b|wheelchair|accessible (?:room|table)|accommodations?|(?:quiet|longer) (?:room|appointment|visit)|support person|service animal/.test(t)) return I('ask', { about: 'accommodation' });
    if (/privacy|private|safe|secure|who can see|where (?:is|does) my (?:data|information)|do you (?:store|save|keep)/.test(t)) return I('ask', { about: 'privacy' });
    if (/(?:what|who) are you|your name|what can you do/.test(t)) return I('ask', { about: 'self' });

    // Reading and understanding.
    if (/^(?:read|read (?:it|this|that|the page|this page|everything|it all)(?: to me| out| out loud| aloud)?|read (?:to me|aloud|out loud) (?:the|this) page)$/.test(t)) return I('read');
    if (/^(?:read (?:the |my )?letter|read (?:me )?what you wrote)$/.test(t)) return I('read-letter');
    if (/^(?:summari[sz]e|summary|give me (?:a|the) summary|what is (?:this page|this) about|the short version|tldr|in short)$/.test(t)) return I('summary');
    if ((m = t.match(/^(?:what (?:does|do|is|are)|what is the meaning of|explain|define|meaning of|tell me what)\s+(?:the\s+(?:word|term)\s+)?["']?(.+?)["']?(?:\s+mean|\s+means|\s+stand for)?$/)) && !/^(?:this|that|it|next|now)$/.test(m[1])) return I('explain', { term: m[1] });
    for (const [re, key, value] of SETTINGS) if (re.test(t)) return I('setting', { key, value });

    // Fetch, speak up, rest.
    if (/^(?:fill (?:this|the|it|in this|out this|out the)(?: page| form)?(?: for me)?|fill it in|fill (?:it )?out|autofill|fetch|use my profile|fill (?:in )?(?:my )?details|fill in the form)$/.test(t)) return I('fill');
    if (/^(?:paste|put|add|enter|type|insert) (?:in )?my (?:needs|accessibility needs|accommodations)(?: here| in(?: this| the)? box)?$/.test(t)) return I('paste');
    if (/^(?:copy|copy (?:it|that|the letter|my letter|the text))$/.test(t)) return I('copy');
    if (/(?:take a break|rest stop|^rest$|^pause$|i am tired|i need (?:a )?(?:break|rest)|break time|^(?:i will be|be) (?:right )?back)/.test(t)) return I('rest');
    if (/^(?:resume|i am back|keep going|carry on|pick up where i left off|let'?s continue|back again|ready)$/.test(t)) return I('resume');
    if (/^(?:stop guiding|cancel(?: (?:that|this|it|the goal))?|never ?mind|forget it|new goal|something else|i want to do something else)$/.test(t)) return I('cancel');

    // Pressing something by its name ("click sign in", "open appointments", "go to test results").
    if ((m = t.match(/^(?:click|press|tap|hit|push|open|select|go to|take me to|show me|visit|activate|follow)\s+(?:on\s+)?(?:the\s+)?(.+?)(?:\s+(?:button|link|page|tab|menu))?$/))) return I('click', { name: m[1] }, 0.9);

    return I('unknown', {}, 0);
  }

  // Of several things speech recognition thinks it heard, pick the one that makes the most sense here.
  function pickAlternative(alts, ctx = {}) {
    let best = null;
    for (const a of alts) {
      const intent = parse(a.transcript, ctx);
      let score = intent.score + 0.35 * (a.confidence || 0);
      if (intent.type === 'click' && ctx.labels) {
        const hit = bestMatch(intent.name, ctx.labels.map(l => ({ names: [l] })));
        score += hit && hit.score >= 0.6 ? hit.score * 0.4 : -0.2;
      }
      if (intent.type === 'unknown' && ctx.labels) {
        const hit = bestMatch(intent.text, ctx.labels.map(l => ({ names: [l] })));
        if (hit) score += hit.score * 0.6;
      }
      if (!best || score > best.score) best = { transcript: a.transcript, confidence: a.confidence || 0, intent, score };
    }
    return best;
  }

  // What to suggest when nothing matched: the closest example commands.
  const EXAMPLES = {
    'Getting around': ['next', 'show me', 'do it', 'click sign in', 'show numbers', 'click 3', 'scroll down', 'go back', 'where am I'],
    'Filling in forms': ['type hello', 'spell j r i v e r a', 'type my phone number', 'put 555 0100 in phone', 'start dictation', 'clear it', 'choose cardiology', 'choose nine forty', 'what are the options', 'tick it', 'fill this page', 'paste my needs'],
    'Understanding': ['read this', 'summarize', 'simpler', 'what does ABN mean', 'when is my appointment', 'I am stuck'],
    'Your settings': ['bigger', 'high contrast', 'read to me', 'slower', 'less movement', 'one step at a time', 'keep me signed in'],
    'Pawthfinder': ['book a follow-up with my cardiologist', 'refill my medicine', 'understand my test results', 'open warnings', 'write my request', 'take a break', 'I am back', 'stop', 'stop listening']
  };
  function suggest(said, n = 3) {
    const all = Object.values(EXAMPLES).flat();
    return all.map(e => [e, similarity(said, e)]).sort((a, b) => b[1] - a[1]).slice(0, n).map(x => x[0]);
  }

  const api = { normalize, toNumber, spokenTime, spell, similarity, bestMatch, parse, pickAlternative, suggest, EXAMPLES };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PF_VOICE = api;
})(typeof window !== 'undefined' ? window : globalThis);
