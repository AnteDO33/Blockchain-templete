export const NETWORKS = Object.freeze({
  '0x1': { name: 'Ethereum Mainnet', explorer: 'https://etherscan.io/tx/', testnet: false },
  '0xaa36a7': { name: 'Sepolia', explorer: 'https://sepolia.etherscan.io/tx/', testnet: true },
  '0x7a69': { name: 'Localhost · 31337', explorer: null, testnet: true },
  '0x539': { name: 'Localhost · 1337', explorer: null, testnet: true },
});
const WEI = 10n ** 18n;
const ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const HASH = /^0x[0-9a-fA-F]{64}$/;

export function normalizeChainId(chainId) {
  if (!/^0x[0-9a-f]+$/i.test(String(chainId))) throw new Error('Novčanik je vratio neispravnu mrežu.');
  return `0x${BigInt(chainId).toString(16)}`;
}

export function parseEther(input) {
  const value = String(input).trim().replace(',', '.');
  if (!/^(?:0|[1-9]\d*|0\d+)\.\d{1,18}$|^\d+$/.test(value) || value.length > 100) {
    throw new Error('Unesi pozitivan iznos s najviše 18 decimalnih mjesta (npr. 0,001).');
  }
  const [whole, fraction = ''] = value.split('.');
  const wei = BigInt(whole) * WEI + BigInt(fraction.padEnd(18, '0'));
  if (wei <= 0n) throw new Error('Iznos mora biti veći od nule.');
  if (wei >= 2n ** 256n) throw new Error('Iznos je prevelik.');
  return wei;
}

export function formatEther(wei, digits = 18) {
  const value = BigInt(wei);
  const fraction = (value % WEI).toString().padStart(18, '0').slice(0, digits).replace(/0+$/, '');
  return `${value / WEI}${fraction ? `,${fraction}` : ''}`;
}

export function validateRecipient(input, sender) {
  const address = String(input).trim();
  if (!ADDRESS.test(address)) throw new Error('Unesi adresu koja počinje s 0x i ima 40 heksadekadskih znakova.');
  if (/^0x0{40}$/i.test(address)) throw new Error('Nulta adresa nije valjana adresa kolege.');
  if (address.toLowerCase() === sender?.toLowerCase()) throw new Error('Unesena je tvoja adresa. Unesi adresu kolege.');
  return address;
}

export function walletError(error) {
  const code = Number(error?.code ?? error?.data?.originalError?.code);
  if (code === 4001) return 'Zahtjev je odbijen u MetaMasku.';
  if (code === -32002) return 'U MetaMasku već postoji otvoren zahtjev. Otvori novčanik i dovrši ga.';
  if (code === 4100) return 'MetaMask nije odobrio pristup računu. Ponovno poveži novčanik.';
  if (code === 4900 || code === 4901) return 'MetaMask nema vezu s mrežom. Provjeri mrežu u novčaniku.';
  if (code === 4902) return 'Sepolia nije dodana u MetaMask. Uključi prikaz testnih mreža i odaberi Sepoliju.';
  if (/insufficient funds/i.test(error?.message ?? '')) return 'Nema dovoljno ETH-a za iznos i mrežnu naknadu.';
  return String(error?.message || 'Zahtjev nije uspio. Provjeri MetaMask i pokušaj ponovno.').slice(0, 280);
}

export function findLegacyMetaMask(ethereum) {
  const providers = ethereum?.providers ?? [ethereum];
  return providers.find((provider) => provider?.isMetaMask && typeof provider.request === 'function') ?? null;
}

// All signing stays in MetaMask. The app only uses its public EIP-1193 provider.
export class WalletSession {
  constructor(provider, { onChange = () => {}, pollInterval = 4000, maxReceiptChecks = 75 } = {}) {
    this.provider = provider;
    this.onChange = onChange;
    this.pollInterval = pollInterval;
    this.maxReceiptChecks = maxReceiptChecks;
    this.state = { account: null, chainId: null, balance: null, busy: null, transaction: null };
    this.contextVersion = 0;
    this.refreshId = 0;
    this.suspended = false;
    this.disposed = false;
    this.timer = null;
    this.receiptChecks = 0;
    this.listeners = {
      accountsChanged: (accounts) => {
        if (this.suspended) return;
        const account = this.readAccount(accounts);
        if (account?.toLowerCase() !== this.state.account?.toLowerCase()) {
          this.contextVersion++;
          this.update({ account, balance: null });
        }
        this.refresh().catch(() => {});
      },
      chainChanged: (chainId) => {
        try {
          const normalized = normalizeChainId(chainId);
          if (normalized !== this.state.chainId) {
            this.contextVersion++;
            this.update({ chainId: normalized, balance: null });
          }
          this.refresh().catch(() => {});
        } catch {
          this.contextVersion++;
          this.update({ chainId: null, balance: null });
        }
      },
      disconnect: () => {
        this.contextVersion++;
        this.refreshId++;
        this.update({ account: null, chainId: null, balance: null });
      },
      connect: () => { this.refresh().catch(() => {}); },
    };
  }

  get snapshot() { return { ...this.state, transaction: this.state.transaction && { ...this.state.transaction } }; }
  get network() { return NETWORKS[this.state.chainId] ?? null; }
  get hasPendingTransaction() { return ['pending', 'unknown'].includes(this.state.transaction?.status); }
  readAccount(accounts) { return Array.isArray(accounts) && ADDRESS.test(accounts[0]) ? accounts[0] : null; }
  request(method, params) { return this.provider.request(params ? { method, params } : { method }); }
  update(patch) {
    if (this.disposed) return;
    Object.assign(this.state, patch);
    this.onChange(this.snapshot);
  }

  async initialize() {
    for (const [event, listener] of Object.entries(this.listeners)) this.provider.on?.(event, listener);
    await this.refresh();
  }

  async refresh() {
    if (this.suspended || this.disposed) return;
    const id = ++this.refreshId;
    const version = this.contextVersion;
    const [accounts, chain] = await Promise.all([this.request('eth_accounts'), this.request('eth_chainId')]);
    const account = this.readAccount(accounts);
    const chainId = normalizeChainId(chain);
    let balance = null;
    let balanceError = null;
    if (account) {
      try { balance = BigInt(await this.request('eth_getBalance', [account, 'latest'])); }
      catch { balanceError = 'Stanje nije dostupno. Provjeri vezu s mrežom.'; }
    }
    // Ignore responses from an account/network that changed while RPC was running.
    if (this.disposed || this.suspended || id !== this.refreshId || version !== this.contextVersion) return;
    if (account?.toLowerCase() !== this.state.account?.toLowerCase() || chainId !== this.state.chainId) this.contextVersion++;
    this.update({ account, chainId, balance, balanceError });
  }

  async connect() {
    if (this.state.busy) return;
    this.suspended = false;
    this.update({ busy: 'connecting' });
    try {
      const accounts = await this.request('eth_requestAccounts');
      if (!this.readAccount(accounts)) throw new Error('MetaMask nije vratio račun. Otključaj novčanik i pokušaj ponovno.');
      await this.refresh();
    } finally { this.update({ busy: null }); }
  }

  async disconnect() {
    if (this.state.busy) return;
    this.update({ busy: 'disconnecting' });
    try {
      try { await this.request('wallet_revokePermissions', [{ eth_accounts: {} }]); }
      catch (error) {
        if (![4200, -32601].includes(Number(error?.code))) throw error;
      }
      this.suspended = true;
      this.contextVersion++;
      this.refreshId++;
      this.update({ account: null, chainId: null, balance: null });
    } finally { this.update({ busy: null }); }
  }

  async switchToSepolia() {
    if (this.state.busy) return;
    this.update({ busy: 'switching' });
    try {
      await this.request('wallet_switchEthereumChain', [{ chainId: '0xaa36a7' }]);
      await this.refresh();
    } finally { this.update({ busy: null }); }
  }

  assertContext(expected, accounts, chainId) {
    const account = this.readAccount(accounts);
    if (this.contextVersion !== expected.version || account?.toLowerCase() !== expected.account.toLowerCase()
      || normalizeChainId(chainId) !== expected.chainId) {
      throw new Error('Račun ili mreža su se promijenili. Provjeri podatke pa ponovno pokreni slanje.');
    }
  }

  async send(recipient, amount) {
    if (this.state.busy) throw new Error('Pričekaj da se trenutni zahtjev dovrši u MetaMasku.');
    if (this.hasPendingTransaction) throw new Error('Prvo provjeri status prethodne transakcije.');
    if (!this.state.account) throw new Error('Najprije poveži MetaMask.');
    if (!this.network) throw new Error('Odaberi Ethereum, Sepoliju ili lokalnu Ethereum mrežu (31337 ili 1337).');
    const to = validateRecipient(recipient, this.state.account);
    const value = parseEther(amount);
    const expected = { account: this.state.account, chainId: this.state.chainId, version: this.contextVersion };
    const transaction = { from: expected.account, to, value: `0x${value.toString(16)}` };
    this.update({ busy: 'sending' });
    try {
      const [accounts, chainId, balanceHex] = await Promise.all([
        this.request('eth_accounts'), this.request('eth_chainId'),
        this.request('eth_getBalance', [expected.account, 'pending']),
      ]);
      this.assertContext(expected, accounts, chainId);
      const balance = BigInt(balanceHex);
      if (value > balance) throw new Error('Nema dovoljno ETH-a za uneseni iznos.');
      const [gasHex, priceHex] = await Promise.all([
        this.request('eth_estimateGas', [transaction]), this.request('eth_gasPrice'),
      ]);
      this.assertContext(expected, accounts, chainId);
      if (value + BigInt(gasHex) * BigInt(priceHex) > balance) {
        throw new Error('Nema dovoljno ETH-a za iznos i procijenjenu mrežnu naknadu. Smanji iznos slanja.');
      }
      const [currentAccounts, currentChain] = await Promise.all([this.request('eth_accounts'), this.request('eth_chainId')]);
      this.assertContext(expected, currentAccounts, currentChain);
      // Bind the request to the reviewed chain; MetaMask performs final fee estimation.
      const hash = await this.request('eth_sendTransaction', [{ ...transaction, chainId: expected.chainId }]);
      if (!HASH.test(hash)) throw new Error('MetaMask nije vratio valjan hash. Provjeri aktivnost u novčaniku prije novog pokušaja.');
      this.receiptChecks = 0;
      this.update({ transaction: { hash, from: expected.account, to, value, chainId: expected.chainId, status: 'pending', monitorNote: '' } });
      this.scheduleReceipt();
      return hash;
    } finally { this.update({ busy: null }); }
  }

  scheduleReceipt() {
    clearTimeout(this.timer);
    if (!this.pollInterval || this.disposed || this.state.transaction?.status !== 'pending') return;
    this.timer = setTimeout(async () => {
      await this.checkReceipt();
      this.receiptChecks++;
      if (this.receiptChecks >= this.maxReceiptChecks && this.state.transaction?.status === 'pending') {
        this.update({ transaction: { ...this.state.transaction, status: 'unknown', monitorNote: 'Potvrda još nije dostupna. Provjeri status ručno ili otvori explorer. Nemoj ponavljati slanje dok ne utvrdiš ishod.' } });
      } else this.scheduleReceipt();
    }, this.pollInterval);
    this.timer.unref?.();
  }

  async checkReceipt() {
    if (this.receiptRequest) return this.receiptRequest;
    this.receiptRequest = this.readReceipt();
    try { return await this.receiptRequest; }
    finally { this.receiptRequest = null; }
  }

  async readReceipt() {
    const transaction = this.state.transaction;
    if (!transaction || !['pending', 'unknown'].includes(transaction.status)) return;
    try {
      const chainId = normalizeChainId(await this.request('eth_chainId'));
      if (chainId !== transaction.chainId) {
        this.update({ transaction: { ...transaction, monitorNote: `Za provjeru statusa vrati MetaMask na mrežu ${NETWORKS[transaction.chainId]?.name}.` } });
        return;
      }
      const receipt = await this.request('eth_getTransactionReceipt', [transaction.hash]);
      // A network change during the receipt request must not produce a false status.
      const currentChain = normalizeChainId(await this.request('eth_chainId'));
      if (this.disposed || this.state.transaction?.hash !== transaction.hash || currentChain !== transaction.chainId) return;
      if (receipt?.status != null) {
        clearTimeout(this.timer);
        this.update({ transaction: { ...transaction, status: BigInt(receipt.status) === 1n ? 'confirmed' : 'failed', monitorNote: '' } });
        await this.refresh().catch(() => {});
      } else {
        this.update({ transaction: { ...transaction, monitorNote: transaction.status === 'unknown' ? transaction.monitorNote : '' } });
      }
    } catch {
      if (this.state.transaction?.hash === transaction.hash) this.update({ transaction: { ...transaction, monitorNote: 'Provjera statusa trenutačno nije dostupna. Transakcija je predana mreži; provjeri je u exploreru ili pokušaj ponovno.' } });
    }
  }

  dispose() {
    this.disposed = true;
    this.contextVersion++;
    this.refreshId++;
    clearTimeout(this.timer);
    for (const [event, listener] of Object.entries(this.listeners)) this.provider.removeListener?.(event, listener);
  }
}
