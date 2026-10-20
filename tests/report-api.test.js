import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { toCsv } from '../src/core/csv.js';
import { reportRows } from '../src/core/report.js';
import { reportCsvRows } from '../src/core/report-csv.js';
import { NOT_LOGGED_IN_MESSAGE } from '../src/server/auth.js';
import { insertUser, prepare } from './helpers/sql.js';
import { DATABASE_MESSAGES, MEMORY_PATH, closeDatabase, getDatabase, openDatabase, exec } from '../src/server/db.js';
import {
  OVERVIEW_MAX_MONTHS,
  OVERVIEW_MIN_MONTHS,
  addMonthItem,
  addTemplate,
  readMonth,
  readOverview,
  setBudget
} from '../src/server/months.js';
import { readReport } from '../src/server/reports.js';

const NU = '2026-10-08T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const SLUT = '2026-10';

const FEL_MANAD = 'Månaden måste anges som ÅÅÅÅ-MM.';
const OKAND_ADRESS = 'Okänd adress.';
const METOD = 'Metoden stöds inte.';
const FEL_ANTAL = `Antalet månader måste vara mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}.`;

class MockResponse {
  constructor() {
    this.statusCode = null;
    this.headers = null;
    this.chunks = [];
    this.ended = false;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers ?? null;
    return this;
  }

  end(chunk) {
    if (chunk !== undefined) {
      this.chunks.push(chunk);
    }
    this.ended = true;
  }

  get text() {
    return this.chunks.join('');
  }

  get body() {
    return JSON.parse(this.text);
  }

  get cookie() {
    return this.headers?.['Set-Cookie'] ?? null;
  }
}

function makeRequest(method, body, { cookie } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {};
  if (typeof cookie === 'string') {
    req.headers.cookie = cookie;
  }
  req.socket = { remoteAddress: IP };
  setImmediate(() => {
    if (typeof body === 'string') {
      req.emit('data', Buffer.from(body, 'utf8'));
    }
    req.emit('end');
  });
  return req;
}

async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-rapport-'));
  const tidigare = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = path.join(dir, 'hemochekonomi.sqlite');
  await closeDatabase();
  t.after(async () => {
    await closeDatabase();
    if (tidigare === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = tidigare;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  return {
    db: getDatabase(),
    async call(method, pathname, { body, cookie, now = NU } = {}) {
      const res = new MockResponse();
      const handled = await handleApiRequest(
        makeRequest(method, body === undefined ? undefined : JSON.stringify(body), { cookie }),
        res,
        pathname,
        now
      );
      return { handled, res };
    }
  };
}

const LOSENORD = 'ett-langt-losenord';

async function loggaIn(db, call, { email = EPOST } = {}) {
  let { res } = await call('POST', '/api/auth/registrera', { body: { email, password: LOSENORD } });
  if (res.statusCode === 409) {
    ({ res } = await call('POST', '/api/auth/logga-in', { body: { email, password: LOSENORD } }));
    assert.equal(res.statusCode, 204, res.text);
  } else {
    assert.equal(res.statusCode, 201, res.text);
  }
  return res.cookie;
}

async function loggaInSomPlus(db, call, options) {
  return await loggaIn(db, call, options);
}

async function userId(db, email) {
  return (await prepare(db, 'SELECT id FROM users WHERE email = ?').get(email)).id;
}

let nästaId = 0;
const nyttId = () => {
  nästaId += 1;
  return `id-${nästaId}`;
};

async function annasPoster(db, anna) {
  await addTemplate(anna, '2026-08', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing', interval: 'monthly', toMonth: null }, { db, now: NU, makeId: nyttId });
  await addMonthItem(anna, '2026-09', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NU, makeId: nyttId });
  await addMonthItem(anna, '2026-10', { kind: 'income', name: 'Lön', amountOre: 3000000, category: 'other' }, { db, now: NU, makeId: nyttId });
  await setBudget(anna, '2026-09', 'housing', 1200000, { db, now: NU, makeId: nyttId });
  await setBudget(anna, '2026-10', 'housing', 1250000, { db, now: NU, makeId: nyttId });
}

async function beritsPoster(db, berit) {
  await addMonthItem(berit, '2026-09', { kind: 'saving', name: 'Buffert', amountOre: 77700, category: 'loan' }, { db, now: NU, makeId: nyttId });
  await addMonthItem(berit, '2026-10', { kind: 'expense', name: 'Bil', amountOre: 333300, category: 'transport' }, { db, now: NU, makeId: nyttId });
  await setBudget(berit, '2026-10', 'housing', 100, { db, now: NU, makeId: nyttId });
}

const ANNAS_RAPPORT = Object.freeze({
  months: ['2026-08', '2026-09', '2026-10'],
  rows: [
    {
      kind: 'income',
      category: 'other',
      perMonthOre: [0, 0, 3000000],
      totalOre: 3000000,
      averageOre: 1000000,
      budgetPerMonthOre: [null, null, null],
      overBudgetMonths: 0
    },
    {
      kind: 'expense',
      category: 'housing',
      perMonthOre: [1250000, 1250000, 1250000],
      totalOre: 3750000,
      averageOre: 1250000,
      budgetPerMonthOre: [null, 1200000, 1250000],
      overBudgetMonths: 1
    },
    {
      kind: 'expense',
      category: 'other',
      perMonthOre: [0, 95000, 0],
      totalOre: 95000,
      averageOre: 31667,
      budgetPerMonthOre: [null, null, null],
      overBudgetMonths: 0
    }
  ],
  largest: { kind: 'expense', category: 'housing' }
});

async function kastar(fn, message, etikett) {
  await assert.rejects(fn, (error) => error instanceof RangeError && error.message === message, etikett);
}

const namn = (value) => (Array.isArray(value) ? `[${String(value)}]` : String(value));

const OGILTIGA_ANTAL = [0, -0, -1, 37, 1000, 1.5, 12.5, NaN, Infinity, -Infinity, '12', '', null, undefined, true, {}, [], [1], new Date(), 1n, Symbol('x')];

const OGILTIGA_MANADER = ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', ' 2026-10', '', null, undefined, 202610, -0, NaN, {}, [], ['2026-10'], new Date(), 1n, Symbol('x')];

test('taket exporteras ur months.js som 1 och 36', () => {
  assert.equal(OVERVIEW_MIN_MONTHS, 1);
  assert.equal(OVERVIEW_MAX_MONTHS, 36);
});

test('(RA35) textspärren mot taket i reports.js kräver bindningen, med kommentarerna bortrensade', async () => {
  const källa = await fs.readFile(new URL('../src/server/reports.js', import.meta.url), 'utf8');
  const kod = källa.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  const platt = kod.replace(/\s+/g, ' ');
  assert.equal(
    platt.includes('if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {'),
    true,
    'rad 2 i reports.js läser inte golvet och taket ur months.js'
  );
  assert.equal(
    platt.includes("import { OVERVIEW_MAX_MONTHS, OVERVIEW_MIN_MONTHS, readMonth } from './months.js';"),
    true,
    'golvet och taket importeras inte ur months.js'
  );
  assert.equal(/\b(const|let|var)\s+OVERVIEW_(MIN|MAX)_MONTHS\b/.test(kod), false, 'en lokal kopia av taket');
  assert.equal(/\b36\b/.test(kod), false, 'talet 36 står i reports.js');
});

test('rad 1: en slutmånad som inte är ÅÅÅÅ-MM ger rad 1:s text', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_MANADER) {
    await kastar(
      async () => await readReport('u-1', value, 3, { db }),
      `readReport kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".`,
      namn(value)
    );
  }
});

test('rad 1 vinner över rad 2 när båda är fel', async (t) => {
  const { db } = await apiDatabase(t);
  await kastar(async () => await readReport('u-1', '2026-13', 99, { db }), 'readReport kräver en månad på formen ÅÅÅÅ-MM, fick "2026-13".');
});

test('rad 2: ett antal som inte är ett heltal mellan 1 och 36 ger rad 2:s text', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_ANTAL) {
    await kastar(
      async () => await readReport('u-1', SLUT, value, { db }),
      `readReport kräver ett antal månader mellan 1 och 36, fick "${String(value)}".`,
      namn(value)
    );
  }
});

test('rad 2 godtar båda gränserna, 1 och 36', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual((await readReport('u-1', SLUT, 1, { db })).months, [SLUT]);
  const lång = (await readReport('u-1', SLUT, 36, { db })).months;
  assert.equal(lång.length, 36);
  assert.equal(lång[0], '2023-11');
  assert.equal(lång[35], SLUT);
});

test('(RA17) readReport med ett antal utanför taket ger samma meddelandeform som readOverview', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_ANTAL) {
    let översikten;
    try {
      await readOverview('u-1', SLUT, value, { db });
    } catch (error) {
      översikten = error.message;
    }
    assert.equal(typeof översikten, 'string', `readOverview godtog ${namn(value)}`);
    await kastar(async () => await readReport('u-1', SLUT, value, { db }), översikten.replace('readOverview', 'readReport'), namn(value));
  }
});

test('(RA17) readReport och readOverview godtar samma antal, gräns för gräns', async (t) => {
  const { db } = await apiDatabase(t);
  for (const count of [OVERVIEW_MIN_MONTHS, 2, 12, OVERVIEW_MAX_MONTHS]) {
    assert.equal((await readOverview('u-1', SLUT, count, { db })).months.length, count);
    assert.equal((await readReport('u-1', SLUT, count, { db })).months.length, count);
  }
});

test('readReport ger rapporten ur readMonth, äldst först, med taket per månad', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  const anna = await userId(db, EPOST);
  await annasPoster(db, anna);
  assert.deepEqual(await readReport(anna, SLUT, 3, { db }), ANNAS_RAPPORT);
});

test('readReport är reportRows över readMonth för varje månad, ingen egen räkning', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  const anna = await userId(db, EPOST);
  await annasPoster(db, anna);
  const månader = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const väntat = reportRows(await Promise.all(månader.map(async (month) => {
    const { items, budgets } = await readMonth(anna, month, { db });
    return { month, items, budgets };
  })));
  assert.deepEqual(await readReport(anna, SLUT, 6, { db }), väntat);
  assert.deepEqual(väntat.rows[1].perMonthOre, [0, 0, 0, 1250000, 1250000, 1250000]);
  assert.equal(väntat.rows[1].averageOre, 625000);
});

test('(RA37) readReport läser ur den databas den får, och aldrig ur getDatabase()', async (t) => {
  await apiDatabase(t);
  const minne = await openDatabase(MEMORY_PATH);
  t.after(() => minne.close());
  await prepare(minne, "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, '', '', ?)").run('u-anna', EPOST, NU);
  await annasPoster(minne, 'u-anna');
  assert.deepEqual(await readReport('u-anna', SLUT, 3, { db: minne }), ANNAS_RAPPORT);
});

test('readReport över ett årsskifte ger månaderna i stigande ordning', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual((await readReport('u-1', '2027-02', 4, { db })).months, ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('readReport för en användare utan poster ger en tom rapport, inget kast', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual(await readReport('ingen', SLUT, 3, { db }), { months: ['2026-08', '2026-09', '2026-10'], rows: [], largest: null });
});

const JSON_TYP = 'application/json; charset=utf-8';
const CSV_TYP = 'text/csv; charset=utf-8';

function vägar(month = SLUT, count = '3') {
  return [`/api/rapport/${month}/${count}`, `/api/rapport/${month}/${count}/csv`];
}

test('(RA18) 200 på båda vägarna för Plus', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  await annasPoster(db, await userId(db, EPOST));
  const [jsonväg, csvväg] = vägar();

  const json = await call('GET', jsonväg, { cookie });
  assert.equal(json.handled, true);
  assert.equal(json.res.statusCode, 200, json.res.text);
  assert.equal(json.res.headers['Content-Type'], JSON_TYP);
  assert.deepEqual(json.res.body, ANNAS_RAPPORT);

  const csv = await call('GET', csvväg, { cookie });
  assert.equal(csv.handled, true);
  assert.equal(csv.res.statusCode, 200, csv.res.text);
  assert.equal(csv.res.headers['Content-Type'], CSV_TYP);
  assert.equal(csv.res.text, toCsv(reportCsvRows(ANNAS_RAPPORT)));
});

test('(RA18) 400 med månadens text på båda vägarna för en månad som inte är ÅÅÅÅ-MM', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const month of ['2026-13', '2026-1', 'okt', '2026-10-01']) {
    for (const väg of vägar(month)) {
      const { res } = await call('GET', väg, { cookie });
      assert.equal(res.statusCode, 400, `${väg}: ${res.text}`);
      assert.equal(res.headers['Content-Type'], JSON_TYP, väg);
      assert.deepEqual(res.body, { error: FEL_MANAD }, väg);
    }
  }
});

test('(RA18) 400 med antalets text på båda vägarna för ett tal utanför taket', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const count of ['0', '37', '99', '123456789012345678901234567890']) {
    for (const väg of vägar(SLUT, count)) {
      const { res } = await call('GET', väg, { cookie });
      assert.equal(res.statusCode, 400, `${väg}: ${res.text}`);
      assert.equal(res.headers['Content-Type'], JSON_TYP, väg);
      assert.deepEqual(res.body, { error: FEL_ANTAL }, väg);
    }
  }
});

test('(RA18) antalets text nämner talen 1 och 36 och ingen funktion i datalagret', () => {
  assert.equal(FEL_ANTAL, 'Antalet månader måste vara mellan 1 och 36.');
});

test('(RA18) antalets text i api.js läser båda talen ur taket och skriver inga siffror', async () => {
  const källa = await fs.readFile(new URL('../src/server/api.js', import.meta.url), 'utf8');
  const rader = källa.split('\n').filter((rad) => /\binvalidReportCount\s*:/.test(rad));
  assert.equal(rader.length, 1, 'invalidReportCount ska stå på exakt en rad i api.js');
  assert.equal(rader[0].includes('OVERVIEW_MIN_MONTHS'), true, rader[0]);
  assert.equal(rader[0].includes('OVERVIEW_MAX_MONTHS'), true, rader[0]);
  assert.equal(/[0-9]/.test(rader[0]), false, rader[0]);
});

test('(RA18) månadsspärren står före antalet när båda är fel', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const väg of vägar('2026-13', '99')) {
    const { res } = await call('GET', väg, { cookie });
    assert.equal(res.statusCode, 400, väg);
    assert.deepEqual(res.body, { error: FEL_MANAD }, väg);
  }
});

test('(RA31) inledande nollor ger 404, 0 ger 400 och gränserna 1 och 36 ger 200', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const count of ['012', '0012', '00', '036', '01']) {
    for (const väg of vägar(SLUT, count)) {
      const { handled, res } = await call('GET', väg, { cookie });
      assert.equal(handled, true, väg);
      assert.equal(res.statusCode, 404, `${väg}: ${res.text}`);
      assert.deepEqual(res.body, { error: OKAND_ADRESS }, väg);
    }
  }
  for (const väg of vägar(SLUT, '0')) {
    const { res } = await call('GET', väg, { cookie });
    assert.equal(res.statusCode, 400, `${väg}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_ANTAL }, väg);
  }
  for (const [count, längd] of [['1', 1], ['36', 36]]) {
    for (const väg of vägar(SLUT, count)) {
      const { res } = await call('GET', väg, { cookie });
      assert.equal(res.statusCode, 200, `${väg}: ${res.text}`);
    }
    const { res } = await call('GET', vägar(SLUT, count)[0], { cookie });
    assert.equal(res.body.months.length, längd, count);
  }
});

test('(RA31) en sökväg med inledande nolla ger 404 före metodfrågan', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const väg of vägar(SLUT, '012')) {
    const { res } = await call('POST', väg, { cookie, body: {} });
    assert.equal(res.statusCode, 404, `${väg}: ${res.text}`);
    assert.deepEqual(res.body, { error: OKAND_ADRESS }, väg);
  }
});

test('(RA32) 200-kroppen på JSON-vägen har exakt tre nycklar och varje rad exakt sju', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  await annasPoster(db, await userId(db, EPOST));
  const { res } = await call('GET', vägar()[0], { cookie });
  assert.equal(res.statusCode, 200, res.text);
  const kropp = res.body;
  assert.deepEqual(Object.keys(kropp).sort(), ['largest', 'months', 'rows']);
  assert.equal(kropp.rows.length > 0, true, 'kroppen har inga rader att pröva');
  const radnycklar = ['averageOre', 'budgetPerMonthOre', 'category', 'kind', 'overBudgetMonths', 'perMonthOre', 'totalOre'];
  for (const rad of kropp.rows) {
    assert.deepEqual(Object.keys(rad).sort(), radnycklar, JSON.stringify(rad));
    assert.equal(rad.perMonthOre.length, kropp.months.length);
    assert.equal(rad.budgetPerMonthOre.length, kropp.months.length);
    for (const tal of [...rad.perMonthOre, rad.totalOre, rad.averageOre, rad.overBudgetMonths]) {
      assert.equal(Number.isSafeInteger(tal), true, `${String(tal)} i ${JSON.stringify(rad)}`);
    }
    for (const tak of rad.budgetPerMonthOre) {
      assert.equal(tak === null || Number.isSafeInteger(tak), true, `${String(tak)} i ${JSON.stringify(rad)}`);
    }
    assert.equal(rad.overBudgetMonths >= 0 && rad.overBudgetMonths <= kropp.months.length, true);
  }
  assert.deepEqual(Object.keys(kropp.largest).sort(), ['category', 'kind']);
});

test('(RA32) en tom rapport har samma tre nycklar, med largest null', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('GET', vägar()[0], { cookie });
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(Object.keys(res.body).sort(), ['largest', 'months', 'rows']);
  assert.equal(res.body.largest, null);
});


test('(RA18) 404 Okänd adress för ett N som inte är siffror och för en väg med fel form', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const adresser = [
    '/api/rapport/2026-10/abc',
    '/api/rapport/2026-10/abc/csv',
    '/api/rapport/2026-10/',
    '/api/rapport/2026-10//csv',
    '/api/rapport/2026-10/-3',
    '/api/rapport/2026-10/+3',
    '/api/rapport/2026-10/3.0',
    '/api/rapport/2026-10/%203',
    '/api/rapport/2026-10/%33',
    '/api/rapport/2026-10/ 3',
    '/api/rapport/2026-10/3 ',
    '/api/rapport/2026-10/1e1',
    '/api/rapport/2026-10/0x3',
    '/api/rapport/2026-10/3/CSV',
    '/api/rapport/2026-10/3/csv/',
    '/api/rapport/2026-10/3/json',
    '/api/rapport/2026-10/3/csv/extra',
    '/api/rapport/2026-10',
    '/api/rapport//3',
    '/api/rapport//3/csv',
    '/api/rapport/',
    '/api/rapport'
  ];
  for (const adress of adresser) {
    const { handled, res } = await call('GET', adress, { cookie });
    assert.equal(handled, true, adress);
    assert.equal(res.statusCode, 404, `${adress}: ${res.text}`);
    assert.equal(res.headers['Content-Type'], JSON_TYP, adress);
    assert.deepEqual(res.body, { error: OKAND_ADRESS }, adress);
  }
});

test('(RA18) 500 med datalagrets svenska text på båda vägarna när databasen inte går att läsa', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  await exec(db, 'DROP TABLE month_items');
  for (const väg of vägar()) {
    const { res } = await call('GET', väg, { cookie });
    assert.equal(res.statusCode, 500, `${väg}: ${res.text}`);
    assert.equal(res.headers['Content-Type'], JSON_TYP, väg);
    assert.deepEqual(res.body, { error: DATABASE_MESSAGES.readFailed }, väg);
  }
});

test('(RA33) varje metod utom GET ger 405 på båda vägarna', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const väg of vägar()) {
    for (const method of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const { handled, res } = await call(method, väg, { cookie, body: {} });
      assert.equal(handled, true, `${method} ${väg}`);
      assert.equal(res.statusCode, 405, `${method} ${väg}: ${res.text}`);
      if (method !== 'HEAD') {
        assert.deepEqual(res.body, { error: METOD }, `${method} ${väg}`);
      }
    }
  }
});

test('(RA33) 405 ges före sessionen', async (t) => {
  const { call } = await apiDatabase(t);
  for (const väg of vägar()) {
    for (const method of ['POST', 'PATCH', 'HEAD']) {
      const { res } = await call(method, väg);
      assert.equal(res.statusCode, 405, `${method} ${väg}: ${res.text}`);
    }
  }
});






test('(RA21) varje annat fel på CSV-vägen svarar också JSON, utan bilagehuvud', async (t) => {
  const { db, call } = await apiDatabase(t);
  const utan = await call('GET', vägar()[1]);
  const cookie = await loggaInSomPlus(db, call);
  const fel = [
    utan,
    await call('GET', vägar('2026-13')[1], { cookie }),
    await call('GET', vägar(SLUT, '99')[1], { cookie }),
    await call('GET', '/api/rapport/2026-10/abc/csv', { cookie }),
    await call('POST', vägar()[1], { cookie, body: {} })
  ];
  await exec(db, 'DROP TABLE month_items');
  fel.push(await call('GET', vägar()[1], { cookie }));
  assert.deepEqual(fel.map(({ res }) => res.statusCode), [401, 400, 400, 404, 405, 500]);
  for (const { res } of fel) {
    assert.equal(res.headers['Content-Type'], JSON_TYP, String(res.statusCode));
    assert.equal(Object.hasOwn(res.headers, 'Content-Disposition'), false, String(res.statusCode));
    assert.equal(typeof res.body.error, 'string', String(res.statusCode));
  }
});

test('(RA22) Content-Disposition är ordagrant attachment med ett filnamn i rent ASCII', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const month of [SLUT, '2027-01', '1999-12']) {
    const { res } = await call('GET', vägar(month)[1], { cookie });
    assert.equal(res.statusCode, 200, res.text);
    const huvud = res.headers['Content-Disposition'];
    assert.equal(huvud, `attachment; filename="hemochekonomi-${month}.csv"`);
    assert.equal(/^[ -~]+$/.test(huvud), true, huvud);
  }
});

test('(RA22) JSON-vägen har inget bilagehuvud', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('GET', vägar()[0], { cookie });
  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(res.headers, 'Content-Disposition'), false);
});

test('(RA23) readReport visar bara användarens egna poster och tak', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const anna = await userId(db, EPOST);
  const berit = await userId(db, ANNAN_EPOST);
  await annasPoster(db, anna);
  await beritsPoster(db, berit);

  assert.deepEqual(await readReport(anna, SLUT, 3, { db }), ANNAS_RAPPORT);
  assert.deepEqual((await readReport(berit, SLUT, 3, { db })).rows.map((r) => [r.kind, r.category, r.perMonthOre, r.budgetPerMonthOre]), [
    ['expense', 'housing', [0, 0, 0], [null, null, 100]],
    ['expense', 'transport', [0, 0, 333300], [null, null, null]],
    ['saving', 'loan', [0, 77700, 0], [null, null, null]]
  ]);
});

test('(RA23) båda API-vägarna visar bara den inloggades data', async (t) => {
  const { db, call } = await apiDatabase(t);
  const anna = await loggaInSomPlus(db, call);
  const berit = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  await annasPoster(db, await userId(db, EPOST));
  await beritsPoster(db, await userId(db, ANNAN_EPOST));

  const [jsonväg, csvväg] = vägar();
  assert.deepEqual((await call('GET', jsonväg, { cookie: anna })).res.body, ANNAS_RAPPORT);
  const annasFil = (await call('GET', csvväg, { cookie: anna })).res.text;
  assert.equal(annasFil, toCsv(reportCsvRows(ANNAS_RAPPORT)));
  for (const främmande of ['Transport', 'Lån', 'Sparande', '3333,00', '777,00', '1,00']) {
    assert.equal(annasFil.includes(främmande), false, främmande);
  }

  const beritsJson = (await call('GET', jsonväg, { cookie: berit })).res.body;
  assert.equal(beritsJson.rows.some((r) => r.category === 'other' || r.perMonthOre.includes(1250000)), false);
  const beritsFil = (await call('GET', csvväg, { cookie: berit })).res.text;
  for (const främmande of ['Inkomst', 'Övrigt', '12500,00', '950,00', '30000,00']) {
    assert.equal(beritsFil.includes(främmande), false, främmande);
  }
});
