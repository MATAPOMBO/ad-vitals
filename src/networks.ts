/**
 * Signatures for identifying ad slots in the DOM and ad traffic on the wire.
 *
 * Slot selectors run inside the page, so they must be plain CSS that
 * `querySelectorAll` accepts. Order matters only for readability; a node
 * matched by several entries is attributed to the first match.
 */

export interface NetworkSignature {
  name: string;
  /** CSS selectors that identify an ad container for this network. */
  slotSelectors: string[];
  /** Hostname fragments that identify this network's requests. */
  hosts: string[];
}

export const NETWORKS: NetworkSignature[] = [
  {
    name: 'Google AdSense',
    slotSelectors: ['ins.adsbygoogle', '.adsbygoogle'],
    hosts: ['pagead2.googlesyndication.com', 'googleads.g.doubleclick.net', 'adservice.google.'],
  },
  {
    name: 'Google Ad Manager',
    slotSelectors: ['[id^="div-gpt-ad"]', '[data-google-query-id]', '[id^="gpt-"]'],
    hosts: ['securepubads.g.doubleclick.net', 'googletagservices.com', 'pubads.g.doubleclick.net'],
  },
  {
    name: 'Ezoic',
    slotSelectors: ['[id^="ezoic-pub-ad-"]', '.ezoic-ad', '[id^="ez-"]'],
    hosts: ['ezoic.net', 'ezojs.com', 'ezoic.com'],
  },
  {
    name: 'Mediavine',
    slotSelectors: ['[data-mediavine-slot]', '.mv-ad-box', '[id^="mediavine-"]', '.adunitwrapper'],
    hosts: ['scripts.mediavine.com', 'mediavine.com'],
  },
  {
    name: 'Raptive (AdThrive)',
    slotSelectors: ['.adthrive-ad', '[class*="adthrive"]', '[id^="AdThrive_"]'],
    hosts: ['adthrive.com', 'raptive.com'],
  },
  {
    name: 'Amazon Publisher Services',
    slotSelectors: ['[id^="amzn-assoc-ad"]'],
    hosts: ['amazon-adsystem.com', 'aax.amazon-adsystem.com'],
  },
  {
    name: 'Taboola',
    slotSelectors: ['[id^="taboola-"]', '.trc_rbox', '.trc_related_container'],
    hosts: ['taboola.com', 'taboolasyndication.com'],
  },
  {
    name: 'Outbrain',
    slotSelectors: ['.OUTBRAIN', '[data-widget-id]', '.ob-widget'],
    hosts: ['outbrain.com', 'outbrainimg.com'],
  },
  {
    name: 'Media.net',
    slotSelectors: ['[id^="cm-"]', '._mNDetails', '[id^="mNCC"]'],
    hosts: ['media.net', 'mnet-ad.net', 'mnetads.com'],
  },
  {
    name: 'Criteo',
    slotSelectors: ['[id^="crt-"]'],
    hosts: ['criteo.com', 'criteo.net'],
  },
  {
    name: 'Prebid',
    slotSelectors: ['[id*="prebid"]'],
    hosts: ['prebid.org'],
  },
  {
    name: 'Index Exchange',
    slotSelectors: [],
    hosts: ['casalemedia.com', 'indexww.com'],
  },
  {
    name: 'PubMatic',
    slotSelectors: [],
    hosts: ['pubmatic.com'],
  },
  {
    name: 'Magnite',
    slotSelectors: [],
    hosts: ['rubiconproject.com', 'magnite.com'],
  },
  {
    name: 'OpenX',
    slotSelectors: [],
    hosts: ['openx.net', 'openx.com'],
  },
  {
    name: 'Xandr',
    slotSelectors: [],
    hosts: ['adnxs.com', 'adnxs-simple.com'],
  },
  {
    name: 'Teads',
    slotSelectors: ['[id^="teads"]'],
    hosts: ['teads.tv'],
  },
  {
    name: 'TripleLift',
    slotSelectors: [],
    hosts: ['3lift.com'],
  },
  {
    name: 'Sharethrough',
    slotSelectors: [],
    hosts: ['sharethrough.com'],
  },
  {
    name: 'Sovrn',
    slotSelectors: [],
    hosts: ['lijit.com', 'sovrn.com'],
  },
  {
    name: 'GumGum',
    slotSelectors: [],
    hosts: ['gumgum.com'],
  },
  {
    name: 'Yieldmo',
    slotSelectors: [],
    hosts: ['yieldmo.com'],
  },
  {
    name: '33Across',
    slotSelectors: [],
    hosts: ['33across.com'],
  },
  {
    name: 'Smart AdServer',
    slotSelectors: [],
    hosts: ['smartadserver.com', 'sascdn.com'],
  },
  {
    name: 'Adform',
    slotSelectors: [],
    hosts: ['adform.net'],
  },
];

/** Generic containers that signal an ad without naming the network. */
export const GENERIC_SLOT_SELECTORS = [
  'iframe[src*="googlesyndication"]',
  'iframe[src*="doubleclick"]',
  'iframe[id^="google_ads_iframe"]',
  '[class^="ad-"]',
  '[class*=" ad-"]',
  '[id^="ad-"]',
  '[id^="ad_"]',
  '[class~="ad"]',
  '[class~="ads"]',
  '[class*="advert"]',
  '[id*="banner-ad"]',
  '[data-ad-slot]',
  '[data-ad-client]',
];

/** Resolve a request hostname to a network name, or null when it is not ad traffic. */
export function networkForHost(hostname: string): string | null {
  const host = hostname.toLowerCase();
  for (const net of NETWORKS) {
    for (const fragment of net.hosts) {
      if (host.includes(fragment)) return net.name;
    }
  }
  return null;
}
