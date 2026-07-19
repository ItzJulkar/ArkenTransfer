import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const tokensUrl = pathToFileURL(path.join(__dirname, '../src/lib/tokens.js')).href;
const chainsUrl = pathToFileURL(path.join(__dirname, '../src/lib/chains.js')).href;

const { searchTrustedTokens, findTrustedByAddress, TRUSTED_TOKENS } = await import(tokensUrl);
const { CHAINS, CHAIN_ORDER, MAINNET_SOON } = await import(chainsUrl);

describe('chains Arc Testnet only', () => {
  it('only Arc Testnet 5042002', () => {
    assert.ok(CHAINS[5042002], 'Arc Testnet 5042002');
    assert.equal(CHAINS[5042002].name, 'Arc Testnet');
    assert.equal(CHAINS[5042002].nativeSymbol, 'USDC');
    assert.equal(CHAINS[5042002].testnet, true);
    assert.equal(CHAINS[5042002].hex, '0x4cef52');
    assert.deepEqual(CHAIN_ORDER, [5042002]);
    assert.equal(MAINNET_SOON.disabled, true);
    assert.ok(CHAINS[5042002].label.includes('USDC'));
    assert.ok(!CHAINS[1], 'Ethereum mainnet not included');
    assert.ok(!CHAINS[4663], 'Robinhood not included');
    assert.ok(!CHAINS[143], 'Monad not included');
    for (const id of CHAIN_ORDER) {
      assert.ok(CHAINS[id], `chain ${id} in order`);
    }
  });
});

describe('trusted token search Arc', () => {
  it('finds native USDC first', () => {
    const hits = searchTrustedTokens(5042002, 'usdc', { nativeSymbol: 'USDC' });
    assert.ok(hits.length >= 1);
    assert.equal(hits[0].kind, 'native');
    assert.equal(hits[0].symbol, 'USDC');
  });

  it('Arc curated list has EURC + cirBTC', () => {
    const list = TRUSTED_TOKENS[5042002];
    assert.equal(list.length, 2);
    assert.ok(list.some((t) => t.symbol === 'EURC'));
    assert.ok(list.some((t) => t.symbol === 'cirBTC'));
    assert.equal(
      list.find((t) => t.symbol === 'EURC').address.toLowerCase(),
      '0x89b50855aa3be2f677cd6303cec089b5f319d72a',
    );
    assert.equal(
      list.find((t) => t.symbol === 'cirBTC').address.toLowerCase(),
      '0xf0c4a4ce82a5746abaad9425360ab04fbba432bf',
    );
  });

  it('finds EURC and cirBTC by name', () => {
    const eurc = searchTrustedTokens(5042002, 'eurc', { nativeSymbol: 'USDC' });
    assert.ok(eurc.some((h) => h.kind === 'erc20' && h.symbol === 'EURC'));
    const btc = searchTrustedTokens(5042002, 'btc', { nativeSymbol: 'USDC' });
    assert.ok(btc.some((h) => h.kind === 'erc20' && h.symbol === 'cirBTC'));
  });

  it('empty query includes native first then curated', () => {
    const hits = searchTrustedTokens(5042002, '', { nativeSymbol: 'USDC' });
    assert.equal(hits[0].kind, 'native');
    assert.ok(hits.some((h) => h.symbol === 'EURC'));
    assert.ok(hits.some((h) => h.symbol === 'cirBTC'));
  });

  it('does not invent random viral names', () => {
    const hits = searchTrustedTokens(5042002, 'super-moon-scam-inu-xyz', { nativeSymbol: 'USDC' });
    assert.equal(hits.filter((h) => h.kind === 'erc20').length, 0);
    assert.equal(hits.length, 0);
  });

  it('returns empty for address-like query', () => {
    const hits = searchTrustedTokens(5042002, '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', {
      nativeSymbol: 'USDC',
    });
    assert.equal(hits.length, 0);
  });

  it('findTrustedByAddress finds EURC', () => {
    const t = findTrustedByAddress(5042002, '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a');
    assert.ok(t);
    assert.equal(t.symbol, 'EURC');
  });
});
