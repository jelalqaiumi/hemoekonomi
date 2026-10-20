import { addMonthsClamped, compareIsoDates, daysBetween, parseIsoDate } from './dates.js';
import { isPlainObject, isValidEntryId } from './entry.js';

export const MONTHS_PER_PERIOD = Object.freeze({
  monthly: 1,
  quarterly: 3,
  semiannual: 6,
  yearly: 12
});

const MONTHS_PER_YEAR = 12;

export function nextDueDate(entry, todayIsoDate, addMonths = addMonthsClamped) {
  if (!isPlainObject(entry)) {
    throw new RangeError('nextDueDate kräver en post som objekt.');
  }
  if (!Object.hasOwn(MONTHS_PER_PERIOD, entry.interval)) {
    throw new RangeError(`nextDueDate kräver ett känt interval, fick "${String(entry.interval)}".`);
  }
  const start = parseIsoDate(entry.startDate);
  if (start === null) {
    throw new RangeError(`nextDueDate kräver ett startDate på formen ÅÅÅÅ-MM-DD, fick "${String(entry.startDate)}".`);
  }
  const today = parseIsoDate(todayIsoDate);
  if (today === null) {
    throw new RangeError(`nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(todayIsoDate)}".`);
  }
  if (typeof addMonths !== 'function') {
    throw new RangeError(`nextDueDate kräver att addMonths är en funktion, fick "${String(addMonths)}".`);
  }
  const step = MONTHS_PER_PERIOD[entry.interval];
  const diff = monthIndex(today) - monthIndex(start);
  let k = Math.max(0, Math.floor(diff / step));
  let occurrence = addMonths(entry.startDate, k * step);
  while (compareIsoDates(occurrence, todayIsoDate) < 0) {
    k += 1;
    occurrence = addMonths(entry.startDate, k * step);
  }
  return occurrence;
}

export function upcoming(entries, todayIsoDate) {
  if (!Array.isArray(entries)) {
    throw new RangeError('upcoming kräver en lista med poster.');
  }
  const items = entries.map((entry) => {
    const due = nextDueDate(entry, todayIsoDate);
    if (typeof entry.name !== 'string') {
      throw new RangeError(`upcoming kräver ett name som sträng, fick "${String(entry.name)}".`);
    }
    if (!isValidEntryId(entry.id)) {
      throw new RangeError(`upcoming kräver ett id som är en icke-tom sträng, fick "${String(entry.id)}".`);
    }
    return { entry, nextDueDate: due, daysUntil: daysBetween(todayIsoDate, due) };
  });
  return items.sort(compareUpcoming);
}

export function compareUpcoming(a, b) {
  const byDate = compareIsoDates(a.nextDueDate, b.nextDueDate);
  if (byDate !== 0) {
    return byDate;
  }
  const byName = a.entry.name.localeCompare(b.entry.name, 'sv');
  if (byName !== 0) {
    return byName;
  }
  if (a.entry.id < b.entry.id) {
    return -1;
  }
  if (a.entry.id > b.entry.id) {
    return 1;
  }
  return 0;
}

function monthIndex(parts) {
  return parts.year * MONTHS_PER_YEAR + (parts.month - 1);
}
