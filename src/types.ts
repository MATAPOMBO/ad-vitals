export interface SlotReport {
  /** Stable identifier for the slot: element id, ad unit path, or generated path. */
  id: string;
  /** Ad network that owns the slot, e.g. "Google AdSense". */
  network: string;
  /** CSS-ish path to the element, for pointing a human at the right DOM node. */
  selector: string;
  /** CLS attributed to this slot, summed across the run. */
  cls: number;
  /** How much of the page's total CLS this slot is responsible for, 0..1. */
  clsShare: number;
  /** Shifts caused by the slot's own box resizing. */
  directShifts: number;
  /** Shifts caused by other content being pushed when this slot grew. */
  pushShifts: number;
  /** Slot box height before any ad filled it, in CSS pixels. */
  initialHeight: number;
  /** Largest height the slot reached during the run, in CSS pixels. */
  finalHeight: number;
  /** finalHeight - initialHeight: the unreserved space that caused the damage. */
  growth: number;
  /** True when the slot sits within the initial viewport. */
  aboveTheFold: boolean;
  /** Milliseconds from navigation start until the slot first rendered content. */
  filledAt: number | null;
}

export interface NetworkReport {
  name: string;
  /** Total bytes transferred by this network's resources. */
  bytes: number;
  /** Total main-thread time in long tasks attributed to this network. */
  blockingMs: number;
  /** Number of network requests made. */
  requests: number;
  /** CLS summed across all slots owned by this network. */
  cls: number;
}

export interface Finding {
  severity: 'critical' | 'warning' | 'info';
  slotId?: string;
  title: string;
  detail: string;
  /** Concrete CSS or config change that would fix it. */
  fix?: string;
}

export interface AuditResult {
  url: string;
  finalUrl: string;
  device: 'mobile' | 'desktop';
  timestamp: string;
  /** Total CLS for the page, ad-related or not. */
  totalCls: number;
  /** Portion of totalCls that ad-vitals could attribute to an ad slot. */
  adCls: number;
  /** Portion of totalCls with no ad involvement. */
  contentCls: number;
  /** Largest Contentful Paint in ms, null when not observed. */
  lcp: number | null;
  /** Total Blocking Time in ms, measured from long tasks. */
  tbt: number;
  /** Total blocking time attributable to ad network scripts. */
  adTbt: number;
  slots: SlotReport[];
  networks: NetworkReport[];
  findings: Finding[];
}

export interface AuditOptions {
  url: string;
  device?: 'mobile' | 'desktop';
  /** How long to sit on the page after load, letting lazy ads fill. Milliseconds. */
  wait?: number;
  /** Scroll the page to trigger lazily loaded ad slots. */
  scroll?: boolean;
  /** Playwright browser channel, e.g. "chrome" to use installed Chrome. */
  channel?: string;
  /** Show the browser window. */
  headed?: boolean;
  /** Extra time allowed for navigation, milliseconds. */
  timeout?: number;
  /** Called with human-readable progress updates. */
  onProgress?: (message: string) => void;
}
