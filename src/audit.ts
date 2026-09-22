import { chromium, type Browser, type BrowserContext } from 'playwright';
import { buildResult, type ResourceStat } from './attribute.js';
import { installCollector, readCollector, type RawData } from './collector.js';
import { GENERIC_SLOT_SELECTORS, NETWORKS } from './networks.js';
import type { AuditOptions, AuditResult } from './types.js';

const DEVICES = {
  mobile: {
    viewport: { width: 412, height: 915 },
    deviceScaleFactor: 2.625,
    isMobile: true,
    hasTouch: true,
    userAgent:
      'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Mobile Safari/537.36',
  },
  desktop: {
    viewport: { width: 1366, height: 768 },
    deviceScaleFactor: 1,
    isMobile: false,
    hasTouch: false,
    userAgent:
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  },
} as const;

/** Lighthouse's mobile defaults: slow 4G with a 4x CPU slowdown. */
const THROTTLE = {
  downloadThroughput: (1.6 * 1024 * 1024) / 8,
  uploadThroughput: (750 * 1024) / 8,
  latency: 150,
  cpuRate: 4,
};

export interface RunOptions extends AuditOptions {
  /** Emulate a slow connection and a slower CPU. Defaults to true. */
  throttle?: boolean;
}

export class BrowserMissingError extends Error {
  constructor(cause: string) {
    super(cause);
    this.name = 'BrowserMissingError';
  }
}

export async function audit(options: RunOptions): Promise<AuditResult> {
  const device = options.device ?? 'mobile';
  const wait = options.wait ?? 5000;
  const scroll = options.scroll ?? true;
  const throttle = options.throttle ?? true;
  const timeout = options.timeout ?? 45000;
  const report = options.onProgress ?? (() => {});
  const preset = DEVICES[device];

  let browser: Browser | undefined;
  let context: BrowserContext | undefined;

  try {
    report(`Launching Chromium (${device})`);
    try {
      browser = await chromium.launch({
        headless: !options.headed,
        channel: options.channel,
      });
    } catch (error) {
      throw new BrowserMissingError(error instanceof Error ? error.message : String(error));
    }

    context = await browser.newContext({
      viewport: preset.viewport,
      deviceScaleFactor: preset.deviceScaleFactor,
      isMobile: preset.isMobile,
      hasTouch: preset.hasTouch,
      userAgent: preset.userAgent,
    });

    const page = await context.newPage();
    await page.addInitScript(installCollector, {
      networks: NETWORKS.map((n) => ({ name: n.name, slotSelectors: n.slotSelectors })),
      genericSelectors: GENERIC_SLOT_SELECTORS,
    });

    const resources: ResourceStat[] = [];
    page.on('response', (response) => {
      const headers = response.headers();
      const size = Number(headers['content-length'] ?? 0);
      resources.push({ url: response.url(), bytes: Number.isFinite(size) ? size : 0 });
    });

    if (throttle) {
      report('Applying slow-4G and 4x CPU throttling');
      const session = await context.newCDPSession(page);
      await session.send('Network.enable');
      await session.send('Network.emulateNetworkConditions', {
        offline: false,
        latency: THROTTLE.latency,
        downloadThroughput: THROTTLE.downloadThroughput,
        uploadThroughput: THROTTLE.uploadThroughput,
      });
      await session.send('Emulation.setCPUThrottlingRate', { rate: THROTTLE.cpuRate });
    }

    report(`Loading ${options.url}`);
    await page.goto(options.url, { waitUntil: 'domcontentloaded', timeout });

    try {
      await page.waitForLoadState('networkidle', { timeout: Math.min(timeout, 15000) });
    } catch {
      report('Network stayed busy, continuing anyway');
    }

    if (scroll) {
      report('Scrolling to trigger lazily loaded slots');
      await autoScroll(page);
    }

    report(`Waiting ${wait}ms for ads to settle`);
    await page.waitForTimeout(wait);

    const raw = (await page.evaluate(readCollector)) as RawData;
    const finalUrl = page.url();

    report(`Collected ${raw.slots.length} slot(s) and ${raw.shifts.length} layout shift(s)`);

    return buildResult(raw, mergeResources(raw.resources, resources), {
      url: options.url,
      finalUrl,
      device,
      viewportHeight: preset.viewport.height,
    });
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }
}

/**
 * Resource Timing reports 0 bytes for cross-origin responses without
 * Timing-Allow-Origin, while content-length is missing on chunked responses.
 * Neither source is complete, so keep the larger figure per URL.
 */
function mergeResources(fromPage: ResourceStat[], fromNetwork: ResourceStat[]): ResourceStat[] {
  const merged = new Map<string, number>();
  for (const resource of [...fromPage, ...fromNetwork]) {
    merged.set(resource.url, Math.max(merged.get(resource.url) ?? 0, resource.bytes));
  }
  return [...merged].map(([url, bytes]) => ({ url, bytes }));
}

async function autoScroll(page: import('playwright').Page): Promise<void> {
  await page.evaluate(async () => {
    const step = Math.round(window.innerHeight * 0.8);
    const limit = Math.min(document.body.scrollHeight, window.innerHeight * 8);
    for (let y = 0; y < limit; y += step) {
      window.scrollTo(0, y);
      await new Promise((resolve) => setTimeout(resolve, 350));
    }
    window.scrollTo(0, 0);
    await new Promise((resolve) => setTimeout(resolve, 300));
  });
}
