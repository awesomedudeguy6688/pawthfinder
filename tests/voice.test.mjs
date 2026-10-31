// Unit tests for Pawthfinder's speech understanding (pawthfinder/voice.js).
//   npm run test:voice
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'pawthfinder/voice.js'), 'utf8'), sandbox);
const V = sandbox.PF_VOICE;

let pass = 0, fail = 0;
function check(label, got, want) {
  const ok = Object.entries(want).every(([k, v]) => JSON.stringify(got[k]) === JSON.stringify(v));
  if (ok) pass++; else { fail++; console.log(`✗ ${label}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(got)}`); }
}
const P = (said, want, ctx) => check(`“${said}”`, V.parse(said, ctx), want);

// Steps and help, said many ways.
for (const s of ['next', 'Next.', "what's next", 'what next', 'repeat that', 'say that again', 'pardon?', 'Pawthfinder, next step please', 'um, what should I do'])
  P(s, { type: 'step' });
for (const s of ['help', 'Help me', "I'm stuck", 'I am lost', "I don't know what to do", 'what can I say', 'how does this work', 'hey pawthfinder help', 'now what'])
  P(s, { type: 'help' });
P("I'm stuck", { type: 'help', stuck: true });
for (const s of ['do it', 'press it', 'click it', 'tap that', 'go ahead', 'can you press it for me', 'Pressed it', 'do it for me', 'that one'])
  P(s, { type: 'do-step' });
for (const s of ['show me', 'where is it', 'where do I click', 'point at it']) P(s, { type: 'show' });
for (const s of ['where am I', 'what page is this', "what's on this page"]) P(s, { type: 'where' });

// Pressing things by name.
P('click sign in', { type: 'click', name: 'sign in' });
P('Press the continue button', { type: 'click', name: 'continue' });
P('open appointments', { type: 'click', name: 'appointments' });
P('go to test results', { type: 'click', name: 'test results' });
P('take me to my medicines', { type: 'click', name: 'my medicines' });
P('could you please click on submit request', { type: 'click', name: 'submit request' });

// Number labels.
P('show numbers', { type: 'numbers-on' });
P('what can I click', { type: 'numbers-on' });
P('hide numbers', { type: 'numbers-off' });
P('click 5', { type: 'number', n: 5 });
P('number twelve', { type: 'number', n: 12 });
P('press number twenty one', { type: 'number', n: 21 });
P('seven', { type: 'number', n: 7 }, { numbersShown: true });
P('for', { type: 'number', n: 4 }, { numbersShown: true });
P('type hello in 3', { type: 'type', value: 'hello', n: 3 }, { numbersShown: true });

// Typing, spelling, dictation.
P('type jrivera', { type: 'type', value: 'jrivera' });
P('Type Follow-up visit for my heart.', { type: 'type', value: 'Follow-up visit for my heart' });
P('write 555 0100', { type: 'type', value: '555 0100' });
P('spell j r i v e r a', { type: 'type', value: 'jrivera', spelled: true });
P('spell capital j o r d a n at example dot com', { type: 'type', value: 'Jordan@example.com' });
P('spell x ray zulu papa four four eight', { type: 'type', value: 'xzp448' });
P('type my phone number', { type: 'type', fromProfile: 'phone number' });
P('enter my insurance id', { type: 'type', fromProfile: 'insurance id' });
P('put my email in the contact box', { type: 'type', fromProfile: 'email', field: 'contact' });
P('put 555 0100 in the phone box', { type: 'type', value: '555 0100', field: 'phone' }, { fieldNames: ['Phone number', 'Insurance member ID'] });
P('fill member ID with XZP448', { type: 'type', value: 'XZP448', field: 'member id' });
P('start dictation', { type: 'dictate-start' });
P('I want to dictate', { type: 'dictate-start' });
P('My heart has been racing at night', { type: 'dictate-text', value: 'My heart has been racing at night' }, { dictating: true });
P('new line', { type: 'dictate-text', value: '\n' }, { dictating: true });
P('stop dictation', { type: 'dictate-stop' }, { dictating: true });
P("that's all", { type: 'dictate-stop' }, { dictating: true });
P('clear it', { type: 'clear' });
P('delete that', { type: 'delete-word' });

// Choosing and ticking.
P('choose cardiology', { type: 'choose', value: 'cardiology' });
P('pick Dr Patel', { type: 'choose', value: 'dr patel' });
P("I'll take the first one", { type: 'choose', value: 'first' });
check('time “nine forty”', V.spokenTime('nine forty'), { exact: '09:40' });
check('time “9 40”', V.spokenTime('9 40'), { exact: '09:40' });
check('time “one pm”', V.spokenTime('one pm'), { exact: '13:00' });
check('time “three twenty p.m.”', V.spokenTime('three twenty p.m.'), { exact: '15:20' });
check('time “eleven o’clock”', V.spokenTime("eleven o'clock"), { exact: '11:00' });
check('time “seven oh five”', V.spokenTime('seven oh five'), { exact: '07:05' });
P('choose nine forty', { type: 'choose', time: { exact: '09:40', ambiguous: true, alt: '21:40' } });
P('tick it', { type: 'tick', on: true });
P('check the box', { type: 'tick', on: true });
P('take it', { type: 'tick', on: true });
P('I agree', { type: 'tick', on: true });
P('untick it', { type: 'tick', on: false });
P('what are the options', { type: 'options' });

// Moving around.
P('scroll down', { type: 'scroll', dir: 'down' });
P('down a bit', { type: 'scroll', dir: 'down' });
P('page up', { type: 'scroll', dir: 'up' });
P('go to the top', { type: 'scroll', dir: 'top' });
P('bottom of the page', { type: 'scroll', dir: 'bottom' });
P('go back', { type: 'back' });
P('take me home', { type: 'home' });
P('hide the panel', { type: 'panel', show: false });
P('open warnings', { type: 'tab', tab: 'sniff' });
P('settings', { type: 'tab', tab: 'settings' });
P('go to the fetch tab', { type: 'tab', tab: 'fetch' });

// Understanding.
P('read this', { type: 'read' });
P('read the page to me', { type: 'read' });
P('summarize', { type: 'summary' });
P("what's this page about", { type: 'summary' });
P('what does ABN mean', { type: 'explain', term: 'abn' });
P('explain deductible', { type: 'explain', term: 'deductible' });
P('what is an EOB', { type: 'explain', term: 'an eob' });
P('simpler', { type: 'setting', key: 'level', value: 'up' });
P("I don't understand these words", { type: 'setting', key: 'level', value: 'up' });
P('this is too complicated', { type: 'unknown' });
P('too complicated', { type: 'setting', key: 'level', value: 'up' });
P('show the original', { type: 'setting', key: 'level', value: 0 });

// Settings in everyday words.
P('bigger', { type: 'setting', key: 'large', value: true });
P('make the text bigger', { type: 'setting', key: 'large', value: true });
P("I can't see", { type: 'setting', key: 'large', value: true });
P('high contrast', { type: 'setting', key: 'hc', value: true });
P('read to me', { type: 'setting', key: 'speak', value: true });
P('slow down', { type: 'setting', key: 'rate', value: 'down' });
P('less movement', { type: 'setting', key: 'rm', value: true });
P("I'm overwhelmed", { type: 'setting', key: 'oneStep', value: true });
P('I need more time', { type: 'setting', key: 'keepAlive', value: true });
P('no sounds', { type: 'setting', key: 'sounds', value: false });

// Fetch, speak up, rest, cancel.
P('fill this page', { type: 'fill' });
P('fill it in for me', { type: 'fill' });
P('paste my needs', { type: 'paste' });
P('write my request', { type: 'letter' });
P('make my card', { type: 'card' });
P('take a break', { type: 'rest' });
P("I'm tired", { type: 'rest' });
P("I'm back", { type: 'resume' });
P('never mind', { type: 'cancel' });

// Questions.
P('when is my appointment', { type: 'ask', about: 'appointment' });
P('who is my doctor', { type: 'ask', about: 'doctor' });
P('what are my meds', { type: 'ask', about: 'meds' });
P('how long until I get logged out', { type: 'ask', about: 'time' });
P("I can't make phone calls", { type: 'ask', about: 'phone' });
P('I need a sign language interpreter', { type: 'ask', about: 'accommodation' });
P('is my information safe', { type: 'ask', about: 'privacy' });

// Stopping.
P('stop', { type: 'hush' });
P('shh', { type: 'hush' });
P('stop listening', { type: 'listen-off' });
P('goodbye', { type: 'listen-off' });

// Yes / no only when asked.
P('yes', { type: 'yes' }, { pending: true });
P('nope', { type: 'no' }, { pending: true });

// Session-start picker by voice.
const tiles = [{ id: 'large', names: ['Bigger text and buttons'] }, { id: 'plain', names: ['Plain, simple words'] }, { id: 'voice', names: ['I talk instead of typing'] }];
P('bigger text', { type: 'dialog-tile', id: 'large', on: true }, { dialogOpen: true, tiles });
P('pick plain words', { type: 'dialog-tile', id: 'plain', on: true }, { dialogOpen: true, tiles });
P('remove bigger text', { type: 'dialog-tile', id: 'large', on: false }, { dialogOpen: true, tiles });
P("I'm done", { type: 'dialog-start' }, { dialogOpen: true, tiles });
P('skip', { type: 'dialog-skip' }, { dialogOpen: true, tiles });

// Fuzzy matching forgives mishearings.
const labels = ['Sign In', 'Encounter Mgmt', 'Appointments', 'Rx Mgmt', 'Dx Results', 'Submit Request', 'Continue >>'];
const bm = s => V.bestMatch(s, labels.map(l => ({ names: [l] })));
check('fuzzy “sign it”', { name: bm('sign it').name }, { name: 'Sign In' });
check('fuzzy “encounter management”', { name: bm('encounter management').name }, { name: 'Encounter Mgmt' });
check('fuzzy “submit the request”', { name: bm('submit the request').name }, { name: 'Submit Request' });
const docs = ['PATEL, ANITA R MD FACC', 'OKONKWO, DAVID MD'].map(l => ({ names: [l] }));
check('fuzzy “dr patel”', { name: V.bestMatch('dr patel', docs).name, strong: V.bestMatch('dr patel', docs).score >= 0.8 }, { name: 'PATEL, ANITA R MD FACC', strong: true });
check('fuzzy “doctor okonkwo”', { name: V.bestMatch('doctor okonkwo', docs).name }, { name: 'OKONKWO, DAVID MD' });
check('fuzzy “appointment”', { name: bm('appointment').name }, { name: 'Appointments' });

// Choosing between alternatives the recogniser offers.
const pick = V.pickAlternative([{ transcript: 'click sign it', confidence: 0.6 }, { transcript: 'click sign in', confidence: 0.55 }], { labels });
check('alternatives prefer what’s on screen', { t: pick.transcript }, { t: 'click sign in' });
const pick2 = V.pickAlternative([{ transcript: 'necks', confidence: 0.5 }, { transcript: 'nets', confidence: 0.4 }], { labels });
check('alternatives: “necks” → next', { type: pick2.intent.type }, { type: 'step' });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
