import { isValidIsoMonth } from './dates.js';
import { CATEGORY_LABELS, isPlainObject } from './entry.js';
import { ITEM_KIND_LABELS } from './item.js';

const HEADER = Object.freeze(['Slag', 'Kategori', 'Månad', 'Belopp', 'Tak', 'Över tak']);

const OVER_BUDGET_YES = 'Ja';
const OVER_BUDGET_NO = 'Nej';

const EMPTY = '';

const FILE_PREFIX = 'hemochekonomi-';
const FILE_SUFFIX = '.csv';

const MESSAGES = Object.freeze({
  notAnObject: 'reportCsvRows kräver en rapport som objekt.',
  badMonths: 'reportCsvRows kräver en lista med månader.',
  badRows: 'reportCsvRows kräver en lista med rader.',
  badRow: (i) => `reportCsvRows kräver ett objekt per rad, index ${i}.`,
  badAmountCount: (i) => `reportCsvRows kräver ett belopp per månad, index ${i}.`,
  badBudgetCount: (i) => `reportCsvRows kräver ett tak per månad, index ${i}.`,
  badFileMonth: 'reportFileName kräver en månad på formen ÅÅÅÅ-MM.'
});

function checkReport(report) {
  if (!isPlainObject(report)) {
    throw new RangeError(MESSAGES.notAnObject);
  }
  if (!Array.isArray(report.months)) {
    throw new RangeError(MESSAGES.badMonths);
  }
  if (!Array.isArray(report.rows)) {
    throw new RangeError(MESSAGES.badRows);
  }
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!isPlainObject(report.rows[i])) {
      throw new RangeError(MESSAGES.badRow(i));
    }
  }
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!Array.isArray(report.rows[i].perMonthOre)
      || report.rows[i].perMonthOre.length !== report.months.length) {
      throw new RangeError(MESSAGES.badAmountCount(i));
    }
  }
  for (let i = 0; i < report.rows.length; i += 1) {
    if (!Array.isArray(report.rows[i].budgetPerMonthOre)
      || report.rows[i].budgetPerMonthOre.length !== report.months.length) {
      throw new RangeError(MESSAGES.badBudgetCount(i));
    }
  }
}

export function reportCsvRows(report) {
  checkReport(report);

  const rows = [HEADER.map((text) => ({ text }))];

  for (let i = 0; i < report.rows.length; i += 1) {
    const row = report.rows[i];
    for (let m = 0; m < report.months.length; m += 1) {
      const budgetOre = row.budgetPerMonthOre[m];
      const amountOre = row.perMonthOre[m];

      rows.push([
        { text: ITEM_KIND_LABELS[row.kind] },
        { text: CATEGORY_LABELS[row.category] },
        { text: report.months[m] },
        { amountOre },
        budgetOre === null ? { text: EMPTY } : { amountOre: budgetOre },
        budgetOre === null
          ? { text: EMPTY }
          : { text: amountOre > budgetOre ? OVER_BUDGET_YES : OVER_BUDGET_NO }
      ]);
    }
  }

  return rows;
}

export function reportFileName(endMonth) {
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(MESSAGES.badFileMonth);
  }
  return `${FILE_PREFIX}${endMonth}${FILE_SUFFIX}`;
}
