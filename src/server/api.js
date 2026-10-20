import { validateBillDraft } from '../core/bill.js';
import { toCsv } from '../core/csv.js';
import { isValidIsoDate, isValidIsoMonth, nowIso } from '../core/dates.js';
import { validateDepositDraft, validateGoalDraft } from '../core/goal.js';
import { validateBudgetDraft, validateMonthItemDraft, validateOverrideDraft, validateTemplateDraft } from '../core/item.js';
import { reportCsvRows, reportFileName } from '../core/report-csv.js';
import {
  clearedSessionCookie,
  clientIp,
  deleteAccount,
  isProduction,
  logIn,
  logOut,
  readSessionToken,
  register,
  requestPasswordReset,
  requireSession,
  resetPassword,
  sessionCookie
} from './auth.js';
import { addBill, markBillPaid, readBills, removeBill, updateBill } from './bills.js';
import { getDatabase, readRows } from './db.js';
import { addDeposit, addGoal, readGoals, removeGoal, updateGoal } from './goals.js';
import {
  OVERVIEW_MAX_MONTHS,
  OVERVIEW_MIN_MONTHS,
  addMonthItem,
  addTemplate,
  changeTemplateFrom,
  endTemplate,
  readMonth,
  readOverview,
  removeBudget,
  removeMonthItem,
  setBudget,
  setOverride,
  skipMonth,
  updateMonthItem
} from './months.js';
import { readReport } from './reports.js';

export const UNPARSABLE_MESSAGE = 'Kunde inte tolka anropet.';

const MESSAGES = Object.freeze({
  unknownPath: 'Okänd adress.',
  methodNotAllowed: 'Metoden stöds inte.',
  entryNotFound: 'Posten finns inte.',
  invalidMonth: 'Månaden måste anges som ÅÅÅÅ-MM.',
  invalidToday: 'Dagens datum måste anges som ÅÅÅÅ-MM-DD.',
  billNotFound: 'Räkningen finns inte.',
  goalNotFound: 'Sparmålet finns inte.',
  missingAppUrl: 'Servern saknar sin adress (APP_URL). Kontakta den som driftar appen.',
  invalidReportCount: `Antalet månader måste vara mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}.`
});

const API_PREFIX = '/api/';

const MONTH_PATH_PREFIX = '/api/manad/';
const ITEM_PATH_PREFIX = '/api/poster/';

const OVERVIEW_PATH_PREFIX = '/api/oversikt/';
const OVERVIEW_MONTHS = 12;

const TEMPLATE_PATH_PREFIX = '/api/mallar/';
const ITEM_MONTH_SEGMENT = 'manad';

const BUDGET_PATH_PREFIX = '/api/budget/';

const BILLS_PATH = '/api/rakningar';
const BILL_PATH_PREFIX = '/api/rakningar/';
const BILL_PAID_SEGMENT = 'betald';

const GOALS_PATH = '/api/sparmal';
const GOAL_PATH_PREFIX = '/api/sparmal/';
const GOAL_DEPOSIT_SEGMENT = 'insattning';

const REPORT_PATH_PREFIX = '/api/rapport/';
const REPORT_CSV_SEGMENT = 'csv';
const REPORT_COUNT_PATTERN = /^(0|[1-9][0-9]*)$/;

const AUTH_REGISTER_PATH = '/api/auth/registrera';
const AUTH_FORGOT_PATH = '/api/auth/glomt-losenord';
const AUTH_RESET_PATH = '/api/auth/nytt-losenord';
const EXPORT_PATH = '/api/mig/export';
const AUTH_LOGIN_PATH = '/api/auth/logga-in';
const AUTH_LOGOUT_PATH = '/api/auth/logga-ut';
const ME_PATH = '/api/mig';

const UNPARSABLE = Symbol('unparsable');

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function sendCsv(res, filename, text) {
  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

function parseBody(text) {
  if (text === null) {
    return UNPARSABLE;
  }
  try {
    return JSON.parse(text);
  } catch {
    return UNPARSABLE;
  }
}

function segmentAfter(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const segment = pathname.slice(prefix.length);
  if (segment === '' || segment.includes('/')) {
    return null;
  }
  return segment;
}

function itemMonthFromPath(pathname) {
  if (!pathname.startsWith(ITEM_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(ITEM_PATH_PREFIX.length).split('/');
  if (parts.length !== 3 || parts[1] !== ITEM_MONTH_SEGMENT) {
    return null;
  }
  if (parts[0] === '' || parts[2] === '') {
    return null;
  }
  return { itemId: parts[0], month: parts[2] };
}

function seriesMonthFromPath(pathname) {
  if (!pathname.startsWith(TEMPLATE_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(TEMPLATE_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { seriesId: parts[0], month: parts[1] };
}

function budgetCategoryFromPath(pathname) {
  if (!pathname.startsWith(BUDGET_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(BUDGET_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { month: parts[0], category: parts[1] };
}

function billPaidFromPath(pathname) {
  if (!pathname.startsWith(BILL_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(BILL_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] !== BILL_PAID_SEGMENT) {
    return null;
  }
  return parts[0];
}

function goalDepositFromPath(pathname) {
  if (!pathname.startsWith(GOAL_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(GOAL_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] !== GOAL_DEPOSIT_SEGMENT) {
    return null;
  }
  return parts[0];
}

function reportFromPath(pathname) {
  if (!pathname.startsWith(REPORT_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(REPORT_PATH_PREFIX.length).split('/');
  const csv = parts.length === 3 && parts[2] === REPORT_CSV_SEGMENT;
  if (parts.length !== 2 && !csv) {
    return null;
  }
  if (parts[0] === '' || !REPORT_COUNT_PATTERN.test(parts[1])) {
    return null;
  }
  return { month: parts[0], count: Number(parts[1]), csv };
}

export async function handleApiRequest(req, res, pathname, now = nowIso()) {
  if (pathname !== '/api' && !pathname.startsWith(API_PREFIX)) {
    return false;
  }

  if (pathname === AUTH_REGISTER_PATH) {
    if (req.method === 'POST') {
      await handleRegister(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_LOGIN_PATH) {
    if (req.method === 'POST') {
      await handleLogin(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_LOGOUT_PATH) {
    if (req.method === 'POST') {
      await handleLogout(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_FORGOT_PATH) {
    if (req.method === 'POST') {
      await handleForgotPassword(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_RESET_PATH) {
    if (req.method === 'POST') {
      await handleResetPassword(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === EXPORT_PATH) {
    if (req.method === 'GET') {
      await handleExport(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === ME_PATH) {
    if (req.method === 'GET') {
      await handleMe(req, res, now);
      return true;
    }
    if (req.method === 'DELETE') {
      await handleDeleteAccount(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === BILLS_PATH) {
    if (req.method === 'POST') {
      await handleCreateBill(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const paidBillId = billPaidFromPath(pathname);
  if (paidBillId !== null) {
    if (req.method === 'POST') {
      await handleMarkBillPaid(req, res, now, paidBillId);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const billSegment = segmentAfter(pathname, BILL_PATH_PREFIX);
  if (billSegment !== null) {
    if (req.method === 'GET') {
      await handleReadBills(req, res, now, billSegment);
      return true;
    }
    if (req.method === 'PUT') {
      await handleUpdateBill(req, res, now, billSegment);
      return true;
    }
    if (req.method === 'DELETE') {
      await handleDeleteBill(req, res, now, billSegment);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === GOALS_PATH) {
    if (req.method === 'POST') {
      await handleCreateGoal(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const depositGoalId = goalDepositFromPath(pathname);
  if (depositGoalId !== null) {
    if (req.method === 'POST') {
      await handleCreateDeposit(req, res, now, depositGoalId);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const goalSegment = segmentAfter(pathname, GOAL_PATH_PREFIX);
  if (goalSegment !== null) {
    if (req.method === 'GET') {
      await handleReadGoals(req, res, now, goalSegment);
      return true;
    }
    if (req.method === 'PUT') {
      await handleUpdateGoal(req, res, now, goalSegment);
      return true;
    }
    if (req.method === 'DELETE') {
      await handleDeleteGoal(req, res, now, goalSegment);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const budgetCategory = budgetCategoryFromPath(pathname);
  if (budgetCategory !== null) {
    if (req.method === 'DELETE') {
      await handleDeleteBudget(req, res, now, budgetCategory.month, budgetCategory.category);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const budgetMonth = segmentAfter(pathname, BUDGET_PATH_PREFIX);
  if (budgetMonth !== null) {
    if (req.method === 'PUT') {
      await handleSetBudget(req, res, now, budgetMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const month = segmentAfter(pathname, MONTH_PATH_PREFIX);
  if (month !== null) {
    if (req.method === 'GET') {
      await handleReadMonth(req, res, now, month);
      return true;
    }
    if (req.method === 'POST') {
      await handleCreateMonthItem(req, res, now, month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const overviewMonth = segmentAfter(pathname, OVERVIEW_PATH_PREFIX);
  if (overviewMonth !== null) {
    if (req.method === 'GET') {
      await handleReadOverview(req, res, now, overviewMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const report = reportFromPath(pathname);
  if (report !== null) {
    if (req.method === 'GET') {
      await handleReadReport(req, res, now, report);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const templateMonth = segmentAfter(pathname, TEMPLATE_PATH_PREFIX);
  if (templateMonth !== null) {
    if (req.method === 'POST') {
      await handleCreateTemplate(req, res, now, templateMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const seriesMonth = seriesMonthFromPath(pathname);
  if (seriesMonth !== null) {
    if (req.method === 'PUT') {
      await handleChangeTemplate(req, res, now, seriesMonth.seriesId, seriesMonth.month);
      return true;
    }
    if (req.method === 'DELETE') {
      await handleEndTemplate(req, res, now, seriesMonth.seriesId, seriesMonth.month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const itemMonth = itemMonthFromPath(pathname);
  if (itemMonth !== null) {
    if (req.method === 'PUT') {
      await handleSetMonthOverride(req, res, now, itemMonth.itemId, itemMonth.month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const itemId = segmentAfter(pathname, ITEM_PATH_PREFIX);
  if (itemId !== null) {
    if (req.method === 'PUT') {
      await handleUpdateMonthItem(req, res, now, itemId);
      return true;
    }
    if (req.method === 'DELETE') {
      await handleDeleteMonthItem(req, res, now, itemId);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  sendJson(res, 404, { error: MESSAGES.unknownPath });
  return true;
}

async function sessionOrNull(req, res, now) {
  let guard;
  try {
    guard = await requireSession(getDatabase(), { token: readSessionToken(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return null;
  }
  if (guard.unauthorized === true) {
    sendUnauthorized(res, guard.message);
    return null;
  }
  return guard.session;
}

async function sessionUserId(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  return session === null ? null : session.userId;
}

async function handleReadMonth(req, res, now, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let result;
  try {
    result = await readMonth(userId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { items: result.items, totals: result.totals, budgets: result.budgets });
}

async function handleSetBudget(req, res, now, month) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateBudgetDraft(body);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let budgets;
  try {
    await setBudget(session.userId, month, result.value.category, result.value.amountOre, { now });
    budgets = (await readMonth(session.userId, month)).budgets;
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { budgets });
}

async function handleDeleteBudget(req, res, now, month, category) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let removed;
  try {
    removed = await removeBudget(session.userId, month, category);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

async function handleReadOverview(req, res, now, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let result;
  try {
    result = await readOverview(userId, month, OVERVIEW_MONTHS);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { months: result.months, savedThisYear: result.savedThisYear });
}

async function handleReadReport(req, res, now, report) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  if (!isValidIsoMonth(report.month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  if (report.count < OVERVIEW_MIN_MONTHS || report.count > OVERVIEW_MAX_MONTHS) {
    sendJson(res, 400, { error: MESSAGES.invalidReportCount });
    return;
  }
  let result;
  try {
    result = await readReport(session.userId, report.month, report.count);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (report.csv) {
    sendCsv(res, reportFileName(report.month), toCsv(reportCsvRows(result)));
    return;
  }
  sendJson(res, 200, { months: result.months, rows: result.rows, largest: result.largest });
}

async function handleDeleteMonthItem(req, res, now, itemId) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  let removed;
  try {
    removed = await removeMonthItem(userId, itemId);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

async function handleCreateMonthItem(req, res, now, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateMonthItemDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let item;
  try {
    item = await addMonthItem(userId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { item });
}

async function handleUpdateMonthItem(req, res, now, itemId) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateMonthItemDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let item;
  try {
    item = await updateMonthItem(userId, itemId, result.value);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (item === null) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  sendJson(res, 200, { item });
}

async function handleCreateTemplate(req, res, now, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateTemplateDraft(draft, month);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let template;
  try {
    template = await addTemplate(userId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { template });
}

async function handleChangeTemplate(req, res, now, seriesId, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateTemplateDraft(draft, month);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let template;
  try {
    template = await changeTemplateFrom(userId, seriesId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (template === null) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  sendJson(res, 200, { template });
}

async function handleEndTemplate(req, res, now, seriesId, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let ended;
  try {
    ended = await endTemplate(userId, seriesId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!ended) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

async function handleSetMonthOverride(req, res, now, templateId, month) {
  const userId = await sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateOverrideDraft(body);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let changed;
  try {
    changed = result.value.skipped
      ? await skipMonth(userId, templateId, month, { now })
      : await setOverride(userId, templateId, month, result.value.amountOre, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!changed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  let result2;
  try {
    result2 = await readMonth(userId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { items: result2.items, totals: result2.totals, budgets: result2.budgets });
}

async function billSessionOrNull(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return null;
  }
  return session;
}

async function handleReadBills(req, res, now, today) {
  const session = await billSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  if (!isValidIsoDate(today)) {
    sendJson(res, 400, { error: MESSAGES.invalidToday });
    return;
  }
  let bills;
  try {
    bills = await readBills(session.userId, today);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { bills });
}

async function handleCreateBill(req, res, now) {
  const session = await billSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateBillDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let bill;
  try {
    bill = await addBill(session.userId, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { bill });
}

async function handleUpdateBill(req, res, now, billId) {
  const session = await billSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateBillDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let bill;
  try {
    bill = await updateBill(session.userId, billId, result.value);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (bill === null) {
    sendJson(res, 404, { error: MESSAGES.billNotFound });
    return;
  }
  sendJson(res, 200, { bill });
}

async function handleMarkBillPaid(req, res, now, billId) {
  const session = await billSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const today = body?.today;
  if (!isValidIsoDate(today)) {
    sendJson(res, 400, { error: MESSAGES.invalidToday });
    return;
  }
  let bill;
  try {
    bill = await markBillPaid(session.userId, billId, today, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (bill === null) {
    sendJson(res, 404, { error: MESSAGES.billNotFound });
    return;
  }
  sendJson(res, 200, { bill });
}

async function handleDeleteBill(req, res, now, billId) {
  const session = await billSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  let removed;
  try {
    removed = await removeBill(session.userId, billId);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.billNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

async function goalSessionOrNull(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return null;
  }
  return session;
}

async function handleReadGoals(req, res, now, today) {
  const session = await goalSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  if (!isValidIsoDate(today)) {
    sendJson(res, 400, { error: MESSAGES.invalidToday });
    return;
  }
  let goals;
  try {
    goals = await readGoals(session.userId, today);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { goals });
}

async function handleCreateGoal(req, res, now) {
  const session = await goalSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateGoalDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let goal;
  try {
    goal = await addGoal(session.userId, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { goal });
}

async function handleUpdateGoal(req, res, now, goalId) {
  const session = await goalSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateGoalDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let goal;
  try {
    goal = await updateGoal(session.userId, goalId, result.value);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (goal === null) {
    sendJson(res, 404, { error: MESSAGES.goalNotFound });
    return;
  }
  sendJson(res, 200, { goal });
}

async function handleDeleteGoal(req, res, now, goalId) {
  const session = await goalSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  let removed;
  try {
    removed = await removeGoal(session.userId, goalId);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.goalNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

async function handleCreateDeposit(req, res, now, goalId) {
  const session = await goalSessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateDepositDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let deposit;
  try {
    deposit = await addDeposit(session.userId, goalId, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (deposit === null) {
    sendJson(res, 404, { error: MESSAGES.goalNotFound });
    return;
  }
  sendJson(res, 201, { deposit });
}

function sendUnauthorized(res, message) {
  const text = JSON.stringify({ error: message });
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Set-Cookie': clearedSessionCookie()
  });
  res.end(text);
}


function sendAuthError(res, result) {
  const body = { error: result.message };
  if (typeof result.field === 'string') {
    body.fieldErrors = [{ field: result.field, message: result.message }];
  }
  sendJson(res, result.status, body);
}

async function handleRegister(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE || body === null || typeof body !== 'object') {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  let result;
  try {
    result = await register(getDatabase(), { email: body.email, password: body.password, ip: clientIp(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (result.status !== 201) {
    sendAuthError(res, result);
    return;
  }
  const text = JSON.stringify({ ok: true });
  res.writeHead(201, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Set-Cookie': sessionCookie(result.token)
  });
  res.end(text);
}

async function handleLogin(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE || body === null || typeof body !== 'object') {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  let result;
  try {
    result = await logIn(getDatabase(), { email: body.email, password: body.password, ip: clientIp(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (result.status !== 204) {
    sendJson(res, result.status, { error: result.message });
    return;
  }
  res.writeHead(204, { 'Set-Cookie': sessionCookie(result.token) });
  res.end();
}

async function handleLogout(req, res, now) {
  try {
    await logOut(getDatabase(), { token: readSessionToken(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  res.writeHead(204, { 'Set-Cookie': clearedSessionCookie() });
  res.end();
}

function appUrl(req) {
  const configured = process.env.APP_URL;
  if (typeof configured === 'string' && configured.trim() !== '') {
    return configured.trim().replace(/\/+$/, '');
  }
  if (isProduction()) {
    return null;
  }
  const host = typeof req?.headers?.host === 'string' ? req.headers.host : '127.0.0.1:3000';
  return `http://${host}`;
}

async function handleForgotPassword(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE || body === null || typeof body !== 'object') {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const url = appUrl(req);
  if (url === null) {
    sendJson(res, 500, { error: MESSAGES.missingAppUrl });
    return;
  }
  let result;
  try {
    result = await requestPasswordReset(getDatabase(), { email: body.email, ip: clientIp(req), now, appUrl: url });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (result.status !== 202) {
    sendJson(res, result.status, { error: result.message });
    return;
  }
  res.writeHead(202);
  res.end();
}

async function handleResetPassword(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE || body === null || typeof body !== 'object') {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  let result;
  try {
    result = await resetPassword(getDatabase(), { token: body.token, password: body.password, now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (result.status !== 204) {
    sendAuthError(res, result);
    return;
  }
  res.writeHead(204, { 'Set-Cookie': sessionCookie(result.token) });
  res.end();
}

async function handleMe(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  sendJson(res, 200, { email: session.email });
}

async function handleDeleteAccount(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE || body === null || typeof body !== 'object') {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  let result;
  try {
    result = await deleteAccount(getDatabase(), { userId: session.userId, password: body.password });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (result.status !== 204) {
    sendJson(res, result.status, { error: result.message });
    return;
  }
  res.writeHead(204, { 'Set-Cookie': clearedSessionCookie() });
  res.end();
}

const EXPORT_TABLES = Object.freeze([
  ['templates', 'id, series_id, kind, name, amount_ore, category, interval, start_date, from_month, to_month, created_at'],
  ['month_items', 'id, month, kind, name, amount_ore, category, occurred_on, note, created_at'],
  ['overrides', 'id, template_id, month, amount_ore, skipped, created_at'],
  ['budgets', 'id, month, category, amount_ore, created_at'],
  ['bills', 'id, name, amount_ore, due_date, anchor_date, interval, remind_days, paid_at, created_at'],
  ['goals', 'id, name, target_ore, target_date, created_at'],
  ['goal_deposits', 'id, goal_id, amount_ore, made_on, created_at']
]);

async function handleExport(req, res, now) {
  const session = await sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const data = { exportedAt: now, email: session.email };
  try {
    for (const [table, columns] of EXPORT_TABLES) {
      data[table] = await readRows(getDatabase(), `SELECT ${columns} FROM ${table} WHERE user_id = ? ORDER BY created_at, id`, [session.userId]);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  const text = JSON.stringify(data, null, 2);
  res.writeHead(200, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Content-Disposition': 'attachment; filename="hem-och-ekonomi.json"'
  });
  res.end(text);
}
