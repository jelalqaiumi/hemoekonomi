// Rapportens dokumentlayout: vilka rader och vilka kolumner CSV-filen har
// [steg 5].
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i
// webbläsaren.
//
// Tre moduler, tre ansvar (ARKITEKTUR.md, "En egen modul: src/core/report-csv.js"):
//   src/core/report.js      äger rapportens FORM   — reportRows
//   src/core/report-csv.js  äger dess LAYOUT       — den här filen
//   src/core/csv.js         äger FILFORMATET       — toCsv
//
// Modulen ligger i src/core/ och inte i src/server/ därför att demoläget
// ersätter globalThis.fetch och publiceras på en statisk värd: attrappen måste
// svara på CSV-vägen, och attrappen kan bara nå src/core/. Låg mappningen i
// src/server/ kunde demon inte producera filen, och en handskriven kopia i
// demo-fetch.js hade varit två ställen som glider isär.
//
// Modulen importerar INTE csv.js och känner varken till avgränsare, BOM eller
// citering. Det är hela poängen med typade celler: layouten vet vad en cell
// BETYDER, formatet vet hur den SKRIVS. Anroparen sätter ihop de två med
// toCsv(reportCsvRows(report)).
//
// Ingen klocka läses: en rapport är historik, precis som i report.js.
//
// Beroendet är riktat och cykelfritt: entry.js importerar dates.js och money.js,
// item.js importerar entry.js, dates.js och money.js, och ingen av dem
// importerar den här filen.
import { isValidIsoMonth } from './dates.js';
import { CATEGORY_LABELS, isPlainObject } from './entry.js';
import { ITEM_KIND_LABELS } from './item.js';

// Rubrikraden, ordagrant som i ARKITEKTUR.md under "CSV-filens innehåll
// (bindande)". Texterna är text mot användaren och står bara här; de är därmed
// bundna av (D3) i tests/demo.test.js på samma villkor som varje annan svensk
// sträng demons attrapp svarar med.
//
// Sex kolumner, alltid sex, oavsett hur lång serien är. Formen är lång och inte
// bred: taket är per månad, och i en bred form med en kolumn per månad ryms
// budgetPerMonthOre inte i en kolumn.
const HEADER = Object.freeze(['Slag', 'Kategori', 'Månad', 'Belopp', 'Tak', 'Över tak']);

// De två svaren i kolumnen Över tak. Står som namn och inte som literaler i
// uttrycket: var och en läses på ett ställe i koden och ett i testet, och en
// handskriven kopia kan glida isär.
const OVER_BUDGET_YES = 'Ja';
const OVER_BUDGET_NO = 'Nej';

// Den tomma cellen, för en månad utan tak. Tom och aldrig 0: noll vore ett tak
// på noll kronor, vilket är något helt annat än inget tak. Samma skäl gör Över
// tak tom — utan ett tak finns ingen gräns att ligga över, och Nej hade påstått
// att det fanns en.
const EMPTY = '';

// Filnamnets början och slut [steg 5 del 3]. Står bara här: ingen annan fil i
// src/ får skriva dem i ett filnamn (ARKITEKTUR.md, "En egen modul:
// src/core/report-csv.js"). Båda är rent ASCII, eftersom namnet går rakt in i
// Content-Disposition, där en svensk bokstav kräver RFC 5987-kodning.
const FILE_PREFIX = 'hemochekonomi-';
const FILE_SUFFIX = '.csv';

// Texterna ur spärrtabellen "Ingångsspärrar i src/core/report-csv.js" i
// ARKITEKTUR.md, skrivna bara här. Rad 4 till 6 namnger radens index, till
// skillnad från money.js meddelanden: en trasig rad i en rapport med arton rader
// går annars inte att hitta. Ingen av texterna skriver ut värdet, så ingen av
// dem behöver gå genom String().
const MESSAGES = Object.freeze({
  notAnObject: 'reportCsvRows kräver en rapport som objekt.',
  badMonths: 'reportCsvRows kräver en lista med månader.',
  badRows: 'reportCsvRows kräver en lista med rader.',
  badRow: (i) => `reportCsvRows kräver ett objekt per rad, index ${i}.`,
  badAmountCount: (i) => `reportCsvRows kräver ett belopp per månad, index ${i}.`,
  badBudgetCount: (i) => `reportCsvRows kräver ett tak per månad, index ${i}.`,
  // Rad 7, för reportFileName. Skriver inte ut värdet: det är just ett värde som
  // inte är en månad, och det ska inte följa med in i någon text.
  badFileMonth: 'reportFileName kräver en månad på formen ÅÅÅÅ-MM.'
});

// Spärrtabellen rad 1 till 6, i tabellens ordning och över hela listan i taget.
// Tre genomgångar för rad 4, 5 och 6 och inte en nästlad loop, ordagrant samma
// konstruktion och samma skäl som toCsv i csv.js och checkMonthsData i
// report.js: tabellen säger "första träff vinner" om RADERNA, så en rapport där
// rad 0 har en för kort perMonthOre (rad 5) och rad 1 inte är ett objekt (rad 4)
// ska svara med rad 4. En enda genomgång hade varvat raderna och gjort svaret
// beroende av ordningen i listan, och en numrerad tabell får inte beskriva
// villkor som prövas varvat (LARDOMAR.md 2026-09-02).
//
// Körd konsekvens av ordningen, med ett eget testfall:
//   reportCsvRows({ months: ['2026-01'], rows: [{ …, perMonthOre: [] }, null] })
//     ger rad 4:s meddelande om index 1, inte rad 5:s om index 0.
function checkReport(report) {
  // Rad 1. isPlainObject ägs av entry.js och importeras: ett handskrivet
  // typeof x === 'object' släpper igenom en array och ett Date
  // (LARDOMAR.md 2026-09-02).
  if (!isPlainObject(report)) {
    throw new RangeError(MESSAGES.notAnObject);
  }
  // Rad 2 före rad 3, därför att rad 5 och 6 jämför mot report.months.length:
  // en months som inte är en lista har ingen längd att jämföra med.
  if (!Array.isArray(report.months)) {
    throw new RangeError(MESSAGES.badMonths);
  }
  // Rad 3. Utan Array.isArray itererar loopen nedan över en strängs tecken.
  if (!Array.isArray(report.rows)) {
    throw new RangeError(MESSAGES.badRows);
  }
  // Rad 4. Samma ägare till begreppet "vanligt objekt" som rad 1.
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!isPlainObject(report.rows[i])) {
      throw new RangeError(MESSAGES.badRow(i));
    }
  }
  // Rad 5 och rad 6 är de som bär. Layouten läser perMonthOre[m] och
  // budgetPerMonthOre[m] för varje månad i months. Är en lista kortare blir
  // cellen undefined, och en undefined som når csvAmountSek kastar där i stället
  // — med ett meddelande som pekar ut fel modul, samma fel som LARDOMAR.md
  // 2026-09-02 beskriver för monthlyOre.
  //
  // Array.isArray prövas före längden: en perMonthOre som saknas har ingen length
  // att jämföra, och ett uttryck som läser undefined.length kastar TypeError i
  // stället för modulens RangeError. Delvillkoret har ett eget testfall.
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!Array.isArray(report.rows[i].perMonthOre)
      || report.rows[i].perMonthOre.length !== report.months.length) {
      throw new RangeError(MESSAGES.badAmountCount(i));
    }
  }
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!Array.isArray(report.rows[i].budgetPerMonthOre)
      || report.rows[i].budgetPerMonthOre.length !== report.months.length) {
      throw new RangeError(MESSAGES.badBudgetCount(i));
    }
  }
}

// Rapporten som celler, rubrikraden först. Svaret är en lista av listor där
// varje cell är { text } eller { amountOre } — alltså precis det toCsv tar emot.
//
// En rad per (kind, category, månad): den långa formen. Ordningen är
// rapportradernas ordning, och inom en rad månadernas, alltså months ordning.
// Båda är redan totala — reportRows bygger sina rader ur ITEM_KINDS och
// CATEGORIES, och months är äldst först — så filen kan inte hoppa om mellan två
// läsningar.
//
// Summa och snitt står inte i filen. Skärmtabellen visar dem; filen bär rådatan,
// och SUMMA och MEDEL finns i kalkylbladet. En fil som bär både detaljen och
// sammanfattningen tvingar läsaren att räkna ut vilken av dem en rad är.
//
// kind och category prövas INTE mot sina listor. En nyckel utanför
// ITEM_KIND_LABELS eller CATEGORY_LABELS kan inte uppstå: reportRows bygger varje
// rad ur ITEM_KINDS och CATEGORIES, och en rapport som inte kommer därifrån
// avvisas av rad 1 till 4 (ARKITEKTUR.md). Spärrtabellens rader för
// reportCsvRows är rad 1 till 6, och en rad till här hade varit ett andra facit.
export function reportCsvRows(report) {
  checkReport(report);

  const rows = [HEADER.map((text) => ({ text }))];

  for (let i = 0; i < report.rows.length; i += 1) {
    const row = report.rows[i];
    for (let m = 0; m < report.months.length; m += 1) {
      // Taket för just den här månaden. null betyder "inget tak" och är det enda
      // värde budgetPerMonthOre bär utöver ett belopp: för income och saving är
      // varje element null (beslut 5 i ARKITEKTUR.md), och för expense är det
      // null för varje månad utan tak (beslut 4).
      //
      // Jämförelsen är === null och inte en sanningsprövning: 0 ören är ett
      // giltigt tak på noll kronor och ska skrivas som ett belopp, inte som en
      // tom cell.
      const budgetOre = row.budgetPerMonthOre[m];
      const amountOre = row.perMonthOre[m];

      rows.push([
        // Slagets och kategorins svenska namn kommer ur sina ägare och skrivs
        // inte av här. Användaren ser aldrig nycklarna income, expense, saving,
        // housing och de övriga.
        { text: ITEM_KIND_LABELS[row.kind] },
        { text: CATEGORY_LABELS[row.category] },
        // Månaden som ÅÅÅÅ-MM och aldrig som ett månadsnamn: formen sorterar
        // lexikografiskt som den sorterar kronologiskt, och ett namn hade varit
        // språkberoende i en fil som ska gå att läsa maskinellt. Cellen är text
        // och inte ett belopp — ett kalkylblad ska inte räkna på den.
        { text: report.months[m] },
        // Beloppet som beloppscell. csvAmountSek i csv.js äger formatet och är
        // också ägaren till frågan "är det här ett antal ören": ett skadat tal
        // kastar där, med modulens egen text, i stället för att bli en tyst cell.
        { amountOre },
        budgetOre === null ? { text: EMPTY } : { amountOre: budgetOre },
        // Beslut 6 i ARKITEKTUR.md: över taket betyder strikt större. Lika med
        // taket är inte över det, och gränsen prövas på båda sidor i (RA27).
        budgetOre === null
          ? { text: EMPTY }
          : { text: amountOre > budgetOre ? OVER_BUDGET_YES : OVER_BUDGET_NO }
      ]);
    }
  }

  return rows;
}

// CSV-filens namn för en rapport som slutar med endMonth [steg 5 del 3]:
// "hemochekonomi-<ÅÅÅÅ-MM>.csv". Två läsare: api.js sätter Content-Disposition
// med det, och gränssnittet sätter samma namn på nedladdningen. Ägaren ligger i
// src/core/ därför att det är det enda stället båda når.
//
// Spärrtabellen rad 7. Formen ÅÅÅÅ-MM gör namnet till rent ASCII utan citattecken
// eller radbrott, så att det kan skrivas okodat i ett huvud. isValidIsoMonth i
// dates.js äger frågan; dess prövning coercar inte, så 1n och Symbol('x') ger
// false i stället för att kasta TypeError.
export function reportFileName(endMonth) {
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(MESSAGES.badFileMonth);
  }
  return `${FILE_PREFIX}${endMonth}${FILE_SUFFIX}`;
}
