/**
 * Node test harness for pure parse helpers (no browser).
 * Run: node --test scripts/test-parse.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const parseUrl = pathToFileURL(path.join(__dirname, '../src/lib/parse.js')).href;
const { parseRecipients, isPositiveDecimal, sumDecimals, normalizeDecimal, compareDecimals } =
  await import(parseUrl);

// Minimal address helpers (mirror ethers shape for tests)
const ADDR_OK = '0x1111111111111111111111111111111111111111';
const ADDR_OK2 = '0x2222222222222222222222222222222222222222';
const ADDR_OK3 = '0x3333333333333333333333333333333333333333';

const opts = {
  isAddress: (a) => /^0x[a-fA-F0-9]{40}$/.test(a),
  getAddress: (a) => a, // no checksum enforce in unit tests
};

describe('isPositiveDecimal', () => {
  it('accepts plain positives', () => {
    assert.equal(isPositiveDecimal('1'), true);
    assert.equal(isPositiveDecimal('0.01'), true);
    assert.equal(isPositiveDecimal('10.5'), true);
  });
  it('rejects zero and junk', () => {
    assert.equal(isPositiveDecimal('0'), false);
    assert.equal(isPositiveDecimal('0.0'), false);
    assert.equal(isPositiveDecimal('-1'), false);
    assert.equal(isPositiveDecimal('1e2'), false);
    assert.equal(isPositiveDecimal('abc'), false);
    assert.equal(isPositiveDecimal(''), false);
  });
});

describe('sumDecimals', () => {
  it('sums without float drift', () => {
    assert.equal(sumDecimals(['0.1', '0.2']), '0.3');
    assert.equal(sumDecimals(['1.005', '2.005']), '3.01');
    assert.equal(sumDecimals([]), '0');
  });
});

describe('parseRecipients addr_amount', () => {
  it('parses comma / space / tab', () => {
    const text = [
      `${ADDR_OK}, 0.05`,
      `${ADDR_OK2} 0.1`,
      `${ADDR_OK3}\t1.25`,
    ].join('\n');
    const r = parseRecipients(text, { ...opts, mode: 'addr_amount' });
    assert.equal(r.validCount, 3);
    assert.equal(r.invalidCount, 0);
    assert.equal(r.total, '1.4');
    assert.equal(r.rows[0].address, ADDR_OK);
    assert.equal(r.rows[0].amount, '0.05');
  });

  it('rejects invalid address and amount', () => {
    const text = `not-an-address, 1\n${ADDR_OK}, nope`;
    const r = parseRecipients(text, { ...opts, mode: 'addr_amount' });
    assert.equal(r.validCount, 0);
    assert.equal(r.invalidCount, 2);
  });

  it('rejects duplicates', () => {
    const text = `${ADDR_OK}, 1\n${ADDR_OK}, 2`;
    const r = parseRecipients(text, { ...opts, mode: 'addr_amount' });
    assert.equal(r.validCount, 1);
    assert.equal(r.invalidCount, 1);
    assert.match(r.rows[1].error, /Duplicate/i);
  });

  it('ignores comments and blanks', () => {
    const text = `# header\n\n${ADDR_OK}, 1\n// note`;
    const r = parseRecipients(text, { ...opts, mode: 'addr_amount' });
    assert.equal(r.validCount, 1);
  });
});

describe('parseRecipients equal_split', () => {
  it('applies equal amount', () => {
    const text = `${ADDR_OK}\n${ADDR_OK2}`;
    const r = parseRecipients(text, {
      ...opts,
      mode: 'equal_split',
      equalAmount: '0.01',
    });
    assert.equal(r.validCount, 2);
    assert.equal(r.total, '0.02');
    assert.equal(r.rows[0].amount, '0.01');
  });

  it('requires equal amount', () => {
    const r = parseRecipients(ADDR_OK, { ...opts, mode: 'equal_split', equalAmount: '' });
    assert.ok(r.errors.length > 0);
    assert.equal(r.validCount, 0);
  });
});

describe('compareDecimals', () => {
  it('orders amounts', () => {
    assert.equal(compareDecimals('1', '2'), -1);
    assert.equal(compareDecimals('2', '1'), 1);
    assert.equal(compareDecimals('1.0', '1'), 0);
  });
});

describe('normalizeDecimal', () => {
  it('trims trailing zeros', () => {
    assert.equal(normalizeDecimal('1.2300'), '1.23');
    assert.equal(normalizeDecimal('0010'), '10');
  });
});

console.log('All parse tests defined.');
