import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MONTHS_PER_YEAR,
  PAYMENTS_PER_YEAR,
  monthlyOre,
  totalMonthlyOre,
  totalYearlyOre,
  yearlyOre
} from '../src/core/cost.js';
import { INTERVALS } from '../src/core/entry.js';

// Hjälpare: en giltig post enligt datamodellens sex fält. Bara amountSek och
// interval påverkar kostnadsberäkningen; övriga fält finns för att posterna ska
// vara riktiga poster.
function entry(amountSek, interval, id = 'e1') {
  return {
    id,
    name: 'Post',
    amountSek,
    interval,
    startDate: '2026-01-15',
    category: 'other'
  };
}

test('PAYMENTS_PER_YEAR har de tre intervallen och deras faktorer', () => {
  assert.deepEqual({ ...PAYMENTS_PER_YEAR }, { monthly: 12, quarterly: 4, yearly: 1 });
});

test('PAYMENTS_PER_YEAR är fryst', () => {
  assert.equal(Object.isFrozen(PAYMENTS_PER_YEAR), true);
  assert.throws(() => {
    PAYMENTS_PER_YEAR.monthly = 99;
  }, TypeError);
  assert.throws(() => {
    PAYMENTS_PER_YEAR.weekly = 52;
  }, TypeError);
  assert.throws(() => {
    delete PAYMENTS_PER_YEAR.yearly;
  }, TypeError);
  assert.deepEqual({ ...PAYMENTS_PER_YEAR }, { monthly: 12, quarterly: 4, yearly: 1 });
});

// PAYMENTS_PER_YEAR och INTERVALS beskriver samma domän men bor i var sin modul.
// Utan den här kopplingen kan ett nytt intervall läggas till i entry.js, godkännas
// av validateEntryDraft, och sedan ge NaN i cost.js utan att något test faller.
test('PAYMENTS_PER_YEAR har exakt INTERVALS nycklar', () => {
  assert.deepEqual(Object.keys(PAYMENTS_PER_YEAR).sort(), [...INTERVALS].sort());
});

test('MONTHS_PER_YEAR är 12', () => {
  assert.equal(MONTHS_PER_YEAR, 12);
});

// --- yearlyOre

test('yearlyOre normaliserar 100,00 kr till år för varje intervall', () => {
  assert.equal(yearlyOre(entry(100, 'monthly')), 120000);
  assert.equal(yearlyOre(entry(100, 'quarterly')), 40000);
  assert.equal(yearlyOre(entry(100, 'yearly')), 10000);
});

test('yearlyOre räknar i öre och ger alltid ett heltal', () => {
  assert.equal(yearlyOre(entry(0.01, 'monthly')), 12);
  assert.equal(yearlyOre(entry(0.01, 'quarterly')), 4);
  assert.equal(yearlyOre(entry(0.01, 'yearly')), 1);
  assert.equal(yearlyOre(entry(1234.56, 'monthly')), 1481472);
});

test('yearlyOre klarar det största tillåtna beloppet utan precisionsförlust', () => {
  const ore = yearlyOre(entry(9999999.99, 'monthly'));
  assert.equal(ore, 11999999988);
  assert.equal(Number.isSafeInteger(ore), true);
});

test('yearlyOre för ett belopp som inte är ett finit tal kastar RangeError', () => {
  assert.throws(() => yearlyOre(entry(NaN, 'monthly')), RangeError);
  assert.throws(() => yearlyOre(entry(Infinity, 'monthly')), RangeError);
  assert.throws(() => yearlyOre(entry('100', 'monthly')), RangeError);
  assert.throws(() => yearlyOre(entry(100n, 'monthly')), RangeError);
  assert.throws(() => yearlyOre(entry(Symbol('100'), 'monthly')), RangeError);
});

// --- monthlyOre

test('monthlyOre ger avrundningsavsnittets kontrollvärden per intervall', () => {
  assert.equal(monthlyOre(entry(100, 'monthly')), 10000);
  assert.equal(monthlyOre(entry(100, 'quarterly')), 3333);
  assert.equal(monthlyOre(entry(100, 'yearly')), 833);
});

test('monthlyOre avrundar halva öret uppåt', () => {
  // 1,50 kr/år = 150 öre/år → 12,5 öre/mån → 13 öre.
  assert.equal(monthlyOre(entry(1.5, 'yearly')), 13);
  // 1,49 kr/år = 149 öre/år → 12,416 öre/mån → 12 öre.
  assert.equal(monthlyOre(entry(1.49, 'yearly')), 12);
});

test('monthlyOre ger 0 öre för ett belopp på 0 kr', () => {
  assert.equal(monthlyOre(entry(0, 'yearly')), 0);
  assert.equal(monthlyOre(entry(0, 'monthly')), 0);
});

test('monthlyOre ger beloppet oförändrat för ett månadsintervall', () => {
  for (const amountSek of [0.01, 1, 99.99, 1234.56, 9999999.99]) {
    assert.equal(monthlyOre(entry(amountSek, 'monthly')), Math.round(amountSek * 100), `${amountSek}`);
  }
});

// --- totalYearlyOre och totalMonthlyOre

test('tom lista ger 0 för både årstotal och månadstotal', () => {
  assert.equal(totalYearlyOre([]), 0);
  assert.equal(totalMonthlyOre([]), 0);
  assert.equal(Number.isNaN(totalYearlyOre([])), false);
  assert.equal(Number.isNaN(totalMonthlyOre([])), false);
});

test('totalYearlyOre summerar de exakta årsbeloppen', () => {
  const entries = [
    entry(100, 'monthly', 'a'),
    entry(100, 'quarterly', 'b'),
    entry(100, 'yearly', 'c')
  ];
  assert.equal(totalYearlyOre(entries), 120000 + 40000 + 10000);
});

test('totalYearlyOre räknar i heltal öre, inte i kronor som flyttal', () => {
  // 0,10 kr + 0,20 kr per månad. I flyttalskronor blir 0.1 + 0.2 lika med
  // 0.30000000000000004; i öre blir summan exakt.
  const entries = [entry(0.1, 'monthly', 'a'), entry(0.2, 'monthly', 'b')];
  assert.equal(totalYearlyOre(entries), 360);
  assert.equal(totalMonthlyOre(entries), 30);
});

// Det bindande beslutet i ARKITEKTUR.md: totalen räknas ur den exakta
// årssumman och avrundas en enda gång, inte som summan av de avrundade
// månadsbeloppen. Skillnaden på ett öre är förväntat beteende, inte en bugg.
test('tre årsposter à 100,00 kr ger 833 öre per post men 2500 öre i månadstotal', () => {
  const entries = [
    entry(100, 'yearly', 'a'),
    entry(100, 'yearly', 'b'),
    entry(100, 'yearly', 'c')
  ];
  assert.equal(monthlyOre(entries[0]), 833);
  assert.equal(totalYearlyOre(entries), 30000);
  assert.equal(totalMonthlyOre(entries), 2500);
  const sumOfRounded = entries.reduce((sum, item) => sum + monthlyOre(item), 0);
  assert.equal(sumOfRounded, 2499);
  assert.notEqual(totalMonthlyOre(entries), sumOfRounded);
});

test('en enda post ger samma månadstotal som postens eget månadsbelopp', () => {
  for (const interval of ['monthly', 'quarterly', 'yearly']) {
    const single = [entry(100, interval)];
    assert.equal(totalMonthlyOre(single), monthlyOre(single[0]), interval);
    assert.equal(totalYearlyOre(single), yearlyOre(single[0]), interval);
  }
});

test('totalMonthlyOre avrundar en gång på slutsumman', () => {
  // Två årsposter à 0,01 kr: 2 öre per år → 0,1667 öre/mån → 0 öre.
  const small = [entry(0.01, 'yearly', 'a'), entry(0.01, 'yearly', 'b')];
  assert.equal(totalYearlyOre(small), 2);
  assert.equal(totalMonthlyOre(small), 0);
  // Sju årsposter à 0,01 kr: 7 öre per år → 0,583 öre/mån → 1 öre.
  const seven = [];
  for (let index = 0; index < 7; index += 1) {
    seven.push(entry(0.01, 'yearly', `e${index}`));
  }
  assert.equal(totalYearlyOre(seven), 7);
  assert.equal(totalMonthlyOre(seven), 1);
});

test('totalYearlyOre påverkas inte av postordningen', () => {
  const entries = [
    entry(123.45, 'monthly', 'a'),
    entry(67.89, 'quarterly', 'b'),
    entry(4999.5, 'yearly', 'c')
  ];
  const reversed = [...entries].reverse();
  assert.equal(totalYearlyOre(reversed), totalYearlyOre(entries));
  assert.equal(totalMonthlyOre(reversed), totalMonthlyOre(entries));
});

// --- Ingångsspärrar i cost.js
// Facittabellen i ARKITEKTUR.md, avsnittet "Ingångsspärrar i cost.js".
// yearlyOre äger hela kedjan; monthlyOre, totalMonthlyOre och totalYearlyOre
// (utom sina två egna spärrar) ärver den.

const NOT_OBJECT = {
  name: 'RangeError',
  message: 'yearlyOre kräver en post som objekt.'
};
const NOT_FINITE_AMOUNT = {
  name: 'RangeError',
  message: 'sekToOre kräver ett finit tal.'
};
const NEGATIVE_AMOUNT = {
  name: 'RangeError',
  message: 'yearlyOre kräver ett belopp som inte är negativt.'
};
const UNSAFE_YEARLY = {
  name: 'RangeError',
  message: 'yearlyOre kräver att årsbeloppet är ett säkert heltal.'
};
const NOT_A_LIST = {
  name: 'RangeError',
  message: 'totalYearlyOre kräver en lista med poster.'
};
const UNSAFE_SUM = {
  name: 'RangeError',
  message: 'totalYearlyOre kräver att summan är ett säkert heltal.'
};

function unknownInterval(text) {
  return {
    name: 'RangeError',
    message: `yearlyOre kräver ett känt interval, fick "${text}".`
  };
}

// De fyra exporterade funktionerna som tar emot poster. Varje spärr prövas mot
// alla fyra, eftersom tre av dem ska ärva villkoret och inte skriva av det.
const ENTRY_FUNCTIONS = [
  ['yearlyOre', (item) => yearlyOre(item)],
  ['monthlyOre', (item) => monthlyOre(item)],
  ['totalYearlyOre', (item) => totalYearlyOre([item])],
  ['totalMonthlyOre', (item) => totalMonthlyOre([item])]
];

// En array är inte ett vanligt objekt. Villkoret ägs av isPlainObject i entry.js;
// den tidigare handskrivna kopian i cost.js (entry === null || typeof entry !==
// 'object') släppte igenom en array med de sex fälten påsatta och räknade på den.
const ARRAY_WITH_ENTRY_FIELDS = Object.assign([], entry(100, 'monthly'));

test('varje postfunktion kastar RangeError för något som inte är ett objekt', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    const values = [
      null, undefined, 'abc', 42, true, Symbol('x'), 100n,
      [], [1], ARRAY_WITH_ENTRY_FIELDS
    ];
    for (const value of values) {
      assert.throws(() => call(value), NOT_OBJECT, `${label} ${String(value)}`);
    }
  }
});

// yearlyOre och monthlyOre tar en post och har inget tomlist-fall. Bara
// totalYearlyOre([]) och totalMonthlyOre([]) ger 0.
test('yearlyOre och monthlyOre av en tom array kastar RangeError om objekt', () => {
  assert.throws(() => yearlyOre([]), NOT_OBJECT);
  assert.throws(() => monthlyOre([]), NOT_OBJECT);
  assert.throws(() => yearlyOre([1]), NOT_OBJECT);
  assert.throws(() => monthlyOre([1]), NOT_OBJECT);
  assert.throws(() => yearlyOre(ARRAY_WITH_ENTRY_FIELDS), NOT_OBJECT);
  assert.throws(() => monthlyOre(ARRAY_WITH_ENTRY_FIELDS), NOT_OBJECT);
});

// Spärr 1 är inte isEntry: ett Date är ett vanligt objekt och passerar den, och
// faller i stället på intervallet.
test('yearlyOre av ett Date faller på intervallet, inte på objektspärren', () => {
  assert.throws(() => yearlyOre(new Date()), unknownInterval('undefined'));
});

test('varje postfunktion kastar RangeError för ett interval utanför tabellen', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    assert.throws(() => call(entry(100, 'weekly')), unknownInterval('weekly'), label);
    assert.throws(() => call(entry(100, 'daily')), unknownInterval('daily'), label);
    // Ett uppslag utan Object.hasOwn skulle hitta de här två på prototypen.
    assert.throws(() => call(entry(100, 'constructor')), unknownInterval('constructor'), label);
    assert.throws(() => call(entry(100, 'toString')), unknownInterval('toString'), label);
  }
});

test('varje postfunktion kastar RangeError för interval: undefined', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    assert.throws(() => call(entry(100, undefined)), unknownInterval('undefined'), label);
    assert.throws(() => call(entry(100, null)), unknownInterval('null'), label);
    assert.throws(() => call(entry(100, '')), unknownInterval(''), label);
  }
});

// String() i meddelandet: en mallsträng med värdet direkt kastar TypeError för
// Symbol i stället för att ge modulens RangeError.
test('varje postfunktion kastar RangeError för interval av typ BigInt eller Symbol', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    assert.throws(() => call(entry(100, Symbol('weekly'))), unknownInterval('Symbol(weekly)'), label);
    assert.throws(() => call(entry(100, 52n)), unknownInterval('52'), label);
  }
});

test('varje postfunktion kastar RangeError för ett belopp som inte är finit', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    for (const amountSek of [NaN, Infinity, -Infinity, '100', null, undefined, {}]) {
      assert.throws(
        () => call(entry(amountSek, 'monthly')),
        NOT_FINITE_AMOUNT,
        `${label} ${String(amountSek)}`
      );
    }
  }
});

test('varje postfunktion kastar RangeError för ett belopp av typ BigInt eller Symbol', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    assert.throws(() => call(entry(100n, 'monthly')), NOT_FINITE_AMOUNT, label);
    assert.throws(() => call(entry(Symbol('100'), 'monthly')), NOT_FINITE_AMOUNT, label);
  }
});

test('varje postfunktion kastar RangeError för ett negativt belopp', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    for (const amountSek of [-0.01, -100, -9999999.99]) {
      assert.throws(
        () => call(entry(amountSek, 'monthly')),
        NEGATIVE_AMOUNT,
        `${label} ${amountSek}`
      );
    }
  }
});

// Nytt facit efter beslutet "-0 normaliseras till 0": -0 avvisas inte, det är
// noll skrivet med tecken. cost.js har ingen egen -0-kontroll — amountOre kommer
// från sekToOre, som normaliserar genom ägarfunktionen normalizeZero. Ett belopp
// som avrundas till noll öre ger därför 0, precis som ett belopp på exakt 0.
// Raden Math.round(...) visar att det obehandlade uttrycket ger -0, alltså att
// normaliseringen är det som gör svaret 0 och inte -0.
test('ett belopp som avrundas till -0 ger 0 från varje postfunktion', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    for (const amountSek of [-0, -0.001, -0.004]) {
      assert.equal(Object.is(Math.round(amountSek * 100), -0), true, `${amountSek}`);
      const result = call(entry(amountSek, 'monthly'));
      assert.equal(result, 0, `${label} ${amountSek}`);
      assert.equal(Object.is(result, -0), false, `${label} ${amountSek}`);
    }
  }
});

// Gränsen mellan de två svaren: -0.004 avrundas till noll öre och ger 0, medan
// -0.01 är ett verkligt negativt öretal och fäller teckenspärren. Spärren står
// kvar därför att avrundningsregeln "halva öret uppåt" bara sammanfaller med
// bort-från-noll för icke-negativa täljare.
test('teckenspärren skiljer -0.004 från -0.01', () => {
  assert.equal(yearlyOre(entry(-0.004, 'monthly')), 0);
  assert.throws(() => yearlyOre(entry(-0.01, 'monthly')), NEGATIVE_AMOUNT);
});

// Ett belopp på exakt 0 är tillåtet här: cost.js prövar inte om datamodellens
// "> 0", den regeln ägs av entry.js.
test('ett belopp på exakt 0 ger 0 och inte ett fel', () => {
  assert.equal(yearlyOre(entry(0, 'monthly')), 0);
  assert.equal(yearlyOre(entry(0, 'yearly')), 0);
  assert.equal(totalYearlyOre([entry(0, 'monthly')]), 0);
  assert.equal(totalMonthlyOre([entry(0, 'monthly')]), 0);
  assert.equal(Object.is(yearlyOre(entry(0, 'monthly')), -0), false);
});

// Intervallet prövas före beloppet: en post med okänt intervall ska ge
// intervallmeddelandet oavsett vad beloppet innehåller.
test('ett okänt interval vinner över ett trasigt belopp', () => {
  for (const [label, call] of ENTRY_FUNCTIONS) {
    assert.throws(() => call(entry(NaN, 'weekly')), unknownInterval('weekly'), label);
    assert.throws(() => call(entry(-100, 'weekly')), unknownInterval('weekly'), label);
    assert.throws(() => call(entry(Symbol('x'), 'weekly')), unknownInterval('weekly'), label);
  }
});

// --- Giltighetsområdet: årsbelopp och årssumma
// Kört mot BigInt och redovisat i paketet. yearlyOre spärrar produkten,
// totalYearlyOre spärrar summan efter loopen.

test('yearlyOre kastar RangeError när årsbeloppet lämnar det säkra heltalsområdet', () => {
  assert.throws(() => yearlyOre(entry(1e14, 'yearly')), UNSAFE_YEARLY);
  assert.throws(() => yearlyOre(entry(1e14, 'monthly')), UNSAFE_YEARLY);
  assert.throws(() => yearlyOre(entry(1e13, 'monthly')), UNSAFE_YEARLY);
});

test('yearlyOre svarar och stämmer med BigInt inom området', () => {
  const ore = yearlyOre(entry(4e13, 'yearly'));
  assert.equal(ore, 4000000000000000);
  assert.equal(ore, Number(BigInt(Math.round(4e13 * 100)) * 1n));
  assert.equal(Number.isSafeInteger(ore), true);
});

test('totalYearlyOre kastar RangeError när summan lämnar det säkra heltalsområdet', () => {
  const three = [
    entry(4e13, 'yearly', 'a'),
    entry(4e13, 'yearly', 'b'),
    entry(4e13, 'yearly', 'c')
  ];
  assert.throws(() => totalYearlyOre(three), UNSAFE_SUM);
  assert.throws(() => totalMonthlyOre(three), UNSAFE_SUM);
});

test('totalYearlyOre summerar exakt så länge summan ryms, jämfört med BigInt', () => {
  const two = [entry(4e13, 'yearly', 'a'), entry(4e13, 'yearly', 'b')];
  const sum = totalYearlyOre(two);
  assert.equal(sum, 8000000000000000);
  assert.equal(sum, Number(4000000000000000n + 4000000000000000n));
  assert.equal(Number.isSafeInteger(sum), true);
});

// Ordningen mellan ett postfel och summafelet, båda riktningarna. Summaspärren
// står efter loopen: varje posts eget fel vinner över summafelet. Flyttas raden
// in i loopen faller det första testet, tas den bort faller det andra.
test('ett postfel vinner över summafelet när båda är sanna', () => {
  const threeAndBroken = [
    entry(4e13, 'yearly', 'a'),
    entry(4e13, 'yearly', 'b'),
    entry(4e13, 'yearly', 'c'),
    entry(100, 'weekly', 'd')
  ];
  assert.throws(() => totalYearlyOre(threeAndBroken), unknownInterval('weekly'));
  assert.throws(() => totalMonthlyOre(threeAndBroken), unknownInterval('weekly'));
});

test('utan den trasiga posten vinner summafelet för samma tre poster', () => {
  const three = [
    entry(4e13, 'yearly', 'a'),
    entry(4e13, 'yearly', 'b'),
    entry(4e13, 'yearly', 'c')
  ];
  assert.throws(() => totalYearlyOre(three), UNSAFE_SUM);
  assert.throws(() => totalMonthlyOre(three), UNSAFE_SUM);
});

// --- totalYearlyOre: listspärren

test('totalYearlyOre kastar RangeError för något som inte är en lista', () => {
  const values = ['abc', '', 42, null, undefined, true, {}, new Set(), 100n, Symbol('x')];
  for (const value of values) {
    assert.throws(() => totalYearlyOre(value), NOT_A_LIST, typeof value);
  }
});

// Facit, inte en bugg: meddelandet namnger den funktion som äger villkoret,
// inte den som anropades. totalMonthlyOre har inga egna spärrar.
test('totalMonthlyOre ärver listspärren och svarar med totalYearlyOre-namnet', () => {
  assert.throws(() => totalMonthlyOre('abc'), NOT_A_LIST);
  assert.throws(() => totalMonthlyOre(null), NOT_A_LIST);
  assert.throws(() => totalMonthlyOre({}), NOT_A_LIST);
});

// Utan Array.isArray itererar totalYearlyOre('abc') över strängens tecken, och
// felet skulle komma från yearlyOre med ett annat meddelande.
test('en sträng behandlas inte som en lista av tecken', () => {
  assert.throws(() => totalYearlyOre('abc'), NOT_A_LIST);
  assert.throws(() => totalYearlyOre('monthly'), NOT_A_LIST);
});

// --- Ingen exporterad funktion i cost.js får returnera NaN

test('ingen exporterad funktion returnerar NaN för trasig indata — de kastar', () => {
  const badEntries = [
    entry(100, 'weekly'),
    entry(100, undefined),
    entry(100, Symbol('x')),
    entry(NaN, 'monthly'),
    entry('100', 'monthly'),
    entry(-100, 'monthly'),
    entry(-0.01, 'monthly'),
    entry(1e14, 'yearly'),
    null,
    'abc'
  ];
  for (const [label, call] of ENTRY_FUNCTIONS) {
    for (const item of badEntries) {
      let threw = false;
      let result;
      try {
        result = call(item);
      } catch (error) {
        threw = true;
        assert.equal(error instanceof RangeError, true, `${label}: ${error}`);
      }
      assert.equal(threw, true, `${label} gav ${String(result)} i stället för att kasta`);
    }
  }
});
