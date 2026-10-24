# Eurojackpot AI WEB

Samostatná webová aplikace inspirovaná vzhledem Extra Renty. Generuje 6 sloupců po 5 hlavních číslech (1–50) a 2 Euro číslech (1–12). Statistiky a adaptivní heuristika vycházejí z dodaného `generuj_predikci.py`. Historická četnost není zárukou predikce náhodného losování.

## Nasazení

1. Vytvoř **nový** GitHub repozitář (např. `Eurojackpot-AI`), neměň repozitář Extra Renty.
2. Nahraj **obsah této složky** do kořene nového repozitáře, včetně `.github/workflows/`.
3. V GitHub `Settings → Pages` nastav `Deploy from a branch`, větev `main`, složka `/(root)`.
4. Otevři URL GitHub Pages. První načtení používá přibalené CSV.
5. V `Nastavení · GitHub` zadej uživatele, název nového repozitáře a fine-grained token s `Contents: Read and write` **pouze pro nový repozitář**. Token nikam neukládej do souborů repozitáře.
6. Pro první vytvoření `euro-data.json` použij `Uložit společnou`. Na dalších zařízeních `Nastavit přístup` načte společnou verzi.

## Důležité

- Veřejný GitHub repozitář znamená, že soubor `euro-data.json` a historie sázek jsou veřejně čitelné. Pro soukromé sázky to není vhodné.
- Kalendář povoluje úterky a pátky. **Čas uzávěrky 18:30 je převzatý z Extra Renty a před reálným sázením musí být ověřen pro Eurojackpot.**
- Automatizace výsledků běží ve středu a v sobotu ráno (UTC), ale **scraper je převzatý z dodaného Pythonu a musí být ověřen vůči aktuální podobě zdrojového webu**. Neúspěšné stažení nesmí být zaměňováno za úspěšnou aktualizaci.
- Aplikace je čistě klientská, bez serverového Pythonu nebo Excelu. Algoritmus v JavaScriptu je převod hlavních pravidel Python verze, nikoliv bitově identická implementace.
- Při konfliktu synchronizace nejdříve exportuj JSON zálohu. Neodstraňuj data prohlížeče bez zálohy.

## Offline spuštění

Rozbal celý ZIP do jedné složky a otevři `index.html` dvojklikem. `initial-data.js` musí být ve stejné složce. Generování, ukládání a vyhodnocení známých losování funguje bez serveru. Nové výsledky a GitHub synchronizace vyžadují internet.
