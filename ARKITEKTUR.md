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
│   │   ├── paths.js      Var datafilen ligger (paket 4).
│   │   ├── storage.js    Läser/skriver JSON-filen (paket 4).
│   │   ├── api.js        Routing och JSON-svar för /api/* (paket 5).
│   │   └── server.js     HTTP-server, statisk filserver, startpunkt (paket 5).
│   └── web/              Det som skickas till webbläsaren.
│       ├── index.html    Enda sidan. Formulär, lista, totaler, kommande
│       │                 dragningar (paket 5, byggs ut i 6 och 7).
│       ├── style.css     All styling. Ingen inline-CSS (paket 5).
│       └── app.js        UI-logik. Anropar API:t, importerar src/core via
│                         /core/ (paket 5, byggs ut i 6 och 7).
└── tests/                Alla tester. Namnmönster: <modul>.test.js.
    ├── smoke.test.js     Paket 1.
    ├── dates.test.js     Paket 2, byggs ut i paket 7.
    ├── entry.test.js     Paket 2.
    ├── money.test.js     Paket 3.
    ├── cost.test.js      Paket 3.
    ├── storage.test.js   Paket 4.
    └── schedule.test.js  Paket 7.
```

**Paketmärkningen är bindande.** Varje fil i trädet är märkt med det paket där
den skapas. En fil som inte finns är korrekt så länge dess paket inte är
påbörjat, och ett fel så snart paketet är klart — den skillnaden ska aldrig
behöva gissas. Tre moduler byggs i flera omgångar (`dates.js`, `index.html` +
`app.js`); för dem gäller den finkorniga märkningen per export respektive per
punkt i ansvarslistan, se "Gränssnitt". Saknas märkning för något nytt är det en
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
  `daysInMonth` och `parseIsoDate` har var sin handskriven kopia av villkoret
  `month < 1 || month > 12`. `daysInMonth` äger gränsen, och `parseIsoDate`
  behöver ingen egen kopia: `daysInMonth` svarar `0` för ett månadsnummer
  utanför 1–12, så raden `day < 1 || day > daysInMonth(year, month)` avvisar
  redan samma värden. **Åtgärdas i paket 7** av byggaren, i det paket där
  `dates.js` byggs ut och `tests/dates.test.js` utökas: månadsraden i
  `parseIsoDate` tas bort, ingen ny konstant införs, och `'2026-13-01'`,
  `'2026-00-10'` samt `'2026-99-01'` ska fortfarande ge `null`. Fram till dess
  är kopian ett känt, daterat och utpekat fel — inte en tillåten form.

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

**Runtime-beroenden: 0. Dev-beroenden: 0.** `package.json` ska inte ha något
`dependencies`- eller `devDependencies`-fält. Nytt beroende kräver en ny rad i
tabellen ovan innan det installeras.

### package.json — skrivs av byggaren exakt så här

```json
{
  "name": "hemochekonomi",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "description": "Koll pa hemmets fasta utgifter och prenumerationer.",
  "engines": { "node": ">=20.17.0" },
  "scripts": {
    "start": "node src/server/server.js",
    "test": "node --test \"tests/**/*.test.js\""
  }
}
```

De inre citationstecknen i `test`-scriptet är escapade med `\"` och ska stå
kvar precis så. Tas de bort tolkar Node argumentet som en katalog och kommandot
misslyckas med `Cannot find module`.

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
| `interval` | `string` | Ja | Exakt ett av `"monthly"`, `"quarterly"`, `"yearly"`. |
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
för `ISO_DATE_PATTERN` (se "Mappstruktur"). I dagens `src/core/entry.js` står
villkoret skrivet för hand på båda ställena; de två raderna ska ersättas av två
anrop till `isValidEntryId`. Ingen felmeddelandesträng ändras av det, och inget
observerbart beteende ändras — kontrollen är redan `trim`-baserad i koden.

**Id:t lagras exakt som `makeId()` gav det, utan trimning.** `name` trimmas,
`id` gör det inte: `crypto.randomUUID()` ger aldrig blanktecken, och ett id får
aldrig förändras efter att det satts. `isEntry` ställer därför inget krav på att
`id === id.trim()`, till skillnad från `name`.

### Etiketter mot användaren (svenska)

`interval`: `monthly` → "Månadsvis", `quarterly` → "Kvartalsvis",
`yearly` → "Årsvis".

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
| `amountSek` | normaliseringen (steg 1 nedan) ger inget finit tal | `Beloppet måste vara ett tal.` |
| `amountSek` | ≤ 0 | `Beloppet måste vara större än 0 kr.` |
| `amountSek` | > 9999999.99 | `Beloppet får vara högst 9 999 999,99 kr.` |
| `amountSek` | fler än 2 decimaler | `Beloppet får ha högst två decimaler.` |
| `interval` | inte något av de tre värdena | `Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis eller årsvis.` |
| `startDate` | matchar inte `ISO_DATE_PATTERN` (se `dates.js`) | `Startdatum måste anges som ÅÅÅÅ-MM-DD.` |
| `startDate` | rätt format men obefintligt datum (t.ex. `2026-02-30`) | `Startdatum är inget giltigt datum.` |
| `startDate` | år utanför 1970–2099 | `Startdatum måste ligga mellan 1970-01-01 och 2099-12-31.` |
| `category` | inte något av de sex värdena | `Välj en giltig kategori.` |

Notera att `amountSek`-raderna står i ordningen **tal → större än 0 → maxgräns →
decimaler**. Maxgränsen står före decimalregeln med flit; motiveringen finns
under "Steg 2" nedan.

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

Utfallet är antingen ett **finit `number`** eller felet
`Beloppet måste vara ett tal.` Inget annat felmeddelande kan uppstå i det här
steget.

| Råvärdets typ | Vad som görs | Utfall |
|---------------|--------------|--------|
| `number` | – | `Number.isFinite(raw)` → `raw`. Annars (`NaN`, `Infinity`, `-Infinity`) → `Beloppet måste vara ett tal.` |
| `string` | `raw.trim()`, matcha mot `AMOUNT_PATTERN`, byt `,` mot `.`, kör `Number(...)` | Matchar mönstret → talet. Matchar inte → `Beloppet måste vara ett tal.` |
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

Följande strängar matchar inte och ger `Beloppet måste vara ett tal.`:
`''`, `'   '`, `'abc'`, `',5'`, `'.5'`, `'1 234,50'` (mellanslag som
tusentalsavgränsare stöds inte), `'1,2,3'`, `'1e3'`, `'-'`, `'50 kr'`, samt
strängar med fler än 15 heltalssiffror.

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

| Sträng in | Tal in | `v` efter steg 1 | Vinnande regel | Resultat |
|-----------|--------|------------------|----------------|----------|
| `'abc'` | `NaN` | – | steg 1 | `Beloppet måste vara ett tal.` |
| `'50 kr'` | `Infinity` | – | steg 1 | `Beloppet måste vara ett tal.` |
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

### Kanonisk lagringsform — det enda `isEntry` kräver utöver regelkedjan

`validateEntryDraft` gör två saker: den **avvisar** ogiltiga värden, och den
**normaliserar** de godkända. Normaliseringen berör två av de sex fälten:

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

Tre intervall stöds. Inga fler. Vecko- och halvårsintervall är medvetet
bortvalda: de finns inte i planen och veckointervall går inte att normalisera
exakt mot ett kalenderår.

| `interval` | Betalningar per år | Månader per period |
|------------|--------------------|--------------------|
| `monthly` | 12 | 1 |
| `quarterly` | 4 | 3 |
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
lexikografiskt) via `compareIsoDates`. `occurrence` växer med minst 28 dagar per
steg, så loopen terminerar och kör i praktiken högst 2–3 varv.

Konsekvenser som följer av algoritmen och som ska testas i paket 7:

- Startdatum i framtiden → `k = 0` → nästa dragning **är** startdatumet.
- Startdatum exakt idag → `occurrence(0) = today` → nästa dragning är idag,
  `daysUntilNextDue = 0`.
- Startdatum flera perioder tillbaka → steg 2 hoppar direkt till rätt trakt,
  steg 3 justerar. Inget varv-för-varv-räknande från 1970.

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

**Dagar kvar.** `daysUntilNextDue(entry, todayIso)` =
`(Date.UTC(nästa) - Date.UTC(idag)) / 86400000`, alltid ett icke-negativt heltal.
UTC används för att sommartid annars ger 23- och 25-timmarsdygn.

**Sortering av kommande dragningar.** `upcoming(entries, todayIso)` sorterar
stigande på `nextDueDate`. Vid samma datum: `name` med
`a.name.localeCompare(b.name, 'sv')`, och vid samma namn `id` med vanlig
strängjämförelse. Ordningen blir därmed alltid stabil och oberoende av
inmatningsordningen.

**Klockan läses på exakt ett ställe:** `todayIso()` i `src/core/dates.js`.
Ingen annan funktion i `src/core/` får anropa `Date.now()` eller `new Date()`
utan argument. Alla funktioner som behöver dagens datum tar emot det som
parameter. Utan den regeln går paket 7 inte att testa.

Hela det här avsnittet byggs i **paket 7**, tillsammans med de fem exporter i
`dates.js` som ännu inte finns (se gränssnittslistan). Ingen av dem får byggas
i förtid: de har inga användare före paket 7 och skulle då stå otestade.

---

## Lagring

- **Format:** en UTF-8-kodad JSON-fil, indenterad med 2 mellanslag och avslutad
  med radbrytning.
- **Plats:** `%APPDATA%\hemochekonomi\entries.json`, dvs.
  `path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), 'hemochekonomi', 'entries.json')`.
  Datan ligger utanför git-repot med flit — den är användarens, inte projektets.
- **Överstyrning för tester:** om miljövariabeln `HEMOCHEKONOMI_DATA_FILE` är
  satt används den sökvägen i stället. Testerna i paket 4 sätter den till en fil
  under `os.tmpdir()` och städar upp efter sig.
- **Katalogen skapas vid behov** med `fs.mkdir(dir, { recursive: true })` före
  skrivning.
- **Skrivning är atomär:** skriv till `entries.json.tmp` och gör därefter
  `fs.rename` till `entries.json`. Ett avbrott mitt i skrivningen får inte kunna
  lämna en halv fil — det är precis det fel som annars uppfyller paket 4:s
  "trasigt innehåll".

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

Beteende vid läsning:

| Situation | Resultat |
|-----------|----------|
| Filen saknas (`ENOENT`) | `[]`. Inget fel, ingen fil skapas. |
| Filen är tom eller bara blanktecken | `[]`. |
| Ogiltig JSON | `StorageError`: `Datafilen är skadad och kunde inte läsas: <sökväg>` |
| JSON men inte ett objekt, eller `entries` är inte en array | `StorageError`: `Datafilen har fel innehåll: <sökväg>` |
| `version` saknas eller är inte `1` | `StorageError`: `Datafilen har en version som appen inte känner igen: <sökväg>` |
| En post i `entries` saknar fält, har fel typ eller har ett okänt fält | `StorageError`: `Datafilen innehåller en ogiltig post: <sökväg>` |
| Läsfel från operativsystemet | `StorageError` med svensk text och `cause` satt till originalfelet. |

Raden om "en ogiltig post" avgörs av `isEntry`, inte av en egen kontroll i
`storage.js`. Det gäller även `id`: `storage.js` får inte ha någon egen åsikt om
vad ett giltigt `id` är.

`StorageError` kastas — den fångas i `api.js`, som svarar `500` med
`{ "error": "<meddelandet>" }`. Servern får aldrig krascha på ett trasigt lager.
`version: 1` finns för att kunna ge det tydliga felmeddelandet ovan i stället
för en tyst feltolkning; det är inte en förberedelse för framtida funktioner.

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
  `cost` (paket 3), `storage` (paket 4), `schedule` (paket 7). Det är den logik
  där fel är tysta. **Varje fil under `src/core/` ska ha en egen
  `tests/<modul>.test.js` som testar modulens egna exporter direkt, i samma
  paket som filen skapas.** Indirekt täckning via en annan moduls tester räknas
  inte. `dates` är den enda modul som byggs ut i ett senare paket: de fem
  exporter som tillkommer i paket 7 får sina testfall i `tests/dates.test.js` i
  paket 7.
- **Avsiktligt obyggda exporter är märkta, inte tysta.** Varje export i
  "Gränssnitt" bär `[paket N]`. Att en export saknas i koden är korrekt så länge
  dess paket inte är påbörjat, och ett fel så snart paketet är klart. Ingen
  export får byggas i förtid — en export utan användare får inga meningsfulla
  tester och blir just den otestade kod som lärdomen om `dates.js`
  (2026-08-18) handlar om.
- **Manuell genomgång för:** paket 5 och 6 (gränssnittet). Ingen webbläsar-
  automatisering införs — det skulle vara projektets största beroende och testa
  minst.
- **Determinism:** inget test får bero på dagens datum. Dagens datum skickas
  alltid in som parameter. Ett test som skulle gå sönder i mars är ett trasigt
  test.
- **Paket 4:s "ny körning"** uppfylls genom att testet skriver med
  `saveEntries`, därefter importerar modulen på nytt med en cache-brytande
  query (`await import('../src/server/storage.js?fresh=' + Date.now())`) och
  läser tillbaka. Filen på disk är sanningen, inget cachas i modulminne.
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
  en redovisad mätning, inte med en assertion.
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
när hela modulen byggs i ett svep; `dates.js` är märkt per export eftersom den
byggs i två omgångar. En export vars paket inte är påbörjat ska **inte** finnas
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
kräver dem. De fem sista har sin första användare i paket 7 och byggs där.

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

Att paket 2-hälften är byggd och paket 7-hälften inte är **rätt tillstånd** i
dag. `tests/dates.test.js` finns redan och täcker de fyra byggda exporterna
(inklusive `daysInMonth(2000, 2)` och ogiltiga månadsnummer); i paket 7 utökas
samma fil med testfall för de fem tillkommande — `addMonthsClamped` mot
facittabellen i "Härledning av nästa dragningsdatum", `compareIsoDates` och
`daysBetween` med både positiv och negativ riktning, `toIsoDate` med
nollutfyllnad, och `todayIso` med ett inskickat `now` så att testet inte läser
klockan.

### `src/core/entry.js` [paket 2]

```js
import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate } from './dates.js';  // inget eget datummönster
import { ORE_PER_SEK, normalizeZero } from './money.js';                      // [paket 3] konstanten och normalizeZero — inget annat

export const INTERVALS;          // ['monthly', 'quarterly', 'yearly']
export const INTERVAL_LABELS;    // { monthly: 'Månadsvis', ... }
export const CATEGORIES;         // ['housing', 'subscription', 'insurance', 'transport', 'loan', 'other']
export const CATEGORY_LABELS;    // { housing: 'Boende', ... }
export const ENTRY_FIELDS;       // ['amountSek', 'category', 'id', 'interval', 'name', 'startDate'] (sorterad)
export const NAME_MAX_LENGTH;    // 60
export const AMOUNT_MAX_SEK;     // 9999999.99
export const AMOUNT_PATTERN;     // /^-?\d{1,15}([.,]\d{1,15})?$/
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

export const PAYMENTS_PER_YEAR;                        // { monthly: 12, quarterly: 4, yearly: 1 } — fryst
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
export const MONTHS_PER_PERIOD;                        // { monthly: 1, quarterly: 3, yearly: 12 } — fryst
export function nextDueDate(entry: Entry, todayIsoDate: string): string;
export function daysUntilNextDue(entry: Entry, todayIsoDate: string): number;

// UpcomingItem = { entry: Entry, nextDueDate: string, daysUntil: number }
export function upcoming(entries: Entry[], todayIsoDate: string): UpcomingItem[];   // sorterad
```

`MONTHS_PER_PERIOD.yearly` skrivs som `12` och importerar **inte**
`MONTHS_PER_YEAR` från `cost.js`. Talen är lika, rollerna olika: tabellen svarar
på hur många månader en period omfattar, konstanten på hur många månader ett år
har. `schedule.js` importerar ingenting från `cost.js`.

### `src/server/paths.js` [paket 4]

```js
export function getDataFilePath(): string;             // läser HEMOCHEKONOMI_DATA_FILE vid varje anrop
export function getWebDir(): string;
export function getCoreDir(): string;
```

### `src/server/storage.js` [paket 4]

```js
export const STORAGE_VERSION;                          // 1
export class StorageError extends Error {}             // .message är svensk text
export async function loadEntries(): Promise<Entry[]>; // [] om filen saknas
export async function saveEntries(entries: Entry[]): Promise<void>;  // atomär
```

### `src/server/api.js` [paket 5]

```js
// Returnerar true om anropet hanterades, false om det inte var en /api-väg.
export async function handleApiRequest(req: IncomingMessage, res: ServerResponse, pathname: string): Promise<boolean>;
```

### `src/server/server.js` [paket 5]

```js
export function createServer(): http.Server;
export async function start(port = Number(process.env.PORT) || 3000): Promise<http.Server>;
// Startar automatiskt när filen körs direkt (npm start) och skriver då
// "Hemochekonomi kör på http://127.0.0.1:3000" till stdout.
```

### HTTP-API [paket 5]

Alla svar är `application/json; charset=utf-8` utom de statiska filerna. Alla
felsvar har formen `{ "error": "<svensk text>" }` och valideringsfel har
dessutom `{ "fieldErrors": [{ "field": "...", "message": "..." }] }`.

| Metod | Väg | Body in | Svar |
|-------|-----|---------|------|
| `GET` | `/api/entries` | – | `200 { "entries": Entry[] }` |
| `POST` | `/api/entries` | `{ name, amountSek, interval, startDate, category }` | `201 { "entry": Entry }` · `400 { error, fieldErrors }` vid ogiltig post · `400 { error: "Kunde inte tolka anropet." }` vid trasig JSON · `500 { error }` vid internt fel från `createEntry` (se nedan) |
| `DELETE` | `/api/entries/<id>` | – | `204` utan body · `404 { "error": "Posten finns inte." }` |
| annat | `/api/*` | – | `404 { "error": "Okänd adress." }` eller `405 { "error": "Metoden stöds inte." }` |

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

`<id>` i `DELETE`-vägen jämförs som en exakt sträng mot `entry.id`. Servern
trimmar inte, normaliserar inte och tolkar inte id:t — en post som inte matchar
exakt finns inte, och svaret blir `404`.

Servern beräknar inte totaler. Webbläsaren importerar `cost.js` och
`schedule.js` och räknar själv — samma kod, ett facit.

### Statiska filer [paket 5]

| Väg | Levereras från | Content-Type |
|-----|----------------|--------------|
| `/` | `src/web/index.html` | `text/html; charset=utf-8` |
| `/style.css` | `src/web/style.css` | `text/css; charset=utf-8` |
| `/app.js` | `src/web/app.js` | `text/javascript; charset=utf-8` |
| `/core/<fil>.js` | `src/core/<fil>.js` | `text/javascript; charset=utf-8` |
| övrigt | – | `404` |

`charset=utf-8` är obligatoriskt på alla svar, och `index.html` ska ha
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
   formulärets allmänna felruta: `error`-texten från ett `500`-svar, och varje
   `fieldError` vars `field` saknar motsvarande formulärelement. Inget felsvar
   får leda till att ingenting syns på skärmen.
7. **[paket 5]** Anropa `DELETE /api/entries/<id>` och uppdatera vyn.
8. **[paket 6]** Visa tomläge när listan är tom: "Du har inga poster ännu. Lägg
   till din första utgift ovan." — inte en tom skärm.

`index.html` följer samma indelning: formulär och lista i paket 5, totalrutan i
paket 6, listan över kommande dragningar i paket 7.

All text i gränssnittet är på svenska. Inga id:n eller engelska nyckelvärden
visas för användaren.

---

## Beslutslogg

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
  `checkAmountSek` läser numera konstanten. **Kvar i paket 3:** de kommentarer i
  `checkAmountSek` som citerar uttrycket med siffran (`v * 100` och
  `Math.round(v * 100) / 100`) ska skrivas om till `ORE_PER_SEK`, så att
  kommentar och kod inte pekar ut olika ägare. **Kvar i paket 7:** den andra
  träffen, `12` i rollen "högsta månadsnummer" i `dates.js` — månadsraden i
  `parseIsoDate` tas bort, gränsen ägs av `daysInMonth`; villkoret och de tre
  datumen som ska fortsätta ge `null` står i regeltexten under "Mappstruktur".
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
