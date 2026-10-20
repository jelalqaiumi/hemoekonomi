# hemochekonomi

Hem och Ekonomi: en gratis webbapp för hushållets månadsbudget. Användaren
skapar ett konto med e-post och lösenord, och allt sparas per konto i
PostgreSQL (Neon i drift, PGlite lokalt och i testerna). Se "Del 10" i
`ARKITEKTUR.md`.

## Kör projektet

```
npm install
npm start
npm test
```

`npm install` hämtar projektets två beroenden, `pg` och
`@electric-sql/pglite`. Den måste köras innan `npm start` och `npm test`.
`npm start` startar servern på http://127.0.0.1:3000 — öppna adressen i
webbläsaren. Utan `DATABASE_URL` sparar den i en lokal PGlite-katalog.
`npm test` kör `node --test "tests/**/*.test.js"`. Argumentet måste vara ett
glob-mönster inom citationstecken; `node --test tests/` misslyckas på Node 24
med `Cannot find module ...\tests`. Verifierat på Node v24.19.0.

## Regler för det här projektet

- All text mot användaren ska vara på svenska. Kod, filnamn och variabelnamn
  skrivs på engelska.
- Inga nya beroenden utöver `pg` och `@electric-sql/pglite`. Ett nytt beroende
  kräver en egen rad i teknikvalstabellen i `ARKITEKTUR.md` innan det
  installeras — annars är det ett fel.
- Datalagret är asynkront: varje anrop till `db.js` och till funktionerna
  ovanpå det ska ha `await`.
- `ARKITEKTUR.md` är bindande. Fältnamn, felmeddelanden, avrundningsregel,
  datumregel och funktionssignaturer följs ordagrant. Behöver något ändras:
  ändra `ARKITEKTUR.md` först, bygg sedan.
- Belopp räknas alltid i heltal öre. Ingen addition eller division av kronor som
  flyttal.
- Datum är alltid strängar på formen `YYYY-MM-DD`. Inga `Date`-objekt i
  datamodellen och ingen lokal tolkning av datumsträngar.
- Filer i `src/core/` får bara importera från `src/core/`. Inga `node:`-moduler
  där — samma filer körs i webbläsaren.
- Klockan läses på exakt ett ställe: `todayIso()` i `src/core/dates.js`. Alla
  andra funktioner tar emot dagens datum som parameter, annars går de inte att
  testa.
- Testfiler ligger i `tests/` och måste sluta på `.test.js`, annars körs de
  inte.
- All användarinput valideras explicit och valideringen har egna tester. Ett
  paket som tar emot input utan testad validering är inte klart.
- Kod som inte körts är inte färdig kod. `npm test` ska ge `fail 0` och exit 0
  innan ett paket lämnas vidare — kontrollera utgångskoden, inte bara
  utskriften.

## Teamets minne

@LARDOMAR.md

Reglerna under "Regel framåt" i filen ovan är bindande. Läs dem innan du
ändrar något. Bryter du mot en av dem är det ett fel, även om koden fungerar.

## Arbetsgång

`projektledare` → `arkitekt` → `byggare` → `granskare` → `dokumentator`

Kör alltid `granskare` innan ett arbetspaket räknas som klart.
