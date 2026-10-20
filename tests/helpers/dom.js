import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { setFrozenDay, snapshotFrozenDay } from './frozen-dates.js';

const APP_PATH = fileURLToPath(new URL('../../src/web/app.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../../src/web/index.html', import.meta.url));
const CORE_DIR = new URL('../../src/core/', import.meta.url).href;
const CORE_SPECIFIER = "'/core/";
const CORE_DAY_SPECIFIER = `'${CORE_DIR}dates.js'`;
const FROZEN_DAY_SPECIFIER = `'${new URL('./frozen-dates.js', import.meta.url).href}'`;

let appLaddad = false;

function forvaldCreateObjectURL() {
  throw new Error('createObjectURL anropades utan attrapp');
}

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.checked = false;
    this.hidden = false;
    this.title = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }

  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(type, listener) {
    const lista = this.listeners.get(type) ?? [];
    lista.push(listener);
    this.listeners.set(type, lista);
  }

  utlos(type, event = {}) {
    const lista = this.listeners.get(type) ?? [];
    assert.notEqual(lista.length, 0, `ingen ${type}-lyssnare på #${this.id || this.tagName}`);
    if (type === 'click' && this.disabled) {
      return false;
    }
    for (const listener of lista) {
      listener(event);
    }
    return true;
  }

  attlingar() {
    const alla = [];
    for (const barn of this.children) {
      alla.push(barn, ...barn.attlingar());
    }
    return alla;
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this.attlingar().find((element) => element.id === id) ?? null;
    }
    const attribut = /^([a-z]+)\[type="([a-z]+)"\]$/.exec(selector);
    if (attribut !== null) {
      const [, tagName, type] = attribut;
      return this.attlingar().find(
        (element) => element.tagName === tagName && element.type === type
      ) ?? null;
    }
    throw new Error(`DOM-attrappen stöder inte selektorn ${selector}`);
  }
}

class FakeForm extends FakeElement {
  constructor(id) {
    super('form', id);
    this.elements = Object.create(null);
    this.resetAnrop = 0;
  }

  registrera(name, element) {
    this.elements[name] = element;
  }

  reset() {
    this.resetAnrop += 1;
    for (const element of Object.values(this.elements)) {
      element.value = '';
    }
  }
}

const FALT = Object.freeze([
  { name: 'name', id: 'item-name', tagName: 'input' },
  { name: 'amountSek', id: 'item-amount', tagName: 'input' },
  { name: 'category', id: 'item-category', tagName: 'select' }
]);

const ATERKOMMANDE_FALT = Object.freeze([
  { name: 'interval', id: 'item-interval', tagName: 'select' },
  { name: 'toMonth', id: 'item-to-month', tagName: 'input' }
]);

const ENGANGSFALT = Object.freeze([
  { name: 'occurredOn', id: 'item-occurred-on', tagName: 'input' },
  { name: 'note', id: 'item-note', tagName: 'input' }
]);

const LISTOR = Object.freeze(['income', 'expense', 'saving']);

export function createDom() {
  const registry = new Map();

  const skapa = (tagName, id, egenskaper = {}) => {
    const element = new FakeElement(tagName, id);
    Object.assign(element, egenskaper);
    registry.set(id, element);
    return element;
  };

  const loginView = skapa('section', 'login-view');
  const loginTabs = skapa('div', 'login-tabs', { className: 'login-tabs' });
  loginTabs.append(
    skapa('button', 'tab-login', { type: 'button', className: 'secondary', textContent: 'Logga in' }),
    skapa('button', 'tab-register', { type: 'button', className: 'secondary', textContent: 'Skapa konto' })
  );
  const loginForm = new FakeForm('login-form');
  registry.set('login-form', loginForm);
  const emailField = skapa('div', 'login-email-field', { className: 'field' });
  emailField.append(skapa('input', 'login-email', { type: 'email' }), skapa('p', 'error-email', { className: 'field-error' }));
  const passwordField = skapa('div', 'login-password-field', { className: 'field' });
  passwordField.append(
    skapa('label', 'login-password-label', { textContent: 'Lösenord' }),
    skapa('input', 'login-password', { type: 'password' }),
    skapa('p', 'password-hint', { className: 'field-hint', hidden: true }),
    skapa('p', 'error-password', { className: 'field-error' })
  );
  loginForm.append(
    emailField,
    passwordField,
    skapa('button', 'login-submit', { type: 'submit', className: 'primary', textContent: 'Logga in' }),
    skapa('button', 'forgot-link', { type: 'button', className: 'link-button', textContent: 'Glömt lösenordet?' }),
    skapa('button', 'back-to-login', { type: 'button', className: 'link-button', hidden: true })
  );
  loginView.append(
    skapa('h2', 'login-title', { textContent: 'Logga in' }),
    loginTabs,
    loginForm,
    skapa('p', 'login-note', { className: 'lead' }),
    skapa('p', 'login-error', { className: 'form-error' })
  );

  const monthView = skapa('section', 'month-view', { hidden: true });
  monthView.append(
    skapa('span', 'user-email'),
    skapa('button', 'log-out', { type: 'button', textContent: 'Logga ut' }),
    skapa('button', 'month-prev', { type: 'button', textContent: 'Föregående' }),
    skapa('h2', 'month-label'),
    skapa('button', 'month-next', { type: 'button', textContent: 'Nästa' }),
    skapa('span', 'total-income', { className: 'summary-amount' }),
    skapa('span', 'total-expense', { className: 'summary-amount' }),
    skapa('span', 'total-saving', { className: 'summary-amount' }),
    skapa('span', 'total-left', { className: 'summary-amount' })
  );

  const formCard = skapa('section', 'item-form-card', { hidden: true });
  const form = new FakeForm('item-form');
  registry.set('item-form', form);
  form.append(skapa('p', 'month-only-note', { className: 'lead', hidden: true }));
  const faltblock = Object.freeze({ name: 'name-field', category: 'category-field' });
  for (const { name, id, tagName } of FALT) {
    const falt = skapa(tagName, id);
    const fel = skapa('p', `error-${name}`, { className: 'field-error' });
    if (Object.hasOwn(faltblock, name)) {
      const block = skapa('div', faltblock[name], { className: 'field' });
      block.append(falt, fel);
      form.append(block);
    } else {
      form.append(falt, fel);
    }
    form.registrera(name, falt);
  }
  const singleFields = skapa('div', 'single-fields');
  for (const { name, id, tagName } of ENGANGSFALT) {
    const falt = skapa(tagName, id);
    const fel = skapa('p', `error-${name}`, { className: 'field-error' });
    singleFields.append(falt, fel);
    form.registrera(name, falt);
  }
  form.append(singleFields);
  const recurringField = skapa('div', 'recurring-field', { className: 'field field-checkbox' });
  recurringField.append(skapa('input', 'item-recurring', { type: 'checkbox' }));
  form.append(recurringField);
  const recurringFields = skapa('div', 'recurring-fields', { hidden: true });
  for (const { name, id, tagName } of ATERKOMMANDE_FALT) {
    const falt = skapa(tagName, id);
    const fel = skapa('p', `error-${name}`, { className: 'field-error' });
    recurringFields.append(falt, fel);
    form.registrera(name, falt);
  }
  form.append(recurringFields);
  form.append(
    skapa('p', 'item-form-error', { className: 'form-error' }),
    skapa('button', 'item-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'item-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  formCard.append(form);
  monthView.append(formCard);

  for (const slag of LISTOR) {
    monthView.append(
      skapa('button', `add-${slag}`, { type: 'button', className: 'add' }),
      skapa('ul', `${slag}-list`, { className: 'item-list' }),
      skapa('p', `${slag}-empty`, { className: 'empty-state' })
    );
  }

  const billCard = skapa('section', 'bill-card', { className: 'card' });
  const billForm = new FakeForm('bill-form');
  billForm.hidden = true;
  registry.set('bill-form', billForm);
  const billFalt = Object.freeze([
    { name: 'name', id: 'bill-name', tagName: 'input' },
    { name: 'amountSek', id: 'bill-amount', tagName: 'input' },
    { name: 'dueDate', id: 'bill-due-date', tagName: 'input' },
    { name: 'interval', id: 'bill-interval', tagName: 'select' },
    { name: 'remindDays', id: 'bill-remind-days', tagName: 'input' }
  ]);
  for (const { name, id, tagName } of billFalt) {
    const falt = skapa(tagName, id);
    billForm.append(falt);
    billForm.registrera(name, falt);
  }
  billForm.append(
    skapa('p', 'bill-form-error', { className: 'form-error' }),
    skapa('button', 'bill-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'bill-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  billCard.append(
    skapa('button', 'add-bill', { type: 'button', className: 'add' }),
    billForm,
    skapa('ul', 'bill-list', { className: 'item-list' })
  );
  monthView.append(billCard);

  const budgetCard = skapa('section', 'budget-card', { className: 'card' });
  const budgetForm = new FakeForm('budget-form');
  budgetForm.hidden = true;
  registry.set('budget-form', budgetForm);
  const budgetCategory = skapa('select', 'budget-category');
  const budgetAmount = skapa('input', 'budget-amount');
  budgetForm.registrera('category', budgetCategory);
  budgetForm.registrera('amountSek', budgetAmount);
  budgetForm.append(
    budgetCategory,
    budgetAmount,
    skapa('p', 'budget-form-error', { className: 'form-error' }),
    skapa('button', 'budget-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'budget-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  budgetCard.append(
    skapa('button', 'add-budget', { type: 'button', className: 'add' }),
    budgetForm,
    skapa('ul', 'budget-list', { className: 'item-list' })
  );
  monthView.append(budgetCard);

  const goalCard = skapa('section', 'goal-card', { className: 'card', hidden: true });
  const goalForm = new FakeForm('goal-form');
  goalForm.hidden = true;
  registry.set('goal-form', goalForm);
  const goalFalt = Object.freeze([
    { name: 'name', id: 'goal-name', tagName: 'input' },
    { name: 'targetSek', id: 'goal-target', tagName: 'input' },
    { name: 'targetDate', id: 'goal-target-date', tagName: 'input' }
  ]);
  for (const { name, id, tagName } of goalFalt) {
    const falt = skapa(tagName, id);
    goalForm.append(falt);
    goalForm.registrera(name, falt);
  }
  goalForm.append(
    skapa('p', 'goal-form-error', { className: 'form-error' }),
    skapa('button', 'goal-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'goal-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  const depositForm = new FakeForm('deposit-form');
  depositForm.hidden = true;
  registry.set('deposit-form', depositForm);
  const depositFalt = Object.freeze([
    { name: 'amountSek', id: 'deposit-amount', tagName: 'input' },
    { name: 'madeOn', id: 'deposit-date', tagName: 'input' }
  ]);
  for (const { name, id, tagName } of depositFalt) {
    const falt = skapa(tagName, id);
    depositForm.append(falt);
    depositForm.registrera(name, falt);
  }
  depositForm.append(
    skapa('p', 'deposit-form-error', { className: 'form-error' }),
    skapa('button', 'deposit-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'deposit-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  goalCard.append(
    skapa('button', 'add-goal', { type: 'button', className: 'add', textContent: '+ Nytt sparmål' }),
    goalForm,
    depositForm,
    skapa('ul', 'goal-list', { className: 'item-list' })
  );
  monthView.append(goalCard);

  const reportCard = skapa('section', 'report-card', { className: 'card', hidden: true });
  for (const count of [3, 6, 12]) {
    const knappen = skapa('button', `report-period-${count}`, { type: 'button', className: 'secondary', textContent: `${count} mån` });
    knappen.setAttribute('aria-pressed', 'false');
    reportCard.append(knappen);
  }
  reportCard.append(
    skapa('div', 'report-chart', { className: 'chart' }),
    skapa('p', 'report-chart-empty', { className: 'empty-state' }),
    skapa('tbody', 'report-rows'),
    skapa('p', 'report-empty', { className: 'empty-state' }),
    skapa('button', 'report-download', { type: 'button', className: 'secondary', textContent: 'Hämta som CSV' })
  );
  monthView.append(reportCard);
  monthView.append(skapa('p', 'report-error', { className: 'form-error' }));

  monthView.append(
    skapa('div', 'chart', { className: 'chart' }),
    skapa('p', 'chart-empty', { className: 'empty-state' }),
    skapa('p', 'month-error', { className: 'form-error' })
  );

  monthView.append(skapa('button', 'show-overview', { type: 'button', className: 'secondary', textContent: 'Översikt' }));

  monthView.append(skapa('button', 'show-account', { type: 'button', className: 'secondary', textContent: 'Mitt konto' }));

  const overviewView = skapa('section', 'overview-view', { hidden: true });
  overviewView.append(
    skapa('h2', 'overview-label'),
    skapa('button', 'back-to-month', { type: 'button', textContent: 'Tillbaka till månaden' }),
    skapa('span', 'overview-saved', { className: 'summary-amount' }),
    skapa('span', 'overview-average', { className: 'summary-amount' }),
    skapa('span', 'overview-best', { className: 'summary-amount' }),
    skapa('div', 'overview-chart', { className: 'chart' }),
    skapa('tbody', 'overview-rows')
  );

  const accountView = skapa('section', 'account-view', { hidden: true });
  const deleteForm = new FakeForm('delete-form');
  registry.set('delete-form', deleteForm);
  deleteForm.append(
    skapa('input', 'delete-password', { type: 'password' }),
    skapa('p', 'delete-error', { className: 'form-error' }),
    skapa('button', 'delete-submit', { type: 'submit', className: 'danger', textContent: 'Ta bort kontot' })
  );
  accountView.append(
    skapa('button', 'back-from-account', { type: 'button', textContent: 'Tillbaka till månaden' }),
    skapa('span', 'account-email', { className: 'summary-amount' }),
    skapa('a', 'account-export', { href: '/api/mig/export' }),
    deleteForm
  );

  const klick = [];

  const document = {
    querySelector(selector) {
      assert.equal(selector.startsWith('#'), true, `DOM-attrappen stöder inte selektorn ${selector}`);
      return registry.get(selector.slice(1)) ?? null;
    },
    createElement(tagName) {
      const element = new FakeElement(tagName, '');
      if (tagName === 'a') {
        element.href = '';
        element.download = '';
        element.click = () => {
          klick.push({ href: element.href, download: element.download });
        };
      }
      return element;
    },
    createElementNS(namespace, tagName) {
      const element = new FakeElement(tagName, '');
      element.namespace = namespace;
      return element;
    }
  };

  return {
    document,
    klick,
    form,
    loginView,
    monthView,
    overviewView,
    ids: [...registry.keys()].sort(),
    falt: (id) => registry.get(id),
    faltfel: (field) => registry.get(`error-${field}`).textContent,
    rader: (id) => registry.get(id).children,
    text: (element) => element.textContent
  };
}

export async function idsFranIndexHtml() {
  const html = await fs.readFile(INDEX_PATH, 'utf8');
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]).sort();
}

export function createFetch(plan) {
  const anrop = [];

  const svarsobjekt = (svar) => ({
    status: svar.status,
    json: async () => {
      if (svar.json === undefined) {
        throw new SyntaxError('Unexpected token in JSON');
      }
      return svar.json;
    },
    blob: async () => {
      if (!(svar.blob instanceof Blob)) {
        throw new TypeError('svaret har ingen Blob');
      }
      return svar.blob;
    }
  });

  const fetchAttrapp = (url, init = {}) => {
    const post = {
      url,
      method: init.method ?? 'GET',
      body: init.body,
      svara: null,
      kasta: null
    };
    anrop.push(post);

    const svar = plan(post, anrop.length - 1);
    if (svar === null) {
      return new Promise((resolve, reject) => {
        post.svara = (senare) => resolve(svarsobjekt(senare));
        post.kasta = reject;
      });
    }
    if (svar instanceof Error) {
      return Promise.reject(svar);
    }
    return Promise.resolve(svarsobjekt(svar));
  };

  return { fetch: fetchAttrapp, anrop };
}

export async function flush(varv = 50) {
  for (let i = 0; i < varv; i += 1) {
    await Promise.resolve();
  }
}

export async function loadApp(t, { document, fetch, idag, createObjectURL = forvaldCreateObjectURL, search = '' }) {
  if (appLaddad) {
    throw new Error(
      'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.'
    );
  }

  const kalla = await fs.readFile(APP_PATH, 'utf8');
  const antal = kalla.split(CORE_SPECIFIER).length - 1;
  assert.notEqual(
    antal,
    0,
    `src/web/app.js importerar inte längre något under ${CORE_SPECIFIER}… — ompekningen träffar ingenting`
  );

  const medCore = kalla.replaceAll(CORE_SPECIFIER, `'${CORE_DIR}`);
  const antalDagar = medCore.split(CORE_DAY_SPECIFIER).length - 1;
  assert.equal(
    antalDagar,
    1,
    `src/web/app.js ska importera dagens datum från /core/dates.js på exakt ett ställe, hittade ${antalDagar}`
  );

  const omskriven = `${medCore.replaceAll(CORE_DAY_SPECIFIER, FROZEN_DAY_SPECIFIER)}\n// ${randomUUID()}\n`;

  const tidigareDocument = globalThis.document;
  const tidigareFetch = globalThis.fetch;
  const tidigareCreateObjectURL = URL.createObjectURL;
  const tidigareLocation = globalThis.location;
  const tidigareHistory = globalThis.history;
  const aterstallDag = snapshotFrozenDay();
  t.after(() => {
    appLaddad = false;
    globalThis.document = tidigareDocument;
    globalThis.fetch = tidigareFetch;
    URL.createObjectURL = tidigareCreateObjectURL;
    globalThis.location = tidigareLocation;
    globalThis.history = tidigareHistory;
    aterstallDag();
  });
  appLaddad = true;
  globalThis.document = document;
  globalThis.fetch = fetch;
  URL.createObjectURL = createObjectURL;
  const historik = [];
  globalThis.location = { search };
  globalThis.history = {
    replaceState: (state, title, url) => {
      historik.push(url);
      globalThis.location.search = new URL(url, 'http://attrapp').search;
    }
  };
  setFrozenDay(idag);

  const url = `data:text/javascript;base64,${Buffer.from(omskriven, 'utf8').toString('base64')}`;
  const modul = await import(url);
  return { modul, bytDag: setFrozenDay, historik };
}
