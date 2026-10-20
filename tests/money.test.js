import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ORE_PER_SEK,
  divideRoundHalfUp,
  formatSek,
  normalizeZero,
  oreToSek,
  sekToOre
} from '../src/core/money.js';
import { canonicalAmountSek } from '../src/core/entry.js';

import * as costModule from '../src/core/cost.js';
import * as datesModule from '../src/core/dates.js';
import * as entryModule from '../src/core/entry.js';
import * as moneyModule from '../src/core/money.js';

test('ORE_PER_SEK är 100', () => {
  assert.equal(ORE_PER_SEK, 100);
});

test('divideRoundHalfUp ger kontrollvärdena i avrundningsavsnittet', () => {
  const cases = [
    { label: '100 kr/mån → månad', numerator: 120000, denominator: 12, expected: 10000 },
    { label: '100 kr/kvartal → månad', numerator: 40000, denominator: 12, expected: 3333 },
    { label: '100 kr/år → månad', numerator: 10000, denominator: 12, expected: 833 },
    { label: 'exakt halva öret uppåt', numerator: 150, denominator: 12, expected: 13 },
    { label: 'precis under halva', numerator: 149, denominator: 12, expected: 12 },
    { label: 'noll', numerator: 0, denominator: 12, expected: 0 }
  ];
  for (const { label, numerator, denominator, expected } of cases) {
    assert.equal(divideRoundHalfUp(numerator, denominator), expected, label);
  }
});

test('divideRoundHalfUp avrundar halva uppåt även vid nämnare 2', () => {
  assert.equal(divideRoundHalfUp(1, 2), 1);
  assert.equal(divideRoundHalfUp(3, 2), 2);
  assert.equal(divideRoundHalfUp(4, 2), 2);
  assert.equal(divideRoundHalfUp(5, 2), 3);
});

test('divideRoundHalfUp med nämnare 1 ger täljaren oförändrad', () => {
  assert.equal(divideRoundHalfUp(0, 1), 0);
  assert.equal(divideRoundHalfUp(7, 1), 7);
  assert.equal(divideRoundHalfUp(999999999, 1), 999999999);
});

test('divideRoundHalfUp kastar RangeError för en täljare som inte är heltal', () => {
  assert.throws(() => divideRoundHalfUp(1.5, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(0.5, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(NaN, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(Infinity, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(-Infinity, 12), RangeError);
});

test('divideRoundHalfUp kastar RangeError för täljare av typ BigInt eller Symbol', () => {
  assert.throws(() => divideRoundHalfUp(12n, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(Symbol('12'), 12), RangeError);
});

test('divideRoundHalfUp kastar RangeError för andra icke-tal som täljare', () => {
  assert.throws(() => divideRoundHalfUp('120000', 12), RangeError);
  assert.throws(() => divideRoundHalfUp(null, 12), RangeError);
  assert.throws(() => divideRoundHalfUp(undefined, 12), RangeError);
  assert.throws(() => divideRoundHalfUp({}, 12), RangeError);
});

test('divideRoundHalfUp kastar RangeError för en nämnare som inte är heltal', () => {
  assert.throws(() => divideRoundHalfUp(120000, 12.5), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, NaN), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, Infinity), RangeError);
});

test('divideRoundHalfUp kastar RangeError för nämnare av typ BigInt eller Symbol', () => {
  assert.throws(() => divideRoundHalfUp(120000, 12n), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, Symbol('12')), RangeError);
});

test('divideRoundHalfUp kastar RangeError för andra icke-tal som nämnare', () => {
  assert.throws(() => divideRoundHalfUp(120000, '12'), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, null), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, undefined), RangeError);
});

test('divideRoundHalfUp kastar RangeError för nämnare som inte är större än 0', () => {
  assert.throws(() => divideRoundHalfUp(120000, 0), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, -1), RangeError);
  assert.throws(() => divideRoundHalfUp(120000, -12), RangeError);
});

test('sekToOre ger heltal öre för typiska belopp', () => {
  assert.equal(sekToOre(0), 0);
  assert.equal(sekToOre(0.01), 1);
  assert.equal(sekToOre(1), 100);
  assert.equal(sekToOre(100), 10000);
  assert.equal(sekToOre(199.5), 19950);
  assert.equal(sekToOre(9999999.99), 999999999);
});

test('sekToOre ger alltid ett heltal, även för belopp med fler decimaler', () => {
  for (const amountSek of [0.005, 1.004, 1.005, 199.999999999, 12.345]) {
    assert.equal(Number.isInteger(sekToOre(amountSek)), true, `${amountSek}`);
  }
});

test('sekToOre kastar RangeError för värden som inte är finita tal', () => {
  assert.throws(() => sekToOre(NaN), RangeError);
  assert.throws(() => sekToOre(Infinity), RangeError);
  assert.throws(() => sekToOre(-Infinity), RangeError);
  assert.throws(() => sekToOre('100'), RangeError);
  assert.throws(() => sekToOre(null), RangeError);
  assert.throws(() => sekToOre(undefined), RangeError);
  assert.throws(() => sekToOre({}), RangeError);
});

test('sekToOre kastar RangeError för BigInt och Symbol', () => {
  assert.throws(() => sekToOre(100n), RangeError);
  assert.throws(() => sekToOre(Symbol('100')), RangeError);
});

test('oreToSek räknar tillbaka öre till kronor', () => {
  assert.equal(oreToSek(0), 0);
  assert.equal(oreToSek(1), 0.01);
  assert.equal(oreToSek(10000), 100);
  assert.equal(oreToSek(123450), 1234.5);
  assert.equal(oreToSek(999999999), 9999999.99);
});

test('oreToSek är inversen av sekToOre för kanoniska belopp', () => {
  for (const amountSek of [0, 0.01, 1, 199.5, 1234.5, 9999999.99]) {
    assert.equal(oreToSek(sekToOre(amountSek)), amountSek, `${amountSek}`);
  }
});

test('formatSek ger svenskt kronformat med två decimaler', () => {
  assert.equal(formatSek(123450), '1\u00a0234,50\u00a0kr');
  assert.equal(formatSek(0), '0,00\u00a0kr');
  assert.equal(formatSek(100), '1,00\u00a0kr');
  assert.equal(formatSek(833), '8,33\u00a0kr');
  assert.equal(formatSek(2500), '25,00\u00a0kr');
  assert.equal(formatSek(999999999), '9\u00a0999\u00a0999,99\u00a0kr');
});

test('formatSek visar alltid två decimaler', () => {
  for (const ore of [0, 1, 10, 100, 12345]) {
    assert.match(formatSek(ore), /,\d{2}\u00a0kr$/, `${ore}`);
  }
});

test('divideRoundHalfUp kastar RangeError när 2 * täljaren + nämnaren inte är ett säkert heltal', () => {
  for (const numerator of [
    Number.MAX_SAFE_INTEGER,
    2 ** 53,
    2 ** 53 - 3,
    2 ** 54,
    4503599627370490
  ]) {
    assert.throws(
      () => divideRoundHalfUp(numerator, 12),
      {
        name: 'RangeError',
        message: 'divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.'
      },
      `${numerator}`
    );
  }
});

test('divideRoundHalfUp svarar för den sista täljaren inom området och ger BigInt-svaret', () => {
  const numerator = 4503599627370489;
  assert.equal(Number.isSafeInteger(2 * numerator + 12), true);
  assert.equal(divideRoundHalfUp(numerator, 12), 375299968947541);
  assert.equal(divideRoundHalfUp(numerator, 12), Number((2n * BigInt(numerator) + 12n) / 24n));
});

test('divideRoundHalfUp kastar också när nämnaren ensam för summan utanför området', () => {
  assert.throws(() => divideRoundHalfUp(0, Number.MAX_SAFE_INTEGER + 2), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.'
  });
});

test('divideRoundHalfUp ger orsaksmeddelandet för argumentet, inte för summan', () => {
  assert.throws(() => divideRoundHalfUp('120000', 12), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver ett heltal som täljare.'
  });
  assert.throws(() => divideRoundHalfUp(12n, 12), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver ett heltal som täljare.'
  });
  assert.throws(() => divideRoundHalfUp(Symbol('12'), 12), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver ett heltal som täljare.'
  });
  assert.throws(() => divideRoundHalfUp(120000, '12'), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver ett heltal som nämnare.'
  });
  assert.throws(() => divideRoundHalfUp(120000, 12n), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver ett heltal som nämnare.'
  });
  assert.throws(() => divideRoundHalfUp(120000, 0), {
    name: 'RangeError',
    message: 'divideRoundHalfUp kräver en nämnare större än 0.'
  });
});

const ORE_TO_SEK_ERROR = {
  name: 'RangeError',
  message: 'oreToSek kräver ett säkert heltal öre.'
};

test('oreToSek kastar RangeError för öre som inte är ett säkert heltal', () => {
  for (const ore of [NaN, Infinity, -Infinity, 1.5, 1e300, 'abc', '100', null, undefined, {}]) {
    assert.throws(() => oreToSek(ore), ORE_TO_SEK_ERROR, String(ore));
  }
});

test('oreToSek kastar RangeError för BigInt och Symbol', () => {
  assert.throws(() => oreToSek(1n), ORE_TO_SEK_ERROR);
  assert.throws(() => oreToSek(Symbol('x')), ORE_TO_SEK_ERROR);
});

test('oreToSek godkänner hela det säkra heltalsområdet', () => {
  assert.equal(oreToSek(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER / 100);
  assert.equal(oreToSek(-1), -0.01);
  assert.throws(() => oreToSek(Number.MAX_SAFE_INTEGER + 2), ORE_TO_SEK_ERROR);
});

test('formatSek kastar RangeError i stället för att visa NaN, ∞ eller 1e300', () => {
  for (const ore of [NaN, Infinity, -Infinity, 1.5, 1e300, 'abc', null, undefined, {}]) {
    assert.throws(() => formatSek(ore), ORE_TO_SEK_ERROR, String(ore));
  }
});

test('formatSek kastar RangeError för BigInt och Symbol', () => {
  assert.throws(() => formatSek(1n), ORE_TO_SEK_ERROR);
  assert.throws(() => formatSek(Symbol('x')), ORE_TO_SEK_ERROR);
});

test('normalizeZero gör -0 till 0', () => {
  assert.equal(Object.is(normalizeZero(-0), 0), true);
  assert.equal(Object.is(normalizeZero(-0), -0), false);
});

test('normalizeZero kastar inte och lämnar allt utom -0 oförändrat', () => {
  const unchanged = [0, 1, -1, Infinity, -Infinity, 1n, 'abc', '', null, undefined, true];
  for (const value of unchanged) {
    assert.doesNotThrow(() => normalizeZero(value), String(value));
    assert.equal(Object.is(normalizeZero(value), value), true, String(value));
  }
  const symbol = Symbol('x');
  assert.equal(normalizeZero(symbol), symbol);
  assert.equal(Number.isNaN(normalizeZero(NaN)), true);
  assert.equal(normalizeZero(1n), 1n);
  const object = {};
  assert.equal(normalizeZero(object), object);
});

test('sekToOre ger 0 och aldrig -0 för belopp som avrundas till noll öre', () => {
  for (const amountSek of [-0, -0.001, -0.004, -1e-9]) {
    const result = sekToOre(amountSek);
    assert.equal(Object.is(result, 0), true, String(amountSek));
  }
});

test('oreToSek ger 0 och aldrig -0 för -0 öre', () => {
  assert.equal(Object.is(oreToSek(-0), 0), true);
});

test('canonicalAmountSek ger 0 och aldrig -0', () => {
  assert.equal(Object.is(canonicalAmountSek(-0), 0), true);
  assert.equal(Object.is(canonicalAmountSek(-1e-9), 0), true);
});

test('formatSek(-0) ger exakt samma sträng som formatSek(0)', () => {
  assert.equal(formatSek(-0), formatSek(0));
  assert.equal(formatSek(-0), '0,00\u00a0kr');
  assert.deepEqual([...formatSek(-0)].map((c) => c.codePointAt(0)), [
    0x0030, 0x002c, 0x0030, 0x0030, 0x00a0, 0x006b, 0x0072
  ]);
});

const CORE_MODULES = [
  ['money', moneyModule],
  ['entry', entryModule],
  ['cost', costModule],
  ['dates', datesModule]
];

function draftWith(amountSek) {
  return {
    name: 'Spotify Family',
    amountSek,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
}

const NEGATIVE_ZERO_ARGUMENTS = [
  -0, 0, -0.001, -0.004, -1e-9, -0.01, -1, 1, 12, 0.01, 199.5,
  '-0', '-0,00', '0', 'abc', '', null, undefined, NaN, Infinity, -Infinity,
  true, {}, [], [1],
  draftWith(-0), draftWith(-0.001), draftWith(0), draftWith(199),
  { ...draftWith(-0), id: 'a' }, { ...draftWith(0), id: 'a' },
  [draftWith(-0)], [draftWith(0)], [draftWith(199)]
];

function assertNoNegativeZero(value, where, depth = 0) {
  if (typeof value === 'number') {
    assert.equal(Object.is(value, -0), false, `${where} returnerade -0`);
    return;
  }
  if (depth >= 3 || value === null || typeof value !== 'object') {
    return;
  }
  for (const [key, inner] of Object.entries(value)) {
    assertNoNegativeZero(inner, `${where}.${key}`, depth + 1);
  }
}

test('ingen exporterad funktion i src/core/ returnerar -0', () => {
  let calls = 0;
  for (const [moduleName, module] of CORE_MODULES) {
    for (const [exportName, exported] of Object.entries(module)) {
      if (typeof exported !== 'function') {
        continue;
      }
      for (const first of NEGATIVE_ZERO_ARGUMENTS) {
        for (const second of [undefined, 12, -0, 2]) {
          let result;
          try {
            result = exported(first, second);
          } catch {
            continue;
          }
          calls += 1;
          if (typeof result === 'object' && result !== null
            && (result === first || result === second)) {
            continue;
          }
          assertNoNegativeZero(
            result,
            `${moduleName}.${exportName}(${String(first)}, ${String(second)})`
          );
        }
      }
    }
  }
  assert.equal(calls > 100, true, `bara ${calls} anrop gick igenom`);
});
