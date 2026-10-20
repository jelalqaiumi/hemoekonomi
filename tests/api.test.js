import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';

import { AUTH_MESSAGES, NOT_LOGGED_IN_MESSAGE, SESSION_COOKIE_NAME } from '../src/server/auth.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';
import { addMonthItem } from '../src/server/months.js';
import { prepare } from './helpers/sql.js';

const NU = '2026-10-17T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const LOSENORD = 'ett långt lösenord';
const OKAND = 'Okänd adress.';
const METOD = 'Metoden stöds inte.';
const OTOLKBART = 'Kunde inte tolka anropet.';

class MockResponse {
  constructor() {
    this.statusCode = null;
    this.headers = null;
    this.chunks = [];
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
  }

  get text() {
    return this.chunks.join('');
  }

  get body() {
    return JSON.parse(this.text);
  }

  get cookie() {
    const header = this.headers?.['Set-Cookie'];
    return typeof header === 'string' ? header.split(';')[0] : null;
  }
}

function makeRequest(method, body, { cookie, host } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {};
  if (typeof cookie === 'string') {
    req.headers.cookie = cookie;
  }
  if (typeof host === 'string') {
    req.headers.host = host;
  }
  req.socket = { remoteAddress: IP };
  setImmediate(() => {
    if (body !== undefined) {
      req.emit('data', Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8'));
    }
    req.emit('end');
  });
  return req;
}

async function riggning(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const tidigare = { db: process.env.HEMOCHEKONOMI_DB_FILE, app: process.env.APP_URL };
  process.env.HEMOCHEKONOMI_DB_FILE = ':memory:';
  delete process.env.APP_URL;
  await closeDatabase();
  t.after(async () => {
    await closeDatabase();
    for (const [key, name] of [['db', 'HEMOCHEKONOMI_DB_FILE'], ['app', 'APP_URL']]) {
      if (tidigare[key] === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = tidigare[key];
      }
    }
  });
  return {
    db: getDatabase(),
    async call(method, pathname, { body, cookie, host } = {}) {
      const res = new MockResponse();
      const handled = await handleApiRequest(makeRequest(method, body, { cookie, host }), res, pathname, NU);
      return { handled, res };
    }
  };
}

async function registrera(call, email = EPOST) {
  const { res } = await call('POST', '/api/auth/registrera', { body: { email, password: LOSENORD } });
  assert.equal(res.statusCode, 201, res.text);
  return res.cookie;
}

async function medLoggad(fn) {
  const rader = [];
  const original = console.log;
  console.log = (...args) => rader.push(args.join(' '));
  try {
    await fn();
  } finally {
    console.log = original;
  }
  return rader;
}

test('POST /api/auth/registrera ger 201, en sessionscookie och GET /api/mig svarar med adressen', async (t) => {
  const { call } = await riggning(t);
  const { res } = await call('POST', '/api/auth/registrera', { body: { email: ' Anna@Example.se', password: LOSENORD } });
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.body, { ok: true });
  assert.match(res.headers['Set-Cookie'], new RegExp(`^${SESSION_COOKIE_NAME}=[A-Za-z0-9_-]{43}; HttpOnly; Path=/; SameSite=Lax`));
  const mig = await call('GET', '/api/mig', { cookie: res.cookie });
  assert.equal(mig.res.statusCode, 200);
  assert.deepEqual(mig.res.body, { email: EPOST });
});

test('registrera: fältfel för adress och lösenord, och 409 för en adress som redan har konto', async (t) => {
  const { call } = await riggning(t);
  let { res } = await call('POST', '/api/auth/registrera', { body: { email: 'x', password: LOSENORD } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: AUTH_MESSAGES.invalidEmail, fieldErrors: [{ field: 'email', message: AUTH_MESSAGES.invalidEmail }] });
  ({ res } = await call('POST', '/api/auth/registrera', { body: { email: EPOST, password: 'kort' } }));
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors, [{ field: 'password', message: AUTH_MESSAGES.passwordTooShort }]);
  await registrera(call);
  ({ res } = await call('POST', '/api/auth/registrera', { body: { email: EPOST, password: LOSENORD } }));
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.error, AUTH_MESSAGES.emailTaken);
});

test('kontots vägar ger 400 för en kropp som inte är JSON eller inte är ett objekt', async (t) => {
  const { call } = await riggning(t);
  for (const väg of ['/api/auth/registrera', '/api/auth/logga-in', '/api/auth/glomt-losenord', '/api/auth/nytt-losenord']) {
    for (const body of ['{trasig', 'null', '"text"', '42']) {
      const { res } = await call('POST', väg, { body });
      assert.equal(res.statusCode, 400, `${väg} ${body}`);
      assert.deepEqual(res.body, { error: OTOLKBART }, `${väg} ${body}`);
    }
  }
});

test('POST /api/auth/logga-in: 204 med cookie, 401 vid fel lösenord', async (t) => {
  const { call } = await riggning(t);
  await registrera(call);
  let { res } = await call('POST', '/api/auth/logga-in', { body: { email: EPOST, password: 'fel lösenord här' } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: AUTH_MESSAGES.wrongCredentials });
  ({ res } = await call('POST', '/api/auth/logga-in', { body: { email: EPOST, password: LOSENORD } }));
  assert.equal(res.statusCode, 204);
  assert.equal(res.text, '');
  assert.notEqual(res.cookie, null);
  assert.equal((await call('GET', '/api/mig', { cookie: res.cookie })).res.statusCode, 200);
});

test('POST /api/auth/logga-ut återkallar sessionen och tömmer cookien', async (t) => {
  const { call } = await riggning(t);
  const cookie = await registrera(call);
  const { res } = await call('POST', '/api/auth/logga-ut', { cookie });
  assert.equal(res.statusCode, 204);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  const mig = await call('GET', '/api/mig', { cookie });
  assert.equal(mig.res.statusCode, 401);
  assert.deepEqual(mig.res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

test('glömt lösenord och nytt lösenord hela vägen, med länken till appens adress', async (t) => {
  const { call } = await riggning(t);
  const gammal = await registrera(call);
  let svar;
  const rader = await medLoggad(async () => {
    svar = await call('POST', '/api/auth/glomt-losenord', { body: { email: EPOST }, host: '127.0.0.1:3000' });
  });
  assert.equal(svar.res.statusCode, 202);
  const rad = rader.find((r) => r.startsWith(`Länk för nytt lösenord till ${EPOST}: `));
  assert.ok(rad, rader.join('\n'));
  const länk = new URL(rad.split(': ')[1]);
  assert.equal(länk.origin, 'http://127.0.0.1:3000');
  assert.equal(länk.pathname, '/app');
  const token = länk.searchParams.get('aterstall');

  const nytt = 'ett nytt långt lösenord';
  const { res } = await call('POST', '/api/auth/nytt-losenord', { body: { token, password: nytt } });
  assert.equal(res.statusCode, 204);
  assert.equal((await call('GET', '/api/mig', { cookie: res.cookie })).res.statusCode, 200);
  assert.equal((await call('GET', '/api/mig', { cookie: gammal })).res.statusCode, 401);

  const igen = await call('POST', '/api/auth/nytt-losenord', { body: { token, password: nytt } });
  assert.equal(igen.res.statusCode, 400);
  assert.deepEqual(igen.res.body, { error: AUTH_MESSAGES.invalidResetLink, fieldErrors: [{ field: 'token', message: AUTH_MESSAGES.invalidResetLink }] });
});

test('glömt lösenord svarar 202 för en adress utan konto och skriver ingen länk', async (t) => {
  const { call } = await riggning(t);
  let svar;
  const rader = await medLoggad(async () => {
    svar = await call('POST', '/api/auth/glomt-losenord', { body: { email: 'ingen@example.se' } });
  });
  assert.equal(svar.res.statusCode, 202);
  assert.equal(rader.some((r) => r.includes('Länk för nytt lösenord')), false);
});

test('i drift används APP_URL och aldrig anropets Host, och utan APP_URL blir det 500', async (t) => {
  const { call } = await riggning(t);
  await registrera(call);
  const tidigare = process.env.NODE_ENV;
  t.after(() => {
    if (tidigare === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = tidigare;
    }
  });
  process.env.NODE_ENV = 'production';
  const utan = await call('POST', '/api/auth/glomt-losenord', { body: { email: EPOST }, host: 'ond.example' });
  assert.equal(utan.res.statusCode, 500);
  assert.equal(utan.res.body.error.includes('APP_URL'), true);

  process.env.APP_URL = 'https://hemochekonomi.se/';
  const tidigareNyckel = process.env.RESEND_API_KEY;
  delete process.env.RESEND_API_KEY;
  t.after(() => {
    if (tidigareNyckel !== undefined) {
      process.env.RESEND_API_KEY = tidigareNyckel;
    }
  });
  const med = await call('POST', '/api/auth/glomt-losenord', { body: { email: EPOST }, host: 'ond.example' });
  assert.equal(med.res.statusCode, 502);
  assert.deepEqual(med.res.body, { error: AUTH_MESSAGES.resetSendFailed });
});

test('GET /api/mig/export ger alla användarens uppgifter som en fil, utan lösenord eller token', async (t) => {
  const { db, call } = await riggning(t);
  const cookie = await registrera(call);
  const annans = await registrera(call, 'berit@example.se');
  const anna = (await prepare(db, 'SELECT id FROM users WHERE email = ?').get(EPOST)).id;
  const berit = (await prepare(db, 'SELECT id FROM users WHERE email = ?').get('berit@example.se')).id;
  await addMonthItem(anna, '2026-10', { kind: 'expense', name: 'Mat', amountOre: 320000, category: 'food' }, { db, now: NU });
  await addMonthItem(berit, '2026-10', { kind: 'expense', name: 'Hemligt', amountOre: 1, category: 'other' }, { db, now: NU });

  const { res } = await call('GET', '/api/mig/export', { cookie });
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="hem-och-ekonomi.json"');
  const data = res.body;
  assert.equal(data.email, EPOST);
  assert.deepEqual(data.month_items.map((r) => [r.name, r.amount_ore]), [['Mat', 320000]]);
  for (const nyckel of ['templates', 'overrides', 'budgets', 'bills', 'goals', 'goal_deposits']) {
    assert.deepEqual(data[nyckel], [], nyckel);
  }
  assert.equal(/password|token|salt|hash/i.test(res.text), false, res.text);
  assert.equal(res.text.includes('Hemligt'), false);
  assert.equal((await call('GET', '/api/mig/export')).res.statusCode, 401);
  void annans;
});

test('DELETE /api/mig kräver lösenordet och tar sedan bort kontot', async (t) => {
  const { db, call } = await riggning(t);
  const cookie = await registrera(call);
  let { res } = await call('DELETE', '/api/mig', { cookie, body: { password: 'fel lösenord här' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: AUTH_MESSAGES.wrongPassword });
  ({ res } = await call('DELETE', '/api/mig', { cookie, body: { password: LOSENORD } }));
  assert.equal(res.statusCode, 204);
  assert.match(res.headers['Set-Cookie'], /Max-Age=0/);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM users').get()).antal, 0);
  assert.equal((await call('GET', '/api/mig', { cookie })).res.statusCode, 401);
  assert.equal((await call('DELETE', '/api/mig', { body: { password: LOSENORD } })).res.statusCode, 401);
});

test('kontots vägar ger 405 för fel metod, och de borttagna vägarna finns inte', async (t) => {
  const { call } = await riggning(t);
  for (const [method, väg] of [
    ['GET', '/api/auth/registrera'], ['GET', '/api/auth/logga-in'], ['GET', '/api/auth/logga-ut'],
    ['GET', '/api/auth/glomt-losenord'], ['GET', '/api/auth/nytt-losenord'], ['POST', '/api/mig'],
    ['PUT', '/api/mig'], ['POST', '/api/mig/export']
  ]) {
    const { res } = await call(method, väg);
    assert.equal(res.statusCode, 405, `${method} ${väg}`);
    assert.deepEqual(res.body, { error: METOD }, `${method} ${väg}`);
  }
  for (const väg of ['/api/auth/kod', '/api/plan', '/api/entries', '/api/entries/x']) {
    const { res } = await call('GET', väg);
    assert.equal(res.statusCode, 404, väg);
    assert.deepEqual(res.body, { error: OKAND }, väg);
  }
});

test('en sökväg utanför /api hanteras inte', async (t) => {
  const { call } = await riggning(t);
  assert.equal((await call('GET', '/app')).handled, false);
  assert.equal((await call('GET', '/apix')).handled, false);
});
