# Performance run

Run on 2026-10-31 17:18 UTC, headless Chromium, cache off, gzip on. Medians of 3 runs. **Slow device** = 4× CPU slowdown + 1.6 Mbps / 150 ms network (roughly an older phone on weak mobile data).

## Page loads

| Profile | Page | First paint | Largest paint | Load | Ready* | Requests | Transferred | Script | Style + layout | Long tasks | Layout shift | DOM nodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Normal machine | Landing page | 140 ms | 140 ms | 77 ms | – | 3 | 8.6 KB | 3 ms | 41 ms | 0 ms | 0.019 | 209 |
| Normal machine | Sign in | 120 ms | 120 ms | 81 ms | – | 7 | 25.9 KB | 5 ms | 25 ms | 0 ms | 0.000 | 49 |
| Normal machine | Sign up | 132 ms | 0 ms | 81 ms | – | 7 | 26.6 KB | 7 ms | 26 ms | 0 ms | 0.000 | 226 |
| Normal machine | Portal without Pawthfinder | 72 ms | 72 ms | 46 ms | – | 3 | 7.6 KB | 7 ms | 16 ms | 0 ms | 0.059 | 25 |
| Normal machine | Portal with Pawthfinder | 116 ms | 264 ms | 137 ms | 239 ms | 9 | 67.3 KB | 40 ms | 74 ms | 0 ms | 0.162 | 472 |
| Slow device | Landing page | 636 ms | 636 ms | 573 ms | – | 3 | 8.6 KB | 6 ms | 162 ms | 134 ms | 0.000 | 209 |
| Slow device | Sign in | 636 ms | 636 ms | 622 ms | – | 7 | 25.9 KB | 17 ms | 86 ms | 57 ms | 0.000 | 49 |
| Slow device | Sign up | 692 ms | 692 ms | 677 ms | – | 7 | 26.6 KB | 37 ms | 130 ms | 86 ms | 0.000 | 226 |
| Slow device | Portal without Pawthfinder | 452 ms | 452 ms | 407 ms | – | 3 | 7.6 KB | 18 ms | 28 ms | 0 ms | 0.059 | 25 |
| Slow device | Portal with Pawthfinder | 468 ms | 1036 ms | 957 ms | 1185 ms | 9 | 67.3 KB | 115 ms | 196 ms | 125 ms | 0.162 | 472 |

\* Ready = until the session-start picker is on screen.

## Running the app

| Profile | Idle CPU per 10 s | …of which script | Goal → first step shown | Page change → next step shown |
| --- | --- | --- | --- | --- |
| Normal machine | 40 ms | 3 ms | 15 ms | 38 ms |
| Slow device | 274 ms | 14 ms | 78 ms | 59 ms |

## What ships to the browser

| File | Size | Gzipped |
| --- | --- | --- |
| pawthfinder/pawthfinder.js | 116.0 KB | 35.6 KB |
| pawthfinder/voice.js | 26.9 KB | 9.7 KB |
| pawthfinder/pawthfinder.css | 26.7 KB | 6.5 KB |
| account/account.js | 17.7 KB | 5.7 KB |
| portal/portal.js | 14.1 KB | 5.1 KB |
| site.css | 10.3 KB | 3.1 KB |
| index.html | 10.2 KB | 3.9 KB |
| account/account.css | 9.0 KB | 2.5 KB |
| pawthfinder/knowledge.js | 7.9 KB | 3.3 KB |
| account/signup.html | 6.6 KB | 1.8 KB |
| pawthfinder/needs.js | 5.9 KB | 2.3 KB |
| portal/portal.css | 3.5 KB | 1.2 KB |
| account/profile.html | 2.8 KB | 1.1 KB |
| account/login.html | 2.8 KB | 1.1 KB |
| pawthfinder/dog.js | 2.6 KB | 1.0 KB |
| portal/index.html | 2.0 KB | 0.8 KB |
