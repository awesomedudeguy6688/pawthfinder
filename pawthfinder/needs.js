// Shared catalog of needs, used by the session-start picker, the "Stay close" tab and sign-up.
// Each website feature turns on a bundle of Pawthfinder settings.
window.PF_NEEDS = {
  features: [
    { id: 'voice', icon: '🎤', label: 'I talk instead of typing', desc: 'Control everything with your voice', set: { listen: true, speak: true, sounds: true } },
    { id: 'readAloud', icon: '🔊', label: 'Read things out loud', desc: 'Hear each step and each page', set: { speak: true } },
    { id: 'keyboard', icon: '⌨️', label: 'I use a keyboard, not a mouse', desc: 'Every button works with Tab and Enter', set: { repair: true, focusFollow: true } },
    { id: 'screenReader', icon: '🦯', label: 'I use a screen reader', desc: 'Clear labels and spoken updates', set: { repair: true, focusFollow: true, sounds: true } },
    { id: 'plain', icon: '📖', label: 'Plain, simple words', desc: 'No medical or insurance jargon', set: { level: 2 } },
    { id: 'oneStep', icon: '👣', label: 'One step at a time', desc: 'Small steps, nothing extra', set: { oneStep: true } },
    { id: 'large', icon: '🔍', label: 'Bigger text and buttons', desc: 'Easier to see and to press', set: { large: true } },
    { id: 'hc', icon: '🌓', label: 'Strong contrast', desc: 'Bright text on a dark background', set: { hc: true } },
    { id: 'dys', icon: '🔤', label: 'Easier-to-read letters', desc: 'Dyslexia-friendly spacing', set: { dys: true } },
    { id: 'rm', icon: '🐢', label: 'Less movement', desc: 'Turn off animations', set: { rm: true } },
    { id: 'moreTime', icon: '⏳', label: 'More time', desc: 'Keep me signed in, save my answers', set: { keepAlive: true } },
    { id: 'sounds', icon: '🔔', label: 'Sound cues', desc: 'A chime for each step, a bark for warnings', set: { sounds: true } }
  ],

  // Settings every feature bundle starts from, so un-picking a tile turns its settings back off.
  // Reading level is left alone unless "Plain, simple words" is picked or un-picked.
  base: { speak: false, listen: false, sounds: false, oneStep: false, large: false, hc: false, dys: false, rm: false, repair: true, focusFollow: false, keepAlive: false },

  // Self-described and always optional. `phrase` is how it reads in copy-ready text.
  conditions: [
    { id: 'deaf', icon: '🦻', label: 'Deaf or hard of hearing', phrase: 'I am Deaf or hard of hearing' },
    { id: 'blind', icon: '👁️', label: 'Blind or low vision', phrase: 'I am blind or have low vision' },
    { id: 'mobility', icon: '♿', label: 'Use a wheelchair or mobility aid', phrase: 'I use a wheelchair or mobility aid' },
    { id: 'hands', icon: '✋', label: 'Limited hand use or tremor', phrase: 'I have limited use of my hands' },
    { id: 'memory', icon: '🧠', label: 'Memory, focus or brain fog', phrase: 'I have trouble with memory or focus' },
    { id: 'fatigue', icon: '🔋', label: 'Chronic illness, pain or fatigue', phrase: 'I live with chronic illness, pain or fatigue' },
    { id: 'reading', icon: '📚', label: 'Dyslexia or reading difficulty', phrase: 'I have dyslexia or find reading hard' },
    { id: 'sensory', icon: '🧩', label: 'Autistic or sensory sensitive', phrase: 'I am autistic or sensitive to light and noise' },
    { id: 'mental', icon: '💭', label: 'Anxiety or mental health', phrase: 'I live with anxiety or a mental health condition' },
    { id: 'speech', icon: '🗣️', label: 'Speech difficulty', phrase: 'I have difficulty speaking' }
  ],

  // Icons for the visit accommodations listed in knowledge.js.
  accIcons: {
    asl: '🤟', captions: '💬', quiet: '🤫', longer: '⏱️', table: '🛏️', lift: '🏋️',
    wheel: '♿', plain: '📝', large: '🔠', support: '🧑‍🤝‍🧑', animal: '🐕‍🦺', sensory: '💡'
  },

  // Settings for a list of feature ids, layered on top of whatever else is already set.
  settingsFor(ids, current) {
    const out = Object.assign({}, current, this.base);
    if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) out.rm = true;
    if (!ids.includes('plain') && ((current && current.needs) || []).includes('plain')) out.level = 0;
    for (const f of this.features) if (ids.includes(f.id)) Object.assign(out, f.set);
    out.needs = ids.slice();
    return out;
  },

  // Copy-ready text built from a profile. Every version can be pasted into any text box.
  pasteKit(p) {
    const K = window.PF_KNOWLEDGE;
    const conds = this.conditions.filter(c => (p.conditions || []).includes(c.id)).map(c => c.phrase);
    if (p.conditionsText) conds.push(p.conditionsText.trim());
    const accs = (K ? K.accommodations : []).filter(([k]) => (p.acc || []).includes(k)).map(([, l]) => l);
    const lower = s => s.charAt(0).toLowerCase() + s.slice(1);
    const web = this.features.filter(f => (p.needs || []).includes(f.id)).map(f => f.label);
    const contact = [p.phone, p.email].filter(Boolean).join(' or ');
    const kit = [];
    if (accs.length || p.accNotes) {
      kit.push({ id: 'short', title: 'One line', text: `Accessibility needs: ${accs.map(lower).join('; ')}${p.accNotes ? (accs.length ? '; ' : '') + p.accNotes.trim() : ''}.` });
    }
    if (conds.length || accs.length) {
      kit.push({
        id: 'full', title: 'Full paragraph',
        text: [
          conds.length ? `${conds.join('. ')}.` : '',
          accs.length ? `To take part fully in my care, I need: ${accs.map(lower).join(', ')}.` : '',
          p.accNotes ? p.accNotes.trim() : '',
          contact ? `The best way to reach me is ${contact}.` : ''
        ].filter(Boolean).join(' ')
      });
    }
    if (accs.length) kit.push({ id: 'list', title: 'As a list', text: accs.map(a => `• ${a}`).join('\n') });
    if (conds.length) kit.push({ id: 'conditions', title: 'My disabilities only', text: `${conds.join('. ')}.` });
    if (web.length) kit.push({ id: 'web', title: 'What helps me online', text: `When using websites I need: ${web.map(lower).join(', ')}.` });
    return kit;
  }
};
