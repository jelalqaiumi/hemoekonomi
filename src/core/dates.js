// Kalenderdatum som strängar "YYYY-MM-DD".
// Ren logik: inga sidoeffekter, inga node:-importer.
// Endast de funktioner som paket 2 behöver är implementerade här.

// Formatmönstret för ett ISO-datum. Exporteras så att entry.js kan skilja
// "fel format" från "obefintligt datum" utan att duplicera regexen.
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

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
  if (month < 1 || month > 12) {
    return null;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function isValidIsoDate(value) {
  return parseIsoDate(value) !== null;
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
