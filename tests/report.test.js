import assert from 'node:assert/strict';
import test from 'node:test';

import { CATEGORIES } from '../src/core/entry.js';
import { ITEM_KINDS } from '../src/core/item.js';
import { reportRows } from '../src/core/report.js';

const post = (kind, category, amountOre) => ({ kind, category, amountOre });

const månad = (month, items = [], budgets = []) => ({ month, items, budgets });

const tak = (category, amountOre) => ({ category, amountOre, spentOre: 0, leftOre: amountOre });

const ICKE_LISTOR = [null, undefined, 'abc', '', 42, 0, true, {}, { 0: månad('2026-01') }, new Date(), 1n, Symbol('x')];

const ICKE_OBJEKT = [null, undefined, 'abc', 42, 0, true, [], [1], 1n, Symbol('x')];

const ICKE_LISTOR_I_MÅNAD = [null, undefined, 'abc', 42, true, {}, new Date(), 1n, Symbol('x')];

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

test('spärrtabellen rad 2: en tom lista kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([]),
    { name: 'RangeError', message: 'reportRows kräver minst en månad.' }
  );
});

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
  assert.throws(
    () => reportRows([new Date()]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 0.' }
  );
});

test('spärrtabellen rad 4: en månad som inte är en månad kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('januari')]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 0.' }
  );
});

test('spärrtabellen rad 4: formen räcker inte, månadsnumret prövas också', () => {
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
  const svar = reportRows([månad('2025-11'), månad('2026-02'), månad('2027-01')]);
  assert.deepEqual(svar.months, ['2025-11', '2026-02', '2027-01']);
});

test('spärrtabellen rad 8: en budgetrad som inte är ett objekt kastar med hela meddelandet', () => {
  assert.throws(
    () => reportRows([månad('2026-01', [], [null])]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 0 rad 0.' }
  );
});

test('spärrtabellen rad 8: varje värde som inte är ett vanligt objekt ger samma meddelande', () => {
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
  const svar = reportRows([månad('2026-01', [], [{ category: 'housing', amountOre: -0 }])]);
  const värdet = svar.rows[0].budgetPerMonthOre[0];
  assert.equal(Number.isSafeInteger(-0), true, 'rad 9 skulle släppa igenom -0');
  assert.equal(Object.is(värdet, -0), false, 'budgetPerMonthOre bar -0');
  assert.equal(Object.is(värdet, 0), true);
});

test('ett tak på 0 ören är ett tal och passerar rad 9', () => {
  const svar = reportRows([månad('2026-01', [], [tak('housing', 0)])]);
  assert.deepEqual(svar.rows.map((rad) => `${rad.kind}/${rad.category}`), ['expense/housing']);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [0]);
  assert.equal(svar.rows[0].overBudgetMonths, 0);
});

test('spärrtabellens ordning är radernas och inte elementens: rad 4 vinner över rad 5', () => {
  assert.throws(
    () => reportRows([{ month: '2026-01', budgets: [] }, { month: 'januari', items: [], budgets: [] }]),
    { name: 'RangeError', message: 'reportRows kräver en månad på formen ÅÅÅÅ-MM, index 1.' }
  );
});

test('rad 8 vinner över rad 9, också när rad 9:s träff står i en tidigare månad', () => {
  assert.throws(
    () => reportRows([
      månad('2026-01', [], [{ category: 'housing', amountOre: 'abc' }]),
      månad('2026-02', [], [null])
    ]),
    { name: 'RangeError', message: 'reportRows kräver ett objekt per budgetrad, index 1 rad 0.' }
  );
});

test('rad 7 vinner över rad 8, och rad 6 över rad 8', () => {
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
  const stor = (month) => månad(month, [post('expense', 'housing', 4e15)]);
  assert.equal(Number.isSafeInteger(4e15), true);
  assert.throws(
    () => reportRows([stor('2026-01'), stor('2026-02'), stor('2026-03')]),
    { name: 'RangeError', message: 'monthTotals kräver att summan är ett säkert heltal.' }
  );
});

test('(RA8) samma kategori med två slag ger två rader, i ITEM_KINDS ordning', () => {
  const svar = reportRows([
    månad('2026-01', [post('income', 'housing', 500000), post('expense', 'housing', 120000)]),
    månad('2026-02', [post('expense', 'housing', 30000)])
  ]);

  assert.equal(svar.rows.length, 2);
  assert.deepEqual(svar.rows.map((rad) => [rad.kind, rad.category]), [
    ['income', 'housing'],
    ['expense', 'housing']
  ]);

  assert.deepEqual(svar.rows[0].perMonthOre, [500000, 0]);
  assert.equal(svar.rows[0].totalOre, 500000);
  assert.equal(svar.rows[0].averageOre, 250000);
  assert.deepEqual(svar.rows[1].perMonthOre, [120000, 30000]);
  assert.equal(svar.rows[1].totalOre, 150000);
  assert.equal(svar.rows[1].averageOre, 75000);

  assert.deepEqual(Object.keys(svar), ['months', 'rows', 'largest']);
  assert.deepEqual(Object.keys(svar.rows[0]), [
    'kind', 'category', 'perMonthOre', 'totalOre', 'averageOre', 'budgetPerMonthOre', 'overBudgetMonths'
  ]);
  assert.deepEqual(Object.keys(svar.largest), ['kind', 'category']);

  assert.deepEqual(svar.months, ['2026-01', '2026-02']);
});

test('(RA8) radordningen är ITEM_KINDS ordning, därefter CATEGORIES ordning', () => {
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

  assert.equal(svar.rows[0].averageOre, 7000);
  assert.notEqual(svar.rows[0].averageOre, 21000, 'snittet delades med antalet månader som har ett belopp');

  assert.equal(svar.rows[0].perMonthOre.length, svar.months.length);
  assert.equal(svar.rows[0].budgetPerMonthOre.length, svar.months.length);
});

test('(RA10) ett snitt som inte delar jämnt avrundas med halva öret uppåt', () => {
  const månader = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const svar = reportRows(månader.map((month, i) => (
    i === 0 ? månad(month, [post('expense', 'subscription', 999)]) : månad(month)
  )));

  assert.equal(svar.rows[0].totalOre, 999);
  assert.equal(svar.rows[0].averageOre, 167);
  assert.notEqual(svar.rows[0].averageOre, 166, 'snittet trunkerades i stället för att avrundas uppåt');
  assert.equal(Number.isInteger(svar.rows[0].averageOre), true);
});

test('(RA11) en rad med tak men noll belopp kommer med, och en rad utan båda utesluts', () => {
  const svar = reportRows([månad('2026-01', [], [tak('housing', 700000)])]);

  assert.equal(svar.rows.length, 1);
  assert.equal(svar.rows[0].kind, 'expense');
  assert.equal(svar.rows[0].category, 'housing');
  assert.deepEqual(svar.rows[0].perMonthOre, [0]);
  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [700000]);

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

test('(RA12) budgetPerMonthOre följer taket per månad, med null för en månad utan tak', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'other', 50000)], [tak('other', 100000)]),
    månad('2026-02', [post('expense', 'other', 60000)], []),
    månad('2026-03', [post('expense', 'other', 70000)], [tak('other', 300000)])
  ]);

  assert.equal(svar.rows.length, 1);
  assert.deepEqual(svar.rows[0].perMonthOre, [50000, 60000, 70000]);
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

test('(RA13) budgetPerMonthOre är enbart null för income och saving, också när kategorin har ett tak', () => {
  const svar = reportRows([
    månad('2026-01', [post('income', 'housing', 410000), post('saving', 'housing', 230000)], [tak('housing', 550000)])
  ]);

  assert.deepEqual(svar.rows.map((rad) => `${rad.kind}/${rad.category}`), [
    'income/housing', 'expense/housing', 'saving/housing'
  ]);

  assert.deepEqual(svar.rows[0].budgetPerMonthOre, [null]);
  assert.deepEqual(svar.rows[1].budgetPerMonthOre, [550000]);
  assert.deepEqual(svar.rows[2].budgetPerMonthOre, [null]);

  assert.equal(svar.rows[0].overBudgetMonths, 0);
  assert.equal(svar.rows[2].overBudgetMonths, 0);

  const medTak = svar.rows.filter((rad) => rad.budgetPerMonthOre.some((ore) => ore !== null));
  assert.equal(medTak.length, 1);
  assert.equal(ITEM_KINDS.includes(medTak[0].kind), true);
  assert.equal(medTak[0].kind, 'expense');
});

test('(RA14) overBudgetMonths räknar månaden över taket men inte månaden lika med taket', () => {
  const serie = (januari) => [
    månad('2026-01', [post('expense', 'loan', januari)], [tak('loan', 400000)]),
    månad('2026-02', [post('expense', 'loan', 400001)], [tak('loan', 400000)]),
    månad('2026-03', [post('expense', 'loan', 399999)], [tak('loan', 400000)])
  ];

  const lika = reportRows(serie(400000));
  assert.deepEqual(lika.rows[0].perMonthOre, [400000, 400001, 399999]);
  assert.deepEqual(lika.rows[0].budgetPerMonthOre, [400000, 400000, 400000]);
  assert.equal(lika.rows[0].overBudgetMonths, 1);

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

test('(RA15) largest vid exakt lika totalOre är den tidigare i ITEM_KINDS ordning', () => {
  const svar = reportRows([
    månad('2026-01', [post('expense', 'transport', 77700), post('income', 'housing', 77700)]),
    månad('2026-02')
  ]);

  assert.equal(svar.rows.length, 2);
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
  assert.deepEqual(svar.largest, { kind: 'expense', category: 'loan' });
});

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
