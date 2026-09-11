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
│   │   ├── paths.js      Var datafilen ligger (paket 4; getLockFilePath i 5).
│   │   ├── storage.js    Läser/skriver JSON-filen (paket 4; updateEntries i 5).
│   │   ├── lock.js       Låset på datafilen: en instans i taget (paket 5).
│   │   ├── api.js        Routing och JSON-svar för /api/* (paket 5).
│   │   └── server.js     HTTP-server, statisk filserver, startpunkt (paket 5).
│   └── web/              Det som skickas till webbläsaren.
│       ├── index.html    Enda sidan. Formulär, lista, totaler, kommande
│       │                 dragningar (paket 5, byggs ut i 6 och 7).
│       ├── style.css     All styling. Ingen inline-CSS (paket 5).
│       └── app.js        UI-logik. Anropar API:t, importerar src/core via
│                         /core/ (paket 5, byggs ut i 6 och 7).
└── tests/                Alla tester. Testfiler heter <modul>.test.js, och bara
                          de körs av npm test. Hjälpfiler till ett test ligger
                          under helpers/ och körs aldrig av testköraren.
    ├── smoke.test.js     Paket 1.
    ├── dates.test.js     Paket 2, byggs ut i paket 7.
    ├── entry.test.js     Paket 2.
    ├── money.test.js     Paket 3.
    ├── cost.test.js      Paket 3.
    ├── storage.test.js   Paket 4.
    ├── api.test.js       Paket 5.
    ├── lock.test.js      Paket 5.
    ├── server.test.js    Paket 5.
    ├── app.test.js       Paket 5, byggs ut i 6 och 7. Kör src/web/app.js mot
    │                     DOM-attrappen. Ingen webbläsare, ingen server.
    ├── schedule.test.js  Paket 7.
    └── helpers/
        ├── interrupted-save.js  Barnprocess för atomicitetstestet: anropar
        │                        saveEntries och dödas med SIGKILL av
        │                        storage.test.js. Namnet slutar medvetet inte
        │                        på .test.js (paket 4).
        └── dom.js               DOM-attrapp, fetch-attrapp och laddare för
                                 app.test.js. Projektets enda DOM-attrapp
                                 (paket 5).
```

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
  inte. `dates` är den enda modul som byggs ut i ett senare paket: de fem
  exporter som tillkommer i paket 7 får sina testfall i `tests/dates.test.js` i
  paket 7.
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
  `CHILD_START_TIMEOUT_MS`. Datafilen är alltid en temporär fil. Fyra fall:
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
  - **Ingen server och inga timers i den här testfilen.** `fetch` är alltid
    attrappen: allt `app.js` gör här är löften utan I/O, och testet driver dem
    själv genom att flöda ut mikrotaskerna ett bestämt antal varv. Därför behövs
    ingen tidsgräns och ingen hängningsspärr, och därför har filerna ingen rad i
    tabellen under "Inget test asserterar på körtid". Kontrollen där gäller också
    här, men med två mönster till (`setInterval` och `Date.now`), eftersom kravet
    på de här två filerna är strängare än på de andra: ingen klocka alls.
    `grep -n "setTimeout\|setInterval\|AbortSignal.timeout\|Promise.race\|performance.now\|Date.now" tests/app.test.js tests/helpers/dom.js`
    ska ge noll träffar för båda filerna; en sökning efter de sex mönstren i de
    två filerna gav noll träffar 2026-09-07. Serversidan prövas av
    `tests/api.test.js` och
    `tests/server.test.js`; ett fall som startar en server hör hemma där och inte
    här.
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
    samtidigt som båda totalerna visar `–`, två motsägande påståenden på samma
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
  test.
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
     `child.once('error', …)` och en `AbortSignal.timeout(…)`. Vinner något
     annat än meddelandet ska testet falla, och felmeddelandet ska innehålla
     barnets `exitCode`, `signalCode` och `stderr` — barnet startas därför med
     `stderr` som `'pipe'`, och utskriften samlas upp från start.
     Timeouten **är** ett millisekundtal och står som en namngiven konstant i
     testfilen, `CHILD_START_TIMEOUT_MS`, på minst 30 000 ms. Undantaget är
     avgränsat och inte en uppluckring: en dödandetid avgör var i barnets arbete
     avbrottet landar och därmed vad omgången mäter, medan den här tiden aldrig
     kan påverka utfallet av en omgång som blir av. Den avgör bara att ett barn
     som **aldrig** startar ger ett fallerat test i stället för en väntan utan
     exitkod. Gränsen är satt så högt just för att en långsam maskin inte ska
     kunna göra spärren till ett falskt fel; ett högre värde är alltid tillåtet,
     ett lägre inte. Skälet till att spärren måste finnas är att en hängning
     inte ger någon exitkod alls, och kravet i `CLAUDE.md` att kontrollera
     utgångskoden går då inte att uppfylla — granskarens körning från en annan
     katalog hängde i tio minuter utan exitkod och gav vid nästa försök
     `EXIT=124` från en yttre `timeout 60`. Innan testet räknas som skrivet ska
     det köras en gång med barnets filnamn medvetet felstavat och ge exit 1 inom
     några sekunder; den utdatan klistras in i redovisningen.
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

  | Testfil | Konstant | Väntan spärren bryter | Villkoret den skyddar |
  |---------|----------|-----------------------|-----------------------|
  | `tests/storage.test.js` | `CHILD_START_TIMEOUT_MS` | Barnets `startar`-meddelande, atomicitetstestets punkt 8 | Ett barn som aldrig startar (felstavad sökväg, syntaxfel, kastande import) |
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
avrundas för sig. Arkitektens körning av `src/core/cost.js` på Node v24.19.0, tre
poster à 100,00 kr:

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
const UNKNOWN_TOTAL = '–';
```

Tecknet är U+2013 EN DASH, inte bindestreck (U+002D) och inte tankstreck
(U+2014). **Det skrivs med escapen `–` i koden, aldrig som det råa
tecknet** — ett tecken utanför ASCII som står rått i en sträng går inte att
skilja från sina grannar vid läsning, och den här filen har redan brutit mot
det en gång med ett osynligt U+00A0 (`LARDOMAR.md` 2026-09-10). Det står ensamt: feltexten i den allmänna felrutan säger redan vad som
gick fel, och en andra förklaring intill varje belopp vore samma besked två
gånger. En egen svensk mening här förkastades av det skälet.

**Testfallen är obligatoriska** och läggs till kravlistan för `tests/app.test.js`
som (17): ett avvisat `fetch` vid sidladdning ger tömd lista, tomt
`#empty-state`, `–` i båda totalelementen och `GENERAL_ERROR` i felrutan; och
(18): en lista renderad ur ett `200`, följd av en borttagning vars omhämtning
misslyckas, lämnar inget av den gamla listans innehåll i vyn. Mutationen som ska
fällas av (17) är "ta bort anropet som nollställer vyn i den misslyckade grenen"
→ `EXIT=1`.

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

Antalen nedan är körda i paket 6 och gäller den här filen som den ser ut nu.
De räknar **omnämnanden**, och ett av dem är den här textens egna sökmönster,
som matchar sig självt — ett mönster som skrivs in i den fil det söker i höjer
sitt eget antal, och det är skälet till att antalet inte går att skriva en gång
för alla:

```
grep -c "inte kör\(t\|d\|da\) av arkitekten" ARKITEKTUR.md   -> 3
grep -c "inte kört\|inte körd\|inte körda\|ej kört" ARKITEKTUR.md -> 6
```

Det bindande påståendet är inte ett antal utan detta: **ingen träff är en
markering på ett krav**. Den kontrollen görs genom att läsa träffarna, inte
genom att jämföra en siffra.

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
  `grep -n '\b100\b' src/core/entry.js` gav noll träffar. **Kvar i paket 7:** den andra
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
  Barnprocessen bär hela hängningsspärren från atomicitetstestets punkt 8: en
  `spawn` utan den är en hängning utan exitkod som väntar på att inträffa. Ingen
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
  hand`, `Kvar i paket` — och gav inga fler falska träffar: `Kvar i paket 7` pekar
  på ett paket som ännu inte är påbörjat och är därmed en öppen uppgift och inte
  ett påstående om koden. (påverkat av lärdom: **ja**, `2026-09-07 —
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
