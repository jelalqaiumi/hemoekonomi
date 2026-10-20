import { divideRoundHalfUp, sekToOre } from './money.js';
import { isPlainObject } from './entry.js';

export const PAYMENTS_PER_YEAR = Object.freeze({
  monthly: 12,
  quarterly: 4,
  semiannual: 2,
  yearly: 1
});

export const MONTHS_PER_YEAR = 12;

export function yearlyOre(entry) {
  if (!isPlainObject(entry)) {
    throw new RangeError('yearlyOre kräver en post som objekt.');
  }
  if (!Object.hasOwn(PAYMENTS_PER_YEAR, entry.interval)) {
    throw new RangeError(`yearlyOre kräver ett känt interval, fick "${String(entry.interval)}".`);
  }
  const amountOre = sekToOre(entry.amountSek);
  if (amountOre < 0) {
    throw new RangeError('yearlyOre kräver ett belopp som inte är negativt.');
  }
  const totalOre = amountOre * PAYMENTS_PER_YEAR[entry.interval];
  if (!Number.isSafeInteger(totalOre)) {
    throw new RangeError('yearlyOre kräver att årsbeloppet är ett säkert heltal.');
  }
  return totalOre;
}

export function monthlyOre(entry) {
  return divideRoundHalfUp(yearlyOre(entry), MONTHS_PER_YEAR);
}

export function totalYearlyOre(entries) {
  if (!Array.isArray(entries)) {
    throw new RangeError('totalYearlyOre kräver en lista med poster.');
  }
  let sum = 0;
  for (const entry of entries) {
    sum += yearlyOre(entry);
  }
  if (!Number.isSafeInteger(sum)) {
    throw new RangeError('totalYearlyOre kräver att summan är ett säkert heltal.');
  }
  return sum;
}

export function totalMonthlyOre(entries) {
  return divideRoundHalfUp(totalYearlyOre(entries), MONTHS_PER_YEAR);
}
