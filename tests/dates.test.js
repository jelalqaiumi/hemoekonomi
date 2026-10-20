import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  ISO_DATE_PATTERN,
  ISO_MONTH_PATTERN,
  MONTH_NAMES,
  addMonthsClamped,
  compareIsoDates,
  compareMonths,
  daysBetween,
  daysInMonth,
  firstDayOfMonth,
  isValidIsoDate,
  isValidIsoMonth,
  monthLabel,
  monthName,
  monthOfIsoDate,
  parseIsoDate,
  shiftMonth,
  toIsoDate,
  nowIso,
  todayIso
} from '../src/core/dates.js';

const ICKE_HELTAL = [NaN, Infinity, -Infinity, '7', null, undefined, 1n, Symbol('x'), {}, [], true, 1.5];

test('ISO_DATE_PATTERN matchar formatet ÅÅÅÅ-MM-DD och inget annat', () => {
  assert.equal(ISO_DATE_PATTERN.test('2026-01-31'), true);
  assert.equal(ISO_DATE_PATTERN.test('2026-1-5'), false);
  assert.equal(ISO_DATE_PATTERN.test('2026-01-31T00:00:00'), false);
  assert.equal(ISO_DATE_PATTERN.test(''), false);
});

test('daysInMonth ger rätt längd för alla tolv månader i ett normalår', () => {
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  for (let month = 1; month <= 12; month += 1) {
    assert.equal(daysInMonth(2026, month), lengths[month - 1], `månad ${month}`);
  }
});

test('daysInMonth följer skottårsreglerna, inklusive 400-årsregeln', () => {
  assert.equal(daysInMonth(2024, 2), 29, 'delbart med 4');
  assert.equal(daysInMonth(2025, 2), 28, 'inte delbart med 4');
  assert.equal(daysInMonth(2000, 2), 29, '400-årsregeln: enda sekelåret i 1970-2099');
  assert.equal(daysInMonth(1970, 2), 28);
  assert.equal(daysInMonth(2099, 2), 28);
});

test('daysInMonth returnerar 0 utan att kasta för månader utanför 1-12', () => {
  assert.equal(daysInMonth(2026, 13), 0);
  assert.equal(daysInMonth(2026, 0), 0);
  assert.equal(daysInMonth(2026, -1), 0);
});

test('daysInMonth returnerar 0 utan att kasta för år eller månad som inte är heltal', () => {
  for (const [year, month] of [[2026, 1.5], [2026.5, 1], [2026, '2'], ['2026', 1], [2026, NaN], [2026, undefined]]) {
    assert.equal(daysInMonth(year, month), 0, `${year}-${month}`);
  }
});

test('parseIsoDate delar upp ett giltigt datum i år, månad och dag', () => {
  assert.deepEqual(parseIsoDate('2026-01-31'), { year: 2026, month: 1, day: 31 });
  assert.deepEqual(parseIsoDate('1970-01-01'), { year: 1970, month: 1, day: 1 });
  assert.deepEqual(parseIsoDate('2099-12-31'), { year: 2099, month: 12, day: 31 });
  assert.deepEqual(parseIsoDate('2024-02-29'), { year: 2024, month: 2, day: 29 });
  assert.deepEqual(parseIsoDate('2000-02-29'), { year: 2000, month: 2, day: 29 });
});

test('parseIsoDate ger null för datum som inte finns i kalendern', () => {
  for (const value of ['2025-02-29', '2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
    assert.equal(parseIsoDate(value), null, value);
  }
});

test('parseIsoDate ger null för fel format och för värden som inte är strängar', () => {
  for (const value of ['2026-1-5', '31/01/2026', '2026-01-31T00:00:00', ' 2026-01-31', '', 'imorgon', 20260131, null, undefined, {}, ['2026-01-31']]) {
    assert.equal(parseIsoDate(value), null, String(value));
  }
});

test('isValidIsoDate följer parseIsoDate', () => {
  for (const value of ['2026-01-31', '2024-02-29', '2000-02-29', '1970-01-01', '2099-12-31']) {
    assert.equal(isValidIsoDate(value), true, value);
  }
  for (const value of ['2025-02-29', '2026-02-30', '2026-13-01', '2026-1-5', '', null, undefined, 20260131]) {
    assert.equal(isValidIsoDate(value), false, String(value));
  }
});

test('isValidIsoDate godtar år långt utanför 1970-2099 — intervallet är entrys regel, inte datumsmodulens', () => {
  assert.equal(isValidIsoDate('1900-02-28'), true);
  assert.equal(isValidIsoDate('1900-02-29'), false, '1900 är inget skottår');
  assert.equal(isValidIsoDate('2100-01-01'), true);
});

test('parseIsoDate ger null för månadsnummer utanför 1-12 utan en egen månadsrad', () => {
  for (const value of ['2026-13-01', '2026-00-10', '2026-99-01', '2026-20-15']) {
    assert.equal(parseIsoDate(value), null, value);
    assert.equal(isValidIsoDate(value), false, value);
  }
  assert.equal(daysInMonth(2026, 13), 0);
  assert.equal(daysInMonth(2026, 0), 0);
  assert.equal(daysInMonth(2026, 99), 0);
});

test('toIsoDate nollutfyller år, månad och dag', () => {
  assert.equal(toIsoDate({ year: 2026, month: 1, day: 5 }), '2026-01-05');
  assert.equal(toIsoDate({ year: 7, month: 1, day: 2 }), '0007-01-02');
  assert.equal(toIsoDate({ year: 0, month: 1, day: 1 }), '0000-01-01');
  assert.equal(toIsoDate({ year: 9999, month: 12, day: 31 }), '9999-12-31');
  assert.equal(toIsoDate({ year: 2024, month: 2, day: 29 }), '2024-02-29');
});

test('toIsoDate producerar strängar som ISO_DATE_PATTERN och parseIsoDate godtar', () => {
  for (const parts of [{ year: 7, month: 1, day: 2 }, { year: 2026, month: 12, day: 31 }, { year: 2000, month: 2, day: 29 }]) {
    const text = toIsoDate(parts);
    assert.equal(ISO_DATE_PATTERN.test(text), true, text);
    assert.deepEqual(parseIsoDate(text), parts, text);
  }
});

test('toIsoDate kastar RangeError för ett värde som inte bär tre datumfält', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), {}, [], [2026, 1, 1], new Date()]) {
    assert.throws(() => toIsoDate(value), RangeError, String(value));
  }
});

test('toIsoDate kastar RangeError för ett år som inte ryms i fyra siffror', () => {
  assert.throws(() => toIsoDate({ year: -1, month: 1, day: 1 }), {
    name: 'RangeError',
    message: 'toIsoDate kräver ett år med fyra siffror, fick "-1".'
  });
  assert.throws(() => toIsoDate({ year: 10000, month: 1, day: 1 }), RangeError);
  for (const year of ICKE_HELTAL) {
    assert.throws(() => toIsoDate({ year, month: 1, day: 1 }), RangeError, String(year));
  }
});

test('toIsoDate kastar RangeError för ett datum som inte finns i kalendern', () => {
  assert.throws(() => toIsoDate({ year: 2026, month: 2, day: 30 }), {
    name: 'RangeError',
    message: 'toIsoDate kräver ett datum som finns i kalendern, fick "2026-2-30".'
  });
  assert.throws(() => toIsoDate({ year: 2025, month: 2, day: 29 }), RangeError);
  assert.throws(() => toIsoDate({ year: 2026, month: 13, day: 1 }), RangeError);
  assert.throws(() => toIsoDate({ year: 2026, month: 0, day: 1 }), RangeError);
  assert.throws(() => toIsoDate({ year: 2026, month: 1.5, day: 1 }), RangeError);
  for (const day of ICKE_HELTAL) {
    assert.throws(() => toIsoDate({ year: 2026, month: 1, day }), RangeError, String(day));
  }
  for (const day of [0, -1, 32]) {
    assert.throws(() => toIsoDate({ year: 2026, month: 1, day }), RangeError, String(day));
  }
});

test('toIsoDate släpper aldrig ut -0 i strängen', () => {
  assert.equal(toIsoDate({ year: -0, month: 1, day: 1 }), '0000-01-01');
  assert.throws(() => toIsoDate({ year: 2026, month: 1, day: -0 }), RangeError);
  assert.equal(toIsoDate({ year: 2026, month: -0 + 1, day: 1 }), '2026-01-01');
});

test('addMonthsClamped lägger till hela månader och behåller dagen när den ryms', () => {
  assert.equal(addMonthsClamped('2026-08-18', 0), '2026-08-18');
  assert.equal(addMonthsClamped('2026-08-18', 1), '2026-09-18');
  assert.equal(addMonthsClamped('2026-08-18', 12), '2027-08-18');
  assert.equal(addMonthsClamped('2026-01-15', 3), '2026-04-15');
});

test('addMonthsClamped klampar till sista dagen i en kortare målmånad', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28', 'februari är kortare');
  assert.equal(addMonthsClamped('2024-01-31', 1), '2024-02-29', 'skottår');
  assert.equal(addMonthsClamped('2026-03-31', 1), '2026-04-30', 'april har 30 dagar');
  assert.equal(addMonthsClamped('2024-02-29', 12), '2025-02-28', 'skottdag till normalår');
  assert.equal(addMonthsClamped('2024-02-29', 48), '2028-02-29', 'skottdag till skottår');
});

test('addMonthsClamped utgår alltid från startdatumets ursprungliga dag', () => {
  assert.equal(addMonthsClamped('2026-01-31', 1), '2026-02-28');
  assert.equal(addMonthsClamped('2026-01-31', 2), '2026-03-31');
  assert.equal(addMonthsClamped('2026-01-31', 3), '2026-04-30');
  assert.equal(addMonthsClamped('2026-01-31', 4), '2026-05-31');
  assert.notEqual(addMonthsClamped('2026-01-31', 2), addMonthsClamped('2026-02-28', 1));
});

test('addMonthsClamped räknar bakåt för ett negativt antal månader', () => {
  assert.equal(addMonthsClamped('2026-03-31', -1), '2026-02-28');
  assert.equal(addMonthsClamped('2026-01-15', -1), '2025-12-15');
  assert.equal(addMonthsClamped('2026-01-15', -13), '2024-12-15');
  assert.equal(addMonthsClamped('2026-08-18', -0), '2026-08-18', '-0 är noll månader');
});

test('addMonthsClamped kastar RangeError för ett datum som inte är ÅÅÅÅ-MM-DD', () => {
  for (const value of ['2026-1-5', '2026-02-30', '2026-13-01', '', ' 2026-08-18', 20260818, null, undefined, 1n, Symbol('x'), {}, []]) {
    assert.throws(() => addMonthsClamped(value, 1), RangeError, String(value));
  }
  assert.throws(() => addMonthsClamped('2026-13-01', 1), {
    name: 'RangeError',
    message: 'addMonthsClamped kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "2026-13-01".'
  });
});

test('addMonthsClamped kastar RangeError för ett antal månader som inte är ett heltal', () => {
  for (const months of ICKE_HELTAL) {
    assert.throws(() => addMonthsClamped('2026-08-18', months), RangeError, String(months));
  }
  assert.throws(() => addMonthsClamped('2026-08-18', NaN), {
    name: 'RangeError',
    message: 'addMonthsClamped kräver ett heltal månader, fick "NaN".'
  });
});

test('addMonthsClamped kastar RangeError när målåret hamnar utanför fyra siffror', () => {
  assert.throws(() => addMonthsClamped('2026-08-18', 1000000), {
    name: 'RangeError',
    message: /^toIsoDate kräver ett år med fyra siffror/
  });
  assert.throws(() => addMonthsClamped('2026-08-18', -1000000), RangeError);
  assert.throws(() => addMonthsClamped('2026-08-18', Number.MAX_SAFE_INTEGER), RangeError);
});

test('compareIsoDates ger -1, 0 eller 1', () => {
  assert.equal(compareIsoDates('2026-01-01', '2026-01-02'), -1);
  assert.equal(compareIsoDates('2026-01-02', '2026-01-01'), 1);
  assert.equal(compareIsoDates('2026-01-01', '2026-01-01'), 0);
  assert.equal(compareIsoDates('2025-12-31', '2026-01-01'), -1, 'årsskifte');
  assert.equal(compareIsoDates('2026-09-01', '2026-10-01'), -1, 'ensiffrig mot tvåsiffrig månad');
  assert.equal(compareIsoDates('2026-01-09', '2026-01-10'), -1, 'ensiffrig mot tvåsiffrig dag');
});

test('compareIsoDates returnerar aldrig -0', () => {
  assert.equal(Object.is(compareIsoDates('2026-01-01', '2026-01-01'), -0), false);
});

test('compareIsoDates kastar RangeError för ett ogiltigt första argument', () => {
  for (const value of ['2026-1-5', '2026-02-30', '', null, undefined, 20260101, 1n, Symbol('x'), NaN, Infinity, -Infinity, -0, {}, []]) {
    assert.throws(() => compareIsoDates(value, '2026-01-01'), RangeError, String(value));
  }
  assert.throws(() => compareIsoDates('abc', '2026-01-01'), {
    name: 'RangeError',
    message: 'compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "abc" som första argument.'
  });
});

test('compareIsoDates kastar RangeError för ett ogiltigt andra argument', () => {
  for (const value of ['2026-1-5', '2026-02-30', '', null, undefined, 20260101, 1n, Symbol('x'), NaN, Infinity, -Infinity, -0, {}, []]) {
    assert.throws(() => compareIsoDates('2026-01-01', value), RangeError, String(value));
  }
  assert.throws(() => compareIsoDates('2026-01-01', 'abc'), {
    name: 'RangeError',
    message: 'compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "abc" som andra argument.'
  });
});

test('daysBetween räknar framåt, bakåt och till noll', () => {
  assert.equal(daysBetween('2026-08-18', '2026-08-18'), 0);
  assert.equal(daysBetween('2026-08-18', '2026-08-19'), 1);
  assert.equal(daysBetween('2026-08-19', '2026-08-18'), -1);
  assert.equal(daysBetween('2026-01-01', '2026-03-01'), 59, 'normalår');
  assert.equal(daysBetween('2024-01-01', '2024-03-01'), 60, 'skottår');
  assert.equal(daysBetween('2026-01-01', '2027-01-01'), 365);
  assert.equal(daysBetween('2024-01-01', '2025-01-01'), 366);
});

test('daysBetween påverkas inte av sommartid — räkningen sker i UTC', () => {
  assert.equal(daysBetween('2026-03-28', '2026-03-30'), 2);
  assert.equal(daysBetween('2026-10-24', '2026-10-26'), 2);
  assert.equal(daysBetween('2026-03-01', '2026-11-01'), 245);
});

test('daysBetween räknar rätt även för år under 100, där Date.UTC annars tolkar om året', () => {
  assert.equal(daysBetween('0099-12-31', '0100-01-01'), 1);
  assert.equal(daysBetween('0050-01-01', '0050-01-02'), 1);
  assert.equal(daysBetween('0000-01-01', '0000-12-31'), 365, 'år 0 är ett skottår');
});

test('daysBetween returnerar ett heltal och aldrig -0', () => {
  for (const [from, to] of [['2026-08-18', '2026-08-18'], ['2026-08-18', '2026-08-19'], ['2026-08-19', '2026-08-18'], ['1970-01-01', '2099-12-31']]) {
    const dagar = daysBetween(from, to);
    assert.equal(Number.isSafeInteger(dagar), true, from + ' ' + to);
    assert.equal(Object.is(dagar, -0), false, from + ' ' + to);
  }
});

test('daysBetween kastar RangeError för ett ogiltigt argument', () => {
  for (const value of ['2026-1-5', '2026-02-30', '2026-13-01', '', null, undefined, 20260101, 1n, Symbol('x'), NaN, Infinity, -Infinity, -0, {}, []]) {
    assert.throws(() => daysBetween(value, '2026-01-01'), RangeError, String(value));
    assert.throws(() => daysBetween('2026-01-01', value), RangeError, String(value));
  }
  assert.throws(() => daysBetween('abc', '2026-01-01'), {
    name: 'RangeError',
    message: 'daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "abc" som första argument.'
  });
  assert.throws(() => daysBetween('2026-01-01', 'abc'), {
    name: 'RangeError',
    message: 'daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "abc" som andra argument.'
  });
});

test('todayIso ger det lokala datumet för ett inskickat Date', () => {
  assert.equal(todayIso(new Date(2026, 7, 18, 12, 0)), '2026-08-18');
  assert.equal(todayIso(new Date(2026, 7, 18, 0, 0)), '2026-08-18', 'strax efter midnatt');
  assert.equal(todayIso(new Date(2026, 7, 18, 23, 59, 59)), '2026-08-18', 'strax före midnatt');
  assert.equal(todayIso(new Date(2026, 0, 5)), '2026-01-05', 'nollutfyllt');
  assert.equal(todayIso(new Date(2024, 1, 29)), '2024-02-29', 'skottdag');
  assert.equal(todayIso(new Date(2026, 11, 31)), '2026-12-31');
});

test('todayIso utan argument läser klockan och ger ett datum modulen själv godkänner', () => {
  const idag = todayIso();
  assert.equal(isValidIsoDate(idag), true, idag);
  assert.equal(idag, todayIso(new Date()));
});

test('todayIso kastar RangeError för allt som inte är ett giltigt Date', () => {
  for (const value of ['2026-08-18', 0, NaN, Infinity, -Infinity, -0, null, 1n, Symbol('x'), {}, [], true]) {
    assert.throws(() => todayIso(value), RangeError, String(value));
  }
  assert.equal(todayIso(undefined), todayIso(), 'undefined ger standardargumentet');
  assert.throws(() => todayIso('2026-08-18'), {
    name: 'RangeError',
    message: 'todayIso kräver ett Date, fick "2026-08-18".'
  });
  assert.throws(() => todayIso(new Date(NaN)), {
    name: 'RangeError',
    message: 'todayIso kräver ett Date som visar ett datum, fick ett ogiltigt Date.'
  });
  assert.throws(() => todayIso(new Date('inte ett datum')), RangeError);
});

test('nowIso ger tidsstämpeln i UTC på formen toISOString ger', () => {
  assert.equal(nowIso(new Date(Date.UTC(2026, 8, 24, 18, 3, 0))), '2026-09-24T18:03:00.000Z');
  assert.equal(nowIso(new Date(Date.UTC(2026, 0, 5, 0, 0, 0, 7))), '2026-01-05T00:00:00.007Z', 'millisekunder');
  assert.equal(nowIso(new Date(Date.UTC(2024, 1, 29, 23, 59, 59, 999))), '2024-02-29T23:59:59.999Z', 'skottdag');
  assert.equal(nowIso(new Date(Date.UTC(2026, 8, 24))).length, 24);
  assert.equal(
    nowIso(new Date(Date.UTC(2026, 8, 24, 9))) < nowIso(new Date(Date.UTC(2026, 8, 24, 10))),
    true,
    'texten sorterar som tiden'
  );
});

test('nowIso utan argument läser klockan och ger en stämpel modulen själv godkänner', () => {
  const nu = nowIso();
  assert.match(nu, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.equal(isValidIsoDate(nu.slice(0, 10)), true, nu);
});

test('nowIso kastar RangeError för allt som inte är ett giltigt Date', () => {
  for (const value of ['2026-09-24T18:03:00.000Z', 0, NaN, Infinity, -Infinity, -0, null, 1n, Symbol('x'), {}, [], true]) {
    assert.throws(() => nowIso(value), RangeError, String(value));
  }
  assert.throws(() => nowIso('2026-09-24T18:03:00.000Z'), {
    name: 'RangeError',
    message: 'nowIso kräver ett Date, fick "2026-09-24T18:03:00.000Z".'
  });
  assert.throws(() => nowIso(new Date(NaN)), {
    name: 'RangeError',
    message: 'nowIso kräver ett Date som visar en tidpunkt, fick ett ogiltigt Date.'
  });
});

test('MD1: isValidIsoMonth godkänner januari och december i ett år', () => {
  assert.equal(isValidIsoMonth('2026-01'), true);
  assert.equal(isValidIsoMonth('2026-12'), true);
  assert.equal(isValidIsoMonth('1970-01'), true);
  assert.equal(isValidIsoMonth('0001-06'), true);
});

test('MD2: månadsdelen 00 och 13 avvisas fastän mönstret matchar', () => {
  for (const value of ['2026-00', '2026-13', '2026-99']) {
    assert.equal(ISO_MONTH_PATTERN.test(value), true, `mönstret borde matcha ${value}`);
    assert.equal(isValidIsoMonth(value), false, value);
  }
});

test('MD3: fel form avvisas av isValidIsoMonth', () => {
  const fel = ['2026-1', '2026-01-01', '', '2026', '26-01', ' 2026-01', '2026-01 ', '2e3-01', '2026-0x'];
  for (const value of fel) {
    assert.equal(isValidIsoMonth(value), false, value);
  }
  for (const value of [202601, 2026.01, 0, NaN, Infinity, null, undefined, true, {}, ['2026-01'], new Date(), 1n, Symbol('x')]) {
    assert.equal(isValidIsoMonth(value), false, String(value));
  }
});

test('MD4: firstDayOfMonth ger månadens första dag', () => {
  assert.equal(firstDayOfMonth('2026-02'), '2026-02-01');
  assert.equal(firstDayOfMonth('2026-12'), '2026-12-01');
  assert.equal(isValidIsoDate(firstDayOfMonth('2026-02')), true);
});

test('MD5: monthOfIsoDate ger datumets månad', () => {
  assert.equal(monthOfIsoDate('2026-02-28'), '2026-02');
  assert.equal(monthOfIsoDate('2024-02-29'), '2024-02');
  assert.equal(monthOfIsoDate('2026-12-31'), '2026-12');
  assert.equal(isValidIsoMonth(monthOfIsoDate('2026-02-28')), true);
});

test('MD6: shiftMonth över årsskiftet i båda riktningarna', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('MD7: shiftMonth med 0 ger samma månad tillbaka', () => {
  for (const month of ['2026-01', '2026-06', '2026-12']) {
    assert.equal(shiftMonth(month, 0), month);
  }
});

test('MD8: shiftMonth trettio månader framåt och bakåt', () => {
  assert.equal(shiftMonth('2026-05', 30), '2028-11');
  assert.equal(shiftMonth('2026-05', -30), '2023-11');
});

test('MD9: compareMonths ger -1, 1 och 0', () => {
  assert.equal(compareMonths('2026-01', '2026-02'), -1);
  assert.equal(compareMonths('2026-02', '2026-01'), 1);
  assert.equal(compareMonths('2026-02', '2026-02'), 0);
  assert.equal(compareMonths('2026-12', '2027-01'), -1);
  assert.equal(compareMonths('2027-01', '2026-12'), 1);
  assert.equal(Object.is(compareMonths('2026-02', '2026-02'), -0), false);
});

test('MD10: firstDayOfMonth kastar med sitt eget meddelande', () => {
  for (const value of ['2026-13', '2026-00', '2026-1', '2026-01-01', '', null, undefined, 202601, 1n, Symbol('x'), {}, []]) {
    assert.throws(
      () => firstDayOfMonth(value),
      { name: 'RangeError', message: `firstDayOfMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".` },
      String(value)
    );
  }
});

test('MD10: monthOfIsoDate kastar med sitt eget meddelande', () => {
  for (const value of ['2026-02-31', '2026-13-01', '2026-02', '', null, undefined, 20260228, 1n, Symbol('x'), {}, []]) {
    assert.throws(
      () => monthOfIsoDate(value),
      { name: 'RangeError', message: `monthOfIsoDate kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(value)}".` },
      String(value)
    );
  }
});

test('MD10: shiftMonth kastar för en månad som inte är en månad', () => {
  for (const value of ['2026-13', '2026-1', '', null, undefined, 202601, 1n, Symbol('x')]) {
    assert.throws(
      () => shiftMonth(value, 1),
      { name: 'RangeError', message: `shiftMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".` },
      String(value)
    );
  }
});

test('MD10: shiftMonth kastar för ett antal månader som inte är ett säkert heltal', () => {
  for (const value of [1.5, NaN, Infinity, -Infinity, 1e300, '1', null, undefined, true, 1n, Symbol('x'), {}]) {
    assert.throws(
      () => shiftMonth('2026-01', value),
      { name: 'RangeError', message: `shiftMonth kräver ett heltal månader, fick "${String(value)}".` },
      String(value)
    );
  }
  assert.equal(shiftMonth('2026-01', -0), '2026-01');
});

test('MD10: shiftMonth ärver årsgränsen från toIsoDate och skriver dess namn', () => {
  assert.throws(() => shiftMonth('9999-12', 1), {
    name: 'RangeError',
    message: 'toIsoDate kräver ett år med fyra siffror, fick "10000".'
  });
});

test('MD10: compareMonths kastar för vilket som helst av de två argumenten', () => {
  for (const value of ['2026-13', '2026-1', '', null, undefined, 202601, 1n, Symbol('x')]) {
    const message = `compareMonths kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".`;
    assert.throws(() => compareMonths(value, '2026-01'), { name: 'RangeError', message }, `första: ${String(value)}`);
    assert.throws(() => compareMonths('2026-01', value), { name: 'RangeError', message }, `andra: ${String(value)}`);
  }
  assert.throws(() => compareMonths('a', 'b'), {
    name: 'RangeError',
    message: 'compareMonths kräver en månad på formen ÅÅÅÅ-MM, fick "a".'
  });
});


test('MONTH_NAMES har tolv namn i kalenderordning och går inte att skriva om', () => {
  assert.equal(MONTH_NAMES.length, 12);
  assert.equal(MONTH_NAMES[0], 'januari');
  assert.equal(MONTH_NAMES[11], 'december');
  assert.equal(Object.isFrozen(MONTH_NAMES), true);
  assert.equal(new Set(MONTH_NAMES).size, 12);
  for (const name of MONTH_NAMES) {
    assert.equal(name.length > 2, true, name);
  }
});

test('monthName ger månadens namn i gemener', () => {
  assert.equal(monthName('2026-01'), 'januari');
  assert.equal(monthName('2026-09'), 'september');
  assert.equal(monthName('2026-10'), 'oktober');
  assert.equal(monthName('2026-12'), 'december');
  for (let nummer = 1; nummer <= 12; nummer += 1) {
    const manad = `2026-${String(nummer).padStart(2, '0')}`;
    assert.equal(monthName(manad), MONTH_NAMES[nummer - 1], manad);
  }
});

test('monthName kastar för allt som inte är en månad', () => {
  for (const value of ['2026-13', '2026-00', '2026-1', '2026-01-01', '', null, undefined, 202601, 1n, Symbol('x')]) {
    assert.throws(
      () => monthName(value),
      { name: 'RangeError', message: `monthName kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".` },
      String(value)
    );
  }
});

test('monthLabel ger versal begynnelsebokstav och året', () => {
  assert.equal(monthLabel('2026-09'), 'September 2026');
  assert.equal(monthLabel('2027-01'), 'Januari 2027');
  assert.equal(monthLabel('2025-12'), 'December 2025');
});

test('monthLabel ärver spärren från monthName och skriver dess namn', () => {
  assert.throws(() => monthLabel('2026-13'), {
    name: 'RangeError',
    message: 'monthName kräver en månad på formen ÅÅÅÅ-MM, fick "2026-13".'
  });
});
