import { isValidIsoMonth, shiftMonth } from '../core/dates.js';
import { reportRows } from '../core/report.js';
import { getDatabase } from './db.js';
import { OVERVIEW_MAX_MONTHS, OVERVIEW_MIN_MONTHS, readMonth } from './months.js';

export async function readReport(userId, endMonth, count, { db = getDatabase() } = {}) {
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(`readReport kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".`);
  }
  if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {
    throw new RangeError(`readReport kräver ett antal månader mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}, fick "${String(count)}".`);
  }

  const monthsData = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    const { items, budgets } = await readMonth(userId, month, { db });
    monthsData.push({ month, items, budgets });
  }

  return reportRows(monthsData);
}
