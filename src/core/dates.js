export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const ISO_MONTH_PATTERN = /^\d{4}-\d{2}$/;

const MONTHS_PER_YEAR = 12;

const UTC_ANCHOR_YEAR = 2000;

const MS_PER_DAY = 86400000;

export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return lengths[month - 1];
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function isValidIsoDate(value) {
  return parseIsoDate(value) !== null;
}

export function toIsoDate(parts) {
  const year = parts?.year;
  const month = parts?.month;
  const day = parts?.day;
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`toIsoDate kräver ett år med fyra siffror, fick "${String(year)}".`);
  }
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`toIsoDate kräver ett datum som finns i kalendern, fick "${String(year)}-${String(month)}-${String(day)}".`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

export function addMonthsClamped(isoDate, months) {
  const start = parseIsoDate(isoDate);
  if (start === null) {
    throw new RangeError(`addMonthsClamped kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(isoDate)}".`);
  }
  if (!Number.isInteger(months)) {
    throw new RangeError(`addMonthsClamped kräver ett heltal månader, fick "${String(months)}".`);
  }
  const index = start.year * MONTHS_PER_YEAR + (start.month - 1) + months;
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = index - year * MONTHS_PER_YEAR + 1;
  return toIsoDate({ year, month, day: Math.min(start.day, daysInMonth(year, month)) });
}

export function compareIsoDates(a, b) {
  if (!isValidIsoDate(a)) {
    throw new RangeError(`compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(a)}" som första argument.`);
  }
  if (!isValidIsoDate(b)) {
    throw new RangeError(`compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(b)}" som andra argument.`);
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export function daysBetween(fromIso, toIso) {
  const from = parseIsoDate(fromIso);
  if (from === null) {
    throw new RangeError(`daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(fromIso)}" som första argument.`);
  }
  const to = parseIsoDate(toIso);
  if (to === null) {
    throw new RangeError(`daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(toIso)}" som andra argument.`);
  }
  return (utcMs(to) - utcMs(from)) / MS_PER_DAY;
}

export function isValidIsoMonth(value) {
  if (typeof value !== 'string' || !ISO_MONTH_PATTERN.test(value)) {
    return false;
  }
  return daysInMonth(Number(value.slice(0, 4)), Number(value.slice(5, 7))) > 0;
}

export function firstDayOfMonth(month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`firstDayOfMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
  return `${month}-01`;
}

export function monthOfIsoDate(isoDate) {
  if (!isValidIsoDate(isoDate)) {
    throw new RangeError(`monthOfIsoDate kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(isoDate)}".`);
  }
  return isoDate.slice(0, 7);
}

export function shiftMonth(month, deltaMonths) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`shiftMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
  if (!Number.isSafeInteger(deltaMonths)) {
    throw new RangeError(`shiftMonth kräver ett heltal månader, fick "${String(deltaMonths)}".`);
  }
  return monthOfIsoDate(addMonthsClamped(firstDayOfMonth(month), deltaMonths));
}

export function compareMonths(a, b) {
  if (!isValidIsoMonth(a)) {
    throw new RangeError(`compareMonths kräver en månad på formen ÅÅÅÅ-MM, fick "${String(a)}".`);
  }
  if (!isValidIsoMonth(b)) {
    throw new RangeError(`compareMonths kräver en månad på formen ÅÅÅÅ-MM, fick "${String(b)}".`);
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

export const MONTH_NAMES = Object.freeze([
  'januari',
  'februari',
  'mars',
  'april',
  'maj',
  'juni',
  'juli',
  'augusti',
  'september',
  'oktober',
  'november',
  'december'
]);

export function monthName(month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`monthName kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
  return MONTH_NAMES[Number(month.slice(5, 7)) - 1];
}

export function monthLabel(month) {
  const name = monthName(month);
  return `${name.slice(0, 1).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

export function todayIso(now = new Date()) {
  if (!(now instanceof Date)) {
    throw new RangeError(`todayIso kräver ett Date, fick "${String(now)}".`);
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('todayIso kräver ett Date som visar ett datum, fick ett ogiltigt Date.');
  }
  return toIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

export function nowIso(now = new Date()) {
  if (!(now instanceof Date)) {
    throw new RangeError(`nowIso kräver ett Date, fick "${String(now)}".`);
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('nowIso kräver ett Date som visar en tidpunkt, fick ett ogiltigt Date.');
  }
  return now.toISOString();
}

function utcMs(parts) {
  return Date.UTC(UTC_ANCHOR_YEAR, (parts.year - UTC_ANCHOR_YEAR) * MONTHS_PER_YEAR + parts.month - 1, parts.day);
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
