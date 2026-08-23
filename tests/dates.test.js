import { test } from 'node:test';
import assert from 'node:assert/strict';

import { ISO_DATE_PATTERN, daysInMonth, isValidIsoDate, parseIsoDate } from '../src/core/dates.js';

// Endast de tre funktioner som finns i modulen testas här. Resten av
// gränssnittet i ARKITEKTUR.md (toIsoDate, addMonthsClamped, compareIsoDates,
// daysBetween, todayIso) byggs i senare paket och testas då.

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

// ARKITEKTUR.md anger `daysInMonth(year, month): number` med kommentaren
// "month 1-12" och kräver inget kastat fel. Där ett kast är avsett står det
// uttryckligen (RangeError i divideRoundHalfUp och sekToOre). Kontraktet är
// alltså att funktionen returnerar ett tal; 0 är den enda returen som aldrig
// kan förväxlas med en verklig månadslängd, och parseIsoDate förlitar sig på
// att jämförelsen `day > daysInMonth(...)` alltid går att göra.
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
