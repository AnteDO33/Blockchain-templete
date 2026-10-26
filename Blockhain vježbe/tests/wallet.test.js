import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { WalletSession, parseEther, formatEther, validateRecipient, findLegacyMetaMask, walletError } from '../wallet.js';

const SENDER = `0x${'1'.repeat(40)}`;
const RECIPIENT = `0x${'2'.repeat(40)}`;
const OTHER = `0x${'3'.repeat(40)}`;
const HASH = `0x${'a'.repeat(64)}`;

class MockProvider extends EventEmitter {
  accounts = [SENDER];
  chainId = '0xaa36a7';
  balance = parseEther('2');
  gas = 21000n;
  gasPrice = 1000000000n;
  receipt = null;
  calls = [];
  overrides = {};
  async request({ method, params }) {
    this.calls.push({ method, params });
    if (this.overrides[method]) return this.overrides[method](params);
    switch (method) {
      case 'eth_accounts': return [...this.accounts];
      case 'eth_chainId': return this.chainId;
      case 'eth_getBalance': return `0x${this.balance.toString(16)}`;
      case 'eth_requestAccounts': this.accounts = [SENDER]; return this.accounts;
      case 'eth_estimateGas': return `0x${this.gas.toString(16)}`;
      case 'eth_gasPrice': return `0x${this.gasPrice.toString(16)}`;
      case 'eth_sendTransaction': return HASH;
      case 'eth_getTransactionReceipt': return this.receipt;
      case 'wallet_revokePermissions': this.accounts = []; this.emit('accountsChanged', []); return null;
      case 'wallet_switchEthereumChain': this.chainId = params[0].chainId; this.emit('chainChanged', this.chainId); return null;
      default: throw Object.assign(new Error(`Unsupported ${method}`), { code: -32601 });
    }
  }
}

async function setup(options = {}) {
  const provider = new MockProvider();
  Object.assign(provider, options);
  const session = new WalletSession(provider, { pollInterval: 0 });
  await session.initialize();
  return { provider, session };
}

test('iznosi s točkom i zarezom koriste točne wei vrijednosti bez zaokruživanja', () => {
  assert.equal(parseEther('0,000000000000000001'), 1n);
  assert.equal(parseEther(' 1.123456789012345678 '), 1123456789012345678n);
  assert.equal(formatEther(parseEther('12,03400')), '12,034');
  assert.equal(formatEther(0n), '0');
});

test('nevaljani, nulti i previše precizni iznosi ne prolaze', () => {
  for (const input of ['', '0', '0,0', '-1', 'NaN', 'Infinity', '1e-3', '0x10', '1,2.3', '0.0000000000000000001', '1 000', '9'.repeat(100)]) {
    assert.throws(() => parseEther(input), Error, input);
  }
});

test('provjera adrese odbija nultu adresu, vlastitu adresu i pogrešan format', () => {
  assert.equal(validateRecipient(` ${RECIPIENT} `, SENDER), RECIPIENT);
  for (const address of ['', '0xabc', `0x${'z'.repeat(40)}`, `0x${'0'.repeat(40)}`, SENDER]) {
    assert.throws(() => validateRecipient(address, SENDER));
  }
});

test('naslijeđeno otkrivanje pronalazi MetaMask među više novčanika', () => {
  const metamask = { isMetaMask: true, request() {} };
  assert.equal(findLegacyMetaMask({ providers: [{ isMetaMask: false }, metamask] }), metamask);
  assert.equal(findLegacyMetaMask(undefined), null);
  assert.equal(findLegacyMetaMask({ isMetaMask: true }), null);
});

test('inicijalizacija čita dopušteni račun bez otvaranja zahtjeva za povezivanje', async () => {
  const { provider, session } = await setup();
  assert.equal(session.state.account, SENDER);
  assert.equal(session.state.balance, parseEther('2'));
  assert.equal(provider.calls.some(({ method }) => ['eth_requestAccounts', 'eth_sendTransaction'].includes(method)), false);
  session.dispose();
  assert.equal(provider.eventNames().length, 0);
});

test('novi korisnik povezuje račun izričitim zahtjevom', async () => {
  const { provider, session } = await setup({ accounts: [] });
  assert.equal(session.state.account, null);
  await session.connect();
  assert.equal(session.state.account, SENDER);
  assert.equal(session.state.busy, null);
  assert.equal(provider.calls.filter(({ method }) => method === 'eth_requestAccounts').length, 1);
});

test('odbijeno povezivanje vraća stanje bez zaglavljenog gumba', async () => {
  const { provider, session } = await setup({ accounts: [] });
  provider.overrides.eth_requestAccounts = () => { throw Object.assign(new Error('Rejected'), { code: 4001 }); };
  await assert.rejects(session.connect(), { code: 4001 });
  assert.equal(session.state.busy, null);
  assert.equal(session.state.account, null);
  assert.equal(walletError({ code: 4001 }), 'Zahtjev je odbijen u MetaMasku.');
});

test('slanje šalje točan račun, adresu, wei iznos i odabranu mrežu', async () => {
  const { provider, session } = await setup();
  assert.equal(await session.send(RECIPIENT, '0,001000000000000001'), HASH);
  const sent = provider.calls.find(({ method }) => method === 'eth_sendTransaction');
  assert.deepEqual(sent.params, [{ from: SENDER, to: RECIPIENT, value: `0x${1000000000000001n.toString(16)}`, chainId: '0xaa36a7' }]);
  assert.equal(session.state.transaction.status, 'pending');
  assert.equal(session.state.busy, null);
});

test('nevaljana adresa ne otvara MetaMask potvrdu', async () => {
  const { provider, session } = await setup();
  await assert.rejects(session.send('0xabc', '0,1'), /adresu/);
  assert.equal(provider.calls.some(({ method }) => method === 'eth_sendTransaction'), false);
});

test('slanje zahtijeva povezan račun i podržanu mrežu', async () => {
  const disconnected = await setup({ accounts: [] });
  await assert.rejects(disconnected.session.send(RECIPIENT, '0,1'), /poveži/);
  const unsupported = await setup({ chainId: '0x89' });
  await assert.rejects(unsupported.session.send(RECIPIENT, '0,1'), /Odaberi/);
  assert.equal(unsupported.provider.calls.some(({ method }) => method === 'eth_sendTransaction'), false);
});

test('nedovoljno sredstava za iznos i naknadu blokira slanje', async () => {
  const { provider, session } = await setup({ balance: parseEther('0,1') });
  await assert.rejects(session.send(RECIPIENT, '0,1'), /naknadu/);
  assert.equal(provider.calls.some(({ method }) => method === 'eth_sendTransaction'), false);
  assert.equal(session.state.busy, null);
});

test('promjena računa tijekom procjene naknade zaustavlja slanje', async () => {
  const { provider, session } = await setup();
  provider.overrides.eth_estimateGas = () => {
    provider.accounts = [OTHER];
    provider.emit('accountsChanged', provider.accounts);
    return '0x5208';
  };
  await assert.rejects(session.send(RECIPIENT, '0,1'), /promijenili/);
  assert.equal(provider.calls.some(({ method }) => method === 'eth_sendTransaction'), false);
});

test('promjena mreže bez događaja otkriva se prije konačnog zahtjeva za slanje', async () => {
  const { provider, session } = await setup();
  provider.overrides.eth_estimateGas = () => { provider.chainId = '0x1'; return '0x5208'; };
  await assert.rejects(session.send(RECIPIENT, '0,1'), /promijenili/);
  assert.equal(provider.calls.some(({ method }) => method === 'eth_sendTransaction'), false);
});

test('dvostruki klik i ponovno slanje dok je prijenos u obradi ne šalju duplikat', async () => {
  const { provider, session } = await setup();
  let release;
  const approval = new Promise((resolve) => { release = resolve; });
  provider.overrides.eth_sendTransaction = () => approval;
  const first = session.send(RECIPIENT, '0,1');
  await assert.rejects(session.send(RECIPIENT, '0,1'), /trenutni zahtjev/);
  release(HASH);
  await first;
  await assert.rejects(session.send(RECIPIENT, '0,1'), /prethodne/);
  assert.equal(provider.calls.filter(({ method }) => method === 'eth_sendTransaction').length, 1);
});

test('odbijena potvrda transakcije dopušta ispravak i ponovni pokušaj', async () => {
  const { provider, session } = await setup();
  provider.overrides.eth_sendTransaction = () => { throw Object.assign(new Error('Rejected'), { code: 4001 }); };
  await assert.rejects(session.send(RECIPIENT, '0,1'), { code: 4001 });
  assert.equal(session.state.transaction, null);
  assert.equal(session.state.busy, null);
  delete provider.overrides.eth_sendTransaction;
  await session.send(RECIPIENT, '0,1');
  assert.equal(session.state.transaction.status, 'pending');
});

test('hash nije potvrda: tek uspješan receipt prikazuje potvrđen prijenos', async () => {
  const { provider, session } = await setup();
  await session.send(RECIPIENT, '0,1');
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'pending');
  provider.receipt = { status: '0x1', transactionHash: HASH };
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'confirmed');
});

test('neuspješna transakcija na mreži razlikuje se od uspješne', async () => {
  const { provider, session } = await setup();
  await session.send(RECIPIENT, '0,1');
  provider.receipt = { status: '0x0', transactionHash: HASH };
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'failed');
});

test('provjera potvrde čeka ispravnu mrežu i zadržava izvorni chain ID', async () => {
  const { provider, session } = await setup();
  await session.send(RECIPIENT, '0,1');
  provider.chainId = '0x1';
  provider.receipt = { status: '0x1' };
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'pending');
  assert.equal(session.state.transaction.chainId, '0xaa36a7');
  assert.equal(provider.calls.some(({ method }) => method === 'eth_getTransactionReceipt'), false);
  provider.chainId = '0xaa36a7';
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'confirmed');
});

test('zakašnjeli odgovor za stari račun ne prepisuje novo stanje', async () => {
  const { provider, session } = await setup();
  let release;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  provider.overrides.eth_getBalance = () => { started(); return new Promise((resolve) => { release = resolve; }); };
  const oldRefresh = session.refresh();
  await waiting;
  delete provider.overrides.eth_getBalance;
  provider.accounts = [OTHER];
  provider.balance = parseEther('3');
  provider.emit('accountsChanged', provider.accounts);
  await session.refresh();
  release('0x0');
  await oldRefresh;
  assert.equal(session.state.account, OTHER);
  assert.equal(session.state.balance, parseEther('3'));
});

test('promjena mreže koristi Sepolia chain ID i osvježava stanje', async () => {
  const { provider, session } = await setup({ chainId: '0x1' });
  await session.switchToSepolia();
  assert.equal(session.state.chainId, '0xaa36a7');
  assert.deepEqual(provider.calls.find(({ method }) => method === 'wallet_switchEthereumChain').params, [{ chainId: '0xaa36a7' }]);
});

test('odspajanje opoziva pristup i onemogućuje slanje', async () => {
  const { provider, session } = await setup();
  await session.disconnect();
  assert.equal(session.state.account, null);
  assert.equal(session.state.balance, null);
  assert.equal(provider.calls.some(({ method }) => method === 'wallet_revokePermissions'), true);
  await assert.rejects(session.send(RECIPIENT, '0,1'), /poveži/);
});

test('kratki prekid mreže ne označuje poslanu transakciju neuspješnom', async () => {
  const { provider, session } = await setup();
  await session.send(RECIPIENT, '0,1');
  provider.overrides.eth_getTransactionReceipt = () => { throw new Error('Offline'); };
  await session.checkReceipt();
  assert.equal(session.state.transaction.status, 'pending');
  assert.match(session.state.transaction.monitorNote, /predana mreži/);
});

test('istodobna ručna i automatska provjera potvrde dijele isti zahtjev', async () => {
  const { provider, session } = await setup();
  await session.send(RECIPIENT, '0,1');
  let release;
  provider.overrides.eth_getTransactionReceipt = () => new Promise((resolve) => { release = resolve; });
  const first = session.checkReceipt();
  const second = session.checkReceipt();
  // Allow the chain ID read to complete before resolving the simulated receipt.
  await new Promise((resolve) => setImmediate(resolve));
  release({ status: '0x1' });
  await Promise.all([first, second]);
  assert.equal(provider.calls.filter(({ method }) => method === 'eth_getTransactionReceipt').length, 1);
  assert.equal(session.state.transaction.status, 'confirmed');
});
