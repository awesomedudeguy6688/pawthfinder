# Pawthfinder: a guide dog for medical websites

Hackathon prototype. An animated guide dog sits on top of a patient portal, reads the page, and leads the user through it. It doesn't assume any one disability.

- `index.html` is the pitch/landing page, with links to the three demo personas.
- `portal/` is **MyHealthLink**, a mock patient portal that is inaccessible on purpose: tiny mouse-only buttons, unlabeled fields, jargon, a hidden 4-minute session limit that erases your form, a mouse-only robot check, a scanned PDF, and a phone-only workflow.
- `pawthfinder/` is the "extension". It's written like a content script: it only reads and changes the portal's DOM and never calls portal code. The portal page loads it to stand in for an installed extension.

## Run it

No build step and no dependencies.

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

Voice input needs Chrome or Edge, and the page must be served from `localhost` or HTTPS for the microphone to work.

## Demo links

| Link | What it shows |
| --- | --- |
| `portal/?pf=0&reset=1` | The portal without Pawthfinder ("before") |
| `portal/?reset=1&mode=voice` | Sam: voice only |
| `portal/?reset=1&mode=cognitive` | Riley: plain language, one step at a time, big targets |
| `portal/?reset=1&mode=keyboard` | Alex: keyboard and screen reader |
| add `&session=45` | Makes the portal's timeout hit after 45 s, to demo the warning, keep-alive and restore |

Any username and password work. Goals the planner understands: booking an appointment (with a type of doctor), refilling a medicine, and understanding test results.

## What's in the prototype

| Skill | Status |
| --- | --- |
| Lead: goal → steps, highlighting, re-planning across pages | ✅ |
| Animated dog that walks to each step | ✅ |
| Translate: 3 reading levels, read aloud, summary, word list | ✅ |
| Stay close: presets plus voice, captions, large targets, high contrast, dyslexia font, reduced motion, sounds, vibration | ✅ |
| Sniff ahead: hazard scan on this page and ahead on the path, with fixes | ✅ (stretch) |
| Fetch: fill from an on-device profile, preview first, never passwords or consent | ✅ (stretch) |
| Speak up: accommodation letter, PDF and phone templates, printable card | ✅ (stretch) |
| Rest stops: save your place and answers, restore after a timeout | ✅ |

## Honest limits

- Page understanding and plain-language rewriting use rules and a hand-written glossary (`pawthfinder/knowledge.js`). That makes the demo offline and repeatable, but the task flows are written for MyHealthLink. The production design swaps in an LLM for unfamiliar portals.
- Everything is stored in `localStorage`. There is no server.
- Before pitching, check the disability statistic and its CDC link on the landing page.
