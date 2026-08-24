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
ägs av `dates.js` och importeras av `entry.js`, och villkoret för ett giltigt
`id` ägs av `isValidEntryId` i `entry.js` och anropas av både `createEntry` och
`isEntry` (se "Vad som är ett giltigt `id`").

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
| `Intl.NumberFormat('sv-SE', …)` | Inbyggd i Node och webbläsaren. Ger "1 234,50 kr" utan egen formateringskod. | Egen strängpillning, `numeral`/`dinero.js`. |

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

**`entry.js` importerar inte `money.js`.** Beloppsvalideringen arbetar i kronor
och är klar innan öresaritmetiken börjar. Paket 2 har därför inget behov av
`money.js`, som byggs i paket 3.

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
| `amountSek` | `Math.round(v * 100) / 100` | `canonicalAmountSek` i `entry.js` |

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
yearlyOre(entry)  = amountOre(entry) * PAYMENTS_PER_YEAR[entry.interval]     // exakt, heltal
monthlyOre(entry) = divideRoundHalfUp(yearlyOre(entry), 12)                  // avrundat

totalYearlyOre(entries)  = summan av yearlyOre för varje post                // exakt, heltal
totalMonthlyOre(entries) = divideRoundHalfUp(totalYearlyOre(entries), 12)    // avrundat EN gang
```

Tom lista ger `0` för samtliga fyra funktioner, aldrig fel och aldrig `NaN`.

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

Exakt, i heltalsaritmetik, utan flyttal:

```
divideRoundHalfUp(numerator, denominator)
  = Math.floor((2 * numerator + denominator) / (2 * denominator))
```

- `numerator` och `denominator` ska vara heltal, `denominator > 0`. Annars
  kastas `RangeError`.
- Regeln är "halva öret uppåt". Alla belopp i appen är positiva, så uppåt och
  bort-från-noll är samma sak. Negativa belopp är otillåtna redan i
  valideringen och behöver inte hanteras.
- Avrundning sker **en gång per visat värde** och aldrig i mellanled.

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
`ore / 100`. Formatering görs bara i gränssnittet, aldrig före en beräkning.
`formatSek` byggs i paket 3 med resten av `money.js` även om första
användningen i gränssnittet kommer i paket 6 — en modul byggs och testas i sin
helhet i ett paket, inte styckevis.

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
export function sekToOre(amountSek: number): number;       // heltal öre; RangeError om ej finit
export function oreToSek(ore: number): number;             // endast för visning
export function divideRoundHalfUp(numerator: number, denominator: number): number;
export function formatSek(ore: number): string;            // "1 234,50 kr"
```

Hela modulen byggs i paket 3 med `tests/money.test.js`, som minst innehåller
kontrollvärdena i "Avrundningsregel". `entry.js` importerar den inte, och paket
2 är inte beroende av att den finns.

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
import { ISO_DATE_PATTERN, parseIsoDate } from './dates.js';   // inget eget datummönster

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
export function canonicalAmountSek(amountSek: number): number;          // Math.round(v * 100) / 100 — enda definitionen
export function isEntry(value: unknown): boolean;                       // används av storage vid inläsning
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
export const PAYMENTS_PER_YEAR;                        // { monthly: 12, quarterly: 4, yearly: 1 } — fryst
export function yearlyOre(entry: Entry): number;
export function monthlyOre(entry: Entry): number;
export function totalYearlyOre(entries: Entry[]): number;
export function totalMonthlyOre(entries: Entry[]): number;
```

### `src/core/schedule.js` [paket 7]

```js
export const MONTHS_PER_PERIOD;                        // { monthly: 1, quarterly: 3, yearly: 12 } — fryst
export function nextDueDate(entry: Entry, todayIsoDate: string): string;
export function daysUntilNextDue(entry: Entry, todayIsoDate: string): number;

// UpcomingItem = { entry: Entry, nextDueDate: string, daysUntil: number }
export function upcoming(entries: Entry[], todayIsoDate: string): UpcomingItem[];   // sorterad
```

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
