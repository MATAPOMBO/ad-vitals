import { CLS_GOOD, CLS_POOR, formatBytes } from './attribute.js';
import type { AuditResult, Finding } from './types.js';

const useColor = process.env.NO_COLOR === undefined && process.stdout.isTTY !== false;

const paint = (code: string) => (text: string) => (useColor ? `[${code}m${text}[0m` : text);
const bold = paint('1');
const dim = paint('2');
const red = paint('31');
const yellow = paint('33');
const green = paint('32');
const cyan = paint('36');

function clsColor(value: number): (text: string) => string {
  if (value > CLS_POOR) return red;
  if (value > CLS_GOOD) return yellow;
  return green;
}

function bar(share: number, width = 24): string {
  const filled = Math.max(0, Math.min(width, Math.round(share * width)));
  return '█'.repeat(filled) + dim('░'.repeat(width - filled));
}

export function renderReport(result: AuditResult): string {
  const lines: string[] = [];
  const out = (text = '') => lines.push(text);

  out();
  out(bold(`ad-vitals  ${result.finalUrl}`));
  out(dim(`${result.device} · slow 4G · ${new Date(result.timestamp).toLocaleString()}`));
  out();

  const rate = result.totalCls > CLS_POOR ? 'poor' : result.totalCls > CLS_GOOD ? 'needs improvement' : 'good';
  out(
    `  ${bold('CLS')}  ${clsColor(result.totalCls)(result.totalCls.toFixed(3))} ${dim(`(${rate})`)}` +
      `   ${dim('ads')} ${clsColor(result.adCls)(result.adCls.toFixed(3))}` +
      `   ${dim('content')} ${result.contentCls.toFixed(3)}`,
  );
  out(
    `  ${bold('TBT')}  ${result.tbt}ms` +
      `   ${dim('from ad scripts')} ${result.adTbt}ms` +
      (result.lcp !== null ? `   ${bold('LCP')}  ${result.lcp}ms` : ''),
  );
  out();

  if (result.slots.length === 0) {
    out(dim('  No ad slots detected. If this page does serve ads, please open an issue with the URL'));
    out(dim('  so the detection signatures can be improved.'));
    out();
    return lines.join('\n');
  }

  out(bold(`  Ad slots by CLS impact`));
  out();
  const shifting = result.slots.filter((s) => s.cls > 0);
  const quiet = result.slots.length - shifting.length;

  for (const slot of shifting) {
    const share = result.totalCls > 0 ? slot.cls / result.totalCls : 0;
    out(`  ${clsColor(slot.cls)(slot.cls.toFixed(3))}  ${bar(share)}  ${bold(slot.id)}`);
    const via: string[] = [];
    if (slot.directShifts) via.push(`${slot.directShifts} own`);
    if (slot.pushShifts) via.push(`${slot.pushShifts} pushed content`);
    out(
      dim(
        `         ${slot.network} · ${slot.selector} · ${slot.initialHeight}px → ${slot.finalHeight}px` +
          (via.length ? ` · ${via.join(', ')}` : ''),
      ),
    );
    out();
  }

  if (quiet > 0) {
    out(dim(`  ${quiet} other slot(s) detected with no measurable shift.`));
    out();
  }

  if (result.networks.length > 0) {
    out(bold('  Ad network cost'));
    out();
    for (const network of result.networks) {
      out(
        `  ${network.name.padEnd(28)} ${String(Math.round(network.blockingMs) + 'ms').padStart(7)} ${dim('main thread')}` +
          `  ${formatBytes(network.bytes).padStart(8)}  ${dim(`${network.requests} req`)}`,
      );
    }
    out();
  }

  if (result.findings.length > 0) {
    out(bold('  Findings'));
    out();
    for (const finding of result.findings) out(renderFinding(finding));
  }

  return lines.join('\n');
}

function renderFinding(finding: Finding): string {
  const marker =
    finding.severity === 'critical' ? red('  ✖') : finding.severity === 'warning' ? yellow('  ▲') : cyan('  ●');
  const parts = [`${marker} ${bold(finding.title)}`, `     ${finding.detail}`];
  if (finding.fix) {
    for (const line of finding.fix.split('\n')) parts.push(dim(`     ${line}`));
  }
  parts.push('');
  return parts.join('\n');
}
