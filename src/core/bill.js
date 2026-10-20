import { addMonthsClamped, compareIsoDates, daysBetween, isValidIsoDate } from './dates.js';
import { checkAmountSek, checkInterval, checkName, isPlainObject } from './entry.js';
import { sekToOre } from './money.js';
import { MONTHS_PER_PERIOD, nextDueDate } from './schedule.js';

export const BILL_STATUSES = Object.freeze(['betald', 'forfallen', 'paminnelse', 'kommande']);

const [PAID, OVERDUE, REMINDER, UPCOMING] = BILL_STATUSES;

export const REMIND_DAYS_MIN = 0;
export const REMIND_DAYS_MAX = 30;
export const REMIND_DAYS_DEFAULT = 3;

const MESSAGES = Object.freeze({
  dueDate: 'Förfallodag måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD.',
  interval: 'Välj Engångs, månadsvis, kvartalsvis, halvårsvis eller årsvis.',
  remindDays: `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`
});

export function billStatus(bill, today) {
  if (!isPlainObject(bill)) {
    throw new RangeError('billStatus kräver en räkning som objekt.');
  }
  if (!isValidBillPaidAt(bill.paidAt)) {
    throw new RangeError(`billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "${String(bill.paidAt)}".`);
  }
  if (!isValidRemindDays(bill.remindDays)) {
    throw new RangeError(`billStatus kräver ett remindDays mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX}, fick "${String(bill.remindDays)}".`);
  }
  if (bill.paidAt !== null) {
    return PAID;
  }
  if (compareIsoDates(bill.dueDate, today) < 0) {
    return OVERDUE;
  }
  if (daysUntilDue(bill.dueDate, today) <= bill.remindDays) {
    return REMINDER;
  }
  return UPCOMING;
}

export function daysUntilDue(dueDate, today) {
  return daysBetween(today, dueDate);
}

export function billDaysText(daysUntil) {
  if (!Number.isInteger(daysUntil)) {
    throw new RangeError(`billDaysText kräver ett heltal dagar, fick "${String(daysUntil)}".`);
  }
  const antal = Math.abs(daysUntil);
  if (daysUntil <= -2) {
    return `Förföll för ${antal} dagar sedan`;
  }
  if (daysUntil === -1) {
    return 'Förföll igår';
  }
  if (daysUntil === 0) {
    return 'Förfaller idag';
  }
  if (daysUntil === 1) {
    return 'Förfaller imorgon';
  }
  return `Förfaller om ${antal} dagar`;
}

export function nextBillDueDate(bill, today) {
  if (!isPlainObject(bill)) {
    throw new RangeError('nextBillDueDate kräver en räkning som objekt.');
  }
  if (!Object.hasOwn(MONTHS_PER_PERIOD, bill.interval)) {
    throw new RangeError(`nextBillDueDate kräver ett känt interval, fick "${String(bill.interval)}".`);
  }
  const series = { interval: bill.interval, startDate: bill.anchorDate };
  const afterPaid = addMonthsClamped(bill.dueDate, MONTHS_PER_PERIOD[bill.interval]);
  const from = compareIsoDates(today, afterPaid) > 0 ? today : afterPaid;
  return nextDueDate(series, from);
}

export function validateBillDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    value.amountOre = sekToOre(amount.value);
  }

  const dueDate = checkDueDate(source.dueDate);
  if (dueDate.message) {
    errors.push({ field: 'dueDate', message: dueDate.message });
  } else {
    value.dueDate = dueDate.value;
  }

  const interval = checkBillInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const remindDays = checkRemindDays(source.remindDays);
  if (remindDays.message) {
    errors.push({ field: 'remindDays', message: remindDays.message });
  } else {
    value.remindDays = remindDays.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

function checkDueDate(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.dueDate };
  }
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.dueDate };
  }
  return { value: trimmed };
}

function checkBillInterval(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.interval };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  const result = checkInterval(trimmed);
  if (result.message) {
    return { message: MESSAGES.interval };
  }
  return { value: result.value };
}

function checkRemindDays(raw) {
  if (raw === undefined || raw === null) {
    return { value: REMIND_DAYS_DEFAULT };
  }
  let days = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (trimmed === '') {
      return { value: REMIND_DAYS_DEFAULT };
    }
    if (trimmed.length > 4 || !/^-?\d{1,3}$/.test(trimmed)) {
      return { message: MESSAGES.remindDays };
    }
    days = Number(trimmed);
  }
  if (!isValidRemindDays(days)) {
    return { message: MESSAGES.remindDays };
  }
  return { value: days };
}

function isValidRemindDays(value) {
  return Number.isInteger(value) && value >= REMIND_DAYS_MIN && value <= REMIND_DAYS_MAX;
}

function isValidBillPaidAt(value) {
  return value === null || (typeof value === 'string' && value.trim() !== '');
}
