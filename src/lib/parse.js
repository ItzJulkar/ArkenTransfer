/**
 * Recipient list parsing & validation (pure — no wallet deps).
 * Used by UI and by Node unit tests.
 */

const MAX_ROWS = 200;

/** Loose EVM address shape before checksum (after sanitize) */
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

/** Invisible / copy-paste junk that breaks address matching */
const INVISIBLE_RE = /[\u200B-\u200D\uFEFF\u00A0\u2028\u2029\u2060]/g;

/**
 * Clean a pasted line: trim, strip ZWSP/BOM/nbsp, collapse spaces.
 */
export function sanitizeLine(line) {
  return String(line || '')
    .replace(INVISIBLE_RE, '')
    .replace(/\u00a0/g, ' ')
    .trim();
}

/**
 * Normalize address token: strip junk, force 0x prefix casing.
 */
export function sanitizeAddressToken(raw) {
  let s = sanitizeLine(raw).replace(INVISIBLE_RE, '');
  // strip surrounding quotes / brackets sometimes copied from explorers
  s = s.replace(/^['"`<\[]+|['"`>\]]+$/g, '');
  if (/^0X[a-fA-F0-9]{40}$/.test(s)) s = '0x' + s.slice(2);
  return s;
}

/**
 * @param {string} text
 * @param {{ mode: 'addr_amount' | 'equal_split', equalAmount?: string, isAddress?: (a:string)=>boolean, getAddress?: (a:string)=>string }} opts
 */
export function parseRecipients(text, opts = {}) {
  const mode = opts.mode || 'addr_amount';
  const equalAmount = sanitizeLine(opts.equalAmount || '');
  const isAddress = opts.isAddress || ((a) => ADDR_RE.test(a));
  const getAddress = opts.getAddress || ((a) => a);

  const lines = String(text || '')
    .split(/\r?\n/)
    .map((l) => sanitizeLine(l))
    .filter((l) => l && !l.startsWith('#') && !l.startsWith('//'));

  const rows = [];
  const errors = [];
  const seen = new Map();

  if (lines.length === 0) {
    return { rows: [], errors: ['No recipients provided.'], total: '0', validCount: 0, invalidCount: 0 };
  }

  if (lines.length > MAX_ROWS) {
    return {
      rows: [],
      errors: [`Too many rows (${lines.length}). Max is ${MAX_ROWS} per run.`],
      total: '0',
      validCount: 0,
      invalidCount: lines.length,
    };
  }

  if (mode === 'equal_split') {
    if (!equalAmount || !isPositiveDecimal(equalAmount)) {
      return {
        rows: [],
        errors: ['Equal-split mode: set a valid positive amount per address first.'],
        total: '0',
        validCount: 0,
        invalidCount: lines.length,
      };
    }
  }

  lines.forEach((line, i) => {
    const lineNo = i + 1;
    let addressRaw = '';
    let amountRaw = '';

    if (mode === 'equal_split') {
      const m = line.match(/^(0[xX][a-fA-F0-9]{40})(?:\s*[,;\t]\s*|\s+)?(.*)$/);
      if (m) {
        addressRaw = sanitizeAddressToken(m[1]);
        amountRaw = equalAmount;
      } else {
        addressRaw = sanitizeAddressToken(line.split(/[\s,;\t]+/)[0] || line);
        amountRaw = equalAmount;
      }
    } else {
      // address,amount | address amount | address\tamount | address;amount
      const m =
        line.match(/^(0[xX][a-fA-F0-9]{40})\s*[,;\t]\s*(.+)$/) ||
        line.match(/^(0[xX][a-fA-F0-9]{40})\s+(.+)$/);
      if (m) {
        addressRaw = sanitizeAddressToken(m[1]);
        amountRaw = sanitizeLine(m[2]).split(/\s+/)[0];
      } else {
        const parts = line.split(/[\s,;\t]+/).filter(Boolean);
        addressRaw = sanitizeAddressToken(parts[0] || '');
        amountRaw = parts[1] ? sanitizeLine(parts[1]) : '';
      }
    }

    const row = {
      index: lineNo,
      addressRaw,
      amountRaw,
      address: null,
      amount: null,
      ok: false,
      error: null,
      status: 'idle',
      txHash: null,
    };

    if (!ADDR_RE.test(addressRaw)) {
      // common confusion: valid-looking address with invisible char already stripped —
      // still show helpful message
      const onlyAddr = /^0[xX][a-fA-F0-9]{1,}$/.test(addressRaw);
      row.error = onlyAddr
        ? `Bad address length (${addressRaw.length - 2} hex chars, need 40)`
        : 'Invalid address format';
      errors.push(`Line ${lineNo}: ${row.error}`);
      rows.push(row);
      return;
    }

    // Normalize checksum via lowercase so mixed-case typos don't reject good addresses
    let checksummed;
    try {
      const lower = addressRaw.toLowerCase();
      if (!isAddress(lower) && !isAddress(addressRaw)) {
        row.error = 'Invalid address';
        errors.push(`Line ${lineNo}: invalid address`);
        rows.push(row);
        return;
      }
      checksummed = getAddress(lower);
    } catch {
      row.error = 'Invalid address';
      errors.push(`Line ${lineNo}: invalid address`);
      rows.push(row);
      return;
    }

    if (mode === 'addr_amount' && !amountRaw) {
      row.error = 'Missing amount — use: address, 0.01  (or switch to equal-split)';
      row.address = checksummed; // still show cleaned address in preview
      errors.push(`Line ${lineNo}: missing amount`);
      rows.push(row);
      return;
    }

    if (!isPositiveDecimal(amountRaw)) {
      row.error = amountRaw
        ? `Invalid amount “${amountRaw}”`
        : 'Missing amount — use: address, 0.01';
      row.address = checksummed;
      errors.push(`Line ${lineNo}: invalid amount`);
      rows.push(row);
      return;
    }

    if (/[eE]/.test(amountRaw)) {
      row.error = 'Scientific notation not allowed';
      errors.push(`Line ${lineNo}: use plain decimal amount`);
      rows.push(row);
      return;
    }

    const key = checksummed.toLowerCase();
    if (seen.has(key)) {
      row.error = `Duplicate of line ${seen.get(key)}`;
      row.address = checksummed;
      errors.push(`Line ${lineNo}: duplicate address (first on line ${seen.get(key)})`);
      rows.push(row);
      return;
    }
    seen.set(key, lineNo);

    row.address = checksummed;
    row.amount = normalizeDecimal(amountRaw);
    row.ok = true;
    rows.push(row);
  });

  const valid = rows.filter((r) => r.ok);
  const total = sumDecimals(valid.map((r) => r.amount));

  return {
    rows,
    errors,
    total,
    validCount: valid.length,
    invalidCount: rows.length - valid.length,
  };
}

export function isPositiveDecimal(s) {
  if (typeof s !== 'string' || !s.trim()) return false;
  const t = s.trim();
  if (!/^\d+(\.\d+)?$/.test(t)) return false;
  if (/^0+$/.test(t.replace('.', ''))) return false;
  const frac = t.split('.')[1];
  if (frac && frac.length > 18) return false;
  return true;
}

export function normalizeDecimal(s) {
  const t = s.trim();
  if (!t.includes('.')) return String(BigInt(t));
  let [a, b] = t.split('.');
  a = a.replace(/^0+(?=\d)/, '') || '0';
  b = b.replace(/0+$/, '');
  return b ? `${a}.${b}` : a;
}

/** Sum decimal strings without floating point. Returns decimal string. */
export function sumDecimals(parts) {
  if (!parts.length) return '0';
  const scaled = parts.map((p) => toScaled(p, 18));
  const sum = scaled.reduce((a, b) => a + b, 0n);
  return fromScaled(sum, 18);
}

function toScaled(dec, decimals) {
  const t = String(dec).trim();
  const neg = t.startsWith('-');
  const s = neg ? t.slice(1) : t;
  const [w, f = ''] = s.split('.');
  if (f.length > decimals) throw new Error('too many decimals');
  const frac = f.padEnd(decimals, '0');
  const n = BigInt(w || '0') * 10n ** BigInt(decimals) + BigInt(frac || '0');
  return neg ? -n : n;
}

function fromScaled(n, decimals) {
  const neg = n < 0n;
  const abs = neg ? -n : n;
  const base = 10n ** BigInt(decimals);
  const w = abs / base;
  let f = (abs % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  const body = f ? `${w}.${f}` : `${w}`;
  return neg ? `-${body}` : body;
}

export function compareDecimals(a, b) {
  const sa = toScaled(a, 18);
  const sb = toScaled(b, 18);
  if (sa === sb) return 0;
  return sa > sb ? 1 : -1;
}

export { MAX_ROWS };
