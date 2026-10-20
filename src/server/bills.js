import crypto from 'node:crypto';

import { billStatus, daysUntilDue, nextBillDueDate } from '../core/bill.js';
import { compareIsoDates, isValidIsoDate, nowIso } from '../core/dates.js';
import { getDatabase, readRows, transaction, write } from './db.js';

const NAME_COLLATOR = new Intl.Collator('sv');

const BILL_COLUMNS = 'id, name, amount_ore, due_date, interval, remind_days, paid_at';

const SQL_BILLS = `
SELECT ${BILL_COLUMNS}
  FROM bills
 WHERE user_id = ?`;

const SQL_BILL_BY_ID = `
SELECT ${BILL_COLUMNS}
  FROM bills
 WHERE user_id = ?
   AND id = ?`;

const SQL_BILL_SERIES_BY_ID = `
SELECT interval, due_date, anchor_date
  FROM bills
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_BILL = `
INSERT INTO bills
  (id, user_id, name, amount_ore, due_date, anchor_date, interval, remind_days, paid_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`;

const SQL_UPDATE_BILL = `
UPDATE bills
   SET name = ?, amount_ore = ?, due_date = ?, anchor_date = ?, interval = ?, remind_days = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_MARK_BILL_PAID = `
UPDATE bills
   SET paid_at = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_MOVE_BILL_FORWARD = `
UPDATE bills
   SET due_date = ?, paid_at = NULL
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_BILL = `
DELETE FROM bills
 WHERE user_id = ?
   AND id = ?`;

export async function readBills(userId, today, { db = getDatabase() } = {}) {
  requireToday('readBills', today);
  return (await readRows(db, SQL_BILLS, [userId]))
    .map((row) => toBillView(row, today))
    .sort(compareBills);
}

export async function addBill(userId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  const id = makeId();
  await write(db, SQL_INSERT_BILL, [
    id,
    userId,
    draft?.name,
    draft?.amountOre,
    draft?.dueDate,
    draft?.dueDate,
    draft?.interval ?? null,
    draft?.remindDays,
    now
  ]);
  return await findBill(db, userId, id);
}

export async function updateBill(userId, billId, draft, { db = getDatabase() } = {}) {
  await write(db, SQL_UPDATE_BILL, [
    draft?.name,
    draft?.amountOre,
    draft?.dueDate,
    draft?.dueDate,
    draft?.interval ?? null,
    draft?.remindDays,
    userId,
    billId
  ]);
  return await findBill(db, userId, billId);
}

export async function markBillPaid(userId, billId, today, { db = getDatabase(), now = nowIso() } = {}) {
  requireToday('markBillPaid', today);
  return await transaction(db, async () => {
    const rows = await readRows(db, SQL_BILL_SERIES_BY_ID, [userId, billId]);
    if (rows.length === 0) {
      return null;
    }
    const row = rows[0];
    if (row.interval === null) {
      await write(db, SQL_MARK_BILL_PAID, [now, userId, billId]);
    } else {
      const series = { interval: row.interval, dueDate: row.due_date, anchorDate: row.anchor_date };
      await write(db, SQL_MOVE_BILL_FORWARD, [nextBillDueDate(series, today), userId, billId]);
    }
    return await findBill(db, userId, billId);
  });
}

export async function removeBill(userId, billId, { db = getDatabase() } = {}) {
  return (await write(db, SQL_DELETE_BILL, [userId, billId])).changes > 0;
}

async function findBill(db, userId, billId) {
  const rows = await readRows(db, SQL_BILL_BY_ID, [userId, billId]);
  return rows.length === 0 ? null : toBill(rows[0]);
}

function toBill(row) {
  return {
    id: row.id,
    name: row.name,
    amountOre: row.amount_ore,
    dueDate: row.due_date,
    interval: row.interval,
    remindDays: row.remind_days,
    paidAt: row.paid_at
  };
}

function toBillView(row, today) {
  const bill = toBill(row);
  return { ...bill, daysUntil: daysUntilDue(bill.dueDate, today), status: billStatus(bill, today) };
}

function compareBills(a, b) {
  const byDate = compareIsoDates(a.dueDate, b.dueDate);
  if (byDate !== 0) {
    return byDate;
  }
  const byName = NAME_COLLATOR.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

function requireToday(functionName, today) {
  if (!isValidIsoDate(today)) {
    throw new RangeError(`${functionName} kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
  }
}
