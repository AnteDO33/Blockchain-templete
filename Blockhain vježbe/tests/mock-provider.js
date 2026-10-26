// Browser fixture, never served by server.js. No chain RPC or real signing occurs.
const sender = `0x${'1'.repeat(40)}`;
const scenario = new URLSearchParams(location.search).get('scenario');
const listeners = new Map();
let accounts = [];
let chainId = '0xaa36a7';
let receiptReads = 0;
const provider = {
  on(event, listener) {
    if (!listeners.has(event)) listeners.set(event, new Set());
    listeners.get(event).add(listener);
  },
  removeListener(event, listener) { listeners.get(event)?.delete(listener); },
  async request({ method, params }) {
    switch (method) {
      case 'eth_accounts': return accounts;
      case 'eth_chainId': return chainId;
      case 'eth_requestAccounts':
        if (scenario === 'reject-connect') throw Object.assign(new Error('Rejected'), { code: 4001 });
        accounts = [sender];
        return accounts;
      case 'eth_getBalance': return scenario === 'insufficient' ? '0x38d7ea4c68000' : '0x1bc16d674ec80000';
      case 'eth_estimateGas': return '0x5208';
      case 'eth_gasPrice': return '0x3b9aca00';
      case 'eth_sendTransaction':
        if (scenario === 'reject-send') throw Object.assign(new Error('Rejected'), { code: 4001 });
        return `0x${'a'.repeat(64)}`;
      case 'eth_getTransactionReceipt':
        receiptReads++;
        return receiptReads < 2 ? null : { status: scenario === 'failed' ? '0x0' : '0x1', transactionHash: `0x${'a'.repeat(64)}` };
      case 'wallet_switchEthereumChain':
        chainId = params[0].chainId;
        for (const listener of listeners.get('chainChanged') ?? []) listener(chainId);
        return null;
      case 'wallet_revokePermissions':
        accounts = [];
        for (const listener of listeners.get('accountsChanged') ?? []) listener(accounts);
        return null;
      default: throw Object.assign(new Error(`Unsupported method: ${method}`), { code: -32601 });
    }
  },
};
window.addEventListener('eip6963:requestProvider', () => {
  window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: { info: { rdns: 'io.metamask', name: 'QA simulation' }, provider } }));
});
