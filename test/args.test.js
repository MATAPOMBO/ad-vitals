import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalizeUrl, parseArgs } from '../dist/index.js';

test('defaults to a throttled mobile audit with scrolling', () => {
  const args = parseArgs(['example.com']);
  assert.equal(args.url, 'example.com');
  assert.equal(args.device, 'mobile');
  assert.equal(args.throttle, true);
  assert.equal(args.scroll, true);
  assert.equal(args.json, false);
});

test('parses every documented flag', () => {
  const args = parseArgs([
    'https://example.com',
    '--device',
    'desktop',
    '--budget',
    '0.05',
    '--wait',
    '9000',
    '--timeout',
    '20000',
    '--channel',
    'chrome',
    '--json',
    '--no-scroll',
    '--no-throttle',
    '--headed',
  ]);

  assert.equal(args.device, 'desktop');
  assert.equal(args.budget, 0.05);
  assert.equal(args.wait, 9000);
  assert.equal(args.timeout, 20000);
  assert.equal(args.channel, 'chrome');
  assert.equal(args.json, true);
  assert.equal(args.scroll, false);
  assert.equal(args.throttle, false);
  assert.equal(args.headed, true);
});

test('rejects an unknown device', () => {
  assert.throws(() => parseArgs(['example.com', '--device', 'watch']), /must be "mobile" or "desktop"/);
});

test('rejects a non-numeric budget', () => {
  assert.throws(() => parseArgs(['example.com', '--budget', 'low']), /must be a number/);
});

test('rejects an unknown option instead of treating it as a url', () => {
  assert.throws(() => parseArgs(['example.com', '--turbo']), /Unknown option/);
});

test('rejects a flag that is missing its value', () => {
  assert.throws(() => parseArgs(['example.com', '--device']), /needs a value/);
});

test('adds https when the scheme is missing and keeps it otherwise', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('example.com/a?b=1'), 'https://example.com/a?b=1');
  assert.equal(normalizeUrl('http://example.com'), 'http://example.com');
  assert.equal(normalizeUrl('https://example.com'), 'https://example.com');
  assert.equal(normalizeUrl('HTTPS://example.com'), 'HTTPS://example.com');
});
