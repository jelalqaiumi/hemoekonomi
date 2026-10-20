import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { NOT_LOGGED_IN_MESSAGE } from '../src/server/auth.js';
import { insertUser, prepare } from './helpers/sql.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';
import { addDeposit, addGoal } from '../src/server/goals.js';

const NU = '2026-10-08T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const IDAG = '2026-10-08';

const UTKAST = Object.freeze({
  name: 'Buffert',
  targetSek: '50000',
  targetDate: '2027-06-30'
});

const INSATTNING = Object.freeze({ amountSek: '2840,50', madeOn: '2026-10-01' });

const FEL_DATUM = 'Dagens datum måste anges som ÅÅÅÅ-MM-DD.';
const FINNS_INTE = 'Sparmålet finns inte.';

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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-sparmal-'));
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


async function antalMal(db) {
  return (await prepare(db, 'SELECT COUNT(*) AS antal FROM goals').get()).antal;
}

async function antalInsattningar(db) {
  return (await prepare(db, 'SELECT COUNT(*) AS antal FROM goal_deposits').get()).antal;
}

function allaVagar(goalId = 'g-1') {
  return [
    { method: 'GET', pathname: `/api/sparmal/${IDAG}` },
    { method: 'POST', pathname: '/api/sparmal', body: UTKAST },
    { method: 'PUT', pathname: `/api/sparmal/${goalId}`, body: UTKAST },
    { method: 'DELETE', pathname: `/api/sparmal/${goalId}` },
    { method: 'POST', pathname: `/api/sparmal/${goalId}/insattning`, body: INSATTNING }
  ];
}





test('(SM11) POST /api/sparmal ger 201 med sparmålet', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const { handled, res } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.equal(res.body.goal.name, 'Buffert');
  assert.equal(res.body.goal.targetOre, 5000000);
  assert.equal(res.body.goal.targetDate, '2027-06-30');
  assert.equal(typeof res.body.goal.id, 'string');
  assert.deepEqual(Object.keys(res.body.goal).sort(), ['id', 'name', 'targetDate', 'targetOre']);
  assert.equal(await antalMal(db), 1);
});

test('(SM11) POST /api/sparmal tar emot ett mål utan slutdatum', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('POST', '/api/sparmal', { cookie, body: { name: 'Resa', targetSek: '12000' } });
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.body.goal.targetDate, null);
  assert.equal(await antalMal(db), 1);
});

test('(SM11) POST /api/sparmal ger 400 med fieldErrors och skriver ingen rad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const { res } = await call('POST', '/api/sparmal', { cookie, body: { name: '', targetSek: 'abc', targetDate: '2026-02-30' } });
  assert.equal(res.statusCode, 400, res.text);
  assert.equal(res.body.error, 'Namnet får inte vara tomt.');
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), ['name', 'targetSek', 'targetDate']);
  assert.equal(await antalMal(db), 0, 'valideringen står före datalagret');

  const trasig = await call('POST', '/api/sparmal', { cookie, body: undefined });
  assert.equal(trasig.res.statusCode, 400, trasig.res.text);
  assert.equal(trasig.res.body.error, 'Kunde inte tolka anropet.');
  assert.equal(await antalMal(db), 0);
});

test('(SM11) GET /api/sparmal/<datum> ger 200 med listan och de tio fälten', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const mitt = await userId(db, EPOST);
  await addGoal(mitt, { name: 'Buffert', targetOre: 5000000, targetDate: '2027-06-30' }, { db, now: NU, makeId: () => 'g-buffert' });
  await addGoal(mitt, { name: 'Cykel', targetOre: 1000000, targetDate: '2026-09-30' }, { db, now: NU, makeId: () => 'g-cykel' });
  await addGoal(mitt, { name: 'Dator', targetOre: 2000000, targetDate: null }, { db, now: NU, makeId: () => 'g-dator' });
  await addDeposit(mitt, 'g-buffert', { amountOre: 3000000, madeOn: '2026-09-01' }, { db, now: NU, makeId: () => 'd-1' });
  await addDeposit(mitt, 'g-buffert', { amountOre: -160000, madeOn: '2026-10-01' }, { db, now: NU, makeId: () => 'd-2' });
  await addDeposit(mitt, 'g-cykel', { amountOre: 1000000, madeOn: '2026-09-05' }, { db, now: NU, makeId: () => 'd-3' });

  const { handled, res } = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.goals.map((mål) => [mål.id, mål.savedOre, mål.leftOre, mål.percent, mål.monthsLeft, mål.perMonthOre, mål.status]), [
    ['g-buffert', 2840000, 2160000, 56, 8, 270000, 'pagaende'],
    ['g-cykel', 1000000, 0, 100, 0, 0, 'klart'],
    ['g-dator', 0, 2000000, 0, null, null, 'pagaende']
  ]);
  assert.deepEqual(Object.keys(res.body.goals[0]).sort(), [
    'id', 'leftOre', 'monthsLeft', 'name', 'perMonthOre', 'percent', 'savedOre', 'status', 'targetDate', 'targetOre'
  ]);
});

test('(SM11) GET /api/sparmal/<datum> ger 200 med en tom lista utan sparmål', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body, { goals: [] });
});

test('(SM11) GET /api/sparmal/<datum> ger 400 för ett led som inte är ett datum', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const led of ['imorgon', '2026-10', '2026-02-30', '2026-13-01', '20261008']) {
    const { res } = await call('GET', `/api/sparmal/${led}`, { cookie });
    assert.equal(res.statusCode, 400, `${led}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, led);
  }
});

test('(SM11) PUT /api/sparmal/<id> ger 200, och 404 för ett okänt eller någon annans id', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;

  const ändrat = await call('PUT', `/api/sparmal/${goalId}`, { cookie, body: { name: 'Ny buffert', targetSek: '70000', targetDate: null } });
  assert.equal(ändrat.res.statusCode, 200, ändrat.res.text);
  assert.deepEqual(ändrat.res.body.goal, { id: goalId, name: 'Ny buffert', targetOre: 7000000, targetDate: null });

  const okänt = await call('PUT', '/api/sparmal/g-finns-inte', { cookie, body: UTKAST });
  assert.equal(okänt.res.statusCode, 404, okänt.res.text);
  assert.deepEqual(okänt.res.body, { error: FINNS_INTE });

  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: { ...UTKAST, name: 'Hennes mål' } });
  assert.equal(hennes.res.statusCode, 201, hennes.res.text);
  const stöld = await call('PUT', `/api/sparmal/${hennes.res.body.goal.id}`, { cookie, body: { ...UTKAST, name: 'Stulet' } });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.deepEqual(stöld.res.body, { error: FINNS_INTE });
  assert.equal((await prepare(db, 'SELECT name FROM goals WHERE id = ?').get(hennes.res.body.goal.id)).name, 'Hennes mål');

  const trasigt = await call('PUT', '/api/sparmal/g-finns-inte', { cookie, body: { name: '', targetSek: 'abc' } });
  assert.equal(trasigt.res.statusCode, 400, trasigt.res.text);
  assert.equal(trasigt.res.body.fieldErrors.length, 2);
});

test('(SM11) DELETE /api/sparmal/<id> ger 204, och 404 för ett okänt eller någon annans id', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;
  await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: INSATTNING });
  assert.equal(await antalInsattningar(db), 1);

  const borttaget = await call('DELETE', `/api/sparmal/${goalId}`, { cookie });
  assert.equal(borttaget.res.statusCode, 204, borttaget.res.text);
  assert.equal(borttaget.res.text, '', '204 har ingen kropp');
  assert.equal(await antalMal(db), 0);
  assert.equal(await antalInsattningar(db), 0, 'ON DELETE CASCADE tog insättningen');

  const igen = await call('DELETE', `/api/sparmal/${goalId}`, { cookie });
  assert.equal(igen.res.statusCode, 404, igen.res.text);
  assert.deepEqual(igen.res.body, { error: FINNS_INTE });

  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: UTKAST });
  const stöld = await call('DELETE', `/api/sparmal/${hennes.res.body.goal.id}`, { cookie });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.equal(await antalMal(db), 1, 'hennes mål finns kvar');
});

test('(SM11) POST /api/sparmal/<id>/insattning ger 201, också för ett uttag', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;

  const insatt = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: INSATTNING });
  assert.equal(insatt.res.statusCode, 201, insatt.res.text);
  assert.equal(insatt.res.body.deposit.goalId, goalId);
  assert.equal(insatt.res.body.deposit.amountOre, 284050);
  assert.equal(insatt.res.body.deposit.madeOn, '2026-10-01');
  assert.equal(typeof insatt.res.body.deposit.id, 'string');

  const uttag = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: { amountSek: '-500', madeOn: '2026-10-05' } });
  assert.equal(uttag.res.statusCode, 201, uttag.res.text);
  assert.equal(uttag.res.body.deposit.amountOre, -50000);

  const läst = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(läst.res.body.goals[0].savedOre, 234050);
});

test('(SM11) POST /api/sparmal/<id>/insattning ger 400 för noll och för ett datum som inte finns', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;

  const noll = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: { amountSek: '0', madeOn: '2026-10-01' } });
  assert.equal(noll.res.statusCode, 400, noll.res.text);
  assert.equal(noll.res.body.error, 'Beloppet får inte vara 0 kr. Skriv ett minustecken framför för ett uttag.');
  assert.deepEqual(noll.res.body.fieldErrors.map((fel) => fel.field), ['amountSek']);

  const datum = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: { amountSek: '100', madeOn: '2026-02-30' } });
  assert.equal(datum.res.statusCode, 400, datum.res.text);
  assert.deepEqual(datum.res.body.fieldErrors, [{ field: 'madeOn', message: 'Datum måste anges som ÅÅÅÅ-MM-DD.' }]);

  assert.equal(await antalInsattningar(db), 0);
});

test('(SM11) POST /api/sparmal/<id>/insattning ger 404 för ett okänt eller någon annans mål', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const okänt = await call('POST', '/api/sparmal/g-finns-inte/insattning', { cookie, body: INSATTNING });
  assert.equal(okänt.res.statusCode, 404, okänt.res.text);
  assert.deepEqual(okänt.res.body, { error: FINNS_INTE });

  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: UTKAST });
  const stöld = await call('POST', `/api/sparmal/${hennes.res.body.goal.id}/insattning`, { cookie, body: INSATTNING });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.equal(await antalInsattningar(db), 0);
  const hennesLista = await call('GET', `/api/sparmal/${IDAG}`, { cookie: annanCookie });
  assert.equal(hennesLista.res.body.goals[0].savedOre, 0, 'hennes savedOre är oförändrad');
});

test('(SM11) en metod som inte stöds ger 405 på var och en av sparmålens tre adresser', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;

  for (const [method, pathname] of [
    ['GET', '/api/sparmal'],
    ['DELETE', '/api/sparmal'],
    ['POST', `/api/sparmal/${goalId}`],
    ['GET', `/api/sparmal/${goalId}/insattning`],
    ['DELETE', `/api/sparmal/${goalId}/insattning`]
  ]) {
    const { handled, res } = await call(method, pathname, { cookie });
    assert.equal(handled, true, `${method} ${pathname}`);
    assert.equal(res.statusCode, 405, `${method} ${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' });
  }

  const tomt = await call('GET', '/api/sparmal/', { cookie });
  assert.equal(tomt.res.statusCode, 404, tomt.res.text);
  assert.deepEqual(tomt.res.body, { error: 'Okänd adress.' });
  const tre = await call('POST', `/api/sparmal/${goalId}/insattning/extra`, { cookie, body: INSATTNING });
  assert.equal(tre.res.statusCode, 404, tre.res.text);
});

