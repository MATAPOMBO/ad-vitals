#!/usr/bin/env node
import { HELP, normalizeUrl, parseArgs, type ParsedArgs } from './args.js';
import { audit, BrowserMissingError } from './audit.js';
import { renderReport } from './report.js';

async function main(): Promise<number> {
  let args: ParsedArgs;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (error) {
    console.error(`${error instanceof Error ? error.message : error}\n${HELP}`);
    return 2;
  }

  if (args.version) {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    const pkg = JSON.parse(
      readFileSync(fileURLToPath(new URL('../package.json', import.meta.url)), 'utf8'),
    ) as { version: string };
    console.log(pkg.version);
    return 0;
  }

  if (args.help || !args.url) {
    console.log(HELP);
    return args.help ? 0 : 2;
  }

  try {
    const result = await audit({
      url: normalizeUrl(args.url),
      device: args.device,
      wait: args.wait,
      scroll: args.scroll,
      throttle: args.throttle,
      channel: args.channel,
      headed: args.headed,
      timeout: args.timeout,
      onProgress: args.json ? undefined : (message) => process.stderr.write(`  ${message}\n`),
    });

    if (args.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(renderReport(result));
    }

    if (args.budget !== undefined && result.adCls > args.budget) {
      console.error(
        `\nAd-attributed CLS ${result.adCls.toFixed(3)} exceeds budget ${args.budget.toFixed(3)}.`,
      );
      return 1;
    }
    return 0;
  } catch (error) {
    if (error instanceof BrowserMissingError) {
      console.error(
        'Could not launch Chromium.\n\n' +
          'Install the browser once with:\n' +
          '  npx playwright install chromium\n\n' +
          'Or reuse a browser you already have:\n' +
          '  npx ad-vitals <url> --channel chrome\n\n' +
          `Original error: ${error.message}`,
      );
      return 3;
    }
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

main().then(
  (code) => process.exit(code),
  (error) => {
    console.error(error);
    process.exit(1);
  },
);
