import { isPlainObject } from './entry.js';
import { isItemKind } from './item.js';
import { normalizeZero } from './money.js';

const MESSAGES = Object.freeze({
  notAList: 'monthTotals kräver en lista med poster.',
  notAnObject: 'monthTotals kräver poster som objekt.',
  unknownKind: (value) => `monthTotals kräver ett känt slag, fick "${String(value)}".`,
  badAmount: 'monthTotals kräver ett belopp i heltal ören.',
  unsafeSum: 'monthTotals kräver att summan är ett säkert heltal.'
});

function checkItems(items) {
  if (!Array.isArray(items)) {
    throw new RangeError(MESSAGES.notAList);
  }
  for (const item of items) {
    if (!isPlainObject(item)) {
      throw new RangeError(MESSAGES.notAnObject);
    }
  }
  for (const item of items) {
    if (!isItemKind(item.kind)) {
      throw new RangeError(MESSAGES.unknownKind(item.kind));
    }
  }
  for (const item of items) {
    if (!Number.isSafeInteger(item.amountOre)) {
      throw new RangeError(MESSAGES.badAmount);
    }
  }
}

export function sumByKind(items, kind) {
  checkItems(items);
  if (!isItemKind(kind)) {
    throw new RangeError(MESSAGES.unknownKind(kind));
  }
  let sum = 0;
  for (const item of items) {
    if (item.kind !== kind) {
      continue;
    }
    sum += item.amountOre;
    if (!Number.isSafeInteger(sum)) {
      throw new RangeError(MESSAGES.unsafeSum);
    }
  }
  return sum;
}

export function monthTotals(items) {
  const incomeOre = sumByKind(items, 'income');
  const expenseOre = sumByKind(items, 'expense');
  const savingOre = sumByKind(items, 'saving');
  let leftOre = incomeOre - expenseOre;
  if (!Number.isSafeInteger(leftOre)) {
    throw new RangeError(MESSAGES.unsafeSum);
  }
  leftOre -= savingOre;
  if (!Number.isSafeInteger(leftOre)) {
    throw new RangeError(MESSAGES.unsafeSum);
  }
  return {
    incomeOre,
    expenseOre,
    savingOre,
    leftOre: normalizeZero(leftOre)
  };
}
