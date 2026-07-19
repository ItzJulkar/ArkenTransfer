/** Arc networks for Arken */

export const CHAINS = {
  5042002: {
    chainId: 5042002,
    hex: '0x4cef52',
    name: 'Arc Testnet',
    label: 'Arc Testnet (USDC)',
    nativeSymbol: 'USDC',
    nativeDecimals: 18,
    explorer: 'https://testnet.arcscan.app',
    rpcHint: 'https://rpc.testnet.arc.network',
    testnet: true,
    live: true,
  },
};

/** UI-only placeholder — not switchable */
export const MAINNET_SOON = {
  id: 'mainnet-soon',
  label: 'Arc Mainnet (soon)',
  disabled: true,
};

export const CHAIN_ORDER = [5042002];

export function getChain(chainId) {
  return CHAINS[Number(chainId)] || null;
}

export function explorerTx(chainId, hash) {
  const c = getChain(chainId);
  if (!c || !hash) return '#';
  return `${c.explorer}/tx/${hash}`;
}

export function explorerAddress(chainId, address) {
  const c = getChain(chainId);
  if (!c || !address) return '#';
  return `${c.explorer}/address/${address}`;
}
