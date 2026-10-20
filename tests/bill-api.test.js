import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { REMIND_DAYS_DEFAULT, REMIND_DAYS_MAX } from '../src/core/bill.js';
import { NOT_LOGGED_IN_MESSAGE } from '../src/server/auth.js';
import { insertUser, prepare } from './helpers/sql.js';
import { addBill } from '../src/server/bills.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';

const NU = '2026-09-25T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const IDAG = '2026-09-25';

const UTKAST = Object.freeze({
  name: 'Elräkning',
  amountSek: '850,50',
  dueDate: '2026-10-15',
  interval: null,
  remindDays: 3
});

const FEL_DATUM = 'Dagens datum måste anges som ÅÅÅÅ-MM-DD.';
const FINNS_INTE = 'Räkningen finns inte.';

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-rakn-'));
  const tidigare = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = ':memory:';
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

async function userId(db, email) {
  return (await prepare(db, 'SELECT id FROM users WHERE email = ?').get(email)).id;
}

async function antalRakningar(db) {
  return (await prepare(db, 'SELECT COUNT(*) AS antal FROM bills').get()).antal;
}

test('(R10) POST /api/rakningar ger 201 med räkningen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { handled, res } = await call('POST', '/api/rakningar', { body: UTKAST, cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.body.bill.name, 'Elräkning');
  assert.equal(res.body.bill.amountOre, 85050);
  assert.equal(res.body.bill.dueDate, '2026-10-15');
  assert.equal(res.body.bill.interval, null);
  assert.equal(res.body.bill.remindDays, 3);
  assert.equal(res.body.bill.paidAt, null);
  assert.equal(typeof res.body.bill.id, 'string');
  assert.equal(await antalRakningar(db), 1);
});

test('(R10) GET /api/rakningar/<datum> ger 200 med listan', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mitt = await userId(db, EPOST);
  await addBill(mitt, { name: 'Hyra', amountOre: 1250000, dueDate: '2026-09-20', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hyra' });
  await addBill(mitt, { name: 'Bredband', amountOre: 39900, dueDate: '2026-09-27', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-bredband' });
  await addBill(mitt, { name: 'Tandläkare', amountOre: 95000, dueDate: '2026-11-01', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-tand' });

  const { handled, res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.bills.map((rad) => [rad.id, rad.daysUntil, rad.status]), [
    ['b-hyra', -5, 'forfallen'],
    ['b-bredband', 2, 'paminnelse'],
    ['b-tand', 37, 'kommande']
  ]);
  assert.deepEqual(Object.keys(res.body.bills[0]).sort(), [
    'amountOre', 'daysUntil', 'dueDate', 'id', 'interval', 'name', 'paidAt', 'remindDays', 'status'
  ]);
});

test('(R10) GET /api/rakningar/<datum> ger 200 med en tom lista utan räkningar', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body, { bills: [] });
});

test('(R10) PUT /api/rakningar/<id> ger 200 med den ändrade räkningen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const { handled, res } = await call('PUT', '/api/rakningar/b-el', {
    body: { ...UTKAST, name: 'Elnät', amountSek: '999', dueDate: '2026-10-20', interval: 'quarterly', remindDays: 10 },
    cookie
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.bill, {
    id: 'b-el',
    name: 'Elnät',
    amountOre: 99900,
    dueDate: '2026-10-20',
    interval: 'quarterly',
    remindDays: 10,
    paidAt: null
  });
});

test('(R10) POST /api/rakningar/<id>/betald ger 200 med räkningen efter flytten', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mitt = await userId(db, EPOST);
  await addBill(mitt, { name: 'El', amountOre: 85000, dueDate: '2026-09-30', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });
  await addBill(mitt, { name: 'Tandläkare', amountOre: 95000, dueDate: '2026-09-30', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-tand' });

  const flyttad = await call('POST', '/api/rakningar/b-el/betald', { body: { today: IDAG }, cookie });
  assert.equal(flyttad.handled, true);
  assert.equal(flyttad.res.statusCode, 200, flyttad.res.text);
  assert.equal(flyttad.res.body.bill.dueDate, '2026-10-30');
  assert.equal(flyttad.res.body.bill.paidAt, null);

  const betald = await call('POST', '/api/rakningar/b-tand/betald', { body: { today: IDAG }, cookie });
  assert.equal(betald.res.statusCode, 200, betald.res.text);
  assert.equal(betald.res.body.bill.dueDate, '2026-09-30');
  assert.equal(betald.res.body.bill.paidAt, NU);

  const { res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.deepEqual(res.body.bills.map((rad) => [rad.id, rad.dueDate, rad.status]), [
    ['b-tand', '2026-09-30', 'betald'],
    ['b-el', '2026-10-30', 'kommande']
  ]);
});

test('(R10) DELETE /api/rakningar/<id> ger 204 och sedan 404', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const första = await call('DELETE', '/api/rakningar/b-el', { cookie });
  assert.equal(första.handled, true);
  assert.equal(första.res.statusCode, 204);
  assert.equal(första.res.text, '');
  assert.equal(await antalRakningar(db), 0);

  const andra = await call('DELETE', '/api/rakningar/b-el', { cookie });
  assert.equal(andra.res.statusCode, 404);
  assert.deepEqual(andra.res.body, { error: FINNS_INTE });
});

test('(R10) alla fem vägarna ger 401 utan session, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  await insertUser(db, `u-${EPOST}`, EPOST, NU);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const vagar = [
    ['GET', `/api/rakningar/${IDAG}`, undefined],
    ['POST', '/api/rakningar', UTKAST],
    ['PUT', '/api/rakningar/b-el', UTKAST],
    ['POST', '/api/rakningar/b-el/betald', { today: IDAG }],
    ['DELETE', '/api/rakningar/b-el', undefined]
  ];
  for (const [method, pathname, body] of vagar) {
    const { handled, res } = await call(method, pathname, { body });
    assert.equal(handled, true, `${method} ${pathname}`);
    assert.equal(res.statusCode, 401, `${method} ${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE }, `${method} ${pathname}`);
  }
  assert.equal(await antalRakningar(db), 1);
  assert.equal((await prepare(db, 'SELECT paid_at FROM bills WHERE id = ?').get('b-el')).paid_at, null);
});

test('(R10) POST ger 400 med fieldErrors för de fem fälten, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', '/api/rakningar', {
    body: { name: '', amountSek: 'abc', dueDate: 'nej', interval: 'weekly', remindDays: 99 },
    cookie
  });
  assert.equal(res.statusCode, 400, res.text);
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), ['name', 'amountSek', 'dueDate', 'interval', 'remindDays']);
  assert.equal(res.body.error, res.body.fieldErrors[0].message);
  assert.equal(await antalRakningar(db), 0);
});

test('(R10) PUT ger 400 med fieldErrors och lämnar raden orörd', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const { res } = await call('PUT', '/api/rakningar/b-el', { body: { ...UTKAST, amountSek: '0' }, cookie });
  assert.equal(res.statusCode, 400, res.text);
  assert.deepEqual(res.body.fieldErrors, [{ field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }]);
  const rad = await prepare(db, 'SELECT name, amount_ore FROM bills WHERE id = ?').get('b-el');
  assert.equal(rad.name, 'El');
  assert.equal(rad.amount_ore, 85000);
});

test('(R10) PUT och betald ger 404 för ett id som inte finns', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const ändra = await call('PUT', '/api/rakningar/b-finns-inte', { body: UTKAST, cookie });
  assert.equal(ändra.res.statusCode, 404);
  assert.deepEqual(ändra.res.body, { error: FINNS_INTE });

  const betala = await call('POST', '/api/rakningar/b-finns-inte/betald', { body: { today: IDAG }, cookie });
  assert.equal(betala.res.statusCode, 404);
  assert.deepEqual(betala.res.body, { error: FINNS_INTE });
});

test('(R10) en kropp som inte går att tolka ger 400 på de tre vägar som har en', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  for (const [method, pathname] of [['POST', '/api/rakningar'], ['PUT', '/api/rakningar/b-el'], ['POST', '/api/rakningar/b-el/betald']]) {
    const res = new MockResponse();
    const { handleApiRequest } = await import('../src/server/api.js');
    await handleApiRequest(makeRequest(method, '{ inte json', { cookie }), res, pathname, NU);
    assert.equal(res.statusCode, 400, `${method} ${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' }, `${method} ${pathname}`);
  }
  assert.equal((await prepare(db, 'SELECT paid_at FROM bills WHERE id = ?').get('b-el')).paid_at, null);
});

test('(R10) en metod som inte stöds ger 405 på var och en av de tre adressformerna', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const [method, pathname] of [
    ['GET', '/api/rakningar'],
    ['DELETE', '/api/rakningar'],
    ['PUT', `/api/rakningar/${IDAG}/betald`],
    ['GET', '/api/rakningar/b-el/betald'],
    ['PATCH', '/api/rakningar/b-el']
  ]) {
    const { handled, res } = await call(method, pathname, { cookie });
    assert.equal(handled, true, `${method} ${pathname}`);
    assert.equal(res.statusCode, 405, `${method} ${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, `${method} ${pathname}`);
  }
});

test('(R10) en adress utan led är ingen räkningsväg utan Okänd adress', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/rakningar/', '/api/rakningar/b-el/betald/igen', '/api/rakningar//betald', '/api/rakningar/b-el/annat']) {
    const { handled, res } = await call('GET', pathname, { cookie });
    assert.equal(handled, true, pathname);
    assert.equal(res.statusCode, 404, `${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});

test('(R11) GET med fel datumformat ger 400, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  for (const datum of ['2026-10', '2026', '20261015', '2026-1-1', 'idag', '2026-13-01', '2026-02-30', '2026-00-10', '2026-10-32']) {
    const { handled, res } = await call('GET', `/api/rakningar/${datum}`, { cookie });
    assert.equal(handled, true, datum);
    assert.equal(res.statusCode, 400, `${datum}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, datum);
  }
  assert.equal(await antalRakningar(db), 1);
  assert.equal((await prepare(db, 'SELECT due_date FROM bills WHERE id = ?').get('b-el')).due_date, '2026-10-15');
});

test('(R11) betald med ett today som inte är ett datum ger 400, och lämnar raden obetald', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  await addBill(await userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  for (const today of [undefined, null, '', '2026-10', '2026-02-30', '2026-13-01', 42, true, {}, []]) {
    const { res } = await call('POST', '/api/rakningar/b-el/betald', { body: { today }, cookie });
    assert.equal(res.statusCode, 400, `${String(today)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, String(today));
  }
  for (const body of [null, 'abc', 42, [], true]) {
    const { res } = await call('POST', '/api/rakningar/b-el/betald', { body, cookie });
    assert.equal(res.statusCode, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM });
  }
  const rad = await prepare(db, 'SELECT due_date, paid_at FROM bills WHERE id = ?').get('b-el');
  assert.equal(rad.due_date, '2026-10-15');
  assert.equal(rad.paid_at, null);
});

test('(R11) datumspärren står efter sessionsspärren: utan session blir det 401, inte 400', async (t) => {
  const { db, call } = await apiDatabase(t);
  await insertUser(db, `u-${EPOST}`, EPOST, NU);

  const { res } = await call('GET', '/api/rakningar/inte-ett-datum');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

test('(R12) betald på någon annans räkning ger samma 404 som ett okänt id', async (t) => {
  const { db, call } = await apiDatabase(t);
  const minCookie = await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  await addBill(await userId(db, ANNAN_EPOST), { name: 'Hennes el', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hennes' });

  const hennes = await call('POST', '/api/rakningar/b-hennes/betald', { body: { today: IDAG }, cookie: minCookie });
  const okänt = await call('POST', '/api/rakningar/b-finns-inte/betald', { body: { today: IDAG }, cookie: minCookie });

  assert.equal(hennes.res.statusCode, 404);
  assert.equal(hennes.res.statusCode, okänt.res.statusCode);
  assert.equal(hennes.res.text, okänt.res.text);
  assert.deepEqual(hennes.res.body, { error: FINNS_INTE });

  const rad = await prepare(db, 'SELECT due_date, paid_at FROM bills WHERE id = ?').get('b-hennes');
  assert.equal(rad.due_date, '2026-10-15');
  assert.equal(rad.paid_at, null);
});

test('(R12) de tre övriga vägarna mot någon annans räkning svarar likadant', async (t) => {
  const { db, call } = await apiDatabase(t);
  const minCookie = await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  await addBill(await userId(db, ANNAN_EPOST), { name: 'Hennes el', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hennes' });

  for (const [method, body] of [['PUT', UTKAST], ['DELETE', undefined]]) {
    const hennes = await call(method, '/api/rakningar/b-hennes', { body, cookie: minCookie });
    const okänt = await call(method, '/api/rakningar/b-finns-inte', { body, cookie: minCookie });
    assert.equal(hennes.res.statusCode, 404, `${method}: ${hennes.res.text}`);
    assert.equal(hennes.res.text, okänt.res.text, method);
  }
  assert.equal((await prepare(db, 'SELECT name FROM bills WHERE id = ?').get('b-hennes')).name, 'Hennes el');

  const hennesCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: '111222' });
  const hennesLista = await call('GET', `/api/rakningar/${IDAG}`, { cookie: hennesCookie });
  assert.deepEqual(hennesLista.res.body.bills.map((rad) => rad.id), ['b-hennes']);
  const minLista = await call('GET', `/api/rakningar/${IDAG}`, { cookie: minCookie });
  assert.deepEqual(minLista.res.body.bills, []);
});


test('POST utan remindDays och utan interval ger förvalet och en engångsräkning', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', '/api/rakningar', {
    body: { name: 'Tandläkare', amountSek: '950', dueDate: '2026-10-15' },
    cookie
  });
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.body.bill.interval, null, 'tomt intervall betyder Engångs');
  assert.equal(res.body.bill.remindDays, REMIND_DAYS_DEFAULT);
  const högsta = await call('POST', '/api/rakningar', {
    body: { name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: String(REMIND_DAYS_MAX) },
    cookie
  });
  assert.equal(högsta.res.statusCode, 201, högsta.res.text);
  assert.equal(högsta.res.body.bill.remindDays, REMIND_DAYS_MAX);
});
