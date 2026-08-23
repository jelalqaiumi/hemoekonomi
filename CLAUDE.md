# hemochekonomi

En lokal app som håller koll på hemmets fasta utgifter och prenumerationer och
visar månadskostnad, årskostnad och vad som dras härnäst.

## Kör projektet

```
npm install
npm start
npm test
```

`npm install` hämtar inga beroenden — projektet har noll. Den skapar bara
`package-lock.json` och kan hoppas över.
`npm start` startar servern på http://127.0.0.1:3000 — öppna adressen i
webbläsaren.
`npm test` kör `node --test "tests/**/*.test.js"`. Argumentet måste vara ett
glob-mönster inom citationstecken; `node --test tests/` misslyckas på Node 24
med `Cannot find module ...\tests`. Verifierat på Node v24.19.0.

## Regler för det här projektet

- All text mot användaren ska vara på svenska. Kod, filnamn och variabelnamn
  skrivs på engelska.
- Inga nya beroenden. Ett nytt beroende kräver en egen rad i teknikvalstabellen
  i `ARKITEKTUR.md` innan det installeras — annars är det ett fel.
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
