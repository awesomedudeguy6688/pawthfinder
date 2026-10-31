# Persona test run

Run on 2026-10-31 17:31 UTC with headless Chromium. Personas are simulated: keyboard and voice input are scripted, and “screen reader” means the accessibility tree and live-region announcements, not a real screen reader.

**0 blockers · 0 major · 1 minor**

## Journeys

| Journey | Finished? | Time | Notes |
| --- | --- | --- | --- |
| Automated WCAG scan of every page | ✅ | 7s | Portal problems found by axe: 4 without Pawthfinder, 0 with it. |
| Alex signs up and books a follow-up using only the keyboard | ✅ | 19s | Signed up with the keyboard only.<br>Copied from the paste kit: “I am blind or have low vision. The best way to reach me is alex1793467832433@example.com.…”<br>Picker opened with 2 choices already picked from Alex’s account.<br>16 keyboard actions; 37 screen-reader announcements. |
| Sam books a follow-up by voice only | ✅ | 11s | 17 spoken commands.<br>“choose first” → Tick the “I am not a robot” box.<br>“tick it” → Press “Submit Request”.<br>“press it” → Done! Your appointment request was sent. The clinic still has to appro |
| Riley follows the dog, gets timed out, takes a rest stop | ✅ | 49s | Picker shows 12 choices.<br>Waited 31 s on the form (the portal signs out after 30 s).<br>17 different instructions; longest 21 words; average grade 2.9.<br>Confirmation page at “Simplest”: 54 words, grade 6.9. |
| Morgan uses the app at 200% zoom with bigger text and strong contrast | ✅ | 3s | Had to scroll to find Start in the picker.<br>Panel docks at the bottom (207px of 450px tall); 54% of the view is left for the website. |

## Findings

| # | Severity | Persona | Where | What happened | Expected | Evidence |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | minor | Riley | Session-start picker | 12 choices on one screen is a lot on a brain-fog day | A short first screen, with “more choices” for the rest |  |

## Automated scan detail

- **Landing page:** no violations
- **Sign in:** no violations
- **Sign up: step 1:** no violations
- **Session-start picker:** no violations
- **Pawthfinder panel:** no violations
- **Portal after Pawthfinder repairs:** no violations
- **Portal without Pawthfinder (baseline):** color-contrast (serious, 4)
- **Panel, strong contrast:** no violations
