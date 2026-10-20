import crypto from 'node:crypto';

import { monthTotals, sumByKind } from '../core/budget.js';
import { compareMonths, firstDayOfMonth, isValidIsoMonth, monthOfIsoDate, nowIso, parseIsoDate, shiftMonth } from '../core/dates.js';
import { CATEGORIES } from '../core/entry.js';
import { ITEM_KINDS } from '../core/item.js';
import { nextDueDate } from '../core/schedule.js';
import { getDatabase, readRows, transaction, write } from './db.js';

const NAME_COLLATOR = new Intl.Collator('sv');

const SQL_TEMPLATES = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND from_month <= ?
   AND (to_month IS NULL OR to_month >= ?)`;

const SQL_OVERRIDES = `
SELECT template_id, amount_ore, skipped
  FROM overrides
 WHERE user_id = ?
   AND month = ?`;

const SQL_MONTH_ITEMS = `
SELECT id, kind, name, amount_ore, category, occurred_on, note
  FROM month_items
 WHERE user_id = ?
   AND month = ?`;

const SQL_MONTH_ITEM_BY_ID = `
SELECT id, kind, name, amount_ore, category, occurred_on, note
  FROM month_items
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_MONTH_ITEM = `
INSERT INTO month_items
  (id, user_id, month, kind, name, amount_ore, category, created_at, occurred_on, note)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_UPDATE_MONTH_ITEM = `
UPDATE month_items
   SET kind = ?, name = ?, amount_ore = ?, category = ?, occurred_on = ?, note = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_MONTH_ITEM = `
DELETE FROM month_items
 WHERE user_id = ?
   AND id = ?`;

const SQL_BUDGETS = `
SELECT category, amount_ore
  FROM budgets
 WHERE user_id = ?
   AND month = ?`;

const SQL_UPSERT_BUDGET = `
INSERT INTO budgets (id, user_id, month, category, amount_ore, created_at)
VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT (user_id, month, category)
    DO UPDATE SET amount_ore = excluded.amount_ore`;

const SQL_DELETE_BUDGET = `
DELETE FROM budgets
 WHERE user_id = ?
   AND month = ?
   AND category = ?`;

export const OVERVIEW_MIN_MONTHS = 1;
export const OVERVIEW_MAX_MONTHS = 36;

export async function readMonth(userId, month, { db = getDatabase() } = {}) {
  const firstDay = firstDayOfMonth(month);

  const templates = await readRows(db, SQL_TEMPLATES, [userId, month, month]);
  const overrides = await readRows(db, SQL_OVERRIDES, [userId, month]);
  const oneOffItems = await readRows(db, SQL_MONTH_ITEMS, [userId, month]);
  const budgetRows = await readRows(db, SQL_BUDGETS, [userId, month]);

  const overrideByTemplateId = new Map(overrides.map((row) => [row.template_id, row]));

  const items = [];
  for (const template of templates) {
    const dueDate = nextDueDate({ interval: template.interval, startDate: template.start_date }, firstDay);
    if (monthOfIsoDate(dueDate) !== month) {
      continue;
    }
    const override = overrideByTemplateId.get(template.id);
    if (override !== undefined && override.skipped === 1) {
      continue;
    }
    const overridden = override !== undefined;
    items.push({
      id: template.id,
      kind: template.kind,
      name: template.name,
      amountOre: overridden ? override.amount_ore : template.amount_ore,
      category: template.category,
      occurredOn: null,
      note: null,
      dueDate,
      recurring: true,
      seriesId: template.series_id,
      overridden,
      interval: template.interval,
      toMonth: template.to_month
    });
  }

  for (const row of oneOffItems) {
    items.push(toMonthItem(row));
  }

  items.sort(compareItems);
  return { items, totals: monthTotals(items), budgets: budgetLines(budgetRows, items) };
}

function budgetLines(budgetRows, items) {
  const amountByCategory = new Map(budgetRows.map((row) => [row.category, row.amount_ore]));
  const lines = [];
  for (const category of CATEGORIES) {
    if (!amountByCategory.has(category)) {
      continue;
    }
    const amountOre = amountByCategory.get(category);
    const spentOre = sumByKind(items.filter((item) => item.category === category), 'expense');
    lines.push({ category, amountOre, spentOre, leftOre: amountOre - spentOre });
  }
  return lines;
}

export async function readOverview(userId, endMonth, count, { db = getDatabase() } = {}) {
  if (!isValidIsoMonth(endMonth)) {
    throw new RangeError(`readOverview kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".`);
  }
  if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {
    throw new RangeError(`readOverview kräver ett antal månader mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}, fick "${String(count)}".`);
  }

  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    months.push({ month, ...(await readMonth(userId, month, { db })).totals });
  }

  const januaryOffset = parseIsoDate(firstDayOfMonth(endMonth)).month - 1;
  const yearItems = [];
  for (let offset = januaryOffset; offset >= 0; offset -= 1) {
    for (const item of (await readMonth(userId, shiftMonth(endMonth, -offset), { db })).items) {
      yearItems.push(item);
    }
  }
  const savedThisYear = sumByKind(yearItems, 'saving');

  return { months, savedThisYear };
}

export async function addMonthItem(userId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('addMonthItem', month);
  const id = makeId();
  await write(db, SQL_INSERT_MONTH_ITEM, [
    id,
    userId,
    month,
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    now,
    draft?.occurredOn ?? null,
    draft?.note ?? null
  ]);
  const row = await findMonthItem(db, userId, id);
  return row === null ? null : toMonthItem(row);
}

export async function updateMonthItem(userId, itemId, draft, { db = getDatabase() } = {}) {
  await write(db, SQL_UPDATE_MONTH_ITEM, [
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    draft?.occurredOn ?? null,
    draft?.note ?? null,
    userId,
    itemId
  ]);
  const row = await findMonthItem(db, userId, itemId);
  return row === null ? null : toMonthItem(row);
}

export async function removeMonthItem(userId, itemId, { db = getDatabase() } = {}) {
  const result = await write(db, SQL_DELETE_MONTH_ITEM, [userId, itemId]);
  return result.changes > 0;
}

async function findMonthItem(db, userId, itemId) {
  const rows = await readRows(db, SQL_MONTH_ITEM_BY_ID, [userId, itemId]);
  return rows.length === 0 ? null : rows[0];
}

function toMonthItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountOre: row.amount_ore,
    category: row.category,
    occurredOn: row.occurred_on,
    note: row.note,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    interval: null,
    toMonth: null
  };
}

function compareItems(a, b) {
  const kindOrder = ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  const nameOrder = NAME_COLLATOR.compare(a.name, b.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

function requireMonth(functionName, month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`${functionName} kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
}

const SQL_INSERT_TEMPLATE = `
INSERT INTO templates
  (id, user_id, series_id, kind, name, amount_ore, category, interval,
   start_date, from_month, to_month, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

const SQL_TEMPLATE_BY_ID = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND id = ?`;

const SQL_TEMPLATE_VERSION_FOR_MONTH = `
SELECT id, series_id, kind, name, amount_ore, category, interval, start_date,
       from_month, to_month
  FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month <= ?
   AND (to_month IS NULL OR to_month >= ?)`;

const SQL_END_TEMPLATE_VERSION = `
UPDATE templates
   SET to_month = ?
 WHERE user_id = ?
   AND series_id = ?
   AND from_month < ?
   AND (to_month IS NULL OR to_month >= ?)`;

const SQL_DELETE_TEMPLATES_FROM = `
DELETE FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month >= ?`;

const SQL_DELETE_TEMPLATES_FROM_EXCEPT = `
DELETE FROM templates
 WHERE user_id = ?
   AND series_id = ?
   AND from_month >= ?
   AND id <> ?`;

const SQL_UPDATE_TEMPLATE_IN_PLACE = `
UPDATE templates
   SET kind = ?, name = ?, amount_ore = ?, category = ?, interval = ?, to_month = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_UPSERT_OVERRIDE = `
INSERT INTO overrides (id, user_id, template_id, month, amount_ore, skipped, created_at)
SELECT ?, t.user_id, t.id, ?, ?::integer, ?::smallint, ?
  FROM templates t
 WHERE t.user_id = ?
   AND t.id = ?
    ON CONFLICT (template_id, month)
    DO UPDATE SET amount_ore = excluded.amount_ore, skipped = excluded.skipped`;

const SQL_DELETE_OVERRIDE = `
DELETE FROM overrides
 WHERE user_id = ?
   AND template_id = ?
   AND month = ?`;

export async function addTemplate(userId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('addTemplate', month);
  const id = makeId();
  await write(db, SQL_INSERT_TEMPLATE, [
    id,
    userId,
    id,
    draft?.kind,
    draft?.name,
    draft?.amountOre,
    draft?.category,
    draft?.interval,
    firstDayOfMonth(month),
    month,
    draft?.toMonth ?? null,
    now
  ]);
  const row = await findTemplate(db, userId, id);
  return row === null ? null : toTemplate(row);
}

export async function endTemplate(userId, seriesId, month, { db = getDatabase() } = {}) {
  requireMonth('endTemplate', month);
  const previous = shiftMonth(month, -1);
  return await transaction(db, async () => {
    const ended = await write(db, SQL_END_TEMPLATE_VERSION, [previous, userId, seriesId, month, month]);
    const removed = await write(db, SQL_DELETE_TEMPLATES_FROM, [userId, seriesId, month]);
    return ended.changes + removed.changes > 0;
  });
}

export async function changeTemplateFrom(userId, seriesId, month, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('changeTemplateFrom', month);
  const rows = await readRows(db, SQL_TEMPLATE_VERSION_FOR_MONTH, [userId, seriesId, month, month]);
  if (rows.length === 0) {
    return null;
  }
  const current = rows[0];
  const previous = shiftMonth(month, -1);

  if (compareMonths(previous, current.from_month) < 0) {
    await transaction(db, async () => {
      await write(db, SQL_DELETE_TEMPLATES_FROM_EXCEPT, [userId, seriesId, month, current.id]);
      await write(db, SQL_UPDATE_TEMPLATE_IN_PLACE, [
        draft?.kind,
        draft?.name,
        draft?.amountOre,
        draft?.category,
        draft?.interval,
        draft?.toMonth ?? null,
        userId,
        current.id
      ]);
    });
    const row = await findTemplate(db, userId, current.id);
    return row === null ? null : toTemplate(row);
  }

  const id = makeId();
  await transaction(db, async () => {
    await write(db, SQL_DELETE_TEMPLATES_FROM_EXCEPT, [userId, seriesId, month, current.id]);
    await write(db, SQL_END_TEMPLATE_VERSION, [previous, userId, seriesId, month, month]);
    await write(db, SQL_INSERT_TEMPLATE, [
      id,
      userId,
      current.series_id,
      draft?.kind,
      draft?.name,
      draft?.amountOre,
      draft?.category,
      draft?.interval,
      current.start_date,
      month,
      draft?.toMonth ?? null,
      now
    ]);
  });
  const row = await findTemplate(db, userId, id);
  return row === null ? null : toTemplate(row);
}

export async function setOverride(userId, templateId, month, amountOre, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('setOverride', month);
  const result = await write(db, SQL_UPSERT_OVERRIDE, [makeId(), month, amountOre, 0, now, userId, templateId]);
  return result.changes > 0;
}

export async function skipMonth(userId, templateId, month, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('skipMonth', month);
  const result = await write(db, SQL_UPSERT_OVERRIDE, [makeId(), month, null, 1, now, userId, templateId]);
  return result.changes > 0;
}

export async function clearOverride(userId, templateId, month, { db = getDatabase() } = {}) {
  requireMonth('clearOverride', month);
  const result = await write(db, SQL_DELETE_OVERRIDE, [userId, templateId, month]);
  return result.changes > 0;
}

export async function setBudget(userId, month, category, amountOre, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  requireMonth('setBudget', month);
  await write(db, SQL_UPSERT_BUDGET, [makeId(), userId, month, category, amountOre, now]);
}

export async function removeBudget(userId, month, category, { db = getDatabase() } = {}) {
  requireMonth('removeBudget', month);
  const result = await write(db, SQL_DELETE_BUDGET, [userId, month, category]);
  return result.changes > 0;
}

async function findTemplate(db, userId, templateId) {
  const rows = await readRows(db, SQL_TEMPLATE_BY_ID, [userId, templateId]);
  return rows.length === 0 ? null : rows[0];
}

function toTemplate(row) {
  return {
    id: row.id,
    seriesId: row.series_id,
    kind: row.kind,
    name: row.name,
    amountOre: row.amount_ore,
    category: row.category,
    interval: row.interval,
    startDate: row.start_date,
    fromMonth: row.from_month,
    toMonth: row.to_month
  };
}
