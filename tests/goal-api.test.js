// Sparmålens fem API-vägar [steg 4]. Kravlistan (S11), (S12) och — det här stegets
// huvudsak — (P8) och (P9) i ARKITEKTUR.md.
//
// (P8) och (P9) stod i kravlistan för steg 1 och lämnades som obyggbara då:
// 403-grenen i requireFeature hade ingen nåbar indata, eftersom varje skyddad väg
// då låg i alla tre planerna. Sparmål är den första funktionen Bas saknar
// (PLANS.plus i src/core/plans.js), så grenen får sin första nåbara indata här och
// de två punkterna byggs i den här filen.
//
// Testar handleApiRequest direkt, utan att starta en server, med en riktig databas
// i en fil per testfall — samma rigg som tests/bill-api.test.js.
//
// Ordningen i vägarna är bindande och har ett testfall var: sessionsspärren,
// behörigheten, datumspärren, valideringen, sedan datalagret. Varje fall som ger
// 400 eller 403 kontrollerar dessutom att ingen rad nådde databasen.
//
// Ingen tid och inget datum läses ur klockan: now skickas in i varje anrop, och
// varje dagens datum står som en literal.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { PLANS, PLAN_LABELS, hasFeature } from '../src/core/plans.js';
import { NOT_LOGGED_IN_MESSAGE, requestCode } from '../src/server/auth.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';
import { addDeposit, addGoal } from '../src/server/goals.js';

const NU = '2026-10-08T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const IDAG = '2026-10-08';

// Kroppen i POST och PUT: tre fält, och målbeloppet i kronor. Svaret bär ören.
const UTKAST = Object.freeze({
  name: 'Buffert',
  targetSek: '50000',
  targetDate: '2027-06-30'
});

// Kroppen i POST .../insattning.
const INSATTNING = Object.freeze({ amountSek: '2840,50', madeOn: '2026-10-01' });

// Texterna ur tabellerna i ARKITEKTUR.md, skrivna en gång här.
const FEL_DATUM = 'Dagens datum måste anges som ÅÅÅÅ-MM-DD.';
const FINNS_INTE = 'Sparmålet finns inte.';
// 403-texten sätts samman av requireFeature ur PLAN_LABELS. Den skrivs inte av som
// en literal: planens svenska namn har en ägare, och en kopia hade kunnat glida.
const LÅST = `Funktionen ingår i ${PLAN_LABELS.plus}. Uppgradera för att låsa upp.`;

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

// setImmediate och inte queueMicrotask, av samma skäl som i tests/api.test.js:
// lyssnarna i readBody sätts upp under den synkrona delen av handleApiRequest.
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

// api.js hämtar sin anslutning med getDatabase(), som läser HEMOCHEKONOMI_DB_FILE.
// En fil per testfall, och den delade anslutningen stängs både före och efter —
// samma rigg som tests/bill-api.test.js.
async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-sparmal-'));
  const tidigare = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = path.join(dir, 'hemochekonomi.sqlite');
  closeDatabase();
  t.after(async () => {
    closeDatabase();
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

async function loggaIn(db, call, { email = EPOST, kod = KOD } = {}) {
  await requestCode(db, { email, ip: IP, now: NU, makeCode: () => kod });
  const { res } = await call('POST', '/api/auth/logga-in', { body: { email, code: kod } });
  assert.equal(res.statusCode, 204, res.text);
  return res.cookie;
}

// Loggar in och höjer planen till Plus genom PUT /api/plan — appens egen väg, inte
// en UPDATE för hand. Nya konton får 'bas' av kolumnens DEFAULT, så varje testfall
// som ska nå en sparmålsväg måste gå genom den här.
async function loggaInSomPlus(db, call, options) {
  const cookie = await loggaIn(db, call, options);
  const { res } = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(res.statusCode, 200, res.text);
  assert.equal(res.body.plan, 'plus');
  return cookie;
}

function userId(db, email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
}

function plan(db, email) {
  return db.prepare('SELECT plan FROM users WHERE email = ?').get(email).plan;
}

function antalMal(db) {
  return db.prepare('SELECT COUNT(*) AS antal FROM goals').get().antal;
}

function antalInsattningar(db) {
  return db.prepare('SELECT COUNT(*) AS antal FROM goal_deposits').get().antal;
}

// De fem vägarna som data, så att de behörighetsfall som gäller ALLA fem kan köra
// en loop i stället för fem handskrivna anrop. En upprepad kontroll är en som
// glöms på en väg, och detsamma gäller ett upprepat testfall.
function allaVagar(goalId = 'g-1') {
  return [
    { method: 'GET', pathname: `/api/sparmal/${IDAG}` },
    { method: 'POST', pathname: '/api/sparmal', body: UTKAST },
    { method: 'PUT', pathname: `/api/sparmal/${goalId}`, body: UTKAST },
    { method: 'DELETE', pathname: `/api/sparmal/${goalId}` },
    { method: 'POST', pathname: `/api/sparmal/${goalId}/insattning`, body: INSATTNING }
  ];
}

// ---------------------------------------------------------------------------
// (P8) En Bas-användare får 403 på en sparmålsväg, med feature och requiredPlan i
// svaret. Första gången 403-grenen i requireFeature har en nåbar indata.
// ---------------------------------------------------------------------------

test('(P8) Bas får 403 på varje sparmålsväg, med feature och requiredPlan i svaret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  // Förutsättningen, utskriven: kontot har planen bas, och bas saknar
  // savingsGoals. Utan de två raderna prövar fallet nedan inte behörigheten — ett
  // 403 kunde komma av att planen råkade vara något annat.
  assert.equal(plan(db, EPOST), 'bas', 'ett nytt konto har planen bas');
  assert.equal(hasFeature('bas', 'savingsGoals'), false, 'bas saknar savingsGoals');
  assert.equal(PLANS.plus.features.includes('savingsGoals'), true, 'savingsGoals står i Plus');

  // Ett mål som finns, skapat utanför API:t: utan det kunde ett 404 från PUT,
  // DELETE och insättningsvägen dölja att behörigheten prövas före datalagret.
  addGoal(userId(db, EPOST), { name: 'Buffert', targetOre: 5000000, targetDate: '2027-06-30' }, { db, now: NU, makeId: () => 'g-1' });

  for (const väg of allaVagar()) {
    const { handled, res } = await call(väg.method, väg.pathname, { cookie, body: väg.body });
    assert.equal(handled, true, `${väg.method} ${väg.pathname}`);
    assert.equal(res.statusCode, 403, `${väg.method} ${väg.pathname}: ${res.text}`);
    // De tre fälten ARKITEKTUR.md kräver i kroppen: texten, funktionsnyckeln och
    // den plan som behövs. Gränssnittet ska kunna visa rätt låsruta utan att gissa
    // ur strängen.
    assert.deepEqual(res.body, { error: LÅST, feature: 'savingsGoals', requiredPlan: 'plus' }, `${väg.method} ${väg.pathname}`);
  }

  // Ingen rad nådde databasen: behörigheten står före datalagret i kedjan.
  assert.equal(antalMal(db), 1, 'bara målet som skapades utanför API:t');
  assert.equal(antalInsattningar(db), 0);
});

test('(P8) en utan session får 401 och inte 403, också på en Plus-väg', async (t) => {
  const { db, call } = await apiDatabase(t);
  // Sessionsspärren står före behörigheten. En utan session ska få 401 — annars
  // avslöjar svaret vilka funktioner som finns för den som inte är inloggad.
  for (const väg of allaVagar()) {
    const { res } = await call(väg.method, väg.pathname, { body: väg.body });
    assert.equal(res.statusCode, 401, `${väg.method} ${väg.pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
  }
  assert.equal(antalMal(db), 0);
});

// ---------------------------------------------------------------------------
// (P9) Plus får 200 på samma väg. Utan det här fallet kunde (P8) passera med ett
// 403 som gavs åt alla.
// ---------------------------------------------------------------------------

test('(P9) Plus får 200 på samma sparmålsväg där Bas fick 403', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  // Först som Bas: 403.
  const basSvar = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(basSvar.res.statusCode, 403, basSvar.res.text);
  assert.equal(basSvar.res.body.requiredPlan, 'plus');

  // Samma kaka, samma väg, samma dagens datum — bara planen ändras.
  const { res: planSvar } = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(planSvar.statusCode, 200, planSvar.text);
  assert.equal(plan(db, EPOST), 'plus');

  const plusSvar = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(plusSvar.res.statusCode, 200, plusSvar.res.text);
  assert.deepEqual(plusSvar.res.body, { goals: [] });

  // Och Premium, som ärver Plus funktioner genom hasFeature: arvet ska gälla också
  // över HTTP och inte bara i kärnan.
  const { res: premiumSvar } = await call('PUT', '/api/plan', { cookie, body: { plan: 'premium' } });
  assert.equal(premiumSvar.statusCode, 200, premiumSvar.text);
  const premium = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(premium.res.statusCode, 200, premium.res.text);

  // Och tillbaka ned till Bas: 403 igen. Spärren läser planen ur sessionen vid
  // varje anrop och inte en gång vid inloggningen.
  await call('PUT', '/api/plan', { cookie, body: { plan: 'bas' } });
  const nedgraderad = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(nedgraderad.res.statusCode, 403, nedgraderad.res.text);
});

test('(P9) Plus får svar på alla fem vägarna, inte bara på läsvägen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  // POST: 201.
  const skapat = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  assert.equal(skapat.res.statusCode, 201, skapat.res.text);
  const goalId = skapat.res.body.goal.id;

  // GET: 200.
  const läst = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(läst.res.statusCode, 200, läst.res.text);

  // POST .../insattning: 201.
  const insatt = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: INSATTNING });
  assert.equal(insatt.res.statusCode, 201, insatt.res.text);

  // PUT: 200.
  const ändrat = await call('PUT', `/api/sparmal/${goalId}`, { cookie, body: { ...UTKAST, name: 'Ny buffert' } });
  assert.equal(ändrat.res.statusCode, 200, ändrat.res.text);

  // DELETE: 204.
  const borttaget = await call('DELETE', `/api/sparmal/${goalId}`, { cookie });
  assert.equal(borttaget.res.statusCode, 204, borttaget.res.text);
  assert.equal(antalMal(db), 0);
  assert.equal(antalInsattningar(db), 0, 'insättningen försvann med målet');
});

// ---------------------------------------------------------------------------
// (S11) De fem vägarna: statuskoderna i tabellen.
// ---------------------------------------------------------------------------

test('(S11) POST /api/sparmal ger 201 med sparmålet', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const { handled, res } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  // Målbeloppet går in som kronor och kommer ut som ören.
  assert.equal(res.body.goal.name, 'Buffert');
  assert.equal(res.body.goal.targetOre, 5000000);
  assert.equal(res.body.goal.targetDate, '2027-06-30');
  assert.equal(typeof res.body.goal.id, 'string');
  // De fyra fälten ur goals-raden, och inga av de sex räknade: de kräver ett dagens
  // datum, och kroppen har inget.
  assert.deepEqual(Object.keys(res.body.goal).sort(), ['id', 'name', 'targetDate', 'targetOre']);
  assert.equal(antalMal(db), 1);
});

test('(S11) POST /api/sparmal tar emot ett mål utan slutdatum', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('POST', '/api/sparmal', { cookie, body: { name: 'Resa', targetSek: '12000' } });
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.body.goal.targetDate, null);
  assert.equal(antalMal(db), 1);
});

test('(S11) POST /api/sparmal ger 400 med fieldErrors och skriver ingen rad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const { res } = await call('POST', '/api/sparmal', { cookie, body: { name: '', targetSek: 'abc', targetDate: '2026-02-30' } });
  assert.equal(res.statusCode, 400, res.text);
  // error är första fältfelets text, fieldErrors hela listan i formulärets ordning
  // — samma form som varje annan skrivväg i API:t.
  assert.equal(res.body.error, 'Namnet får inte vara tomt.');
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), ['name', 'targetSek', 'targetDate']);
  assert.equal(antalMal(db), 0, 'valideringen står före datalagret');

  // En kropp som inte går att tolka ger samma statuskod med API:ts egen text.
  const trasig = await call('POST', '/api/sparmal', { cookie, body: undefined });
  assert.equal(trasig.res.statusCode, 400, trasig.res.text);
  assert.equal(trasig.res.body.error, 'Kunde inte tolka anropet.');
  assert.equal(antalMal(db), 0);
});

test('(S11) GET /api/sparmal/<datum> ger 200 med listan och de tio fälten', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const mitt = userId(db, EPOST);
  addGoal(mitt, { name: 'Buffert', targetOre: 5000000, targetDate: '2027-06-30' }, { db, now: NU, makeId: () => 'g-buffert' });
  addGoal(mitt, { name: 'Cykel', targetOre: 1000000, targetDate: '2026-09-30' }, { db, now: NU, makeId: () => 'g-cykel' });
  addGoal(mitt, { name: 'Dator', targetOre: 2000000, targetDate: null }, { db, now: NU, makeId: () => 'g-dator' });
  addDeposit(mitt, 'g-buffert', { amountOre: 3000000, madeOn: '2026-09-01' }, { db, now: NU, makeId: () => 'd-1' });
  addDeposit(mitt, 'g-buffert', { amountOre: -160000, madeOn: '2026-10-01' }, { db, now: NU, makeId: () => 'd-2' });
  addDeposit(mitt, 'g-cykel', { amountOre: 1000000, madeOn: '2026-09-05' }, { db, now: NU, makeId: () => 'd-3' });

  const { handled, res } = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.goals.map((mål) => [mål.id, mål.savedOre, mål.leftOre, mål.percent, mål.monthsLeft, mål.perMonthOre, mål.status]), [
    // Namnordning: Buffert, Cykel, Dator.
    ['g-buffert', 2840000, 2160000, 56, 8, 270000, 'pagaende'],
    // Nått mål med passerat slutdatum: klart vinner över forsenat, och noll kvar.
    ['g-cykel', 1000000, 0, 100, 0, 0, 'klart'],
    // Utan slutdatum: monthsLeft och perMonthOre är null.
    ['g-dator', 0, 2000000, 0, null, null, 'pagaende']
  ]);
  // Varje rad bär de tio fälten ARKITEKTUR.md räknar upp under "Vad readGoals
  // svarar", och inga andra.
  assert.deepEqual(Object.keys(res.body.goals[0]).sort(), [
    'id', 'leftOre', 'monthsLeft', 'name', 'perMonthOre', 'percent', 'savedOre', 'status', 'targetDate', 'targetOre'
  ]);
});

test('(S11) GET /api/sparmal/<datum> ger 200 med en tom lista utan sparmål', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res } = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body, { goals: [] });
});

test('(S11) GET /api/sparmal/<datum> ger 400 för ett led som inte är ett datum', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  // '2026-02-30' matchar mönstret utan att vara ett datum, så raden prövar att
  // isValidIsoDate och inte bara ett format äger frågan.
  for (const led of ['imorgon', '2026-10', '2026-02-30', '2026-13-01', '20261008']) {
    const { res } = await call('GET', `/api/sparmal/${led}`, { cookie });
    assert.equal(res.statusCode, 400, `${led}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, led);
  }
});

test('(S11) PUT /api/sparmal/<id> ger 200, och 404 för ett okänt eller någon annans id', async (t) => {
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

  // Någon annans mål: samma statuskod och samma text. Användaren ska inte kunna se
  // skillnad på de två.
  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: { ...UTKAST, name: 'Hennes mål' } });
  assert.equal(hennes.res.statusCode, 201, hennes.res.text);
  const stöld = await call('PUT', `/api/sparmal/${hennes.res.body.goal.id}`, { cookie, body: { ...UTKAST, name: 'Stulet' } });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.deepEqual(stöld.res.body, { error: FINNS_INTE });
  assert.equal(db.prepare('SELECT name FROM goals WHERE id = ?').get(hennes.res.body.goal.id).name, 'Hennes mål');

  // Valideringen står före datalagret, också här: ett ogiltigt utkast mot ett okänt
  // id ger 400 och inte 404.
  const trasigt = await call('PUT', '/api/sparmal/g-finns-inte', { cookie, body: { name: '', targetSek: 'abc' } });
  assert.equal(trasigt.res.statusCode, 400, trasigt.res.text);
  assert.equal(trasigt.res.body.fieldErrors.length, 2);
});

test('(S11) DELETE /api/sparmal/<id> ger 204, och 404 för ett okänt eller någon annans id', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  const goalId = skapat.body.goal.id;
  await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: INSATTNING });
  assert.equal(antalInsattningar(db), 1);

  const borttaget = await call('DELETE', `/api/sparmal/${goalId}`, { cookie });
  assert.equal(borttaget.res.statusCode, 204, borttaget.res.text);
  assert.equal(borttaget.res.text, '', '204 har ingen kropp');
  assert.equal(antalMal(db), 0);
  assert.equal(antalInsattningar(db), 0, 'ON DELETE CASCADE tog insättningen');

  // Samma id en andra gång: 404.
  const igen = await call('DELETE', `/api/sparmal/${goalId}`, { cookie });
  assert.equal(igen.res.statusCode, 404, igen.res.text);
  assert.deepEqual(igen.res.body, { error: FINNS_INTE });

  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: UTKAST });
  const stöld = await call('DELETE', `/api/sparmal/${hennes.res.body.goal.id}`, { cookie });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.equal(antalMal(db), 1, 'hennes mål finns kvar');
});

test('(S11) POST /api/sparmal/<id>/insattning ger 201, också för ett uttag', async (t) => {
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

  // Uttaget: ett negativt belopp tas emot, och det är hela skälet till att schemats
  // CHECK är <> 0 och inte > 0.
  const uttag = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: { amountSek: '-500', madeOn: '2026-10-05' } });
  assert.equal(uttag.res.statusCode, 201, uttag.res.text);
  assert.equal(uttag.res.body.deposit.amountOre, -50000);

  // Summan syns i listan.
  const läst = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(läst.res.body.goals[0].savedOre, 234050);
});

test('(S11) POST /api/sparmal/<id>/insattning ger 400 för noll och för ett datum som inte finns', async (t) => {
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

  // Ingen rad nådde databasen: valideringen står före datalagret. Noll är dessutom
  // avvisat av schemats CHECK som sista utpost — den spärren prövas av (S9).
  assert.equal(antalInsattningar(db), 0);
});

test('(S11) POST /api/sparmal/<id>/insattning ger 404 för ett okänt eller någon annans mål', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const okänt = await call('POST', '/api/sparmal/g-finns-inte/insattning', { cookie, body: INSATTNING });
  assert.equal(okänt.res.statusCode, 404, okänt.res.text);
  assert.deepEqual(okänt.res.body, { error: FINNS_INTE });

  // Någon annans mål: samma svar, och ingen rad skrivs. Främmande nyckeln goal_id
  // kräver bara att målet finns — utan läsningen i addDeposit hade anropet skapat
  // en insättning på den andres mål.
  const annanCookie = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const hennes = await call('POST', '/api/sparmal', { cookie: annanCookie, body: UTKAST });
  const stöld = await call('POST', `/api/sparmal/${hennes.res.body.goal.id}/insattning`, { cookie, body: INSATTNING });
  assert.equal(stöld.res.statusCode, 404, stöld.res.text);
  assert.equal(antalInsattningar(db), 0);
  const hennesLista = await call('GET', `/api/sparmal/${IDAG}`, { cookie: annanCookie });
  assert.equal(hennesLista.res.body.goals[0].savedOre, 0, 'hennes savedOre är oförändrad');
});

test('(S11) en metod som inte stöds ger 405 på var och en av sparmålens tre adresser', async (t) => {
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

  // Ett tomt led är ingen väg alls och ger 404 Okänd adress, inte 405.
  const tomt = await call('GET', '/api/sparmal/', { cookie });
  assert.equal(tomt.res.statusCode, 404, tomt.res.text);
  assert.deepEqual(tomt.res.body, { error: 'Okänd adress.' });
  // Och ett tredje led likaså: goalDepositFromPath kräver exakt två.
  const tre = await call('POST', `/api/sparmal/${goalId}/insattning/extra`, { cookie, body: INSATTNING });
  assert.equal(tre.res.statusCode, 404, tre.res.text);
});

// ---------------------------------------------------------------------------
// (S12) Nedgradering raderar inget.
// ---------------------------------------------------------------------------

test('(S12) ett sparmål skapat på Plus är kvar efter ned- och uppgradering', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);

  const { res: skapat } = await call('POST', '/api/sparmal', { cookie, body: UTKAST });
  assert.equal(skapat.statusCode, 201, skapat.text);
  const goalId = skapat.body.goal.id;
  const insatt = await call('POST', `/api/sparmal/${goalId}/insattning`, { cookie, body: INSATTNING });
  assert.equal(insatt.res.statusCode, 201, insatt.res.text);

  // Ned till Bas. Vägen är låst, men raderna rörs inte: nedgraderingen är en UPDATE
  // av en kolumn och ingenting annat.
  const ned = await call('PUT', '/api/plan', { cookie, body: { plan: 'bas' } });
  assert.equal(ned.res.statusCode, 200, ned.res.text);
  const låst = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(låst.res.statusCode, 403, låst.res.text);
  // Mätt direkt i databasen, eftersom API:t inte svarar medan planen är Bas.
  assert.equal(antalMal(db), 1, 'målet finns kvar på Bas');
  assert.equal(antalInsattningar(db), 1, 'insättningen finns kvar på Bas');

  // Upp igen: samma mål, samma insättning, samma räknade fält.
  const upp = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(upp.res.statusCode, 200, upp.res.text);
  const efter = await call('GET', `/api/sparmal/${IDAG}`, { cookie });
  assert.equal(efter.res.statusCode, 200, efter.res.text);
  assert.deepEqual(efter.res.body.goals, [{
    id: goalId,
    name: 'Buffert',
    targetOre: 5000000,
    targetDate: '2027-06-30',
    savedOre: 284050,
    leftOre: 4715950,
    percent: 5,
    monthsLeft: 8,
    perMonthOre: 589494,
    status: 'pagaende'
  }]);
});
