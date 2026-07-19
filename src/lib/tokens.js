/** Curated trusted tokens only — Arc Testnet. Native USDC always via native path. */

export const TRUSTED_TOKENS = {
  // Arc Testnet — native gas is USDC. Curated ERC-20s from Circle faucet set.
  // Addresses: Circle / Arc docs (testnet).
  5042002: [
    {
      symbol: 'EURC',
      name: 'EURC',
      address: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
      decimals: 6,
    },
    {
      symbol: 'cirBTC',
      name: 'cirBTC',
      address: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
      decimals: 8,
    },
  ],
};

/**
 * Does query match the chain's native gas coin?
 */
export function matchesNativeQuery(query, nativeSymbol) {
  const q = String(query || '')
    .trim()
    .toLowerCase();
  if (!nativeSymbol) return !q;
  const sym = String(nativeSymbol).toLowerCase();
  if (!q) return true;
  if (q === 'native' || q === 'coin' || q === 'gas') return true;
  if (q === sym || sym.startsWith(q) || q.startsWith(sym)) return true;
  if (sym === 'usdc' && ['usdc', 'usd', 'stable', 'dollar'].some((a) => a.startsWith(q) || q.startsWith(a)))
    return true;
  if (sym === 'eth' && ['ether', 'ethereum', 'eth'].some((a) => a.startsWith(q) || q.startsWith(a))) return true;
  return false;
}

/**
 * Search assets: native coin (if matched) + curated trusted ERC-20s only.
 */
export function searchTrustedTokens(chainId, query, opts = {}) {
  const limit = opts.limit ?? 12;
  const nativeSymbol = opts.nativeSymbol || null;
  const list = TRUSTED_TOKENS[Number(chainId)] || [];
  const q = String(query || '')
    .trim()
    .toLowerCase();
  const id = Number(chainId);

  if (/^0x[a-fA-F0-9]{6,}$/.test(q)) {
    return [];
  }

  const out = [];

  if (nativeSymbol && matchesNativeQuery(q, nativeSymbol)) {
    out.push({
      kind: 'native',
      symbol: nativeSymbol,
      name: `Native ${nativeSymbol} (gas coin)`,
      address: null,
      decimals: opts.nativeDecimals ?? 18,
      chainId: id,
      score: 1000,
    });
  }

  if (!q) {
    for (const t of list.slice(0, Math.max(0, limit - out.length))) {
      out.push({ ...t, kind: 'erc20', chainId: id, score: 0 });
    }
    return out.slice(0, limit);
  }

  const scored = [];
  for (const t of list) {
    const sym = t.symbol.toLowerCase();
    const name = t.name.toLowerCase();
    let score = 0;
    if (sym === q) score = 100;
    else if (sym.startsWith(q)) score = 80;
    else if (sym.includes(q)) score = 60;
    else if (name.startsWith(q)) score = 50;
    else if (name.includes(q)) score = 30;
    // aliases
    if (!score && sym === 'cirbtc' && ['btc', 'bitcoin', 'cir', 'cibtc'].some((a) => a === q || a.startsWith(q) || q.startsWith(a)))
      score = 70;
    if (!score && sym === 'eurc' && ['eur', 'euro'].some((a) => a === q || a.startsWith(q) || q.startsWith(a)))
      score = 70;
    if (score > 0) scored.push({ ...t, kind: 'erc20', chainId: id, score });
  }
  scored.sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  for (const t of scored) {
    if (out.length >= limit) break;
    out.push(t);
  }
  return out;
}

export function findTrustedByAddress(chainId, address) {
  if (!address) return null;
  const list = TRUSTED_TOKENS[Number(chainId)] || [];
  const lower = address.toLowerCase();
  return list.find((t) => t.address.toLowerCase() === lower) || null;
}
