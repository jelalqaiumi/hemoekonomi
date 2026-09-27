import { test } from 'node:test';
import assert from 'node:assert/strict';

import { monthTotals, sumByKind } from '../src/core/budget.js';
import { ITEM_KINDS } from '../src/core/item.js';

// Hjälpare: en post i en månad. Bara kind och amountOre påverkar summorna;
// övriga fält finns för att posterna ska vara riktiga poster.
function item(kind, amountOre, id = 'i1') {
  return { id, kind, name: 'Post', amountOre, category: 'other' };
}

// De fem texterna ur spärrtabellen i ARKITEKTUR.md, skrivna som de står där.
// Varje rad har ett eget testfall under (B5), och hela meddelandet asserteras:
// en assert.throws mot enbart RangeError kan inte skilja en spärr från en annan
// spärr längre ner i kedjan (LARDOMAR.md 2026-09-16).
const NOT_A_LIST = 'monthTotals kräver en lista med poster.';
const NOT_AN_OBJECT = 'monthTotals kräver poster som objekt.';
const BAD_AMOUNT = 'monthTotals kräver ett belopp i heltal ören.';
const UNSAFE_SUM = 'monthTotals kräver att summan är ett säkert heltal.';
const unknownKind = (value) => `monthTotals kräver ett känt slag, fick "${value}".`;

const MAX = Number.MAX_SAFE_INTEGER;

// (B1) kvar att leva på räknas rätt.
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

// (B1) fortsättning: varje summa tar bara sitt eget slag. Fälls av att raden
// som hoppar över poster av ett annat slag tas bort ur sumByKind.
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

// (B2) negativt kvar visas som negativt.
test('utgifter och sparande över inkomsten ger negativt leftOre, inget fel', () => {
  const totals = monthTotals([
    item('income', 2000000, 'lon'),
    item('expense', 1900000, 'hyra'),
    item('saving', 500000, 'buffert')
  ]);
  assert.equal(totals.leftOre, -400000);
  assert.equal(totals.leftOre < 0, true);
});

// (B2) fortsättning: ett negativt belopp i en post är tillåtet. Rad 4 kräver ett
// säkert heltal och ingenting om tecknet, och ingen spärr mot negativa summor
// finns. Fallet är dessutom förutsättningen för att rad 5 ska kunna slå inuti
// loopen: utan negativa belopp växer delsummorna monotont.
test('ett negativt amountOre är tillåtet och dras från summan', () => {
  assert.equal(sumByKind([item('income', 5000, 'a'), item('income', -2000, 'b')], 'income'), 3000);
});

// (B3) tom lista ger nollor.
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

// (B4) leftOre är aldrig -0. Asserteras med Object.is och aldrig med
// assert.equal(leftOre, 0), som är sant också för -0.
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

// (B5) rad 1: items är inte en array.
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

// (B5) rad 2: en post är inte ett objekt. Listan innehåller [], [1] och
// new Date(), inte bara primitiver och null: ägarfunktionen isPlainObject i
// entry.js avvisar en array, och en handskriven kopia gjorde det inte
// (LARDOMAR.md 2026-09-02).
test('rad 2: en post som inte är ett objekt ger objektmeddelandet', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(
      () => monthTotals([value]),
      { name: 'RangeError', message: NOT_AN_OBJECT },
      `posten ${String(value)}`
    );
  }
  assert.throws(() => monthTotals([[1]]), { name: 'RangeError', message: NOT_AN_OBJECT });
  // Ett Date är däremot ett objekt enligt ägaren: isPlainObject i entry.js
  // avvisar null och en array, ingenting annat. Körd: posten faller därför på
  // rad 3, eftersom ett Date inte har något kind. Raden står här för att facit
  // ska vara utskrivet och inte gissat — budget.js får inte skriva en andra,
  // strängare kopia av villkoret.
  assert.throws(() => monthTotals([new Date()]), { name: 'RangeError', message: unknownKind('undefined') });
});

// (B5) rad 3: kind är inte ett känt slag. Prototypnycklarna står med, av samma
// skäl som i tests/schedule.test.js: ett sanningsprövat uppslag i ett objekt
// hade hittat något på prototypen.
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

// (B5) rad 3, andra vägen in: kind-argumentet till sumByKind. Utan spärren
// svarar sumByKind(items, 'gift') med 0, alltså ett tyst fel.
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

// (B5) rad 4: amountOre är inte ett säkert heltal. 1n och Symbol('x') står med
// för att Number.isSafeInteger inte coercar: en aritmetik på ett ovaliderat
// värde hade kastat TypeError där varje annan typ tvingas till NaN
// (LARDOMAR.md 2026-08-24).
test('rad 4: ett amountOre som inte är ett säkert heltal ger beloppsmeddelandet', () => {
  const värden = [1.5, NaN, Infinity, -Infinity, '1000', null, undefined, true, 1n, Symbol('x'), 1e300, MAX + 2, {}];
  for (const amountOre of värden) {
    assert.throws(
      () => monthTotals([item('income', amountOre)]),
      { name: 'RangeError', message: BAD_AMOUNT },
      `amountOre ${String(amountOre)}`
    );
  }
  // -0 är noll skrivet med tecken och ett säkert heltal: rad 4 släpper igenom
  // det, och normaliseringen i money.js äger frågan om tecknet.
  assert.equal(sumByKind([item('income', -0)], 'income'), 0);
});

// (B5) radernas ordning: tabellen säger att första träff vinner om raderna, inte
// om posternas plats i listan. Fälls av att de tre varven i checkItems slås
// samman till ett: då svarar listan nedan med rad 4 i stället för rad 2.
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

// (B6) summan i heltal: rad 5 inuti loopen.
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

// (B6) fortsättning: spärrens placering inuti loopen är det som ändrar svaret,
// och fallet är det där placeringen syns. Med kontrollen efter loopen ger listan
// nedan 9007199254740991 och inget fel, eftersom delsumman 18014398509481982
// hinner tillbaka in i området innan loopen är slut. Ett negativt belopp är
// tillåtet, så delsummorna växer inte monotont — det är skillnaden mot
// totalYearlyOre i cost.js, där kontrollen står efter loopen.
test('rad 5 prövas efter varje addition, inte bara på slutsumman', () => {
  assert.throws(
    () => sumByKind([item('income', MAX, 'a'), item('income', MAX, 'b'), item('income', -MAX, 'c')], 'income'),
    { name: 'RangeError', message: UNSAFE_SUM }
  );
});

// (B6) fortsättning: rad 5 gäller också leftOre, som är en summa. De två leden
// har var sitt testfall, och varje fall är valt så att bara det ena ledet slår:
// tas kontrollen efter det första ledet bort passerar listan i det första fallet
// tyst med leftOre 9007199254740991.
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

// Kopplingen mellan de tre summorna i monthTotals och ITEM_KINDS i item.js.
// Samma sorts prov som tests/cost.test.js har för PAYMENTS_PER_YEAR mot
// INTERVALS: två listor som beskriver samma domän glider isär, och mutationen
// "lägg till ett värde i ITEM_KINDS" ska fälla just det här testet.
test('monthTotals ger ett fält per slag i ITEM_KINDS, plus leftOre', () => {
  assert.deepEqual(Object.keys(monthTotals([])), [...ITEM_KINDS.map((kind) => `${kind}Ore`), 'leftOre']);
});
