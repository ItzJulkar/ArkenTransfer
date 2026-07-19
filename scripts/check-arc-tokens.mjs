import { JsonRpcProvider, Contract } from 'ethers';

const p = new JsonRpcProvider('https://rpc.testnet.arc.network');
const abi = [
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function name() view returns (string)',
];
const addrs = {
  EURC: '0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a',
  cirBTC: '0xf0C4a4CE82A5746AbAAd9425360Ab04fbBA432BF',
  USDC_iface: '0x3600000000000000000000000000000000000000',
};

for (const [k, a] of Object.entries(addrs)) {
  try {
    const c = new Contract(a, abi, p);
    const [sym, dec, name] = await Promise.all([c.symbol(), c.decimals(), c.name()]);
    console.log(JSON.stringify({ k, address: a, symbol: sym, decimals: Number(dec), name }));
  } catch (e) {
    console.log(JSON.stringify({ k, err: e.shortMessage || e.message }));
  }
}
