# Worklog

Changes and problems, newest round first. Kept up to date while working.

## Round 4: performance agent

### Changes
- **`performance-optimizer` agent** (`.claude/agents/performance-optimizer.md`): measures, finds where the time goes, changes one thing at a time, and keeps a change only if the numbers improve and the persona tests still pass. No build tools, and no changes to behavior or looks.
- **`tests/perf.mjs`** (`npm run test:perf`): page-load and runtime measurements on a normal machine and a simulated slow device (4× CPU, 1.6 Mbps / 150 ms). Writes `tests/reports/perf-latest.md`.
- **Baseline, slow device:**
  - Portal with Pawthfinder: picker on screen after 1.24 s (load 1.06 s), 8 requests, 48.7 KB.
  - Other pages: load in 0.4–0.6 s.
  - While running: 346 ms of idle CPU per 10 s; goal → first step in 75 ms; page change → next step in 179 ms.
- **Likely targets** (for the agent to confirm):
  - The extension's scripts load one after another after the portal.
  - A 120 ms wait before reacting to page changes.
  - Timers that run every second, even when nothing changes.

### Problems
- None this round.

## Round 3: picker, accounts, test agent

### Changes
- **Session-start picker:** a full-screen dialog of 12 icon tiles ("I talk instead of typing", "Bigger text and buttons", "Plain, simple words", and so on) opens once per browser session. Choices are pre-picked from your account or your last session. Big-text, contrast, font and motion choices preview live. Has Read-this-to-me, keyboard focus trap, Escape to skip, and `?onboard=0` to skip it in tests.
- **Icons instead of checkboxes in the panel:** *Stay close* needs, *Translate* reading level, and *Speak up* visit accommodations are now icon tiles. Rarely used switches moved into "More options".
- **Shared catalog** in `pawthfinder/needs.js`: website needs (each turns on a bundle of settings), self-described disabilities, accommodation icons, and the paste-kit text builder. Presets (Voice, Simple & steady, Keyboard) are now built from it.
- **Accounts** (`account/`):
  - Accessible sign-in: large labeled fields, show-password, error summary that links to each field, big on/off button instead of a checkbox, no time limit, demo account button.
  - Five-step sign-up: about you → disabilities (optional) → website needs → appointment needs → review. Each step's heading gets focus. Choices are icon tiles, and the page changes look as you pick.
  - Profile page with the **paste kit**: copy-ready text (one line, full paragraph, list, disabilities only, website needs), each editable with its own Copy button. Also has "Change" links, sign-out, and delete.
  - Stored only on this device (localStorage). Passwords are salted and hashed with SHA-256. Prototype only, not real security.
- **Extension ↔ account:** the extension reads the signed-in account (name, contact, needs, accommodations). Fetch has "My needs, ready to paste", with "Put it in that box" and Copy. New voice command: "paste my needs". *Stay close* shows who's signed in.
- **Landing page:** Sign in / Make an account links.
- **Test agent:**
  - `tests/personas.mjs`: a Playwright and axe-core harness that plays Alex (keyboard and screen reader), Sam (voice), Riley (brain fog, follows the highlight, gets timed out, takes a rest stop) and Morgan (200% zoom, big text, contrast). Writes `tests/reports/latest.md`, `latest.json` and screenshots.
  - `.claude/agents/disabled-user-tester.md`: a Claude Code subagent that runs the harness, explores beyond it in character, and writes a prioritized findings report. Report only, no fixes.
  - `package.json` (`npm run test:personas`) and `.gitignore`.
- **Fixes from the first persona run:**
  - At 200% zoom the side panel left 243px for the website. Below 900px wide it now docks to the bottom as a sheet, and the dog stays above it.
  - Big-button mode now makes every panel control at least 44×44px.
  - "Fix labels and keyboard access" now also darkens the portal's faint text, which fixes axe color-contrast.
- **`visual-polish` agent** (`.claude/agents/visual-polish.md`): edits HTML and CSS only to make the site more appealing. It must keep contrast, focus rings, target sizes, zoom and reduced motion intact, must leave `portal/` ugly on purpose, and checks its work with screenshots and the persona tests.
- **Latest persona run:** all 5 journeys finish. 0 blockers, 0 major, 1 minor (12 picker tiles may be a lot on a brain-fog day). Left for the team as a design decision.

### Problems
- Codespace link: Claude here can't sign in to a github.dev Codespace. Work is shared through the GitHub repo instead (`git pull` in the Codespace).
- No browser on this machine at first. Installed Playwright's Chromium, then the missing system libraries (atk, X11, gbm, alsa…) with `dnf`.
- First harness run had false alarms from the harness itself: it read emoji icons as part of button names (screen readers skip them), looked for an option called "Dr", checked announcements too early, measured the new bottom panel as if it were a side panel, and searched for the wrong warning wording. All fixed in `tests/personas.mjs`.
- `/agents` no longer has a wizard in Claude Code. Agents are just files in `.claude/agents/`. Ask Claude to "use the disabled-user-tester agent" or "use the visual-polish agent".
- Headless Chromium crashed at random on some pages. Cause: the machine had **no fonts installed**. Fixed by installing DejaVu and Noto Emoji fonts (`dnf`). Teammates running the tests on a bare Linux box may hit the same thing.

## Round 2: GitHub

### Changes
- Committed the project and pushed it to `awesomedudeguy6688/NESTLE_HACKATHON` on `main`, on top of the existing placeholder commit (no force push).

### Problems
- No `gh` CLI. The only key on the machine was a deploy key for the workshop's own setup repo (`seaphu/workshop-ai-coding-hackathon`), which was the wrong place for this, so nothing was pushed there.
- `~/.ssh` is read-only, so the new deploy key lives in `~/.pawthfinder-git/`, and the repo's git config points to it.
- The first push was refused until the deploy key was added to the team repo with write access.

## Round 1: first build

### Changes
- `index.html` + `site.css`: pitch page covering why it matters, three demo personas, the seven skills, the "assist, don't replace" rules, and architecture.
- `portal/`: MyHealthLink, a mock patient portal that is inaccessible on purpose. Tiny mouse-only buttons, unlabeled fields, jargon, a hidden 4-minute sign-out that erases forms, a mouse-only robot check, a scanned PDF, a phone-only task. `?pf=0` shows it without Pawthfinder, `?session=N` shortens the timeout, `?reset=1` clears the demo.
- `pawthfinder/`: the overlay.
  - Animated SVG guide dog that walks to each step.
  - Lead: goal → steps, re-plans when you go off the path.
  - Sniff ahead: hazards on this page and further along the path.
  - Translate: three reading levels, read aloud, summary, word list.
  - Fetch: preview first, never passwords or consent.
  - Speak up: accommodation, PDF and phone letters, plus a printable card.
  - Stay close: modes and presets.
  - Voice commands, keyboard shortcuts, live announcements, rest stops, keep-alive, and restoring answers after a timeout.

### Problems
- No browser to test with, so the flows were tested in jsdom. jsdom gives `file://` pages no storage, so the site was served over HTTP for testing. The layout wasn't checked visually.
- Fixed during review: the dog's SVG head class clashed with the panel header class; the phrase "Pt" got rewritten inside a file name; the robot-check finder broke once ticked; speech cut off hazard warnings; the "Handled" state disappeared after a repair.
- Not verified: the CDC "1 in 4" statistic and link on the landing page.
