import { isPlainObject } from './entry.js';
import { ORE_PER_SEK } from './money.js';

const SEPARATOR = ';';

const BOM = '\ufeff';

const CRLF = '\r\n';

const INJECTION_PREFIXES = Object.freeze(['=', '+', '-', '@', '\t', '\r']);

const APOSTROPHE = "'";

const QUOTE = '"';

export function csvAmountSek(ore) {
  if (!Number.isSafeInteger(ore)) {
    throw new RangeError('csvAmountSek kräver ett säkert heltal öre.');
  }

  const negative = ore < 0;
  const magnitude = Math.abs(ore);
  const kronor = Math.trunc(magnitude / ORE_PER_SEK);
  const rest = magnitude % ORE_PER_SEK;
  return `${negative ? '-' : ''}${kronor},${String(rest).padStart(2, '0')}`;
}

export function csvText(value) {
  if (typeof value !== 'string') {
    throw new RangeError('csvText kräver en sträng.');
  }
  if (INJECTION_PREFIXES.includes(value[0])) {
    return APOSTROPHE + value;
  }
  return value;
}

export function toCsv(rows) {
  if (!Array.isArray(rows)) {
    throw new RangeError('toCsv kräver en lista med rader.');
  }

  for (let i = 0; i < rows.length; i += 1) {
    if (!Array.isArray(rows[i])) {
      throw new RangeError(`toCsv kräver att varje rad är en lista, raden på index ${i} är det inte.`);
    }
  }

  for (let i = 0; i < rows.length; i += 1) {
    for (let j = 0; j < rows[i].length; j += 1) {
      if (!isCell(rows[i][j])) {
        throw new RangeError(`toCsv kräver en cell med text eller amountOre, rad ${i} kolumn ${j}.`);
      }
    }
  }

  let out = BOM;
  for (const row of rows) {
    out += row.map(toField).join(SEPARATOR) + CRLF;
  }
  return out;
}

function isCell(cell) {
  if (!isPlainObject(cell)) {
    return false;
  }
  const keys = Object.keys(cell);
  return keys.length === 1 && (keys[0] === 'text' || keys[0] === 'amountOre');
}

function toField(cell) {
  const raw = Object.hasOwn(cell, 'text') ? csvText(cell.text) : csvAmountSek(cell.amountOre);
  return needsQuoting(raw) ? QUOTE + raw.replaceAll(QUOTE, QUOTE + QUOTE) + QUOTE : raw;
}

function needsQuoting(field) {
  return field.includes(SEPARATOR)
    || field.includes(QUOTE)
    || field.includes('\r')
    || field.includes('\n');
}
