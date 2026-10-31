# Performance run

Run on 2026-10-31 16:27 UTC, headless Chromium, cache off, gzip on. Medians of 3 runs. **Slow device** = 4× CPU slowdown + 1.6 Mbps / 150 ms network (roughly an older phone on weak mobile data).

## Page loads

| Profile | Page | First paint | Largest paint | Load | Ready* | Requests | Transferred | Script | Style + layout | Long tasks | Layout shift | DOM nodes |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Normal machine | Landing page | 112 ms | 112 ms | 66 ms | – | 3 | 7.4 KB | 2 ms | 34 ms | 0 ms | 0.019 | 209 |
| Normal machine | Sign in | 88 ms | 88 ms | 62 ms | – | 7 | 23.2 KB | 6 ms | 18 ms | 0 ms | 0.000 | 49 |
| Normal machine | Sign up | 104 ms | 96 ms | 75 ms | – | 7 | 23.9 KB | 6 ms | 21 ms | 0 ms | 0.000 | 226 |
| Normal machine | Portal without Pawthfinder | 72 ms | 72 ms | 41 ms | – | 3 | 7.5 KB | 4 ms | 14 ms | 0 ms | 0.059 | 24 |
| Normal machine | Portal with Pawthfinder | 92 ms | 200 ms | 111 ms | 179 ms | 8 | 48.7 KB | 29 ms | 51 ms | 0 ms | 0.162 | 457 |
| Slow device | Landing page | 596 ms | 596 ms | 553 ms | – | 3 | 7.4 KB | 7 ms | 165 ms | 115 ms | 0.019 | 209 |
| Slow device | Sign in | 588 ms | 588 ms | 576 ms | – | 7 | 23.2 KB | 15 ms | 79 ms | 32 ms | 0.000 | 49 |
| Slow device | Sign up | 620 ms | 620 ms | 635 ms | – | 7 | 23.9 KB | 37 ms | 99 ms | 62 ms | 0.000 | 226 |
| Slow device | Portal without Pawthfinder | 464 ms | 464 ms | 436 ms | – | 3 | 7.5 KB | 19 ms | 38 ms | 0 ms | 0.059 | 24 |
| Slow device | Portal with Pawthfinder | 500 ms | 1136 ms | 1057 ms | 1240 ms | 8 | 48.7 KB | 142 ms | 181 ms | 139 ms | 0.162 | 457 |

\* Ready = until the session-start picker is on screen.

## Running the app

| Profile | Idle CPU per 10 s | …of which script | Goal → first step shown | Page change → next step shown |
| --- | --- | --- | --- | --- |
| Normal machine | 52 ms | 6 ms | 22 ms | 132 ms |
| Slow device | 346 ms | 22 ms | 75 ms | 179 ms |

## What ships to the browser

| File | Size | Gzipped |
| --- | --- | --- |
| pawthfinder/pawthfinder.js | 91.2 KB | 28.1 KB |
| pawthfinder/pawthfinder.css | 23.3 KB | 5.6 KB |
| account/account.js | 17.6 KB | 5.7 KB |
| portal/portal.js | 14.1 KB | 5.1 KB |
| index.html | 10.2 KB | 3.9 KB |
| pawthfinder/knowledge.js | 7.9 KB | 3.3 KB |
| account/signup.html | 6.6 KB | 1.8 KB |
| account/account.css | 6.3 KB | 1.8 KB |
| site.css | 6.2 KB | 2.0 KB |
| pawthfinder/needs.js | 5.9 KB | 2.3 KB |
| portal/portal.css | 3.5 KB | 1.2 KB |
| account/profile.html | 2.8 KB | 1.1 KB |
| account/login.html | 2.8 KB | 1.1 KB |
| pawthfinder/dog.js | 2.6 KB | 1.0 KB |
| portal/index.html | 1.2 KB | 0.7 KB |
