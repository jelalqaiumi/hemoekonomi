import assert from 'node:assert/strict';
import test from 'node:test';

import { AMOUNT_PATTERN, CATEGORIES, CATEGORY_LABELS } from '../src/core/entry.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '../src/core/item.js';
import { sekToOre } from '../src/core/money.js';
import { toCsv } from '../src/core/csv.js';
import { reportRows } from '../src/core/report.js';
import { reportCsvRows, reportFileName } from '../src/core/report-csv.js';

const BOM = '\uFEFF';
const CRLF = '\r\n';

const RUBRIK = ['Slag', 'Kategori', 'Månad', 'Belopp', 'Tak', 'Över tak'];

function rad(kind, category, perMonthOre, budgetPerMonthOre = perMonthOre.map(() => null)) {
  return { kind, category, perMonthOre, totalOre: 0, averageOre: 0, budgetPerMonthOre, overBudgetMonths: 0 };
}

function rapport(months, rows) {
  return { months, rows, largest: null };
}

const ICKE_OBJEKT = [null, undefined, 'abc', '', 42, 0, -0, NaN, true, [], [1], 1n, Symbol('x')];

const ICKE_LISTOR = [null, undefined, 'abc', '', 42, -0, NaN, true, {}, { length: 1, 0: 1 }, new Date(), 1n, Symbol('x')];

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

function läsTillbaka(fil) {
  assert.equal(fil.startsWith(BOM), true, 'filen börjar inte med BOM');
  assert.equal(fil.includes('"'), false, 'filen innehåller en citerad cell, och delningen nedan räcker då inte');
  const kropp = fil.slice(BOM.length);
  assert.equal(kropp.endsWith(CRLF), true, 'filen slutar inte med CR LF');
  return kropp.slice(0, -CRLF.length).split(CRLF).map((rad) => rad.split(';'));
}

test('rad 1: en rapport som inte är ett vanligt objekt ger rad 1:s text', () => {
  for (const value of ICKE_OBJEKT) {
    kastar(() => reportCsvRows(value), TEXTER.rad1, namn(value));
  }
});

test('rad 1: utan argument ger rad 1:s text', () => {
  kastar(() => reportCsvRows(), TEXTER.rad1);
});

test('rad 1 släpper igenom ett Date, som då når rad 2', () => {
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

test('(RA24) rubrikraden är sex textceller i ordningen Slag, Kategori, Månad, Belopp, Tak, Över tak', () => {
  const rader = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [100])]));
  assert.deepEqual(rader[0], RUBRIK.map((text) => ({ text })));
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
  const fil = läsTillbaka(toCsv(rader));
  assert.deepEqual(fil[1], ['Utgift', 'Boende', '2026-01', '0,00', '', '']);
  assert.deepEqual(fil[2], ['Utgift', 'Boende', '2026-02', '5,00', '', '']);
});

test('(RA26) ett tak på noll kronor är ett tak och skrivs som ett belopp, inte som en tom cell', () => {
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
      assert.equal(AMOUNT_PATTERN.test(fält), true, `${fält} underkänns av AMOUNT_PATTERN`);
      const tillbaka = sekToOre(Number(fält.replace(',', '.')));
      assert.equal(tillbaka === cell.amountOre, true, `${fält} lästes tillbaka som ${tillbaka}, väntat ${cell.amountOre}`);
      assert.equal(Object.is(tillbaka, -0), false, `${fält} lästes tillbaka som -0`);
    }
  }
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
  for (const value of [undefined, NaN]) {
    const celler = reportCsvRows(rapport(['2026-01'], [rad('expense', 'housing', [100], [value])]));
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
