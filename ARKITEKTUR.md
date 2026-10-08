# Arkitektur

Gäller paket 1 i `PLAN.md`. Allt här är bindande för paket 2–8. Byggaren ska
inte behöva fatta ett enda designbeslut som inte står i den här filen.

Avgränsningarna under "Beslut" i `PLAN.md` (bara utgifter, inga notiser, en
person på en enhet, ingen historik, SEK) är förutsatta och omprövas inte.

---

## Körsätt i korthet

| Steg | Kommando | Vad som händer |
|------|----------|----------------|
| Installera | `npm install` | Inga beroenden hämtas. Skapar `package-lock.json`. Kan hoppas över. |
| Starta | `npm start` | Startar en lokal HTTP-server på `http://127.0.0.1:3000`. Användaren öppnar adressen i sin webbläsare. |
| Testa | `npm test` | Kör `node --test "tests/**/*.test.js"`. |

**Verifierad miljö.** Node **v24.19.0** och npm 11.17.0 är installerade på
maskinen. `node --test` och `node:test`/`node:assert` är stabila sedan Node 20.
Ingen extern testkörare behövs.

**Körmiljön har en inbyggd `globalThis.fetch` men ingen DOM.** Granskarens
körning på den här maskinen:

```
typeof globalThis.fetch = function
globalThis.fetch === undefined: false
typeof globalThis.document = undefined
```

Det är ett villkor på varje krav som rör globaler i ett test, och det har redan
fällt ett: **ett test får aldrig kräva att `globalThis.fetch` är `undefined`
efter en återställning.** En laddare som sparar och lägger tillbaka det tidigare
värdet lägger tillbaka Nodes inbyggda funktion, vilket är rätt beteende — det
värde som ska jämföras är alltså det som lästes innan testfallen kördes, aldrig
`undefined`. `globalThis.document` saknas däremot i Node och får jämföras med
`undefined`. Den som skriver ett krav om en global i ett test kör de tre raderna
ovan först.

**Testkommandot måste vara ett glob-mönster, inte en katalog.** På Node 24
tolkas positionsargumentet till `--test` som ett glob-mönster. Ett
katalogargument matchar då ingenting, och Node faller tillbaka på att försöka
ladda `tests` som en modulfil:

```
node --test tests/
Error: Cannot find module C:\...\hemochekonomi\tests
tests 1 | pass 0 | fail 1 | EXIT=1
```

Verifierat fungerande på den här maskinen (21 tester, EXIT=0):

```
node --test "tests/**/*.test.js"
```

Citationstecknen är obligatoriska. De hindrar skalet från att expandera
mönstret innan Node ser det — utan dem beter sig kommandot olika i PowerShell,
cmd och bash. I `package.json` skrivs de som `\"` (se blocket längre ned).

`node --test` helt utan argument fungerar också och använder Nodes egen
rekursiva filsökning. Det är den godkända reservvarianten om globmönstret
någon gång slutar fungera, men det explicita mönstret är förstahandsvalet
eftersom det binder testerna till `tests/`.

> Not till byggaren: kör `node --version` och `npm test` en gång och se att de
> går igenom innan paket 2 anses påbörjat. Skapa `tests/smoke.test.js` med ett
> enda triviellt påstående som allra första fil, så att globmönstret har något
> att matcha från start. `npm start` går inte att köra förrän
> `src/server/server.js` finns — det är ett förkrav för paket 5, inte för
> paket 2.

---

## Mappstruktur

```
hemochekonomi/
├── package.json          Endast metadata och scripts. Inga dependencies.
├── .gitignore            node_modules/, .env, *.log (finns redan).
├── CLAUDE.md             Projektregler + kommandon.
├── PLAN.md               Arbetspaketen.
├── ARKITEKTUR.md         Den här filen.
├── LARDOMAR.md           Teamets minne.
├── README.md             Skapas i paket 8.
├── src/
│   ├── core/             Ren logik. Inga sidoeffekter, inga node:-importer.
│   │                     Körs oförändrad både i Node (tester) och i webbläsaren.
│   │   ├── money.js      Öre/kronor, avrundning, formatering (paket 3).
│   │   ├── dates.js      Kalenderdatum som YYYY-MM-DD. Enda stället som får
│   │   │                 läsa klockan (paket 2 + 7, se gränssnittslistan).
│   │   ├── entry.js      Datamodell + validering (paket 2).
│   │   ├── cost.js       Månadskostnad och årskostnad (paket 3).
│   │   └── schedule.js   Nästa dragningsdatum och kommande dragningar (paket 7).
│   ├── server/           Node-specifikt. Får importera node:-moduler och src/core.
│   │   ├── paths.js      Var datafilen ligger (paket 4; getLockFilePath i 5).
│   │   ├── storage.js    Läser/skriver JSON-filen (paket 4; updateEntries i 5).
│   │   ├── lock.js       Låset på datafilen: en instans i taget (paket 5).
│   │   ├── api.js        Routing och JSON-svar för /api/* (paket 5).
│   │   └── server.js     HTTP-server, statisk filserver, startpunkt (paket 5).
│   └── web/              Det som skickas till webbläsaren.
│       ├── index.html    Enda sidan. Formulär, lista, totaler, kommande
│       │                 dragningar (paket 5, utbyggd i 6 och 7).
│       ├── style.css     All styling. Ingen inline-CSS (paket 5).
│       └── app.js        UI-logik. Anropar API:t, importerar src/core via
│                         /core/ (paket 5, utbyggd i 6 och 7).
└── tests/                Alla tester. Testfiler heter <modul>.test.js, och bara
                          de körs av npm test. Hjälpfiler till ett test ligger
                          under helpers/ och körs aldrig av testköraren.
    ├── smoke.test.js     Paket 1.
    ├── dates.test.js     Paket 2, utbyggd i paket 7.
    ├── entry.test.js     Paket 2.
    ├── money.test.js     Paket 3.
    ├── cost.test.js      Paket 3.
    ├── storage.test.js   Paket 4.
    ├── api.test.js       Paket 5.
    ├── lock.test.js      Paket 5.
    ├── server.test.js    Paket 5.
    ├── app.test.js       Paket 5, utbyggd i 6 och 7. Kör src/web/app.js mot
    │                     DOM-attrappen. Ingen webbläsare, ingen server.
    ├── schedule.test.js  Paket 7.
    └── helpers/
        ├── interrupted-save.js  Barnprocess för atomicitetstestet: anropar
        │                        saveEntries och dödas med SIGKILL av
        │                        storage.test.js. Namnet slutar medvetet inte
        │                        på .test.js (paket 4).
        ├── dom.js               DOM-attrapp, fetch-attrapp och laddare för
        │                        app.test.js. Projektets enda DOM-attrapp
        │                        (paket 5).
        └── frozen-dates.js      Den klocka app.js läser under test: todayIso()
                                 lämnar tillbaka den dag laddaren satt. Läser
                                 ingen klocka själv (paket 7).
```

**Trädet ovan är paket 1–8.** Etapp 1 och 2 lägger till filer och tar bort två;
trädet för dem står under "Del 2: månadsbudget med konto och inloggning" och är
facit för de filerna. Det upprepas inte här, så att en fil har exakt ett hem i
den här filen.

**Paketmärkningen är bindande.** Varje fil i trädet är märkt med det paket där
den skapas. En fil som inte finns är korrekt så länge dess paket inte är
påbörjat, och ett fel så snart paketet är klart — den skillnaden ska aldrig
behöva gissas. Fyra moduler byggs i flera omgångar (`dates.js`, `storage.js`,
`index.html` + `app.js`); för dem gäller den finkorniga märkningen per export
respektive per punkt i ansvarslistan, se "Gränssnitt". Saknas märkning för något nytt är det en
lucka i den här filen och ska lämnas tillbaka till arkitekten, inte gissas bort.

**Beroenderiktning — bindande.** `src/core/` importerar ingenting utom andra
filer i `src/core/`. `src/server/` och `src/web/` får importera `src/core/`.
`src/core/` får aldrig importera från `src/server/` eller `src/web/`. Bryts
denna regel slutar webbläsaren att kunna ladda kärnan.

**Inom `src/core/` gäller att varje konstant har exakt en ägare.** Ett mönster,
en gräns eller en etikettlista definieras i den modul vars ansvarsområde den
tillhör och importeras av övriga. Två moduler får aldrig innehålla var sin kopia
av samma regel — då glider de isär vid första ändringen. Regeln gäller lika
mycket **inom** en modul: två funktioner i samma fil får inte ha var sin
handskriven kopia av samma villkor. Konkret: datummönstret `ISO_DATE_PATTERN`
ägs av `dates.js` och importeras av `entry.js`, villkoret för ett giltigt `id`
ägs av `isValidEntryId` i `entry.js` och anropas av både `createEntry` och
`isEntry` (se "Vad som är ett giltigt `id`"), och villkoret "är det här ett
vanligt objekt" ägs av `isPlainObject` i `entry.js` och anropas av både
`isEntry` och `yearlyOre` i `cost.js` (se `src/core/cost.js` under
"Gränssnitt").

**Regeln gäller också ett tal som står skrivet som literal.** Ett tal som står
på mer än ett ställe *i samma roll* ska ha en namngiven ägande konstant och
läsas därifrån. Det avgörande är rollen, inte siffran. `12` i rollen "antal
månader per år" är en konstant, `MONTHS_PER_YEAR` i `cost.js`, och används av
både `monthlyOre` och `totalMonthlyOre`. `PAYMENTS_PER_YEAR.monthly` och
`MONTHS_PER_PERIOD.yearly` bär samma siffra men svarar på andra frågor — hur
många betalningar ett månadsintervall ger per år, respektive hur många månader
en årsperiod omfattar — och är därför inte samma konstant och ska inte skrivas
som uttryck i varandra.

Tre avgränsningar gör regeln avgörbar. De är lika bindande som regeln själv, och
ett tal som faller under någon av dem är inte ett regelbrott:

1. **Ett tal som står på exakt ett ställe behöver ingen konstant.** Rollen räknas
   per betydelse, inte per siffra: `100` i `year % 100 !== 0` i `dates.js` är
   rollen "ett århundrade", står på ett ställe, och är inte samma roll som "öre
   per krona".
2. **`0`, `1` och `-1` räknas aldrig som en roll.** De är neutrala element och
   närmaste granne till en gräns i så många sammanhang att en konstant inte gör
   någon text tydligare.
3. **Ett tal som hör till ett enda uttrycks struktur räknas som ett ställe, även
   om det skrivs flera gånger i uttrycket eller i uttryckets egen spärr.** Tvåan
   i `Math.floor((2 * numerator + denominator) / (2 * denominator))` och i
   `!Number.isSafeInteger(2 * numerator + denominator)` är avrundningsregelns
   form, inte ett värde som kan ändras; `divideRoundHalfUp` behöver därför ingen
   konstant för den. Samma sak gäller de två `15` i `AMOUNT_PATTERN`, som är
   samma mönsters struktur.

Regeln är körd mot hela `src/core/` i paket 3. Utöver `MONTHS_PER_YEAR`, som den
kom till för, träffar den två ställen. Båda har ett utpekat paket och en utpekad
åtgärd — ingen av dem är ett undantag, och ingen av dem får lämnas obeslutad:

- **`100` i rollen "öre per krona" i `entry.js`**, i `canonicalAmountSek` och i
  `checkAmountSek`. Ägaren är `ORE_PER_SEK` i `money.js`. `entry.js` importerar
  konstanten och läser talet därifrån; vad som får och inte får importeras står
  under "Vad `entry.js` importerar från `money.js`". **Åtgärdat i paket 3** — de
  fem literalerna i koden är ersatta av konstanten.
- **`12` i rollen "högsta månadsnummer i ett kalenderdatum" i `dates.js`.**
  Ägaren är `daysInMonth`, som svarar `0` för varje månadsnummer utanför 1–12.
  `parseIsoDate` behöver ingen egen kopia av villkoret `month < 1 || month > 12`:
  raden `day < 1 || day > daysInMonth(year, month)` avvisar redan samma värden.
  **Åtgärdat i paket 7** — `parseIsoDate` hade en handskriven kopia av villkoret,
  och den raden togs bort. Vad som gjordes, vilka datum som prövades och vilket
  testfall som är facit står i beslutsloggens punkt **`entry.js` läser
  `ORE_PER_SEK` från `money.js`, och ägarregeln för tal får tre avgränsningar och
  en fullständig träfflista**, och upprepas inte här.

**Exporterade konstanter i `src/core/` fryses med `Object.freeze`.** Gäller
`INTERVALS`, `INTERVAL_LABELS`, `CATEGORIES`, `CATEGORY_LABELS`, `ENTRY_FIELDS`,
`PAYMENTS_PER_YEAR` och `MONTHS_PER_PERIOD`. En ägare är verkningslös om vilken
importör som helst kan skriva om ägarens värde: `ENTRY_FIELDS.push('income')`
någonstans i `app.js` skulle ändra vad `isEntry` godkänner i hela processen,
utan att någon fil visar det och utan att något test av `entry.js` märker det.
Frysningen är ett anrop per konstant, noll beroenden, och den fångar misstaget
direkt eftersom ES-moduler alltid körs i strict mode — en muterande operation
på ett fryst objekt kastar `TypeError` i stället för att tyst ignoreras.

---

## Teknikval

| Val | Varför | Vad vi valde bort |
|-----|--------|-------------------|
| Node.js v24 (ESM, `"type": "module"`) | Finns redan installerat på maskinen (verifierat ovan). Samma språk i kärnan, servern och webbläsaren — kostnadslogiken skrivs en gång och används av båda. | Python (ingen verifierad installation, och skulle kräva ett andra språk i webbläsaren), .NET/WPF (mycket större yta för en enanvändarapp). |
| Lokal HTTP-server (`node:http`) + webbläsare som gränssnitt | Ger ett riktigt grafiskt gränssnitt utan något UI-ramverk och utan byggsteg. Servern behövs ändå för att skriva filen på disk. | Electron/Tauri (hundratals MB beroenden), ren terminalapp (uppfyller inte "se månadskostnad och årskostnad" bra), ren HTML-fil utan server (se lagringsvalet nedan). |
| Ren HTML/CSS/JS i webbläsaren, ES-moduler direkt | Noll byggsteg, noll transpilering. `<script type="module">` räcker. | React/Vue/Svelte + bundler (skulle ensamt vara fler beroenden än hela resten av projektet). |
| `node --test` + `node:assert/strict` | Ingår i Node. Testkommandot fungerar direkt efter `git clone`. | Jest, Vitest, Mocha — alla tre är beroenden som löser ett problem Node redan löser. |
| JSON-fil på disk under `%APPDATA%` | Läsbar, enkel att säkerhetskopiera, och paket 4:s krav "läses tillbaka i en ny körning" blir ett rakt test. | `localStorage` (går inte att läsa från Node, gör paket 4 otestbart), SQLite (beroende + binär fil för sex fält). |
| `crypto.randomUUID()` | Finns både i Node och i webbläsare på `http://localhost` (secure context). Noll beroenden. | `uuid`-paketet, löpnummer (krockar efter borttagning). |
| `Intl.NumberFormat('sv-SE', …)` | Inbyggd i Node och webbläsaren. Ger `"1\u00a0234,50\u00a0kr"` utan egen formateringskod — hårt blanksteg (U+00A0) på båda platserna, se `money.js` under "Gränssnitt". Ett negativt belopp får minustecknet U+2212, inte bindestrecket U+002D: `formatSek(-0)` gav `"\u22120,00\u00a0kr"` i granskarens körning. | Egen strängpillning, `numeral`/`dinero.js`. |

Raderna nedan tillkom i **etapp 1 och 2** (månadsbudget med konto och
inloggning, se "Del 2"). De ändrar inget i raderna ovan utom lagringsvalet, vars
gamla rad står kvar oförändrad som historik: JSON-filen var rätt val för sex fält
och en person, och blev fel val när samma fil skulle bära flera användare, flera
tabeller och en månadsvy.

| Val | Varför | Vad vi valde bort |
|-----|--------|-------------------|
| **`node:sqlite` (`DatabaseSync`)** som lagring i stället för `entries.json` | Inbyggd i Node, alltså fortfarande noll beroenden. Ger transaktioner, främmandenycklar, index och filtrering per användare och månad — allt som JSON-filen tvingade appen att läsa hela filen för att göra. Användarens körning på den här maskinen (Node v24.19.0, **utan experimentflagga**): `new DatabaseSync(':memory:')`, `CREATE TABLE`, `prepare().run()` och `.get()` gav `{"id":1,"ore":123450}`. Klassen är **synkron** — inga `await` i datalagret. | `better-sqlite3` (byggs mot en C++-kompilator vid `npm install`), `sql.js` (hela SQLite som WebAssembly, megabyte i onödan), att behålla JSON-filen (kan inte filtrera per användare, saknar transaktioner över flera tabeller, och varje skrivning skriver om hela filen). |
| **`node:crypto`** för engångskoder, hashning och sessionstoken: `randomInt`, `randomBytes`, `scryptSync`, `timingSafeEqual`, `createHash`, `randomUUID` | Inbyggd. Användarens körning: `crypto.randomInt(0, 1000000)` gav `930991`, och `scryptSync`, `timingSafeEqual` och `randomUUID` finns alla. `scrypt` är en avsiktligt långsam nyckelutledning, vilket är precis vad en sexsiffrig hemlighet behöver. | `bcrypt`/`argon2` (native byggsteg), `jsonwebtoken` (ett beroende för något en sessionstabell gör bättre: en rad går att återkalla, ett signerat token gör det inte). |
| **Globalt `fetch` mot Resends HTTP-API** för utskick av engångskoden | Inbyggt i Node (verifierat i "Körsätt i korthet"). Ett `POST` med JSON är hela integrationen. Utan `RESEND_API_KEY` skrivs koden i serverloggen i stället, så hela inloggningsflödet går att köra och testa utan e-postkonto. | `nodemailer` (ett beroende plus SMTP-uppsättning), Resends egen SDK (samma anrop, ett beroende till), egen SMTP-klient. |
| **Engångskod via e-post i stället för lösenord** | Ingen lösenordslagring, ingen glömt-lösenord-väg, ingen andra hemlighet att läcka. Koden är kortlivad och engångs. | Lösenord (kräver hashning, byteflöde, återställning och styrkeregler — fyra funktioner i stället för en), OAuth hos Google eller GitHub (tredjepartsberoende, egen registrering hos leverantören, och ett konto användaren inte har valt). |
| **Sessioner som rader i en tabell, med en `httpOnly`-cookie som bär ett slumpat token** | En session går att återkalla vid utloggning genom en `UPDATE`. Tokenet bär ingen information och går inte att läsa av klienten. | Signerad cookie eller JWT (går inte att återkalla före sin utgång), sessioner i processminne (försvinner vid omstart och fungerar inte med två processer). |
| **Drift på Fly.io, en enda instans, databasfilen på en monterad volym** | Fly.io kör en vanlig långlivad Node-process, så `start()` med `listen()` är oförändrat körsätt och ingen andra ingång behövs. Certifikat på egen domän ingår, vilket är förutsättningen för `Secure` på sessionscookien. Volymen behövs därför att appens filsystem återställs vid varje driftsättning. | Serverlös drift (varje anrop får ett tomt, tillfälligt filsystem — en SQLite-fil överlever inte mellan anrop, och lagringen hade då måst bytas mot en databas över nätet, alltså asynkrona frågor genom hela datalagret), egen VPS (certifikat, brandvägg och uppdateringar blir projektets arbete). |

**Runtime-beroenden: 0. Dev-beroenden: 0.** `package.json` ska inte ha något
`dependencies`- eller `devDependencies`-fält. Nytt beroende kräver en ny rad i
tabellen ovan innan det installeras. `node:sqlite`, `node:crypto` och globala
`fetch` är inbyggda i Node och är därför inga beroenden — de kräver ändå var sin
rad ovan, eftersom en rad är det enda som gör valet granskningsbart.

### package.json — skrivs av byggaren exakt så här

```json
{
  "name": "hemochekonomi",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Koll pa hemmets fasta utgifter och prenumerationer.",
  "engines": { "node": ">=22.5.0" },
  "scripts": {
    "start": "node src/server/server.js",
    "test": "node --test \"tests/**/*.test.js\""
  }
}
```

De inre citationstecknen i `test`-scriptet är escapade med `\"` och ska stå
kvar precis så. Tas de bort tolkar Node argumentet som en katalog och kommandot
misslyckas med `Cannot find module`.

**`engines` höjdes från `>=20.17.0` till `>=22.5.0` i etapp 1.** Skälet är
`node:sqlite`, som inte finns i Node 20 — en installation som uppfyller det gamla
kravet kan inte starta appen alls efter etapp 1, och då ska `npm install` säga
det i stället för att `import 'node:sqlite'` kastar vid första anropet. Talet är
det lägsta som bär modulen och inget påstående om vad som är testat: den
verifierade miljön är fortfarande Node v24.19.0, och det är den enda version
projektets körningar gäller för.

---

## Datamodell

En post = en fast utgift eller prenumeration. Sex fält, alla obligatoriska.
Inga andra fält får finnas — inkomst, konto, saldo, historik och "nästa
dragning" är uttryckligen inte fält (se `PLAN.md`, beslut 1–5).

| Fält | Typ | Obligatoriskt | Regel |
|------|-----|---------------|-------|
| `id` | `string` | Ja | UUID från `crypto.randomUUID()`. Sätts av `createEntry`, aldrig av användaren. Ändras aldrig. Vad som räknas som giltigt avgörs av `isValidEntryId` — se "Vad som är ett giltigt `id`" nedan, villkoret upprepas inte här. |
| `name` | `string` | Ja | Trimmad. 1–60 tecken. Lagras trimmad. |
| `amountSek` | `number` | Ja | Belopp i kronor per betalningstillfälle. > 0, ≤ 9999999.99, högst 2 decimaler. |
| `interval` | `string` | Ja | Exakt ett av `"monthly"`, `"quarterly"`, `"semiannual"`, `"yearly"`. `"semiannual"` tillkom i etapp 1, se "Del 2". |
| `startDate` | `string` | Ja | `"YYYY-MM-DD"`. Verkligt kalenderdatum. Mellan `1970-01-01` och `2099-12-31`. |
| `category` | `string` | Ja | Exakt ett av `"housing"`, `"subscription"`, `"insurance"`, `"transport"`, `"loan"`, `"other"`. |

Exempel på en giltig post:

```json
{
  "id": "6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234",
  "name": "Spotify Family",
  "amountSek": 199,
  "interval": "monthly",
  "startDate": "2026-01-31",
  "category": "subscription"
}
```

### Vad som är ett giltigt `id` — en definition, en ägare

Det här avsnittet är den **enda** platsen i den här filen där villkoret för ett
giltigt `id` står skrivet. Övriga avsnitt hänvisar hit och formulerar inte om
det. I koden är ägaren en enda funktion:

```js
// src/core/entry.js — enda definitionen av villkoret i projektet
export function isValidEntryId(value: unknown): boolean;
// sann omm: typeof value === 'string' && value.trim().length > 0
```

Ett `id` är alltså giltigt om och endast om det är en sträng som innehåller
minst ett tecken som inte är blanktecken. `'   '` är **inte** ett giltigt `id`,
lika lite som `''`, `42`, `null` eller `undefined`.

**Varför `trim().length > 0` och inte `length > 0`.** Villkoret används på två
ställen: `createEntry` godkänner resultatet av `makeId()`, och `isEntry`
godkänner en post som lästs från disk. Är de två inte exakt lika kan
`createEntry` returnera `ok: true` för en post som `isEntry` sedan underkänner —
posten skrivs till datafilen och kan aldrig läsas tillbaka. Det är precis det
fel `LARDOMAR.md` (2026-08-18, `createEntry` litar blint på det injicerade
id:t) finns för att hindra. `'   '` är det enda värde där de två skrivsätten
skiljer sig, och där ska svaret vara "ogiltigt": ett id av bara blanktecken bär
ingen information och kan inte identifiera en post i `DELETE /api/entries/<id>`.

**Bindande för koden.** `createEntry` och `isEntry` anropar `isValidEntryId`.
Ingen av dem får ha en egen handskriven kopia av villkoret — samma ägarregel som
för `ISO_DATE_PATTERN` (se "Mappstruktur"). Kravet är uppfyllt sedan tidigare:
granskarens körning 2026-09-07 av `grep -n "trim().length" src/core/entry.js`
gav en enda träff, inuti `isValidEntryId` själv. Den instruktion som stod här —
att två handskrivna kopior skulle ersättas av anrop — är struken. Den var utförd
och beskrev därför kod som inte längre såg ut så.

**Id:t lagras exakt som `makeId()` gav det, utan trimning.** `name` trimmas,
`id` gör det inte: `crypto.randomUUID()` ger aldrig blanktecken, och ett id får
aldrig förändras efter att det satts. `isEntry` ställer därför inget krav på att
`id === id.trim()`, till skillnad från `name`.

### Etiketter mot användaren (svenska)

`interval`: `monthly` → "Månadsvis", `quarterly` → "Kvartalsvis",
`semiannual` → "Halvårsvis", `yearly` → "Årsvis".

`category`: `housing` → "Boende", `subscription` → "Prenumeration",
`insurance` → "Försäkring", `transport` → "Transport", `loan` → "Lån",
`other` → "Övrigt".

Etiketterna bor i `src/core/entry.js` som `INTERVAL_LABELS` respektive
`CATEGORY_LABELS`. Ingen svensk etikett får skrivas hårdkodad i `app.js`.

### Valideringsregler och exakta felmeddelanden

`validateEntryDraft` kontrollerar **alla** fält och returnerar alla fel, inte
bara det första. Fälten kontrolleras i ordningen `name`, `amountSek`,
`interval`, `startDate`, `category`. Inom ett fält vinner den första regel som
slår till, och bara ett fel per fält returneras.

**Tabellen nedan är det enda facit som gäller för regelordningen inom ett
fält.** Raderna körs uppifrån och ned och den första rad vars villkor är sant
ger felet. Ingen annan del av den här filen får ange en avvikande ordning, och
ordningen får inte bero på råvärdets typ.

Tabellen beskriver **fel som användaren kan orsaka och rätta**. Fel som bara ett
programmeringsmisstag kan orsaka står i ett eget avsnitt längre ned
("Interna fel i `createEntry`") och blandas medvetet inte in här.

| Fält | Villkor som avvisar | `message` (exakt sträng) |
|------|---------------------|--------------------------|
| `name` | inte sträng, eller tom efter `trim()` | `Namnet får inte vara tomt.` |
| `name` | fler än 60 tecken efter `trim()` | `Namnet får vara högst 60 tecken.` |
| `amountSek` | normaliseringen (steg 1 nedan) ger inget finit tal, **och** råvärdet är en sträng som ser ut som ett skrivet belopp (villkoret står i steg 1) | `Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.` |
| `amountSek` | normaliseringen (steg 1 nedan) ger inget finit tal | `Beloppet måste vara ett tal.` |
| `amountSek` | ≤ 0 | `Beloppet måste vara större än 0 kr.` |
| `amountSek` | > 9999999.99 | `Beloppet får vara högst 9 999 999,99 kr.` |
| `amountSek` | fler än 2 decimaler | `Beloppet får ha högst två decimaler.` |
| `interval` | inte något av värdena i `INTERVALS` | `Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.` |
| `startDate` | matchar inte `ISO_DATE_PATTERN` (se `dates.js`) | `Startdatum måste anges som ÅÅÅÅ-MM-DD.` |
| `startDate` | rätt format men obefintligt datum (t.ex. `2026-02-30`) | `Startdatum är inget giltigt datum.` |
| `startDate` | år utanför 1970–2099 | `Startdatum måste ligga mellan 1970-01-01 och 2099-12-31.` |
| `category` | inte något av de sex värdena | `Välj en giltig kategori.` |

Notera att `amountSek`-raderna står i ordningen **skrivet belopp → tal → större
än 0 → maxgräns → decimaler**. Maxgränsen står före decimalregeln med flit;
motiveringen finns under "Steg 2" nedan. De två första raderna delar samma
villkor i steg 1 och skiljs bara av hur råvärdet ser ut: den vägledande texten är
den smalare raden och står därför först.

`amountSek`-kedjan i steg 2 har därutöver ett **fjärde** steg, som prövar om
kravet "större än 0" på det avrundade värde som faktiskt lagras. Det steget har
ingen egen rad här därför att det ger exakt samma sträng som raden `≤ 0` — det
tillför inget felmeddelande, bara en till väg till ett befintligt. Ordningen
mellan de fyra stegen står i "Steg 2".

Datummönstret skrivs **inte** ut som ett reguljärt uttryck i den här tabellen.
Det finns på exakt ett ställe i projektet, `ISO_DATE_PATTERN` i
`src/core/dates.js`, och `entry.js` importerar det därifrån. Skrivs mönstret av
för hand någonstans — i koden eller i den här filen — kan de två kopiorna glida
isär utan att något test märker det.

**Vad `entry.js` importerar från `money.js` — bindande.** Från och med paket 3
importerar `entry.js` **konstanten** `ORE_PER_SEK` och **funktionen**
`normalizeZero`, och ingenting annat därifrån. Talet i rollen "öre per krona"
används av `canonicalAmountSek` och `checkAmountSek`. Det stod som literalen
`100` på fem ställen i `entry.js` fram till paket 3, och ägarregeln under
"Mappstruktur" kräver att det läses från sin ägare. Paket 2 byggdes utan
`money.js` — modulen fanns inte då, och det var rätt; förbudet mot importen var
ett uttalande om paket 2:s beroenden och gäller inte längre.

**De funktioner i `money.js` som kan kasta importeras däremot inte av
`entry.js`, och det är lika bindande.** `sekToOre(v)` räknar om samma tal som
`canonicalAmountSek` men kastar `RangeError` för ett tal som inte är finit,
medan `canonicalAmountSek` måste kunna anropas med vilket `number` som helst och
svara med ett tal: `isEntry` anropar den på ett `amountSek` som kommer från
datafilen, och `canonicalAmountSek(NaN)` ska ge `NaN` så att `isEntry`
returnerar `false` — inte kasta. De två funktionerna har alltså olika kontrakt
och är inte två kopior av samma sak. Beloppsvalideringen arbetar i kronor och är
klar innan öresaritmetiken börjar.

`normalizeZero` är det enda undantaget, och den är ett undantag just därför att
den aldrig kastar: den avgör identiteten `-0` och ingenting annat, för vilken
indata som helst (`normalizeZero(NaN)` ger `NaN`, `normalizeZero(1n)` ger `1n`).
Den importeras därför att `canonicalAmountSek` annars skulle behöva en egen
handskriven kopia av villkoret "detta är `-0`", och en andra kopia av ett
villkor som har en ägare är just det ägarregeln under "Mappstruktur" förbjuder.
Villkoret, ägaren och de tre anropsställena står under "Avrundningsregel",
rubriken "`-0` normaliseras till `0`".

### `name` — längdgränsen och den billiga avvisningen (bindande)

Gränsen är **60 tecken**, mätt i kodpunkter med `[...trimmed].length`, aldrig
med `trimmed.length` — den senare räknar UTF-16-kodenheter och gör varje emoji
till två (`LARDOMAR.md`, 2026-08-18, namnlängd i kodenheter).

`checkName` kontrollerar i exakt den här ordningen:

| # | Villkor | Utfall |
|---|---------|--------|
| 1 | `typeof raw !== 'string'` | `Namnet får inte vara tomt.` |
| 2 | `raw.trim() === ''` | `Namnet får inte vara tomt.` |
| 3 | `trimmed.length > 2 * NAME_MAX_LENGTH` | `Namnet får vara högst 60 tecken.` |
| 4 | `[...trimmed].length > NAME_MAX_LENGTH` | `Namnet får vara högst 60 tecken.` |
| – | inget av ovanstående | giltigt, `value.name` blir `trimmed` |

**Steg 3 är en snabbväg, inte en ny regel.** En kodpunkt är i UTF-16 antingen en
eller två kodenheter. Fler än `2 * NAME_MAX_LENGTH` kodenheter betyder därför
alltid fler än `NAME_MAX_LENGTH` kodpunkter, så steg 3 kan bara vara sant för
strängar som steg 4 ändå hade avvisat — med exakt samma meddelande. Snabbvägen
ändrar alltså inte vilken rad i felmeddelandetabellen som vinner för något
värde, och den får därför **ingen egen rad** i den tabellen: tabellen förblir
det enda facit för `name`. Argumentet följer av UTF-16-kodningen och är exakt,
till skillnad från toleransresonemangen i `amountSek`-kedjan. Faktorn skrivs
`2 * NAME_MAX_LENGTH` och aldrig `120`, så att gränsen behåller en enda ägare.

**Varför snabbvägen finns.** Steg 4 bygger en array med ett element per tecken i
hela strängen, fast svaret är avgjort efter 61 tecken: ett namn på 50 000 000
tecken kostade 2,8 sekunder och 1,7 GB heap för att svara `Namnet får vara
högst 60 tecken.` (`LARDOMAR.md`, 2026-08-23, namnlängden räknas genom att hela
strängen materialiseras). Steg 3 gör kostnaden oberoende av indatans storlek.

**Generell regel för `src/core/`, bindande.** Ingen validering får utföra arbete
som växer med hela indatans storlek när svaret är avgjort av ett prefix. Är
frågan bara "överskrider detta en gräns" ska den först avgöras med en billig och
exakt övre uppskattning; den dyra exakta mätningen körs först därefter.

**Detta är projektets enda gräns för indatastorlek.** Inget fält, ingen
API-body och ingen datafil får någon storleksgräns i byte: fälten tar emot
godtyckligt stor indata och avvisar den billigt. En gräns i `api.js` eller
`storage.js` löser inget problem som står i `PLAN.md` och införs inte.

**Obligatoriska testfall i paket 2** (`tests/entry.test.js`):

| `name` in | Förväntat | Avgörs av |
|-----------|-----------|-----------|
| `'a'.repeat(60)` | giltigt | – |
| `'a'.repeat(61)` | `Namnet får vara högst 60 tecken.` | steg 4 |
| `'🎵'.repeat(60)` | giltigt | – (120 kodenheter, exakt på steg 3:s gräns) |
| `'🎵'.repeat(61)` | `Namnet får vara högst 60 tecken.` | steg 3 |
| `'a'.repeat(1000000)` | `Namnet får vara högst 60 tecken.` | steg 3 |

Raden `'🎵'.repeat(60)` är obligatorisk därför att den ligger exakt på steg 3:s
gräns: 120 kodenheter är inte fler än 120, så namnet måste nå steg 4 och
godkännas där. Skrivs snabbvägen som `>=` i stället för `>` avvisas ett giltigt
namn, och det är den enda indata som visar det.

Testet får **inte** innehålla någon assertion på körtid — se "Teststrategi".
Att snabbvägen verkligen är billig visas i stället med en mätning: byggaren kör
`validateEntryDraft` med ett `name` på 50 000 000 tecken och klistrar in den
uppmätta tiden i paketets redovisning, så att den går att ställa mot de 2,8
sekunder lärdomen mätte.

### `amountSek` — normalisering och regelkedja (bindande)

Formulär skickar strängar, tester och API-anrop skickar tal. **Det får inte
finnas två valideringsvägar.** Värdet normaliseras först till ett `number`, och
därefter körs en enda ordnad regelkedja som är gemensam för alla ingångstyper.
Ingen regel i kedjan får titta på råvärdets typ eller på hur strängen såg ut.
Samma värde ska ge exakt samma `message`, oavsett om det kom in som sträng
eller som tal.

#### Steg 1 — normalisering till `number`

Utfallet är antingen ett **finit `number`** eller ett av de två meddelanden som
hör till steget: `Beloppet måste vara ett tal.` eller den vägledande texten för
ett skrivet belopp. Vilket av de två som gäller avgörs av tabellen under
rubriken längre ned; ingen värderegel kan uppstå här.

| Råvärdets typ | Vad som görs | Utfall |
|---------------|--------------|--------|
| `number` | – | `Number.isFinite(raw)` → `raw`. Annars (`NaN`, `Infinity`, `-Infinity`) → `Beloppet måste vara ett tal.` |
| `string` | `raw.trim()`, matcha mot `AMOUNT_PATTERN`, byt `,` mot `.`, kör `Number(...)` | Matchar mönstret → talet. Matchar inte → en av de två texterna, enligt "Den vägledande texten för ett skrivet belopp" |
| allt annat (`undefined`, `null`, `boolean`, objekt, array) | – | `Beloppet måste vara ett tal.` |

```js
export const AMOUNT_PATTERN = /^-?\d{1,15}([.,]\d{1,15})?$/;
```

**Mönstret har ett enda jobb: avgöra om strängen alls är ett tal i
decimalform.** Det får aldrig avgöra ett värdeintervall och aldrig ett antal
decimaler — det gör steg 2. Därför är mönstret medvetet tillåtande:

- **Minustecken tillåts.** `'-50'` ska nå regel 1 ("större än 0 kr"), precis som
  talet `-50` gör. Utan `-?` skulle sträng och tal ge olika fel för samma värde.
- **Upp till 15 heltalssiffror tillåts, inte 7.** `'10000000'` ska nå
  maxgränsen och ge `Beloppet får vara högst 9 999 999,99 kr.`, inte
  `Beloppet måste vara ett tal.` Siffergränsen 15 är ingen värderegel — den
  finns bara för att garantera att `Number(...)` alltid ger ett finit tal långt
  under `Number.MAX_SAFE_INTEGER`. Därmed kan strängvägen aldrig producera
  `Infinity`, och finitkontrollen i tabellen ovan behöver bara täcka talvägen.
- **Upp till 15 decimaler tillåts, inte 3.** Antalet decimaler bedöms på det
  normaliserade talet i steg 2, aldrig på strängen. Det är det som gör att
  `'0,000'` och `0` hamnar på samma regel.

Strängar som inte matchar `AMOUNT_PATTERN` är ogiltiga, och **tusentalsavgränsare
stöds inte**: `'1 234,50'`, `'12 000'` och `'50 kr'` är alla ogiltiga, liksom
`''`, `'   '`, `'abc'`, `',5'`, `'.5'`, `'1,2,3'`, `'1e3'`, `'-'` och strängar
med fler än 15 heltalssiffror.

##### Den vägledande texten för ett skrivet belopp (bindande) [paket 8]

`Beloppet måste vara ett tal.` är sant men inte till någon hjälp för `12 000`,
som är det normala svenska skrivsättet för tolvtusen — och dessutom det skrivsätt
appen **själv** väljer när den visar ett belopp. `formatSek(sekToOre(12000))` ger
`12\u00a0000,00\u00a0kr`, och klistras den strängen tillbaka in i formuläret
avvisas den med ett meddelande som säger att den inte är ett tal. Appens utdata
är alltså inte giltig indata, och texten säger inte vad användaren ska göra
(`LARDOMAR.md`, 2026-09-22, appen visar belopp som "12 000,00 kr" men avvisar
"12 000").

**Beslut: avvisningen står kvar, meddelandet blir handlingsbart.** Strängen är
bindande ordagrant, och varje tecken i den är ASCII:

```js
'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.'
```

De två exemplen i texten är valda för att båda ska vara **giltig indata**: en
vägledning som visar ett format appen avvisar vore samma fel en gång till.

**Regeln "samma värde, samma `message` oavsett ingångstyp" står kvar orörd.**
Den nya raden skiljer inte på `number` och `string` för något värde som kan
uttryckas i båda formerna: varje sträng som `AMOUNT_PATTERN` godkänner
normaliseras till ett tal och når regelkedjan precis som förut, och `'-50'` ger
fortfarande samma svar som `-50`. Raden gäller bara strängar som **inte** är tal
alls, och de har ingen motsvarighet bland talen — `12 000` finns inte som
`number`. Det som avgör är alltså inte råvärdets typ utan värdets form, och det
är skillnaden mot det fel `LARDOMAR.md` (2026-08-18, felordningen för amountSek)
beskriver.

**Villkoret, skrivet som det ska stå i koden.** Steg 1 avgör först om strängen
alls är ett tal, och först därefter vilken av de två texterna som gäller:

```js
export const AMOUNT_HINT_PATTERN = /^-?[\d.,\u0020\u00a0]*\d[\d.,\u0020\u00a0]*(?:kr)?$/i;
export const AMOUNT_HINT_MAX_LENGTH = 40;
```

Ordningen i steg 1 för ett råvärde som inte gav ett finit tal:

| # | Villkor | `message` |
|---|---------|-----------|
| 1 | `typeof raw !== 'string'` | `Beloppet måste vara ett tal.` |
| 2 | `trimmed.length > AMOUNT_HINT_MAX_LENGTH` | `Beloppet måste vara ett tal.` |
| 3 | `AMOUNT_HINT_PATTERN.test(trimmed)` | den vägledande texten |
| 4 | inget av ovanstående | `Beloppet måste vara ett tal.` |

**Rad 2 är en snabbväg av samma slag som steg 3 i `checkName`, och den är inte
valfri.** `AMOUNT_HINT_PATTERN` läser hela strängen, medan `AMOUNT_PATTERN`
avgör sitt svar på de första tecknen. Utan längdgränsen skulle ett `amountSek`
på 50 000 000 tecken kosta en genomläsning av hela indatan för att svara — och
`LARDOMAR.md` (2026-08-23) mätte att `amountSek` i dag avvisar just den
storleken på under 60 ms. Gränsen `40` är vald som en billig övre uppskattning:
det längsta någon rimligen skriver som ett belopp är ett minustecken, femton
siffror med avgränsare, ett decimaltecken, femton decimaler och ` kr`. En sträng
längre än så får standardtexten, och det är rätt: den är inget någon har skrivit
som ett belopp.

**Varför `\u0020` och `\u00a0` står som escaper** och inte som tecknen själva:
det ena av dem syns inte i en genomläsning, och ett mönster där man inte kan se
vilket blanktecken som avses är oläsbart (`LARDOMAR.md`, 2026-09-14, U+2013 står
rått i ARKITEKTUR.md). Båda tecknen ska finnas med — appen visar det hårda, och
tangentbordet ger det vanliga.

**Facit, bindande och obligatoriska testfall.** Varje rad körs som sträng:

| Råvärde | `message` |
|---|---|
| `'12 000'` (U+0020) | den vägledande texten |
| `'12\u00a0000'` | den vägledande texten |
| `'1\u00a0234,50\u00a0kr'` | den vägledande texten |
| `'50 kr'` | den vägledande texten |
| `'1,2,3'` | den vägledande texten |
| `',5'` | den vägledande texten |
| `'-12 000'` | den vägledande texten |
| `''` | `Beloppet måste vara ett tal.` |
| `'   '` | `Beloppet måste vara ett tal.` |
| `'abc'` | `Beloppet måste vara ett tal.` |
| `'1e3'` | `Beloppet måste vara ett tal.` |
| `'-'` | `Beloppet måste vara ett tal.` |
| `'kr'` | `Beloppet måste vara ett tal.` |
| `'1'.repeat(41)` | `Beloppet måste vara ett tal.` |
| `'1'.repeat(40)` | den vägledande texten |
| `12000` (tal) | giltigt |
| `NaN`, `Infinity`, `null`, `{}` | `Beloppet måste vara ett tal.` |

Raderna `'1'.repeat(40)` och `'1'.repeat(41)` ligger på var sin sida om
`AMOUNT_HINT_MAX_LENGTH` och är obligatoriska: utan dem går gränsen att flytta
utan att något faller. `'kr'` är med därför att mönstret kräver minst en siffra —
en sträng utan siffra är inget skrivet belopp.

**Invarianten som saknades, och som nu är ett testfall.** Rundgången
`formatSek` → `validateEntryDraft` prövas av inget testfall i projektet, och det
är därför felet kunde stå kvar i sju paket: testerna matar in belopp de själva
skrivit som `'12000'` och jämför utdata mot `'12\u00a0000,00\u00a0kr'`, aldrig
det omvända varvet. Kravet är bindande och ligger i `tests/entry.test.js`: för
varje belopp i facittabellen under "Facit — samma värde, samma fel i båda
ingångstyperna" som är giltigt, kör `formatSek(sekToOre(v))` och mata tillbaka
resultatet i `validateEntryDraft`. Utfallet ska vara **den vägledande texten**
för var och en — aldrig `Beloppet måste vara ett tal.`, och aldrig `ok: true`,
eftersom varje utdata från `formatSek` slutar med `\u00a0kr`. Testfilen importerar
`formatSek` och `sekToOre` från `../src/core/money.js` för det; inga strängar
skrivs av för hand, eftersom den bindande strängen har en ägare i `src/`
(`LARDOMAR.md`, 2026-09-14, samma bindande användartext fick två skrivsätt).

**Mutationer som ska köras när raden byggs**, en i taget, var och en med `EXIT=1`
och kryssraden inklistrad:

| Mutation | Fälls av |
|---|---|
| `if (AMOUNT_HINT_PATTERN.test(trimmed)) {` → `if (false) {` | facitraderna med den vägledande texten, och rundgångstestet |
| `if (trimmed.length > AMOUNT_HINT_MAX_LENGTH) {` → `if (false) {` | raden `'1'.repeat(41)` |
| `AMOUNT_HINT_MAX_LENGTH = 40` → `41` | raden `'1'.repeat(41)` |

Uttrycken skrivs med det namn de bär där villkoret står, och kontrollen är
`grep -c "<uttrycket före pilen>" src/core/entry.js` med minst `1` för var och
en.

**Vad som inte ändras.** `AMOUNT_PATTERN` är orörd: appen fortsätter avvisa
`12 000`. *Att i stället acceptera blanksteg som tusentalsavgränsare, genom att
strippa dem före matchningen, förkastades av användaren* — det ändrar vilka
värden som är giltiga i projektets mest granskade kod, med en facittabell, en
regelkedja i fyra steg och en invariant mot `isEntry` som alla vilar på att
normaliseringen är en enda smal väg. Priset för beslutet är att användaren måste
skriva om sitt belopp, och det priset betalas med en text som säger hur. Att det
är ett val och inte ett förbiseende står här, så att nästa läsare inte behöver
gissa. `amountTooLarge`-texten, som skriver gränsen som `9 999 999,99 kr` med
vanliga blanksteg, är också orörd: den påstår inget om hur man skriver ett
belopp utan anger en gräns, och skriver någon av den strängen i fältet får hen
numera just den vägledande texten.

#### Steg 2 — regelkedjan

Körs på det finita talet `v` från steg 1, i exakt den här ordningen. Första
träff vinner, resten hoppas över. Regel 1–3 följer `amountSek`-raderna i
felmeddelandetabellen ovan rad för rad; regel 4 är regel 1 omprövad på det
lagrade värdet och ger därför samma sträng som regel 1.

| # | Villkor | `message` |
|---|---------|-----------|
| 1 | `v <= 0` | `Beloppet måste vara större än 0 kr.` |
| 2 | `v > AMOUNT_MAX_SEK` | `Beloppet får vara högst 9 999 999,99 kr.` |
| 3 | `Math.abs(v * 100 - Math.round(v * 100)) >= 1e-6` | `Beloppet får ha högst två decimaler.` |
| 4 | `Math.round(v * 100) < 1` | `Beloppet måste vara större än 0 kr.` |

Passerar `v` alla fyra är fältet giltigt och `value.amountSek` sätts till
`Math.round(v * 100) / 100`. Den lagrade posten har därmed alltid högst två
decimaler och är fri från flyttalsskräp, oavsett vad som skickades in.

**Varför maxgränsen (regel 2) står före decimalregeln (regel 3).** Regel 3 är en
flyttalsjämförelse med tolerans, och toleransen `1e-6` håller bara så länge
`v * 100` ligger under ungefär `1e9`. Eftersom regel 2 körs först ser regel 3
aldrig ett värde över `9999999.99`, där `v * 100 <= 999999999` och det
sammanlagda flyttalsfelet är som mest ungefär `1.6e-7` — drygt sex gånger under
toleransen. Den minsta äkta överträdelsen (ett halvt öre, `0.005`) ger `0.5`,
alltså fem tiopotenser över. Ordningen är därför inte smaksak: det är den som
gör regel 3 exakt. Konsekvens: `'9999999,995'` ger maxfelet, inte decimalfelet.

**Varför regel 4 finns, och varför den står sist.** Regel 1 prövas på det
inkommande `v`, men posten lagrar `Math.round(v * 100) / 100`. Varje `v` där
`0 < v < 1e-8` ger `v * 100 < 1e-6` och ryms alltså under regel 3:s tolerans:
kedjan släpper igenom värdet, och det som lagras blir `0`. En sådan post bryter
mot "> 0" och underkänns av `isEntry` — `createEntry` skulle returnera
`ok: true` för en post som skrivs till datafilen men aldrig kan läsas tillbaka,
och invarianten "allt som `createEntry` returnerar med `ok: true` godkänns av
`isEntry`" vore falsk. Det är felet i `LARDOMAR.md` (2026-08-19, belopp under
decimaltoleransen). Regel 4 är därför ingen ny värderegel utan regel 1
omprövad på det värde som faktiskt lagras: gränsvillkoret och lagringen ska
ligga på samma sida om avrundningen. Att den står **sist** är lika medvetet som
att regel 2 står före regel 3. Kördes den tidigare skulle den ta över fel som
hör hemma på regel 3: `'0,005'` och `'0,001'` avrundas också till noll öre men
är äkta decimalöverträdelser och ska ge `Beloppet får ha högst två decimaler.`,
inte `Beloppet måste vara större än 0 kr.` Gränsen mellan de två reglerna går
mellan `9.9e-9` och `1e-8`: för `1e-8` blir `v * 100` exakt `1e-6`, vilket inte
är mindre än toleransen, så regel 3 hinner först. Konsekvens: `0.01` är det
minsta belopp som kan lagras, och allt strikt under `1e-8` ger regel 4.

#### Facit — samma värde, samma fel i båda ingångstyperna

Raderna nedan är **obligatoriska testfall i paket 2**. Varje rad ska köras med
både strängen och talet och ge identisk `message` (respektive identiskt
`value.amountSek`). Detta uppfyller regeln i `LARDOMAR.md`
(2026-08-18, beloppsgränsen) om att varje rad i felmeddelandetabellen ska ha ett
test för båda vägarna.

**Kravet på identisk `message` gäller värden som finns i båda ingångstyperna**,
och det avgör vilka strängar som duger som exempel här. En sträng som den
vägledande texten i steg 1 träffar har ingen motsvarighet bland talen —
`50 kr` finns inte som `number` — och ett sådant par kan därför aldrig ge samma
svar. Villkoret på en sträng i den här tabellen är alltså: den ska antingen
matcha `AMOUNT_PATTERN` och nå regelkedjan, eller falla på steg 1 **utan** att
träffa `AMOUNT_HINT_PATTERN`. `'abc'` och `''` saknar siffra, `'1e3'` har ett
tecken utanför mönstrets teckenuppsättning; alla tre hamnar därför på
standardtexten, precis som `NaN`, `Infinity` och `null` gör.

Raden med `Infinity` hade `'50 kr'` som strängexempel fram till paket 8. Det
exemplet duger inte längre: `'50 kr'` får den vägledande texten, medan `Infinity`
får standardtexten, alltså två olika svar på en rad som kräver ett. Strängen är
utbytt mot `'1e3'`, som står i facittabellen under "Den vägledande texten för ett
skrivet belopp" med standardtexten och därmed parar ihop sig med `Infinity` igen.
`'50 kr'` är inte borttappat — det prövas i den tabellen, som en av raderna med
den vägledande texten.

| Sträng in | Tal in | `v` efter steg 1 | Vinnande regel | Resultat |
|-----------|--------|------------------|----------------|----------|
| `'abc'` | `NaN` | – | steg 1 | `Beloppet måste vara ett tal.` |
| `'1e3'` | `Infinity` | – | steg 1 | `Beloppet måste vara ett tal.` |
| `''` | `null` | – | steg 1 | `Beloppet måste vara ett tal.` |
| `'0'` | `0` | `0` | 1 | `Beloppet måste vara större än 0 kr.` |
| `'0,000'` | `0` | `0` | 1 | `Beloppet måste vara större än 0 kr.` |
| `'-0'` | `-0` | `-0` | 1 | `Beloppet måste vara större än 0 kr.` |
| `'-0,00'` | `-0` | `-0` | 1 | `Beloppet måste vara större än 0 kr.` |
| `'-50'` | `-50` | `-50` | 1 | `Beloppet måste vara större än 0 kr.` |
| `'10000000'` | `10000000` | `10000000` | 2 | `Beloppet får vara högst 9 999 999,99 kr.` |
| `'9999999,995'` | `9999999.995` | `9999999.995` | 2 | `Beloppet får vara högst 9 999 999,99 kr.` |
| `'1,005'` | `1.005` | `1.005` | 3 | `Beloppet får ha högst två decimaler.` |
| `'0,005'` | `0.005` | `0.005` | 3 | `Beloppet får ha högst två decimaler.` |
| `'0,001'` | `0.001` | `0.001` | 3 | `Beloppet får ha högst två decimaler.` |
| `'0,00000001'` | `1e-8` | `1e-8` | 3 | `Beloppet får ha högst två decimaler.` |
| `'0,0000000099'` | `9.9e-9` | `9.9e-9` | 4 | `Beloppet måste vara större än 0 kr.` |
| `'0,000000001'` | `1e-9` | `1e-9` | 4 | `Beloppet måste vara större än 0 kr.` |
| `'199'` | `199` | `199` | ingen | giltig, `amountSek` blir `199` |
| `'199,50'` | `199.5` | `199.5` | ingen | giltig, `amountSek` blir `199.5` |
| `'1,000'` | `1` | `1` | ingen | giltig, `amountSek` blir `1` |
| `'0,01'` | `0.01` | `0.01` | ingen | giltig, `amountSek` blir `0.01` |
| `'9999999,99'` | `9999999.99` | `9999999.99` | ingen | giltig |

Raden `'0,000'` var den som tidigare gav två olika svar. Att den nu ger regel 1
följer av två saker samtidigt: decimalantalet räknas på **talet** `0` (som har
noll decimaler), och regel 1 står dessutom före regel 3 i kedjan.

Raden `'1,000'` accepteras och blir `1`. Det är avsiktligt: valideringen bedömer
värdet, inte hur användaren råkade skriva det. `1.000` som tal accepteras redan,
och strängen måste ge samma svar.

Raderna `'0,00000001'` (`1e-8`) och `'0,0000000099'` (`9.9e-9`) är paret på var
sin sida om regel 3:s tolerans och är obligatoriska av just det skälet: en
toleransjämförelse ska ha testfall på båda sidor om sin gräns. `'0,01'` är den
nedre giltiga gränsen — ett öre — och visar var kedjan slutar avvisa.

**Kontrollen som ska köras varje gång kedjan för `amountSek` ändras — bindande.**
Filen har nu tre tabeller som svarar på vad ett värde ger: felmeddelandetabellen
under "Valideringsregler och exakta felmeddelanden", facittabellen under "Den
vägledande texten för ett skrivet belopp" och den här. Ett nytt steg i kedjan kan
göra en rad i vilken som helst av dem falsk utan att någon rör raden, och det har
hänt: paket 8:s vägledande text gjorde raden `'50 kr'` här osann, eftersom samma
sträng plötsligt fick ett annat svar än sitt tal. Kontrollen är den `LARDOMAR.md`
(2026-08-23, två facit i samma fil ger olika svar för samma belopp) föreskriver,
och den kördes inte när steget lades till: **kör varje värde ur alla tre
tabellerna genom hela kedjan och kräv att tabellerna ger samma svar.** För
strängarna i den här tabellen gäller dessutom villkoret ovan — en sträng som
träffar `AMOUNT_HINT_PATTERN` hör inte hemma här. Utfallet klistras in i paketets
redovisning, rad för rad; ett skäl att inte köra räknas aldrig som en körning.

### Kanonisk lagringsform — det enda `isEntry` kräver utöver regelkedjan

`validateEntryDraft` gör två saker: den **avvisar** ogiltiga värden, och den
**normaliserar** de godkända. Tabellen räknar upp de fält normaliseringen berör:

| Fält | Kanonisk form (det som lagras) | Ägare av uttrycket |
|------|--------------------------------|--------------------|
| `name` | `raw.trim()` | `String.prototype.trim` |
| `amountSek` | `normalizeZero(Math.round(v * 100) / 100)` | `canonicalAmountSek` i `entry.js` |

`id`, `interval`, `startDate` och `category` lagras exakt som de kom in och har
ingen kanonisk form utöver sig själva.

**Varför kedjan inte räcker vid inläsning.** Regelkedjan svarar på frågan *är
det här värdet godtagbart som indata*. `isEntry` ställer en annan fråga: *är det
här värdet den form skrivvägen producerar*. De två frågorna kan inte ha ett
gemensamt facit, och skillnaden är mätbar: regel 3 är en toleransjämförelse, så
`199.999999999` passerar kedjan medan `validateEntryDraft` för samma värde
lagrar `200`. En datafil kunde alltså innehålla ett belopp som `isEntry` släpper
in men som appen därefter visar och räknar med som ett annat tal
(`LARDOMAR.md`, 2026-08-23, `isEntry` godkänner belopp som appen räknar om till
ett annat tal).

**Bindande.** För varje normaliserat fält kräver `isEntry` att värdet redan
**är** sin kanoniska form:

```js
value.name === value.name.trim()
value.amountSek === canonicalAmountSek(value.amountSek)
```

Detta är samma krav som `isEntry` sedan tidigare ställer på `name`, nu skrivet
som en regel i stället för som ett enskilt undantag. Det är också det **enda**
krav `isEntry` ställer utöver regelkedjan; varje annan skillnad mellan `isEntry`
och `validateEntryDraft` är ett fel.

**Ingen regel skrivs av för hand.** Uttrycket `Math.round(amountSek * 100) / 100`
har exakt en ägare, `canonicalAmountSek`, som anropas både av `checkAmountSek`
när det godkända beloppet ska returneras och av `isEntry`. Skrivvägen och
läsvägen kan därmed inte glida isär: byter avrundningen form på ett ställe byter
den form på båda. Samma ägarregel som för `isValidEntryId` och
`ISO_DATE_PATTERN` (se "Mappstruktur").

**Invarianten står fast.** *"Allt som `createEntry` returnerar med `ok: true`
godkänns av `isEntry`"* gäller fortfarande, och gör det just därför att kravet
är formulerat som likhet med skrivvägens egen utdata i stället för som ännu en
tolerans: skrivvägen returnerar `canonicalAmountSek(v)`, och `isEntry` frågar om
värdet är lika med `canonicalAmountSek` av sig självt.

**Det gör invarianten beroende av att `canonicalAmountSek` är en fixpunkt på sin
egen utdata.** Om det för något lagringsbart belopp gäller att
`canonicalAmountSek(canonicalAmountSek(v)) !== canonicalAmountSek(v)` faller
invarianten. Det är ett påstående om flyttalsaritmetik och skrivs därför
**inte** ned här som ett faktum (`LARDOMAR.md`, 2026-08-23,
gränsvärdespåstående om flyttal skrevs ned utan att köras). I stället är det ett
krav på byggaren att köra det och redovisa utdatan:

- För varje heltal `ore` i `[1, 200000]`, uttömmande, ska
  `canonicalAmountSek(ore / 100) === ore / 100` gälla.
- Detsamma ska gälla för `ore`-värdet i varje giltig rad i facittabellen ovan
  (`19900`, `19950`, `100`, `1`, `999999999`).
- Körningen lämnas kvar som testfall i `tests/entry.test.js`, och den faktiska
  utdatan klistras in i paketets redovisning.
- Visar körningen ett `ore` där likheten inte håller är det en lucka i den här
  filen och ska lämnas tillbaka till arkitekten. Den får **inte** lappas med en
  tolerans i `isEntry` — då är vi tillbaka i felet som det här avsnittet finns
  för att stänga.

**Obligatoriska testfall i paket 2** (hämtade ur lärdomen, som körde dem):

| `amountSek` i posten | `isEntry` |
|----------------------|-----------|
| `199.999999999` | `false` |
| `199.000000001` | `false` |
| `0.01` | `true` |
| `199.5` | `true` |
| `9999999.99` | `true` |

Vilket av `isEntry`-stegen som fäller vart och ett av de två `false`-fallen ska
inte påstås i en testkommentar förrän mutationskravet i "Teststrategi" har visat
det.

### Interna fel i `createEntry` — separat från formulärfelen

`createEntry(draft, makeId)` tar emot `makeId` som injicerbar parameter. I
appen är den alltid `crypto.randomUUID()`; parametern finns enbart för att
tester ska kunna ge förutsägbara id:n. Ett id som `isValidEntryId` underkänner
kan alltså **inte orsakas av användaren** — det kräver att någon har skickat in
en trasig `makeId`. Felet hör därför inte hemma i tabellen ovan, som beskriver
inmatning en användare kan rätta.

**Regel.** Efter att `validateEntryDraft` godkänt utkastet anropar `createEntry`
`makeId()` och kontrollerar resultatet med `isValidEntryId` (villkoret står
under "Vad som är ett giltigt `id`" och skrivs inte om här). Ger `isValidEntryId`
`false` returneras

```
{ ok: false, errors: [ { field: 'id', message: 'Posten kunde inte skapas på grund av ett internt fel.' } ] }
```

Returtypen är `ValidationResult`, alltså samma som vid formulärfel. Det är
bindande enligt `LARDOMAR.md` (2026-08-18, `createEntry` litar blint på det
injicerade id:t) och `createEntry` får inte kasta i stället.

**Byggarens provisoriska sträng `Posten kunde inte skapas: id saknas.` ersätts
av strängen ovan.** Två skäl: den var inte sann i alla fall regeln täcker
(`makeId` som ger `42` eller `''` är inget som "saknas"), och den visar det
tekniska ordet "id" för en användare, vilket bryter mot regeln längst ned i den
här filen om att inga id:n eller engelska nyckelvärden syns i gränssnittet.

**Fältet är `'id'`.** Det är ingen etikett åt användaren utan en maskinläsbar
uppgift om var felet uppstod, och det är just därför det aldrig får renderas som
ett fältfel — `id` finns inte i formuläret.

**Konsekvenser som är bindande för paket 4 och 5:**

- `api.js`: innehåller `errors` ett fel med `field: 'id'` svarar servern
  `500 { "error": "<message>" }` — **inte** `400`, och **utan** `fieldErrors`.
  Klientens anrop var korrekt; det är appen som gick sönder. Samma form som vid
  `StorageError`, vilket är avsiktligt: båda är serverfel.
- `app.js`: fel vars `field` inte motsvarar ett fält i formuläret visas i
  formulärets allmänna felruta, aldrig tyst. Utan den regeln skulle ett
  `id`-fel resultera i att inget händer när användaren trycker Spara.
- Ingen post får skapas, sparas eller returneras när det här felet inträffar.

**Obligatoriskt testfall i paket 2** (följer av samma lärdom):
`createEntry(giltigtUtkast, () => 42)`, `createEntry(giltigtUtkast, () => '')`
och `createEntry(giltigtUtkast, () => '   ')` ger alla tre `ok: false` med exakt
strängen ovan. Blanktecken-fallet är obligatoriskt därför att det är det enda
värde där ett handskrivet `id.length > 0` och `isValidEntryId` ger olika svar —
det är precis där spec och kod kan glida isär utan att något annat test märker
det. Dessutom ska invarianten *"allt som `createEntry` returnerar med `ok: true`
godkänns av `isEntry`"* finnas som eget test.

---

## Betalningsintervall och normalisering

Intervallen står i tabellen nedan, och den är uttömmande.
Veckointervall är medvetet bortvalt: det går inte att normalisera exakt mot ett
kalenderår, eftersom ett år inte är ett helt antal veckor. Halvårsvis
(`semiannual`) var bortvalt i paket 1–8 och **tillkom i etapp 1** — det gick att
normalisera exakt och efterfrågades av användaren; se "Del 2".

| `interval` | Betalningar per år | Månader per period |
|------------|--------------------|--------------------|
| `monthly` | 12 | 1 |
| `quarterly` | 4 | 3 |
| `semiannual` | 2 | 6 |
| `yearly` | 1 | 12 |

**All beloppsaritmetik sker i heltal öre.** Kronor är endast in- och utdata.
`amountOre = Math.round(entry.amountSek * 100)`. Flyttal får aldrig adderas
eller divideras i kronor.

Normalisering:

```
yearlyOre(entry)  = amountOre(entry) * PAYMENTS_PER_YEAR[entry.interval]     // heltal, spärrat mot 2^53
monthlyOre(entry) = divideRoundHalfUp(yearlyOre(entry), MONTHS_PER_YEAR)     // avrundat

totalYearlyOre(entries)  = summan av yearlyOre för varje post                // heltal, spärrat mot 2^53
totalMonthlyOre(entries) = divideRoundHalfUp(totalYearlyOre(entries), MONTHS_PER_YEAR)  // avrundat EN gang
```

Tom lista är ett fall bara för de två `total`-funktionerna: `yearlyOre` och
`monthlyOre` tar **en post**, inte en lista, och `yearlyOre([])` kastar. Vad de
fyra funktionerna svarar och kastar — inklusive `totalYearlyOre([])` och
`totalMonthlyOre([])` — står under `src/core/cost.js` i "Gränssnitt". Det är
filens enda facit för `cost.js` ingångsspärrar och för tomlist-fallet, och det
upprepas inte här.

**Bindande beslut om totalen.** Totalen räknas ur den exakta årssumman och
avrundas en enda gång. Den räknas *inte* som summan av de avrundade
månadsbeloppen. Konsekvens: kolumnen med månadsbelopp per post kan skilja sig
någon enstaka öre från den visade månadstotalen. Det är avsiktligt och ska
testas som förväntat beteende i paket 3, inte rapporteras som en bugg.

Exempel att testa i paket 3: tre årsposter à 100,00 kr ger per post 8,33 kr/mån
(833 öre) men månadstotal 25,00 kr (2500 öre), inte 24,99 kr.

---

## Avrundningsregel

Regeln bor i `src/core/money.js` och byggs i **paket 3**, tillsammans med
`cost.js` som är dess enda kärnanvändare. Paket 2 rör den inte.

Formeln (giltighetsområdet och ingångsspärrarna står under formeln):

```
divideRoundHalfUp(numerator, denominator)
  = Math.floor((2 * numerator + denominator) / (2 * denominator))
```

- Regeln är "halva öret uppåt". Alla belopp i appen är positiva, så uppåt och
  bort-från-noll är samma sak. Negativa belopp är otillåtna redan i
  valideringen och behöver inte hanteras.
- Avrundning sker **en gång per visat värde** och aldrig i mellanled.

**Giltighetsområde — bindande.** `2 * numerator + denominator` räknas i
`Number`, inte i någon heltalstyp, och `Number` bär hela heltal bara upp till
`Number.MAX_SAFE_INTEGER`. Funktionen ska därför kasta `RangeError` i stället
för att svara utanför det området. Den här filen påstår **inte** att resultatet
är exakt inom området — det är ett flyttalspåstående och står som körkrav på
byggaren nedan.

Ingångsspärrarna prövas i den här ordningen. Första träff vinner, och det här
är det enda facit som gäller för ordningen mellan dem:

| # | Villkor | Meddelande i `RangeError` |
|---|---------|---------------------------|
| 1 | `!Number.isInteger(numerator)` | `divideRoundHalfUp kräver ett heltal som täljare.` |
| 2 | `!Number.isInteger(denominator)` | `divideRoundHalfUp kräver ett heltal som nämnare.` |
| 3 | `denominator <= 0` | `divideRoundHalfUp kräver en nämnare större än 0.` |
| 4 | `!Number.isSafeInteger(2 * numerator + denominator)` | `divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.` |

Regel 4 står **sist** därför att den räknar på båda argumenten: körs den före
regel 1–3 får `divideRoundHalfUp('120000', 12)` ett meddelande om summan i
stället för om täljaren, och `divideRoundHalfUp(12n, 12)` kastar `TypeError`
från aritmetiken i stället för modulens `RangeError` (`LARDOMAR.md`,
2026-08-24: `BigInt` och `Symbol` kastar där varje annan typ ger `NaN`).

**Körkrav på byggaren (paket 3).** Att `divideRoundHalfUp` ger samma tal som
samma formel i `BigInt` inom området är inget som får skrivas som faktum här
förrän det körts. Byggaren ska köra `divideRoundHalfUp(t, 12)` och jämföra med
`Number((2n * BigInt(t) + 12n) / 24n)` för `t = Number.MAX_SAFE_INTEGER`,
`2 ** 53`, `2 ** 53 - 3`, `2 ** 54`, `4503599627370489` och `4503599627370490`
(de två sista väntas vara den sista täljare som passerar spärren respektive den
första som avvisas — redovisa det faktiska utfallet, inte det väntade), och
klistra in utdatan i paketets redovisning. Samma krav gäller `totalYearlyOre`:
kör en lista vars summa passerar och en vars summa avvisas, och visa att den
som passerar stämmer med `BigInt`-summan.

Kontrollvärden som ska stå som testfall i paket 3:

| Fall | `numerator` (öre) | `denominator` | Resultat (öre) |
|------|-------------------|---------------|----------------|
| 100 kr/mån → månad | 120000 | 12 | 10000 |
| 100 kr/kvartal → månad | 40000 | 12 | 3333 |
| 100 kr/år → månad | 10000 | 12 | 833 |
| exakt halva öret uppåt | 150 | 12 | 13 |
| precis under halva | 149 | 12 | 12 |
| noll | 0 | 12 | 0 |

Visning: `formatSek(ore)` ger `Intl.NumberFormat('sv-SE', { style: 'currency',
currency: 'SEK', minimumFractionDigits: 2, maximumFractionDigits: 2 })` på
`oreToSek(ore)`. Formatering görs bara i gränssnittet, aldrig före en beräkning.
`formatSek` byggs i paket 3 med resten av `money.js` även om första
användningen i gränssnittet kommer i paket 6 — en modul byggs och testas i sin
helhet i ett paket, inte styckevis.

**Visningsvägens ingångsspärr har en ägare: `oreToSek`.** Villkoret
`!Number.isSafeInteger(ore)` ger `RangeError` med meddelandet
`oreToSek kräver ett säkert heltal öre.` `formatSek` skriver inte av villkoret
och räknar aldrig om öre till kronor själv — den anropar `oreToSek` och ärver
spärren därigenom, samma ägarregel som gäller `isValidEntryId` i `entry.js`.
Följden är bindande: `formatSek(NaN)`, `formatSek(Infinity)`,
`formatSek(-Infinity)`, `formatSek('abc')`, `formatSek(1.5)`,
`formatSek(1e300)`, `formatSek(null)`, `formatSek(1n)` och
`formatSek(Symbol('x'))` kastar alla `RangeError` med den strängen, i stället
för att ge `"NaN kr"`, `"∞ kr"`, en sträng på 313 tecken eller ett `TypeError`.

`Number.isSafeInteger` är valt framför `Number.isInteger`. Det är strikt
starkare — allt som `Number.isInteger` avvisar avvisas också här — och det
täcker dessutom `1e300`, som är ett heltal men inte ett säkert. Med det valet
mäter hela modulen sina tal med ett och samma begrepp: `sekToOre` tar kronor och
kräver ett finit tal, allt som räknar i öre kräver ett säkert heltal.

### `-0` normaliseras till `0` — villkoret ägs av `normalizeZero` (bindande)

`-0` är samma tal som `0`: `-0 === 0` är `true`, `-0 <= 0` är `true`, och
`Number.isFinite(-0)`, `Number.isInteger(-0)` och `Number.isSafeInteger(-0)` är
alla `true`. Inget `Number.is*`-predikat är därför en spärr mot `-0`. Den enda
skada `-0` gör i den här appen är tecknet i visningen: `formatSek(-0)` gav
kodpunkterna `U+2212 U+0030 U+002C U+0030 U+0030 U+00A0 U+006B U+0072`, alltså
`"\u22120,00\u00a0kr"` (granskarens körning, `LARDOMAR.md` 2026-09-02). Talet är
rätt, tecknet är fel.

**Beslut: `-0` avvisas inte någonstans i `src/core/`. Det normaliseras till `0`
och behandlas i övrigt exakt som `0`.** Ingen ny felsträng införs, och ingen
funktion får kasta för `-0`. Skälet är att `-0` inte är ett ogiltigt värde utan
noll skrivet med tecken: en avvisning skulle kräva att modulen svarar olika på
två skrivsätt för samma tal, och den skillnaden kan användaren aldrig göra —
`-0`, `'-0'` och `'-0,00'` avvisas redan av `entry.js` med
`Beloppet måste vara större än 0 kr.` (regel 1, `v <= 0`).

**Ägaren är `normalizeZero(value)` i `money.js`**, definierad som
`Object.is(value, -0) ? 0 : value`. Det är den enda definitionen av villkoret
"detta är `-0`" i projektet. Ingen annan funktion — varken i `money.js`,
`entry.js` eller `cost.js` — får skriva `Object.is(v, -0)` eller
`v === 0 ? 0 : v` för hand; de anropar ägaren, precis som `isValidEntryId`,
`canonicalAmountSek` och `isPlainObject` anropas i stället för att skrivas av.

`normalizeZero` har **medvetet ingen ingångsspärr**, och det är ett namngivet
undantag från regeln att varje exporterad funktion i `money.js` har samma
ingångskontroll och samma feltyp. Skälet: den avgör en identitet, inte ett
värde, och `Object.is` kastar för ingen indata — `normalizeZero(NaN)` ger `NaN`,
`normalizeZero(1n)` ger `1n`, `normalizeZero(Symbol('x'))` ger samma symbol.
Kastade den för icke-finit indata kunde `canonicalAmountSek` inte anropa den, och
`isEntry` får inte kasta.

Anropsställena är tre, och de är bindande:

| Funktion | Returnerar |
|----------|------------|
| `sekToOre` i `money.js` | `normalizeZero(Math.round(amountSek * ORE_PER_SEK))` |
| `oreToSek` i `money.js` | `normalizeZero(ore / ORE_PER_SEK)` |
| `canonicalAmountSek` i `entry.js` | `normalizeZero(…)` runt den kanoniska formen |

`formatSek` får **inget** eget anrop: den går genom `oreToSek` och ärver
normaliseringen, samma ägarregel som gäller ingångsspärren. `cost.js` får inget
anrop alls — dess `amountOre` kommer från `sekToOre` och är redan normaliserat.

Följder, och de är facit:

- `sekToOre(-0)`, `sekToOre(-0.001)`, `sekToOre(-0.004)` och `sekToOre(-1e-9)`
  ger `0`, inte `-0`. (Att just de fyra kronvärdena avrundas till noll öre är
  kört: `tests/cost.test.js` asserterar det för de tre första, granskarens
  körning visade det för `-1e-9`.)
- `oreToSek(-0)` ger `0`.
- `formatSek(-0)` ska ge exakt samma sträng som `formatSek(0)`; väntad sträng är
  `"0,00\u00a0kr"` — byggaren redovisar den faktiska kodpunktsföljden, inte den
  väntade.
- `canonicalAmountSek(-0)` och `canonicalAmountSek(-1e-9)` ger `0`.
- Invarianten, bindande för alla paket: **ingen exporterad funktion i
  `src/core/` får returnera `-0`.**

**Inget fjärde anrop utan en körning.** `divideRoundHalfUp` får ett anrop till
`normalizeZero` endast om en körning visar att den kan returnera `-0`. Byggaren
kör `divideRoundHalfUp(-0, 12)`, `divideRoundHalfUp(-1, 2)`,
`divideRoundHalfUp(-1, 3)`, `divideRoundHalfUp(-6, 12)` och
`divideRoundHalfUp(0, 12)`, redovisar `Object.is(resultat, -0)` för varje fall,
och lägger in anropet bara om något fall ger `true`. Ger inget fall `-0` skrivs
inget anrop: en rad som ingen indata kan skilja överlever mutation och är död
kod, vilket "Teststrategi" förbjuder.

---

## Härledning av nästa dragningsdatum

Nästa dragning lagras inte. Den räknas fram ur `interval` + `startDate` + dagens
datum, varje gång den visas.

**Datum är alltid strängar `"YYYY-MM-DD"`.** Ingen funktion i `src/core/` får
skapa ett `Date` från en sträng med `new Date(str)` och sedan använda
`getMonth()`/`getDate()` — det ger fel vid tidszonsskiften. Datum bryts isär med
`parseIsoDate` till `{ year, month, day }` med `month` 1–12. `Date.UTC` får bara
användas för att räkna antal dagar mellan två datum.

**Formatkontrollen av ett datum sker på exakt ett ställe:** `ISO_DATE_PATTERN` i
`src/core/dates.js`. Ingen annan modul får definiera ett eget datummönster —
`entry.js` importerar konstanten. Mönstret kontrollerar bara *formen*
`ÅÅÅÅ-MM-DD`; att datumet finns i kalendern avgörs av `parseIsoDate`, och att
året ligger i intervallet 1970–2099 avgörs av `entry.js`. Tre olika frågor, tre
olika kontroller, ingen av dem får svara på någon annans fråga.

Begrepp:

```
monthIndex(year, month) = year * 12 + (month - 1)
step                    = MONTHS_PER_PERIOD[interval]        // 1, 3 eller 12
occurrence(k)           = addMonthsClamped(startDate, k * step),  k = 0, 1, 2, …
```

**Klampningsregeln (månadsskiften och dag 29–31).** `addMonthsClamped` räknar
fram målmånaden och sätter dagen till
`Math.min(startDate.day, daysInMonth(målår, målmånad))`. Klampningen utgår
**alltid från startdatumets ursprungliga dag** — aldrig från föregående
klampade resultat. En post som startar den 31:e dras alltså den 31:e i varje
månad som har 31 dagar, och den sista dagen i månaden i de månader som är
kortare.

**Algoritmen för `nextDueDate(entry, todayIso)`:**

1. `diff = monthIndex(today) - monthIndex(startDate)`
2. `k = Math.max(0, Math.floor(diff / step))`
3. Så länge `occurrence(k) < today`: `k = k + 1`
4. Returnera `occurrence(k)`

Jämförelsen i steg 3 är strängjämförelse av `"YYYY-MM-DD"` (fungerar
lexikografiskt) via `compareIsoDates`. Med `addMonthsClamped` växer `occurrence`
med minst 28 dagar per steg, så loopen terminerar och kör i praktiken högst 2–3
varv. Beviset vilar alltså på förvalet: utförs `occurrence`-steget av något annat
än `addMonthsClamped` gäller det inte, och den skillnaden bevakas inte — se
"Parameterns kontrakt" under "Steg 2 görs mätbart".

Konsekvenser som följer av algoritmen och som ska testas i paket 7:

- Startdatum i framtiden → `k = 0` → nästa dragning **är** startdatumet.
- Startdatum exakt idag → `occurrence(0) = today` → nästa dragning är idag, och
  `daysUntil` för posten är `0`.
- Startdatum flera perioder tillbaka → steg 2 hoppar direkt till rätt trakt,
  steg 3 justerar. Inget varv-för-varv-räknande från 1970. **Det här kravet
  handlar om arbete och inte om ett värde**, och prövas därför av punkt (S3) i
  kravlistan för `tests/schedule.test.js` — inte av någon assertion på
  returvärdet. Skälet, och varför de andra vägarna förkastades, står under
  "Steg 2 görs mätbart" nedan.

Facit att använda som testfall i paket 7:

| `startDate` | `interval` | `today` | Nästa dragning | Varför |
|-------------|-----------|---------|----------------|--------|
| `2026-09-01` | `monthly` | `2026-08-18` | `2026-09-01` | framtida start |
| `2026-08-18` | `monthly` | `2026-08-18` | `2026-08-18` | start = idag, 0 dagar kvar |
| `2026-01-31` | `monthly` | `2026-02-01` | `2026-02-28` | februari är kortare |
| `2026-01-31` | `monthly` | `2026-03-01` | `2026-03-31` | klampningen smittar inte vidare |
| `2024-02-29` | `yearly` | `2026-08-18` | `2027-02-28` | skottdag, flera år tillbaka |
| `2020-03-31` | `quarterly` | `2026-08-18` | `2026-09-30` | 26 perioder tillbaka, september har 30 dagar |
| `2026-12-31` | `quarterly` | `2026-08-18` | `2026-12-31` | start i framtiden trots samma år |

**Dagar kvar.** Storheten bor i fältet `daysUntil` på `upcoming`s
`UpcomingItem` och räknas som `daysBetween(idag, nästa dragning)`, alltid ett
icke-negativt heltal. `daysBetween` i `dates.js` äger räkningen
`(Date.UTC(nästa) - Date.UTC(idag)) / 86400000`, och `schedule.js` skriver ingen
egen kopia av den. UTC används för att sommartid annars ger 23- och
25-timmarsdygn. Att `schedule.js` inte har någon egen exporterad funktion för
storheten är ett beslut med skäl; se beslutsloggen.

**Sortering av kommande dragningar.** `upcoming(entries, todayIso)` sorterar
stigande på `nextDueDate`. Vid samma datum: `name` med
`a.name.localeCompare(b.name, 'sv')`, och vid samma namn `id` med vanlig
strängjämförelse. Ordningen är därmed oberoende av inmatningsordningen **så länge
två poster skiljer sig på någon av de tre nycklarna**, och det gör de i en datafil
appen själv har skrivit: `createEntry` ger varje post ett eget
`crypto.randomUUID()`.

Påståendet var tidigare skrivet som "alltid stabil och oberoende av
inmatningsordningen", utan villkoret, och det är inte sant för två poster som är
lika på alla tre nycklarna: jämföraren svarar då `0`, sorteringen är stabil, och
de två behåller den ordning de kom in i. Det är rätt beteende och det enda
möjliga — poster som är lika på varje nyckel jämföraren läser går inte att
ordna sinsemellan — men villkoret ska stå skrivet, och `0`-svaret ska vara prövat:
en jämförare som svarar något annat än `0` för två lika element är inte reflexiv,
och då är ordningen varken stabil eller oberoende av något. Punkt (S5) i
kravlistan för `tests/schedule.test.js` är det provet.

**Klockan läses på exakt ett ställe:** `todayIso()` i `src/core/dates.js`.
Ingen annan funktion i `src/core/` får anropa `Date.now()` eller `new Date()`
utan argument. Alla funktioner som behöver dagens datum tar emot det som
parameter. Utan den regeln går paket 7 inte att testa.

Hela det här avsnittet hör till **paket 7** och byggdes där, tillsammans med de
fem exporter i `dates.js` som tillkom i samma paket (se gränssnittslistan).
Skälet till att de inte byggdes tidigare står kvar som regel: en export utan
användare stod otestad, och de fem fick sin första användare först här.

### Ingångsspärrar i `src/core/schedule.js` — bindande [paket 7]

Modulen äger hela sin egen indatakedja. Alla spärrar kastar `RangeError`, samma
feltyp som `dates.js`, `money.js` och `cost.js` använder, och värdet skrivs in i
meddelandet med `String(...)` och aldrig direkt i en mallsträng: `${Symbol('x')}`
kastar `TypeError`, medan `String(Symbol('x'))` ger `'Symbol(x)'`
(`LARDOMAR.md`, 2026-08-24). Ingen exporterad funktion i modulen får returnera
`NaN` eller `-0` för någon indata; den kastar i stället.

Det här avsnittet är filens enda facit för ordningen mellan `schedule.js` egna
fel och för de svenska strängarna. Beloppet prövas inte här: `amountSek` är
`cost.js` domän, och en post med negativt belopp ger samma dragningsdatum som en
med positivt.

`nextDueDate(entry, todayIsoDate, addMonths)` är en numrerad kedja där **första
träff vinner** — villkoren körs sekventiellt i en enda funktion, med
`start = parseIsoDate(entry.startDate)` och `today = parseIsoDate(todayIsoDate)`:

| # | Villkor | Meddelande i `RangeError` |
|---|---------|---------------------------|
| 1 | `!isPlainObject(entry)` — ägarfunktionen i `entry.js` | `nextDueDate kräver en post som objekt.` |
| 2 | `!Object.hasOwn(MONTHS_PER_PERIOD, entry.interval)` | `` `nextDueDate kräver ett känt interval, fick "${String(entry.interval)}".` `` |
| 3 | `start === null` | `` `nextDueDate kräver ett startDate på formen ÅÅÅÅ-MM-DD, fick "${String(entry.startDate)}".` `` |
| 4 | `today === null` | `` `nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(todayIsoDate)}".` `` |
| 5 | `typeof addMonths !== 'function'` | `` `nextDueDate kräver att addMonths är en funktion, fick "${String(addMonths)}".` `` |

Ordningen bär beslut som inte är utbytbara:

- **Rad 1 har en ägarfunktion, inte en handskriven kopia.** `isPlainObject`
  importeras från `entry.js` och säger `true` för ett `Date`, eftersom villkoret
  är `typeof value === 'object'`, inte `null` och inte en array. Följden är facit:
  `nextDueDate(new Date(), '2026-08-18')` faller på rad 2 och inte på rad 1,
  precis som `yearlyOre` i `cost.js` gör. En array med de sex fälten påsatta
  faller däremot på rad 1, därför att ägarfunktionen har `!Array.isArray(value)`.
- **Rad 2 gör uppslaget med `Object.hasOwn`**, inte med
  `MONTHS_PER_PERIOD[entry.interval]` och en sanningsprövning. Annars hittar
  `interval: 'constructor'` något på prototypen, och `interval: 'weekly'` ger
  `undefined` rakt in i `k * step`, alltså `NaN` i stället för ett fel.
  Skillnaden syns bara i **meddelandet**: båda skrivsätten kastar `RangeError`,
  men det sanningsprövade uppslaget kastar det längre ned, från
  `addMonthsClamped`, och pekar då ut fel orsak. Det är därför punkt (S4) i
  kravlistan asserterar hela `message` och inte bara feltypen.
- **Rad 5 står sist**, efter kontrollen av dagens datum och före steg 1 i
  algoritmen. Skälet, den indata där placeringen ändrar svaret och vad raden inte
  lovar står under "Steg 2 görs mätbart" nedan; raden upprepas inte där.

`upcoming(entries, todayIsoDate)` skrivs som funktionens gång och inte som en
numrerad tabell: dess villkor prövas inte efter varandra utan varvat med
`nextDueDate`-kedjan i en loop över posterna, och en numrerad tabell skulle där
ge ett annat svar än koden (`LARDOMAR.md`, 2026-09-02, `totalYearlyOre`-tabellen
numrerar spärrarna i en ordning koden inte följer).

```
if (!Array.isArray(entries))
    -> RangeError: upcoming kräver en lista med poster.
för varje entry i entries, i listans ordning:
    due = nextDueDate(entry, todayIsoDate)   // nextDueDate-kedjan ovan äger felen här
    if (typeof entry.name !== 'string')
        -> RangeError: upcoming kräver ett name som sträng, fick "<String(entry.name)>".
    if (!isValidEntryId(entry.id))
        -> RangeError: upcoming kräver ett id som är en icke-tom sträng, fick "<String(entry.id)>".
sortera items med compareUpcoming
```

**Postens plats i listan avgör, inte radens plats i kedjan.** `name` och `id`
prövas för varje post och inte bara när två datum råkar vara lika: annars skulle
svaret bero på om en oduglig post hamnade bredvid en post med samma datum.
`isValidEntryId` är ägaren till "är det här ett giltigt id" och importeras från
`entry.js`; `upcoming` skriver ingen egen kopia av villkoret.

Indata där mer än ett villkor är sant samtidigt, med det vinnande meddelandet
utskrivet. Raderna följer av loopens ordning ovan och är obligatoriska testfall i
`tests/schedule.test.js`; byggaren kör båda och klistrar in utdatan i paketets
redovisning:

| Indata | Vinnande meddelande |
|--------|---------------------|
| `upcoming([post({ name: 42 }), post({ interval: 'weekly' })], '2026-08-18')` | `` upcoming kräver ett name som sträng, fick "42". `` |
| `upcoming([post({ interval: 'weekly' }), post({ name: 42 })], '2026-08-18')` | `` nextDueDate kräver ett känt interval, fick "weekly". `` |

**Den assertion som ensam skiljer en spärr i det här avsnittet från en annan
asserterar hela `message`, aldrig bara feltypen.** Feltypen delas av varje spärr i
modulen och av `dates.js`, så `assert.throws(fn, RangeError)` kan inte skilja en
spärr från en annan spärr längre ned i kedjan. Det var precis så rad 2 kunde
överleva sin mutation med grön svit (`LARDOMAR.md`, 2026-09-16).

Kravet gäller den rollen och inte varje `assert.throws` i filen. En bredare
uppräkning av **värden för samma spärr** — typlistor med `1n`, `Symbol('x')`,
`null`, `[]`, `new Date()` och liknande — får asserta enbart feltypen. De två
proven svarar på olika frågor: listan prövar att spärren avvisar varje värde,
fullmeddelandeassertionen prövar att det är just den spärren som gör det, och de
behöver inte ligga på samma rad. Den tidigare lydelsen sa "varje `assert.throws`"
och var därmed bredare än det som byggdes: en granskare kunde inte avgöra om en
`assert.throws(fn, RangeError)` i filen var ett fel eller ett godtaget undantag
(`LARDOMAR.md`, 2026-09-22).

**Villkoret som gör det avgörbart, och som körs innan `tests/schedule.test.js`
lämnas vidare:** varje spärr i det här avsnittet — varje rad i tabellen ovan och
varje `-> RangeError:` i pseudokoden för `upcoming` — ska ha minst en assertion
med hela meddelandet. Kontrollen är `grep -n "<meddelandets fasta del>"
tests/schedule.test.js` för var och en, där den fasta delen är strängen fram till
det första insatta värdet (för rad 2: `nextDueDate kräver ett känt interval`).
Varje sökning ska ge minst en träff, och utdatan klistras in i redovisningen; en
sökning utan träff stoppar paketet. En `assert.throws` som bara bär feltypen är
då per definition en bredare uppräkning och inget fel.

### Steg 2 görs mätbart (bindande) [paket 7]

Kravet "inget varv-för-varv-räknande från 1970" skiljer sig från varje annat krav
i den här filen: **de två kodvarianterna ger samma svar för varje indata.**
Mutationen `let k = Math.max(0, Math.floor(diff / step));` → `let k = 0;` är körd
två gånger av två olika läsare med samma utfall: `tests 335, pass 335, fail 0`
och `EXIT=0` på granskarens frysta träd (`LARDOMAR.md` 2026-09-14) och
`tests 97, pass 97, fail 0` och `EXIT=0` i körningen inför det här beslutet, där
`nextDueDate` för en månadspost från `1970-01-15` dessutom fortfarande gav
`2026-09-15`. Skillnaden är inte ett värde utan ett arbete: ett hopp direkt till
rätt trakt i stället för ett varv per period sedan startdatumet. Hur många varv
det blir beror på både `startDate` och `today`, och antalet står därför inte som
ett tal här — det hör hemma i den körning som ger det och redovisas av byggaren
under (S3). Ingen assertion på ett returvärde
kan alltså fälla den, och en assertion på körtid är förbjuden i projektet (se
"Inget test asserterar på körtid" under "Teststrategi").

**Beslut: arbetet görs mätbart genom att `nextDueDate` tar emot funktionen som
utför `occurrence`-steget som ett injicerbart argument.** Signaturen är
`nextDueDate(entry, todayIsoDate, addMonths = addMonthsClamped)`, **båda**
anropen av `occurrence` går genom `addMonths` — det i steg 2 och det i
korrigeringsloopen — och testet skickar in en omslutning som räknar sina anrop.
Formen är den `LARDOMAR.md` (2026-09-14) föreskriver. Injektion med förval är
inget nytt i projektet: `todayIso(now = new Date())` och `createEntry(draft,
makeId)` är byggda likadant.

Spärren för det injicerade värdet är rad 5 i tabellen under "Ingångsspärrar i
`src/core/schedule.js`". Villkoret och den svenska strängen står där och skrivs
inte av här — ett facit per fråga.

**Raden står sist i ingångskedjan**, efter kontrollen av dagens datum och före
steg 1. Placeringen är inte smak, och skillnaden skrivs som den indata där den
ändrar svaret: `nextDueDate(5, '2026-09-14', null)` ger med raden sist
`nextDueDate kräver en post som objekt.` och med raden först `nextDueDate kräver
att addMonths är en funktion, fick "null".` Företrädet för rad 1 till rad 4 i den
tabellen ska vara oförändrat, så raden för `addMonths` går sist — och just den
indatan är ett obligatoriskt testfall.

**Returvärdet från `addMonths` får ingen egen spärr.** Ägaren till frågan "är det
här ett datum" på den vägen är `compareIsoDates` i `dates.js`, som kastar
`RangeError` med sitt eget namn för allt som inte är `ÅÅÅÅ-MM-DD`. En andra kopia
av det villkoret i `schedule.js` vore samma fel som `LARDOMAR.md` (2026-09-02,
`cost.js` har en egen, svagare kopia av "är detta ett objekt"). Testfall:
`nextDueDate(giltigPost, '2026-09-14', () => 'skräp')` ska ge
`compareIsoDates`-meddelandet, inte ett meddelande från `schedule.js`.

**Parameterns kontrakt: vad som bevakas och vad som bara är dokumenterat.**
Kontraktet för det injicerade värdet har ett led per rad i tabellen nedan, och
ägarkolumnen säger vem som bevakar ledet. Utfallskolumnen är körd — körningarna
är granskarens på det frysta trädet (`LARDOMAR.md` 2026-09-14) och inget av dem
är härlett ur resonemang:

| Led | Ägare | Körd indata och utfall |
|---|---|---|
| Går att anropa | ingen | `typeof addMonths !== 'function'` avvisar varje värde som inte är en funktion med `RangeError` och modulens eget namn. En klass passerar raden: `typeof (class C {})` är `'function'`, och anropet ger `TypeError: Class constructor C cannot be invoked without 'new'`. |
| Ger ett datum `ÅÅÅÅ-MM-DD` | `compareIsoDates` i `dates.js` | `() => 'skräp'`, `() => new Date()`, `() => null` och `() => '2026-02-30'` ger alla `compareIsoDates`-meddelandet. |
| Flyttar `occurrence` framåt | ingen | `nextDueDate(giltigPost, '2026-09-14', () => '1970-01-01')` hänger för alltid; avbröts med `timeout 8` och `EXIT=124`. |

**Beslut: parametern är en testsöm vars första och sista led är dokumenterade,
inte bevakade.** `src/core/schedule.js` får ingen spärr för "går att anropa" och
ingen för "flyttar framåt". Skälen, vart och ett knutet till en regel filen redan
följer:

- **Ingen väg in i appen når leden.** Ingen kod i `src/` skickar ett tredje
  argument, och kontrollen är `grep -rn "nextDueDate" src/`: varje träff ska vara
  definitionen i `schedule.js`, ett anrop med **två** argument, eller
  `src/web/app.js`, som bara läser fältet `nextDueDate` ur `upcoming`. Kontrollen
  är skriven som ett villkor på träffarna och inte som en uppräkning av dem, så
  att den inte blir falsk av att ett anropsställe tillkommer eller försvinner. En
  spärr för något av de två leden skulle alltså bara kunna nås av ett test skrivet
  för spärren själv, och det är den konstruktion `LARDOMAR.md` 2026-09-04 och
  2026-09-07 kräver att man tar bort i stället för att bygga.
- **"Går att anropa" går inte att avgöra utan att anropa.** Den enda formen är ett
  `try`/`catch` runt anropet som skriver om ett `TypeError` till ett `RangeError`.
  Den `catch`-grenen är precis en sådan gren, och den skulle dessutom fånga varje
  `TypeError` som uppstår **inne** i `addMonthsClamped` och sätta modulens eget
  namn på det — ett meddelande som pekar ut fel orsak, samma fel som
  `divideRoundHalfUp`-meddelandet i `LARDOMAR.md` 2026-09-02.
- **"Flyttar framåt" går bara att avgöra med ett tak på antalet varv.** Det är
  ordagrant förkastad väg 3 nedan, med skälet utskrivet där. Ett tak som förs in
  under namnet "kontraktskontroll" är samma rad med ett annat namn.
- **`typeof`-raden står kvar, och den lovar något annat.** Den avgör ett
  *meddelande* utan att anropa något: varje värde som inte är en funktion ger
  `RangeError` med modulens namn i stället för ett `TypeError` från anropsstället.
  Provet av raden är den obligatoriska listan med icke-funktioner i
  `tests/schedule.test.js` — `1n`, `Symbol('x')`, `null`, en sträng, `42`, `true`,
  `NaN`, `{}`, `[]` och `new Date()`. Raden lovar inte "går att anropa" och får
  inte beskrivas så — varken i den här filen eller i en kodkommentar.

Vad som följer av beslutet, bindande:

- **Klassfallet blir ett testfall, och det asserterar `TypeError`.**
  `tests/schedule.test.js` skickar in `class C {}` som `addMonths` och kräver att
  anropet kastar `TypeError`, inte `RangeError`. Fallet naglar fast den
  dokumenterade gränsen: införs en spärr för ledet senare faller det, och då
  skrivs det här avsnittet om först. Fallet följer av spärrtabellen och numreras
  inte — det är inte det enda som fäller en namngiven mutation.
- **Ingen testfil får skicka in en `addMonths` som inte flyttar `occurrence`
  framåt.** Anropet hänger, och en hängning ger ingen exitkod alls
  (`LARDOMAR.md` 2026-09-04), så ledet får inget testfall. Varje omslutning ett
  test skickar in ska omsluta `addMonthsClamped` och lämna dess returvärde orört;
  en sådan omslutning uppfyller alla leden av sig själv. Det gäller (S3):s
  räknande omslutning.
- **Termineringsbeviset gäller förvalet.** Att `occurrence` växer med minst 28
  dagar per varv är en egenskap hos `addMonthsClamped`, inte hos varje värde
  parametern kan bära. Varje mening i den här filen och varje kommentar i `src/`
  som bevisar att korrigeringsloopen terminerar ska namnge förvalet som den
  storhet beviset vilar på, och säga att parametern inte bevakas på den punkten.
- **Nästa granskning.** De två leden är kända och avsiktligt obevakade. Ett fynd
  som säger "en klass tar sig förbi" eller "en icke-framåtskridande funktion
  hänger" är därför inte ett fel i koden utan ett förslag att ändra det här
  beslutet, och ska redovisas som det.

**Förkastade vägar**, med skälet utskrivet, så att ingen bygger om dem:

1. **Stryk kravet som otestbart och skriv om raden till en anteckning om
   implementationen.** Förkastad. Kravet är inte otestbart — det är bara inte
   synligt i ett returvärde, och skillnaden mellan de två orden är hela frågan.
   `upcoming` anropar `nextDueDate` en gång per post, och kortet renderas om vid
   varje laddning, sparning och borttagning, så en återgång till
   varv-för-varv-räkning är arbete appen gör om och om igen. Ett krav som ingen
   kan pröva är dessutom sämre än inget krav (`LARDOMAR.md` 2026-09-07, en
   kravlista som inleds med "Kraven är bokstavliga" men innehåller punkter ingen
   kod uppfyller).
2. **Bryt ut hoppsteget till en egen exporterad funktion och testa dess
   returvärde.** Förkastad, därför att skyddet då hamnar bredvid hålet: testet
   prövar att den utbrutna funktionen räknar rätt, medan mutationen består i att
   `nextDueDate` slutar **använda** den — och den ändringen är fortfarande
   beteendeidentisk och fäller fortfarande inget testfall. Dessutom blir den en
   export vars enda anropare kan försvinna utan att något faller (`LARDOMAR.md`
   2026-09-07, `saveEntries` blev en export utan anropare i `src/`).
3. **Ett tak på antalet korrigeringsvarv, som kastar `RangeError` när det
   överskrids.** Förkastad, fastän den skulle fälla mutationen. Med korrekt kod
   finns ingen giltig indata som når grenen: den skulle stå instrumenterad och
   skrivas noll gånger under hela sviten, och en gren som ingen indata når ska
   tas bort i stället för att behållas (`LARDOMAR.md` 2026-09-04 och 2026-09-07,
   de två konstruktionerna i `storage.js`). Ett tak vore alltså en ny rad av
   just det slag filen redan har straffat två gånger.

### Kravlista för `tests/schedule.test.js` [paket 7]

Filen saknade kravlista när den byggdes, och de fall en granskning krävde skrevs
därför utan någon punkt att hänvisa till (`LARDOMAR.md` 2026-09-14). Listan
numrerar **de fall som är utpekade som facit för en namngiven mutation**. Övriga fall i
filen följer av facittabellen och spärrtabellerna ovan och numreras inte: bara
ett fall som bär ett `(SN)` i testfilen ska gå att slå upp här. Prefixet `S`
skiljer serien från numreringen i `tests/app.test.js`, så att ett nummer i en
testfil har exakt ett hem.

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (S1) | `nextDueDate klampar från startDate också i korrigeringsloopen` | `addMonths(entry.startDate, k * step)` i loopkroppen → `addMonths(occurrence, step)` |
| (S2) | `upcoming begär svensk kollation utskriven, inte körmiljöns standardspråk` | `'sv'` stryks ur `a.entry.name.localeCompare(b.entry.name, 'sv')` |
| (S3) | `nextDueDate hoppar till rätt period i stället för att räkna varv för varv` | `let k = Math.max(0, Math.floor(diff / step));` → `let k = 0;` |
| (S3) | samma testfall | steg 2: `let occurrence = addMonths(entry.startDate, k * step);` → `let occurrence = addMonthsClamped(entry.startDate, k * step);` |
| (S3) | samma testfall | loopkroppen: `occurrence = addMonths(entry.startDate, k * step);` → `occurrence = addMonthsClamped(entry.startDate, k * step);` |
| (S4) | `nextDueDate kastar RangeError för ett interval utanför tabellen` | `Object.hasOwn(MONTHS_PER_PERIOD, entry.interval)` → `MONTHS_PER_PERIOD[entry.interval]` |
| (S5) | `compareUpcoming svarar 0 för två poster som är lika på varje nyckel` | `return 0;` sist i `compareUpcoming` → `return 1;` |

Varje mutation körs en i taget, ska ge `EXIT=1`, och kryssraden för det utpekade
testfallet klistras in i redovisningen. Faller bara andra tester medan det
utpekade passerar räknas mutationen som överlevd och paketet lämnas tillbaka.

(S3):s tre rader är tre skilda mutationer och körs var för sig. De två sista
skrevs in efter runda 4 (`LARDOMAR.md` 2026-09-15); dessförinnan stod de bara som
kommentar i `src/core/schedule.js`, och en mutation som bara står i en
kodkommentar ingår inte i den här listan. `let`-ordet skiljer steg 2:s sats från
loopkroppens — uttrycket `addMonths(entry.startDate, k * step)` står på båda
ställena, och varje rad ska gå att tillämpa ordagrant på exakt en sats.

**(S1)** gäller loopkroppens anrop. Uttrycket `addMonths(entry.startDate, k * step)`
står på två ställen i `src/core/schedule.js` — steg 2 och `while`-kroppen — så
mutationen byts in **bara i `while`-kroppen**; steg 2:s rad lämnas orörd.
Mutationen skrevs tidigare med `addMonthsClamped` på båda sidor om pilen och gick
då inte att tillämpa ordagrant på någon rad i filen; den rättades efter
`LARDOMAR.md` 2026-09-14.

Fallet måste använda `quarterly` och `yearly` med ett `today` mitt i perioden.
För `monthly` kan en klampad `occurrence` och ett loopvarv aldrig inträffa
samtidigt — loopen körs bara när `today` ligger efter `occurrence`, och en
klampad `occurrence` ligger alltid på månadens sista dag (`LARDOMAR.md`
2026-09-12). **Inget assertionsmeddelande i fallet får namnge `k`.** `k` är
modulintern och syns inte i ett returvärde, så `k = 1 ger den klampade
2026-04-30` är ett påstående raden inte prövar: med `let k = 0;` ger samma anrop
fortfarande `2026-04-30`. Meddelandet ska säga vad raden faktiskt prövar — att en
`occurrence` som är lika med `today` inte korrigeras vidare. Det enda ställe
`k`:s uppförande observeras är (S3), och det observeras som antalet anrop av
`addMonths`.

**(S3)** skickar in en omslutning kring `addMonthsClamped` som räknar sina anrop
och lämnar returvärdet orört. Fallet kör **två poster, var och en med sin egen
räknare** — ett delat tal kan inte skilja posternas anrop åt, och det är just den
skillnaden fallet mäter:

- **En post vars korrigeringsloop kör noll varv:** `startDate: '1970-01-31'` med
  `interval: 'monthly'` mot ett fast `today` som inte ligger efter den occurrence
  steg 2 landar på. Räknaren ser då bara steg 2:s anrop. Assertion: antalet anrop
  är **högst 3**.
- **En post vars korrigeringsloop kör minst ett varv:** `startDate: '1970-01-15'`
  med `interval: 'monthly'` mot samma `today`, som då ligger efter den occurrence
  steg 2 landar på. Ett anrop från vardera stället. Assertioner: antalet anrop är
  **minst 2** **och** **högst 3**.

Det `today` de två posterna delar i `tests/schedule.test.js` är `'2026-08-18'`.
Varje annat `today` som uppfyller de två villkoren ovan duger lika bra — det är
villkoren som är bindande, inte datumet, och den som byter datum ska pröva båda
villkoren mot facitreglerna för klampning och sedan köra de tre mutationerna om.

För båda posterna asserteras returvärdet som vanligt, och samma anrop **utan**
omslutningen ska ge samma svar — annars mäter fallet något annat än
produktionsvägen.

**Taket ensamt är blint, och därför räcker inte en post.** Ett tak fälls bara av
*fler* anrop, aldrig av färre, så det kan inte se att ett av de två
occurrence-stegen slutat gå genom parametern: byts steg 2:s eller loopkroppens
`addMonths(entry.startDate, k * step)` mot ett direkt anrop av
`addMonthsClamped`, sjunker antalet och taket håller fortfarande. Det är den
undre gränsen på den andra posten som fäller de två routningsmutationerna, en i
taget, och taket som fäller `let k = 0;`. Alla tre står som egna rader i
mutationstabellen ovan. Formen med **en** post och **enbart** ett tak är den
granskningen underkände (`LARDOMAR.md` 2026-09-14, loopkroppens väg genom
`addMonths`); den får inte återinföras med motiveringen att sviten är grön utan
den.

**Taket mäter arbete och inte ett värde:** ett exakt antal skulle bli falskt av
en tillåten omskrivning av steg 2, medan ett tak fäller varje återgång till
varv-för-varv-räkning.

**Den undre gränsen är hårdare knuten till algoritmens form än taket, och det
ska nästa läsare veta.** Att den andra posten ger minst två anrop förutsätter att
steg 2 landar på en occurrence före `today` för just den posten. En i sig tillåten
omskrivning av steg 2 som hoppar förbi `today` skulle ge ett enda anrop också där:
då faller gränsen, och meddelandet skyller på fel orsak — det säger att ett av
occurrence-stegen slutat gå genom parametern, fast det som hänt är att steg 2
räknar annorlunda. Meningen "ett exakt antal skulle bli falskt av en tillåten
omskrivning av steg 2" gäller alltså i mild form även den undre gränsen. Faller
gränsen är första frågan därför om steg 2 skrivits om: håller båda posterna
fortfarande sitt tak och ger båda rätt returvärde, ska gränsens indata väljas om
till en post vars korrigeringsloop fortfarande kör minst ett varv — gränsen
sänks inte och tas inte bort, eftersom den är fallets enda detektor för att båda
occurrence-stegen går genom parametern.

Byggaren redovisar det uppmätta antalet anrop **per post** i den ostörda
körningen och i varje mutationskörning. **Inget assertionsmeddelande i fallet får
namnge `k`.** Meddelandet namnger det som mäts — antalet anrop av `addMonths` —
och för den undre gränsen dessutom de två ställen som kan ha slutat gå genom
parametern, loopkroppen och steg 2.

**(S2) använder en teknik som inte finns någon annanstans i projektet:
`String.prototype.localeCompare` och `Intl.Collator` ersätts under sorteringen.**
En ny konstruktion i en testfil kräver en egen beskrivning innan den byggs
(`LARDOMAR.md` 2026-09-07, den fjärde hängningsspärren), och här är den:

- **Syfte.** Fallet prövar vad koden *begär*, inte vad den råkar få. Ett test som
  bara ser på ordningen kan inte skilja `localeCompare(namn, 'sv')` från
  `localeCompare(namn)` på en maskin vars standardspråk redan är svenskt:
  mutationen "ta bort `'sv'`" gav `tests 331, pass 331, fail 0` och `EXIT=0` på
  en sådan maskin (`LARDOMAR.md` 2026-09-12). `app.js` kör i webbläsaren, där
  språket är användarens och inte utvecklarens.
- **Konstruktion.** Varje kollationsbegäran under sorteringen fångas, på båda
  sätten att be om en: `locales`-argumentet till `String.prototype.localeCompare`
  och till `Intl.Collator`. Minst en begäran ska vara utskriven, och varje
  utskrivet språk ska ge svensk ordning. `undefined` betyder körmiljöns
  standardspråk och räknas inte som utskriven.
- **Återställning.** Båda originalen läggs tillbaka i ett `finally`, så att inget
  senare fall i filen ser attrapperna. Granskaren har prövat att återställningen
  sker även när `upcoming` kastar mitt i sorteringen.
- **Räckvidd.** `node --test` kör en process per testfil, så en ersättning kan
  inte läcka till en annan testfil. Inom filen är `finally` det enda som skyddar,
  och därför är det obligatoriskt.
- **Motexemplet hör till fallet.** Två rader slår fast att `Intl.Collator('sv')`
  och `Intl.Collator('en')` ger olika svar för `Ångbåt` mot `Zebra` i den här
  körmiljön. Utan dem vore resten sann av sig själv på en maskin med annan
  ICU-data; med dem säger fallet det i klartext i stället.
- **Det tekniken inte kan upptäcka.** Den ser bara begäranden som görs **under**
  anropet. Skrivs sorteringen om till en `Intl.Collator` som byggs en gång vid
  modulladdningen fångas ingen begäran — granskaren har mätt att fallet då
  **faller** i stället för att ge ett falskt godkänt. En sådan omskrivning kräver
  alltså att (S2) skrivs om, och det är avsiktligt: ett test som tyst skulle
  börja gälla en annan konstruktion är värre än ett som säger ifrån.

**(S4) asserterar hela `message` för de nycklar som finns på `Object.prototype`.**
Testfallet är `nextDueDate kastar RangeError för ett interval utanför tabellen`,
och de nycklar som skiljer de två skrivsätten åt är `constructor`, `toString`,
`hasOwnProperty` och `__proto__`. För var och en av dem ska fallet kräva
`` nextDueDate kräver ett känt interval, fick "<nyckeln>". `` ordagrant. En
assertion på enbart `RangeError` duger inte, och det är mätt: med det
sanningsprövade uppslaget kastar koden fortfarande `RangeError`, men från
`addMonthsClamped` och med meddelandet
`` addMonthsClamped kräver ett heltal månader, fick "NaN". `` — alltså ett
meddelande som pekar ut fel orsak, medan fallet passerar och mutationen överlever
med grön svit (granskarens körning, `LARDOMAR.md` 2026-09-16). Samma krav gäller
redan den motsvarande spärren i `cost.js`, och där fälls mutationen just därför
att `tests/cost.test.js` asserterar hela meddelandet.

Kravet gäller inte bara den här punkten: regeln står under "Ingångsspärrar i
`src/core/schedule.js`", och den säger att varje rad i det avsnittet ska ha minst
en assertion med hela `message` — den assertion som ensam skiljer raden från en
annan spärr. En bredare uppräkning av värden för samma rad får asserta enbart
feltypen, och sökningen som visar att varje rad har sin fullmeddelandeassertion
står på samma ställe. (S4) numreras ändå, eftersom fallet är det som är utpekat
som facit för mutationen i tabellen ovan.

**(S5) prövar att jämföraren är reflexiv, och asserterar på jämförarens egen
utdata.** Sista raden i `compareUpcoming`, `return 0;`, var modulens enda rad
utan täckning: granskarens körning med `--experimental-test-coverage` gav då
`schedule.js | 99.38 | 96.77 | 100.00 | 157`, och mutationen `return 0;` →
`return 1;` gav `tests 348, pass 348, fail 0` och `EXIT=0`. Efter att punkten
byggdes ger samma körning `schedule.js | 100.00 | 100.00 | 100.00` med tom
kolumn för otäckta rader (granskarens körning). Grenen är nåbar med vanlig
indata — två poster med samma `nextDueDate`, samma `name` och samma `id` — och
ingenting i projektet kräver att `id` är unikt, så den ska prövas och inte
skrivas ut som oprövad.

Assertionen ska ligga på **jämförarens svar** och inte på den sorterade listan.
Skälet är att en sorterad lista inte kan skilja de två svaren åt utan att luta sig
mot hur körmiljöns sortering behandlar en jämförare som inte är reflexiv, och det
är inget projektet får bygga ett prov på (`LARDOMAR.md` 2026-09-22, sista raden i
`compareUpcoming`). För att svaret ska gå att asserta **exporteras
`compareUpcoming` från `src/core/schedule.js`**. Exporten har en anropare i
`src/` — `items.sort(compareUpcoming)` i `upcoming` — och är alltså ingen export
byggd i förtid; den är samma sorts testsöm som det injicerade `addMonths` i
`nextDueDate`, och signaturen står i gränssnittsblocket.

Fallet bygger sina två `UpcomingItem` genom att anropa `upcoming` med två poster
som är lika på alla tre nycklarna, och asserterar `0` för paret i båda
ordningarna samt `0` för ett item mot sig självt. Att de två posterna är lika på
varje nyckel är kravet på testdatan: skiljer de sig på någon av dem svarar en
tidigare rad i kedjan, och fallet prövar då inte den sista raden.

## Lagring

- **Format:** en UTF-8-kodad JSON-fil, indenterad med 2 mellanslag och avslutad
  med radbrytning.
- **Plats:** `%APPDATA%\hemochekonomi\entries.json`, dvs.
  `path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'hemochekonomi', 'entries.json')`.
  Datan ligger utanför git-repot med flit — den är användarens, inte projektets.
  I samma katalog ligger låsfilen `entries.json.lock` medan appen kör, och
  ibland efter en krasch; se "Låset på datafilen — en instans i taget".
- **Överstyrning för tester:** om miljövariabeln `HEMOCHEKONOMI_DATA_FILE` är
  satt till ett värde som innehåller minst ett tecken som inte är blanktecken
  används den sökvägen i stället. Osatt, tom sträng och en sträng med bara
  blanktecken räknas alla som osatt. Villkoret är
  `typeof override === 'string' && override.trim() !== ''`, och värdet används
  därefter **ordagrant, utan `trim()`**: en riktig sökväg får innehålla
  blanksteg, och `paths.js` ska inte ha någon egen åsikt om hur en sökväg ser
  ut. Facit: `''` och `'   '` (tre blanksteg) ger båda standardsökvägen under
  `%APPDATA%`, medan en sökväg med ett inledande blanksteg returneras med
  blanksteget kvar. Testerna i paket 4 sätter variabeln till en fil under
  `os.tmpdir()` och städar upp efter sig.
- **Katalogen skapas vid behov** med
  `fs.mkdir(path.dirname(filePath), { recursive: true })` före skrivning.
- **Skrivning är atomär:** skriv till en temporärfil vars namn är unikt per
  anrop och gör därefter `fs.rename` till `entries.json`. Ett avbrott mitt i
  skrivningen får inte kunna lämna en halv fil — det är precis det fel som
  annars uppfyller paket 4:s "trasigt innehåll". Temporärnamnet, kön, felen och
  städningen står under "Skrivvägen" nedan, och den texten är facit — den här
  punkten är en sammanfattning och avgör ingenting.

Filens innehåll:

```json
{
  "version": 1,
  "entries": [
    {
      "id": "6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234",
      "name": "Spotify Family",
      "amountSek": 199,
      "interval": "monthly",
      "startDate": "2026-01-31",
      "category": "subscription"
    }
  ]
}
```

Beteende vid läsning. **Tabellens ordning är körordningen i `loadEntries`, och
första sanna raden vinner** — det är filens enda facit för ordningen mellan
läsvägens fel:

| # | Situation | Resultat |
|---|-----------|----------|
| 1 | Filen saknas (`ENOENT`) | `[]`. Inget fel, ingen fil skapas. |
| 2 | Annat läsfel från operativsystemet | `StorageError`: `Datafilen kunde inte läsas: <sökväg>`, med `cause` satt till originalfelet. |
| 3 | Filen är tom eller bara blanktecken | `[]`. |
| 4 | Ogiltig JSON | `StorageError`: `Datafilen är skadad och kunde inte läsas: <sökväg>` |
| 5 | JSON men inte ett vanligt objekt enligt `isPlainObject`, eller `entries` är inte en array | `StorageError`: `Datafilen har fel innehåll: <sökväg>` |
| 6 | `version` saknas eller är inte `1` | `StorageError`: `Datafilen har en version som appen inte känner igen: <sökväg>` |
| 7 | En post i `entries` saknar fält, har fel typ eller har ett okänt fält | `StorageError`: `Datafilen innehåller en ogiltig post: <sökväg>` |

Rad 1 och rad 2 hör till samma `catch` runt `fs.readFile`, och `ENOENT` prövas
först. Rad 2:s sträng är fastnaglad här och får inte formuleras om i koden:
paket 5 och 8 citerar den, och "svensk text" räcker inte som specifikation när
strängen är den text användaren ser.

**Två rader kan vara sanna samtidigt, och då vinner den lägre siffran.**
Obligatoriska testfall, som visar just det:

| Filens innehåll | Meddelande | Vinnande rad |
|-----------------|------------|--------------|
| `{ "version": 2, "entries": 42 }` | `Datafilen har fel innehåll: <sökväg>` | 5 (rad 6 är också sann) |
| `{ "version": 2, "entries": [<ogiltig post>] }` | `Datafilen har en version som appen inte känner igen: <sökväg>` | 6 (rad 7 är också sann) |

Raden om "en ogiltig post" avgörs av `isEntry`, inte av en egen kontroll i
`storage.js`. Det gäller även `id`: `storage.js` får inte ha någon egen åsikt om
vad ett giltigt `id` är. Samma ägarskap gäller skrivvägen, se nedan.

`StorageError` kastas — den fångas i `api.js`, som svarar `500` med
`{ "error": "<meddelandet>" }`. Servern får aldrig krascha på ett trasigt lager.
`version: 1` finns för att kunna ge det tydliga felmeddelandet ovan i stället
för en tyst feltolkning; det är inte en förberedelse för framtida funktioner.

### Skrivvägen — namn, kö och ordning (bindande)

- **Temporärfilens namn är unikt per anrop:**
  `` `${filePath}.${process.pid}.${randomUUID()}.tmp` ``, där `randomUUID`
  importeras från `node:crypto`. Namnet får aldrig härledas enbart ur
  datafilens namn. Gjorde det det valde två överlappande `saveEntries` samma
  fil och blandade sitt innehåll: granskarens 60 omgångar av
  `Promise.allSettled([saveEntries(3000 poster), saveEntries(1500 poster)])`
  gav 16 läsbara filer där det ena anropets poster hade försvunnit, 14
  ohanterade `ENOENT ... rename` och 44 filer som `loadEntries` avvisade.
- **Diskoperationerna serialiseras i en modullokal löfteskedja.** `storage.js`
  har en modullokal variabel `ioQueue`, initierad till `Promise.resolve()`.
  Kedjan infördes i paket 4 under namnet `writeQueue` och omfattade då bara
  skrivningarna; den omfattar nu varje diskoperation i modulinstansen, och
  namnet följer med. Skälet står i punkten om `loadEntries` nedan.
  `saveEntries` och `loadEntries` utökar kedjan **synkront, före funktionens
  första `await`** — annars är kedjans ordning inte anropsordningen och facit
  nedan gäller inte. Ett misslyckat anrop får inte blockera nästa: kedjan går
  vidare både efter uppfyllelse och efter avvisning, och ett anrops fel får
  aldrig bli ett annat anrops fel.
- **Facit när två skrivningar överlappar: anropsordningen avgör, och sista
  anropet vinner.** `saveEntries(a)` följt av `saveEntries(b)` utan `await`
  emellan ger: båda löftena uppfylls, `a` skrivs först och `b` sist, och ett
  därpå följande `loadEntries()` returnerar exakt `b`. Det andra anropet kastar
  aldrig på grund av det första, inget anrop hoppas över, och filen på disk är
  aldrig en blandning. Det här är ett beslut, inte en följd av implementationen:
  kod som ger något annat svar är fel.
- **`loadEntries` ställs i samma kö som `saveEntries`.** Påståendet att en
  läsning inte behöver köas gällde bara åt läsarens håll: `rename` byter filen i
  ett enda steg, så en läsning ser antingen hela den gamla eller hela den nya
  filen — men åt skrivarens håll gäller motsatsen. På Windows kastar `fs.rename`
  `EPERM` när målfilen är öppen i en annan handtagare, och granskarens körning av
  `Promise.allSettled([loadEntries(), saveEntries(liten)])` mot en datafil på
  37 577 818 byte (200 000 poster) gav `saveEntries lyckades 0, avvisade 25` av
  25 omgångar, samtliga med rad 6:s meddelande och `cause=EPERM`. Paket 5 gör
  `GET /api/entries` (`loadEntries`) och `POST`/`DELETE /api/entries`
  (`updateEntries`, som gör sitt `rename` inuti samma kö) mot samma fil i samma
  process, så en användare som klickar Spara medan listan läses om når fallet
  utan att göra något ovanligt. `loadEntries` läser därför
  `getDataFilePath()` synkront, utökar `ioQueue` synkront och gör hela sitt
  `fs.readFile`-arbete inuti kedjan.
- **Facit när en läsning och en skrivning överlappar: anropsordningen avgör, och
  ingen av dem misslyckas på grund av den andra.** `saveEntries(b)` följt av
  `loadEntries()` utan `await` emellan ger: båda löftena uppfylls, och läsningen
  returnerar exakt `b`. `loadEntries()` följt av `saveEntries(b)` utan `await`
  emellan ger: båda löftena uppfylls, läsningen returnerar filens innehåll före
  `b`, och skrivningen lyckas. Ett läsfel får aldrig bli en skrivnings fel, och
  tvärtom. Det här är ett beslut, inte en följd av implementationen: kod som ger
  något annat svar är fel.
- Kön ligger i modulminnet och skyddar därför bara anrop som går genom
  `loadEntries` och `saveEntries` i samma modulinstans. Ett `fs.open` eller
  `fs.readFile` som någon annan gör — ett testfall, en annan process, ett
  virusskydd, en filsynk — ligger utanför kön, och då kan `fs.rename` fortfarande
  kasta `EPERM`. Svaret på det är rad 6 i tabellen "Beteende vid skrivning";
  ingen ny felsträng och ingen omförsöksslinga införs för det, och skälet står i
  beslutsloggen.
- **Två processer mot samma datafil är ett problem kön inte kan lösa, och det
  ligger utanför `storage.js`.** Det unika temporärnamnet plus `rename` svarar på
  frågan om **filens integritet**: ingen fil blir en blandning, och en av
  processerna vinner hela filen. Frågan om **användarens data** har ett annat
  svar, och det är inte samma svar: att den ena vinner hela filen betyder att den
  andras poster är borta. Körd i det här projektet, två serverprocesser på 3111
  och 3112 mot samma datafil, 20 omgångar av
  `Promise.all([POST mot A, POST mot B])`: `omgångar där en post tappades:
  20 av 20`, `svar med 500: 16`, `poster på disk till slut: 20 (förväntat 40)`.
  Granskarens oberoende körning gav 19 av 20 för `POST`, 19 av 20 för `DELETE`
  och `500` i 5 av 80 svar. Kön ändrar ingenting på det: den
  ligger i modulminnet, och två processer delar inte modulminne. Svaret är därför
  inte en spärr i `storage.js` utan en spärr vid processgränsen — se "Låset på
  datafilen — en instans i taget" nedan, som hindrar att en andra instans
  över huvud taget startar mot samma fil.
- **Validering och strängifiering sker före kön**, alltså utan att ta plats i
  den. Ett avvisat anrop varken fördröjer eller fördröjs av en pågående
  skrivning.

Ordningen i `saveEntries`, som pseudokod. Stegen körs sekventiellt i en enda
kedja, och det första fel som inträffar avgör meddelandet:

```
filePath = getDataFilePath()          // en gång per anrop, som i loadEntries
kontrollera att entries är en array   // tabellrad 1
kontrollera varje element med isEntry // tabellrad 2, lägsta index vinner
text = JSON.stringify(...)            // tabellrad 3
ställ arbetet sist i ioQueue:
    fs.mkdir(path.dirname(filePath))  // tabellrad 4
    fs.writeFile(tempPath, text)      // tabellrad 5
    fs.rename(tempPath, filePath)     // tabellrad 6
    finally: ta bort tempPath om den finns kvar
```

Beteende vid skrivning. Samma form som lästabellen: körordningen är tabellens
ordning, och första sanna raden vinner.

| # | Situation | Resultat |
|---|-----------|----------|
| 1 | `Array.isArray(entries)` är `false` (`undefined`, `null`, `'abc'`, `{ a: 1 }`, `42`) | `StorageError`: `Posterna kunde inte sparas: listan över poster är ogiltig.` |
| 2 | `isEntry(entries[i])` är `false` för något element; lägsta `i` vinner | `StorageError`: `Posterna kunde inte sparas: post nummer <i + 1> är ogiltig.` |
| 3 | `JSON.stringify` kastar | `StorageError`: `Posterna kunde inte sparas: de gick inte att omvandla till JSON.`, `cause` satt till originalfelet |
| 4 | `fs.mkdir` kastar | `StorageError`: `Datafilen kunde inte sparas: katalogen gick inte att skapa: <sökväg>`, `cause` satt till originalfelet |
| 5 | `fs.writeFile` till temporärfilen kastar | `StorageError`: `Datafilen kunde inte sparas: skrivningen misslyckades: <sökväg>`, `cause` satt till originalfelet |
| 6 | `fs.rename` kastar | `StorageError`: `Datafilen kunde inte sparas: den nya filen gick inte att byta in: <sökväg>`, `cause` satt till originalfelet |
| 7 | Något annat kastar i `saveEntries` | `StorageError`: `Posterna kunde inte sparas: ett oväntat fel inträffade.`, `cause` satt till originalfelet |
| – | Inget kastar | `undefined`. Datafilen innehåller de nya posterna, och ingen temporärfil från anropet finns kvar. |

`<i + 1>` är elementets plats räknad från 1: är första elementet ogiltigt lyder
meddelandet `Posterna kunde inte sparas: post nummer 1 är ogiltig.`

`<sökväg>` är alltid **datafilens** sökväg, aldrig temporärfilens. Temporärnamnet
innehåller ett pid och ett UUID som inte betyder något för användaren och som
skiljer sig mellan två anrop; ett meddelande som citerade det gick inte att
känna igen mellan två körningar. Rad 7 får ingen sökväg alls: den fångar också
fel som inträffar innan sökvägen har använts, och meddelandet får inte påstå att
felet rörde filen.

**Ingen annan feltyp lämnar `saveEntries`.** Varje `node:fs`-anrop och
`JSON.stringify` ligger innanför `try`. En `StorageError` som redan har kastats
inne i blocket kastas om oförändrad — annars skulle rad 7 skriva över rad 1–6:s
meddelanden. Allt annat lindas enligt den rad det inträffade på. Invarianten är
bindande: `saveEntries` avvisar alltid med `StorageError`, aldrig med `Error`,
`TypeError` eller ett rått OS-fel, och `.message` innehåller aldrig engelsk
OS-text som `operation not permitted` eller `illegal operation on a directory`.
Skälet står redan i `storage.js` egen kommentar: meddelandet går rakt ut till
användaren som `500 { error }`, och all text mot användaren är svensk.

**Temporärfilen städas i ett `finally`.** Kördes inte `rename` klart tas
temporärfilen bort med `fs.rm(tempPath, { force: true })`. Städningen ligger i
en egen `try`/`catch` och sväljer sitt eget fel: en misslyckad städning får
varken göra en lyckad skrivning till ett fel eller ersätta det verkliga felet.
Facit efter varje rad i tabellen ovan: det anropets temporärfil finns inte kvar,
och `fs.readdir(path.dirname(filePath))` ger exakt de filer som fanns före
anropet, plus `entries.json` när skrivningen lyckades.

**Ett undantag står skrivet i stället för att gissas:** en process som dödas
(`SIGKILL`) hinner inte köra sitt `finally` och lämnar sin temporärfil kvar.
Ingen sveprutin som städar katalogen införs — den skulle behöva gissa vilka
temporärfiler som tillhör en levande process, och den löser inget problem i
`PLAN.md`. En kvarliggande temporärfil är ofarlig för appen: `loadEntries` läser
bara `entries.json`.

**Två bindande invarianter för skrivvägen:**

1. **Allt som `saveEntries` accepterar kan `loadEntries` läsa tillbaka.** För
   varje `entries` där `saveEntries` inte kastar gäller att ett därpå följande
   `loadEntries()` mot samma sökväg returnerar en lista som är `deepEqual` med
   `entries`. Det är därför skrivvägens domare måste vara `isEntry` och inte en
   egen kontroll: läsvägen frågar samma funktion, och två kopior av begreppet
   "giltig post" glider isär vid första ändringen. En datafil som appen själv
   har skrivit och sedan vägrar läsa är den värsta möjliga följden — användarens
   poster blir oåtkomliga, och felet upprepas vid varje start.
2. **Ett avvisat anrop rör inte disken.** Kastar `saveEntries` på rad 1–3 är
   datafilen byte-identisk med före anropet, och ingen katalog och ingen
   temporärfil har skapats. Kastar den på rad 4–6 är datafilen byte-identisk med
   före anropet — `rename` byter antingen hela filen eller ingen — och
   temporärfilen är borttagen. Invarianten gäller raderna i tabellen och prövas
   rad för rad; vad som händer vid ett strömavbrott mitt i `rename` kan
   projektets kod inte påstå något om, och påstås inte här.

### Läs–ändra–skriv i ett steg: `updateEntries` (bindande) [paket 5]

Kön ovan gör varje **enskild** diskoperation odelbar, men inte ett par av dem.
`loadEntries()` följt av `saveEntries(...)` är två köplatser med ett glapp
emellan, och två anrop som överlappar läser då samma utgångsläge och skriver
över varandra. Granskarens körningar mot en riktig server:
`Promise.all([POST Klick A, POST Klick B])` i 20 omgångar gav 20 av 20 omgångar
där bara en post låg kvar på disk, båda svaren `201`; `Promise.all([DELETE a,
DELETE b])` mot tre poster gav 19 av 20 omgångar där bara den ena borttagningen
blev av, båda svaren `204`. Användaren fick alltså kvitto på något som inte hade
hänt.

Därför gäller: **en läs-ändra-skriv-sekvens mot datafilen utförs som ett steg i
`ioQueue`, aldrig som två.** `storage.js` får en export för det:

```js
// mutera(entries) körs mellan läsningen och skrivningen, innanför samma köplats.
// Returnerar den skrivna listan, eller null när mutera valde att inte skriva.
export async function updateEntries(mutera: (entries: Entry[]) => Entry[] | null): Promise<Entry[] | null>;
```

Ordningen inuti köplatsen, som pseudokod. Stegen körs sekventiellt, och det
första fel som inträffar avgör meddelandet:

```
filePath = getDataFilePath()          // synkront, före kön, som i loadEntries
ställ arbetet sist i ioQueue:
    entries = läs filen                       // läsvägens tabell, oförändrad
    nästa = mutera(entries)                   // tabellrad U1 om anropet kastar
    om nästa === null: returnera null         // ingenting rör disken
    kontrollera att nästa är en array         // skrivtabellens rad 1
    kontrollera varje element med isEntry     // skrivtabellens rad 2
    text = JSON.stringify(...)                // skrivtabellens rad 3
    fs.mkdir / fs.writeFile / fs.rename       // skrivtabellens rad 4–6
    finally: ta bort tempPath om den finns kvar
    returnera nästa
```

Fyra punkter är bindande utöver pseudokoden:

- **`updateEntries` anropar aldrig `loadEntries` eller `saveEntries`.** Den
  använder samma modullokala läs- och skrivfunktioner som de gör. Ett anrop till
  den exporterade `loadEntries` inifrån en köplats skulle ställa sig sist i en kö
  som väntar på just den köplatsen — en låsning som inget felmeddelande beskriver.
- **Felen är skrivvägens fel, med två tillägg.** Läsningen ger läsvägens
  meddelanden (tabellen "Beteende vid läsning"), skrivningen ger skrivvägens
  (tabellen "Beteende vid skrivning"), och båda tabellernas ordning gäller
  oförändrad. Tillägg U1: kastar `mutera` blir svaret
  `StorageError`: `Posterna kunde inte sparas: ett oväntat fel inträffade.` med
  `cause` satt till originalfelet — samma sträng och samma ägare som
  skrivtabellens rad 7, ingen ny sträng. Tillägg U2: `mutera` som returnerar
  `null` är inget fel utan svaret "skriv inte", och `updateEntries` uppfyller sig
  då med `null` utan att något har rört disken.
- **Skrivtabellens rad 1–3 prövas inuti köplatsen här, inte före den.** För
  `saveEntries` prövas de före kön, eftersom listan är känd då; i `updateEntries`
  finns listan först efter läsningen. Skillnaden ändrar ingen sträng och ingen
  inbördes ordning, bara var i tiden prövningen sker, och den står skriven här
  för att punkten "Validering och strängifiering sker före kön" ovan gäller
  `saveEntries` och inte den här funktionen.
- **Facit när två `updateEntries` överlappar: anropsordningen avgör, och båda
  ändringarna blir av.** `updateEntries(f)` följt av `updateEntries(g)` utan
  `await` emellan ger: båda löftena uppfylls, `g` ser resultatet av `f`, och ett
  därpå följande `loadEntries()` returnerar `g(f(x))`. Ingen ändring går
  förlorad. Överlappar `updateEntries` och `saveEntries` gäller samma sak som för
  två skrivningar: anropsordningen avgör och sista anropet vinner. Det här är ett
  beslut, inte en följd av implementationen: kod som ger något annat svar är fel.

`api.js` får därefter inte anropa `loadEntries` och `saveEntries` efter varandra
i samma hanterare. `GET /api/entries` läser bara och använder `loadEntries`;
`POST` och `DELETE` går genom `updateEntries`. Vad `mutera` gör i respektive
hanterare, och hur `null` blir `404`, står under "HTTP-API".

### Låset på datafilen — en instans i taget (bindande) [paket 5]

`ioQueue` och `updateEntries` gör varje läs-ändra-skriv odelbar **inom en
process**. De kan inte göra mer än så: kön är en variabel i modulminnet, och två
processer delar inte modulminne. Två serverprocesser mot samma datafil läser
alltså samma utgångsläge och skriver över varandra, och användaren får `201`
eller `204` på en ändring som är borta — mätningen står under "Skrivvägen".

**Beslut: en datafil används av högst en process åt gången.** `start()` tar ett
lås på datafilen innan servern binder någon port, och en andra instans mot samma
fil startar inte utan avslutas med ett svenskt felmeddelande och exitkod `1`.
Beslutet är den enda mekanism som svarar på frågan om användarens data i stället
för frågan om filens integritet, och det följer `PLAN.md` beslut 3 (*en person,
en enhet*): två samtidiga instanser är inte en funktion som ska fungera sämre,
det är ett läge appen inte har.

**Låsfilen.** Namnet är datafilens sökväg plus `.lock`, och det ägs av
`paths.js`: `getLockFilePath()` returnerar `` `${getDataFilePath()}.lock` ``.
Låset hör därmed till datafilen och inte till porten — två instanser med var sin
datafil (`HEMOCHEKONOMI_DATA_FILE`) låser inte varandra, vilket är det som gör
testerna körbara. Suffixet `.lock` kan aldrig krocka med temporärnamnet, som
slutar på `.tmp`.

**Låsfilens innehåll är en märkning**, och ingenting mer: den låsande processens
pid som decimal text, ett kolon, ett `randomUUID()`, och ett avslutande `\n`.

```
<pid>:<uuid>\n          t.ex.  4711:2f6f4a1e-0d2e-4c1a-9a2b-8f3c5d7e1b04\n
```

Märkningen skapas en gång per anrop till `acquireDataFileLock()` och är det enda
som avgör vad ett släpp får ta bort. Pid:en ensam räcker inte: samma process kan
ha skrivit ett *tidigare* lås på samma sökväg som redan är släppt, och en
jämförelse på pid kan då inte skilja "vårt gamla lås" från "vårt nya". Uuid:t är
det som gör dem åtskilda.

Innehållet är giltigt om och endast om det, sedan ett avslutande `\n` tagits
bort, matchar
`/^([0-9]+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/` och
pid-delen är ett `Number.isSafeInteger` större än `0`. Allt annat är rad L2 — en
låsfil som bara innehåller en pid, till exempel en som en tidigare körning av en
äldre version lämnat kvar, ger alltså rad L2, som ber användaren ta bort filen.
Det är det avsedda svaret och inget särfall i koden. `pid <= 0` avvisas inte bara
för formens skull: `process.kill(0, 0)` frågar om den egna processgruppen och
skulle svara "lever" för varje körning, så en märkning med `0` skulle annars
blockera för alltid utan att någon kör.

`randomUUID` från `node:crypto` är samma inbyggda funktion som
teknikvalstabellen redan har en rad för och som `storage.js` använder till
temporärnamnet; den ger inget nytt beroende.

Låsfilen ligger i datafilens katalog. Kravet under "Paket 4: två överlappande
skrivningar" att `fs.readdir(dirname)` ger exakt `['entries.json']` gäller
oförändrat, eftersom låset bara tas av `start()` och `tests/storage.test.js`
startar ingen server. En testfil som både startar en server och läser katalogen
ska räkna med `entries.json.lock`.

Ordningen i `acquireDataFileLock()`, som pseudokod. Hela kroppen ligger i en
köplats i `lockQueue` (se punkten om kön nedan), skrivförsöket görs högst **två**
gånger, och det första fel som inträffar avgör meddelandet:

```
lockPath = getLockFilePath()                  // en gång per anrop
heldLocks har redan en post för lockPath  → rad L5   (ingenting rör disken)
token = `${process.pid}:${randomUUID()}`      // en gång per anrop

försök 1:
    fs.mkdir(path.dirname(lockPath), { recursive: true })   // kastar → rad L4
    fs.writeFile(lockPath, `${token}\n`, { flag: 'wx' })
        lyckas → heldLocks.set(lockPath, token), registrera exit-städningen,
                 uppfyll med lockPath
        kastar med annan code än 'EEXIST' → rad L4
    // EEXIST: låsfilen finns redan. Vem äger den?
    fs.readFile(lockPath, 'utf8')             // kastar, oavsett code → rad L3
    innehållet matchar inte märkningens mönster → rad L2
    pid === process.pid → vårt eget kvarlämnade lås: tas över
                          (ingen nuvarande innehavare, annars vann rad L5)
    annars process.kill(pid, 0):
        kastar med code 'ESRCH' → pid:en är död: låset tas över
        varje annat utfall      → rad L1
    fs.unlink(lockPath)                       // ingen egen felhantering,
                                              // se noten nedan
försök 2:
    fs.writeFile(lockPath, `${token}\n`, { flag: 'wx' })   // ingen egen felhantering
        lyckas → heldLocks.set(lockPath, token), registrera exit-städningen,
                 uppfyll med lockPath
```

**De två sista anropen har ingen egen felhantering, och strykningen är mätt.**
Pseudokoden svalde tidigare felet från `fs.unlink` och lät `försök 2` kasta rad
L4 med `cause` satt. Ingen indata når någon av de två grenarna. Den enda
konstruktion som kunde nå dem — en märkning med en död pid plus ett öppet handtag
på låsfilen — kördes i den här miljön av byggaren och gav `unlink LYCKADES med
oppet handtag`, `filen finns efterat: false`, `writeFile wx LYCKADES` och ett
uppfyllt `acquireDataFileLock`, alltså inget `EEXIST` i försök 2 och ingen rad L4.
Byggarens instrumentering av båda grenarna över hela sviten gav
`GREN unlink-catch: 0` och `GREN forsok2-catch: 0`, och båda mutationerna ("ta
bort `try`/`catch` runt andra skrivförsöket" respektive "kasta vidare i stället
för att svälja unlink-felet") gav `pass 18, fail 0, EXIT=0`. Kvar fanns bara
fönstret där en **annan** process hinner skapa låsfilen mellan vårt `unlink` och
vårt `writeFile` — samma sorts fönster som `ENOENT`-grenen ströks för, och lika
omöjligt att träffa deterministiskt. Grenarna är därför strukna: en gren ingen
indata når är inte ett skydd utan en osann uppgift om vad koden hanterar
(`LARDOMAR.md`, 2026-09-04, två konstruktioner i storage.js körs aldrig och
överlever mutation).

Följden skrivs ut i stället för att antas. Ett fel från `fs.unlink` eller från
`försök 2`:s `fs.writeFile` lämnar `acquireDataFileLock` som ett **rått OS-fel**,
inte som ett `DataFileLockError`. Modulen har en enda anropare i `src/`, `start`,
och hela dess kropp ligger innanför en `try`/`catch` som lämnar varje fel vidare
som rad 3 under "Beteende vid start": svensk text, `cause` satt, ingen krasch och
inget engelskt stackspår. Priset är att det felet namnger porten i stället för
låsfilen, och det priset är billigare än en `catch` som ingen indata når. Rad L4
är oförändrad och nås fortfarande av `mkdir` och av ett fel från `försök 1` vars
`code` inte är `EEXIST` — båda vägarna har var sitt testfall i
`tests/lock.test.js`.

Numren i tabellen är **namn på rader, inte en ordning**: rad L5 prövas först och
rad L1–L4 i pseudokodens ordning. Namnen L1–L4 är oförändrade därför att
`tests/lock.test.js` och `LARDOMAR.md` refererar till dem.

| # | Situation | Resultat |
|---|-----------|----------|
| L5 | `heldLocks` har redan en post för `lockPath`: processen håller själv låset på den datafilen | `DataFileLockError`: `Hemochekonomi kör redan i den här processen mot samma datafil: <datafilens sökväg>. En datafil används av högst en instans i taget — stäng den första servern innan du startar en ny.` |
| L1 | Låsfilen finns och bär en pid som inte bevisligen är död | `DataFileLockError`: `Hemochekonomi kör redan i en annan process (pid <pid>) mot samma datafil: <datafilens sökväg>. Stäng den först — två samtidiga körningar mot samma fil kan förstöra dina poster.` |
| L2 | Låsfilen finns men innehållet är inte en märkning | `DataFileLockError`: `Hemochekonomi kunde inte starta: låsfilen <låsfilens sökväg> går inte att tolka. Kontrollera att appen inte redan kör, ta bort filen och försök igen.` |
| L3 | Låsfilen finns men gick inte att läsa | `DataFileLockError`: `Hemochekonomi kunde inte starta: låsfilen <låsfilens sökväg> gick inte att läsa. Kontrollera att appen inte redan kör, ta bort filen och försök igen.`, `cause` satt till originalfelet |
| L4 | Låsfilen gick inte att skapa av något annat skäl | `DataFileLockError`: `Hemochekonomi kunde inte starta: låsfilen <låsfilens sökväg> gick inte att skapa.`, `cause` satt till originalfelet |
| – | Låset togs | Löftet uppfylls med låsfilens sökväg. |

Rad L1 och rad L5 namnger **datafilen**, eftersom det är den resurs användaren
delar och den enda uppgift som gör felet begripligt när två fönster står öppna.
Rad L2–L4 namnger **låsfilen**, eftersom den är det användaren ska ta bort.
`<pid>` står med i rad L1 av samma skäl: utan den går det andra fönstret inte att
hitta. Rad L5 bär ingen pid — det är den egna processen, och en pid som pekar på
en själv hjälper ingen.

Punkterna nedan är bindande utöver pseudokoden:

- **Låset släpper bara på ett bevis, aldrig på en gissning.** Enda vägen att ta
  över ett lås som bär en **annan** process pid är att `process.kill(pid, 0)`
  avvisar den pid:en med `ESRCH`. Varje annat utfall — en pid som lever, ett
  `EPERM`, ett oläsbart innehåll, en tom fil — blockerar starten. Bär låsfilen
  den **egna** pid:en är det inget undantag utan det starkare beviset: hade någon
  i den här processen hållit låset hade rad L5 vunnit innan disken rördes, så en
  post som saknas i `heldLocks` betyder att låset inte har någon innehavare.
  Beviset kommer där från den egna bokföringen i stället för från
  operativsystemet. Riktningen är vald med
  flit: ett fel åt det hållet betyder "appen startar inte och säger varför på
  svenska", och ett fel åt andra hållet betyder "två instanser skriver över
  varandras poster utan att någon får veta det". Det första går att rätta med
  ett kommando, det andra går inte att rätta alls.
- **En krasch, ett `SIGKILL` eller ett Ctrl+C kan lämna låsfilen kvar.** Det är
  inte ett fel utan det normala fallet, och det är därför `ESRCH`-grenen finns:
  nästa start läser pid:en, ser att processen är borta och tar över låset. En
  pid som operativsystemet hunnit återanvända ger i stället rad L1 fastän
  ingenting kör — det är priset för att felet ska falla åt det ofarliga hållet,
  och rad L1:s text ska därför alltid gå att svara på genom att stänga fönstret
  eller ta bort filen. Ingen signalhanterare införs för att göra fallet
  ovanligare: `SIGINT` och `SIGTERM` beter sig olika på olika operativsystem, och
  ett påstående om hur de beter sig här vore ett påstående ingen har kört.
- **Två samtidiga anrop i samma process delar inte lås — det andra avvisas med
  rad L5.** En datafil används av högst *en instans*, och två `start()` i samma
  process är två instanser lika mycket som två processer är det. Svaret kommer
  från den egna bokföringen och inte från filsystemet: `heldLocks` frågas innan
  något rör disken, så rad L5 kostar ingen filoperation och kan aldrig förväxlas
  med rad L1. Ett andra `start()` mot samma datafil avvisas därmed **före**
  `createServer` och `listen`, och det första `start()`:s lås ligger orört kvar.
  Sekventiellt är två anrop tillåtna: när den första serverns `close`-hanterare
  har släppt låset finns ingen post kvar, och nästa `acquireDataFileLock()` tar
  ett nytt lås med en ny märkning. Att i stället låta det andra anropet dela
  låset förkastades, och skälet står i beslutsloggen.
- **Ägarskapet bokförs per låssökväg, aldrig i en enda variabel.** Modulen håller
  `heldLocks`, en `Map` från låssökväg till den märkning processen skrev i just
  den filen. Två datafiler kan därför hållas samtidigt — testerna gör det — och
  varje släpp och varje `exit`-städning gäller den sökväg det handlar om, aldrig
  "den senast tagna".
- **Släppandet tar aldrig ett annat lås än sitt eget.**
  `releaseDataFileLock(lockPath)` tar sökvägen som argument, samma värde som
  `acquireDataFileLock()` uppfyllde sig med. `null`, `undefined` och en sökväg
  som `heldLocks` inte har en post för betyder alla "ingenting att släppa", och
  då rör anropet inte disken. Finns posten läser den filen och tar bort den
  **endast** om innehållet, sedan ett avslutande `\n` tagits bort, är exakt den
  märkning posten bär. En jämförelse på bara pid räcker inte: en märkning från
  ett tidigare, redan släppt lås i samma process bär samma pid. Posten tas bort
  ur `heldLocks` oavsett filens utfall, och funktionen kastar aldrig utan sväljer
  sina egna fel, precis som `finally`-städningen av temporärfilen i
  `saveEntries`. Den anropas på tre ställen: när `start` inte lyckas binda porten
  (med den sökväg `start` fick av låset, eller `null` när det var låset som
  fällde starten), i `server.once('close', …)`, och som en sista utväg i en
  `process.once('exit', …)` som registreras när det första låset tas.
  Exit-städningen går igenom **varje** post i `heldLocks`, är den enda synkrona
  filoperationen i `src/` — en `exit`-hanterare kan inte invänta ett löfte — och
  sväljer också den sina egna fel.
- **`acquireDataFileLock` och `releaseDataFileLock` ligger i en modullokal
  löfteskedja, `lockQueue`.** Samma konstruktion som `ioQueue` i `storage.js`:
  kedjan utökas synkront före funktionens första `await`, så att kedjans ordning
  är anropsordningen, och neutraliseringsraden
  `lockQueue = work.then(() => undefined, () => undefined)` gör att kedjan aldrig
  kan vara ett avvisat löfte — därför har `work`-raden bara en handlare, en andra
  vore en gren ingen indata når. Skälet är att bokföringen och filen annars kan
  komma ur takt på två sätt, båda nåbara utan kön: två `acquireDataFileLock()`
  som startar innan någon av dem hunnit skriva sin post ser båda ett `heldLocks`
  utan posten, tar sig båda förbi rad L5 och skriver över varandras låsfil; och
  ett `releaseDataFileLock` vars `fs.unlink` ligger i luften kan hinna ta bort
  den låsfil ett efterföljande `acquireDataFileLock` just skapat. Med kedjan är
  `heldLocks` alltid i takt med filen när rad L5 avgörs.
- **Varje test som startar en server har sin egen temporära datafil, och
  `HEMOCHEKONOMI_DATA_FILE` är alltid satt när `start` anropas.** Två följder,
  båda bindande. Ett `start()` utan överstyrd datafil tar låset i användarens
  riktiga `%APPDATA%\hemochekonomi\` och kan dessutom fällas av rad L1 för att
  användarens egen app kör — samma skäl som redan förbjuder ett testfall att
  skriva i den riktiga datafilen. Och ett `start()` i testprocessen håller låset
  när ett barn startas mot samma fil: barnet avslutas då med rad L1 i stället för
  att skriva sin rad. Undantaget är fall 1 och 3 under "Paket 5: två instanser
  mot samma datafil", som handlar om just det och delar fil med flit. Två
  `start()` i **samma** process mot samma temporära datafil ger på motsvarande
  sätt rad L5 för det andra anropet, så ett testfall som behöver två servrar
  igång samtidigt ska ge dem var sin datafil.

`start()` tar låset **före** `createServer` och `listen`. Ordningen är ett
beslut: den gör "Hemochekonomi kör redan" till ett svar från låset och aldrig
från `EADDRINUSE`, så de två felen svarar på var sin fråga i stället för på
samma. `EADDRINUSE` betyder därefter att porten är upptagen av något annat, och
rad 1 i tabellen "Beteende vid start" är omskriven efter det.

---

## Teststrategi

- **Testkommando: `npm test`**, som kör `node --test "tests/**/*.test.js"`.
  Inget annat kommando är giltigt i det här projektet. Argumentet är ett
  glob-mönster inom citationstecken — en katalogsökväg fungerar inte på Node 24,
  se "Körsätt i korthet".
- **Testkörare:** Nodes inbyggda. Varje testfil börjar med
  `import { test } from 'node:test';` och `import assert from 'node:assert/strict';`.
- **Filnamn:** `tests/<modul>.test.js`. Ändelsen `.test.js` är det globmönstret
  matchar. En testfil som inte slutar på `.test.js` körs inte och räknas som
  obefintlig.
- **Enhetstester (automatiska) för:** `dates` och `entry` (paket 2), `money` och
  `cost` (paket 3), `storage` (paket 4), `api`, `lock`, `server` och `app`
  (paket 5), `schedule` (paket 7). Det är den logik
  där fel är tysta. `app` är `src/web/app.js`, körd mot en DOM-attrapp och inte i
  en webbläsare; vad den filen får och inte får göra står under "Paket 5:
  `src/web/app.js` körs av `tests/app.test.js`". **Varje fil under `src/core/`
  ska ha en egen
  `tests/<modul>.test.js` som testar modulens egna exporter direkt, i samma
  paket som filen skapas.** Indirekt täckning via en annan moduls tester räknas
  inte. `dates` är den enda modul som byggts ut i ett senare paket: de fem
  exporter som tillkom i paket 7 fick sina testfall i `tests/dates.test.js` i
  samma paket. Utfallet av den körningen står under `src/core/dates.js` och
  upprepas inte här.
- **Avsiktligt obyggda exporter är märkta, inte tysta.** Varje export i
  "Gränssnitt" bär `[paket N]`. Att en export saknas i koden är korrekt så länge
  dess paket inte är påbörjat, och ett fel så snart paketet är klart. Ingen
  export får byggas i förtid — en export utan användare får inga meningsfulla
  tester och blir just den otestade kod som lärdomen om `dates.js`
  (2026-08-18) handlar om.
- **Manuell genomgång för:** `index.html` och `style.css`, och för det i
  `app.js` som bara en webbläsare kan visa — layout, faktisk rendering och att
  den spärrade knappen syns som spärrad. Ingen webbläsar-automatisering införs;
  det skulle vara projektets största beroende och testa minst. Undantaget gäller
  därmed webbläsarens *visning*, aldrig `app.js`:s logik: den filen laddas och
  körs av `tests/app.test.js` mot en DOM-attrapp. Serverns två moduler är inte
  gränssnitt och omfattas inte av undantaget: `api.js` och `server.js` tar emot
  användarinput och har automatiska tester enligt punkten ovan.
- **Paket 5: `tests/api.test.js` och `tests/server.test.js`.**
  `tests/api.test.js` anropar `handleApiRequest(req, res, pathname)` direkt och
  behöver ingen server: signaturen tar de tre värdena just för att vägen ska gå
  att pröva utan att något lyssnar på en port. `tests/server.test.js` måste
  däremot gå över HTTP, eftersom det är routningen och svarshuvudena den prövar;
  den startar servern med `createServer()` och `server.listen(0, '127.0.0.1')` —
  port `0`, aldrig `3000`, så att en körning inte krockar med en app som redan
  är igång. **Ingen körning får binda `3000`**; det är regeln, och port `0` är
  det vanliga sättet att följa den. Punkt 3, 4 och 5 nedan använder ett annat
  portnummer än `0`, men aldrig ett de har valt själva: numret är det kärnan
  tilldelade en `listen(0, …)` tidigare i samma körning.
  **Servern stängs i en `after`-hook, aldrig i ett `finally` — bindande.** De
  två är inte utbytbara, och skillnaden är mätt. Avbryts ett testfall av ett
  ohanterat kast någon annanstans i processen körs funktionens `finally` aldrig:
  lyssnaren blir kvar och `npm test` avslutas aldrig. Två av byggarens
  mutationskörningar orsakade just ett sådant kast i serverns handler, och med
  städningen i ett `finally` slutade båda i `EXIT=124` från en yttre
  `timeout 120` — alltså ingen exitkod alls att kontrollera. Med städningen i
  `t.after()` ger samma två mutationer `exit 1`. En hängning utan exitkod är
  sämre än ett fel (`LARDOMAR.md`, 2026-09-04, storage-testet hänger för alltid
  i stället för att falla när barnprocessen inte startar), och `CLAUDE.md`
  kräver att utgångskoden kontrolleras, inte bara utskriften.
  **Stängningen kör `server.closeAllConnections()` före `server.close()`.**
  `close()` slutar ta emot nya anslutningar men väntar på att varje redan öppen
  anslutning stängs, och en keep-alive-socket stängs inte av sig själv — den
  väntan är samma hängning utan exitkod som stycket ovan. Av samma skäl gör
  varje förfrågan i testfilen sitt anrop med `agent: false`: en egen socket per
  anrop, som stängs när svaret är läst. Samma två krav gäller varje server ett
  test startar, oavsett om den kom från `createServer()` eller från `start()`.
  `tests/api.test.js` täcker minst: `GET /api/entries`; en giltig `POST` som ger
  `201` och en post som finns kvar vid nästa `GET`; `400` med `error` och
  `fieldErrors` enligt facit under "HTTP-API", inklusive fallet där två fält är
  ogiltiga samtidigt; `400` med `Kunde inte tolka anropet.` för en kropp som
  inte är JSON; `500` med `error` och utan `fieldErrors` när `createEntry` ger
  ett fel med `field: 'id'`; `DELETE` som ger `204` respektive `404` med
  `Posten finns inte.`; samt `405` med `Metoden stöds inte.`
  `tests/server.test.js` täcker minst: att `/`, `/style.css`, `/app.js` och
  `/core/entry.js` ger `200` med exakt den `Content-Type` den statiska tabellen
  anger; att en okänd statisk sökväg ger `404` utan kropp medan
  `GET /api/finns-inte` ger `404` med JSON-kroppen — facit står under "Statiska
  filer"; och att sökvägsfiltret håller. Filtret är den enda validering av
  användarinput som bara `server.js` gör, och dess testfall är obligatoriska:
  `/core/../server/paths.js`, `/core/..%2fpaths.js`, `/core/../../package.json`,
  `/core/Entry.js` (versal), `/core/under/entry.js` och `/core/entry.txt` ska
  alla ge `404` utan kropp, och ingen fil utanför `src/core/` får levereras.
  **Portvalet och autostarten prövas var för sig, och inget villkor i
  `server.js` lämnas medvetet otestat.** Skälet till uppdelningen står i
  beslutsloggen. Kraven:
  1. `resolvePort` anropas direkt, en gång per rad i facittabellen under
     `src/server/server.js` i "Gränssnitt". Inget av anropen binder en port och
     inget av dem ändrar `process.env` — funktionen tar sin miljö som argument
     just därför.
  2. `isDirectRun` anropas direkt med båda utfallen: `argv1` lika med serverns
     egen sökväg ger `true`, medan `argv1` lika med en annan sökväg och `argv1`
     som `undefined` ger `false`.
  3. `start()` anropas **utan argument** en gång, med `process.env.PORT` satt
     till en port som testet först har fått av kärnan: lyssna på `0`, läs
     `server.address().port`, stäng. Då körs default-uttrycket på riktigt utan
     att `3000` bindas. Miljövariabeln återställs i en `after`-hook.
  4. Autostartens kropp — `start()` plus utskriften — nås inte av något anrop
     inifrån processen och prövas därför i en barnprocess:
     `spawn(process.execPath, [serverPath], { env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: <temporär fil>, PORT: String(sondensPort) } })`,
     där `serverPath` byggs ur `import.meta.url` och aldrig ur `process.cwd()`
     och `sondensPort` hämtas med metoden i punkt 3. Testet läser barnets
     `stdout` tills raden `Hemochekonomi kör på http://127.0.0.1:<port>` kommit,
     med `<port>` lika med den port som skickades in, gör därefter `GET /` mot
     den porten och kräver `200`. Väntan på raden kapplöper mot
     `child.once('exit', …)`, `child.once('error', …)` och en
     `AbortSignal.timeout(…)` vars värde står som en namngiven konstant i den
     här testfilen, med samma namn och samma minsta värde (30 000 ms) som
     hängningsspärren i atomicitetstestets punkt 8, och av samma skäl;
     vinner något annat än raden faller testet med barnets `exitCode`,
     `signalCode` och `stderr` i meddelandet. Barnet dödas i en `after`-hook.
     Datafilen måste vara en temporär fil: en spawnad server som skriver i
     användarens riktiga `%APPDATA%\hemochekonomi\entries.json` vore ett
     testfall som ändrar användarens data.
     Sonden är den enda vägen till en ledig port här. `PORT` osatt binder
     `3000`, och `PORT=0` ger också `3000`, eftersom `0` är falskt — se
     facittabellens rad `'0'`. Hinner något annat ta porten mellan sonden och
     barnets `listen` avslutas barnet med `EADDRINUSE`, och testet faller då med
     barnets `stderr` i meddelandet: ett synligt fel med utskriven orsak, aldrig
     en hängning.
  5. Autostartens **felgren** — `try`/`catch` runt `start()`, utskriften till
     `stderr` och `process.exitCode = 1` — nås inte heller av något anrop inifrån
     processen och prövas i en barnprocess på samma sätt som punkt 4. En egen
     server binder en port med `listen(0, '127.0.0.1')`, och barnet startas med
     `PORT` satt till just den porten och `HEMOCHEKONOMI_DATA_FILE` till en
     temporär fil. Krav: barnet avslutas med kod `1`, `stdout` är tomt, och
     `stderr` är exakt rad 1:s sträng i tabellen under "Beteende vid start" följt
     av `\n` — varken `address already in use` eller `Error:` får förekomma.
     Väntan på barnets `exit` kapplöper mot `child.once('error', …)` och samma
     hängningsspärr som punkt 4, `CHILD_START_TIMEOUT_MS`; vinner något annat än
     `exit` faller testet med barnets `stdout` och `stderr` i meddelandet.
     Punkten finns därför att mutationen av `catch`-grenen annars överlever —
     byggarens körning visade det — och en gren som inget test når
     är enligt filens egen regel ingen spärr utan en osann uppgift om vad koden
     hanterar. Det här är det enda automatiska provet av hela vägen `npm start`
     mot en upptagen port; direktanropet `start(<upptagen port>)` under "Paket 5:
     `npm start` på en upptagen port" prövar samma fel utan autostarten.
  Mutationer som ska köras. Var och en pekar ut vilket testfall som ska falla,
  och resultatet är inte godkänt förrän namnet på det fallerande testet har
  jämförts med det utpekade — klistra in raden som börjar med kryss (`✖`).
  Faller bara andra tester räknas mutationen som överlevd, oavsett exitkod, och
  paketet lämnas tillbaka:
  - ta bort kontrollen mot `CORE_FILE_PATTERN` innan sökvägen slås samman →
    sökvägsfiltrets testfall faller;
  - byt `Number(env.PORT) || DEFAULT_PORT` i `resolvePort` mot
    `Number(env.PORT)` → facittabellens testfall faller på raden där `PORT` är
    osatt;
  - byt samma uttryck mot enbart `DEFAULT_PORT` → facittabellens testfall faller
    på raden `'8080'`;
  - låt `isDirectRun` alltid returnera `false` → `isDirectRun`-fallet i punkt 2
    faller, och autostartfallet i punkt 4 faller på att barnet avslutas utan att
    ha skrivit sin rad;
  - ta bort autostart-`if`-satsen helt → autostartfallet i punkt 4 faller på
    samma sätt, på barnets `exit` och aldrig på en väntan utan exitkod;
  - ta bort `try`/`catch` runt `start()` i autostarten, så att avvisningen blir
    ohanterad → felgrensfallet i punkt 5 faller. Vilken av punktens assertioner
    som faller står inte utskrivet här: byggaren kör mutationen och klistrar in
    kryssraden.
  Ingen mutation får däremot få autostarten att köra vid `import`, alltså varken
  `isDirectRun` som alltid ger `true` eller ett borttaget villkor med kroppen
  kvar (till skillnad från punkten ovan, som tar bort hela satsen): modulkroppen
  skulle då anropa `start()` i testprocessen, med `PORT` osatt, och binda `3000`
  — vilket regeln ovan förbjuder. Den riktningen av villkoret prövas i stället av
  punkt 2, som anropar `isDirectRun` direkt och utan att något startas.
- **Paket 5: två överlappande anrop får inte tappa en ändring.** Obligatoriskt i
  `tests/api.test.js`, som anropar `handleApiRequest` direkt — två samtidiga
  anrop är två `handleApiRequest(...)` som inte inväntas var för sig, och ingen
  server behövs. Två testfall, **minst 20 omgångar var**, mot en tom datafil per
  omgång:
  1. `await Promise.all([POST a, POST b])` med olika `name`. Krav per omgång:
     båda svaren är `201`, deras `entry.id` är olika, och `await loadEntries()`
     innehåller **exakt två** poster, en med `a`:s namn och en med `b`:s.
  2. Tre poster på disk, `await Promise.all([DELETE id1, DELETE id2])`. Krav per
     omgång: båda svaren är `204`, och `await loadEntries()` innehåller **exakt
     en** post, den med `id3`.
  Ett tredje fall skrivs för `404`-facit under samtidighet:
  `await Promise.all([DELETE id1, DELETE id1])` med samma `id` ska ge
  statuskoderna `[204, 404]` sedda som en mängd (sortera de två koderna innan de
  jämförs — vilket av löftena som får vilken kod är inte bestämt), och posten ska
  vara borta. Mutation som ska köras: byt `updateEntries` i `handleCreate` och i
  `handleDelete` mot `loadEntries()` följt av `saveEntries(...)`; `npm test` ska
  ge exit 1, och de fallerande testerna ska vara de här. Klistra in raderna som
  börjar med kryss. Följer av `LARDOMAR.md` (2026-09-07, api: två snabba klick
  tappar en post).
- **Paket 5: ett trasigt anrop får inte döda processen.** Obligatoriskt i
  `tests/server.test.js`. Förfrågningsraderna skickas som råa byte över en
  `net.Socket` mot `127.0.0.1:<port>`, aldrig med `http.request({ path })`, som
  alltid ger en sökväg i origin-form och därför inte kan nå felet. Minst dessa
  rader, var och en följd av `Host: 127.0.0.1` och en tom rad:
  `GET http://[v1.x]/ HTTP/1.1`, `GET http://[::1 HTTP/1.1`,
  `GET https://[fe80::1%25]/ HTTP/1.1`, `GET http://%/ HTTP/1.1` och
  `OPTIONS * HTTP/1.1`. Krav per rad:
  ett svar kommer på sockeln (statusraden läses), och ett därpå följande
  `GET /api/entries` över HTTP ger `200`. De fyra första raderna är fall för rad
  S1 och ska ge `400` med rad S1:s kropp: granskarens körning visar att `new URL`
  kastar `ERR_INVALID_URL` för just dem. `OPTIONS * HTTP/1.1` är **inget** fall
  för rad S1 utan ska ge `404` utan kropp — `*` går att tolka mot basen och ger
  då en okänd statisk sökväg. Byggarens körning i paket 5 gav den statuskoden.
  Raden står med i listan oavsett svar, eftersom det
  är en förfrågningsrad som ingen webbläsare skickar och därför den sortens indata
  som aldrig prövats. Rad S2 och S3 provoceras i stället genom `handler`-
  argumentet, och provokationshanteraren **kastar på sitt första anrop och
  svarar som en okänd statisk sökväg därefter** — `res.writeHead(404)` följt av
  `res.end()`. Med en hanterare som kastar vid *varje* anrop går ingenting att
  bevisa: det andra anropet kastar då också, och det är just det andra anropets
  `404` utan kropp som är beviset att processen lever. Rad S2 kräver två
  varianter av samma hanterare: den synkrona, som kastar med `throw` direkt i
  kroppen, och den asynkrona (`async`), som kastar och därmed avvisar sitt löfte.
  Båda ska ge `500 { "error": "Ett oväntat fel inträffade. Försök igen." }` på
  det första anropet och `404` utan kropp på det andra. Den synkrona varianten
  returnerar `Promise.resolve()` på sin icke-kastande väg, eftersom `handler`
  enligt kontraktet under "Ett trasigt anrop får inte döda appen" ska returnera
  ett löfte. Ett eget testfall prövar det brutna kontraktet:
  `createServer(() => undefined)` ska ge `500` med rad S2:s kropp på **ett**
  anrop — `.catch` på ett värde som inte är ett löfte kastar `TypeError`, och det
  kastet fångas av samma `try`/`catch` som ett synkront kast. Byggarens och
  granskarens körningar gav det svaret. Kravet på ett **andra** anrop gäller inte
  det här fallet: `() => undefined` beter sig likadant vid varje anrop, så ett
  andra anrop asserterar ingenting som det första inte redan gör. Granskaren
  mätte det — med bara ett varv ger `node --test tests/server.test.js`
  fortfarande `tests 22, pass 22, fail 0`, och båda de föreskrivna mutationerna
  ger identiskt utfall med och utan det andra varvet. Det andra anropet hör till
  provokationshanteraren i rad S2 och S3, som kastar på sitt *första* anrop och
  svarar `404` utan kropp därefter; där, och bara där, är det andra anropets svar
  beviset att processen lever.
  Rad S3 provoceras med en hanterare som på sitt första anrop först skriver
  `res.writeHead(200, …)` och därefter kastar: klienten ska då få ett avbrutet
  svar utan att processen dör, och det andra anropet ska ge `404` utan kropp.
  Väntan på ett svar har en hängningsspärr, se undantagslistan under "Inget test
  asserterar på körtid". Mutationer som ska köras, en i taget, eftersom de två
  konstruktionerna i `createServer` fångar olika indata: ta bort `.catch(...)`
  och behåll `try`/`catch` → rad S2:s asynkrona variant och rad S3:s testfall ska
  falla; ta bort `try`/`catch` och behåll `.catch(...)` → rad S2:s synkrona
  variant och kontraktsfallet `() => undefined` ska falla; ta bort `try`/`catch`
  runt `new URL` → testfallet för `GET http://[v1.x]/ HTTP/1.1` ska falla,
  eftersom svaret då blir rad S2:s `500` i stället för rad S1:s `400`. Vilka
  testfall de två första mutationerna fäller ska byggaren visa med inklistrade
  kryssrader; stämmer de inte med raderna ovan lämnas paketet tillbaka till
  arkitekten. De två mutationerna kan dessutom döda
  testprocessen med en ohanterad avvisning respektive ett ohanterat kast i
  stället för att ge ett ✖ på det utpekade testfallet; händer det klistrar
  byggaren in kraschutdatan i stället för kryssraden och skriver ut vilket av de
  två utfallen körningen gav. Följer av `LARDOMAR.md` (2026-09-07, server: ett
  enda HTTP-anrop dödar hela appen).
- **Paket 5: `npm start` på en upptagen port.** Obligatoriskt i
  `tests/server.test.js`. `asStartError` anropas direkt, en gång per rad i
  tabellen "Beteende vid start": ett `DataFileLockError` med en känd text för rad
  0, samt `{ code: 'EADDRINUSE' }`, `{ code: 'EACCES' }` och
  `{ code: 'EFELSTAVAT' }` med ett portnummer, och varje rads svenska sträng
  jämförs ordagrant, med `instanceof ServerStartError` och `error.cause` satt.
  Rad 0:s krav är att `message` är låsfelets text ordagrant och att portnumret
  inte har smugit in i den.
  Rad 1 provoceras dessutom på riktigt: bind en port med `listen(0, '127.0.0.1')`
  på en egen server, läs `server.address().port`, anropa `start(<den porten>)`
  och kräv att löftet **avvisas** med rad 1:s sträng, att `error.message` inte
  innehåller `address already in use`, och att testprocessen lever vidare. Båda
  servrarna stängs i en `after`-hook. Mutation som ska köras: ta bort
  `server.once('error', reject)` ur `start` → det provocerade fallet ska falla
  (utan lyssnaren fullbordas löftet aldrig, så det är hängningsspärren i
  `RESPONSE_TIMEOUT_MS` som fäller det, och testet ska då falla på en assertion
  som namnger att `start` aldrig svarade). Följer av `LARDOMAR.md` (2026-09-07,
  server: npm start på en upptagen port).
- **Paket 5: två instanser mot samma datafil.** Obligatoriskt i
  `tests/lock.test.js`. Varje barnprocess startas med
  `spawn(process.execPath, [serverPath], { env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: <fil>, PORT: String(<sondens port>) } })`,
  där `serverPath` byggs ur `import.meta.url` och aldrig ur `process.cwd()` och
  porten hämtas med sonden i punkt 3 ovan. Väntan på ett barn som ska starta är
  väntan på dess utskrivna rad, väntan på ett barn som ska vägra är väntan på
  dess `exit`; ingen väntan är en tidsgräns som räknas som en mätning, och båda
  kapplöper mot `child.once('error', …)` och hängningsspärren
  `CHILD_START_TIMEOUT_MS`. Datafilen är alltid en temporär fil. Fallen:
  1. **Instans två startar inte — minst 20 omgångar.** En temporär datafil,
     instans ett startad en gång och kvar under hela testet. I varje omgång
     startas instans två mot **samma** datafil och en **ledig** port. Att porten
     är ledig är ett krav och inte en detalj: med instans ettas port skulle en
     trasig låsning falla på `EADDRINUSE`, och fallet vore då bevisat av fel
     spärr. Krav per
     omgång: instans två avslutas med kod `1`, dess `stdout` är tomt, och dess
     `stderr` är exakt rad L1:s sträng följd av `\n`, med instans ettas pid i
     strängen; instans ett svarar därefter `200` på `GET /api/entries`. Efter de
     20 omgångarna: ett `POST` mot instans ett, och datafilen ska därefter
     innehålla exakt en post — läst med `loadEntries()` efter att
     `process.env.HEMOCHEKONOMI_DATA_FILE` satts till just den filen i
     testprocessen, och återställd i en `after`-hook. Förväntat utfall, som ska
     skrivas ut i redovisningen:
     `omgångar där instans två startade: 0 av 20`,
     `omgångar där instans två gav exitkod 1 och rad L1 på stderr: 20 av 20`,
     `poster på disk efteråt: 1`. Det är samma indata som gav granskaren
     `omgångar där en post tappades: 20 av 20`.
  2. **Var sin datafil låser inte varandra.** Två barn med var sin temporära
     datafil och var sin port: båda ska skriva sin rad och båda svara `200` på
     `GET /api/entries`. Fallet är det som visar att låset hör till datafilen och
     inte till processen eller porten.
  3. **Ett dött lås tas över.** Starta ett barn, vänta på dess rad, döda det med
     `SIGKILL`, och **assertera att låsfilen ligger kvar** (`getLockFilePath()`
     finns på disk) innan nästa barn startas — annars prövar fallet ingenting.
     Starta därefter ett nytt barn mot samma datafil: det ska skriva sin rad.
     Ligger låsfilen *inte* kvar efter `SIGKILL` i den här miljön är det inget
     att laga i testet: paketet lämnas tillbaka till arkitekten med körningen som
     underlag, eftersom hela `ESRCH`-grenen då saknar indata.
  4. **Ett otolkbart lås blockerar.** Skriv `''`, `'inte en pid'` respektive
     `` `${process.pid}\n` `` till `getLockFilePath()` och starta ett barn: det
     ska avsluta med kod `1` och rad L2:s sträng på `stderr`. Den tredje indatan
     är en låsfil i det gamla formatet — bara en pid, utan märkning — och den ska
     ge rad L2 och inte tolkas som ett giltigt lås.
  Mutationer som ska köras, en i taget, med kryssraden inklistrad och jämförd med
  det utpekade testfallet: ta bort `await acquireDataFileLock()` ur `start` →
  fall 1 faller; låt varje `EEXIST` betyda att låset är övergivet (ta bort
  livskontrollen) → fall 1 faller; ta bort `ESRCH`-grenen så att varje `EEXIST`
  blockerar → fall 3 faller; byt `getLockFilePath()` mot en sökväg som inte
  härleds ur datafilen → fall 2 faller. Följer av `LARDOMAR.md` (2026-09-07,
  api: två snabba klick tappar en post) och av granskarens underkännande av
  paket 5.
- **Paket 5: två `start()` i samma process, och låsets bokföring.**
  Obligatoriskt i `tests/lock.test.js`. Fallen prövar den variant där felet
  uppstod: porten hålls upptagen av en server som **själv har tagit låset**,
  aldrig av en naken `http.createServer()`. Ett fall som håller porten upptagen
  med en server utan lås räknas inte som täckning för någon av raderna här.
  Datafilen är alltid en temporär fil, och varje lås som tas i testprocessen
  släpps i en `after`-hook.
  5. **Ett andra `start()` mot första serverns port lämnar låset orört.**
     `const s1 = await start(0)`; läs `s1.address().port` och läs låsfilens
     innehåll till `f1`. Anropa därefter `start(<samma port>)` i samma process.
     Krav: löftet **avvisas**; `error instanceof ServerStartError`;
     `error.message` är rad L5:s sträng ordagrant, med datafilens sökväg i;
     `error.cause instanceof DataFileLockError`; `error.message` innehåller
     varken `Port ` eller `address already in use`; låsfilen finns kvar och dess
     innehåll är byte-identiskt med `f1`; `s1` svarar `200` på
     `GET /api/entries`. Starta därefter ett barn med `spawnServer` mot **samma**
     datafil och en ledig port och kräv att det avslutas med kod `1` och rad L1:s
     sträng med testprocessens pid på `stderr`. Utan den sista halvan prövar
     fallet bara en sträng och inte det låset finns för.
     Porten ska vara `s1`:s egen, trots att rad L5 avgörs före `listen`: det är
     just den kombinationen — samma port **och** samma datafil — som gav
     granskaren `låsfil efter att start 2 misslyckades: ENOENT`, och kravet att
     meddelandet är rad L5 och inte rad 1:s porttext är beviset att låset svarar
     före porten. Fallet ersätter inte `start på en upptagen port avvisas med rad
     1:s svenska text` i `tests/server.test.js`, som håller porten med en server
     **utan** lås: det fallet är den indata som når släppandet efter ett
     misslyckat `listen`, och där ska låsfilen vara borta efteråt. De två fallen
     prövar var sin sida av samma rad och ska båda finnas.
  6. **Två datafiler, två lås, två släpp.** Ta `const p1 = await
     acquireDataFileLock()` med `HEMOCHEKONOMI_DATA_FILE` satt till `a.json` och
     därefter `const p2 = await acquireDataFileLock()` med den satt till
     `b.json`. Krav: `p1 !== p2` och båda låsfilerna finns.
     `await releaseDataFileLock(p1)` → `a.json.lock` är borta, `b.json.lock`
     finns kvar. `await releaseDataFileLock(p2)` → båda är borta, och `fs.readdir`
     på katalogen ger noll filer som slutar på `.lock`.
  7. **Exit-städningen tar varje lås processen håller.** Samma barn som redan
     provar exit-städningen, men med två datafiler: barnet tar båda låsen,
     skriver sin rad och avslutas med `process.exit(0)`. Krav efter barnets
     `exit`: ingen av de två låsfilerna finns kvar.
  8. **Ett kvarlämnat lås med den egna pid:en tas över.** Skriv
     `` `${process.pid}:<ett uuid>\n` `` till `getLockFilePath()` utan att gå
     genom modulen och anropa `acquireDataFileLock()`. Krav: löftet uppfylls, och
     låsfilens innehåll är **inte** det påskrivna — låset togs över och skrevs
     om. Det är den indata som når grenen `pid === process.pid`: en pid som
     operativsystemet återanvänt, eller ett släpp som inte fick bort filen.
  9. **Ett släpp tar inte bort en främmande märkning med den egna pid:en.**
     `const p = await acquireDataFileLock()`; skriv därefter
     `` `${process.pid}:<ett annat uuid>\n` `` till samma fil och kör
     `await releaseDataFileLock(p)`. Krav: filen ligger kvar med exakt det
     påskrivna innehållet. Fallet är den indata som når märkningsjämförelsen;
     utan det är jämförelsen bara en pid-jämförelse som inget test skiljer från
     den rätta.
  10. **Två överlappande `acquireDataFileLock()` mot samma datafil.**
     `const [a, b] = await Promise.allSettled([acquireDataFileLock(),
     acquireDataFileLock()])`, alltså båda startade innan någon av dem hunnit
     uppfylla sig. Krav: exakt ett utfall är `fulfilled`, det andra är `rejected`
     med rad L5:s sträng, och låsfilen finns med den uppfylldas märkning.
  11. **Struket nummer, och det återanvänds aldrig.** Fallet krävde ett andra
     skrivförsök som också misslyckas och därmed ger rad L4. Byggarens körning
     visade att den indatan inte går att konstruera i den här miljön —
     `fs.unlink` lyckas med ett öppet handtag — grenen är struken ur pseudokoden,
     och fallet är därmed borta. Numret står kvar som en tom rad av samma skäl som
     namnen L1–L4 är oförändrade: numren är **namn**, och ett nummer som får en ny
     innebörd gör varje äldre hänvisning tvetydig. Nästa fall som tillkommer får
     nummer 13.
  12. **Ett släpp utan post i bokföringen rör inte disken.**
     `releaseDataFileLock(null)`, `releaseDataFileLock(undefined)` och
     `releaseDataFileLock('<en sökväg utan post i heldLocks>')` ska var och en
     göra **noll** filoperationer. Kravet mäts och antas inte: testet ersätter
     `fs.readFile` med en räknande omslutning runt anropet, kräver `0` läsningar,
     och lägger tillbaka originalet både direkt efter anropet och i en
     `after`-hook — ett fall som avbryts får inte lämna en patchad kärnmodul efter
     sig. Formuleringen "låsfilen är oförändrad" duger inte som enda assertion och
     är förbjuden här: utan spärren `token === undefined` läser modulen ändå filen
     och jämför innehållet med `undefined`, vilket också lämnar filen i fred, så
     villkoret överlever mutation med den gamla formuleringen — det var byggarens
     skäl att byta mätsätt. Filen får gärna kontrolleras som oförändrad **utöver**
     räkningen, aldrig i stället för den. Räkningen förutsätter att `lock.js` når
     sina filoperationer genom modulnamnrymden (`import fs from
     'node:fs/promises'`): med `import { readFile }` ser testet ingenting, och då
     ska mätsättet bytas — kravet på noll filoperationer står kvar.
  Mutationer som ska köras, en i taget, med kryssraden inklistrad och jämförd med
  det utpekade fallet: (a) låt `acquireDataFileLock` uppfylla sig med `lockPath`
  när `heldLocks` redan har posten, i stället för rad L5 → **fall 5** faller;
  (b) jämför bara pid i `releaseDataFileLock`, inte hela märkningen → **fall 9**
  faller; (c) byt `heldLocks` mot en enda variabel för den senast tagna sökvägen
  → **fall 6** faller; (d) låt exit-städningen bara ta den senast tagna sökvägen
  → **fall 7** faller; (e) ta bort köplatsen och anropa arbetet direkt i både
  `acquireDataFileLock` och `releaseDataFileLock` → **fall 10** faller;
  (f) ta bort spärren `token === undefined` i släppandet, så att en sökväg utan
  post ändå läser filen → **fall 12** ska falla, och den assertion som fäller det
  ska vara räknaren; visar meddelandet i stället en filjämförelse är mätsättet
  inte det kravet säger och paketet lämnas tillbaka.
  Mutation (e) ska köras **tio gånger** och antalet körningar som fällde fall 10
  redovisas; kravet är tio av tio, annars är fallet inget skydd mot mutationen
  och paketet lämnas tillbaka (`LARDOMAR.md`, 2026-09-07, mutationsdetektor som
  beror på tur). Följer av `LARDOMAR.md` (2026-09-07, lås: ett misslyckat andra
  `start()` i samma process tar bort ett lås som fortfarande används).
- **Paket 5: `api.js` importerar inte `saveEntries`.** Obligatoriskt i
  `tests/api.test.js`. Regeln "varje läs-ändra-skriv går genom `updateEntries`"
  är annars bara en mening i den här filen, och en mening kan paket 6 och 7 inte
  falla på. Testet läser `src/server/api.js` som text, med sökvägen byggd ur
  `import.meta.url`, och kräver: strängen `'./storage.js'` förekommer på exakt
  ett ställe i filen; den förekomsten matchar en namngiven importsats
  (`/import\s*\{([^}]*)\}\s*from\s*'\.\/storage\.js'/`), alltså aldrig
  `import * as`; och namnlistan i den satsen innehåller inte `saveEntries`.
  **Regeln gäller bindningen `saveEntries` i modulens omfång, inte strängen
  `saveEntries` i en importlista.** Varje element i listan normaliseras därför
  till sitt importerade namn — `del.split(/\s+as\s+/)[0].trim()` — innan
  jämförelsen. Utan normaliseringen är `namn.includes('saveEntries')` falskt för
  elementet `saveEntries as spara`, och spärren släpper igenom exakt den
  återinföring den byggdes för att stoppa; granskaren körde den stavningen och
  fick `✔` och `EXIT=0`.
  Mutationer som ska köras, **alla tre**, en i taget, var och en med kryssraden
  inklistrad — en textspärr prövas med varje stavning språket tillåter för samma
  bindning, aldrig bara med den stavning regeltexten råkar använda
  (`LARDOMAR.md`, 2026-09-07, textspärren mot `saveEntries` går förbi med ett
  alias):
  1. `import { loadEntries, updateEntries, saveEntries } from './storage.js';`
     — det raka namnet;
  2. `import { loadEntries, updateEntries, saveEntries as spara } from './storage.js';`
     — aliaset, som fälls av normaliseringen och av ingenting annat;
  3. `import * as storage from './storage.js';` — namnrymden, som fälls av kravet
     på en namngiven importsats.
  Alla tre ska ge `EXIT=1` på samma kryssrad, alltså på det här testfallet.
  **En textspärr räknas aldrig som det enda skyddet mot regressionen:** skriv i
  redovisningen ut vilka beteendetestfall samma återinföring fäller — de tre
  samtidighetsfallen under "Paket 5: två överlappande anrop får inte tappa en
  ändring" — och kör dem. Regeln som testet upprätthåller står under
  `src/server/storage.js` i "Gränssnitt".
- **Paket 5: `src/web/app.js` körs av `tests/app.test.js` mot en incheckad
  DOM-attrapp.** Ingen webbläsarautomatisering införs — det skulle vara
  projektets största beroende och pröva minst — men filen ska laddas och köras av
  `npm test`. Kravet på fem redovisade körningar mot en attrapp byggaren själv
  slängde efteråt är avskaffat och får inte återinföras: en mätapparat som kastas
  bort gör mätningen omöjlig att göra om, och under det kravet gav mutationen "ett
  namn som inte finns plus `const trasig = ( ;` i `src/web/app.js`"
  `tests 241, pass 241, fail 0` och `EXIT=0` (`LARDOMAR.md`, 2026-09-07,
  `src/web/app.js` kan göras syntaktiskt trasig utan att `npm test` faller).
  - **Två filer, med var sitt ansvar.** `tests/app.test.js` är testfilen.
    `tests/helpers/dom.js` är mätapparaten: DOM-attrappen, `fetch`-attrappen och
    laddaren. Attrappen ligger under `helpers/`, körs aldrig av testköraren och
    är den **enda** DOM-attrappen i projektet — en andra kopia i en annan testfil
    är ett fel, samma ägarregel som för konstanterna i `src/core/`.
  - **Laddningen är bindande.** Laddaren läser `src/web/app.js` från disk vid
    varje anrop (så att ett syntaxfel når körningen), pekar om
    `/core/`-specifikationerna till `src/core/` (webbläsaren hämtar dem över
    HTTP, en Node-körning har ingen server), och importerar källan som en
    `data:`-modul med ett unikt inslag per anrop — `app.js` har modullokalt
    tillstånd som inte får följa med till nästa testfall. `globalThis.document`
    och `globalThis.fetch` sätts av laddaren och återställs i en `after`-hook.
    Sökvägarna byggs ur `import.meta.url`, aldrig ur `process.cwd()`.
  - **Ingen server, inga timers och ingen klocka i den här testfilen.** `fetch` är
    alltid attrappen: allt `app.js` gör här är löften utan I/O, och testet driver
    dem själv genom att flöda ut mikrotaskerna ett bestämt antal varv. Därför
    behövs ingen tidsgräns och ingen hängningsspärr, och därför har filerna ingen
    rad i tabellen under "Inget test asserterar på körtid". Den tabellens kontroll
    är skriven för hängningsspärrar och svarar på en annan fråga än den här
    punkten, så den ärvs inte hit: kravet här är strängare och har en egen
    kontroll. Serversidan prövas av `tests/api.test.js` och
    `tests/server.test.js`; ett fall som startar en server hör hemma där och inte
    här.

    **Kontrollen är förankrad i klockans källor, inte i en lista över metodnamn.**
    Den tidigare lydelsen räknade upp sex API:er — `setTimeout`, `setInterval`,
    `AbortSignal.timeout`, `Promise.race`, `performance.now` och `Date.now` — och
    kunde därför inte se de klockläsningar som skrevs in i filen: `todayIso()`,
    `Date.parse` och `new Date(ms)` heter inget av de sex, och kontrollen gav noll
    träffar medan filen läste klockan (`LARDOMAR.md`, 2026-09-22,
    `tests/app.test.js` läser klockan sju gånger). Mönstret namnger i stället de
    objekt ett tidsvärde kan komma ur, så att en stavning ingen har tänkt på
    träffas ändå:

    ```
    grep -nE "\b(Date|Temporal|performance|hrtime|todayIso|setTimeout|setInterval|setImmediate|AbortSignal)\b|Promise\.race" tests/app.test.js tests/helpers/dom.js tests/helpers/frozen-dates.js
    ```

    `\bDate\b` träffar `new Date(`, `Date.now`, `Date.parse`, `Date.UTC` och
    `globalThis.Date`, men inte `startDate` eller `nextDueDate`: ordgränsen saknas
    inuti ett sammansatt namn, och fältnamnen är därför inga falska träffar.
    Kontrollen räknas som prövad först när den har körts mot två stavningar som
    inte liknar de tidigare kända. Byggaren stoppar in `Date.UTC(2026, 0, 1)` och
    `Temporal.Now.plainDateISO()` på var sin rad i `tests/app.test.js`, kör
    kommandot, kräver en träff för var och en, tar bort raderna och kör om.
    Varje kvarvarande träff ska ha en rad i tabellen nedan; en träff utan rad
    stoppar paketet.

    | Fil | Tillåtna träffar |
    |---|---|
    | `tests/app.test.js` | inga |
    | `tests/helpers/dom.js` | inga |
    | `tests/helpers/frozen-dates.js` | namnet `todayIso` i exportens egen definition, och ingenting annat: filen har ingen klocka att läsa utan lämnar tillbaka den sträng laddaren satt |

    Raden "inga" gäller också kommentarer, och det är med flit: en kommentar som
    behöver tala om klockan skriver "klockan" eller "dagens datum" i stället för
    API-namnet. Priset är en omskriven mening, vinsten är att kontrollen har ett
    svar — noll träffar — som ingen behöver tolka.

    Av kontrollen följer att **ingen spärr mot en midnattspassage får finnas i
    filen**: en sådan spärr måste läsa klockan för att jämföra, och varje väg till
    klockan är en träff. Den behövs inte heller, av skälet i punkten nedan.

  - **Klockan som `app.js` läser är injicerad, inte verklig.** `renderUpcoming`
    anropar `todayIso()` själv vid varje rendering, och det ska den göra: en flik
    som står öppen över midnatt ska visa rätt dagar kvar vid nästa hämtning (se
    "Kommande dragningar i gränssnittet"). DOM-attrappen har ingen klocka att
    ställa, och ett test som jämför mot samma verkliga klocka har därför två
    problem. Det kan bli rött på oförändrad kod när dygnet byts mellan
    uppställningen och körningen, vilket gör `CLAUDE.md`:s grind "`fail 0` och
    exit 0" oduglig för filen, och det kan aldrig pröva en annan dag än den dag
    det råkar köras.

    **Beslut: laddaren äger klockan, precis som den äger `document` och `fetch`.**
    I webbläsaren kommer `todayIso` över nätet, i en Node-körning ur laddaren —
    samma ompekning som redan gäller varje annan `/core/`-import, och därmed ingen
    ny sorts konstruktion i filen. Kraven är bokstavliga:

    1. Laddaren har signaturen `loadApp(t, { document, fetch, idag })`. `idag` är
       en sträng på formen `ÅÅÅÅ-MM-DD`.
    2. `tests/helpers/frozen-dates.js` är en incheckad hjälpfil under `helpers/`
       och exporterar `todayIso()` plus den sättare laddaren använder. `todayIso()`
       lämnar tillbaka den sträng som sattes senast. Filen läser ingen klocka och
       får inte innehålla något av mönstren i kontrollen ovan utöver sitt eget
       exportnamn.
    3. Attrappen är sträng, samma regel som för DOM-attrappen: `todayIso()` kastar
       när ingen dag är satt, och sättaren kastar för varje värde `isValidIsoDate`
       i `src/core/dates.js` svarar `false` på. En stub som svarar `undefined`
       skulle låta `app.js` gå sönder tyst, och då mäter testet ingenting.
       **Ägaren är `isValidIsoDate` och inte `ISO_DATE_PATTERN`**, och valet är
       inte fritt: mönstret äger frågan "rätt form", `isValidIsoDate` äger frågan
       "finns i kalendern", och det är den senare spärren lovar ett svar på.
       `2026-02-30` har rätt form men ingen kalenderdag, och granskarens körning
       visar vad mönstret ensamt ger: `loadApp` med den dagen faller med
       `RangeError: nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD,
       fick "2026-02-30".` kastad från `src/core/schedule.js`, alltså långt från
       laddaren och med ett meddelande som pekar ut fel orsak. Sättarens text är
       bindande ordagrant:

       ```js
       `frozen-dates kräver ett datum som finns i kalendern på formen ÅÅÅÅ-MM-DD, fick "${String(day)}".`
       ```

       `String(day)` och inte värdet rakt in i mallsträngen, av samma skäl som i
       `src/core/`: `${Symbol('x')}` kastar `TypeError`. Villkoret skrivs som
       `!isValidIsoDate(day)` utan någon `typeof`-kontroll bredvid —
       `isValidIsoDate` svarar `false` för varje värde som inte är en sträng, så
       en andra kontroll vore en gren ingen indata når.
    4. Laddaren pekar om `app.js`:s egen `/core/dates.js` till hjälpfilen, efter
       den ompekning som redan görs för `/core/`. Båda adresserna byggs ur
       `import.meta.url`, aldrig ur `process.cwd()`. Antalet utbyten asserteras
       vara **exakt ett**: slutar `app.js` importera `todayIso` ska laddningen
       falla, inte tyst sluta mäta — samma skäl som assertionen på att
       `/core/`-ompekningen träffar något.
    5. Laddaren sätter dagen före importen och återställer det tidigare värdet i
       en `t.after`-hook, precis som `globalThis.document` och `globalThis.fetch`.
       Återställningen är sann bara under villkoret i krav 8: **högst en levande
       instans, alltså högst en hook i taget.** `node:test` kör `after`-hookar i
       registreringsordning, så två hookar i samma test ger den sist registrerade
       sista ordet — och den lägger tillbaka en ögonblicksbild som redan var det
       första anropets värde.
       Granskarens körning av två `loadApp` i samma test: efteråt svarar
       `todayIso()` med den **första** dagen i stället för att kasta, och
       `globalThis.document` och `globalThis.fetch` står kvar satta.
    6. Laddaren lämnar tillbaka en väg för testet att sätta en annan dag mitt i
       ett fall, utan att testet importerar hjälpfilen självt. Den vägen är hela
       poängen med punkt (27) nedan. Den vägen byter dag inom det pågående
       testfallet och är alltså inte ett andra `loadApp`: krav 8 rör bara
       laddningen av modulen.
    7. `tests/app.test.js` har den frusna dagen som en namngiven konstant,
       `FRYST_IDAG = '2026-03-15'`, och `starta` tar dagen som ett argument med
       den konstanten som förval. Värdet är valt mitt i en månad med 31 dagar, så
       att en post som startar i dag, i morgon eller i övermorgon ligger i samma
       månad och dagtexterna `Idag`, `Om 1 dag` och `Om 2 dagar` går att nå utan
       någon datumaritmetik i testfilen. Den andra dagen punkt (27) behöver är
       `FRYST_NASTA_DAG = '2026-03-16'`, skriven som en andra konstant och inte
       uträknad.
    8. **Högst en levande instans av `app.js` åt gången, i hela processen.**
       Laddaren håller en modullokal flagga över om en instans lever, prövar den
       **innan** något tillstånd rörs, och kastar annars. Flaggan heter
       `appLaddad`, och den nollställs i samma `t.after`-hook som lägger tillbaka
       globalerna och dagen. Texten är bindande ordagrant:

       ```js
       'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.'
       ```

       **Villkoret gäller processen och inte testkontexten**, och den skillnaden
       är mätt. Den tidigare lydelsen nycklade en `WeakSet` på `t`, och ett
       underordnat test har en egen kontext: granskarens körning visar att ett
       `loadApp` inuti ett `t.test` passerade spärren, att båda instanserna levde
       samtidigt, och att förälderns formulärsubmit hamnade i barnets
       `fetch`-attrapp — ordagrant den fara spärren finns för. En spärr som bara
       prövas med sin egen stavning missar den stavning ingen tänkt på; det är
       fjärde gången i projektet, och därför är villkoret skrivet om det som är
       farligt (två levande instanser) och inte om den nyckel som råkade ligga
       närmast (`t`).

       Avvisningen är vald framför en räknare eller en hook som registreras bara
       första gången, och skälet är att bokföringen inte är hela problemet: två
       instanser delar `globalThis.fetch` och stubbens dag, så den andra skriver
       över den förstas omvärld medan båda lever vidare med var sin lyssnare på
       attrappens element. En räknare hade gjort återställningen sann och lämnat
       den sammanblandningen kvar. Behöver ett senare paket verkligen två
       instanser samtidigt är det ett beslut som fattas i beslutsloggen — och då
       med ett svar på vad de två ska dela.

       **Ordningen i `loadApp` är bindande**, eftersom flaggan annars kan bli
       kvar: pröva flaggan först, registrera därefter `t.after`-hooken som
       nollställer den och lägger tillbaka globalerna och dagen, och sätt flaggan
       sedan. Hooken är registrerad före importen, så den körs också när
       `import()` avvisar — vilket den gör i syntaxfelsmutationen, som måste
       fortsätta ge `EXIT=1` utan att lämna flaggan satt för resten av filen.

       **Vad villkoret vilar på:** att testfallen i en fil körs ett i taget.
       `node --test` kör en process per testfil, och tester inom filen körs efter
       varandra så länge ingen sätter samtidighet. Skulle ett senare paket ändra
       det börjar spärren slå till mellan fall som körs parallellt — och det är
       rätt utfall, eftersom två levande instanser då verkligen delar globaler.
       Den dagen ska villkoret skrivas om här först.

    **Ompekningen räcker bara så länge ingen annan modul `app.js` laddar läser
    klockan.** `src/core/schedule.js` tar dagens datum som parameter och ska
    fortsätta göra det. Kontrollen är `grep -rn "\btodayIso\b" src/core/`: varje
    träff ska ligga i `dates.js`, som äger funktionen, eller i en kommentar, och
    ingen importrad under `src/core/` får namnge `todayIso`.

    **Vad konstruktionen inte kan upptäcka**, utskrivet i stället för underförstått:
    den prövar inte att `todayIso()` i `src/core/dates.js` ger rätt dag — det ägs
    av `tests/dates.test.js`, där `now` skickas in — och den prövar inte att
    webbläsaren kan hämta `/core/dates.js`, vilket ägs av testfallen för statiska
    filer i `tests/server.test.js`. Den prövar det `app.js` gör med den dag den
    får.

    **Stubbens spärrar, och varför bara den ena får ett testfall.** Krav 3 ovan
    ger hjälpfilen ett kast när en dag sätts i fel form och ett kast när
    `todayIso()` anropas innan någon dag är satt. Ingen indata i sviten når dem
    var för sig — de fälls först i par med en andra ändring — och då gäller
    frågan från `LARDOMAR.md` (2026-09-04): är grenen **onåbar**, och ska då tas
    bort, eller **nåbar men oprövad**, och ska då antingen prövas eller skrivas
    ut? Svaret skiljer sig mellan de två, och därför gör beslutet det också.
    Kriteriet nedan gäller de här två grenarna och inget annat: en regel som
    sträcks längre än den indata den är mätt mot är precis det fel som gav
    `assert.throws`-kravet sin lärdom.

    | Spärr i `tests/helpers/frozen-dates.js` | Nås av | Beslut |
    |---|---|---|
    | Formkontrollen i sättaren | en rad i `tests/app.test.js`, utan att någon klocka läses | punkt (32) |
    | Kastet när ingen dag är satt | bara av en laddare som importerar `app.js` utan att sätta dagen, alltså av en ändring i mätapparaten själv | **avsiktligt oprövad**, skälet nedan |

    Kastet när ingen dag är satt är inte död kod: indatan finns och byggarens
    körning har nått den genom att ta bort laddarens sättande. Den indatan går
    däremot inte att skriva i `tests/app.test.js`, eftersom den enda vägen dit är
    att anropa `todayIso()` i testfilen — och varje sådan väg är en träff i
    klockkontrollen ovan, som inte har och inte ska ha ett undantag. *En egen
    testfil för mätapparaten prövades och förkastades:* den skulle stå utanför
    klockkontrollens fillista och därmed göra hålet i fynd 1 möjligt igen, och
    ingen annan hjälpfil har en sådan fil. Grenen står alltså kvar som diagnostik
    för nästa byggare — utan den byter ett glömt sättande ut ett svenskt besked
    som pekar ut laddaren mot ett fel längre in i `src/core/`, vilket byggarens
    körning mätte. Byggaren skriver in en rad i kommentaren över grenen som
    hänvisar hit, så att nästa granskare ser att avsaknaden av testfall är ett
    beslut och inte ett förbiseende.

    | Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
    |---|---|---|
    | (32) | `laddarens byte av dag avvisar en dag som inte finns i kalendern` | `if (!isValidIsoDate(day)) {` → `if (false) {` |
    | (33) | `ett andra loadApp i samma testfall avvisas`, `ett loadApp i ett underordnat test avvisas` och `laddarens after-hook lämnar tillbaka globalThis efter ett avvisat andra anrop` | `if (appLaddad) {` → `if (false) {` |

    Fallet för (32) anropar laddarens väg för att byta dag och kräver hela
    meddelandet, inte bara feltypen, av samma skäl som gäller spärrarna i
    `src/core/schedule.js`: en assertion på enbart feltypen kan inte skilja
    stubbens kast från ett kast längre in. Fallet prövar `'imorgon'`, som har fel
    form, och `'2026-02-30'`, som har rätt form men ingen kalenderdag; det är den
    senare som avgör ägarvalet i krav 3. Inget av argumenten får vara något som
    läser klockan.

    De två mutationsuttrycken citerar villkor som krav 3 och krav 8 beskriver och
    som byggaren skriver i den här rundan. Kontrollen är densamma som för varje
    annan rad och körs när koden finns: `grep -c "<uttrycket före pilen>"
    tests/helpers/frozen-dates.js` respektive `tests/helpers/dom.js` ska ge minst
    `1`, annars är raden och koden skrivna för olika villkor.

    Punkt (33) har tre testfall, och de prövar spärren i krav 8 från var sitt håll.
    Det första anropar `starta` två gånger i samma testfall och kräver hela texten
    ur krav 8. Det andra laddar en gång och kör därefter ett underordnat test —
    `await t.test(...)` — vars kropp anropar `starta` med **barnets** testkontext
    och kräver samma text. Det fallet är det som skiljer villkoret "en levande
    instans i processen" från det tidigare "en laddning per `t`": med en nyckel på
    testkontexten passerar barnets anrop, och granskarens körning visade då två
    levande instanser där förälderns formulärsubmit hamnade i barnets
    `fetch`-attrapp. Ett fall som bara laddar två gånger med samma `t` kan inte se
    den skillnaden, och därför räcker det inte.

    Det tredje fallet prövar att återställningen från det första anropet blev av.
    Globalerna prövas på olika sätt, och skälet är
    körmiljön: **bara den ena går att jämföra med `undefined`**. Node har en inbyggd
    `globalThis.fetch` men ingen DOM (se "Verifierad miljö"), så laddaren sparar
    den inbyggda funktionen i sitt `tidigareFetch` och lägger tillbaka den. Det är
    rätt beteende, men värdet är då en funktion och blir aldrig `undefined`. Den
    tidigare lydelsen krävde `undefined` för båda och var därför omöjlig att
    uppfylla här; byggaren byggde fallet ordagrant och fick
    `✖ laddarens after-hook lämnar tillbaka globalThis efter ett avvisat andra
    anrop`.

    - `globalThis.document` asserteras mot `undefined`.
    - `globalThis.fetch` asserteras mot det värde testfilen läste **innan något
      testfall kördes**. Filen håller `const FETCH_FORE_TESTERNA =
      globalThis.fetch;` på modulnivå, och fallet kräver
      `globalThis.fetch === FETCH_FORE_TESTERNA`. Det är samma påstående som
      `undefined` skulle ha varit i en miljö utan inbyggd `fetch` — att attrappen
      inte står kvar — skrivet så att det går att uppfylla här. En assertion om
      att `fetch` bara *inte* är attrappen vore svagare: den passerar också om
      återställningen lägger tillbaka något tredje.

    Mutationen i (33):s rad ska fälla **alla tre** fallen, och kryssraderna för
    var och en ska stå i utfallet: utan spärren registrerar det andra anropet en
    andra hook vars ögonblicksbild togs efter det första anropet, och då lägger
    den sista hooken tillbaka det första anropets attrapper — `document` är satt
    och `fetch` är attrappen i stället för det inlästa värdet.

    **Att dagen är osatt asserteras inte**, och skälet är
    en konsekvens av klockkontrollen: det läget syns bara genom `todayIso()`, och
    varje stavning av den vägen är en träff i kontrollen. Avvisningen i krav 8 är
    det som gör påståendet sant i stället — med högst en levande instans finns
    ingen andra ögonblicksbild som kan vinna, och det är den mekanismen (33)
    skyddar.
  - **Attrappen är sträng, och den växer bara med `app.js`.** En selektor eller
    ett element den inte känner till ska ge ett **kast**, aldrig `null`: en
    attrapp som svarar `null` på något den inte förstår låter `app.js` gå sönder
    tyst, och då mäter testet ingenting. Den får bara ha de element, egenskaper
    och metoder `index.html` och `app.js` verkligen använder — den ska inte bli en
    DOM-implementation, och inget stöd får byggas för ett anrop som ingen rad i
    `src/web/` gör. Ett avstängt element tar inte emot ett klick (det är
    webbläsarens beteende och grunden för spärren under "Knappen spärras under ett
    pågående anrop"), medan `submit` går fram oavsett — en submit-händelse behöver
    inte komma från knappen, och det är därför `app.js` har ett eget
    pågående-läge. Attrappens id:n jämförs med de id:n `index.html` själv skriver
    ut; det testfallet är det som gör att paket 6 och 7 inte kan lägga till ett
    fält i `index.html` utan att attrappen får det.
  - **`tests/app.test.js` täcker minst**, och de tre första är de gamla fall 1–3:
    (1) ett `400` med två `fieldErrors` visar båda texterna vid sina fält och
    lämnar den allmänna rutan tom; (2) ett `500 { error }` visar `error`-texten i
    den allmänna rutan; (3) ett `500` med en kropp som inte är JSON visar
    `GENERAL_ERROR` — den konkreta indata som når
    `typeof body.error === 'string'`-grenen; (4) ett `fetch` som avvisas visar
    `GENERAL_ERROR` och lämnar Spara-knappen påslagen; (5) att modulen laddas utan
    att kasta och att `#interval` och `#category` fyllts med nycklarna **och**
    etiketterna ur `INTERVAL_LABELS` respektive `CATEGORY_LABELS`, alltså att
    ingen svensk etikett skrivs för hand i `app.js`; (6) att attrappens id:n är
    exakt `index.html`:s; (7) en giltig post: kroppen är utkastet ordagrant med
    beloppet som rå sträng, formuläret nollställs, listan hämtas om (`GET`,
    `POST`, `GET`) och raden visar `formatSek`-strängen; (8) två `submit` i rad
    medan det första anropet är i luften ger **exakt ett** `POST`; (9) ett andra
    klick på **samma** Ta bort-knapp medan anropet är i luften ger **inget** andra
    `DELETE`; (10) klick på Ta bort för den första posten och därefter för den
    **andra** ger två `DELETE` och tömmer listan — granskarens underkännande av
    paket 5, som ska visas grönt och inte antas; (11) en borttagning som ger `404`
    visar serverns text och lämnar raden kvar i vyn.
  - **`tests/app.test.js` täcker dessutom, från paket 6:** (12) tre poster med
    var sitt intervall (`monthly`, `quarterly`, `yearly`) ger sex celler per rad,
    och `entry-monthly` och `entry-yearly` bär de exakta strängarna med etikett
    och `formatSek`-belopp — minst en av dem skriven med `\u00a0` för blanktecknet
    före `kr`, aldrig med vanligt mellanslag; (13) totalrutans `#total-monthly`
    och `#total-yearly` bär `formatSek(totalMonthlyOre(entries))` respektive
    `formatSek(totalYearlyOre(entries))`, jämförda mot ett anrop av de två
    exporterna i testet och inte mot en inskriven sträng; (14) **kolumnen och
    totalen skiljer sig med ett öre för just de tre posterna** — testet
    asserterar både att raderna summerar till `141,66\u00a0kr` och att
    `#total-monthly` visar `141,67\u00a0kr`, så att ingen senare byggare kan byta
    `totalMonthlyOre` mot en kolumnsumma utan att ett test faller; (15) en tom
    lista ger `#empty-state` med texten ur punkt 8, en tom `#entry-list` och
    `0,00\u00a0kr` i **båda** totalelementen — totalrutan döljs alltså inte; (16) en
    lista med minst en post ger `#empty-state` den tomma strängen.
  - **Paket 6 lade till (19) och (20):** (19) en tom lista vid sidladdningen,
    följd av ett `POST` som ger `201` och en omhämtning som ger `500`, lämnar
    `#empty-state` tomt — utgångsläget är alltså det motsatta av det förväntade,
    och utan nollställningen i `clearView` står "Du har inga poster ännu"
    samtidigt som båda totalerna visar `\u2013`, två motsägande påståenden på samma
    skärm; (20) ett svar med status `200` **utan läsbar JSON-kropp** ger en tom
    vy och inget kast. Punkt (20) prövar `Array.isArray(body.entries)`-skyddet i
    `loadAndRender`, som byggarens körning i paket 6 visade är nåbart: `readJson`
    svarar `{}` för en kropp som inte går att tolka, och utan skyddet ger
    `renderEntries` `TypeError: entries is not iterable` — en trasig vy helt utan
    felmeddelande. Appens egen serverkod kan inte producera ett sådant svar
    (`sendJson` skriver alltid en fullständig kropp), men ett `200` som kapas
    efter huvudena kan: serverprocessen dör mitt i svaret, eller nätet bryter.
  - **Punkt (17) och (18) står inte här utan under "Vyn när en hämtning
    misslyckas" i avsnittet om `src/web/app.js`**, tillsammans med den regel de
    prövar och den mutation de ska fälla. De räknas till den här listan och är
    lika obligatoriska som (12)–(16); de står där för att en regel och dess
    testfall ska ha exakt ett hem.
  - **Punkt (21) till (27) står av samma skäl under "Kommande dragningar i
    gränssnittet", och punkt (28) till (31) under "Radelementets klass är ett
    kontrakt med `style.css`"**, båda i avsnittet om `src/web/app.js`. Punkt (32)
    och (33) står i punkten om den injicerade klockan ovan, hos de krav de prövar,
    och punkt (34) till (36) under "Vyn efter en borttagning". De är lika
    obligatoriska som punkterna här. Uppräkningen ovan är alltså inte fullständig
    för filen: den slutar vid (20), och fortsättningen har sitt hem där regeln den
    prövar står. Numren (1) till (36) är den enda serien för `tests/app.test.js`;
    `tests/schedule.test.js` har en egen serie med prefixet `S` under "Härledning
    av nästa dragningsdatum".
  - **Mutationer som paket 6 ska köra, utöver syntaxfelsmutationen nedan:**
    (a) byt `totalMonthlyOre(entries)` i `app.js` mot en kolumnsumma över
    `monthlyOre` → punkt (14) ska falla med `EXIT=1`; (b) **varje** rad som sätter `#empty-state` till den tomma strängen tas bort,
    en i taget, med en egen körning och en egen kryssrad per rad. Efter paket 6
    finns två sådana rader — `else`-grenen i `renderEntries` och nollställningen
    i `clearView` — och den första fälls av punkt (16), den andra av punkt (19).
    Kravet är skrivet som "varje rad" och inte som ett antal, så att en tredje
    förekomst inte gör det falskt: kör `grep -n "empty-state" src/web/app.js`,
    räkna träffarna som skriver den tomma strängen, och redovisa lika många
    mutationskörningar med `EXIT=1`. Byggaren klistrar in kryssraden för var och en. Överlever en
    mutation är punkten inte ett skydd, och paketet lämnas tillbaka.
  - **Mutation som ska köras innan filen räknas som testad:** stoppa in ett
    syntaxfel i `src/web/app.js` (`const trasig = ( ;`) → `npm test` ska ge
    `EXIT=1`, och byggaren klistrar in kryssraderna. Paket 6 och 7 kör om samma
    mutation innan de lämnar vidare: det är den enda kontroll som visar att den
    fil de bygger i fortfarande körs av sviten.
- **Determinism:** inget test får bero på dagens datum. Dagens datum skickas
  alltid in som parameter. Ett test som skulle gå sönder i mars är ett trasigt
  test. Regeln har ett gränsfall och ingen undantagsrätt: `src/web/app.js` läser
  klockan självt, eftersom den ska visa rätt dagar kvar i en flik som stått öppen
  över midnatt. Parametern finns även där, men en modul in i stället för en
  funktion in — laddaren injicerar dagen, se punkten om DOM-attrappen ovan. Ett
  test som i stället läser samma verkliga klocka som koden under prov uppfyller
  inte den här punkten.
- **Paket 4:s "ny körning"** uppfylls genom att testet skriver med
  `saveEntries`, därefter importerar modulen på nytt med en cache-brytande
  query (`await import('../src/server/storage.js?fresh=' + Date.now())`) och
  läser tillbaka. Filen på disk är sanningen, inget cachas i modulminne.
  Den nya importen ger en **ny modulinstans med en egen `ioQueue`**: två
  instanser delar inte kö. Ett test får därför aldrig ha läsningar eller
  skrivningar i luften från båda instanserna samtidigt — invänta den ena innan
  den andra startas. Två instanser som rör filen samtidigt kan ge `EPERM` från
  `rename`, precis som en handtagare utanför modulen.
- **Paket 4: två överlappande skrivningar.** Bygg `a` med 3 000 giltiga poster
  och `b` med 1 500 giltiga poster, med olika `id` och `name` så att en
  blandning syns. Kör minst 20 omgångar av
  `await Promise.allSettled([saveEntries(a), saveEntries(b)])`. Krav per
  omgång: båda resultaten har `status: 'fulfilled'`; `await loadEntries()`
  kastar inte och är `deepEqual` med `b`; `await fs.readdir(dirname)` ger exakt
  `['entries.json']`. Storlekarna är valda så att det stora anropet blir klart
  sist utan kö — utan kön vinner `a` på disk, och det är den skillnaden testet
  mäter. Mutation som ska köras: ta bort löfteskedjan så att `saveEntries` går
  direkt på disken, kör `npm test` och kräv exit 1. Följer av `LARDOMAR.md`
  (2026-09-02, två överlappande saveEntries delar samma .tmp-namn).
- **Paket 4: en läsning och en skrivning som överlappar.** Datafilen ska vara
  stor nog att läsningen fortfarande pågår när `rename` körs. Storleken är inget
  tal den här filen anger: byggaren mäter den genom att först köra fallet med kön
  borttagen ur `loadEntries` och öka antalet poster tills körningen ger minst en
  avvisning, och klistrar in antalet poster och filens storlek i byte i
  redovisningen. Granskarens körning nådde felet med 200 000 poster och en fil på
  37 577 818 byte. Kör därefter minst 20 omgångar av vardera anropsordningen:
  `await Promise.allSettled([saveEntries(b), loadEntries()])` och
  `await Promise.allSettled([loadEntries(), saveEntries(b)])`, där `b` är en
  annan lista än den som ligger på disk. Krav per omgång: båda resultaten har
  `status: 'fulfilled'`; i den första ordningen är läsningens värde `deepEqual`
  med `b`, i den andra `deepEqual` med listan som låg på disk före omgången; och
  `await loadEntries()` efteråt är `deepEqual` med `b`. En avvisning med
  `Datafilen kunde inte sparas: den nya filen gick inte att byta in: <sökväg>`
  betyder att läsningen inte gick genom kön. Mutation som ska köras: ta bort kön
  ur `loadEntries` så att läsningen går direkt på disken; `npm test` ska ge exit
  1, och det fallerande testet ska vara det här. Byggaren redovisar vilken av de
  två anropsordningarna som fällde mutationen. Följer av `LARDOMAR.md`
  (2026-09-04, en pågående loadEntries får saveEntries att misslyckas med EPERM).
- **Paket 4: atomicitetstestet ska avbryta en riktig skrivning.** Ett test som
  själv skapar en temporärfil bevisar ingenting — det gamla testet passerade två
  av tre assertioner med atomiciteten helt borttagen. Kraven är bokstavliga:
  1. Testet skapar utgångsläget genom att anropa `saveEntries` med en lista som
     **inte är tom** och som har ett annat antal poster än barnets lista (punkt
     2 nedan). Listan behålls i minnet och är facit för den första grenen i
     punkt 4. Någon `Buffer`-läsning av filen krävs inte: punkt 4 jämför listor med
     `deepEqual` genom `loadEntries`, och en byte-jämförelse svarar på en annan
     fråga än den punkt 4 ställer — barnets lista är ett godkänt utfall, och
     dess byte är varken kända före omgången eller intressanta efter den. Att
     utgångslistan inte får vara tom är däremot bindande, och skälet är rad 3 i
     "Beteende vid läsning": en tom fil läses som `[]`. Vore utgångslistan tom
     skulle en avbruten skrivning som lämnar en tom fil räknas som "den gamla
     listan" och passera oupptäckt.
  2. Skrivningen som avbryts sker i en barnprocess. Sökvägen till barnet byggs
     ur `import.meta.url`, aldrig ur `process.cwd()`:
     `const childPath = fileURLToPath(new URL('./helpers/interrupted-save.js', import.meta.url));`
     och därefter
     `fork(childPath, [], { env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath, HEMOCHEKONOMI_TEST_ENTRY_COUNT: String(antal) } })`.
     En cwd-relativ sökväg hittar barnet bara så länge kommandot körs från
     projektroten, medan testfilens egna importer alltid löses mot filens plats
     (`LARDOMAR.md`, 2026-09-04, storage-testet hänger för alltid).
     Barnet skickar `process.send('startar')` omedelbart före sitt
     `saveEntries`-anrop, som skriver `antal` poster. `antal` är minst 20 000 och
     kan höjas av punkt 7; saknas miljövariabeln skriver barnet 20 000 poster.
  3. **Dödandetiden härleds ur en mätning, aldrig ur ett tal i den här filen.**
     Före omgångarna kör testet en mätomgång som inte dödar barnet och tar tiden
     `tKlar` från att `startar`-meddelandet togs emot till barnets `exit`.
     Omgång `i` av `N` väntar därefter `Math.round((i * 2 * tKlar) / (N - 1))`
     millisekunder efter meddelandet, kör `child.kill('SIGKILL')` och inväntar
     `exit`. **`N` är 200.** Fönstret `0 … 2 × tKlar` är valt för att spänna
     över hela skrivningen: dess undre hälft ligger före `rename`, dess övre
     efter. Antalet omgångar är mätt fram och inte valt, och mätningen står i
     beslutsloggen: tiden som ett dödande måste träffa för att fälla mutationen
     i punkt 6 är cirka 0,2 ms av ett fönster på cirka 120 ms, och därför fällde
     mutationen testet i 1 av 30 körningar med `N = 20` men i 9 av 10 med
     `N = 200`. `N` är ett antal omgångar och ingen dödandetid: talet får stå
     skrivet i testkoden, och förbudet i nästa mening gäller det inte.
     **Ingen dödandetid får stå som ett millisekundtal, varken i
     testkoden eller i den här filen:** varje väntan före ett
     `child.kill('SIGKILL')` räknas ut ur `tKlar`. Den tidigare lydelsen band
     fönstret till `i = 0 … 19` ms, och granskarens mätning visade att barnet
     börjar skriva först efter cirka 45 ms, så assertionsgrenen i punkt 4 kördes
     noll gånger och mutationen i punkt 6 överlevde. Förbudet gäller
     dödandetiden och ingenting annat — hängningsspärren i punkt 8 är ett
     utskrivet undantag med sitt eget skäl. Byggaren klistrar in `tKlar` och de
     använda dödandetiderna i redovisningen.
  4. **Assertionen som ska fälla mutationen ligger i det här testet och namnger
     avbrottet:** `await loadEntries()` kastar inte, och listan är antingen
     `deepEqual` med utgångslistan eller `deepEqual` med barnets lista. Ingen
     tredje utgång godtas. Varje omgång räknas dessutom upp i en av två räknare,
     `gamlaListan` respektive `barnetsLista`, och efter sista omgången asserteras
     att **båda är minst 1**. En körning där någondera grenen kördes noll gånger
     är ett fallerat test, inte ett godkänt — det är den assertion som saknades
     när mutationen överlevde. En `console.log` av fördelningen ersätter aldrig
     assertionen.
  5. Testet skapar aldrig en temporärfil själv och asserterar aldrig på en
     temporärfil som det självt har skrivit. Det asserterar inte heller att
     temporärfilen är borta efter ett `SIGKILL` — ett dödat `finally` körs inte,
     se "Skrivvägen" under "Lagring".
  6. **Mutationen, och hur utfallet räknas.** Mutationen är: ersätt `writeFile`
     till temporärfilen plus `rename` med
     `await fs.writeFile(filePath, text, 'utf8')`. Kravet är **inte** att varje
     körning fäller det här testet. Om en omgångs dödande landar inne i den
     direkta skrivningen eller utanför den avgörs av var i barnets arbete tiden
     hamnar, och det kan testet inte styra: granskaren körde mutationen 12
     gånger, och testet föll 6 gånger och passerade 6. Ett krav som är uppfyllt i
     hälften av körningarna är inget krav, och det gjorde paket 4 omöjligt att
     lämna vidare på ett utfall slumpen bestämde.
     Kravet lyder därför: **kör mutationen tio gånger. Minst en av de tio
     körningarna ska falla på just det här testet, och det fallerande anropet
     ska vara punkt 4:s assertion.** Byggaren redovisar hur många av de tio
     körningarna som föll på testet och klistrar in raden som börjar med kryss
     (`✖`) från en av dem, med filnamn och radnummer för det fallerande
     anropet. Faller testet i noll av tio körningar räknas mutationen som
     överlevd och paketet lämnas tillbaka.
     **Referensvärdet med `N = 200` är 9 av 10.** Det är byggarens mätning på
     den här maskinen, och det är också skälet till att `N` höjdes från 20:
     med `N = 20` föll testet i 1 av 30 körningar (tre serier om tio: 0, 1, 0),
     alltså hade två av de tre serierna inte klarat kravet ovan. En körning som
     ger märkbart färre än 9 av 10 är ett tecken på att något annat har ändrats
     och ska redovisas med mätvärdena, även när kravet formellt är uppfyllt.
     Det är den formuleringen som skiljer ett test som verkligen prövar
     atomiciteten från ett som inte gör det, och det är hela syftet med kravet:
     det gamla testet föll i **noll** körningar med atomiciteten borttagen, och
     ett test som föll ungefär varannan körning och sedan inte faller i någon av
     tio har slutat pröva det det ska pröva.
     Två saker gäller oförändrat. `exit 1` ensamt är aldrig ett godkänt utfall —
     i paket 4 gav mutationen exit 1 från två andra tester medan raden
     `✔ en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den
     nya listan` stod kvar, och en sådan körning räknas som en av de tio där
     testet inte föll. Att andra tester faller under mutationen är alltså varken
     ett godkännande eller ett fel; de räknas inte. Och åt andra hållet:
     **utan** mutationen ska testet passera. Byggaren kör den ostörda sviten tre
     gånger i rad och redovisar `fail 0` och exit 0 för alla tre. Ett enda fall
     där testet faller på ostörd kod ska lämnas tillbaka, eftersom punkt 4:s
     assertion bara kan vara falsk för en skrivning som inte är atomär.
  7. **Är någon räknare 0 justeras uppsättningen och omgångarna körs om, högst
     tre försök totalt.** Är `barnetsLista` 0 landade varje dödande före
     `rename`: fördubbla fönstrets övre gräns (`4 × tKlar`, sedan `8 × tKlar`).
     Är `gamlaListan` 0 blev barnet klart före även det tidigaste dödandet:
     fördubbla `antal` poster i punkt 2. `tKlar` mäts om före varje nytt försök.
     Är någon räknare fortfarande 0 efter det tredje försöket faller testet på
     assertionen i punkt 4, och byggaren lämnar tillbaka paketet med mätvärdena.
     Räknarnas slutliga värden och antalet försök är dessutom redovisningskrav.
     **En startomtagning enligt punkt 8 förbrukar inget av de tre försöken här
     och har ett eget, oberoende tak.** De tre försöken justerar `windowFactor`
     och `entryCount` efter vad räknarna visade, och ett barn som aldrig hann
     starta ger inget underlag för någondera justeringen — det säger ingenting
     om var ett dödande landade, eftersom inget dödande blev av. Att låta en
     fork som missade kasta ett helt försöks utförda omgångar vore dessutom att
     kasta prov som blev av för ett fel som inte rör fördelningen. Antalet
     startomtagningar redovisas tillsammans med räknarna och antalet försök.
     Villkoret "minst 1 i var och en" är den enda assertion i projektet vars
     utfall beror på hur lång tid en skrivning tar; den står här därför att det
     tidigare förbudet mot varje sådan assertion var det som lät mutationen
     överleva. De enda andra ställen i projektet där tid alls kan avgöra ett
     utfall är hängningsspärrarna i tabellen under "Inget test asserterar på
     körtid", och de mäter ingenting — de bryter en väntan som annars är oändlig. Ingen annan assertion i testet får röra tid
     eller fördelning, och determinismkravet ovan — inget test beror på dagens
     datum — gäller oförändrat.
  8. **Hängningsspärren — det utskrivna undantaget från punkt 3.** Varje väntan
     på barnets `startar`-meddelande ska kapplöpa mot `child.once('exit', …)`,
     `child.once('error', …)` och en `AbortSignal.timeout(…)`.
     Timeouten **är** ett millisekundtal och står som en namngiven konstant i
     testfilen, `CHILD_START_TIMEOUT_MS`, på minst 30 000 ms. Undantaget är
     avgränsat och inte en uppluckring: en dödandetid avgör var i barnets arbete
     avbrottet landar och därmed vad omgången mäter, medan den här tiden aldrig
     kan påverka utfallet av en omgång som blir av. Gränsen är satt så högt just
     för att en långsam maskin inte ska kunna göra spärren till ett falskt fel;
     ett högre värde är alltid tillåtet, ett lägre inte. Skälet till att spärren
     måste finnas är att en hängning inte ger någon exitkod alls, och kravet i
     `CLAUDE.md` att kontrollera utgångskoden går då inte att uppfylla —
     granskarens körning från en annan katalog hängde i tio minuter utan exitkod
     och gav vid nästa försök `EXIT=124` från en yttre `timeout 60`.

     **Vinner något annat än meddelandet skiljs två utfall åt, och de behandlas
     olika.**
     - **`exit` eller `error`** — barnet dog, eller kunde inte startas alls.
       Testet faller omedelbart, och felmeddelandet ska innehålla barnets
       `exitCode`, `signalCode` och `stderr`; barnet startas därför med `stderr`
       som `'pipe'`, och utskriften samlas upp från start. Ett barn som dör är
       ett verkligt fel — felstavad sökväg, syntaxfel, en kastande import — och
       får aldrig göras om: en omtagning upprepar bara samma fel och fördröjer
       beskedet.
     - **Timeouten** — barnet varken skickade `startar`, avslutades eller
       kastade. Det är den enda grenen som görs om. Skälet är granskarens
       mätning: sviten gick röd en gång på 26 fullkörningar på en idle maskin,
       med en fork som inte hann skicka `startar` inom `CHILD_START_TIMEOUT_MS`.
       En slutgranskning av hela flödet kan inte vila på en svit som går röd
       utan att något är fel i projektets kod.

     **Timeouten kan slå till på två ställen, och omtagningen betyder olika
     saker på de två.** I punkt 3:s mätomgång finns ingen omgång att kassera:
     `tKlar` mäts om från början med ett nytt barn, och inget annat tillstånd
     rörs. Inuti omgångsloopen kasseras varvet och körs om **med samma
     `delays[i]`** — ett varv som hoppas över lämnar ett hål i det fönster punkt
     3 lägger ut jämnt över skrivningen, och punkt 4:s båda grenar blir därmed
     svårare att nå. Ett omkört varv börjar om från `await saveEntries(before)`,
     så att disken står i utgångsläget oavsett hur långt det kasserade barnet
     hann, och det kasserade barnets `exit` inväntas innan ett nytt forkas, så
     att aldrig två barn skriver mot samma datafil. Ett kasserat varv räknas i
     varken `gamlaListan` eller `barnetsLista`: bara ett varv som blev av är ett
     prov.

     **Taket.** Antalet startomtagningar i hela testet begränsas av en namngiven
     konstant i testfilen, `MAX_CHILD_START_RETRIES`, med värdet `3`. Den
     timeout som skulle bli omtagning nummer `MAX_CHILD_START_RETRIES + 1`
     fäller testet i stället för att göra om något. Konstanten heter `RETRIES`
     och inte `ATTEMPTS` därför att punkt 7 redan använder ordet *försök* om
     något annat, och två betydelser av samma ord i samma test är ett andra
     facit. Taket är testövergripande och inte per väntan: ett tak per väntan
     skulle släppa igenom ett obegränsat antal spridda omtagningar, och varje
     omtagning kostar upp till `CHILD_START_TIMEOUT_MS` i körtid.
     **Vad taket skyddar mot.** En omtagning döljer något, och det är hela
     invändningen mot den: ett barn som *systematiskt* inte hinner starta — på
     en långsam maskin, eller för att en import i `src/server/` har börjat hänga
     — blir med en omtagning tyst i stället för rött. Taket är den gräns där
     tystnaden upphör. Nås det faller testet med antalet gjorda omtagningar,
     orsaken (`timeout`) och det sista barnets `exitCode`, `signalCode` och
     `stderr` i meddelandet, precis som `exit`-grenen faller. En systematisk
     oförmåga att starta når taket på de första väntningarna och ger ett rött
     test efter ungefär fyra gånger `CHILD_START_TIMEOUT_MS` — med utskriven
     orsak och en exitkod, aldrig som en hängning.
     Värdet `3` är inte härlett ur någon mätning av hur ofta en fork missar; den
     mätningen finns inte, och det enda kända utfallet är granskarens en röda
     körning av 26. Talet är valt som det minsta som skiljer en enstaka miss
     från en upprepning. Visar en senare körning att en i övrigt grön maskin
     behöver fler ska talet skrivas om här, med mätningen inklistrad — aldrig i
     testfilen ensam.
     **Antalet startomtagningar är ett redovisningskrav** och skrivs ut i samma
     svep som punkt 7:s mätvärden, också när det är `0`. En körning där taket
     inte nåddes men omtagningar ändå gjordes är den enda plats där en maskin på
     gränsen blir synlig.

     **Båda grenarna ska köras, och körningarna klistras in i redovisningen.**
     - `exit`-grenen: kör testet en gång med barnets filnamn medvetet felstavat.
       Det ska ge exit 1 inom några sekunder, och den inklistrade utdatan ska
       visa ett `exitCode` som inte är `null` och en `stderr` som inte är tom —
       det är kontrollen av att fallet gick genom `exit` och inte genom
       timeouten.
     - Timeout- och takgrenen: kör testet en gång i en kopia av trädet med
       `CHILD_START_TIMEOUT_MS` satt till `1`, aldrig i `tests/` (`LARDOMAR.md`,
       2026-09-07, felsökningsutskrifter lämnades kvar i `src/server/storage.js`).
       Varje väntan timeoutar då, taket nås redan i mätomgången, och testet ska
       falla med antalet omtagningar och orsaken `timeout` i meddelandet.
  Följer av `LARDOMAR.md` (2026-09-02, atomicitetstestet avbryter aldrig en
  skrivning, och 2026-09-04, SIGKILL-testet dödar barnet innan skrivningen har
  börjat, och 2026-09-04, storage-testet hänger för alltid i stället för att
  falla när barnprocessen inte startar).
- **Paket 4: skrivvägens validering har egna tester.** Rad 1–3 i "Beteende vid
  skrivning" ska ha testfall, och listan ska minst innehålla `undefined`,
  `null`, `'abc'`, `{ a: 1 }`, `42`, `[giltigPost, undefined]`, en post med ett
  okänt fält (`income`), en post med fel typ (`amountSek: '199'`), en post med
  `amountSek: 1n`, en post med `amountSek: Symbol('x')` och en cirkulär post.
  `[]` är giltig indata och ska skrivas: `loadEntries()` ger `[]` efteråt. Per
  ogiltigt fall asserteras `error instanceof StorageError`, exakt
  `error.message` enligt tabellen, att datafilen är byte-identisk med före
  anropet (`fs.readFile` som `Buffer`, jämförd med `assert.deepEqual`) och att
  `fs.readdir(dirname)` är oförändrad. Invarianten *"allt som `saveEntries`
  accepterar kan `loadEntries` läsa tillbaka"* ska finnas som eget test. Följer
  av `LARDOMAR.md` (2026-09-02, saveEntries validerar ingenting).
- **Paket 4: rad 3 och rad 7 nås bara med en `Proxy`, och de ska nås.** En
  cirkulär post och `amountSek: 1n` avvisas redan av rad 2 och ger
  `Posterna kunde inte sparas: post nummer 1 är ogiltig.` — de kan alltså inte
  visa att rad 3 finns. Byggaren kör konstruktionerna nedan, klistrar in utfallet
  och lämnar tillbaka paketet om de inte håller:
  - rad 3: `new Proxy(giltigPost, { get: (t, p) => p === 'toJSON' ? () => { throw new Error('nej'); } : t[p] })`
    — `toJSON` är ingen egen nyckel, så `isEntry` ser sex fält och godkänner,
    medan `JSON.stringify` frågar efter `toJSON` och får ett kast.
  - rad 7: `new Proxy(giltigPost, { get() { throw new Error('nej'); } })` —
    `Object.keys` går genom `ownKeys` och kastar inte, men `isEntry` kastar när
    den läser ett fält, och det felet fångas bara av rad 7.
- **Paket 4: OS-felen ska provoceras på riktigt.** Rad 4–6 ska ha minst ett
  testfall var som får just det anropet att kasta. Per fall asserteras
  `error instanceof StorageError`, exakt `error.message` enligt tabellen,
  `assert.ok(error.cause)`, att `error.message` varken innehåller
  `operation not permitted`, `illegal operation` eller `EPERM`, och att ingen
  fil vars namn slutar på `.tmp` finns kvar i katalogen. Provokationerna är
  byggarens val men ska vara deterministiska och köras i den här miljön. Förslag
  som byggaren prövar:
  - rad 4 (`mkdir`): `HEMOCHEKONOMI_DATA_FILE` pekar på
    `<tmpdir>/enfil/hemochekonomi/entries.json` där `<tmpdir>/enfil` redan finns
    som en **fil**.
  - rad 5 (`writeFile`): en sökväg där katalogen är giltig men filnamnet inte
    kan skapas i den här miljön.
  - rad 6 (`rename`): datafilens sökväg är en befintlig **katalog**, eller
    datafilen hålls öppen med `await fs.open(filePath, 'r')` under skrivningen —
    granskarens körning gav `EPERM ... rename` för det senare på den här
    maskinen.
  Lärdomens recept "en katalog på `.tmp`-namnets plats" går inte längre att
  köra, eftersom temporärnamnet innehåller ett UUID som testet inte kan
  förutsäga. Det ersätts av raderna ovan och är därmed avhandlat, inte
  bortglömt. Går en rad inte att provocera i den här miljön lämnas paketet
  tillbaka till arkitekten med körningen som underlag — raden får varken byggas
  utan testfall eller tas bort utan beslut. Följer av `LARDOMAR.md` (2026-09-02,
  saveEntries kastar råa engelska OS-fel).
- **Paket 4: `getDataFilePath` testas på tomma och blanka värden.**
  `HEMOCHEKONOMI_DATA_FILE` osatt
  (`delete process.env.HEMOCHEKONOMI_DATA_FILE`), `''` och `'   '` (tre
  blanksteg) ska alla ge standardsökvägen under `%APPDATA%`, och en sökväg med
  ett inledande blanksteg ska returneras ordagrant med blanksteget kvar. Testet
  återställer miljövariabeln efteråt.
- **Mutationskravet gäller `src/server/storage.js` i paket 4 på samma sätt som
  `src/core/`.** Varje rad 1–7 i "Beteende vid skrivning", det unika
  temporärnamnet, löfteskedjan i både `saveEntries` och `loadEntries` samt
  `finally`-städningen tas bort en i taget; `npm test` ska ge minst ett
  fallerande test och exit 1 för var och en. Byggaren räknar upp villkoren
  skriftligt och visar en körning per villkor. Ingen rad i skrivtabellen är
  undantagen — rad 3 och rad 7 har sina `Proxy`-fall just därför. **Pekar den
  här filen ut vilket test som ska falla för en viss mutation är resultatet inte
  godkänt förrän namnet på det fallerande testet har jämförts med det utpekade
  testet:** klistra in raden som börjar med kryss (`✖`). Faller bara andra tester
  räknas mutationen som överlevd, oavsett exitkod.
- **Mutationstabellernas kolumn kräver att punktens egen kryssrad står i
  utfallet, inte att den står ensam där.** Kolumnen hette tidigare "Mutationen det
  ensamt fäller", och den lydelsen är ett påstående om varje rad i tabellen.
  Ett sådant påstående åldras, och mekanismen är värd att skriva ut: **ett nytt
  testfall kan göra en äldre rads ensamhet falsk utan att någon rör raden.** Det
  inträffade när punkt (27) skrevs — den renderar kortet Kommande dragningar två
  gånger med en lista som inte är tom, alltså samma form som fäller varje mutation
  i `renderUpcoming` som lämnar gamla rader kvar eller läser fel fält. Granskarens
  körning av varje rad i samtliga tabeller: (24) gav `fail 2` och (26) gav
  `fail 2`, där den andra kryssraden i båda fallen är (27); (30) gav `fail 8`, av
  det skäl noten till den raden skriver ut; (33) gav `fail 2`; övriga rader gav
  `fail 1`. Talen är granskarens från den rundan och är skrivna i dåtid med flit:
  de ändras så snart en punkt får ett testfall till, och det är just därför
  kolumnen inte längre påstår något om dem. Kolumnen lyder därför
  `Mutation som ska ge EXIT=1 med punktens egen kryssrad i utfallet` i samtliga
  tabeller. Kravet är avgörbart rad för rad, och det blir inte falskt av att ett
  testfall tillkommer.

  Ensamheten är inte längre ett krav, men den är fortfarande en upplysning, och
  den hämtas ur redovisningen: **byggaren skriver ut vilka testfall som faller för
  varje mutation.** Faller fler än punktens eget är frågan om punkten ändå är värd
  sin plats, och svaret är vad kryssraden säger — en punkt vars rad namnger
  orsaken behålls även när äldre fall faller med, därför att de äldre
  kryssraderna pekar ut något annat. Noten för punkt (30) är exemplet, och den
  formen används för varje rad där det gäller.

  **När en tabell ska köras om:** skrivs ett nytt testfall som renderar samma vy
  eller anropar samma funktion som en befintlig punkt, körs varje mutationstabell
  som rör den vyn eller funktionen om, rad för rad, med antalet fallerande
  testfall utskrivet per rad. Ett skäl att inte köra om räknas aldrig som en
  körning (`LARDOMAR.md`, 2026-09-22, "deras rader är äkta ensamma fällare"
  skrevs om fem tabeller utan att någon av dem kördes om).

  **En facittabell som gör flera utfall bindande ska ha en mutationsrad per rad i
  facit, inte en per testfall paketet råkar skriva.** De två formerna ser lika ut
  när paketet skrivs och skiljer sig först i efterhand: en lista som följer
  testfallen växer med det som byggdes, medan en lista som följer facit visar vad
  som **inte** byggdes. Skillnaden är mätt i det här projektet. Facit för vyn
  efter en borttagning har en rad per statuskod; mutationslistan fick en rad per
  nytt testfall, och de två rader som säger att vyn ska stå **oförändrad** blev
  skrivna utan skydd — mutationen "hämta om vid varje misslyckat svar" gav hela
  sviten `fail 0` och `EXIT=0` (granskarens körning, `LARDOMAR.md` 2026-09-23).
  **En rad som säger att något ska stå oförändrat behöver ett test lika mycket
  som en rad som säger att något ska ändras**, och den är bara svårare att komma
  ihåg, eftersom ingenting syns när den håller. Formen som gör den prövbar står
  under "Vyn efter en borttagning": räkna anropen som inte ska ske, och låt det
  anrop mutationen inför förstöra vyn, så att kryssraden pekar ut vad användaren
  förlorar. Kontrollen innan ett paket lämnas vidare är mekanisk: för varje
  facittabell paketet inför eller ändrar, para ihop varje rad med den punkt som
  skyddar den och skriv ut paren — en rad utan punkt stoppar paketet.
- **Validering ska ha egna tester.** Följer av `LARDOMAR.md`. Ett paket som tar
  emot användarinput utan testad validering är inte klart.
- **Fält som kan komma i flera typer testas i alla typer.** Varje rad i
  `amountSek`-facittabellen ovan ska köras både som sträng och som tal och ge
  identisk `message`. Ett fält som bara testas i en ingångstyp räknas som
  otestat.
- **Toleransjämförelser testas på båda sidor om sin gräns.** För `amountSek`
  gäller det paret `1e-8` (regel 3) och `9.9e-9` (regel 4), i båda
  ingångstyperna. Invarianten "allt som `createEntry` returnerar med `ok: true`
  godkänns av `isEntry`" ska köras med värden från just de gränserna, inte bara
  med typiska belopp. Följer av `LARDOMAR.md` (2026-08-19, belopp under
  decimaltoleransen).
- **Injicerade funktioner testas med trasiga värden.** `makeId` som ger `42`,
  `''` respektive `'   '` ska ge `ok: false` enligt avsnittet "Interna fel i
  `createEntry`". Invarianten "allt som `createEntry` returnerar med `ok: true`
  godkänns av `isEntry`" ska finnas som eget test.
- **Villkor med en ägare testas på ägaren.** `isValidEntryId` ska ha egna
  testfall (`'abc'`, `'   '`, `''`, `42`, `null` → förväntat `true`/`false`
  enligt "Vad som är ett giltigt `id`"), och samma värden ska ge samma svar
  genom `createEntry` och `isEntry`. Ett test som bara går via en av de två
  vägarna kan inte upptäcka att villkoret skrivits av för hand på det andra
  stället.
- **`-0` står i testlistan för varje exporterad funktion i `src/core/` som tar
  eller returnerar ett tal**, tillsammans med `NaN`, `Infinity`, `-Infinity`, en
  sträng, `null`, `1n` och `Symbol('x')`. `-0` asserteras alltid med
  `assert.equal(Object.is(resultat, -0), false)`, aldrig med
  `assert.equal(resultat, 0)` — det senare är sant också för `-0` och kan därför
  aldrig falla. Obligatoriskt i paket 3: `sekToOre` med `-0`, `-0.001`, `-0.004`
  och `-1e-9`; `oreToSek` och `formatSek` med `-0`; `canonicalAmountSek` med
  `-0` och `-1e-9`; `yearlyOre` och `monthlyOre` med `amountSek: -0`, `-0.001`
  och `-0.004` (ska ge `0`) och med `-0.01` (ska kasta); `isEntry` med
  `amountSek: -0` (ska ge `false`); `validateEntryDraft` med `-0`, `'-0'` och
  `'-0,00'`. Följer av `LARDOMAR.md` (2026-09-02, `-0` tar sig genom alla tre
  spärrarna).
- **Frysta konstanter testas.** För `ENTRY_FIELDS` i paket 2:
  `assert.throws(() => ENTRY_FIELDS.push('x'), TypeError)` följt av att listan
  är oförändrad. Samma mönster för `INTERVALS`, `CATEGORIES`,
  `INTERVAL_LABELS` och `CATEGORY_LABELS` i paket 2 och för
  `PAYMENTS_PER_YEAR` respektive `MONTHS_PER_PERIOD` i paket 3 och 7.
- **Varje spärr i `src/core/` verifieras med mutation innan paketet lämnas
  vidare.** En spärr är ett villkor som kan få en funktion att returnera `false`
  eller ett fel. Metod: ta bort villkoret, kör `npm test`, kräv minst ett
  fallerande test och exit 1, återställ. Kravet gäller varje **delvillkor** för
  sig och inte bara hela `if`-satsen — det var ett delvillkor som överlevde i
  `isEntry`. Överlever ett villkor mutationen ska antingen ett test skrivas som
  bara det villkoret kan få att fälla avgörandet, eller villkoret tas bort.
  Utdatan från körningarna klistras in i paketets redovisning. Ett paket
  mutationstestar de spärrar det självt lägger till eller ändrar, inte hela
  projektet på nytt. Följer av `LARDOMAR.md` (2026-08-23, kontrollen av antalet
  fält i `isEntry` skyddas inte av något test).
- **En testkommentar får inte namnge vilken kontroll som fångar ett fall förrän
  mutationen har visat att det stämmer.** Kommentaren "ett saknat fält är också
  fel antal fält" var osann: fallet passerade via en annan kodväg än den som
  namngavs, och kommentaren fick raden att se skyddad ut.
- **Undantag: rena snabbvägar mutationstestas inte — de mäts.** Ett villkor som
  bara påverkar arbetsmängden och aldrig svaret, som steg 3 i `checkName`, kan
  per definition inte fällas av ett funktionellt test. Ett sådant villkor ska
  vara märkt som snabbväg i koden, ha ett testfall med minst 1 000 000 tecken
  indata som ger rätt felmeddelande, och en uppmätt körtid i paketets
  redovisning. Det får inte tas bort med hänvisning till mutationskravet, och
  inget annat villkor får kallas snabbväg utan att det står i den här filen att
  det är en.
- **Inget test asserterar på körtid.** Determinismkravet ovan gäller även
  maskinens hastighet: ett test som kräver "under N millisekunder" går sönder på
  en långsam maskin, och ett trasigt test är inget fynd. Prestandakrav visas med
  en redovisad mätning, inte med en assertion. Undantagen är uppräknade nedan,
  vart och ett med sitt skäl. Inget annat villkor får åberopa något av dem, och
  varje ny hängningsspärr kräver en egen rad i tabellen — med syfte, konstantens
  namn och skälet till att spärren inte kan påverka utfallet av ett prov som blir
  av. Kontrollen körs innan en testfil lämnas vidare:
  `grep -n "setTimeout\|AbortSignal.timeout\|Promise.race\|performance.now"
  tests/<fil>`, och varje träff ska ha en rad här.

  **Undantag 1 — det enda villkor vars utfall beror på tid.** Räknarvillkoret i
  atomicitetstestets punkt 4, motiverat i punkt 7. Det står ensamt och får inte
  åberopas av något annat test.

  **Undantag 2 — hängningsspärrar.** Alla är samma konstruktion av samma skäl: de
  mäter ingenting och kan inte påverka utfallet av ett prov som blir av. De avgör
  bara att en väntan som annars vore oändlig ger ett fallerat test i stället för
  en körning utan exitkod, vilket `CLAUDE.md`:s krav på att kontrollera
  utgångskoden annars gör omöjligt att uppfylla. **Varje hängningsspärr skrivs som
  en namngiven konstant i sin testfil, aldrig som en literal, och på minst
  30 000 ms** — gränsen är satt så högt just för att en långsam maskin inte ska
  kunna göra spärren till ett falskt fel. Ett högre värde är alltid tillåtet, ett
  lägre inte. Tre namn finns, ett per roll:

  Raden för `tests/storage.test.js` har en avvikelse som punkt 8 äger: där
  fäller spärren inte ensam utan utlöser en omtagning av den kasserade
  uppsättningen, och det är takräknaren `MAX_CHILD_START_RETRIES` som avgör när
  en väntan blir ett fallerat test. Avvikelsen gäller bara den raden. Taket är
  en räknare och ingen tid: det träffas inte av kontrollen ovan, det kan inte
  påverka utfallet av ett prov som blev av, och det får därför ingen egen rad i
  tabellen.

  | Testfil | Konstant | Väntan spärren bryter | Villkoret den skyddar |
  |---------|----------|-----------------------|-----------------------|
  | `tests/storage.test.js` | `CHILD_START_TIMEOUT_MS` | Barnets `startar`-meddelande, atomicitetstestets punkt 8 | Ett barn som varken skickar `startar`, avslutas eller kastar: en fork som hänger. Ett barn som *dör* — felstavad sökväg, syntaxfel, kastande import — fångas av `exit`-grenen och fäller testet omedelbart, utan att spärren behövs |
  | `tests/server.test.js` | `CHILD_START_TIMEOUT_MS` | Barnets utskrivna rad i autostartfallet, punkt 4 under "Paket 5" | Ett barn som avslutas utan att skriva sin rad |
  | `tests/server.test.js` | `CHILD_START_TIMEOUT_MS` | Barnets `exit` i autostartens felgren, punkt 5 under "Paket 5" | `try`/`catch` runt `start()` i autostarten, som skriver felet och sätter `process.exitCode = 1`: ett barn som i stället fortsätter lyssna avslutas aldrig |
  | `tests/lock.test.js` | `CHILD_START_TIMEOUT_MS` | Barnets utskrivna rad, fall 1–3 under "Paket 5: två instanser mot samma datafil" och fall 7 under "Paket 5: två `start()` i samma process" | Ett barn som avslutas utan att skriva sin rad, t.ex. för att låset felaktigt blockerade det |
  | `tests/lock.test.js` | `CHILD_START_TIMEOUT_MS` | Instans tvås `exit`, fall 1 och 4 under samma punkt, och barnets `exit` i fall 5 och 7 | `acquireDataFileLock` i `start`: ett barn som i stället startar fortsätter lyssna och avslutas aldrig |
  | `tests/lock.test.js` | `RESPONSE_TIMEOUT_MS` | Svaret på `GET /api/entries` och `POST /api/entries`, mot ett barn eller mot en server i testprocessen | Att instans ett lever vidare: en instans som dött svarar aldrig |
  | `tests/api.test.js` | `RESPONSE_TIMEOUT_MS` | `handleApiRequest` som aldrig fullbordar sitt löfte | Lyssnaren på `'error'` i `readBody`: utan den svarar ett avbrutet anrop aldrig |
  | `tests/server.test.js` | `RESPONSE_TIMEOUT_MS` | Ett svar som aldrig kommer på sockeln, och `start()` som aldrig fullbordar sitt löfte | `try`/`catch` och `.catch(...)` runt hanteraranropet i `createServer` och `once('error', reject)` i `start` — utan dem kommer inget svar respektive inget avslut |
  | `tests/lock.test.js` | `LOCK_RELEASE_TIMEOUT_MS` | Väntan på att låsfilen försvinner efter `server.close()` | `server.once('close', …)` i `start`: utan den släpps låset aldrig, och väntan på filen vore oändlig |

  Raden för `LOCK_RELEASE_TIMEOUT_MS` är en tredje roll, inte en tredje sort:
  väntan pekar på en **fil** i stället för på ett meddelande eller ett svar,
  eftersom släppandet i `close`-hanteraren är ett löfte ingen anropare kan
  invänta. Den fick ett eget namn av samma skäl som de två andra har var sitt —
  ett namn per roll gör det synligt när en väntan byter innebörd. Konstanten
  fanns i testfilen utan rad här; raden skrevs in efter granskarens fynd, av
  samma slag som `LARDOMAR.md` (2026-09-07, en fjärde hängningsspärr byggdes utan
  den rad ARKITEKTUR.md kräver för den).

  Raden i `tests/api.test.js` fanns som en literal `5000` utan rad här; den
  skrevs in i paket 5 efter granskarens fynd, och konstanten ersätter literalen.
  Ett anrop i samma process som svarar, svarar på millisekunder, så 30 000 ms kan
  inte göra ett prov som blir av till ett falskt fel. Priset står utskrivet i stället för att döljas: en mutationskörning där
  spärren fäller testet tar 30 sekunder innan den ger exit 1, och det är billigare
  än en körning utan exitkod.
- **Kanonisk lagringsform testas separat från regelkedjan.** `isEntry` ska
  underkänna `amountSek: 199.999999999` och `199.000000001` och godkänna `0.01`,
  `199.5` och `9999999.99`. Fixpunktskörningen för `canonicalAmountSek` som
  krävs under "Kanonisk lagringsform" lämnas kvar som testfall. Följer av
  `LARDOMAR.md` (2026-08-23, `isEntry` godkänner belopp som appen räknar om till
  ett annat tal).
- **Kontrollera alltid utgångskoden, inte bara utskriften.** `node --test` kan
  skriva ut rader som ser ut som testresultat och ändå avsluta med `EXIT=1`.
  Ett paket är inte klart förrän `npm test` ger `fail 0` och exit 0.

---

## Gränssnitt

Alla exporter är namngivna (`export function …`). Ingen `export default`.

**Varje modul och varje export är märkt med sitt paket.** Rubriken bär paketet
när hela modulen byggs i ett svep; `dates.js` och `storage.js` är märkta per
export eftersom de byggs i två omgångar. En export vars paket inte är påbörjat ska **inte** finnas
i koden — att den saknas är avsiktligt och ingen lucka. När den byggs får den
testfall i `tests/<modul>.test.js` i samma paket, utan undantag.

### `src/core/money.js` [paket 3]

```js
export const ORE_PER_SEK;                                  // 100
export function normalizeZero(value: number): number;      // Object.is(value, -0) ? 0 : value — enda ägaren till villkoret "detta är -0"
export function sekToOre(amountSek: number): number;       // heltal öre; RangeError om ej finit; returvärdet går genom normalizeZero
export function oreToSek(ore: number): number;             // endast för visning; RangeError om ej säkert heltal; returvärdet går genom normalizeZero
export function divideRoundHalfUp(numerator: number, denominator: number): number;
export function formatSek(ore: number): string;            // "1\u00a0234,50\u00a0kr"
```

`formatSek(123450)` ger kodpunkterna `U+0031 U+00A0 U+0032 U+0033 U+0034 U+002C
U+0035 U+0030 U+00A0 U+006B U+0072` — avläst ur en körning på Node v24.19.0 och
dokumenterad i `tests/money.test.js`. Varje jämförelse mot `formatSek`, i kod
eller i test, skrivs därför med escapen `\u00a0`, aldrig med ett
vanligt mellanslag: `formatSek(123450) === '1 234,50 kr'` med U+0020 är
`false`. Det gäller även paket 6.

Samma sak gäller minustecknet: `Intl` ger U+2212 (MINUS SIGN), inte
bindestrecket U+002D. `formatSek(-0)` gav kodpunkterna `U+2212 U+0030 U+002C
U+0030 U+0030 U+00A0 U+006B U+0072`, alltså `"\u22120,00\u00a0kr"`, i
granskarens körning på samma Node-version. Varje negativ `formatSek`-sträng som
skrivs i den här filen, i koden eller i ett test skrivs därför med escapen
`\u2212`, aldrig med ett bindestreck. Efter beslutet under "`-0` normaliseras
till `0`" ska `formatSek(-0)` ge samma sträng som `formatSek(0)`; ett
minustecken kan alltså bara uppstå för ett verkligt negativt öretal.

Ingångsspärrarna och deras exakta meddelanden står under "Avrundningsregel" och
upprepas inte här. Hela modulen byggs i paket 3 med `tests/money.test.js`, som
minst innehåller kontrollvärdena i "Avrundningsregel". Paket 2 byggdes utan
`money.js`. Från och med paket 3 importerar `cost.js` `sekToOre` och
`divideRoundHalfUp` härifrån, och `entry.js` importerar `ORE_PER_SEK` och
`normalizeZero` och ingenting annat; skälen står under "Vad `entry.js`
importerar från `money.js`" och upprepas inte här.

### `src/core/dates.js`

De fyra första exporterna byggdes i paket 2 därför att `startDate`-valideringen
kräver dem. De fem sista fick sin första användare i paket 7 och byggdes där.

```js
export const ISO_DATE_PATTERN;   // [paket 2] /^\d{4}-\d{2}-\d{2}$/ — enda definitionen i projektet

export function isValidIsoDate(value: unknown): boolean;                                 // [paket 2] format + kalender
export function parseIsoDate(value: string): { year: number, month: number, day: number } | null;  // [paket 2]
export function daysInMonth(year: number, month: number): number;                        // [paket 2] month 1-12

export function toIsoDate(parts: { year: number, month: number, day: number }): string;  // [paket 7] nollutfyllt
export function addMonthsClamped(isoDate: string, months: number): string;               // [paket 7] klampningsregeln
export function compareIsoDates(a: string, b: string): number;                           // [paket 7] -1 | 0 | 1
export function daysBetween(fromIso: string, toIso: string): number;                     // [paket 7] heltal, kan vara negativt
export function todayIso(now = new Date()): string;                                      // [paket 7] lokalt datum; enda klockläsningen
```

`ISO_DATE_PATTERN` ägs av `dates.js` och importeras av `entry.js`. Ingen annan
modul får skriva mönstret på nytt. `isValidIsoDate` är den kompletta kontrollen
(format **och** kalender); `ISO_DATE_PATTERN` exporteras separat därför att
`entry.js` behöver skilja på "fel format" och "obefintligt datum" för att kunna
ge två olika felmeddelanden.

Modulen byggdes alltså i två omgångar, och båda halvorna är byggda. Kontrollen
står utan antal: en sökning efter `^export (function|const)` i
`src/core/dates.js` ger samtliga namn i blocket ovan, och var och en av de fem
som tillkom i paket 7 — `toIsoDate`, `addMonthsClamped`, `compareIsoDates`,
`daysBetween` och `todayIso` — ger minst en träff på
`grep -n "<namn>" tests/dates.test.js`. Inget tal skrivs ned här, och det är
avsiktligt: ordet "träffar" betyder olika saker för `grep -c` (antal rader med
minst en förekomst) och för `grep -o` rörledd till `wc -l` (antal förekomster),
och de två ger olika svar för `addMonthsClamped` och `todayIso`, eftersom två
rader i filen bär namnet två gånger. Den tidigare lydelsen på den här platsen
angav fem tal i prosa utan sitt kommando och var därmed fel för två av dem
(`LARDOMAR.md` 2026-09-14). Ett påstående utan siffra blir dessutom inte falskt
av nästa tillägg.
`tests/dates.test.js` fanns sedan paket 2 och täckte de fyra första exporterna
(inklusive `daysInMonth(2000, 2)` och ogiltiga månadsnummer); i paket 7 utökades
samma fil med testfall för de fem tillkommande — `addMonthsClamped` mot
facittabellen i "Härledning av nästa dragningsdatum", `compareIsoDates` och
`daysBetween` med både positiv och negativ riktning, `toIsoDate` med
nollutfyllnad, och `todayIso` med ett inskickat `now` så att testet inte läser
klockan.

### `src/core/entry.js` [paket 2]

```js
import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate } from './dates.js';  // inget eget datummönster
import { ORE_PER_SEK, normalizeZero } from './money.js';                      // [paket 3] konstanten och normalizeZero — inget annat

export const INTERVALS;          // ['monthly', 'quarterly', 'semiannual', 'yearly'] — 'semiannual' [etapp 1]
export const INTERVAL_LABELS;    // { monthly: 'Månadsvis', ..., semiannual: 'Halvårsvis' } — [etapp 1] för semiannual
export const CATEGORIES;         // ['housing', 'subscription', 'insurance', 'transport', 'loan', 'other']
export const CATEGORY_LABELS;    // { housing: 'Boende', ... }
export const ENTRY_FIELDS;       // ['amountSek', 'category', 'id', 'interval', 'name', 'startDate'] (sorterad)
export const NAME_MAX_LENGTH;    // 60
export const AMOUNT_MAX_SEK;     // 9999999.99
export const AMOUNT_PATTERN;     // /^-?\d{1,15}([.,]\d{1,15})?$/
// [paket 8] Avgör bara vilken av steg 1:s två texter som gäller, aldrig om ett värde är giltigt.
export const AMOUNT_HINT_PATTERN;    // /^-?[\d.,\u0020\u00a0]*\d[\d.,\u0020\u00a0]*(?:kr)?$/i
export const AMOUNT_HINT_MAX_LENGTH; // 40
export const MIN_YEAR;           // 1970
export const MAX_YEAR;           // 2099

// FieldError       = { field: string, message: string }
// ValidationResult = { ok: true, value: Entry } | { ok: false, errors: FieldError[] }

export function validateEntryDraft(draft: unknown): ValidationResult;   // value saknar id
export function createEntry(draft: unknown, makeId = () => crypto.randomUUID()): ValidationResult;  // value har id
export function isValidEntryId(value: unknown): boolean;                // enda definitionen av id-villkoret
export function canonicalAmountSek(amountSek: number): number;          // normalizeZero(Math.round(v * 100) / 100) — enda definitionen
export function isEntry(value: unknown): boolean;                       // används av storage vid inläsning
export function isPlainObject(value: unknown): boolean;                 // [paket 3] enda definitionen av "vanligt objekt"
```

De fem sammansatta konstanterna (`INTERVALS`, `INTERVAL_LABELS`, `CATEGORIES`,
`CATEGORY_LABELS`, `ENTRY_FIELDS`) fryses med `Object.freeze` enligt regeln
under "Mappstruktur". `ENTRY_FIELDS` är den viktigaste: den avgör vilka fält
`isEntry` godkänner, och en importör som muterar den flyttar datamodellens
gräns för hela processen.

`validateEntryDraft` normaliserar vid `ok: true`: `name` trimmas, och
`amountSek` blir ett `number` med högst två decimaler
(`Math.round(v * 100) / 100`, se steg 2 ovan). `createEntry` anropar
`validateEntryDraft`, kontrollerar därefter `makeId()` med `isValidEntryId`
enligt avsnittet "Interna fel i `createEntry`", och lägger till `id`. `makeId`
är injicerbar enbart för att tester ska kunna ge förutsägbara id:n.

`isEntry` kontrollerar, i den ordningen:

1. att värdet är ett vanligt objekt (inte `null`, inte en array),
2. att fältuppsättningen är exakt `ENTRY_FIELDS` — ett enda odelbart villkor,
   se "Fältkontrollen i `isEntry`" nedan,
3. att `id` godkänns av **`isValidEntryId`**,
4. att `name` är en sträng och redan är sin kanoniska form
   (`value.name === value.name.trim()`),
5. att `amountSek` är ett `number` och redan är sin kanoniska form
   (`value.amountSek === canonicalAmountSek(value.amountSek)`),
6. att de fem fälten utom `id` godkänns av **`validateEntryDraft`** — alltså av
   exakt samma regelkedja som `createEntry` kör, inklusive `amountSek`-regel 4.

Steg 3 och 6 är anrop, inte egna formuleringar. `isEntry` frågar samma
funktioner som `createEntry` frågar, och det är det som garanterar invarianten
"allt som `createEntry` returnerar med `ok: true` godkänns av `isEntry`". Att
kedjan ärvs i stället för att räknas upp på nytt är bindande, och det är regel 4
som gör skillnaden synlig: en datafil med `amountSek: 1e-15` avvisas därför att
`Math.round(v * 100)` är `0`, och `storage.js` svarar med
`Datafilen innehåller en ogiltig post: <sökväg>` i stället för att läsa in en
post som bryter mot "> 0". Skrevs reglerna av för hand här skulle den spärren
tyst kunna glida isär från `validateEntryDraft`.

Steg 4 och 5 är **inte** ett undantag från den regeln utan svaret på en fråga
kedjan inte ställer: kedjan avgör om ett värde är godtagbart som indata, steg
4–5 avgör om det redan är den form skrivvägen producerar. Motiveringen, ägaren
till uttrycken, fixpunktskravet och de obligatoriska testfallen står under
"Kanonisk lagringsform" och upprepas inte här. Utöver steg 4–5 ställer `isEntry`
inga andra krav än kedjan.

**`amountSek: -0` i en datafil — bindande svar.** `isEntry` ger `false`, och
avvisningen sker i **steg 6**: regelkedjans regel 1 (`v <= 0`) är sann för `-0`
och ger `Beloppet måste vara större än 0 kr.` genom `validateEntryDraft`. Steg 5
kan per konstruktion inte avgöra frågan — `canonicalAmountSek(-0)` är `0` och
`-0 === 0` är `true`, så likhetsjämförelsen passerar. Steg 5 får därför **inte**
skrivas om till `Object.is` för att fånga `-0`: villkoret "detta är `-0`" har en
ägare, `normalizeZero`, och svaret `false` är redan entydigt utan en andra kopia
av villkoret. `-0` ska stå kvar i värdelistan i testet "isEntry avvisar belopp
som avrundas till noll öre i datafilen" i `tests/entry.test.js`, och `isEntry`
får aldrig kasta för det.

#### Fältkontrollen i `isEntry`

Fältuppsättningen prövas med **ett** villkor, inte med två:

```js
JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(ENTRY_FIELDS)
```

Villkoret fångar saknade fält, extra fält och felstavade fält i ett svep.
`JSON.stringify` används i stället för `join` därför att `join` gör jämförelsen
beroende av att inget fältnamn innehåller avgränsartecknet: en post med det enda
fältet `amountSek,category` ger samma sträng som två riktiga fält, medan
`JSON.stringify` escapar citattecknen och håller isär fallen.

Skälet till att det ska vara **ett** villkor och inte två är mutationskravet i
"Teststrategi". Ett separat `keys.length !== ENTRY_FIELDS.length` går inte att
skydda med något test: den enda postform som bara den raden fångar är en post
vars sorterade fältlista är ett äkta prefix av `ENTRY_FIELDS`, och en sådan post
saknar minst ett fält och avvisas ändå av `isValidEntryId` eller
`validateEntryDraft`. En rad som inget test kan få att fälla avgörandet är död
kod, och död kod i en spärr är värre än ingen kod alls: den ser ut att skydda
något den inte skyddar (`LARDOMAR.md`, 2026-08-23, kontrollen av antalet fält i
`isEntry` skyddas inte av något test).

Villkoret ovan är däremot mutationsbart: tas hela `if`-satsen bort ska minst ett
test falla och `npm test` avsluta med exit 1. Det testet finns redan i form av
posten med ett extra fält.

### `src/core/cost.js` [paket 3]

```js
import { divideRoundHalfUp, sekToOre } from './money.js';
import { isPlainObject } from './entry.js';            // [paket 3] ägaren till "vanligt objekt"

export const PAYMENTS_PER_YEAR;                        // { monthly: 12, quarterly: 4, semiannual: 2, yearly: 1 } — fryst; semiannual [etapp 1]
export const MONTHS_PER_YEAR;                          // 12 — ägare till talet i rollen "månader per år"
export function yearlyOre(entry: Entry): number;
export function monthlyOre(entry: Entry): number;      // divideRoundHalfUp(yearlyOre(entry), MONTHS_PER_YEAR)
export function totalYearlyOre(entries: Entry[]): number;
export function totalMonthlyOre(entries: Entry[]): number;  // divideRoundHalfUp(totalYearlyOre(entries), MONTHS_PER_YEAR)
```

`MONTHS_PER_YEAR` fryses inte. `Object.freeze` på ett primitivt värde gör
ingenting, och en importerad ESM-bindning går ändå inte att skriva om.
Frysningskravet under "Mappstruktur" gäller de sammansatta konstanterna, alltså
`PAYMENTS_PER_YEAR`.

**Ingångsspärrar i `cost.js` — bindande.** `cost.js` kontrollerar det den egna
aritmetiken kräver, inte datamodellens gränser: att `amountSek` är `> 0`, har
högst två decimaler och ligger under `AMOUNT_MAX_SEK` ägs av `entry.js` och
prövas inte om här. Alla spärrar kastar `RangeError`, samma feltyp som
`money.js` använder.

`yearlyOre`-kedjan nedan är en numrerad tabell där **första träff vinner**: de
fem villkoren körs sekventiellt i en enda funktion. `totalYearlyOre` får ingen
sådan tabell utan skrivs som funktionens gång, eftersom dess villkor inte prövas
efter varandra utan varvat med `yearlyOre`-kedjan i en loop — en numrerad tabell
skulle där ge ett annat svar än koden (`LARDOMAR.md`, 2026-09-02,
`totalYearlyOre`-tabellen numrerar spärrarna i en ordning koden inte följer).

`yearlyOre(entry)`, med `amountOre = sekToOre(entry.amountSek)`:

| # | Villkor | Meddelande i `RangeError` |
|---|---------|---------------------------|
| 1 | `!isPlainObject(entry)` — ägarfunktionen i `entry.js`, se nedan | `yearlyOre kräver en post som objekt.` |
| 2 | `!Object.hasOwn(PAYMENTS_PER_YEAR, entry.interval)` | `` `yearlyOre kräver ett känt interval, fick "${String(entry.interval)}".` `` |
| 3 | `!Number.isFinite(entry.amountSek)` | `sekToOre kräver ett finit tal.` — ärvs från `sekToOre` och skrivs inte av här |
| 4 | `amountOre < 0` | `yearlyOre kräver ett belopp som inte är negativt.` |
| 5 | `!Number.isSafeInteger(amountOre * PAYMENTS_PER_YEAR[entry.interval])` | `yearlyOre kräver att årsbeloppet är ett säkert heltal.` |

**Spärr 1 har en ägarfunktion, inte en handskriven kopia.** `isPlainObject`
exporteras från `entry.js` (märkt `[paket 3]` i gränssnittsblocket) och
importeras av `cost.js`. Begreppet "vanligt objekt" — `typeof value === 'object'`
och inte `null` och inte en array — ägs av `entry.js`, som redan använder det i
`isEntry`. Beroendet är riktat och cykelfritt: `entry.js` importerar inte
`cost.js`, och `entry.js` importerar i sin tur bara `dates.js` och `money.js`.
`isPlainObject` får egna testfall i `tests/entry.test.js` i paket 3: `{}` och
`new Date()` ger `true`, medan `[]`, `[1]`, `null`, `undefined`, `'abc'`, `42`,
`true`, `Symbol('x')`, `100n` och `() => {}` ger `false`. `tests/cost.test.js`
lägger till `[]`, `[1]` och en array med de sex fälten påsatta bland de värden
som ska ge `yearlyOre kräver en post som objekt.` från alla fyra
postfunktionerna.

**Spärr 1 är inte `isEntry`.** `cost.js` prövar inte om argumentet är en giltig
post i datamodellens mening. `yearlyOre` kräver ett vanligt objekt med ett känt
`interval` och ett finit, icke-negativt `amountSek` — inget mer. Ett `Date` med
`interval: 'monthly'` och `amountSek: 100` är därför ett godkänt argument och
ger `120000` trots att `isEntry` avvisar det, och `yearlyOre(new Date())` ger
`` yearlyOre kräver ett känt interval, fick "undefined". `` Det är avsiktligt:
datamodellens gräns bevakas av `isEntry` när posten läses från disk (paket 4),
medan `cost.js` spärrar sin egen aritmetik. Att anropa `isEntry` här vore en
andra inläsningsspärr med en annan feltyp, och den skulle göra `yearlyOre`
beroende av hela regelkedjan för fält den inte räknar på.

Fyra saker i ordningen är bindande och inte utbytbara:

- **Intervallet prövas före beloppet.** En post med okänt intervall ska ge
  intervallmeddelandet oavsett vad beloppet innehåller. Det var det som fattades
  när `monthlyOre` svarade `divideRoundHalfUp kräver ett heltal som täljare.`
  för `interval: 'weekly'` — ett meddelande som pekade ut fel orsak.
- **Uppslaget görs med `Object.hasOwn`**, inte med `PAYMENTS_PER_YEAR[...]` och
  en sanningsprövning. Annars skulle `interval: 'constructor'` hitta något på
  prototypen, och `interval: 'weekly'` ge `undefined` rakt in i
  multiplikationen — alltså `NaN` i stället för ett fel.
- **Värdet skrivs in i meddelandet med `String(entry.interval)`**, aldrig genom
  att värdet läggs direkt i en mallsträng. `${Symbol('x')}` kastar `TypeError`,
  medan `String(Symbol('x'))` ger `'Symbol(x)'` (`LARDOMAR.md`, 2026-08-24).
- **`-0` kan inte nå hit, och `cost.js` har därför ingen egen `-0`-kontroll.**
  `amountOre` kommer från `sekToOre`, som normaliserar `-0` till `0` genom
  ägarfunktionen `normalizeZero`. En kontroll här vore både en handskriven kopia
  av ett villkor som har en ägare och död kod. Följden är facit och är
  avsiktlig: `yearlyOre({ amountSek: -0, interval: 'monthly' })` ger `0`, liksom
  `-0.001` och `-0.004`, medan `-0.01` ger
  `yearlyOre kräver ett belopp som inte är negativt.` — `-0` är samma tal som
  `0`, och ett belopp på exakt `0` är tillåtet här och ger `0`. Teckenspärren
  `amountOre < 0` står kvar därför att avrundningsregeln "halva öret uppåt" är
  definierad för icke-negativa täljare, inte för att `cost.js` skulle pröva om
  datamodellens `> 0`.

`monthlyOre(entry)` har **inga egna spärrar**. Den anropar `yearlyOre` och
`divideRoundHalfUp` och ärver deras, enligt regeln att ett villkor har en enda
ägarfunktion.

`totalYearlyOre(entries)` — ordningen skrivs som funktionens gång och inte som
en numrerad tabell, eftersom postprövningen sker i en loop:

```
if (!Array.isArray(entries))
    -> RangeError: totalYearlyOre kräver en lista med poster.
sum = 0
för varje entry i entries, i listans ordning:
    sum += yearlyOre(entry)        // yearlyOre-kedjan ovan äger felen här
efter loopen:
if (!Number.isSafeInteger(sum))
    -> RangeError: totalYearlyOre kräver att summan är ett säkert heltal.
return sum
```

**Varje posts eget fel vinner över summafelet.** Summan prövas först när alla
poster har passerat `yearlyOre`-kedjan. Två indata där mer än ett villkor är
sant samtidigt, med det vinnande meddelandet utskrivet. Båda ska stå som testfall
i paket 3, och båda ska köras med utdatan inklistrad i paketets redovisning:

| Indata | Vinnande meddelande |
|--------|---------------------|
| tre poster med `interval: 'yearly'` och `amountSek: 4e13`, följda av en post med `interval: 'weekly'` | `` yearlyOre kräver ett känt interval, fick "weekly". `` |
| samma tre poster utan den fjärde | `totalYearlyOre kräver att summan är ett säkert heltal.` |

**Summaspärren står efter loopen, inte inuti den.** Inuti loopen går den inte att
skydda med något test: `yearlyOre` returnerar aldrig ett negativt tal (spärr 4
ovan), addition av icke-negativa tal är monoton, och en delsumma som lämnat det
säkra området kan därför inte komma tillbaka in i det — kontrollen efter loopen
fäller exakt de listor en kontroll i loopen skulle ha fällt. Det enda den inre
placeringen ändrar är vilket meddelande som vinner när både en delsumma och en
senare post är trasiga, och det svaret är valt: postens fel vinner, eftersom det
pekar ut något som går att rätta i datafilen. Placeringen efter loopen är
mutationsbar åt båda hållen — tas raden bort faller testet på rad två i tabellen
ovan, och flyttas raden in i loopen faller testet på rad ett.

`Array.isArray` är bindande: utan den itererar `totalYearlyOre('abc')` över
strängens tecken. `totalMonthlyOre(entries)` har inga egna spärrar utan ärver
`totalYearlyOre`-kedjan och `divideRoundHalfUp`. Följden är facit och ska inte
byggas bort: `totalMonthlyOre('abc')` ger meddelandet
`totalYearlyOre kräver en lista med poster.` — meddelandet namnger den funktion
som **äger** villkoret, inte den som anropades.

`totalYearlyOre([])` och `totalMonthlyOre([])` ger `0`. `yearlyOre` och
`monthlyOre` tar en post och har inget tomlist-fall: `yearlyOre([])` och
`monthlyOre([])` kastar `RangeError` med `yearlyOre kräver en post som objekt.`,
eftersom en array inte är ett vanligt objekt (spärr 1 ovan). Det här stycket och
tabellerna ovan är filens enda facit för `cost.js` beteende; avsnittet
"Betalningsintervall och normalisering" pekar hit och upprepar det inte. Ingen
exporterad funktion i `cost.js` får returnera `NaN` för någon indata; den ska
kasta i stället.

Testet av summaspärren ska gå att köra på en sekund: tre poster med
`interval: 'yearly'` och `amountSek: 4e13` ger årsbelopp om `4e15` öre vardera,
alltså `8e15` efter två poster (ett säkert heltal) och `1.2e16` efter tre (inte
ett säkert heltal). En lista på tio miljoner poster ska inte skrivas som test.

### `src/core/schedule.js` [paket 7]

```js
export const MONTHS_PER_PERIOD;                        // { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 } — fryst; semiannual [etapp 1]
// addMonths är injicerbar enbart för att antalet steg ska gå att mäta, se "Steg 2 görs mätbart" nedan.
export function nextDueDate(entry: Entry, todayIsoDate: string, addMonths = addMonthsClamped): string;

// UpcomingItem = { entry: Entry, nextDueDate: string, daysUntil: number }
export function upcoming(entries: Entry[], todayIsoDate: string): UpcomingItem[];   // sorterad
// Jämföraren upcoming sorterar med. Exporterad för att (S5) ska kunna asserta svaret 0 för två lika items.
export function compareUpcoming(a: UpcomingItem, b: UpcomingItem): number;
```

Modulen har ingen export för "dagar kvar för en enskild post". Storheten finns
bara som fältet `daysUntil` i `UpcomingItem`, räknat med ägarfunktionen
`daysBetween` i `dates.js`. Skälet, och de två vägar som prövades och
förkastades, står i beslutsloggen.

`compareUpcoming` har en anropare i `src/`: `items.sort(compareUpcoming)` i
`upcoming`. Kontrollen `grep -rn "compareUpcoming" src/` ska därför ge både
definitionen och det anropet — ger den bara definitionen är exporten i det läge
`LARDOMAR.md` (2026-09-16) beskriver och ska avgöras på nytt. Exporten gör inte
jämföraren till en väg in i modulen för någon annan: `upcoming` bestämmer
ordningen, och ingen annan modul får anropa den.

`MONTHS_PER_PERIOD.yearly` skrivs som `12` och importerar **inte**
`MONTHS_PER_YEAR` från `cost.js`. Talen är lika, rollerna olika: tabellen svarar
på hur många månader en period omfattar, konstanten på hur många månader ett år
har. `schedule.js` importerar ingenting från `cost.js`.

`upcoming` **skickar inte vidare** `addMonths` och får inget eget tredje
argument. Parametern finns för att göra arbetet mätbart i den funktion kravet
gäller, och en genomsläppning skulle ge en spärr och ett testfall till utan att
skydda något nytt. `upcoming` anropar alltså `nextDueDate(entry, todayIsoDate)`
med två argument.

### `src/server/paths.js` [paket 4; `getLockFilePath` i paket 5]

```js
export function getDataFilePath(): string;             // läser HEMOCHEKONOMI_DATA_FILE vid varje anrop; tom sträng och bara blanktecken räknas som osatt
export function getLockFilePath(): string;             // [paket 5] getDataFilePath() + '.lock'
export function getWebDir(): string;
export function getCoreDir(): string;
```

Villkoret för när överstyrningen används, och regeln att värdet därefter
returneras ordagrant utan `trim()`, står under "Lagring" och skrivs inte av här
— ett facit per fråga. `getLockFilePath` läser sin sökväg genom
`getDataFilePath()` och aldrig ur miljövariabeln själv: två uppslag vore två
kopior av samma regel.

### `src/server/lock.js` [paket 5]

```js
export class DataFileLockError extends Error {}        // .message är svensk text; .cause satt när ett annat fel ligger bakom
export async function acquireDataFileLock(): Promise<string>;                      // returnerar låsfilens sökväg; kastar DataFileLockError för rad L1-L5
export async function releaseDataFileLock(lockPath: string | null): Promise<void>; // kastar aldrig; tar bort låsfilen bara om den bär den märkning sökvägen registrerades med
```

`releaseDataFileLock` har inget standardvärde för `lockPath`: `null`, `undefined`
och en sökväg modulen inte har en post för betyder alla "ingenting att släppa",
och anropet rör då inte disken. Ett andra släpp av samma sökväg är därmed
ofarligt, och ingen anropare kan säga "släpp det som råkar vara taget". "Rör inte
disken" är ett krav på **noll filoperationer** och inte på att låsfilen är
oförändrad — hur det prövas står under "Teststrategi", fall 12.

`acquireDataFileLock` avvisar med `DataFileLockError` för rad L1–L5, men inte för
varje tänkbart fel: `fs.unlink` och `försök 2`:s `fs.writeFile` har ingen egen
felhantering, och ett fel därifrån går ut rått. Skälet, mätningen bakom det och
vad användaren då får se står under "Låset på datafilen — en instans i taget" i
"Lagring" och skrivs inte av här.

Beroenden modulen får ha: `node:fs/promises`, `node:fs` (bara för den synkrona
`exit`-städningen), `node:path`, `randomUUID` från `node:crypto` samt
`getLockFilePath` **och** `getDataFilePath` från `./paths.js`. `getDataFilePath`
behövs därför att rad L1 och rad L5 namnger datafilen och inte låsfilen.
`randomUUID` är samma inbyggda funktion som teknikvalstabellen redan har en rad
för och ger inget nytt beroende. Vad funktionerna gör, i vilken ordning och med
vilka strängar står under "Låset på datafilen — en instans i taget" i "Lagring"
och skrivs inte om här. Modullokalt tillstånd: `heldLocks`, en `Map` från
låssökväg till den märkning processen skrev i den filen; `lockQueue`, initierad
till `Promise.resolve()`; och flaggan att `exit`-hanteraren är registrerad.
Modulen är den enda i `src/server/` som rör låsfilen; `storage.js` känner inte
till att den finns.

### `src/server/storage.js` [paket 4; `updateEntries` i paket 5]

```js
export const STORAGE_VERSION;                          // 1
export class StorageError extends Error {}             // .message är svensk text; .cause satt när ett annat fel ligger bakom
export async function loadEntries(): Promise<Entry[]>; // [] om filen saknas; ställs i ioQueue som saveEntries
export async function saveEntries(entries: Entry[]): Promise<void>;  // validerar före disken, köar, skriver atomärt
// [paket 5] Läs–ändra–skriv innanför en enda köplats. null från mutera betyder "skriv inte".
export async function updateEntries(mutera: (entries: Entry[]) => Entry[] | null): Promise<Entry[] | null>;
```

Modulen får i paket 4 exakt de fyra första exporterna, och i paket 5 tillkommer
`updateEntries` och ingenting annat. Vad den gör, i vilken ordning och med vilka
fel står under "Läs–ändra–skriv i ett steg" i "Lagring" och skrivs inte om här.
Temporärnamnet och löfteskedjan är
modullokala: ett test som vill veta att temporärfilen är städad läser katalogen
med `fs.readdir` i stället för att importera namnet och få en andra kopia av
regeln.

Beroenden modulen får ha: `node:fs/promises`, `node:path`, `randomUUID` från
`node:crypto`, `isEntry` och `isPlainObject` från `../core/entry.js` samt
`getDataFilePath` från `./paths.js`. `randomUUID` är samma inbyggda funktion som
teknikvalstabellen redan har en rad för och ger inget nytt beroende.

**När `saveEntries` får användas — bindande.** `saveEntries` skriver en **känd**
lista, alltså en lista som inte kommer ur en läsning av samma fil. Varje
läs-ändra-skriv går genom `updateEntries`, aldrig genom `loadEntries` följt av
`saveEntries`; skillnaden mellan de två är 20 tappade poster på 20 omgångar i
granskarens körning. Regeln gäller varje modul i `src/` och varje paket som
kommer, inte bara `api.js` och inte bara paket 5.

Mätt 2026-09-07 med `grep -rn "saveEntries" src/`: tio träffar, varav nio är
kommentarer och en är definitionen — exporten har alltså ingen anropare i
`src/`, och dess enda anropare är `tests/storage.test.js`. Att ta bort den
prövades och förkastades: `updateEntries` läser innan den skriver, så den kan
varken skriva över en fil som läsvägens tabell underkänner eller användas för
att sätta ett känt utgångsläge — ett test som skriver en skadad fil och därefter
vill lägga tillbaka en giltig lista skulle falla på läsvägen redan i sitt
arrange-steg. `saveEntries` är den enda vägen till "filen ska innehålla exakt
det här", och den vägen behövs. Exporten stannar därför, men regeln ovan får en
automatisk spärr i stället för att bara stå skriven: se "Paket 5: `api.js`
importerar inte `saveEntries`" i teststrategin.

`saveEntries` kastar bara `StorageError`. Vilken sträng varje fel ger, i vilken
ordning felen prövas och vad som gäller filen på disk står i "Beteende vid
skrivning" under "Lagring". Modullokalt tillstånd: `ioQueue`, initierad till
`Promise.resolve()`. Både `loadEntries` och `saveEntries` utökar den kedjan
synkront före sitt första `await`; skälet står under "Skrivvägen — namn, kö och
ordning".

### `src/server/api.js` [paket 5]

```js
// Returnerar true om anropet hanterades, false om det inte var en /api-väg.
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
export const UNPARSABLE_MESSAGE;   // 'Kunde inte tolka anropet.' — ägs här, importeras av server.js för rad S1
```

`UNPARSABLE_MESSAGE` är den enda av `api.js` strängar som en annan modul läser.
Den exporteras därför att `server.js` behöver exakt samma text för en
förfrågningsrad som inte går att tolka, och en handskriven kopia där vore en
andra text för samma sak. Övriga strängar i `api.js` stannar i modulen.

### `src/server/server.js` [paket 5]

```js
export function resolvePort(env = process.env): number;                             // portvalet, facit nedan
export function isDirectRun(argv1: string | undefined, moduleUrl: string): boolean;  // körs filen direkt?
export function createServer(handler = handleRequest): http.Server;                  // handler ska returnera ett löfte, se nedan
export async function start(port = resolvePort(process.env)): Promise<http.Server>;  // tar låset på datafilen först, binder porten sedan
export class ServerStartError extends Error {}                                       // .message är svensk text; .cause satt till originalfelet
export function asStartError(port: number, error: Error): ServerStartError;          // översätter ett listen-fel eller ett låsfel till svensk text, facit nedan
```

`start` gör tre saker i den här ordningen, allt innanför samma `try`, så att
invarianten nedan gäller varje fel som lämnar funktionen: den tar låset med
`acquireDataFileLock()` och behåller sökvägen i en lokal variabel som är `null`
tills låset är taget, den skapar servern med `createServer()`, och den binder
porten. Misslyckas något av de två senare stegen anropas
`releaseDataFileLock(<sökvägen>)` innan felet kastas vidare. Var det låset självt
som fällde starten är variabeln fortfarande `null`, och anropet gör då
ingenting — det är den enda vägen till "släpp ingenting", och `start` avgör den
med sin egen variabel i stället för att fråga låsmodulen vad som råkar vara
taget. Lyckas allt registreras `server.once('close', …)` som anropar
`releaseDataFileLock(<sökvägen>)`. Skälet till ordningen, låsets regler och dess
felsträngar står under "Låset på datafilen — en instans i taget" i "Lagring".

Filen startar servern automatiskt när den körs direkt (`npm start`) och aldrig
när den importeras. Villkoret är `isDirectRun(process.argv[1], import.meta.url)`,
och kroppen anropar `start()` utan argument. Lyckas det skriver den exakt en rad
till `stdout`:

```
Hemochekonomi kör på http://127.0.0.1:<port>
```

`<port>` är `server.address().port`, alltså den port som verkligen bands — inte
siffran `3000` skriven i strängen. Med `PORT` osatt är de två samma tal.
Misslyckas det skrivs ingenting till `stdout`; vad som då händer står under
"Beteende vid start" nedan.

#### Ett trasigt anrop får inte döda appen (bindande)

Kravet under "Lagring" — servern får aldrig krascha på ett trasigt **lager** —
gäller lika mycket ett trasigt **anrop**. Granskarens körning: förfrågningsraden
`GET http://[v1.x]/ HTTP/1.1` fick `new URL(req.url, …)` att kasta
`TypeError: Invalid URL` (`code: 'ERR_INVALID_URL'`), avvisningen blev ohanterad,
processen dog med `EXIT=1` och nästa anrop mot samma port gav `000`. Fem av sex
prövade rader gjorde detsamma. En `unhandledRejection`-lyssnare räknas inte som
lösning: den byter kraschen mot en evig hängning, och sockeln lämnas öppen.

Två spärrar, och de sitter på var sitt ställe därför att de svarar olika:

1. **Sökvägen läses innanför `try`/`catch`.** Går `req.url` inte att tolka mot
   basen `http://127.0.0.1` är det klientens förfrågan som är trasig, inte
   appen: svaret är `400` och hanteringen är slut. Ingen annan kod i filen körs
   för det anropet.
2. **Hanteraranropet ligger i `try`/`catch`, och dess löfte i `.catch(...)`.**
   `createServer` skriver

   ```js
   try {
     handler(req, res).catch((error) => sendUnexpectedError(res, error));
   } catch (error) {
     sendUnexpectedError(res, error);
   }
   ```

   och låter varken en avvisning eller ett kast nå `process`. De två
   konstruktionerna är inte en dubblering och ingen av dem kan ersätta den
   andra: `.catch(...)` når bara ett löfte som redan finns, medan ett synkront
   kast sker innan löftet finns och därför bara fångas av `try`/`catch`.
   Teststrategin kräver `500` för både `createServer(() => { throw … })` och
   `createServer(async () => { throw … })`, och de två konstruktionerna
   mutationsprövas var för sig. Spärren sitter här och inte inuti
   `handleRequest`, därför att den ska täcka **varje** väg: sökvägsläsningen,
   `handleApiRequest`, `serveStatic` och allt som tillkommer senare. En spärr
   inuti `handleRequest` hade behövt upprepas för varje ny gren, och det är
   precis den sortens andra kopia ägarregeln förbjuder.

| # | Situation | Svar |
|---|-----------|------|
| S1 | `new URL(req.url, "http://127.0.0.1")` kastar | `400 { "error": "Kunde inte tolka anropet." }` |
| S2 | Hanteraren kastar, avvisar eller returnerar något som inte är ett löfte, och `res.headersSent` är `false` | `500 { "error": "Ett oväntat fel inträffade. Försök igen." }` |
| S3 | Hanteraren kastar, avvisar eller returnerar något som inte är ett löfte, och `res.headersSent` är `true` | Inget skrivs. Svaret är redan påbörjat, och sockeln stängs med `res.destroy()`. |

Kropparna i rad S1 och S2 är `application/json; charset=utf-8` och har formen
`{ "error": "<svensk text>" }`, samma form som `/api/*`. Rad S3 skickar ingen
kropp alls, eftersom svaret redan är påbörjat. Skälet: rad S2 kan
inträffa på vilken väg som helst, `/api/*` inräknad, så ett annat svarsformat
här hade gett två format för samma svar. Det är också det enda undantaget från
meningen under "Statiska filer" om att JSON-formen gäller `/api/*` — undantaget
är dessa två rader och ingenting annat.

Rad S1 återanvänder `Kunde inte tolka anropet.`, som ägs av `api.js` och
exporteras därifrån som `UNPARSABLE_MESSAGE`. `server.js` importerar strängen
och skriver ingen egen kopia: texten
säger "anropet", inte "kroppen", och täcker därför båda fallen. En andra text
för samma sak är just det ägarregeln under "Mappstruktur" förbjuder.

Rad S2:s sträng är ny och ägs av `server.js`. Felets eget meddelande når aldrig
användaren — det kan vara engelsk OS-text eller innehålla en sökväg, precis som
skrivtabellens rad 7 finns för att hindra. Felet loggas inte heller: `src/`
skriver ingenting till `stderr` utom vid start (se nedan), och ett svar som
alltid kommer är hela hanteringen.

`sendUnexpectedError` är modullokal. `createServer` tar däremot `handler` som
argument med `handleRequest` som defaultvärde, av samma skäl som
`handleApiRequest` tar `pathname`: annars finns ingen indata som når rad S2 och
S3, och en gren ingen indata når är ingen spärr utan en osann uppgift om vad
koden hanterar. `start()` och autostarten anropar `createServer()` utan argument,
så produktionsvägen är oförändrad.

**`handler` ska returnera ett löfte.** `handleRequest` är `async`, och varje
hanterare ett test skickar in ska antingen vara `async` eller returnera
`Promise.resolve()` på sin icke-kastande väg. Kontraktet har ett utskrivet
utfall: returnerar `handler` något som inte är ett löfte kastar `.catch` ett
`TypeError` inne i samma `try`, och det felet besvaras som rad S2 — eller som
rad S3, om hanteraren redan hunnit skriva huvudena. Det är det avsedda
beteendet och lagas inte med en normalisering
(`Promise.resolve(handler(req, res)).catch(...)`): produktionsvägen har exakt en
hanterare och den är `async`, ett brutet kontrakt är ett fel i appen, och `500`
med svensk text är rätt svar på ett fel i appen — samma svar som varje annat
kast från en hanterare får. En normalisering hade dessutom tyst tagit emot en
andra sorts hanterare som ingen kod i projektet skickar in, alltså byggt för en
framtid som inte står i planen. Kontraktsbrottet ska ha ett eget testfall,
`createServer(() => undefined)`, se "Teststrategi". Att svaret blir rad S2 är
kört och bekräftat av både byggaren och granskaren i paket 5.

#### Beteende vid start

`start` väntar på `listen` **och** på serverns `error`-händelse i samma
`new Promise`: `server.once('error', reject)` sätts upp innan `server.listen`
anropas. `listen` rapporterar sitt fel som en händelse och inte som en
avvisning, så ett `await` utan den lyssnaren uppfylls aldrig och Node kastar
händelsen vidare — granskarens körning gav `node:events:487 throw er` följt av
`Error: listen EADDRINUSE: address already in use 127.0.0.1:3098` och sex rader
stackspår, alltså noll svenska ord från `npm start`.

Samma form som lästabellen och skrivtabellen: körordningen är tabellens ordning,
och första sanna raden vinner. `<port>` är **argumentet till `start`**, aldrig
`server.address()`, som är `null` när `listen` misslyckades.

| # | Situation | Resultat |
|---|-----------|----------|
| 0 | `error instanceof DataFileLockError` | `ServerStartError` med `error.message` **ordagrant** och `cause` satt till låsfelet. Ingen ny sträng: texten är redan svensk och redan användarens svar, och rad 3 skulle annars skriva över den med en mening om porten. |
| 1 | `error.code === 'EADDRINUSE'` | `ServerStartError`: `Port <port> är upptagen. Stäng programmet som använder porten, eller sätt PORT till ett annat portnummer och starta om Hemochekonomi.` |
| 2 | `error.code === 'EACCES'` | `ServerStartError`: `Port <port> gick inte att öppna: åtkomst nekades. Sätt PORT till ett annat portnummer.` |
| 3 | Något annat fel som lämnar `start` — från `listen`, eller från de två anrop i `acquireDataFileLock` som inte har egen felhantering | `ServerStartError`: `Servern kunde inte startas på port <port>.` |
| – | Inget fel | Löftet uppfylls med servern, som lyssnar på `127.0.0.1:<port>`. |

Rad 1:s text är omskriven i paket 5 och den gamla lydelsen är förbjuden. Den
löd `… Hemochekonomi kör troligen redan på http://127.0.0.1:<port>. Sätt PORT
till ett annat portnummer om du vill starta en till.` och bad alltså användaren
på svenska att göra just det som förstör hens data — två instanser mot samma
datafil, mätt till 20 tappade poster på 20 omgångar. Efter låset är "Hemochekonomi
kör redan" dessutom rad L1:s svar och inte den här radens: när porten är upptagen
och låset gick att ta är det något annat program som håller porten. Texten säger
därför inte längre vad som håller porten och lockar inte till en andra instans.

`cause` är satt till originalfelet på alla fyra raderna. `EACCES` får en egen rad
och inte den gemensamma därför att åtgärden är en annan än vid `EADDRINUSE`:
appen kör inte redan, utan porten är otillåten, och texten ska inte be
användaren leta efter ett fönster som inte finns. Vilka portnummer som ger
`EACCES` i den här miljön står inte utskrivet — det är ett påstående om
operativsystemet som ingen har kört.

**Invariant:** `start` avvisar alltid med `ServerStartError`, aldrig med ett rått
OS-fel, och `.message` innehåller aldrig engelsk text som
`address already in use`. Rad 3 finns för att göra invarianten sann även för ett
fel ingen har sett, och den gäller varje fel som lämnar `start` — inte bara
`listen`-händelsen. Hela kroppen ligger innanför spärren, precis som varje
`node:fs`-anrop ligger innanför `saveEntries` rad 7.

Översättningen ägs av `asStartError(port, error)`, som är exporterad. Skälet är
teststrategins: ett villkor med en ägare testas på ägaren, och rad 2 och 3 går
inte att provocera deterministiskt i den här miljön — med en exporterad funktion
provas de med ett påhittat fel (`{ code: 'EACCES' }`), medan rad 1 dessutom
provas på riktigt. Samma skäl som gjorde `canonicalAmountSek` och
`isValidEntryId` till exporter.

Autostarten fångar avvisningen, skriver `error.message` följt av `\n` till
`stderr` med `process.stderr.write` och sätter `process.exitCode = 1`. Inget
stackspår, ingen engelsk text och ingen rad till `stdout`. `process.stderr.write`
och inte `console.error`: `LARDOMAR.md` (2026-09-07, felsökningsutskrifter
lämnades kvar) gör `console.error` i `src/` till ett stoppkriterium i
diffgranskningen, och startfelet är appens svar till användaren, inte en
felsökningsutskrift. Raden med `console.log` för det lyckade fallet är oförändrad
och berörs inte av den kontrollen, som läser diffens rader.

Processen avslutas därefter med exitkod `1`: inget handtag är kvar när starten
misslyckats, vare sig felet kom från låset eller från `listen`. Byggarens
körning av `npm start` mot en upptagen port gav den koden, och granskaren
bekräftade den. Kravet har dessutom sedan paket 5 ett
automatiskt testfall — punkt 5 under "Paket 5" i teststrategin — som kräver
exitkod `1`, tomt `stdout` och exakt rad 1:s sträng följd av `\n` på `stderr`.

Efter ett lyckat `listen` sitter `once('error', reject)` kvar på ett redan
uppfyllt löfte, så ett senare `error` från servern sväljs i stället för att
kasta. Det är avsiktligt och följer kravet att servern aldrig får krascha; någon
`removeListener` ska inte läggas till.

**Facit för `resolvePort` — ett värde per rad.** `resolvePort` är uttrycket
`Number(env.PORT) || DEFAULT_PORT` och ingenting mer: ingen validering, ingen
trimning och inget nytt felmeddelande. Sökvägsfiltret är fortfarande den enda
validering av användarinput som `server.js` gör själv. `DEFAULT_PORT` är `3000`,
är modullokal och exporteras inte. Siffran har därmed en ägare och ska inte
skrivas som literal någon annanstans i `server.js`.

| `env.PORT` | `resolvePort(env)` |
|------------|--------------------|
| osatt (`undefined`) | `3000` |
| `''` | `3000` |
| `'   '` | `3000` |
| `'abc'` | `3000` |
| `'0'` | `3000` |
| `'8080'` | `8080` |

Varje rad är körd av byggaren i paket 5 och stämmer. Skulle uttrycket och
tabellen någon gång ge olika svar är uttrycket facit och tabellen det som
rättas.

Raden `'0'` står utskriven därför att den är skälet till att ett test inte kan
be om en ledig port via `PORT` — `0` är falskt, så `PORT=0` ger `3000`. Testerna
får sin port av kärnan i stället, med `listen(0, …)` respektive den sond som
beskrivs under "Teststrategi".

De två första exporterna finns för att portvalet och autostartvillkoret annars
inte går att pröva: båda nås bara via `start()` utan argument respektive via
att filen körs direkt, och ingen indata inifrån processen når dem utan att en
port bindas. Skälet i sin helhet står i beslutsloggen.

### HTTP-API [paket 5]

Avsnittet gäller `/api/*`. Varje svar med en kropp är
`application/json; charset=utf-8`, varje felsvar med en kropp har formen
`{ "error": "<svensk text>" }`, och valideringsfel har dessutom
`{ "fieldErrors": [{ "field": "...", "message": "..." }] }`. Två svar saknar
kropp och därmed båda formerna: `204` från `DELETE` här, och `404` från en okänd
statisk sökväg under "Statiska filer". De statiska filerna har sina egna
`Content-Type`, också de under "Statiska filer".

**Tabellen räknar upp varje statuskod respektive väg kan ge.** Kontrollen är
mekanisk och körs varje gång tabellen ändras: `grep -n "sendJson(res, "
src/server/api.js` och `grep -n "writeHead(" src/server/*.js`, och varje
statuskod som kan komma ut ur en väg ska stå på den vägens rad. En avgränsning
av ett svar ("vid internt fel från `createEntry`") får bara stå kvar om ingen
annan kodväg kan ge samma statuskod på den raden.

| Metod | Väg | Body in | Svar |
|-------|-----|---------|------|
| `GET` | `/api/entries` | – | `200 { "entries": Entry[] }` · `500 { error }` med lagringens text |
| `POST` | `/api/entries` | `{ name, amountSek, interval, startDate, category }` | `201 { "entry": Entry }` · `400 { error, fieldErrors }` vid ogiltig post (vad `error` innehåller står nedan) · `400 { error: "Kunde inte tolka anropet." }` vid trasig JSON · `500 { error }` vid internt fel från `createEntry` (se nedan) **eller** med lagringens text |
| `DELETE` | `/api/entries/<id>` | – | `204` utan body · `404 { "error": "Posten finns inte." }` · `500 { error }` med lagringens text |
| annat | `/api/*` | – | `404 { "error": "Okänd adress." }` eller `405 { "error": "Metoden stöds inte." }` |

"Lagringens text" är `StorageError.message` ordagrant, alltså en rad ur
tabellerna "Beteende vid läsning" och "Beteende vid skrivning" under "Lagring".
Alla tre vägarna rör datafilen och kan därför ge den, och `api.js` skriver aldrig
om texten: den är redan svensk och avsedd för användaren.

Utöver tabellen kan varje väg — `/api/*` inräknad — ge serverskiktets `500` med
`Ett oväntat fel inträffade. Försök igen.` om något kastar utanför `api.js` egna
`try`/`catch`. Den raden ägs av `server.js` och står under "Ett trasigt anrop får
inte döda appen".

`amountSek` i `POST`-body får vara antingen `string` eller `number`. Servern
gör ingen egen konvertering — den skickar råvärdet vidare till
`createEntry`, som normaliserar enligt steg 1 ovan. Det är den enda platsen i
projektet som tolkar ett belopp.

**Statuskoden avgörs av felets ursprung, inte av returtypen.** `createEntry`
returnerar `ValidationResult` både vid formulärfel och vid ett internt
`id`-fel, men de är inte samma sak för klienten: innehåller `errors` ett fel med
`field: 'id'` svarar servern `500 { "error": "<message>" }` utan `fieldErrors`,
eftersom anropet var korrekt och felet ligger i appen. Alla övriga
valideringsfel ger `400` med `fieldErrors`.

**Vad `error` innehåller i ett `400` med `fieldErrors` — bindande.** `fieldErrors`
är `createEntry`-resultatets `errors` i oförändrad ordning, och `error` är
`fieldErrors[0].message`. De två är alltid ordagrant samma sträng; en
implementation som skriver någon annan text i `error` är fel.

Ordningen är **fältens**, inte regelkedjans: `errors` kommer i den ordning
fälten prövas av `validateEntryDraft` (ordningen står under "Valideringsregler
och exakta felmeddelanden" och skrivs inte om här), och eftersom bara ett fel
per fält returneras är `fieldErrors[0]` felet på det första fält i den ordningen
som är ogiltigt. Regelkedjans ordning inom ett fält avgör bara *vilket*
meddelande det fältet får, aldrig vilket fält som står först i listan.

Ingen egen sträng införs för det här svaret, och det är skälet till valet: varje
text som beskriver ett ogiltigt fält har redan en ägare i felmeddelandetabellen,
så en ny sträng vore en andra text för samma sak. Den skulle dessutom aldrig nå
användaren — `app.js` visar `fieldErrors` vid sina fält och använder `error`
bara när svaret saknar `fieldErrors` (punkt 6 under "`src/web/app.js` —
ansvar").

Facit, som ska stå som testfall i `tests/api.test.js`: en `POST` med tomt `name`
och `amountSek: 'abc'` ger

```json
{
  "error": "Namnet får inte vara tomt.",
  "fieldErrors": [
    { "field": "name", "message": "Namnet får inte vara tomt." },
    { "field": "amountSek", "message": "Beloppet måste vara ett tal." }
  ]
}
```

med statuskoden `400`. Ett anrop där bara `amountSek` är ogiltigt ger
`error: "Beloppet måste vara ett tal."` — alltså det enda fältfelets meddelande.

`<id>` i `DELETE`-vägen jämförs som en exakt sträng mot `entry.id`. Servern
trimmar inte, normaliserar inte och tolkar inte id:t — en post som inte matchar
exakt finns inte, och svaret blir `404`.

**Hur `POST` och `DELETE` rör datafilen — bindande.** Båda gör ett enda anrop
till `updateEntries` (se "Läs–ändra–skriv i ett steg" under "Lagring"), aldrig
`loadEntries` följt av `saveEntries`. `GET` läser bara och använder
`loadEntries`.

| Väg | `mutera(entries)` returnerar | Svar |
|-----|------------------------------|------|
| `POST` | `[...entries, result.value]` — alltid en lista, aldrig `null` | `201 { entry }` |
| `DELETE` | `entries.filter(e => e.id !== id)` när något `id` matchar, annars `null` | `204` respektive `404 { error: "Posten finns inte." }` när `updateEntries` gav `null` |

Beslutet "finns posten?" fattas alltså inuti köplatsen, av `mutera`, och inte av
en läsning före den. Det ger ett bestämt facit också när två anrop överlappar:
`Promise.all([DELETE x, DELETE x])` med samma `id` ger exakt ett `204` och exakt
ett `404`, och posten är borta. Skulle `404` avgöras av en läsning utanför
köplatsen kunde båda anropen svara `204` för en borttagning som bara blev av en
gång.

`createEntry` anropas **före** `updateEntries`, inte inuti `mutera`: ett
valideringsfel ska ge `400` utan att någon köplats tas i anspråk, precis som
skrivvägens rad 1–3 avvisar utan att röra disken. `mutera` gör därför inget annat
än att lägga till respektive ta bort en post i den lista den får, och kastar
aldrig.

Servern beräknar inte totaler. Webbläsaren importerar `cost.js` och
`schedule.js` och räknar själv — samma kod, ett facit.

### Statiska filer [paket 5]

| Väg | Levereras från | Content-Type |
|-----|----------------|--------------|
| `/` | `src/web/index.html` | `text/html; charset=utf-8` |
| `/style.css` | `src/web/style.css` | `text/css; charset=utf-8` |
| `/app.js` | `src/web/app.js` | `text/javascript; charset=utf-8` |
| `/core/<fil>.js` | `src/core/<fil>.js` | `text/javascript; charset=utf-8` |
| övrigt | – | – (svaret är `404` utan kropp, se nedan) |

**En okänd statisk sökväg svarar `404` utan kropp och utan `Content-Type` —
bindande.** Statusraden är hela svaret. Formen `{ "error": "<svensk text>" }`
gäller `/api/*` och serverskiktets två egna felsvar (rad S1 och S2 under "Ett
trasigt anrop får inte döda appen"), och ingenting annat: strängen
`Okänd adress.` ägs av `api.js`
(se HTTP-API-tabellen), och en kopia av den i `server.js` vore en andra text för
samma sak — just det ägarregeln under "Mappstruktur" förbjuder. Att den statiska
vägen klarar sig utan text är inget undantag från regeln att all text mot
användaren är svensk: en okänd statisk sökväg är webbläsarens begäran om en fil
som inte finns, inte en människas fråga, och svaret visas aldrig i
gränssnittet.

Facit, som ska stå som testfall: `GET /finns-inte` ger `404` med tom kropp,
medan `GET /api/finns-inte` ger `404` med kroppen `{"error":"Okänd adress."}`
och `Content-Type: application/json; charset=utf-8`. Skillnaden mellan de två
`404`-svaren är avsiktlig.

`charset=utf-8` är obligatoriskt på varje svar som har en kropp — de två svar
som saknar kropp är `204` från `DELETE` och `404` från en okänd statisk sökväg —
och `index.html` ska ha
`<meta charset="utf-8">`. Utan det blir å, ä och ö förvanskade i webbläsaren.
Endast filnamn som matchar `/^[a-z0-9-]+\.js$/` får slås upp under `/core/` —
ingen sökvägssammanslagning med användarens indata utan den kontrollen.

Servern lyssnar på `127.0.0.1`, inte `0.0.0.0`. Appen är för en person på en
enhet och ska inte vara nåbar från nätverket.

### `src/web/app.js` — ansvar [paket 5–7]

Ingen ny logik. Varje punkt är märkt med det paket där den byggs:

1. **[paket 5]** Hämta `GET /api/entries` vid sidladdning.
2. **[paket 5]** Rendera postlistan: namn, kategorietikett, belopp,
   intervalletikett och en Ta bort-knapp per post. **[paket 6]** Lägg till
   månadskostnad och årskostnad per post.
3. **[paket 6]** Rendera totalerna via `totalMonthlyOre` och `totalYearlyOre`.
4. **[paket 7]** Rendera kommande dragningar via `upcoming(entries, todayIso())`
   med datum och antal dagar kvar ("Idag" vid 0, "Om 1 dag", "Om N dagar").
5. **[paket 5]** Skicka formuläret till `POST /api/entries` och visa
   `fieldErrors` vid det fält de tillhör. Ingen post skapas vid fel.
   Beloppsfältet skickas som den råa strängen från formuläret — ingen egen
   `parseFloat` i `app.js`.
6. **[paket 5]** Visa fel som **inte** hör till ett fält i formuläret i
   formulärets allmänna felruta. Fältfelen visas vid sina fält, och de allmänna
   fallen är två: svarets `error`-text när svaret inte bär något fältfel (det
   gäller varje `500` och `400 { error: "Kunde inte tolka anropet." }`), och
   `GENERAL_ERROR` när svaret varken bär en `error`-sträng eller något fältfel.
   Inget felsvar får leda till att ingenting syns på skärmen; de exakta fallen
   för `GENERAL_ERROR` står under "Den allmänna felrutans egen text" nedan.
7. **[paket 5]** Anropa `DELETE /api/entries/<id>` och uppdatera vyn.
8. **[paket 6]** Visa tomläge när listan är tom: "Du har inga poster ännu. Lägg
   till din första utgift ovan." — inte en tom skärm.

#### Totalrutan, kostnaden per post och tomläget [paket 6]

Punkt 2, 3 och 8 ovan är sammanfattningen. Det här avsnittet är facit för dem:
elementens id:n, de svenska strängarna och beräkningsvägen. Ingen sträng mot
användaren får hittas på av byggaren, och inget tal får räknas fram i `app.js`.

**Beräkningsvägen — bindande.** Fyra tal visas, och vart och ett kommer ur en
egen export i `src/core/cost.js`:

| Tal på skärmen | Anrop | Var |
|---|---|---|
| Månadskostnad för en post | `monthlyOre(entry)` | en cell i postens rad |
| Årskostnad för en post | `yearlyOre(entry)` | en cell i postens rad |
| Totalt per månad | `totalMonthlyOre(entries)` | totalrutan |
| Totalt per år | `totalYearlyOre(entries)` | totalrutan |

`app.js` får aldrig summera kolumnen själv. Totalerna kommer alltid ur
`totalMonthlyOre` och `totalYearlyOre`, som får hela listan.

**Kolumnen och totalen kan skilja sig med ören, och det är avsiktligt.** Det
följer av beslutet "Totalen avrundas en gång, ur den exakta årssumman" i
beslutsloggen: totalen avrundas en gång ur den exakta årssumman, medan varje rad
avrundas för sig. Arkitektens körning av `src/core/cost.js` på Node v24.19.0, med
posterna à 100,00 kr:

| Post | `interval` | `monthlyOre` | `yearlyOre` |
|---|---|---|---|
| Hyra | `monthly` | 10000 öre | 120000 öre |
| Försäkring | `quarterly` | 3333 öre | 40000 öre |
| Domän | `yearly` | 833 öre | 10000 öre |

Kolumnsumman för månad blir 14166 öre, medan `totalMonthlyOre` ger **14167**
öre — en öres skillnad, synlig på skärmen med tre helt vanliga poster.
Årskolumnen summerar till 170000 öre och `totalYearlyOre` ger 170000 öre, alltså
ingen skillnad där.

**Skillnaden förklaras inte för användaren.** Ingen fotnot, ingen asterisk, ingen
extra sträng. Skälet: en förklaring gör en öres avrundning till något användaren
måste förstå för att lita på appen, och den korrekta totalen är den som visas.
Kravet är i stället att skillnaden är **testad**, så att en senare byggare inte
"lagar" den genom att summera kolumnen — se punkt (14) i kravlistan för
`tests/app.test.js` under "Teststrategi".

**Punkt (14):s testform går inte att skriva för årshalvan, och det är avsiktligt.**
Granskarens körning i paket 6: mutationen `formatSek(totalYearlyOre(entries))` →
`formatSek(entries.reduce((s, e) => s + yearlyOre(e), 0))` ger `tests 264,
pass 264, fail 0` och `EXIT=0`, medan samma mutation för månadstotalen fäller två
testfall. Skälet är att `totalYearlyOre` **är** kolumnsumman: årsbeloppet per post
avrundas inte, så ingen indata kan skilja de två uttrycken åt på värdet. Ett test
som påstår sig skydda årshalvan på samma sätt som punkt (14) skyddar månadshalvan
vore alltså ett test utan indata som kan fälla det, och det får inte skrivas.
Det som ändå går förlorat med en kolumnsumma är `totalYearlyOre`:s egna spärrar
(`Array.isArray` på listan och `Number.isSafeInteger` efter varje addition), och
de prövas av `tests/cost.test.js`, inte härifrån.

**Inget testfall i `tests/app.test.js` kan fälla den mutationen, och punkt (13)
gör det inte heller.** Granskarens körning i runda 2: årstotalen bytt mot en
`reduce` ger `tests 267, pass 267, fail 0` och `EXIT=0`, utan en enda kryssrad.
Det är en mätt egenskap hos värdena, inte ett hål någon glömt att täppa: de två
uttrycken ger samma tal för varje indata, och ett test som skiljer dem åt går
därför inte att skriva. Kravet på `app.js` står kvar oförändrat — totalerna
hämtas ur de två exporterna — och det som skyddar årshalvan är i stället en
textspärr av samma slag som den mot `saveEntries` i `api.js`: ett testfall som
läser `src/web/app.js` och kräver att `totalYearlyOre` anropas där och att
ingen `reduce` förekommer. **En textspärr räknas aldrig som ensamt skydd, och
här finns inget beteendetest bakom den** — därför prövades den mot varje
stavning språket tillåter innan den räknades som skriven.

Byggd i paket 6 som `app.js hämtar båda totalerna ur cost.js och räknar inte ut
dem själv` i `tests/app.test.js`. Spärren prövar **bindningen**, inte strängen:
varje element i importlistan normaliseras till sitt exportnamn, och anropet
prövas under det namn filen faktiskt använder — aliaset om det finns. Tre
mutationer kördes, alla med `EXIT=1` och `fail 1` på just det testfallet:

| Stavning | Utfall |
|---|---|
| `totalYearlyOre(entries)` → `reduce`, oförändrad import | `EXIT=1` |
| `totalYearlyOre as arsTotal` i importlistan → `reduce` | `EXIT=1` |
| `import * as cost` → `cost.yearlyOre` i en `reduce` | `EXIT=1` |

Spärren förbjuder `.reduce(` men **inte** `for`-loopar: `renderEntries` behöver
en, och ett förbud som är bredare än sitt skäl gör nästa granskare oförmögen
att avgöra om en konstruktion är ett fel eller en nödvändighet. Det bredare
förbudet prövades och föll på `renderEntries` egen loop.

**Kostnaden per post.** Postens rad har efter paket 6 sex celler i den här
ordningen: `entry-name`, `entry-category`, `entry-amount`, `entry-interval`,
`entry-monthly`, `entry-yearly`, följt av Ta bort-knappen. De två nya cellerna
bär sin egen etikett i texten, eftersom raden annars visar tre belopp utan att
något skiljer dem åt — `entry-amount` är beloppet **per betalning** och de två
nya är omräkningar. Strängarna är bindande och byggs så här:

```js
cell('entry-monthly', `Per månad: ${formatSek(monthlyOre(entry))}`)
cell('entry-yearly', `Per år: ${formatSek(yearlyOre(entry))}`)
```

Arkitektens körning gav för kvartalsposten ovan cellerna
`"Per månad: 33,33\u00a0kr"` och `"Per år: 400,00\u00a0kr"`. Blanktecknet före
`kr` är U+00A0 och kommer ur `formatSek`; etikettens kolon följs av ett vanligt
mellanslag, U+0020. Ett test som jämför mot `'Per månad: 33,33 kr'` skrivet med
vanligt mellanslag före `kr` fallerar — det är en inträffad lärdom, se
`LARDOMAR.md` 2026-09-02 om `formatSek`-strängen.

**Totalrutan.** En egen `<section class="card">` i `<main>` i `index.html`,
placerad **efter** kortet "Dina poster": rutan sammanfattar listan och läses
efter den. Rubriken är `<h2>Summa</h2>`. Rutan innehåller två rader, var och en
med en etikett i klartext och ett belopp i ett eget element:

| Etikett i `index.html` | Elementets id | Fylls med |
|---|---|---|
| `Totalt per månad` | `total-monthly` | `formatSek(totalMonthlyOre(entries))` |
| `Totalt per år` | `total-yearly` | `formatSek(totalYearlyOre(entries))` |

Etiketterna står som statisk text i `index.html` och skrivs aldrig av `app.js`;
`app.js` sätter bara `textContent` på de två elementen. Klassnamnen för raden och
etiketten väljer byggaren, men beloppselementen ska ha klassen `total-amount`, så
att `style.css` kan ge dem samma `font-variant-numeric: tabular-nums` som
`entry-amount` har.

**Totalrutan visas alltid, också när listan är tom.** Den döljs inte. Arkitektens
körning: `totalMonthlyOre([])` och `totalYearlyOre([])` ger båda `0`, och
`formatSek(0)` ger `"0,00\u00a0kr"` — en tom lista visar alltså `0,00\u00a0kr`
på båda raderna. Alternativet, att dölja rutan, förkastades av två skäl: det kräver
en mekanism DOM-attrappen i `tests/helpers/dom.js` inte har (varken `hidden`,
`style` eller `classList`), och en ruta som försvinner och kommer tillbaka är
oroligare att läsa än två nollor.

**Tomläget.** Ett eget element i kortet "Dina poster", efter `<ul id="entry-list">`:

```html
<p class="empty-state" id="empty-state"></p>
```

`app.js` sätter dess `textContent` till `Du har inga poster ännu. Lägg till din
första utgift ovan.` när listan är tom och till den tomma strängen annars. Det är
samma teknik som `#form-error` redan använder — ett tomt `textContent` syns inte —
och den kräver ingen ny förmåga hos attrappen. Texten står ordagrant i punkt 8
ovan och får inte skrivas om.

**Tre nya id:n betyder tre tillägg i DOM-attrappen.** `index.html` får `total-monthly`,
`total-yearly` och `empty-state`, och testfallet som jämför attrappens id:n med
`index.html`:s id:n (punkt (6) i kravlistan) faller tills `createDom()` i
`tests/helpers/dom.js` registrerar samma tre. Attrappen ska alltså få tre
`FakeElement` till, registrerade under just de id:n — ingen ny metod, ingen ny
egenskap. Det är hela utökningen av attrappen i paket 6.

**`style.css` — krav, inte kod.** Två regler tillkommer: `total-amount` ska ha
`font-variant-numeric: tabular-nums` som `entry-amount`, så att siffrorna står i
kolumn, och `.entry` ska klara sina två nya celler — dagens
`grid-template-columns: 1fr auto auto auto auto` räcker inte för sju barn.
Hur rutnätet skrivs om, och hur `empty-state` dämpas, är byggarens val; kravet är
att de sex cellerna och knappen får plats utan att raden bryts sönder, och att
regeln för smal skärm (`@media (max-width: 34rem)`) fortfarande ger en läsbar rad.
Ingen ny text mot användaren tillkommer i `style.css`.

#### Villkoret för en misslyckad hämtning är `!== 200`, inte `>= 500` [paket 6]

Byggarens körning i paket 6 sonderade `GET /api/entries` mot en riktig server i
fyra tillstånd och fick bara två statuskoder: `200` för saknad, tom och giltig
datafil, och `500` för skadad datafil och för en ogiltig post. `handleList`
skickar heller inga andra: `405` kräver en annan metod, `404` en annan sökväg
och serverskiktets `400` en förfrågningsrad som inte går att tolka, och `app.js`
skickar alltid `GET /api/entries`. Mutationen `!== 200` → `>= 500` ger därför
`tests 268, pass 268, fail 0` och `EXIT=0`.

**Villkoret ska ändå vara `!== 200`, och det är ett beslut och inte en
förbiseelse.** De två uttrycken skiljer sig först vid en status i intervallet
300–499, som i dag kräver en mellanhand mellan webbläsaren och servern. Det
bredare villkoret är det som stämmer med regeln nedan — vyn visar aldrig ett tal
appen inte vet är sant — medan `>= 500` skulle låta ett framtida `404` eller
`409` på GET-vägen rendera som om svaret varit lyckat. Att en mutation överlever
är alltså väntat här och gör inte villkoret till död kod: **grenen körs**, av
varje `500`, och den prövas av punkt (13). Det otestbara är gränsen, inte
grenen. Får GET-vägen någon gång en status mellan `300` och `499` ska den få ett
testfall i samma paket.

#### Vyn när en hämtning misslyckas [paket 6]

`renderEntries` är enda skrivaren av `#entry-list`, `#empty-state`,
`#total-monthly` och `#total-yearly`, och den nås bara när `GET /api/entries` gav
`200`. Utan en regel för det misslyckade fallet får användaren kortet **Summa**
med två etiketter och inga belopp — inte de två nollor stycket ovan lovar — och
efter en borttagning som inte kunde följas av en omhämtning står en post kvar i
vyn som redan är borta ur datafilen, med totaler som räknar med den. Båda
tillstånden är uppmätta av granskaren i paket 6 mot den incheckade DOM-attrappen.

**Regeln är bindande: vyn visar aldrig ett tal appen inte vet är sant.**
Misslyckas en hämtning — `fetch` avvisas, eller svaret har någon annan status än
`200` — ska `app.js` göra tre saker utöver att visa feltexten enligt punkt 6:

| Element | Vad det sätts till | Varför inte något annat |
|---|---|---|
| `#entry-list` | tömd | En kvarstående lista är förra svarets data och kan innehålla en post användaren just tagit bort. |
| `#empty-state` | den tomma strängen | Texten "Du har inga poster ännu" är ett **påstående om datafilen**. Appen vet inte om den är tom; den vet bara att den inte kunde läsa den. |
| `#total-monthly`, `#total-yearly` | `UNKNOWN_TOTAL` | `0,00\u00a0kr` vore ett tal appen inte har räknat fram. |

`UNKNOWN_TOTAL` är `app.js`:s tredje egna sträng och bindande ordagrant:

```js
const UNKNOWN_TOTAL = '\u2013';
```

Tecknet är U+2013 EN DASH, inte bindestreck (U+002D) och inte tankstreck
(U+2014). **Det skrivs med escapen `\u2013` — i koden, i testerna och i den
här filen — aldrig som det råa tecknet** — ett tecken utanför ASCII som står rått i
en sträng går inte att skilja från sina grannar vid läsning. Regeln gäller varje
icke-ASCII-tecken som ingår i en sträng en funktion producerar, inte det tecken
som senast råkade bli fel: `\u00a0`, `\u2013` och `\u2212` skrivs alla
med escapen. Filen har brutit mot regeln en gång per tecken — ett osynligt U+00A0
(`LARDOMAR.md` 2026-09-10 och 2026-09-11) och ett rått U+2013 i det här
kodblocket, som stod kvar från paket 6 till den andra granskningen av paket 7
och alltså inte var den rad `src/web/app.js` innehåller (`LARDOMAR.md`
2026-09-14). Ett tankstreck i **löptext** — rad 1–3, 1–60 tecken — är typografi
och ligger utanför regeln; det som omfattas är strängar en funktion producerar.

Det står ensamt: feltexten i den allmänna felrutan säger redan vad som
gick fel, och en andra förklaring intill varje belopp vore samma besked två
gånger. En egen svensk mening här förkastades av det skälet.

**Testfallen är obligatoriska** och läggs till kravlistan för `tests/app.test.js`
som (17): ett avvisat `fetch` vid sidladdning ger tömd lista, tomt
`#empty-state`, `\u2013` i båda totalelementen och `GENERAL_ERROR` i
felrutan; och (18): en lista renderad ur ett `200`, följd av en borttagning vars omhämtning
misslyckas, lämnar inget av den gamla listans innehåll i vyn. Mutationen som ska
fällas av (17) är "ta bort anropet som nollställer vyn i den misslyckade grenen"
→ `EXIT=1`.

#### Vyn efter en borttagning [paket 8]

Regeln ovan gäller en **hämtning** som misslyckas. Vad vyn ska visa när en
**borttagning** misslyckas har inte stått någonstans i den här filen, och
beslutet fanns bara som en kommentar i ett testfall. Följden mätte
slutgranskningen med två flikar mot samma datafil: en borttagning i den ena och
ett klick på samma rad i den andra gav `#form-error = "Posten finns inte."`
samtidigt som raden stod kvar i listan, i båda totalerna och bland kommande
dragningar — ett belopp 12 000 kr för högt per månad och en dragning för en post
som inte finns, bredvid texten som säger att den inte finns. `clearView`s egen
kommentar namnger det tillståndet ordagrant som det den finns för att förhindra,
men slutsatsen drogs bara för `loadAndRender` (`LARDOMAR.md`, 2026-09-22, en
borttagning som ger 404 lämnar posten kvar).

**Facit, en rad per utfall av `DELETE /api/entries/<id>`:**

| Utfall | Feltext | Vyn |
|---|---|---|
| `204` | ingen | hämtas om med `loadAndRender()` |
| `404` | serverns `Posten finns inte.` genom `showErrors` | **hämtas om** |
| `500` | lagringens svenska text genom `showErrors` | oförändrad |
| `fetch` avvisas | `GENERAL_ERROR` | oförändrad |

**Skälet att `404` behandlas annorlunda än `500`** är att de säger olika saker.
Ett `404` är ett **definitivt besked om datafilen**: servern har läst den och
sagt att posten inte finns, alltså har filen ändrats sedan vyn hämtades, och då
är vyn inaktuell i sin helhet — inte bara på raden användaren klickade. Ett `500`
och ett avvisat `fetch` säger tvärtom att appen **inte vet** något nytt om
datafilen, och då får den inte gissa: en omhämtning som misslyckas skulle nollställa
vyn och ta bort information användaren fortfarande kan läsa. Samma skillnad
styr redan `updateEntries` på serversidan, där `404` avgörs inuti köplatsen av
den som läser filen.

**Ordningen är bindande, och den indata som visar det är utskriven:**
`showErrors(...)` körs **före** omhämtningen. Skulle omhämtningen också
misslyckas skriver `loadAndRender` sin egen text och nollställer vyn, och då är
det den nyare upplysningen användaren ser. I omvänd ordning skulle lagringens
text skrivas först och därefter skrivas över av `Posten finns inte.`, alltså en
tom vy med en text om en post — den indata som skiljer är `DELETE` som ger `404`
följt av en omhämtning som ger `500`.

**Varje rad i facit har en punkt som skyddar den.** Tabellen gör fyra utfall
bindande, och tre av dem sitter i samma `if`-kedja i `removeEntry`; en rad utan
punkt är därför inte en lucka i ett testfall utan en rad vem som helst kan ändra
med grön svit:

| Rad i facit | Punkt |
|---|---|
| `204` | (24) |
| `404` | (34) |
| `500` | (35) |
| `fetch` avvisas | (36) |

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (34) | `en borttagning som ger 404 hämtar om listan och visar serverns text` | `if (response.status === 404) {` → `if (false) {` |
| (34) | `en borttagning som ger 404 följd av en misslyckad omhämtning visar det nyare felet` | i `removeEntry`, inte i `submitForm`: `showErrors(await readJson(response));` flyttas efter 404-grenen |
| (35) | `en borttagning som ger 500 lämnar vyn orörd och visar lagringens text` | `if (response.status === 404) {` → `if (true) {` |
| (36) | `ett avvisat fetch vid Ta bort lämnar vyn orörd och visar den allmänna texten` | i `removeEntry`s `catch`-gren, inte i `submitForm` eller `loadAndRender`: raden `FORM_ERROR.textContent = GENERAL_ERROR;` följs av `await loadAndRender();` |

Punkt (34):s första fall ska asserta **alla tre** vyelementen efter svaret, inte
bara felrutan: `#entry-list` har en rad färre, `#total-monthly` och
`#total-yearly` är den kvarvarande listans totaler jämförda mot ett anrop av
`totalMonthlyOre` och `totalYearlyOre`, och `#upcoming-list` saknar den
borttagna postens namn. En assertion på bara `#form-error` räknas inte — den
passerar med den kod som gav fyndet. Planen för `fetch`-attrappen svarar `404` på
`DELETE` och en kortare lista på den `GET` som följer, alltså samma form som
punkt (24) använder.

**Punkt (35) och (36) skyddar de två rader som säger att vyn ska stå
oförändrad**, och de kom till efter granskningen av paket 8: mutationen "hämta om
vid varje misslyckat svar" gav hela sviten `tests 358, pass 358, fail 0` och
`EXIT=0`, alltså noll kryssrader, trots att just den ändringen är det alternativ
beslutsloggen räknar upp som förkastat (granskarens körning). Orsaken var mätt:
inget testfall lät `DELETE` självt svara `500` eller avvisas — varje `500` i
filen låg på `POST`-vägen eller på en omhämtning efter ett `DELETE` som redan
lyckats.

**Formen är gemensam för de två fallen och är det som gör dem till prov.** En
vy som ska stå oförändrad syns inte när regeln håller, så testet måste göra
skillnaden synlig, och punkterna nedan gäller samtidigt:

1. **Räkna hämtningarna.** Planen räknar sina `GET`, och fallet kräver att
   antalet är oförändrat efter klicket på Ta bort. Det är den assertion som
   fäller mutationen direkt.
2. **Låt en omhämtning som ändå sker förstöra vyn.** Planen svarar `500` på varje
   `GET` efter den första. Med mutationen kör `loadAndRender` då `clearView`, och
   raderna, båda totalerna och kortet Kommande dragningar töms — alltså faller
   också elementassertionerna, och kryssraden pekar ut vad användaren förlorar
   i stället för bara ett tal. Utan den fällan skulle en plan som svarar samma
   lista varje gång dölja hela skillnaden.

Elementassertionerna är desamma i båda fallen: `#entry-list` har kvar sina rader,
`#total-monthly` och `#total-yearly` bär den **ursprungliga** listans totaler
jämförda mot ett anrop av `totalMonthlyOre` och `totalYearlyOre`, och
`#upcoming-list` har kvar sina rader. Feltexten skiljer dem åt: (35) kräver
lagringens svenska text ur svaret, (36) kräver `GENERAL_ERROR`. I (36) avvisas
`DELETE`-anropet av `fetch`-attrappen, alltså utan svar och utan statuskod.

Det andra fallet svarar `404` på `DELETE` och `500` på den följande `GET`, och
kräver lagringens text i `#form-error` plus en nollställd vy enligt "Vyn när en
hämtning misslyckas".

#### Hur `showErrors` letar upp fälten [paket 5]

**`fieldErrors` bär alltid bara de fem formulärfälten** — `name`, `amountSek`,
`interval`, `startDate`, `category` — och varje sådant fält har ett
`#error-<fält>` i `index.html`. Kravet är bindande för `api.js`: ett `field`
utanför den listan får aldrig lämna servern som ett `fieldError`, och det enda
sjätte fält valideringen känner till, `id`, skickas som `500 { error }` utan
`fieldErrors` (se "Statuskoden avgörs av felets ursprung" under "HTTP-API").

Därför gäller: **`showErrors` går igenom de fem kända fälten och letar upp deras
fel i svaret — aldrig tvärtom.** För varje fält i listan söks det första
`fieldError` med det `field`, och finns det sätts texten vid fältet. Visades
inget fältfel alls visas den allmänna texten enligt punkt 6: svarets `error` när
den är en sträng, annars `GENERAL_ERROR`.

Villkoret för den allmänna rutan är alltså "inget fältfel visades". För varje
svar `api.js` kan ge sammanfaller det med formuleringen under "Den allmänna
felrutans egen text" nedan, eftersom ett svar med `fieldErrors` alltid också bär
en `error`-sträng — den är `fieldErrors[0].message`. De två villkoren kan bara
skilja sig för ett svar som bryter mot HTTP-API-kontraktet, och då är
`GENERAL_ERROR` rätt svar: något syns.

Formuleringen är vald för att inte beordra en gren ingen indata kan nå. Den
tidigare lydelsen krävde att `app.js` samlade upp "varje `fieldError` vars
`field` saknar motsvarande formulärelement" och visade dem i den allmänna
felrutan, men med kravet ovan kan ingen sådan post finnas: granskaren fann grenen
onåbar, och det var den här punkten som beordrade den. Med uppslaget vänt
försvinner både grenen och risken — ett okänt `field` kan varken hittas eller slå
i en `null`-referens, det ignoreras bara, och den allmänna rutan visar då svarets
`error` (som enligt "HTTP-API" är `fieldErrors[0].message`). Kravet "inget
felsvar får leda till att ingenting syns" håller alltså även om `api.js` skulle
bryta mot sitt eget kontrakt.

`GENERAL_ERROR`-grenen inuti `showErrors` står kvar och är något annat än den
strukna: den prövar `typeof body.error === 'string'` på ett värde som kommer ur
`JSON.parse` av bytes appen inte har skrivit, och den nås av varje svar utan
läsbar JSON-kropp — `readJson` svarar `{}` för en kropp som inte gick att tolka.
Den indata som når grenen ska finnas som ett konkret testfall i
`tests/app.test.js`, se kravlistan under "Teststrategi".

#### Kommande dragningar i gränssnittet [paket 7]

Punkt 4 i ansvarslistan är sammanfattningen. Det här avsnittet är facit för den:
markup, element-id:n och de svenska strängarna. `app.js` räknar ingenting — varje
rad kommer ur `upcoming(entries, todayIso())`, som ger en redan sorterad lista av
`{ entry, nextDueDate, daysUntil }`.

**Kortet.** En egen `<section class="card">` i `<main>` i `index.html`, placerad
**efter** kortet **Summa**: listan svarar på "vad händer härnäst" och läses sist,
när användaren vet vad posterna är och vad de kostar. Rubriken är
`<h2>Kommande dragningar</h2>`. Kortet innehåller en `<ul id="upcoming-list"
class="upcoming-list">` och därefter ett tomlägeselement
`<p class="empty-state" id="upcoming-empty"></p>`, samma teknik som
`#empty-state` — ett tomt `textContent` syns inte.

**En rad per post, i den ordning `upcoming` gav.** Raden är ett `<li>` med
klassen `upcoming` — se "Radelementets klass är ett kontrakt med `style.css`" —
och innehåller cellerna i tabellen:

| Cell | Klass | Innehåll |
|---|---|---|
| Namn | `upcoming-name` | `item.entry.name` |
| Datum | `upcoming-date` | `item.nextDueDate`, ordagrant |
| Dagar kvar | `upcoming-days` | enligt tabellen nedan |

Datumet visas som `YYYY-MM-DD` utan omskrivning. Det är formatet datamodellen
använder, det är standard i Sverige (SS 01 61 21), och ett månadsnamn skulle
kräva en ny tabell med svensk text som ingen modul äger i dag.

**Texten för dagar kvar är bindande ordagrant** och ägs av `app.js`, eftersom
ingen modul i `src/core/` formaterar text mot användaren:

| `item.daysUntil` | Text |
|---|---|
| `0` | `Idag` |
| `1` | `Om 1 dag` |
| `n > 1` | `Om ${n} dagar` |

`daysUntil` är aldrig negativ — `nextDueDate` är per definition idag eller
senare, se algoritmen under "Datum och dragningar". Blir den ändå negativ är det
ett fel i `schedule.js`, inte något `app.js` ska dölja med en egen text: det
fallet har ingen rad här och ska inte byggas.

**Tomläget.** `#upcoming-empty` sätts till `Inga kommande dragningar ännu.` när
listan är tom, och till den tomma strängen annars. Listan är tom exakt när
`entries` är tom — varje post har en nästa dragning — men kortet får ändå en egen
text i stället för att luta sig mot `#empty-state`: en läsare ska inte behöva
sluta sig till varför ett kort är tomt genom att läsa ett annat.

**`clearView` ska nollställa också det här kortet.** Regeln under "Vyn när en
hämtning misslyckas" gäller oförändrat — vyn visar aldrig något appen inte vet är
sant — och efter paket 7 omfattar den dessa element:

```
#entry-list      tömd
#empty-state     tom sträng
#total-monthly   UNKNOWN_TOTAL
#total-yearly    UNKNOWN_TOTAL
#upcoming-list   tömd          [paket 7]
#upcoming-empty  tom sträng    [paket 7]
```

En kvarstående dragningslista efter en misslyckad hämtning vore samma fel som
den kvarstående postlistan granskaren mätte i paket 6: rader som beskriver en
datafil appen inte kunde läsa.

**Två nya id:n i `index.html` betyder två nya `FakeElement` i `createDom()`** i
`tests/helpers/dom.js`, registrerade under `upcoming-list` och `upcoming-empty` —
ingen ny metod och ingen ny egenskap. Testfallet som jämför attrappens id:n med
`index.html`:s faller tills båda finns. Räkna själv med
`grep -o ' id="[^"]*"' src/web/index.html | wc -l` före och efter i stället för
att skriva ned ett antal: ett antal i den här filen har blivit fel en gång förut.

**`style.css` — krav, inte kod.** `.upcoming-list` ska sakna punktmarkörer som
`.entry-list` gör, raden ska ha samma slags rutnät som `.entry` med datumet och
dagarna högerställda, och `.upcoming-date` ska ha
`font-variant-numeric: tabular-nums` så att datumen står i kolumn. Regeln för
smal skärm ska ge en läsbar rad. Ingen ny text mot användaren tillkommer. Vilket
element reglerna träffar avgörs av klassnamnet, och det namnet är ett kontrakt
mellan två filer — se nästa avsnitt.

**Kravlista för `tests/app.test.js`, punkt (21) till (27)** — obligatoriska:
(21) tre poster med olika nästa dragning renderas i `upcoming`-ordningen, och
raderna bär namn, datum ordagrant och rätt dagtext; (22) de tre dagtexterna
`Idag`, `Om 1 dag` och `Om 2 dagar` visas för `daysUntil` `0`, `1` och `2` —
gränsen mellan singular och plural ska ha ett fall på var sida; (23) en tom lista
ger tomt `#upcoming-list` och texten i `#upcoming-empty`, och en misslyckad
hämtning tömmer **båda**. Mutationer att köra, en per rad med egen kryssrad:
varje rad i `clearView` som rör de två nya elementen tas bort en i taget, och
`daysUntil === 1` byts mot `daysUntil >= 1`. Varje mutation ska ge `EXIT=1`.
Villkoret står i `daysText(daysUntil)` och skrivs därför med det namn det bär
där, inte med det namn det bär hos anroparen: mutationen ska gå att tillämpa
ordagrant, och `grep -c "item.daysUntil === 1" src/web/app.js` ger `0`
(`LARDOMAR.md` 2026-09-16).

**Punkt (24) och (25) — de två nollställningarna i `renderUpcoming`.** De kom
till efter granskningen och är lika obligatoriska som (21)–(23): var och en är
det enda som fäller sin mutation. De numreras här och inte bara i testfilen —
ett `(N)` i en testfil utan punkt i den här listan stoppar paketet
(`LARDOMAR.md` 2026-09-14).

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (24) | `en borttagning med lyckad omhämtning lämnar bara de kvarvarande posternas dragningar` | `UPCOMING_LIST.replaceChildren()` tas bort ur `renderUpcoming` — se noten nedan: raden delar sin mutation med punkt (27) |
| (25) | `en sparning med lyckad omhämtning tar bort tomtexten ur #upcoming-empty` | `UPCOMING_EMPTY.textContent = ''` tas bort ur `else`-grenen i `renderUpcoming` |

Noten till (24): granskarens körning ger `fail 2`, där den andra kryssraden är
punkt (27) — den renderar samma kort två gånger med en lista som inte är tom och
fäller därför samma mutation. Kravet är punktens egen kryssrad, se
mutationsregeln under "Teststrategi".

**Formkravet är gemensamt och bindande: kortet ska renderas två gånger, och
utgångsläget före den andra renderingen ska vara det motsatta av det förväntade
resultatet.** En assertion om att ett element är tomt skyddar inte raden som
tömmer det om elementet redan var tomt — då är den sann av sig själv och fäller
bara en mutation som skriver *fel* text, aldrig en som tar bort raden
(`LARDOMAR.md` 2026-09-10 och 2026-09-12). För (24) betyder det en längre lista
följd av en kortare: tre rader som ska bli två. För (25) betyder det en tom lista
följd av en med en post, så att tomtexten står på skärmen före det andra anropet.
Punkt (21)–(23) renderar kortet en enda gång från ett orört utgångsläge och kan
därför inte ersätta dem.

Båda fallen har två renderingar och därmed två klockläsningar i produktionskoden.
Ingen av dem kan ge ett annat svar än den andra, och ingen spärr mot en
midnattspassage ska finnas: klockan `app.js` läser är laddarens, och den står
still tills testet självt flyttar den (se "Klockan som `app.js` läser är
injicerad, inte verklig" under "Teststrategi"). Ett test som i stället läste den
verkliga klockan behövde en sådan spärr, kunde bli rött på oförändrad kod och
kunde aldrig pröva två olika dagar — det var läget granskaren mätte
(`LARDOMAR.md`, 2026-09-22).

**Punkt (26) — datumcellen visar nästa dragning och inte startdatumet.** Punkten
kom till efter granskningen och är lika obligatorisk som (21) till (25).
Facitraden `| Datum | upcoming-date | item.nextDueDate, ordagrant |` i
celltabellen ovan stod utan skydd: varje post i `tests/app.test.js` har ett
`startDate` som ligger idag eller de närmaste dagarna, och för en post som
startar i framtiden **är** nästa dragning startdatumet — steg 2 ger `k = 0`. De
två uttrycken är då samma sträng, och en assertion på det renderade värdet prövar
därför inte vilket av fälten koden läser (`LARDOMAR.md` 2026-09-16).

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (26) | `datumkolumnen visar nästa dragning och inte startdatumet` | `cell('upcoming-date', item.nextDueDate)` → `cell('upcoming-date', item.entry.startDate)` — se noten nedan: raden delar sin mutation med punkt (27) |

Noten till (26): granskarens körning ger `fail 2` med punkt (27) som andra
kryssrad, av samma skäl som gäller (24). Punkten behålls, och skälet är vad
kryssraden säger: (27):s rad heter `dagarna räknas om mot den nya dagen när
listan hämtas om` och pekar inte ut vilket fält datumcellen läser, medan (26):s
rad gör det.

**Testdatan är kravet här, inte assertionens form.** Fallet ska innehålla minst
en post där `nextDueDate` skiljer sig från `startDate`, och den posten är
`startDate: '2020-03-31'` med `interval: 'quarterly'` — samma rad som står i
facittabellen under "Datum och dragningar". Cellens innehåll jämförs mot
`upcoming(entries, FRYST_IDAG)`:s `nextDueDate` för samma post och inte mot en
inskriven datumsträng: facit ska komma ur ägaren till frågan, `schedule.js`, och
följa med när algoritmen ändras.

Regeln bakom punkten gäller varje cell i kortet: för varje fält en
renderingsfunktion skriver ut ska testdatan väljas så att fältet skiljer sig från
de andra fält samma objekt bär. Är två fält lika i all testdata prövar
assertionen inte vilket av dem koden läser.

**Punkt (27) — klockan läses vid varje rendering, inte vid sidladdningen.**
`renderUpcoming` ska anropa `todayIso()` inne i funktionen, och det är ett krav
och ingen detalj: en flik som står öppen över midnatt ska visa rätt dagar kvar
vid nästa hämtning. Kravet stod utan prov så länge testfilen läste den verkliga
klockan — den står still under en körning, så en klockläsning flyttad till
modulens toppnivå ger samma svar i varje testfall. Laddarens klocka går att
flytta, och det är det punkten gör.

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (27) | `dagarna räknas om mot den nya dagen när listan hämtas om` | `upcoming(entries, todayIso())` → `upcoming(entries, MODUL_IDAG)`, med `const MODUL_IDAG = todayIso();` tillagd bland modulens konstanter: klockan läses då en gång vid laddningen i stället för vid varje rendering |

Formen är bindande: fallet renderar kortet två gånger, med `FRYST_IDAG` före den
första renderingen och `FRYST_NASTA_DAG` före den andra, och den andra
renderingen utlöses av en sparning eller en borttagning vars omhämtning ger `200`
med **samma** lista som den första. Posten är en `monthly`-post som startar
`FRYST_IDAG`, så att den första renderingen ger `Idag`. Assertionerna som krävs:
varje rad jämförs mot `upcoming(poster, FRYST_IDAG)` respektive
`upcoming(poster, FRYST_NASTA_DAG)` — aldrig mot en inskriven dagtext, som vore
ett andra facit — och därutöver ska cellerna `upcoming-date` och `upcoming-days`
från den första renderingen jämföras med samma celler från den andra och vara
**olika**. Är de lika prövar fallet ingenting, och då är testdatan fel vald, inte
koden (samma krav som punkt (26) ställer på sin post).

#### Radelementets klass är ett kontrakt med `style.css` [paket 7]

Ett klassnamn som `app.js` skriver och `style.css` väljer på är en koppling
mellan två filer, och `style.css` har inget automatiskt test. Klassnamnet i
`app.js` är därför den enda ände av kopplingen som går att pröva, och den ska
prövas. Cellernas klasser hade assertioner redan före den här rundan, medan
radelementet självt saknade en: varken `rad.className = 'upcoming'`,
`item.className = 'entry'` eller valet av tagg gick att fälla med en mutation
(granskarens körning, `LARDOMAR.md`, 2026-09-22, radens egen klass i kortet
Kommande dragningar överlever mutation). Med fel klass får raden ett annat korts
rutnät eller inget alls, och med fel tagg hamnar ett `<div>` i en `<ul>`.

**Bindande: varje egenskap ett element bär som ett annat kontrakt beror på ska ha
en assertion i `tests/app.test.js`.** Inte bara `textContent` — ett element bär
mer än sin text. Kravet är skrivet om egenskapens **roll** och inte om
egenskapens namn, därför att en tidigare lydelse krävde `className` och `tagName`
för varje skapat element och därmed var bredare än de punkter som byggde den
(`LARDOMAR.md`, 2026-09-22, "Varje `assert.throws` ..." — samma form, samma fel).
Frågorna som avgör går båda att besvara mekaniskt:

1. **Väljer `style.css` på klassnamnet?** Då är klassnamnet ett kontrakt mellan
   två filer och ska asserteras.
2. **Beror något på elementtypen?** Den frågan har två mekaniska prov: namnger
   någon selektor i `style.css` elementtypen (`button.remove`, inte `.remove`),
   eller kräver föräldern just den barntypen (`<ul>` tar `<li>`, `<select>` visar
   bara `<option>`)? Är svaret ja på något av dem ska `tagName` asserteras.

Tabellen är facit för de element `app.js` skapar, och den ska läsas om när ett
element tillkommer:

| Element och var det skapas | Klassen | Elementtypen |
|---|---|---|
| `li` i `renderUpcoming` | `upcoming` bär rutnätet och kantlinjen — punkt (28) | `<ul>`:s barn — punkt (28) |
| `li` i `renderEntries` | `entry` bär samma sak — punkt (29) | `<ul>`:s barn — punkt (29) |
| `button` i `renderEntries` | `remove` bär `button.remove` och det spärrade lägets regler — asserteras av punkt (12):s celluppräkning | selektorn är `button.remove`, alltså bär typen halva regeln — punkt (30) |
| `span` i `cell` | cellklasserna bär varje `.entry-`- och `.upcoming-`-regel — asserteras av punkt (12) och (21) | **inget kontrakt, uttryckligt undantag:** ingen selektor i `style.css` namnger elementtypen, och föräldern är ett rutnät som tar vilket barn som helst |
| `option` i `fillOptions` | **inget kontrakt:** `fillOptions` sätter ingen klass, och `style.css` har ingen regel för elementet | `<select>` visar bara `<option>`: med fel typ är listan tom och formuläret obrukbart — punkt (31) |

Undantaget för `span` är skrivet som ett undantag och inte utelämnat, så att
nästa granskare kan skilja ett medvetet val från ett hål. Ändras `style.css` så
att en selektor namnger elementtypen blir undantaget falskt i samma stund, och
raden ska då bytas mot en punkt.

| Punkt | Testfall | Mutation som ska ge `EXIT=1` med punktens egen kryssrad i utfallet |
|---|---|---|
| (28) | `raden i kortet Kommande dragningar är ett li med klassen upcoming` | `rad.className = 'upcoming';` → `rad.className = 'entry';`; `rad.className = 'upcoming';` → `rad.className = '';`; `const rad = document.createElement('li');` → `const rad = document.createElement('div');` |
| (29) | `raden i postlistan är ett li med klassen entry` | `item.className = 'entry';` → `item.className = 'upcoming';`; `const item = document.createElement('li');` → `const item = document.createElement('div');` |
| (30) | `Ta bort-knappen är ett button-element` | `const remove = document.createElement('button');` → `const remove = document.createElement('span');` — se noten nedan: raden delar sin mutation med äldre fall |
| (31) | `valen i de två listorna är option-element` | `const option = document.createElement('option');` → `const option = document.createElement('div');` |

Raderna med flera mutationer körs en mutation i taget. Noten för (30) är
exemplet på den form varje rad använder när den delar sin mutation med äldre
fall; regeln bakom kolumnen står under "Teststrategi".

**Kolumnen kräver att punktens egen kryssrad står i utfallet, inte att den står
ensam där.** Rubriken sa tidigare "ensamt fäller", och det stämmer inte för raden
för (30): DOM-attrappen plockar Ta bort-knappen med selektorn
`button[type="button"]`, som matchar på elementtypen, så varje befintligt fall som
klickar på knappen faller med. Byggarens körning: åtta testfall faller, varav sju
fanns före den här rundan, och samma mutation gav `pass 26, fail 7, EXIT=1` innan
(30) skrevs. Punkten behålls ändå, och skälet är vad kryssraden **säger**: de sju
äldre heter saker som "en borttagning som ger 404 visar serverns text" och pekar
inte ut elementtypen, medan (30):s rad gör det — en granskare som bara får sju
kryss om borttagning läser dem som ett fel i borttagningen och letar på fel
ställe. Noten gäller den raden och inte tabellen: står det i en rads not att
äldre fall faller med är det en uppgift att kontrollera mot redovisningen, inte
ett fel. Byggaren skriver ut vilka testfall som faller för varje mutation i
tabellen, så att nästa granskare kan avgöra en rad genom att läsa redovisningen i
stället för att köra om allt.

Klassmutationen för Ta bort-knappen, `remove.className = 'remove';` →
`remove.className = 'delete';`, står inte i (30):s rad därför att punkt (12)
redan räknar upp radens klasser. Den ska ändå köras, och utfallet ska innehålla
punkt (12):s kryssrad — annars är klasshalvan oskyddad och behöver en egen punkt.
Punkt (31) prövar elementtypen och inget annat: att listorna fylls med rätt
värden och rätt etiketter ägs av punkt (5), och en andra kopia av den assertionen
vore ett andra facit.

Uttrycken är skrivna med det namn de bär där de står i `src/web/app.js`, så att
varje mutation går att tillämpa ordagrant: `grep -c "<uttrycket före pilen>"
src/web/app.js` ska ge minst `1` för var och en, och den kontrollen körs innan
paketet lämnas vidare (`LARDOMAR.md`, 2026-09-16). Punkt (29) prövar
`renderEntries`, alltså paket 5:s och 6:s rad, och punkt (30) och (31) prövar
paket 5:s knapp och paket 5:s listor; alla fyra hör ändå hemma här, eftersom
hålet är detsamma överallt och regeln ska ha ett hem.

**Kontrollen som hittar nästa sådant hål** körs när en regel läggs till i
`style.css` och innan `src/web/app.js` lämnas vidare, och den är en sökning per
fråga ovan. Kör `grep -nE "className = '|cell\('" src/web/app.js`, plocka ut varje klassnamn
raderna skriver, och sök var och en i `tests/app.test.js`; ett klassnamn som
`app.js` skriver men testfilen aldrig nämner är ett hål och stoppar paketet. Kör
därefter `grep -nE "document\.createElement\('" src/web/app.js` och ställ de två
frågorna ovan till varje träff; ett element som besvarar någon av dem med ja utan
att ha en rad i tabellen stoppar paketet. Båda sökningarna är riktade från
`app.js` till testet och inte tvärtom, därför att det är `app.js` som kan få ett
nytt namn eller en ny elementtyp utan att någon märker det.

#### Knappen spärras under ett pågående anrop [paket 5]

Serverns korrekthet och gränssnittets spärr är två olika frågor, och båda ska
byggas. Bindande: **den knapp som utlöste ett anrop sätts till `disabled`
innan `fetch` startar och tillbaka i ett `finally` när svaret kommit eller
anropet avvisats.** Det gäller Spara-knappen i formuläret och den Ta bort-knapp
som klickades.

**Ingen ny text mot användaren, men en ny regel i `style.css` — och den är
bindande.** `button.primary` och `button.remove` sätter egen `background`, egen
`color` och `cursor: pointer`, och de reglerna åsidosätter webbläsarens egen
gråtoning av en avstängd knapp: utan en regel för det spärrade läget ser knappen
oförändrad ut och visar handpekare medan den inte går att klicka på, alltså en
spärr användaren inte kan se. `style.css` ska därför ha en regel som gäller både
`button.primary:disabled` och `button.remove:disabled` och ger dem ett utseende
som skiljer sig från det klickbara läget: en `cursor` som inte är `pointer` och
en dämpning av knappen. Regeln ska stå bland knappreglerna, efter dem den
åsidosätter, och gälla också under `:hover` — en spärrad knapp får inte lysa upp.
Hur dämpningen görs (`opacity`, `filter`, färg) är byggarens val; kravet är att
den spärrade knappen inte ser klickbar ut. Ingen sträng tillkommer: spärren syns,
den skrivs inte.

Spärren skyddar mot ett andra klick på **samma** knapp. Den skyddar inte mot två
klick på olika Ta bort-knappar, och ska inte göra det: att ta bort två poster
snabbt efter varandra är ett rimligt handgrepp, och det är serverns
`updateEntries` som gör det korrekt. Att i stället spärra hela listan under varje
anrop förkastades — det gör gränssnittet trögt för att dölja ett fel som är
lagat på rätt ställe.

Att en knapp som redan är borttagen ur DOM:en (listan renderas om efter ett
lyckat `DELETE`) får `disabled = false` i sitt `finally` är ofarligt och kräver
ingen extra kontroll.

#### Den allmänna felrutans egen text [paket 5]

Punkt 6 kräver att något alltid syns, men servern kan inte alltid skicka en
text: `fetch` avvisas när servern inte svarar, och ett svar kan sakna både
`error` och `fieldErrors`. För de fallen — och bara för dem — har `app.js` en
egen sträng, och den är bindande ordagrant:

```js
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
```

Den visas i formulärets allmänna felruta i exakt dessa fall:

- `fetch` avvisas — vid sidladdningen, vid Spara och vid Ta bort.
- Svaret har en annan statuskod än den lyckade (`200`, `201`, `204`) och
  kroppen bär varken en `error`-sträng eller några `fieldErrors`; en kropp som
  inte gick att tolka som JSON hör hit.

Bär svaret en `error`-sträng visas **den**, ordagrant. `GENERAL_ERROR` får
aldrig ersätta en text servern har skickat, och den får inte visas tillsammans
med en sådan text.

Strängen står här och inte bara i koden därför att all text mot användaren är
svensk och bestäms i den här filen. Att den nämner servern och inte felet är
avsiktligt: de två fallen ovan betyder båda att svaret inte gick att förstå,
och användarens enda möjliga åtgärd är att försöka igen.

`index.html` följer samma indelning: formulär och lista i paket 5, totalrutan i
paket 6, listan över kommande dragningar i paket 7.

All text i gränssnittet är på svenska. Inga id:n eller engelska nyckelvärden
visas för användaren.

---

## Beslutslogg

**Ingen reservation i den bindande texten (bindande för den här filen).** Filen
innehåller inga påståenden märkta som ovissa, och markeringen "inte kört av
arkitekten" finns inte längre. Tre regler ersätter den:

1. Ett påstående om ett utfall — en statuskod, en exitkod, en sträng, ett
   returvärde, ett felmeddelande — skrivs in i den bindande texten först när
   någon har kört det, och skrivs då med vem som körde det ("byggarens körning",
   "granskarens körning").
2. Går utfallet inte att köra när beslutet fattas skrivs det **inte alls**.
   Kravet formuleras i stället som något byggaren ska köra och redovisa: ett
   testfall, en mutation, en inklistrad kryssrad. Ett krav behöver inget facit
   för att vara bindande.
3. En öppen fråga står som en punkt i den här loggen, aldrig som en reservation
   mitt i ett krav. Loggen är det enda stället i filen där något får vara öppet.

Skälet är mätt: markeringen stod på varje rad som
`grep -n "inte kör\(t\|d\|da\) av arkitekten" ARKITEKTUR.md` träffade, fem av dem
besvarade av en körning som ingen skrev in, och samma order stod på tre olika
rader — den som rättade en av dem hade fortfarande fel på två. En bindande fil
kan inte innehålla frågor. Samtliga markeringar är strukna: sökningen ovan ger
efter rättningen inga markeringar alls — varje kvarvarande träff är ett
omnämnande av att mekanismen är avskaffad, inte en markering.

Inget antal står skrivet här, och det är avsiktligt. Mönstren nedan matchar sig
själva: varje mening som dokumenterar dem, och varje hänvisning till den lärdom
som beskriver dem, höjer sitt eget antal. Ett tal blir därmed fel av att skrivas
ned — det stod `3` respektive `6` här och var fel så snart beslutsloggen fick en
post till. Kommandona körs och **träffarna läses**, en och en:

```
grep -n "inte kör\(t\|d\|da\) av arkitekten" ARKITEKTUR.md
grep -n "inte kört\|inte körd\|inte körda\|ej kört" ARKITEKTUR.md
```

Det bindande påståendet är inte ett antal utan detta: **ingen träff är en
markering på ett krav** — varje kvarvarande träff är ett omnämnande av att
mekanismen är avskaffad, eller en hänvisning till den lärdom som beskriver den.
Den kontrollen görs genom att läsa träffarna, inte genom att jämföra en siffra.

**En markör som pekar ut en uppgift som ännu inte är utförd åldras (bindande för
den här filen).** Det är rollen som avgör, inte stavningen: varje markör som
binder en åtgärd till ett paketnummer är sann bara fram till den stund byggaren
utför den, och blir i samma stund ett falskt påstående om koden. Filen har haft
tre stavningar av samma roll — `**Kvar i paket N:**`, `**Åtgärdas i paket N**`
och den avskaffade "inte kört av arkitekten" — och gick på var och en för sig,
eftersom sökningen gjordes efter den stavning som råkade stå i den lärdom som
just då rättades. En fjärde stavning ska träffas av samma kontroll utan att
någon ändrar den.

Det löftet höll inte när det prövades. Kontrollen bestod då bara av kommando A
nedan, och A är förankrat i fetstilen — alltså i typografin, inte i rollen. De
tre kända stavningarna råkade allihop vara fetstilta, så förankringen såg gratis
ut. Granskarens körning hittade i vanlig löptext ställen som band ett arbete
till ett paketnummer utan en enda asterisk ("byggs ut i paket N", "de fem sista
har sin första användare i paket N och byggs där", "de fem exporter i `dates.js`
som ännu inte finns", "att paket N-hälften är byggd och paket N-hälften inte är
rätt tillstånd i dag"), och A träffade inget av dem. Ett
mönster förankras i orden som bär rollen — aldrig i fetstil, backticks eller
rubriknivå.

Kontrollen är därför **två** kommandon, och båda körs innan varje paket lämnas
vidare, oavsett vilket paket som pågår:

```
A: grep -nE "\*\*[^*]+ i paket [0-9]" ARKITEKTUR.md
B: grep -nE "(byggs|byggd|byggas|byggt|utök|tillkom|återst|kvarst|ännu inte|rätt tillstånd)[^.]{0,80}[Pp]aket [0-9]|[Pp]aket [0-9][^.]{0,80}(byggs|byggd|byggas|byggt|utök|tillkom|återst|kvarst|ännu inte|rätt tillstånd)" ARKITEKTUR.md
```

Inget av de två räcker ensamt, och det ena är inte en bättre version av det
andra. A träffar en markör som bär fetstil men inget byggord
(`**Åtgärdat i paket N**`), B träffar en markör som bär ett byggord men ingen
fetstil (`byggs ut i paket N` mitt i en trädvy eller en löpande mening). B söker
åt båda hållen därför att ordet lika gärna står före som efter paketnumret.

**B är avsiktligt trubbigt.** Det träffar också dåtid ("byggdes i paket N") och
ren planeringstext, och de träffarna ska stå kvar som träffar: de klassas som
utfall 1 eller 3 nedan och lämnas. Ett mönster som smalnas tills bara de kända
felen återstår kan bara hitta de fel som redan är kända, och det är just det
felet A gjorde. Träffarna ska samtidigt vara så få att en agent orkar läsa dem
alla, och de är det: B:s träfflista är en liten bråkdel av
`grep -c "[Pp]aket [0-9]" ARKITEKTUR.md`, som är den enda ärliga men oläsbara
sökningen B ersätter. Prövade och förkastade tillägg till ordlistan:
`ska`, `kommer att`, `skrivs`, `görs`, `prövas` och `körs` ger nästan bara
kravlistor ("testfall som ska köras i paket N"), alltså utfall 3, och dränker de
verkliga träffarna.

**Läs meningen, inte raden.** Båda kommandona är radvisa, men en markör kan
sträcka sig över en radbrytning: ordet som bär rollen står på en rad och
paketnumret på nästa, eller tvärtom. En träff är därför en anvisning att läsa
hela meningen den står i, och rättningen omfattar hela meningen.

**Orden står som stammar** (`utök`, `tillkom`, `återst`, `kvarst`) och inte som
hela ordformer, därför att böjningen annars avgör: en sökning på `tillkommer`
missar `tillkom`, precis som en sökning på "inte kört" en gång missade två
markörer som stod i plural. Stammen `bygg` är däremot för bred — den träffar
varje mening om byggaren — så där står formerna utskrivna i stället.

**B kommer att missa något.** En markör kan skrivas med ett verb som inte står i
ordlistan ("införs i paket N", "flyttas till paket N"). Den som skriver en sådan
mening lägger in stammen i B i samma ändring; ordlistan är inte fredad. Det som
är bindande är rollen, och B är bara dagens bästa mekaniska spår av den.

Varje träff läses; ingen räknas. Träffen klassas som ett av utfallen nedan:

1. **Dåtid** (`**Utfört i paket N:**`, `**Åtgärdat i paket N**`) — en färdig
   uppgift, skriven som ett konstaterande. Lämnas.
2. **Presens eller futurum** (`**Kvar i paket N:**`, `**Åtgärdas i paket N**`,
   `**Utförs i paket N**`) med ett paketnummer som är påbörjat eller avslutat —
   alltid ett fel, och rättas av den agent som hittar den, oavsett vilket paket
   som pågår. Antingen körs det kommando som visar att uppgiften kvarstår och
   utdatan klistras in, eller så skrivs raden om i dåtid med det som faktiskt
   gjordes. Flyttas uppgiften till ett senare paket skrivs den om med det
   paketnumret.
3. **Ingen markör** — en rubrik eller en kravlista som råkar nämna ett paket
   (`**Obligatoriska testfall i paket N**`) pekar inte ut någon oavslutad
   uppgift. Lämnas.

Frågan som skiljer utfall 2 från utfall 3 i löpande text är **om meningen
påstår en avsaknad**. "De fem sista har sin första användare i paket N och byggs
där" och "de exporter som ännu inte finns" säger att koden saknar något i dag —
utfall 2, och falskt i samma stund byggaren skrivit filen. "Regeln bor i
`src/core/money.js` och byggs i paket N" och "modulen får i paket N sina fyra
första exporter" fördelar arbete mellan paket utan att påstå något om vad som
finns just nu — utfall 3, sant oavsett när det läses. Ett arbete får tilldelas
ett paket i presens; ett tillstånd får bara beskrivas som det är.

Formen `**Byggaren ska:**` i den här loggen träffas inte av något av de två och är
inget undantag som smugits in: den bär inget paketnummer, den hör till det
beslut den står i, och den är den plats lärdomen `2026-08-23 — dokumentation:
ARKITEKTUR.md beskriver kod som inte längre ser ut så` anvisar för instruktioner
till byggaren. Den är en order och aldrig historik — byter ett namn i `src/`
skrivs den om till det nya namnet.

Exemplen ovan skrivs med `N` i stället för en siffra just för att den här texten
inte ska matcha sitt eget sökmönster och höja sitt eget antal.

**En mening som inleder en uppräkning bär inte uppräkningens antal (bindande för
den här filen).** Regeln står redan i beslutsloggens punkt om `clearView`-blocket
och har brutits fyra gånger. Den fick en mekanisk kontroll efter tredje gången,
men kontrollen var förankrad i en lista över substantiv — `element`, `rader`,
`id:n`, `fall`, `punkter`, `exporter`, `stavningar`, `ställen` — och paket 7 skrev
"Raden har tre celler:", ett substantiv som inte fanns i listan när listan skrevs
(`LARDOMAR.md`, 2026-09-22). Samma fel som kommando A gjorde med fetstilen: en
spärr prövad enbart med de stavningar som fanns när den skrevs. Kontrollen är
därför förankrad i **formen** — ett räkneord, ett eller två ord, kolon sist på
raden — och har ingen ordlista alls:

```
C: grep -nEi "\b(två|tre|fyra|fem|sex|sju|åtta|nio|tio|[0-9]+) [a-zåäö]+( [a-zåäö]+)?:$" ARKITEKTUR.md
```

C körs på hela filen innan varje paket lämnas vidare, tillsammans med A och B.
`-i` står där av samma skäl som gör B trubbigt: ett räkneord som inleder en
mening skrivs med versal, och den sortens rad är den vanligaste bäraren av
konstruktionen — utan flaggan går varje `Tre utfall finns:` förbi. Varje träff
läses, ingen räknas, bland annat därför att ett belopp som `100,00 kr:` träffas
av mönstret utan att vara ett antal. Träffen klassas efter vad talet
räknar. **Räknar det raderna i tabellen, listan eller kodblocket som följer** ska
meningen skrivas om utan talet, och blocket bära antalet; det är den enda
rättningen, en ny siffra duger aldrig. **Räknar det något annat** — ett belopp,
ett antal anrop i ett scenario, en mätning som redovisas med sitt kommando —
lämnas träffen. Raden som skriver ut kommandot ovan matchar inte kommandot:
efter varje räkneord i alterneringen följer ett `|`, inte ett mellanslag.

**Ett tal som beskriver sviten är en mätning och aldrig ett facit (bindande för
den här filen, och för `README.md`).** Antalet tester, antalet fallerande fall
och en täckningsprocent hör till den körning som gav dem, och ett sådant tal
åldras av precis den handling projektet uppmuntrar: **någon lägger till ett
testfall.** Det är samma mekanism som gör en äldre mutationsrads ensamhet falsk
när en ny punkt skrivs, och den har nu slagit till sju gånger i den här filen.
Därför gäller ett av två skrivsätt, aldrig något tredje. Antingen står talet i
**dåtid** tillsammans med kommandot, körningen och vem som körde den — då är det
sant för alltid, eftersom det beskriver ett tillfälle. Eller så skrivs det
**inte alls**, och i stället skrivs den egenskap som inte åldras: `npm test` ska
ge `fail 0` och avsluta med exitkod 0, och `ℹ tests`-raden i läsarens egen
körning är enda facit för hur många de är. En order eller ett krav som en annan
agent ska följa får aldrig bära ett sådant tal i presens — det är just den formen
som har varit fel varje gång.

- **Node.js med inbyggd HTTP-server och webbläsaren som gränssnitt** — enda
  körsätt som ger ett grafiskt gränssnitt med noll beroenden och som är
  verifierat installerat i miljön. (påverkat av lärdom: nej)
- **Testkommandot är `node --test "tests/**/*.test.js"`, inte
  `node --test tests/`** — rättat efter att byggaren körde kommandot och fick
  `Cannot find module ...\tests` med exit 1 på Node v24.19.0. Node 24 tolkar
  positionsargumentet som glob, inte som katalog. Glob-varianten är körd och
  verifierad med 21 gröna tester. Ursprungsfelet var att jag skrev ned ett
  kommando jag bara härlett ur dokumentation i stället för att köra det.
  (påverkat av lärdom: **ja**, `2026-08-18 — miljö`)
- **`npm start` är inte längre ett förkrav för paket 2** — `src/server/server.js`
  skapas först i paket 5, så kravet var omöjligt att uppfylla när det skrevs.
  (påverkat av lärdom: **ja**, `2026-08-18 — miljö`)
- **Noll beroenden, varken runtime eller dev** — testkörare, UI-ramverk och
  UUID-generator finns redan i plattformen. (påverkat av lärdom: nej)
- **`src/core/` är fri från node:-importer** — samma filer körs i tester och i
  webbläsaren, så kostnads- och datumlogik kan inte glida isär mellan server och
  vy. (påverkat av lärdom: nej)
- **All beloppsaritmetik i heltal öre** — motmedel mot risken "Intervall och
  avrundning smyger in fel" i `PLAN.md`. Flyttal på kronor ger fel som först
  syns i totalen. (påverkat av lärdom: nej)
- **Totalen avrundas en gång, ur den exakta årssumman** — beslutet måste vara
  ett, annars får paket 3 och paket 6 olika facit. Den lilla öresskillnaden mot
  kolumnsumman är dokumenterad och testad, inte upptäckt senare. (påverkat av
  lärdom: nej)
- **`amountSek` normaliseras till `number` först, därefter körs en enda
  regelkedja** — den tidigare texten beskrev två parallella valideringsvägar
  (en för sträng, en för tal) som råkade ha olika inbördes ordning. Två vägar
  kan inte hållas i synk; en väg kan inte glida isär. Ordningen står numera på
  exakt ett ställe: `amountSek`-raderna i felmeddelandetabellen, som steg 2
  följer rad för rad. (påverkat av lärdom: **ja**, `2026-08-18 — validering:
  felordningen för amountSek`)
- **Antalet decimaler räknas på det normaliserade talet, aldrig på strängen** —
  det är det som gör att `'0,000'` och `0` ger samma fel. Ett representationsnära
  villkor (hur många nollor användaren skrev) får aldrig avgöra ett fel som ett
  värdenära villkor (`≤ 0`) redan har fångat. (påverkat av lärdom: **ja**,
  `2026-08-18 — validering: felordningen för amountSek`)
- **`AMOUNT_PATTERN` är `/^-?\d{1,15}([.,]\d{1,15})?$/`, inte
  `/^\d{1,7}([.,]\d{1,3})?$/`** — det gamla mönstret kontrollerade i praktiken
  både maxgräns och decimalantal, vilket gjorde regel 2 och regel 3 till död
  kod och gav `'10000000'` fel felmeddelande. Formatkontroll avgör numera bara
  "är detta ett tal alls". Minustecknet är med för att `'-50'` och `-50` ska
  landa på samma regel. Siffergränsen 15 är enbart ett finitgarantivärde.
  (påverkat av lärdom: **ja**, `2026-08-18 — validering: beloppsgränsen`)
- **Maxgränsen kontrolleras före decimalregeln** — decimalregeln är en
  toleransjämförelse i flyttal som bara är exakt under ungefär `1e9` öre. Genom
  att maxgränsen körs först ser decimalregeln aldrig ett värde utanför sitt
  giltiga arbetsområde. Detta bytte plats på två rader i felmeddelandetabellen
  men ändrade ingen felsträng. (påverkat av lärdom: **ja**,
  `2026-08-18 — validering: beloppsgränsen`)
- **Regelkedjan för `amountSek` har fyra steg, inte tre: regel 1 prövas om på
  det avrundade värdet och står sist** — dokumentet beskrev tre regler medan
  koden körde fyra. Regel 4 (`Math.round(v * 100) < 1`) finns därför att regel 1
  prövar det inkommande talet men posten lagrar `Math.round(v * 100) / 100`:
  varje `v` i intervallet `0 < v < 1e-8` ryms under regel 3:s tolerans och
  skulle lagras som `0`, alltså en post som bryter mot "> 0" och som `isEntry`
  underkänner. Den står sist för att `'0,001'` och `'0,005'` fortfarande ska ge
  decimalfelet. Ingen ny felsträng infördes — regel 4 återanvänder regel 1:s, och
  därför fick den ingen egen rad i felmeddelandetabellen utan en not. Beteendet
  är verifierat med `npm test` (48 tester, fail 0, exit 0) på Node v24.19.0.
  (påverkat av lärdom: **ja**, `2026-08-19 — validering: belopp under
  decimaltoleransen godkänns och lagras som 0`)
- **`ISO_DATE_PATTERN` ägs av `dates.js` och importeras av `entry.js`** —
  mönstret fanns i två moduler samtidigt, vilket är samma sorts fel som
  dubbelvalideringen av `amountSek`: två kopior av en regel som inget test
  tvingar att vara lika. Arkitekturen skriver inte längre ut mönstret som ett
  reguljärt uttryck i felmeddelandetabellen heller, så att inte ens
  dokumentationen kan bli en tredje kopia. Mönstret exporteras separat från
  `isValidIsoDate` därför att `entry.js` måste kunna ge två olika
  felmeddelanden för "fel format" och "obefintligt datum". (påverkat av
  lärdom: nej — men det här är ett återfall av samma mönster som
  `2026-08-18 — validering: felordningen för amountSek`)
- **Ett ogiltigt injicerat id specas separat från formulärfelen, med `500` i
  stället för `400`** — felet kan inte orsakas av användaren, bara av en trasig
  `makeId`. Returtypen förblir `ValidationResult` eftersom `LARDOMAR.md`
  (`createEntry` litar blint på det injicerade id:t) bindande kräver
  `{ ok: false, errors: [...] }`, men det får inte renderas som ett fältfel:
  `id` finns inte i formuläret, så ett `400 { fieldErrors }` skulle bli osynligt
  för användaren. Byggarens provisoriska sträng ersattes eftersom "id saknas"
  varken var sann för alla fall regeln täcker eller lämplig att visa för en
  användare. (påverkat av lärdom: **ja**, `2026-08-18 — datamodell: createEntry
  litar blint på det injicerade id:t`)
- **Villkoret för ett giltigt `id` är `trim().length > 0`, och det har exakt en
  ägare: `isValidEntryId` i `entry.js`** — den här filen skrev tidigare
  `typeof id === 'string' && id.length > 0` medan koden avvisade på
  `id.trim() === ''`. Skillnaden gällde ett enda värde, `'   '`, och det var
  **specen** som hade fel: `isEntry` underkänner ett id av bara blanktecken, så
  ett `createEntry` som godkände det skulle returnera `ok: true` för en post som
  skrivs till disk men aldrig kan läsas tillbaka — exakt det fel lärdomen om det
  injicerade id:t finns för att hindra. Invarianten väger tyngre än bokstaven i
  ett villkor. Byggarens strängare kontroll behölls därför, specen rättades, och
  villkoret flyttades till en enda funktion som både `createEntry` och `isEntry`
  anropar i stället för att var och en skriva av det för hand. Ingen
  felmeddelandesträng och inget observerbart beteende ändrades. (påverkat av
  lärdom: **ja**, `2026-08-18 — datamodell: createEntry litar blint på det
  injicerade id:t`)
- **`money.js` byggs i paket 3, inte i paket 2** — teststrategin räknade
  tidigare `money` till paket 2:s enhetstester medan `PLAN.md` lägger
  avrundningen i paket 3, och filen var otaggad i mappstrukturen. Ingenting i
  paket 2 rör öre: `entry.js` validerar kronor och importerar inte `money.js`.
  Motiveringen för paket 3 framför paket 2 är att `cost.js` är modulens enda
  kärnanvändare och byggs där; `formatSek` följer med samma paket trots att
  gränssnittet använder den först i paket 6, eftersom en modul byggs och testas
  i sin helhet i ett paket. (påverkat av lärdom: **ja**, `2026-08-18 — test: ny
  modul i src/core levererades utan egen testfil`)
- **Varje fil och varje export är märkt med sitt paket** — en fil eller export
  som saknas ska kunna avgöras som antingen "rätt, paketet är inte påbörjat"
  eller "fel, paketet är klart", utan att någon behöver gissa. `dates.js` var
  det tydliga fallet: fyra exporter byggda i paket 2 av nödvändighet, fem
  obyggda, och inget i filen som skilde "avsiktligt obyggd" från "glömd". Nu
  bär de fem `[paket 7]` och testfallen följer exporten till sitt paket.
  (påverkat av lärdom: **ja**, `2026-08-18 — test: ny modul i src/core
  levererades utan egen testfil`)
- **Exporterade konstanter i `src/core/` fryses med `Object.freeze`** —
  granskarens observation, inte ett inträffat fel: `ENTRY_FIELDS.push(...)` från
  vilken importör som helst ändrar vad `isEntry` godkänner i hela processen,
  och ingen fil visar att det har hänt. En ägare till en regel är verkningslös
  om alla kan skriva om ägarens värde. Kostnaden är ett anrop per konstant och
  noll beroenden; i strict mode (som ESM alltid kör i) kastar ett muteringsförsök
  `TypeError` i stället för att tyst ignoreras, så det syns direkt.
  (påverkat av lärdom: nej)
- **Varje konstant i `src/core/` har exakt en ägarmodul, och varje villkor exakt
  en ägarfunktion** — generaliseringen av besluten ovan. Fyra av projektets fem
  lärdomar handlar om samma sak: en regel som råkade finnas på två ställen.
  Regeln gäller även inom en och samma fil. (påverkat av lärdom: **ja**)
- **Klampning av dag 29–31 utgår alltid från startdatumets ursprungliga dag** —
  alternativet, att klampa vidare från förra resultatet, gör att en post som
  startar den 31 januari för alltid dras den 28:e. (påverkat av lärdom: nej)
- **Dagens datum skickas in som parameter, klockan läses bara i `todayIso()`** —
  annars går paket 7 inte att testa deterministiskt. (påverkat av lärdom: nej)
- **Datum lagras som strängar `YYYY-MM-DD`, aldrig som `Date`** — tidszon och
  sommartid ska inte kunna flytta ett dragningsdatum ett dygn. (påverkat av
  lärdom: nej)
- **Validering returnerar alla fältfel med exakta svenska meddelanden** — direkt
  följd av `LARDOMAR.md`: tom sträng, för lång sträng och fel typ hanteras
  explicit och testas. Exakta strängar står i den här filen så att paket 2 och
  paket 5 inte kan råka visa olika text. (påverkat av lärdom: **ja**)
- **JSON-fil under `%APPDATA%` i stället för `localStorage`** — `localStorage`
  går inte att läsa från Node och skulle göra paket 4:s krav på "ny körning"
  otestbart. (påverkat av lärdom: nej)
- **Atomär skrivning via temporärfil och `rename`** — ett avbrutet sparande får
  inte lämna kvar den trasiga fil som paket 4 samtidigt ska hantera. (påverkat
  av lärdom: nej)
- **`isEntry` kräver kanonisk lagringsform utöver regelkedjan, och uttrycket får
  en ägare: `canonicalAmountSek`** — den här filen slog tidigare fast att
  `isEntry` ärver exakt `validateEntryDraft`-kedjan och ingenting mer. Den
  formuleringen gick inte att förena med kravet att en datafil med
  `amountSek: 199.999999999` ska avvisas, och den var i grunden ett svar på fel
  fråga: kedjan avgör om ett värde är godtagbart som **indata**, medan
  inläsningen frågar om värdet är den form skrivvägen **producerar**. Två frågor
  kan inte ha ett gemensamt facit. I stället för att göra ett undantag för
  `amountSek` generaliserades den kontroll `isEntry` redan hade för `name`
  (`value.name === value.name.trim()`) till en regel: varje fält som skrivvägen
  normaliserar prövas mot sin kanoniska form, och de fälten är uppräknade i en
  tabell. Alternativet — att göra regel 3 exakt i stället för att lägga till
  kontrollen — förkastades, eftersom det skulle ändra vilket felmeddelande
  användaren får för värden som `1.005` och därmed röra ett facit som fungerar.
  Invarianten "allt som `createEntry` returnerar med `ok: true` godkänns av
  `isEntry`" bevaras genom att kravet uttrycks som likhet med skrivvägens egen
  utdata via en gemensam ägarfunktion, inte som ännu en tolerans. Att den
  likheten håller för varje lagringsbart belopp är ett flyttalspåstående och
  skrivs därför inte ned som faktum — det är ett körkrav på byggaren.
  **Byggaren ska:** lägga till `canonicalAmountSek` i `entry.js`, låta
  `checkAmountSek` returnera dess resultat i stället för att skriva
  `Math.round(v * 100) / 100` en gång till, och lägga till kontrollen av
  `amountSek` mot kanonisk form i `isEntry`. (påverkat av lärdom: **ja**,
  `2026-08-23 — datamodell: isEntry godkänner belopp som appen räknar om till
  ett annat tal`)
- **`canonicalAmountSek` exporteras trots att bara `entry.js` använder den** —
  teststrategin kräver att ett villkor med en ägare testas på ägaren, och
  fixpunktskörningen behöver nå funktionen direkt i stället för att gå via
  `createEntry` för varje öre. Samma skäl som gjorde `isValidEntryId` till en
  export. (påverkat av lärdom: **ja**, samma post som ovan)
- **`isEntry` prövar fältuppsättningen med ett enda odelbart villkor** — ett
  separat `keys.length !== ENTRY_FIELDS.length` går inte att skydda med något
  test, eftersom varje postform som bara den raden fångar saknar minst ett fält
  och avvisas ändå av `isValidEntryId` eller `validateEntryDraft`. Enligt
  mutationsregeln ska ett villkor som överlever mutationen antingen få ett eget
  test eller tas bort; här finns inget möjligt test, så villkoret tas bort och
  ersätts av en jämförelse som är självständigt korrekt.
  `JSON.stringify` valdes framför `join(',')` därför att `join` gör resultatet
  beroende av att inget fältnamn innehåller avgränsartecknet. **Byggaren ska:**
  ersätta de två `if`-satserna som prövar nycklarna i `isEntry` med en enda, och
  visa med mutation att den nya satsen fäller testet med en post som har ett
  extra fält. (påverkat av lärdom: **ja**, `2026-08-23 — test: kontrollen av
  antalet fält i isEntry skyddas inte av något test`)
- **Namnlängden avvisas först på kodenheter, sedan på tecken — och projektet får
  ingen gräns i byte för indata** — mätningen i lärdomen visade att bara `name`
  har det här problemet, eftersom det är den enda kontroll som materialiserar
  hela indatan för att svara på en fråga som är avgjord efter 61 tecken. Två
  alternativ förkastades: en global storleksgräns på API-anropet (löser inget
  problem i `PLAN.md`, och gränsen skulle behöva ett eget svenskt felmeddelande
  och en egen plats i facittabellen) och att byta tillbaka till
  `trimmed.length`, vilket vore ett återfall i lärdomen om emoji. Snabbvägen får
  ingen rad i felmeddelandetabellen därför att den ger samma meddelande för en
  äkta delmängd av samma värden — den kan alltså inte flytta vilket facit som
  gäller, till skillnad från `amountSek`-regel 4. Faktorn skrivs
  `2 * NAME_MAX_LENGTH` så att gränsen behåller en enda ägare. **Byggaren ska:**
  lägga till kontrollen `trimmed.length > 2 * NAME_MAX_LENGTH` i `checkName`
  före teckenräkningen, märka den som snabbväg i en kommentar, och lägga till de
  fem testfallen i tabellen under "`name` — längdgränsen och den billiga
  avvisningen". (påverkat av lärdom: **ja**, `2026-08-23 — validering:
  namnlängden räknas genom att hela strängen materialiseras`)
- **Mutationsverifiering är ett bindande teststrategikrav, med ett uttalat
  undantag för snabbvägar** — kravet stod bara i `LARDOMAR.md` och var därför
  inte bindande för någon byggare. Det gäller varje delvillkor och inte bara
  hela `if`-satsen, eftersom det var ett delvillkor som överlevde. Undantaget
  för snabbvägar skrevs in samtidigt: utan det skulle mutationsregeln kräva att
  den nya kontrollen i `checkName` tas bort, och de två avsnitten hade blivit
  två facit som ger motsatta svar. Ett tidsbaserat test förkastades som lösning
  på samma fråga — det skulle göra testsviten beroende av maskinens hastighet
  och bryta mot determinismkravet. (påverkat av lärdom: **ja**,
  `2026-08-23 — test: kontrollen av antalet fält i isEntry skyddas inte av något
  test`)
- **Exaktheten i beloppsaritmetiken får ett utskrivet område och en spärr, i
  stället för ordet "exakt"** — `divideRoundHalfUp` kastar `RangeError` när
  `2 * numerator + denominator` inte är ett säkert heltal, och `totalYearlyOre`
  kastar när summan inte är ett säkert heltal (var den spärren står avgörs av
  beslutet "Summaspärren i `totalYearlyOre` står efter loopen" längst ned i den
  här loggen). `yearlyOre` fick samma spärr
  på produkten `amountOre * PAYMENTS_PER_YEAR[interval]`, eftersom
  multiplikationen är det första stället där ett skadat belopp från datafilen
  kan lämna det säkra området, och det ska inte kunna passera bara för att
  summan råkar rymmas. Alternativet att räkna i `BigInt` förkastades: det skulle
  byta typ på varje belopp i hela kedjan, göra `Intl.NumberFormat`-vägen och
  datamodellens `number` till två världar, och lösa ett problem som inte kan
  uppstå för lagringsbara belopp (största möjliga årsbelopp är 11 999 999 988
  öre, drygt fem tiopotenser under gränsen). Att resultatet är exakt *inom*
  området skrivs inte som faktum i den här filen — det är ett körkrav på
  byggaren mot en `BigInt`-beräkning, av samma skäl som fixpunktskörningen för
  `canonicalAmountSek`. (påverkat av lärdom: **ja**, `2026-09-02 —
  dokumentation: "exakt heltalsaritmetik utan flyttal" skrevs in i koden utan
  att köras`)
- **`cost.js` spärrar sin egen aritmetik, inte datamodellen** — `yearlyOre`
  kastar `RangeError` på ett intervall som inte är en egen nyckel i
  `PAYMENTS_PER_YEAR`, med värdet inskrivet i meddelandet via `String()`, och
  intervallet prövas före beloppet så att meddelandet aldrig pekar ut täljaren
  när felet sitter i intervallet. `monthlyOre` och `totalMonthlyOre` fick inga
  egna spärrar: de ärver, eftersom ett villkor har en enda ägarfunktion, och
  följden — att `totalMonthlyOre('abc')` svarar med `totalYearlyOre`-namnet — är
  nedskriven som facit i stället för att lagas med en andra kopia av villkoret.
  Beloppsgränserna `> 0` och två decimaler prövas medvetet **inte** om här; de
  ägs av `entry.js`. Kvar blir en teckenspärr, som finns därför att
  avrundningsregeln "halva öret uppåt" bara sammanfaller med bort-från-noll för
  icke-negativa täljare. Ett belopp på exakt `0` ger fortfarande `0`. Spärrens
  `-0`-del (`Object.is(amountOre, -0)`) hörde till samma beslut men gäller inte
  längre: den ersattes av beslutet "`-0` normaliserades till `0` av en
  ägarfunktion" längst ned i den här loggen, där `-0` i stället normaliseras av
  `sekToOre` innan värdet kan nå `cost.js`.
  (påverkat av lärdom: **ja**, `2026-09-02 — kostnad: ett interval utanför
  tabellen ger tyst NaN i stället för fel`, och `2026-08-24` för `String()` i
  meddelandet)
- **Visningsvägens spärr ägs av `oreToSek` och ärvs av `formatSek`** — lärdomen
  krävde spärr i båda funktionerna, men två handskrivna kopior av samma villkor
  är just det ägarregeln förbjuder. Lösningen är att `formatSek` aldrig räknar
  om öre till kronor själv utan går genom `oreToSek`, som äger både omräkningen
  och kontrollen. `Number.isSafeInteger` valdes framför lärdomens
  `Number.isInteger`: det är strikt starkare, det avvisar `1e300` (ett heltal,
  men det som gav en sträng på 313 tecken) och det gör att modulen mäter alla
  öretal med ett enda begrepp. (påverkat av lärdom: **ja**, `2026-09-02 —
  money: formatSek har ingen ingångsspärr och visar NaN och ∞ för användaren`)
- **Exempelsträngen för `formatSek` skrivs med kodpunkter, på båda ställena i
  filen** — den faktiska utdatan har hårt blanksteg (U+00A0) som
  tusentalsavgränsare och före `kr`, så exempelsträngen med vanliga mellanslag
  (U+0020) var en sträng som aldrig uppstår. Både teknikvalstabellen och
  gränssnittsblocket rättades: hade bara det ena rättats hade filen fått två
  facit för samma fråga. (påverkat av lärdom: **ja**, `2026-09-02 —
  dokumentation: ARKITEKTUR.md:s exempelsträng för formatSek är inte den koden
  ger`)
- **Talet `12` får en ägande konstant, `MONTHS_PER_YEAR` i `cost.js`, medan
  `PAYMENTS_PER_YEAR.monthly` och `MONTHS_PER_PERIOD.yearly` behåller sina
  siffror** — ägarregeln var formulerad om mönster och villkor, inte om tal, och
  därför bröt två handskrivna `12` i `cost.js` inte mot något skrivet. Regeln
  utvidgades med ett rollkriterium i stället för ett sifferkriterium: samma tal
  i olika roller är olika konstanter. Alternativet, att uttrycka
  `MONTHS_PER_PERIOD` och `PAYMENTS_PER_YEAR` i `MONTHS_PER_YEAR`, förkastades —
  det skulle koppla `schedule.js` till `cost.js` för en likhet som inte är samma
  fråga, och göra tabellerna svårare att läsa än de handskrivna siffrorna är.
  `MONTHS_PER_YEAR` fryses inte, eftersom `Object.freeze` på ett primitivt värde
  inte gör något. (påverkat av lärdom: nej — granskarens observation, men
  beslutet följer ägarregeln under "Mappstruktur")
- **Summaspärren i `totalYearlyOre` står efter loopen, och `totalYearlyOre` får
  ingen numrerad tabell** — filen hade två svar på vilken spärr som vinner: en
  tabell märkt "första träff vinner" där rad 3 själv bar undantaget "efter
  **varje** addition". Av de två svaren behölls tabellens: varje posts eget fel
  vinner över summafelet, alltså det meddelande som pekar ut ett `interval` som
  går att rätta i datafilen i stället för ett storleksfel på hela listan. Koden
  flyttades till dokumentet och inte tvärtom, av två skäl: placeringen i loopen
  går inte att skydda med ett mutationstest — `yearlyOre` returnerar aldrig ett
  negativt tal, så delsummorna växer monotont och kontrollen efter loopen fäller
  exakt samma listor — och kodkommentaren som motiverade den ("kan inte upptäckas
  i efterhand") var falsk. Tabellformen ersattes av loopens gång som pseudokod
  plus två utskrivna indata där mer än ett villkor är sant, eftersom en numrerad
  "första träff vinner"-tabell bara får beskriva villkor som körs sekventiellt i
  en enda kedja. **Utfört i paket 3:** spärren flyttades ut ur `for`-loopen till
  raden före `return sum`, den falska kommentaren ersattes av motiveringen skriven
  som det indatafall där placeringen ändrar svaret, och båda fallen står som
  testfall i `tests/cost.test.js`. Byggaren redovisade `npm test` med
  `tests 124, pass 124, fail 0` och exit 0 samt sex mutationskörningar med exit 1.
  (påverkat av lärdom: **ja**, `2026-09-02 — dokumentation:
  totalYearlyOre-tabellen numrerar spärrarna i en ordning koden inte följer` och
  `2026-09-02 — test: summaspärren efter varje addition överlever mutation`)
- **Påståendet om tom lista gäller `totalYearlyOre` och `totalMonthlyOre`, och
  står på ett enda ställe** — "samtliga fyra funktioner" kunde aldrig vara sant:
  `yearlyOre` och `monthlyOre` tar en post, inte en lista. Meningen i
  "Betalningsintervall och normalisering" gjordes till en hänvisning i stället
  för att skrivas om till ett andra korrekt påstående, eftersom två likalydande
  meningar glider isär vid nästa ändring precis som två kopior av ett villkor —
  det syntes redan här, där bara det ena av de två ställena uppdaterades. Facit
  bor i `cost.js`-avsnittet under "Gränssnitt", tillsammans med spärrtabellerna.
  (påverkat av lärdom: **ja**, `2026-09-02 — dokumentation: "tom lista ger 0 för
  samtliga fyra funktioner" motsägs av koden`)
- **`entry.js` läser `ORE_PER_SEK` från `money.js`, och ägarregeln för tal får
  tre avgränsningar och en fullständig träfflista** — regeln utvidgades i förra
  omgången till att gälla tal som står som literal, men prövades bara mot det tal
  utvidgningen handlade om. Körd mot hela `src/core/` gjorde den fem handskrivna
  `100` i `entry.js` till ett regelbrott, samtidigt som två meningar i den här
  filen förbjöd den enda rättningen. Av de tre möjliga besluten — avgränsa
  regeln, skriva ut ett undantag för `entry.js`, eller häva importförbudet —
  valdes det sista: rollen "öre per krona" har en riktig ägare, `ORE_PER_SEK` är
  ett tal och inte en funktion, och importen ger ingen cykel (`money.js` ←
  `entry.js` ← `cost.js`). Ett undantag hade varit svårare att försvara än
  importen och hade dessutom måst skrivas om vid varje ny användning. Förbudet
  var ett uttalande om paket 2:s beroenden, inte ett arkitekturbeslut — `money.js`
  fanns inte då. Funktionerna i `money.js` importeras däremot fortfarande inte:
  `sekToOre` kastar för icke-finita tal, medan `canonicalAmountSek` måste svara
  `NaN` så att `isEntry` kan returnera `false` i stället för att kasta, och det
  undantaget står utskrivet med sitt skäl. Avgränsningarna (ett ställe,
  `0`/`1`/`-1`, samma uttrycks struktur) finns för att regeln ska gå att avgöra
  utan tolkning; utan dem träffar den tvåan i `divideRoundHalfUp` och de två `15`
  i `AMOUNT_PATTERN`. **Utfört i paket 3:** `src/core/entry.js` importerar
  `ORE_PER_SEK`, och alla fem literalerna i `canonicalAmountSek` och
  `checkAmountSek` läser numera konstanten. **Utfört i paket 3:** kommentarerna i
  `checkAmountSek` som citerade uttrycket med siffran skrevs om till
  `v * ORE_PER_SEK` respektive `Math.round(v * ORE_PER_SEK) / ORE_PER_SEK`, så
  att kommentar och kod pekar ut samma ägare — granskarens körning 2026-09-04 av
  `grep -n '\b100\b' src/core/entry.js` gav noll träffar. **Utfört i paket 7:** den
  andra träffen, `12` i rollen "högsta månadsnummer" i `dates.js` — raden
  `if (month < 1 || month > 12) { return null; }` togs bort ur `parseIsoDate`, och
  på dess plats står numera en kommentar som pekar ut `daysInMonth` som ägare av
  gränsen. Dagraden `day < 1 || day > daysInMonth(year, month)` avvisar samma
  värden, eftersom `daysInMonth` svarar `0` för varje månadsnummer utanför 1–12.
  Ingen ny konstant infördes. De tre datumen ur regeltexten under "Mappstruktur" —
  `'2026-13-01'`, `'2026-00-10'` och `'2026-99-01'` — ger fortfarande `null`, och
  testfallet `parseIsoDate ger null för månadsnummer utanför 1-12 utan en egen
  månadsrad` i `tests/dates.test.js` är facit för det. I `src/core/dates.js` står
  `12` därefter kvar som kod bara i `const MONTHS_PER_YEAR = 12;`, som är rollen
  "antal månader per år" med en egen ägarkommentar, och i `month > 12` inuti
  `daysInMonth`, som är ägaren till rollen "högsta månadsnummer".
  (påverkat av lärdom: **ja**, `2026-09-02 — arkitektur: den utvidgade
  ägarregeln för tal bryts av kod som redan fanns`)
- **Villkoret "är det här ett vanligt objekt" har en ägarfunktion,
  `isPlainObject` i `entry.js`, och `cost.js` anropar den** — `yearlyOre` hade en
  egen, svagare kopia utan `!Array.isArray(...)`, och kopian skrevs av in i
  facittabellen och blev därmed bindande: en array med `amountSek` och `interval`
  påsatta gav `120000` från `yearlyOre` och `false` från `isEntry`. Alternativet
  att lägga funktionen i en ny modul förkastades — begreppet hör till
  datamodellen, och `entry.js` äger den — liksom alternativet att låta `cost.js`
  vara medvetet tillåtande i just objektfrågan, som hade krävt två olika svar på
  samma fråga i samma kärna. Beroenderiktningen håller: `cost.js` importerar
  `entry.js` och `money.js`, ingen av dem importerar `cost.js`. Att `cost.js` är
  tillåtande **utöver** objektfrågan är däremot ett beslut som nu står skrivet:
  `yearlyOre` kräver ett känt `interval` och ett finit, icke-negativt `amountSek`
  och ingenting mer, så ett `Date` med de två fälten ger `120000` trots att
  `isEntry` avvisar det. Datamodellens gräns bevakas av `isEntry` vid inläsning i
  paket 4; `cost.js` spärrar sin egen aritmetik. **Utfört i paket 3:**
  `isPlainObject` exporteras från `src/core/entry.js`, importeras av
  `src/core/cost.js` och har ersatt det handskrivna villkoret i `yearlyOre`;
  funktionen har egna testfall i `tests/entry.test.js` och arrayfallen finns i
  `tests/cost.test.js`. (påverkat av lärdom: **ja**, `2026-09-02 — datamodell:
  cost.js har en egen, svagare kopia av "är detta ett objekt"`)
- **`-0` normaliserades till `0` av en ägarfunktion, `normalizeZero` i
  `money.js`, i stället för att avvisas** — `-0` tog sig genom alla tre
  spärrarna i `money.js` och nådde användaren som `"\u22120,00\u00a0kr"`, medan
  `cost.js` avvisade samma värde med ett eget meddelande: två svar för samma tal
  i samma kärna. Avvisning med `RangeError` förkastades. `-0` är inte ett
  ogiltigt värde utan noll skrivet med tecken (`-0 === 0`), och en avvisning
  hade krävt en ny felsträng för en skillnad användaren inte kan göra — formulär
  och datafil möter redan `Beloppet måste vara större än 0 kr.` för `-0`, `'-0'`
  och `'-0,00'`. Den hade dessutom flyttat facit: `yearlyOre` för ett belopp som
  avrundas till noll öre hade svarat med `sekToOre`-namnet, och
  `canonicalAmountSek` hade inte kunnat anropa ägaren alls, eftersom `isEntry`
  inte får kasta. Att låta `sekToOre` eller `oreToSek` ensam äga villkoret
  förkastades också: villkoret behövs på tre ställen, och de två återstående
  hade fått var sin handskriven kopia. Följder som skrevs in som facit:
  `yearlyOre({ amountSek: -0 })` ger `0` i stället för `RangeError`,
  `Object.is`-delen av `cost.js`-spärren togs bort som död kod, `isEntry` svarar
  `false` för `amountSek: -0` via steg 6 och inte via steg 5, och ingen
  exporterad funktion i `src/core/` får returnera `-0`. (påverkat av lärdom:
  **ja**, `2026-09-02 — money: -0 tar sig genom alla tre spärrarna`)
- **Minustecknet från `formatSek` skrevs med escapen `\u2212`, på båda ställena
  i filen** — `Intl.NumberFormat('sv-SE', …)` ger U+2212 (MINUS SIGN), inte
  bindestrecket U+002D, vilket avlästes ur granskarens körning av
  `formatSek(-0)`: `U+2212 U+0030 U+002C U+0030 U+0030 U+00A0 U+006B U+0072`.
  En jämförelse skriven med bindestreck hade varit `false` utan att någon kunnat
  se varför, precis som exempelsträngen med vanliga mellanslag var det. Både
  teknikvalstabellen och gränssnittsblocket rättades i samma ändring, av samma
  skäl som `\u00a0` rättades på båda ställena. (påverkat av lärdom: **ja**,
  `2026-09-02 — dokumentation: ARKITEKTUR.md:s exempelsträng för formatSek är
  inte den koden ger`)
- **Temporärfilens namn blev unikt per anrop, och skrivningarna ställdes i en
  modullokal löfteskedja** — namnet `entries.json.tmp` härleddes ur datafilens
  namn och var därför detsamma för varje samtidigt anrop; granskarens 60
  omgångar gav 44 skadade datafiler, 14 ohanterade `ENOENT ... rename` och 16
  läsbara filer där det ena anropets poster hade försvunnit, medan båda anropen
  rapporterade lyckad sparning. Det unika namnet ensamt hade räckt för att ingen
  fil ska bli en blandning, men inte för att svara på frågan *vilket* anrop som
  vinner: två `rename` i godtycklig ordning gör utfallet beroende av hur lång
  tid varje skrivning tar. Kön lades därför till också, och facit skrevs ut i
  stället för att lämnas åt implementationen: anropsordningen avgör, båda
  löftena uppfylls och sista anropet vinner på disk. Två alternativ förkastades.
  Ett fillås eller en `.lock`-fil förkastades **för den här frågan**: kön löser
  den inom processen, och ett lås hade krävt ett eget svenskt felmeddelande och
  en egen upplåsning efter en krasch. Den avvägningen gällde två anrop i samma
  process och gäller inte två processer — det beslutet är omprövat i paket 5, se
  "Ett lås på datafilen" längst ned i loggen, och de två kostnaderna är då
  betalda i stället för undvikna. Att låta det andra anropet kasta förkastades
  därför att två snabba klick på Spara ska spara, inte ge ett fel användaren inte
  kan tolka; klickvägen går sedan paket 5 genom `updateEntries`, som ärver kön
  och samma facit. **Byggaren ska:** bygga namnet som
  `` `${filePath}.${process.pid}.${randomUUID()}.tmp` ``, utöka den modullokala
  löfteskedjan synkront före funktionens första `await`, låta kedjan gå vidare
  även efter en avvisning, och köra överlappningstestet med sin mutation.
  Kedjan hette `writeQueue` när det här beslutet skrevs och heter `ioQueue`
  sedan beslutet om `loadEntries` längst ned i den här loggen; namnet står på
  ett ställe, i det beslutet. (påverkat av lärdom: **ja**, `2026-09-02 —
  lagring: två överlappande saveEntries delar samma .tmp-namn och förstör
  datafilen`)
- **Skrivvägen fick en egen tabell, "Beteende vid skrivning", med sju rader och
  en slutrad som fångar det oväntade** — grundorsaken till alla fyra
  underkännandena i paket 4 var att den här filen bara hade en tabell för
  läsvägen: `loadEntries` fick sin `catch` ur tabellens sista rad, `saveEntries`
  hade ingen rad att bygga efter och fick därför ingen `try` alls. Tabellen
  skrevs i samma form som lästabellen, med varje svensk sträng utskriven, och
  numreringen är körordningen. Rad 7 (det oväntade) lades till därför att en
  tabell med bara kända rader lämnar samma hål ett steg upp: ett `isEntry` som
  kastar är varken `mkdir`, `writeFile` eller `rename`, och utan slutraden hade
  ett rått engelskt fel gått rakt ut till användaren som `500 { error }`.
  Alternativet att låta okända fel passera orört ("de är buggar, inte
  användarfel") förkastades av just det skälet. `<sökväg>` i meddelandena är
  datafilens sökväg, som på läsvägen, aldrig temporärfilens: den innehåller ett
  pid och ett UUID som skiljer sig mellan två körningar. Rad 7 fick ingen
  sökväg, eftersom den också fångar fel som inträffar innan sökvägen har
  använts. **Byggaren ska:** lägga varje `node:fs`-anrop och `JSON.stringify`
  innanför `try`, kasta om en redan kastad `StorageError` oförändrad så att rad
  7 inte skriver över rad 1–6, ta bort temporärfilen i ett `finally` vars egen
  `catch` sväljer sitt fel, och köra en mutation per rad. (påverkat av lärdom:
  **ja**, `2026-09-02 — lagring: saveEntries kastar råa engelska OS-fel i
  stället för StorageError`)
- **Skrivvägen frågar `isEntry`, och den frågar innan något rör disken** —
  `isEntry` satt bara på läsvägen, så `saveEntries` skrev en post med okänt
  fält, en post med fel typ, `{a: 1}`, `'abc'` och `undefined` rakt till disk
  och bytte ut den giltiga filen med `rename` innan felet gick att upptäcka.
  Domaren är samma funktion på båda vägarna: `storage.js` får inte ha någon egen
  åsikt om vad en giltig post är, lika lite som den får ha en åsikt om `id`.
  Ordningen är array, sedan varje element, sedan `JSON.stringify` — beloppen
  `1n` och de cirkulära posterna fastnar därmed på rad 2 och ger ett meddelande
  om posten i stället för ett om serialiseringen, vilket är det svar som pekar
  ut något användaren kan rätta. Invarianten *"allt som `saveEntries` accepterar
  kan `loadEntries` läsa tillbaka"* skrevs in som bindande krav tillsammans med
  sitt motstycke: ett avvisat anrop lämnar datafilen byte-identisk. Att
  validera i `api.js` i stället förkastades — `saveEntries` är den funktion som
  skriver över användarens enda datafil, och nästa anropare skulle annars ärva
  ett krav som inte syns i signaturen. **Byggaren ska:** kontrollera i den
  ordning tabellen anger, före `fs.mkdir`, och skriva invarianttestet med de
  uppräknade indatavärdena. (påverkat av lärdom: **ja**, `2026-09-02 — lagring:
  saveEntries validerar ingenting och kan skriva en fil appen vägrar läsa`)
- **Atomicitetstestet ska döda en riktig skrivning i en barnprocess, och
  `tests/helpers/` infördes för den** — det gamla testet skrev temporärfilen för
  hand och passerade två av tre assertioner med atomiciteten helt borttagen; en
  kommentar i `src/server/storage.js` åberopade det som bevis. Ett avbrott går
  bara att pröva genom att verkligen avbryta, och en process går bara att döda
  utifrån, alltså behövs en barnprocess och en fil åt den. Alternativet att låta
  testet skriva barnets kod till en temporär fil under `os.tmpdir()` vid körning
  förkastades: en genererad fil är svårare att läsa och lämnar inget spår i
  trädet. Assertionen formulerades som "gamla listan eller nya listan, aldrig
  ett fel" därför att den är sann oavsett när `SIGKILL` landar — då kan testet
  vara deterministiskt utan att asserta på tid. Att fördelningen mellan de två
  utfallen blev ett redovisningskrav och inte en assertion **var fel och är
  ändrat**: den lösningen lät mutationen överleva medan den ena grenen kördes
  noll gånger. Facit står i punkten om det mätta tidsfönstret längre ned. Att
  temporärfilen ligger kvar efter ett `SIGKILL` skrevs in som ett utpekat
  undantag i stället för att lösas med en sveprutin. **Byggaren ska:** följa
  atomicitetstestets punkter under "Teststrategi" bokstavligt och klistra in
  mutationens fallerande rad med filnamn och radnummer. (påverkat av lärdom:
  **ja**,
  `2026-09-02 — test: atomicitetstestet avbryter aldrig en skrivning och bevisar
  ingenting`)
- **Läsvägens sista sträng naglades fast, lästabellen numrerades, och en blank
  `HEMOCHEKONOMI_DATA_FILE` räknas som osatt** — tre frågor som byggaren fick
  besvara själv därför att filen tvingade fram en gissning. Raden "Läsfel från
  operativsystemet" krävde bara "svensk text", så strängen
  `Datafilen kunde inte läsas: <sökväg>` var byggarens val trots att paket 5 och
  8 ska citera den; den står nu utskriven som rad 2, på den plats i tabellen där
  den prövas. Ordningen mellan "fel innehåll" och "version" var obesvarad när
  båda är sanna, och `{ "version": 2, "entries": 42 }` gav i granskarens körning
  `Datafilen har fel innehåll`; den ordningen skrevs in som facit tillsammans
  med ett andra exempel där version vinner över en ogiltig post, eftersom en
  numrerad tabell måste kunna prövas med en indata som gör mer än en rad sann.
  För miljövariabeln fanns två tänkbara svar — trimma värdet, eller behandla ett
  blankt värde som osatt. Trimning förkastades: en riktig sökväg får innehålla
  blanksteg, och `paths.js` ska inte ha en åsikt om hur en sökväg ser ut. `'   '`
  som sökväg är däremot alltid ett misstag i testuppsättningen, och att svara med
  standardsökvägen är det enda svar som inte leder till ett OS-fel på engelska.
  **Byggaren ska:** byta villkoret i `getDataFilePath` till
  `typeof override === 'string' && override.trim() !== ''`, returnera värdet
  ordagrant, och lägga till de fyra testfallen. (påverkat av lärdom: **ja**,
  `2026-09-02 — lagring: saveEntries kastar råa engelska OS-fel i stället för
  StorageError` för strängkravet, och `2026-09-02 — dokumentation:
  totalYearlyOre-tabellen numrerar spärrarna i en ordning koden inte följer` för
  tabellordningen)
- **`loadEntries` lades i samma kö som `saveEntries`, kön bytte namn till
  `ioQueue`, och omförsök på `EPERM`/`EBUSY` valdes bort** — meningen
  "`loadEntries` köas inte" motiverades med vad läsaren ser, men det är inte den
  riktningen som går sönder: granskarens 25 omgångar av
  `Promise.allSettled([loadEntries(), saveEntries(liten)])` mot en fil på
  37 577 818 byte gav 25 avvisade skrivningar med `cause=EPERM`. Paket 5 gör
  `GET` och `POST` mot samma fil i samma process, så felet nås av ett klick på
  Spara medan listan läses. `LARDOMAR.md` (2026-09-04) ger två vägar, och kön
  valdes därför att den är den enda av dem som gör svaret bestämt: skrivningens
  sluttid ändras inte, ingen ny felsträng behövs, ingen ny tidskonstant införs,
  och facit går att skriva ut för båda anropsordningarna. Omförsök förkastades av
  tre skäl. De gör skrivningens sluttid obestämd och kräver både en övre gräns
  och ett eget svenskt meddelande när försöken tar slut, alltså en åttonde rad i
  en tabell som redan har sju. Antalet försök och pausernas längd hade blivit tal
  som ingen kört, vilket är precis det `LARDOMAR.md` förbjuder (2026-08-18,
  testkommandot, och 2026-09-02, exakthetspåståendet). Och de hade gjort rad 6:s
  befintliga provokation — datafilen hålls öppen med `fs.open` under skrivningen
  — till ett testfall som måste vänta ut hela omförsökskedjan innan det får sitt
  svar. Vad kön inte löser står utskrivet i stället för att lovas bort: en
  handtagare utanför modulen (ett testfall, en annan process, ett virusskydd, en
  filsynk) kan fortfarande ge `EPERM`, och svaret är då rad 6:s meddelande — ett
  tydligt svenskt fel, inte en skadad fil. Visar sig den situationen i en körning
  där ingen läsning i samma process pågår är det underlag för att ompröva
  omförsöken; utan en sådan körning byggs de inte. **Byggaren ska:** döpa om
  `writeQueue` till `ioQueue`, låta `loadEntries` läsa `getDataFilePath()`
  synkront och utöka kedjan synkront före sitt första `await`, lägga hela
  `fs.readFile`-arbetet inuti kedjan, och köra det nya överlappningstestet med
  sin mutation. (påverkat av lärdom: **ja**, `2026-09-04 — lagring: en pågående
  loadEntries får saveEntries att misslyckas med EPERM`)
- **SIGKILL-testets tidsfönster härleds ur en mätning i testet självt, och båda
  utfallen räknas i en assertion** — fönstret `i = 0 … 19` ms stod som ett
  bindande tal i den här filen utan att någon hade mätt när barnet börjar skriva.
  Granskarens mätning gav cirka 45 ms, så varje dödande landade före `rename`:
  grenen `deepEqual(after, barnets lista)` kördes noll gånger, och mutationen som
  tar bort atomiciteten passerade testet. Tre alternativ förkastades. Ett nytt
  fast tal (40–90 ms) flyttar bara felet till nästa maskin. Att låta barnet
  signalera när `rename` är nära gör testet beroende av just den kod det ska
  pröva. Att behålla fördelningen som redovisningskrav var det som lät mutationen
  överleva. Kvar blev att mäta `tKlar` i en ostörd omgång, lägga dödandena över
  `0 … 2 × tKlar` och asserta att båda räknarna är minst 1. Den assertionen beror
  på hur lång tid en skrivning tar, vilket är ett medvetet undantag: det står
  utskrivet i punkt 7, det gäller bara det testet, och determinismkravet — inget
  test beror på dagens datum — är oberört. Snedheten åtgärdas åt båda hållen
  innan testet faller: för få avbrutna omgångar vidgar fönstret, för få hela
  omgångar ökar barnets postantal, högst tre försök. Ett mutationsresultat är
  dessutom inte godkänt förrän det fallerande testets namn jämförts med det
  utpekade testet — förra gången lästes `exit 1` som ett godkännande fast raden
  med kryss tillhörde två andra tester. **Byggaren ska:** mäta `tKlar`, klistra
  in mätvärdet och de använda dödandetiderna, klistra in raden med kryss från
  mutationskörningen, och redovisa båda räknarnas värden. (påverkat av lärdom:
  **ja**, `2026-09-04 — test: SIGKILL-testet dödar barnet innan skrivningen har
  börjat`)
- **`error` i ett `400` med `fieldErrors` är `fieldErrors[0].message`, och ingen
  ny sträng infördes** — filen krävde `{ "error": "<svensk text>" }` i varje
  felsvar men skrev aldrig ut texten för det vanligaste felsvaret av alla, så
  byggaren stod inför att antingen hitta på en sträng eller lämna kravet
  ouppfyllt. Två svar var möjliga. En egen sträng ("kontrollera fälten" eller
  liknande) förkastades av två skäl: varje text som beskriver ett ogiltigt fält
  har redan en ägare i felmeddelandetabellen, och en ny text för samma sak vore
  en andra formulering av något som redan är bindande; dessutom når den aldrig
  användaren, eftersom `app.js` visar `fieldErrors` vid sina fält och bara
  använder `error` när `fieldErrors` saknas. Kvar blev första fältfelets
  meddelande, och då måste "första" ha ett svar: det är **fältens** ordning, den
  som `validateEntryDraft` redan äger, inte regelkedjans ordning inom ett fält.
  Regelkedjan avgör vilket meddelande ett fält får, fältordningen avgör vilket
  fält som står först — två frågor, två ägare, ingen ny ordning. **Byggaren
  ska:** låta `error` vara ordagrant `fieldErrors[0].message`, och lägga
  facitexemplet under "HTTP-API" (tomt `name` plus `amountSek: 'abc'`) som
  testfall i `tests/api.test.js`. (påverkat av lärdom: **ja**, `2026-08-23 —
  dokumentation: två facit i samma fil ger olika svar för samma belopp`)
- **`app.js` får en egen sträng, `Det gick inte att nå appens server. Försök
  igen.`, och den står i den här filen** — punkt 6 i ansvarslistan krävde att
  något alltid syns vid ett felsvar, men två fall kan inte ge någon text från
  servern: ett `fetch` som avvisas, och ett svar utan både `error` och
  `fieldErrors`. Byggarens sträng godkändes ordagrant i stället för att bytas
  ut; den är svensk, den namnger det användaren kan göra, och den påstår inget
  om vad som är fel — vilket är rätt, eftersom de två fallen bara har det
  gemensamt att svaret inte gick att förstå. Att skriva in den här och inte bara
  i koden följer av att all text mot användaren bestäms i den här filen. Punkt 6
  skrevs samtidigt om från "`error`-texten från ett `500`-svar" till "svarets
  `error`-text när svaret inte bär några `fieldErrors`": den gamla lydelsen
  svarade inte på vad som händer med `error` i ett `400` utan `fieldErrors`, och
  utan omskrivningen hade filen fått två svar på när `error` visas i den
  allmänna felrutan. **Byggaren ska:** använda strängen ordagrant, bara i de två
  uppräknade fallen, och aldrig i stället för en text servern har skickat.
  (påverkat av lärdom: **ja**, `2026-08-23 — dokumentation: två facit i samma
  fil ger olika svar för samma belopp`)
- **Förbudet mot millisekundtal gäller dödandetiden, och hängningsspärren är ett
  utskrivet undantag** — den tidigare lydelsen förbjöd *varje* millisekundtal i
  testkoden och i den här filen, samtidigt som `LARDOMAR.md` (2026-09-04,
  storage-testet hänger för alltid) bokstavligt kräver en `AbortSignal.timeout`
  när testet väntar på barnets första meddelande. Ett dokument som förbjuder det
  teamets minne kräver är oanvändbart, och ordet `AbortSignal` fanns inte i
  filen alls, så hängningsspärren var dessutom obyggd enligt bokstaven. De två
  talen är olika saker: en dödandetid avgör var i barnets arbete avbrottet
  landar och därmed vad omgången mäter, medan hängningsspärren aldrig kan
  påverka utfallet av en omgång som blir av — den avgör bara att ett barn som
  aldrig startar ger ett fallerat test i stället för en väntan utan exitkod. Det
  är skälet till att den måste finnas: en hängning ger ingen exitkod alls, och
  kravet i `CLAUDE.md` att kontrollera utgångskoden går då inte att uppfylla. I
  samma svep rättades barnprocessens sökväg i punkt 2, som stod som en
  cwd-relativ sträng — den form samma lärdom förbjuder. **Byggaren ska:** följa
  punkt 8, hålla konstanten på minst 30 000 ms, och köra testet en gång med
  barnets filnamn medvetet felstavat. (påverkat av lärdom: **ja**, `2026-09-04 —
  test: storage-testet hänger för alltid i stället för att falla när
  barnprocessen inte startar`)
- **Kravet på SIGKILL-mutationen räknas i körningar, inte per körning** —
  formuleringen "körningen ska ge exit 1 och det fallerande testet ska vara just
  det här testet" gick inte att uppfylla: granskaren körde mutationen 12 gånger
  och testet föll 6 gånger. Var ett dödande landar i förhållande till den
  direkta skrivningen är inget testet kan styra, och ett krav som slumpen
  avgör gör paketet omöjligt att lämna vidare. Att i stället skärpa testet till
  en säker detektor prövades och förkastades i tre former. Fler omgångar per
  körning förkastades **då** med skälet att det multiplicerar testets körtid för
  en träffbild ingen hade mätt; träffbilden mättes senare, och det beslutet är
  omprövat i posten om `N = 200` längre ned i den här loggen. En tät
  `fs.readdir`-avsökning efter en temporärfil under skrivningen, och ett dödande
  som utlöses av en `fs.watch`-händelse i stället för av en tid, är båda
  fortfarande kapplöpningar — och att skriva in en okörd konstruktion som
  bindande är precis det `LARDOMAR.md` straffar (2026-08-18 testkommandot,
  2026-08-23 flyttalsgränsen, 2026-09-02 exakthetspåståendet). Kvar blev att
  skriva ut vad kravet faktiskt ska bevisa: att testet inte är tomt. Det gamla
  testet föll i noll körningar med atomiciteten borttagen, och skillnaden mellan
  noll av tio och sex av tolv är det kravet ska fånga. Kravet att det fallerande
  testets namn jämförs med det utpekade testet gäller oförändrat; det som ändras
  är att tio körningar räknas och att minst en av dem ska falla på testet, samt
  att motsatsen skrivs ut — på ostörd kod ska testet passera varje gång, och ett
  enda fall där det inte gör det lämnas tillbaka. **Byggaren ska:** köra
  mutationen tio gånger, redovisa hur många av dem som föll på testet, klistra
  in kryssraden från en av dem, och redovisa tre ostörda körningar med `fail 0`
  och exit 0. (påverkat av lärdom: **ja**, `2026-09-04 — test: SIGKILL-testet
  dödar barnet innan skrivningen har börjat`)
- **`Buffer`-läsningen ströks ur atomicitetstestets punkt 1, och utgångslistan
  fick i stället ett krav på att inte vara tom** — kravet att läsa filens byte
  med `fs.readFile(filePath)` var kvar från det gamla testet, där byte-
  jämförelsen *var* assertionen. Punkt 4 ställer numera en annan fråga: listan
  ska vara den gamla **eller** barnets, och barnets byte är varken kända före
  omgången eller intressanta efter den. Ett krav som inget assertionsställe
  använder är en uppgift byggaren inte kan uppfylla utan att hitta på vad den
  ska bevisa. Det ersattes av det krav som verkligen behövs på samma ställe:
  utgångslistan får inte vara tom, eftersom en tom fil läses som `[]` (rad 3 i
  "Beteende vid läsning") och en tom utgångslista därför skulle räkna en
  avbruten, tömd datafil som "den gamla listan". Byte-jämförelsen står kvar där
  den har en fråga att svara på — testerna av skrivvägens validering, där kravet
  är att filen är oförändrad. **Byggaren ska:** skapa utgångsläget med en
  icke-tom lista vars längd skiljer sig från barnets. (påverkat av lärdom:
  **ja**, `2026-09-02 — test: atomicitetstestet avbryter aldrig en skrivning och
  bevisar ingenting`)
- **En okänd statisk sökväg svarar `404` utan kropp; JSON-formen gäller bara
  `/api/*`** — den statiska tabellens rad `övrigt` angav varken kropp eller
  `Content-Type`, medan kravet "alla felsvar har `{ error }`" stod i
  HTTP-API-avsnittet. Byggarens läsning bekräftas: strängen `Okänd adress.` ägs
  av `api.js`, och en kopia i `server.js` vore en andra text för samma sak. Att
  det statiska svaret saknar svensk text är inget undantag från språkregeln — en
  okänd statisk sökväg är webbläsarens begäran om en fil som inte finns, och
  svaret visas aldrig i gränssnittet. Meningen "`charset=utf-8` är obligatoriskt
  på alla svar" skrevs samtidigt om till "på varje svar som har en kropp", med
  de två kroppslösa svaren uppräknade: annars hade filen krävt en `Content-Type`
  på ett svar som per samma beslut inte har någon. Av samma skäl avgränsades
  meningen som inleder HTTP-API-avsnittet ("Alla svar är `application/json …`.
  Alla felsvar har formen `{ "error": … }`") till `/api/*` och till svar som har
  en kropp — den var det ställe granskaren läste som ett krav på en `error`-text
  i det statiska `404`-svaret, och `204` från `DELETE` bröt mot den redan innan.
  **Byggaren ska:** låta båda
  `404`-formerna stå som testfall i `tests/server.test.js`. (påverkat av lärdom:
  **ja**, `2026-08-23 — dokumentation: två facit i samma fil ger olika svar för
  samma belopp`)
- **Paket 5 får två testfiler, `tests/api.test.js` och `tests/server.test.js`,
  och den manuella genomgången krymper till det som körs i webbläsaren** —
  filträdet saknade testfiler för paket 5, och teststrategin lämnade hela paket
  5 till manuell genomgång. Det gick att förena med `CLAUDE.md` så länge paket 5
  antogs vara "gränssnitt", men `api.js` och `server.js` tar emot användarinput
  och körs utan webbläsare. Undantaget för manuell genomgång finns för att en
  webbläsarautomatisering vore projektets största beroende; det skälet gäller
  `index.html`, `style.css` och `app.js`, inte servern. (`app.js` fick senare en
  egen testfil utan webbläsare — se beslutet längre ned i loggen; undantaget
  gäller sedan dess bara det en webbläsare måste visa.) `server.js` får en egen
  fil och inte en rad i `api.test.js`, därför att dess enda egna validering av
  användarinput — filtret `/^[a-z0-9-]+\.js$/` framför `path.join` — är det som
  hindrar att en sökväg från klienten pekar ut en fil utanför `src/core/`, och
  ett filter som ingen automatisk körning prövar går att refaktorera sönder utan
  att sviten märker det. En verifiering mot en manuellt startad server räknas
  inte: den körs inte av `npm test`. `tests/server.test.js` lyssnar på port `0`
  eller på en port kärnan redan tilldelat, aldrig på `3000`, så att en körning
  inte krockar med en app som redan är igång;
  `tests/api.test.js` startar ingen server alls, eftersom `handleApiRequest` tar
  `req`, `res` och `pathname` som argument och går att anropa direkt.
  **Byggaren ska:** skriva `tests/server.test.js` med de uppräknade fallen under
  "Teststrategi", köra mutationen som tar bort mönsterkontrollen, och redovisa
  `npm test` med `fail 0` och exit 0. (påverkat av lärdom: **ja**, `2026-08-18 —
  test: ny modul i src/core levererades utan egen testfil`)
- **`N` i SIGKILL-testet är 200, och kostnaden är utskriven** — punkt 3 sa `N`
  är minst 20, punkt 6 kräver att mutationen fäller testet i minst 1 av 10
  körningar, och de två gick inte ihop: byggarens mätning gav 1 av 30 med
  `N = 20` (tre serier om tio: 0, 1, 0) mot 9 av 10 med `N = 200`. Orsaken är
  mätt och inte gissad — dödandet måste träffa tiden mellan filens trunkering
  och dess sista byte, cirka 0,2 ms av ett fönster på cirka 120 ms. Att hålet är
  verkligt och att punkt 4:s assertion fångar det är kontrollmätt var för sig:
  en rå `fs.writeFile` av 38 MB som dödades lämnade en partiell fil i 7 av 24
  omgångar (200 MB: 4 av 24), och ett barn som skrev i 200 block gav
  `Datafilen är skadad och kunde inte läsas` i 5 av 10 omgångar. Avvägningen:
  `N = 200` kostar cirka 33 s för SIGKILL-testet i stället för cirka 3,5 s, och
  cirka 37 s för hela sviten i stället för cirka 7 s. Det accepteras. Alternativet
  var att sänka kravet i punkt 6 till ungefär "minst 1 av 30 körningar", och det
  förkastades: med `N = 20` hade två av byggarens tre serier om tio gett noll
  träffar, så kravet hade avgjorts av slumpen i just den mätning det ska ersätta.
  Hela skälet till att kravet finns är att skilja ett test som faller sällan från
  det gamla testet, som föll i **noll** körningar, och ett krav som två serier av
  tre missar kan inte göra den skillnaden. En halv minut per svit är ett pris som
  går att betala; ett krav som slumpen avgör är det inte. Talet stod bara som en
  kommentar i testfilen — ett tal som styr ett bindande krav hör hemma här.
  Posten längre upp, "Kravet på SIGKILL-mutationen räknas i körningar, inte per
  körning", förkastade fler omgångar med skälet att träffbilden inte var mätt;
  det skälet gäller inte längre och den meningen är omskriven. **Byggaren ska:**
  hålla `N` på 200, redovisa `tKlar`, de använda dödandetiderna, båda räknarnas
  värden och hur många av de tio mutationskörningarna som föll på testet.
  (påverkat av lärdom: **ja**, `2026-09-07 — test: atomicitetsmutationen fäller
  det utpekade testet i bara hälften av körningarna`)
- **Portvalet och autostartvillkoret får var sin exporterad funktion,
  `resolvePort` och `isDirectRun`, i stället för att skrivas som medvetet
  otestade** — byggaren mutationsprövade varje villkor i `src/server/server.js`;
  nio föll och två överlevde med `pass 200` och exit 0. Båda nås bara via
  `start()` utan argument respektive via att filen körs direkt, och testfilen är
  bunden till port `0`, aldrig `3000`. `PORT=0` löser det inte, eftersom `0` är
  falskt och uttrycket därför ger `3000`. Det fanns alltså ingen indata som nådde
  vare sig default-uttrycket eller autostartgrenen utan att en fast port bands.
  Att skriva in de två som medvetet otestade förkastades: de är inte grenar som
  ingen indata når — autostarten körs av varje `npm start`, alltså av användarens
  enda sätt att starta appen — och skiljer sig därmed från de två grenarna i
  `storage.js`, som togs bort just för att ingen indata alls kunde nå dem. Det som
  gjorde dem oprövbara var att ett *beslut* satt ihop med en *effekt*: uttrycket
  som väljer port gick bara att köra genom att binda en port, och villkoret som
  avgör om filen körs direkt gick bara att köra genom att starta servern. Beslutet
  bryts därför ut till en ren funktion vardera, som ett test kan anropa direkt
  utan att något lyssnar — samma form som `handleApiRequest(req, res, pathname)`
  redan har och av samma skäl. Kvar blir tre rader som ingen ren funktion kan
  fånga: `start()`, `server.address()` och utskriften. De prövas med en `spawn`
  av `node <server.js>` med `PORT` satt till en port testet först fått av kärnan,
  och det är samtidigt projektets enda automatiska prov av `npm start`.
  Barnprocessen bär samma hängningsspärr som atomicitetstestets punkt 8 kräver,
  med samma konstantnamn och samma minsta värde men utan punkt 8:s omtagning,
  som gäller `tests/storage.test.js` ensamt: en `spawn` utan spärren är en
  hängning utan exitkod som väntar på att inträffa. Ingen
  ny export byggs i förtid — båda har en användare i `server.js` från första
  raden de finns. **Byggaren ska:** flytta portuttrycket oförändrat till
  `resolvePort(env)`, flytta autostartvillkoret till
  `isDirectRun(argv1, moduleUrl)`, låta `start` ha `resolvePort(process.env)` som
  defaultvärde, köra facittabellen under "Gränssnitt" rad för rad och klistra in
  utfallet, samt köra de fem mutationerna under "Teststrategi" och jämföra namnet
  på det fallerande testet med det utpekade. (påverkat av lärdom: **ja**,
  `2026-09-04 — test: två konstruktioner i storage.js körs aldrig och överlever
  mutation`)
- **Servern i ett test stängs i en `after`-hook, aldrig i ett `finally`, och
  `closeAllConnections()` körs före `close()`** — filen erbjöd de två städsätten
  som likvärdiga ("i ett `finally` eller en `after`"), och byggarens mätning
  visar att de inte är det. Avbryts ett testfall av ett ohanterat kast någon
  annanstans i processen körs `finally` aldrig: lyssnaren blir kvar och `npm test`
  avslutas aldrig. Två av mutationskörningarna orsakade just ett sådant kast i
  serverns handler och slutade med `EXIT=124` från en yttre `timeout 120`; med
  `t.after()` ger samma två mutationer `exit 1`. En hängning utan exitkod är det
  tillstånd `LARDOMAR.md` (2026-09-04, storage-testet hänger för alltid) pekar ut
  som värre än ett fel, och `CLAUDE.md` kräver att utgångskoden kontrolleras — ett
  dokument som tillåter det städsätt som tar bort exitkoden är ett dokument som
  tillåter att kravet inte går att uppfylla. Byggarens andra iakttagelse skrivs in
  av samma skäl: `server.close()` väntar på varje öppen anslutning, och en
  keep-alive-socket stängs inte av sig själv, så `closeAllConnections()` måste
  köras först och varje förfrågan i testfilen göras med `agent: false`. Det är
  samma hängning en gång till, och den hör hemma i filen och inte bara i en
  kodkommentar. `finally` står kvar där det gäller något annat — städningen av
  temporärfilen i `storage.js` under "Skrivvägen" — och rör inte det här beslutet.
  **Byggaren ska:** registrera varje serverstängning som `t.after()`, köra
  `closeAllConnections()` före `close()` och använda `agent: false` i varje
  förfrågan. (påverkat av lärdom: **ja**, `2026-09-04 — test: storage-testet
  hänger för alltid i stället för att falla när barnprocessen inte startar`)
- **Läs–ändra–skriv blev ett steg i `ioQueue` genom en ny export,
  `updateEntries(mutera)` — inte en kö i `api.js` och inte en villkorad
  skrivning** — kön i `storage.js` gör varje enskild operation odelbar, och det
  facit som skrevs för den ("sista anropet vinner") är precis det som gör ett
  *par* av operationer osäkert: anrop två läser före anrop ett har skrivit.
  Granskarens mätning: 20 av 20 omgångar tappade en post vid två samtidiga
  `POST`, 19 av 20 tappade en borttagning vid två samtidiga `DELETE`, och båda
  anropen svarade att det gick bra. Tre mekanismer vägdes.
  *En kö i `api.js`* förkastades: den lägger en andra kö bredvid den som redan
  finns, alltså två ägare till samma begrepp — just det ägarregeln under
  "Mappstruktur" förbjuder — och den skyddar bara de anrop som råkar gå genom
  `api.js`, medan `storage.js` är den modul som äger filen. Den hade dessutom
  inte hjälpt någon annan framtida anropare, som ärvt ett krav som inte syns i
  någon signatur.
  *En villkorad skrivning* (jämför en version eller en hash mot den lästa och
  vägra skriva om filen ändrats) förkastades av tre skäl: den kräver ett nytt
  fält i datafilen eller ett nytt tillstånd i modulminnet, alltså en ändring av
  lagringsformatet eller en cache som filen på disk annars är ensam sanning för;
  den kräver ett nytt svenskt felmeddelande och ett svar till användaren på
  "någon annan hann före", vilket i en app för en person på en enhet är ett fel
  utan mening; och den gör inte ändringen av — den avvisar den, medan kravet är
  att två snabba klick ska spara båda.
  Kvar blev callbacken innanför köplatsen, som är den form `LARDOMAR.md`
  bokstavligt anger. Kontraktet valdes så att `DELETE` inte behöver en andra
  läsning: `mutera` svarar `null` för "skriv inte", och `updateEntries` uppfyller
  sig då med `null`, vilket blir `404`. Det ger ett bestämt facit också när samma
  `id` tas bort två gånger samtidigt — ett `204` och ett `404`. Att `mutera` inte
  får anropa `loadEntries` eller `saveEntries` skrevs ut, eftersom en sådan rad
  är en låsning som inget felmeddelande beskriver. Att skrivtabellens rad 1–3
  prövas inuti köplatsen här, till skillnad från i `saveEntries`, skrevs också ut
  — annars hade filen två svar på när valideringen sker. **Byggaren ska:** lägga
  `updateEntries` i `storage.js` med den pseudokod som står under "Läs–ändra–
  skriv i ett steg", byta `handleCreate` och `handleDelete` till ett anrop var,
  och köra de tre samtidighetstestfallen med sin mutation. (påverkat av lärdom:
  **ja**, `2026-09-07 — api: två snabba klick tappar en post eller en
  borttagning`)
- **Knappen som utlöste anropet spärras under anropet, men bara den knappen** —
  serverns korrekthet och gränssnittets spärr är två frågor, och båda behövs:
  `grep -n "disabled" src/web/*.js src/web/*.html` gav noll träffar, så ett
  dubbelklick på Spara skickade två `POST`. Spärren är `disabled = true` före
  `fetch` och tillbaka i ett `finally`; ingen ny text, men en ny regel i
  `style.css` för det spärrade läget — se avsnittet "Knappen spärras under ett
  pågående anrop", som är facit. Att
  spärra hela listan eller hela formuläret under varje anrop förkastades: det
  gör gränssnittet trögt för att dölja ett fel som `updateEntries` lagar på rätt
  ställe, och två klick på **olika** Ta bort-knappar är ett rimligt handgrepp som
  ska fungera, inte hindras. Att `app.js` då bara hade manuell genomgång gjorde
  bevisbördan större, inte mindre, så spärren fick ett eget körfall mot en
  DOM-attrapp; sedan `tests/app.test.js` tillkom är det två testfall i den filen,
  ett för samma knapp och ett för två olika. **Byggaren ska:** sätta `disabled`
  på den klickade knappen före `fetch` och återställa den i ett `finally` i både
  `submitForm` och `removeEntry`. (påverkat av lärdom:
  **ja**, samma post som ovan)
- **Ett trasigt anrop får inte döda appen: `new URL` innanför `try`/`catch` ger
  `400`, och `createServer` fångar varje avvisning och svarar `500`** — kravet
  "servern får aldrig krascha på ett trasigt lager" hade ingen motsvarighet för
  ett trasigt **anrop**, och det som inte står i en tabell blev inte byggt, precis
  som med skrivvägens OS-fel. Fem av sex prövade förfrågningsrader dödade
  processen. Spärren ligger i `createServer` och inte inuti `handleRequest`, därför
  att den ska täcka varje väg och inte bara `new URL`; en spärr per gren hade
  blivit en ny kopia vid varje ny gren. En `unhandledRejection`-lyssnare
  förkastades — granskaren mätte att den byter kraschen mot en evig hängning med
  sockeln öppen, alltså ett svar som aldrig kommer. Två statuskoder och inte en:
  en oläsbar förfrågningsrad är klientens fel (`400`), ett kast i en hanterare är
  appens (`500`). `400`-raden återanvänder `Kunde inte tolka anropet.` från
  `api.js` i stället för att införa en andra text — strängen säger "anropet", inte
  "kroppen", och en ny sträng för samma sak är det ägarregeln förbjuder.
  `500`-raden fick en ny sträng, `Ett oväntat fel inträffade. Försök igen.`, och
  felets eget meddelande når aldrig användaren: det kan vara engelsk OS-text eller
  bära en sökväg, samma skäl som skrivtabellens rad 7 har. Att JSON-formen därmed
  gäller utanför `/api/*` skrevs in som ett avgränsat undantag i "Statiska filer",
  eftersom rad S2 kan inträffa på vilken väg som helst — `/api/*` inräknad — och
  ett annat format där hade gett två format för samma svar. `createServer` fick
  `handler` som argument med `handleRequest` som defaultvärde: annars finns ingen
  indata som når spärren, och en gren ingen indata når är enligt projektets egen
  regel ingen spärr utan en osann uppgift. Det är samma seam som
  `handleApiRequest(req, res, pathname)` och `resolvePort(env)` redan har, av
  samma skäl. Ingen loggning till `stderr` infördes: svaret är hela hanteringen.
  **Byggaren ska:** lägga `new URL` innanför `try`/`catch` med rad S1 som svar,
  skriva `handler(req, res).catch(...)` i `createServer`, bygga
  `sendUnexpectedError` med `res.headersSent`-grenen, exportera
  `UNPARSABLE_MESSAGE` från `api.js`, och köra de två mutationerna under
  "Teststrategi" med namnet på det fallerande testet inklistrat. Den
  instruktionen täckte bara avvisningen; det synkrona kastet avgörs i beslutet
  längre ned i loggen, och mutationerna är sedan dess tre.
  (påverkat av lärdom: **ja**, `2026-09-07 — server: ett enda HTTP-anrop dödar
  hela appen`)
- **`npm start` på en upptagen port svarar på svenska och avslutas med exitkod 1;
  `EADDRINUSE`, `EACCES` och övrigt fick var sin rad** — `listen` rapporterar sitt
  fel som en händelse, så `await new Promise((resolve) => server.listen(...))`
  fångar ingenting och Node kastar händelsen: tolv rader engelskt stackspår från
  användarens enda sätt att starta appen. Rättningen är `server.once('error',
  reject)` i samma `new Promise`. `EACCES` fick en egen text och inte den
  gemensamma, därför att åtgärden är en annan: appen kör inte redan, och texten
  ska inte be användaren leta efter ett fönster som inte finns. Vilka portnummer
  som ger `EACCES` skrivs inte ut — det vore ett påstående om operativsystemet som
  ingen har kört. Rad 3 finns för att invarianten "`start` avvisar alltid med
  `ServerStartError`" ska vara sann också för ett fel ingen har sett; utan den
  hade ett rått OS-fel gått rakt till `stderr` på engelska. `<port>` är argumentet
  till `start` och inte `server.address()`, som är `null` när `listen`
  misslyckats. Översättningen bröts ut till en exporterad `asStartError(port,
  error)` av samma skäl som `resolvePort` bröts ut: rad 2 och 3 går inte att
  provocera deterministiskt i den här miljön, och en rad utan testfall är antingen
  otestad kod eller en rad som måste tas bort. `process.stderr.write` valdes
  framför `console.error`, eftersom `LARDOMAR.md` (2026-09-07,
  felsökningsutskrifter) gör `console.error` i `src/` till ett stoppkriterium i
  diffgranskningen och startfelet inte är en felsökningsutskrift; `console.log` på
  den lyckade raden är oförändrad och berörs inte, eftersom den kontrollen läser
  diffens rader. Byggarens körning av `npm start` mot en upptagen port gav
  exitkod `1` och rad 1:s sträng på `stderr`, och granskaren bekräftade den.
  (påverkat av lärdom:
  **ja**, `2026-09-07 — server: npm start på en upptagen port ger tolv rader
  engelskt stackspår`)
- **HTTP-API-tabellen räknar upp lagringens `500` på alla tre vägarna, och
  avgränsningen i `POST`-raden gäller bara den ena av dess två `500`** — tabellen
  var ett facit som koden och två testfall motsade: `GET` kan ge `500` från
  lagringen, `DELETE` likaså, och `POST`-radens "vid internt fel från
  `createEntry`" läste som en fullständig uppräkning och uteslöt aktivt lagringens
  `500`. En tabell som ser fullständig ut men inte är det blir ett andra facit,
  precis som `totalYearlyOre`-tabellen blev. Den mekaniska kontrollen skrevs in i
  avsnittet i stället för att lämnas som en vana: `grep -n "sendJson(res, "` och
  `grep -n "writeHead("`, och varje statuskod som kan komma ut ur en väg ska stå
  på den vägens rad. Serverskiktets `500` fördes in som en mening under tabellen
  och inte som en fjärde kolumn: den kan träffa varje väg, och en rad per väg hade
  upprepat samma sak fyra gånger. **Byggaren ska:** köra de två `grep`-kommandona
  efter varje ändring i `api.js` och jämföra utfallet mot tabellen, och klistra in
  utdatan i redovisningen för paket 5. (påverkat av lärdom: **ja**, `2026-09-07 —
  dokumentation: HTTP-API-tabellen utesluter tre av kodens statuskoder`)
- **Den fjärde hängningsspärren skrevs in, och undantagslistan blev en tabell med
  en rad per spärr** — `tests/api.test.js` byggde en spärr som filen krävde en
  egen rad för, och raden fanns inte; talet stod dessutom som literalen `5000`
  medan de andra spärrarna ska vara namngivna konstanter på minst 30 000 ms. Att
  låta just den se annorlunda ut prövades och förkastades: skälet till 30 000 ms
  är att en långsam maskin inte ska kunna göra spärren till ett falskt fel, och
  det skälet gäller ett anrop i samma process lika mycket som ett barn i en annan
  — ett anrop som svarar, svarar på millisekunder. Uppräkningen av tre namngivna
  undantag byttes mot en tabell, eftersom paket 5 tillför fler spärrar och en
  uppräkning som måste skrivas om vid varje ny rad är samma sorts fälla som
  "samtliga fyra funktioner" — hur många spärrar paketet till slut tillförde
  behövde tabellen därmed inte veta. Konstantnamnen är två, ett per roll:
  `CHILD_START_TIMEOUT_MS` för väntan på en barnprocess, `RESPONSE_TIMEOUT_MS` för
  väntan på ett svar. Priset skrevs ut i stället för att döljas: en
  mutationskörning där spärren fäller testet tar en halv minut innan den ger exit
  1, vilket är billigare än en körning utan exitkod. **Byggaren ska:** ersätta
  literalen `5000` i `tests/api.test.js` med `RESPONSE_TIMEOUT_MS` på minst
  30 000 ms, lägga in samma konstant i `tests/server.test.js`, och köra
  `grep -n "setTimeout\|AbortSignal.timeout\|Promise.race\|performance.now"` mot
  varje testfil paketet rör innan det lämnas vidare. (påverkat av lärdom: **ja**,
  `2026-09-07 — test: en fjärde hängningsspärr byggdes utan den rad ARKITEKTUR.md
  kräver för den`)
- **Punkt 6 i `app.js`-listan vändes: `showErrors` letar upp de fem kända fältens
  fel i svaret, i stället för att leta upp varje fels fält i formuläret** —
  punkten beordrade en gren som inget serversvar kan nå, eftersom `fieldErrors`
  bara innehåller de fem formulärfälten och `id`-felet skickas som `500` utan
  `fieldErrors`. Två utvägar fanns. Att låta `id`-felet komma som ett `fieldError`
  förkastades: beslutet att det ska ge `500` står sedan paket 2 och är riktigt —
  anropet var korrekt och felet ligger i appen. Kvar blev att vända uppslaget, och
  det löser mer än det onåbara: ett okänt `field` kan då varken hittas eller slå i
  en `null`-referens, det ignoreras, och den allmänna rutan visar svarets `error`
  — så kravet "inget felsvar får leda till att ingenting syns" håller även om
  `api.js` skulle bryta mot sitt eget kontrakt. Att `fieldErrors` bär exakt de fem
  fälten skrevs samtidigt in som ett bindande krav på `api.js`, eftersom en gren
  som tas bort med hänvisning till ett kontrakt kräver att kontraktet står
  skrivet. `GENERAL_ERROR`-grenen i samma funktion står kvar och är inte samma
  sak: den prövar ett värde ur `JSON.parse` av bytes appen inte har skrivit, den
  nås av varje svar utan läsbar JSON-kropp, och `readJson` svarar `{}` för just
  det — den konkreta indata som når den är ett krav på ett testfall (punkt 3 i
  kravlistan för `tests/app.test.js` under "Teststrategi"). **Byggaren ska:**
  vända uppslaget i `showErrors` så att den går igenom `FORM_FIELDS` och söker upp
  varje fälts fel i svaret, och ta bort `withoutField` och dess `return`.
  (påverkat av
  lärdom: **ja**, `2026-09-07 — gränssnitt: withoutField-grenen i app.js kan
  inget serversvar nå`)
- **Den falska meningen om `isValidEntryId` ströks, och sökningen kördes över hela
  filen** — meningen "I dagens `src/core/entry.js` står villkoret skrivet för hand
  på båda ställena; de två raderna ska ersättas av två anrop till
  `isValidEntryId`" var en instruktion skriven i presens, utförd sedan commit
  `10fe469`, och den överlevde paket 3, 4 och 5. Den ersattes av kravet i sig plus
  granskarens körning som visar att kravet är uppfyllt. Sökningen som lärdomen
  föreskriver kördes över hela filen — `I dagens`, `ska ersättas`, `skrivet för
  hand`, `Kvar i paket` — och gav vid det tillfället inga fler falska träffar:
  `Kvar i paket 7` pekade då på ett paket som ännu inte var påbörjat och var
  därmed en öppen uppgift och inte ett påstående om koden. Den raden skrevs om
  till `**Utfört i paket 7:**` när paket 7 var byggt. (påverkat av lärdom: **ja**, `2026-09-07 —
  dokumentation: rättningen av "beskriver kod som inte längre ser ut så" gjordes
  till hälften`)
- **Autostartens felgren fick en egen punkt i teststrategin och en egen rad i
  hängningsspärrtabellen** — mutationskravet tvingade fram ett automatiskt prov
  av `catch`-grenen som skriver felet och sätter `process.exitCode = 1`, och det
  provet väntar på barnets **exit**, inte på en utskriven rad. Den befintliga
  raden för `tests/server.test.js` beskriver väntan på barnets utskrivna rad och
  täcker därför inte den nya väntan: två väntanden med olika vinstvillkor är två
  spärrar, och filen kräver en rad per spärr. Byggarens förslag till rad togs med
  två förtydliganden: kolumn 3 pekar ut punkt 5 under "Paket 5", så att raden har
  ett ställe att peka på, och kolumn 4 skriver ut varför spärren behövs — ett
  barn vars `listen` lyckas fortsätter lyssna och avslutas aldrig, alltså en
  väntan utan exitkod. Punkt 5 skrevs in i samma svep med kraven på exitkod, tomt
  `stdout` och rad 1:s sträng ordagrant på `stderr`, och mutationslistan fick
  raden "ta bort `try`/`catch` runt `start()` i autostarten". Räkningen som
  lärdomen om "samtliga fyra funktioner" varnar för kontrollerades i hela filen:
  `De två sista raderna kom till i paket 5` ströks, eftersom den pekade ut fel
  rader så snart en femte tillkom, och `paket 5 tillför två spärrar till` i
  beslutsloggen skrevs om till `fler spärrar`. Rubriken `Den fjärde
  hängningsspärren skrevs in` står kvar: den beskriver vad som gjordes då, i
  dåtid, och räknar inte spärrarna i dag. Att stycket under "Beteende vid start"
  sade att exitkod `1` bara var arkitektens läsning skrevs om, eftersom kravet nu
  har ett testfall; att koden är `1` är sedan dess kört av byggaren och
  bekräftat av granskaren. (påverkat av lärdom: **ja**, `2026-08-23 — dokumentation: två
  facit i samma fil ger olika svar för samma belopp`, och `2026-09-07 — test: en
  fjärde hängningsspärr byggdes utan den rad ARKITEKTUR.md kräver för den`)
- **`createServer` behåller båda konstruktionerna: `try`/`catch` runt anropet och
  `.catch(...)` på löftet** — föreskriften `handler(req, res).catch(...)` räckte
  inte för teststrategins egen rad S2, som kräver `500` också för
  `createServer(() => { throw new Error('trasig'); })`: ett synkront kast sker
  innan löftet finns, så `.catch` kan inte nå det, och utan `try`/`catch` dör
  processen — precis det som lärdomen om det enda HTTP-anropet handlar om. De två
  fångar alltså olika indata, och ingen av dem är en dubblering av den andra.
  Konsekvensen byggaren pekade på skrevs ut i stället för att lämnas outtalad: en
  hanterare som inte returnerar ett löfte får `.catch` att kasta `TypeError`, som
  fångas av samma `try` och besvaras som rad S2 (eller rad S3 om huvudena redan
  är skrivna). Det behålls. Alternativet
  `Promise.resolve(handler(req, res)).catch(...)` prövades och förkastades:
  produktionsvägen har exakt en hanterare och den är `async`, ett brutet kontrakt
  är ett fel i appen, och `500` med svensk text är rätt svar på ett fel i appen —
  en normalisering hade i stället tyst tagit emot en andra sorts hanterare som
  ingen kod i projektet skickar in, alltså byggt för en framtid som inte står i
  planen. Kontraktet "`handler` ska returnera ett löfte" skrevs därför in vid
  signaturen och under "Ett trasigt anrop får inte döda appen", och en gren utan
  indata får inte stå obevisad: kontraktsbrottet ska ha ett eget testfall,
  `createServer(() => undefined)` med `500` på ett anrop. Att just det svaret
  blir rad S2 är kört av byggaren och bekräftat av granskaren. Kravet skrevs
  först som `500` "på två anrop i rad" och rättades i paket 5, se beslutet
  `"På två anrop i rad" ströks ur kontraktsfallet` längst ned i loggen.
  Mutationen av `createServer` delades i två — ta bort den ena konstruktionen och
  behåll den andra — eftersom en enda mutation inte kan visa att båda behövs. **Byggaren ska:** lägga till testfallet
  `createServer(() => undefined)`, köra de tre mutationerna under "Teststrategi"
  var för sig och klistra in kryssraderna — eller kraschutdatan, om en mutation
  dödar testprocessen. (påverkat av lärdom: **ja**, `2026-09-04 — test: två
  konstruktioner i storage.js körs aldrig och överlever mutation`)
- **Provokationshanteraren kastar på sitt första anrop och svarar som en okänd
  statisk sökväg därefter** — kravet "servern ska svara `404` utan kropp på ett
  andra, vanligt anrop efteråt" motsade sig självt: med en hanterare som alltid
  kastar ger det andra anropet `500`, aldrig `404`. Kravet skrevs om till vad
  hanteraren ska **göra** i stället för till vad servern ska svara oavsett
  hanterare, med den icke-kastande vägen utskriven som `res.writeHead(404)` följt
  av `res.end()`. Att det andra anropets svar är beviset att processen lever står
  kvar; det är hela skälet till att det andra anropet finns. Att den synkrona
  varianten returnerar `Promise.resolve()` på sin icke-kastande väg skrevs ut i
  samma stycke, eftersom det följer av kontraktet ovan och annars ser ut som en
  godtycklighet i testkoden. (påverkat av lärdom: **ja**, `2026-08-23 —
  dokumentation: två facit i samma fil ger olika svar för samma belopp`)
- **Ett lås på datafilen: en instans i taget, och `addressInUse`-texten slutade
  be om en andra** — `ioQueue` och `updateEntries` gjorde varje läs-ändra-skriv
  odelbar inom processen, och felet flyttade då ett lager ut: två serverprocesser
  mot samma datafil gav i den körning som underkände paket 5
  `omgångar där en post tappades: 20 av 20`,
  `svar med 500: 16` och `poster på disk till slut: 20 (förväntat 40)`, medan
  appens eget startfel uppmanade användaren på svenska att göra just det ("Sätt
  PORT till ett annat portnummer om du vill starta en till"). Tre mekanismer
  vägdes mot varandra.
  *Att bara skriva om `addressInUse`-texten* förkastades som ensam åtgärd: den tar
  bort uppmaningen men inte möjligheten. `PORT` står kvar i `resolvePort`, i
  facittabellen och i `EACCES`-radens egen text, så en användare som behöver en
  annan port hittar dit ändå, och då är datan lika oskyddad som förut. En
  uppmaning som tas bort är inte en spärr.
  *Att härleda datafilens sökväg så att två instanser inte kan dela den* — till
  exempel en fil per port — förkastades av två skäl. Det byter en synlig krasch
  mot en tyst: användaren startar på en annan port, ser en tom lista, lägger in
  sina poster igen och har därefter två halva register utan att något fel
  visats. Och det löser inte fallet: `HEMOCHEKONOMI_DATA_FILE` pekar fortfarande
  på samma fil för båda, och porten är dessutom fel nyckel — det är datafilen som
  är resursen, inte porten.
  Kvar blev *ett lås vid start*, och det är beslutet: `start()` tar ett lås på
  `` `${getDataFilePath()}.lock` `` innan porten binds, och instans två avslutas
  med exitkod `1` och rad L1:s svenska text. De två kostnader som fällde ett lås i
  paket 4 är betalda i stället för undvikna: felmeddelandena är utskrivna med
  varje sträng ordagrant i tabellen under "Låset på datafilen", och upplåsningen
  efter en krasch är löst med
  pid i låsfilen plus `process.kill(pid, 0)` — ett lås släpps bara på beviset
  `ESRCH`, aldrig på en gissning, så ett fel faller åt hållet "appen startar inte
  och säger varför" i stället för åt hållet "två instanser skriver över
  varandra". Att låset hör till datafilen och inte till processen eller porten är
  det som gör att tester och två olika datafiler fortfarande fungerar. Ordningen
  lås före `listen` är också ett beslut: den gör "Hemochekonomi kör redan" till
  rad L1:s svar och `EADDRINUSE` till svaret "porten är upptagen av något annat",
  alltså ett facit per fråga. Meningen under "Skrivvägen" som svarade att "en av
  dem vinner hela filen, och ingen fil blir en blandning" är rättad: den var sann
  om filens integritet och falsk om användarens data, och den användes som skäl
  att inte införa något lås. **Byggaren ska:** bygga `src/server/lock.js` och
  `getLockFilePath` enligt "Låset på datafilen", lägga låset i `start` med rad 0
  i `asStartError`, skriva `tests/lock.test.js` med fallen och mutationerna under
  "Paket 5: två instanser mot samma datafil" i teststrategin, och köra
  `npm start` två gånger mot samma datafil och klistra in
  båda utskrifterna och exitkoderna. (påverkat av lärdom: **ja**, `2026-09-02 —
  lagring: två överlappande saveEntries delar samma .tmp-namn`, och `2026-09-07 —
  api: två snabba klick tappar en post`)
- **Mekanismen "inte kört av arkitekten" avskaffades** — markeringen stod på varje
  rad som `grep -n "inte kör\(t\|d\|da\) av arkitekten" ARKITEKTUR.md` träffade.
  Fem var besvarade av en körning och stod ändå kvar, och tre av dem bar
  samma order på tre olika rader, så den som rättade en rad trodde sig klar och
  hade fel på två. Att behålla mekanismen och skriva ut vem som stänger en
  markering prövades och förkastades: en stängningsrutin är ännu en uppgift som
  måste utföras vid rätt tillfälle av rätt agent, och exakt den sortens uppgift
  har den här filen redan misslyckats med fem gånger (`Kvar i paket 3` stod kvar i
  två paket efter att den var utförd). Ett dokument som är bindande ska inte
  innehålla frågor. Reglerna som ersätter den står som preambel överst i den här
  loggen: kört utfall skrivs in med vem som körde det, ett utfall som ingen har
  kört skrivs inte alls utan formuleras som ett krav byggaren ska köra och
  redovisa, och öppna frågor står som punkter i loggen. Samtliga markeringar är
  strukna och de körda utfallen inskrivna som konstateranden; hur många de var
  står inte utskrivet, eftersom antalet ärvdes ur en sökning på singularformen
  och därför var för lågt — påståendet om *noll kvar* går att kontrollera med
  sökningen ovan, påståendet om *hur många det var* gör det inte. (påverkat av
  lärdom: **ja**, `2026-09-02 — dokumentation: ARKITEKTUR.md pekar ut en
  kvarvarande uppgift i paket 3 som redan är utförd`, `2026-09-04 —
  dokumentation: "Kvar i paket 3" står kvar i ARKITEKTUR.md`, och `2026-09-07 —
  dokumentation: antalet avskaffade "inte kört av arkitekten"-markörer räknades
  utan alla böjningsformer`)
- **"På två anrop i rad" ströks ur kontraktsfallet `createServer(() =>
  undefined)`** — kravet var skrivet för rad S2:s provokationshanterare, som
  kastar bara på sitt *första* anrop och därför gör det andra anropets `404` utan
  kropp till ett bevis. Det kopierades till ett fall där hanteraren beter sig
  likadant varje gång, och där bevisar det andra varvet ingenting: granskarens
  körning med bara ett varv gav `tests 22, pass 22, fail 0`, och båda de
  föreskrivna mutationerna gav identiskt utfall med och utan det. Ett krav som
  tillverkar ett test utan innehåll är värre än inget krav — det ser ut som
  täckning. Kravet är nu ett anrop, och skälet till att provokationshanteraren
  ändå kräver två står kvar på sitt ställe. Regeln bakom: ett krav på ett andra
  anrop ska motiveras med vad det andra anropet asserterar som det första inte
  gör, och den motiveringen ska stå utskriven där kravet står. (påverkat av
  lärdom: **ja**, `2026-09-02 — test: summaspärren efter varje addition överlever
  mutation`)
- **`saveEntries` stannar som export, med en skriven regel och ett test som
  upprätthåller den** — `grep -rn "saveEntries" src/` gav 2026-09-07 tio träffar:
  nio kommentarer och definitionen. Exporten har alltså ingen anropare i `src/`
  sedan `api.js` gick över till `updateEntries`, och den enda spärren mot att
  paket 6 eller 7 återinför `loadEntries` följt av `saveEntries` var en mening i
  det här dokumentet. Att ta bort exporten prövades och förkastades: `updateEntries`
  läser innan den skriver, så den kan varken skriva över en fil som läsvägens
  tabell underkänner eller sätta ett känt utgångsläge, och testernas arrange-steg
  skulle då falla på läsvägen i stället för att pröva det de handlar om.
  `saveEntries` är den enda vägen till "filen ska innehålla exakt det här".
  Regeln är därför skriven i klartext under `src/server/storage.js` — en känd
  lista, aldrig en lista som kommer ur en läsning av samma fil — och den fick en
  automatisk spärr i stället för ett löfte: `tests/api.test.js` läser `api.js`
  som text och kräver att importsatsen från `./storage.js` finns på exakt ett
  ställe, är namngiven och inte innehåller `saveEntries`. Vilka mutationer som ska
  fälla just det testet står under "Paket 5: `api.js` importerar inte
  `saveEntries`" i teststrategin och är facit — den här punkten föreskrev från
  början bara en av dem, och den stavningen var den enda spärren råkade fånga. En
  regel som inget test upprätthåller är en mening, och meningar överlever inte tre
  paket.
  (påverkat av lärdom: **ja**, `2026-09-02 — test: kopplingen mellan INTERVALS
  och PAYMENTS_PER_YEAR skyddas inte av något test`)
- **Låsets ägarskap: en post per låssökväg, och ett andra samtidigt anrop mot
  samma datafil avvisas med rad L5** — granskarens körning visade att ett andra
  `start()` som föll på `listen` städade bort det *första* `start()`:s lås
  (`låsfil efter att start 2 misslyckades: ENOENT` medan `server 1 lever
  fortfarande: 200`, därefter `ANNAN PROCESS TOG LASET pid 32500`), och att
  `heldLockPath` som en enda variabel lämnade `a.json.lock` kvar för alltid när
  ett andra lås togs mot `b.json`. Grundorsaken är att ägarskapet bokfördes som
  "en sökväg plus en pid", en bokföring som varken kan säga *hur många* eller
  *vilka* innehavare låset har.
  Tre modeller vägdes mot varandra.
  *En räknare per låssökväg* — `acquireDataFileLock` räknar upp också i grenen
  "pid:en är vår egen", `releaseDataFileLock` räknar ned och tar bort filen först
  vid noll — förkastades. Den lagar symtomet men behåller frågan "vem är den
  andra innehavaren?" obesvarad, och den kräver att varje uppfyllt anrop
  motsvaras av exakt ett släpp: ett släpp för mycket räknar ned för en innehavare
  som fortfarande kör, alltså samma hål en gång till, och ett släpp för lite
  lämnar låsfilen kvar. Den har dessutom ett eget hål som bara en kö stänger:
  räknaren kan gå `1 → 0` i ett släpp vars `fs.unlink` ännu inte körts, medan ett
  överlappande anrop räknar `0 → 1` och uppfyller sig — och när unlink sedan körs
  står räknaren på `1` utan låsfil, alltså en instans som tror sig ha låset och en
  datafil vilken process som helst kan ta. Den löser inte heller den andra halvan
  av fyndet: en
  räknare per sökväg kräver ändå en `Map`, och med `Map`:en på plats är räknaren
  det enda som är kvar att motivera. Framför allt gör den delningen till en
  funktion som ska fungera, och den funktionen finns inte: två `start()` i samma
  process mot samma datafil är två instanser mot en datafil, precis det läge
  låset byggdes för att omöjliggöra, och `PLAN.md` beslut 3 (*en person, en
  enhet*) har det inte.
  *Att förbjuda varje andra `start()` i samma process* förkastades också: ett
  andra anrop **efter** att den första servern stängts är helt riktigt — det är
  vad `tests/server.test.js` gör när det startar om efter ett misslyckat
  `listen`, och det är hur paket 6 och 7 kommer att skriva sina testfall. Ett
  förbud som inte skiljer "samtidigt" från "efter" byter ett hål mot ett stopp.
  Kvar blev *en `Map` från låssökväg till märkning, plus rad L5 för ett andra
  samtidigt anrop mot en sökväg processen redan håller*. Den svarar på båda
  halvorna av fyndet: flera datafiler kan hållas samtidigt och släpps var för sig
  (`releaseDataFileLock(lockPath)` tar sökvägen som argument i stället för att
  gissa), och frågan "vem är den andra innehavaren?" uppstår aldrig, eftersom det
  aldrig finns en andra. Att `start` misslyckas på `listen` och släpper sitt lås
  är därmed alltid rätt: hade någon annan hållit låset hade `start` inte kommit
  till `listen`. Två följdbeslut hör till: låsfilens innehåll är en **märkning**
  (`` `${process.pid}:${randomUUID()}` ``), så att ett släpp kan skilja vårt gamla
  lås från vårt nya, och båda funktionerna ligger i en modullokal löfteskedja
  `lockQueue`, så att bokföringen och filen inte kan komma ur takt mellan två
  överlappande anrop. **Byggaren ska:** skriva om `src/server/lock.js` efter
  pseudokoden och punkterna under "Låset på datafilen", byta `start` till att
  hålla låssökvägen i en lokal variabel och skicka den till varje
  `releaseDataFileLock`, lägga fall 5–10 och 12 i `tests/lock.test.js` och köra
  mutationerna (a)–(f) med kryssraden inklistrad, mutation (e) tio gånger med
  antalet fällda körningar utskrivet. (påverkat av lärdom: **ja**, `2026-09-07 —
  lås: ett misslyckat andra start() i samma process tar bort ett lås som
  fortfarande används`, och `2026-09-07 — test: atomicitetsmutationen fäller det
  utpekade testet i bara hälften av körningarna`)
- **Alla tre onåbara grenarna ströks ur låsets pseudokod: `ENOENT` efter ett
  `EEXIST`, unlink-svaljningen och kastet efter det andra skrivförsöket** —
  byggarens instrumentering över hela sviten gav noll träffar för var och en av
  dem. `ENOENT`-grenen ("låset släpptes emellan: nästa varv") och kastet i
  `försök 2` kan båda nås bara av en **annan** process som rör låsfilen i ett
  fönster på några mikrosekunder mellan två av våra egna anrop, och sådana fönster
  kan inget testfall träffa deterministiskt. `ENOENT` ströks först; de två andra
  behölls en runda till, med kravet att byggaren skulle avgöra saken med en
  körning i stället för med ett resonemang — "ingen indata **når** grenen" och
  "inget test **konstruerar** den" är två olika påståenden. Byggarens körning gav
  `unlink LYCKADES med oppet handtag`, `filen finns efterat: false`,
  `writeFile wx LYCKADES` och ett uppfyllt `acquireDataFileLock`: den enda
  konstruktion som fanns — en märkning med en död pid plus ett öppet handtag på
  låsfilen — når inte grenen i den här miljön, och den utlovade återlämningen
  gäller därför. Bevisen som avgjorde: `GREN unlink-catch: 0` och
  `GREN forsok2-catch: 0` över hela sviten, och båda mutationerna ("ta bort
  `try`/`catch` runt andra skrivförsöket", "kasta vidare i stället för att svälja
  unlink-felet") gav `pass 18, fail 0, EXIT=0`. Priset för strykningen är skrivet
  där det märks: ett fel från `fs.unlink` eller från `försök 2`:s `fs.writeFile`
  lämnar `acquireDataFileLock` rått, går genom `start`:s `try`/`catch` och blir
  rad 3 under "Beteende vid start" — svensk text och `cause` satt, men med portens
  namn i stället för låsfilens. Det priset är billigare än en `catch` som ingen
  indata når: en sådan gren är enligt filens egen regel inte ett skydd utan en
  osann uppgift om vad koden hanterar. Rad L4 påverkas inte, den nås av `mkdir`
  och av `försök 1`, och båda vägarna har testfall. Fall 11 är därmed struket och
  numret återanvänds aldrig. (påverkat av lärdom: **ja**, `2026-09-04 — test: två
  konstruktioner i storage.js körs aldrig och överlever mutation`)
- **`src/web/app.js` fick en automatisk testfil, och kravet på fem redovisade
  körningar mot en slängd attrapp är avskaffat** — beslutet "ingen automatisk
  testfil, men fem redovisade körningar" lade bevisbördan på en mätapparat som
  inte fanns i projektet, och den bevisbördan höll inte: granskarens mutation
  (`const trasig = ( ;` plus ett importnamn som inte finns) gav
  `tests 241, pass 241, fail 0` och `EXIT=0`. Beslutet "ingen
  webbläsarautomatisering" står kvar oförändrat — det motiverar att `click` och
  `submit` inte prövas i en webbläsare, aldrig att filen inte laddas. Två fällor
  följde med tillägget, och båda är stängda i regeltexten i stället för lämnade åt
  paket 6 och 7. Den första: en attrapp som svarar `null` på det den inte förstår
  låter `app.js` gå sönder tyst — därför ska den kasta. Den andra: en attrapp som
  växer efter vad ett testfall råkar behöva blir en halv webbläsare — därför får
  den bara ha det `index.html` och `app.js` verkligen använder, och därför är
  id-jämförelsen mot `index.html` ett eget testfall. Att filen ligger under
  `tests/helpers/` och är incheckad är samma beslut som för
  `interrupted-save.js`: en mätapparat som kastas bort gör mätningen omöjlig att
  göra om. Ingen server och inga timers i `tests/app.test.js` — allt `app.js` gör
  där är löften utan I/O, och det är också skälet till att filen inte har någon
  rad i tabellen över hängningsspärrar. Tillägget är prövat med den mutation som
  avslöjade hålet: byggarens körning av samma syntaxfel ger nu `EXIT=1` med
  `pass 1, fail 10`. (påverkat av lärdom: **ja**, `2026-09-07 —
  test: src/web/app.js kan göras syntaktiskt trasig utan att npm test faller`)
- **Textspärren mot `saveEntries` föreskriver tre stavningar, och "release rör
  inte disken" mäts i filoperationer** — två fynd av samma slag: en regel som
  prövas med den stavning eller det mätsätt regeln själv råkar använda prövar
  ingenting. Spärren i `tests/api.test.js` delade importlistan på `,` och jämförde
  hela elementet, så `saveEntries as spara` gick förbi med `✔` och `EXIT=0` i
  granskarens körning; regeln gäller
  **bindningen** och inte strängen, listan normaliseras därför med
  `del.split(/\s+as\s+/)[0].trim()`, och mutationslistan räknar upp alla tre
  stavningarna språket tillåter — rakt namn, alias och `import * as`. Att
  textspärren inte är det enda skyddet skrivs ut i stället för att antas: samma
  återinföring fäller de tre samtidighetsfallen, och de ska köras och redovisas.
  Byggaren har kört alla tre stavningarna mot den normaliserade spärren och fått
  `EXIT=1` på samma kryssrad.
  På samma sätt lät kravet "låsfilen är oförändrad" villkoret `token === undefined`
  överleva mutation, eftersom en läsning som jämför med `undefined` också lämnar
  filen i fred. Kravet är därför omskrivet till noll filoperationer, mätt genom
  att räkna anropen till `fs.readFile` med originalet återlagt i en `after`-hook,
  och det fick ett eget nummer (fall 12) och en egen mutation (f). Regeln bakom
  båda: ett krav ska formuleras som det som skiljer den rätta koden från den
  trasiga, inte som det som råkar vara sant för båda. (påverkat av lärdom: **ja**,
  `2026-09-07 — test: textspärren mot saveEntries i api.js går förbi med ett
  alias`, och `2026-09-04 — test: två konstruktioner i storage.js körs aldrig och
  överlever mutation`)
- **Den spärrade knappen får en egen regel i `style.css`, och "ingen ny stil"
  ströks** — avsnittet "Knappen spärras under ett pågående anrop" skrev "Ingen ny
  text och ingen ny stil krävs" medan beslutsloggen skrev "ingen ny text och
  ingen ny stil". Den första meningen går att läsa som "behövs inte" och den
  andra som "får inte", alltså två svar på samma fråga. Facit är nu att regeln
  **ska** finnas, och skälet är sakligt: `button.primary` och `button.remove`
  sätter egen `background` och `cursor: pointer`, vilket åsidosätter webbläsarens
  gråtoning, så utan regeln är `disabled` en spärr användaren inte kan se — och
  en osynlig spärr ser ut som en app som inte svarar. Kravet är skrivet som
  utseende och inte som CSS-rader (`cursor` som inte är `pointer`, en dämpning,
  och samma sak under `:hover`), eftersom `style.css` inte har något automatiskt
  test och ett krav på exakta värden bara flyttar granskningen till fel fråga.
  (påverkat av lärdom: **ja**, `2026-08-23 — dokumentation: två facit i samma fil
  ger olika svar för samma belopp`)
- **`lock.js` får importera `getDataFilePath`, och `LOCK_RELEASE_TIMEOUT_MS` fick
  sin rad i hängningsspärrtabellen** — två fynd av samma slag: dokumentet krävde
  något och listade sedan inte det som krävdes. Beroendelistan för `lock.js`
  namngav bara `getLockFilePath`, men rad L1 (och nu rad L5) namnger
  **datafilen**, så modulen måste kunna fråga efter den — ett ord saknades, och en
  byggare som följer listan bokstavligt kan inte skriva rad L1:s sträng.
  `LOCK_RELEASE_TIMEOUT_MS` fanns i `tests/lock.test.js` utan rad i tabellen över
  hängningsspärrar, trots att tabellen är uttömmande och en spärr utan rad ska
  stoppa paketet. Den fick en rad i stället för att tas bort: väntan pekar på en
  fil och inte på ett meddelande eller ett svar, eftersom släppandet i
  `close`-hanteraren är ett löfte ingen anropare kan invänta, och det är en tredje
  roll. (påverkat av lärdom: **ja**, `2026-09-07 — test: en fjärde hängningsspärr
  byggdes utan den rad ARKITEKTUR.md kräver för den`)
- **Räkneordet ströks ur meningen som inleder `clearView`-blocket** — meningen
  bar uppräkningens antal och uppräkningen bar ett annat, och det är fjärde
  gången ett antal i den här filen är fel. Rättningen är inte en ny siffra utan
  ingen siffra: `clearView` omfattar "dessa element", och blocket under bär
  antalet. Grannmeningen om nya id:n i `index.html` bär inget antal ur ett block
  utan jämför två körningar av samma kommando, och den är därför oförändrad.
  Regeln som följer av de fyra gångerna står nu i sin skarpaste form: ett antal
  som också står i en uppräkning, en tabell eller ett kodblock i samma stycke
  skrivs bara på ett av de två ställena, och det stället är uppräkningen.
  (påverkat av lärdom: **ja**, `2026-09-12 — dokumentation: "omfattar den fem
  element" står tre rader ovanför en uppräkning med sex`, och `2026-09-10 —
  dokumentation: "Två nya id:n" i samma stycke som kräver tre FakeElement`)
- **Åldringskontrollen är två kommandon, och det andra är förankrat i orden i
  stället för i fetstilen** — kontrollen lovade att fånga varje markör "utan att
  någon ändrar den" och föll på den första stavning som prövade löftet: den var
  skriven som `**[^*]+ i paket N`, alltså som ett mönster över typografi, och
  varje markör i vanlig löptext gick förbi. Det är samma fel som lärdomen om
  millisekundförbudet — en regel skriven om den form den råkar träffa i stället
  för om sitt skäl — och det upptäcktes bara därför att granskaren läste text som
  kommandot aldrig visade. Tre beslut följde. Kommando B söker efter
  **byggorden** i båda riktningarna kring ett paketnummer och bryr sig inte om
  markeringar. Båda kommandona körs, eftersom inget av dem rymmer det andra: A
  fångar fetstil utan byggord, B fångar byggord utan fetstil. Och B får vara
  trubbigt — det träffar dåtid och planeringstext med flit, därför att ett
  mönster som smalnas tills bara de kända felen återstår bara kan hitta de fel
  som redan är kända. Bredare ordlistor prövades: `ska`, `kommer att`, `skrivs`,
  `görs`, `prövas` och `körs` nära ett paketnummer ger nästan enbart kravlistor,
  som är utfall 3, och gör listan oläsbar utan att tillföra en enda markör.
  Kvar står en känd svaghet, utskriven i stället för bortglömd: ett verb utanför
  ordlistan går förbi B, och den som skriver en sådan mening lägger in stammen i
  samma ändring. Kriteriet som avgör utfall 2 mot utfall 3 fick samtidigt en
  operativ form — **påstår meningen en avsaknad?** — eftersom "byggs i paket N"
  är en tilldelning och "byggs ut i paket N" är ett påstående om att koden saknar
  något i dag. B prövades mot de markörer som fanns **innan** de rättades, inte
  efteråt; en rutin som bara körts mot färdigrättad text bevisar ingenting.
  (påverkat av lärdom: **ja**, `2026-09-12 — dokumentation: fyra
  framtidspåståenden om paket 7 är nu falska, och den nya rutinen fångar inget av
  dem`, `2026-09-07 — dokumentation: ARKITEKTUR.md förbjuder den
  millisekundkonstant LARDOMAR.md kräver`, och `2026-09-10 — dokumentation: "det
  är punkt (13) som är dess test" prövades inte med den mutation punkt (14)
  prövades med`)
- **Varje mening som sa att `dates.js`-hälften och dragningsavsnittet återstod
  skrevs om i dåtid** — samma påstående stod på fem ställen: i trädvyn över
  `tests/`, i teststrategins punkt om enhetstester, i inledningen till
  "Datum och dragningar", i inledningen till `src/core/dates.js` och i stycket
  efter dess gränssnittsblock. Det femte hittades av kommando B och inte av
  granskaren, vilket är hela skälet till att B finns. Utfallet skrivs på **ett**
  ställe — under `src/core/dates.js` — och de övriga hänvisar dit i stället för
  att upprepa det, eftersom samma order tidigare har stått på tre rader och den
  som rättade en av dem hade fortfarande fel på två. Tre rader i trädvyn med
  formen "byggs ut i 6 och 7" rättades i samma svep fastän granskaren bara
  namngav en av dem: `index.html`, `src/web/app.js` och `tests/app.test.js` bär
  alla sitt paket 7-arbete i dag, och att rätta ett av fyra likadana påståenden
  är den vanligaste halvrättningen i den här filens historia. (påverkat av
  lärdom: **ja**, `2026-09-11 — dokumentation: det osynliga blanksteget rättades
  i dokumentet och lämnades kvar i testfilen`, och `2026-09-07 — dokumentation:
  rättningen av "beskriver kod som inte längre ser ut så" gjordes till hälften`)
- **Escapekravet skrevs om från ett tecken till en teckenklass, och de fyra råa
  U+2013 ströks** — regeln hade formulerats om ett tecken i taget, och varje
  rättning hade sökt efter just det tecken posten namngav. Följden var att
  meningen som förbjuder råtecknet skrev ordet "escapen" som själva råtecknet,
  och att det bindande kodblocket för `UNKNOWN_TOTAL` inte var den rad
  `src/web/app.js` innehåller. Rättningen är gjord efter **regeln** och inte
  efter radnumren: sökningen kördes över hela filen med alla tre kodpunkterna i
  en teckenklass, och varje träff bedömdes en och en. Kvar står bara U+2013 i
  löptext — intervall som `1–12`, tabellernas platshållare `–` och
  sammansättningar som `Läs–ändra–skriv` — och den gränsdragningen är nu utskriven
  i regeltexten, så att nästa läsare inte behöver gissa om en träff är ett fel.
  (påverkat av lärdom: **ja**, `2026-09-14 — dokumentation: U+2013 står rått i
  ARKITEKTUR.md, även i meningen som förbjuder det`, och `2026-09-11 —
  dokumentation: det osynliga blanksteget rättades i dokumentet och lämnades kvar
  i testfilen`)
- **De fem antalen om `tests/dates.test.js` ströks i stället för att rättas** —
  talen stod i prosa utan sitt kommando, och ordet "träffar" har två läsningar
  som ger olika svar på just de två punkter där talen var fel: `grep -c` räknar
  rader, `grep -o | wc -l` räknar förekomster, och två rader i filen bär sitt namn
  två gånger. Att skriva in rätt tal hade löst fel problem — nästa tillägg gör
  dem fel igen. Påståendet är därför omformulerat till det som ska vara sant och
  som inte kan bli fel av ett tillägg: varje namn i blocket ger minst en träff,
  med kommandot utskrivet och utan antal. Det är den form lärdomen rekommenderar.
  (påverkat av lärdom: **ja**, `2026-09-14 — dokumentation: fem antal skrevs in i
  ARKITEKTUR.md utan kommandot, och två av fem stämmer inte`, och `2026-09-07 —
  dokumentation: antalet avskaffade "inte kört av arkitekten"-markörer räknades
  utan alla böjningsformer`)
- **De fyra granskningsframtvingade testfallen fick sina punkter: (24), (25),
  (S1) och (S2), och `tests/schedule.test.js` fick en egen numrerad serie** —
  numren `(24)` och `(25)` fanns i testfilen men inte i dokumentet, och
  `tests/schedule.test.js` hade ingen kravlista alls. Två beslut om formen följde.
  Serien för `tests/schedule.test.js` får prefixet `S`, så att ett nummer i en
  testfil kan slås upp på exakt ett ställe. Och listan numrerar bara de fall som
  ensamma fäller en namngiven mutation — en kravlista som utger sig för att
  räkna upp allt men inte gör det blir ett andra facit, vilket den här filen redan
  har straffats för. Kollationsfallets teknik — att `String.prototype.localeCompare`
  och `Intl.Collator` ersätts under sorteringen — fick ett eget stycke med syfte,
  återställning, räckvidd och det den **inte** kan upptäcka, på samma villkor som
  en ny hängningsspärr. Granskarens mätningar står inskrivna där i stället för i
  en testkommentar. (påverkat av lärdom: **ja**, `2026-09-14 — test: fyra
  obligatoriska testfall byggdes utan sin rad i ARKITEKTUR.md, och två av dem
  numrerar punkter som inte finns`, och `2026-09-07 — test: en fjärde
  hängningsspärr byggdes utan den rad ARKITEKTUR.md kräver för den`)
- **Steg 2 i `nextDueDate` görs mätbart genom ett injicerbart `addMonths`, och
  kravet står kvar som krav** — de två kodvarianterna ger samma svar för varje
  indata, så egenskapen som ska skyddas är ett **arbete** och inte ett värde.
  Tre vägar vägdes. Att stryka kravet förkastades: det är inte otestbart, bara
  osynligt i ett returvärde, och `upcoming` anropar `nextDueDate` en gång per post
  vid varje rendering. Att bryta ut hoppsteget till en egen exporterad funktion
  förkastades: testet hade då prövat att den räknar rätt, medan mutationen består
  i att `nextDueDate` slutar **använda** den — skyddet hade hamnat bredvid hålet.
  Ett tak på antalet korrigeringsvarv förkastades trots att det fäller mutationen:
  ingen giltig indata når den grenen, och en gren som ingen indata når ska tas
  bort, inte byggas. Kvar står lärdomens egen form. Priset skrivs ut i stället för
  att döljas: produktionssignaturen får ett argument som bara tester skickar, och
  det argumentet får därför en egen spärr med svensk text, sist i kedjan, med den
  indata som visar varför placeringen spelar roll. Returvärdet får ingen egen
  spärr — `compareIsoDates` äger den frågan, och en andra kopia vore ett känt fel.
  Samtidigt förbjuds assertionsmeddelanden som namnger `k`: variabeln är
  modulintern, och `k = 1 ger den klampade 2026-04-30` är ett påstående raden inte
  prövar. (påverkat av lärdom: **ja**, `2026-09-14 — test: steg 2 i nextDueDate
  kan tas bort utan att något test faller, och det nya fallet påstår sig förankra
  k`, `2026-09-02 — datamodell: cost.js har en egen, svagare kopia av "är detta
  ett objekt"`, och `2026-09-04 — test: två konstruktioner i storage.js körs
  aldrig och överlever mutation`)
- **(S1):s mutation skrevs om till kodens eget uttryck, och antalet varv ströks
  ur mätbarhetsavsnittet i stället för att rättas** — två textfel från förra
  rundan, båda av samma slag: dokumentet beskrev kod och körningar som inte var
  dess egna. (S1)-raden citerade `addMonthsClamped(entry.startDate, k * step)`,
  ett uttryck signaturändringen i samma paket hade skrivit bort;
  `grep -n "addMonthsClamped(entry.startDate" src/core/schedule.js` gav noll
  träffar och `grep -n "addMonths(entry.startDate" src/core/schedule.js` rad 90
  och 102. Raden pekar nu ut kodens uttryck, och eftersom det står på två ställen
  säger (S1)-stycket vilket av dem mutationen gäller — en mutation som inte går
  att tillämpa ordagrant hör inte hemma i en lista som inleds med "Varje mutation
  körs en i taget". Varvtalet `674` hörde till ett `today` i mars medan meningen
  namnger `2026-09-15`, där körningen ger `680`. Talet rättades inte utan
  formulerades bort: antalet varv beror på både `startDate` och `today`, så varje
  tal i löptext blir falskt av nästa datumändring, medan (S3) redan kräver att
  byggaren redovisar det uppmätta antalet ur sin egen körning. Det är sjätte
  gången ett antal i den här filen är fel, och ett tal som inte står här kan inte
  bli fel en sjunde gång. (påverkat av lärdom: **ja**, `2026-09-14 —
  dokumentation: (S1):s mutation i ARKITEKTUR.md citerar ett uttryck som inte
  längre finns i koden`, och `2026-09-14 — dokumentation: "674 varv" är antalet
  för ett annat today än det meningen själv namnger`)
- **Kontraktet för det injicerade `addMonths` dokumenteras i stället för att
  bevakas: "går att anropa" och "flyttar framåt" får ingen spärr** — granskaren
  mätte att `typeof addMonths !== 'function'` täcker ett av kontraktets led:
  `typeof (class C {})` är `'function'`, så en klass passerar raden och anropet
  ger `TypeError: Class constructor C cannot be invoked without 'new'`, och en
  funktion som inte flyttar `occurrence` framåt hänger för alltid
  (`timeout 8`, `EXIT=124`). Ledet "ger ett datum" har en ägare som håller,
  `compareIsoDates`. Att bygga spärrar för de andra två förkastades. Ingen kod i
  `src/` skickar ett tredje argument, så en sådan spärr kan bara nås av ett test
  skrivet för spärren själv — det är den konstruktion projektet redan tagit bort
  två gånger. "Går att anropa" går dessutom inte att avgöra utan att anropa, och
  ett `try`/`catch` runt anropet skulle sätta modulens namn på varje `TypeError`
  som uppstår inne i `addMonthsClamped`; "flyttar framåt" går bara att avgöra med
  ett tak på antalet varv, och taket är redan förkastat i samma avsnitt. Kvar
  står att skriva ut vad som gäller: en tabell med ett led per rad och ägaren
  utskriven, ett testfall som asserterar att en klass ger `TypeError` och inte
  `RangeError` — så att den dokumenterade gränsen faller om någon senare inför en
  spärr utan att ändra beslutet — och ett förbud mot testfall som skickar in en
  icke-framåtskridande funktion, eftersom en hängning inte ger någon exitkod.
  `typeof`-radens löfte skrevs samtidigt om till det den gör: den avgör ett
  meddelande utan att anropa något. Termineringsbeviset knöts till förvalet på
  båda ställena det står, i algoritmavsnittet och i det nya stycket, och
  kommentaren i `nextDueDate` ska säga samma sak. **Byggaren ska:** skriva om
  kommentaren i korrigeringsloopen så att den namnger `addMonthsClamped` som den
  storhet beviset vilar på och säger att parametern inte bevakas på den punkten,
  och lägga till klassfallet i testlistan för `addMonths`. (påverkat av lärdom:
  **ja**, `2026-09-14 — schedule: spärren för det injicerade addMonths täcker
  bara halva sin egen motivering`, `2026-09-04 — test: två konstruktioner i
  storage.js körs aldrig och överlever mutation`, och `2026-09-04 — test:
  storage-testet hänger för alltid i stället för att falla när barnprocessen inte
  startar`)
- **(S3) mäter två poster med var sin räknare, och den andra posten bär en undre
  gräns utöver taket** — den här posten hör till runda 3:s första fynd och skrevs
  först nu; rättningen gjordes då i testfilen medan det stycke som föreskriver
  (S3):s konstruktion lämnades kvar i den underkända lydelsen, så kravlistan
  beskrev under en hel runda ett test som var strikt svagare än det byggda. Fyndet
  var att båda occurrence-stegen går genom `addMonths`, men att ett tak bara kan
  fällas av *fler* anrop: ett steg som slutar gå genom parametern ger *färre*
  anrop och är därför osynligt för ett tak, och en post vars korrigeringsloop kör
  noll varv räknar dessutom bara ett av de två stegen. Alternativen prövades och
  förkastades. Ett exakt antal anrop för en post: förkastat av samma skäl som
  tidigare — det blir falskt av en tillåten omskrivning av steg 2. Ett tak på ett
  *lägre* tal: förkastat, ett tak fäller fortfarande bara arbete som växer. En
  räknare per anropsställe inne i `nextDueDate`: förkastad, det vore en
  produktionsrad som bara ett test når, samma konstruktion filen redan tagit bort
  två gånger. Kvar står lärdomens egen form: två poster, var sin räknare, och på
  den post vars korrigeringsloop kör minst ett varv en undre gräns **och** ett
  tak, med loopkroppen och steg 2 utpekade i meddelandet. Priset skrivs ut i
  stället för att döljas: den undre gränsen är hårdare knuten till algoritmens form
  än taket, så en tillåten omskrivning av steg 2 som hoppar förbi `today` skulle
  fälla den och skylla på fel orsak — det står nu i (S3)-stycket tillsammans med
  vad nästa läsare ska göra då, nämligen välja om gränsens indata och inte ta bort
  gränsen. Mutationstabellen fick samtidigt två nya rader för (S3): de två
  routningsmutationerna stod bara i en kodkommentar i `src/core/schedule.js`, och
  en mutation som bara står i en kodkommentar går inte att slå upp av nästa
  byggare. (påverkat av lärdom: **ja**, `2026-09-14 — test: loopkroppens väg genom
  addMonths skyddas av inget test, och tas den bort överlever också den mutation
  (S3) byggdes för`, `2026-09-15 — dokumentation: (S3):s kravlista föreskriver den
  form granskningen underkände, inte den som byggdes`, och `2026-09-04 — test: två
  konstruktioner i storage.js körs aldrig och överlever mutation`)
- **Punkt 8 delades i två utfall: ett barn som dör fäller testet, ett barn som
  aldrig hör av sig ger en omtagning med tak** — den tidigare lydelsen band ihop
  de två ("vinner något annat än meddelandet ska testet falla"), och granskarens
  fynd visade vad det kostar: sviten gick röd en gång på 26 fullkörningar på en
  idle maskin, på en enda fork som inte hann skicka `startar`. Testet forkar
  mätomgången plus `N` barn per försök i punkt 7, och punkt 7 tillåter tre
  försök, så en fullkörning startar många hundra barn — en missfrekvens i den
  storleksordning granskaren såg gör en i övrigt grön svit röd med jämna
  mellanrum. Byggaren lämnade tillbaka i stället för att bygga, vilket var rätt:
  rättningen motsäger en bindande rad och är därmed arkitektens fråga.
  Att avvisa ändringen och behålla lydelsen prövades och förkastades: en
  slutgranskning av hela flödet kan inte vila på en svit vars utfall avgörs av
  om en fork hann starta. Att i stället höja `CHILD_START_TIMEOUT_MS` prövades
  och förkastades — det flyttar gränsen utan att ändra vad som händer vid den,
  och en fork som inte schemalagts inom 30 sekunder blir inte mer sannolik att
  ha schemalagts inom 60. Att göra om *varje* utfall prövades och förkastades:
  `exit` och `error` är deterministiska fel (byggarens körning med felstavat
  filnamn gav `exitCode=1` och en `stderr` som pekar ut modulladdaren, varje
  gång), och en omtagning där upprepar bara samma fel och fördröjer beskedet.
  De två utfallen är redan åtskilda i koden, som sätter utfallets sort innan
  `assert.fail`, så avgränsningen är ett tillägg i dokumentet och inte en ny
  konstruktion.
  Omtagningen betyder olika saker på testets två anropsställen, och båda står nu
  utskrivna: i mätomgången finns ingen omgång att kassera, så `tKlar` mäts om
  från början, medan ett kasserat varv i omgångsloopen körs om med **samma**
  `delays[i]`. Att hoppa över varvet prövades och förkastades — det lämnar ett
  hål i det fönster punkt 3 lägger ut jämnt över skrivningen, och punkt 4:s båda
  grenar blir svårare att nå av ett skäl som inte har med skrivningen att göra.
  Priset skrivs ut i stället för att döljas: en omtagning **döljer** ett barn
  som systematiskt inte hinner starta, och det är därför taket finns.
  `MAX_CHILD_START_RETRIES` är testövergripande och inte per väntan, eftersom
  ett tak per väntan släpper igenom hur många spridda omtagningar som helst och
  varje omtagning kostar upp till `CHILD_START_TIMEOUT_MS` i körtid. Nås taket
  faller testet med antalet omtagningar, orsaken och barnets `exitCode`,
  `signalCode` och `stderr` — en systematisk startoförmåga ger alltså fortfarande
  rött, bara efter ungefär fyra spärrlängder i stället för en. Värdet `3` är
  skrivet som ett val och inte som en mätning, med den saknade mätningen
  utpekad. Namnet blev `RETRIES` och inte `ATTEMPTS`, som byggaren föreslog,
  därför att punkt 7 redan använder ordet *försök* om sina tre uppsättningar.
  Punkt 7 fick en egen mening om att en startomtagning inte förbrukar något av
  de tre försöken: de justerar `windowFactor` och `entryCount` efter räknarna,
  och ett barn som aldrig startade ger inget underlag för någondera. Byggarens
  bedömning att taket inte är en ny tidsberoende konstruktion prövades och
  håller i två led: undantagslistans egen kontroll är en sökning efter
  `setTimeout`, `AbortSignal.timeout`, `Promise.race` och `performance.now`, och
  en räknarkonstant träffas inte av något av mönstren — men viktigare är att ett
  kasserat varv inte rör `gamlaListan` eller `barnetsLista`, så taket kan inte
  påverka utfallet av ett prov som blev av. Undantagstabellens rad för
  `tests/storage.test.js` beskrev tre `exit`-fall som spärrens villkor; den är
  omskriven till den fork som hänger, och avvikelsen "spärren fäller inte ensam"
  står nu i stycket ovanför tabellen, så att tabellen och punkt 8 inte ger olika
  besked om samma rad. **Byggaren ska:** låta väntan på `startar` returnera sitt
  utfall i stället för att fälla testet på egen hand, fälla omedelbart på `exit`
  och `error` med `exitCode`, `signalCode` och `stderr`, och på `timeout` döda
  barnet, invänta dess `exit`, räkna upp en testövergripande räknare och göra om
  uppsättningen — mätomgången från en ny mätning av `tKlar`, ett varv i loopen
  från `await saveEntries(before)` med samma `delays[i]`; införa
  `MAX_CHILD_START_RETRIES = 3` i `tests/storage.test.js`, låta den timeout som
  skulle bli omtagning nummer fyra fälla testet med antalet omtagningar och
  orsaken utskrivna, skriva ut antalet startomtagningar i samma svep som punkt
  7:s mätvärden också när det är `0`, och redovisa två körningar: en med barnets
  filnamn felstavat (ska ge exit 1 inom några sekunder med ett `exitCode` som
  inte är `null` och en `stderr` som inte är tom) och en i en kopia av trädet med
  `CHILD_START_TIMEOUT_MS` satt till `1` (ska falla på taket med orsaken
  `timeout`). (påverkat av lärdom: **ja**, `2026-09-04 — test: storage-testet
  hänger för alltid i stället för att falla när barnprocessen inte startar`,
  `2026-09-07 — dokumentation: ARKITEKTUR.md förbjuder den millisekundkonstant
  LARDOMAR.md kräver`, `2026-09-07 — test: kravet "två anrop i rad" gav
  kontraktstestet en loop som inte kan fälla någon mutation`, och `2026-09-04 —
  test: två konstruktioner i storage.js körs aldrig och överlever mutation`)
- **`src/core/schedule.js` fick en egen numrerad spärrtabell, och `upcoming`
  skrevs som funktionens gång i stället för som en tabell** — modulen kallade sig
  själv ägare av hela sin indatakedja, men kedjan och merparten av dess svenska
  strängar gick inte att slå upp i den här filen. Följden var mätbar och inte
  teoretisk: utan en utskriven sträng kunde testfallet för det frysta uppslaget
  bara asserta feltypen, och feltypen delas av varje spärr i modulen och av
  `dates.js` — så mutationen av just den raden överlevde med grön svit. Formen är
  hämtad från `cost.js`, som fick sin tabell av samma skäl. `nextDueDate` blir en
  numrerad tabell därför att dess villkor körs sekventiellt i en enda funktion.
  `upcoming` blir det **inte**: dess villkor varvas med `nextDueDate`-kedjan i en
  loop över posterna, och en numrerad tabell skulle där ge ett annat svar än
  koden. I stället står loopens ordning som pseudokod, följd av indata där mer än
  ett villkor är sant samtidigt och det vinnande meddelandet utskrivet — samma
  behandling som `totalYearlyOre` redan har. Den tidigare enradstabellen för det
  injicerade `addMonths` togs bort ur "Steg 2 görs mätbart" och ersattes av en
  hänvisning till rad 5, så att villkoret och strängen har exakt ett hem; det
  avsnittet behåller sitt eget ämne, alltså varför raden står sist och vad den
  inte lovar. Meningen om "de fyra befintliga radernas företräde" pekar nu på
  tabellens rad 1 till rad 4, som går att slå upp. **Byggaren ska:** köra varje
  indata i tabellen över samtidigt sanna villkor, skriva dem som
  testfall i `tests/schedule.test.js` och klistra in utdatan; kontrollen innan
  paketet lämnas vidare är att slå upp varje sträng som
  `src/core/schedule.js` skickar till `new RangeError(...)` i det här dokumentet,
  och ingen får saknas. (påverkat av lärdom: **ja**, `2026-09-16 —
  dokumentation: schedule.js:s sex felmeddelanden och spärrordning står inte i
  ARKITEKTUR.md, som ändå hänvisar till "de fyra befintliga raderna"`,
  `2026-09-02 — dokumentation: totalYearlyOre-tabellen numrerar spärrarna i en
  ordning koden inte följer`, och `2026-08-23 — dokumentation: två facit i samma
  fil ger olika svar för samma belopp`)
- **(S4): det frysta uppslagets testfall asserterar hela `message`** — en
  `assert.throws` mot enbart `RangeError` kan inte skilja en spärr från en annan
  spärr längre ned i kedjan, och därför överlevde mutationen av
  `Object.hasOwn`-raden. Att lägga till fler prototypnycklar i listan prövades och
  förkastades: nycklarna fanns redan där, och det var assertionens form och inte
  urvalet som var hålet. Punkten numreras trots att kravet "hela `message`" gäller
  varje rad i spärrtabellen, därför att serien numrerar de fall som ensamt fäller
  en namngiven mutation — och mutationstabellen för `tests/schedule.test.js` fick
  raden i samma ändring. **Byggaren ska:** skriva om prototypnycklarna i
  testfallet `nextDueDate kastar RangeError för ett interval utanför tabellen` så
  att var och en kräver hela meddelandet, köra mutationen i tabellen och klistra
  in kryssraden. (påverkat av lärdom: **ja**, `2026-09-16 — test:
  Object.hasOwn-spärren i schedule.js överlever mutation, och testkommentaren
  namnger ett skydd assertionen inte ger`, och `2026-08-23 — test: kontrollen av
  antalet fält i isEntry skyddas inte av något test`)
- **Punkt (26): datumcellen får ett testfall där `nextDueDate` skiljer sig från
  `startDate`** — facitraden för cellen hade ingen mutation och inget testfall som
  kunde falla, eftersom all testdata i `tests/app.test.js` har ett `startDate`
  som ligger idag eller de närmaste dagarna. För en post som startar i framtiden
  ger steg 2 `k = 0`, så de två fälten bär samma sträng och assertionen kan inte
  se vilket av dem koden läser. Att i stället skriva om celltabellen till "datumet
  som visas" prövades och förkastades — facit ska säga vilket fält som läses, och
  det är just det påståendet som saknade skydd. Kravet skrevs som ett krav på
  **testdatan** och inte på assertionen, eftersom det är datan som gör skillnaden
  synlig, och regeln generaliserades till varje cell i kortet. **Byggaren ska:**
  lägga in en post med `startDate: '2020-03-31'` och `interval: 'quarterly'` i
  fallet, jämföra cellen mot `upcoming(entries, idag)`:s `nextDueDate` för samma
  post, och köra mutationen i punkt (26):s tabell med kryssraden inklistrad.
  (påverkat av lärdom: **ja**, `2026-09-16 — test: datumkolumnen i kortet
  Kommande dragningar kan bytas mot startDate utan att något test faller`, och
  `2026-09-12 — test: språkargumentet 'sv' i localeCompare skyddas inte, eftersom
  maskinens eget språk är sv-SE`)
- **Mutationen för dagtexten skrevs om till kodens eget uttryck** — raden
  citerade `item.daysUntil === 1`, som är namnet på anropsstället; villkoret står
  i `daysText(daysUntil)` och bär där namnet `daysUntil`. En mutation som inte går
  att tillämpa ordagrant hör inte hemma i en lista som kräver en körning per rad,
  och det är andra gången samma fel rättas i den här filen. Raden stod i löptext
  och inte i en tabell, och det var därför `grep -c`-kontrollen inte kördes mot
  den: kontrollen gäller nu båda formerna. (påverkat av lärdom: **ja**,
  `2026-09-16 — dokumentation: mutationsraden i kravlistan för (21) till (23)
  citerar ett uttryck som inte finns i app.js`, och `2026-09-14 — dokumentation:
  (S1):s mutation i ARKITEKTUR.md citerar ett uttryck som inte längre finns i
  koden`)
- **`daysUntilNextDue` tas bort ur `src/core/schedule.js`** — exporten hade ingen
  anropare i `src/`: sökningen efter namnet där ger definitionen och ingenting
  annat, medan `src/web/app.js` läser fältet `daysUntil` ur `upcoming`. Lärdomen
  ger tre utgångar och alla tre prövades. *Att behålla exporten med raden "ingen
  anropare i `src/` sedan paket N — behålls därför att ..." förkastades:* skälet
  går inte att skriva sant. Den enda andra exporten i projektet som bär den raden,
  `saveEntries`, har ett omöjlighetsskäl — ingen annan väg kan sätta ett känt
  utgångsläge på disk — och här finns inget motsvarande. Funktionen äger inget
  begrepp: räkningen ägs av `daysBetween` i `dates.js` och datumet av
  `nextDueDate`, och kroppen är de två satta efter varandra. Varje prov den bär
  går att skriva mot `upcoming`. *Att låta `upcoming` anropa den förkastades:*
  `upcoming` behöver `nextDueDate` både till fältet och till sorteringen, så ett
  anrop av `daysUntilNextDue` skulle räkna fram nästa dragning en andra gång per
  post, vid varje laddning, sparning och borttagning. Det är dubbelt arbete för en
  garanti mot glidning som redan har ett testfall, och det motsäger avsnittet
  "Steg 2 görs mätbart", som gör just arbetet i `nextDueDate` till ett eget krav.
  Kvar står att ta bort den. Priset skrivs ut i stället för att döljas: proven för
  "dagar kvar" blir omständligare, eftersom var och en måste gå genom en lista och
  plocka ut fältet, och `upcoming` blir enda vägen till storheten.
  **Byggaren ska:** ta bort `export function daysUntilNextDue` ur
  `src/core/schedule.js`; ta bort namnet ur importraden i
  `tests/schedule.test.js`; skriva om testfallen i blocket som i dag står under
  rubrikkommentaren för funktionen så att de prövar fältet `daysUntil` i
  `upcoming([...], today)` med oförändrad indata och oförändrade förväntade tal,
  och namnge `upcoming` i testnamnen; ta bort raden som prövar
  `daysUntilNextDue(new Date(), '2026-08-18')`, eftersom raden intill redan prövar
  samma sak genom `upcoming([new Date()], '2026-08-18')`; skriva om testfallet
  `upcoming räknar samma svar som daysUntilNextDue och nextDueDate för varje post`
  så att `daysUntil` jämförs med `daysBetween(today, rad.nextDueDate)`, med
  `daysBetween` importerad från `../src/core/dates.js` — ägarfunktionen, inte en
  handskriven kopia av uttrycket; slå ihop de prov som efter omskrivningen blir
  ordagrant samma som ett befintligt `upcoming`-fall och redovisa varje
  sammanslagning; och köra `npm test` med `fail 0` och exit 0. (påverkat av
  lärdom: **ja**, `2026-09-16 — arkitektur: daysUntilNextDue byggdes utan
  anropare i src/ och utan den märkning gränssnittsblocket kräver`, `2026-09-07 —
  arkitektur: saveEntries blev en export utan anropare i src/ när updateEntries
  togs i bruk`, och `2026-09-02 — datamodell: cost.js har en egen, svagare kopia
  av "är detta ett objekt"`)
- **Klockan `app.js` läser injiceras av laddaren; `tests/app.test.js` slutar läsa
  den verkliga klockan, och förbudet står kvar oförändrat** — granskaren mätte att
  filen läste klockan på sju ställen medan kontrollen som skulle förbjuda det gav
  noll träffar, och att en midnattspassage gör filen röd på oförändrad
  produktionskod. Två utgångar fanns och den ena är vald. *Att i stället skriva in
  ett undantag för `todayIso()` och dokumentera midnattsspärren förkastades*, av
  tre skäl. `CLAUDE.md` säger att klockan läses på exakt ett ställe och att allt
  annat tar dagens datum som parameter, "annars går de inte att testa" — ett
  undantag i den här filen kan inte upphäva det. Ett test som räknar fram sitt
  facit ur samma klocka som koden under prov är dessutom samma sorts svaghet som
  `'sv'` i `localeCompare` på en svensk maskin och som `let k = 0`: två uttryck som
  sammanfaller för all testdata. Och filen kan då aldrig pröva någon annan dag än
  den dag den råkar köras, vilket är precis vad punkt (27) behöver. *Att byta ut
  `globalThis.Date` eller `Date.now` i testprocessen förkastades:* det träffar
  varje modul i processen, inte bara den som prövas, och ersättning av en inbyggd
  konstruktion är det projektet redan har behövt skriva ett eget stycke för
  (`LARDOMAR.md` 2026-09-14). *Att låta `renderUpcoming` ta dagen som parameter
  förkastades:* anroparen i `app.js` måste ändå läsa klockan någonstans, och
  flyttas läsningen till `loadAndRender` eller till modulens toppnivå blir
  beteendet i en flik som stått öppen över midnatt sämre — parametern vore
  dessutom en parameter utan annan anropare än testet. Kvar står att laddaren äger
  klockan, precis som den redan äger `document` och `fetch`: i webbläsaren kommer
  `todayIso` över nätet, i en Node-körning ur `tests/helpers/frozen-dates.js`.
  Kontrollen skrevs samtidigt om från sex metodnamn till de objekt ett tidsvärde
  kan komma ur, eftersom en sluten stavningslista nu har missat sitt mål fyra
  gånger i projektet. **Byggaren ska:** skapa `tests/helpers/frozen-dates.js`
  enligt punkt 2 och 3 under "Klockan som `app.js` läser är injicerad, inte
  verklig"; bygga ut laddaren enligt punkt 1, 4, 5 och 6 där; ta bort importen av
  `todayIso` ur `tests/app.test.js` tillsammans med hjälpfunktionerna för
  midnattsspärr och datumaritmetik och varje anrop av dem; lägga in konstanterna
  och `starta`-argumentet enligt punkt 7 och skriva om paket 7:s testfall så att
  de bygger sina poster ur `FRYST_IDAG` som inskrivna datumsträngar, utan
  datumaritmetik; lägga till punkt (27); köra den nya kontrollen och kräva noll
  träffar i `tests/app.test.js` och `tests/helpers/dom.js`; köra
  prövningsstavningarna `Date.UTC(2026, 0, 1)` och `Temporal.Now.plainDateISO()`
  och klistra in en träff för var och en; köra mutationen i punkt (27) och klistra
  in kryssraden; och köra `npm test` med `fail 0` och exit 0. (påverkat av lärdom:
  **ja**, `2026-09-22 — test: tests/app.test.js läser klockan sju gånger, och
  kontrollen som ska förbjuda det ser ingenting`, `2026-09-12 — test:
  språkargumentet 'sv' i localeCompare skyddas inte, eftersom maskinens eget språk
  är sv-SE`, och `2026-09-07 — test: en fjärde hängningsspärr byggdes utan den rad
  ARKITEKTUR.md kräver för den`)
- **Radelementets `className` och `tagName` får var sin assertion, i båda
  renderingsfunktionerna: punkt (28) och (29)** — klassen är enda kopplingen mellan
  raden och de regler `style.css` skriver för `.upcoming` respektive `.entry`, och
  den kopplingen gick att bryta med grön svit. Mutationslistan för kortet räknade
  upp allt som är *innehåll* — nollställningarna, dagtexten, datumcellen — och
  radelementet självt bär ingen text och hamnade utanför, trots att listan ska
  genereras ur den ändrade filen och inte ur det här dokumentet. *Att låta
  `style.css` få ett eget automatiskt test förkastades:* det kräver en
  CSS-tolkare, alltså projektets första beroende, för att pröva en koppling vars
  ena ände redan går att asserta med en rad i en fil som körs. *Att nöja sig med
  punkt (28) och lämna `renderEntries` förkastades:* hålet är mätt i båda
  funktionerna, och en regel som bara gäller den senast skrivna av två likadana
  rader är ingen regel. Kravet är därför skrivet om varje element `app.js` skapar
  och inte om de två rader som är kända i dag, och det fick ett eget avsnitt så
  att regeln och testfallen har ett hem. **Byggaren ska:** skriva testfallen (28)
  och (29) med namnen i tabellen, köra var och en av de fem mutationerna i
  tabellen separat med `EXIT=1` och kryssraden inklistrad, köra `grep -c` för
  varje uttryck före pilen mot `src/web/app.js` och kräva minst `1`, köra
  klassnamnskontrollen från `app.js` till `tests/app.test.js` och redovisa
  utdatan, och köra `npm test` med `fail 0` och exit 0. (påverkat av lärdom:
  **ja**, `2026-09-22 — gränssnitt: radens egen klass i kortet Kommande
  dragningar överlever mutation`, `2026-09-12 — gränssnitt: renderUpcomings två
  nollställningar överlever mutation och kortet motsäger sig självt`, och
  `2026-09-16 — dokumentation: mutationsraden i kravlistan för (21) till (23)
  citerar ett uttryck som inte finns i app.js`)
- **Kravet på `assert.throws` smalnades till den roll det har, i stället för att
  tolv assertioner skrevs om** — lydelsen "varje `assert.throws` ... asserterar
  hela `message`" skrevs i samma runda som tolv assertioner i `tests/schedule.test.js`
  bär enbart feltypen, och en granskare kunde därför inte avgöra om en sådan rad
  var ett fel eller ett godtaget undantag. *Att behålla kravet brett och skriva om
  de tolv förkastades:* granskarens två försvagningsmutationer fälls redan, så
  omskrivningen köper ingen upptäcktsförmåga, och den skulle göra de breda
  typlistorna — `1n`, `Symbol('x')`, `null`, `[]`, `new Date()` — till tolv
  kopior av samma sträng, alltså fler ställen att hålla i synk när ett meddelande
  ändras. Det som verkligen bär skyddet är att **varje spärr har minst en**
  fullmeddelandeassertion, och det var precis den egenskapen som saknades när rad
  2 överlevde sin mutation. Kravet är därför skrivet om den assertionen, och
  undantaget för en bredare värdeuppräkning står utskrivet. Regeln fick samtidigt
  det som gjorde den ofullständig: ett mekaniskt villkor, en sökning per spärr på
  meddelandets fasta del i testfilen, som säger ifrån när en spärr saknar sin
  assertion. **Byggaren ska:** köra sökningen för varje rad i spärrtabellen och
  för varje `-> RangeError:` i `upcoming`-pseudokoden mot
  `tests/schedule.test.js`, klistra in utdatan, och lämna tillbaka paketet till
  arkitekten om någon sökning saknar träff i stället för att lägga till en
  assertion på eget bevåg. (påverkat av lärdom: **ja**, `2026-09-22 —
  dokumentation: "Varje assert.throws ... asserterar hela message" skrevs i samma
  runda som tolv assert.throws utan message`, och `2026-09-07 — dokumentation:
  ARKITEKTUR.md förbjuder den millisekundkonstant LARDOMAR.md kräver`)
- **Räkneordet ströks ur meningen som inleder celltabellen, och kontrollen mot
  konstruktionen fick formen i stället för en ordlista** — "Raden har tre celler:"
  bar antalet som tabellen under den redan bär. Det är femte gången samma
  konstruktion skrivs i den här filen, och andra gången den mekaniska kontrollen
  mot den missar sitt mål: substantivlistan hade inget ord för `celler`. *Att
  lägga till `celler` i listan förkastades* av samma skäl som gjorde kommando A
  otillräckligt — en lista som fylls på med det ord som senast råkade fela kan
  bara hitta de fel som redan är kända. Mönstret är därför förankrat i formen, ett
  räkneord följt av ett eller två ord och kolon sist på raden, och har ingen
  ordlista alls. Kommandot kördes mot hela filen och varje träff lästes: två
  meningar till bar sitt blocks antal och skrevs om utan tal — meningen som
  inleder tabellen över kanonisk form och meningen som inleder tabellen över
  arkitektens kostnadskörning. Flaggan `-i` kom till i samma körning: utan den
  går varje räkneord som inleder en mening förbi, och två sådana rader stod i
  filen — uppräkningen av låsets fall i teststrategin och uppräkningen av
  åldringskontrollens utfall. Också de skrevs om utan tal. Kvarvarande träffar
  räknar något annat än ett blocks rader — ett scenario med två överlappande
  anrop, ett belopp med `100,00` och en `grep`-mätning som redovisas med sitt
  kommando — och lämnades, vilket är det andra av kontrollens två utfall.
  (påverkat av lärdom: **ja**,
  `2026-09-22 — dokumentation: "Raden har tre celler:" står före uppräkningen, och
  kontrollen mot det saknar ordet celler`, `2026-09-12 — dokumentation: "omfattar
  den fem element" står tre rader ovanför en uppräkning med sex`, och `2026-09-10
  — dokumentation: "Två nya id:n" i samma stycke som kräver tre FakeElement`)
- **`createElement`-kravet smalnades till rollen, och de element rollen
  fortfarande träffar fick punkt (30) och (31)** — lydelsen "både `className` och
  `tagName` för varje element" var bredare än de punkter som byggde den: `span`
  och `button` hade klass men inte typ asserterad, `option` ingendera, och
  byggaren byggde riktigt nog inget utan en punkt. Det är samma form som kravet på
  `assert.throws` i samma runda, alltså andra gången ett bindande "varje" skrivs
  bredare än det som byggs, och utgången är därför densamma: kravet skrivs om till
  det skäl det har. Skälet är kontraktet, inte egenskapens namn — klassen därför
  att `style.css` väljer på den, elementtypen därför att en selektor kan namnge
  den (`button.remove`) eller en förälder kräva den (`<ul>` tar `<li>`,
  `<select>` visar bara `<option>`). Med rollen utskriven blir svaret olika per
  element, och tabellen ger det: `span` i `cell` får ett **uttryckligt undantag**
  för elementtypen, eftersom ingen selektor i `style.css` namnger den och rutnätet
  tar vilket barn som helst, medan `button` och `option` får var sin punkt — för
  knappen är typen halva selektorn `button.remove` och bär därmed också det
  spärrade lägets regler, och för valen är typen skillnaden mellan en fylld och en
  tom rullgardin. *Att behålla kravet brett och ge `span` en typassertion
  förkastades:* en assertion som ingen selektor och inget föräldrakontrakt beror på
  fäller bara en ändring som ingen ser, och den vore ett andra facit att hålla i
  synk när en cell byter element. *Att stryka kravet och nöja sig med (28) och
  (29) förkastades:* knappens typ bär en bindande `style.css`-regel och valens typ
  bär formulärets användbarhet — båda är hål, inte smak. **Byggaren ska:** skriva
  testfallen (30) och (31) med namnen i tabellen; köra de två mutationerna i
  tabellen var för sig med `EXIT=1` och kryssraden inklistrad; dessutom köra
  `remove.className = 'remove';` → `remove.className = 'delete';` och visa att det
  är punkt (12) som faller; köra `grep -c` för varje uttryck före pilen mot
  `src/web/app.js` och kräva minst `1`; köra båda sökningarna i "Kontrollen som
  hittar nästa sådant hål" och redovisa utdatan; och köra `npm test` med `fail 0`
  och exit 0. (påverkat av lärdom: **ja**, `2026-09-22 — dokumentation: "Varje
  assert.throws ... asserterar hela message" skrevs i samma runda som tolv
  assert.throws utan message`, `2026-09-22 — gränssnitt: radens egen klass i kortet
  Kommande dragningar överlever mutation`, och `2026-09-14 — test: fyra
  obligatoriska testfall byggdes utan sin rad i ARKITEKTUR.md`)
- **Stubbens formkontroll får punkt (32); kastet när ingen dag är satt skrivs ut
  som avsiktligt oprövat** — de två spärrarna i `tests/helpers/frozen-dates.js`
  överlever var sin mutation, och frågan lärdomen `2026-09-04` ställer har olika
  svar för dem. Ingen av dem är död kod: byggarens körningar nådde båda genom att
  ändra laddaren, så borttagningskravet för en gren ingen indata når gäller inte —
  skillnaden mellan **onåbar** och **nåbar men oprövad** är skriven ut i avsnittet,
  eftersom det är just den skillnaden nästa granskare ska kunna avgöra.
  Formkontrollen nås med en rad i `tests/app.test.js` och får därför ett testfall:
  argumentet `'imorgon'` går genom laddarens väg att byta dag och läser ingen
  klocka, så klockkontrollen står orörd. Kastet när ingen dag är satt nås bara av
  en laddare som importerar `app.js` utan att sätta dagen. *Att skriva ett testfall
  för det förkastades:* den enda vägen dit ur testfilen är att anropa `todayIso()`
  där, och varje sådan väg är en träff i klockkontrollen, som inte får något
  undantag — ett undantag där vore att återinföra hålet i fynd 1. *En egen testfil
  för mätapparaten förkastades* av samma skäl, med tillägget att den skulle stå
  utanför klockkontrollens fillista och att ingen annan hjälpfil har en sådan fil.
  *Att ta bort grenen förkastades:* utan den byter ett glömt sättande ut ett
  svenskt besked som pekar ut laddaren mot ett fel längre in i `src/core/`, vilket
  byggarens körning mätte — grenen är diagnostik för nästa byggare, och beslutet
  att den saknar testfall står skrivet så att det inte behöver upptäckas en gång
  till. **Byggaren ska:** skriva testfallet (32) med namnet i tabellen och kräva
  hela meddelandet, inte bara feltypen; köra mutationen i tabellen med `EXIT=1` och
  kryssraden inklistrad; köra `grep -c` på uttrycket före pilen mot
  `tests/helpers/frozen-dates.js` och kräva minst `1`; skriva in en rad i
  kommentaren över kastet som hänvisar till det här beslutet; köra klockkontrollen
  och kräva oförändrat noll träffar; och köra `npm test` med `fail 0` och exit 0.
  (påverkat av lärdom: **ja**, `2026-09-04 — test: två konstruktioner i storage.js
  körs aldrig och överlever mutation`, `2026-09-07 — lagring:
  felsökningsutskrifter lämnades kvar i src/server/storage.js`, och `2026-09-22 —
  test: tests/app.test.js läser klockan sju gånger, och kontrollen som ska förbjuda
  det ser ingenting`)
- **Kolumnrubriken "ensamt fäller" byttes mot kravet att punktens egen kryssrad
  står i utfallet, och raden för (30) fick en not** — rubriken var ett påstående om
  varje rad i tabellen, och byggarens körning visade att den inte höll för (30):
  DOM-attrappen plockar Ta bort-knappen med `button[type="button"]`, en selektor
  som matchar på elementtypen, så de befintliga borttagningsfallen faller med.
  Tredje gången i samma paket att en formulering är bredare än det som gäller —
  efter `assert.throws`-kravet och `createElement`-kravet — och utgången är
  densamma: skriv kravet så att det går att avgöra rad för rad. *Att stryka punkt
  (30) förkastades:* de äldre kryssraderna namnger borttagning och inte
  elementtypen, så en granskare som bara ser dem letar på fel ställe; punktens
  värde ligger i vad kryssraden säger, inte i att den är ensam. *Att skriva om
  rubriken till "fäller" utan not förkastades:* då försvinner den upplysning nästa
  granskare behöver för att avgöra raden utan att köra om allt. Rubrikerna i de
  andra mutationstabellerna lämnades då oförändrade, med motiveringen att deras
  rader var redovisade som ensamma fällare — den motiveringen höll inte, och
  nästa punkt i loggen rättar den och byter rubrik i samtliga tabeller. Byggaren
  redovisar hädanefter vilka testfall som faller per mutation i den här tabellen.
  (påverkat av lärdom: **ja**, `2026-09-22
  — dokumentation: "Varje assert.throws ... asserterar hela message" skrevs i samma
  runda som tolv assert.throws utan message`, `2026-08-23 — test: kontrollen av
  antalet fält i isEntry skyddas inte av något test`, och `2026-09-14 —
  dokumentation: (S1):s mutation i ARKITEKTUR.md citerar ett uttryck som inte
  längre finns i koden`)
- **Rubriken byttes i samtliga mutationstabeller, och mekanismen som gjorde två
  rader osanna skrevs in** — motiveringen "deras rader är redovisade som ensamma
  fällare" var ett skäl att inte köra, och ett skäl räknas aldrig som en körning.
  Granskarens rad-för-rad-körning visar varför: (24) och (26) ger `fail 2`, och
  den andra kryssraden är i båda fallen punkt (27), som skrevs i samma runda.
  Mekanismen är värd mer än rättningen — **ett nytt testfall kan göra en äldre
  rads ensamhet falsk utan att någon rör raden** — och den står nu som en egen
  regel under "Teststrategi", tillsammans med kravet att en tabell körs om när ett
  nytt fall rör samma vy eller funktion. *Att köra om alla fem tabellerna varje
  rond och skriva in de faktiska kryssraderna förkastades:* det är en skyldighet
  som växer med varje nytt testfall och som just har visat sig omöjlig att komma
  ihåg, medan kravet "punktens egen kryssrad står i utfallet" är avgörbart rad för
  rad och inte blir falskt av ett tillägg. Ensamheten är därmed ingen del av
  kravet men fortfarande en upplysning, och den hämtas ur byggarens redovisning av
  vilka fall som faller. (24) och (26) fick var sin not av samma form som (30).
  Två meningar som bar samma ensamhetspåstående skrevs om i samma ändring:
  kravlistans inledning för `tests/schedule.test.js` och motiveringen till att
  (S4) numreras. **Byggaren ska:** skriva ut vilka testfall som faller för varje
  mutation i varje tabell paketet kör. (påverkat av lärdom: **ja**, `2026-09-22 —
  dokumentation: "deras rader är äkta ensamma fällare" skrevs om fem tabeller utan
  att någon av dem kördes om`, och `2026-09-10 — dokumentation: "det är punkt (13)
  som är dess test" prövades inte med den mutation punkt (14) prövades med`)
- **Laddaren avvisar ett andra `loadApp` i samma testfall i stället för att
  bokföra flera** — krav 5 lovade att det tidigare värdet läggs tillbaka, och
  granskarens körning visar att två anrop i samma test lämnar den **första** dagen
  kvar och båda globalerna satta, eftersom `node:test` kör `after`-hookar i
  registreringsordning och den sist registrerade ögonblicksbilden vinner. *Att
  hålla en räknare eller registrera hooken bara vid första anropet förkastades:*
  båda gör bokföringen sann och lämnar den verkliga faran kvar, att två
  modulinstanser i samma testfall delar `globalThis.fetch` och stubbens dag medan
  båda har lyssnare på attrappens element — ett prov vars utfall ingen kan
  resonera om. Avvisningen är den minsta mekanismen som gör kravet sant, och den
  säger dessutom ifrån i stället för att tyst tillåta en konstruktion som ingen har
  tänkt igenom. Behöver ett senare paket två instanser fattas det beslutet här,
  med ett svar på vad de ska dela. Punkt (33) skyddar avvisningen, och att dagens
  osatta läge inte asserteras är en följd av klockkontrollen och står utskrivet.
  Ordern till byggaren stod här i presens och krävde en `WeakSet` nycklad på `t`
  och ett efterföljande fall som asserterar `undefined` för båda globalerna. Båda
  halvorna är upphävda av senare punkter i loggen — nyckeln av punkten om
  `t.test`, `undefined` av punkten om körmiljöns inbyggda `fetch` — och ordern är
  därför struken här i stället för att stå kvar som ett krav ingen får följa. Det
  som byggdes: krav 8 med en spärr prövad före allt annat, punkt (33) och
  mutationen i dess rad. (påverkat av lärdom: **ja**, `2026-09-22 — test: laddarens
  återställning av den frusna dagen lämnar kvar den första dagen när loadApp
  anropas två gånger i samma test`, och `2026-09-07 — lås: ett misslyckat andra
  start() i samma process tar bort ett lås som fortfarande används`)
- **`compareUpcoming` exporteras och får punkt (S5); löftet om ordningen fick sitt
  villkor** — sista raden, `return 0;`, är modulens enda otäckta rad och överlever
  sin mutation, samtidigt som filen lovade en ordning som "alltid" är stabil och
  oberoende av inmatningsordningen. Två saker var fel, och båda är rättade. Löftet
  gäller under villkoret att två poster skiljer sig på någon av de tre nycklarna —
  för poster som är lika på alla tre är svaret `0`, sorteringen stabil och
  ordningen den de kom in i, vilket är det enda möjliga och nu utskrivet. Och
  raden ska prövas: en jämförare som inte är reflexiv är ett fel oavsett om det
  syns i vyn. *Att skriva ut raden som avsiktligt oprövad förkastades:* grenen nås
  av vanlig indata, provet är några rader, och ett löfte som vilar på en oprövad
  rad är inte ett löfte. *Att asserta på den sorterade listan i stället för på
  jämförarens svar förkastades:* ett sådant prov lutar sig mot hur körmiljöns
  sortering behandlar en jämförare som inte är reflexiv. Därför exporten, som har
  en anropare i `src/` och är samma sorts testsöm som det injicerade `addMonths`.
  **Byggaren ska:** exportera `compareUpcoming`; skriva (S5) med två poster lika
  på `nextDueDate`, `name` och `id`, med `0` asserterat i båda ordningarna och för
  ett item mot sig självt; köra mutationen `return 0;` → `return 1;` med `EXIT=1`
  och kryssraden inklistrad; köra `grep -rn "compareUpcoming" src/` och redovisa
  att både definitionen och anropet syns; och köra täckningskörningen på nytt och
  redovisa att ingen rad i `src/core/schedule.js` står otäckt. (påverkat av
  lärdom: **ja**, `2026-09-22 — test: sista raden i compareUpcoming körs av inget
  test och överlever mutation`, och `2026-09-16 — arkitektur: daysUntilNextDue
  byggdes utan anropare i src/ och utan den märkning gränssnittsblocket kräver`)
- **`setFrozenDay` byter ägare till `isValidIsoDate`, och (32) prövar
  gränsvärdet** — spärren frågade `ISO_DATE_PATTERN`, alltså formen, medan två
  kommentarer lovade att ett felskrivet argument fälls i laddaren och inte inne i
  `schedule.js`. Granskarens körning: `2026-02-30` har rätt form, passerar
  spärren, och faller sedan med `nextDueDate kräver ett dagens datum ...` från
  `src/core/schedule.js` — exakt det kommentarerna säger att den inte gör.
  `dates.js` har två ägare i samma modul, och valet mellan dem var underförstått:
  `ISO_DATE_PATTERN` äger "rätt form", `isValidIsoDate` äger "finns i kalendern",
  och det är den senare frågan spärren lovar ett svar på. *Att i stället skriva om
  de två kommentarerna till "prövar bara formen" förkastades:* då står en
  apparatspärr kvar som släpper igenom precis de värden som ger det förvirrande
  felet längre in, och hela skälet till att spärren finns faller. Meddelandet
  skrevs om så att det säger vad som prövas, och villkoret skrivs utan
  `typeof`-kontroll, eftersom `isValidIsoDate` svarar `false` för varje värde som
  inte är en sträng och en andra kontroll vore en gren ingen indata når.
  **Byggaren ska:** byta villkoret och meddelandet enligt krav 3; skriva om (32):s
  testfall så att det prövar både `'imorgon'` och `'2026-02-30'` med hela
  meddelandet; köra den nya mutationsraden med `EXIT=1` och kryssraden inklistrad;
  skriva om de två kommentarerna så att de namnger den valda ägaren och skälet,
  och köra `grep -rn` på fem ord ur den gamla meningen i `src`, `tests` och
  `ARKITEKTUR.md` före och efter med båda utfallen inklistrade. (påverkat av
  lärdom: **ja**, `2026-09-22 — test: setFrozenDay släpper igenom kalenderogiltiga
  datum, och kommentaren på två ställen påstår motsatsen`, och `2026-09-02 —
  datamodell: cost.js har en egen, svagare kopia av "är detta ett objekt"`)
- **Återställningen av `globalThis.fetch` jämförs med det inlästa värdet, inte
  med `undefined`, och körmiljöns globaler blev ett villkor i miljöavsnittet** —
  kravet på fallet efter (33) var omöjligt att uppfylla: Node har en inbyggd
  `fetch`, så laddaren lägger tillbaka en funktion och aldrig `undefined`.
  Byggaren byggde kravet ordagrant och fick en kryssrad, vilket är rätt ordning —
  ett omöjligt krav ska falla, inte byggas bort. *Att stryka `fetch`-halvan med
  skälet utskrivet förkastades:* då prövas bara den ena av de två globaler
  laddaren rör, och `fetch` är den som en andra ögonblicksbild byter ut mot en
  attrapp — alltså precis den halva (33) finns för. *Att assertera att `fetch`
  bara inte är attrappen förkastades:* det passerar också om återställningen
  lägger tillbaka något tredje. Kvar står identitetsjämförelsen mot det värde
  testfilen läser på modulnivå innan något testfall körts, vilket säger samma sak
  som `undefined` skulle ha sagt i en miljö utan inbyggd `fetch`. Mätningen
  skrevs samtidigt in under "Verifierad miljö" som ett villkor på varje krav om
  en global i ett test, eftersom det är en egenskap hos körmiljön och inte hos
  den här punkten. **Byggaren ska:** lägga tillbaka fallet med
  `FETCH_FORE_TESTERNA` enligt punkten, köra mutationen i (33):s rad och klistra
  in kryssraden för varje fall punkten har, och köra `npm test` med `fail 0` och
  exit 0.
  (påverkat av lärdom: **ja**, `2026-08-18 — miljö: testkommandot i ARKITEKTUR.md
  skrevs ned utan att köras`, och `2026-09-02 — dokumentation: ARKITEKTUR.md:s
  exempelsträng för formatSek är inte den koden ger`)
- **Spärren i krav 8 nycklas på processen och inte på testkontexten** — en
  `WeakSet` över `t` prövar bara den stavning spärren själv är skriven för, och
  ett underordnat test har en egen kontext. Granskarens körning i en kopia: ett
  `loadApp` inuti ett `t.test` passerade, båda instanserna levde samtidigt, och
  förälderns formulärsubmit hamnade i barnets `fetch`-attrapp — ordagrant den
  fara spärren finns för. Fjärde gången en spärr prövas enbart med sin egen
  stavning. *Att låta `WeakSet` ligga kvar och lägga till barnets kontext
  förkastades:* det är samma fel en gång till, eftersom nästa stavning ingen
  tänkt på går förbi igen; villkoret ska skrivas om det som är farligt, två
  levande instanser i samma process. *En räknare som nollställs i en hook
  förkastades* av samma skäl som en räknare förkastades förra rundan: den gör
  bokföringen sann utan att hindra sammanblandningen. Kvar står en modullokal
  flagga, `appLaddad`, nollställd i samma hook som lägger tillbaka globalerna och
  dagen. Ordningen i `loadApp` skrevs ut som bindande — pröva, registrera hooken,
  sätt flaggan — eftersom en flagga som sätts före hooken blir kvar när
  `import()` avvisar, och just det gör syntaxfelsmutationen. Vad villkoret vilar
  på står också utskrivet: att testfallen i en fil körs ett i taget. Punkt (33)
  fick ett tredje testfall, det med `t.test`, som är det enda som skiljer det nya
  villkoret från det gamla. **Byggaren ska:** byta `laddadeTester`-spärren mot
  flaggan enligt krav 8 med den ordningen; byta meddelandet till krav 8:s nya
  text; skriva testfallet `ett loadApp i ett underordnat test avvisas`; köra
  mutationen `if (appLaddad) {` → `if (false) {` och klistra in kryssraden för
  vart och ett av punktens tre fall; köra `grep -c "if (appLaddad) {"
  tests/helpers/dom.js` och kräva minst `1`; och köra `npm test` med `fail 0` och
  exit 0. (påverkat av lärdom: **ja**, `2026-09-22 — test: WeakSet-spärren i
  loadApp går förbi med t.test, och de två modulinstanserna byter fetch med
  varandra`, `2026-09-07 — test: textspärren mot saveEntries i api.js går förbi
  med ett alias`, och `2026-09-12 — test: språkargumentet 'sv' i localeCompare
  skyddas inte, eftersom maskinens eget språk är sv-SE`)
- **Tre påståenden som åldrats rättades i samma svep: den upphävda ordern,
  `fail 1`-raden och täckningssiffran** — alla tre är samma form, ett påstående i
  presens om ett läge som en senare ändring har gjort falskt, och alla tre kostade
  eller kunde ha kostat en vända. Ordern för punkt (33) krävde fortfarande en
  `WeakSet` på `t` och `undefined` för båda globalerna, alltså två krav som
  senare punkter i den här loggen upphäver; den är struken och ersatt av vad som
  faktiskt byggdes, eftersom en order som ingen får följa inte hör hemma i en
  bindande fil. Meningen "medan övriga rader ger `fail 1`" är utbytt mot
  granskarens rad-för-rad-körning, skriven i dåtid och med en mening om varför
  talen inte ska läsas som ett facit: de ändras så snart en punkt får ett testfall
  till, vilket är just det kolumnrubriken inte längre påstår något om.
  Täckningssiffran för `schedule.js` stod i presens med det gamla värdet och står
  nu i dåtid, följd av vad samma körning ger efter att (S5) byggdes. *Att skriva
  om `fail`-talen till ett krav förkastades:* de är en upplysning ur en körning,
  och ett antal som blir fel av nästa testfall ska inte vara bindande. Regeln som
  följer, och som gäller varje sådan rättning: ett påstående om ett läge skrivs i
  dåtid med den som körde utskriven, och ett krav skrivs som ett krav.
  (påverkat av lärdom: **ja**, `2026-09-22 — dokumentation: byggarordern för punkt
  (33) kräver fortfarande det undefined som samma fil förbjuder`, `2026-09-22 —
  dokumentation: "medan övriga rader ger fail 1" motsägs av två av filens egna
  rader`, och `2026-09-22 — dokumentation: täckningssiffran för schedule.js står i
  presens och är inte längre den körningen ger`)
- **Två fynd i `tests/helpers/dom.js` är inte paket 7:s och lämnas till nästa
  paket som rör filen** — granskaren fann att `FakeElement.querySelector` har en
  `#`-gren som ingen indata når, och att `document.querySelector` i attrappen
  svarar `null` för ett okänt id trots att den här filen kräver ett **kast** av
  attrappen ("Attrappen är sträng"). Båda är oförändrade sedan `dd5ddaf`, alltså
  från paket 5 eller 6, och ingen av dem rör det paket 7 bygger. De skrivs upp här
  i stället för att rättas nu, av skälet i `CLAUDE.md`: en uppgift i taget, och en
  rättning i mätapparaten mitt i ett paket som just har verifierats om skulle göra
  granskningens körningar ogiltiga. Nästa paket som rör `dom.js` avgör dem, och
  kravet står redan skrivet under "Attrappen är sträng": en gren ingen indata når
  tas bort, och ett okänt id ska ge ett kast och aldrig `null`. (påverkat av
  lärdom: **ja**, `2026-09-04 — test: två konstruktioner i storage.js körs aldrig
  och överlever mutation`)
- **Ett `404` från `DELETE` följs av en omhämtning; `500` och ett avvisat `fetch`
  lämnar vyn orörd** [paket 8] — slutgranskningen mätte att en borttagning av en
  post som en annan flik redan tagit bort lämnar raden kvar i listan, i båda
  totalerna och bland kommande dragningar, bredvid texten som säger att posten
  inte finns. Regeln för vyn efter en **borttagning** fanns inte i den här filen
  alls; beslutet låg som en kommentar i ett testfall, och det var skrivet för
  alla misslyckade svar. Skillnaden som saknades är vad svaret säger om
  **datafilen**: `404` är ett definitivt besked om att filen har ändrats sedan vyn
  hämtades, medan `500` och ett avvisat anrop säger att appen inte vet något nytt.
  *Att hämta om vid varje misslyckat svar förkastades:* en omhämtning som själv
  misslyckas nollställer vyn, och då tar appen bort information användaren
  fortfarande kan läsa, på grundval av ett svar som inte sade något om filen.
  *Att lämna allt orört och i stället skriva en text som ber användaren ladda om
  förkastades:* appen har redan beskedet och kan visa rätt läge, och en app som
  ber användaren göra jobbet döljer en rättning som är fyra rader. Ordningen
  mellan `showErrors` och omhämtningen är skriven som bindande med den indata där
  den ändrar svaret — `404` följt av en `GET` som ger `500` — och den indatan är
  det andra av punkt (34):s två testfall. Att fallet bara nås med två vyer mot
  samma datafil är skälet att det överlevde sju paket; testfallen bygger det
  läget med `fetch`-attrappen i stället, alltså utan en andra process.
  **Byggaren ska:** lägga 404-grenen i `removeEntry` efter `showErrors(...)`
  enligt facittabellen; skriva punkt (34):s två testfall med assertioner på alla
  tre vyelementen i det första; köra de två mutationerna i tabellen var för sig
  med `EXIT=1` och kryssraden inklistrad; köra `grep -c` på båda uttrycken före
  pilen mot `src/web/app.js` med minst `1`; och köra `npm test` med `fail 0` och
  exit 0. (påverkat av lärdom: **ja**, `2026-09-22 — gränssnitt: en borttagning
  som ger 404 lämnar posten kvar i listan, i båda totalerna och bland kommande
  dragningar`, och `2026-09-07 — gränssnitt: withoutField-grenen i app.js kan
  inget serversvar nå`)
- **Beloppet fortsätter avvisas, men meddelandet säger vad användaren ska skriva**
  [paket 8] — `12 000` är det normala svenska skrivsättet och dessutom appens
  eget utmatningsformat, och det avvisades med `Beloppet måste vara ett tal.`,
  en text som är sann men inte till någon hjälp. *Att låta `AMOUNT_PATTERN`
  acceptera blanksteg som tusentalsavgränsare förkastades av användaren* som för
  ingripande: det ändrar vilka värden som är giltiga i projektets mest granskade
  kod — en facittabell, en regelkedja i fyra steg och en invariant mot `isEntry`
  vilar alla på att normaliseringen är en enda smal väg. Det valet står utskrivet
  i avsnittet, så att nästa läsare ser att avvisningen är ett beslut och inte ett
  förbiseende. Kvar står en egen rad i felmeddelandetabellen med en text som
  namnger skillnaden och visar två exempel som båda är giltig indata — en
  vägledning som visar ett format appen avvisar vore samma fel en gång till.
  Raden är skriven om **värdets form** och inte om råvärdets typ, så regeln
  "samma värde, samma `message` oavsett ingångstyp" står orörd. Två saker kom
  till utöver texten. Villkoret fick en längdgräns av samma slag som snabbvägen i
  `checkName`, eftersom mönstret läser hela strängen och `amountSek` annars
  skulle förlora den billiga avvisningen `LARDOMAR.md` 2026-08-23 mätte. Och
  rundgången `formatSek` → `validateEntryDraft` blev ett obligatoriskt testfall:
  den saknades i projektet, och det är därför felet kunde stå i sju paket —
  testerna matar in belopp de själva skrivit och jämför utdata, aldrig det
  omvända varvet. **Byggaren ska:** lägga till de två konstanterna och villkoret i
  `src/core/entry.js` enligt tabellen i steg 1; lägga till meddelandet i
  `MESSAGES` med en nyckel i samma form som de övriga; skriva facittabellens rader
  och rundgångstestet i `tests/entry.test.js` med `formatSek` och `sekToOre`
  importerade från ägaren; köra de tre mutationerna var för sig med `EXIT=1` och
  kryssraden inklistrad; köra `grep -c` på varje uttryck före pilen mot
  `src/core/entry.js` med minst `1`; och köra `npm test` med `fail 0` och exit 0.
  (påverkat av lärdom: **ja**, `2026-09-22 — validering: appen visar belopp som
  "12 000,00 kr" men avvisar "12 000" med "Beloppet måste vara ett tal."`,
  `2026-09-16 — test: Object.hasOwn-spärren i schedule.js överlever mutation, och
  testkommentaren namnger ett skydd assertionen inte ger`, och `2026-09-14 —
  test: samma bindande användartext fick två skrivsätt i tests/app.test.js`)
- **De två raderna som säger "oförändrad" fick punkt (35) och (36), och
  mutationslistan följer numera facit och inte testfallen** — facit för vyn efter
  en borttagning gjorde fyra utfall bindande, men bara `204` och `404` hade en
  punkt. Granskarens körning visar vad det kostade: mutationen "hämta om vid
  varje misslyckat svar" — `404`-grenen utvidgad till `500` plus ett
  `await loadAndRender()` i `catch`-grenen — gav `tests 358, pass 358, fail 0` och
  `EXIT=0`, alltså noll kryssrader för ordagrant det alternativ som står som
  förkastat i den här loggen. Orsaken var mätt och är inte slumpen: inget
  testfall lät `DELETE` självt svara `500` eller avvisas. *Att lita på att de två
  raderna följer av de andra förkastades:* de sitter i samma `if`-kedja, så en rad
  utan punkt är en rad vem som helst kan ändra med grön svit. Formen som gör en
  "oförändrad"-rad prövbar står utskriven i avsnittet — räkna anropen som inte ska
  ske, och låt det anrop mutationen inför förstöra vyn — eftersom en assertion på
  en vy som ser likadan ut före och efter annars är sann av sig själv. Regeln som
  följer står under "Teststrategi": en mutationsrad per rad i facit, aldrig en per
  testfall paketet råkar skriva, och varje facittabell redovisas med sina par av
  rad och punkt. **Byggaren ska:** skriva punkt (35) och (36) enligt formen i
  avsnittet; köra de två nya mutationerna var för sig med `EXIT=1` och kryssraden
  inklistrad; köra om granskarens sammansatta mutation och visa att den numera ger
  `EXIT=1`; köra `grep -c` på båda uttrycken mot `src/web/app.js`; och köra
  `npm test` med `fail 0` och exit 0. (påverkat av lärdom: **ja**, `2026-09-23 —
  test: två av fyra rader i facit för vyn efter en borttagning skyddas av inget
  test`, och `2026-09-10 — test: raden som tömmer #empty-state i clearView
  överlever mutation`)
- **Åldrade påståenden utanför `ARKITEKTUR.md` som paket 8 orsakade, och som
  ägarna rättar** — granskningen fann dem, och de skrivs upp här så att de inte
  glöms bort mellan agenterna. `README.md` säger att felmeddelandet för ett
  mellanslag bara ger standardtexten och råder användaren att leta efter
  mellanslag; efter rättningen är det omvänt, och texten är alltså falsk för
  användaren, som är den läsare den finns för. Samma fil angav dessutom antalet
  tester som ett fast tal, och det talet var förbi redan när granskningen läste
  det. Båda hör till **dokumentatorn** och står som två egna rader i ordern under
  punkten `README.md` har två avsnitt vars facit de här besluten ändrar. En
  kommentar över `AMOUNT_HINT_CASES` i `tests/entry.test.js` påstår att båda
  blanktecknen står som escaper, medan raderna under skriver U+0020 rått; ägaren
  i `src/core/entry.js` har samma mening och där stämmer den. Den hör till
  **byggaren** och rättas i samma paket. Ingen av de tre kräver ett beslut: facit
  finns redan, och det är påståendena som ska följa facit. (påverkat av lärdom:
  **ja**, `2026-09-02 — dokumentation: ARKITEKTUR.md:s exempelsträng för formatSek
  är inte den koden ger`, och `2026-09-14 — dokumentation: fem antal skrevs in i
  ARKITEKTUR.md utan kommandot, och två av fem stämmer inte`)
- **Den vägledande texten gjorde en rad i paket 2:s facittabell falsk, och
  korskontrollen mellan tabellerna kördes inte** — raden `'50 kr'` / `Infinity`
  kräver identisk `message` för strängen och talet, och efter paket 8:s beslut
  ger strängen den vägledande texten medan talet ger standardtexten. Byggaren
  hittade det och löste det på rätt ställe: paret bytte sträng till `'1e3'`, som
  fortfarande ger samma svar som `Infinity`, och `'50 kr'` prövas i stället i den
  nya facittabellen — ingen rad tappades. Dokumentet hade dock kvar den gamla
  raden, alltså två facit som gav olika svar för samma värde, och det är ordagrant
  felet i `LARDOMAR.md` 2026-08-23. Rättat här: raden är utbytt, skälet utskrivet,
  och villkoret på vilka strängar som duger i den tabellen står nu som en regel —
  en sträng ska antingen matcha `AMOUNT_PATTERN` eller falla på steg 1 **utan**
  att träffa `AMOUNT_HINT_PATTERN`. Varje övrig sträng i tabellen prövades mot den
  nya kedjan i samma svep: `'abc'` och `''` saknar siffra och står kvar, och
  resten matchar `AMOUNT_PATTERN` och når regelkedjan som förut, så raden om
  `Infinity` var den enda som blivit falsk. *Att i stället skriva om invarianten
  förkastades:* "samma värde, samma `message` oavsett ingångstyp" är sann och ska
  vara det — det var exemplet som inte dög, inte regeln. Den kontroll som skulle
  ha fångat detta när steget lades till står nu utskriven i samma avsnitt som
  tabellerna, med kravet att utfallet klistras in rad för rad.
  (påverkat av lärdom: **ja**, `2026-08-23 — dokumentation: två facit i samma fil
  ger olika svar för samma belopp`, och `2026-09-22 — validering: appen visar
  belopp som "12 000,00 kr" men avvisar "12 000" med "Beloppet måste vara ett
  tal."`)
- **`README.md` har två avsnitt vars facit de här besluten ändrar** — dokumentatorn
  har beskrivit båda felen för användaren som kända och orättade, och en sådan
  text blir falsk i samma stund koden ändras. Det är samma form som en åldrad
  markör i den här filen, med skillnaden att den står i en annan fil och att
  kommando A, B och C inte träffar den; därför står facit här i stället.
  **Dokumentatorn ska:** i "Så skriver du ett belopp" behålla att `12 000`
  avvisas, stryka meningen om att felmeddelandet inte pekar ut mellanslaget, och
  i stället skriva vad appen svarar — den vägledande texten, ordagrant som den
  står i felmeddelandetabellen; i stycket om att appens utdata inte går att
  klistra tillbaka skriva samma sak, alltså att appen säger vad man ska skriva;
  stryka stycket "Känt fel vid borttagning av en post som redan är borta" och i
  stället skriva att listan, totalerna och kortet hämtas om när servern svarar att
  posten inte finns; och behålla varningen om två flikar, men utan hänvisning till
  det strukna felet. Därutöver det granskningen av paket 8 hittade i samma fil:
  meningen om att felmeddelandet inte pekar ut mellanslaget står kvar på ett andra
  ställe i samma avsnitt och säger numera motsatsen till vad appen gör, och
  antalet tester står som ett fast tal, som körningen sedan länge har passerat —
  **talet stryks och skrivs inte om till ett nytt**. Kravet som ska stå i stället
  är det som inte åldras: `npm test` ska ge `fail 0` och avsluta med exitkod 0,
  och `ℹ tests`-raden i läsarens egen körning är enda facit för hur många de är.
  Ingen av ändringarna görs förrän koden är ändrad och `npm test` ger `fail 0`
  och exit 0. (påverkat av lärdom: **ja**, `2026-09-04 —
  dokumentation: "Kvar i paket 3" står kvar i ARKITEKTUR.md och är fortfarande
  falsk`)

---

## Del 2: månadsbudget med konto och inloggning

Paket 1-8 byggde en lokal utgiftslista för en person på en enhet. Del 2 bygger ut
den till en personlig månadsbudget med konton och inloggning, i två etapper:

| Etapp | Innehåll |
|-------|----------|
| **Etapp 1** | Datamodellen: SQLite-schemat, månadsbegreppet, posttypen inkomst/utgift/sparande, versionerade mallar och beräkningen av en månads innehåll. |
| **Etapp 2** | Konto och inloggning: engångskod via e-post, sessioner, och kopplingen som gör varje läsning och skrivning till en fråga om *den inloggade användarens* rader. |

Avgränsningarna under "Beslut" i `PLAN.md` gäller inte längre fullt ut, och det
är hela skälet till Del 2. Vilka som är upphävda och vilka som står kvar, en rad
per beslut:

| Beslut i `PLAN.md` | Gäller i Del 2? |
|--------------------|-----------------|
| 1. Bara utgifter, ingen inkomsthantering | **Upphävt** av användaren. Del 2 bär inkomst, utgift och sparande. |
| 2. Bara en lista över kommande dragningar, inga notiser | Står kvar. Inga mejl utom inloggningskoden, ingen bakgrundskörning. |
| 3. En person, en enhet, ingen inloggning | **Upphävt** av användaren. Del 2 har konton och inloggning. |
| 4. Ingen historik över faktiska dragningar | Står kvar. En mall med `from_month` och `to_month` är en historik över *vad som gällde*, aldrig över vad som verkligen drogs. |
| 5. SEK som enda valuta | Står kvar. |

Det här avsnittet är skrivet efter en lättare process som användaren har godkänt
för etapp 1 och 2: ingen mutationsprövning av varje delvillkor, och inga
granskningsrundor i den skala paket 1-8 hade. Kraven på **innehållet** är
oförändrade - svensk text mot användaren, engelska namn i kod och kolumner,
belopp i heltal ören, och ett facit per fråga.

### Datamodell: SQLite-schemat (bindande) [etapp 1]

Lagringen är en SQLite-fil som nås med `node:sqlite` (`DatabaseSync`, synkron -
inga `await` i datalagret). Varje tabell nedan skapas exakt som den står
skriven. Kolumn- och tabellnamn är engelska och `snake_case`, eftersom det är
SQL:s form; kärnans fältnamn är `camelCase`, och översättningen mellan de två
sker på exakt ett ställe, i det lager som skriver SQL.

**Filens plats.** Sökvägen kommer ur miljövariabeln `HEMOCHEKONOMI_DB_FILE`,
läst med samma villkor som `HEMOCHEKONOMI_DATA_FILE` redan har i
`src/server/paths.js`: satt till ett värde som innehåller minst ett tecken som
inte är blanktecken används värdet **ordagrant, utan `trim()`**; osatt, tom
sträng och bara blanktecken räknas som osatt. Förvalet för lokal körning är
`hemochekonomi.sqlite` i samma katalog som datafilen låg i, alltså under
`%APPDATA%\hemochekonomi\`. Funktionen heter `getDatabaseFilePath()` och ligger i
`src/server/paths.js`, som redan äger frågan "var ligger appens filer".

**Driftsvillkor på Fly.io - bindande, och ett krav byggaren ska verifiera mot
Fly.ios dokumentation, inte ett mätvärde.** Databasfilen ska ligga på en
**monterad volym** och inte i appens filsystem, eftersom filsystemet återställs
vid varje driftsättning: `HEMOCHEKONOMI_DB_FILE` sätts i drift till en sökväg
under volymens monteringspunkt. Appen ska dessutom köras i **en enda instans**:
`node:sqlite` mot en fil på en volym tål inte att två maskiner skriver samtidigt.
Byggaren verifierar mot Fly.ios dokumentation hur en volym knyts till en maskin
och hur antalet instanser låses till en, och skriver in svaret här tillsammans
med det kommando som sätter det. Instansvillkoret är också skälet att
`src/server/lock.js` behålls: låset skyddar mot två *processer på samma maskin*,
och det problemet finns kvar oavsett hur många maskiner som kör.

**Pragman sätts på varje anslutning, direkt efter att den öppnats:**

```sql
PRAGMA foreign_keys = ON;    -- av som förval i SQLite; utan raden är varje REFERENCES nedan en kommentar
PRAGMA journal_mode = WAL;   -- en läsning blockerar inte en skrivning
PRAGMA busy_timeout = 5000;  -- millisekunder; väntar i stället för att svara SQLITE_BUSY direkt
```

`PRAGMA foreign_keys` är per anslutning och måste sättas om varje gång en
anslutning öppnas. `journal_mode = WAL` är en egenskap hos filen och behöver
bara sättas en gång, men får sättas varje gång - raden är idempotent.

**Schemaversionen står i `PRAGMA user_version`**, satt till `1` av etapp 1. Ingen
egen tabell för det: versionen är ett heltal, SQLite har redan ett fält för det,
och en tabell hade varit en rad att hålla i synk. Ett senare schema höjer talet
och skriver sin ändring som ett steg som körs när det lästa talet är lägre.

**Tidsstämplar.** Varje `*_at`-kolumn är en ISO 8601-tidsstämpel i UTC, exakt den
sträng `new Date().toISOString()` ger, alltså på formen
`2026-09-24T18:03:00.000Z`. Den läses på ett ställe: `nowIso(now = new Date())` i
`src/core/dates.js`, som är samma fil och samma form som `todayIso(now = new
Date())`. Varje funktion som behöver tiden tar emot värdet som parameter - annars
går utgångna koder och utgångna sessioner inte att testa. **`CLAUDE.md` ska få en
mening till under klockregeln** i etapp 1: `todayIso()` ger dagen och `nowIso()`
tidsstämpeln, båda i `src/core/dates.js`, och ingen annan fil läser klockan.

#### Tabellerna

```sql
-- Ett konto. Skapas vid första begäran om en inloggningskod; ingen separat
-- registrering finns.
CREATE TABLE users (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- En utskickad engångskod. Koden lagras ALDRIG i klartext: kolumnen bär
-- scryptSync(kod, salt, 64) som hex, och saltet står i code_salt.
CREATE TABLE login_codes (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  code_salt      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  consumed_at    TEXT,            -- NULL = inte använd ännu
  superseded_at  TEXT,            -- NULL = inte ersatt av en nyare kod
  attempts       INTEGER NOT NULL DEFAULT 0,
  request_ip     TEXT NOT NULL
);
CREATE INDEX idx_login_codes_user ON login_codes (user_id, created_at);
CREATE INDEX idx_login_codes_ip ON login_codes (request_ip, created_at);

-- En inloggad session. Tokenet finns bara i användarens cookie; tabellen bär
-- sha256(token) som hex.
CREATE TABLE sessions (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT                -- NULL = giltig; sätts vid utloggning
);
CREATE INDEX idx_sessions_user ON sessions (user_id);

-- En återkommande post, versionerad. En version gäller från from_month till och
-- med to_month; to_month = NULL betyder "gäller framåt utan slut". Alla
-- versioner av samma post delar series_id.
CREATE TABLE templates (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id   TEXT NOT NULL,      -- första versionens id
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  interval    TEXT NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  start_date  TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  from_month  TEXT NOT NULL CHECK (from_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  to_month    TEXT CHECK (to_month IS NULL OR to_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  created_at  TEXT NOT NULL,
  CHECK (to_month IS NULL OR to_month >= from_month)
);
CREATE INDEX idx_templates_user_period ON templates (user_id, from_month, to_month);
CREATE INDEX idx_templates_series ON templates (user_id, series_id, from_month);

-- En engångspost: gäller exakt en månad och har inget intervall och ingen dag.
CREATE TABLE month_items (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX idx_month_items_user_month ON month_items (user_id, month);

-- En avvikelse för en enskild månad av en mall: antingen ett annat belopp den
-- månaden, eller att posten hoppas över den månaden. Aldrig båda, aldrig
-- ingenting.
CREATE TABLE overrides (
  id           TEXT PRIMARY KEY,  -- crypto.randomUUID()
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id  TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  month        TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount_ore   INTEGER CHECK (amount_ore IS NULL OR amount_ore > 0),
  skipped      INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  created_at   TEXT NOT NULL,
  CHECK ((skipped = 1 AND amount_ore IS NULL) OR (skipped = 0 AND amount_ore IS NOT NULL)),
  UNIQUE (template_id, month)
);
CREATE INDEX idx_overrides_user_month ON overrides (user_id, month);
```

**Krav byggaren ska köra innan schemat skrivs in i koden, inte ett mätvärde:**
`interval` är ett kolumnnamn i `templates`. Kör `CREATE TABLE` ovan i
`new DatabaseSync(':memory:')` och se att det går igenom. Gör det inte det är
ordet ett nyckelord i den här SQLite-versionen, och kolumnen skrivs då som
`"interval"` inom dubbla citationstecken på varje ställe den förekommer -
**namnet byts inte**, eftersom kärnans fält heter `interval` och två namn för
samma sak är det den här filen förbjuder.

#### Varför kolumnerna ser ut så

- **`id` är alltid en `TEXT` med ett UUID från `crypto.randomUUID()`**, aldrig
  `INTEGER PRIMARY KEY AUTOINCREMENT`. Skälet står redan i teknikvalstabellen
  för paket 1-8: ett löpnummer krockar efter borttagning, och id:t syns i
  adresser. `isValidEntryId` i `src/core/entry.js` är fortfarande enda
  definitionen av vad ett giltigt id är.
- **Belopp lagras som `amount_ore INTEGER`**, aldrig som kronor och aldrig som
  `REAL`. `CLAUDE.md`:s regel gäller i databasen också. Omvandlingen mellan
  kronor och ören sker bara i `sekToOre` och `oreToSek` i `src/core/money.js`,
  som redan äger den; SQL räknar aldrig om ett belopp.
  `CHECK (amount_ore > 0)` är samma gräns som `Beloppet måste vara större än
  0 kr.` i felmeddelandetabellen, uttryckt en andra gång på ett annat språk - se
  "Två spärrar i två språk" nedan.
- **`email` är unik och normaliserad.** Normaliseringen är `raw.trim().toLowerCase()`
  och görs på **ett** ställe, i valideringen av e-postadressen i kärnan, innan
  värdet når SQL. `UNIQUE` på kolumnen är därför en spärr mot ett
  programmeringsmisstag och inte mot två stavningar av samma adress: adressen är
  redan normaliserad när den skrivs, så `Anna@Example.se ` och `anna@example.se`
  är samma rad. Kolumnen får inget `COLLATE NOCASE` - det hade varit en andra,
  svagare kopia av samma regel, på ett språk där den inte går att testa med
  resten.
- **`login_codes` knyts till `user_id`, inte till en fri e-poststräng.** Kontot
  skapas vid den första begäran om en kod, så användaren finns alltid när koden
  skrivs. Följden är att en kod alltid kan tas bort med kontot
  (`ON DELETE CASCADE`), och att en kod aldrig kan peka på en adress som inte är
  någons.
- **`consumed_at` och `superseded_at` är två kolumner och inte en.** De svarar på
  olika frågor och ger användaren olika svar: en kod som redan använts är
  `consumed_at`, och en kod som gjorts ogiltig av att en nyare kod skickades är
  `superseded_at`. En enda kolumn hade tvingat ihop två svenska felmeddelanden
  till ett som är fel i hälften av fallen.
- **`sessions.token_hash` är unik och indexerad, och tokenet finns bara i
  cookien.** Uppslaget vid varje anrop sker på hashen, som är ett
  `sha256`-värde av ett token med hög entropi; därför behövs ingen
  `timingSafeEqual` här, till skillnad från vid jämförelsen av en sexsiffrig
  kod. `id` finns utöver hashen därför att en primärnyckel inte ska vara ett
  värde som härleds ur en hemlighet.
- **`templates.series_id` gör versionerna till en post i gränssnittet.** Utan den
  går det inte att svara på "visa den här utgiften över tid" eller "ta bort
  utgiften helt" utan att gissa vilka rader som hör samman. Första versionens
  `id` är seriens `series_id`, så ingen extra tabell behövs.
- **`overrides.template_id` pekar på en *version*, inte på en serie.** En
  avvikelse är ett påstående om beloppet en bestämd månad, och den månaden har
  exakt en giltig version. `UNIQUE (template_id, month)` gör att en månad inte
  kan ha två motstridiga avvikelser för samma mall.
- **`month_items` har ingen dag och inget intervall.** En engångspost gäller en
  månad, punkt. Vill användaren ha ett datum är posten en mall med
  `from_month = to_month`.
- **`category` har inget `CHECK`.** Kategorilistan `CATEGORIES` ägs av
  `src/core/entry.js` och kan komma att växa; en `CHECK` hade gjort varje tillägg
  till en schemaändring. `kind` och `interval` har däremot `CHECK`, eftersom de
  två listorna är slutna och bär beräkningens mening - ett okänt `interval` är
  det fel `LARDOMAR.md` 2026-09-02 handlar om.

#### Posttypen: inkomst, utgift eller sparande

Typen lagras som `kind TEXT NOT NULL` med exakt ett av tre värden:

| `kind` | Etikett mot användaren | Roll i "kvar att leva på" |
|--------|------------------------|---------------------------|
| `income` | Inkomst | läggs till |
| `expense` | Utgift | dras bort |
| `saving` | Sparande | dras bort |

`saving` dras bort och läggs inte till: pengar som går till sparande är inte
pengar som finns kvar att leva på den månaden. Att det ändå är en egen typ och
inte en utgift är hela poängen - summan per typ går att visa var för sig, så
användaren ser vad som är utgifter och vad som är sparande.

Alla tre typerna bor i samma tabeller. En egen tabell per typ hade gett tre
kopior av samma kolumner, tre index och tre vägar genom beräkningen, för en
skillnad som är ett tecken i en summa.

**Ägaren till listan är `ITEM_KINDS` i `src/core/item.js`**, en ny modul i
etapp 1, tillsammans med `ITEM_KIND_LABELS` för de svenska etiketterna ovan.
Konstanterna fryses med `Object.freeze`, precis som `INTERVALS` och
`CATEGORIES`. Ingen svensk etikett skrivs hårdkodad i `src/web/app.js`. Modulens
gränssnitt och dess validering skrivs i ett eget avsnitt; det här avsnittet äger
bara kolumnen och värdena.

#### Månad som `ÅÅÅÅ-MM`

En månad är en sträng på formen `ÅÅÅÅ-MM`, till exempel `2026-10`. Aldrig ett
tal, aldrig ett `Date`, och aldrig `ÅÅÅÅ-M`. Formen är vald av samma skäl som
`ÅÅÅÅ-MM-DD` för datum: den sorterar och jämförs korrekt som text, vilket är
precis vad `from_month <= :month` och `to_month >= :month` i SQL bygger på.

**Giltigheten ägs av `src/core/dates.js`**, som redan äger datumformatet. Ingen
annan fil skriver ett eget månadsmönster:

| Export i `src/core/dates.js` | Vad den äger |
|------------------------------|--------------|
| `ISO_MONTH_PATTERN` | formen, i samma roll som `ISO_DATE_PATTERN` har för ett datum |
| `isValidIsoMonth(value)` | "är det här en riktig månad": formen plus månadsnumret 01-12 |
| `monthOfIsoDate(isoDate)` | `'2026-01-31'` ger `'2026-01'` |
| `firstDayOfMonth(month)` | `'2026-01'` ger `'2026-01-01'` |
| `compareMonths(a, b)` | ordningen, i samma roll som `compareIsoDates` |
| `shiftMonth(month, count)` | månaden `count` månader senare; namnet är inte `addMonths`, som redan är taget i en annan roll |

Signaturerna och deras ingångsspärrar skrivs i ett eget avsnitt. Vad som gäller
här är ägarskapet och de tre ställen månaden valideras:

1. **I kärnan, före varje skrivning.** Valideringen av en mall och av en
   engångspost avvisar en månad som `isValidIsoMonth` säger nej till, med svensk
   text, precis som `startDate` avvisas i dag. Årsgränsen 1970-2099 prövas i
   samma kedja och inte i `isValidIsoMonth`, exakt som för `startDate`: `MIN_YEAR`
   och `MAX_YEAR` ägs av `src/core/entry.js`.
2. **I API-lagret, när månaden kommer ur ett anrop.** En månad som inte är giltig
   ger `400` med svensk text och når aldrig datalagret.
3. **I schemat, som sista spärr.** `CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]')`
   fångar ett programmeringsmisstag som tagit sig förbi de två första. Den är
   avsiktligt svagare än `isValidIsoMonth` - `GLOB` kan inte avgöra att `13` inte
   är en månad - och det är inget att rätta: en spärr som är sista utposten ska
   vara billig och får vara grov.

#### Två spärrar i två språk (bindande)

Tre regler står nu på två ställen: `kind`-listan, `interval`-listan och
beloppsgränsen `> 0` finns både som en ägande konstant i `src/core/` och som ett
`CHECK` i schemat. Det bryter inte ägarregeln, men det kräver en utskriven
motivering och ett prov, annars är det just den glidning regeln finns för att
hindra.

Motiveringen: `CHECK` i schemat är sista utposten mot ett programmeringsmisstag i
serverkoden, och den skriver aldrig ett meddelande till användaren. Ägaren i
`src/core/` avgör vad användaren får för svar. De två svarar alltså på olika
frågor - "får den här raden finnas i filen" respektive "vad ska användaren läsa".

Provet: `tests/db.test.js` läser schemats text och kräver att värdelistan i
`CHECK (kind IN (...))` är densamma som `ITEM_KINDS`, och att värdelistan i
`CHECK (interval IN (...))` är densamma som `INTERVALS`. Det är samma sorts prov
som `tests/cost.test.js` redan har för `PAYMENTS_PER_YEAR` mot `INTERVALS`, och
det finns av samma skäl: två listor som beskriver samma domän glider isär vid
första tillägget. Testfilens kravlista skrivs i ett eget avsnitt.

#### Varje rad hör till en användare (bindande)

Regeln, i den form en granskare kan pröva:

1. **Varje `SELECT`, `UPDATE` och `DELETE` mot `templates`, `month_items`,
   `overrides`, `login_codes` eller `sessions` ska ha `user_id = ?` i sin
   `WHERE`.** Varje `INSERT` i samma tabeller ska ha `user_id` i sin kolumnlista.
   Två uppslag är uttryckliga undantag, eftersom de är de satser som *avgör* vem
   användaren är och därför inte kan filtrera på svaret: uppslaget i `users` på
   `email` respektive `id`, och uppslaget i `sessions` på `token_hash`. Inga
   andra undantag finns, och ett nytt undantag kräver en egen rad här.
2. **`user_id` hämtas alltid ur sessionen.** Aldrig ur anropets kropp, sökväg
   eller frågesträng. Ett `user_id` i en inkommande JSON-kropp ignoreras tyst -
   det är inte ett fält appen läser.
3. **Ett anrop utan giltig session når aldrig datalagret.** Kontrollen sker i
   routningen, före hanteraren, för varje `/api/`-väg utom
   inloggningsvägarna och utloggningen. Svaret är `401` med svensk text.
4. **Ett `id` som finns men tillhör någon annan ger `404`, aldrig `403`.** Att
   svara `403` vore att bekräfta att raden finns. Det följer automatiskt av
   punkt 1: satsen med `user_id = ?` hittar ingen rad, och "hittade ingen rad" är
   redan `404`.
5. **Kontrollen en granskare kör** är en sökning per tabell efter varje sats som
   rör den, följd av en läsning av varje träff:
   `grep -rn "FROM templates\|UPDATE templates\|DELETE FROM templates\|INTO templates" src/`
   och samma sökning med `month_items`, `overrides`, `login_codes` och
   `sessions`. Varje träff ska antingen bära `user_id` enligt punkt 1 eller vara
   ett av de två undantagen i punkten. En träff som är ingetdera stoppar
   etappen.

#### Hur en månads innehåll räknas fram

Ingenting materialiseras. En månads innehåll finns inte som rader utan räknas
fram vid läsning, ur mallar som bär sin egen giltighetsperiod. Kedjan, som den
ska byggas:

```
monthContents(userId, month):

1. giltiga mallar
   SELECT * FROM templates
    WHERE user_id = :userId
      AND from_month <= :month
      AND (to_month IS NULL OR to_month >= :month)

2. intervallträff  -- enda stället intervallet avgörs; ingen SQL räknar månader
   för varje mall t ur steg 1:
     due = nextDueDate({ interval: t.interval, startDate: t.start_date },
                       firstDayOfMonth(month))
     behåll t bara om monthOfIsoDate(due) === month, och bär med due som dueDate

3. avvikelser
   SELECT * FROM overrides WHERE user_id = :userId AND month = :month
   för varje kvarvarande mall t, med o = avvikelsen för t.id om den finns:
     o saknas          -> amountOre = t.amount_ore, overridden = false
     o.skipped = 1     -> mallen utgår ur månaden
     annars            -> amountOre = o.amount_ore, overridden = true

4. engångsposter
   SELECT * FROM month_items WHERE user_id = :userId AND month = :month
   dueDate = null, overridden = false

5. raderna = resultatet av steg 3 + resultatet av steg 4

6. summorna, i heltal ören
   incomeOre  = summan av amountOre för raderna med kind = 'income'
   expenseOre = summan av amountOre för raderna med kind = 'expense'
   savingOre  = summan av amountOre för raderna med kind = 'saving'
   remainingOre = incomeOre - expenseOre - savingOre      -- "kvar att leva på"
```

**Steg 2 är beslut 5 i uppdraget: intervallogiken återanvänds och skrivs inte om.**
`nextDueDate` i `src/core/schedule.js` äger redan regeln för vilka datum en post
med kvartals-, halvårs- eller årsintervall faktiskt dras, inklusive klampningen
för startdatum den 29-31. Frågan "dras den här posten i den här månaden" ställs
därför som "ligger den första dragningen den 1:a i månaden eller senare
fortfarande i samma månad". Den formen ger klampningen gratis: en kvartalspost
med `start_date` `2026-01-31` får `2026-04-30` i april, eftersom
`nextDueDate` klampar, och `monthOfIsoDate('2026-04-30')` är `'2026-04'`.
`nextDueDate` prövar bara `interval` och `startDate` i posten den får, så ett
objekt med de två fälten räcker - och det är avsiktligt, inte en genväg.

**`remainingOre` är enda definitionen av "kvar att leva på".** Den räknas i
heltal ören, i ett uttryck, och aldrig som en kedja av avrundade
mellanresultat - samma regel som månadstotalen i paket 3 har. Talet kan bli
negativt, och det är ett giltigt svar: en månad kan gå med underskott.
Visningen sker med `formatSek`, som redan skriver ett negativt belopp med
minustecknet U+2212 MINUS SIGN, aldrig med bindestrecket U+002D. Varje
jämförelse mot den strängen skrivs med unicode-escapen för kodpunkten 2212, på
den form som redan står under `src/core/money.js` i "Gränssnitt", aldrig med
råtecknet.

#### Utskrivet exempel: priset höjs från 199 till 249 från och med oktober 2026

Utgångsläget är en rad i `templates`, den enda versionen av serien:

| `id` | `series_id` | `name` | `amount_ore` | `interval` | `start_date` | `from_month` | `to_month` |
|------|-------------|--------|--------------|------------|--------------|--------------|------------|
| `A` | `A` | Spotify Family | `19900` | `monthly` | `2026-01-31` | `2026-01` | `NULL` |

Ändringen är två satser i **en** transaktion:

```sql
BEGIN;
  UPDATE templates SET to_month = '2026-09'
   WHERE id = 'A' AND user_id = :userId;

  INSERT INTO templates
    (id, user_id, series_id, kind, name, amount_ore, category,
     interval, start_date, from_month, to_month, created_at)
  VALUES
    ('B', :userId, 'A', 'expense', 'Spotify Family', 24900, 'subscription',
     'monthly', '2026-01-31', '2026-10', NULL, :now);
COMMIT;
```

Läget efteråt:

| `id` | `series_id` | `amount_ore` | `from_month` | `to_month` |
|------|-------------|--------------|--------------|------------|
| `A` | `A` | `19900` | `2026-01` | `2026-09` |
| `B` | `A` | `24900` | `2026-10` | `NULL` |

Vad de två raderna ger per månad, genom kedjan ovan:

| Månad | Steg 1 väljer | Belopp |
|-------|---------------|--------|
| `2026-08` | `A` (`2026-01 <= 2026-08 <= 2026-09`); `B` faller bort, `from_month` är senare | `19900` |
| `2026-09` | `A`; `B` faller bort | `19900` |
| `2026-10` | `B`; `A` faller bort, `to_month` är tidigare | `24900` |
| `2026-11` | `B` | `24900` |

**Varför september och tidigare blir oförändrade:** ingen rad som beskriver en
tidigare månad har rörts. Version `A` bär fortfarande `19900`, och den enda
ändringen på den är *när den slutar gälla*. Eftersom en månads innehåll räknas
fram vid läsning finns det inga materialiserade rader för oktober och framåt som
någon kan glömma att uppdatera - och inga för augusti och september som någon
kan råka skriva om. Det är hela skälet till versionerade mallar i stället för
kopierade poster: kravet "att ändra en återkommande post får aldrig skriva om
tidigare månaders siffror" blir en egenskap hos modellen i stället för en regel
någon måste komma ihåg.

Tre närliggande ändringar följer samma form och skrivs här, så att de inte
gissas:

- **Höj priset från och med *nästa* månad** är samma två satser, med
  `to_month` satt till månaden före.
- **Avsluta posten från och med november 2026:** sätt `to_month = '2026-10'` på
  den version som gäller oktober, och ta bort de versioner av samma serie som
  börjar senare. Ingen rad för oktober eller tidigare rörs.
- **Ta bort posten som om den aldrig funnits:**
  `DELETE FROM templates WHERE user_id = :userId AND series_id = :seriesId`.
  Avvikelserna följer med genom `ON DELETE CASCADE`. Det här är den enda
  operationen som ändrar historiken, och den finns därför att en post som lagts
  in av misstag ska gå att få bort helt.
- **Hoppa över en enskild månad utan att röra serien:** en rad i `overrides` med
  `skipped = 1` för den månaden och den version som gäller då.

#### Vad som händer med `storage.js`, `paths.js` och `lock.js`

| Fil | Utfall | Etapp |
|-----|--------|-------|
| `src/server/storage.js` | **Tas bort**, tillsammans med `tests/storage.test.js` och `tests/helpers/interrupted-save.js`. SQLite äger både atomiciteten och samtidigheten: den atomiska skrivvägen (temporärnamn plus `rename`) och `ioQueue` ersätts av en transaktion per skrivning. `updateEntries`, som fanns för att läs-ändra-skriv skulle ligga i en enda köplats, ersätts av att läsningen och skrivningen ligger i samma transaktion. | Etapp 2, när `api.js` har bytt väg |
| `src/server/paths.js` | **Behålls.** `getDataFilePath` och `getLockFilePath` ersätts av `getDatabaseFilePath` och ett lås som hör till databasfilen; `getWebDir` och `getCoreDir` är oförändrade. Villkoret för miljövariabeln är oförändrat, ordagrant. | Etapp 1 lägger till `getDatabaseFilePath`; etapp 2 tar bort de två gamla |
| `src/server/lock.js` | **Behålls oförändrad i sin mekanik**, med låsfilen flyttad till databasfilens sökväg plus `.lock`. Skälet står under "Driftsvillkor på Fly.io": appen ska köras i en enda instans, och låset är det som hindrar två processer på samma maskin från att skriva i samma SQLite-fil. `tests/lock.test.js` behålls med sökvägen bytt. | Etapp 1 |
| `entries.json` på användarens disk | **Lämnas orörd.** Ingen automatisk migrering byggs: en import skulle behöva ett `user_id` som inte finns förrän någon loggat in, och filen är liten nog att mata in igen. Filen tas inte bort av appen, så den går att läsa för hand. | - |

**Läsvägens och skrivvägens felmeddelanden byter ägare men inte form.** En
`StorageError` med svensk text är fortfarande det som `api.js` översätter till
`500 { "error": "<meddelandet>" }`. Vilka rader tabellen får när lagringen är
SQLite skrivs i ett eget avsnitt tillsammans med datalagrets gränssnitt; vad som
gäller redan nu är att en rå engelsk text från SQLite aldrig får nå användaren,
av samma skäl som en rå `EPERM` inte får det i dag.

#### Filer som tillkommer i etapp 1 och 2

Trädet nedan är facit för Del 2:s filer. Paketmärkningen från paket 1-8 gäller
oförändrad för övriga filer, och ingen fil står på två ställen.

```
src/core/
  item.js          Posttypen inkomst/utgift/sparande: ITEM_KINDS,
                   ITEM_KIND_LABELS, och valideringen av de fält som är nya i
                   Del 2 (etapp 1).
  budget.js        En månads innehåll och summorna, inklusive remainingOre
                   ("kvar att leva på") (etapp 1).
  dates.js         Utbyggd: månadsbegreppet ÅÅÅÅ-MM och nowIso (etapp 1).
src/server/
  db.js            Anslutningen, pragman, schemat och PRAGMA user_version
                   (etapp 1).
  budget-store.js  Frågorna mot templates, month_items och overrides. Varje
                   funktion tar userId (etapp 1).
  auth-store.js    Frågorna mot users, login_codes och sessions (etapp 2).
  mail.js          Utskicket av engångskoden: Resend över fetch, eller
                   serverloggen när RESEND_API_KEY saknas (etapp 2).
  session.js       Sessionscookien och uppslaget som avgör vem användaren är
                   (etapp 2).
tests/
  item.test.js     Etapp 1.
  budget.test.js   Etapp 1.
  db.test.js       Etapp 1.
  auth.test.js     Etapp 2.
```

Gränssnitten för filerna ovan, inloggningsflödets vägar och kravlistorna för
testfilerna skrivs i egna avsnitt. Det här avsnittet är facit för schemat,
månadsbegreppet, posttypen, ägarregeln per användare och beräkningen av en
månads innehåll - och för ingenting annat.

---

### Inloggning med engångskod (bindande) [etapp 2]

Ingen lösenordslagring. Konto skapas och används genom en sexsiffrig kod som
skickas till e-postadressen. Det här avsnittet är facit för kodens livscykel,
sessionen, felmeddelandena och API-vägarna.

#### Namngivna konstanter

Varje tal nedan är en namngiven konstant i `src/server/auth.js`. En literal på
anropsstället är ett fel.

| Konstant | Värde | Roll |
|---|---|---|
| `CODE_LENGTH` | `6` | Antal siffror i koden. |
| `CODE_TTL_MS` | `10 * 60 * 1000` | Kodens livslängd. Uppdraget säger högst 10 minuter. |
| `CODE_MAX_ATTEMPTS` | `5` | Antal gissningar per kod innan den bränns. |
| `EMAIL_WINDOW_MS` | `60 * 60 * 1000` | Tidsfönster för utskick per e-postadress. |
| `EMAIL_MAX_PER_WINDOW` | `5` | Utskick per e-postadress inom fönstret. |
| `IP_WINDOW_MS` | `60 * 60 * 1000` | Tidsfönster för utskick per IP. |
| `IP_MAX_PER_WINDOW` | `20` | Utskick per IP inom fönstret. Högre än per e-post: en delad utgång (kontor, mobilnät) ska inte spärras av en granne. |
| `SESSION_TTL_MS` | `30 * 24 * 60 * 60 * 1000` | Sessionens livslängd, 30 dygn. |
| `SCRYPT_KEYLEN` | `64` | Längd på kodhashen i byte. |

#### Kodens livscykel

1. Koden genereras med `crypto.randomInt` över hela intervallet för `CODE_LENGTH`
   siffror och nollutfylls till full längd. `randomInt` är kryptografiskt säker;
   `Math.random` är det inte och får inte användas.
2. Ett salt om 16 byte skapas med `crypto.randomBytes`. Hashen är
   `crypto.scryptSync` av koden med saltet och `SCRYPT_KEYLEN`. **Koden lagras
   aldrig i klartext** — varken i databasen, i en logg eller i ett felmeddelande.
3. När en ny kod begärs för samma användare sätts `superseded_at` på varje
   tidigare kod som ännu är oanvänd och ogången. En ersatt kod duger inte längre,
   även om dess `expires_at` inte har passerat. Skälet: annars kan den som begär
   tre koder använda den första, och `CODE_MAX_ATTEMPTS` blir då en gräns per kod
   i stället för per inloggningsförsök.
4. Vid inmatning jämförs hashen med `crypto.timingSafeEqual`. En vanlig
   likhetsjämförelse läcker information genom sin körningstid.
5. Lyckad inloggning sätter `consumed_at`. En kod med `consumed_at` duger aldrig
   igen.

#### Villkorskedjan vid inmatad kod — första träff vinner

Ordningen är bindande. Flera villkor kan vara sanna samtidigt, och då är det
raden högst upp som avgör svaret.

| # | Villkor | Svar |
|---|---|---|
| 1 | E-posten saknar giltigt format | `400` rad 1 |
| 2 | Koden är inte sex siffror | `400` rad 2 |
| 3 | Ingen kod finns för e-posten | `400` rad 3 |
| 4 | Antalet försök har nått `CODE_MAX_ATTEMPTS` | `429` rad 4 |
| 5 | `consumed_at` är satt | `400` rad 5 |
| 6 | `superseded_at` är satt | `400` rad 6 |
| 7 | `expires_at` har passerat | `400` rad 7 |
| 8 | Hashen stämmer inte | `400` rad 3, och antalet försök ökas med ett |
| 9 | Annars | `204` med sessionscookie |

Rad 4 står före rad 5, 6 och 7 med avsikt: är försöken uttömda ska användaren få
veta det även om koden dessutom hunnit gå ut, annars ser en bränd kod ut som en
vanlig utgången kod och användaren begär en ny i onödan.

Rad 8 ger **samma text som rad 3**. En felaktig kod och en kod som inte finns får
aldrig skiljas åt i svaret; annars blir formuläret ett sätt att ta reda på vilka
e-postadresser som har konto.

#### Felmeddelanden — ordagrant

| Rad | Svensk text |
|---|---|
| 1 | `Ange en giltig e-postadress.` |
| 2 | `Koden ska vara sex siffror.` |
| 3 | `Koden stämmer inte. Begär en ny kod och försök igen.` |
| 4 | `För många försök på den här koden. Begär en ny kod.` |
| 5 | `Koden är redan använd. Begär en ny kod.` |
| 6 | `En nyare kod har skickats. Använd den senaste koden.` |
| 7 | `Koden har gått ut. Begär en ny kod.` |
| 8 | `För många koder till den här adressen. Försök igen om en stund.` |
| 9 | `För många koder från den här anslutningen. Försök igen om en stund.` |
| 10 | `Det gick inte att skicka koden. Försök igen.` |

Texterna ägs av `src/server/auth.js` och skrivs ordagrant där. Ingen text får
avslöja om en e-postadress finns i databasen.

#### Att begära en kod avslöjar inte om kontot finns

Vägen för att begära en kod svarar **alltid `202`**, oavsett om e-posten har ett
konto eller inte. Finns inget konto skapas det i samma anrop — registrering och
inloggning är samma väg. Text 8 och 9 är de enda undantagen: en spärr måste kunna
säga ifrån, och den gäller adressen eller anslutningen, inte kontots existens.

#### Sessionen

- Token är `crypto.randomUUID()`. Endast en `sha256`-hash av tokenet lagras, i
  `sessions.token_hash`. En läckt databas ger alltså inte inloggning. Hashen
  behöver ingen `scrypt`: tokenet är redan tillräckligt med slump, till skillnad
  från en sexsiffrig kod.
- Cookien heter `hemochekonomi_session` och sätts med `HttpOnly`, `Path=/`,
  `SameSite=Lax` och `Max-Age` ur `SESSION_TTL_MS`.
- `Secure` sätts när miljön är drift, alltså på Fly.io där HTTPS alltid gäller.
  Vid lokal körning över `http://127.0.0.1` skulle `Secure` göra att webbläsaren
  aldrig skickar tillbaka cookien, och inloggningen hade då varit omöjlig att
  prova lokalt.
- `SameSite=Lax` och inte `Strict`: `Strict` gör att cookien inte följer med när
  användaren kommer till appen från en länk i e-posten.
- Utloggning sätter `revoked_at` och skickar en cookie som upphör omedelbart.
- Ett anrop med en cookie vars session saknas, har `revoked_at` satt eller vars
  `expires_at` passerat behandlas som **inte inloggad**: `401` med texten
  `Du är inte inloggad.` Cookien rensas i samma svar.

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `POST /api/auth/kod` | `{ "email": string }` | `202` utan kropp. `400` rad 1. `429` rad 8 eller 9. `500` rad 10 om utskicket misslyckas. |
| `POST /api/auth/logga-in` | `{ "email": string, "code": string }` | `204` med sessionscookie. `400` rad 1, 2, 3, 5, 6 eller 7. `429` rad 4. |
| `POST /api/auth/logga-ut` | ingen | `204` med rensad cookie. Svarar `204` även utan giltig session — utloggning ska aldrig misslyckas. |
| `GET /api/mig` | ingen | `200` med e-postadressen. `401` om inte inloggad. |

Varje statuskod som koden kan ge står i tabellen. En väg får inte svara med en
kod som inte står på dess rad.

#### Klientens IP-adress

IP-gränserna räknas per klientadress, och bakom Fly.io är anslutningens
fjärradress alltid proxyns. Klientens adress läses därför ur `X-Forwarded-For`,
**första** kommaseparerade värdet, trimmat.

Huvudet får litas på **endast** när miljövariabeln `TRUST_PROXY` är satt till
`1`. Utan den används anslutningens fjärradress. Skälet: utan proxy kan vem som
helst sätta huvudet själv och därmed kringgå både `IP_MAX_PER_WINDOW` och
`EMAIL_MAX_PER_WINDOW`. Variabeln sätts i Fly.io-konfigurationen och ska inte
vara satt vid lokal körning.

#### E-post: utvecklingsläge och drift

| Miljövariabel | Roll |
|---|---|
| `RESEND_API_KEY` | Satt: koden mejlas via Resends HTTPS-API med globalt `fetch`. Osatt: utvecklingsläge. |
| `RESEND_FROM` | Avsändaradress. Krävs när `RESEND_API_KEY` är satt. |
| `TRUST_PROXY` | `1` bakom Fly.ios proxy, annars osatt. |
| `HEMOCHEKONOMI_DB_FILE` | Sökväg till SQLite-filen. På Fly.io en sökväg på den monterade volymen. |
| `NODE_ENV` | `production` i drift; styr `Secure` på cookien. |

I utvecklingsläge skrivs koden på `stdout` tillsammans med e-postadressen och
uppgiften att den gäller i tio minuter. Det är den enda platsen i projektet där
en kod får stå i klartext, och den finns för att inloggningsflödet ska gå att
prova och testa utan e-postkonto.

Misslyckas utskicket i drift svarar vägen `500` med rad 10, och koden raderas ur
`login_codes` i samma transaktion. En kod som användaren inte kan ta emot får
inte ligga kvar och räkna mot `EMAIL_MAX_PER_WINDOW`.

#### Kravlista för `tests/auth.test.js` [etapp 2]

Numreringen är egen för filen och skrivs `(A1)` och framåt i testkoden.

| # | Testfall | Kräver |
|---|---|---|
| (A1) | en giltig kod loggar in | `204`, cookie med `HttpOnly` och `SameSite=Lax`, och vägen för inloggad användare ger `200` med e-posten |
| (A2) | en utgången kod avvisas | tiden flyttas förbi `CODE_TTL_MS`; `400` med rad 7 ordagrant |
| (A3) | en felaktig kod avvisas och räknar upp försöket | `400` med rad 3; antalet försök ökat med ett |
| (A4) | en återanvänd kod avvisas | först `204`, sedan samma kod igen: `400` med rad 5 |
| (A5) | för många försök bränner koden | `CODE_MAX_ATTEMPTS` felaktiga försök, därefter **rätt** kod: `429` med rad 4 |
| (A6) | en ersatt kod avvisas | två koder begärs, den första matas in: `400` med rad 6 |
| (A7) | okänd e-post avslöjas inte | en begäran för en adress utan konto ger `202`, och en felaktig kod för den ger rad 3 — samma text som för en adress med konto |
| (A8) | för många utskick per e-post | `EMAIL_MAX_PER_WINDOW` utskick, därefter ett till: `429` med rad 8 |
| (A9) | för många utskick per IP | `IP_MAX_PER_WINDOW` utskick från samma adress: `429` med rad 9 |
| (A10) | utloggning återkallar sessionen | utloggning ger `204`, och vägen för inloggad användare med samma cookie ger därefter `401` |
| (A11) | `X-Forwarded-For` litas inte på utan `TRUST_PROXY` | två anrop med olika värden i huvudet räknas som samma klient när variabeln är osatt |
| (A12) | en annan användares data är onåbar | två konton, och ett anrop med användare A:s cookie mot B:s poster ger `404` eller tom lista, aldrig B:s data |

Klockan får inte läsas direkt i testerna. `CODE_TTL_MS` prövas genom att tiden
injiceras på samma sätt som dagens datum redan injiceras i `tests/app.test.js` —
se `tests/helpers/frozen-dates.js`.

---

### Databasens fel når aldrig användaren på engelska (bindande) [etapp 2]

`node:sqlite` kastar på engelska: `FOREIGN KEY constraint failed`,
`CHECK constraint failed: amount_ore > 0`, `SQLITE_CANTOPEN`. `CLAUDE.md` kräver
att all text mot användaren är svensk, och `src/server/storage.js` har sedan
paket 4 mönstret att varje felväg omsluts och kastas vidare som ett eget fel med
svensk text och `cause` satt till originalet. Databasen följer samma mönster.

#### `DatabaseError`

`src/server/db.js` exporterar `DatabaseError`, som ärver `Error`. Kraven är
desamma som på `StorageError`:

- `.message` är **alltid** svensk text och skickas rakt ut till användaren.
- `.cause` är originalfelet från `node:sqlite`, aldrig del av `.message`.
- Ingen sökväg och ingen SQL-text står i `.message`. En sökväg avslöjar
  serverns filsystem för den som läser felet i webbläsaren, och SQL-texten
  avslöjar schemat.

Skillnaden mot `StorageError`, som är medveten: `StorageError` skriver ut
datafilens sökväg, eftersom den appen kördes lokalt av en person som äger filen.
Den här appen nås över internet av flera användare, och då är sökvägen inte
användarens information.

#### Felen — ordagrant

| # | Situation | Svensk text |
|---|---|---|
| 1 | Databasen går inte att öppna eller skapa | `Databasen kunde inte öppnas. Kontakta den som driftar appen.` |
| 2 | En läsning misslyckas | `Det gick inte att läsa dina uppgifter. Försök igen.` |
| 3 | En skrivning misslyckas | `Det gick inte att spara. Försök igen.` |
| 4 | Ett `CHECK`- eller `UNIQUE`-villkor bryts | `Uppgifterna kunde inte sparas: något värde är ogiltigt.` |

Rad 4 är ett **programmeringsfel, inte ett användarfel**. All indata valideras i
`src/core/` innan den når datalagret, så ett brutet `CHECK` betyder att
valideringen har ett hål. Texten är därför medvetet allmän, och felet ska loggas
på servern med `cause` intakt så att det går att hitta. Det som når användaren
säger bara att det inte gick.

#### Var omslutningen sitter

Varje exporterad funktion i datalagret som kör en fråga omsluter sina
`node:sqlite`-anrop och kastar `DatabaseError`. Samma krav som redan gäller
`loadEntries` och `saveEntries`: **ingen** `node:sqlite`-metod får anropas utan
att dess fel fångas. En funktion som läcker ett engelskt fel är ett fel även om
den fungerar.

`api.js` fångar `DatabaseError` och svarar `500` med `{ "error": <meddelandet> }`,
på samma sätt som den redan fångar `StorageError`.

#### Testkrav

`tests/db.test.js` ska pröva, utöver det den redan gör:

| # | Fall | Kräver |
|---|---|---|
| (D1) | en sökväg som inte går att öppna | `error instanceof DatabaseError`, och `.message` är rad 1 ordagrant |
| (D2) | felet bär originalet | `.cause` är satt och är felet från `node:sqlite` |
| (D3) | ingen sökväg läcker | `.message` innehåller inte sökvägen som gavs |
| (D4) | ingen engelsk text läcker | `.message` innehåller varken `constraint failed`, `SQLITE_` eller `unable to open` |

---

### Månadens summering: kvar att leva på (bindande) [etapp 3]

#### `src/core/budget.js` — ny modul, ren kärna

Ingen `node:`-import. Modulen äger beräkningen och ingenting annat: den tar emot
en lista poster och svarar med summorna. Den läser ingen databas och ingen klocka.

```
sumByKind(items, kind)   -> heltal ören
monthTotals(items)       -> { incomeOre, expenseOre, savingOre, leftOre }
```

`leftOre = incomeOre - expenseOre - savingOre`. Det är hela regeln, och den står
på exakt ett ställe i projektet.

**Räkningen sker i heltal ören.** Ingen division, ingen avrundning, inget
flyttal — en summa av heltal är exakt. `money.js` äger omvandlingen till text,
och `budget.js` anropar den aldrig.

**`leftOre` får vara negativt.** Det är hela poängen: en månad där utgifter och
sparande överstiger inkomsten ska visa ett minusbelopp, inte noll och inte ett
fel. Ingen spärr mot negativa `leftOre` får skrivas.

**`leftOre` får aldrig vara `-0`.** `0 - 0 - 0` ger `0`, men subtraktion kan ge
`-0` i andra fall, och `formatSek(-0)` gav `"\u22120,00\u00a0kr"` i en tidigare
granskning — alltså minustecken före noll kronor. `money.js` äger
normaliseringen med `normalizeZero`; `budget.js` ska använda den eller göra
motsvarande, och det ska finnas ett testfall.

**Ingångsspärrar — bindande, första träff vinner:**

| # | Villkor | Svensk text |
|---|---|---|
| 1 | `items` är inte en array | `monthTotals kräver en lista med poster.` |
| 2 | En post är inte ett objekt | `monthTotals kräver poster som objekt.` |
| 3 | En posts `kind` är inte `income`, `expense` eller `saving` | `monthTotals kräver ett känt slag, fick "<värdet>".` |
| 4 | En posts `amountOre` är inte ett säkert heltal | `monthTotals kräver ett belopp i heltal ören.` |
| 5 | En summa lämnar det säkra heltalsområdet | `monthTotals kräver att summan är ett säkert heltal.` |

Rad 5 prövas efter varje addition, av samma skäl som `totalYearlyOre` i
`cost.js`: en summa som lämnar området avrundas tyst.

Tom lista ger `{ incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 }` — aldrig
ett fel och aldrig `NaN`.

#### En månads innehåll — kedjan

Ordningen är bindande och står som pseudokod, inte som prosa, eftersom två steg
kan röra samma post.

```
1. Läs mallarna som är giltiga månaden M för användaren:
     from_month <= M  OCH  (to_month IS NULL ELLER to_month >= M)
2. Behåll de mallar vars intervall faktiskt ger en dragning i M.
     Avgörs av MONTHS_PER_PERIOD och start_date i src/core/schedule.js.
     En månadspost träffar varje månad; en kvartalspost var tredje
     räknat från start_date, och så vidare.
3. För varje kvarvarande mall: finns en override för (mall, M)?
     skipped = 1  -> posten ingår inte i månaden
     amount_ore  -> posten ingår med override-beloppet
     ingen rad   -> posten ingår med mallens belopp
4. Lägg till månadens engångsposter ur month_items.
5. Sortera: slag (income, expense, saving), därefter namn i svensk ordning
     med Intl.Collator('sv'), därefter id.
```

Steg 2 är skälet att intervallogiken inte skrivs om: `schedule.js` äger redan
klampningen för den 29–31 och hoppet över flera perioder.

**En återkommande post markeras i svaret** med ett fält som säger att den kommer
från en mall, plus mallens `series_id`. Gränssnittet behöver det för ikonen, och
etapp 4 behöver det för "ändra från och med denna månad".

#### Datalagret — `src/server/months.js`

Ny modul. Varje funktion tar `userId` som **första** argument och har
`user_id = ?` i varje `WHERE`. En funktion utan det är ett fel även om den
fungerar, eftersom nästa användare av modulen då ärver hålet.

```
readMonth(userId, month)                  -> { items, totals }
addMonthItem(userId, month, draft)        -> den skapade posten
updateMonthItem(userId, itemId, draft)    -> den ändrade posten
removeMonthItem(userId, itemId)           -> true om något togs bort
```

`readMonth` kör kedjan ovan och anropar `monthTotals` för summorna. Varje
`node:sqlite`-anrop omsluts och kastar `DatabaseError` enligt det avsnittet.

**En post som inte tillhör användaren ska bete sig som om den inte finns.**
`updateMonthItem` och `removeMonthItem` mot ett id som ägs av någon annan ger
samma svar som mot ett id som inte existerar — aldrig ett fel som avslöjar att
raden finns. Skälet är detsamma som att inloggningen inte avslöjar om en
e-postadress har konto.

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `GET /api/manad/<ÅÅÅÅ-MM>` | ingen | `200` med poster och summor. `400` vid fel månadsformat. `401` utan session. `500` vid `DatabaseError`. |
| `POST /api/manad/<ÅÅÅÅ-MM>` | `{ kind, name, amountSek, category }` | `201` med posten. `400` med `fieldErrors`. `401`. `500`. |
| `PUT /api/poster/<id>` | samma som `POST` | `200` med posten. `400`. `401`. `404` om posten inte finns eller tillhör någon annan. `500`. |
| `DELETE /api/poster/<id>` | ingen | `204`. `401`. `404`. `500`. |

Varje statuskod koden kan ge står på sin rad. `401` ges av sessionsspärren innan
vägen körs, inte av vägen själv.

**Beloppet tas emot i kronor som sträng eller tal** och valideras med samma kedja
som `checkAmountSek` i `entry.js` redan äger — inklusive den vägledande texten för
`12 000`. Ingen andra beloppsvalidering skrivs.

#### Kravlista för testerna [etapp 3]

`tests/budget.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (B1) | kvar att leva på räknas rätt | inkomst 30000 kr, utgifter 18500 kr, sparande 5000 kr ger `leftOre` 650000 |
| (B2) | negativt kvar visas som negativt | utgifter över inkomsten ger negativt `leftOre`, inget fel |
| (B3) | tom lista ger nollor | alla fyra fälten `0`, ingen är `-0` |
| (B4) | `leftOre` är aldrig `-0` | asserteras med `Object.is(left, -0) === false` |
| (B5) | varje ingångsspärr | ett fall per rad i spärrtabellen, hela meddelandet asserterat |
| (B6) | summan i heltal | ett belopp nära `Number.MAX_SAFE_INTEGER` ger rad 5 |

`tests/months.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (M1) | en engångspost syns bara i sin månad | lagd i oktober, saknas i september och november |
| (M2) | en månadsmall syns i varje månad från `from_month` | tre månader i rad |
| (M3) | en kvartalsmall syns var tredje månad | från `start_date`, prövat över sex månader |
| (M4) | en halvårsmall syns var sjätte månad | sex månader isär |
| (M5) | `to_month` stänger serien | månaden efter `to_month` saknar posten |
| (M6) | en override ändrar beloppet bara i sin månad | grannmånaderna oförändrade |
| (M7) | `skipped` tar bort posten ur månaden | och bara ur den |
| (M8) | en annan användares poster syns aldrig | två konton, tom lista för det andra |
| (M9) | `updateMonthItem` mot någon annans id | samma svar som mot ett id som inte finns |
| (M10) | summorna följer posterna | `readMonth` ger samma summor som `monthTotals` på dess egna poster |

Månaden får aldrig läsas ur klockan i ett test. Dagens månad injiceras på samma
sätt som dagens datum redan injiceras genom `tests/helpers/frozen-dates.js`.

---

### Månaden som begrepp: nya exporter i `src/core/dates.js` (bindande) [etapp 3]

En månad är strängen `ÅÅÅÅ-MM`. `dates.js` äger formatet, precis som den redan
äger `ÅÅÅÅ-MM-DD` genom `ISO_DATE_PATTERN` och `isValidIsoDate`. Ingen annan fil
skriver ett eget månadsmönster, och ingen annan fil klipper en månad ur ett datum
med `slice`.

#### Exporterna

```
ISO_MONTH_PATTERN                -> mönstret för fyra siffror, bindestreck, två siffror
isValidIsoMonth(value)           -> boolean
firstDayOfMonth(month)           -> månadens första dag som ÅÅÅÅ-MM-01
monthOfIsoDate(isoDate)          -> datumets månad som ÅÅÅÅ-MM
shiftMonth(month, deltaMonths)   -> månaden flyttad ett antal månader
compareMonths(a, b)              -> -1, 0 eller 1
```

`isValidIsoMonth` kräver både formatet **och** att månadsdelen är `01` till `12`.
Strängen `2026-13` matchar mönstret men är ingen månad, precis som `2026-02-31`
matchar `ISO_DATE_PATTERN` utan att vara ett datum. Mönstret ensamt räcker alltså
aldrig — samma skäl som gav `isValidIsoDate` sitt existensberättigande.

`shiftMonth` räknar i månader, inte i dagar: december plus en månad ger januari
året efter, och januari minus en månad ger december året före. Den har ingen
klampning att göra — en månad har ingen dag.

`compareMonths` jämför strängarna, vilket är korrekt just för det här formatet:
`ÅÅÅÅ-MM` sorterar i samma ordning alfabetiskt som kronologiskt, eftersom både år
och månad är nollutfyllda. Det står utskrivet här så att nästa läsare inte tror
att raden är en genväg.

#### Ingångsspärrar — bindande, första träff vinner

Varje funktion kastar `RangeError`. Texterna står ordagrant.

| Funktion | Villkor | Svensk text |
|---|---|---|
| `firstDayOfMonth` | `!isValidIsoMonth(month)` | `firstDayOfMonth kräver en månad på formen ÅÅÅÅ-MM, fick "<värdet>".` |
| `monthOfIsoDate` | `!isValidIsoDate(isoDate)` | `monthOfIsoDate kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "<värdet>".` |
| `shiftMonth` | `!isValidIsoMonth(month)` | `shiftMonth kräver en månad på formen ÅÅÅÅ-MM, fick "<värdet>".` |
| `shiftMonth` | `!Number.isSafeInteger(deltaMonths)` | `shiftMonth kräver ett heltal månader, fick "<värdet>".` |
| `compareMonths` | `!isValidIsoMonth(a)` eller `!isValidIsoMonth(b)` | `compareMonths kräver en månad på formen ÅÅÅÅ-MM, fick "<värdet>".` |

`<värdet>` skrivs med `String(värdet)`, samma form som modulens befintliga texter
använder.

**Ingen av funktionerna läser klockan.** `todayIso()` är fortfarande projektets
enda klockläsning. Vill en anropare veta dagens månad skriver den
`monthOfIsoDate(todayIso())`, och då står klockläsningen kvar på sitt enda ställe.

#### Anropare i `src/` — varför alla sex byggs nu

`LARDOMAR.md` förbjuder en export utan anropare. Var och en har en:

| Export | Anropare i etapp 3 |
|---|---|
| `ISO_MONTH_PATTERN` | `isValidIsoMonth` |
| `isValidIsoMonth` | API-vägarnas spärr för fel månadsformat, och `months.js` |
| `firstDayOfMonth` | kedjans steg 2 i `months.js` |
| `monthOfIsoDate` | kedjans steg 2 i `months.js` |
| `shiftMonth` | månadsväljarens två knappar i `src/web/app.js` |
| `compareMonths` | jämförelsen av `from_month` och `to_month` i `months.js` |

#### Testkrav för månadshalvan av `tests/dates.test.js`

| # | Fall | Kräver |
|---|---|---|
| (MD1) | `isValidIsoMonth` godkänner en giltig månad | januari och december i ett år ger `true` |
| (MD2) | månadsdelen `00` och `13` avvisas | båda ger `false`, trots att mönstret matchar |
| (MD3) | fel form avvisas | en ensiffrig månad, ett fullt datum, tom sträng, `null`, ett tal och en sträng med exponent ger alla `false` |
| (MD4) | `firstDayOfMonth` ger den första | februari ger den första februari |
| (MD5) | `monthOfIsoDate` ger månaden | sista februari ger februari |
| (MD6) | `shiftMonth` över årsskiftet | december plus en ger januari nästa år, januari minus en ger december föregående år |
| (MD7) | `shiftMonth` med noll | ger samma månad tillbaka |
| (MD8) | `shiftMonth` över flera år | trettio månader framåt och trettio bakåt, båda med utskrivet facit |
| (MD9) | `compareMonths` ordnar kronologiskt | tidigare före senare ger `-1`, omvänt `1`, lika ger `0` |
| (MD10) | varje spärr | ett fall per rad i spärrtabellen, hela meddelandet asserterat |

---

### Månadens API — de två texter som saknades (bindande) [etapp 3]

| Situation | Svensk text | Statuskod |
|---|---|---|
| Månaden i vägen är inte `ÅÅÅÅ-MM` | `Månaden måste anges som ÅÅÅÅ-MM.` | `400` |
| Posten finns inte, eller tillhör någon annan | `Posten finns inte.` | `404` |

Texten för `404` är **densamma** som `api.js` redan använder för den gamla
borttagningsvägen. Skälet att återanvända den i stället för att skriva en ny:
användaren ska inte kunna se skillnad på en post som aldrig funnits och en som
tillhör någon annan, och två olika strängar för samma svar vore två facit.

Månadsspärren prövas **innan** datalagret nås. En ogiltig månad ska aldrig bli en
SQL-fråga.

#### Månaden injiceras inte i testerna

`readMonth(userId, month)` och varje API-väg tar månaden som argument eller ur
sökvägen. Ingen av dem läser klockan, och därför behövs **ingen**
`frozen-months`-hjälpare. Kravet på injicering i avsnittet ovan gäller
`src/web/app.js`, som läser `todayIso()` för att öppna den aktuella månaden — och
den filen har redan sin injicering genom `tests/helpers/frozen-dates.js`.

---

### Månadspostens validering (bindande) [etapp 3]

#### Var den bor: `validateMonthItemDraft` i `src/core/item.js`

En månadspost har fyra fält från användaren: `kind`, `name`, `amountSek` och
`category`. Tre av dem har redan en ägare i `src/core/entry.js` — `checkName`,
`checkAmountSek` och `checkCategory` — men de är modullokala. De **exporteras** nu,
på samma sätt som `isPlainObject` exporterades i paket 3 när `cost.js` behövde
den. Skälet är detsamma: alternativet är en andra kopia av samma villkor, och en
andra kopia glider isär från den första.

```
validateMonthItemDraft(draft) -> { ok: true, value } | { ok: false, errors }
```

`value` är `{ kind, name, amountOre, category }` — **ören, inte kronor.**
Omvandlingen sker här, med `sekToOre` i `money.js`, eftersom `item.js` är kärna
och får importera kärna. Då finns kronor bara i det användaren skrev och i det
`formatSek` skriver ut; allt däremellan är heltal ören.

`errors` har samma form som `validateEntryDraft` redan använder: en lista med
`{ field, message }`. API-lagret skickar den vidare som `fieldErrors` utan att
bygga om den.

**Fältordningen är bindande** och avgör i vilken ordning felen står i listan:
`kind`, `name`, `amountSek`, `category`. Alla fyra prövas, så att ett formulär med
fyra fel visar fyra meddelanden samtidigt — samma beteende som den gamla
formulärvägen redan har.

#### Den text som saknades

| Fält | Villkor | Svensk text |
|---|---|---|
| `kind` | `!isItemKind(draft.kind)` | `Välj inkomst, utgift eller sparande.` |

Formen följer `interval`-raden i felmeddelandetabellen: den räknar upp de
tillåtna alternativen i stället för att bara säga att värdet är fel. Texten
nämner inte de engelska nycklarna `income`, `expense` och `saving` — användaren
ser aldrig dem.

De tre övriga fälten ger exakt de texter deras ägare redan ger, inklusive den
vägledande beloppstexten för `12 000`. Ingen text skrivs om.

#### Kronor blir ören i kärnan, aldrig i datalagret

`months.js` tar `amountOre` och rör aldrig kronor. `addMonthItem` och
`updateMonthItem` får alltså ett utkast som redan är validerat och omräknat.
Ordningen i API-vägen är bindande:

```
1. sessionsspärren      -> 401 om ingen giltig session
2. månadsspärren        -> 400 om månaden inte är ÅÅÅÅ-MM
3. validateMonthItemDraft -> 400 med fieldErrors
4. months.js            -> 201 eller 200
```

Steg 1 före steg 2 är redan byggt och prövat av ett testfall. Steg 3 före steg 4
betyder att en ogiltig post aldrig blir en SQL-fråga.

#### Kravlista

| # | Fall | Kräver |
|---|---|---|
| (V1) | ett giltigt utkast | `ok: true`, och `value.amountOre` är heltal ören för det skrivna kronbeloppet |
| (V2) | ogiltigt `kind` | `ok: false` med `kind`-texten ordagrant |
| (V3) | fyra fel samtidigt | fyra poster i `errors`, i fältordningen |
| (V4) | beloppet med mellanslag | den vägledande texten, alltså ägarens och ingen egen |
| (V5) | `POST` med ogiltigt utkast | `400` med `fieldErrors`, och ingen rad i databasen |
| (V6) | `POST` med giltigt utkast | `201`, posten i svaret, och den syns i `GET` för samma månad |
| (V7) | `PUT` mot någon annans id | `404` med `Posten finns inte.` |
| (V8) | `PUT` ändrar beloppet | `200`, och `GET` visar det nya beloppet och nya summor |

---

### Två rättelser i det jag skrev tidigare

#### `compareMonths` anropas av månadsväljaren, inte av `months.js`

Anropartabellen sade att `compareMonths` anropas av jämförelsen av `from_month`
och `to_month` i `months.js`. Det var fel: den jämförelsen är bindande skriven som
SQL i kedjans steg 1, och att göra om den i JavaScript vore en andra kopia av
samma filter. Byggaren byggde därför ingen anropare, och det var riktigt.

Rätt anropare är `src/web/app.js`: månadsväljaren behöver avgöra om en månad
ligger före eller efter en annan, och historiköversikten i etapp 5 behöver ordna
tolv månader. Båda är senare uppdrag, så `compareMonths` och `shiftMonth` står
tills dess utan anropare i `src/` — med den här raden som skäl.

#### Kollatorns språk går inte att skydda på den här maskinen

`new Intl.Collator('sv')` i `months.js` överlever mutationen till
`new Intl.Collator()`, och orsaken är mätt: maskinens förval är `sv-SE`, så
utfallet kan inte skilja de två skrivsätten. Testet är skrivet i den form
`LARDOMAR.md` 2026-09-12 föreskriver, och den formen räcker inte här.

Beslutet är att **behålla `'sv'` utan ett skydd som håller oavsett maskin**, och
skälet är att priset inte är värt det: alternativen är att injicera kollatorn i
`readMonth` eller att exportera den, och båda lägger en parameter i
produktionskoden vars enda syfte är att ett test ska kunna byta språk.
`src/core/schedule.js` har samma oskyddade rad sedan paket 7 och samma
motivering. Raden står kvar därför att en användare med engelsk webbläsare annars
får engelsk sortering av svenska namn.

Det här är alltså en känd lucka, utskriven, och inte ett förbiseende.

---

### Gränssnittet: inloggning och månadsvy (bindande) [etapp 3]

#### Den gamla vyn ersätts

`src/web/index.html` och `src/web/app.js` är byggda för den enanvändarlista appen
var i paket 5 till 8. De skrivs om till inloggning plus månadsbudget. Följden är
utskriven här så att den inte kommer som en överraskning:

- Den gamla formulärvyn med `#entry-form`, `#entry-list` och korten Summa och
  Kommande dragningar tas bort ur `index.html`.
- `tests/app.test.js` prövar den vyn. De testfall som rör element som inte längre
  finns **tas bort**, inte kommenteras bort. Ett test som prövar en vy som inte
  finns är sämre än inget test, eftersom det ser ut som täckning.
- `tests/helpers/dom.js` byggs ut med de nya id:na. `idsFranIndexHtml`-provet är
  det som fångar en attrapp som glidit isär från sidan, och det ska fortsätta
  gälla.
- `src/server/storage.js`, `lock.js` och `entries.json`-vägen **rörs inte** i den
  här etappen. De behövs i etapp 6 för att flytta över befintliga poster, och
  `GET /api/entries` får stå kvar tills dess.
- `src/core/cost.js` och `src/core/schedule.js` behålls oförändrade. Den nya vyn
  använder dem inte i etapp 3, men etapp 4 behöver intervallogiken och etapp 5
  behöver kostnadsberäkningen.

#### Två vyer i en sida

Sidan har två tillstånd och ingen router. `app.js` frågar `GET /api/mig` när den
laddas:

- `401` visar **inloggningsvyn** och döljer månadsvyn.
- `200` visar **månadsvyn** och döljer inloggningsvyn.

Inget annat avgör vilken vy som syns. Ett `401` från någon annan väg senare i
körningen visar inloggningsvyn igen — sessionen kan gå ut medan sidan är öppen.

#### Inloggningsvyn

Två steg i samma vy, där steg två ersätter steg ett:

1. Ett fält för e-post och en knapp `Skicka kod`. Svaret är alltid `202`, och
   vyn säger då `En kod är skickad till <e-post>. Den gäller i tio minuter.`
2. Ett fält för koden och en knapp `Logga in`. Vid `204` laddas månadsvyn. Vid
   `400` eller `429` visas serverns text ordagrant — aldrig en egen.

En knapp `Använd en annan adress` går tillbaka till steg ett.

Fältet för koden har `inputmode="numeric"` och `autocomplete="one-time-code"`, så
att mobiltangentbordet ger siffror och koden kan fyllas i automatiskt.

#### Månadsvyn

**Månadsväljaren** ligger överst: en knapp bakåt, månadens namn, en knapp framåt.
Namnet skrivs på svenska med versal begynnelsebokstav, till exempel
`September 2026`. Månadsnamnen ägs av en fryst tabell i `src/core/dates.js` —
ingen handskriven lista i `app.js`, och inte `toLocaleDateString`, eftersom
körmiljöns språk då avgör utfallet.

Vyn öppnar **den aktuella månaden**: `monthOfIsoDate(todayIso())`. Det är den enda
klockläsningen i filen. Knapparna anropar `shiftMonth(month, -1)` respektive
`shiftMonth(month, 1)`.

**Summeringen ligger direkt under månadsväljaren**, före listorna, så att den syns
utan att man behöver skrolla — det är ett uttryckligt krav från användaren.

| Rad | Innehåll |
|---|---|
| Inkomster | `formatSek(incomeOre)` |
| Utgifter | `formatSek(expenseOre)` |
| Sparande | `formatSek(savingOre)` |
| **Kvar att leva på** | `formatSek(leftOre)`, i större text |

`leftOre` får klassen `left-positive` när värdet är noll eller mer och
`left-negative` när det är mindre. Färgerna ligger i `style.css`, aldrig som
`style`-attribut i JavaScript. Noll räknas som positivt: en budget som går jämnt
upp är inte ett problem.

**Tre listor** under summeringen, i ordningen inkomster, utgifter, sparande. Varje
lista har en rubrik, en knapp `+ Ny inkomst`, `+ Ny utgift` respektive
`+ Nytt sparande`, och sina poster. En post visar namn, kategori, belopp och två
knappar: `Ändra` och `Ta bort`.

En post som kommer från en mall märks med ett tecken och texten
`Återkommande varje månad` som `title`. Tecknet skrivs som escape i källkoden, inte
som råtecken.

**Formuläret öppnas av knappen**, inte alltid synligt — uttryckligt krav från
användaren. Det är samma formulär för ny post och för ändring; vid ändring är
fälten ifyllda och knappen heter `Spara ändring`. Fälten är namn, belopp,
kategori. Slaget kommer från vilken lista knappen satt i och är inget fält.

#### Tomma lägen

Varje lista som är tom visar sin egen vänliga text, med månadens namn i:

| Lista | Text |
|---|---|
| Inkomster | `Inga inkomster i <månad> ännu - lägg till din första.` |
| Utgifter | `Inga utgifter i <månad> ännu - lägg till din första.` |
| Sparande | `Inget sparande i <månad> ännu - lägg till ditt första.` |

`<månad>` är månadens namn i gemener, till exempel `oktober`. Bindestrecket är
ASCII, inte tankstreck.

Summeringen visas **alltid**, också när alla tre listorna är tomma — då med fyra
nollor. En ruta som försvinner och kommer tillbaka är oroligare att läsa än en
nolla, och det är samma beslut som paket 6 tog för den gamla vyn.

#### Diagrammet

Ett stapeldiagram över utgifter per kategori för månaden, som **inline-SVG** som
`app.js` bygger. Ingen bildfil, inget bibliotek, inget `canvas`.

- En stapel per kategori som har minst en utgift. En kategori utan utgifter visas
  inte.
- Stapelns längd är kategorins andel av den största kategorin, så att den största
  alltid fyller bredden. Andel av totalen skulle göra alla staplar korta när en
  kategori dominerar.
- Varje stapel har kategorinamnet ur `CATEGORY_LABELS` och beloppet ur
  `formatSek`.
- Inga utgifter i månaden: diagrammet döljs och ersätts av
  `Inga utgifter att visa i diagrammet ännu.`
- SVG:n har `role="img"` och en `<title>` som säger `Utgifter per kategori`, så att
  den går att läsa med skärmläsare.

#### Direktuppdatering

Varje ändring som lyckas hämtar om månaden med `GET /api/manad/<månad>` och
renderar om listorna, summeringen och diagrammet. Ingen räkning sker i `app.js`:
summorna kommer alltid ur svaret, aldrig ur en egen addition. Det är samma regel
som paket 6 satte för den gamla vyn, och den har ett testfall som fäller en
`reduce` i filen.

Knappen som utlöste anropet sätts till `disabled` tills svaret kommit, så att två
snabba klick inte ger två poster.

#### Mobil och dator

`style.css` utgår från en kolumn och lägger listorna i två kolumner först när
bredden räcker, med en `@media`-fråga. Knappar och fält är minst 44 pixlar höga,
vilket är den minsta yta en tumme träffar säkert. Ingen vågrät skrollning vid 320
pixlars bredd.

#### Kravlista för `tests/app.test.js` [etapp 3]

Fortsätter numreringen från den gamla filen, som slutade på (36).

| # | Fall | Kräver |
|---|---|---|
| (37) | `401` vid laddning visar inloggningsvyn | månadsvyn är dold, e-postfältet syns |
| (38) | `200` vid laddning visar månadsvyn | inloggningsvyn dold, månadens namn syns |
| (39) | månadsvyn öppnar aktuell månad | med en fryst dag ska vägen som hämtas vara den frysta månaden |
| (40) | bakåtknappen byter månad | ett `GET` för föregående månad, och rubriken byter namn |
| (41) | framåtknappen byter månad | samma, framåt, inklusive över ett årsskifte |
| (42) | summeringen kommer ur svaret | fyra rader mot `formatSek` på svarets fyra tal |
| (43) | `leftOre` negativt ger `left-negative` | och noll ger `left-positive` |
| (44) | tomma listor visar sina texter | tre texter med månadens namn i gemener |
| (45) | summeringen visas även när allt är tomt | fyra nollor, rutan finns |
| (46) | en mallpost märks | tecknet och `title` finns på raden, en engångspost saknar dem |
| (47) | diagrammet har en stapel per kategori med utgift | och ingen för en kategori utan |
| (48) | inga utgifter döljer diagrammet | texten visas i stället |
| (49) | en ny post hämtar om månaden | ett `POST` följt av ett `GET`, och listan växer |
| (50) | knappen är låst medan anropet pågår | ett andra klick ger inget andra anrop |
| (51) | `Ta bort` hämtar om månaden | listan krymper, summorna ändras |
| (52) | `Ändra` fyller formuläret | fälten bär postens värden, knappen heter `Spara ändring` |
| (53) | ett `400` visar fältfelen | vid rätt fält, och posten skapas inte |
| (54) | ett `401` mitt i körningen visar inloggningsvyn | månadsvyn döljs |
| (55) | `app.js` räknar inte själv | filens text får inte innehålla `reduce` eller `for` i samma sats som ett summaelement |
| (56) | attrappen har sidans id:n | `idsFranIndexHtml` mot `createDom().ids` |

Klockan läses bara genom den injicerade `todayIso`. Kontrollen som förbjuder
klockläsningar i testfilerna gäller oförändrat.

---

### Logga ut, Avbryt och vyn när en hämtning misslyckas (bindande) [etapp 3]

Tre luckor som byggaren flaggade. Den första är ett uttryckligt krav i uppdraget
och skulle ha stått i avsnittet från början.

#### Logga ut

Månadsvyn har en knapp `Logga ut` överst, till höger om månadsväljaren eller på
egen rad ovanför den — placeringen är `style.css`:s sak, inte specifikationens.

Knappen anropar `POST /api/auth/logga-ut`, och när svaret kommit visas
inloggningsvyn igen. Vägen svarar `204` även utan giltig session, så det finns
ingen felväg att hantera: lyckas anropet inte alls, alltså ett avvisat `fetch`,
visas den allmänna texten i `#month-error` och användaren står kvar i månadsvyn.

Bredvid knappen står den inloggade e-postadressen, hämtad ur `GET /api/mig`. Utan
den kan två personer som delar dator inte se vems budget som visas.

#### Avbryt i formuläret

Formuläret har en knapp `Avbryt` bredvid `Spara`. Den stänger formuläret, tömmer
fälten och rensar eventuella fältfel. Den skickar inget anrop.

Utan den kan ett öppnat formulär bara stängas genom att spara, vilket tvingar
användaren att skapa en post hen inte vill ha.

#### Vyn när en hämtning misslyckas

`#month-error` bär texten. Regeln per väg:

| Vad som händer | Texten | Listorna, summeringen och diagrammet |
|---|---|---|
| `GET` för en månad misslyckas | serverns text, eller den allmänna vid avvisat `fetch` | står kvar oförändrade |
| `POST`, `PUT` eller `DELETE` misslyckas | serverns text | står kvar oförändrade |
| En omhämtning efter en lyckad ändring misslyckas | serverns text | står kvar oförändrade |

Vyn nollställs alltså **aldrig** av ett fel. Det är ett annat beslut än paket 6
tog för den gamla vyn, där båda totalerna byttes mot ett tankstreck, och skälet
är att den vyn visade hela datafilen medan den här visar en månad: en summa som
blir kvar från föregående lyckade hämtning är fortfarande sann om just den
månaden, och en tom vy tar bort information användaren kan läsa.

`#month-error` töms vid varje lyckad hämtning.

#### Kravlista, fortsättning

| # | Fall | Kräver |
|---|---|---|
| (57) | `Logga ut` visar inloggningsvyn | ett `POST` till utloggningsvägen, och månadsvyn döljs |
| (58) | e-postadressen visas i månadsvyn | adressen ur `GET /api/mig` står i vyn |
| (59) | `Avbryt` stänger formuläret utan anrop | formuläret döljs, fälten är tömda, och anropslistan är oförändrad |
| (60) | `Avbryt` rensar fältfel | ett fältfel visas, `Avbryt`, formuläret öppnas igen: inget fel kvar |
| (61) | ett misslyckat `GET` lämnar vyn stående | posterna och summorna kvar, texten i `#month-error` |
| (62) | en misslyckad omhämtning efter en ändring lämnar vyn stående | samma, och texten visas |
| (63) | `#month-error` töms vid lyckad hämtning | ett fel först, därefter en lyckad hämtning: rutan är tom |

---

## Del 3: ny design och landningssida

### Färgpaletten (bindande) [design]

Färgerna är **uppmätta ur loggan**, inte valda på ögonmått. Metoden var ett
histogram över de mättade bildpunkterna i `src/web/bilder/logga.png`, grupperade i
intervall om 24 nivåer per kanal, och de tio största grupperna med sitt
medelvärde. Kommandot gick genom `System.Drawing` i PowerShell. Varje ton nedan
har alltså en motsvarighet i bilden, och antalet bildpunkter står utskrivet.

| Token | Värde | Ur loggan |
|---|---|---|
| `--gron-primar` | `#0B6A3B` | husets vägg, 2 677 bildpunkter |
| `--gron-djup` | `#025B38` | husets skuggsida, 2 075 |
| `--gron-ljus` | `#248038` | husets ljussida, 1 334 |
| `--bla-primar` | `#014085` | stapelns mitt, 1 978 |
| `--bla-marin` | `#022D68` | textens mörkaste blå, 1 932 |
| `--bla-mellan` | `#01529C` | pilens mitt, 1 851 |
| `--bla-ljus` | `#0069B7` | pilens ljusa kant, 1 251 |
| `--guld` | `#E28202` | myntets mättade ton, 993 |
| `--guld-mork` | `#D16C01` | myntets skuggkant, 765 |
| `--guld-ljus` | `#FEED7E` | myntets högdager |

Tonerna som **inte** finns i loggan och därför är valda, med skäl:

| Token | Värde | Skäl |
|---|---|---|
| `--bakgrund` | `#F7F5EF` | Varm off-white. Rent vitt mot så mättade toner ger hård kontrast och gör sidan steril. |
| `--positiv` | `#1E9E5A` | Inkomster. Ljusare än `--gron-primar` så att ett belopp inte läses som en yta. |
| `--negativ` | `#D64545` | Utgifter. Rött finns inte i loggan, men ett negativt belopp måste skilja sig från guld. |
| `--fel-text` | `#a52020` | Feltext i appen. `--negativ` ger 4,38:1 mot vitt, vilket räcker för stor text men inte för brödtext, och feltexterna är 0,875rem. Den här tonen ger 7,43:1. Tillkom när temat lades på appen. |

`--positiv` och `--negativ` bär därför **bara** beloppet på raden *Kvar att leva
på*, som är 1,5rem och fet, alltså stor text med kravet 3:1. All feltext i
brödtextstorlek använder `--fel-text`.

**Kontrast.** Varje kombination som bär text ska nå WCAG AA, alltså 4,5:1 för
brödtext och 3:1 för stor text. `--guld` på vitt ger **inte** AA för brödtext och
får bara användas till ytor, ikoner, ramar och stor text — aldrig till löpande
text på ljus bakgrund. `--guld-ljus` på `--bla-marin` är den kombination som
bär guldtext.

#### Mörkt läge

`:root` bär det ljusa temat. `@media (prefers-color-scheme: dark)` byter
`--bakgrund` mot `--bla-marin`, korten mot en ton strax ljusare, och texten mot
off-white. Tokennamnen är desamma, så ingen komponent vet vilket läge som gäller.

### Loggan

Loggan är användarens egen bild. **Ingen ritad symbol används.** En förenklad
SVG-symbol byggdes först, men användaren bad om originalet i stället, och
`symbol.svg` och `symbol-mork.svg` togs bort.

| Fil | Mått | Plats |
|---|---|---|
| `logga-beskuren.png` | 1200 x 653 | Hero |
| `logga-liten.png` | 480 x 261 | Header, sidomeny, sidfot, favicon |

**Båda är beskurna till motivet.** Originalet `logga.png` är kvadratiskt och har
motivet i 26,3 procent av ytan — mätt med en genomgång av bildpunkternas
alfavärde, som gav motivet i rutan x 144 till 868, y 267 till 646. I en header
med begränsad höjd betyder det att den tomma ytan skalas med och att märket blir
litet. Beskärningen lägger 16 bildpunkters marginal runt motivet och ger drygt
tre gånger mer logga per bildpunkt.

**Loggan är ritad för ljus botten.** 69,3 procent av dess täckande bildpunkter
ger under 3:1 mot `--bla-marin`, medan samma toner ger 7 till 14:1 mot
`--bakgrund`. Därför ligger den på en ljus platta i sidomenyn och i sidfoten.
Headern behöver ingen platta: dess yta är redan `--yta`.

`logga.png` behålls som original, men används inte av någon sida.

### Landningssidan

Ny fil `src/web/landning.html`, som blir `/`. Appen flyttar till `/app`.
`STATIC_ROUTES` i `src/server/server.js` får raderna; `/bilder/logga.png` serveras
med `image/png`, och sökvägen prövas mot samma mönster som `/core/`-filerna redan
använder — ett rent filnamn, ingen punkt-punkt, inga snedstreck.

Sektionerna uppifrån och ned:

| # | Sektion | Innehåll |
|---|---|---|
| 1 | Header, fast | Logga vänster, menyn `Funktioner`, `Priser`, `FAQ` i mitten, `Logga in` som kontur och `Registrera` som fylld till höger. På mobil blir menyn en hamburgare, men `Registrera` syns alltid. |
| 2 | Hero | Rubrik `Full koll på hemmet och ekonomin på ett ställe`, underrubrik på två meningar, knapparna `Kom igång` och `Se hur det fungerar`, och loggan till höger. Bakgrund: gradient från `--bla-marin` till `--gron-djup` med ett svagt rutnät. |
| 3 | Fördelar | Fyra punkter med ikon: budget, räkningar, sparmål, hushållet. |
| 4 | Varför Hem och Ekonomi | Tre kolumner med ikon, rubrik och kort text. |
| 5 | Så fungerar det | Tre numrerade steg: registrera, lägg in din ekonomi, få överblick. |
| 6 | Priser | Tre kort. Mittenkortet upphöjt med guldbadge `Populärast`. |
| 7 | FAQ | Sex frågor som fälls ut med `<details>` och `<summary>` — inget JavaScript behövs för att öppna dem. |
| 8 | Footer | Logga, länkarna `Priser`, `FAQ`, `Kontakt`, `Villkor`, `Integritetspolicy`, och upphovsrättsrad. Bakgrund `--bla-marin`. |

**Varannan sektion** har `--bakgrund` respektive en svag grön ton, så att sidan
inte blir genomgående ljus.

**Ikonerna ritas som inline-SVG** i loggans färger. Inget ikonbibliotek hämtas:
Lucide och Phosphor är beroenden, och projektet har noll. En ikon är fem till
femton rader SVG.

**Typsnittet** är systemets egna, med en stack som börjar i `Inter` och
`Plus Jakarta Sans` och faller tillbaka på `system-ui`. Ingen `@import` från
Google Fonts: det är en extern begäran vid varje sidvisning, och den som besöker
sidan ska inte skicka en förfrågan till en tredje part för att läsa den.

### Priskorten

| Plan | Pris | Innehåll |
|---|---|---|
| Bas | `99 kr/mån` | Budget och utgiftsregistrering, räkningspåminnelser, grundläggande översikt |
| Plus | `149 kr/mån` | Allt i Bas, sparmål, delat hushåll, diagram och rapporter |
| Premium | `179 kr/mån` | Allt i Plus, Mina funktioner, prioriterad support |

Varje kort har en knapp `Välj Bas`, `Välj Plus` respektive `Välj Premium`.
Knapparna länkar i det här steget till `/app`, eftersom registreringen med
planval byggs senare. **Ingen knapp får antyda att en betalning sker** förrän
betalningen finns.

### Krav

Mobil först. Ingen vågrät skrollning vid 320 bildpunkter. Knappar och fält minst
44 bildpunkter höga. Rundade hörn: 16 bildpunkter på kort, pillerform på knappar.
All text på svenska. Varje sektion är en egen komponent i den meningen att dess
CSS är samlad under ett eget block med en kommentar, så att den går att flytta.

Den inloggade appen fick samma tema i ett eget steg. `src/web/style.css` gick
från tretton hexkoder till noll och läser nu samma tokens som landningssidan;
`--positiv` och `--negativ` bär beloppet på raden *Kvar att leva på*, och
klassnamnen `left-positive` och `left-negative` behölls så att testfallen för dem
gäller oförändrat.

Appen fick samtidigt en sidomeny i `--morkt-block` med loggan, den inloggade
adressen och `Logga ut`: en rad överst på mobil, en spalt till vänster vid 60rem.
I mörkt läge är `--bakgrund` samma ton som sidomenyn, så menyn skulle flyta in i
sidan — en ram i `--guld` skiljer dem åt, och guld är den enda ton i temat som
når 3:1 mot marinblått och samtidigt syns mot `--bakgrund` i ljust läge.

---

### Återkommande poster (bindande) [etapp 4]

Datamodellen finns sedan etapp 1: `templates` med `series_id`, `from_month` och
`to_month`, samt `overrides` per månad. `readMonth` läser dem redan. Det som
saknas är vägen att **skapa och ändra** dem.

#### Vad en användare ska kunna

| Vad | Hur det faller ut i modellen |
|---|---|
| Göra en post återkommande | En rad i `templates` med `from_month` = månaden posten skapas i |
| Välja intervall | `interval`: månadsvis, kvartalsvis, halvårsvis eller årsvis |
| Sätta ett slutdatum | `to_month`, eller `NULL` för tills vidare |
| Ändra beloppet **bara denna månad** | En rad i `overrides` med `amount_ore` |
| Ändra **från och med denna månad** | Den gamla raden får `to_month` = föregående månad; en ny rad med samma `series_id` skapas från den här månaden |
| Hoppa över **bara denna månad** | En rad i `overrides` med `skipped = 1` |
| Avsluta serien | `to_month` = föregående månad. Tidigare månader rörs aldrig |

**Historiken är oföränderlig.** Ingen av operationerna skriver om en rad som
gäller en passerad månad. Det är hela skälet till versioneringen, och det ska
finnas ett testfall som bevisar det för varje operation.

#### Datalagret — `src/server/months.js`

Varje funktion tar `userId` först och har `user_id = ?` i varje `WHERE`.

```
addTemplate(userId, month, draft)            -> den skapade mallen
endTemplate(userId, seriesId, month)         -> avslutar serien från och med month
changeTemplateFrom(userId, seriesId, month, draft) -> versionerar: avslutar gamla, skapar ny
setOverride(userId, templateId, month, amountOre) -> belopp bara den månaden
skipMonth(userId, templateId, month)         -> hoppar över den månaden
clearOverride(userId, templateId, month)     -> tar bort en override
```

**`changeTemplateFrom` är den svåraste** och ska ske i **en transaktion**: faller
den andra skrivningen får den första inte bli kvar. SQLite ger `BEGIN` och
`COMMIT` genom `exec`; `db.js` äger omslutningen.

**En mall som ändras från sin egen `from_month`** ska inte ge två rader där den
gamla är tom. Sätts `to_month` till månaden före `from_month` blir serien
ogiltig — `CHECK (to_month IS NULL OR to_month >= from_month)` fäller den. Då ska
den gamla raden i stället **uppdateras** i stället för att versioneras, eftersom
ingen passerad månad berörs. Skriv ut villkoret i koden.

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `POST /api/mallar/<ÅÅÅÅ-MM>` | `{ kind, name, amountSek, category, interval, toMonth }` | `201` med mallen. `400` med `fieldErrors`. `401`. `500`. |
| `PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>` | samma plus `{ omfattning }` | `200`. `400`. `401`. `404`. `500`. |
| `DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>` | `{ omfattning }` | `204`. `401`. `404`. `500`. |
| `PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>` | `{ amountSek }` eller `{ skipped: true }` | `200`. `400`. `401`. `404`. `500`. |

`omfattning` är `"denna"`, `"framat"` eller `"hela"`. Ett okänt värde ger `400`
med `Välj om ändringen gäller den här månaden, framåt eller hela serien.`

#### Gränssnittet

**I formuläret** tillkommer en kryssruta `Återkommande` som öppnar två fält:
`Intervall` med de fyra alternativen ur `INTERVAL_LABELS`, och `Till och med`
som är valfritt och tomt betyder tills vidare.

**På en rad som kommer från en mall** har `Ändra` och `Ta bort` inte längre ett
enda utfall. Båda öppnar en fråga med tre val, formulerade så att användaren
förstår följden utan att veta vad en mall är:

| Knapp | Fråga | Val |
|---|---|---|
| Ändra | `Vad ska ändras?` | `Bara <månad>` · `Från och med <månad>` |
| Ta bort | `Vad ska tas bort?` | `Bara <månad>` · `Från och med <månad>` |

`<månad>` skrivs med `monthLabel`, alltså `Oktober 2026`.

**Tabellen ovan hade först ett tredje val, `Hela serien`, med en varningstext.**
Det valet togs bort av rättelsen längre ned i det här avsnittet — se
`#### Hela serien tas bort som val`. Raderna här är uppdaterade; varningstexten
finns inte längre, eftersom ingen av de två kvarvarande vägarna rör historiken.

**Tomläget** och summeringen är oförändrade. En mallpost räknas in i summorna på
samma sätt som i dag.

#### Kravlista [etapp 4]

`tests/months.test.js`, fortsätter från (M10):

| # | Fall | Kräver |
|---|---|---|
| (M11) | en mall syns i varje månad från `from_month` | tre månader i rad |
| (M12) | `endTemplate` lämnar passerade månader orörda | månaden före har posten kvar, månaden efter saknar den |
| (M13) | `changeTemplateFrom` versionerar | två rader med samma `series_id`, den gamla med `to_month` satt |
| (M14) | ändring framåt rör inte historiken | föregående månad har gamla beloppet, denna och nästa det nya |
| (M15) | ändring från egen `from_month` uppdaterar i stället | en rad, inte två |
| (M16) | `setOverride` ändrar bara sin månad | grannmånaderna oförändrade |
| (M17) | `skipMonth` tar bort posten ur en månad | och bara ur den |
| (M18) | `clearOverride` återställer | mallens belopp tillbaka |
| (M19) | transaktionen håller | en `changeTemplateFrom` som faller halvvägs lämnar noll ändringar |
| (M20) | en annan användares mall är onåbar | samma svar som för ett okänt id |

`tests/month-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (M21) | `POST /api/mallar/<månad>` skapar | `201`, och posten syns i `GET` för nästa månad också |
| (M22) | okänd `omfattning` ger `400` | texten ordagrant |
| (M23) | `DELETE` med `framat` | denna och kommande månader saknar posten, föregående har den |
| (M24) | `PUT` med `denna` | bara den månaden ändras |

`tests/app.test.js`, fortsätter från (63):

| # | Fall | Kräver |
|---|---|---|
| (64) | kryssrutan öppnar de två fälten | de är dolda tills den kryssas |
| (65) | en mallrads `Ändra` visar två val | `Bara <månad>` och `Från och med <månad>`, med månadens namn skrivet av `monthLabel` |
| (66) | en engångsposts `Ändra` visar inga val | formuläret öppnas direkt, som före etapp 4 |
| (67) | de två valen går till olika vägar | `Från och med` anropar `PUT /api/mallar/<seriesId>/<månad>`, `Bara` anropar `PUT /api/poster/<id>/manad/<månad>` |

**(65) och (67) är omskrivna.** De bar först `tre val` respektive varningstexten
på `Hela serien`, alltså kravlistans form före rättelsen i samma avsnitt. Det
som nu prövas i (67) är skillnaden som betyder något: att de två valen leder till
olika vägar, och därmed till olika följder för historiken.

---

### Rättelse av etapp 4: `omfattning` utgår (bindande)

Byggaren lämnade tillbaka `PUT` och `DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>`
med tre invändningar. Alla tre är riktiga, och alla tre är fel i den
specifikation jag skrev. Det här avsnittet ersätter `omfattning` helt.

#### Felen

1. **`omfattning: "hela"` hade ingen funktion bland de sex.** Gränssnittet lovade
   ett val som datalagret inte kunde utföra.
2. **`omfattning: "denna"` dubblerade en väg som redan finns.** `setOverride` och
   `skipMonth` tar ett `templateId`, inte ett `seriesId`, och samma operation nås
   genom `PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>`. Dessutom kan `overrides` bara
   bära ett belopp — det finns ingen kolumn för ett avvikande namn eller slag en
   enskild månad.
3. **`DELETE`-radens svarskolumn saknade `400`** medan texten under tabellen krävde
   det. Två besked om samma väg.

#### `Hela serien` tas bort som val

Modellen är byggd för att en passerad månad aldrig skrivs om. Ett val som bryter
den principen är en fälla: det ser ut som en bekvämlighet och är i själva verket
det enda sättet att förstöra sin egen historik.

Vill användaren ändra en hel serie går hen till **seriens första månad** och
ändrar därifrån. Det är några klick mer och ett ärligt steg: den som bläddrar
tillbaka till januari 2026 för att ändra hyran förstår att januari ändras.

#### Vägarna utan `omfattning`

Varje väg gör nu **en** sak, och vilken avgörs av vägen — inte av ett fält i
kroppen.

| Metod och väg | Betyder | Svar |
|---|---|---|
| `POST /api/mallar/<ÅÅÅÅ-MM>` | Skapa en återkommande post | `201` med mallen. `400` med `fieldErrors`. `401`. `500`. |
| `PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>` | Ändra **från och med** månaden | `200` med den nya versionen. `400` med `fieldErrors`. `401`. `404`. `500`. |
| `DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>` | Avsluta serien **från och med** månaden | `204`. `401`. `404`. `500`. |
| `PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>` | Ändra eller hoppa över **bara den månaden** | `200` med `{ items, totals }`. `400`. `401`. `404`. `500`. |

`DELETE` har ingen kropp och därför ingen `400`. `PUT /api/mallar/...` anropar
`changeTemplateFrom`, `DELETE` anropar `endTemplate`.

**Svarskroppen `{ items, totals }`** för den sista vägen är byggarens val och
godkänns: en överhoppad månad har ingen post att svara med, så `{ item }` går
inte, och formen är densamma som `GET /api/manad/<ÅÅÅÅ-MM>` redan ger.

#### Gränssnittets två frågor skrivs om

| Knapp | Fråga | Val |
|---|---|---|
| Ändra | `Vad ska ändras?` | `Bara <månad>` · `Från och med <månad>` |
| Ta bort | `Vad ska tas bort?` | `Bara <månad>` · `Från och med <månad>` |

`Bara <månad>` går till `PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>`; vid borttagning
med `skipped`, vid ändring med `amountSek`. `Från och med <månad>` går till
mallvägarna. Ingen varningstext behövs längre, eftersom ingen väg rör historiken.

#### De tre texterna skrivs in i facit

Byggaren skrev dem för att vägarna annars hade gett `500` ur schemats `CHECK` i
stället för ett fältfel. De godkänns ordagrant:

| Nyckel | Text |
|---|---|
| `toMonthFormat` | `Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.` |
| `toMonthBeforeFrom` | `Till och med kan inte vara före den månad posten gäller från.` |
| `overrideShape` | `Ange ett belopp för månaden, eller att posten ska hoppas över.` |

#### Två fynd som får sina rader

**Överlappande versioner.** Ändrar användaren från en framtida månad och därefter
från en tidigare, täcker två versioner samma månader och posten visas två gånger.
`changeTemplateFrom` ska därför ta bort varje version vars `from_month` ligger i
eller efter den månad ändringen gäller, i samma transaktion — samma sak som
`endTemplate` redan gör, och av samma skäl: de täcker ingen passerad månad.

**Avvikelser på en passerad månad.** `setOverride` och `skipMonth` mot en månad
som redan passerat ändrar vad den månaden visar. Det är tillåtet och avsiktligt:
en glömd utgift ska gå att föra in i efterhand. Invarianten gäller att en
ändring av en post aldrig får ändra *andra* månader än den som pekas ut, och den
håller.

#### Kravlistan ändras

(M22) och (M23) utgår — de prövade `omfattning`. I stället:

| # | Fall | Kräver |
|---|---|---|
| (M22) | `PUT /api/mallar/<seriesId>/<månad>` ändrar framåt | föregående månad har gamla beloppet, denna och nästa det nya |
| (M23) | `DELETE /api/mallar/<seriesId>/<månad>` avslutar | föregående månad har posten, denna och nästa saknar den |
| (M25) | en andra ändring från en tidigare månad ger inte två poster | serien visas en gång per månad |

---

## Del 4: demoläge

Appen ska kunna visas för arbetsgivare på en egen domän utan att någon backend,
databas eller betalning körs. Allt ligger i `src/web/demo/` och är avstängt som
förval.

### Varför ingen MSW

Uppdraget föreslår Mock Service Worker. Den används inte, och skälet ska stå
skrivet: MSW finns för att fånga anrop i en app vars kod man inte äger eller inte
vill röra. Här äger projektet varje rad, och `tests/helpers/dom.js` har redan en
fetch-attrapp — `createFetch` — byggd för samma syfte. En modul som ersätter
`globalThis.fetch` gör samma sak utan ett beroende, och projektets regel om noll
beroenden står därför orörd.

Följden är dessutom praktisk: demon är rena statiska filer. Ingen byggkedja,
ingen serviceworker att registrera, inget som kan misslyckas i produktion.

### Flaggan

`src/web/demo/demolage.js` exporterar `DEMO`, en boolesk konstant.

```js
export const DEMO = false;
```

**Raden byts till `true` vid publicering** och är det enda som skiljer demon från
den riktiga appen. Ingen miljövariabel, eftersom projektet inte har någon
byggkedja som kan läsa en.

Är `DEMO` falsk laddas ingen annan fil under `demo/`, och appen beter sig exakt
som i dag. Det ska finnas ett testfall som kräver det.

### Attrappen

`src/web/demo/demo-fetch.js` ersätter `globalThis.fetch` innan `app.js` laddas,
och svarar på de sju vägarna med **samma JSON och samma statuskoder som servern**:

| Väg | Svar |
|---|---|
| `POST /api/auth/kod` | `202` utan kropp |
| `POST /api/auth/logga-in` | `204` |
| `POST /api/auth/logga-ut` | `204` |
| `GET /api/mig` | `200 { email }` eller `401 { error }` |
| `GET /api/manad/<ÅÅÅÅ-MM>` | `200 { items, totals }` |
| `POST /api/manad/<ÅÅÅÅ-MM>` | `201 { item }` eller `400 { error, fieldErrors }` |
| `PUT`/`DELETE /api/poster/<id>` | `200`/`204` eller `404` |
| Mallvägarna | som servern |

**Summorna räknas av `budget.js` och posterna av samma kedja som `months.js`
använder** — attrappen får inte räkna själv. Kärnan i `src/core/` körs redan i
webbläsaren, så `monthTotals`, `nextDueDate` och `validateMonthItemDraft`
anropas direkt. Då visar demon den verkliga logiken, inte en efterhärmning.

Valideringen ska ge **samma fältfel** som servern: skriver besökaren `12 000` får
hen den vägledande beloppstexten, precis som i den riktiga appen.

### Seed-data

`src/web/demo/seed.js`. Demoanvändaren är `anna.andersson@exempel.se` — en
påhittad adress på ett domännamn som inte kan ta emot post.

Tre månader, med den aktuella månaden som mitten. Beloppen är realistiska för ett
svenskt hushåll:

| Slag | Namn | Belopp | Intervall |
|---|---|---|---|
| Inkomst | Lön | 32 000 kr | månadsvis |
| Inkomst | Barnbidrag | 1 250 kr | månadsvis |
| Utgift | Hyra | 8 900 kr | månadsvis |
| Utgift | El | 760 kr | månadsvis |
| Utgift | Mat | 6 200 kr | månadsvis |
| Utgift | Mobil och bredband | 598 kr | månadsvis |
| Utgift | Hemförsäkring | 1 450 kr | kvartalsvis |
| Utgift | Bilskatt | 2 800 kr | halvårsvis |
| Sparande | Buffert | 3 000 kr | månadsvis |
| Sparande | Pension | 1 500 kr | månadsvis |

De återkommande posterna är mallar, så besökaren ser märket och kan bläddra
mellan månader och se dem följa med. Kvartals- och halvårsposterna syns bara de
månader de dras — det visar intervallogiken utan att något behöver förklaras.

Minst en månad ska ha en **avvikelse**: elräkningen högre i januari. Det visar
att ett belopp kan ändras för en enda månad.

### Lagring

`src/web/demo/lagring.js`. Varje ändring besökaren gör sparas i `localStorage`
under en egen nyckel, så demon känns levande mellan sidladdningar.

`localStorage` kan saknas eller kasta — i privat läge, med blockerad lagring. Varje
läsning och skrivning omsluts, och demon ska fungera utan lagring: då försvinner
ändringarna vid omladdning, vilket är bättre än ett fel.

`Återställ demo` tömmer nyckeln och laddar om seed-datan.

### Bannern

`src/web/demo/banner.js` ritar en smal rad högst upp på båda sidorna, i temats
färger:

```
Demoversion - ingen riktig data eller betalning.  [Se koden på GitHub]  [Återställ demo]
```

Den går att fälla ihop till en smal remsa men aldrig dölja helt. GitHub-länken är
en platshållare tills repot finns.

Sidfoten får raden `Portfolio-projekt av Jelal Qaiumi` med platshållare för
GitHub och LinkedIn. **Den visas alltid**, inte bara i demoläge — den är sann
oavsett.

### Inloggning i demoläge

Inloggningsvyn får knappen `Logga in som demoanvändare`, som **bara visas när
`DEMO` är sann**. Den loggar in direkt, utan kod.

Formuläret för e-post och kod står kvar och fungerar: skriver besökaren en adress
får hen en kod — attrappen visar den i bannern i stället för att mejla den, så
att hela flödet går att prova. Ingen adress skickas någonstans och ingen sparas
utanför `localStorage`.

### Det demon inte visar

Skrivs ut i bannerns hjälptext och i README: prisplaner, behörighet, sparmål,
räkningspåminnelser, delat hushåll och Mina funktioner är **inte byggda**. De
står på landningssidan som design. En planväxlare har därför inget att växla
mellan och byggs inte.

### Publicering

Demon är statiska filer: `landning.html`, `index.html`, `app.js`, de tre
CSS-filerna, `bilder/` och `core/`. De kan läggas på vilken statisk värd som
helst — Vercel, Netlify, GitHub Pages.

**Två vägar måste fungera:** `/` ger landningssidan och `/app` ger appen. På en
statisk värd betyder det en omskrivningsregel, eller att `index.html` döps om.
Skriv ut vilket och varför i README.

Ingen serviceworker, inget `mockServiceWorker.js`, ingen byggkedja.

### Kravlista [demoläge]

| # | Fall | Kräver |
|---|---|---|
| (D1) | `DEMO` är falsk som förval | filen exporterar `false`, och ett testfall kräver det |
| (D2) | avstängt läge rör ingenting | med `DEMO` falsk laddas ingen demofil, och appens testfall passerar oförändrade |
| (D3) | attrappen svarar som servern | varje väg jämförs mot den riktiga serverns statuskod och JSON-form |
| (D4) | summorna kommer ur `budget.js` | attrappen räknar inte själv |
| (D5) | valideringen ger samma fältfel | `12 000` ger den vägledande texten |
| (D6) | en ny post överlever omladdning | sparad i `localStorage`, läst tillbaka |
| (D7) | `Återställ demo` ger seed-datan | ändringen borta, ursprunget tillbaka |
| (D8) | utan `localStorage` fungerar demon | läsningen kastar, appen visar ändå seed-datan |
| (D9) | en återkommande post följer med | syns i tre månader i rad |
| (D10) | kvartalsposten syns bara sina månader | tre månader, en träff |

---

### Rättelse: posten bär sitt intervall (bindande) [etapp 4]

Byggaren av gränssnittet hittade en tyst dataförlust, och den är verifierad:
`readMonth` ger en post fälten `id, kind, name, amountOre, category, dueDate,
recurring, seriesId, overridden` — **inte `interval` och inte `toMonth`.**

`PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>` kräver båda. Gränssnittet kan alltså inte
förifylla dem, och `<select>` står på sitt första alternativ, som är månadsvis.
Följden: en användare som ändrar **beloppet** på en kvartalspost genom
`Från och med <månad>`, utan att röra intervallfältet, skriver om serien till
månadsvis. Ingenting varnar, och felet syns först när en dragning dyker upp i en
månad den inte skulle.

Det är samma sorts fel som versioneringen finns för att undvika: en ändring som
rör något användaren inte bad om att ändra.

#### Postens form utökas

`readMonth` ger varje post två fält till. De är `null` för en engångspost, som
inte har något intervall:

| Fält | Mallpost | Engångspost |
|---|---|---|
| `interval` | mallens `interval` | `null` |
| `toMonth` | mallens `to_month`, eller `null` | `null` |

Samma två fält läggs till i `src/web/demo/demo-fetch.js`, så att demon och
servern svarar lika. Ett testfall ska jämföra fältlistan mellan de två.

Gränssnittet förifyller då `Intervall` och `Till och med` ur posten när
`Från och med <månad>` väljs, precis som det redan förifyller namn, belopp och
kategori.

#### `Bara <månad>` döljer de fält som inte går att ändra

Byggarens andra fynd: i det läget bär kroppen bara `amountSek`, eftersom
`overrides` varken har en kolumn för namn eller för kategori. Fälten står ändå
redigerbara, och en ändring av namnet försvinner tyst när formuläret skickas.

I läget `Bara <månad>` döljs därför **namn, kategori, kryssrutan och de två
återkommandefälten**. Kvar står beloppet, som är det enda som går att ändra för
en enskild månad. Formulärets rubrik eller en kort rad ska säga vad som gäller:

```
Ändrar bara beloppet för <månad>.
```

Att dölja är bättre än att spärra: ett utgråat fält ser ut som något som kan
låsas upp, medan ett fält som inte finns inte väcker frågan.

#### Kravlista

| # | Fall | Kräver |
|---|---|---|
| (68) | posten bär `interval` och `toMonth` | en kvartalsmall ger `quarterly`, en engångspost ger `null` |
| (69) | demon ger samma fält som servern | fältlistorna jämförs |
| (70) | `Från och med` förifyller intervallet | en kvartalspost visar `Kvartalsvis` i fältet, inte `Månadsvis` |
| (71) | en beloppsändring behåller intervallet | ändra bara beloppet på en kvartalspost: serien är kvar som kvartalsvis |
| (72) | `Bara <månad>` döljer de fält som inte går att ändra | namn, kategori, kryssruta och de två fälten är dolda; beloppet syns |

---

### Historik och tolvmånadersöversikt (bindande) [etapp 5]

Att bläddra bakåt fungerar sedan etapp 3: månadsväljaren visar vilken månad som
helst, och versioneringen i etapp 4 gör att en passerad månad visar det som
gällde då. Det som saknas är **överblicken** — tolv månader bredvid varandra.

#### Datalagret

```
readOverview(userId, endMonth, count) -> { months, savedThisYear }
```

`months` är en lista med `count` poster, äldst först, var och en
`{ month, incomeOre, expenseOre, savingOre, leftOre }`. `endMonth` är den sista
månaden, alltså normalt den aktuella.

**Summorna räknas av `monthTotals`**, samma funktion som en enskild månad
använder. Ingen andra väg till ett tal.

`savedThisYear` är summan av `savingOre` för varje månad i `endMonth`:s år, till
och med `endMonth`. En översikt som slutar i oktober 2026 räknar alltså januari
till oktober 2026, oavsett hur många månader `count` sträcker sig bakåt.

**Spärrar, första träff vinner:**

| # | Villkor | Svensk text |
|---|---|---|
| 1 | `endMonth` är inte en månad | `readOverview kräver en månad på formen ÅÅÅÅ-MM, fick "<värdet>".` |
| 2 | `count` är inte ett heltal mellan 1 och 36 | `readOverview kräver ett antal månader mellan 1 och 36, fick "<värdet>".` |

Taket 36 finns för att en översikt läser varje månads hela kedja: mallar,
intervallträffar, avvikelser och engångsposter. Utan tak kan en klient be om
tiotusen månader och få servern att arbeta i onödan.

#### API-vägen

| Metod och väg | Svar |
|---|---|
| `GET /api/oversikt/<ÅÅÅÅ-MM>` | `200` med `{ months, savedThisYear }`. `400` vid fel månadsformat. `401`. `500`. |

Antalet månader är tolv och står inte i vägen — en klient ska inte kunna be om
ett annat antal förrän det finns ett skäl. `count` är ändå ett argument i
datalagret, eftersom testerna behöver kortare serier.

#### Gränssnittet

En ny vy som månadsvyn växlar till, inte en egen sida: sidomenyn får en knapp
`Översikt`, och månadsvyn får tillbaka en knapp `Tillbaka till månaden`. Ingen
router, samma mönster som inloggningsvyn och månadsvyn redan använder.

**Överst: tre tal.**

| Tal | Innehåll |
|---|---|
| `Sparat hittills i år` | `savedThisYear` genom `formatSek` |
| `Snitt kvar per månad` | medelvärdet av `leftOre`, avrundat med `divideRoundHalfUp` i `money.js` |
| `Bästa månaden` | månaden med högst `leftOre`, skriven med `monthLabel` |

**Därefter ett stapeldiagram** som inline-SVG, byggt av `app.js` på samma sätt
som kategoridiagrammet: en stapel per månad, höjden som andel av den största
`leftOre`. En månad med negativt `leftOre` ritas **nedåt** från en nollinje och i
`--negativ`; en positiv uppåt i `--positiv`. Nollinjen ska synas.

**Och under det en tabell** med en rad per månad: månad, inkomst, utgift,
sparande, kvar. Diagrammet visar formen, tabellen de exakta talen — den som vill
läsa siffror ska inte behöva tolka en stapel.

**Tomma månader utelämnas inte.** En månad utan poster visas med fyra nollor,
annars ser tidslinjen ut att hoppa över tid.

#### Kravlista [etapp 5]

`tests/months.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (M26) | tolv månader i rätt ordning | äldst först, och den sista är `endMonth` |
| (M27) | summorna kommer ur `monthTotals` | samma tal som `readMonth` ger för varje månad |
| (M28) | `savedThisYear` räknar årets månader | en översikt över ett årsskifte räknar bara innevarande år |
| (M29) | en tom månad ger fyra nollor | inte en utelämnad rad |
| (M30) | en annan användares data syns inte | tomma månader för det andra kontot |
| (M31) | spärrarna | ett fall per rad, hela meddelandet asserterat |

`tests/month-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (M32) | `GET /api/oversikt/<månad>` ger tolv månader | och `savedThisYear` |
| (M33) | fel månadsformat ger `400` | och når aldrig datalagret |

`tests/app.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (73) | `Översikt` byter vy | månadsvyn döljs, översikten visas |
| (74) | `Tillbaka till månaden` byter tillbaka | till samma månad som innan |
| (75) | de tre talen kommer ur svaret | inget räknas i `app.js` utom snittet, som använder `money.js` |
| (76) | en negativ månad ritas nedåt och i `--negativ` | klassen finns på stapeln |
| (77) | tabellen har en rad per månad | tolv rader, i samma ordning som diagrammet |

---

## Del 5: planer och behörighet

### En källa för planerna (bindande)

`src/core/plans.js` är **den enda** platsen som vet vad en plan kostar och vad
den innehåller. Prissidan, appen och servern läser alla därifrån. Modulen är ren
kärna — ingen `node:`-import — eftersom både servern och webbläsaren behöver den.

```
PLANS           -> fryst, de tre planerna i ordning
FEATURES        -> fryst lista med funktionsnycklarna
PLAN_LABELS     -> svenska namn
hasFeature(plan, feature) -> boolean
planFor(feature)          -> den lägsta plan som har funktionen
```

#### Planerna

| Nyckel | Namn | Pris per månad | Funktioner utöver den lägre |
|---|---|---|---|
| `bas` | Bas | `9900` ören | `budget`, `billReminders`, `overview` |
| `plus` | Plus | `14900` | `savingsGoals`, `sharedHousehold`, `reports` |
| `premium` | Premium | `17900` | `customFeatures`, `prioritySupport` |

**Priserna lagras i ören**, som varje annat belopp i projektet, och skrivs ut med
`formatSek`. En plan ärver den lägre planens funktioner — `hasFeature` löser
upp det, så ingen lista räknar upp samma nyckel två gånger.

**`FEATURES` är frusen och uttömmande.** `hasFeature` med en nyckel som inte står
där kastar `RangeError` med texten
`hasFeature kräver en känd funktion, fick "<värdet>".` Skälet är detsamma som
gav `cost.js` sin spärr: ett uppslag med en okänd nyckel ger annars tyst `false`,
och en funktion som råkat stavas fel ser då ut att vara låst för alla.

#### Kopplingen till schemat

`users` får kolumnen `plan`:

```sql
plan TEXT NOT NULL DEFAULT 'bas' CHECK (plan IN ('bas', 'plus', 'premium'))
```

Ett testfall ska jämföra `CHECK`-listan mot `Object.keys(PLANS)`, på samma sätt
som `kind` redan jämförs mot `ITEM_KINDS` — annars kan de två glida isär.

**Befintliga rader får `bas`** genom kolumnens förval. Ingen migrering behövs
utöver `ALTER TABLE`, och den körs bara när kolumnen saknas.

### Behörigheten på servern

En spärr i `src/server/api.js`, byggd som **en funktion varje skyddad väg går
genom** — aldrig en kontroll upprepad per väg, eftersom en upprepad kontroll är
en som glöms på en väg.

```
requireFeature(session, feature) -> null eller ett svar
```

Räcker planen inte svarar vägen `403` med:

```json
{ "error": "<text>", "feature": "<nyckel>", "requiredPlan": "<plan>" }
```

Texten är `Funktionen ingår i <Plan>. Uppgradera för att låsa upp.` där
`<Plan>` är det svenska namnet ur `PLAN_LABELS`.

**`feature` och `requiredPlan` i svaret** finns för att gränssnittet ska kunna
visa rätt ruta utan att gissa ur texten.

**Spärren prövas efter sessionen men före allt annat.** Ordningen är bindande:
session, behörighet, månadsspärr, validering, datalager. En utan session ska få
`401` och inte `403` — annars avslöjar svaret vilka funktioner som finns för den
som inte är inloggad.

### Nedgradering raderar ingen data

En användare som går från Plus till Bas behåller varje rad. Data blir
**skrivskyddad och dold**, inte borttagen:

- Läsvägar för en funktion planen saknar svarar `403`.
- Skrivvägar svarar `403`.
- Ingenting raderas, och en uppgradering gör allt synligt igen.

Det ska finnas ett testfall som skapar data på Plus, går ned till Bas, går upp
igen och kräver att raden är oförändrad.

### Byta plan

| Metod och väg | Kropp | Svar |
|---|---|---|
| `GET /api/plan` | ingen | `200 { plan, features }` |
| `PUT /api/plan` | `{ plan }` | `200 { plan, features }`. `400` vid okänd plan. `401`. |

`400`-texten är `Välj Bas, Plus eller Premium.`

**Ingen betalning.** Bytet sparas direkt, och gränssnittet visar
`Demo: ingen betalning genomförs.` Det står så tills en riktig betalning finns —
och ingen knapp får antyda att pengar dras innan dess.

### Gränssnittet

**Prissidan renderas ur `PLANS`.** De tre korten byggs av `landning.html` med
data ur modulen, inte med inskriven text. Priset skrivs med `formatSek`.
Texten under korten blir:

```
Detta är en demo - du kan byta plan fritt och ingen betalning dras.
```

**Sidomenyn visar låsta funktioner** med en låsikon. Ett klick ger en ruta:

```
Funktionen ingår i <Plan>. Uppgradera för att låsa upp.   [Se planer]
```

**Inställningar → Min plan** visar nuvarande plan och tre knappar. Byte sker
direkt, och vyn ritas om så att låsta funktioner låses upp utan omladdning.

### Kravlista [steg 1]

`tests/plans.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (P1) | `hasFeature` ärver uppåt | Premium har `budget`, Bas har inte `reports` |
| (P2) | okänd funktion kastar | hela meddelandet asserterat |
| (P3) | `planFor` ger lägsta planen | `reports` ger `plus` |
| (P4) | listorna är frysta | `Object.freeze` håller |
| (P5) | `FEATURES` täcker varje plans funktioner | ingen nyckel i en plan saknas i `FEATURES` |

`tests/db.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (P6) | `plan`-kolumnens `CHECK` är `Object.keys(PLANS)` | läst ur `sqlite_master` |
| (P7) | förvalet är `bas` | en rad utan `plan` får `bas` |

`tests/plan-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (P8) | Bas får `403` på en Plus-väg | med `feature` och `requiredPlan` i svaret |
| (P9) | Plus får `200` på samma väg | |
| (P10) | utan session ges `401`, inte `403` | behörigheten avslöjas inte för utloggad |
| (P11) | `PUT /api/plan` byter | och `GET` visar den nya |
| (P12) | okänd plan ger `400` | texten ordagrant |
| (P13) | nedgradering raderar inget | data på Plus, ned till Bas, upp igen: raden oförändrad |

---

### Budget per kategori (bindande) [steg 2]

Priskortet lovar `Budget och utgiftsregistrering` på Bas. Registreringen finns
sedan etapp 3. Det som saknas är **taket** — ett belopp per kategori och per
månad, och visningen av hur mycket som är kvar av det.

Punkten lovar också **datum och kommentar** på en post. De fälten finns inte.

#### Tabellen

```sql
CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category    TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, month, category)
);
```

`UNIQUE` hindrar två tak för samma kategori och månad. `category` prövas mot
`CATEGORY_LABELS` i kärnan, inte i schemat — kategorilistan ägs av `entry.js`
och ett `CHECK` här hade blivit en andra kopia.

**Ett tak gäller en månad.** Vill användaren ha samma tak varje månad sätts det
per månad; en återkommande budget är en annan funktion och byggs inte nu.

#### Två nya fält på en post

`month_items` får:

```sql
occurred_on TEXT CHECK (occurred_on IS NULL OR occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
note        TEXT
```

`occurred_on` är dagen utgiften gjordes, `null` när användaren inte anger den.
Den **får inte** blandas ihop med `dueDate`, som räknas fram ur en mall — en
inskriven dag och en härledd dragningsdag är två olika saker, och fältnamnen
ska hållas isär.

`note` är fritext, högst 200 tecken, mätt med `[...note].length` som `checkName`
redan gör. Längre ger `Kommentaren får vara högst 200 tecken.`

Mallar får **inte** de två fälten: en återkommande post har ingen enskild dag
och ingen enskild kommentar.

#### Kvar av budgeten

`readMonth` svarar med ett fält till:

```
budgets: [ { category, amountOre, spentOre, leftOre } ]
```

`spentOre` är summan av månadens **utgifter** i kategorin — inkomster och
sparande räknas inte. `leftOre = amountOre - spentOre` och **får vara negativt**:
har användaren dragit över taket ska det synas som ett minusbelopp, inte som
noll.

Bara kategorier med ett tak kommer med. En kategori utan tak har ingen budget
att vara kvar av.

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `PUT /api/budget/<ÅÅÅÅ-MM>` | `{ category, amountSek }` | `200` med månadens budgetar. `400` med `fieldErrors`. `401`. `500`. |
| `DELETE /api/budget/<ÅÅÅÅ-MM>/<kategori>` | ingen | `204`. `401`. `404`. `500`. |

`PUT` skapar taket eller ersätter det som finns — `UNIQUE` gör det till en
operation. Behörighet: `budget` finns i alla tre planerna, så spärren släpper
igenom var och en, men vägen går ändå genom `requireFeature` så att den dagen
något ändras finns kontrollen på plats.

#### Gränssnittet

**I månadsvyn, under utgiftslistan:** ett kort `Budget` med en rad per kategori
som har ett tak:

```
Mat        4 000,00 kr    kvar 1 240,00 kr
Boende     9 000,00 kr    kvar -300,00 kr
```

Kvar-beloppet bär `left-positive` eller `left-negative`, samma klasser som
summeringen redan använder. En knapp `+ Sätt tak` öppnar ett litet formulär med
kategori och belopp.

**I postformuläret** tillkommer `Datum` (valfritt) och `Kommentar` (valfritt).
De döljs när kryssrutan `Återkommande` är ikryssad, eftersom en mall inte har
dem — samma mönster som `Bara <månad>` redan använder för att dölja fält som
inte går att ändra.

#### Kravlista [steg 2]

`tests/months.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (B1) | ett tak syns bara i sin månad | grannmånaderna har inget |
| (B2) | `spentOre` räknar bara utgifter | en inkomst och ett sparande i samma kategori påverkar inte |
| (B3) | `leftOre` får vara negativt | ett överdrag ger ett minusbelopp |
| (B4) | `PUT` ersätter ett befintligt tak | en rad, inte två |
| (B5) | kategori utan tak saknas i `budgets` | listan bär bara satta tak |
| (B6) | en annan användares tak syns inte | |
| (B7) | `occurred_on` och `note` sparas och läses | och är `null` när de inte anges |
| (B8) | en för lång kommentar avvisas | texten ordagrant |
| (B9) | en mall får inte de två fälten | utkastet avvisas eller fälten ignoreras — skriv ut vilket |

`tests/app.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (78) | budgetkortet visar kvar per kategori | tre rader, rätt belopp |
| (79) | ett överdrag får `left-negative` | klassen finns |
| (80) | `Återkommande` döljer datum och kommentar | och visar dem igen när rutan avmarkeras |

---

### Rättelser till steg 2 (bindande)

Tre saker byggaren hittade, alla fel i det jag skrev.

#### De två texter som saknades

Avsnittet skrev ut `Kommentaren får vara högst 200 tecken.` men ingen text för
ett ogiltigt datum och ingen för en kommentar som inte är text. Byggaren fick
välja dem, byggda på formen hos `toMonthFormat`. De godkänns ordagrant:

| Nyckel | Text |
|---|---|
| `occurredOnFormat` | `Datum måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD, eller lämnas tomt.` |
| `noteType` | `Kommentaren måste vara text.` |

Datumtexten täcker tre fel i ett — fel form, ogiltigt datum och fel typ —
eftersom `isValidIsoDate` avgör alla tre i samma fråga. Det är avsiktligt: tre
texter för samma fält hade gett användaren tre sätt att få veta samma sak.

#### Kravlistans nummer byter prefix

Kravlistan för steg 2 använde `(B1)` till `(B9)`, men `tests/budget.test.js` har
redan `(B1)` till `(B6)` för `src/core/budget.js`. Två uppsättningar med samma
nummer i samma projekt gör att nästa läsare slår upp fel punkt.

**Steg 2:s fall heter `(BU1)` till `(BU9)`** — `BU` för budget. Byggaren följde
den ursprungliga listan och märkte varje testnamn så att de går att skilja åt;
numren skrivs om i testfilen när någon ändå rör den, inte som en egen ändring.

De sex äldre `(B1)` till `(B6)` behåller sina nummer, eftersom de är äldst och
ligger i den fil namnet pekar ut.

#### `requireFeature` fanns inte när jag sa att den gjorde det

Min lägesbeskrivning till steg 2:s byggare sade att `requireFeature` var spärren
varje skyddad väg går genom. Det var falskt: steg 1 stallade innan den byggdes,
och jag kontrollerade aldrig före jag skrev. Byggaren byggde den enligt
specifikationen.

Följden står kvar: **(P8) och (P9) är fortfarande obyggbara.** De kräver en väg
som Bas saknar behörighet till, och `budget` finns i alla tre planerna. De blir
byggbara i steg 3, när den första Plus-funktionen finns.

Lärdomen är densamma som filen redan bär på nio ställen: ett påstående om vad
koden innehåller ska köras, inte antas — också när det är jag som skriver det.

#### Två beslut byggaren fattade och som godkänns

**`budgets`-listans ordning** följer `CATEGORIES`, av samma skäl som en månads
poster sorteras i `ITEM_KINDS` ordning: en lista som byter ordning mellan två
hämtningar är svår att läsa.

**`validateBudgetDraft` ligger i `src/core/item.js`**, där projektets övriga
utkastvaliderare bor.

---

### Räkningar och påminnelser (bindande) [steg 3]

Priskortet lovar `Räkningspåminnelser` på Bas. Ingenting av det finns.

**Datumlogiken ska inte skrivas om.** `src/core/schedule.js` äger sedan paket 7
`nextDueDate` med klampning för den 29 till 31 och hopp över flera perioder, och
den är fullt testad. En räkning som återkommer använder den.

#### En räkning är inte en månadspost

De skiljer sig i vad de svarar på:

| | Månadspost | Räkning |
|---|---|---|
| Frågan | Vad kostade den här månaden? | Vad ska betalas, och när? |
| Datum | `occurred_on`, dagen det hände | `due_date`, dagen det förfaller |
| Tillstånd | inget | betald eller obetald |
| Hör till | en månad | ett datum |

Därför en egen tabell, inte ett fält till på `month_items`.

```sql
CREATE TABLE IF NOT EXISTS bills (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  amount_ore    INTEGER NOT NULL CHECK (amount_ore > 0),
  due_date      TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  interval      TEXT CHECK (interval IS NULL OR interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  remind_days   INTEGER NOT NULL DEFAULT 3 CHECK (remind_days >= 0 AND remind_days <= 30),
  paid_at       TEXT,
  created_at    TEXT NOT NULL
);
```

`interval` är `NULL` för en engångsräkning. `remind_days` är hur många dagar
innan förfallodagen påminnelsen visas; `0` betyder på dagen.

`CHECK`-listan för `interval` ska jämföras mot `INTERVALS` i ett testfall, som
`kind` redan jämförs mot `ITEM_KINDS`.

#### Betald, och vad som händer sedan

`paid_at` är tidpunkten räkningen markerades betald, `NULL` när den är obetald.

**En återkommande räkning som betalas flyttas fram.** `due_date` sätts till nästa
dragning genom `nextDueDate`, och `paid_at` nollställs. Raden är alltså alltid
den **nästa** obetalda, och historiken över betalda räkningar lagras inte — det
är `PLAN.md` beslut 4, som står kvar: appen håller reda på vad som ska dras, inte
vad som har dragits.

**En engångsräkning som betalas behåller sitt `paid_at`** och faller ur listan
över kommande.

#### Vad `readBills` svarar

```
readBills(userId, today) -> [ { id, name, amountOre, dueDate, interval, remindDays, paidAt, daysUntil, status } ]
```

`daysUntil` räknas med `daysBetween` i `dates.js` — ingen egen räkning.

`status` är ett av tre värden, och **ordningen är bindande, första träff vinner**:

| # | Villkor | `status` |
|---|---|---|
| 1 | `paid_at` är satt | `betald` |
| 2 | `due_date` är före `today` | `forfallen` |
| 3 | `daysUntil <= remind_days` | `paminnelse` |
| 4 | annars | `kommande` |

Listan sorteras på `due_date`, därefter namn i svensk ordning, därefter `id` —
samma kedja som `upcoming` i `schedule.js` redan använder.

`today` är ett argument. **Ingen funktion i datalagret läser klockan.**

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `GET /api/rakningar/<ÅÅÅÅ-MM-DD>` | ingen | `200` med listan. `400` vid fel datumformat. `401`. `500`. |
| `POST /api/rakningar` | `{ name, amountSek, dueDate, interval, remindDays }` | `201`. `400` med `fieldErrors`. `401`. `500`. |
| `PUT /api/rakningar/<id>` | samma | `200`. `400`. `401`. `404`. `500`. |
| `POST /api/rakningar/<id>/betald` | `{ today }` | `200` med räkningen efter flytten. `401`. `404`. `500`. |
| `DELETE /api/rakningar/<id>` | ingen | `204`. `401`. `404`. `500`. |

Dagens datum står i sökvägen respektive kroppen i stället för att läsas på
servern, av samma skäl som månaden gör det: en funktion som läser klockan går
inte att testa.

Alla fem går genom `requireFeature` med `billReminders`, som finns i alla tre
planerna.

#### Gränssnittet

**Ett kort `Räkningar` i månadsvyn**, över budgetkortet. En rad per räkning som
inte är betald, med namn, belopp, förfallodag och dagtext:

| `status` | Utseende |
|---|---|
| `forfallen` | Röd text, `Förföll <N> dagar sedan` |
| `paminnelse` | Guldram, `Förfaller om <N> dagar` eller `Förfaller idag` |
| `kommande` | Vanlig, `Förfaller <datum>` |

Varje rad har knappen `Betald`. En återkommande räkning som markeras betald
visas direkt med sin nya förfallodag — användaren ska se att den kommer igen.

En knapp `+ Ny räkning` öppnar ett formulär med namn, belopp, förfallodag,
intervall (eller `Engångs`) och `Påminn mig <N> dagar innan`.

**Dagtexterna ägs av en funktion i `src/core/`**, inte av `app.js`, eftersom de
är användarvänd text som räknas fram ur ett tal — samma skäl som gav `daysText`
sin plats.

#### Kravlista [steg 3]

`tests/bills.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (R1) | de fyra statusvärdena | ett fall per rad i tabellen, i rätt ordning |
| (R2) | `betald` vinner över `forfallen` | en betald räkning som förfallit är `betald` |
| (R3) | en återkommande räkning flyttas fram | `due_date` till nästa dragning, `paid_at` nollställd |
| (R4) | klampningen följer med | en räkning den 31 januari, månadsvis, ger 28 eller 29 februari |
| (R5) | en engångsräkning blir kvar betald | `paid_at` satt, faller ur kommande |
| (R6) | sorteringen | datum, namn i svensk ordning, id |
| (R7) | `remind_days` styr `paminnelse` | gränsen prövad på båda sidor |
| (R8) | en annan användares räkningar syns inte | |
| (R9) | `CHECK`-listan är `INTERVALS` | läst ur `sqlite_master` |

`tests/bill-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (R10) | de fem vägarna | statuskoderna i tabellen |
| (R11) | fel datumformat ger `400` | och når aldrig datalagret |
| (R12) | `betald` på någon annans räkning ger `404` | samma svar som för ett okänt id |

`tests/app.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (81) | kortet visar de tre utseendena | förfallen, påminnelse, kommande |
| (82) | `Betald` flyttar fram en återkommande | den nya förfallodagen syns |
| (83) | en betald engångsräkning försvinner ur listan | |

---

### Rättelser till steg 3 (bindande)

Byggaren lämnade tillbaka fyra punkter. Användaren har avgjort de två som var
hans att avgöra; de övriga två rättas här.

#### Klampningen ska inte fastna — en ankardag bevaras

Byggaren mätte och skrev ut följden av datamodellen: eftersom bara nästa obetalda
datum lagras finns ingen ursprunglig dag att räkna från, och en räkning den 31
januari glider till den 28:e och stannar där.

```
förföll 2026-01-31, betald 2026-01-31  ->  2026-02-28
förföll 2026-02-28, betald 2026-02-28  ->  2026-03-28
förföll 2026-03-28, betald 2026-03-28  ->  2026-04-28
```

**Användaren har valt att ursprungsdagen ska bevaras.** En hyra som dras den
sista i månaden ska inte glida till den 28:e efter en februari.

Lösningen finns redan i projektet: `templates.start_date` styr intervallets fas,
och `nextDueDate` klampar alltid **från den ursprungliga dagen, aldrig från
föregående klampade resultat**. `bills` får samma fält:

```sql
anchor_date TEXT NOT NULL CHECK (anchor_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')
```

`anchor_date` sätts till den första förfallodagen när räkningen skapas och
**ändras aldrig av en betalning**. Den ändras bara när användaren själv ändrar
förfallodagen genom `PUT`.

`nextBillDueDate` ställer därmed sin fråga med `anchor_date` som `startDate` i
stället för `dueDate`. Allt annat i funktionen står kvar — hoppet över passerade
perioder vid en sen betalning är oförändrat och är byggarens konstruktion, som
godkänns.

Förväntat utfall efter rättningen, och ett obligatoriskt testfall:

```
2026-01-31 -> 2026-02-28 -> 2026-03-31 -> 2026-04-30 -> 2026-05-31
```

**Migreringen** sätter `anchor_date = due_date` för befintliga rader, vilket är
rätt: en räkning som aldrig betalats har sin ursprungliga dag kvar i `due_date`.

#### Dagtexterna med naturlig svenska

Användaren har valt formen med `igår`, `idag` och `imorgon`. Funktionen bor i
`src/core/bill.js` och byggs av gränssnittsuppdraget, som är det som får en
anropare.

| `daysUntil` | Text |
|---|---|
| `-2` eller lägre | `Förföll för <N> dagar sedan` |
| `-1` | `Förföll igår` |
| `0` | `Förfaller idag` |
| `1` | `Förfaller imorgon` |
| `2` eller högre | `Förfaller om <N> dagar` |

`<N>` är absolutbeloppet. Varje rad ska ha ett eget testfall, och gränserna
`-2`, `-1`, `0`, `1` och `2` prövas var för sig — det är där formen byter.

#### API-tabellen räknar upp varje statuskod

Byggaren påpekade att tabellen saknade koder som koden ger. Den rättas:

| Metod och väg | Svar |
|---|---|
| `GET /api/rakningar/<ÅÅÅÅ-MM-DD>` | `200`, `400`, `401`, `403`, `500` |
| `POST /api/rakningar` | `201`, `400`, `401`, `403`, `500` |
| `PUT /api/rakningar/<id>` | `200`, `400`, `401`, `403`, `404`, `500` |
| `POST /api/rakningar/<id>/betald` | `200`, `400`, `401`, `403`, `404`, `500` |
| `DELETE /api/rakningar/<id>` | `204`, `401`, `403`, `404`, `500` |

`403` står på varje rad eftersom varje väg går genom `requireFeature`, även om
grenen i dag inte är nåbar — `billReminders` finns i alla tre planerna.

Texten byggaren skrev för ett ogiltigt `today` godkänns ordagrant:
`Dagens datum måste anges som ÅÅÅÅ-MM-DD.`

#### Svarskropparna godkänns som byggaren valde dem

`POST` ger `201 { bill }` och `PUT` ger `200 { bill }` med sju fält, utan
`status` och `daysUntil` — de två kräver ett `today` som kroppen inte bär. `GET`
och `POST .../betald` ger nio respektive sju fält. Skillnaden står utskriven i
koden, och det är rätt plats.

#### `tests/bill.test.js` får sin kravlista

Filen prövar kärnans egna exporter, som varje modul i `src/core/` ska ha enligt
`LARDOMAR.md` 2026-08-18. Fallen numreras `(BI1)` och framåt — `BI` för bill, så
att de inte krockar med `(B1)` för `budget.js` eller `(BU1)` för budgeten.

Kravlistan skrivs av det uppdrag som nästa gång rör filen; tills dess står fallen
onumrerade, vilket är rätt enligt `LARDOMAR.md` 2026-09-14: ett nummer utan punkt
är sämre än inget nummer.

---

### Sparmål (bindande) [steg 4]

Priskortet lovar `Sparmål` på **Plus**. Det här är den **första funktionen som
Bas saknar**, och därmed den första som gör behörighetsspärren prövbar: fram
till nu har varje funktion legat i alla tre planerna, och `403`-grenen har aldrig
haft en nåbar indata.

**Följden: (P8) och (P9) från steg 1 blir byggbara här.** De lämnades som
obyggbara då, och ska skrivas i det här steget.

#### Tabellerna

```sql
CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  target_ore  INTEGER NOT NULL CHECK (target_ore > 0),
  target_date TEXT CHECK (target_date IS NULL OR target_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at  TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_deposits (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore <> 0),
  made_on     TEXT NOT NULL CHECK (made_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  created_at  TEXT NOT NULL
);
```

**`amount_ore <> 0`, inte `> 0`:** en insättning kan vara negativ. Den som tar ut
pengar ur sitt sparande ska kunna registrera det, annars visar målet mer än som
finns. Noll är däremot meningslöst och avvisas.

`target_date` är valfritt. Utan det finns inget `perMonthOre` att räkna.

#### Vad `readGoals` svarar

```
readGoals(userId, today) -> [ { id, name, targetOre, targetDate, savedOre, leftOre, percent, monthsLeft, perMonthOre, status } ]
```

| Fält | Regel |
|---|---|
| `savedOre` | summan av insättningarna, kan vara negativ om uttagen överstiger |
| `leftOre` | `targetOre - savedOre`, **aldrig negativ** — ett överskridet mål har noll kvar |
| `percent` | `savedOre / targetOre`, avrundat nedåt till heltal, **noll som lägst och 100 som högst** |
| `monthsLeft` | hela månader från `today` till `targetDate`, `null` utan slutdatum |
| `perMonthOre` | `leftOre / monthsLeft` med `divideRoundHalfUp`, `null` utan slutdatum |
| `status` | se nedan |

**`percent` klipps i båda ändar** därför att en progressruta inte kan rita minus 12
procent och inte heller 140. `savedOre` och `leftOre` bär sanningen; `percent` är
till för stapeln.

**`monthsLeft` är noll när slutdatumet är i denna månad eller har passerat.** Då
är `perMonthOre` hela `leftOre` — allt som återstår ska sparas nu, och en
division med noll får aldrig uppstå.

`status`, första träff vinner:

| # | Villkor | `status` |
|---|---|---|
| 1 | `savedOre >= targetOre` | `klart` |
| 2 | `targetDate` saknas | `pagaende` |
| 3 | `targetDate` har passerat | `forsenat` |
| 4 | annars | `pagaende` |

`today` är ett argument. Ingen funktion i datalagret läser klockan.

#### API-vägar

| Metod och väg | Kropp | Svar |
|---|---|---|
| `GET /api/sparmal/<ÅÅÅÅ-MM-DD>` | ingen | `200`, `400`, `401`, `403`, `500` |
| `POST /api/sparmal` | `{ name, targetSek, targetDate }` | `201`, `400`, `401`, `403`, `500` |
| `PUT /api/sparmal/<id>` | samma | `200`, `400`, `401`, `403`, `404`, `500` |
| `DELETE /api/sparmal/<id>` | ingen | `204`, `401`, `403`, `404`, `500` |
| `POST /api/sparmal/<id>/insattning` | `{ amountSek, madeOn }` | `201`, `400`, `401`, `403`, `404`, `500` |

Alla fem går genom `requireFeature` med `savingsGoals`. **Till skillnad från
tidigare steg är `403` här nåbar**: en Bas-användare får den.

#### Ingångsspärrar i `src/core/goal.js` — bindande, första träff vinner

Skriven i steg 4 efter att byggaren lämnade tillbaka att den saknades.
`LARDOMAR.md` 2026-09-16 gör tabellen obligatorisk för varje modul som kastar:
utan en utskriven sträng kan ett test bara asserta feltypen, och en feltyp delas
av varje spärr i modulen.

`goalStatus` och `goalProgress` delar kedjan — `goalProgress` delegerar till
`requireGoalFields('goalStatus', ...)`. Varje meddelande namnger därför
`goalStatus` också när anroparen anropade `goalProgress`, eftersom ett
meddelande som namngav `goalProgress` hade påstått att felet uppstod i en annan
kontroll.

| # | Villkor, skrivet som i koden | Meddelande |
|---|---|---|
| 1 | `!isPlainObject(goal)` | `goalStatus kräver ett sparmål som objekt.` |
| 2 | `!Number.isSafeInteger(goal.targetOre) || goal.targetOre <= 0` | `goalStatus kräver ett targetOre större än 0, fick "<v>".` |
| 3 | `!Number.isSafeInteger(goal.savedOre)` | `goalStatus kräver ett savedOre som ett säkert heltal, fick "<v>".` |
| 4 | `goal.targetDate !== null && !isValidIsoDate(goal.targetDate)` | `goalStatus kräver ett targetDate på formen ÅÅÅÅ-MM-DD eller null, fick "<v>".` |
| 5 | `!isValidIsoDate(today)` | `goalStatus kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "<v>".` |

`<v>` är `String(värdet)`, så ett `Symbol` och ett `BigInt` når meddelandet i
stället för att kasta `TypeError` ur stränginterpolationen.

**`Number.isSafeInteger` och inte `Number.isInteger`.** Ett ören-tal utanför det
säkra heltalsområdet räknas inte exakt, och predikatet coercar inte: `1n` och
`Symbol('x')` ger `false` i stället för att kasta ur jämförelsen.

**Den assertion som ensam skyddar en rad i tabellen asserterar hela `message`.**
En bredare lista med värden för samma rad får asserta enbart feltypen — kravet
är skrivet om rollen och inte om varje `assert.throws`, av skälet i
`LARDOMAR.md` 2026-09-22.

#### Gränssnittet

Ett eget kort `Sparmål` i månadsvyn, under budgetkortet. Per mål:

```
Buffert                      28 400,00 kr av 50 000,00 kr
[============--------]  57 %
Kvar 21 600,00 kr - spara 2 700,00 kr i månaden till juni 2027
```

Stapeln är **inline-SVG**, byggd med `svgElement` som `renderChart` redan
använder: bredden sätts som SVG-attributet `width`, färgen med en klass.
**Inget `style`-attribut i JavaScript** — och ingen CSS-variabel heller.

Byggaren i steg 4 hittade att den tidigare lydelsen var omöjlig att uppfylla:
den krävde en CSS-variabel och förbjöd `style` i samma mening, men en
CSS-variabel går bara att sätta per element med `element.style.setProperty`,
vilket **är** `style`-attributet. För ett `div`-par finns ingen annan väg.
Beslutet är därför inline-SVG — den enda av de två formerna som uppfyller
förbudet, och den projektet redan har precedens för: `svgElement` i
`src/web/app.js` sätter varje värde med `setAttribute` och rör aldrig `style`.

| `status` | Utseende |
|---|---|
| `klart` | Grön stapel, texten `Målet är nått` |
| `forsenat` | Röd ram, `Slutdatumet har passerat` |
| `pagaende` | Vanlig |

En knapp `+ Sätt in` per mål, och `+ Nytt sparmål` överst.

**För en Bas-användare visas kortet inte alls.** I stället står en rad med
låsikon: `Sparmål ingår i Plus.` och knappen `Se planer`. Det är första gången
låsmekanismen från steg 1 får något att låsa.

#### Kravlista [steg 4]

`tests/goals.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (SM1) | `savedOre` summerar insättningar | inklusive ett negativt uttag |
| (SM2) | `leftOre` är aldrig negativ | ett överskridet mål ger noll |
| (SM3) | `percent` klipps i båda ändar | noll som lägst, 100 som högst |
| (SM4) | `perMonthOre` utan slutdatum är `null` | och `monthsLeft` också |
| (SM5) | `monthsLeft` noll ger hela `leftOre` | ingen division med noll |
| (SM6) | de fyra statusvärdena | ett fall per rad, i ordning |
| (SM7) | `klart` vinner över `forsenat` | ett nått mål med passerat datum är klart |
| (SM8) | en annan användares mål syns inte | |
| (SM9) | insättning noll avvisas | `CHECK` håller |
| (SM10) | ett borttaget mål tar sina insättningar med sig | `ON DELETE CASCADE` |

`tests/goal-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (SM11) | de fem vägarna | statuskoderna i tabellen |
| **(P8)** | **Bas får `403` på en sparmålsväg** | med `feature` och `requiredPlan` i svaret |
| **(P9)** | **Plus får `200` på samma väg** | |
| (SM12) | nedgradering raderar inget | mål skapat på Plus, ned till Bas, upp igen: målet kvar |

`tests/app.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (84) | kortet visar stapel och procent | tre mål, rätt bredd |
| (85) | Bas ser låsraden i stället för kortet | och knappen `Se planer` |
| (86) | ett nått mål visas som klart | grön stapel, texten |
| (87) | `+ Sätt in` ökar `savedOre` och ritar om raden | stapeln och procenten följer med |

---

### Diagram och rapporter (bindande) [steg 5]

Priskortet lovar `Diagram och rapporter` på Plus. `FEATURE_LABELS.reports` bär
den texten. Ingenting av det finns.

#### Gränsen mot `overview`, som Bas redan har

Den här gränsen måste vara skarp, annars blir steg 5 en andra kopia av något
Bas betalar för. `readOverview` finns sedan etapp 5 och svarar
`{ months: [{ month, incomeOre, expenseOre, savingOre, leftOre }], savedThisYear }`.

| | `overview` (Bas) | `reports` (Plus) |
|---|---|---|
| Frågan | Hur mycket? | Vart gick det, och höll jag budgeten? |
| Upplösning | fyra summor per månad | en rad per slag och kategori, per månad |
| Budget | ingen | taket per månad, och hur ofta det sprack |
| Ut ur appen | nej | CSV |

`overview` är summorna över tid. `reports` är **uppdelningen bakom summorna, och
datan ut.** En rapport som bara visade samma fyra tal snyggare vore inget att
betala för.

`renderChart` i `src/web/app.js` ritar redan utgifter per kategori för **en**
månad. Rapporten är samma fråga över tid, och den ritas med samma funktion.
**Ingen andra diagramfunktion skrivs.**

#### Två nya moduler i kärnan

**`src/core/csv.js`** äger formatet. **`src/core/report.js`** äger formen.
Åtskilda därför att CSV är ett *filformat* med egna fällor som ska gå att pröva
ensamt, medan rapporten är en *datamodell*. En gemensam modul hade gjort
injektionsregeln otestbar utan att bygga en hel rapport först.

Båda fick en egen numrerad spärrtabell i det här dokumentet före koden, på
formen "Ingångsspärrar i `<modul>` — bindande, första träff vinner", enligt
`LARDOMAR.md` 2026-09-16: de två avsnitten nedan. Steg 4 byggde en modul utan
sin tabell och fick lämna tillbaka den.

#### Vad `readReport` svarar

```
readReport(userId, endMonth, count) -> {
  months: ['2026-05', ..., '2026-10'],
  rows: [ {
    kind, category,
    perMonthOre: [...],          // samma längd och ordning som months
    totalOre,
    averageOre,
    budgetPerMonthOre: [...],    // samma längd; null för en månad utan tak
    overBudgetMonths
  } ],
  largest: { kind, category } | null
}
```

`months` är äldst först, samma ordning och samma tak som `readOverview`:
`OVERVIEW_MIN_MONTHS` till `OVERVIEW_MAX_MONTHS`. Konstanterna läses därifrån
och skrivs inte om — ett andra tak för samma sak vore två facit.

Sex beslut där specen annars är tyst, och var och en är en fälla:

**1. Radens nyckel är `(kind, category)`, inte `category`.** Samma kategori kan
bära både en inkomst och en utgift, och en rad som slog ihop dem hade visat ett
netto användaren aldrig skrivit. Ordningen är `ITEM_KINDS` ordning, därefter
`CATEGORIES` ordning — båda frysta listor med en ägare, så ordningen är total
och vyn kan inte hoppa mellan två läsningar.

**2. `averageOre` delas med `count`, aldrig med antalet månader som har ett
belopp.** Frågan är vad kategorin kostar i månaden, och en månad utan utgift är
en riktig nolla och inte en saknad mätning. `divideRoundHalfUp` gör divisionen;
ingen flyttalsdivision.

**3. En rad kommer med om den har ett belopp skilt från noll i någon månad
*eller* ett tak i någon månad.** Ett satt tak som inte använts är ett svar: du
budgeterade för mat och handlade ingen. En kategori som är noll hela serien och
saknar tak har ingenting att rapportera och utesluts.

**4. `budgetPerMonthOre` är en lista, inte ett tal.** Taket sätts per månad och
per kategori (`budgets`-tabellen, steg 2). Ett enda `budgetOre` för hela serien
blir en lögn i samma stund användaren ändrar taket. `null` för varje månad utan
tak.

**5. `budgetPerMonthOre` är enbart `null` för `income` och `saving`.** Taket
gäller bara utgifter — det är steg 2:s beslut, där `spentOre` räknar enbart
utgifter. Skrivs ut här så att nästa läsare inte undrar om det är ett bortfall.

**6. `overBudgetMonths` räknar månader där taket finns *och* beloppet överstiger
det.** Lika med taket är inte över det. Gränsen prövas på båda sidor.

`largest` är raden med störst `totalOre`, till diagrammets skalning, och `null`
för en tom rapport. Vid lika `totalOre` vinner den tidigare i radordningen, så
svaret är entydigt.

`today` behövs inte: en rapport är historik. **Ingen funktion i datalagret läser
klockan.**

#### CSV: sex fällor, var och en mätbar

Varje punkt här är ett fel som annars blir användarens, inte en teoretisk risk.

**1. Avgränsaren är semikolon.** Vi skriver belopp med decimalkomma, så ett
komma som avgränsare bryter varje rad. Svensk Excel förväntar sig dessutom
semikolon.

**2. Filen börjar med en UTF-8 BOM, kodpunkt U+FEFF.** Excel på Windows läser en
UTF-8-fil utan BOM som Latin-1, och då blir bokstaven a-ring två tecken.
Projektets användare kör Windows, så det här är det normala utfallet och inte
ett kantfall.

**3. Radslutet är CR LF, kodpunkterna U+000D U+000A,** enligt RFC 4180.

**4. En textcell som börjar med likhetstecken, plus, minus, snabel-a, tabb eller
CR föregås av en apostrof.** Excel kör en sådan cell som en formel, och ett
postnamn är fritext användaren skriver själv. Det här är steg 5:s enda
säkerhetspunkt och den ska ha egna testfall.

**Undantaget är bindande: regeln gäller enbart textceller.** Ett negativt belopp
börjar med minustecken, och en apostrof framför det hade gjort hela
beloppskolumnen oläsbar som tal. Beloppsceller produceras av vår egen
formaterare och kan bara matcha mönstret minus-valfritt, siffror, komma, två
siffror.

**5. En cell som innehåller semikolon, citattecken eller ett radbrott omges av
citattecken, och inre citattecken dubbleras.**

**6. Belopp skrivs som 1234,50** — decimalkomma, två decimaler, ingen
tusentalsavgränsare och ingen enhet. `formatSek` får inte användas: dess utdata
har hårda blanksteg (U+00A0) och enheten `kr`, och är obrukbar i ett
kalkylblad. Ägaren är en egen export i `src/core/csv.js`.

**Rundgångskravet är obligatoriskt.** `LARDOMAR.md` 2026-09-22 beskriver exakt
det här felet ett steg tidigare: appen visade ett belopp med hårt blanksteg och
avvisade samma sträng som indata. Varje belopp CSV:n skriver ska gå att läsa
tillbaka — för varje belopp i testlistan ska det skrivna värdet, matat in i
beloppskedjan, ge samma antal ören. Gränserna hör med: ett öre, minus ett öre,
`AMOUNT_MAX_SEK` i ören, och noll.

#### Ingångsspärrar i `src/core/csv.js` — bindande, första träff vinner

Skriven före koden (`LARDOMAR.md` 2026-09-16). `src/core/report.js` fick sin
egen tabell i samma del, i avsnittet nedan.

Tre exporter:

```
csvAmountSek(ore)  -> string   // 1234,50
csvText(value)     -> string   // injektionssäkrad fritext, utan citering
toCsv(rows)        -> string   // BOM + rader med CRLF, citeringen inräknad
```

**En cell deklarerar sin typ.** `rows` är en lista av listor, och varje cell är
`{ text: <sträng> }` eller `{ amountOre: <heltal> }` — aldrig en färdig sträng.

Det är ett medvetet val mot en fotgillra: tog `toCsv` emot färdiga strängar
måste anroparen minnas att köra varje fritextcell genom `csvText`, och en enda
glömd cell är injektionshålet tillbaka. Med typade celler kan åtgärden inte
glömmas: `toCsv` väljer regel ur cellens egen form, och en cell som varken är
text eller belopp kastar i stället för att tystna.

| # | Funktion | Villkor, skrivet som i koden | Meddelande |
|---|---|---|---|
| 1 | `csvAmountSek` | `!Number.isSafeInteger(ore)` | `csvAmountSek kräver ett säkert heltal öre.` |
| 2 | `csvText` | `typeof value !== 'string'` | `csvText kräver en sträng.` |
| 3 | `toCsv` | `!Array.isArray(rows)` | `toCsv kräver en lista med rader.` |
| 4 | `toCsv` | `!Array.isArray(rows[i])` | `toCsv kräver att varje rad är en lista, raden på index <i> är det inte.` |
| 5 | `toCsv` | cellen är inte `{ text }` eller `{ amountOre }` med exakt en nyckel | `toCsv kräver en cell med text eller amountOre, rad <i> kolumn <j>.` |

Rad 4 och 5 namnger platsen, till skillnad från `money.js` meddelanden: en
trasig cell i en tabell på trettio rader går annars inte att hitta.

Rad 5 prövar **exakt en nyckel**, inte bara att en av dem finns. En cell med
båda hade låtit `toCsv` välja tyst, och det valet är hela poängen med att
cellen deklarerar sin typ.

**`-0` normaliseras och kastar inte.** `csvAmountSek(-0)` ger `0,00`. Noll ören
är ett giltigt belopp i en rapport — en kategori kan vara noll en månad — och
`Number.isSafeInteger(-0)` är sant, så en spärr hade inte fångat det ändå.
`normalizeZero` i `money.js` är ägaren och importeras; ingen andra kopia skrivs
(`LARDOMAR.md` 2026-09-02).

**`csvText` citerar inte.** Citeringen gör `toCsv` för varje cell, eftersom den
regeln är gemensam för text och belopp. `csvText` äger bara apostrofen. Två
funktioner som båda citerade hade dubbelciterat.

#### Ingångsspärrar i `src/core/report.js` — bindande, första träff vinner

Skriven före koden (`LARDOMAR.md` 2026-09-16), i del 1 av steget.

Modulen har en export:

```
reportRows(monthsData) -> { months, rows, largest }
```

där varje element i `monthsData` är `{ month, items, budgets }` — alltsa en
månadssträng plus precis de två listor `readMonth` i `src/server/months.js`
redan svarar med. `budgets` form är `{ category, amountOre, spentOre, leftOre }`,
satt av `budgetLines` i samma fil.

**En lista, inte två parallella.** Min egen första skiss hade
`reportRows(months, perMonth)`, och två parallella listor kan komma i otakt i
längd — en hel felklass som försvinner när månaden bärs av samma element som
sina poster. `months` i svaret härleds därför ur indatan och skickas inte in.

`readReport(userId, endMonth, count)` i `src/server/reports.js` är den funktion
som läser databasen; `reportRows` är den rena formen och körs i webbläsaren.
Två namn för två skilda ansvar.

| # | Villkor, skrivet som i koden | Meddelande |
|---|---|---|
| 1 | `!Array.isArray(monthsData)` | `reportRows kräver en lista med månader.` |
| 2 | `monthsData.length === 0` | `reportRows kräver minst en månad.` |
| 3 | `!isPlainObject(monthsData[i])` | `reportRows kräver ett objekt per månad, index <i>.` |
| 4 | `!isValidIsoMonth(monthsData[i].month)` | `reportRows kräver en månad på formen ÅÅÅÅ-MM, index <i>.` |
| 5 | `!Array.isArray(monthsData[i].items)` | `reportRows kräver en lista med poster, index <i>.` |
| 6 | `!Array.isArray(monthsData[i].budgets)` | `reportRows kräver en lista med budgetar, index <i>.` |
| 7 | `i > 0 && monthsData[i].month <= monthsData[i - 1].month` | `reportRows kräver månaderna i stigande ordning, index <i>.` |

**Rad 7 är den som bär mest.** `perMonthOre`:s index *är* månaden: element noll
hör till `months[0]`. Kommer indatan i fel ordning blir hela serien tyst
omkastad, och diagrammet ritar en kurva som inte är användarens. Ett kast är
därför enda hederliga svaret — det finns inget rätt svar att ge på en
felsorterad serie.

**Månaderna behöver inte vara varandras granne, bara stigande.** Servern
producerar alltid en obruten serie, och `months` följer med i svaret, så en
lucka är synlig för anroparen. Strikt stigande är allt som krävs för att
indexet ska betyda något, och en strängjämförelse räcker eftersom formen
ÅÅÅÅ-MM sorterar lexikografiskt som den sorterar kronologiskt.

**`isPlainObject` importeras ur `src/core/entry.js`**, som äger begreppet och
exporterar det. Inget handskrivet `typeof x === object` — den svagare formen
släpper igenom en array och ett `Date` (`LARDOMAR.md` 2026-09-02).

**`averageOre` räknas med `divideRoundHalfUp`** och `monthsData.length` som
nämnare. Funktionen kastar när `2 * täljaren + nämnaren` lämnar det säkra
heltalsområdet, och det är rätt beteende: en summa som inte går att dela exakt
ska inte avrundas tyst.

#### API-vägar

| Metod och väg | Svar |
|---|---|
| `GET /api/rapport/<ÅÅÅÅ-MM>/<N>` | `200` med rapporten. `400`. `401`. `403`. `500`. |
| `GET /api/rapport/<ÅÅÅÅ-MM>/<N>/csv` | `200` med `text/csv`. `400`. `401`. `403`. `500`. |

`N` står i sökvägen och inte i en frågesträng, av samma skäl som månaden gör det
på varje annan väg: projektet har ingen frågeströmstolkning, och att införa en
är en ny indatayta för ett tal som ryms i sökvägen.

Båda går genom `requireFeature` med `reports`. **`403` är nåbar här**, precis som
för sparmål.

**Fel svarar alltid med JSON, också på CSV-vägen.** En `403` eller `400` som kom
som CSV hade gränssnittet inte kunnat läsa. Bara `200` är `text/csv`.

`sendCsv` är projektets första svar som inte är JSON. Den sätter
`Content-Type: text/csv; charset=utf-8` och
`Content-Disposition: attachment; filename="hemochekonomi-<ÅÅÅÅ-MM>.csv"`.
**Filnamnet är rent ASCII.** En svensk bokstav i ett `Content-Disposition`-huvud
kräver RFC 5987-kodning, och ett okodat huvud är ett trasigt svar.

#### Gränssnittet

Ett kort `Rapport` i månadsvyn, under sparmålskortet. Tre knappar för perioden
(`3 mån`, `6 mån`, `12 mån`), diagrammet genom `renderChart`, och en tabell med
en rad per `(kind, category)`: namn, snitt per månad, summa, och för utgifter
taket och antalet månader det sprack.

En knapp `Hämta som CSV`.

**Nedladdningen går genom `fetch` och en `Blob`, aldrig genom ett `<a href>`.**
Två skäl, och det första är avgörande: demoläget ersätter `globalThis.fetch` och
publiceras på en statisk värd, där ett riktigt HTTP-anrop inte finns att göra —
en länk hade gett `404` i demon. Det andra är att bara `fetch` kan visa ett `403`
i appens egen felruta i stället för att öppna en JSON-klump i en flik.

**För en Bas-användare visas kortet inte alls**, utan låsraden
`Diagram och rapporter ingår i Plus.` med knappen `Se planer`.

**Låsraden är nu projektets andra, och ska därför ha en ägare.** Sparmålskortet
byggde den första i steg 4. En handskriven kopia här vore två ställen som kan
glida isär: bryt ut `lockRow(feature)` som läser `FEATURE_LABELS` och `planFor`,
och låt sparmålskortet anropa samma funktion.

**Döljandet är aldrig skyddet.** Servern svarar `403` på båda vägarna, och det är
där spärren sitter. Ingen kommentar får antyda något annat.

#### Kravlista [steg 5]

Numren fortsätter där steg 4 slutade. Sparmålens serie heter `(SM)` och
schedules `(S)`; rapportens heter `(RA)`, eftersom `(R)` ägs av
`tests/bills.test.js`.

`tests/csv.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (RA1) | BOM först i filen | kodpunkten utskriven i testet |
| (RA2) | radslutet är CR LF | inte bara LF |
| (RA3) | de sex injektionstecknen får apostrof | ett fall per tecken |
| (RA4) | ett negativt belopp får *ingen* apostrof | regelns undantag |
| (RA5) | citering och dubblering | semikolon, citattecken och radbrott i en cell |
| (RA6) | beloppsformatet | 1234,50, utan enhet och utan avgränsare |
| (RA7) | rundgång | varje skrivet belopp läst tillbaka ger samma ören |

`tests/report.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (RA8) | radnyckeln är `(kind, category)` | samma kategori med två slag ger två rader |
| (RA9) | `averageOre` delas med `count` | en kategori i 2 av 6 månader |
| (RA10) | halva öret uppåt i snittet | ett belopp som inte delar jämnt |
| (RA11) | en rad med tak men noll belopp kommer med | och en utan båda utesluts |
| (RA12) | `budgetPerMonthOre` följer taket per månad | ett ändrat tak mitt i serien |
| (RA13) | `budgetPerMonthOre` är null för inkomst och sparande | |
| (RA14) | `overBudgetMonths` på båda sidor om gränsen | lika med taket räknas inte |
| (RA15) | `largest` vid lika summa | den tidigare i radordningen |
| (RA16) | tom rapport | `rows` tom, `largest` null, inget kast |
| (RA17) | taket ärvs ur `readOverview` | `count` utanför ger samma meddelandeform |

`tests/report-api.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (RA18) | båda vägarna | statuskoderna i tabellen |
| (RA19) | Bas får `403` på båda | samma kropp som sparmålens |
| (RA20) | Plus får `200` på båda | och CSV-vägen `text/csv` |
| (RA21) | ett `403` på CSV-vägen svarar JSON | inte CSV |
| (RA22) | filnamnet är rent ASCII | huvudet läst ordagrant |
| (RA23) | en annan användares data syns inte | |

`tests/app.test.js`:

| # | Fall | Kräver |
|---|---|---|
| (88) | kortet visas för Plus och låsraden för Bas | båda i samma fil |
| (89) | `lockRow` är en ägare | sparmålskortet anropar samma funktion |
| (90) | periodknappen hämtar om | tre månader efter tolv, kortare lista än längre |
| (91) | diagrammet ritas med `renderChart` | ingen andra diagramfunktion |

**Mutationslistan genereras ur `git diff HEAD`**, aldrig ur den här tabellen.
Tabellen är ett minimum (`LARDOMAR.md` 2026-09-12).
