import { NETWORKS, WalletSession, findLegacyMetaMask, formatEther, parseEther, validateRecipient, walletError } from './wallet.js';

const element = (id) => document.getElementById(id);
const recipient = element('recipient');
const amount = element('amount');
let session = null;
let initializing = null;
let toastTimer;
let lastTransactionHash = null;

function showError(error) {
  element('error-text').textContent = walletError(error);
  element('error-banner').hidden = false;
}
function clearError() { element('error-banner').hidden = true; }
function toast(message) {
  clearTimeout(toastTimer);
  element('toast').textContent = message;
  element('toast').hidden = false;
  toastTimer = setTimeout(() => { element('toast').hidden = true; }, 3500);
}
function shorten(address) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }
function fieldError(name, message = '') {
  const field = element(name);
  field.setAttribute('aria-invalid', String(Boolean(message)));
  element(`${name}-error`).textContent = message;
  element(`${name}-error`).hidden = !message;
}
function validateFields() {
  let valid = true;
  try { validateRecipient(recipient.value, session?.state.account); fieldError('recipient'); }
  catch (error) { fieldError('recipient', error.message); valid = false; }
  try { parseEther(amount.value); fieldError('amount'); }
  catch (error) { fieldError('amount', error.message); valid = false; }
  if (!valid) document.querySelector('[aria-invalid="true"]')?.focus();
  return valid;
}
function updateAmountSummary() {
  try { element('summary-amount').textContent = `${formatEther(parseEther(amount.value))} ETH`; }
  catch { element('summary-amount').textContent = '— ETH'; }
}

function renderTransaction(transaction) {
  element('activity-empty').hidden = Boolean(transaction);
  element('transaction-details').hidden = !transaction;
  if (!transaction) return;
  const network = NETWORKS[transaction.chainId];
  element('transaction-details').dataset.status = transaction.status;
  const statuses = {
    pending: ['U obradi · čeka potvrdu mreže', `${formatEther(transaction.value)} ETH poslano je na mrežu. Potvrda se provjerava automatski.`],
    confirmed: ['Transakcija je potvrđena', `${formatEther(transaction.value)} ETH uspješno je poslano kolegi.`],
    failed: ['Transakcija nije uspjela', 'Mreža je obradila transakciju, ali prijenos nije uspio. Mrežna naknada može biti naplaćena.'],
    unknown: ['Poslano · potvrda još nije dostupna', 'Prije novog slanja provjeri ovu transakciju u MetaMasku ili exploreru.'],
  };
  const [title, description] = statuses[transaction.status];
  element('transaction-status').textContent = title;
  element('transaction-description').textContent = transaction.monitorNote || description;
  element('transaction-network').textContent = network?.name ?? transaction.chainId;
  element('transaction-recipient').textContent = transaction.to;
  element('transaction-hash').textContent = transaction.hash;
  const explorer = element('transaction-explorer');
  explorer.hidden = !network?.explorer;
  if (network?.explorer) explorer.href = `${network.explorer}${transaction.hash}`;
  else explorer.removeAttribute('href');
  element('check-transaction').hidden = !['pending', 'unknown'].includes(transaction.status);
  if (lastTransactionHash !== transaction.hash) {
    lastTransactionHash = transaction.hash;
    amount.value = '';
    updateAmountSummary();
  }
}

function render(state = { account: null, chainId: null, balance: null, busy: null, transaction: null }) {
  const connected = Boolean(state.account);
  const network = NETWORKS[state.chainId];
  const busy = Boolean(state.busy);
  const pending = ['pending', 'unknown'].includes(state.transaction?.status);
  element('network-name').textContent = connected ? (network?.name ?? `Mreža ${state.chainId ?? 'nedostupna'}`) : 'Novčanik nije povezan';
  element('network-pill').classList.toggle('connected', connected);
  element('balance').textContent = !network || state.balance === null ? '—' : (state.balance > 0n && state.balance < 10n ** 10n ? '< 0,00000001' : formatEther(state.balance, 8));
  element('balance-note').textContent = connected
    ? (!network ? 'Odaberi podržanu Ethereum mrežu.' : state.balanceError || (state.balance === null ? 'Učitavanje stanja…' : network.testnet ? 'Testna mreža · ETH za vježbu' : 'Ethereum mreža · stvarni ETH'))
    : 'Stanje će se prikazati nakon povezivanja.';
  element('wallet-caption').textContent = connected ? shorten(state.account) : 'Sve počinje povezivanjem.';
  element('wallet-caption').title = state.account ?? '';
  element('connect-wallet').hidden = connected;
  element('connect-wallet').disabled = busy;
  element('connect-label').textContent = state.busy === 'connecting' ? 'Potvrdi u MetaMasku…' : 'Poveži MetaMask';
  element('connected-actions').hidden = !connected;
  element('account-short').textContent = connected ? shorten(state.account) : '';
  element('copy-address').disabled = busy;
  element('copy-address').title = connected ? `Kopiraj adresu: ${state.account}` : 'Kopiraj adresu';
  element('disconnect-wallet').disabled = busy;
  const status = element('wallet-status');
  status.replaceChildren();
  const dot = document.createElement('span');
  dot.className = 'dot';
  status.append(dot, document.createTextNode(connected ? 'MetaMask povezan' : state.busy === 'connecting' ? 'Čeka odobrenje…' : 'Čeka povezivanje'));
  status.classList.toggle('connected', connected);
  element('summary-network').textContent = connected ? (network?.name ?? 'Nepodržana mreža') : '—';
  recipient.disabled = busy;
  amount.disabled = busy;
  document.querySelectorAll('[data-amount]').forEach((button) => { button.disabled = busy; });
  element('send-transaction').disabled = !connected || !network || busy || pending;
  element('send-transaction').setAttribute('aria-busy', String(state.busy === 'sending'));
  element('send-label').textContent = state.busy === 'sending' ? 'Provjeri i potvrdi u MetaMasku…' : pending ? 'Čeka se prethodna transakcija…' : 'Nastavi u MetaMasku';
  element('form-note').textContent = !connected ? 'Najprije poveži novčanik da omogućiš slanje.'
    : pending ? 'Prati potvrdu prethodnog prijenosa u statusu transakcije.'
    : 'Adresu, mrežnu naknadu i konačan iznos potvrđuješ u MetaMasku.';
  const warning = element('network-warning');
  warning.hidden = !connected || Boolean(network?.testnet);
  warning.textContent = network
    ? 'Na Ethereum Mainnet mreži šalješ stvarni ETH. Provjeri mrežu i adresu kolege prije potvrde.'
    : 'Ova mreža nije podržana. Odaberi Ethereum Mainnet, Sepoliju ili lokalnu mrežu (31337 ili 1337).';
  element('switch-sepolia').disabled = !connected || busy || state.chainId === '0xaa36a7';
  element('switch-sepolia').textContent = state.chainId === '0xaa36a7' && connected ? 'Sepolia je aktivna ✓' : state.busy === 'switching' ? 'Potvrdi promjenu u MetaMasku…' : 'Prebaci na Sepoliju ↗';
  renderTransaction(state.transaction);
}

function attachProvider(provider) {
  if (session || !provider || typeof provider.request !== 'function') return;
  session = new WalletSession(provider, { onChange: render });
  element('wallet-missing').hidden = true;
  initializing = session.initialize().catch(showError);
}

// Prefer EIP-6963 to avoid choosing another extension's window.ethereum.
window.addEventListener('eip6963:announceProvider', (event) => {
  if (event.detail?.info?.rdns === 'io.metamask') attachProvider(event.detail.provider);
});
window.dispatchEvent(new Event('eip6963:requestProvider'));
function discoverFallback() { attachProvider(findLegacyMetaMask(window.ethereum)); }
window.addEventListener('ethereum#initialized', discoverFallback, { once: true });
setTimeout(() => {
  discoverFallback();
  element('wallet-missing').hidden = Boolean(session);
}, 500);

element('connect-wallet').addEventListener('click', async () => {
  clearError();
  window.dispatchEvent(new Event('eip6963:requestProvider'));
  discoverFallback();
  if (!session) {
    element('wallet-missing').hidden = false;
    showError(new Error('MetaMask nije dostupan u ovom pregledniku. Otvori stranicu u pregledniku s instaliranim MetaMaskom.'));
    return;
  }
  try { await initializing; await session.connect(); }
  catch (error) { showError(error); }
});
element('disconnect-wallet').addEventListener('click', async () => {
  clearError();
  try { await session.disconnect(); toast('Novčanik je odspojen.'); }
  catch (error) { showError(error); }
});
element('copy-address').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(session.state.account); toast('Adresa novčanika je kopirana.'); }
  catch { showError(new Error('Kopiranje nije dostupno. Cijelu adresu možeš kopirati iz MetaMaska.')); }
});
element('switch-sepolia').addEventListener('click', async () => {
  clearError();
  try { await session.switchToSepolia(); }
  catch (error) { showError(error); }
});
element('transfer-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  clearError();
  if (!session?.state.account) { showError(new Error('Najprije poveži MetaMask.')); return; }
  if (!validateFields()) return;
  try { await session.send(recipient.value, amount.value); }
  catch (error) { showError(error); }
});
element('check-transaction').addEventListener('click', async () => {
  const button = element('check-transaction');
  button.disabled = true;
  button.textContent = 'Provjeravam…';
  try { await session?.checkReceipt(); }
  finally { button.disabled = false; button.textContent = 'Provjeri status'; }
});
element('dismiss-error').addEventListener('click', clearError);
for (const field of [recipient, amount]) {
  field.addEventListener('input', () => { fieldError(field.id); updateAmountSummary(); });
  field.addEventListener('blur', () => {
    if (!field.value.trim()) return;
    try {
      if (field === recipient) validateRecipient(field.value, session?.state.account);
      else parseEther(field.value);
      fieldError(field.id);
    } catch (error) { fieldError(field.id, error.message); }
  });
}
document.querySelectorAll('[data-amount]').forEach((button) => button.addEventListener('click', () => {
  amount.value = button.dataset.amount;
  fieldError('amount');
  updateAmountSummary();
  amount.focus();
}));
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && session) {
    session.refresh().catch(() => {});
    session.checkReceipt();
  }
});
window.addEventListener('pagehide', (event) => { if (!event.persisted) session?.dispose(); });
render();
