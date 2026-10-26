## T2 — Povezivanje MetaMaska i slanje transakcija (26.10.2026)

- Cilj termina: Izrada frontenda za povezivanje MetaMask novčanika i slanje ETH-a kolegi.
- Najkorisniji prompt (kopiran u cijelosti): "U frontendu napravi da se mogu spojiti sa svojim meta mask walletom i da mogu poslati transakciju kolegi"
- Što je AI napravio dobro: Omogućio je povezivanje MetaMaska, prikaz računa, mreže i stanja te unos adrese primatelja i iznosa. Dodao je provjeru podataka, praćenje statusa transakcije i prebacivanje na Sepolia testnu mrežu.
- Što je AI napravio drugačije nego što sam očekivao: Zbog prazne radne mape izradio je novi frontend umjesto izmjene postojećeg. Nakon provjere zaustavio je aplikaciju pa ju je trebalo ponovno pokrenuti.
- Što sam dodao u AGENTS.md: Ništa nije dodano.
- Provjera: Prošla su sva 23 automatizirana testa. Povezivanje, slanje i odbijanje zahtjeva provjereni su simuliranim novčanikom. Stvarnu transakciju između dva MetaMask računa još treba provjeriti.
- Commit: c2594ce
 .