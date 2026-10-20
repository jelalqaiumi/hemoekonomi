import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BILL_STATUSES,
  REMIND_DAYS_DEFAULT,
  REMIND_DAYS_MAX,
  REMIND_DAYS_MIN,
  billDaysText,
  billStatus,
  daysUntilDue,
  nextBillDueDate,
  validateBillDraft
} from '../src/core/bill.js';
import { INTERVALS } from '../src/core/entry.js';

const IDAG = '2026-09-25';
const NU = '2026-09-25T18:03:00.000Z';

const ICKE_TAL = [-0.5, NaN, Infinity, -Infinity, '3', null, 1n, Symbol('x'), {}, [], new Date(), true];

function bill(ändringar = {}) {
  const värden = {
    id: 'b1',
    name: 'Elräkning',
    amountOre: 85000,
    dueDate: '2026-10-15',
    interval: null,
    remindDays: REMIND_DAYS_DEFAULT,
    paidAt: null,
    ...ändringar
  };
  return { anchorDate: värden.dueDate, ...värden };
}

test('BILL_STATUSES är de fyra värdena i tabellordning och är fryst', () => {
  assert.deepEqual([...BILL_STATUSES], ['betald', 'forfallen', 'paminnelse', 'kommande']);
  assert.equal(Object.isFrozen(BILL_STATUSES), true);
  const svar = new Set([
    billStatus(bill({ paidAt: NU }), IDAG),
    billStatus(bill({ dueDate: '2026-09-20' }), IDAG),
    billStatus(bill({ dueDate: '2026-09-27', remindDays: 3 }), IDAG),
    billStatus(bill({ dueDate: '2026-10-15', remindDays: 3 }), IDAG)
  ]);
  assert.deepEqual([...svar].sort(), [...BILL_STATUSES].sort());
});

test('billStatus ger de fyra värdena, en rad i tabellen var', () => {
  assert.equal(billStatus(bill({ paidAt: NU }), IDAG), 'betald');
  assert.equal(billStatus(bill({ dueDate: '2026-09-24' }), IDAG), 'forfallen');
  assert.equal(billStatus(bill({ dueDate: '2026-09-28', remindDays: 3 }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-29', remindDays: 3 }), IDAG), 'kommande');
});

test('billStatus låter rad 1 vinna över rad 2: en betald räkning som förfallit är betald', () => {
  const förfallenOchBetald = bill({ dueDate: '2026-09-20', paidAt: NU });
  assert.equal(billStatus(förfallenOchBetald, IDAG), 'betald');
  assert.equal(billStatus({ ...förfallenOchBetald, paidAt: null }, IDAG), 'forfallen');
});

test('billStatus låter rad 2 vinna över rad 3: en förfallen räkning är inte en påminnelse', () => {
  const förfallen = bill({ dueDate: '2026-09-20', remindDays: 3 });
  assert.equal(daysUntilDue(förfallen.dueDate, IDAG), -5);
  assert.equal(billStatus(förfallen, IDAG), 'forfallen');
});

test('billStatus räknar en räkning som förfaller idag som paminnelse, aldrig som forfallen', () => {
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: REMIND_DAYS_MIN }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-24', remindDays: REMIND_DAYS_MIN }), IDAG), 'forfallen');
});

test('billStatus prövar gränsen för paminnelse på båda sidor av remind_days', () => {
  assert.equal(billStatus(bill({ dueDate: '2026-10-02', remindDays: 7 }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-10-02', remindDays: 6 }), IDAG), 'kommande');
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: REMIND_DAYS_MIN }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-26', remindDays: REMIND_DAYS_MIN }), IDAG), 'kommande');
  assert.equal(billStatus(bill({ dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-10-26', remindDays: REMIND_DAYS_MAX }), IDAG), 'kommande');
});

test('billStatus kastar RangeError för något som inte är ett objekt', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(() => billStatus(value, IDAG), {
      name: 'RangeError',
      message: 'billStatus kräver en räkning som objekt.'
    }, String(value));
  }
  assert.throws(() => billStatus(new Date(), IDAG), {
    name: 'RangeError',
    message: 'billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "undefined".'
  });
});

test('billStatus kastar RangeError för ett paidAt som varken är en tidsstämpel eller null', () => {
  for (const paidAt of [undefined, '', '   ', 42, 0, true, 1n, Symbol('x'), {}, [], new Date(), NaN]) {
    assert.throws(() => billStatus(bill({ paidAt }), IDAG), {
      name: 'RangeError',
      message: `billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "${String(paidAt)}".`
    }, String(paidAt));
  }
});

test('billStatus kastar RangeError för ett remindDays utanför gränserna eller av fel typ', () => {
  for (const remindDays of [...ICKE_TAL, REMIND_DAYS_MIN - 1, REMIND_DAYS_MAX + 1, 2.5, -0.0001]) {
    assert.throws(() => billStatus(bill({ remindDays }), IDAG), {
      name: 'RangeError',
      message: `billStatus kräver ett remindDays mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX}, fick "${String(remindDays)}".`
    }, String(remindDays));
  }
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: -0 }), IDAG), 'paminnelse');
});

test('billStatus låter compareIsoDates äga frågan "är det här ett datum"', () => {
  assert.throws(() => billStatus(bill({ dueDate: '2026-02-30' }), IDAG), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.throws(() => billStatus(bill(), '2026-13-01'), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.equal(billStatus(bill({ dueDate: '2026-02-30', paidAt: NU }), IDAG), 'betald');
});

test('daysUntilDue räknar dagar framåt och bakåt, och ger +0 för samma dag', () => {
  assert.equal(daysUntilDue('2026-10-02', IDAG), 7);
  assert.equal(daysUntilDue('2026-09-20', IDAG), -5);
  assert.equal(daysUntilDue(IDAG, IDAG), 0);
  assert.equal(Object.is(daysUntilDue(IDAG, IDAG), -0), false);
  assert.equal(daysUntilDue('2027-01-01', '2026-12-31'), 1);
  assert.equal(daysUntilDue('2026-03-01', '2026-02-28'), 1);
  assert.equal(daysUntilDue('2028-03-01', '2028-02-28'), 2, 'skottår');
});

test('daysUntilDue låter daysBetween avvisa det som inte är ett datum', () => {
  for (const value of [undefined, null, '', '2026-13-01', 42, 1n, Symbol('x')]) {
    assert.throws(() => daysUntilDue(value, IDAG), {
      name: 'RangeError',
      message: /^daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD/
    }, String(value));
    assert.throws(() => daysUntilDue(IDAG, value), {
      name: 'RangeError',
      message: /^daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD/
    }, String(value));
  }
});

test('billDaysText ger Förföll för <N> dagar sedan vid -2 och lägre', () => {
  assert.equal(billDaysText(-2), 'Förföll för 2 dagar sedan');
  assert.equal(billDaysText(-3), 'Förföll för 3 dagar sedan');
  assert.equal(billDaysText(-5), 'Förföll för 5 dagar sedan');
  assert.equal(billDaysText(-31), 'Förföll för 31 dagar sedan');
  assert.equal(billDaysText(-365).includes('-'), false);
});

test('billDaysText ger Förföll igår vid -1', () => {
  assert.equal(billDaysText(-1), 'Förföll igår');
  assert.notEqual(billDaysText(-2), 'Förföll igår');
});

test('billDaysText ger Förfaller idag vid 0', () => {
  assert.equal(billDaysText(0), 'Förfaller idag');
  assert.equal(billDaysText(-0), 'Förfaller idag');
  assert.notEqual(billDaysText(-1), 'Förfaller idag');
  assert.notEqual(billDaysText(1), 'Förfaller idag');
});

test('billDaysText ger Förfaller imorgon vid 1', () => {
  assert.equal(billDaysText(1), 'Förfaller imorgon');
  assert.notEqual(billDaysText(2), 'Förfaller imorgon');
});

test('billDaysText ger Förfaller om <N> dagar vid 2 och högre', () => {
  assert.equal(billDaysText(2), 'Förfaller om 2 dagar');
  assert.equal(billDaysText(3), 'Förfaller om 3 dagar');
  assert.equal(billDaysText(14), 'Förfaller om 14 dagar');
  assert.equal(billDaysText(365), 'Förfaller om 365 dagar');
});

test('billDaysText byter form på exakt de fem gränserna', () => {
  assert.deepEqual(
    [-2, -1, 0, 1, 2].map(billDaysText),
    [
      'Förföll för 2 dagar sedan',
      'Förföll igår',
      'Förfaller idag',
      'Förfaller imorgon',
      'Förfaller om 2 dagar'
    ]
  );
});

test('billDaysText kastar RangeError för allt som inte är ett heltal', () => {
  for (const value of [...ICKE_TAL, undefined, 2.5, -2.5]) {
    assert.throws(() => billDaysText(value), {
      name: 'RangeError',
      message: `billDaysText kräver ett heltal dagar, fick "${String(value)}".`
    }, String(value));
  }
});

test('nextBillDueDate flyttar en period framåt när räkningen betalas i tid', () => {
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-10-15'), '2026-11-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'quarterly' }), '2026-10-15'), '2027-01-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'semiannual' }), '2026-10-15'), '2027-04-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'yearly' }), '2026-10-15'), '2027-10-15');
});

test('nextBillDueDate flyttar en period framåt också när räkningen betalas i förväg', () => {
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-10-01'), '2026-11-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-11-15'), '2026-11-15');
});

test('nextBillDueDate hoppar över de perioder som redan passerat vid en sen betalning', () => {
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-15', interval: 'quarterly' }), '2026-07-20'), '2026-10-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2020-03-15', interval: 'monthly' }), '2026-09-25'), '2026-10-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-15', interval: 'monthly' }), '2026-07-15'), '2026-07-15');
});

test('nextBillDueDate klampar genom nextDueDate för den 29 till 31', () => {
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-31', interval: 'monthly' }), '2026-01-31'), '2026-02-28');
  assert.equal(nextBillDueDate(bill({ dueDate: '2028-01-31', interval: 'monthly' }), '2028-01-31'), '2028-02-29');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-30', interval: 'monthly' }), '2026-01-30'), '2026-02-28');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-29', interval: 'monthly' }), '2026-01-29'), '2026-02-28');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-11-30', interval: 'quarterly' }), '2026-11-30'), '2027-02-28');
});

test('nextBillDueDate kastar RangeError för en engångsräkning och för ett okänt interval', () => {
  assert.throws(() => nextBillDueDate(bill({ interval: null }), IDAG), {
    name: 'RangeError',
    message: 'nextBillDueDate kräver ett känt interval, fick "null".'
  });
  for (const interval of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'weekly', '', undefined, 42, 1n]) {
    assert.throws(() => nextBillDueDate(bill({ interval }), IDAG), {
      name: 'RangeError',
      message: `nextBillDueDate kräver ett känt interval, fick "${String(interval)}".`
    }, String(interval));
  }
});

test('nextBillDueDate kastar RangeError för något som inte är ett objekt', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(() => nextBillDueDate(value, IDAG), {
      name: 'RangeError',
      message: 'nextBillDueDate kräver en räkning som objekt.'
    }, String(value));
  }
});

test('nextBillDueDate låter dates.js avvisa ett dueDate eller ett today som inte är ett datum', () => {
  assert.throws(() => nextBillDueDate(bill({ dueDate: '2026-02-30', interval: 'monthly' }), IDAG), {
    name: 'RangeError',
    message: /^addMonthsClamped kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.throws(() => nextBillDueDate(bill({ interval: 'monthly' }), '2026-13-01'), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
});

test('validateBillDraft tar emot de fem fälten och räknar om beloppet till ören', () => {
  assert.deepEqual(
    validateBillDraft({ name: '  Elräkning ', amountSek: '850,50', dueDate: '2026-10-15', interval: 'monthly', remindDays: 5 }),
    { ok: true, value: { name: 'Elräkning', amountOre: 85050, dueDate: '2026-10-15', interval: 'monthly', remindDays: 5 } }
  );
});

test('validateBillDraft tar emot de fyra intervallen plus Engångs som tomt', () => {
  for (const interval of INTERVALS) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, true, interval);
    assert.equal(result.value.interval, interval);
  }
  for (const interval of [undefined, null, '', '   ']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, true, String(interval));
    assert.equal(result.value.interval, null, String(interval));
  }
});

test('validateBillDraft ger förvalet för remindDays när fältet är tomt', () => {
  for (const remindDays of [undefined, null, '', '   ']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays });
    assert.equal(result.ok, true, String(remindDays));
    assert.equal(result.value.remindDays, REMIND_DAYS_DEFAULT, String(remindDays));
  }
  assert.equal(REMIND_DAYS_DEFAULT, 3);
});

test('validateBillDraft tar emot remindDays som sträng och som tal, med samma svar', () => {
  for (const [sträng, tal] of [['0', 0], ['3', 3], ['30', 30], [' 7 ', 7]]) {
    assert.deepEqual(
      validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: sträng }),
      validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: tal }),
      sträng
    );
  }
  for (const [sträng, tal] of [['31', 31], ['-1', -1], ['999', 999]]) {
    const frånSträng = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: sträng });
    const frånTal = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: tal });
    assert.deepEqual(frånSträng, frånTal, sträng);
    assert.equal(frånSträng.errors[0].message, `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`);
  }
});

test('validateBillDraft avvisar ett remindDays som inte är ett heltal i intervallet', () => {
  for (const remindDays of [31, -1, 2.5, NaN, Infinity, '2,5', '3 dagar', 'tre', 1n, Symbol('x'), {}, [], true, new Date(), '0031']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays });
    assert.equal(result.ok, false, String(remindDays));
    assert.deepEqual(result.errors, [{
      field: 'remindDays',
      message: `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`
    }], String(remindDays));
  }
});

test('validateBillDraft avvisar ett remindDays på en miljon tecken utan att läsa hela', () => {
  const start = Date.now();
  const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: '1'.repeat(1000000) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].field, 'remindDays');
  assert.equal(Date.now() - start < 1000, true, `tog ${Date.now() - start} ms`);
});

test('validateBillDraft kräver en förfallodag och avvisar ett datum som inte finns', () => {
  for (const dueDate of [undefined, null, '', '   ', '2026-10', '20261015', '2026-2-1', '2026-02-30', '2026-13-01', 'imorgon', 42, 1n, Symbol('x'), {}, [], new Date()]) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate });
    assert.equal(result.ok, false, String(dueDate));
    assert.deepEqual(result.errors, [{
      field: 'dueDate',
      message: 'Förfallodag måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD.'
    }], String(dueDate));
  }
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: ' 2026-10-15 ' }).value.dueDate, '2026-10-15');
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2028-02-29' }).ok, true);
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-02-29' }).ok, false);
});

test('validateBillDraft avvisar ett intervall som inte är ett av de fyra, med sin egen text', () => {
  for (const interval of ['weekly', 'MONTHLY', 'constructor', 'toString', 42, 1n, Symbol('x'), {}, [], true, new Date()]) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, false, String(interval));
    assert.deepEqual(result.errors, [{
      field: 'interval',
      message: 'Välj Engångs, månadsvis, kvartalsvis, halvårsvis eller årsvis.'
    }], String(interval));
  }
});

test('validateBillDraft lånar namnets och beloppets texter av deras ägare i entry.js', () => {
  assert.deepEqual(
    validateBillDraft({ name: '  ', amountSek: '100', dueDate: '2026-10-15' }).errors,
    [{ field: 'name', message: 'Namnet får inte vara tomt.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'a'.repeat(61), amountSek: '100', dueDate: '2026-10-15' }).errors,
    [{ field: 'name', message: 'Namnet får vara högst 60 tecken.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'El', amountSek: '0', dueDate: '2026-10-15' }).errors,
    [{ field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'El', amountSek: '1,005', dueDate: '2026-10-15' }).errors,
    [{ field: 'amountSek', message: 'Beloppet får ha högst två decimaler.' }]
  );
});

test('validateBillDraft prövar alla fem fälten och ger felen i formulärets ordning', () => {
  const result = validateBillDraft({ name: '', amountSek: 'abc', dueDate: 'nej', interval: 'weekly', remindDays: 99 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((fel) => fel.field), ['name', 'amountSek', 'dueDate', 'interval', 'remindDays']);
});

test('validateBillDraft tar emot något som inte är ett objekt och svarar med fem fältfel', () => {
  for (const draft of [undefined, null, 'abc', 42, true, 1n, Symbol('x'), []]) {
    const result = validateBillDraft(draft);
    assert.equal(result.ok, false, String(draft));
    assert.deepEqual(result.errors.map((fel) => fel.field), ['name', 'amountSek', 'dueDate'], String(draft));
  }
});
