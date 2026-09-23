# ad-vitals

**Find out which ad slot is costing you Core Web Vitals — and how much.**

Publishers live with a conflict: the ads that pay for the site are the same ads that wreck its Core Web Vitals, and wrecked Core Web Vitals cost search rankings. Every tool will tell you *that* your CLS is bad. None of them tell you *which ad slot did it*.

`ad-vitals` loads your page in a real throttled Chromium, watches every ad slot, and attributes each layout shift back to the slot that caused it.

```
npx ad-vitals yoursite.com
```

## The problem this solves

When an ad loads late and expands, the element that Chrome records as "shifted" is almost never the ad — it is the article text that got pushed down. So Lighthouse hands you this:

```
Avoid large layout shifts
  div#article-body        0.105
```

Which is true and useless. `#article-body` is not the problem; it is the victim. `ad-vitals` correlates slot growth with the shift it caused and reports the culprit instead:

```
  CLS  0.105 (needs improvement)   ads 0.105   content 0.000
  TBT  0ms   from ad scripts 0ms   LCP  836ms

  Ad slots by CLS impact

  0.105  ████████████████████████  slot-leaderboard
         Google AdSense · ins#slot-leaderboard · 0px → 250px · 1 pushed content

  Findings

  ✖ Slot "slot-leaderboard" causes 0.105 CLS
     The slot started at 0px and grew to 250px, pushing content down by 250px at 909ms.
     Reserve the space before the ad loads:
       ins#slot-leaderboard { min-height: 250px; }
     On responsive slots use aspect-ratio, or set min-height per breakpoint to the tallest creative you accept.
```

That is a fix you can paste.

## Install

Requires Node 20+ (Playwright's minimum).

```bash
npx ad-vitals yoursite.com
```

The first run needs a browser. Either let Playwright fetch one:

```bash
npx playwright install chromium
```

…or reuse the Chrome you already have:

```bash
npx ad-vitals yoursite.com --channel chrome
```

To use it as a library: `npm install ad-vitals`.

## Usage

```
npx ad-vitals <url> [options]

  --device <mobile|desktop>   Device to emulate. Default: mobile
  --budget <number>           Exit 1 when ad-attributed CLS exceeds this
  --json                      Machine-readable output
  --wait <ms>                 Time to wait after load for ads to settle. Default: 5000
  --no-scroll                 Only audit slots present at load
  --no-throttle               Audit at full speed instead of slow 4G with 4x CPU slowdown
  --channel <name>            Use an installed browser, e.g. --channel chrome
  --headed                    Show the browser window
  --timeout <ms>              Navigation timeout. Default: 45000
```

By default the audit runs as **mobile on slow 4G with a 4x CPU slowdown**, matching Lighthouse's mobile profile. That is deliberate: on a fast desktop connection the ad arrives before first paint and nothing shifts, which is exactly how publishers convince themselves they have no problem. Real users are on phones.

### Catching regressions in CI

`--budget` turns the audit into a gate, so a new ad unit cannot quietly cost you a ranking:

```bash
npx ad-vitals https://yoursite.com --budget 0.05
```

Exit codes: `0` pass, `1` over budget, `2` bad arguments, `3` browser missing, `4` page unreachable.

### GitHub Action

```yaml
- uses: MATAPOMBO/ad-vitals@v0
  with:
    url: https://yoursite.com
    budget: '0.05'
```

### As a library

```js
import { audit } from 'ad-vitals';

const result = await audit({ url: 'https://yoursite.com', device: 'mobile' });

for (const slot of result.slots) {
  console.log(slot.id, slot.network, slot.cls);
}
```

## How attribution works

Two mechanisms, both running in a `PerformanceObserver` installed before any site script.

**Direct.** The shifted node is inside a known ad container, so the shift is that slot's own doing.

**Push.** The shifted node is ordinary content. `ad-vitals` looks for an ad slot that:

1. grew in height within 600ms before the shift,
2. sits **above** the shifted element, and
3. grew by roughly the distance the element moved (within 30%, or 30px).

The best match takes the blame. This is a heuristic, not a browser-reported fact — the layout-shift API does not expose causality. It is deliberately conservative: when no slot fits all three conditions, the shift is reported as `content` CLS rather than guessed onto an ad. The test suite pins the cases where it must *not* fire — a slot below the content, a slot whose growth does not match, a slot that grew too early.

A single shift is split across its sources by area and distance moved, so one slot cannot absorb the blame for a shift it only partly caused.

**Script cost** comes from [Long Animation Frames](https://developer.chrome.com/docs/web-platform/long-animation-frames), which report real script URLs, so main-thread time is attributed per ad network instead of lumped into "third-party JavaScript". Requires Chrome 123+; on older browsers the per-network breakdown is empty while CLS attribution still works.

## Limitations

Worth knowing before you trust a number:

- **One load, one page.** Ad auctions are non-deterministic; a slot that wins a 250px creative on one run may get a 90px one on the next. Run it a few times, and treat it as a diagnostic rather than a benchmark.
- **Push attribution is inference.** See above. It can miss, and it can occasionally blame a neighbouring slot that grew at the same moment.
- **Detection is signature-based.** A slot whose markup matches none of the [known signatures](src/networks.ts) is invisible. If your ads are missed, please [open an issue](https://github.com/MATAPOMBO/ad-vitals/issues) with the URL — that is the single most useful contribution to this project.
- **No consent-gated ads.** If your CMP blocks ads until consent, the audit sees an empty page. Consent automation is on the roadmap.
- **Lab, not field.** This tells you what your page does on one throttled device. It does not replace CrUX field data.

## Supported networks

AdSense, Google Ad Manager (GPT), Ezoic, Mediavine, Raptive (AdThrive), Amazon Publisher Services, Taboola, Outbrain, Media.net, Criteo, Prebid, Index Exchange, PubMatic, Magnite, OpenX, Xandr, Teads, TripleLift, Sharethrough, Sovrn, GumGum, Yieldmo, 33Across, Smart AdServer, Adform.

Unrecognised ad containers still get caught by generic signatures and reported as `Unknown`.

Adding a network is a small, self-contained change in [`src/networks.ts`](src/networks.ts) — a good first contribution.

## Contributing

Issues with a real URL where detection or attribution got it wrong are the most valuable thing you can send. See [CONTRIBUTING.md](CONTRIBUTING.md).

```bash
npm install
npm run build
npm test
```

## License

MIT
