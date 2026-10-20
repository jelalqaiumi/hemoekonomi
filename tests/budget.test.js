import { test } from 'node:test';
import assert from 'node:assert/strict';

import { monthTotals, sumByKind } from '../src/core/budget.js';
import { ITEM_KINDS } from '../src/core/item.js';

function item(kind, amountOre, id = 'i1') {
  return { id, kind, name: 'Post', amountOre, category: 'other' };
}

const NOT_A_LIST = 'monthTotals kräver en lista med poster.';
const NOT_AN_OBJECT = 'monthTotals kräver poster som objekt.';
const BAD_AMOUNT = 'monthTotals kräver ett belopp i heltal ören.';
const UNSAFE_SUM = 'monthTotals kräver att summan är ett säkert heltal.';
const unknownKind = (value) => `monthTotals kräver ett känt slag, fick "${value}".`;

const MAX = Number.MAX_SAFE_INTEGER;

test('inkomst 30000 kr, utgifter 18500 kr och sparande 5000 kr ger leftOre 650000', () => {
  const totals = monthTotals([
    item('income', 3000000, 'lon'),
    item('expense', 1850000, 'hyra'),
    item('saving', 500000, 'buffert')
  ]);
  assert.deepEqual(totals, {
    incomeOre: 3000000,
    expenseOre: 1850000,
    savingOre: 500000,
    leftOre: 650000
  });
});

test('sumByKind summerar bara posterna med det slaget', () => {
  const items = [
    item('income', 3000000, 'lon'),
    item('income', 100000, 'bidrag'),
    item('expense', 1850000, 'hyra'),
    item('saving', 500000, 'buffert')
  ];
  assert.equal(sumByKind(items, 'income'), 3100000);
  assert.equal(sumByKind(items, 'expense'), 1850000);
  assert.equal(sumByKind(items, 'saving'), 500000);
});

test('utgifter och sparande över inkomsten ger negativt leftOre, inget fel', () => {
  const totals = monthTotals([
    item('income', 2000000, 'lon'),
    item('expense', 1900000, 'hyra'),
    item('saving', 500000, 'buffert')
  ]);
  assert.equal(totals.leftOre, -400000);
  assert.equal(totals.leftOre < 0, true);
});

test('ett negativt amountOre är tillåtet och dras från summan', () => {
  assert.equal(sumByKind([item('income', 5000, 'a'), item('income', -2000, 'b')], 'income'), 3000);
});

test('en tom lista ger fyra nollor och ingen av dem är -0', () => {
  const totals = monthTotals([]);
  assert.deepEqual(totals, { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });
  for (const [field, value] of Object.entries(totals)) {
    assert.equal(Object.is(value, -0), false, `${field} är -0`);
  }
});

test('sumByKind ger 0 för en tom lista för varje slag', () => {
  for (const kind of ITEM_KINDS) {
    assert.equal(sumByKind([], kind), 0);
  }
});

test('leftOre är aldrig -0', () => {
  const fall = [
    [[], 'tom lista'],
    [[item('income', 0, 'noll')], 'en inkomst på 0'],
    [[item('income', 1000, 'a'), item('expense', 1000, 'b')], 'inkomst lika med utgift'],
    [[item('income', 1000, 'a'), item('expense', 600, 'b'), item('saving', 400, 'c')], 'allt uppäget'],
    [[item('income', -0, 'a'), item('expense', -0, 'b'), item('saving', -0, 'c')], 'tre belopp skrivna som -0']
  ];
  for (const [items, namn] of fall) {
    const { leftOre } = monthTotals(items);
    assert.equal(Object.is(leftOre, -0), false, `leftOre är -0 för ${namn}`);
  }
});

test('rad 1: items som inte är en array ger listmeddelandet', () => {
  for (const value of ['abc', null, undefined, 42, true, {}, new Map(), 1n, Symbol('x')]) {
    assert.throws(
      () => monthTotals(value),
      { name: 'RangeError', message: NOT_A_LIST },
      `monthTotals(${String(value)})`
    );
    assert.throws(() => sumByKind(value, 'income'), { name: 'RangeError', message: NOT_A_LIST });
  }
});

test('rad 2: en post som inte är ett objekt ger objektmeddelandet', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(
      () => monthTotals([value]),
      { name: 'RangeError', message: NOT_AN_OBJECT },
      `posten ${String(value)}`
    );
  }
  assert.throws(() => monthTotals([[1]]), { name: 'RangeError', message: NOT_AN_OBJECT });
  assert.throws(() => monthTotals([new Date()]), { name: 'RangeError', message: unknownKind('undefined') });
});

test('rad 3: ett okänt kind ger slagmeddelandet med värdet utskrivet', () => {
  for (const kind of ['gift', '', 'Income', 'INCOME', ' income', 'constructor', 'toString', '__proto__']) {
    assert.throws(
      () => monthTotals([item(kind, 1000)]),
      { name: 'RangeError', message: unknownKind(kind) },
      `kind "${kind}"`
    );
  }
  for (const [kind, text] of [[undefined, 'undefined'], [null, 'null'], [42, '42'], [1n, '1'], [Symbol('x'), 'Symbol(x)']]) {
    assert.throws(
      () => monthTotals([item(kind, 1000)]),
      { name: 'RangeError', message: unknownKind(text) },
      `kind ${String(kind)}`
    );
  }
});

test('rad 3: ett okänt kind-argument till sumByKind ger samma meddelande', () => {
  const items = [item('income', 1000)];
  for (const [kind, text] of [['gift', 'gift'], ['Income', 'Income'], [undefined, 'undefined'], [null, 'null'], [1n, '1'], [Symbol('x'), 'Symbol(x)']]) {
    assert.throws(
      () => sumByKind(items, kind),
      { name: 'RangeError', message: unknownKind(text) },
      `kind-argumentet ${String(kind)}`
    );
    assert.throws(() => sumByKind([], kind), { name: 'RangeError', message: unknownKind(text) });
  }
});

test('rad 4: ett amountOre som inte är ett säkert heltal ger beloppsmeddelandet', () => {
  const värden = [1.5, NaN, Infinity, -Infinity, '1000', null, undefined, true, 1n, Symbol('x'), 1e300, MAX + 2, {}];
  for (const amountOre of värden) {
    assert.throws(
      () => monthTotals([item('income', amountOre)]),
      { name: 'RangeError', message: BAD_AMOUNT },
      `amountOre ${String(amountOre)}`
    );
  }
  assert.equal(sumByKind([item('income', -0)], 'income'), 0);
});

test('rad 2 vinner över rad 4 även när den trasiga posten står sist', () => {
  assert.throws(
    () => monthTotals([item('expense', 1.5, 'a'), 'inte ett objekt']),
    { name: 'RangeError', message: NOT_AN_OBJECT }
  );
  assert.throws(
    () => monthTotals([item('expense', 1.5, 'a'), item('gift', 1000, 'b')]),
    { name: 'RangeError', message: unknownKind('gift') }
  );
});

test('rad 5: en delsumma som lämnar det säkra heltalsområdet ger summameddelandet', () => {
  assert.throws(
    () => sumByKind([item('income', MAX, 'a'), item('income', 1, 'b')], 'income'),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
  assert.throws(
    () => monthTotals([item('expense', MAX, 'a'), item('expense', MAX, 'b')]),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
});

test('rad 5 prövas efter varje addition, inte bara på slutsumman', () => {
  assert.throws(
    () => sumByKind([item('income', MAX, 'a'), item('income', MAX, 'b'), item('income', -MAX, 'c')], 'income'),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
});

test('rad 5 gäller leftOre: första ledet incomeOre - expenseOre', () => {
  assert.throws(
    () => monthTotals([item('income', MAX, 'a'), item('expense', -MAX, 'b'), item('saving', MAX, 'c')]),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
});

test('rad 5 gäller leftOre: andra ledet minus savingOre', () => {
  assert.throws(
    () => monthTotals([item('income', MAX, 'a'), item('saving', -MAX, 'b')]),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
});

test('monthTotals ger ett fält per slag i ITEM_KINDS, plus leftOre', () => {
  assert.deepEqual(Object.keys(monthTotals([])), [...ITEM_KINDS.map((kind) => `${kind}Ore`), 'leftOre']);
});
