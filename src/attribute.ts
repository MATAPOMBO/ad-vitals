import type { RawData, RawSlot, RawSource } from './collector.js';
import { networkForHost } from './networks.js';
import type { AuditResult, Finding, NetworkReport, SlotReport } from './types.js';

export interface ResourceStat {
  url: string;
  bytes: number;
}

/**
 * A slot resize lands in the same frame as the shift it causes, but
 * ResizeObserver delivers asynchronously, so accept a window around the shift.
 */
const GROWTH_WINDOW_BEFORE = 600;
const GROWTH_WINDOW_AFTER = 200;

/** Google's "good" threshold for Cumulative Layout Shift. */
export const CLS_GOOD = 0.1;
/** Above this, CLS is rated "poor". */
export const CLS_POOR = 0.25;

interface SlotAccumulator extends SlotReport {
  viewportHeight: number;
}

function growthNear(slot: RawSlot, time: number): { delta: number; top: number } | null {
  let best: { delta: number; top: number } | null = null;
  for (let i = 1; i < slot.growthEvents.length; i++) {
    const prev = slot.growthEvents[i - 1];
    const cur = slot.growthEvents[i];
    if (!prev || !cur) continue;
    const [t, height, top] = cur;
    if (t < time - GROWTH_WINDOW_BEFORE || t > time + GROWTH_WINDOW_AFTER) continue;
    const delta = height - prev[1];
    if (delta <= 0) continue;
    if (!best || delta > best.delta) best = { delta, top };
  }
  return best;
}

/**
 * Find the ad slot that pushed a non-ad element down.
 *
 * The element moved down by `movement`; look for a slot that grew by roughly
 * that much, at roughly that moment, positioned above the element.
 */
function findPushingSlot(source: RawSource, shiftTime: number, slots: RawSlot[]): RawSlot | null {
  const movement = source.cur.top - source.prev.top;
  if (movement <= 0) return null;

  let best: { slot: RawSlot; error: number } | null = null;
  for (const slot of slots) {
    const growth = growthNear(slot, shiftTime);
    if (!growth) continue;
    // The slot has to sit above the content it pushed.
    if (growth.top > source.prev.top + 1) continue;
    const error = Math.abs(growth.delta - movement);
    const tolerance = Math.max(movement * 0.3, 30);
    if (error > tolerance) continue;
    if (!best || error < best.error) best = { slot, error };
  }
  return best ? best.slot : null;
}

export function buildResult(
  raw: RawData,
  resources: ResourceStat[],
  meta: { url: string; finalUrl: string; device: 'mobile' | 'desktop'; viewportHeight: number },
): AuditResult {
  const slotsById = new Map<string, SlotAccumulator>();
  for (const slot of raw.slots) {
    if (slotsById.has(slot.id)) continue;
    slotsById.set(slot.id, {
      id: slot.id,
      network: slot.network,
      selector: slot.selector,
      cls: 0,
      clsShare: 0,
      directShifts: 0,
      pushShifts: 0,
      initialHeight: round(slot.initialHeight, 0),
      finalHeight: round(slot.maxHeight, 0),
      growth: round(Math.max(0, slot.maxHeight - slot.initialHeight), 0),
      aboveTheFold: slot.top < meta.viewportHeight,
      filledAt: slot.firstFilled === null ? null : round(slot.firstFilled, 0),
      viewportHeight: meta.viewportHeight,
    });
  }

  let totalCls = 0;
  let adCls = 0;

  for (const shift of raw.shifts) {
    totalCls += shift.value;
    for (const source of shift.sources) {
      const contribution = shift.value * source.weight;
      let target: SlotAccumulator | undefined;
      let viaPush = false;

      if (source.slotId) {
        target = slotsById.get(source.slotId);
      } else {
        const pushing = findPushingSlot(source, shift.time, raw.slots);
        if (pushing) {
          target = slotsById.get(pushing.id);
          viaPush = true;
        }
      }

      if (!target) continue;
      target.cls += contribution;
      if (viaPush) target.pushShifts++;
      else target.directShifts++;
      adCls += contribution;
    }
  }

  const networks = new Map<string, NetworkReport>();
  function networkEntry(name: string): NetworkReport {
    let entry = networks.get(name);
    if (!entry) {
      entry = { name, bytes: 0, blockingMs: 0, requests: 0, cls: 0 };
      networks.set(name, entry);
    }
    return entry;
  }

  for (const resource of resources) {
    const host = safeHost(resource.url);
    if (!host) continue;
    const name = networkForHost(host);
    if (!name) continue;
    const entry = networkEntry(name);
    entry.bytes += resource.bytes;
    entry.requests++;
  }

  let adTbt = 0;
  for (const script of raw.scriptTimes) {
    const host = safeHost(script.url);
    if (!host) continue;
    const name = networkForHost(host);
    if (!name) continue;
    const entry = networkEntry(name);
    entry.blockingMs += script.duration;
    adTbt += script.duration;
  }

  const slots = [...slotsById.values()]
    .map((slot) => {
      const { viewportHeight: _drop, ...rest } = slot;
      return { ...rest, cls: round(slot.cls, 4), clsShare: totalCls > 0 ? round(slot.cls / totalCls, 4) : 0 };
    })
    .sort((a, b) => b.cls - a.cls);

  for (const slot of slots) {
    const entry = networks.get(slot.network);
    if (entry) entry.cls = round(entry.cls + slot.cls, 4);
  }

  const result: AuditResult = {
    url: meta.url,
    finalUrl: meta.finalUrl,
    device: meta.device,
    timestamp: new Date().toISOString(),
    totalCls: round(totalCls, 4),
    adCls: round(adCls, 4),
    contentCls: round(Math.max(0, totalCls - adCls), 4),
    lcp: raw.lcp === null ? null : round(raw.lcp, 0),
    tbt: round(raw.blockingTotal, 0),
    adTbt: round(adTbt, 0),
    slots,
    networks: [...networks.values()].sort((a, b) => b.blockingMs + b.bytes / 1000 - (a.blockingMs + a.bytes / 1000)),
    findings: [],
  };

  result.findings = buildFindings(result);
  return result;
}

function buildFindings(result: AuditResult): Finding[] {
  const findings: Finding[] = [];

  if (result.totalCls > CLS_POOR) {
    findings.push({
      severity: 'critical',
      title: `Page CLS is ${result.totalCls.toFixed(3)}, in the "poor" band`,
      detail:
        `Google rates CLS above ${CLS_POOR} as poor. Ads account for ${result.adCls.toFixed(3)} ` +
        `(${percent(result.adCls, result.totalCls)}) of it.`,
    });
  } else if (result.totalCls > CLS_GOOD) {
    findings.push({
      severity: 'warning',
      title: `Page CLS is ${result.totalCls.toFixed(3)}, above the "good" threshold of ${CLS_GOOD}`,
      detail: `Ads account for ${result.adCls.toFixed(3)} (${percent(result.adCls, result.totalCls)}) of it.`,
    });
  }

  for (const slot of result.slots) {
    if (slot.cls < 0.01) continue;
    const severity = slot.cls >= 0.05 ? 'critical' : 'warning';
    const reserved = slot.initialHeight >= slot.finalHeight - 5;
    findings.push({
      severity,
      slotId: slot.id,
      title: `Slot "${slot.id}" causes ${slot.cls.toFixed(3)} CLS`,
      detail: reserved
        ? `The slot reserved its space but still shifted ${slot.directShifts + slot.pushShifts} time(s).`
        : `The slot started at ${slot.initialHeight}px and grew to ${slot.finalHeight}px, ` +
          `pushing content down by ${slot.growth}px${slot.filledAt !== null ? ` at ${slot.filledAt}ms` : ''}.`,
      fix: reserved
        ? undefined
        : `Reserve the space before the ad loads:\n` +
          `  ${firstSelectorToken(slot.selector)} { min-height: ${slot.finalHeight}px; }\n` +
          `On responsive slots use aspect-ratio, or set min-height per breakpoint to the tallest creative you accept.`,
    });
  }

  if (result.adTbt > 200) {
    findings.push({
      severity: result.adTbt > 600 ? 'critical' : 'warning',
      title: `Ad scripts occupied the main thread for ${Math.round(result.adTbt)}ms`,
      detail:
        `That is ${percent(result.adTbt, Math.max(result.tbt, result.adTbt))} of the page's blocking time, ` +
        `spread across ${result.networks.filter((n) => n.blockingMs > 0).length} network(s). ` +
        `Main-thread congestion during load is the usual cause of poor INP.`,
      fix:
        `Defer bidder scripts until after first paint, drop bidders that rarely win, ` +
        `and load the ad library with async so it cannot block parsing.`,
    });
  }

  for (const network of result.networks) {
    if (network.blockingMs > 250) {
      findings.push({
        severity: network.blockingMs > 600 ? 'critical' : 'warning',
        title: `${network.name} scripts blocked the main thread for ${Math.round(network.blockingMs)}ms`,
        detail:
          `Long main-thread work delays interaction readiness and hurts INP. ` +
          `${network.name} made ${network.requests} request(s) totalling ${formatBytes(network.bytes)}.`,
        fix: `Load this network's tag with async/defer, and delay non-critical ad calls until after first paint.`,
      });
    }
  }

  const unreservedAboveFold = result.slots.filter((s) => s.aboveTheFold && s.growth > 50 && s.initialHeight < 10);
  for (const slot of unreservedAboveFold) {
    if (findings.some((f) => f.slotId === slot.id)) continue;
    findings.push({
      severity: 'info',
      slotId: slot.id,
      title: `Above-the-fold slot "${slot.id}" has no reserved height`,
      detail: `It grew ${slot.growth}px after load. It did not shift measurably this run, but it will on slower connections.`,
      fix: `${firstSelectorToken(slot.selector)} { min-height: ${slot.finalHeight}px; }`,
    });
  }

  if (findings.length === 0 && result.slots.length > 0) {
    findings.push({
      severity: 'info',
      title: 'No ad-attributed layout shift found',
      detail: `Found ${result.slots.length} ad slot(s), none of which shifted measurably during this run.`,
    });
  }

  return findings;
}

function firstSelectorToken(selector: string): string {
  const last = selector.split('>').pop()?.trim() || selector;
  return last;
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function percent(part: number, whole: number): string {
  if (whole <= 0) return '0%';
  return Math.round((part / whole) * 100) + '%';
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)}MB`;
}

function round(value: number, digits: number): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
