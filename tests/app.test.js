import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { monthLabel } from '../src/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '../src/core/entry.js';
import { REMIND_DAYS_DEFAULT, REMIND_DAYS_MAX, REMIND_DAYS_MIN } from '../src/core/bill.js';
import { divideRoundHalfUp, formatSek } from '../src/core/money.js';
import { GOAL_STATUSES } from '../src/core/goal.js';
import { ITEM_KIND_LABELS } from '../src/core/item.js';
import { reportFileName } from '../src/core/report-csv.js';
import { OVERVIEW_MAX_MONTHS, OVERVIEW_MIN_MONTHS } from '../src/server/months.js';
import { createDom, createFetch, flush, idsFranIndexHtml, loadApp } from './helpers/dom.js';

const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const CHART_EMPTY_TEXT = 'Inga utgifter att visa i diagrammet ännu.';
const CHART_TITLE = 'Utgifter per kategori';
const RECURRING_MARK = '\u21bb';
const RECURRING_TITLE = 'Återkommande varje månad';
const BILL_PAID_LABEL = 'Betald';
const BILL_ONE_TIME_LABEL = 'Engångs';
const TOM_INKOMSTLISTA = 'Inga inkomster i september ännu - lägg till din första.';
const TOM_UTGIFTSLISTA = 'Inga utgifter i september ännu - lägg till din första.';
const TOMT_SPARANDE = 'Inget sparande i september ännu - lägg till ditt första.';

const FETCH_FORE_TESTERNA = globalThis.fetch;
const CREATE_OBJECT_URL_FORE_TESTERNA = URL.createObjectURL;

const FRYST_IDAG = '2026-09-16';
const MANAD = '2026-09';
const MANAD_RUBRIK = 'September 2026';
const FOREGAENDE_MANAD = '2026-08';
const FOREGAENDE_RUBRIK = 'Augusti 2026';
const MANADSVAG = `/api/manad/${MANAD}`;

const FRYST_IDAG_DECEMBER = '2026-12-05';
const DECEMBER = '2026-12';
const JANUARI_NASTA_AR = '2027-01';
const JANUARI_RUBRIK = 'Januari 2027';

const MIG_200 = Object.freeze({ status: 200, json: { email: 'nils@example.se' } });
const MIG_401 = Object.freeze({ status: 401, json: { error: 'Du är inte inloggad.' } });

const NOLLOR = Object.freeze({ incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });

const RAKNINGSVAG_PREFIX = '/api/rakningar/';
const RAKNINGSVAG = `${RAKNINGSVAG_PREFIX}${FRYST_IDAG}`;
const RAKNINGAR_TOM = Object.freeze({ status: 200, json: { bills: [] } });

const SPARMALSVAG_PREFIX = '/api/sparmal/';
const SPARMALSVAG = `${SPARMALSVAG_PREFIX}${FRYST_IDAG}`;
const SPARMAL_TOM = Object.freeze({ status: 200, json: { goals: [] } });

const RAPPORTVAG_PREFIX = '/api/rapport/';
const RAPPORT_TOM = Object.freeze({ status: 200, json: { months: [], rows: [], largest: null } });

function post(id, kind, name, amountOre, category, extra = {}) {
  return {
    id,
    kind,
    name,
    amountOre,
    category,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    interval: null,
    toMonth: null,
    ...extra
  };
}

function manadssvar(items, totals = NOLLOR, budgets = []) {
  return { status: 200, json: { items, totals, budgets } };
}

async function starta(t, plan, idag = FRYST_IDAG, { createObjectURL } = {}) {
  const dom = createDom();
  const forstaSvaretMasteKomma = (anropet, index) => {
    const svar = plan(anropet, index);
    if (index === 0 && svar === null) {
      return new Error('planen lämnade app.js första anrop hängande');
    }
    return svar;
  };
  const { fetch, anrop } = createFetch(forstaSvaretMasteKomma);
  const { bytDag } = await loadApp(t, { document: dom.document, fetch, idag, createObjectURL });
  return { dom, anrop, bytDag };
}

function planInloggad(
  hamtaManad,
  ovrigt = () => null,
  hamtaRakningar = () => RAKNINGAR_TOM,
  hamtaSparmal = () => SPARMAL_TOM,
  hamtaRapport = () => RAPPORT_TOM
) {
  return (anropet, index) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.method === 'GET' && anropet.url.startsWith(RAKNINGSVAG_PREFIX)) {
      return hamtaRakningar(anropet, index);
    }
    if (anropet.method === 'GET' && anropet.url.startsWith(SPARMALSVAG_PREFIX)) {
      return hamtaSparmal(anropet, index);
    }
    if (anropet.method === 'GET' && anropet.url.startsWith(RAPPORTVAG_PREFIX)) {
      return hamtaRapport(anropet, index);
    }
    if (anropet.method === 'GET') {
      return hamtaManad(anropet.url);
    }
    return ovrigt(anropet, index);
  };
}

function ikoordning(svar) {
  let nasta = 0;
  return () => svar[Math.min(nasta++, svar.length - 1)];
}

function celltext(rad, className) {
  const cell = rad.children.find((barn) => barn.className === className);
  assert.notEqual(cell, undefined, `raden saknar cellen ${className}`);
  return cell.textContent;
}

function knapp(rad, className) {
  const element = rad.children.find((barn) => barn.className === className);
  assert.notEqual(element, undefined, `raden saknar knappen ${className}`);
  return element;
}

function namnen(dom, listId) {
  return dom.rader(listId).map((rad) => celltext(rad, 'item-name'));
}

function fyllFormularet(dom, { name = 'Hyra', amountSek = '1234,50', category = 'housing' } = {}) {
  dom.falt('item-name').value = name;
  dom.falt('item-amount').value = amountSek;
  dom.falt('item-category').value = category;
}

function skickaFormularet(dom) {
  let forhindrad = false;
  dom.form.utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  return forhindrad;
}

function kropp(anropet) {
  return JSON.parse(anropet.body);
}

test('(37) ett 401 vid laddningen visar inloggningsvyn och döljer månadsvyn', async (t) => {
  const { dom, anrop } = await starta(t, () => MIG_401);

  assert.equal(anrop.length, 1);
  assert.equal(anrop[0].method, 'GET');
  assert.equal(anrop[0].url, '/api/mig');

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('login-password-field').hidden, false);
  assert.equal(dom.falt('login-error').textContent, '');
});

test('(38) ett 200 vid laddningen visar månadsvyn med månadens namn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(anrop.length, 5);
  assert.equal(anrop[1].method, 'GET');
  assert.equal(anrop[1].url, MANADSVAG);

  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('month-label').textContent, MANAD_RUBRIK);
  const val = dom.falt('item-category').children;
  assert.deepEqual(val.map((option) => option.value), Object.keys(CATEGORY_LABELS));
  assert.deepEqual(val.map((option) => option.textContent), Object.values(CATEGORY_LABELS));
  assert.equal(dom.falt('item-form-card').hidden, true);
});

test('(39) månadsvyn öppnar den aktuella månaden, räknad ur den frysta dagen', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])), FRYST_IDAG_DECEMBER);

  assert.equal(anrop[1].url, `/api/manad/${DECEMBER}`);
  assert.equal(dom.falt('month-label').textContent, 'December 2026');
});

test('(40) bakåtknappen hämtar föregående månad och byter rubrik', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('month-prev').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 7);
  assert.equal(anrop[5].method, 'GET');
  assert.equal(anrop[5].url, `/api/manad/${FOREGAENDE_MANAD}`);
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);
  assert.equal(dom.falt('income-empty').textContent, 'Inga inkomster i augusti ännu - lägg till din första.');
});

test('(41) framåtknappen hämtar nästa månad, också över ett årsskifte', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])), FRYST_IDAG_DECEMBER);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 7);
  assert.equal(anrop[5].url, `/api/manad/${JANUARI_NASTA_AR}`);
  assert.equal(dom.falt('month-label').textContent, JANUARI_RUBRIK);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(anrop[7].url, '/api/manad/2027-02');
  assert.equal(dom.falt('month-label').textContent, 'Februari 2027');
});

test('(42) summeringens fyra rader kommer ur svarets totals', async (t) => {
  const totals = { incomeOre: 3000000, expenseOre: 1850000, savingOre: 500000, leftOre: 650000 };
  const { dom } = await starta(t, planInloggad(() => manadssvar([], totals)));

  assert.equal(dom.falt('total-income').textContent, formatSek(3000000));
  assert.equal(dom.falt('total-expense').textContent, formatSek(1850000));
  assert.equal(dom.falt('total-saving').textContent, formatSek(500000));
  assert.equal(dom.falt('total-left').textContent, formatSek(650000));
});

test('(43) ett negativt leftOre ger left-negative och noll ger left-positive', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar([], { incomeOre: 1000000, expenseOre: 1500000, savingOre: 0, leftOre: -500000 }),
        manadssvar([], NOLLOR)
      ])
    )
  );

  assert.equal(dom.falt('total-left').textContent, formatSek(-500000));
  assert.equal(dom.falt('total-left').className.includes('left-negative'), true, dom.falt('total-left').className);
  assert.equal(dom.falt('total-left').className.includes('left-positive'), false);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('total-left').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').className.includes('left-positive'), true, dom.falt('total-left').className);
  assert.equal(dom.falt('total-left').className.includes('left-negative'), false);
});

test('(44) varje tom lista visar sin egen text med månadens namn i gemener', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('income-empty').textContent, TOM_INKOMSTLISTA);
  assert.equal(dom.falt('expense-empty').textContent, TOM_UTGIFTSLISTA);
  assert.equal(dom.falt('saving-empty').textContent, TOMT_SPARANDE);
  assert.equal(dom.rader('income-list').length, 0);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.rader('saving-list').length, 0);
});

test('(45) summeringen visas med fyra nollor också när alla tre listorna är tomma', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  const noll = formatSek(0);
  assert.equal(dom.falt('total-income').textContent, noll);
  assert.equal(dom.falt('total-expense').textContent, noll);
  assert.equal(dom.falt('total-saving').textContent, noll);
  assert.equal(dom.falt('total-left').textContent, noll);
});

function treSlagsposter() {
  return [
    post('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'income', 'Lön', 3000000, 'other'),
    post('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'expense', 'Hyra', 1200000, 'housing', {
      recurring: true,
      seriesId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      dueDate: '2026-09-28'
    }),
    post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 25000, 'other'),
    post('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'saving', 'Buffert', 500000, 'other')
  ];
}

test('(46) en mallpost märks med tecknet och titeln, en engångspost saknar dem', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar(treSlagsposter())));

  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra', 'Bio']);
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
  assert.equal(dom.falt('income-empty').textContent, '');

  const [hyra, bio] = dom.rader('expense-list');
  assert.equal(celltext(hyra, 'item-category'), CATEGORY_LABELS.housing);
  assert.equal(celltext(hyra, 'item-amount'), formatSek(1200000));

  const marke = hyra.children.find((barn) => barn.className === 'item-recurring');
  assert.notEqual(marke, undefined, 'mallposten saknar märket');
  assert.equal(marke.textContent, RECURRING_MARK);
  assert.equal(marke.title, RECURRING_TITLE);

  assert.equal(bio.children.find((barn) => barn.className === 'item-recurring'), undefined);

  assert.equal(knapp(bio, 'edit').textContent, 'Ändra');
  assert.equal(knapp(bio, 'remove').textContent, 'Ta bort');
});

function svgen(dom) {
  const barn = dom.falt('chart').children;
  assert.equal(barn.length, 1, 'diagrammet har inte exakt ett barn');
  return barn[0];
}

function elementen(svg, tagName) {
  return svg.children.filter((barn) => barn.tagName === tagName);
}

function medKlass(svg, className) {
  return elementen(svg, 'text').filter((barn) => barn.getAttribute('class') === className);
}

test('(47) diagrammet har en stapel per kategori med utgift och ingen för en kategori utan', async (t) => {
  const poster = [
    post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other'),
    post('22222222-2222-4222-8222-222222222222', 'expense', 'Hyra', 1500000, 'housing'),
    post('33333333-3333-4333-8333-333333333333', 'expense', 'Hemförsäkring', 500000, 'insurance'),
    post('44444444-4444-4444-8444-444444444444', 'expense', 'Buss', 200000, 'transport'),
    post('55555555-5555-4555-8555-555555555555', 'expense', 'Bensin', 100000, 'transport')
  ];
  const { dom } = await starta(t, planInloggad(() => manadssvar(poster)));

  const svg = svgen(dom);
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('role'), 'img');
  const titlar = elementen(svg, 'title');
  assert.equal(titlar.length, 1);
  assert.equal(titlar[0].textContent, CHART_TITLE);

  const staplar = elementen(svg, 'rect');
  assert.equal(staplar.length, 3);

  const etiketter = medKlass(svg, 'chart-label');
  assert.deepEqual(etiketter.map((barn) => barn.textContent), [
    CATEGORY_LABELS.housing,
    CATEGORY_LABELS.insurance,
    CATEGORY_LABELS.transport
  ]);
  assert.equal(etiketter.some((barn) => barn.textContent === CATEGORY_LABELS.other), false);

  assert.deepEqual(medKlass(svg, 'chart-amount').map((barn) => barn.textContent), [
    formatSek(1500000),
    formatSek(500000),
    formatSek(300000)
  ]);

  assert.deepEqual(staplar.map((barn) => barn.getAttribute('width')), ['100', '33', '20']);
});

test('(48) inga utgifter i månaden döljer diagrammet och visar texten i stället', async (t) => {
  const poster = [post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other')];
  const { dom } = await starta(t, planInloggad(() => manadssvar(poster)));

  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
});

test('diagrammet och listorna byter innehåll i båda riktningarna när månaden hämtas om', async (t) => {
  const inkomstmanad = () => manadssvar([post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other')]);
  const utgiftsmanad = () => manadssvar([post('22222222-2222-4222-8222-222222222222', 'expense', 'Hyra', 1500000, 'housing')]);
  const { dom } = await starta(
    t,
    planInloggad(ikoordning([inkomstmanad(), utgiftsmanad(), inkomstmanad()]))
  );

  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('chart').children.length, 1);
  assert.equal(dom.falt('chart-empty').textContent, '');
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra']);
  assert.equal(dom.falt('expense-empty').textContent, '');
  assert.equal(dom.rader('income-list').length, 0);
  assert.equal(dom.falt('income-empty').textContent, 'Inga inkomster i oktober ännu - lägg till din första.');

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('expense-empty').textContent, 'Inga utgifter i november ännu - lägg till din första.');
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
});

test('(49) en ny utgift skickas som POST och hämtar om månaden', async (t) => {
  const nyPost = post('66666666-6666-4666-8666-666666666666', 'expense', 'Hyra', 123450, 'housing');
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar([]),
        manadssvar([nyPost], { incomeOre: 0, expenseOre: 123450, savingOre: 0, leftOre: -123450 })
      ]),
      () => ({ status: 201, json: { item: nyPost } })
    )
  );

  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('add-expense').utlos('click'), true);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-submit').textContent, 'Spara');

  fyllFormularet(dom);
  assert.equal(skickaFormularet(dom), true, 'app.js kallade inte preventDefault');
  await flush();

  assert.equal(anrop.length, 8);
  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, MANADSVAG);
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '1234,50',
    category: 'housing',
    occurredOn: '',
    note: ''
  });

  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);
  assert.equal(anrop[7].url, `/api/rapport/${MANAD}/12`);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra']);
  assert.equal(dom.falt('total-expense').textContent, formatSek(123450));
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
});

test('en ny inkomst och ett nytt sparande skickar sitt eget slag', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({ status: 201, json: { item: null } }))
  );

  for (const [knappId, slag] of [['add-income', 'income'], ['add-saving', 'saving']]) {
    assert.equal(dom.falt(knappId).utlos('click'), true);
    fyllFormularet(dom, { name: 'Post', amountSek: '100', category: 'other' });
    skickaFormularet(dom);
    await flush();
    assert.equal(kropp(anrop.at(-3)).kind, slag, knappId);
  }
});

test('(50) knappen är låst medan anropet pågår och ett andra försök ger inget andra anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => null));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(anrop[5].method, 'POST');
  assert.equal(dom.falt('item-submit').disabled, true, 'knappen släpptes innan svaret kom');

  skickaFormularet(dom);
  await flush();
  assert.equal(anrop.length, 6, 'ett andra försök gav ett andra POST');

  anrop[5].svara({ status: 201, json: { item: null } });
  await flush();
  assert.equal(dom.falt('item-submit').disabled, false);
  assert.equal(anrop.length, 8);
  assert.equal(anrop[6].method, 'GET');
});

test('ett andra klick på samma Ta bort-knapp medan anropet är i luften ger inget andra DELETE', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => null));

  const taBort = knapp(dom.rader('saving-list')[0], 'remove');
  assert.equal(taBort.utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(anrop[5].method, 'DELETE');
  assert.equal(taBort.disabled, true);
  assert.equal(taBort.utlos('click'), false);
  await flush();
  assert.equal(anrop.length, 6);
});

test('(51) Ta bort hämtar om månaden, listan krymper och summorna ändras', async (t) => {
  const kvar = [post('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'income', 'Lön', 3000000, 'other')];
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar(
          [...kvar, post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 25000, 'other')],
          { incomeOre: 3000000, expenseOre: 25000, savingOre: 0, leftOre: 2975000 }
        ),
        manadssvar(kvar, { incomeOre: 3000000, expenseOre: 0, savingOre: 0, leftOre: 3000000 })
      ]),
      () => ({ status: 204 })
    )
  );

  assert.equal(dom.rader('expense-list').length, 1);
  assert.equal(dom.falt('total-expense').textContent, formatSek(25000));

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(anrop[5].method, 'DELETE');
  assert.equal(anrop[5].url, '/api/poster/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);

  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('expense-empty').textContent, TOM_UTGIFTSLISTA);
  assert.equal(dom.falt('total-expense').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').textContent, formatSek(3000000));
});

test('(52) Ändra fyller formuläret och sparar posten med PUT', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 200, json: { item: bio } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');

  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-name').value, 'Bio');
  assert.equal(dom.falt('item-amount').value, '199.5');
  assert.equal(dom.falt('item-category').value, 'subscription');
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');

  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, '/api/poster/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Bio',
    amountSek: '199.5',
    category: 'subscription',
    occurredOn: '',
    note: ''
  });
  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);
});

test('en ny post efter en ändring skickas som POST med tomma fält', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 201, json: { item: null } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('item-name').value, 'Bio');

  dom.falt('add-income').utlos('click');
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
  assert.equal(dom.falt('item-submit').textContent, 'Spara');

  fyllFormularet(dom, { name: 'Lön', amountSek: '30000', category: 'other' });
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, MANADSVAG);
  assert.equal(kropp(anrop[5]).kind, 'income');
});

test('(53) ett 400 visar fältfelen vid sina fält och skapar ingen post', async (t) => {
  const svar = {
    status: 400,
    json: {
      error: 'Namnet får inte vara tomt.',
      fieldErrors: [
        { field: 'name', message: 'Namnet får inte vara tomt.' },
        { field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }
      ]
    }
  };
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom, { name: '', amountSek: '0' });
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.faltfel('name'), 'Namnet får inte vara tomt.');
  assert.equal(dom.faltfel('amountSek'), 'Beloppet måste vara större än 0 kr.');
  assert.equal(dom.faltfel('category'), '');
  assert.equal(dom.falt('item-form-error').textContent, '');
  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.rader('expense-list').length, 0);
});

test('ett fel utan fältfel visar serverns text i formulärets allmänna ruta', async (t) => {
  const svar = { status: 500, json: { error: 'Det gick inte att spara. Försök igen.' } };
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('item-form-error').textContent, 'Det gick inte att spara. Försök igen.');
  assert.equal(dom.faltfel('name'), '');
});

test('ett avvisat fetch vid sparningen visar den allmänna texten och släpper knappen', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => new Error('nätet nere')));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('item-form-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('item-submit').disabled, false);
});

test('ett 404 vid Ta bort visar serverns text i månadsvyns allmänna ruta', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar(treSlagsposter()), () => ({ status: 404, json: { error: 'Posten finns inte.' } }))
  );

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, 'Posten finns inte.');
  assert.equal(anrop.length, 6);
  assert.equal(dom.rader('saving-list').length, 1);
});

test('(54) ett 401 vid en omhämtning visar inloggningsvyn och döljer månadsvyn', async (t) => {
  const { dom } = await starta(t, planInloggad(ikoordning([manadssvar([]), MIG_401])));

  assert.equal(dom.falt('month-view').hidden, false);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('login-password').value, '');
  assert.equal(dom.falt('month-error').textContent, '');
});

test('ett 401 på en sparning visar inloggningsvyn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => MIG_401));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('item-form-error').textContent, '');
});

test('ett 401 på en borttagning visar inloggningsvyn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => MIG_401));

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('month-error').textContent, '');
});

test('ett avvisat fetch vid laddningen visar den allmänna texten i inloggningsvyn', async (t) => {
  const { dom } = await starta(t, () => new Error('nätet nere'));

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-error').textContent, GENERAL_ERROR);
});

test('ett 500 vid laddningen visar serverns text i inloggningsvyn', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(t, () => ({ status: 500, json: { error: serverns } }));

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('login-error').textContent, serverns);
});

test('ett 500 på månadens väg visar serverns text i månadsvyn', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(t, planInloggad(() => ({ status: 500, json: { error: serverns } })));

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('month-error').textContent, serverns);
  assert.equal(dom.falt('month-label').textContent, MANAD_RUBRIK);
});

test('ett avvisat fetch vid en omhämtning visar den allmänna texten', async (t) => {
  const { dom } = await starta(t, planInloggad(ikoordning([manadssvar([]), new Error('nätet nere')])));

  dom.falt('month-next').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('ett 200 utan läsbar JSON-kropp ger nollor och tomma listor och kastar inte', async (t) => {
  const { dom } = await starta(t, planInloggad(() => ({ status: 200 })));

  assert.equal(dom.falt('total-income').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').textContent, formatSek(0));
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
});

test('(57) Logga ut anropar utloggningsvägen och visar inloggningsvyn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => null));

  assert.equal(dom.falt('month-view').hidden, false);

  assert.equal(dom.falt('log-out').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, '/api/auth/logga-ut');
  assert.equal(dom.falt('log-out').disabled, true, 'knappen släpptes innan svaret kom');
  assert.equal(dom.falt('month-view').hidden, false, 'vyn byttes innan svaret kom');
  assert.equal(dom.falt('log-out').utlos('click'), false);
  assert.equal(anrop.length, 6);

  anrop[5].svara({ status: 204 });
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-title').textContent, 'Logga in');
  assert.equal(dom.falt('login-password').value, '');
  assert.equal(dom.falt('log-out').disabled, false);
});

test('ett avvisat fetch vid Logga ut lämnar användaren i månadsvyn med den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar(treSlagsposter()), () => new Error('nätet nere'))
  );

  dom.falt('log-out').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('login-view').hidden, true);
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
});

test('(58) den inloggade adressen står i månadsvyn', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('user-email').textContent, 'nils@example.se');
});

test('ett 200 från /api/mig utan läsbar kropp visar ingen adress', async (t) => {
  const { dom } = await starta(t, (anropet) => (anropet.url === '/api/mig' ? { status: 200 } : manadssvar([])));

  assert.equal(dom.falt('user-email').textContent, '');
  assert.equal(dom.falt('month-view').hidden, false);
});

test('(59) Avbryt stänger formuläret, tömmer fälten och skickar inget anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  assert.equal(dom.falt('item-form-card').hidden, false);

  assert.equal(dom.falt('item-cancel').utlos('click'), true);

  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
  assert.equal(anrop.length, 5);
});

test('(60) Avbryt rensar fältfelen, så att formuläret öppnas rent nästa gång', async (t) => {
  const svar = {
    status: 400,
    json: {
      error: 'Namnet får inte vara tomt.',
      fieldErrors: [{ field: 'name', message: 'Namnet får inte vara tomt.' }]
    }
  };
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom, { name: '' });
  skickaFormularet(dom);
  await flush();
  assert.equal(dom.faltfel('name'), 'Namnet får inte vara tomt.');

  dom.falt('item-cancel').utlos('click');
  assert.equal(dom.faltfel('name'), '');

  dom.falt('add-income').utlos('click');
  assert.equal(dom.faltfel('name'), '');
});

const STAENDE_TOTALER = Object.freeze({
  incomeOre: 3000000,
  expenseOre: 1225000,
  savingOre: 500000,
  leftOre: 1275000
});

function kravVynStaende(dom) {
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra', 'Bio']);
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
  assert.equal(dom.falt('total-income').textContent, formatSek(3000000));
  assert.equal(dom.falt('total-expense').textContent, formatSek(1225000));
  assert.equal(dom.falt('total-saving').textContent, formatSek(500000));
  assert.equal(dom.falt('total-left').textContent, formatSek(1275000));
  assert.equal(dom.falt('chart').children.length, 1);
  assert.equal(dom.falt('chart-empty').textContent, '');
}

test('(61) ett misslyckat GET lämnar listorna, summeringen och diagrammet stående', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([manadssvar(treSlagsposter(), STAENDE_TOTALER), { status: 500, json: { error: serverns } }])
    )
  );

  kravVynStaende(dom);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('month-error').textContent, serverns);
  kravVynStaende(dom);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('(62) en misslyckad omhämtning efter en ändring lämnar vyn stående', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([manadssvar(treSlagsposter(), STAENDE_TOTALER), { status: 500, json: { error: serverns } }]),
      () => ({ status: 204 })
    )
  );

  kravVynStaende(dom);

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(anrop[5].method, 'DELETE');
  assert.equal(anrop[6].method, 'GET');
  assert.equal(dom.falt('month-error').textContent, serverns);
  kravVynStaende(dom);
});

test('en pågående hämtning lämnar den gamla feltexten kvar tills svaret kommit', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(ikoordning([{ status: 500, json: { error: serverns } }, null]))
  );

  assert.equal(dom.falt('month-error').textContent, serverns);

  dom.falt('month-next').utlos('click');
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('month-error').textContent, serverns, 'texten försvann innan svaret kom');

  anrop[5].svara(manadssvar(treSlagsposter(), STAENDE_TOTALER));
  await flush();

  assert.equal(dom.falt('month-error').textContent, '');
  kravVynStaende(dom);
});

test('(63) #month-error töms vid en lyckad hämtning', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([{ status: 500, json: { error: serverns } }, manadssvar(treSlagsposter(), STAENDE_TOTALER)])
    )
  );

  assert.equal(dom.falt('month-error').textContent, serverns);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('month-error').textContent, '');
  kravVynStaende(dom);
});

const EDIT_QUESTION = 'Vad ska ändras?';
const REMOVE_QUESTION = 'Vad ska tas bort?';
const BARA_MANADEN = `Bara ${MANAD_RUBRIK}`;
const FRAN_OCH_MED_MANADEN = `Från och med ${MANAD_RUBRIK}`;

const MALL_ID = '11111111-1111-4111-8111-111111111111';
const SERIE_ID = '22222222-2222-4222-8222-222222222222';

function mallpost(extra = {}) {
  return post(MALL_ID, 'expense', 'Hyra', 1200000, 'housing', {
    dueDate: '2026-09-01',
    recurring: true,
    seriesId: SERIE_ID,
    interval: 'quarterly',
    toMonth: '2027-06',
    ...extra
  });
}

function fragan(rad) {
  return rad.children.find((barn) => barn.className === 'item-question');
}

function fragetext(rad) {
  const ruta = fragan(rad);
  assert.notEqual(ruta, undefined, 'raden saknar frågans ruta');
  return celltext(ruta, 'question-text');
}

function valen(rad) {
  const ruta = fragan(rad);
  assert.notEqual(ruta, undefined, 'raden saknar frågans ruta');
  return ruta.children.filter((barn) => barn.tagName === 'button');
}

function kryssaAterkommande(dom, kryssad) {
  dom.falt('item-recurring').checked = kryssad;
  assert.equal(dom.falt('item-recurring').utlos('change'), true);
}

test('(64) kryssrutan Återkommande öppnar de två fälten, som är dolda tills den kryssas', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('add-expense').utlos('click'), true);
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  kryssaAterkommande(dom, true);
  assert.equal(dom.falt('recurring-fields').hidden, false);

  kryssaAterkommande(dom, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  kryssaAterkommande(dom, true);
  assert.equal(dom.falt('item-cancel').utlos('click'), true);
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  assert.deepEqual(
    dom.falt('item-interval').children.map((barn) => [barn.value, barn.textContent]),
    Object.entries(INTERVAL_LABELS)
  );
  assert.equal(anrop.length, 5);
});

test('(64) en ny post med kryssrutan kryssad skapas som en mall med sina sex fält', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({ status: 201, json: { template: null } }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  kryssaAterkommande(dom, true);
  dom.falt('item-interval').value = 'quarterly';
  dom.falt('item-to-month').value = '';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, `/api/mallar/${MANAD}`);
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '1234,50',
    category: 'housing',
    interval: 'quarterly',
    toMonth: ''
  });
  assert.equal(anrop[6].url, MANADSVAG);
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);
});

test('ett 400 från mallvägen visar fältfelen vid interval och toMonth', async (t) => {
  const intervalltext = 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.';
  const slutmanadstext = 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: {
        error: intervalltext,
        fieldErrors: [
          { field: 'interval', message: intervalltext },
          { field: 'toMonth', message: slutmanadstext }
        ]
      }
    }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  kryssaAterkommande(dom, true);
  dom.falt('item-to-month').value = 'oktober';
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.faltfel('interval'), intervalltext);
  assert.equal(dom.faltfel('toMonth'), slutmanadstext);
  assert.equal(dom.falt('item-form-error').textContent, '');
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(anrop.length, 6);
});

test('(65) en mallrads Ändra visar två val med månadens namn i och öppnar inget formulär', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  const rad = dom.rader('expense-list')[0];
  assert.equal(fragan(rad).hidden, true);
  assert.equal(fragan(rad).children.length, 0);

  assert.equal(knapp(rad, 'edit').utlos('click'), true);

  assert.equal(fragan(rad).hidden, false);
  assert.equal(fragetext(rad), EDIT_QUESTION);
  assert.deepEqual(valen(rad).map((val) => val.textContent), [BARA_MANADEN, FRAN_OCH_MED_MANADEN]);
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(anrop.length, 5);
});

test('(65) en mallrads Ta bort visar sin egen fråga med samma två val', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  const rad = dom.rader('expense-list')[0];
  assert.equal(knapp(rad, 'remove').utlos('click'), true);

  assert.equal(fragetext(rad), REMOVE_QUESTION);
  assert.deepEqual(valen(rad).map((val) => val.textContent), [BARA_MANADEN, FRAN_OCH_MED_MANADEN]);
  assert.equal(anrop.length, 5);

  knapp(rad, 'edit').utlos('click');
  assert.equal(fragetext(rad), EDIT_QUESTION);
});

test('en andra frågas öppning stänger den första, så att två rader aldrig frågar samtidigt', async (t) => {
  const andra = mallpost({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'El',
    seriesId: '44444444-4444-4444-8444-444444444444'
  });
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost(), andra])));

  const [hyra, el] = dom.rader('expense-list');
  knapp(hyra, 'remove').utlos('click');
  assert.equal(fragan(hyra).hidden, false);

  knapp(el, 'edit').utlos('click');
  assert.equal(fragan(el).hidden, false);
  assert.equal(fragan(hyra).hidden, true, 'den första frågan står kvar öppen');
});

test('(66) en engångsposts Ändra öppnar formuläret direkt och raden har ingen fråga', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 200, json: { item: bio } }))
  );

  const rad = dom.rader('expense-list')[0];
  assert.equal(fragan(rad), undefined);

  assert.equal(knapp(rad, 'edit').utlos('click'), true);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-name').value, 'Bio');
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, `/api/poster/${bio.id}`);
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Bio',
    amountSek: '199.5',
    category: 'subscription',
    occurredOn: '',
    note: ''
  });
});

test('(67) Ändra: Bara månaden går till postens månadsväg, Från och med månaden till mallvägen', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([mall]), () => ({ status: 200, json: { items: [mall], totals: NOLLOR } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[0].utlos('click'), true);

  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-amount').value, '12000');
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');

  dom.falt('item-amount').value = '13000';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, `/api/poster/${MALL_ID}/manad/${MANAD}`);
  assert.deepEqual(kropp(anrop[5]), { amountSek: '13000' });
  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);
  assert.equal(dom.falt('item-recurring').checked, true);
  assert.equal(dom.falt('recurring-fields').hidden, false);

  dom.falt('item-interval').value = 'quarterly';
  dom.falt('item-to-month').value = '2027-03';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[8].method, 'PUT');
  assert.equal(anrop[8].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  assert.deepEqual(kropp(anrop[8]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '12000',
    category: 'housing',
    interval: 'quarterly',
    toMonth: '2027-03'
  });
  assert.equal(anrop[9].url, MANADSVAG);
});

test('(67) Ta bort: Bara månaden hoppar över månaden, Från och med månaden avslutar serien', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([mall]),
      ikoordning([{ status: 200, json: { items: [], totals: NOLLOR } }, { status: 204 }])
    )
  );

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[0].utlos('click'), true);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, `/api/poster/${MALL_ID}/manad/${MANAD}`);
  assert.deepEqual(kropp(anrop[5]), { skipped: true });
  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);
  await flush();

  assert.equal(anrop[8].method, 'DELETE');
  assert.equal(anrop[8].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  assert.equal(anrop[8].body, undefined);
  assert.equal(anrop[9].method, 'GET');
  assert.equal(anrop[9].url, MANADSVAG);
});

test('(70) Från och med förifyller Intervall och Till och med ur posten', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);

  assert.equal(dom.falt('item-interval').value, 'quarterly');
  assert.equal(dom.falt('item-to-month').value, '2027-06');
});

test('(70) en mall utan slutmånad ger ett tomt Till och med, inte strängen null', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost({ toMonth: null })])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');

  assert.equal(dom.falt('item-to-month').value, '');
  assert.equal(dom.falt('item-interval').value, 'quarterly');
});

test('(71) en beloppsändring från och med månaden behåller intervallet', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([mall]), () => ({ status: 200, json: { template: null } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');

  dom.falt('item-amount').value = '13000';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '13000',
    category: 'housing',
    interval: 'quarterly',
    toMonth: '2027-06'
  });
});

test('(72) Bara månaden döljer de fält som inte går att ändra och visar sin rad', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('recurring-fields').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
  assert.equal(dom.falt('month-only-note').textContent, '');

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);
  assert.equal(dom.falt('category-field').hidden, true);
  assert.equal(dom.falt('recurring-field').hidden, true);
  assert.equal(dom.falt('recurring-fields').hidden, true);
  assert.equal(dom.falt('item-amount').value, '12000');
  assert.equal(dom.falt('month-only-note').hidden, false);
  assert.equal(dom.falt('month-only-note').textContent, `Ändrar bara beloppet för ${MANAD_RUBRIK}.`);

  assert.equal(dom.falt('item-cancel').utlos('click'), true);
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
  assert.equal(dom.falt('month-only-note').textContent, '');
});

test('(72) en engångsposts Ändra och en ny post visar alla fält', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom } = await starta(t, planInloggad(() => manadssvar([bio, mallpost()])));

  knapp(dom.rader('expense-list')[1], 'edit').utlos('click');
  valen(dom.rader('expense-list')[1])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);

  knapp(dom.rader('expense-list')[1], 'edit').utlos('click');
  valen(dom.rader('expense-list')[1])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);
  assert.equal(dom.falt('add-income').utlos('click'), true);
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
});

test('valet som utlöser ett anrop är låst tills svaret kommit', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()]), () => null));

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  const bara = valen(dom.rader('expense-list')[0])[0];
  assert.equal(bara.utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(bara.disabled, true, 'valet släpptes innan svaret kom');
  assert.equal(bara.utlos('click'), false, 'ett låst val tog emot ett klick');
  await flush();
  assert.equal(anrop.length, 6, 'ett andra klick gav ett andra anrop');

  anrop[5].svara({ status: 200, json: { items: [], totals: NOLLOR } });
  await flush();
  assert.equal(anrop.length, 8);
  assert.equal(anrop[6].url, MANADSVAG);
});

test('ett 404 på en avslutad serie visar serverns text och lämnar valet släppt', async (t) => {
  const serverns = 'Posten finns inte.';
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([mallpost()]), () => ({ status: 404, json: { error: serverns } }))
  );

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  const franOchMed = valen(dom.rader('expense-list')[0])[1];
  franOchMed.utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, serverns);
  assert.equal(franOchMed.disabled, false);
  assert.equal(fragan(dom.rader('expense-list')[0]).hidden, false);
});

const APP_KALLA_PATH = fileURLToPath(new URL('../src/web/app.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../src/web/index.html', import.meta.url));
const SUMMAELEMENT = Object.freeze(['TOTAL_INCOME', 'TOTAL_EXPENSE', 'TOTAL_SAVING', 'TOTAL_LEFT']);

test('(55) app.js räknar aldrig fram summeringen själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  assert.equal(
    kalla.includes('.reduce('),
    false,
    'app.js innehåller .reduce( — summeringens tal kommer ur svaret, de summeras inte här'
  );

  for (const sats of kalla.split(';')) {
    const traffar = SUMMAELEMENT.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  for (const falt of ['incomeOre', 'expenseOre', 'savingOre', 'leftOre']) {
    assert.equal(kalla.includes(`totals.${falt}`), true, `app.js läser inte totals.${falt} ur svaret`);
  }
});

test('(56) attrappen har exakt de id:n index.html har', async () => {
  assert.deepEqual(createDom().ids, await idsFranIndexHtml());
});

test('(32) laddarens byte av dag avvisar en dag som inte finns i kalendern', async (t) => {
  const { bytDag } = await starta(t, () => MIG_401);

  for (const dag of ['imorgon', '2026-02-30']) {
    assert.throws(
      () => bytDag(dag),
      {
        name: 'Error',
        message: `frozen-dates kräver ett datum som finns i kalendern på formen ÅÅÅÅ-MM-DD, fick "${dag}".`
      },
      `bytDag godtog ${dag}`
    );
  }
});

const ANDRA_INSTANSEN_AVVISAS =
  'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.';

test('(33) ett andra loadApp i samma testfall avvisas', async (t) => {
  await starta(t, () => MIG_401);

  await assert.rejects(
    () => starta(t, () => MIG_401),
    {
      name: 'Error',
      message: ANDRA_INSTANSEN_AVVISAS
    }
  );
});

test('(33) ett loadApp i ett underordnat test avvisas', async (t) => {
  await starta(t, () => MIG_401);

  await t.test('barnet har en egen testkontext men samma process', async (barn) => {
    await assert.rejects(
      () => starta(barn, () => MIG_401),
      {
        name: 'Error',
        message: ANDRA_INSTANSEN_AVVISAS
      }
    );
  });
});

test('(33) laddarens after-hook lämnar tillbaka globalThis efter ett avvisat andra anrop', () => {
  assert.equal(globalThis.document, undefined, 'globalThis.document står kvar satt efter förra fallet');
  assert.equal(
    globalThis.fetch,
    FETCH_FORE_TESTERNA,
    'globalThis.fetch är inte värdet från före testfallen: attrappen står kvar'
  );
  assert.equal(
    URL.createObjectURL,
    CREATE_OBJECT_URL_FORE_TESTERNA,
    'URL.createObjectURL är inte värdet från före testfallen: attrappen står kvar'
  );
});

test('(33) laddarens förval för URL.createObjectURL kastar sin text', async (t) => {
  await starta(t, () => MIG_401);
  assert.throws(
    () => URL.createObjectURL(new Blob(['a'])),
    (error) => error instanceof Error && error.message === 'createObjectURL anropades utan attrapp'
  );
});

const OVERSIKTSELEMENT = Object.freeze(['OVERVIEW_SAVED', 'OVERVIEW_AVERAGE', 'OVERVIEW_BEST']);

function ikoordningFor(vag, svar) {
  const nasta = ikoordning(svar);
  return (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === vag) {
      return nasta();
    }
    if (anropet.method === 'GET') {
      return manadssvar([]);
    }
    return null;
  };
}

const OVERSIKTSMANADER = Object.freeze([
  Object.freeze({ month: '2025-10', incomeOre: 3000000, expenseOre: 1000000, savingOre: 200000, leftOre: 1800000 }),
  Object.freeze({ month: '2025-11', incomeOre: 3000000, expenseOre: 1100000, savingOre: 200000, leftOre: 1700000 }),
  Object.freeze({ month: '2025-12', incomeOre: 3000000, expenseOre: 4000000, savingOre: 200000, leftOre: -1200000 }),
  Object.freeze({ month: '2026-01', incomeOre: 3000000, expenseOre: 900000, savingOre: 300000, leftOre: 1800000 }),
  Object.freeze({ month: '2026-02', incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 }),
  Object.freeze({ month: '2026-03', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-04', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-05', incomeOre: 3000000, expenseOre: 1200000, savingOre: 100000, leftOre: 1700000 }),
  Object.freeze({ month: '2026-06', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-07', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-08', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-09', incomeOre: 3500007, expenseOre: 1000000, savingOre: 100000, leftOre: 2400007 })
]);

const SPARAT_I_AR = 900000;
const SUMMA_LEFT = 17700007;
const SNITT_LEFT = 1475001;

const OVERSIKTSVAG = `/api/oversikt/${MANAD}`;
const OVERSIKTSVAG_FOREGAENDE = `/api/oversikt/${FOREGAENDE_MANAD}`;
const OVERSIKTSRUBRIK = 'Översikt till och med September 2026';
const OVERSIKT_DIAGRAMTITEL = 'Kvar att leva på per månad';
const OVERSIKTSSVAR = Object.freeze({
  status: 200,
  json: { months: OVERSIKTSMANADER, savedThisYear: SPARAT_I_AR }
});

function planOversikt(svar = OVERSIKTSSVAR) {
  return (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === OVERSIKTSVAG || anropet.url === OVERSIKTSVAG_FOREGAENDE) {
      return svar;
    }
    if (anropet.method === 'GET') {
      return manadssvar([]);
    }
    return null;
  };
}

async function oppnaOversikten(dom) {
  await flush();
  dom.falt('show-overview').utlos('click');
  await flush();
}

function diagrammet(dom) {
  const barn = dom.falt('overview-chart').children;
  assert.equal(barn.length, 1, 'översiktens diagram har ingen SVG');
  const svg = barn[0];
  return {
    svg,
    titel: svg.children.find((element) => element.tagName === 'title'),
    staplar: svg.children.filter((element) => element.tagName === 'rect'),
    linjer: svg.children.filter((element) => element.tagName === 'line')
  };
}

function kvarcell(rad) {
  const cell = rad.children.find((barn) => barn.className.startsWith('overview-left'));
  assert.notEqual(cell, undefined, 'raden saknar cellen Kvar');
  return cell;
}

test('(73) knappen Översikt hämtar översikten och byter vy', async (t) => {
  const { dom, anrop } = await starta(t, planOversikt());
  await flush();

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG).length, 0);

  dom.falt('show-overview').utlos('click');
  await flush();

  const oversikt = anrop.filter((anropet) => anropet.url === OVERSIKTSVAG);
  assert.equal(oversikt.length, 1);
  assert.equal(oversikt[0].method, 'GET');

  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('overview-view').hidden, false);
  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('overview-label').textContent, OVERSIKTSRUBRIK);
  assert.equal(dom.falt('show-overview').disabled, false);
});

test('(73) ett misslyckat anrop lämnar användaren i månadsvyn med en feltext', async (t) => {
  const { dom } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === OVERSIKTSVAG) {
      return new Error('nätverket föll');
    }
    return manadssvar([]);
  });
  await flush();

  dom.falt('show-overview').utlos('click');
  await flush();

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('overview-saved').textContent, '');
  assert.equal(dom.rader('overview-rows').length, 0);
  assert.equal(dom.falt('show-overview').disabled, false);
});

test('(73) ett 401 från översikten visar inloggningsvyn och ingen av de två andra', async (t) => {
  const { dom } = await starta(t, planOversikt({ status: 401, json: { error: 'Du är inte inloggad.' } }));
  await flush();

  dom.falt('show-overview').utlos('click');
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('overview-view').hidden, true);
});

test('(74) Tillbaka till månaden byter tillbaka till samma månad som innan', async (t) => {
  const { dom, anrop } = await starta(t, planOversikt());
  await flush();

  dom.falt('month-prev').utlos('click');
  await flush();
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);

  dom.falt('show-overview').utlos('click');
  await flush();
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG_FOREGAENDE).length, 1);
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG).length, 0);
  assert.equal(dom.falt('overview-view').hidden, false);

  const foreTillbaka = anrop.length;
  dom.falt('back-to-month').utlos('click');
  await flush();

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);
  assert.equal(anrop.length, foreTillbaka);
});

test('(75) de tre talen kommer ur svaret, och snittet avrundas av money.js', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  assert.equal(dom.falt('overview-saved').textContent, formatSek(SPARAT_I_AR));
  assert.notEqual(formatSek(SPARAT_I_AR), formatSek(1600000));

  assert.equal(dom.falt('overview-average').textContent, formatSek(divideRoundHalfUp(SUMMA_LEFT, 12)));
  assert.equal(dom.falt('overview-average').textContent, formatSek(SNITT_LEFT));
  assert.notEqual(formatSek(SNITT_LEFT), formatSek(Math.floor(SUMMA_LEFT / 12)));

  assert.equal(dom.falt('overview-best').textContent, monthLabel('2026-09'));
});

test('(75) app.js räknar aldrig fram översiktens tal själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  for (const sats of kalla.split(';')) {
    const traffar = OVERSIKTSELEMENT.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  assert.equal(kalla.includes('savedThisYear'), true, 'app.js läser inte savedThisYear ur svaret');
  assert.equal(kalla.includes('divideRoundHalfUp('), true, 'app.js avrundar inte snittet med divideRoundHalfUp');
  assert.equal(kalla.includes('Math.round(sum'), false, 'app.js avrundar snittet med Math.round');
});

test('(76) en negativ månad ritas nedåt från nollinjen och i --negativ', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  const { svg, titel, staplar, linjer } = diagrammet(dom);
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(titel.textContent, OVERSIKT_DIAGRAMTITEL);
  assert.equal(staplar.length, OVERSIKTSMANADER.length);

  assert.equal(linjer.length, 1);
  assert.equal(linjer[0].getAttribute('class'), 'overview-zero-line');
  const nollinje = Number(linjer[0].getAttribute('y1'));
  assert.equal(Number(linjer[0].getAttribute('y2')), nollinje);
  assert.equal(nollinje > 0, true, 'nollinjen ligger i överkanten, så ingen stapel kan ritas nedåt');

  const negativ = staplar[2];
  assert.equal(negativ.getAttribute('class'), 'overview-bar overview-bar-negative');
  assert.equal(Number(negativ.getAttribute('y')), nollinje);
  assert.equal(Number(negativ.getAttribute('height')) > 0, true);

  const positiv = staplar[11];
  assert.equal(positiv.getAttribute('class'), 'overview-bar overview-bar-positive');
  assert.equal(Number(positiv.getAttribute('y')) < nollinje, true);
  assert.equal(
    Number(positiv.getAttribute('y')) + Number(positiv.getAttribute('height')),
    nollinje
  );
  assert.equal(Number(positiv.getAttribute('height')), nollinje);

  for (const [index, stapel] of staplar.entries()) {
    const forvantad = index === 2 ? 'overview-bar overview-bar-negative' : 'overview-bar overview-bar-positive';
    assert.equal(stapel.getAttribute('class'), forvantad, OVERSIKTSMANADER[index].month);
  }
  assert.equal(Number(staplar[4].getAttribute('height')), 0);
});

test('(77) tabellen har en rad per månad, i samma ordning som diagrammet', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  const rader = dom.rader('overview-rows');
  assert.equal(rader.length, OVERSIKTSMANADER.length);

  const { staplar } = diagrammet(dom);
  for (const [index, rad] of rader.entries()) {
    const manaden = OVERSIKTSMANADER[index];
    assert.equal(celltext(rad, 'overview-month'), monthLabel(manaden.month), manaden.month);
    assert.equal(
      staplar[index].children[0].textContent,
      `${monthLabel(manaden.month)}: ${formatSek(manaden.leftOre)}`,
      manaden.month
    );
    assert.equal(celltext(rad, 'overview-income'), formatSek(manaden.incomeOre), manaden.month);
    assert.equal(celltext(rad, 'overview-expense'), formatSek(manaden.expenseOre), manaden.month);
    assert.equal(celltext(rad, 'overview-saving'), formatSek(manaden.savingOre), manaden.month);
    assert.equal(kvarcell(rad).textContent, formatSek(manaden.leftOre), manaden.month);
  }

  assert.equal(celltext(rader[4], 'overview-month'), monthLabel('2026-02'));
  assert.deepEqual(
    [
      celltext(rader[4], 'overview-income'),
      celltext(rader[4], 'overview-expense'),
      celltext(rader[4], 'overview-saving'),
      kvarcell(rader[4]).textContent
    ],
    [formatSek(0), formatSek(0), formatSek(0), formatSek(0)]
  );

  assert.equal(kvarcell(rader[2]).className, 'overview-left left-negative');
  assert.equal(kvarcell(rader[4]).className, 'overview-left left-positive');
  assert.equal(kvarcell(rader[11]).className, 'overview-left left-positive');
});

test('(77) en andra hämtning ersätter tabellen och diagrammet i stället för att bygga på', async (t) => {
  const kortSerie = Object.freeze({
    status: 200,
    json: {
      months: [
        { month: '2026-08', incomeOre: 1000000, expenseOre: 0, savingOre: 0, leftOre: 1000000 },
        { month: '2026-09', incomeOre: 2000000, expenseOre: 0, savingOre: 0, leftOre: 2000000 }
      ],
      savedThisYear: 0
    }
  });
  const { dom } = await starta(t, ikoordningFor(OVERSIKTSVAG, [OVERSIKTSSVAR, kortSerie]));

  await oppnaOversikten(dom);
  assert.equal(dom.rader('overview-rows').length, 12);
  assert.equal(diagrammet(dom).staplar.length, 12);

  dom.falt('back-to-month').utlos('click');
  dom.falt('show-overview').utlos('click');
  await flush();

  assert.equal(dom.rader('overview-rows').length, 2);
  assert.equal(diagrammet(dom).staplar.length, 2);
  assert.equal(celltext(dom.rader('overview-rows')[0], 'overview-month'), monthLabel('2026-08'));
  assert.equal(dom.falt('overview-saved').textContent, formatSek(0));
});

const BUDGETRADER = Object.freeze([
  Object.freeze({ category: 'housing', amountOre: 900000, spentOre: 930000, leftOre: -30000 }),
  Object.freeze({ category: 'transport', amountOre: 150000, spentOre: 42000, leftOre: 108000 }),
  Object.freeze({ category: 'subscription', amountOre: 40000, spentOre: 0, leftOre: 40000 })
]);

const BUDGETVAG = `/api/budget/${MANAD}`;

const BUDGET_LEFT_PREFIX = 'kvar ';

function budgetrader(dom) {
  return dom.rader('budget-list');
}

function budgetKvarcell(rad) {
  const cell = rad.children.find((barn) => barn.className.startsWith('budget-left'));
  assert.notEqual(cell, undefined, 'budgetraden saknar cellen Kvar');
  return cell;
}

function skickaBudgetformularet(dom) {
  let forhindrad = false;
  dom.falt('budget-form').utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  return forhindrad;
}

test('(78) budgetkortet visar kategorin, taket och vad som är kvar, en rad per satt tak', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([], NOLLOR, BUDGETRADER)));

  const rader = budgetrader(dom);
  assert.equal(rader.length, 3);

  assert.deepEqual(
    rader.map((rad) => celltext(rad, 'budget-category')),
    [CATEGORY_LABELS.housing, CATEGORY_LABELS.transport, CATEGORY_LABELS.subscription]
  );

  assert.deepEqual(
    rader.map((rad) => celltext(rad, 'budget-amount')),
    [formatSek(900000), formatSek(150000), formatSek(40000)]
  );

  assert.deepEqual(
    rader.map((rad) => budgetKvarcell(rad).textContent),
    [
      `${BUDGET_LEFT_PREFIX}${formatSek(-30000)}`,
      `${BUDGET_LEFT_PREFIX}${formatSek(108000)}`,
      `${BUDGET_LEFT_PREFIX}${formatSek(40000)}`
    ]
  );
});

test('(78) en kategori utan tak har ingen rad, och en månad utan tak visar inga rader', async (t) => {
  const svar = ikoordning([
    manadssvar([], NOLLOR, BUDGETRADER),
    manadssvar([], NOLLOR, [])
  ]);
  const { dom } = await starta(t, planInloggad(svar));

  assert.equal(budgetrader(dom).length, 3);
  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(budgetrader(dom).length, 0);
});

const BUDGETCELLER = Object.freeze(['budget-amount', 'budget-left']);

test('(78) app.js räknar aldrig fram budgetkortets tal själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  for (const sats of kalla.split(';')) {
    const traffar = BUDGETCELLER.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(', '.map(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  for (const falt of ['amountOre', 'leftOre']) {
    assert.equal(
      kalla.includes(`line.${falt}`),
      true,
      `app.js läser inte line.${falt} ur svaret`
    );
  }
});

test('(79) ett överdraget tak får left-negative, ett med pengar kvar left-positive', async (t) => {
  const tak = (spentOre, leftOre) => [{ category: 'housing', amountOre: 900000, spentOre, leftOre }];
  const svar = ikoordning([
    manadssvar([], NOLLOR, tak(930000, -30000)),
    manadssvar([], NOLLOR, tak(100000, 800000)),
    manadssvar([], NOLLOR, tak(900000, 0))
  ]);
  const { dom } = await starta(t, planInloggad(svar));

  assert.equal(budgetKvarcell(budgetrader(dom)[0]).className, 'budget-left left-negative');
  assert.equal(
    budgetKvarcell(budgetrader(dom)[0]).textContent,
    `${BUDGET_LEFT_PREFIX}${formatSek(-30000)}`
  );

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(budgetKvarcell(budgetrader(dom)[0]).className, 'budget-left left-positive');

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(budgetKvarcell(budgetrader(dom)[0]).className, 'budget-left left-positive');
  assert.equal(
    budgetKvarcell(budgetrader(dom)[0]).textContent,
    `${BUDGET_LEFT_PREFIX}${formatSek(0)}`
  );
});

test('+ Sätt tak sparar taket med PUT och ritar om kortet ur en hämtning', async (t) => {
  const svar = ikoordning([
    manadssvar([], NOLLOR, []),
    manadssvar([], NOLLOR, BUDGETRADER)
  ]);
  const { dom, anrop } = await starta(
    t,
    planInloggad(svar, () => ({ status: 200, json: { budgets: BUDGETRADER } }))
  );

  assert.equal(dom.falt('budget-form').hidden, true);
  assert.equal(budgetrader(dom).length, 0);
  assert.equal(dom.falt('add-budget').utlos('click'), true);
  assert.equal(dom.falt('budget-form').hidden, false);

  dom.falt('budget-category').value = 'housing';
  dom.falt('budget-amount').value = '9000';
  assert.equal(skickaBudgetformularet(dom), true);
  await flush();

  assert.equal(anrop.length, 8);
  assert.equal(anrop[5].method, 'PUT');
  assert.equal(anrop[5].url, BUDGETVAG);
  assert.deepEqual(kropp(anrop[5]), { category: 'housing', amountSek: '9000' });

  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, MANADSVAG);
  assert.equal(budgetrader(dom).length, 3);

  assert.equal(dom.falt('budget-form').hidden, true);
  assert.equal(dom.falt('budget-amount').value, '');
});

test('ett 400 från budgetvägen visar serverns text och lämnar formuläret öppet', async (t) => {
  const beloppstext = 'Beloppet måste vara större än 0 kr.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: { error: beloppstext, fieldErrors: [{ field: 'amountSek', message: beloppstext }] }
    }))
  );

  dom.falt('add-budget').utlos('click');
  dom.falt('budget-category').value = 'housing';
  dom.falt('budget-amount').value = '0';
  skickaBudgetformularet(dom);
  await flush();

  assert.equal(dom.falt('budget-form-error').textContent, beloppstext);
  assert.equal(dom.falt('budget-form').hidden, false);
  assert.equal(dom.falt('budget-amount').value, '0');
  assert.equal(anrop.length, 6);
});

test('ett avvisat fetch vid en sparning av ett tak visar den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => new Error('nätverket svarar inte'))
  );

  dom.falt('add-budget').utlos('click');
  dom.falt('budget-amount').value = '9000';
  skickaBudgetformularet(dom);
  await flush();

  assert.equal(dom.falt('budget-form-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('budget-form').hidden, false);
});

test('Avbryt i budgetformuläret stänger det utan att skicka något anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  dom.falt('add-budget').utlos('click');
  dom.falt('budget-amount').value = '9000';
  assert.equal(dom.falt('budget-cancel').utlos('click'), true);

  assert.equal(dom.falt('budget-form').hidden, true);
  assert.equal(dom.falt('budget-amount').value, '');
  assert.equal(anrop.length, 5);
});

test('budgetknappen är låst tills svaret kommit, så att två snabba klick inte ger två tak', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null)
  );

  dom.falt('add-budget').utlos('click');
  dom.falt('budget-category').value = 'housing';
  dom.falt('budget-amount').value = '9000';
  skickaBudgetformularet(dom);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('budget-submit').disabled, true);
  skickaBudgetformularet(dom);
  await flush();
  assert.equal(anrop.length, 6);

  anrop[5].svara({ status: 200, json: { budgets: [] } });
  await flush();
  assert.equal(dom.falt('budget-submit').disabled, false);
});

test('(80) kryssrutan Återkommande döljer Datum och Kommentar och visar dem igen', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('add-expense').utlos('click'), true);
  assert.equal(dom.falt('single-fields').hidden, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  kryssaAterkommande(dom, true);
  assert.equal(dom.falt('single-fields').hidden, true);
  assert.equal(dom.falt('recurring-fields').hidden, false);

  kryssaAterkommande(dom, false);
  assert.equal(dom.falt('single-fields').hidden, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);
});

test('(80) läget Bara månaden döljer också Datum och Kommentar', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');
  assert.equal(dom.falt('single-fields').hidden, true);

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[0].utlos('click');
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('single-fields').hidden, true);

  assert.equal(dom.falt('item-cancel').utlos('click'), true);
  assert.equal(dom.falt('single-fields').hidden, false);
});

test('Datum och Kommentar fylls i av Ändra och skickas med posten', async (t) => {
  const kvitto = post('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'expense', 'Bio', 19950, 'subscription', {
    occurredOn: '2026-09-04',
    note: 'Kvittot ligger i lådan'
  });
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([kvitto]), () => ({ status: 200, json: { item: kvitto } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('item-occurred-on').value, '2026-09-04');
  assert.equal(dom.falt('item-note').value, 'Kvittot ligger i lådan');

  dom.falt('item-note').value = 'Kvittot är bortkastat';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].method, 'PUT');
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Bio',
    amountSek: '199.5',
    category: 'subscription',
    occurredOn: '2026-09-04',
    note: 'Kvittot är bortkastat'
  });
});

test('en post utan de två fälten ger tomma fält, aldrig strängen null eller undefined', async (t) => {
  const utan = post('ffffffff-ffff-4fff-8fff-ffffffffffff', 'expense', 'Bio', 19950, 'subscription', {
    occurredOn: null,
    note: null
  });
  const { dom } = await starta(t, planInloggad(() => manadssvar([utan])));

  dom.falt('item-occurred-on').value = '2026-09-04';
  dom.falt('item-note').value = 'står kvar';
  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('item-occurred-on').value, '');
  assert.equal(dom.falt('item-note').value, '');
});

test('ett 400 med fältfel på Datum och Kommentar visas vid de två fälten', async (t) => {
  const datumtext = 'Datum måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD, eller lämnas tomt.';
  const kommentarstext = 'Kommentaren får vara högst 200 tecken.';
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: {
        error: datumtext,
        fieldErrors: [
          { field: 'occurredOn', message: datumtext },
          { field: 'note', message: kommentarstext }
        ]
      }
    }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  dom.falt('item-occurred-on').value = '2026-02-30';
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.faltfel('occurredOn'), datumtext);
  assert.equal(dom.faltfel('note'), kommentarstext);
  assert.equal(dom.falt('item-form-error').textContent, '');
  assert.equal(dom.falt('item-form-card').hidden, false);
});

test('en mall skickas utan Datum och Kommentar, också när fälten har värden', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({ status: 201, json: { template: {} } }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  dom.falt('item-occurred-on').value = '2026-09-04';
  dom.falt('item-note').value = 'ska inte med';
  kryssaAterkommande(dom, true);
  dom.falt('item-interval').value = 'monthly';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[5].url, `/api/mallar/${MANAD}`);
  assert.deepEqual(kropp(anrop[5]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '1234,50',
    category: 'housing',
    interval: 'monthly',
    toMonth: ''
  });
});

function rakning(id, name, amountOre, dueDate, daysUntil, status, extra = {}) {
  return {
    id,
    name,
    amountOre,
    dueDate,
    interval: null,
    remindDays: 3,
    paidAt: null,
    daysUntil,
    status,
    ...extra
  };
}

function rakningssvar(bills) {
  return { status: 200, json: { bills } };
}

function rakningsrader(dom) {
  return dom.rader('bill-list');
}

function statusklass(rad) {
  const klasser = rad.className.split(' ');
  assert.deepEqual(klasser.slice(0, 2), ['item', 'bill'], 'raden saknar layoutklasserna');
  return klasser[2];
}

function skickaRakningsformularet(dom) {
  let forhindrad = false;
  dom.falt('bill-form').utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  return forhindrad;
}

function fyllRakningsformularet(dom) {
  dom.falt('bill-name').value = 'Hemförsäkring';
  dom.falt('bill-amount').value = '249,00';
  dom.falt('bill-due-date').value = '2026-10-01';
  dom.falt('bill-interval').value = 'yearly';
  dom.falt('bill-remind-days').value = '7';
}

const EL_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const HYRA_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const TAND_ID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

test('(81) räkningskortet visar de tre utseendena: förfallen, påminnelse och kommande', async (t) => {
  const bills = [
    rakning(EL_ID, 'Elräkning', 85000, '2026-09-13', -3, 'forfallen'),
    rakning(HYRA_ID, 'Hyra', 1250000, '2026-09-18', 2, 'paminnelse', { interval: 'monthly' }),
    rakning(TAND_ID, 'Tandläkare', 180000, '2026-09-30', 14, 'kommande')
  ];
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => rakningssvar(bills))
  );

  assert.equal(anrop.length, 5);
  assert.equal(anrop[2].method, 'GET');
  assert.equal(anrop[2].url, RAKNINGSVAG);

  const rader = rakningsrader(dom);
  assert.equal(rader.length, 3);

  assert.equal(statusklass(rader[0]), 'bill-forfallen');
  assert.equal(celltext(rader[0], 'bill-name'), 'Elräkning');
  assert.equal(celltext(rader[0], 'bill-amount'), formatSek(85000));
  assert.equal(celltext(rader[0], 'bill-due-date'), '2026-09-13');
  assert.equal(celltext(rader[0], 'bill-days'), 'Förföll för 3 dagar sedan');

  assert.equal(statusklass(rader[1]), 'bill-paminnelse');
  assert.equal(celltext(rader[1], 'bill-name'), 'Hyra');
  assert.equal(celltext(rader[1], 'bill-amount'), formatSek(1250000));
  assert.equal(celltext(rader[1], 'bill-due-date'), '2026-09-18');
  assert.equal(celltext(rader[1], 'bill-days'), 'Förfaller om 2 dagar');

  assert.equal(statusklass(rader[2]), 'bill-kommande');
  assert.equal(celltext(rader[2], 'bill-name'), 'Tandläkare');
  assert.equal(celltext(rader[2], 'bill-amount'), formatSek(180000));
  assert.equal(celltext(rader[2], 'bill-due-date'), '2026-09-30');
  assert.equal(celltext(rader[2], 'bill-days'), 'Förfaller om 14 dagar');

  for (const rad of rader) {
    assert.equal(knapp(rad, 'bill-paid').textContent, BILL_PAID_LABEL);
  }
  assert.equal(anrop.length, 5);
});

test('(82) Betald flyttar fram en återkommande räkning, och den nya förfallodagen syns', async (t) => {
  const fore = rakning(HYRA_ID, 'Hyra', 1250000, '2026-09-16', 0, 'paminnelse', { interval: 'monthly' });
  const efter = rakning(HYRA_ID, 'Hyra', 1250000, '2026-10-16', 30, 'kommande', { interval: 'monthly' });
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 200, json: { bill: efter } }),
      ikoordning([rakningssvar([fore]), rakningssvar([efter])])
    )
  );

  assert.equal(celltext(rakningsrader(dom)[0], 'bill-due-date'), '2026-09-16');
  assert.equal(celltext(rakningsrader(dom)[0], 'bill-days'), 'Förfaller idag');

  assert.equal(knapp(rakningsrader(dom)[0], 'bill-paid').utlos('click'), true);
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, `/api/rakningar/${HYRA_ID}/betald`);
  assert.deepEqual(kropp(anrop[5]), { today: FRYST_IDAG });

  assert.equal(anrop.length, 7);
  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, RAKNINGSVAG);
  assert.equal(anrop.filter((anropet) => anropet.url === MANADSVAG).length, 1);

  const rader = rakningsrader(dom);
  assert.equal(rader.length, 1);
  assert.equal(celltext(rader[0], 'bill-name'), 'Hyra');
  assert.equal(celltext(rader[0], 'bill-due-date'), '2026-10-16');
  assert.equal(celltext(rader[0], 'bill-days'), 'Förfaller om 30 dagar');
  assert.equal(statusklass(rader[0]), 'bill-kommande');
});

test('(83) en betald engångsräkning försvinner ur listan', async (t) => {
  const obetald = rakning(TAND_ID, 'Tandläkare', 180000, '2026-09-20', 4, 'kommande');
  const betald = { ...obetald, paidAt: '2026-09-16T10:12:00.000Z', status: 'betald' };
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 200, json: { bill: betald } }),
      ikoordning([rakningssvar([obetald]), rakningssvar([betald])])
    )
  );

  assert.equal(rakningsrader(dom).length, 1);

  assert.equal(knapp(rakningsrader(dom)[0], 'bill-paid').utlos('click'), true);
  await flush();

  assert.equal(anrop[5].url, `/api/rakningar/${TAND_ID}/betald`);
  assert.equal(rakningsrader(dom).length, 0);
});

test('en betald räkning har ingen rad redan vid den första hämtningen', async (t) => {
  const bills = [
    { ...rakning(EL_ID, 'Elräkning', 85000, '2026-09-13', -3, 'betald'), paidAt: '2026-09-13T08:00:00.000Z' },
    rakning(TAND_ID, 'Tandläkare', 180000, '2026-09-30', 14, 'kommande')
  ];
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => rakningssvar(bills))
  );

  assert.deepEqual(
    rakningsrader(dom).map((rad) => celltext(rad, 'bill-name')),
    ['Tandläkare']
  );
});

test('knappen Betald är låst tills svaret kommit, så att två snabba klick inte ger två betalningar', async (t) => {
  const bill = rakning(HYRA_ID, 'Hyra', 1250000, '2026-09-18', 2, 'paminnelse', { interval: 'monthly' });
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => rakningssvar([bill]))
  );

  const betald = knapp(rakningsrader(dom)[0], 'bill-paid');
  assert.equal(betald.utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(betald.disabled, true);
  assert.equal(betald.utlos('click'), false);
  assert.equal(anrop.length, 6);

  anrop[5].svara({ status: 200, json: { bill } });
  await flush();
  assert.equal(betald.disabled, false);
});

test('+ Ny räkning sparar räkningen med POST och ritar om kortet ur en hämtning', async (t) => {
  const sparad = rakning(EL_ID, 'Hemförsäkring', 24900, '2026-10-01', 15, 'kommande', { interval: 'yearly', remindDays: 7 });
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 201, json: { bill: sparad } }),
      ikoordning([rakningssvar([]), rakningssvar([sparad])])
    )
  );

  assert.equal(rakningsrader(dom).length, 0);
  assert.equal(dom.falt('bill-form').hidden, true);

  assert.equal(dom.falt('add-bill').utlos('click'), true);
  assert.equal(dom.falt('bill-form').hidden, false);
  fyllRakningsformularet(dom);
  assert.equal(skickaRakningsformularet(dom), true);
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, '/api/rakningar');
  assert.deepEqual(kropp(anrop[5]), {
    name: 'Hemförsäkring',
    amountSek: '249,00',
    dueDate: '2026-10-01',
    interval: 'yearly',
    remindDays: '7'
  });

  assert.equal(dom.falt('bill-form').hidden, true);
  assert.equal(dom.falt('bill-name').value, '');
  assert.equal(anrop[6].url, RAKNINGSVAG);
  assert.deepEqual(
    rakningsrader(dom).map((rad) => celltext(rad, 'bill-name')),
    ['Hemförsäkring']
  );
});

test('ett 400 från räkningsvägen visar serverns text och lämnar formuläret öppet', async (t) => {
  const serverns = 'Förfallodag måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: { error: serverns, fieldErrors: [{ field: 'dueDate', message: serverns }] }
    }))
  );

  dom.falt('add-bill').utlos('click');
  fyllRakningsformularet(dom);
  skickaRakningsformularet(dom);
  await flush();

  assert.equal(dom.falt('bill-form-error').textContent, serverns);
  assert.equal(dom.falt('bill-form').hidden, false);
  assert.equal(dom.falt('bill-name').value, 'Hemförsäkring');
  assert.equal(anrop.length, 6);
});

test('ett avvisat fetch vid en sparning av en räkning visar den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => new Error('nätverket svarar inte'))
  );

  dom.falt('add-bill').utlos('click');
  fyllRakningsformularet(dom);
  skickaRakningsformularet(dom);
  await flush();

  assert.equal(dom.falt('bill-form-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('bill-form').hidden, false);
});

test('Avbryt i räkningsformuläret stänger det utan att skicka något anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  dom.falt('add-bill').utlos('click');
  fyllRakningsformularet(dom);
  assert.equal(dom.falt('bill-cancel').utlos('click'), true);

  assert.equal(dom.falt('bill-form').hidden, true);
  assert.equal(dom.falt('bill-name').value, '');
  assert.equal(anrop.length, 5);
});

test('räkningsformulärets intervallfält har Engångs först och därefter de fyra intervallen', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  const val = dom.falt('bill-interval').children;
  assert.deepEqual(val.map((option) => option.value), ['', ...Object.keys(INTERVAL_LABELS)]);
  assert.deepEqual(
    val.map((option) => option.textContent),
    [BILL_ONE_TIME_LABEL, ...Object.values(INTERVAL_LABELS)]
  );
});

test('Påminn mig får sitt förval och sina gränser ur src/core/bill.js', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  const falt = dom.falt('bill-remind-days');
  assert.equal(falt.getAttribute('min'), String(REMIND_DAYS_MIN));
  assert.equal(falt.getAttribute('max'), String(REMIND_DAYS_MAX));
  assert.equal(falt.value, '');
  dom.falt('add-bill').utlos('click');
  assert.equal(falt.value, String(REMIND_DAYS_DEFAULT));
});

test('räkningarna hämtas en gång och inte vid ett månadsbyte', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(anrop.filter((anropet) => anropet.url === RAKNINGSVAG).length, 1);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('month-prev').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 9);
  assert.equal(anrop.filter((anropet) => anropet.url === RAKNINGSVAG).length, 1);
});

test('ett 500 på räkningarnas väg visar serverns text i månadsvyn och lämnar kortet tomt', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => ({ status: 500, json: { error: serverns } }))
  );

  assert.equal(dom.falt('month-error').textContent, serverns);
  assert.equal(rakningsrader(dom).length, 0);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('ett avvisat fetch vid hämtningen av räkningarna visar den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => new Error('nätverket svarar inte'))
  );

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('ett 401 på räkningarnas väg visar inloggningsvyn', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => MIG_401)
  );

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
});

test('ett 200 utan läsbar lista ger ett tomt kort, och en okänd status ingen statusklass', async (t) => {
  const bills = [
    { ...rakning(EL_ID, 'Utan dagar', 85000, '2026-09-13', -3, 'forfallen'), daysUntil: undefined },
    rakning(HYRA_ID, 'Okänd status', 1250000, '2026-09-18', 2, 'ingenting'),
    { ...rakning(TAND_ID, 'Utan belopp', 180000, '2026-09-30', 14, 'kommande'), amountOre: null }
  ];
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => rakningssvar(bills))
  );

  const rader = rakningsrader(dom);
  assert.equal(rader.length, 3);
  assert.equal(celltext(rader[0], 'bill-days'), 'Förfaller idag');
  assert.deepEqual(rader[1].className.split(' '), ['item', 'bill']);
  assert.equal(celltext(rader[2], 'bill-amount'), formatSek(0));
});

function sparmal(id, name, fields) {
  return { id, name, ...fields };
}

function sparmalssvar(goals) {
  return { status: 200, json: { goals } };
}

function sparmalsrader(dom) {
  return dom.rader('goal-list');
}

function malstatusklass(rad) {
  const klasser = rad.className.split(' ');
  assert.deepEqual(klasser.slice(0, 2), ['item', 'goal'], 'raden saknar layoutklasserna');
  return klasser[2];
}

function stapeln(rad) {
  const svg = rad.children.find((barn) => barn.tagName === 'svg');
  assert.notEqual(svg, undefined, 'raden saknar stapeln');
  return svg;
}

function stapelfyllning(rad) {
  const rektanglar = stapeln(rad).children.filter((barn) => barn.tagName === 'rect');
  assert.equal(rektanglar.length, 2, 'stapeln ska ha ett spår och en fyllning');
  return rektanglar[1];
}

function stapelsparet(rad) {
  return stapeln(rad).children.filter((barn) => barn.tagName === 'rect')[0];
}

const BUFFERT = Object.freeze(
  sparmal('11111111-1111-4111-8111-aaaaaaaaaaaa', 'Buffert', {
    targetOre: 5000000,
    targetDate: '2027-06-30',
    savedOre: 2840000,
    leftOre: 2160000,
    percent: 57,
    monthsLeft: 8,
    perMonthOre: 270000,
    status: 'pagaende'
  })
);

const RESA = Object.freeze(
  sparmal('22222222-2222-4222-8222-bbbbbbbbbbbb', 'Resa', {
    targetOre: 1200000,
    targetDate: '2026-08-31',
    savedOre: 300000,
    leftOre: 900000,
    percent: 25,
    monthsLeft: 0,
    perMonthOre: 900000,
    status: 'forsenat'
  })
);

const CYKEL = Object.freeze(
  sparmal('33333333-3333-4333-8333-cccccccccccc', 'Cykel', {
    targetOre: 800000,
    targetDate: '2026-11-30',
    savedOre: 950000,
    leftOre: 0,
    percent: 100,
    monthsLeft: 2,
    perMonthOre: 0,
    status: 'klart'
  })
);

const PENSION = Object.freeze(
  sparmal('44444444-4444-4444-8444-dddddddddddd', 'Pension', {
    targetOre: 10000000,
    targetDate: null,
    savedOre: 1500000,
    leftOre: 8500000,
    percent: 15,
    monthsLeft: null,
    perMonthOre: null,
    status: 'pagaende'
  })
);

test('laddningen hämtar sparmålen med dagens datum i sökvägen, efter räkningarna', async (t) => {
  const { anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.deepEqual(
    anrop.map((anropet) => `${anropet.method} ${anropet.url}`),
    ['GET /api/mig', `GET ${MANADSVAG}`, `GET ${RAKNINGSVAG}`, `GET ${SPARMALSVAG}`, `GET /api/rapport/${MANAD}/12`]
  );
});

test('(84) kortet visar namn, sparat av mål, stapel, procent och Kvar-raden', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar([BUFFERT, RESA, CYKEL])
    )
  );

  assert.equal(dom.falt('goal-card').hidden, false);

  const rader = sparmalsrader(dom);
  assert.equal(rader.length, 3);

  assert.equal(rader[0].tagName, 'li');
  assert.equal(rader[0].className, 'item goal goal-pagaende');
  assert.equal(malstatusklass(rader[0]), 'goal-pagaende');

  assert.equal(celltext(rader[0], 'goal-name'), 'Buffert');
  assert.equal(
    celltext(rader[0], 'goal-saved'),
    `${formatSek(2840000)} av ${formatSek(5000000)}`
  );
  assert.equal(celltext(rader[0], 'goal-percent'), '57 %');
  assert.equal(
    celltext(rader[0], 'goal-left'),
    `Kvar ${formatSek(2160000)} - spara ${formatSek(270000)} i månaden till juni 2027`
  );
  assert.equal(celltext(rader[0], 'goal-note'), '');

  const fyllning = stapelfyllning(rader[0]);
  assert.equal(stapeln(rader[0]).namespace, 'http://www.w3.org/2000/svg');
  assert.equal(fyllning.getAttribute('width'), '114');
  assert.equal(fyllning.getAttribute('class'), 'goal-bar goal-bar-pagaende');
  assert.equal(stapelsparet(rader[0]).getAttribute('width'), '200');
  assert.equal(stapelsparet(rader[0]).getAttribute('class'), 'goal-bar-track');
  assert.equal(fyllning.getAttribute('style'), null);

  assert.equal(malstatusklass(rader[1]), 'goal-forsenat');
  assert.equal(celltext(rader[1], 'goal-percent'), '25 %');
  assert.equal(celltext(rader[1], 'goal-note'), 'Slutdatumet har passerat');
  assert.equal(stapelfyllning(rader[1]).getAttribute('width'), '50');

  assert.equal(anrop.length, 5);
});

test('ett slutdatum utan månadstakt ger den korta Kvar-raden i stället för ett kast', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar([sparmal(BUFFERT.id, 'Buffert', { ...BUFFERT, perMonthOre: null })])
    )
  );

  const rader = sparmalsrader(dom);
  assert.equal(rader.length, 1, 'raden ska ritas och inte falla bort');
  assert.equal(celltext(rader[0], 'goal-left'), `Kvar ${formatSek(2160000)}`);
});

test('(86) ett nått mål visas som klart med guldstapel och sin egen text', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar([CYKEL])
    )
  );

  const rad = sparmalsrader(dom)[0];

  assert.equal(malstatusklass(rad), 'goal-klart');
  assert.equal(celltext(rad, 'goal-note'), 'Målet är nått');
  assert.equal(stapelfyllning(rad).getAttribute('class'), 'goal-bar goal-bar-klart');
  assert.equal(celltext(rad, 'goal-percent'), '100 %');
  assert.equal(stapelfyllning(rad).getAttribute('width'), '200');
  assert.equal(celltext(rad, 'goal-saved'), `${formatSek(950000)} av ${formatSek(800000)}`);
});

test('ett mål utan slutdatum visar Kvar-raden utan månadstakt', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar([PENSION])
    )
  );

  const rad = sparmalsrader(dom)[0];

  assert.equal(celltext(rad, 'goal-left'), `Kvar ${formatSek(8500000)}`);
  assert.equal(celltext(rad, 'goal-percent'), '15 %');
  assert.equal(stapelfyllning(rad).getAttribute('width'), '30');
  assert.equal(malstatusklass(rad), 'goal-pagaende');
});

test('kortet ritas om i båda riktningarna när sparmålen hämtas om', async (t) => {
  const svar = ikoordning([
    sparmalssvar([BUFFERT, RESA, CYKEL]),
    sparmalssvar([PENSION]),
    sparmalssvar([])
  ]);
  const { dom } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 201, json: { goal: { id: PENSION.id } } }),
      () => RAKNINGAR_TOM,
      svar
    )
  );

  const namn = () => sparmalsrader(dom).map((rad) => celltext(rad, 'goal-name'));
  assert.deepEqual(namn(), ['Buffert', 'Resa', 'Cykel']);

  const sparaMal = () => {
    dom.falt('add-goal').utlos('click');
    dom.falt('goal-name').value = 'Pension';
    dom.falt('goal-target').value = '100000';
    dom.falt('goal-target-date').value = '';
    dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  };

  sparaMal();
  await flush();
  assert.deepEqual(namn(), ['Pension']);

  sparaMal();
  await flush();
  assert.deepEqual(namn(), []);
  assert.equal(dom.falt('goal-card').hidden, false);
});

test('GOAL_NOTES nycklar står i GOAL_STATUSES, och pagaende har med flit ingen', async (t) => {
  const alla = GOAL_STATUSES.map((status, index) =>
    sparmal(`5${index}555555-5555-4555-8555-eeeeeeeeeeee`, `Mål ${status}`, {
      targetOre: 1000000,
      targetDate: '2027-01-31',
      savedOre: 250000,
      leftOre: 750000,
      percent: 25,
      monthsLeft: 4,
      perMonthOre: 187500,
      status
    })
  );
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar(alla)
    )
  );

  const texter = new Map(
    sparmalsrader(dom).map((rad) => [malstatusklass(rad), celltext(rad, 'goal-note')])
  );

  assert.deepEqual(
    [...texter.keys()],
    GOAL_STATUSES.map((status) => `goal-${status}`)
  );
  assert.equal(texter.get('goal-klart'), 'Målet är nått');
  assert.equal(texter.get('goal-forsenat'), 'Slutdatumet har passerat');
  assert.equal(texter.get('goal-pagaende'), '');
});

test('en okänd status ger ingen statusklass och ingen text', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () =>
      sparmalssvar([sparmal(BUFFERT.id, 'Buffert', { ...BUFFERT, status: 'okand' })])
    )
  );

  const rad = sparmalsrader(dom)[0];
  assert.equal(rad.className, 'item goal');
  assert.equal(celltext(rad, 'goal-note'), '');
  assert.equal(stapelfyllning(rad).getAttribute('class'), 'goal-bar');
});

test('ett 200 utan läsbar lista ger ett tomt kort, och en kropp utan tal ger nollor', async (t) => {
  const svar = ikoordning([
    { status: 200 },
    sparmalssvar([sparmal(BUFFERT.id, 'Buffert', { status: 'pagaende' })])
  ]);
  const { dom } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 201, json: { goal: { id: BUFFERT.id } } }),
      () => RAKNINGAR_TOM,
      svar
    )
  );

  assert.equal(dom.falt('goal-card').hidden, false);
  assert.equal(sparmalsrader(dom).length, 0);

  dom.falt('add-goal').utlos('click');
  dom.falt('goal-name').value = 'Buffert';
  dom.falt('goal-target').value = '50000';
  dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  await flush();

  const rad = sparmalsrader(dom)[0];
  assert.equal(celltext(rad, 'goal-saved'), `${formatSek(0)} av ${formatSek(0)}`);
  assert.equal(celltext(rad, 'goal-percent'), '0 %');
  assert.equal(celltext(rad, 'goal-left'), `Kvar ${formatSek(0)}`);
  assert.equal(stapelfyllning(rad).getAttribute('width'), '0');
});

test('+ Nytt sparmål sparar målet med POST och ritar om kortet ur en hämtning', async (t) => {
  const svar = ikoordning([sparmalssvar([]), sparmalssvar([BUFFERT])]);
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 201, json: { goal: { id: BUFFERT.id } } }),
      () => RAKNINGAR_TOM,
      svar
    )
  );

  assert.equal(dom.falt('goal-form').hidden, true);
  dom.falt('add-goal').utlos('click');
  assert.equal(dom.falt('goal-form').hidden, false);

  dom.falt('goal-name').value = 'Buffert';
  dom.falt('goal-target').value = '50000';
  dom.falt('goal-target-date').value = '2027-06-30';

  let forhindrad = false;
  dom.falt('goal-form').utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  assert.equal(forhindrad, true, 'formuläret ska inte skickas av webbläsaren');
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, '/api/sparmal');
  assert.deepEqual(kropp(anrop[5]), {
    name: 'Buffert',
    targetSek: '50000',
    targetDate: '2027-06-30'
  });

  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, SPARMALSVAG);
  assert.deepEqual(
    sparmalsrader(dom).map((rad) => celltext(rad, 'goal-name')),
    ['Buffert']
  );

  assert.equal(dom.falt('goal-form').hidden, true);
  assert.equal(dom.falt('goal-name').value, '');
});

test('(87) + Sätt in ökar savedOre och ritar om raden, med stapeln och procenten', async (t) => {
  const malId = '66666666-6666-4666-8666-ffffffffffff';
  const fore = sparmal(malId, 'Resefond', {
    targetOre: 5000000,
    targetDate: '2027-04-30',
    savedOre: 1150000,
    leftOre: 3850000,
    percent: 23,
    monthsLeft: 7,
    perMonthOre: 550000,
    status: 'pagaende'
  });
  const efter = sparmal(malId, 'Resefond', {
    ...fore,
    savedOre: 1400000,
    leftOre: 3600000,
    percent: 28,
    perMonthOre: 514286
  });

  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => ({ status: 201, json: { deposit: { id: '77777777-7777-4777-8777-999999999999' } } }),
      () => RAKNINGAR_TOM,
      ikoordning([sparmalssvar([fore]), sparmalssvar([efter])])
    )
  );

  const raden = () => sparmalsrader(dom)[0];

  assert.equal(celltext(raden(), 'goal-saved'), `${formatSek(1150000)} av ${formatSek(5000000)}`);
  assert.equal(celltext(raden(), 'goal-percent'), '23 %');
  assert.equal(stapelfyllning(raden()).getAttribute('width'), '46');
  assert.equal(
    celltext(raden(), 'goal-left'),
    `Kvar ${formatSek(3850000)} - spara ${formatSek(550000)} i månaden till april 2027`
  );

  assert.equal(dom.falt('deposit-form').hidden, true);
  assert.equal(knapp(raden(), 'goal-deposit').textContent, '+ Sätt in');
  assert.equal(knapp(raden(), 'goal-deposit').utlos('click'), true);
  assert.equal(dom.falt('deposit-form').hidden, false);
  assert.equal(anrop.length, 5);

  dom.falt('deposit-amount').value = '2500';
  dom.falt('deposit-date').value = FRYST_IDAG;

  let forhindrad = false;
  dom.falt('deposit-form').utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  assert.equal(forhindrad, true, 'formuläret ska inte skickas av webbläsaren');
  await flush();

  assert.equal(anrop[5].method, 'POST');
  assert.equal(anrop[5].url, `${SPARMALSVAG_PREFIX}${malId}/insattning`);
  assert.deepEqual(kropp(anrop[5]), { amountSek: '2500', madeOn: FRYST_IDAG });

  assert.equal(anrop[6].method, 'GET');
  assert.equal(anrop[6].url, SPARMALSVAG);

  assert.equal(sparmalsrader(dom).length, 1);
  assert.equal(celltext(raden(), 'goal-saved'), `${formatSek(1400000)} av ${formatSek(5000000)}`);
  assert.equal(celltext(raden(), 'goal-percent'), '28 %');
  assert.equal(stapelfyllning(raden()).getAttribute('width'), '56');
  assert.equal(
    celltext(raden(), 'goal-left'),
    `Kvar ${formatSek(3600000)} - spara ${formatSek(514286)} i månaden till april 2027`
  );
  assert.equal(malstatusklass(raden()), 'goal-pagaende');

  assert.equal(dom.falt('deposit-form').hidden, true);
  assert.equal(dom.falt('deposit-amount').value, '');
});

test('ett 400 från sparmålsvägen visar serverns text och lämnar formuläret öppet', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: {
        error: 'Målbeloppet måste vara ett tal.',
        fieldErrors: [{ field: 'targetSek', message: 'Målbeloppet måste vara ett tal.' }]
      }
    }))
  );

  dom.falt('add-goal').utlos('click');
  dom.falt('goal-name').value = 'Buffert';
  dom.falt('goal-target').value = 'abc';
  dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  await flush();

  assert.equal(dom.falt('goal-form-error').textContent, 'Målbeloppet måste vara ett tal.');
  assert.equal(dom.falt('goal-form').hidden, false);
  assert.equal(dom.falt('goal-name').value, 'Buffert', 'fälten ska inte tömmas av ett fel');
});

test('knappen Spara i sparmålsformuläret är låst tills svaret kommit', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null)
  );

  dom.falt('add-goal').utlos('click');
  dom.falt('goal-name').value = 'Buffert';
  dom.falt('goal-target').value = '50000';
  dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  await flush();

  assert.equal(anrop.length, 6);
  assert.equal(dom.falt('goal-submit').disabled, true);

  dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  await flush();
  assert.equal(anrop.length, 6);

  anrop[5].svara({ status: 201, json: { goal: { id: BUFFERT.id } } });
  await flush();
  assert.equal(dom.falt('goal-submit').disabled, false);
});

test('ett avvisat fetch vid en sparning av ett sparmål visar den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => new Error('nätverket nere'))
  );

  dom.falt('add-goal').utlos('click');
  dom.falt('goal-name').value = 'Buffert';
  dom.falt('goal-target').value = '50000';
  dom.falt('goal-form').utlos('submit', { preventDefault: () => undefined });
  await flush();

  assert.equal(dom.falt('goal-form-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('goal-submit').disabled, false);
});

test('Avbryt i sparmålsformuläret stänger det utan att skicka något anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  dom.falt('add-goal').utlos('click');
  dom.falt('goal-name').value = 'Buffert';
  assert.equal(dom.falt('goal-cancel').utlos('click'), true);

  assert.equal(dom.falt('goal-form').hidden, true);
  assert.equal(dom.falt('goal-name').value, '');
  assert.equal(anrop.length, 5);
});

test('ett 500 på sparmålens väg visar serverns text och lämnar kortet dolt', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => ({
      status: 500,
      json: { error: 'Databasen kunde inte läsas.' }
    }))
  );

  assert.equal(dom.falt('month-error').textContent, 'Databasen kunde inte läsas.');
  assert.equal(dom.falt('goal-card').hidden, true);
});

test('ett avvisat fetch vid hämtningen av sparmålen visar den allmänna texten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => new Error('nätverket nere')
    )
  );

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('goal-card').hidden, true);
});

test('ett 401 på sparmålens väg visar inloggningsvyn', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => MIG_401)
  );

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
});

const MALCELLER = Object.freeze(['goal-saved', 'goal-percent', 'goal-left']);

function kallanUtanKommentarer(kalla) {
  return kalla
    .split('\n')
    .filter((rad) => !rad.trimStart().startsWith('//'))
    .join('\n');
}

test('app.js räknar aldrig fram sparmålskortets tal själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  for (const sats of kalla.split(';')) {
    const traffar = MALCELLER.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(', '.map(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  for (const falt of ['savedOre', 'targetOre', 'leftOre', 'perMonthOre', 'percent']) {
    assert.equal(kalla.includes(`goal.${falt}`), true, `app.js läser inte goal.${falt} ur svaret`);
  }

  for (const namn of ['PERCENT_MIN', 'PERCENT_FULL', 'GOAL_STATUSES']) {
    assert.equal(kalla.includes(namn), true, `app.js läser inte ${namn} ur src/core/goal.js`);
  }

  assert.equal(kalla.includes('GOAL_STATUSES.includes(status)'), true);

  const koden = kallanUtanKommentarer(kalla);
  assert.deepEqual(
    GOAL_STATUSES.filter((status) => koden.includes(status)),
    ['klart', 'forsenat'],
    'bara de statusvärden som har ett utseende får stå skrivna i app.js'
  );
});

const REPORT_EMPTY_TEXT = 'Inget att visa för perioden.';

const RAPPORTKOLUMNER = Object.freeze([
  ['Slag', 'report-kind'],
  ['Kategori', 'report-category'],
  ['Snitt per månad', 'report-average'],
  ['Summa', 'report-total'],
  ['Tak', 'report-budget'],
  ['Över taket', 'report-over']
]);

const RAPPORT_UPPMARKNING = [
  '<section class="card" id="report-card" hidden>',
  '<h3>Rapport</h3>',
  '<div class="report-periods">',
  '<button type="button" class="secondary" id="report-period-3" aria-pressed="false">3 mån</button>',
  '<button type="button" class="secondary" id="report-period-6" aria-pressed="false">6 mån</button>',
  '<button type="button" class="secondary" id="report-period-12" aria-pressed="false">12 mån</button></div>',
  '<div id="report-chart" class="chart"></div>',
  '<p class="empty-state" id="report-chart-empty"></p>',
  '<table class="report-table">',
  '<thead><tr><th>Slag</th><th>Kategori</th><th>Snitt per månad</th><th>Summa</th><th>Tak</th><th>Över taket</th></tr></thead>',
  '<tbody id="report-rows"></tbody></table>',
  '<p class="empty-state" id="report-empty"></p>',
  '<button type="button" class="secondary" id="report-download">Hämta som CSV</button></section>',
  '<p class="form-error" id="report-error" role="alert"></p>'
].join('');

const rapportvag = (manad, antal) => `${RAPPORTVAG_PREFIX}${manad}/${antal}`;

function rapportrad(kind, category, perMonthOre, budgetPerMonthOre, overBudgetMonths) {
  const totalOre = perMonthOre.reduce((summa, belopp) => summa + belopp, 0);
  return {
    kind,
    category,
    perMonthOre,
    totalOre,
    averageOre: divideRoundHalfUp(totalOre, perMonthOre.length),
    budgetPerMonthOre,
    overBudgetMonths
  };
}

function rapportsvar(rows, months = ['2026-07', '2026-08', MANAD]) {
  return { status: 200, json: { months, rows, largest: null } };
}

const LANG_RAPPORT = Object.freeze([
  rapportrad('income', 'other', [3000000, 3000000, 3000000], [null, null, null], 0),
  rapportrad('expense', 'housing', [1200000, 1200000, 1200000], [1000000, null, 1250000], 1),
  rapportrad('expense', 'transport', [150000, 150000, 150000], [null, null, null], 0),
  rapportrad('expense', 'other', [0, 0, 0], [undefined, 50000, 50000], 0)
]);
const KORT_RAPPORT = Object.freeze([
  rapportrad('expense', 'loan', [10000, 20000, 30000], [null, null, null], 0)
]);

function rapportrader(dom) {
  return dom.rader('report-rows');
}

function rapportsvgen(dom) {
  const barn = dom.falt('report-chart').children;
  assert.equal(barn.length, 1, 'rapportens diagram har inte exakt ett barn');
  return barn[0];
}

function markeringen(dom) {
  return [3, 6, 12].map((antal) => dom.falt(`report-period-${antal}`).getAttribute('aria-pressed'));
}

function utanKommentarer(kalla) {
  return kalla.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
}

test('(90) rapportens uppmärkning står i index.html, och perioderna ligger inom serverns tak', async () => {
  const html = await fs.readFile(INDEX_PATH, 'utf8');
  for (const id of ['report-card']) {
    const taggen = new RegExp(`<section[^>]*id="${id}"[^>]*>`).exec(html);
    assert.notEqual(taggen, null, `${id} saknas i index.html`);
    assert.equal(taggen[0].includes(' hidden'), true, `${id} bär inte hidden från början`);
  }
  assert.equal(html.includes('id="report-download">Hämta som CSV<'), true);
  const rubrikraden = RAPPORTKOLUMNER.map(([rubrik]) => `<th>${rubrik}</th>`).join('');
  assert.equal(rubrikraden, '<th>Slag</th><th>Kategori</th><th>Snitt per månad</th><th>Summa</th><th>Tak</th><th>Över taket</th>');
  assert.equal(html.includes(rubrikraden), true, 'tabellhuvudet står inte ordagrant i index.html');
  assert.equal(/<div class="report-periods">/.test(html), true, 'div.report-periods saknas');
  assert.equal(/<table class="report-table">/.test(html), true, 'table.report-table saknas');

  const forsta = '<section class="card" id="report-card" hidden>';
  const sista = '<p class="form-error" id="report-error" role="alert"></p>';
  const fran = html.indexOf(forsta);
  const till = html.indexOf(sista);
  assert.notEqual(fran, -1, 'rapportkortets öppnande tagg saknas i index.html');
  assert.notEqual(till, -1, 'rapportens felrad saknas i index.html');
  const utdraget = html
    .slice(fran, till + sista.length)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .trim();
  assert.equal(utdraget, RAPPORT_UPPMARKNING);

  const kod = utanKommentarer(await fs.readFile(APP_KALLA_PATH, 'utf8'));
  const traff = /const REPORT_PERIODS = Object\.freeze\(\[([0-9, ]+)\]\);/.exec(kod);
  assert.notEqual(traff, null, 'REPORT_PERIODS saknas i app.js');
  const perioder = traff[1].split(',').map((tal) => Number(tal.trim()));
  assert.equal(perioder.length > 0, true);
  for (const antal of perioder) {
    assert.equal(Number.isInteger(antal), true, String(antal));
    assert.equal(antal >= OVERVIEW_MIN_MONTHS && antal <= OVERVIEW_MAX_MONTHS, true, `${antal} ligger utanför taket`);
    assert.equal(html.includes(`id="report-period-${antal}" aria-pressed="false">${antal} mån<`), true, `knappen för ${antal} saknas`);
  }
});

test('(91) rapportens diagram ritas med renderChart: bara utgifter, totalOre, ingen stapel på noll', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => rapportsvar(LANG_RAPPORT))
  );
  const svg = rapportsvgen(dom);
  const staplar = svg.children.filter((barn) => barn.tagName === 'rect' && barn.getAttribute('class') === 'chart-bar');
  assert.equal(staplar.length, 2);
  assert.equal(staplar[0].getAttribute('width'), '100');
  assert.equal(staplar[1].getAttribute('width'), String(Math.round((450000 * 100) / 3600000)));
  assert.deepEqual(
    medKlass(svg, 'chart-amount').map((text) => text.textContent),
    [formatSek(3600000), formatSek(450000)]
  );
  assert.deepEqual(
    medKlass(svg, 'chart-label').map((text) => text.textContent),
    [CATEGORY_LABELS.housing, CATEGORY_LABELS.transport]
  );
  assert.equal(dom.falt('report-chart-empty').textContent, '');

  const kod = utanKommentarer(await fs.readFile(APP_KALLA_PATH, 'utf8'));
  assert.equal(kod.split("'chart-bar'").length - 1, 1);
});

test('(91) staplarna står i fallande belopp också när rapportens rader inte gör det', async (t) => {
  const rader = [
    rapportrad('expense', 'transport', [100000, 100000, 100000], [null, null, null], 0),
    rapportrad('expense', 'loan', [400000, 400000, 400000], [null, null, null], 0)
  ];
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => rapportsvar(rader))
  );
  const svg = rapportsvgen(dom);
  assert.deepEqual(
    medKlass(svg, 'chart-label').map((text) => text.textContent),
    [CATEGORY_LABELS.loan, CATEGORY_LABELS.transport]
  );
  const staplar = svg.children.filter((barn) => barn.tagName === 'rect');
  assert.deepEqual(staplar.map((stapel) => stapel.getAttribute('width')), ['100', '25']);
});

test('(92) en tabellrad per slag och kategori, med tak och Över taket enligt F1 och F2', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      (anropet) => (anropet.url.endsWith('/12') ? rapportsvar(LANG_RAPPORT) : rapportsvar(KORT_RAPPORT))
    )
  );
  const rader = rapportrader(dom);
  assert.equal(rader.length, 4);
  const klasser = RAPPORTKOLUMNER.map(([, klass]) => klass);
  for (const rad of rader) {
    assert.equal(rad.tagName, 'tr');
    assert.equal(rad.className, 'report-row');
    assert.deepEqual(rad.children.map((barn) => barn.className), klasser);
    assert.deepEqual(rad.children.map((barn) => barn.tagName), klasser.map(() => 'td'));
  }
  const celler = (rad) => klasser.map((klass) => celltext(rad, klass));
  assert.deepEqual(celler(rader[0]), [
    ITEM_KIND_LABELS.income, CATEGORY_LABELS.other, formatSek(3000000), formatSek(9000000), '', ''
  ]);
  assert.deepEqual(celler(rader[1]), [
    ITEM_KIND_LABELS.expense, CATEGORY_LABELS.housing, formatSek(1200000), formatSek(3600000), formatSek(1250000), '1 av 2'
  ]);
  assert.deepEqual(celler(rader[2]).slice(4), ['', '']);
  assert.deepEqual(celler(rader[3]).slice(4), [formatSek(50000), '0 av 2']);

  assert.equal(dom.falt('report-period-3').utlos('click'), true);
  await flush();
  assert.equal(rapportrader(dom).length, 1);
  assert.equal(celltext(rapportrader(dom)[0], 'report-category'), CATEGORY_LABELS.loan);
});

test('(92) ett slutmånadstak som inte är ett säkert heltal ger en tom cell och aldrig texten NaN', async (t) => {
  const rader = [
    rapportrad('expense', 'housing', [100, 100, 100], [50000, 50000, undefined], 0),
    rapportrad('expense', 'loan', [100, 100, 100], [50000, 50000, NaN], 0)
  ];
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => rapportsvar(rader))
  );
  assert.equal(rapportrader(dom).length, 2);
  for (const rad of rapportrader(dom)) {
    assert.equal(celltext(rad, 'report-budget'), '');
    assert.equal(celltext(rad, 'report-over'), '0 av 2');
  }
});

test('(93) en tom rapport ger båda tomtexterna, och en rapport med rader därefter tömmer tomtexten', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      ikoordning([rapportsvar([]), rapportsvar(KORT_RAPPORT)])
    )
  );
  assert.equal(dom.falt('report-chart-empty').textContent, CHART_EMPTY_TEXT);
  assert.equal(dom.falt('report-empty').textContent, REPORT_EMPTY_TEXT);
  assert.equal(rapportrader(dom).length, 0);

  assert.equal(dom.falt('report-period-6').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('report-empty').textContent, '');
  assert.equal(dom.falt('report-chart-empty').textContent, '');
  assert.equal(rapportrader(dom).length, 1);
});

test('(94) perioden: 12 från start, 3 efter ett klick, och ett 500 på 6 lämnar 3 kvar', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      (anropet) => {
        if (anropet.url.endsWith('/12')) {
          return rapportsvar(LANG_RAPPORT);
        }
        if (anropet.url.endsWith('/3')) {
          return null;
        }
        return { status: 500, json: { error: serverns } };
      }
    )
  );
  assert.equal(anrop[4].method, 'GET');
  assert.equal(anrop[4].url, rapportvag(MANAD, 12));
  assert.deepEqual(markeringen(dom), ['false', 'false', 'true']);

  assert.equal(dom.falt('report-period-3').utlos('click'), true);
  await flush();
  assert.equal(anrop.length, 6);
  assert.equal(anrop[5].url, rapportvag(MANAD, 3));
  assert.equal(dom.falt('report-period-3').disabled, true);
  assert.deepEqual(markeringen(dom), ['false', 'false', 'true']);
  assert.equal(dom.falt('report-period-3').utlos('click'), false);
  assert.equal(anrop.length, 6);
  anrop[5].svara(rapportsvar(KORT_RAPPORT));
  await flush();
  assert.equal(dom.falt('report-period-3').disabled, false);
  assert.deepEqual(markeringen(dom), ['true', 'false', 'false']);
  assert.equal(rapportrader(dom).length, 1);

  assert.equal(dom.falt('report-period-6').utlos('click'), true);
  await flush();
  assert.equal(anrop[6].url, rapportvag(MANAD, 6));
  assert.deepEqual(markeringen(dom), ['true', 'false', 'false']);
  assert.equal(rapportrader(dom).length, 1);
  assert.equal(dom.falt('report-error').textContent, serverns);
  assert.equal(dom.falt('month-error').textContent, '');
  assert.equal(dom.falt('report-period-6').disabled, false);
  assert.equal(dom.falt('report-card').hidden, false);

  assert.equal(dom.falt('month-prev').utlos('click'), true);
  await flush();
  assert.equal(anrop.at(-1).url, rapportvag(FOREGAENDE_MANAD, 3));
});

test('(95) rapporten följer månaden vid månadsbyte och efter en lyckad ändring', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar(treSlagsposter()),
      (anropet) => {
        if (anropet.method === 'DELETE') {
          return { status: 204 };
        }
        if (anropet.method === 'PUT') {
          return { status: 200, json: { budgets: [] } };
        }
        return { status: 201, json: { item: null } };
      },
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      () => rapportsvar(KORT_RAPPORT)
    )
  );
  dom.falt('report-period-3').utlos('click');
  await flush();
  assert.equal(anrop[5].url, rapportvag(MANAD, 3));

  assert.equal(dom.falt('month-prev').utlos('click'), true);
  await flush();
  assert.equal(anrop.length, 8, 'månadsbytet hämtade inte rapporten');
  assert.equal(anrop[6].url, `/api/manad/${FOREGAENDE_MANAD}`);
  assert.equal(anrop[7].url, rapportvag(FOREGAENDE_MANAD, 3));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();
  assert.equal(anrop.length, 11, 'sparningen hämtade inte rapporten');
  assert.equal(anrop[8].method, 'POST');
  assert.equal(anrop[9].url, `/api/manad/${FOREGAENDE_MANAD}`);
  assert.equal(anrop[10].url, rapportvag(FOREGAENDE_MANAD, 3));

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();
  assert.equal(anrop.length, 14, 'borttagningen hämtade inte rapporten');
  assert.equal(anrop[11].method, 'DELETE');
  assert.equal(anrop[12].url, `/api/manad/${FOREGAENDE_MANAD}`);
  assert.equal(anrop[13].url, rapportvag(FOREGAENDE_MANAD, 3));

  dom.falt('add-budget').utlos('click');
  dom.falt('budget-category').value = 'housing';
  dom.falt('budget-amount').value = '9000';
  skickaBudgetformularet(dom);
  await flush();
  assert.equal(anrop.length, 17, 'taket hämtade inte rapporten');
  assert.equal(anrop[14].method, 'PUT');
  assert.equal(anrop[15].url, '/api/manad/' + FOREGAENDE_MANAD);
  assert.equal(anrop[16].url, rapportvag(FOREGAENDE_MANAD, 3));
});

test('(96) hämtningens felvägar vid sidladdning: avvisat fetch, 500 och 401', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => new Error('nätet nere'))
  );
  assert.equal(dom.falt('report-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-error').textContent, '');
  assert.equal(dom.falt('report-card').hidden, true);
});

test('(96) ett 500 vid sidladdning ger serverns text och båda sektionerna dolda', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => ({ status: 500, json: { error: serverns } }))
  );
  assert.equal(dom.falt('report-error').textContent, serverns);
  assert.equal(dom.falt('month-error').textContent, '');
  assert.equal(dom.falt('report-card').hidden, true);
});

test('(96) ett 401 vid sidladdning visar inloggningsvyn', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_TOM, () => SPARMAL_TOM, () => MIG_401)
  );
  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('month-error').textContent, '');
  assert.equal(dom.falt('report-error').textContent, '');
});

function objektUrl() {
  const fatt = [];
  const createObjectURL = (blob) => {
    fatt.push(blob);
    return `blob:attrapp/${fatt.length}`;
  };
  return { fatt, createObjectURL };
}

test('(97) nedladdningen hämtar den rapport som syns och sparar Bloben under reportFileName', async (t) => {
  const fil = new Blob(['csv'], { type: 'text/csv; charset=utf-8' });
  const { fatt, createObjectURL } = objektUrl();
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([manadssvar([]), { status: 500, json: { error: 'fel' } }]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      (anropet) => {
        if (anropet.url.endsWith('/csv')) {
          return { status: 200, blob: fil };
        }
        return anropet.url.startsWith(rapportvag(MANAD, '')) ? rapportsvar(KORT_RAPPORT) : { status: 500, json: { error: 'fel' } };
      }
    ),
    FRYST_IDAG,
    { createObjectURL }
  );

  assert.equal(dom.falt('report-period-3').utlos('click'), true);
  await flush();

  dom.falt('month-next').utlos('click');
  await flush();

  assert.equal(dom.falt('report-download').utlos('click'), true);
  await flush();
  const nedladdning = anrop.at(-1);
  assert.equal(nedladdning.method, 'GET');
  assert.equal(nedladdning.url, `${rapportvag(MANAD, 3)}/csv`);
  assert.equal(fatt.length, 1);
  assert.equal(fatt[0] === fil, true, 'createObjectURL fick inte attrappens Blob');
  assert.deepEqual(dom.klick, [{ href: 'blob:attrapp/1', download: reportFileName(MANAD) }]);
  assert.equal(dom.klick[0].download, 'hemochekonomi-2026-09.csv');
  assert.equal(dom.falt('report-download').disabled, false);
});

for (const [namn, svar, kontroll] of [
  ['ett avvisat fetch ger den allmänna texten', () => new Error('nätet nere'), (dom) => {
    assert.equal(dom.falt('report-error').textContent, GENERAL_ERROR);
    assert.equal(dom.falt('month-error').textContent, '');
  }],
  ['ett 500 ger serverns text', () => ({ status: 500, json: { error: 'Serverns text.' } }), (dom) => {
    assert.equal(dom.falt('report-error').textContent, 'Serverns text.');
    assert.equal(dom.falt('month-error').textContent, '');
  }],
  ['ett 200 utan läsbar kropp ger den allmänna texten', () => ({ status: 200 }), (dom) => {
    assert.equal(dom.falt('report-error').textContent, GENERAL_ERROR);
    assert.equal(dom.falt('month-error').textContent, '');
  }],
  ['ett 401 visar inloggningsvyn', () => MIG_401, (dom) => {
    assert.equal(dom.falt('login-view').hidden, false);
    assert.equal(dom.falt('month-view').hidden, true);
  }]
]) {
  test(`(98) vid nedladdning: ${namn}, och createObjectURL anropas inte`, async (t) => {
    const { fatt, createObjectURL } = objektUrl();
    let csvSvar = null;
    const { dom, anrop } = await starta(
      t,
      planInloggad(
        () => manadssvar([]),
        () => null,
        () => RAKNINGAR_TOM,
        () => SPARMAL_TOM,
        (anropet) => (anropet.url.endsWith('/csv') ? csvSvar : rapportsvar(KORT_RAPPORT))
      ),
      FRYST_IDAG,
      { createObjectURL }
    );
    assert.equal(dom.falt('report-download').utlos('click'), true);
    await flush();
    assert.equal(dom.falt('report-download').disabled, true);
    assert.equal(dom.falt('report-download').utlos('click'), false);
    const forsta = anrop.at(-1);
    forsta.svara({ status: 200, blob: new Blob(['a']) });
    await flush();
    assert.equal(dom.falt('report-download').disabled, false);
    assert.equal(fatt.length, 1);

    csvSvar = svar();
    assert.equal(dom.falt('report-download').utlos('click'), true);
    await flush();
    kontroll(dom);
    assert.equal(fatt.length, 1, 'createObjectURL anropades efter ett fel');
    assert.equal(dom.klick.length, 1);
    assert.equal(dom.falt('report-download').disabled, false);
  });
}

const RAKNINGARNAS_FEL = 'Räkningarnas fel.';
const RAKNINGAR_500 = Object.freeze({ status: 500, json: { error: RAKNINGARNAS_FEL } });

for (const [namn, svaraRapporten] of [
  ['200', (anropet) => anropet.svara(rapportsvar(KORT_RAPPORT))],
  ['500', (anropet) => anropet.svara({ status: 500, json: { error: 'Serverns text.' } })],
  ['avvisade fetch', (anropet) => anropet.kasta(new Error('nätet nere'))]
]) {
  test(`(100) vid sidladdning: rapportens ${namn} rör inte räkningarnas fel i #month-error`, async (t) => {
    const { dom, anrop } = await starta(
      t,
      planInloggad(() => manadssvar([]), () => null, () => RAKNINGAR_500, () => SPARMAL_TOM, () => null)
    );
    await flush();
    assert.equal(anrop[4].url, rapportvag(MANAD, 12));
    assert.equal(dom.falt('month-error').textContent, RAKNINGARNAS_FEL);
    assert.equal(dom.falt('report-error').textContent, '');

    svaraRapporten(anrop[4]);
    await flush();
    assert.equal(dom.falt('month-error').textContent, RAKNINGARNAS_FEL);
  });
}

for (const [namn, csvSvar] of [
  ['200 med en Blob', () => ({ status: 200, blob: new Blob(['csv']) })],
  ['500', () => ({ status: 500, json: { error: 'Serverns text.' } })],
  ['ett avvisat fetch', () => new Error('nätet nere')],
  ['200 där blob() avvisar', () => ({ status: 200 })]
]) {
  test(`(100) vid nedladdning: ${namn} rör inte räkningarnas fel i #month-error`, async (t) => {
    const { createObjectURL } = objektUrl();
    const { dom } = await starta(
      t,
      planInloggad(
        () => manadssvar([]),
        () => null,
        () => RAKNINGAR_500,
        () => SPARMAL_TOM,
        (anropet) => (anropet.url.endsWith('/csv') ? csvSvar() : rapportsvar(KORT_RAPPORT))
      ),
      FRYST_IDAG,
      { createObjectURL }
    );
    await flush();
    assert.equal(dom.falt('month-error').textContent, RAKNINGARNAS_FEL);
    assert.equal(dom.falt('report-error').textContent, '');
    assert.equal(dom.falt('report-card').hidden, false);

    assert.equal(dom.falt('report-download').utlos('click'), true);
    await flush();
    assert.equal(dom.falt('month-error').textContent, RAKNINGARNAS_FEL);
  });
}

test('(100) en pågående hämtning tömmer inte #report-error vid periodbyte', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      ikoordning([rapportsvar(LANG_RAPPORT), { status: 500, json: { error: 'Serverns text.' } }, null])
    )
  );
  dom.falt('report-period-6').utlos('click');
  await flush();
  assert.equal(dom.falt('report-error').textContent, 'Serverns text.');

  dom.falt('report-period-3').utlos('click');
  await flush();
  const hangande = anrop.at(-1);
  assert.equal(hangande.url, rapportvag(MANAD, 3));
  assert.equal(dom.falt('report-error').textContent, 'Serverns text.', 'texten försvann innan svaret kom');

  hangande.svara(rapportsvar(KORT_RAPPORT));
  await flush();
  assert.equal(dom.falt('report-error').textContent, '');
});

test('(100) en pågående hämtning tömmer inte #report-error vid nedladdning', async (t) => {
  const { createObjectURL } = objektUrl();
  const csvSvar = ikoordning([{ status: 500, json: { error: 'Serverns text.' } }, null]);
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([]),
      () => null,
      () => RAKNINGAR_TOM,
      () => SPARMAL_TOM,
      (anropet) => (anropet.url.endsWith('/csv') ? csvSvar() : rapportsvar(KORT_RAPPORT))
    ),
    FRYST_IDAG,
    { createObjectURL }
  );
  dom.falt('report-download').utlos('click');
  await flush();
  assert.equal(dom.falt('report-error').textContent, 'Serverns text.');

  dom.falt('report-download').utlos('click');
  await flush();
  const hangande = anrop.at(-1);
  assert.equal(hangande.url, `${rapportvag(MANAD, 12)}/csv`);
  assert.equal(dom.falt('report-error').textContent, 'Serverns text.', 'texten försvann innan svaret kom');

  hangande.svara({ status: 200, blob: new Blob(['csv']) });
  await flush();
  assert.equal(dom.falt('report-error').textContent, '');
});
