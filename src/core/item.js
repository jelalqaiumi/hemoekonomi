import { compareMonths, isValidIsoDate, isValidIsoMonth } from './dates.js';
import { checkAmountSek, checkCategory, checkInterval, checkName, isPlainObject } from './entry.js';
import { sekToOre } from './money.js';

const NOTE_MAX_LENGTH = 200;

const MESSAGES = Object.freeze({
  kind: 'Välj inkomst, utgift eller sparande.',
  toMonthFormat: 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.',
  toMonthBeforeFrom: 'Till och med kan inte vara före den månad posten gäller från.',
  overrideShape: 'Ange ett belopp för månaden, eller att posten ska hoppas över.',
  occurredOn: 'Datum måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD, eller lämnas tomt.',
  noteNotText: 'Kommentaren måste vara text.',
  noteTooLong: `Kommentaren får vara högst ${NOTE_MAX_LENGTH} tecken.`
});

export const ITEM_KINDS = Object.freeze(['income', 'expense', 'saving']);

export const ITEM_KIND_LABELS = Object.freeze({
  income: 'Inkomst',
  expense: 'Utgift',
  saving: 'Sparande'
});

export function isItemKind(value) {
  return ITEM_KINDS.includes(value);
}

function checkSharedFields(source) {
  const errors = [];
  const value = {};

  if (!isItemKind(source.kind)) {
    errors.push({ field: 'kind', message: MESSAGES.kind });
  } else {
    value.kind = source.kind;
  }

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

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  return { errors, value };
}

export function validateMonthItemDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const { errors, value } = checkSharedFields(source);

  const occurredOn = checkOccurredOn(source.occurredOn);
  if (occurredOn.message) {
    errors.push({ field: 'occurredOn', message: occurredOn.message });
  } else {
    value.occurredOn = occurredOn.value;
  }

  const note = checkNote(source.note);
  if (note.message) {
    errors.push({ field: 'note', message: note.message });
  } else {
    value.note = note.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

function checkOccurredOn(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.occurredOn };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.occurredOn };
  }
  return { value: trimmed };
}

function checkNote(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.noteNotText };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (trimmed.length > 2 * NOTE_MAX_LENGTH) {
    return { message: MESSAGES.noteTooLong };
  }
  if ([...trimmed].length > NOTE_MAX_LENGTH) {
    return { message: MESSAGES.noteTooLong };
  }
  return { value: trimmed };
}

export function validateTemplateDraft(draft, month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`validateTemplateDraft kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
  const source = isPlainObject(draft) ? draft : {};
  const { errors, value } = checkSharedFields(source);

  const interval = checkInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const toMonth = checkToMonth(source.toMonth, month);
  if (toMonth.message) {
    errors.push({ field: 'toMonth', message: toMonth.message });
  } else {
    value.toMonth = toMonth.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

function checkToMonth(raw, month) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.toMonthFormat };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoMonth(trimmed)) {
    return { message: MESSAGES.toMonthFormat };
  }
  if (compareMonths(trimmed, month) < 0) {
    return { message: MESSAGES.toMonthBeforeFrom };
  }
  return { value: trimmed };
}

export function validateBudgetDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    value.amountOre = sekToOre(amount.value);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

export function validateOverrideDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};

  if (source.skipped === true) {
    return { ok: true, value: { skipped: true, amountOre: null } };
  }

  if (source.amountSek === undefined) {
    return { ok: false, errors: [{ field: 'skipped', message: MESSAGES.overrideShape }] };
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    return { ok: false, errors: [{ field: 'amountSek', message: amount.message }] };
  }
  return { ok: true, value: { skipped: false, amountOre: sekToOre(amount.value) } };
}
