import { test } from 'node:test';
import assert from 'node:assert/strict';

import { checkAmountSek } from '../src/core/entry.js';
import { ITEM_KINDS, isItemKind, validateMonthItemDraft } from '../src/core/item.js';

test('ITEM_KINDS är de tre slagen i tabellens ordning', () => {
  assert.deepEqual([...ITEM_KINDS], ['income', 'expense', 'saving']);
});

test('ITEM_KINDS är fryst', () => {
  assert.equal(Object.isFrozen(ITEM_KINDS), true);
  assert.throws(() => {
    ITEM_KINDS[0] = 'gift';
  }, TypeError);
  assert.throws(() => {
    ITEM_KINDS.push('gift');
  }, TypeError);
});

test('isItemKind är true för varje värde i ITEM_KINDS', () => {
  for (const kind of ITEM_KINDS) {
    assert.equal(isItemKind(kind), true, kind);
  }
});

// Versaler, blanktecken och prototypnycklar är inte slag. Prototypnycklarna står
// med därför att ett sanningsprövat uppslag i ett objekt hade hittat något på
// prototypen för dem (LARDOMAR.md 2026-09-16), och en lista har inte det
// problemet — testet är beviset för att svaret är false också här.
test('isItemKind är false för varje annat värde och kastar för ingen indata', () => {
  const värden = [
    'gift', '', ' income', 'income ', 'Income', 'INCOME',
    'constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf',
    null, undefined, 0, 1, -0, NaN, Infinity, true, false,
    {}, [], ['income'], new Date(), 1n, Symbol('x')
  ];
  for (const value of värden) {
    assert.equal(isItemKind(value), false, String(value));
  }
});

// Månadspostens validering, kravlistan (V1) till (V4) i ARKITEKTUR.md under
// "Månadspostens validering".

// Texten den här modulen äger. De tre övriga fälten prövas mot sina ägares
// texter, lästa ur entry.js-kedjan genom check-funktionerna.
const KIND_TEXT = 'Välj inkomst, utgift eller sparande.';

function draft(overrides = {}) {
  return { kind: 'expense', name: 'Tandläkare', amountSek: '950,50', category: 'other', ...overrides };
}

// (V1) ett giltigt utkast.
test('V1: ett giltigt utkast ger ok och amountOre i heltal ören', () => {
  const resultat = validateMonthItemDraft(draft());
  assert.deepEqual(resultat, {
    ok: true,
    value: { kind: 'expense', name: 'Tandläkare', amountOre: 95050, category: 'other' }
  });
  // Kronor finns inte kvar i svaret: fältet heter amountOre och amountSek är borta.
  assert.equal(Object.hasOwn(resultat.value, 'amountSek'), false);
  // Beloppet tas emot både som sträng och som tal, av samma ägare.
  assert.equal(validateMonthItemDraft(draft({ amountSek: 950.5 })).value.amountOre, 95050);
  assert.equal(validateMonthItemDraft(draft({ amountSek: '0,01' })).value.amountOre, 1);
  // Namnet trimmas av sin ägare, checkName.
  assert.equal(validateMonthItemDraft(draft({ name: '  Hyra  ' })).value.name, 'Hyra');
});

test('V1: varje slag i ITEM_KINDS godkänns', () => {
  for (const kind of ITEM_KINDS) {
    const resultat = validateMonthItemDraft(draft({ kind }));
    assert.equal(resultat.ok, true, kind);
    assert.equal(resultat.value.kind, kind);
  }
});

// (V2) ogiltigt kind.
test('V2: ett ogiltigt kind ger kind-texten ordagrant', () => {
  for (const kind of ['gift', '', 'Income', 'INCOME', ' expense', 'constructor', '__proto__', undefined, null, 42, 1n, Symbol('x'), {}, []]) {
    const resultat = validateMonthItemDraft(draft({ kind }));
    assert.equal(resultat.ok, false, String(kind));
    assert.deepEqual(resultat.errors, [{ field: 'kind', message: KIND_TEXT }], String(kind));
  }
  // Texten nämner aldrig de engelska nycklarna: användaren ser bara svenska ord.
  for (const nyckel of ITEM_KINDS) {
    assert.equal(KIND_TEXT.includes(nyckel), false, nyckel);
  }
});

// (V3) fyra fel samtidigt, i fältordningen kind, name, amountSek, category.
test('V3: fyra fel ger fyra poster i errors, i fältordningen', () => {
  const resultat = validateMonthItemDraft({ kind: 'gift', name: '', amountSek: 'abc', category: 'x' });
  assert.equal(resultat.ok, false);
  assert.equal(Object.hasOwn(resultat, 'value'), false);
  assert.deepEqual(resultat.errors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category']);
  assert.deepEqual(resultat.errors, [
    { field: 'kind', message: KIND_TEXT },
    { field: 'name', message: 'Namnet får inte vara tomt.' },
    { field: 'amountSek', message: 'Beloppet måste vara ett tal.' },
    { field: 'category', message: 'Välj en giltig kategori.' }
  ]);
});

test('V3: ett utkast som inte är ett objekt ger fyra fel och kastar inte', () => {
  for (const värde of [undefined, null, 'abc', 42, true, [], 1n, Symbol('x')]) {
    const resultat = validateMonthItemDraft(värde);
    assert.equal(resultat.ok, false, String(värde));
    assert.deepEqual(resultat.errors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category'], String(värde));
  }
});

// (V4) beloppet med mellanslag ger ägarens vägledande text och ingen egen.
test('V4: ett belopp med mellanslag ger den vägledande texten ur checkAmountSek', () => {
  const vägledande = 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.';
  for (const amountSek of ['12 000', '12 000 kr', '1 234,50 kr']) {
    const resultat = validateMonthItemDraft(draft({ amountSek }));
    assert.equal(resultat.ok, false, amountSek);
    assert.deepEqual(resultat.errors, [{ field: 'amountSek', message: vägledande }], amountSek);
  }
  // Och texten är ägarens, inte en kopia: samma sträng som checkAmountSek ger
  // för samma värde. Fälls den här raden har item.js skrivit en egen text.
  assert.equal(checkAmountSek('12 000').message, vägledande);
});

test('V4: varje annan beloppsregel kommer också från ägaren', () => {
  for (const amountSek of ['0', '-5', '10000000', '1,234', 'abc', '', null]) {
    const förväntat = checkAmountSek(amountSek).message;
    assert.equal(typeof förväntat, 'string', String(amountSek));
    const resultat = validateMonthItemDraft(draft({ amountSek }));
    assert.deepEqual(resultat.errors, [{ field: 'amountSek', message: förväntat }], String(amountSek));
  }
});
