// Kärnans rapportmodul, src/core/report.js [steg 5]. Prövar modulens egna
// exporter direkt: varje fil under src/core/ ska ha en tests/<modul>.test.js som
// gör det, i samma paket som filen skapas (LARDOMAR.md 2026-08-18).
//
// Kravlistan är (RA8) till (RA16) i ARKITEKTUR.md under "Kravlista [steg 5]".
// (RA17) prövas inte här: den står sedan commit f7dc97d i kravlistan för
// tests/report-api.test.js, därför att taket är readReports ensak — reportRows
// tar inget count, och OVERVIEW_MIN_MONTHS och OVERVIEW_MAX_MONTHS är
// modullokala i src/server/months.js, som kärnan inte får importera.
//
// Utöver (RA8) till (RA16) prövas spärrtabellen "Ingångsspärrar i
// src/core/report.js" rad för rad, alla nio raderna. De fallen bär inget
// (RA)-nummer, därför att tabellen är deras facit och ett nummer utan en punkt i
// kravlistan ser ut som en hänvisning utan att vara en (LARDOMAR.md 2026-09-14).
// Samma val som tests/csv.test.js gjorde i del 1 av steget.
//
// Varje assert.throws asserterar hela message, aldrig bara feltypen: en feltyp
// delas av varje spärr i modulen, och en assertion på enbart RangeError kan
// därför inte skilja rad 3 från rad 4, eller rad 8 från rad 9
// (LARDOMAR.md 2026-09-16). Det gäller också de bredare värdelistorna nedan,
// eftersom varje värde i dem står ensamt i sin serie och meddelandet då är
// identiskt.
//
// Ingen klocka läses: modulen har ingen, och ingen testdata bygger på dagens
// datum. En rapport är historik.
import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORIES } from '../src/core/entry.js';
import { ITEM_KINDS } from '../src/core/item.js';
import { reportRows } from '../src/core/report.js';

// En månadspost som readMonth svarar med, nedskalad till de tre fält reportRows
// läser. Posten bär fler fält i verkligheten (id, name, dueDate och de övriga),
// och modulen rör inget av dem.
const post = (kind, category, amountOre) => ({ kind, category, amountOre });

// Ett element i monthsData: månadssträngen plus de två listor readMonth svarar
// med.
const månad = (month, items = [], budgets = []) => ({ month, items, budgets });

// En rad ur budgetLines i src/server/months.js, med sin fulla form. spentOre och
// leftOre står med fast reportRows inte läser dem: indatan ska vara den form
// servern verkligen skickar, inte en bantad variant.
const tak = (category, amountOre) => ({ category, amountOre, spentOre: 0, leftOre: amountOre });

// Varje värde som inte är en lista och som därför ska nå rad 1. 1n och
// Symbol('x') står med därför att de kastar TypeError ur aritmetik och
// stränginterpolation där varje annan typ tvingas till NaN respektive en sträng
// (LARDOMAR.md 2026-08-24), och new Date() därför att ett handskrivet typvillkor
// släpper igenom det (LARDOMAR.md 2026-09-02).
const ICKE_LISTOR = [null, undefined, 'abc', '', 42, 0, true, {}, { 0: månad('2026-01') }, new Date(), 1n, Symbol('x')];

// Varje värde som inte är ett vanligt objekt och som därför ska nå rad 3. [] och
// [1] står med därför att isPlainObject avvisar en array, till skillnad från ett
// handskrivet typeof x === 'object'. new Date() står INTE här: ägaren
// isPlainObject godkänner ett Date, så det värdet når rad 4 i stället, och det
// har ett eget testfall.
const ICKE_OBJEKT = [null, undefined, 'abc', 42, 0, true, [], [1], 1n, Symbol('x')];

// Varje värde som inte är en lista och som därför ska nå rad 5 respektive rad 6
// när det står som items eller budgets.
const ICKE_LISTOR_I_MÅNAD = [null, undefined, 'abc', 42, true, {}, new Date(), 1n, Symbol('x')];

// Varje värde som inte är ett säkert heltal och som därför ska nå rad 9 när det
// står som amountOre på en budgetrad. Talen med punkt och de två över det säkra
// området står med därför att Number.isInteger är sant för dem — skillnaden mot
// Number.isSafeInteger har ett eget testfall.
//
// -0 står medvetet INTE här: Number.isSafeInteger(-0) är sant, så värdet
// passerar rad 9. Det är avgjort och inte en lucka — arkitekten beslutade att
// värdet normaliseras av normalizeZero i stället för att avvisas, och det har ett
// eget testfall längre ner.
const ICKE_ÖRETAL = [
  'abc',
  '',
  '5000',
  NaN,
  Infinity,
  -Infinity,
  1.5,
  1e300,
  Number.MAX_SAFE_INTEGER + 2,
  null,
  undefined,
  true,
  {},
  [],
  [1],
  new Date(),
  1n,
  Symbol('x')
];

// ---------------------------------------------------------------------------
// Spärrtabellen rad 1: reportRows kräver en lista med månader.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 1: reportRows kastar med hela meddelandet för något som inte är en lista', () => {
  assert.throws(
    () => reportRows({ month: '2026-01', items: [], budgets: [] }),
    { name: 'RangeError', message: 'reportRows kräver en lista med månader.' }
  );
});

test('spärrtabellen rad 1: varje värde som inte är en lista ger samma meddelande', () => {
  for (const värde of ICKE_LISTOR) {
    assert.throws(
      () => reportRows(värde),
      { name: 'RangeError', message: 'reportRows kräver en lista med månader.' },
      `${String(värde)} skulle ha nått rad 1`
    );
  }
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 2: reportRows kräver minst en månad.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 2: en tom lista kastar med hela meddelandet', () => {
  // Rad 2 och inte rad 1: den tomma listan ÄR en lista. Meddelandet skiljer de
  // två, och en assertion på enbart RangeError hade inte gjort det.
  assert.throws(
    () => reportRows([]),
    { name: 'RangeError', message: 'reportRows kräver minst en månad.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 3: reportRows kräver ett objekt per månad, index <i>.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 3: ett element som inte är ett objekt kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([null]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per månad, index 0.' }
  );
});

test('spärrtabellen rad 3: varje värde som inte är ett vanligt objekt ger samma meddelande', () => {
  for (const värde of ICKE_OBJEKT) {
    assert.throws(
      () => reportRows([värde]),
      { name: 'RangeError', message: 'reportRows kräver ett objekt per månad, index 0.' },
      `${String(värde)} skulle ha nått rad 3`
    );
  }
});

test('spärrtabellen rad 3 namnger indexet och inte bara felet', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), 'abc']),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per månad, index 1.' }
  );
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-02'), []]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per månad, index 2.' }
  );
});

test('ett Date passerar rad 3 och avvisas av rad 4', () => {
  // Mätt, inte resonerat: isPlainObject i entry.js är ägaren till frågan "är
  // det här ett vanligt objekt", och den godkänner ett Date — den avvisar bara
  // null och en array. Ett Date bär inget month, så det är rad 4 som avvisar
  // det. Fallet står här för att utfallet ska vara skrivet någonstans
  // (LARDOMAR.md 2026-09-02 kräver new Date() bland värdena, inte att det ska
  // nå en bestämd rad).
  assert.throws(
    () => reportRows([new Date()]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 0.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 4: reportRows kräver en månad på formen ÅÅÅÅ-MM, index <i>.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 4: en månad som inte är en månad kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('januari')]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 0.' }
  );
});

test('spärrtabellen rad 4: formen räcker inte, månadsnumret prövas också', () => {
  // '2026-13' och '2026-00' matchar ISO_MONTH_PATTERN utan att vara månader.
  // isValidIsoMonth i dates.js äger frågan, och mönstret ensamt hade släppt
  // igenom båda.
  for (const värde of ['2026-13', '2026-00', '2026-1', '26-01', '2026-01-01', '', ' 2026-01', 42, null, undefined]) {
    assert.throws(
      () => reportRows([månad(värde)]),
      { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 0.' },
      `${String(värde)} skulle ha nått rad 4`
    );
  }
});

test('spärrtabellen rad 4 namnger indexet', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-13')]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 1.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 5: reportRows kräver en lista med poster, index <i>.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 5: items som inte är en lista kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([{ month: '2026-01', budgets: [] }]),
    { name: 'RangeError', message: 'reportRows kräver en lista med poster, index 0.' }
  );
});

test('spärrtabellen rad 5: varje värde som inte är en lista ger samma meddelande', () => {
  for (const värde of ICKE_LISTOR_I_MÅNAD) {
    assert.throws(
      () => reportRows([{ month: '2026-01', items: värde, budgets: [] }]),
      { name: 'RangeError', message: 'reportRows kräver en lista med poster, index 0.' },
      `${String(värde)} skulle ha nått rad 5`
    );
  }
});

test('spärrtabellen rad 5 namnger indexet', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), { month: '2026-02', items: 'abc', budgets: [] }]),
    { name: 'RangeError', message: 'reportRows kräver en lista med poster, index 1.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 6: reportRows kräver en lista med budgetar, index <i>.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 6: budgets som inte är en lista kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([{ month: '2026-01', items: [] }]),
    { name: 'RangeError', message: 'reportRows kräver en lista med budgetar, index 0.' }
  );
});

test('spärrtabellen rad 6: varje värde som inte är en lista ger samma meddelande', () => {
  for (const värde of ICKE_LISTOR_I_MÅNAD) {
    assert.throws(
      () => reportRows([{ month: '2026-01', items: [], budgets: värde }]),
      { name: 'RangeError', message: 'reportRows kräver en lista med budgetar, index 0.' },
      `${String(värde)} skulle ha nått rad 6`
    );
  }
});

test('spärrtabellen rad 6 namnger indexet', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), { month: '2026-02', items: [], budgets: {} }]),
    { name: 'RangeError', message: 'reportRows kräver en lista med budgetar, index 1.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 7: reportRows kräver månaderna i stigande ordning, index <i>.
//
// Raden bär mest av alla sju: perMonthOre:s index ÄR månaden, så en felsorterad
// indata kastar om hela serien tyst och diagrammet ritar en kurva som inte är
// användarens.
// ---------------------------------------------------------------------------

test('spärrtabellen rad 7: två lika månader kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-01')]),
    { name: 'RangeError', message: 'reportRows kräver månaderna i stigande ordning, index 1.' }
  );
});

test('spärrtabellen rad 7: två månader i fallande ordning kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('2026-02'), månad('2026-01')]),
    { name: 'RangeError', message: 'reportRows kräver månaderna i stigande ordning, index 1.' }
  );
});

test('spärrtabellen rad 7 namnger indexet där ordningen bryts', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-02'), månad('2026-02')]),
    { name: 'RangeError', message: 'reportRows kräver månaderna i stigande ordning, index 2.' }
  );
  assert.throws(
    () => reportRows([månad('2025-12'), månad('2026-03'), månad('2026-01')]),
    { name: 'RangeError', message: 'reportRows kräver månaderna i stigande ordning, index 2.' }
  );
});

test('rad 7 kräver strikt stigande ordning, inte att månaderna är varandras granne', () => {
  // Servern producerar alltid en obruten serie, men strikt stigande är allt som
  // krävs för att indexet ska betyda något, och months följer med i svaret så
  // att en lucka är synlig för anroparen (ARKITEKTUR.md).
  const svar = reportRows([månad('2025-11'), månad('2026-02'), månad('2027-01')]);
  assert.deepEqual(svar.months, ['2025-11', '2026-02', '2027-01']);
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 8: reportRows kräver ett objekt per budgetrad, index <i>
// rad <j>.
//
// Raden tillkom i del 2 av steget, efter en mätning: modulen filtrerade först
// bort budgetrader som inte var objekt i stället för att kasta, och i samma
// element prövades då items och budgets efter motsatta regler — items: [null]
// kastade genom sumByKind, budgets: [null] tystnade (ARKITEKTUR.md).
// ---------------------------------------------------------------------------

test('spärrtabellen rad 8: en budgetrad som inte är ett objekt kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('2026-01', [], [null])]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 0 rad 0.' }
  );
});

test('spärrtabellen rad 8: varje värde som inte är ett vanligt objekt ger samma meddelande', () => {
  // Samma lista som rad 3 använder, och av samma skäl: [] och [1] släpps igenom
  // av ett handskrivet typeof-villkor men inte av isPlainObject, och 1n och
  // Symbol('x') kastar TypeError ur en jämförelse där andra typer tvingas till
  // NaN (LARDOMAR.md 2026-09-02 och 2026-08-24).
  for (const värde of ICKE_OBJEKT) {
    assert.throws(
      () => reportRows([månad('2026-01', [], [värde])]),
      { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 0 rad 0.' },
      `${String(värde)} skulle ha nått rad 8`
    );
  }
});

test('spärrtabellen rad 8 namnger både månadens index och budgetradens', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-02', [], [tak('housing', 100000), 'abc'])]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 1 rad 1.' }
  );
});

test('items och budgets prövas lika strikt i samma element', () => {
  // Symmetrin är hela skälet till rad 8 och 9: samma trasiga värde i de två
  // listorna ska ge ett kast i båda fallen, inte ett kast i det ena och tystnad i
  // det andra. Meddelandena skiljer sig därför att spärrarna har olika ägare —
  // postkedjan ägs av sumByKind i budget.js, budgetraden av den här modulen.
  const trasig = { month: '2026-01', items: [null], budgets: [] };
  const trasigBudget = { month: '2026-01', items: [], budgets: [null] };
  assert.throws(
    () => reportRows([trasig]),
    { name: 'RangeError', message: 'monthTotals kräver poster som objekt.' }
  );
  assert.throws(
    () => reportRows([trasigBudget]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 0 rad 0.' }
  );
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 9: reportRows kräver ett belopp i heltal ören per
// budgetrad, index <i> rad <j>.
//
// Före raden gick ett tak med skräp i beloppet rakt in i svaret, och
// jämförelsen mot det var tyst falsk: 500000 ören spenderat mot amountOre 'abc'
// gav overBudgetMonths: 0, alltså svaret att användaren höll budgeten
// (ARKITEKTUR.md).
// ---------------------------------------------------------------------------

test('spärrtabellen rad 9: ett tak som inte är ett heltal ören kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('2026-01', [], [{ category: 'housing', amountOre: 'abc' }])]),
    { name: 'RangeError', message: 'reportRows kräver ett belopp i heltal ören per budgetrad, index 0 rad 0.' }
  );
});

test('spärrtabellen rad 9: varje värde som inte är ett säkert heltal ger samma meddelande', () => {
  for (const värde of ICKE_ÖRETAL) {
    assert.throws(
      () => reportRows([månad('2026-01', [], [{ category: 'housing', amountOre: värde }])]),
      { name: 'RangeError', message: 'reportRows kräver ett belopp i heltal ören per budgetrad, index 0 rad 0.' },
      `${String(värde)} skulle ha nått rad 9`
    );
  }
});

test('spärrtabellen rad 9 kräver ett SÄKERT heltal, inte bara ett heltal', () => {
  // Skillnaden är hela skälet till att regeln heter som den gör:
  // Number.isInteger är sant för båda värdena nedan, Number.isSafeInteger falskt.
  // Ett tak utanför det säkra heltalsområdet går inte att jämföra meningsfullt med
  // en summa — två skilda heltal över 2 upphöjt till 53 är samma dubbel — och
  // summan på andra sidan jämförelsen är redan prövad som ett säkert heltal av
  // sumByKind.
  for (const värde of [Number.MAX_SAFE_INTEGER + 2, 1e300]) {
    assert.equal(Number.isInteger(värde), true, `${värde} skulle vara ett heltal`);
    assert.equal(Number.isSafeInteger(värde), false, `${värde} skulle inte vara ett säkert heltal`);
    assert.throws(
      () => reportRows([månad('2026-01', [], [{ category: 'housing', amountOre: värde }])]),
      { name: 'RangeError', message: 'reportRows kräver ett belopp i heltal ören per budgetrad, index 0 rad 0.' },
      `${värde} skulle ha nått rad 9`
    );
  }
});

test('spärrtabellen rad 9 namnger både månadens index och budgetradens', () => {
  assert.throws(
    () => reportRows([månad('2026-01'), månad('2026-02', [], [tak('housing', 100000), { category: 'loan', amountOre: 1.5 }])]),
    { name: 'RangeError', message: 'reportRows kräver ett belopp i heltal ören per budgetrad, index 1 rad 1.' }
  );
});

test('ett tak på -0 ören normaliseras och budgetPerMonthOre bär aldrig -0', () => {
  // Number.isSafeInteger(-0) är sant, så rad 9 släpper igenom värdet. Talet går
  // rakt ur indatan in i svaret, och normalizeZero i money.js äger frågan: ingen
  // exporterad funktion i src/core/ får returnera -0 (LARDOMAR.md 2026-09-02).
  //
  // Asserteras med Object.is och aldrig med assert.equal(värdet, 0), som är sant
  // också för -0 — det är hela skälet till att ett sådant fel kan överleva en
  // grön svit.
  const svar = reportRows([månad('2026-01', [], [{ category: 'housing', amountOre: -0 }])]);
  const värdet = svar.rows[0].budgetPerMonthOre[0];
  assert.equal(Number.isSafeInteger(-0), true, 'rad 9 skulle släppa igenom -0');
  assert.equal(Object.is(värdet, -0), false, 'budgetPerMonthOre bar -0');
  assert.equal(Object.is(värdet, 0), true);
});

test('ett tak på 0 ören är ett tal och passerar rad 9', () => {
  // Noll ören är ett heltal och avvisas inte: taket är satt och ska läsas som 0,
  // aldrig som "inget tak". Uppslaget frågar därför has och inte om värdet är
  // sant. Databasen kan inte producera värdet — budgets har
  // CHECK (amount_ore > 0) — men modulen är kärna och får inte svara fel för en
  // indata den kan få.
  const svar = reportRows([månad('2026-01', [], [tak('housing', 0)])]);
  assert.deepEqual(svar.rows.map((rad) => `${rad.kind}/${rad.category}`), ['expense/housing']);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [0]);
  assert.equal(svar.rows[0].overBudgetMonths, 0);
});

// ---------------------------------------------------------------------------
// Ordningen mellan raderna.
// ---------------------------------------------------------------------------

test('spärrtabellens ordning är radernas och inte elementens: rad 4 vinner över rad 5', () => {
  // Körd konsekvens av att varje rad prövas i en egen genomgång, ordagrant samma
  // konstruktion som toCsv i csv.js: index 0 saknar items (rad 5) och index 1
  // har en månad som inte är en månad (rad 4). Tabellen säger "första träff
  // vinner" om RADERNA, så rad 4 ska vinna oavsett vilket element som står
  // först. En enda genomgång hade gett rad 5:s meddelande om index 0
  // (LARDOMAR.md 2026-09-02).
  assert.throws(
    () => reportRows([{ month: '2026-01', budgets: [] }, { month: 'januari', items: [], budgets: [] }]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 1.' }
  );
});

test('rad 8 vinner över rad 9, också när rad 9:s träff står i en tidigare månad', () => {
  // Rad 8 prövas för VARJE budgetrad i varje månad innan rad 9 prövas för någon.
  // Index 0 har ett tak med skräp i beloppet (rad 9) och index 1 en budgetrad som
  // inte är ett objekt (rad 8); svaret är rad 8:s, om index 1 rad 0.
  //
  // Ordningen är inte bara tabellens: rad 9 läser .amountOre, och på en budgetrad
  // som är null hade det gett TypeError i stället för modulens RangeError.
  assert.throws(
    () => reportRows([
      månad('2026-01', [], [{ category: 'housing', amountOre: 'abc' }]),
      månad('2026-02', [], [null])
    ]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 1 rad 0.' }
  );
});

test('rad 7 vinner över rad 8, och rad 6 över rad 8', () => {
  // De två nya raderna står sist i tabellen, så varje tidigare rad vinner över
  // dem.
  assert.throws(
    () => reportRows([månad('2026-02'), månad('2026-01', [], [null])]),
    { name: 'RangeError', message: 'reportRows kräver månaderna i stigande ordning, index 1.' }
  );
  assert.throws(
    () => reportRows([
      { month: '2026-01', items: [], budgets: [null] },
      { month: '2026-02', items: [], budgets: {} }
    ]),
    { name: 'RangeError', message: 'reportRows kräver en lista med budgetar, index 1.' }
  );
});

// ---------------------------------------------------------------------------
// Postens egna fält: kedjan ärvs av sumByKind i src/core/budget.js.
//
// Spärrtabellen prövar att items ÄR en lista och inget mer. Postens kind och
// amountOre ägs av sumByKind, och modulen skriver ingen egen kopia av de
// villkoren. Fallen nedan visar att en trasig post ger ett kast och inte ett
// skadat tal: ingen exporterad funktion i src/core/ får svara med NaN
// (LARDOMAR.md 2026-09-02). Meddelandet namnger monthTotals, som är spärrens
// ägare, och skrivs inte om.
// ---------------------------------------------------------------------------

test('en post som inte är ett objekt avvisas av sumByKind och tappas inte tyst', () => {
  for (const värde of [null, undefined, 'abc', 42, true, [], [1], 1n, Symbol('x')]) {
    assert.throws(
      () => reportRows([månad('2026-01', [värde])]),
      { name: 'RangeError', message: 'monthTotals kräver poster som objekt.' },
      `${String(värde)} skulle ha nått postkedjan`
    );
  }
});

test('ett belopp som inte är ett heltal ören ger ett kast och aldrig NaN', () => {
  for (const värde of ['abc', NaN, Infinity, 199.5, 1e300, null, undefined, 1n, Symbol('x')]) {
    assert.throws(
      () => reportRows([månad('2026-01', [post('expense', 'housing', värde)])]),
      { name: 'RangeError', message: 'monthTotals kräver ett belopp i heltal ören.' },
      `${String(värde)} skulle ha nått beloppsspärren`
    );
  }
});

test('ett okänt slag ger ett kast som namnger slaget', () => {
  assert.throws(
    () => reportRows([månad('2026-01', [post('gift', 'housing', 12000)])]),
    { name: 'RangeError', message: 'monthTotals kräver ett känt slag, fick "gift".' }
  );
});

test('en summa över hela serien som lämnar det säkra heltalsområdet ger ett kast, inte ett tyst tal', () => {
  // Varje månads egen summa är ett säkert heltal, men summan över serien är det
  // inte. Fallet står här därför att det är det enda som skiljer totalOre:s
  // ägare, sumByKind över månadernas poster tillsammans, från en addition av
  // perMonthOre i den här filen: en addition här hade svarat 12000000000000000
  // tyst. Ett förbud mot en egen summering kräver en mutation per anrop
  // (LARDOMAR.md 2026-09-10).
  const stor = (month) => månad(month, [post('expense', 'housing', 4e15)]);
  assert.equal(Number.isSafeInteger(4e15), true);
  assert.throws(
    () => reportRows([stor('2026-01'), stor('2026-02'), stor('2026-03')]),
    { name: 'RangeError', message: 'monthTotals kräver att summan är ett säkert heltal.' }
  );
});

// ---------------------------------------------------------------------------
// (RA8) Radnyckeln är (kind, category): samma kategori med två slag ger två
// rader.
// ---------------------------------------------------------------------------

test('(RA8) samma kategori med två slag ger två rader, i ITEM_KINDS ordning', () => {
  const svar = reportRows([
    månad('2026-01', [post('income', 'housing', 500000), post('expense', 'housing', 120000)]),
    månad('2026-02', [post('expense', 'housing', 30000)])
  ]);

  // Två rader och inte en: en rad som slog ihop slagen hade visat nettot
  // 500000 - 150000, ett tal användaren aldrig skrivit (ARKITEKTUR.md, beslut 1).
  assert.equal(svar.rows.length, 2);
  assert.deepEqual(svar.rows.map((rad) => [rad.kind, rad.category]), [
    ['income', 'housing'],
    ['expense', 'housing']
  ]);

  // Talen är valda så att inget fält sammanfaller med ett annat fält raden bär:
  // perMonthOre, totalOre och averageOre är tre olika tal i båda raderna, så en
  // assertion kan inte passera på fel fält (LARDOMAR.md 2026-09-16).
  assert.deepEqual(svar.rows[0].perMonthOre, [500000, 0]);
  assert.equal(svar.rows[0].totalOre, 500000);
  assert.equal(svar.rows[0].averageOre, 250000);
  assert.deepEqual(svar.rows[1].perMonthOre, [120000, 30000]);
  assert.equal(svar.rows[1].totalOre, 150000);
  assert.equal(svar.rows[1].averageOre, 75000);

  // Svarets form, ordagrant som ARKITEKTUR.md skriver ut den under "Vad
  // readReport svarar". Ett extra fält är ett fel: nästa del av steget bygger
  // gränssnittet mot exakt de här namnen.
  assert.deepEqual(Object.keys(svar), ['months', 'rows', 'largest']);
  assert.deepEqual(Object.keys(svar.rows[0]), [
    'kind', 'category', 'perMonthOre', 'totalOre', 'averageOre', 'budgetPerMonthOre', 'overBudgetMonths'
  ]);
  assert.deepEqual(Object.keys(svar.largest), ['kind', 'category']);

  // months härleds ur indatan och skickas inte in.
  assert.deepEqual(svar.months, ['2026-01', '2026-02']);
});

test('(RA8) radordningen är ITEM_KINDS ordning, därefter CATEGORIES ordning', () => {
  // En post i varje kategori och i varje slag. Ordningen i indatan är den
  // omvända, så ett svar som bara bevarade inmatningsordningen hade fallit.
  const items = [];
  for (const kind of [...ITEM_KINDS].reverse()) {
    for (const category of [...CATEGORIES].reverse()) {
      items.push(post(kind, category, 1000));
    }
  }
  const svar = reportRows([månad('2026-01', items)]);

  const väntad = [];
  for (const kind of ITEM_KINDS) {
    for (const category of CATEGORIES) {
      väntad.push([kind, category]);
    }
  }
  assert.deepEqual(svar.rows.map((rad) => [rad.kind, rad.category]), väntad);
});

// ---------------------------------------------------------------------------
// (RA9) averageOre delas med antalet månader i serien, aldrig med antalet
// månader som har ett belopp.
// ---------------------------------------------------------------------------

test('(RA9) averageOre delas med antalet månader i serien, också för en kategori i 2 av 6 månader', () => {
  const månader = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const svar = reportRows(månader.map((month, i) => {
    if (i === 1) {
      return månad(month, [post('expense', 'transport', 30000)]);
    }
    if (i === 4) {
      return månad(month, [post('expense', 'transport', 12000)]);
    }
    return månad(month);
  }));

  assert.equal(svar.rows.length, 1);
  assert.deepEqual(svar.rows[0].perMonthOre, [0, 30000, 0, 0, 12000, 0]);
  assert.equal(svar.rows[0].totalOre, 42000);

  // 42000 / 6 = 7000. Delningen med antalet månader SOM HAR ett belopp hade gett
  // 42000 / 2 = 21000, och en månad utan utgift är en riktig nolla och inte en
  // saknad mätning (ARKITEKTUR.md, beslut 2).
  assert.equal(svar.rows[0].averageOre, 7000);
  assert.notEqual(svar.rows[0].averageOre, 21000, 'snittet delades med antalet månader som har ett belopp');

  // Listorna har samma längd och samma ordning som months.
  assert.equal(svar.rows[0].perMonthOre.length, svar.months.length);
  assert.equal(svar.rows[0].budgetPerMonthOre.length, svar.months.length);
});

// ---------------------------------------------------------------------------
// (RA10) Halva öret uppåt i snittet.
// ---------------------------------------------------------------------------

test('(RA10) ett snitt som inte delar jämnt avrundas med halva öret uppåt', () => {
  const månader = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const svar = reportRows(månader.map((month, i) => (
    i === 0 ? månad(month, [post('expense', 'subscription', 999)]) : månad(month)
  )));

  assert.equal(svar.rows[0].totalOre, 999);
  // 999 / 6 = 166,5 ören. Halva öret uppåt ger 167; en trunkering hade gett 166
  // och en flyttalsdivision 166.5, som inte är ett ören-tal.
  assert.equal(svar.rows[0].averageOre, 167);
  assert.notEqual(svar.rows[0].averageOre, 166, 'snittet trunkerades i stället för att avrundas uppåt');
  assert.equal(Number.isInteger(svar.rows[0].averageOre), true);
});

// ---------------------------------------------------------------------------
// (RA11) En rad med tak men noll belopp kommer med; en rad utan båda utesluts.
// ---------------------------------------------------------------------------

test('(RA11) en rad med tak men noll belopp kommer med, och en rad utan båda utesluts', () => {
  const svar = reportRows([månad('2026-01', [], [tak('housing', 700000)])]);

  // Ett satt tak som inte använts är ett svar: du budgeterade för boende och
  // betalade ingenting (ARKITEKTUR.md, beslut 3).
  assert.equal(svar.rows.length, 1);
  assert.equal(svar.rows[0].kind, 'expense');
  assert.equal(svar.rows[0].category, 'housing');
  assert.deepEqual(svar.rows[0].perMonthOre, [0]);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [700000]);

  // De sjutton övriga (kind, category)-paren är noll hela serien och saknar tak,
  // och har därför ingenting att rapportera.
  assert.equal(ITEM_KINDS.length * CATEGORIES.length, 18);
  assert.deepEqual(
    svar.rows.map((rad) => `${rad.kind}/${rad.category}`),
    ['expense/housing']
  );
});

test('(RA11) en kategori med ett belopp skilt från noll kommer med utan tak', () => {
  const svar = reportRows([månad('2026-01', [post('saving', 'other', 25000)])]);
  assert.deepEqual(svar.rows.map((rad) => `${rad.kind}/${rad.category}`), ['saving/other']);
  assert.deepEqual(svar.rows[0].perMonthOre, [25000]);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [null]);
});

// ---------------------------------------------------------------------------
// (RA12) budgetPerMonthOre följer taket per månad.
// ---------------------------------------------------------------------------

test('(RA12) budgetPerMonthOre följer taket per månad, med null för en månad utan tak', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'other', 50000)], [tak('other', 100000)]),
    månad('2026-02', [post('expense', 'other', 60000)], []),
    månad('2026-03', [post('expense', 'other', 70000)], [tak('other', 300000)])
  ]);

  assert.equal(svar.rows.length, 1);
  assert.deepEqual(svar.rows[0].perMonthOre, [50000, 60000, 70000]);
  // En lista och inte ett tal: ett enda budgetOre för hela serien hade blivit en
  // lögn i samma stund användaren ändrade taket (ARKITEKTUR.md, beslut 4). Den
  // mellersta månaden saknar tak och är null, inte 0 och inte undefined.
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [100000, null, 300000]);
  assert.equal(svar.rows[0].budgetPerMonthOre[1], null);
});

test('(RA12) taket för en annan kategori läcker inte in i raden', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'loan', 80000)], [tak('transport', 150000)])
  ]);
  const lån = svar.rows.find((rad) => rad.category === 'loan');
  const transport = svar.rows.find((rad) => rad.category === 'transport');
  assert.deepEqual(lån.budgetPerMonthOre, [null]);
  assert.deepEqual(transport.budgetPerMonthOre, [150000]);
  assert.deepEqual(transport.perMonthOre, [0]);
});

// ---------------------------------------------------------------------------
// (RA13) budgetPerMonthOre är null för inkomst och sparande.
// ---------------------------------------------------------------------------

test('(RA13) budgetPerMonthOre är enbart null för income och saving, också när kategorin har ett tak', () => {
  const svar = reportRows([
    månad('2026-01', [post('income', 'housing', 410000), post('saving', 'housing', 230000)], [tak('housing', 550000)])
  ]);

  // Tre rader: inkomsten, utgiftsraden som taket skapar, och sparandet.
  assert.deepEqual(svar.rows.map((rad) => `${rad.kind}/${rad.category}`), [
    'income/housing', 'expense/housing', 'saving/housing'
  ]);

  // Taket gäller bara utgifter — det är steg 2:s beslut, där spentOre räknar
  // enbart utgifter (ARKITEKTUR.md, beslut 5). Raderna för inkomst och sparande
  // har ett belopp i samma kategori och samma månad, så det enda som skiljer dem
  // från utgiftsraden är slaget.
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [null]);
  assert.deepEqual(svar.rows[1].budgetPerMonthOre, [550000]);
  assert.deepEqual(svar.rows[2].budgetPerMonthOre, [null]);

  // Taket påverkar inte heller overBudgetMonths för de två slagen: 410000
  // överstiger inte taket, men 230000 gör det inte heller, och ingen av dem
  // räknas eftersom de inte har något tak.
  assert.equal(svar.rows[0].overBudgetMonths, 0);
  assert.equal(svar.rows[2].overBudgetMonths, 0);

  // Exakt ett slag läser taket, och det slaget står i ITEM_KINDS. Faller detta
  // har modulens BUDGETED_KIND bytts mot ett värde som inte är ett känt slag.
  const medTak = svar.rows.filter((rad) => rad.budgetPerMonthOre.some((ore) => ore !== null));
  assert.equal(medTak.length, 1);
  assert.equal(ITEM_KINDS.includes(medTak[0].kind), true);
  assert.equal(medTak[0].kind, 'expense');
});

// ---------------------------------------------------------------------------
// (RA14) overBudgetMonths på båda sidor om gränsen.
// ---------------------------------------------------------------------------

test('(RA14) overBudgetMonths räknar månaden över taket men inte månaden lika med taket', () => {
  const serie = (januari) => [
    månad('2026-01', [post('expense', 'loan', januari)], [tak('loan', 400000)]),
    månad('2026-02', [post('expense', 'loan', 400001)], [tak('loan', 400000)]),
    månad('2026-03', [post('expense', 'loan', 399999)], [tak('loan', 400000)])
  ];

  // Januari lika med taket: räknas INTE. Februari ett öre över: räknas. Mars ett
  // öre under: räknas inte (ARKITEKTUR.md, beslut 6).
  const lika = reportRows(serie(400000));
  assert.deepEqual(lika.rows[0].perMonthOre, [400000, 400001, 399999]);
  assert.deepEqual(lika.rows[0].budgetPerMonthOre, [400000, 400000, 400000]);
  assert.equal(lika.rows[0].overBudgetMonths, 1);

  // Samma serie med januari ett öre över taket i stället: då är det två månader.
  // Det enda som skiljer de två körningarna är ett öre på gränsen.
  const över = reportRows(serie(400001));
  assert.deepEqual(över.rows[0].perMonthOre, [400001, 400001, 399999]);
  assert.equal(över.rows[0].overBudgetMonths, 2);
});

test('(RA14) en månad utan tak räknas inte som över taket, hur stort beloppet än är', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'insurance', 9999999)], []),
    månad('2026-02', [post('expense', 'insurance', 1)], [tak('insurance', 100)])
  ]);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [null, 100]);
  assert.equal(svar.rows[0].overBudgetMonths, 0);
});

// ---------------------------------------------------------------------------
// (RA15) largest vid lika summa: den tidigare i radordningen.
// ---------------------------------------------------------------------------

test('(RA15) largest vid exakt lika totalOre är den tidigare i ITEM_KINDS ordning', () => {
  // Utgiftsposten står FÖRST i indatan, så ett svar som följde
  // inmatningsordningen hade gett expense/transport.
  const svar = reportRows([
    månad('2026-01', [post('expense', 'transport', 77700), post('income', 'housing', 77700)]),
    månad('2026-02')
  ]);

  assert.equal(svar.rows.length, 2);
  // Exakt lika summa — annars prövar fallet ingenting. Snittet är ett annat tal
  // än summan, så assertionen nedan kan inte passera på fel fält.
  assert.equal(svar.rows[0].totalOre, 77700);
  assert.equal(svar.rows[1].totalOre, 77700);
  assert.equal(svar.rows[0].averageOre, 38850);
  assert.deepEqual(svar.largest, { kind: 'income', category: 'housing' });
});

test('(RA15) largest vid exakt lika totalOre inom samma slag är den tidigare i CATEGORIES ordning', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'transport', 64200), post('expense', 'housing', 64200)]),
    månad('2026-02')
  ]);
  assert.deepEqual(svar.rows.map((rad) => rad.category), ['housing', 'transport']);
  assert.equal(svar.rows[0].totalOre, 64200);
  assert.equal(svar.rows[1].totalOre, 64200);
  assert.deepEqual(svar.largest, { kind: 'expense', category: 'housing' });
});

test('(RA15) largest är raden med störst totalOre när summorna skiljer sig', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'housing', 10000), post('expense', 'loan', 90000), post('income', 'other', 50000)])
  ]);
  // Störst summa vinner oavsett radordning: loan står efter housing i
  // CATEGORIES och expense efter income i ITEM_KINDS.
  assert.deepEqual(svar.largest, { kind: 'expense', category: 'loan' });
});

// ---------------------------------------------------------------------------
// (RA16) Tom rapport: rows tom, largest null, inget kast.
// ---------------------------------------------------------------------------

test('(RA16) en månad utan poster och utan tak ger en tom rapport utan kast', () => {
  const svar = reportRows([månad('2026-01')]);
  assert.deepEqual(svar.months, ['2026-01']);
  assert.deepEqual(svar.rows, []);
  assert.equal(svar.largest, null);
});

test('(RA16) flera tomma månader ger en tom rapport med alla månader kvar i months', () => {
  const svar = reportRows([månad('2026-01'), månad('2026-02'), månad('2026-03')]);
  assert.deepEqual(svar.months, ['2026-01', '2026-02', '2026-03']);
  assert.deepEqual(svar.rows, []);
  assert.equal(svar.largest, null);
});
