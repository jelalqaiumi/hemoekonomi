import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate } from './dates.js';
import { ORE_PER_SEK, normalizeZero } from './money.js';

export const INTERVALS = Object.freeze(['monthly', 'quarterly', 'semiannual', 'yearly']);

export const INTERVAL_LABELS = Object.freeze({
  monthly: 'Månadsvis',
  quarterly: 'Kvartalsvis',
  semiannual: 'Halvårsvis',
  yearly: 'Årsvis'
});

export const CATEGORIES = Object.freeze([
  'housing', 'subscription', 'insurance', 'transport', 'loan', 'other'
]);

export const CATEGORY_LABELS = Object.freeze({
  housing: 'Boende',
  subscription: 'Prenumeration',
  insurance: 'Försäkring',
  transport: 'Transport',
  loan: 'Lån',
  other: 'Övrigt'
});

export const NAME_MAX_LENGTH = 60;

export const AMOUNT_MAX_SEK = 9999999.99;

export const AMOUNT_PATTERN = /^-?\d{1,15}([.,]\d{1,15})?$/;

export const AMOUNT_HINT_PATTERN = /^-?[\d.,\u0020\u00a0]*\d[\d.,\u0020\u00a0]*(?:kr)?$/i;

export const AMOUNT_HINT_MAX_LENGTH = 40;

export const MIN_YEAR = 1970;
export const MAX_YEAR = 2099;

export const ENTRY_FIELDS = Object.freeze([
  'amountSek', 'category', 'id', 'interval', 'name', 'startDate'
]);

const MESSAGES = {
  nameEmpty: 'Namnet får inte vara tomt.',
  nameTooLong: `Namnet får vara högst ${NAME_MAX_LENGTH} tecken.`,
  amountNotNumber: 'Beloppet måste vara ett tal.',
  amountHint: 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.',
  amountNotPositive: 'Beloppet måste vara större än 0 kr.',
  amountTooManyDecimals: 'Beloppet får ha högst två decimaler.',
  amountTooLarge: `Beloppet får vara högst ${formatAmountLimitSek(AMOUNT_MAX_SEK)} kr.`,
  interval: 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.',
  dateFormat: 'Startdatum måste anges som ÅÅÅÅ-MM-DD.',
  dateInvalid: 'Startdatum är inget giltigt datum.',
  dateOutOfRange: `Startdatum måste ligga mellan ${MIN_YEAR}-01-01 och ${MAX_YEAR}-12-31.`,
  category: 'Välj en giltig kategori.',
  idInvalid: 'Posten kunde inte skapas på grund av ett internt fel.'
};

function formatAmountLimitSek(amountSek) {
  const [whole, fraction] = amountSek.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
}

export function validateEntryDraft(draft) {
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
    value.amountSek = amount.value;
  }

  const interval = checkInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const startDate = checkStartDate(source.startDate);
  if (startDate.message) {
    errors.push({ field: 'startDate', message: startDate.message });
  } else {
    value.startDate = startDate.value;
  }

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: value.name,
      amountSek: value.amountSek,
      interval: value.interval,
      startDate: value.startDate,
      category: value.category
    }
  };
}

export function createEntry(draft, makeId = () => crypto.randomUUID()) {
  const result = validateEntryDraft(draft);
  if (!result.ok) {
    return result;
  }
  const id = makeId();
  if (!isValidEntryId(id)) {
    return { ok: false, errors: [{ field: 'id', message: MESSAGES.idInvalid }] };
  }
  return {
    ok: true,
    value: {
      id,
      name: result.value.name,
      amountSek: result.value.amountSek,
      interval: result.value.interval,
      startDate: result.value.startDate,
      category: result.value.category
    }
  };
}

export function isValidEntryId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function canonicalAmountSek(amountSek) {
  return normalizeZero(Math.round(amountSek * ORE_PER_SEK) / ORE_PER_SEK);
}

export function isEntry(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(ENTRY_FIELDS)) {
    return false;
  }
  if (!isValidEntryId(value.id)) {
    return false;
  }
  if (typeof value.name !== 'string' || value.name !== value.name.trim()) {
    return false;
  }
  if (typeof value.amountSek !== 'number'
    || value.amountSek !== canonicalAmountSek(value.amountSek)) {
    return false;
  }
  return validateEntryDraft(value).ok;
}

export function checkName(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.nameEmpty };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { message: MESSAGES.nameEmpty };
  }
  if (trimmed.length > 2 * NAME_MAX_LENGTH) {
    return { message: MESSAGES.nameTooLong };
  }
  if ([...trimmed].length > NAME_MAX_LENGTH) {
    return { message: MESSAGES.nameTooLong };
  }
  return { value: trimmed };
}

export function checkAmountSek(raw) {
  const v = normalizeAmountSek(raw);
  if (v === null) {
    return { message: amountNotNumberMessage(raw) };
  }

  if (v <= 0) {
    return { message: MESSAGES.amountNotPositive };
  }
  if (v > AMOUNT_MAX_SEK) {
    return { message: MESSAGES.amountTooLarge };
  }
  if (Math.abs(v * ORE_PER_SEK - Math.round(v * ORE_PER_SEK)) >= 1e-6) {
    return { message: MESSAGES.amountTooManyDecimals };
  }

  const ore = Math.round(v * ORE_PER_SEK);
  if (ore < 1) {
    return { message: MESSAGES.amountNotPositive };
  }

  return { value: canonicalAmountSek(v) };
}

function amountNotNumberMessage(raw) {
  if (typeof raw !== 'string') {
    return MESSAGES.amountNotNumber;
  }
  const trimmed = raw.trim();
  if (trimmed.length > AMOUNT_HINT_MAX_LENGTH) {
    return MESSAGES.amountNotNumber;
  }
  if (AMOUNT_HINT_PATTERN.test(trimmed)) {
    return MESSAGES.amountHint;
  }
  return MESSAGES.amountNotNumber;
}

function normalizeAmountSek(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!AMOUNT_PATTERN.test(trimmed)) {
      return null;
    }
    return Number(trimmed.replace(',', '.'));
  }
  return null;
}

export function checkInterval(raw) {
  if (typeof raw !== 'string' || !INTERVALS.includes(raw)) {
    return { message: MESSAGES.interval };
  }
  return { value: raw };
}

function checkStartDate(raw) {
  if (typeof raw !== 'string' || !ISO_DATE_PATTERN.test(raw)) {
    return { message: MESSAGES.dateFormat };
  }
  if (!isValidIsoDate(raw)) {
    return { message: MESSAGES.dateInvalid };
  }
  const { year } = parseIsoDate(raw);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { message: MESSAGES.dateOutOfRange };
  }
  return { value: raw };
}

export function checkCategory(raw) {
  if (typeof raw !== 'string' || !CATEGORIES.includes(raw)) {
    return { message: MESSAGES.category };
  }
  return { value: raw };
}

export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
