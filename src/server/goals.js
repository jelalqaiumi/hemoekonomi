import crypto from 'node:crypto';

import { nowIso } from '../core/dates.js';
import { goalProgress } from '../core/goal.js';
import { getDatabase, readRows, transaction, write } from './db.js';

const NAME_COLLATOR = new Intl.Collator('sv');

const GOAL_COLUMNS = 'id, name, target_ore, target_date';

const SAVED_ORE_COLUMN = `
  COALESCE((SELECT SUM(d.amount_ore)
              FROM goal_deposits d
             WHERE d.goal_id = g.id
               AND d.user_id = g.user_id), 0) AS saved_ore`;

const SQL_GOALS = `
SELECT g.id, g.name, g.target_ore, g.target_date,${SAVED_ORE_COLUMN}
  FROM goals g
 WHERE g.user_id = ?`;

const SQL_GOAL_BY_ID = `
SELECT ${GOAL_COLUMNS}
  FROM goals
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_GOAL = `
INSERT INTO goals
  (id, user_id, name, target_ore, target_date, created_at)
VALUES (?, ?, ?, ?, ?, ?)`;

const SQL_UPDATE_GOAL = `
UPDATE goals
   SET name = ?, target_ore = ?, target_date = ?
 WHERE user_id = ?
   AND id = ?`;

const SQL_DELETE_GOAL = `
DELETE FROM goals
 WHERE user_id = ?
   AND id = ?`;

const SQL_INSERT_DEPOSIT = `
INSERT INTO goal_deposits
  (id, user_id, goal_id, amount_ore, made_on, created_at)
VALUES (?, ?, ?, ?, ?, ?)`;

export async function readGoals(userId, today, { db = getDatabase() } = {}) {
  return (await readRows(db, SQL_GOALS, [userId]))
    .map((row) => toGoalView(row, today))
    .sort(compareGoals);
}

export async function addGoal(userId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  const id = makeId();
  await write(db, SQL_INSERT_GOAL, [
    id,
    userId,
    draft?.name,
    draft?.targetOre,
    draft?.targetDate ?? null,
    now
  ]);
  return await findGoal(db, userId, id);
}

export async function updateGoal(userId, goalId, draft, { db = getDatabase() } = {}) {
  await write(db, SQL_UPDATE_GOAL, [
    draft?.name,
    draft?.targetOre,
    draft?.targetDate ?? null,
    userId,
    goalId
  ]);
  return await findGoal(db, userId, goalId);
}

export async function removeGoal(userId, goalId, { db = getDatabase() } = {}) {
  return (await write(db, SQL_DELETE_GOAL, [userId, goalId])).changes > 0;
}

export async function addDeposit(userId, goalId, draft, { db = getDatabase(), now = nowIso(), makeId = () => crypto.randomUUID() } = {}) {
  return await transaction(db, async () => {
    if ((await readRows(db, SQL_GOAL_BY_ID, [userId, goalId])).length === 0) {
      return null;
    }
    const id = makeId();
    await write(db, SQL_INSERT_DEPOSIT, [
      id,
      userId,
      goalId,
      draft?.amountOre,
      draft?.madeOn,
      now
    ]);
    return { id, goalId, amountOre: draft?.amountOre, madeOn: draft?.madeOn };
  });
}

async function findGoal(db, userId, goalId) {
  const rows = await readRows(db, SQL_GOAL_BY_ID, [userId, goalId]);
  return rows.length === 0 ? null : toGoal(rows[0]);
}

function toGoal(row) {
  return {
    id: row.id,
    name: row.name,
    targetOre: row.target_ore,
    targetDate: row.target_date
  };
}

function toGoalView(row, today) {
  const goal = toGoal(row);
  return { ...goal, ...goalProgress({ ...goal, savedOre: row.saved_ore }, today) };
}

function compareGoals(a, b) {
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
