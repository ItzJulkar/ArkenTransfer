/**
 * Arken — OWN MultiSend protocol only.
 * Arken protocol only — no Multicall3 / Disperse. 1 signature batch after protocol is live.
 *
 * Resolve order:
 *   1. CREATE2 Arken at predicted address (if already live)
 *   2. localStorage saved Arken for this chain (if live)
 *   3. Deploy our MultiSend (CREATE2 preferred, else plain create) — one-time
 *   4. disperseEther / disperseToken in ONE tx
 */

import {
  Contract,
  ContractFactory,
  parseUnits,
  formatUnits,
  MaxUint256,
  getCreate2Address,
  keccak256,
  solidityPacked,
  id,
} from 'ethers';
import { BrowserProvider } from './wallet.js';
import { compareDecimals } from './parse.js';
import { getChain } from './chains.js';
import { MULTISEND_ABI, MULTISEND_BYTECODE } from './multisendArtifact.js';

/** Deterministic CREATE2 salt unique to Arken (not BundleTransfer) */
export const CREATE2_DEPLOYER = '0x4e59b44847b379578588920cA78FbF26c0B4956C';
export const MULTISEND_SALT = id('arken.transfer.protocol.v1');
export const MULTISEND_CREATE2_ADDRESS = getCreate2Address(
  CREATE2_DEPLOYER,
  MULTISEND_SALT,
  keccak256(MULTISEND_BYTECODE)
);

const ERC20_ABI = [
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
  'function transfer(address to, uint256 amount) returns (bool)',
];

const LS_KEY = 'arken.batchContract.v1';

export function assertEnoughBalance({ totalAmount, balanceFormatted, symbol }) {
  if (compareDecimals(balanceFormatted, totalAmount) < 0) {
    throw new Error(
      `Insufficient ${symbol} balance. Need ${totalAmount}, have ${trimNum(balanceFormatted)}.`
    );
  }
}

function trimNum(s) {
  if (!s.includes('.')) return s;
  const [a, b] = s.split('.');
  return `${a}.${b.slice(0, 8)}`;
}

async function hasCode(provider, address) {
  if (!address) return false;
  try {
    const code = await provider.getCode(address);
    return !!(code && code !== '0x' && code.length > 2);
  } catch {
    return false;
  }
}

function loadStoredBatch(chainId) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    return all[String(chainId)] || null;
  } catch {
    return null;
  }
}

function saveStoredBatch(chainId, address) {
  try {
    const all = JSON.parse(localStorage.getItem(LS_KEY) || '{}');
    all[String(chainId)] = address;
    localStorage.setItem(LS_KEY, JSON.stringify(all));
  } catch {
    /* ignore */
  }
}

/**
 * Only our Arken protocol — never Multicall3 / public Disperse.
 */
/** Known live Arken protocol on Arc Testnet — skip deploy forever when code is present */
export const LIVE_ARKEN_PROTOCOL = '0x3cE4D2831B4bFeF274703d4ea8f8354380a7035D';

export async function resolveBatchExecutor(provider, chainId) {
  // Prefer pinned live address first (same CREATE2 prediction)
  if (await hasCode(provider, LIVE_ARKEN_PROTOCOL)) {
    return {
      type: 'multisend',
      address: LIVE_ARKEN_PROTOCOL,
      protocol: 'Arken',
      create2: true,
    };
  }
  if (await hasCode(provider, MULTISEND_CREATE2_ADDRESS)) {
    return {
      type: 'multisend',
      address: MULTISEND_CREATE2_ADDRESS,
      protocol: 'Arken',
      create2: true,
    };
  }
  const stored = loadStoredBatch(chainId);
  if (stored && (await hasCode(provider, stored))) {
    return {
      type: 'multisend',
      address: stored,
      protocol: 'Arken',
      create2: false,
    };
  }
  const canCreate2 = await hasCode(provider, CREATE2_DEPLOYER);
  return {
    type: 'none',
    address: null,
    canDeploy: true,
    canCreate2,
    predicted: canCreate2 ? MULTISEND_CREATE2_ADDRESS : null,
    protocol: 'Arken',
  };
}

function nativeDecimals(chainId) {
  return getChain(chainId)?.nativeDecimals ?? 18;
}

function buildArrays(valid, mode, tokenDecimals, chainId) {
  const recipients = valid.map((r) => r.address);
  const decimals = mode === 'native' ? nativeDecimals(chainId) : tokenDecimals;
  const values = valid.map((r) => parseUnits(r.amount, decimals));
  const total = values.reduce((a, b) => a + b, 0n);
  return { recipients, values, total };
}

/** Tight gas + tip caps — less overpay. Protocol already live so no deploy pad. */
async function txOverrides(provider, gasEstimate) {
  const fee = await provider.getFeeData();
  const o = {};
  if (gasEstimate != null) {
    // 2% headroom only (was 5%)
    o.gasLimit = (gasEstimate * 102n) / 100n;
  }

  const ONE_GWEI = 1_000_000_000n;
  const tipRaw = fee.maxPriorityFeePerGas ?? 0n;
  // Cap tip — wallets often suggest fat tips on testnets
  const tip = tipRaw > ONE_GWEI ? ONE_GWEI : tipRaw;

  if (fee.maxFeePerGas != null) {
    // Prefer lean maxFee: ~base + tip. ethers often doubles base.
    let maxFee = fee.maxFeePerGas;
    if (fee.gasPrice != null && fee.gasPrice > 0n) {
      // gasPrice ≈ base on many L2s; maxFee = gasPrice + tip is enough
      const lean = fee.gasPrice + tip;
      if (lean < maxFee) maxFee = lean;
    }
    // Never below tip
    if (maxFee < tip) maxFee = tip;
    o.maxFeePerGas = maxFee;
    o.maxPriorityFeePerGas = tip;
  } else if (fee.gasPrice != null) {
    o.gasPrice = fee.gasPrice;
  }
  return o;
}

/**
 * Deploy our Arken (MultiSend) protocol once on this chain.
 * Prefers CREATE2 via 0x4e59… so address is deterministic across wallets.
 */
export async function deployArkenProtocol({ signer, chainId, onStatus }) {
  const provider = signer.provider;
  let exec = await resolveBatchExecutor(provider, chainId);
  if (exec.type === 'multisend') {
    return exec;
  }

  onStatus?.('Deploy Arken protocol (one-time)…');

  if (exec.canCreate2) {
    // CREATE2 deployer: send salt + init code
    const payload = solidityPacked(['bytes32', 'bytes'], [MULTISEND_SALT, MULTISEND_BYTECODE]);
    const gas = await provider.estimateGas({
      to: CREATE2_DEPLOYER,
      data: payload,
      from: await signer.getAddress(),
    }).catch(() => 900000n);
    const o = await txOverrides(provider, gas);
    const tx = await signer.sendTransaction({
      to: CREATE2_DEPLOYER,
      data: payload,
      ...o,
    });
    onStatus?.('Waiting for protocol deploy…');
    const receipt = await tx.wait(1);
    if (!receipt || receipt.status === 0) {
      throw new Error('Arken protocol deploy reverted');
    }
    if (!(await hasCode(provider, MULTISEND_CREATE2_ADDRESS))) {
      throw new Error('Deploy mined but protocol not at predicted CREATE2 address');
    }
    saveStoredBatch(chainId, MULTISEND_CREATE2_ADDRESS);
    return {
      type: 'multisend',
      address: MULTISEND_CREATE2_ADDRESS,
      protocol: 'Arken',
      create2: true,
      deployTx: tx.hash,
    };
  }

  // Fallback: plain CREATE
  const factory = new ContractFactory(MULTISEND_ABI, MULTISEND_BYTECODE, signer);
  const o = await txOverrides(provider);
  const contract = await factory.deploy(o);
  onStatus?.('Waiting for protocol deploy…');
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  if (!(await hasCode(provider, address))) {
    throw new Error('Plain deploy failed — no code');
  }
  saveStoredBatch(chainId, address);
  const deployTx = contract.deploymentTransaction()?.hash || null;
  return {
    type: 'multisend',
    address,
    protocol: 'Arken',
    create2: false,
    deployTx,
  };
}

export async function estimateBatchGas({
  signer,
  rows,
  mode,
  tokenAddress,
  tokenDecimals,
  chainId,
}) {
  const valid = rows.filter((r) => r.ok);
  if (!valid.length) throw new Error('No valid rows');
  const provider = signer.provider;
  let exec = await resolveBatchExecutor(provider, chainId);
  const { recipients, values, total } = buildArrays(valid, mode, tokenDecimals, chainId);
  const from = await signer.getAddress();

  let gas;
  try {
    if (exec.type === 'multisend' && mode === 'native') {
      gas = await new Contract(exec.address, MULTISEND_ABI, provider).disperseEther.estimateGas(
        recipients,
        values,
        { from, value: total }
      );
    } else if (exec.type === 'multisend' && mode === 'erc20') {
      gas = await new Contract(exec.address, MULTISEND_ABI, provider).disperseToken.estimateGas(
        tokenAddress,
        recipients,
        values,
        { from }
      );
    } else {
      // Protocol not live yet — rough estimate (deploy + batch)
      gas = 550000n + 35000n * BigInt(valid.length);
    }
  } catch {
    gas = 80000n * BigInt(valid.length) + 120000n;
  }

  const feeData = await provider.getFeeData();
  const gasPrice = feeData.gasPrice || feeData.maxFeePerGas || 0n;
  const dec = nativeDecimals(chainId);
  return {
    totalGas: gas,
    feeWei: gas * gasPrice,
    feeFormatted: formatUnits(gas * gasPrice, dec),
    batch: exec.type === 'multisend',
    needsDeploy: exec.type === 'none',
    executor: exec,
  };
}

/**
 * Ensure protocol live, then one batch tx. Never Multicall3/Disperse.
 */
export async function executeTransfers({
  signer,
  rows,
  mode,
  tokenAddress,
  tokenDecimals,
  chainId,
  onProgress,
  onStatus,
  allowDeploy = true,
}) {
  const provider = signer.provider || new BrowserProvider(window.ethereum);
  const results = rows.map((r) => ({ ...r }));
  const validIdx = [];
  results.forEach((r, i) => {
    if (r.ok) validIdx.push(i);
    else r.status = 'skipped';
  });
  onProgress?.(results);
  if (!validIdx.length) {
    return { sent: 0, failed: 0, results, batch: false, txHash: null };
  }

  const valid = validIdx.map((i) => results[i]);
  const { recipients, values, total } = buildArrays(valid, mode, tokenDecimals, chainId);
  let exec = await resolveBatchExecutor(provider, chainId);
  let deployTx = null;

  if (exec.type === 'none') {
    if (!allowDeploy) {
      markAll(results, validIdx, 'failed', 'Arken protocol not installed');
      onProgress?.(results);
      return {
        sent: 0,
        failed: validIdx.length,
        results,
        batch: false,
        txHash: null,
        error: 'Arken protocol not live on this chain. Enable one-time install.',
      };
    }
    try {
      exec = await deployArkenProtocol({ signer, chainId, onStatus });
      deployTx = exec.deployTx || null;
    } catch (err) {
      markAll(results, validIdx, 'failed', humanError(err));
      onProgress?.(results);
      return {
        sent: 0,
        failed: validIdx.length,
        results,
        batch: false,
        txHash: null,
        error: humanError(err),
      };
    }
  }

  try {
    return await runArken({
      signer,
      provider,
      address: exec.address,
      mode,
      tokenAddress,
      recipients,
      values,
      total,
      results,
      validIdx,
      onProgress,
      onStatus,
      deployTx,
    });
  } catch (err) {
    markAll(results, validIdx, 'failed', humanError(err));
    onProgress?.(results);
    return {
      sent: 0,
      failed: validIdx.length,
      results,
      batch: true,
      txHash: null,
      deployTx,
      error: humanError(err),
    };
  }
}

async function ensureErc20Allowance({ signer, tokenAddress, spender, amount, onStatus }) {
  const token = new Contract(tokenAddress, ERC20_ABI, signer);
  const owner = await signer.getAddress();
  const current = await token.allowance(owner, spender);
  if (current >= amount) return null;
  onStatus?.('Approve token once for Arken…');
  const o = await txOverrides(signer.provider);
  const tx = await token.approve(spender, MaxUint256, o);
  await tx.wait(1);
  return tx.hash;
}

async function runArken(ctx) {
  const {
    signer,
    provider,
    address,
    mode,
    tokenAddress,
    recipients,
    values,
    total,
    results,
    validIdx,
    onProgress,
    onStatus,
    deployTx,
  } = ctx;
  const c = new Contract(address, MULTISEND_ABI, signer);
  markAll(results, validIdx, 'pending');
  onProgress?.(results);

  let approveHash = null;
  if (mode === 'erc20') {
    approveHash = await ensureErc20Allowance({
      signer,
      tokenAddress,
      spender: address,
      amount: total,
      onStatus,
    });
  }

  onStatus?.(`Confirm 1 Arken batch · ${recipients.length} wallets…`);
  let tx;
  if (mode === 'native') {
    const gas = await c.disperseEther.estimateGas(recipients, values, { value: total });
    const o = await txOverrides(provider, gas);
    tx = await c.disperseEther(recipients, values, { value: total, ...o });
  } else {
    const gas = await c.disperseToken.estimateGas(tokenAddress, recipients, values);
    const o = await txOverrides(provider, gas);
    tx = await c.disperseToken(tokenAddress, recipients, values, o);
  }
  return finishBatch({
    provider,
    tx,
    results,
    validIdx,
    onProgress,
    approveHash,
    deployTx,
    executor: 'multisend',
  });
}

async function finishBatch({
  provider,
  tx,
  results,
  validIdx,
  onProgress,
  approveHash = null,
  deployTx = null,
  executor,
}) {
  applyTxHash(results, validIdx, tx.hash);
  markAll(results, validIdx, 'sent');
  onProgress?.(results);
  const receipt = await provider.waitForTransaction(tx.hash, 1);
  if (receipt && receipt.status === 0) {
    markAll(results, validIdx, 'failed', 'Batch reverted');
    onProgress?.(results);
    return {
      sent: 0,
      failed: validIdx.length,
      results,
      batch: true,
      txHash: tx.hash,
      approveHash,
      deployTx,
      error: 'Batch reverted',
      executor,
    };
  }
  markAll(results, validIdx, 'confirmed');
  onProgress?.(results);
  return {
    sent: validIdx.length,
    failed: 0,
    results,
    batch: true,
    txHash: tx.hash,
    approveHash,
    deployTx,
    executor,
  };
}

function markAll(results, idxs, status, error = null) {
  for (const i of idxs) {
    results[i].status = status;
    if (error) results[i].error = error;
  }
}

function applyTxHash(results, idxs, hash) {
  for (const i of idxs) results[i].txHash = hash;
}

function isUserReject(err) {
  const code = err?.code ?? err?.info?.error?.code;
  const msg = String(err?.shortMessage || err?.message || '').toLowerCase();
  return (
    code === 4001 ||
    code === 'ACTION_REJECTED' ||
    msg.includes('user rejected') ||
    msg.includes('user denied')
  );
}

function humanError(err) {
  if (isUserReject(err)) return 'Rejected in wallet';
  return String(err?.shortMessage || err?.reason || err?.message || 'Failed').slice(0, 160);
}
