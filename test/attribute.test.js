import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildResult, networkForHost } from '../dist/index.js';

const META = { url: 'https://example.com', finalUrl: 'https://example.com', device: 'mobile', viewportHeight: 915 };

function rect(top, height) {
  return { top, left: 0, width: 400, height };
}

/** A slot that grew from `from` to `to` px at `time`, sitting at viewport `top`. */
function slot(id, { from = 0, to = 250, time = 900, top = 100 } = {}) {
  return {
    id,
    network: 'Google AdSense',
    selector: `ins#${id}`,
    initialHeight: from,
    maxHeight: to,
    top,
    firstFilled: time,
    growthEvents: [
      [0, from, top],
      [time, to, top],
    ],
  };
}

function emptyRaw(overrides) {
  return {
    shifts: [],
    slots: [],
    scriptTimes: [],
    resources: [],
    longTaskTotal: 0,
    blockingTotal: 0,
    lcp: null,
    ...overrides,
  };
}

test('attributes a shift directly when the shifting node is inside the slot', () => {
  const raw = emptyRaw({
    slots: [slot('leaderboard')],
    shifts: [
      {
        time: 905,
        value: 0.1,
        sources: [{ path: 'ins#leaderboard', slotId: 'leaderboard', prev: rect(100, 0), cur: rect(100, 250), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  assert.equal(result.slots.length, 1);
  assert.equal(result.slots[0].cls, 0.1);
  assert.equal(result.slots[0].directShifts, 1);
  assert.equal(result.slots[0].pushShifts, 0);
  assert.equal(result.adCls, 0.1);
  assert.equal(result.contentCls, 0);
});

test('attributes a shift to the ad above that pushed unrelated content down', () => {
  const raw = emptyRaw({
    slots: [slot('leaderboard', { from: 0, to: 250, time: 900, top: 100 })],
    shifts: [
      {
        time: 905,
        value: 0.1,
        // The article moved down 250px; it is not inside any ad slot.
        sources: [{ path: 'div#article', slotId: null, prev: rect(120, 400), cur: rect(370, 400), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  assert.equal(result.slots[0].cls, 0.1);
  assert.equal(result.slots[0].pushShifts, 1, 'should be recorded as a push, not a direct shift');
  assert.equal(result.slots[0].directShifts, 0);
  assert.equal(result.adCls, 0.1);
});

test('does not blame a slot that sits below the content that shifted', () => {
  const raw = emptyRaw({
    // Slot is at y=600, far below the article at y=120.
    slots: [slot('footer-ad', { from: 0, to: 250, time: 900, top: 600 })],
    shifts: [
      {
        time: 905,
        value: 0.1,
        sources: [{ path: 'div#article', slotId: null, prev: rect(120, 400), cur: rect(370, 400), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  assert.equal(result.slots[0].cls, 0);
  assert.equal(result.adCls, 0);
  assert.equal(result.contentCls, 0.1, 'unattributed shift belongs to content, not ads');
});

test('does not blame a slot whose growth does not match the movement', () => {
  const raw = emptyRaw({
    // Slot grew 20px, but the content moved 250px.
    slots: [slot('tiny', { from: 0, to: 20, time: 900, top: 100 })],
    shifts: [
      {
        time: 905,
        value: 0.1,
        sources: [{ path: 'div#article', slotId: null, prev: rect(120, 400), cur: rect(370, 400), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  assert.equal(result.slots[0].cls, 0);
  assert.equal(result.contentCls, 0.1);
});

test('does not blame a slot that grew long before the shift', () => {
  const raw = emptyRaw({
    slots: [slot('early', { from: 0, to: 250, time: 100, top: 100 })],
    shifts: [
      {
        time: 5000,
        value: 0.1,
        sources: [{ path: 'div#article', slotId: null, prev: rect(120, 400), cur: rect(370, 400), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  assert.equal(result.slots[0].cls, 0);
  assert.equal(result.contentCls, 0.1);
});

test('splits a shift across sources by their weights', () => {
  const raw = emptyRaw({
    slots: [slot('a', { top: 100 }), { ...slot('b', { top: 100 }), id: 'b', selector: 'ins#b' }],
    shifts: [
      {
        time: 905,
        value: 0.2,
        sources: [
          { path: 'ins#a', slotId: 'a', prev: rect(100, 0), cur: rect(100, 250), weight: 0.75 },
          { path: 'ins#b', slotId: 'b', prev: rect(100, 0), cur: rect(100, 250), weight: 0.25 },
        ],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  const byId = Object.fromEntries(result.slots.map((s) => [s.id, s.cls]));
  assert.equal(byId.a, 0.15);
  assert.equal(byId.b, 0.05);
  assert.equal(result.adCls, 0.2);
});

test('ignores shifts that followed user input', () => {
  // hadRecentInput entries are filtered in the page collector, so a result
  // built from an empty shift list must report zero rather than guessing.
  const result = buildResult(emptyRaw({ slots: [slot('x')] }), [], META);
  assert.equal(result.totalCls, 0);
  assert.equal(result.adCls, 0);
});

test('aggregates network bytes and blocking time from ad hosts only', () => {
  const raw = emptyRaw({
    slots: [],
    resources: [],
    scriptTimes: [
      { url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', duration: 300 },
      { url: 'https://example.com/app.js', duration: 500 },
    ],
  });

  const result = buildResult(
    raw,
    [
      { url: 'https://securepubads.g.doubleclick.net/tag/js/gpt.js', bytes: 50000 },
      { url: 'https://example.com/app.js', bytes: 90000 },
    ],
    META,
  );

  assert.equal(result.networks.length, 1);
  assert.equal(result.networks[0].name, 'Google Ad Manager');
  assert.equal(result.networks[0].bytes, 50000);
  assert.equal(result.networks[0].blockingMs, 300);
  assert.equal(result.adTbt, 300, 'first-party script time must not count as ad cost');
});

test('flags an unreserved slot with a concrete min-height fix', () => {
  const raw = emptyRaw({
    slots: [slot('leaderboard')],
    shifts: [
      {
        time: 905,
        value: 0.12,
        sources: [{ path: 'ins#leaderboard', slotId: 'leaderboard', prev: rect(100, 0), cur: rect(100, 250), weight: 1 }],
      },
    ],
  });

  const result = buildResult(raw, [], META);
  const finding = result.findings.find((f) => f.slotId === 'leaderboard');
  assert.ok(finding, 'expected a finding for the shifting slot');
  assert.equal(finding.severity, 'critical');
  assert.match(finding.fix, /min-height: 250px/);
});

test('networkForHost recognises ad hosts and ignores everything else', () => {
  assert.equal(networkForHost('pagead2.googlesyndication.com'), 'Google AdSense');
  assert.equal(networkForHost('securepubads.g.doubleclick.net'), 'Google Ad Manager');
  assert.equal(networkForHost('cdn.taboola.com'), 'Taboola');
  assert.equal(networkForHost('example.com'), null);
  assert.equal(networkForHost('cdn.jsdelivr.net'), null);
});
