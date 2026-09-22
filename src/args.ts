export interface ParsedArgs {
  url?: string;
  device: 'mobile' | 'desktop';
  budget?: number;
  json: boolean;
  wait?: number;
  scroll: boolean;
  throttle: boolean;
  channel?: string;
  headed: boolean;
  timeout?: number;
  help: boolean;
  version: boolean;
}

export const HELP = `
ad-vitals — find which ad slot is costing you Core Web Vitals

Usage
  npx ad-vitals <url> [options]

Options
  --device <mobile|desktop>   Device to emulate. Default: mobile
  --budget <number>           Fail with exit code 1 when ad-attributed CLS exceeds this
  --json                      Print machine-readable JSON instead of a report
  --wait <ms>                 Time to wait after load for ads to settle. Default: 5000
  --no-scroll                 Do not scroll; only audit slots present at load
  --no-throttle               Audit at full speed instead of slow 4G with 4x CPU slowdown
  --channel <name>            Use an installed browser, e.g. --channel chrome
  --headed                    Show the browser window
  --timeout <ms>              Navigation timeout. Default: 45000
  -h, --help                  Show this help
  -v, --version               Show version

Examples
  npx ad-vitals example.com
  npx ad-vitals example.com --device desktop --json > report.json
  npx ad-vitals example.com --budget 0.05      # for CI
`;

export function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    device: 'mobile',
    json: false,
    scroll: true,
    throttle: true,
    headed: false,
    help: false,
    version: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === undefined) continue;
    const next = () => {
      const value = argv[++i];
      if (value === undefined) throw new Error(`Option ${arg} needs a value`);
      return value;
    };

    switch (arg) {
      case '-h':
      case '--help':
        parsed.help = true;
        break;
      case '-v':
      case '--version':
        parsed.version = true;
        break;
      case '--json':
        parsed.json = true;
        break;
      case '--no-scroll':
        parsed.scroll = false;
        break;
      case '--no-throttle':
        parsed.throttle = false;
        break;
      case '--headed':
        parsed.headed = true;
        break;
      case '--device': {
        const value = next();
        if (value !== 'mobile' && value !== 'desktop') {
          throw new Error(`--device must be "mobile" or "desktop", got "${value}"`);
        }
        parsed.device = value;
        break;
      }
      case '--budget':
        parsed.budget = numeric(next(), '--budget');
        break;
      case '--wait':
        parsed.wait = numeric(next(), '--wait');
        break;
      case '--timeout':
        parsed.timeout = numeric(next(), '--timeout');
        break;
      case '--channel':
        parsed.channel = next();
        break;
      default:
        if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}`);
        if (!parsed.url) parsed.url = arg;
        break;
    }
  }

  return parsed;
}

function numeric(value: string, flag: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${flag} must be a number, got "${value}"`);
  return parsed;
}

export function normalizeUrl(input: string): string {
  if (/^https?:\/\//i.test(input)) return input;
  return `https://${input}`;
}
