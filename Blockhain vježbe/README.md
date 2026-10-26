# BlockLab — blockchain vježbe

Frontend na hrvatskom za povezivanje vlastitog MetaMask novčanika i slanje **native ETH-a** kolegi. Koristi HTML, CSS i JavaScript, bez vanjskih biblioteka, API ključeva ili instalacije paketa.

## Pokretanje

Potreban je Node.js 20 ili noviji. U ovoj mapi pokreni:

```sh
npm run dev
```

Otvori [http://localhost:5173](http://localhost:5173) u pregledniku s instaliranim [MetaMaskom](https://metamask.io/download/). Poslužitelj sluša samo na ovom računalu. Koristi HTTP adresu, umjesto otvaranja `index.html` izravno s diska.

## Slanje kolegi

1. Klikni **Poveži MetaMask** i odobri račun u MetaMasku.
2. Odaberi mrežu u MetaMasku. Za vježbu klikni **Prebaci na Sepoliju**; ako nije dostupna, uključi prikaz testnih mreža u MetaMasku. Oba novčanika trebaju koristiti istu mrežu, a pošiljatelj treba imati dovoljno ETH-a za iznos i naknadu.
3. Unesi koleginu `0x…` adresu i iznos ETH-a. Podržani su zarez i točka te do 18 decimalnih mjesta.
4. Klikni **Nastavi u MetaMasku**, provjeri primatelja, mrežu, iznos i naknadu, pa osobno potvrdi slanje u novčaniku.
5. Prati **Status transakcije**. Hash označava da je zahtjev poslan; uspjeh se prikazuje tek nakon uspješne potvrde na mreži. Na Ethereum i Sepolia mreži dostupan je link na explorer.

Podržane su Ethereum Mainnet (`1`), Sepolia (`11155111`) i lokalne Ethereum mreže s ID-jem `31337` ili `1337`. Lokalne mreže moraju već biti dodane u MetaMask. Na ostalim mrežama slanje je onemogućeno kako se native valuta ne bi pogrešno prikazala kao ETH. ERC-20 tokeni nisu uključeni.

Povezivanje otkriva MetaMask kroz EIP-6963, uz kompatibilnost sa starijim `window.ethereum` providerom. Stranica reagira na promjene računa i mreže, provjerava stanje i procijenjenu naknadu te iznose pretvara u wei bez decimalnog zaokruživanja. Potpisivanje i slanje obavlja MetaMask; frontend ne traži seed frazu ili privatni ključ. Nije potreban pametni ugovor.

Status prati posljednju transakciju tijekom otvorene sesije i provjerava potvrdu približno svakih 4 sekunde, najviše 5 minuta. Nakon toga koristi **Provjeri status** ili explorer. Osvježavanje stranice briše prikaz statusa; poslana transakcija ostaje u aktivnosti MetaMaska i na mreži. Ne ponavljaj nejasno ili dugo slanje prije provjere njegova ishoda. Naknadu konačno određuje MetaMask, pa se može razlikovati od procjene.

Za mobilni uređaj koristi MetaMaskov preglednik i sigurnu, dostupnu adresu na kojoj je frontend poslužen. `localhost` ovog računala nije dostupan s drugog uređaja. Povezivanje putem QR koda nije uključeno.

## Provjera

```sh
npm test
```

Testovi koriste simulirani EIP-1193 provider. Provjeravaju točnost iznosa, slanje, odbijene zahtjeve, nedovoljna sredstva, promjene računa/mreže, zaštitu od dvostrukog slanja i statuse potvrde. Testovi ne šalju stvarni ETH.

## Datoteke

- `index.html`, `styles.css` — prilagodljivo sučelje na hrvatskom.
- `app.js` — događaji i prikaz stanja.
- `wallet.js` — MetaMask provider, validacija iznosa i životni ciklus transakcije.
- `server.js` — lokalni poslužitelj.
- `tests/wallet.test.js` — testovi povezivanja i transakcija.

Za ručnu provjeru cijelog sučelja sa simuliranim novčanikom pokreni `node tests/browser-preview.js` i otvori `http://localhost:5174`. Taj odvojeni testni poslužitelj ne koristi pravi novčanik ni blockchain. Dodatni scenariji su `?scenario=reject-connect`, `?scenario=reject-send`, `?scenario=insufficient` i `?scenario=failed`. Uobičajena aplikacija na portu 5173 nikada ne učitava simulirani novčanik.

Integracija prati službenu dokumentaciju: [MetaMask provider API](https://docs.metamask.io/metamask-connect/evm/reference/provider-api/), [eth_sendTransaction](https://docs.metamask.io/metamask-connect/evm/reference/json-rpc-api/eth_sendTransaction/) i [EIP-6963](https://eips.ethereum.org/EIPS/eip-6963).
