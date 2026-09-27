// Månadens API-vägar [etapp 3]: GET /api/manad/<ÅÅÅÅ-MM> och
// DELETE /api/poster/<id>. Testar handleApiRequest direkt, utan att starta en
// server, med en riktig databas i en fil per testfall.
//
// Ordningen i skrivvägarna är bindande och har ett testfall var: sessionsspärren,
// månadsspärren, valideringen, sedan datalagret. Varje fall som ger 400 kontrollerar
// dessutom att ingen rad nådde databasen.
//
// Ingen tid och ingen månad läses ur klockan: now skickas in i varje anrop och
// varje månad står som en literal.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { NOT_LOGGED_IN_MESSAGE, requestCode } from '../src/server/auth.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';
import { addMonthItem } from '../src/server/months.js';

const NU = '2026-09-25T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'berit@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const MANAD = '2026-10';

// Kroppen i POST och PUT: fyra fält, och beloppet i kronor. Svaret bär ören.
const UTKAST = Object.freeze({
  kind: 'expense',
  name: 'Tandläkare',
  amountSek: '950,50',
  category: 'other'
});

// De två texterna ur tabellen i ARKITEKTUR.md under "Månadens API".
const FEL_MANAD = 'Månaden måste anges som ÅÅÅÅ-MM.';
const FINNS_INTE = 'Posten finns inte.';

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
// både före och efter — samma rigg som tests/auth.test.js.
async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-manad-'));
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

// Loggar in och svarar med cookien. Koden injiceras, samma mönster som i
// tests/auth.test.js: testet ska veta vilken kod som skickades utan att koden
// lämnar modulen i produktionskoden.
async function loggaIn(db, call, { email = EPOST, kod = KOD } = {}) {
  await requestCode(db, { email, ip: IP, now: NU, makeCode: () => kod });
  const { res } = await call('POST', '/api/auth/logga-in', { body: { email, code: kod } });
  assert.equal(res.statusCode, 204, res.text);
  return res.cookie;
}

function userId(db, email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
}

test('GET /api/manad/<månad> ger 200 med poster och summor', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addMonthItem(userId(db, EPOST), MANAD, { kind: 'income', name: 'Lön', amountOre: 3000000, category: 'other' }, { db, now: NU, makeId: () => 'm-lon' });
  addMonthItem(userId(db, EPOST), MANAD, { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' }, { db, now: NU, makeId: () => 'm-hyra' });

  const { handled, res } = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(res.body.items.map((item) => [item.kind, item.name, item.amountOre]), [
    ['income', 'Lön', 3000000],
    ['expense', 'Hyra', 1250000]
  ]);
  assert.deepEqual(res.body.totals, {
    incomeOre: 3000000,
    expenseOre: 1250000,
    savingOre: 0,
    leftOre: 1750000
  });
});

test('GET /api/manad/<månad> ger 200 med tom lista och fyra nollor för en tom månad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, {
    items: [],
    totals: { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 }
  });
});

test('GET /api/manad/<månad> ger 400 vid fel månadsformat, och når aldrig datalagret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const manad of ['2026-13', '2026-00', '2026-1', '2026', '2026-10-01', 'oktober', '2026-1O']) {
    const { res } = await call('GET', `/api/manad/${manad}`, { cookie });
    assert.equal(res.statusCode, 400, manad);
    assert.deepEqual(res.body, { error: FEL_MANAD }, manad);
  }
});

test('GET /api/manad/ utan månad är ingen månadsväg utan Okänd adress', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/manad', '/api/manad/', '/api/manad/2026-10/poster']) {
    const { res } = await call('GET', pathname, { cookie });
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});

test('GET /api/manad/<månad> ger 401 utan session, med rensad cookie', async (t) => {
  const { call } = await apiDatabase(t);

  const { res } = await call('GET', `/api/manad/${MANAD}`);
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
  assert.match(res.cookie, /^hemochekonomi_session=;/);
});

test('sessionsspärren går före månadsspärren: en ogiltig månad utan session ger 401', async (t) => {
  const { call } = await apiDatabase(t);

  // 401 ges av sessionsspärren innan vägen körs, inte av vägen själv. Utan den
  // ordningen läcker vägen att adressen finns till den som inte är inloggad.
  const { res } = await call('GET', '/api/manad/2026-13');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

test('en annan användares månad är onåbar: A:s cookie ger aldrig B:s poster', async (t) => {
  const { db, call } = await apiDatabase(t);
  const aCookie = await loggaIn(db, call, { email: EPOST, kod: KOD });
  const bCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });

  addMonthItem(userId(db, ANNAN_EPOST), MANAD, { kind: 'expense', name: 'Berits hyra', amountOre: 999900, category: 'housing' }, { db, now: NU, makeId: () => 'm-berit' });

  const a = await call('GET', `/api/manad/${MANAD}`, { cookie: aCookie });
  assert.deepEqual(a.res.body.items, []);
  assert.equal(a.res.text.includes('Berits hyra'), false, 'B:s post finns inte i A:s svar');

  const b = await call('GET', `/api/manad/${MANAD}`, { cookie: bCookie });
  assert.deepEqual(b.res.body.items.map((item) => item.name), ['Berits hyra']);
});

test('DELETE /api/poster/<id> ger 204 och posten är borta ur månaden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  addMonthItem(userId(db, EPOST), MANAD, { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NU, makeId: () => 'm-tand' });

  const { handled, res } = await call('DELETE', '/api/poster/m-tand', { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.text, '');

  const efter = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(efter.res.body.items, []);
});

test('DELETE /api/poster/<id> ger 404 för ett id som inte finns', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('DELETE', '/api/poster/finns-inte', { cookie });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: FINNS_INTE });
});

test('DELETE /api/poster/<id> ger 404 och samma text för någon annans post, som ligger kvar', async (t) => {
  const { db, call } = await apiDatabase(t);
  const aCookie = await loggaIn(db, call, { email: EPOST, kod: KOD });
  const bCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  addMonthItem(userId(db, ANNAN_EPOST), MANAD, { kind: 'expense', name: 'Berits hyra', amountOre: 999900, category: 'housing' }, { db, now: NU, makeId: () => 'm-berit' });

  const kapning = await call('DELETE', '/api/poster/m-berit', { cookie: aCookie });
  assert.equal(kapning.res.statusCode, 404);
  // Exakt samma svar som för ett id som aldrig funnits: användaren ska inte kunna
  // se skillnad på de två.
  const okant = await call('DELETE', '/api/poster/finns-inte', { cookie: aCookie });
  assert.equal(okant.res.statusCode, kapning.res.statusCode);
  assert.deepEqual(kapning.res.body, okant.res.body);
  assert.deepEqual(kapning.res.body, { error: FINNS_INTE });

  // Och posten ligger kvar hos B.
  const b = await call('GET', `/api/manad/${MANAD}`, { cookie: bCookie });
  assert.deepEqual(b.res.body.items.map((item) => item.name), ['Berits hyra']);
});

test('DELETE /api/poster/<id> ger 401 utan session', async (t) => {
  const { call } = await apiDatabase(t);

  const { res } = await call('DELETE', '/api/poster/m-1');
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

test('DELETE /api/poster/ utan id är Okänd adress', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/poster', '/api/poster/', '/api/poster/a/b']) {
    const { res } = await call('DELETE', pathname, { cookie });
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});

// (V5) till (V8): skrivvägarna. Kravlistan står i ARKITEKTUR.md under
// "Månadspostens validering".

// (V6) ett giltigt utkast.
test('V6: POST /api/manad/<månad> ger 201 med posten, och den syns i GET', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { handled, res } = await call('POST', `/api/manad/${MANAD}`, { cookie, body: UTKAST });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201);
  const { item } = res.body;
  assert.equal(typeof item.id, 'string');
  assert.equal(item.name, 'Tandläkare');
  // Kroppen bär kronor, svaret bär ören: 950,50 kr blir 95050 öre.
  assert.equal(item.amountOre, 95050);
  assert.equal(item.kind, 'expense');
  assert.equal(item.category, 'other');
  assert.equal(item.dueDate, null);
  assert.equal(item.recurring, false);
  assert.equal(item.seriesId, null);
  assert.equal(item.overridden, false);

  const efter = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(efter.res.body.items, [item]);
  assert.deepEqual(efter.res.body.totals, {
    incomeOre: 0,
    expenseOre: 95050,
    savingOre: 0,
    leftOre: -95050
  });
  // Och bara i sin månad.
  const grannen = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(grannen.res.body.items, []);
});

// (V5) ett ogiltigt utkast.
test('V5: POST med ogiltigt utkast ger 400 med fieldErrors och skriver ingen rad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', `/api/manad/${MANAD}`, {
    cookie,
    body: { kind: 'gift', name: '', amountSek: 'abc', category: 'x' }
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category']);
  assert.equal(res.body.fieldErrors[0].message, 'Välj inkomst, utgift eller sparande.');
  // error är det första felet i listan, samma form som den gamla formulärvägen.
  assert.equal(res.body.error, res.body.fieldErrors[0].message);

  // Ingen rad nådde databasen: valideringen ligger före datalagret.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal, 0);
  const efter = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(efter.res.body.items, []);
});

test('V5: POST med ett belopp med mellanslag ger den vägledande texten', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', `/api/manad/${MANAD}`, { cookie, body: { ...UTKAST, amountSek: '12 000' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors, [{
    field: 'amountSek',
    message: 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.'
  }]);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal, 0);
});

test('POST med en kropp som inte går att tolka ger 400 Kunde inte tolka anropet.', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const res = new MockResponse();
  const { handleApiRequest } = await import('../src/server/api.js');
  await handleApiRequest(makeRequest('POST', '{trasig', { cookie }), res, `/api/manad/${MANAD}`, NU);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal, 0);
});

test('POST ger 400 vid fel månadsformat, före valideringen av utkastet', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  // Både månaden och utkastet är fel: månadsspärren är steg 2 och vinner över
  // valideringen, som är steg 3.
  const { res } = await call('POST', '/api/manad/2026-13', { cookie, body: { kind: 'gift' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: FEL_MANAD });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal, 0);
});

test('POST och PUT ger 401 utan session, före både månad och utkast', async (t) => {
  const { call } = await apiDatabase(t);

  const post = await call('POST', '/api/manad/2026-13', { body: { kind: 'gift' } });
  assert.equal(post.res.statusCode, 401);
  assert.deepEqual(post.res.body, { error: NOT_LOGGED_IN_MESSAGE });

  const put = await call('PUT', '/api/poster/m-1', { body: { kind: 'gift' } });
  assert.equal(put.res.statusCode, 401);
  assert.deepEqual(put.res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

// (V8) PUT ändrar beloppet.
test('V8: PUT /api/poster/<id> ger 200, och GET visar nytt belopp och nya summor', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const skapad = (await call('POST', `/api/manad/${MANAD}`, { cookie, body: UTKAST })).res.body.item;

  const { handled, res } = await call('PUT', `/api/poster/${skapad.id}`, {
    cookie,
    body: { kind: 'saving', name: 'Tandvård', amountSek: '1200', category: 'other' }
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.item, {
    id: skapad.id,
    kind: 'saving',
    name: 'Tandvård',
    amountOre: 120000,
    category: 'other',
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false
  });

  const efter = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(efter.res.body.items, [res.body.item]);
  assert.deepEqual(efter.res.body.totals, {
    incomeOre: 0,
    expenseOre: 0,
    savingOre: 120000,
    leftOre: -120000
  });
});

// (V7) PUT mot någon annans id.
test('V7: PUT mot någon annans id ger 404 Posten finns inte., och rör inte raden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const aCookie = await loggaIn(db, call, { email: EPOST, kod: KOD });
  const bCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const bItem = (await call('POST', `/api/manad/${MANAD}`, { cookie: bCookie, body: { ...UTKAST, name: 'Berits post' } })).res.body.item;

  const kapning = await call('PUT', `/api/poster/${bItem.id}`, {
    cookie: aCookie,
    body: { kind: 'income', name: 'Kapad', amountSek: '1', category: 'other' }
  });
  assert.equal(kapning.res.statusCode, 404);
  assert.deepEqual(kapning.res.body, { error: FINNS_INTE });

  // Samma svar som för ett id som aldrig funnits.
  const okant = await call('PUT', '/api/poster/finns-inte', {
    cookie: aCookie,
    body: { kind: 'income', name: 'Kapad', amountSek: '1', category: 'other' }
  });
  assert.equal(okant.res.statusCode, kapning.res.statusCode);
  assert.deepEqual(okant.res.body, kapning.res.body);

  // B:s post är orörd.
  const b = await call('GET', `/api/manad/${MANAD}`, { cookie: bCookie });
  assert.deepEqual(b.res.body.items, [bItem]);
});

test('PUT med ogiltigt utkast ger 400 och rör inte raden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const skapad = (await call('POST', `/api/manad/${MANAD}`, { cookie, body: UTKAST })).res.body.item;

  const { res } = await call('PUT', `/api/poster/${skapad.id}`, { cookie, body: { kind: 'gift', name: '', amountSek: 'abc', category: 'x' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category']);

  const efter = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(efter.res.body.items, [skapad]);
});

test('en metod utan väg ger 405 Metoden stöds inte.', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const [method, pathname] of [['PUT', `/api/manad/${MANAD}`], ['DELETE', `/api/manad/${MANAD}`], ['POST', '/api/poster/m-1'], ['GET', '/api/poster/m-1']]) {
    const { res } = await call(method, pathname, { cookie });
    assert.equal(res.statusCode, 405, `${method} ${pathname}`);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, `${method} ${pathname}`);
  }
});
