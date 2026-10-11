// Kärnans layoutmodul för rapportens CSV-fil, src/core/report-csv.js [steg 5].
// Prövar modulens egen export direkt: varje fil under src/core/ ska ha en
// tests/<modul>.test.js som gör det, i samma paket som filen skapas
// (LARDOMAR.md 2026-08-18).
//
// Kravlistan är (RA24) till (RA30) i ARKITEKTUR.md under "Kravlista för
// tests/report-csv.test.js [steg 5]". Utöver dem prövas spärrtabellen
// "Ingångsspärrar i src/core/report-csv.js" rad för rad, alla sex raderna. De
// fallen bär inget (RA)-nummer, därför att tabellen är deras facit och ett nummer
// utan en punkt i kravlistan ser ut som en hänvisning utan att vara en
// (LARDOMAR.md 2026-09-14). Samma val som tests/csv.test.js och
// tests/report.test.js gjorde i del 1 och del 2 av steget.
//
// Varje assert.throws asserterar hela message, aldrig bara feltypen: en feltyp
// delas av varje spärr i modulen, och en assertion på enbart RangeError kan
// därför inte skilja rad 5 från rad 6 (LARDOMAR.md 2026-09-16).
//
// Ingen klocka läses: modulen har ingen, och ingen testdata bygger på dagens
// datum. En rapport är historik.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AMOUNT_PATTERN, CATEGORIES, CATEGORY_LABELS } from '../src/core/entry.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../src/core/item.js';
import { sekToOre } from '../src/core/money.js';
import { toCsv } from '../src/core/csv.js';
import { reportRows } from '../src/core/report.js';
import { reportCsvRows, reportFileName } from '../src/core/report-csv.js';

// U+FEFF BYTE ORDER MARK och U+000D U+000A, skrivna som escaper. Ett rått tecken
// här går inte att se i en genomläsning (LARDOMAR.md 2026-09-14).
const BOM = '\uFEFF';
const CRLF = '\r\n';

// Rubrikraden, ordagrant som i ARKITEKTUR.md under "CSV-filens innehåll
// (bindande)". Skriven tecken för tecken som ägaren skriver den, så att en
// sökning på hela strängen hittar varje ställe den prövas (LARDOMAR.md
// 2026-09-14).
const RUBRIK = ['Slag', 'Kategori', 'Månad', 'Belopp', 'Tak', 'Över tak'];

// En rapportrad på den form reportRows svarar med. Fälten totalOre, averageOre
// och overBudgetMonths står med fast layouten inte läser dem: indatan ska vara
// den form servern verkligen skickar, inte en bantad variant.
function rad(kind, category, perMonthOre, budgetPerMonthOre = perMonthOre.map(() => null)) {
  return { kind, category, perMonthOre, totalOre: 0, averageOre: 0, budgetPerMonthOre, overBudgetMonths: 0 };
}

function rapport(months, rows) {
  return { months, rows, largest: null };
}

// Varje värde som inte är ett vanligt objekt och som därför ska nå rad 1
// respektive rad 4. [] och [1] står med därför att isPlainObject avvisar en
// array, till skillnad från ett handskrivet typeof x === 'object'
// (LARDOMAR.md 2026-09-02). -0, NaN, 1n och Symbol('x') står med därför att de
// är de värden som kastar eller tvingas fram i aritmetik och interpolation
// (LARDOMAR.md 2026-08-24 och 2026-09-02). new Date() står INTE här: ägaren
// isPlainObject godkänner ett Date, så värdet når nästa rad i tabellen, och det
// har egna testfall.
const ICKE_OBJEKT = [null, undefined, 'abc', '', 42, 0, -0, NaN, true, [], [1], 1n, Symbol('x')];

// Varje värde som inte är en lista och som därför ska nå rad 2, 3, 5 och 6.
const ICKE_LISTOR = [null, undefined, 'abc', '', 42, -0, NaN, true, {}, { length: 1, 0: 1 }, new Date(), 1n, Symbol('x')];

// Etikett för ett värde i ett assertionsmeddelande. String() och inte en
// interpolation: `${Symbol('x')}` kastar TypeError.
const namn = (value) => (Array.isArray(value) ? `[${String(value)}]` : String(value));

const TEXTER = Object.freeze({
  rad1: 'reportCsvRows kräver en rapport som objekt.',
  rad2: 'reportCsvRows kräver en lista med månader.',
  rad3: 'reportCsvRows kräver en lista med rader.',
  rad4: (i) => `reportCsvRows kräver ett objekt per rad, index ${i}.`,
  rad5: (i) => `reportCsvRows kräver ett belopp per månad, index ${i}.`,
  rad6: (i) => `reportCsvRows kräver ett tak per månad, index ${i}.`
});

function kastar(fn, message, etikett) {
  assert.throws(fn, (error) => error instanceof RangeError && error.message === message, etikett);
}

// Läser en CSV-fil från toCsv tillbaka till rader av fältsträngar. Filen i de
// här testfallen har ingen cell som kräver citering — ingen svensk etikett och
// ingen månad bär semikolon, citattecken eller radbrott — så en delning räcker.
// Att det stämmer prövas, inte antas: ett citattecken i filen fäller testet.
function läsTillbaka(fil) {
  assert.equal(fil.startsWith(BOM), true, 'filen börjar inte med BOM');
  assert.equal(fil.includes('"'), false, 'filen innehåller en citerad cell, och delningen nedan räcker då inte');
  const kropp = fil.slice(BOM.length);
  assert.equal(kropp.endsWith(CRLF), true, 'filen slutar inte med CR LF');
  return kropp.slice(0, -CRLF.length).split(CRLF).map((rad) => rad.split(';'));
}

// ---------------------------------------------------------------------------
// Spärrtabellen "Ingångsspärrar i src/core/report-csv.js", rad för rad.
// ---------------------------------------------------------------------------

test('rad 1: en rapport som inte är ett vanligt objekt ger rad 1:s text', () => {
  for (const value of ICKE_OBJEKT) {
    kastar(() => reportCsvRows(value), TEXTER.rad1, namn(value));
  }
});

test('rad 1: utan argument ger rad 1:s text', () => {
  kastar(() => reportCsvRows(), TEXTER.rad1);
});

test('rad 1 släpper igenom ett Date, som då når rad 2', () => {
  // isPlainObject i entry.js äger begreppet och godkänner ett Date. Ett Date har
  // ingen months, så värdet fälls av nästa rad — aldrig av ett TypeError.
  kastar(() => reportCsvRows(new Date()), TEXTER.rad2);
});

test('rad 2: months som inte är en lista ger rad 2:s text', () => {
  for (const value of ICKE_LISTOR) {
    kastar(() => reportCsvRows({ months: value, rows: [] }), TEXTER.rad2, namn(value));
  }
  kastar(() => reportCsvRows({ rows: [] }), TEXTER.rad2, 'months saknas');
});

test('rad 2 vinner över rad 3 när båda är fel', () => {
  kastar(() => reportCsvRows({ months: 'abc', rows: 'abc' }), TEXTER.rad2);
  kastar(() => reportCsvRows({}), TEXTER.rad2);
});

test('rad 3: rows som inte är en lista ger rad 3:s text', () => {
  for (const value of ICKE_LISTOR) {
    kastar(() => reportCsvRows({ months: ['2026-01'], rows: value }), TEXTER.rad3, namn(value));
  }
  kastar(() => reportCsvRows({ months: ['2026-01'] }), TEXTER.rad3, 'rows saknas');
});

test('rad 4: en rad som inte är ett vanligt objekt ger rad 4:s text med radens index', () => {
  for (const value of ICKE_OBJEKT) {
    kastar(() => reportCsvRows(rapport(['2026-01'], [value])), TEXTER.rad4(0), namn(value));
    kastar(
      () => reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [1]), value])),
      TEXTER.rad4(1),
      `index 1: ${namn(value)}`
    );
  }
});

test('rad 4 släpper igenom ett Date, som då når rad 5', () => {
  kastar(() => reportCsvRows(rapport(['2026-01'], [new Date()])), TEXTER.rad5(0));
});

test('rad 4 vinner över rad 5 också när rad 5:s fel står på ett tidigare index', () => {
  // Den körda konsekvensen i modulens egen kommentar: tabellen säger "första
  // träff vinner" om RADERNA, och en varvad loop hade svarat med rad 5 om index 0.
  kastar(
    () => reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [], [null]), null])),
    TEXTER.rad4(1)
  );
});

test('rad 5: perMonthOre med fel längd ger rad 5:s text med radens index', () => {
  const månader = ['2026-01', '2026-02'];
  for (const perMonthOre of [[], [1], [1, 2, 3]]) {
    kastar(
      () => reportCsvRows(rapport(månader, [rad('expense', 'housing', perMonthOre, [null, null])])),
      TEXTER.rad5(0),
      `längd ${perMonthOre.length}`
    );
    kastar(
      () => reportCsvRows(rapport(månader, [
        rad('expense', 'housing', [1, 2]),
        rad('expense', 'loan', perMonthOre, [null, null])
      ])),
      TEXTER.rad5(1),
      `index 1, längd ${perMonthOre.length}`
    );
  }
});

test('rad 5: perMonthOre som inte är en lista ger rad 5:s text och aldrig ett TypeError', () => {
  // Array.isArray före längden: undefined.length kastar TypeError, och ett objekt
  // med en length som råkar stämma hade annars passerat.
  for (const value of ICKE_LISTOR) {
    kastar(
      () => reportCsvRows(rapport(['2026-01'], [{ kind: 'expense', category: 'housing', perMonthOre: value, budgetPerMonthOre: [null] }])),
      TEXTER.rad5(0),
      namn(value)
    );
  }
  kastar(
    () => reportCsvRows(rapport(['2026-01'], [{ kind: 'expense', category: 'housing', budgetPerMonthOre: [null] }])),
    TEXTER.rad5(0),
    'perMonthOre saknas'
  );
});

test('rad 6: budgetPerMonthOre med fel längd ger rad 6:s text med radens index', () => {
  const månader = ['2026-01', '2026-02'];
  for (const budgetPerMonthOre of [[], [null], [null, null, null]]) {
    kastar(
      () => reportCsvRows(rapport(månader, [rad('expense', 'housing', [1, 2], budgetPerMonthOre)])),
      TEXTER.rad6(0),
      `längd ${budgetPerMonthOre.length}`
    );
    kastar(
      () => reportCsvRows(rapport(månader, [
        rad('expense', 'housing', [1, 2]),
        rad('expense', 'loan', [1, 2], budgetPerMonthOre)
      ])),
      TEXTER.rad6(1),
      `index 1, längd ${budgetPerMonthOre.length}`
    );
  }
});

test('rad 6: budgetPerMonthOre som inte är en lista ger rad 6:s text och aldrig ett TypeError', () => {
  for (const value of ICKE_LISTOR) {
    kastar(
      () => reportCsvRows(rapport(['2026-01'], [{ kind: 'expense', category: 'housing', perMonthOre: [1], budgetPerMonthOre: value }])),
      TEXTER.rad6(0),
      namn(value)
    );
  }
  kastar(
    () => reportCsvRows(rapport(['2026-01'], [{ kind: 'expense', category: 'housing', perMonthOre: [1] }])),
    TEXTER.rad6(0),
    'budgetPerMonthOre saknas'
  );
});

test('rad 5 vinner över rad 6 också när rad 6:s fel står på ett tidigare index', () => {
  kastar(
    () => reportCsvRows(rapport(['2026-01'], [
      rad('expense', 'housing', [1], []),
      rad('expense', 'loan', [], [null])
    ])),
    TEXTER.rad5(1)
  );
});

// ---------------------------------------------------------------------------
// Kravlistan (RA24) till (RA30).
// ---------------------------------------------------------------------------

test('(RA24) rubrikraden är sex textceller i ordningen Slag, Kategori, Månad, Belopp, Tak, Över tak', () => {
  const rader = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [100])]));
  assert.deepEqual(rader[0], RUBRIK.map((text) => ({ text })));
  // Sex kolumner, alltid sex: också varje datarad.
  for (const rad of rader) {
    assert.equal(rad.length, 6);
  }
});

test('(RA24) rubrikraden står ordagrant först i filen', () => {
  const fil = toCsv(reportCsvRows(rapport(['2026-01'], [])));
  assert.equal(fil, `${BOM}Slag;Kategori;Månad;Belopp;Tak;Över tak${CRLF}`);
});

test('(RA24) rubrikraden är en ny lista vid varje anrop, och en ändring i ett svar smittar inte nästa', () => {
  const första = reportCsvRows(rapport(['2026-01'], []));
  första[0][0].text = 'ÄNDRAD';
  första[0].push({ text: 'extra' });
  const andra = reportCsvRows(rapport(['2026-01'], []));
  assert.deepEqual(andra[0], RUBRIK.map((text) => ({ text })));
});

test('(RA25) tre månader och två rader ger sex datarader, rad för rad och månad för månad', () => {
  const månader = ['2026-01', '2026-02', '2026-03'];
  const rader = reportCsvRows(rapport(månader, [
    rad('income', 'other', [10, 20, 30]),
    rad('expense', 'housing', [40, 50, 60], [100, null, 45])
  ]));
  assert.equal(rader.length, 7);
  assert.deepEqual(rader.slice(1), [
    [{ text: 'Inkomst' }, { text: 'Övrigt' }, { text: '2026-01' }, { amountOre: 10 }, { text: '' }, { text: '' }],
    [{ text: 'Inkomst' }, { text: 'Övrigt' }, { text: '2026-02' }, { amountOre: 20 }, { text: '' }, { text: '' }],
    [{ text: 'Inkomst' }, { text: 'Övrigt' }, { text: '2026-03' }, { amountOre: 30 }, { text: '' }, { text: '' }],
    [{ text: 'Utgift' }, { text: 'Boende' }, { text: '2026-01' }, { amountOre: 40 }, { amountOre: 100 }, { text: 'Nej' }],
    [{ text: 'Utgift' }, { text: 'Boende' }, { text: '2026-02' }, { amountOre: 50 }, { text: '' }, { text: '' }],
    [{ text: 'Utgift' }, { text: 'Boende' }, { text: '2026-03' }, { amountOre: 60 }, { amountOre: 45 }, { text: 'Ja' }]
  ]);
});

test('(RA25) månaden skrivs som ÅÅÅÅ-MM ur months, aldrig som ett månadsnamn', () => {
  const månader = ['2025-11', '2025-12', '2026-01'];
  const rader = reportCsvRows(rapport(månader, [rad('saving', 'loan', [1, 2, 3])]));
  assert.deepEqual(rader.slice(1).map((r) => r[2]), månader.map((text) => ({ text })));
});

test('(RA26) ett saknat tak ger en tom textcell och aldrig ett belopp på noll', () => {
  const rader = reportCsvRows(rapport(['2026-01', '2026-02'], [rad('expense', 'housing', [0, 500], [null, null])]));
  for (const r of rader.slice(1)) {
    assert.deepEqual(r[4], { text: '' });
    assert.notDeepEqual(r[4], { amountOre: 0 });
  }
  // I filen blir det två tomma fält sist på raden, inte 0,00.
  const fil = läsTillbaka(toCsv(rader));
  assert.deepEqual(fil[1], ['Utgift', 'Boende', '2026-01', '0,00', '', '']);
  assert.deepEqual(fil[2], ['Utgift', 'Boende', '2026-02', '5,00', '', '']);
});

test('(RA26) ett tak på noll kronor är ett tak och skrivs som ett belopp, inte som en tom cell', () => {
  // Jämförelsen i modulen är === null och inte en sanningsprövning: 0 ören är
  // något annat än inget tak.
  const rader = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [0], [0])]));
  assert.deepEqual(rader[1][4], { amountOre: 0 });
  assert.deepEqual(rader[1][5], { text: 'Nej' });
});

test('(RA27) Över tak är Ja strikt över taket och Nej på och under det, prövat på båda sidor om gränsen', () => {
  const tak = 50000;
  const rader = reportCsvRows(rapport(['2026-01', '2026-02', '2026-03'], [
    rad('expense', 'housing', [tak + 1, tak, tak - 1], [tak, tak, tak])
  ]));
  assert.deepEqual(rader.slice(1).map((r) => r[5]), [{ text: 'Ja' }, { text: 'Nej' }, { text: 'Nej' }]);
});

test('(RA27) Över tak är tom när taket är null, också när beloppet är stort', () => {
  const rader = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [999999999], [null])]));
  assert.deepEqual(rader[1][5], { text: '' });
});

test('(RA27) Ja, Nej och tom är de enda tre värdena i kolumnen', () => {
  const rader = reportCsvRows(rapport(['2026-01', '2026-02', '2026-03'], [
    rad('expense', 'housing', [2, 1, 0], [1, 1, null]),
    rad('income', 'other', [5, 5, 5])
  ]));
  for (const r of rader.slice(1)) {
    assert.equal(['Ja', 'Nej', ''].includes(r[5].text), true, JSON.stringify(r[5]));
  }
});

test('(RA28) slagets och kategorins svenska namn kommer ur ITEM_KIND_LABELS och CATEGORY_LABELS', () => {
  // Varje slag med varje kategori, så att varje nyckel slås upp minst en gång.
  const rows = [];
  for (const kind of ITEM_KINDS) {
    for (const category of CATEGORIES) {
      rows.push(rad(kind, category, [1]));
    }
  }
  const rader = reportCsvRows(rapport(['2026-01'], rows));
  assert.equal(rader.length, 1 + ITEM_KINDS.length * CATEGORIES.length);
  for (const [index, r] of rader.slice(1).entries()) {
    assert.deepEqual(r[0], { text: ITEM_KIND_LABELS[rows[index].kind] });
    assert.deepEqual(r[1], { text: CATEGORY_LABELS[rows[index].category] });
  }
});

test('(RA28) användaren ser aldrig nycklarna, bara de svenska namnen', () => {
  const rader = reportCsvRows(rapport(['2026-01'], [rad('saving', 'subscription', [1])]));
  assert.deepEqual(rader[1].slice(0, 2), [{ text: 'Sparande' }, { text: 'Prenumeration' }]);
});

test('(RA29) en tom rapport ger bara rubrikraden och kastar inte', () => {
  assert.deepEqual(reportCsvRows(rapport(['2026-01'], [])), [RUBRIK.map((text) => ({ text }))]);
  assert.deepEqual(reportCsvRows(rapport(['2026-01', '2026-02', '2026-03'], [])), [RUBRIK.map((text) => ({ text }))]);
});

test('(RA29) tom rapport direkt ur reportRows ger bara rubrikraden', () => {
  const tom = reportRows([{ month: '2026-01', items: [], budgets: [] }]);
  assert.deepEqual(tom.rows, []);
  assert.deepEqual(reportCsvRows(tom), [RUBRIK.map((text) => ({ text }))]);
});

test('(RA30) rundgång genom toCsv: varje beloppscell i filen läses tillbaka till samma antal ören', () => {
  // Rapporten kommer ur reportRows, så att filen är den servern skriver och inte
  // en handbyggd variant. -0 som tak normaliseras av reportRows; -0 som
  // perMonthOre kan inte komma därifrån och prövas i fallet nedan.
  const report = reportRows([
    {
      month: '2026-01',
      items: [
        { kind: 'expense', category: 'housing', amountOre: 1234550 },
        { kind: 'income', category: 'other', amountOre: 1 }
      ],
      budgets: [{ category: 'housing', amountOre: 1234549, spentOre: 1234550, leftOre: -1 }]
    },
    {
      month: '2026-02',
      items: [{ kind: 'expense', category: 'housing', amountOre: 99 }],
      budgets: [{ category: 'housing', amountOre: 999999999, spentOre: 99, leftOre: 999999900 }]
    },
    { month: '2026-03', items: [{ kind: 'saving', category: 'loan', amountOre: 100 }], budgets: [] }
  ]);
  const celler = reportCsvRows(report);
  const fil = läsTillbaka(toCsv(celler));
  assert.deepEqual(fil[0], RUBRIK);
  assert.equal(fil.length, celler.length);

  let belopp = 0;
  for (let r = 1; r < celler.length; r += 1) {
    for (const kolumn of [3, 4]) {
      const cell = celler[r][kolumn];
      const fält = fil[r][kolumn];
      if (!Object.hasOwn(cell, 'amountOre')) {
        assert.equal(fält, '', `rad ${r} kolumn ${kolumn}`);
        continue;
      }
      belopp += 1;
      // Beloppskedjans steg 1: formatägaren AMOUNT_PATTERN, därefter samma
      // tolkning som entry.js och sekToOre. Samma ingång och samma skäl som
      // (RA7) i tests/csv.test.js: frågan är om FORMATET går att läsa tillbaka.
      assert.equal(AMOUNT_PATTERN.test(fält), true, `${fält} underkänns av AMOUNT_PATTERN`);
      const tillbaka = sekToOre(Number(fält.replace(',', '.')));
      assert.equal(tillbaka === cell.amountOre, true, `${fält} lästes tillbaka som ${tillbaka}, väntat ${cell.amountOre}`);
      assert.equal(Object.is(tillbaka, -0), false, `${fält} lästes tillbaka som -0`);
    }
  }
  // Tre rader gånger tre månader ger nio belopp, plus de två månader där
  // boendet har ett tak.
  assert.equal(belopp, 11);
});

test('(RA30) -0 och noll i en beloppscell skrivs 0,00 och läses tillbaka som noll', () => {
  const fil = läsTillbaka(toCsv(reportCsvRows(rapport(['2026-01', '2026-02'], [
    rad('expense', 'housing', [-0, 0], [-0, null])
  ]))));
  assert.deepEqual(fil[1].slice(3), ['0,00', '0,00', 'Nej']);
  assert.deepEqual(fil[2].slice(3), ['0,00', '', '']);
  for (const fält of [fil[1][3], fil[1][4], fil[2][3]]) {
    assert.equal(Object.is(sekToOre(Number(fält.replace(',', '.'))), -0), false, fält);
  }
});

test('(RA30) ett belopp som inte är ett öretal släpps vidare och fälls av csvAmountSek, formatets ägare', () => {
  // reportCsvRows prövar inte beloppen: spärrtabellen har sex rader och ingen för
  // värdena, och csvAmountSek i csv.js äger frågan "är det här ett antal ören".
  // Det som prövas är att ett skadat tal aldrig blir en tyst cell i filen.
  for (const value of [NaN, Infinity, 1.5, '100', null, undefined, 1n, Symbol('x'), [], [1], new Date()]) {
    const celler = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [value], [null])]));
    assert.throws(
      () => toCsv(celler),
      (error) => error instanceof RangeError && error.message === 'csvAmountSek kräver ett säkert heltal öre.',
      namn(value)
    );
  }
});

test('(RA34) ett skadat tak släpps vidare och fälls av csvAmountSek, aldrig som en tyst tom cell', () => {
  // Villkoret i modulen är === null och inte == null: bara null betyder "inget
  // tak". Ett undefined eller ett NaN i budgetPerMonthOre är ett skadat tal och
  // ska nå csvAmountSek, formatets ägare, och fällas där. Med == null hade
  // undefined blivit en tom cell i kolumnen Tak och en tom cell i Över tak, och
  // filen hade påstått att månaden saknade tak (LARDOMAR.md 2026-10-10, tre
  // delvillkor).
  for (const value of [undefined, NaN]) {
    const celler = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [100], [value])]));
    // Kolumnen Tak bär värdet som ett belopp, och kolumnen Över tak är inte tom.
    assert.equal(Object.hasOwn(celler[1][4], 'amountOre'), true, namn(value));
    assert.notDeepEqual(celler[1][5], { text: '' }, namn(value));
    assert.throws(
      () => toCsv(celler),
      (error) => error instanceof RangeError && error.message === 'csvAmountSek kräver ett säkert heltal öre.',
      namn(value)
    );
  }
});

test('(RA34) bara null i budgetPerMonthOre ger två tomma celler', () => {
  const celler = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [100], [null])]));
  assert.deepEqual(celler[1].slice(4), [{ text: '' }, { text: '' }]);
});

// (RA36) reportFileName och spärrtabellens rad 7.
test('(RA36) reportFileName ger hemochekonomi-<ÅÅÅÅ-MM>.csv i rent ASCII', () => {
  for (const month of ['2026-10', '2027-01', '1999-12']) {
    const filnamn = reportFileName(month);
    assert.equal(filnamn, `hemochekonomi-${month}.csv`);
    for (const tecken of filnamn) {
      assert.equal(tecken.codePointAt(0) < 128, true, `${filnamn}: ${tecken}`);
    }
  }
});

test('(RA36) rad 7: en månad som inte är ÅÅÅÅ-MM ger rad 7:s text', () => {
  const värden = ['2026-13', '2026-1', '2026-10-01', '"2026-10"', '2026-10\r\n', '', undefined, null, 202610, -0, NaN, {}, [], ['2026-10'], new Date(), 1n, Symbol('x')];
  for (const value of värden) {
    kastar(() => reportFileName(value), 'reportFileName kräver en månad på formen ÅÅÅÅ-MM.', namn(value));
  }
  kastar(() => reportFileName(), 'reportFileName kräver en månad på formen ÅÅÅÅ-MM.', 'utan argument');
});
