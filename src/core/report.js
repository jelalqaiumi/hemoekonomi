import { isValidIsoMonth } from './dates.js';
import { CATEGORIES, isPlainObject } from './entry.js';
import { ITEM_KINDS } from './item.js';
import { sumByKind } from './budget.js';
import { divideRoundHalfUp, normalizeZero } from './money.js';

const MESSAGES = Object.freeze({
  notAList: 'reportRows kräver en lista med månader.',
  empty: 'reportRows kräver minst en månad.',
  notAnObject: (i) => `reportRows kräver ett objekt per månad, index ${i}.`,
  badMonth: (i) => `reportRows kräver en månad på formen ÅÅÅÅ-MM, index ${i}.`,
  badItems: (i) => `reportRows kräver en lista med poster, index ${i}.`,
  badBudgets: (i) => `reportRows kräver en lista med budgetar, index ${i}.`,
  badOrder: (i) => `reportRows kräver månaderna i stigande ordning, index ${i}.`,
  badBudgetLine: (i, j) => `reportRows kräver ett objekt per budgetrad, index ${i} rad ${j}.`,
  badBudgetAmount: (i, j) => `reportRows kräver ett belopp i heltal ören per budgetrad, index ${i} rad ${j}.`
});

const BUDGETED_KIND = 'expense';

function checkMonthsData(monthsData) {
  if (!Array.isArray(monthsData)) {
    throw new RangeError(MESSAGES.notAList);
  }
  if (monthsData.length === 0) {
    throw new RangeError(MESSAGES.empty);
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!isPlainObject(monthsData[i])) {
      throw new RangeError(MESSAGES.notAnObject(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!isValidIsoMonth(monthsData[i].month)) {
      throw new RangeError(MESSAGES.badMonth(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!Array.isArray(monthsData[i].items)) {
      throw new RangeError(MESSAGES.badItems(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (!Array.isArray(monthsData[i].budgets)) {
      throw new RangeError(MESSAGES.badBudgets(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    if (i > 0 && monthsData[i].month <= monthsData[i - 1].month) {
      throw new RangeError(MESSAGES.badOrder(i));
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    for (let j = 0; j < monthsData[i].budgets.length; j += 1) {
      if (!isPlainObject(monthsData[i].budgets[j])) {
        throw new RangeError(MESSAGES.badBudgetLine(i, j));
      }
    }
  }
  for (let i = 0; i < monthsData.length; i += 1) {
    for (let j = 0; j < monthsData[i].budgets.length; j += 1) {
      if (!Number.isSafeInteger(monthsData[i].budgets[j].amountOre)) {
        throw new RangeError(MESSAGES.badBudgetAmount(i, j));
      }
    }
  }
}

function itemsInCategory(items, category) {
  return items.filter((item) => !isPlainObject(item) || item.category === category);
}

export function reportRows(monthsData) {
  checkMonthsData(monthsData);

  const months = monthsData.map((month) => month.month);

  const budgetByCategory = monthsData.map((month) => new Map(
    month.budgets.map((line) => [line.category, normalizeZero(line.amountOre)])
  ));

  const rows = [];
  for (const kind of ITEM_KINDS) {
    for (const category of CATEGORIES) {
      const perMonthOre = monthsData.map((month) => sumByKind(itemsInCategory(month.items, category), kind));

      const totalOre = sumByKind(
        monthsData.flatMap((month) => itemsInCategory(month.items, category)),
        kind
      );

      const budgetPerMonthOre = budgetByCategory.map((byCategory) => {
        if (kind !== BUDGETED_KIND) {
          return null;
        }
        if (!byCategory.has(category)) {
          return null;
        }
        return byCategory.get(category);
      });

      const hasAmount = perMonthOre.some((ore) => ore !== 0);
      const hasBudget = budgetPerMonthOre.some((ore) => ore !== null);
      if (!hasAmount && !hasBudget) {
        continue;
      }

      let overBudgetMonths = 0;
      for (let i = 0; i < perMonthOre.length; i += 1) {
        if (budgetPerMonthOre[i] !== null && perMonthOre[i] > budgetPerMonthOre[i]) {
          overBudgetMonths += 1;
        }
      }

      rows.push({
        kind,
        category,
        perMonthOre,
        totalOre,
        averageOre: divideRoundHalfUp(totalOre, monthsData.length),
        budgetPerMonthOre,
        overBudgetMonths
      });
    }
  }

  let largestRow = null;
  for (const row of rows) {
    if (largestRow === null || row.totalOre > largestRow.totalOre) {
      largestRow = row;
    }
  }
  const largest = largestRow === null ? null : { kind: largestRow.kind, category: largestRow.category };

  return { months, rows, largest };
}
