import { BrowserProvider, Contract, formatUnits, getAddress, isAddress, parseUnits } from 'ethers';
import { CHAINS, getChain } from './chains.js';

const ERC20_ABI = [
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

export function hasEthereum() {
  return typeof window !== 'undefined' && !!window.ethereum;
}

function ethProvider() {
  if (!hasEthereum()) throw new Error('No browser wallet found. Install MetaMask or another EVM wallet.');
  return window.ethereum;
}

/** Normalize nested wallet RPC errors (MetaMask / Rabby / OKX / Phantom EVM). */
function errCode(err) {
  return (
    err?.code ??
    err?.error?.code ??
    err?.data?.originalError?.code ??
    err?.info?.error?.code ??
    null
  );
}

function errMessage(err) {
  return String(
    err?.message ||
      err?.error?.message ||
      err?.data?.message ||
      err?.data?.originalError?.message ||
      err?.info?.error?.message ||
      err ||
      '',
  );
}

/** True when the wallet does not know this chain yet (must wallet_addEthereumChain). */
function isUnrecognizedChainError(err) {
  const code = errCode(err);
  if (code === 4902 || code === '4902') return true;
  const msg = errMessage(err).toLowerCase();
  return (
    msg.includes('unrecognized chain') ||
    msg.includes('wallet_addethereumchain') ||
    msg.includes('try adding the chain') ||
    msg.includes('chain not added') ||
    msg.includes('unknown chain') ||
    // some wallets wrap 4902 as internal error + this message
    (code === -32603 && msg.includes('chain'))
  );
}

function isUserRejected(err) {
  const code = errCode(err);
  if (code === 4001 || code === '4001' || code === 'ACTION_REJECTED') return true;
  const msg = errMessage(err).toLowerCase();
  return msg.includes('user rejected') || msg.includes('user denied') || msg.includes('rejected the request');
}

function addChainParams(chain) {
  const decimals = chain.nativeDecimals ?? 18;
  return {
    chainId: chain.hex,
    chainName: chain.name,
    nativeCurrency: {
      name: chain.nativeSymbol,
      symbol: chain.nativeSymbol,
      decimals,
    },
    rpcUrls: [chain.rpcHint],
    blockExplorerUrls: chain.explorer ? [chain.explorer] : [],
  };
}

export async function connectWallet() {
  const eth = ethProvider();
  const provider = new BrowserProvider(eth);
  await provider.send('eth_requestAccounts', []);
  const signer = await provider.getSigner();
  const address = await signer.getAddress();
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  return { provider, signer, address, chainId };
}

export async function getAccounts() {
  if (!hasEthereum()) return [];
  const provider = new BrowserProvider(window.ethereum);
  const accounts = await provider.send('eth_accounts', []);
  return accounts.map((a) => getAddress(a));
}

export async function getChainId() {
  if (!hasEthereum()) return null;
  const provider = new BrowserProvider(window.ethereum);
  const network = await provider.getNetwork();
  return Number(network.chainId);
}

/**
 * Add Arc (or any configured) network to the wallet if missing, then switch to it.
 * Handles wallets that throw message-only "Unrecognized chain ID" without code 4902.
 */
export async function addEthereumChain(chainId) {
  const eth = ethProvider();
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);
  if (!chain.rpcHint) throw new Error(`No RPC configured for ${chain.name}`);
  await eth.request({
    method: 'wallet_addEthereumChain',
    params: [addChainParams(chain)],
  });
}

export async function switchChain(chainId) {
  const eth = ethProvider();
  const chain = getChain(chainId);
  if (!chain) throw new Error(`Unsupported chain ${chainId}`);

  const trySwitch = () =>
    eth.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chain.hex }],
    });

  try {
    await trySwitch();
    return;
  } catch (err) {
    if (isUserRejected(err)) {
      const e = new Error('Wallet rejected network switch');
      e.code = 4001;
      throw e;
    }
    if (!isUnrecognizedChainError(err)) {
      // Still try add+switch once — some wallets mis-code unrecognized chain
      const msg = errMessage(err).toLowerCase();
      if (!msg.includes('chain') && errCode(err) !== -32603) throw err;
    }
  }

  try {
    await eth.request({
      method: 'wallet_addEthereumChain',
      params: [addChainParams(chain)],
    });
  } catch (addErr) {
    if (isUserRejected(addErr)) {
      const e = new Error('Wallet rejected adding Arc Testnet');
      e.code = 4001;
      throw e;
    }
    // "already pending" / already added — fall through to switch
    const msg = errMessage(addErr).toLowerCase();
    const already =
      msg.includes('already') ||
      msg.includes('pending') ||
      errCode(addErr) === -32002;
    if (!already && !isUnrecognizedChainError(addErr)) {
      throw new Error(errMessage(addErr) || 'Failed to add Arc Testnet to wallet');
    }
  }

  // Some wallets auto-switch on add; others need an explicit switch
  try {
    await trySwitch();
  } catch (err) {
    if (isUserRejected(err)) {
      const e = new Error('Wallet rejected network switch');
      e.code = 4001;
      throw e;
    }
    // If still on wrong chain after add, surface clear error
    const current = await getChainId().catch(() => null);
    if (current === Number(chainId)) return;
    throw new Error(
      errMessage(err) ||
        `Could not switch to ${chain.name}. Add RPC ${chain.rpcHint} (chain ${chain.chainId}) manually.`,
    );
  }
}

/** Connect accounts then force wallet onto target chain (add RPC if needed). */
export async function connectAndEnsureChain(targetChainId) {
  const connected = await connectWallet();
  if (Number(connected.chainId) === Number(targetChainId)) {
    return connected;
  }
  await switchChain(targetChainId);
  // Re-bind provider/signer after chain change
  return connectWallet();
}

export async function getNativeBalance(address, chainId) {
  const provider = new BrowserProvider(window.ethereum);
  const bal = await provider.getBalance(address);
  const chain = getChain(chainId);
  const decimals = chain?.nativeDecimals ?? 18;
  return {
    raw: bal,
    formatted: formatUnits(bal, decimals),
    symbol: chain?.nativeSymbol || 'ETH',
    decimals,
  };
}

export async function loadErc20(tokenAddress, owner) {
  if (!isAddress(tokenAddress)) throw new Error('Invalid token address');
  const provider = new BrowserProvider(window.ethereum);
  const checksum = getAddress(tokenAddress);
  const contract = new Contract(checksum, ERC20_ABI, provider);
  const [symbol, decimals, balance] = await Promise.all([
    contract.symbol().catch(() => 'TOKEN'),
    contract.decimals(),
    owner ? contract.balanceOf(owner) : Promise.resolve(0n),
  ]);
  return {
    address: checksum,
    symbol: String(symbol),
    decimals: Number(decimals),
    balance,
    balanceFormatted: formatUnits(balance, decimals),
    contract,
  };
}

export function erc20WithSigner(tokenAddress, signer) {
  return new Contract(getAddress(tokenAddress), ERC20_ABI, signer);
}

export { getAddress, isAddress, parseUnits, formatUnits, BrowserProvider, ERC20_ABI, CHAINS };
