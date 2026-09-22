# Contributing

## The most useful contribution

**A URL where `ad-vitals` got it wrong.** Detection is signature-based, and the web has more ad setups than any one person can see. If the tool missed your slots, blamed the wrong one, or reported a network as `Unknown`, open an issue with:

- the URL
- the output you got (`npx ad-vitals <url> --json`)
- what you expected instead

That is worth more than a feature request, and it is how the signature list gets better.

## Adding an ad network

Everything about a network lives in one entry in [`src/networks.ts`](src/networks.ts):

```ts
{
  name: 'Your Network',
  slotSelectors: ['[id^="yournetwork-slot-"]'],
  hosts: ['yournetwork.com'],
}
```

- `slotSelectors` must be plain CSS that `querySelectorAll` accepts; they run inside the page.
- `hosts` are hostname fragments, matched with `includes`, so `yournetwork.com` also catches `cdn.yournetwork.com`.
- Prefer a selector that matches the **container** the ad expands inside, not the iframe within it. The container is what reserves space, so it is what the fix applies to.

Add a case to `networkForHost` in `test/attribute.test.js` and you are done.

## Development

```bash
npm install
npm run build
npm test
```

`npm run dev` watches and rebuilds.

Tests run against `dist/`, so build before testing. They are plain `node:test` with no framework.

### Testing attribution changes

Attribution logic lives in [`src/attribute.ts`](src/attribute.ts) and is a pure function over collected data, so it is tested without a browser. If you touch it, add cases in both directions: one proving the new attribution fires, and one proving it does **not** fire on a page where it shouldn't. False positives are worse than misses here — a publisher who removes the wrong ad unit loses revenue for nothing.

There is an end-to-end fixture in `test/fixtures/pushing-ad.html` with a known-correct answer: an unreserved AdSense slot that grows to 250px and pushes the article down. To run against it:

```bash
npx http-server test/fixtures -p 8899 &
node dist/cli.js http://127.0.0.1:8899/pushing-ad.html --no-throttle --wait 2500
```

All of the CLS should land on `slot-leaderboard`, counted as a push.

## Code style

No formatter is enforced. Match what is around you: no semicolon-free style, explicit types on exported functions, and comments only where the *why* is not obvious from the code.

## Conduct

Be decent to people. Harassment of any kind is not welcome here.
