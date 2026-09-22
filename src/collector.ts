import type { NetworkSignature } from './networks.js';

export interface CollectorConfig {
  networks: Array<Pick<NetworkSignature, 'name' | 'slotSelectors'>>;
  genericSelectors: string[];
}

export interface RawRect {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface RawSource {
  path: string;
  slotId: string | null;
  prev: RawRect;
  cur: RawRect;
  weight: number;
}

export interface RawShift {
  time: number;
  value: number;
  sources: RawSource[];
}

export interface RawSlot {
  id: string;
  network: string;
  selector: string;
  initialHeight: number;
  maxHeight: number;
  top: number;
  firstFilled: number | null;
  /** Height changes over time: [timestamp, height, viewportTop] triples. */
  growthEvents: Array<[number, number, number]>;
}

export interface RawScriptTime {
  url: string;
  duration: number;
}

export interface RawResource {
  url: string;
  bytes: number;
}

export interface RawData {
  shifts: RawShift[];
  slots: RawSlot[];
  scriptTimes: RawScriptTime[];
  resources: RawResource[];
  longTaskTotal: number;
  blockingTotal: number;
  lcp: number | null;
}

/**
 * Installed into the page before any site script runs. Everything here executes
 * in the browser, so it must not reference anything from module scope.
 */
export function installCollector(config: CollectorConfig): void {
  const w = window as unknown as Record<string, unknown>;
  if (w.__adVitals) return;

  const shifts: RawShift[] = [];
  const scriptTimes = new Map<string, number>();
  const slots = new Map<Element, RawSlot>();
  let longTaskTotal = 0;
  let blockingTotal = 0;
  let lcp: number | null = null;
  let counter = 0;

  const state = {
    shifts,
    slots,
    scriptTimes,
    get longTaskTotal() {
      return longTaskTotal;
    },
    get blockingTotal() {
      return blockingTotal;
    },
    get lcp() {
      return lcp;
    },
  };
  w.__adVitals = state;

  function cssPath(el: Element | null): string {
    if (!el || !(el instanceof Element)) return '(detached)';
    const parts: string[] = [];
    let node: Element | null = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 5) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += '#' + node.id;
        parts.unshift(part);
        break;
      }
      const cls = (node.getAttribute('class') || '').trim().split(/\s+/).filter(Boolean)[0];
      if (cls) part += '.' + cls;
      parts.unshift(part);
      node = node.parentElement;
      depth++;
    }
    return parts.join(' > ');
  }

  function matchNetwork(el: Element): { network: string; selector: string } | null {
    for (const net of config.networks) {
      for (const sel of net.slotSelectors) {
        try {
          if (el.matches(sel)) return { network: net.name, selector: sel };
        } catch {
          /* invalid selector in this browser, skip */
        }
      }
    }
    for (const sel of config.genericSelectors) {
      try {
        if (el.matches(sel)) return { network: 'Unknown', selector: sel };
      } catch {
        /* ignore */
      }
    }
    return null;
  }

  function slotIdFor(el: Element, network: string): string {
    if (el.id) return el.id;
    const dataSlot = el.getAttribute('data-ad-slot') || el.getAttribute('data-mediavine-slot');
    if (dataSlot) return network + ':' + dataSlot;
    counter++;
    return network.toLowerCase().replace(/\s+/g, '-') + '-' + counter;
  }

  const resizeObserver =
    typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver((entries) => {
          const now = performance.now();
          for (const entry of entries) {
            const slot = slots.get(entry.target);
            if (!slot) continue;
            const height = entry.contentRect.height;
            if (height > slot.maxHeight) slot.maxHeight = height;
            const last = slot.growthEvents[slot.growthEvents.length - 1];
            if (!last || Math.abs(last[1] - height) > 1) {
              slot.growthEvents.push([now, height, entry.target.getBoundingClientRect().top]);
            }
            if (slot.firstFilled === null && height > 1) slot.firstFilled = now;
          }
        })
      : null;

  function registerSlot(el: Element): void {
    if (slots.has(el)) return;
    const match = matchNetwork(el);
    if (!match) return;

    // Only one slot per nesting chain. A generic wrapper registered first must
    // give way to the network-specific element inside it, otherwise a slot that
    // ad-vitals could name precisely gets reported as "Unknown".
    for (const [known, record] of slots) {
      if (!known.contains(el) && !el.contains(known)) continue;
      const replacesGeneric = record.network === 'Unknown' && match.network !== 'Unknown' && known.contains(el);
      if (!replacesGeneric) return;
      slots.delete(known);
      resizeObserver?.unobserve(known);
      break;
    }
    const rect = el.getBoundingClientRect();
    const scrollY = window.scrollY || 0;
    const record: RawSlot = {
      id: slotIdFor(el, match.network),
      network: match.network,
      selector: cssPath(el),
      initialHeight: rect.height,
      maxHeight: rect.height,
      top: rect.top + scrollY,
      firstFilled: rect.height > 1 ? performance.now() : null,
      growthEvents: [[performance.now(), rect.height, rect.top]],
    };
    slots.set(el, record);
    resizeObserver?.observe(el);
  }

  function scanForSlots(root: ParentNode): void {
    const all: string[] = [];
    for (const net of config.networks) all.push(...net.slotSelectors);
    all.push(...config.genericSelectors);
    for (const sel of all) {
      let found: NodeListOf<Element>;
      try {
        found = root.querySelectorAll(sel);
      } catch {
        continue;
      }
      found.forEach(registerSlot);
    }
  }

  function findOwningSlot(node: Element | null): RawSlot | null {
    let el: Element | null = node;
    while (el) {
      const slot = slots.get(el);
      if (slot) return slot;
      el = el.parentElement;
    }
    return null;
  }

  function area(r: RawRect): number {
    return Math.max(0, r.width) * Math.max(0, r.height);
  }

  function toRect(r: DOMRectReadOnly | undefined): RawRect {
    if (!r) return { top: 0, left: 0, width: 0, height: 0 };
    return { top: r.top, left: r.left, width: r.width, height: r.height };
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<Record<string, unknown>>) {
        if (entry.hadRecentInput) continue;
        const rawSources = (entry.sources as unknown[]) || [];
        const sources: RawSource[] = [];
        let totalWeight = 0;

        for (const raw of rawSources) {
          const s = raw as { node?: Element | null; previousRect?: DOMRectReadOnly; currentRect?: DOMRectReadOnly };
          const prev = toRect(s.previousRect);
          const cur = toRect(s.currentRect);
          const distance = Math.max(Math.abs(cur.top - prev.top), Math.abs(cur.left - prev.left));
          const weight = Math.max(area(prev), area(cur)) * Math.max(distance, 1);
          totalWeight += weight;
          const owning = s.node ? findOwningSlot(s.node) : null;
          sources.push({
            path: cssPath(s.node ?? null),
            slotId: owning ? owning.id : null,
            prev,
            cur,
            weight,
          });
        }

        for (const s of sources) {
          s.weight = totalWeight > 0 ? s.weight / totalWeight : 1 / Math.max(sources.length, 1);
        }

        shifts.push({
          time: entry.startTime as number,
          value: entry.value as number,
          sources,
        });
      }
    }).observe({ type: 'layout-shift', buffered: true } as PerformanceObserverInit);
  } catch {
    /* layout-shift unsupported */
  }

  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskTotal += entry.duration;
        if (entry.duration > 50) blockingTotal += entry.duration - 50;
      }
    }).observe({ type: 'longtask', buffered: true } as PerformanceObserverInit);
  } catch {
    /* longtask unsupported */
  }

  // Long Animation Frames carry real script URLs, which `longtask` does not.
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries() as unknown as Array<Record<string, unknown>>) {
        const scripts = (entry.scripts as Array<Record<string, unknown>>) || [];
        for (const script of scripts) {
          const url = (script.sourceURL as string) || (script.invoker as string) || '';
          if (!url) continue;
          const duration = (script.duration as number) || 0;
          scriptTimes.set(url, (scriptTimes.get(url) || 0) + duration);
        }
      }
    }).observe({ type: 'long-animation-frame', buffered: true } as PerformanceObserverInit);
  } catch {
    /* LoAF unsupported before Chrome 123 */
  }

  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1];
      if (last) lcp = last.startTime;
    }).observe({ type: 'largest-contentful-paint', buffered: true } as PerformanceObserverInit);
  } catch {
    /* LCP unsupported */
  }

  const mutationObserver = new MutationObserver((records) => {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType !== 1) return;
        const el = node as Element;
        registerSlot(el);
        scanForSlots(el);
      });
    }
  });

  function start(): void {
    scanForSlots(document);
    mutationObserver.observe(document.documentElement, { childList: true, subtree: true });
  }

  if (document.documentElement) {
    start();
  } else {
    document.addEventListener('readystatechange', start, { once: true });
  }
}

/** Serializes collector state out of the page. Runs via page.evaluate. */
export function readCollector(): RawData {
  const w = window as unknown as Record<string, unknown>;
  const state = w.__adVitals as
    | {
        shifts: RawShift[];
        slots: Map<Element, RawSlot>;
        scriptTimes: Map<string, number>;
        longTaskTotal: number;
        blockingTotal: number;
        lcp: number | null;
      }
    | undefined;

  if (!state) {
    return { shifts: [], slots: [], scriptTimes: [], resources: [], longTaskTotal: 0, blockingTotal: 0, lcp: null };
  }

  const slots: RawSlot[] = [];
  state.slots.forEach((slot, el) => {
    const rect = el.getBoundingClientRect();
    if (rect.height > slot.maxHeight) slot.maxHeight = rect.height;
    slots.push(slot);
  });

  const scriptTimes: RawScriptTime[] = [];
  state.scriptTimes.forEach((duration, url) => scriptTimes.push({ url, duration }));

  // transferSize is the real compressed weight; content-length headers are often absent.
  const resources: RawResource[] = [];
  try {
    for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      resources.push({ url: entry.name, bytes: entry.transferSize || entry.encodedBodySize || 0 });
    }
  } catch {
    /* resource timing unavailable */
  }

  return {
    shifts: state.shifts,
    slots,
    scriptTimes,
    resources,
    longTaskTotal: state.longTaskTotal,
    blockingTotal: state.blockingTotal,
    lcp: state.lcp,
  };
}
