// Räkningarnas fem API-vägar [steg 3]. Kravlistan (R10) till (R12) i
// ARKITEKTUR.md under "Kravlista [steg 3]".
//
// Testar handleApiRequest direkt, utan att starta en server, med en riktig
// databas i en fil per testfall — samma rigg som tests/month-api.test.js.
//
// Ordningen i vägarna är bindande och har ett testfall var: sessionsspärren,
// behörigheten, datumspärren, valideringen, sedan datalagret. Varje fall som ger
// 400 kontrollerar dessutom att ingen rad nådde databasen.
//
// Ingen tid och inget datum läses ur klockan: now skickas in i varje anrop, och
// varje dagens datum står som en literal.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { REMIND_DAYS_DEFAULT, REMIND_DAYS_MAX } from '../src/core/bill.js';
import { NOT_LOGGED_IN_MESSAGE, requestCode } from '../src/server/auth.js';
import { addBill } from '../src/server/bills.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';

const NU = '2026-09-25T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const IDAG = '2026-09-25';

// Kroppen i POST och PUT: fem fält, och beloppet i kronor. Svaret bär ören.
const UTKAST = Object.freeze({
  name: 'Elräkning',
  amountSek: '850,50',
  dueDate: '2026-10-15',
  interval: null,
  remindDays: 3
});

// De två texterna ur tabellen i ARKITEKTUR.md, skrivna en gång här.
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

// api.js hämtar sin anslutning med getDatabase(), som läser
// HEMOCHEKONOMI_DB_FILE. En fil per testfall, och den delade anslutningen stängs
// både före och efter — samma rigg som tests/month-api.test.js.
async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-rakn-'));
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

function userId(db, email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
}

function antalRakningar(db) {
  return db.prepare('SELECT COUNT(*) AS antal FROM bills').get().antal;
}

// ---------------------------------------------------------------------------
// (R10) De fem vägarna: statuskoderna i tabellen.
// ---------------------------------------------------------------------------

test('(R10) POST /api/rakningar ger 201 med räkningen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { handled, res } = await call('POST', '/api/rakningar', { body: UTKAST, cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  // Beloppet går in som kronor och kommer ut som ören.
  assert.equal(res.body.bill.name, 'Elräkning');
  assert.equal(res.body.bill.amountOre, 85050);
  assert.equal(res.body.bill.dueDate, '2026-10-15');
  assert.equal(res.body.bill.interval, null);
  assert.equal(res.body.bill.remindDays, 3);
  assert.equal(res.body.bill.paidAt, null);
  assert.equal(typeof res.body.bill.id, 'string');
  assert.equal(antalRakningar(db), 1);
});

test('(R10) GET /api/rakningar/<datum> ger 200 med listan', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mitt = userId(db, EPOST);
  addBill(mitt, { name: 'Hyra', amountOre: 1250000, dueDate: '2026-09-20', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hyra' });
  addBill(mitt, { name: 'Bredband', amountOre: 39900, dueDate: '2026-09-27', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-bredband' });
  addBill(mitt, { name: 'Tandläkare', amountOre: 95000, dueDate: '2026-11-01', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-tand' });

  const { handled, res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.bills.map((rad) => [rad.id, rad.daysUntil, rad.status]), [
    ['b-hyra', -5, 'forfallen'],
    ['b-bredband', 2, 'paminnelse'],
    ['b-tand', 37, 'kommande']
  ]);
  // Varje rad bär de nio fälten ARKITEKTUR.md räknar upp under "Vad readBills
  // svarar", och inga andra.
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
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

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
  const mitt = userId(db, EPOST);
  addBill(mitt, { name: 'El', amountOre: 85000, dueDate: '2026-09-30', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });
  addBill(mitt, { name: 'Tandläkare', amountOre: 95000, dueDate: '2026-09-30', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-tand' });

  // Den återkommande flyttas fram och får paidAt nollställd: användaren ska se
  // att den kommer igen.
  const flyttad = await call('POST', '/api/rakningar/b-el/betald', { body: { today: IDAG }, cookie });
  assert.equal(flyttad.handled, true);
  assert.equal(flyttad.res.statusCode, 200, flyttad.res.text);
  assert.equal(flyttad.res.body.bill.dueDate, '2026-10-30');
  assert.equal(flyttad.res.body.bill.paidAt, null);

  // Engångsräkningen behåller sitt datum och får en tidsstämpel.
  const betald = await call('POST', '/api/rakningar/b-tand/betald', { body: { today: IDAG }, cookie });
  assert.equal(betald.res.statusCode, 200, betald.res.text);
  assert.equal(betald.res.body.bill.dueDate, '2026-09-30');
  assert.equal(betald.res.body.bill.paidAt, NU);

  // Och listan efteråt visar det: en kommande och en betald.
  const { res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.deepEqual(res.body.bills.map((rad) => [rad.id, rad.dueDate, rad.status]), [
    ['b-tand', '2026-09-30', 'betald'],
    ['b-el', '2026-10-30', 'kommande']
  ]);
});

test('(R10) DELETE /api/rakningar/<id> ger 204 och sedan 404', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const första = await call('DELETE', '/api/rakningar/b-el', { cookie });
  assert.equal(första.handled, true);
  assert.equal(första.res.statusCode, 204);
  assert.equal(första.res.text, '');
  assert.equal(antalRakningar(db), 0);

  const andra = await call('DELETE', '/api/rakningar/b-el', { cookie });
  assert.equal(andra.res.statusCode, 404);
  assert.deepEqual(andra.res.body, { error: FINNS_INTE });
});

test('(R10) alla fem vägarna ger 401 utan session, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  // Ett konto och en räkning finns, så att ett 401 inte kan förväxlas med ett
  // 404 av att det inte finns något att röra.
  await requestCode(db, { email: EPOST, ip: IP, now: NU, makeCode: () => KOD });
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

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
  // Raden är orörd: 401 ges av sessionsspärren innan vägen körs.
  assert.equal(antalRakningar(db), 1);
  assert.equal(db.prepare('SELECT paid_at FROM bills WHERE id = ?').get('b-el').paid_at, null);
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
  // error är det första felet, precis som på månadspostens väg.
  assert.equal(res.body.error, res.body.fieldErrors[0].message);
  assert.equal(antalRakningar(db), 0);
});

test('(R10) PUT ger 400 med fieldErrors och lämnar raden orörd', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  const { res } = await call('PUT', '/api/rakningar/b-el', { body: { ...UTKAST, amountSek: '0' }, cookie });
  assert.equal(res.statusCode, 400, res.text);
  assert.deepEqual(res.body.fieldErrors, [{ field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }]);
  // Valideringen står före datalagret: raden är orörd.
  const rad = db.prepare('SELECT name, amount_ore FROM bills WHERE id = ?').get('b-el');
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
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  for (const [method, pathname] of [['POST', '/api/rakningar'], ['PUT', '/api/rakningar/b-el'], ['POST', '/api/rakningar/b-el/betald']]) {
    const res = new MockResponse();
    const { handleApiRequest } = await import('../src/server/api.js');
    await handleApiRequest(makeRequest(method, '{ inte json', { cookie }), res, pathname, NU);
    assert.equal(res.statusCode, 400, `${method} ${pathname}: ${res.text}`);
    assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' }, `${method} ${pathname}`);
  }
  assert.equal(db.prepare('SELECT paid_at FROM bills WHERE id = ?').get('b-el').paid_at, null);
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

// ---------------------------------------------------------------------------
// (R11) Fel datumformat ger 400, och når aldrig datalagret.
// ---------------------------------------------------------------------------

test('(R11) GET med fel datumformat ger 400, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  // Varje värde är ett led som finns i sökvägen men inte är ett datum. Det sista
  // paret är datum som matchar mönstret utan att finnas i kalendern: det är
  // skillnaden mellan ett mönster och isValidIsoDate, och den avgörs av
  // src/core/dates.js.
  for (const datum of ['2026-10', '2026', '20261015', '2026-1-1', 'idag', '2026-13-01', '2026-02-30', '2026-00-10', '2026-10-32']) {
    const { handled, res } = await call('GET', `/api/rakningar/${datum}`, { cookie });
    assert.equal(handled, true, datum);
    assert.equal(res.statusCode, 400, `${datum}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, datum);
  }
  // Datalagret nåddes aldrig: raden är orörd, och inget 500 med ett
  // RangeError-meddelande som namnger readBills kom ut.
  assert.equal(antalRakningar(db), 1);
  assert.equal(db.prepare('SELECT due_date FROM bills WHERE id = ?').get('b-el').due_date, '2026-10-15');
});

test('(R11) betald med ett today som inte är ett datum ger 400, och lämnar raden obetald', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  for (const today of [undefined, null, '', '2026-10', '2026-02-30', '2026-13-01', 42, true, {}, []]) {
    const { res } = await call('POST', '/api/rakningar/b-el/betald', { body: { today }, cookie });
    assert.equal(res.statusCode, 400, `${String(today)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM }, String(today));
  }
  // En kropp som inte är ett objekt ger samma svar: det finns inget today där.
  for (const body of [null, 'abc', 42, [], true]) {
    const { res } = await call('POST', '/api/rakningar/b-el/betald', { body, cookie });
    assert.equal(res.statusCode, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_DATUM });
  }
  // Datumspärren står före datalagret: förfallodagen är oförändrad och raden är
  // fortfarande obetald.
  const rad = db.prepare('SELECT due_date, paid_at FROM bills WHERE id = ?').get('b-el');
  assert.equal(rad.due_date, '2026-10-15');
  assert.equal(rad.paid_at, null);
});

test('(R11) datumspärren står efter sessionsspärren: utan session blir det 401, inte 400', async (t) => {
  const { db, call } = await apiDatabase(t);
  await requestCode(db, { email: EPOST, ip: IP, now: NU, makeCode: () => KOD });

  // Ordningen är bindande. En utan session ska inte kunna läsa ur svaret vilka
  // datumformat appen tar emot.
  const { res } = await call('GET', '/api/rakningar/inte-ett-datum');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

// ---------------------------------------------------------------------------
// (R12) betald på någon annans räkning ger 404, samma svar som för ett okänt id.
// ---------------------------------------------------------------------------

test('(R12) betald på någon annans räkning ger samma 404 som ett okänt id', async (t) => {
  const { db, call } = await apiDatabase(t);
  const minCookie = await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  addBill(userId(db, ANNAN_EPOST), { name: 'Hennes el', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hennes' });

  const hennes = await call('POST', '/api/rakningar/b-hennes/betald', { body: { today: IDAG }, cookie: minCookie });
  const okänt = await call('POST', '/api/rakningar/b-finns-inte/betald', { body: { today: IDAG }, cookie: minCookie });

  // Byte för byte samma svar: statuskoden, kroppen och huvudena. Två olika svar
  // hade avslöjat att raden finns.
  assert.equal(hennes.res.statusCode, 404);
  assert.equal(hennes.res.statusCode, okänt.res.statusCode);
  assert.equal(hennes.res.text, okänt.res.text);
  assert.deepEqual(hennes.res.body, { error: FINNS_INTE });

  // Och hennes rad är orörd.
  const rad = db.prepare('SELECT due_date, paid_at FROM bills WHERE id = ?').get('b-hennes');
  assert.equal(rad.due_date, '2026-10-15');
  assert.equal(rad.paid_at, null);
});

test('(R12) de tre övriga vägarna mot någon annans räkning svarar likadant', async (t) => {
  const { db, call } = await apiDatabase(t);
  const minCookie = await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  addBill(userId(db, ANNAN_EPOST), { name: 'Hennes el', amountOre: 85000, dueDate: '2026-10-15', interval: 'monthly', remindDays: 3 }, { db, now: NU, makeId: () => 'b-hennes' });

  for (const [method, body] of [['PUT', UTKAST], ['DELETE', undefined]]) {
    const hennes = await call(method, '/api/rakningar/b-hennes', { body, cookie: minCookie });
    const okänt = await call(method, '/api/rakningar/b-finns-inte', { body, cookie: minCookie });
    assert.equal(hennes.res.statusCode, 404, `${method}: ${hennes.res.text}`);
    assert.equal(hennes.res.text, okänt.res.text, method);
  }
  // Och hennes lista är lika lång som förut, med samma namn.
  assert.equal(db.prepare('SELECT name FROM bills WHERE id = ?').get('b-hennes').name, 'Hennes el');

  // Hennes GET visar hennes räkning, min visar ingen.
  const hennesCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: '111222' });
  const hennesLista = await call('GET', `/api/rakningar/${IDAG}`, { cookie: hennesCookie });
  assert.deepEqual(hennesLista.res.body.bills.map((rad) => rad.id), ['b-hennes']);
  const minLista = await call('GET', `/api/rakningar/${IDAG}`, { cookie: minCookie });
  assert.deepEqual(minLista.res.body.bills, []);
});

// ---------------------------------------------------------------------------
// Övrigt: behörighetsspärren och förvalet för remindDays.
// ---------------------------------------------------------------------------

test('alla fem vägarna går genom requireFeature med billReminders', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addBill(userId(db, EPOST), { name: 'El', amountOre: 85000, dueDate: '2026-10-15', interval: null, remindDays: 3 }, { db, now: NU, makeId: () => 'b-el' });

  // billReminders står i alla tre planerna, så 403-grenen har ingen nåbar
  // indata: varje plan en session kan bära ger hasFeature true. Mutationen "ta
  // bort if-satsen i requireFeature" överlever därför hela sviten, precis som
  // för budgetens vägar, och det är väntat — ARKITEKTUR.md skriver ut skälet.
  //
  // Det som går att pröva är att vägen verkligen går genom spärren, och det görs
  // på källkoden: en väg som glömmer raden är just det felet spärren finns för
  // (LARDOMAR.md 2026-09-07 om textspärren mot saveEntries, med varje stavning
  // språket tillåter prövad nedan).
  const källa = await fs.readFile(new URL('../src/server/api.js', import.meta.url), 'utf8');
  for (const handler of ['handleReadBills', 'handleCreateBill', 'handleUpdateBill', 'handleMarkBillPaid', 'handleDeleteBill']) {
    const kropp = källa.slice(källa.indexOf(`function ${handler}(`));
    const slut = kropp.indexOf('\n}\n');
    assert.match(
      kropp.slice(0, slut),
      /const session = billSessionOrNull\(req, res, now\);/,
      `${handler} ska gå genom billSessionOrNull`
    );
  }
  // Och billSessionOrNull anropar requireFeature med just den nyckeln. Tre
  // stavningar prövas, så att en omdöpning inte kan smyga förbi: nyckeln som
  // sträng, nyckeln någon annanstans i funktionen, och att ingen annan nyckel
  // står där.
  const spärr = källa.slice(källa.indexOf('function billSessionOrNull('));
  const spärrKropp = spärr.slice(0, spärr.indexOf('\n}\n'));
  assert.match(spärrKropp, /requireFeature\(session, 'billReminders'\)/);
  assert.equal(/requireFeature\(session, '(?!billReminders')/.test(spärrKropp), false, spärrKropp);

  // Att de fem vägarna fungerar för en session med förvalsplanen bas är prövat
  // här och i (R10): planen är bas efter en första inloggning.
  assert.equal(db.prepare('SELECT plan FROM users WHERE email = ?').get(EPOST).plan, 'bas');
  const { res } = await call('GET', `/api/rakningar/${IDAG}`, { cookie });
  assert.equal(res.statusCode, 200, res.text);
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
  // Och det högsta värdet går igenom hela vägen, inte bara datalagret.
  const högsta = await call('POST', '/api/rakningar', {
    body: { name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: String(REMIND_DAYS_MAX) },
    cookie
  });
  assert.equal(högsta.res.statusCode, 201, högsta.res.text);
  assert.equal(högsta.res.body.bill.remindDays, REMIND_DAYS_MAX);
});
