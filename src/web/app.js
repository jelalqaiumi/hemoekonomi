import {
  BILL_STATUSES,
  REMIND_DAYS_DEFAULT,
  REMIND_DAYS_MAX,
  REMIND_DAYS_MIN,
  billDaysText
} from '/core/bill.js';
import { isValidIsoDate, monthLabel, monthName, monthOfIsoDate, shiftMonth, todayIso } from '/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '/core/entry.js';
import { ITEM_KINDS, ITEM_KIND_LABELS } from '/core/item.js';
import { GOAL_STATUSES, PERCENT_FULL, PERCENT_MIN } from '/core/goal.js';
import { divideRoundHalfUp, formatSek, oreToSek } from '/core/money.js';
import { reportFileName } from '/core/report-csv.js';

const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const CHART_EMPTY_TEXT = 'Inga utgifter att visa i diagrammet ännu.';
const REPORT_EMPTY_TEXT = 'Inget att visa för perioden.';
const CHART_TITLE = 'Utgifter per kategori';
const RECURRING_MARK = '\u21bb';
const RECURRING_TITLE = 'Återkommande varje månad';
const LOGIN_MODES = Object.freeze({
  login: { title: 'Logga in', submit: 'Logga in', passwordLabel: 'Lösenord', autocomplete: 'current-password' },
  register: { title: 'Skapa konto', submit: 'Skapa konto', passwordLabel: 'Välj ett lösenord', autocomplete: 'new-password' },
  forgot: { title: 'Glömt lösenord', submit: 'Skicka länk', passwordLabel: 'Lösenord', autocomplete: 'current-password' },
  reset: { title: 'Välj ett nytt lösenord', submit: 'Spara nytt lösenord', passwordLabel: 'Nytt lösenord', autocomplete: 'new-password' }
});
const RESET_SENT_TEXT = 'Om adressen har ett konto har vi skickat en länk dit. Den gäller i en timme. Titta också i skräpposten.';
const RESET_PARAM = 'aterstall';
const REGISTER_PARAM = 'registrera';

const BUDGET_LEFT_PREFIX = 'kvar ';

function budgetLeftText(leftOre) {
  return `${BUDGET_LEFT_PREFIX}${formatSek(leftOre)}`;
}

const BILL_PAID_LABEL = 'Betald';
const BILL_ONE_TIME_LABEL = 'Engångs';

const SAVE_LABEL = 'Spara';
const SAVE_CHANGE_LABEL = 'Spara ändring';
const EDIT_LABEL = 'Ändra';
const REMOVE_LABEL = 'Ta bort';

const EDIT_QUESTION = 'Vad ska ändras?';
const REMOVE_QUESTION = 'Vad ska tas bort?';
function onlyMonthLabel(month) {
  return `Bara ${monthLabel(month)}`;
}

function fromMonthLabel(month) {
  return `Från och med ${monthLabel(month)}`;
}

function monthOnlyNoteText(month) {
  return `Ändrar bara beloppet för ${monthLabel(month)}.`;
}

const INCOME = 'income';
const EXPENSE = 'expense';
const SAVING = 'saving';

const LISTS = Object.freeze({
  [INCOME]: Object.freeze({
    list: '#income-list',
    empty: '#income-empty',
    add: '#add-income',
    emptyText: (month) => `Inga inkomster i ${month} ännu - lägg till din första.`
  }),
  [EXPENSE]: Object.freeze({
    list: '#expense-list',
    empty: '#expense-empty',
    add: '#add-expense',
    emptyText: (month) => `Inga utgifter i ${month} ännu - lägg till din första.`
  }),
  [SAVING]: Object.freeze({
    list: '#saving-list',
    empty: '#saving-empty',
    add: '#add-saving',
    emptyText: (month) => `Inget sparande i ${month} ännu - lägg till ditt första.`
  })
});

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const CHART_WIDTH = 100;
const CHART_ROW_HEIGHT = 14;
const CHART_BAR_HEIGHT = 5;
const CHART_TEXT_BASELINE = 5;
const CHART_BAR_TOP = 7;

const OVERVIEW_CHART_WIDTH = 120;
const OVERVIEW_CHART_HALF = 20;
const OVERVIEW_BAR_GAP = 2;
const OVERVIEW_CHART_TITLE = 'Kvar att leva på per månad';
const OVERVIEW_BAR_POSITIVE = 'overview-bar overview-bar-positive';
const OVERVIEW_BAR_NEGATIVE = 'overview-bar overview-bar-negative';

const LOGIN_VIEW = document.querySelector('#login-view');
const LOGIN_TITLE = document.querySelector('#login-title');
const LOGIN_TABS = document.querySelector('#login-tabs');
const TAB_LOGIN = document.querySelector('#tab-login');
const TAB_REGISTER = document.querySelector('#tab-register');
const LOGIN_FORM = document.querySelector('#login-form');
const LOGIN_EMAIL_FIELD = document.querySelector('#login-email-field');
const LOGIN_EMAIL = document.querySelector('#login-email');
const LOGIN_PASSWORD_FIELD = document.querySelector('#login-password-field');
const LOGIN_PASSWORD_LABEL = document.querySelector('#login-password-label');
const LOGIN_PASSWORD = document.querySelector('#login-password');
const PASSWORD_HINT = document.querySelector('#password-hint');
const LOGIN_SUBMIT = document.querySelector('#login-submit');
const FORGOT_LINK = document.querySelector('#forgot-link');
const BACK_TO_LOGIN = document.querySelector('#back-to-login');
const LOGIN_NOTE = document.querySelector('#login-note');
const LOGIN_ERROR = document.querySelector('#login-error');
const LOGIN_FIELD_ERRORS = Object.freeze({
  email: document.querySelector('#error-email'),
  password: document.querySelector('#error-password')
});

const MONTH_VIEW = document.querySelector('#month-view');
const MONTH_PREV = document.querySelector('#month-prev');
const MONTH_NEXT = document.querySelector('#month-next');
const MONTH_LABEL = document.querySelector('#month-label');
const MONTH_ERROR = document.querySelector('#month-error');
const USER_EMAIL = document.querySelector('#user-email');
const LOG_OUT = document.querySelector('#log-out');

const TOTAL_INCOME = document.querySelector('#total-income');
const TOTAL_EXPENSE = document.querySelector('#total-expense');
const TOTAL_SAVING = document.querySelector('#total-saving');
const TOTAL_LEFT = document.querySelector('#total-left');

const CHART = document.querySelector('#chart');
const CHART_EMPTY = document.querySelector('#chart-empty');

const OVERVIEW_VIEW = document.querySelector('#overview-view');
const SHOW_OVERVIEW = document.querySelector('#show-overview');
const BACK_TO_MONTH = document.querySelector('#back-to-month');
const OVERVIEW_LABEL = document.querySelector('#overview-label');
const OVERVIEW_SAVED = document.querySelector('#overview-saved');
const OVERVIEW_AVERAGE = document.querySelector('#overview-average');
const OVERVIEW_BEST = document.querySelector('#overview-best');
const OVERVIEW_CHART = document.querySelector('#overview-chart');
const OVERVIEW_ROWS = document.querySelector('#overview-rows');

const ACCOUNT_VIEW = document.querySelector('#account-view');
const SHOW_ACCOUNT = document.querySelector('#show-account');
const BACK_FROM_ACCOUNT = document.querySelector('#back-from-account');
const ACCOUNT_EMAIL = document.querySelector('#account-email');
const DELETE_FORM = document.querySelector('#delete-form');
const DELETE_PASSWORD = document.querySelector('#delete-password');
const DELETE_ERROR = document.querySelector('#delete-error');
const DELETE_SUBMIT = document.querySelector('#delete-submit');

const FORM_CARD = document.querySelector('#item-form-card');
const FORM = document.querySelector('#item-form');
const FORM_ERROR = document.querySelector('#item-form-error');
const SUBMIT_BUTTON = document.querySelector('#item-submit');
const CANCEL_BUTTON = document.querySelector('#item-cancel');

const RECURRING_CHECKBOX = document.querySelector('#item-recurring');
const RECURRING_FIELDS = document.querySelector('#recurring-fields');
const INTERVAL_FIELD = document.querySelector('#item-interval');
const TO_MONTH_FIELD = document.querySelector('#item-to-month');

const NAME_FIELD_BLOCK = document.querySelector('#name-field');
const CATEGORY_FIELD_BLOCK = document.querySelector('#category-field');
const RECURRING_FIELD_BLOCK = document.querySelector('#recurring-field');
const MONTH_ONLY_NOTE = document.querySelector('#month-only-note');

const SINGLE_FIELDS = document.querySelector('#single-fields');
const OCCURRED_ON_FIELD = document.querySelector('#item-occurred-on');
const NOTE_FIELD = document.querySelector('#item-note');

const BUDGET_LIST = document.querySelector('#budget-list');
const ADD_BUDGET = document.querySelector('#add-budget');
const BUDGET_FORM = document.querySelector('#budget-form');
const BUDGET_CATEGORY_FIELD = document.querySelector('#budget-category');
const BUDGET_AMOUNT_FIELD = document.querySelector('#budget-amount');
const BUDGET_FORM_ERROR = document.querySelector('#budget-form-error');
const BUDGET_SUBMIT = document.querySelector('#budget-submit');
const BUDGET_CANCEL = document.querySelector('#budget-cancel');

const BILL_LIST = document.querySelector('#bill-list');
const ADD_BILL = document.querySelector('#add-bill');
const BILL_FORM = document.querySelector('#bill-form');
const BILL_NAME_FIELD = document.querySelector('#bill-name');
const BILL_AMOUNT_FIELD = document.querySelector('#bill-amount');
const BILL_DUE_DATE_FIELD = document.querySelector('#bill-due-date');
const BILL_INTERVAL_FIELD = document.querySelector('#bill-interval');
const BILL_REMIND_DAYS_FIELD = document.querySelector('#bill-remind-days');
const BILL_FORM_ERROR = document.querySelector('#bill-form-error');
const BILL_SUBMIT = document.querySelector('#bill-submit');
const BILL_CANCEL = document.querySelector('#bill-cancel');

const GOAL_CARD = document.querySelector('#goal-card');
const GOAL_LIST = document.querySelector('#goal-list');
const ADD_GOAL = document.querySelector('#add-goal');
const GOAL_FORM = document.querySelector('#goal-form');
const GOAL_NAME_FIELD = document.querySelector('#goal-name');
const GOAL_TARGET_FIELD = document.querySelector('#goal-target');
const GOAL_TARGET_DATE_FIELD = document.querySelector('#goal-target-date');
const GOAL_FORM_ERROR = document.querySelector('#goal-form-error');
const GOAL_SUBMIT = document.querySelector('#goal-submit');
const GOAL_CANCEL = document.querySelector('#goal-cancel');

const REPORT_CARD = document.querySelector('#report-card');
const REPORT_CHART = document.querySelector('#report-chart');
const REPORT_CHART_EMPTY = document.querySelector('#report-chart-empty');
const REPORT_ROWS = document.querySelector('#report-rows');
const REPORT_EMPTY = document.querySelector('#report-empty');
const REPORT_DOWNLOAD = document.querySelector('#report-download');
const REPORT_ERROR = document.querySelector('#report-error');

const REPORT_PERIODS = Object.freeze([3, 6, 12]);
const REPORT_DEFAULT_PERIOD = 12;
const REPORT_PERIOD_BUTTONS = new Map(
  REPORT_PERIODS.map((count) => [count, document.querySelector(`#report-period-${count}`)])
);

const DEPOSIT_FORM = document.querySelector('#deposit-form');
const DEPOSIT_AMOUNT_FIELD = document.querySelector('#deposit-amount');
const DEPOSIT_DATE_FIELD = document.querySelector('#deposit-date');
const DEPOSIT_FORM_ERROR = document.querySelector('#deposit-form-error');
const DEPOSIT_SUBMIT = document.querySelector('#deposit-submit');
const DEPOSIT_CANCEL = document.querySelector('#deposit-cancel');

const FORM_FIELDS = ['name', 'amountSek', 'category', 'occurredOn', 'note', 'interval', 'toMonth'];

const MODE_NEW = 'new';
const MODE_ITEM = 'item';
const MODE_MONTH = 'month';
const MODE_SERIES = 'series';

const TODAY = todayIso();
let currentMonth = monthOfIsoDate(TODAY);
let loginMode = 'login';
let resetToken = null;
let startInRegister = false;
let editingId = null;
let formKind = null;
let formMode = MODE_NEW;
let formSeriesId = null;
let openQuestion = null;
let submitInProgress = false;
let budgetSubmitInProgress = false;
let billSubmitInProgress = false;

let goalSubmitInProgress = false;
let depositSubmitInProgress = false;
let depositGoalId = null;
let monthOnlyLayout = false;
let reportCount = REPORT_DEFAULT_PERIOD;
let reportMonth = null;

function fieldErrorElement(field) {
  return document.querySelector(`#error-${field}`);
}

function clearFormErrors() {
  FORM_ERROR.textContent = '';
  for (const field of FORM_FIELDS) {
    fieldErrorElement(field).textContent = '';
  }
}

async function readJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

function generalText(body) {
  return typeof body.error === 'string' ? body.error : GENERAL_ERROR;
}

function showFormErrors(body) {
  clearFormErrors();

  const fieldErrors = Array.isArray(body.fieldErrors) ? body.fieldErrors : [];
  let showedFieldError = false;

  for (const field of FORM_FIELDS) {
    const fieldError = fieldErrors.find((candidate) => candidate.field === field);
    if (fieldError !== undefined) {
      fieldErrorElement(field).textContent = fieldError.message;
      showedFieldError = true;
    }
  }

  if (!showedFieldError) {
    FORM_ERROR.textContent = generalText(body);
  }
}

function fillOptions(selectId, labels) {
  const select = document.querySelector(selectId);
  for (const [value, label] of Object.entries(labels)) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    select.append(option);
  }
}

function showLoginView() {
  LOGIN_VIEW.hidden = false;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = true;
  ACCOUNT_VIEW.hidden = true;
  if (resetToken !== null) {
    setLoginMode('reset');
  } else if (startInRegister) {
    startInRegister = false;
    setLoginMode('register');
  } else {
    setLoginMode('login');
  }
}

function setLoginMode(mode) {
  loginMode = mode;
  const texts = LOGIN_MODES[mode];
  LOGIN_TITLE.textContent = texts.title;
  LOGIN_SUBMIT.textContent = texts.submit;
  LOGIN_PASSWORD_LABEL.textContent = texts.passwordLabel;
  LOGIN_PASSWORD.setAttribute('autocomplete', texts.autocomplete);
  LOGIN_PASSWORD.value = '';
  LOGIN_TABS.hidden = mode === 'forgot' || mode === 'reset';
  TAB_LOGIN.setAttribute('aria-pressed', String(mode === 'login'));
  TAB_REGISTER.setAttribute('aria-pressed', String(mode === 'register'));
  LOGIN_EMAIL_FIELD.hidden = mode === 'reset';
  LOGIN_PASSWORD_FIELD.hidden = mode === 'forgot';
  PASSWORD_HINT.hidden = !(mode === 'register' || mode === 'reset');
  FORGOT_LINK.hidden = mode !== 'login';
  BACK_TO_LOGIN.hidden = !(mode === 'forgot' || mode === 'reset');
  LOGIN_NOTE.textContent = '';
  clearLoginErrors();
}

function clearLoginErrors() {
  LOGIN_ERROR.textContent = '';
  for (const element of Object.values(LOGIN_FIELD_ERRORS)) {
    element.textContent = '';
  }
}

function showLoginErrors(body) {
  const fieldErrors = Array.isArray(body?.fieldErrors) ? body.fieldErrors : [];
  let shown = false;
  for (const error of fieldErrors) {
    const element = LOGIN_FIELD_ERRORS[error?.field];
    if (element !== undefined && typeof error.message === 'string') {
      element.textContent = error.message;
      shown = true;
    }
  }
  if (!shown) {
    LOGIN_ERROR.textContent = generalText(body);
  }
}

function showMonthView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = false;
  OVERVIEW_VIEW.hidden = true;
  ACCOUNT_VIEW.hidden = true;
}

function showOverviewView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = false;
  ACCOUNT_VIEW.hidden = true;
}

function showAccountView() {
  LOGIN_VIEW.hidden = true;
  MONTH_VIEW.hidden = true;
  OVERVIEW_VIEW.hidden = true;
  ACCOUNT_VIEW.hidden = false;
  DELETE_PASSWORD.value = '';
  DELETE_ERROR.textContent = '';
}

function sessionExpired(response) {
  if (response.status !== 401) {
    return false;
  }
  showLoginView();
  return true;
}

function renderUser(email) {
  const text = typeof email === 'string' ? email : '';
  USER_EMAIL.textContent = text;
  ACCOUNT_EMAIL.textContent = text;
}

function cell(className, text, tagName = 'span') {
  const element = document.createElement(tagName);
  element.className = className;
  element.textContent = text;
  return element;
}

function actionButton(className, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = className;
  button.textContent = label;
  button.addEventListener('click', () => {
    onClick(button);
  });
  return button;
}

function oreFromResponse(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function renderItem(item) {
  const row = document.createElement('li');
  row.className = 'item';

  row.append(
    cell('item-name', item.name),
    cell('item-category', CATEGORY_LABELS[item.category]),
    cell('item-amount', formatSek(oreFromResponse(item.amountOre)))
  );

  if (item.recurring === true) {
    const mark = cell('item-recurring', RECURRING_MARK);
    mark.title = RECURRING_TITLE;
    row.append(mark);
  }

  if (item.recurring !== true) {
    row.append(
      actionButton('edit', EDIT_LABEL, () => {
        openForm(item.kind, item, MODE_ITEM);
      }),
      actionButton('remove', REMOVE_LABEL, (button) => {
        void sendChange(button, {
          url: `/api/poster/${item.id}`,
          method: 'DELETE',
          body: null,
          okStatus: 204
        });
      })
    );
    return row;
  }

  const question = document.createElement('div');
  question.className = 'item-question';
  question.hidden = true;

  row.append(
    actionButton('edit', EDIT_LABEL, () => {
      showQuestion(question, EDIT_QUESTION, [
        ['scope-month', onlyMonthLabel(currentMonth), () => {
          openForm(item.kind, item, MODE_MONTH);
        }],
        ['scope-forward', fromMonthLabel(currentMonth), () => {
          openForm(item.kind, item, MODE_SERIES);
        }]
      ]);
    }),
    actionButton('remove', REMOVE_LABEL, () => {
      showQuestion(question, REMOVE_QUESTION, [
        ['scope-month', onlyMonthLabel(currentMonth), (button) => {
          void sendChange(button, {
            url: `/api/poster/${item.id}/manad/${currentMonth}`,
            method: 'PUT',
            body: { skipped: true },
            okStatus: 200
          });
        }],
        ['scope-forward', fromMonthLabel(currentMonth), (button) => {
          void sendChange(button, {
            url: `/api/mallar/${item.seriesId}/${currentMonth}`,
            method: 'DELETE',
            body: null,
            okStatus: 204
          });
        }]
      ]);
    }),
    question
  );

  return row;
}

function showQuestion(question, text, choices) {
  if (openQuestion !== null && openQuestion !== question) {
    openQuestion.hidden = true;
  }
  question.replaceChildren(
    cell('question-text', text),
    ...choices.map(([className, label, onClick]) => actionButton(className, label, onClick))
  );
  question.hidden = false;
  openQuestion = question;
}

function renderTotals(totals) {
  TOTAL_INCOME.textContent = formatSek(oreFromResponse(totals.incomeOre));
  TOTAL_EXPENSE.textContent = formatSek(oreFromResponse(totals.expenseOre));
  TOTAL_SAVING.textContent = formatSek(oreFromResponse(totals.savingOre));

  const left = oreFromResponse(totals.leftOre);
  TOTAL_LEFT.textContent = formatSek(left);
  TOTAL_LEFT.className = left < 0 ? 'summary-amount left-negative' : 'summary-amount left-positive';
}

function renderLists(items) {
  const name = monthName(currentMonth);
  for (const kind of ITEM_KINDS) {
    const config = LISTS[kind];
    const list = document.querySelector(config.list);
    const empty = document.querySelector(config.empty);
    const rows = items.filter((item) => item.kind === kind);

    list.replaceChildren();
    for (const item of rows) {
      list.append(renderItem(item));
    }
    empty.textContent = rows.length === 0 ? config.emptyText(name) : '';
  }
}

function expensesByCategory(items) {
  const sums = new Map();
  for (const item of items) {
    if (item.kind !== EXPENSE) {
      continue;
    }
    const earlier = sums.get(item.category) ?? 0;
    sums.set(item.category, earlier + oreFromResponse(item.amountOre));
  }
  return [...sums].map(([category, amountOre]) => ({ category, amountOre }));
}

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NAMESPACE, name);
  for (const [attribute, value] of Object.entries(attributes)) {
    element.setAttribute(attribute, String(value));
  }
  return element;
}

function renderChart(chartElement, emptyElement, allBars) {
  chartElement.replaceChildren();

  const bars = allBars
    .filter((bar) => bar.amountOre > 0)
    .sort((a, b) => b.amountOre - a.amountOre);
  if (bars.length === 0) {
    emptyElement.textContent = CHART_EMPTY_TEXT;
    return;
  }
  emptyElement.textContent = '';

  const largest = bars[0].amountOre;
  const svg = svgElement('svg', {
    role: 'img',
    viewBox: `0 0 ${CHART_WIDTH} ${bars.length * CHART_ROW_HEIGHT}`
  });
  const title = svgElement('title', {});
  title.textContent = CHART_TITLE;
  svg.append(title);

  for (const [index, bar] of bars.entries()) {
    const top = index * CHART_ROW_HEIGHT;

    const label = svgElement('text', { class: 'chart-label', x: 0, y: top + CHART_TEXT_BASELINE });
    label.textContent = CATEGORY_LABELS[bar.category];

    const amount = svgElement('text', {
      class: 'chart-amount',
      x: CHART_WIDTH,
      y: top + CHART_TEXT_BASELINE,
      'text-anchor': 'end'
    });
    amount.textContent = formatSek(bar.amountOre);

    const rect = svgElement('rect', {
      class: 'chart-bar',
      x: 0,
      y: top + CHART_BAR_TOP,
      height: CHART_BAR_HEIGHT,
      width: Math.round((bar.amountOre * CHART_WIDTH) / largest)
    });

    svg.append(label, amount, rect);
  }

  chartElement.append(svg);
}

function budgetRow(line) {
  const row = document.createElement('li');
  row.className = 'item';

  const left = oreFromResponse(line.leftOre);
  row.append(
    cell('budget-category', CATEGORY_LABELS[line.category]),
    cell('budget-amount', formatSek(oreFromResponse(line.amountOre))),
    cell(left < 0 ? 'budget-left left-negative' : 'budget-left left-positive', budgetLeftText(left))
  );
  return row;
}

function renderBudgets(budgets) {
  BUDGET_LIST.replaceChildren(...budgets.map(budgetRow));
}

function daysFromResponse(value) {
  return Number.isSafeInteger(value) ? value : 0;
}

function billClassName(status) {
  return BILL_STATUSES.includes(status) ? `item bill bill-${status}` : 'item bill';
}

function billRow(bill) {
  const row = document.createElement('li');
  row.className = billClassName(bill.status);

  row.append(
    cell('bill-name', bill.name),
    cell('bill-amount', formatSek(oreFromResponse(bill.amountOre))),
    cell('bill-due-date', bill.dueDate),
    cell('bill-days', billDaysText(daysFromResponse(bill.daysUntil))),
    actionButton('bill-paid', BILL_PAID_LABEL, (button) => {
      void payBill(bill.id, button);
    })
  );
  return row;
}

function renderBills(bills) {
  BILL_LIST.replaceChildren(...bills.filter((bill) => bill.paidAt === null).map(billRow));
}

const GOAL_BAR_WIDTH = 200;
const GOAL_BAR_HEIGHT = 6;

const GOAL_LEFT_PREFIX = 'Kvar ';

const GOAL_DEPOSIT_LABEL = '+ Sätt in';

const GOAL_NOTES = Object.freeze({
  klart: 'Målet är nått',
  forsenat: 'Slutdatumet har passerat'
});

function goalClassName(status) {
  return GOAL_STATUSES.includes(status) ? `item goal goal-${status}` : 'item goal';
}

function goalBarClassName(status) {
  return GOAL_STATUSES.includes(status) ? `goal-bar goal-bar-${status}` : 'goal-bar';
}

function percentFromResponse(value) {
  return Number.isSafeInteger(value) ? value : PERCENT_MIN;
}

function goalBarWidth(percent) {
  return Math.round(((percent - PERCENT_MIN) * GOAL_BAR_WIDTH) / (PERCENT_FULL - PERCENT_MIN));
}

function goalBar(percent, status) {
  const svg = svgElement('svg', {
    'aria-hidden': 'true',
    class: 'goal-chart',
    viewBox: `0 0 ${GOAL_BAR_WIDTH} ${GOAL_BAR_HEIGHT}`
  });
  svg.append(
    svgElement('rect', {
      class: 'goal-bar-track',
      x: 0,
      y: 0,
      width: GOAL_BAR_WIDTH,
      height: GOAL_BAR_HEIGHT
    }),
    svgElement('rect', {
      class: goalBarClassName(status),
      x: 0,
      y: 0,
      width: goalBarWidth(percent),
      height: GOAL_BAR_HEIGHT
    })
  );
  return svg;
}

function goalSavedText(goal) {
  return `${formatSek(oreFromResponse(goal.savedOre))} av ${formatSek(oreFromResponse(goal.targetOre))}`;
}

function goalPercentText(percent) {
  return `${percent} %`;
}

function goalLeftText(goal) {
  const left = `${GOAL_LEFT_PREFIX}${formatSek(oreFromResponse(goal.leftOre))}`;
  if (!isValidIsoDate(goal.targetDate) || !Number.isSafeInteger(goal.perMonthOre)) {
    return left;
  }
  const month = monthLabel(monthOfIsoDate(goal.targetDate)).toLowerCase();
  return `${left} - spara ${formatSek(goal.perMonthOre)} i månaden till ${month}`;
}

function goalNoteText(status) {
  return Object.hasOwn(GOAL_NOTES, status) ? GOAL_NOTES[status] : '';
}

function goalRow(goal) {
  const row = document.createElement('li');
  row.className = goalClassName(goal.status);

  const percent = percentFromResponse(goal.percent);
  row.append(
    cell('goal-name', goal.name),
    cell('goal-saved', goalSavedText(goal)),
    goalBar(percent, goal.status),
    cell('goal-percent', goalPercentText(percent)),
    cell('goal-left', goalLeftText(goal)),
    cell('goal-note', goalNoteText(goal.status)),
    actionButton('goal-deposit', GOAL_DEPOSIT_LABEL, () => {
      openDepositForm(goal.id);
    })
  );
  return row;
}

function renderGoals(goals) {
  GOAL_LIST.replaceChildren(...goals.map(goalRow));
}

function showCard(card) {
  card.hidden = false;
}

async function loadGoals() {
  let response;
  try {
    response = await fetch(`/api/sparmal/${TODAY}`);
  } catch {
    MONTH_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);

  if (response.status !== 200) {
    MONTH_ERROR.textContent = generalText(body);
    return;
  }

  renderGoals(Array.isArray(body.goals) ? body.goals : []);
  showCard(GOAL_CARD);
}

function reportRow(row) {
  const tr = document.createElement('tr');
  tr.className = 'report-row';

  const budgets = Array.isArray(row.budgetPerMonthOre) ? row.budgetPerMonthOre : [];
  const lastBudget = budgets[budgets.length - 1];
  const monthsWithBudget = budgets.filter((budget) => Number.isSafeInteger(budget)).length;

  tr.append(
    cell('report-kind', ITEM_KIND_LABELS[row.kind], 'td'),
    cell('report-category', CATEGORY_LABELS[row.category], 'td'),
    cell('report-average', formatSek(oreFromResponse(row.averageOre)), 'td'),
    cell('report-total', formatSek(oreFromResponse(row.totalOre)), 'td'),
    cell('report-budget', Number.isSafeInteger(lastBudget) ? formatSek(lastBudget) : '', 'td'),
    cell('report-over', monthsWithBudget === 0 ? '' : `${row.overBudgetMonths} av ${monthsWithBudget}`, 'td')
  );
  return tr;
}

function renderReport(body, count) {
  const rows = Array.isArray(body.rows) ? body.rows : [];

  const bars = rows
    .filter((row) => row.kind === EXPENSE)
    .map((row) => ({ category: row.category, amountOre: oreFromResponse(row.totalOre) }));
  renderChart(REPORT_CHART, REPORT_CHART_EMPTY, bars);

  REPORT_ROWS.replaceChildren(...rows.map(reportRow));
  REPORT_EMPTY.textContent = rows.length === 0 ? REPORT_EMPTY_TEXT : '';

  reportCount = count;
  reportMonth = currentMonth;
  for (const [period, button] of REPORT_PERIOD_BUTTONS) {
    button.setAttribute('aria-pressed', period === count ? 'true' : 'false');
  }
}

async function loadReport(count = reportCount) {
  let response;
  try {
    response = await fetch(`/api/rapport/${currentMonth}/${count}`);
  } catch {
    REPORT_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);

  if (response.status !== 200) {
    REPORT_ERROR.textContent = generalText(body);
    return;
  }

  REPORT_ERROR.textContent = '';
  renderReport(body, count);
  showCard(REPORT_CARD);
}

async function loadMonthAndReport() {
  await loadMonth();
  await loadReport();
}

async function changeReportPeriod(count, button) {
  button.disabled = true;
  try {
    await loadReport(count);
  } finally {
    button.disabled = false;
  }
}

async function downloadReport(button) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch(`/api/rapport/${reportMonth}/${reportCount}/csv`);
    } catch {
      REPORT_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    if (response.status !== 200) {
      const body = await readJson(response);
      REPORT_ERROR.textContent = generalText(body);
      return;
    }

    let blob;
    try {
      blob = await response.blob();
    } catch {
      REPORT_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = reportFileName(reportMonth);
    link.click();
    REPORT_ERROR.textContent = '';
  } finally {
    button.disabled = false;
  }
}

function openGoalForm() {
  GOAL_FORM.reset();
  GOAL_FORM_ERROR.textContent = '';
  GOAL_FORM.hidden = false;
}

function closeGoalForm() {
  GOAL_FORM.hidden = true;
  GOAL_FORM.reset();
  GOAL_FORM_ERROR.textContent = '';
}

async function submitGoal(button) {
  GOAL_FORM_ERROR.textContent = '';

  button.disabled = true;
  goalSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch('/api/sparmal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: GOAL_NAME_FIELD.value,
          targetSek: GOAL_TARGET_FIELD.value,
          targetDate: GOAL_TARGET_DATE_FIELD.value
        })
      });
    } catch {
      GOAL_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 201) {
      closeGoalForm();
      await loadGoals();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    GOAL_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    goalSubmitInProgress = false;
  }
}

function openDepositForm(goalId) {
  depositGoalId = goalId;
  DEPOSIT_FORM.reset();
  DEPOSIT_FORM_ERROR.textContent = '';
  DEPOSIT_FORM.hidden = false;
}

function closeDepositForm() {
  DEPOSIT_FORM.hidden = true;
  DEPOSIT_FORM.reset();
  DEPOSIT_FORM_ERROR.textContent = '';
}

async function submitDeposit(button) {
  DEPOSIT_FORM_ERROR.textContent = '';

  button.disabled = true;
  depositSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch(`/api/sparmal/${depositGoalId}/insattning`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amountSek: DEPOSIT_AMOUNT_FIELD.value,
          madeOn: DEPOSIT_DATE_FIELD.value
        })
      });
    } catch {
      DEPOSIT_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 201) {
      closeDepositForm();
      await loadGoals();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    DEPOSIT_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    depositSubmitInProgress = false;
  }
}

function renderMonth(body) {
  const items = Array.isArray(body.items) ? body.items : [];
  renderTotals(body.totals ?? {});
  renderLists(items);
  renderChart(CHART, CHART_EMPTY, expensesByCategory(items));
  renderBudgets(Array.isArray(body.budgets) ? body.budgets : []);
}

async function loadMonth() {
  MONTH_LABEL.textContent = monthLabel(currentMonth);

  let response;
  try {
    response = await fetch(`/api/manad/${currentMonth}`);
  } catch {
    MONTH_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    MONTH_ERROR.textContent = generalText(body);
    return;
  }

  MONTH_ERROR.textContent = '';
  renderMonth(body);
}

async function loadBills() {
  let response;
  try {
    response = await fetch(`/api/rakningar/${TODAY}`);
  } catch {
    MONTH_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (sessionExpired(response)) {
    return;
  }

  const body = await readJson(response);
  if (response.status !== 200) {
    MONTH_ERROR.textContent = generalText(body);
    return;
  }

  renderBills(Array.isArray(body.bills) ? body.bills : []);
}

function payBill(billId, button) {
  return sendChange(button, {
    url: `/api/rakningar/${billId}/betald`,
    method: 'POST',
    body: { today: TODAY },
    okStatus: 200,
    reload: loadBills
  });
}

async function changeMonth(month, button) {
  currentMonth = month;
  button.disabled = true;
  try {
    await loadMonthAndReport();
  } finally {
    button.disabled = false;
  }
}

function setRecurring(checked) {
  RECURRING_CHECKBOX.checked = checked;
  RECURRING_FIELDS.hidden = !checked;
  updateSingleFields();
}

function updateSingleFields() {
  SINGLE_FIELDS.hidden = RECURRING_CHECKBOX.checked || monthOnlyLayout;
}

function setMonthOnlyLayout(monthOnly) {
  monthOnlyLayout = monthOnly;
  updateSingleFields();
  NAME_FIELD_BLOCK.hidden = monthOnly;
  CATEGORY_FIELD_BLOCK.hidden = monthOnly;
  RECURRING_FIELD_BLOCK.hidden = monthOnly;
  MONTH_ONLY_NOTE.hidden = !monthOnly;
  MONTH_ONLY_NOTE.textContent = monthOnly ? monthOnlyNoteText(currentMonth) : '';
}

function openForm(kind, item, mode) {
  clearFormErrors();
  formKind = kind;
  formMode = mode;
  editingId = item === null ? null : item.id;
  formSeriesId = item === null ? null : item.seriesId;

  FORM.reset();
  if (item !== null) {
    FORM.elements.name.value = item.name;
    FORM.elements.amountSek.value = String(oreToSek(item.amountOre));
    FORM.elements.category.value = item.category;
    INTERVAL_FIELD.value = item.interval === null ? '' : item.interval;
    TO_MONTH_FIELD.value = item.toMonth === null ? '' : item.toMonth;
    OCCURRED_ON_FIELD.value = typeof item.occurredOn === 'string' ? item.occurredOn : '';
    NOTE_FIELD.value = typeof item.note === 'string' ? item.note : '';
  }

  setRecurring(mode === MODE_SERIES);
  setMonthOnlyLayout(mode === MODE_MONTH);

  SUBMIT_BUTTON.textContent = mode === MODE_NEW ? SAVE_LABEL : SAVE_CHANGE_LABEL;
  FORM_CARD.hidden = false;
}

function closeForm() {
  FORM_CARD.hidden = true;
  FORM.reset();
  setRecurring(false);
  setMonthOnlyLayout(false);
  clearFormErrors();
}

function sharedDraft() {
  return {
    kind: formKind,
    name: FORM.elements.name.value,
    amountSek: FORM.elements.amountSek.value,
    category: FORM.elements.category.value
  };
}

function itemDraft() {
  return { ...sharedDraft(), occurredOn: OCCURRED_ON_FIELD.value, note: NOTE_FIELD.value };
}

function templateDraft() {
  return { ...sharedDraft(), interval: INTERVAL_FIELD.value, toMonth: TO_MONTH_FIELD.value };
}

function formRequest() {
  if (formMode === MODE_MONTH) {
    return {
      url: `/api/poster/${editingId}/manad/${currentMonth}`,
      method: 'PUT',
      body: { amountSek: FORM.elements.amountSek.value },
      okStatus: 200
    };
  }
  if (formMode === MODE_SERIES) {
    return {
      url: `/api/mallar/${formSeriesId}/${currentMonth}`,
      method: 'PUT',
      body: templateDraft(),
      okStatus: 200
    };
  }
  if (formMode === MODE_ITEM) {
    return { url: `/api/poster/${editingId}`, method: 'PUT', body: itemDraft(), okStatus: 200 };
  }
  return RECURRING_CHECKBOX.checked
    ? { url: `/api/mallar/${currentMonth}`, method: 'POST', body: templateDraft(), okStatus: 201 }
    : { url: `/api/manad/${currentMonth}`, method: 'POST', body: itemDraft(), okStatus: 201 };
}

async function submitForm(button) {
  clearFormErrors();

  const { url, method, body, okStatus } = formRequest();

  button.disabled = true;
  submitInProgress = true;
  try {
    let response;
    try {
      response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      });
    } catch {
      FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === okStatus) {
      closeForm();
      await loadMonthAndReport();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    showFormErrors(await readJson(response));
  } finally {
    button.disabled = false;
    submitInProgress = false;
  }
}

function openBudgetForm() {
  BUDGET_FORM.reset();
  BUDGET_FORM_ERROR.textContent = '';
  BUDGET_FORM.hidden = false;
}

function closeBudgetForm() {
  BUDGET_FORM.hidden = true;
  BUDGET_FORM.reset();
  BUDGET_FORM_ERROR.textContent = '';
}

async function submitBudget(button) {
  BUDGET_FORM_ERROR.textContent = '';

  button.disabled = true;
  budgetSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch(`/api/budget/${currentMonth}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          category: BUDGET_CATEGORY_FIELD.value,
          amountSek: BUDGET_AMOUNT_FIELD.value
        })
      });
    } catch {
      BUDGET_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 200) {
      closeBudgetForm();
      await loadMonthAndReport();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    BUDGET_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    budgetSubmitInProgress = false;
  }
}

function openBillForm() {
  BILL_FORM.reset();
  BILL_REMIND_DAYS_FIELD.value = String(REMIND_DAYS_DEFAULT);
  BILL_FORM_ERROR.textContent = '';
  BILL_FORM.hidden = false;
}

function closeBillForm() {
  BILL_FORM.hidden = true;
  BILL_FORM.reset();
  BILL_FORM_ERROR.textContent = '';
}

async function submitBill(button) {
  BILL_FORM_ERROR.textContent = '';

  button.disabled = true;
  billSubmitInProgress = true;
  try {
    let response;
    try {
      response = await fetch('/api/rakningar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: BILL_NAME_FIELD.value,
          amountSek: BILL_AMOUNT_FIELD.value,
          dueDate: BILL_DUE_DATE_FIELD.value,
          interval: BILL_INTERVAL_FIELD.value,
          remindDays: BILL_REMIND_DAYS_FIELD.value
        })
      });
    } catch {
      BILL_FORM_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === 201) {
      closeBillForm();
      await loadBills();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    BILL_FORM_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
    billSubmitInProgress = false;
  }
}

async function sendChange(button, { url, method, body, okStatus, reload = loadMonthAndReport }) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch(
        url,
        body === null
          ? { method }
          : { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
      );
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (response.status === okStatus) {
      await reload();
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    MONTH_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

async function logOut(button) {
  button.disabled = true;
  try {
    try {
      await fetch('/api/auth/logga-ut', { method: 'POST' });
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }
    showLoginView();
  } finally {
    button.disabled = false;
  }
}

async function submitLogin(button) {
  clearLoginErrors();
  LOGIN_NOTE.textContent = '';
  const email = LOGIN_EMAIL.value;
  const password = LOGIN_PASSWORD.value;
  const request = {
    login: { url: '/api/auth/logga-in', body: { email, password } },
    register: { url: '/api/auth/registrera', body: { email, password } },
    forgot: { url: '/api/auth/glomt-losenord', body: { email } },
    reset: { url: '/api/auth/nytt-losenord', body: { token: resetToken, password } }
  }[loginMode];

  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch(request.url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request.body)
      });
    } catch {
      LOGIN_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (loginMode === 'forgot' && response.status === 202) {
      LOGIN_NOTE.textContent = RESET_SENT_TEXT;
      return;
    }

    if (response.status === 204 || response.status === 201) {
      LOGIN_PASSWORD.value = '';
      if (loginMode === 'reset') {
        resetToken = null;
        history.replaceState(null, '', '/app');
      }
      await loadMe();
      return;
    }

    showLoginErrors(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

async function deleteAccountRequest(button) {
  DELETE_ERROR.textContent = '';
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch('/api/mig', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: DELETE_PASSWORD.value })
      });
    } catch {
      DELETE_ERROR.textContent = GENERAL_ERROR;
      return;
    }
    if (sessionExpired(response)) {
      return;
    }
    if (response.status === 204) {
      DELETE_PASSWORD.value = '';
      showLoginView();
      LOGIN_NOTE.textContent = 'Kontot är borttaget.';
      return;
    }
    DELETE_ERROR.textContent = generalText(await readJson(response));
  } finally {
    button.disabled = false;
  }
}

function overviewHeadingText(month) {
  return `Översikt till och med ${monthLabel(month)}`;
}

function largestLeftMagnitude(months) {
  let largest = 0;
  for (const row of months) {
    const magnitude = Math.abs(oreFromResponse(row.leftOre));
    if (magnitude > largest) {
      largest = magnitude;
    }
  }
  return largest;
}

function bestMonth(months) {
  let best = null;
  for (const row of months) {
    if (best === null || oreFromResponse(row.leftOre) > oreFromResponse(best.leftOre)) {
      best = row;
    }
  }
  return best;
}

function averageLeftOre(months) {
  if (months.length === 0) {
    return 0;
  }
  let sum = 0;
  for (const row of months) {
    sum += oreFromResponse(row.leftOre);
    if (!Number.isSafeInteger(2 * sum + months.length)) {
      return 0;
    }
  }
  return divideRoundHalfUp(sum, months.length);
}

function renderOverviewTotals(months, savedThisYear) {
  OVERVIEW_SAVED.textContent = formatSek(oreFromResponse(savedThisYear));
  OVERVIEW_AVERAGE.textContent = formatSek(averageLeftOre(months));
  const best = bestMonth(months);
  OVERVIEW_BEST.textContent = best === null ? '' : monthLabel(best.month);
}

function renderOverviewChart(months) {
  OVERVIEW_CHART.replaceChildren();
  if (months.length === 0) {
    return;
  }

  const svg = svgElement('svg', {
    role: 'img',
    viewBox: `0 0 ${OVERVIEW_CHART_WIDTH} ${2 * OVERVIEW_CHART_HALF}`
  });
  const title = svgElement('title', {});
  title.textContent = OVERVIEW_CHART_TITLE;
  svg.append(title);

  svg.append(svgElement('line', {
    class: 'overview-zero-line',
    x1: 0,
    y1: OVERVIEW_CHART_HALF,
    x2: OVERVIEW_CHART_WIDTH,
    y2: OVERVIEW_CHART_HALF
  }));

  const largest = largestLeftMagnitude(months);
  const columnWidth = OVERVIEW_CHART_WIDTH / months.length;
  for (const [index, row] of months.entries()) {
    const left = oreFromResponse(row.leftOre);
    const height = largest === 0 ? 0 : Math.round((Math.abs(left) * OVERVIEW_CHART_HALF) / largest);
    const negative = left < 0;
    const bar = svgElement('rect', {
      class: negative ? OVERVIEW_BAR_NEGATIVE : OVERVIEW_BAR_POSITIVE,
      x: index * columnWidth,
      y: negative ? OVERVIEW_CHART_HALF : OVERVIEW_CHART_HALF - height,
      width: columnWidth - OVERVIEW_BAR_GAP,
      height
    });
    const barTitle = svgElement('title', {});
    barTitle.textContent = `${monthLabel(row.month)}: ${formatSek(left)}`;
    bar.append(barTitle);
    svg.append(bar);
  }

  OVERVIEW_CHART.append(svg);
}

function overviewRow(row) {
  const tr = document.createElement('tr');
  const left = oreFromResponse(row.leftOre);
  tr.append(
    cell('overview-month', monthLabel(row.month), 'td'),
    cell('overview-income', formatSek(oreFromResponse(row.incomeOre)), 'td'),
    cell('overview-expense', formatSek(oreFromResponse(row.expenseOre)), 'td'),
    cell('overview-saving', formatSek(oreFromResponse(row.savingOre)), 'td'),
    cell(left < 0 ? 'overview-left left-negative' : 'overview-left left-positive', formatSek(left), 'td')
  );
  return tr;
}

function renderOverviewRows(months) {
  OVERVIEW_ROWS.replaceChildren();
  for (const row of months) {
    OVERVIEW_ROWS.append(overviewRow(row));
  }
}

function renderOverview(body) {
  const months = Array.isArray(body.months) ? body.months : [];
  OVERVIEW_LABEL.textContent = overviewHeadingText(currentMonth);
  renderOverviewTotals(months, body.savedThisYear);
  renderOverviewChart(months);
  renderOverviewRows(months);
}

async function showOverview(button) {
  button.disabled = true;
  try {
    let response;
    try {
      response = await fetch(`/api/oversikt/${currentMonth}`);
    } catch {
      MONTH_ERROR.textContent = GENERAL_ERROR;
      return;
    }

    if (sessionExpired(response)) {
      return;
    }

    const body = await readJson(response);
    if (response.status !== 200) {
      MONTH_ERROR.textContent = generalText(body);
      return;
    }

    MONTH_ERROR.textContent = '';
    renderOverview(body);
    showOverviewView();
  } finally {
    button.disabled = false;
  }
}

async function loadMe() {
  let response;
  try {
    response = await fetch('/api/mig');
  } catch {
    showLoginView();
    LOGIN_ERROR.textContent = GENERAL_ERROR;
    return;
  }

  if (response.status === 200) {
    startInRegister = false;
    if (location.search !== '') {
      history.replaceState(null, '', '/app');
    }
    renderUser((await readJson(response)).email);
    showMonthView();
    await loadMonth();
    void loadBills();
    void loadGoals();
    void loadReport();
    return;
  }

  showLoginView();
  if (response.status !== 401) {
    LOGIN_ERROR.textContent = generalText(await readJson(response));
  }
}

fillOptions('#item-category', CATEGORY_LABELS);
fillOptions('#item-interval', INTERVAL_LABELS);
fillOptions('#budget-category', CATEGORY_LABELS);
fillOptions('#bill-interval', { '': BILL_ONE_TIME_LABEL, ...INTERVAL_LABELS });

BILL_REMIND_DAYS_FIELD.setAttribute('min', String(REMIND_DAYS_MIN));
BILL_REMIND_DAYS_FIELD.setAttribute('max', String(REMIND_DAYS_MAX));

RECURRING_CHECKBOX.addEventListener('change', () => {
  setRecurring(RECURRING_CHECKBOX.checked);
});

TAB_LOGIN.addEventListener('click', () => {
  setLoginMode('login');
});

TAB_REGISTER.addEventListener('click', () => {
  setLoginMode('register');
});

FORGOT_LINK.addEventListener('click', () => {
  setLoginMode('forgot');
});

BACK_TO_LOGIN.addEventListener('click', () => {
  resetToken = null;
  history.replaceState(null, '', '/app');
  setLoginMode('login');
});

let loginSubmitInProgress = false;
LOGIN_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (loginSubmitInProgress) {
    return;
  }
  loginSubmitInProgress = true;
  void submitLogin(LOGIN_SUBMIT).finally(() => {
    loginSubmitInProgress = false;
  });
});

let deleteInProgress = false;
DELETE_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (deleteInProgress) {
    return;
  }
  deleteInProgress = true;
  void deleteAccountRequest(DELETE_SUBMIT).finally(() => {
    deleteInProgress = false;
  });
});

LOG_OUT.addEventListener('click', () => {
  void logOut(LOG_OUT);
});

CANCEL_BUTTON.addEventListener('click', () => {
  closeForm();
});

SHOW_OVERVIEW.addEventListener('click', () => {
  void showOverview(SHOW_OVERVIEW);
});

SHOW_ACCOUNT.addEventListener('click', () => {
  MONTH_ERROR.textContent = '';
  showAccountView();
});

BACK_FROM_ACCOUNT.addEventListener('click', () => {
  showMonthView();
});

BACK_TO_MONTH.addEventListener('click', () => {
  showMonthView();
});

MONTH_PREV.addEventListener('click', () => {
  void changeMonth(shiftMonth(currentMonth, -1), MONTH_PREV);
});

MONTH_NEXT.addEventListener('click', () => {
  void changeMonth(shiftMonth(currentMonth, 1), MONTH_NEXT);
});

for (const kind of ITEM_KINDS) {
  const add = document.querySelector(LISTS[kind].add);
  add.addEventListener('click', () => {
    openForm(kind, null, MODE_NEW);
  });
}

ADD_BUDGET.addEventListener('click', () => {
  openBudgetForm();
});

BUDGET_CANCEL.addEventListener('click', () => {
  closeBudgetForm();
});

ADD_BILL.addEventListener('click', () => {
  openBillForm();
});

BILL_CANCEL.addEventListener('click', () => {
  closeBillForm();
});

ADD_GOAL.addEventListener('click', () => {
  openGoalForm();
});

GOAL_CANCEL.addEventListener('click', () => {
  closeGoalForm();
});

for (const [count, button] of REPORT_PERIOD_BUTTONS) {
  button.addEventListener('click', () => {
    void changeReportPeriod(count, button);
  });
}

REPORT_DOWNLOAD.addEventListener('click', () => {
  void downloadReport(REPORT_DOWNLOAD);
});

GOAL_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (goalSubmitInProgress) {
    return;
  }
  void submitGoal(GOAL_SUBMIT);
});

DEPOSIT_CANCEL.addEventListener('click', () => {
  closeDepositForm();
});

DEPOSIT_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (depositSubmitInProgress) {
    return;
  }
  void submitDeposit(DEPOSIT_SUBMIT);
});

BILL_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (billSubmitInProgress) {
    return;
  }
  void submitBill(BILL_SUBMIT);
});

BUDGET_FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (budgetSubmitInProgress) {
    return;
  }
  void submitBudget(BUDGET_SUBMIT);
});

FORM.addEventListener('submit', (event) => {
  event.preventDefault();
  if (submitInProgress) {
    return;
  }
  void submitForm(SUBMIT_BUTTON);
});

{
  const params = new URLSearchParams(location.search);
  const token = params.get(RESET_PARAM);
  if (typeof token === 'string' && token !== '') {
    resetToken = token;
  }
  startInRegister = params.has(REGISTER_PARAM);
}

if (resetToken !== null) {
  showLoginView();
} else {
  await loadMe();
}
