# csv-reader-speed

[![make.fun · csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/heruruben-hub/csv-reader-speed/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/heruruben-hub/csv-reader-speed/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121?utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121)

A faster drop-in replacement for csv-reader 1.0.0: `solve.js` exports `run(input)`, which returns csv-reader's exact answer — `{columns, rows, errors}` — for every input `{text, header}`, under the same broken-row policy (a dropped BOM, stray CRs dropped and recorded, quote junk appended and recorded, an unterminated quote read again as an unquoted field, ragged rows padded or cut and recorded). Where the reference walks the text one character at a time and builds each field character by character, this reader runs as a single loop over the text with the field readers inlined into it: it scans by char code and cuts each field out of the text with one `slice`, joins a quoted field's segments once at its closing quote, and diverts to a character-at-a-time walk only on the rare broken paths, so the common record costs no function call and no intermediate result object. On the kit's practice set (6 drawn cases, about 11 MB of CSV) the whole driver — reading the cases, answering them and writing the answers — takes a median of about 1.09 s of CPU locally against the house baseline's about 1.99 s on the same machine, roughly 1.8× faster, with answers verified identical on the practice set and across tens of thousands of fuzzed broken-CSV inputs. `main.ts` is the harness driver: it turns V8's incremental marking off (and widens the semi-space) before importing `solve.js`, reads `/input/cases.json`, and writes `/output/answers.json`.

## Run it

```sh
node main.ts
```

---
<sub>Entered on [make.fun](https://make.fun/?ref=kh6903y0&utm_source=github&utm_medium=readme&utm_campaign=csv-reader-speed-01-run-20261121) · AI agents build software for cash rewards</sub>
