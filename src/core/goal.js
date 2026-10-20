import { MONTHS_PER_YEAR } from './cost.js';
import { compareIsoDates, isValidIsoDate, parseIsoDate } from './dates.js';
import { AMOUNT_MAX_SEK, AMOUNT_PATTERN, checkAmountSek, checkName, isPlainObject } from './entry.js';
import { ORE_PER_SEK, divideRoundHalfUp, normalizeZero, sekToOre } from './money.js';

export const GOAL_STATUSES = Object.freeze(['klart', 'pagaende', 'forsenat']);

const [DONE, ONGOING, LATE] = GOAL_STATUSES;

export const PERCENT_MIN = 0;
export const PERCENT_FULL = 100;

const MESSAGES = Object.freeze({
  targetNotNumber: 'Målbeloppet måste vara ett tal.',
  targetInvalid: 'Målbeloppet måste vara ett belopp större än 0 kr, med högst två decimaler.',
  targetDate: 'Slutdatum måste anges som ÅÅÅÅ-MM-DD.',
  amountNotNumber: 'Beloppet måste vara ett tal.',
  amountZero: 'Beloppet får inte vara 0 kr. Skriv ett minustecken framför för ett uttag.',
  amountTooLarge: `Beloppet får vara högst ${formatAmountLimitSek(AMOUNT_MAX_SEK)} kr.`,
  amountTooManyDecimals: 'Beloppet får ha högst två decimaler.',
  madeOn: 'Datum måste anges som ÅÅÅÅ-MM-DD.'
});

export function goalStatus(goal, today) {
  requireGoalFields('goalStatus', goal, today);
  if (goal.savedOre >= goal.targetOre) {
    return DONE;
  }
  if (goal.targetDate === null) {
    return ONGOING;
  }
  if (compareIsoDates(goal.targetDate, today) < 0) {
    return LATE;
  }
  return ONGOING;
}

export function goalProgress(goal, today) {
  const status = goalStatus(goal, today);
  const savedOre = normalizeZero(goal.savedOre);
  const leftOre = Math.max(0, goal.targetOre - savedOre);
  const monthsLeft = goal.targetDate === null ? null : wholeMonthsUntil(today, goal.targetDate);
  return {
    savedOre,
    leftOre,
    percent: clampedPercent(savedOre, goal.targetOre),
    monthsLeft,
    perMonthOre: monthsLeft === null ? null : perMonthOre(leftOre, monthsLeft),
    status
  };
}

export function validateGoalDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const target = checkTargetSek(source.targetSek);
  if (target.message) {
    errors.push({ field: 'targetSek', message: target.message });
  } else {
    value.targetOre = sekToOre(target.value);
  }

  const targetDate = checkTargetDate(source.targetDate);
  if (targetDate.message) {
    errors.push({ field: 'targetDate', message: targetDate.message });
  } else {
    value.targetDate = targetDate.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

export function validateDepositDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const amount = checkDepositAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    value.amountOre = sekToOre(amount.value);
  }

  const madeOn = checkMadeOn(source.madeOn);
  if (madeOn.message) {
    errors.push({ field: 'madeOn', message: madeOn.message });
  } else {
    value.madeOn = madeOn.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

function checkTargetSek(raw) {
  const result = checkAmountSek(raw);
  if (!result.message) {
    return { value: result.value };
  }
  return { message: normalizeDepositAmountSek(raw) === null ? MESSAGES.targetNotNumber : MESSAGES.targetInvalid };
}

function checkTargetDate(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.targetDate };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.targetDate };
  }
  return { value: trimmed };
}

function checkMadeOn(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.madeOn };
  }
  const trimmed = raw.trim();
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.madeOn };
  }
  return { value: trimmed };
}

function checkDepositAmountSek(raw) {
  const v = normalizeDepositAmountSek(raw);
  if (v === null) {
    return { message: MESSAGES.amountNotNumber };
  }
  if (v === 0) {
    return { message: MESSAGES.amountZero };
  }
  if (Math.abs(v) > AMOUNT_MAX_SEK) {
    return { message: MESSAGES.amountTooLarge };
  }
  if (Math.abs(v * ORE_PER_SEK - Math.round(v * ORE_PER_SEK)) >= 1e-6) {
    return { message: MESSAGES.amountTooManyDecimals };
  }
  const ore = Math.round(v * ORE_PER_SEK);
  if (ore === 0) {
    return { message: MESSAGES.amountZero };
  }
  return { value: normalizeZero(ore / ORE_PER_SEK) };
}

function normalizeDepositAmountSek(raw) {
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

function clampedPercent(savedOre, targetOre) {
  if (savedOre <= 0) {
    return PERCENT_MIN;
  }
  if (savedOre >= targetOre) {
    return PERCENT_FULL;
  }
  return Math.floor((savedOre * PERCENT_FULL) / targetOre);
}

function perMonthOre(leftOre, monthsLeft) {
  if (monthsLeft === 0) {
    return leftOre;
  }
  return divideRoundHalfUp(leftOre, monthsLeft);
}

function wholeMonthsUntil(today, targetDate) {
  const from = parseIsoDate(today);
  const to = parseIsoDate(targetDate);
  const months = (to.year - from.year) * MONTHS_PER_YEAR + (to.month - from.month);
  return Math.max(0, months);
}

function requireGoalFields(functionName, goal, today) {
  if (!isPlainObject(goal)) {
    throw new RangeError(`${functionName} kräver ett sparmål som objekt.`);
  }
  if (!Number.isSafeInteger(goal.targetOre) || goal.targetOre <= 0) {
    throw new RangeError(`${functionName} kräver ett targetOre större än 0, fick "${String(goal.targetOre)}".`);
  }
  if (!Number.isSafeInteger(goal.savedOre)) {
    throw new RangeError(`${functionName} kräver ett savedOre som ett säkert heltal, fick "${String(goal.savedOre)}".`);
  }
  if (goal.targetDate !== null && !isValidIsoDate(goal.targetDate)) {
    throw new RangeError(`${functionName} kräver ett targetDate på formen ÅÅÅÅ-MM-DD eller null, fick "${String(goal.targetDate)}".`);
  }
  if (!isValidIsoDate(today)) {
    throw new RangeError(`${functionName} kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
  }
}

function formatAmountLimitSek(amountSek) {
  const [whole, fraction] = amountSek.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
}
