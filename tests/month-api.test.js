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

// ---------------------------------------------------------------------------
// Mallarnas API-vägar [etapp 4]: POST /api/mallar/<ÅÅÅÅ-MM> och
// PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>.
//
// De två övriga raderna i API-tabellen — PUT och DELETE /api/mallar/<seriesId>/
// <ÅÅÅÅ-MM> — är inte byggda i det här paketet, och (M22) och (M23) saknar
// därför testfall. Skälet står i paketets redovisning.
// ---------------------------------------------------------------------------

// Mallens kropp: månadspostens fyra fält plus interval och toMonth. Beloppet i
// kronor, precis som UTKAST ovan; svaret bär ören.
const MALLKROPP = Object.freeze({
  kind: 'expense',
  name: 'Hyra',
  amountSek: '12500',
  category: 'housing',
  interval: 'monthly',
  toMonth: null
});

// De två texterna som ägs av src/core/item.js [etapp 4].
const FEL_TILL_OCH_MED = 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.';
const FEL_AVVIKELSE = 'Ange ett belopp för månaden, eller att posten ska hoppas över.';

// (M21) POST /api/mallar/<månad> skapar: 201, och posten syns i GET för nästa
// månad också.
test('M21: POST /api/mallar/<månad> ger 201 med mallen, och posten syns i tre månader', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { handled, res } = await call('POST', `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201, res.text);
  const { template } = res.body;
  assert.equal(typeof template.id, 'string');
  // series_id är den första versionens eget id.
  assert.equal(template.seriesId, template.id);
  assert.equal(template.name, 'Hyra');
  // Kroppen bär kronor, svaret bär ören.
  assert.equal(template.amountOre, 1250000);
  assert.equal(template.interval, 'monthly');
  assert.equal(template.fromMonth, MANAD);
  assert.equal(template.toMonth, null);
  // start_date härleds ur månaden: formuläret har inget dagfält.
  assert.equal(template.startDate, '2026-10-01');

  // Posten syns i den månad den skapades i och i de två följande — en mall och
  // inte en engångspost.
  for (const månad of ['2026-10', '2026-11', '2026-12']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items.map((item) => [item.name, item.amountOre, item.recurring]), [
      ['Hyra', 1250000, true]
    ], månad);
  }
  // Men inte i månaden före.
  const före = await call('GET', '/api/manad/2026-09', { cookie });
  assert.deepEqual(före.res.body.items, []);
});

test('M21: toMonth i kroppen stänger serien, och den syns i GET', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', `/api/mallar/${MANAD}`, { cookie, body: { ...MALLKROPP, toMonth: '2026-11' } });
  assert.equal(res.statusCode, 201, res.text);
  assert.equal(res.body.template.toMonth, '2026-11');

  const november = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(november.res.body.items.map((item) => item.name), ['Hyra']);
  const december = await call('GET', '/api/manad/2026-12', { cookie });
  assert.deepEqual(december.res.body.items, []);
});

test('POST /api/mallar/<månad> ger 400 med fieldErrors och skriver ingen rad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', `/api/mallar/${MANAD}`, {
    cookie,
    body: { kind: 'gift', name: '', amountSek: 'abc', category: 'x', interval: 'weekly', toMonth: '2026-09' }
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), [
    'kind', 'name', 'amountSek', 'category', 'interval', 'toMonth'
  ]);
  assert.equal(res.body.error, res.body.fieldErrors[0].message);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
});

// Slutmånaden före den månad mallen gäller från ger ett fältfel och ett 400,
// inte ett 500 ur schemats CHECK.
test('POST /api/mallar/<månad> ger 400 för en toMonth före månaden, inte 500', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const för = await call('POST', `/api/mallar/${MANAD}`, { cookie, body: { ...MALLKROPP, toMonth: '2026-09' } });
  assert.equal(för.res.statusCode, 400);
  assert.deepEqual(för.res.body.fieldErrors, [{
    field: 'toMonth',
    message: 'Till och med kan inte vara före den månad posten gäller från.'
  }]);

  const trasig = await call('POST', `/api/mallar/${MANAD}`, { cookie, body: { ...MALLKROPP, toMonth: '2026-13' } });
  assert.equal(trasig.res.statusCode, 400);
  assert.deepEqual(trasig.res.body.fieldErrors, [{ field: 'toMonth', message: FEL_TILL_OCH_MED }]);

  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
});

test('POST /api/mallar/<månad> ger 400 vid fel månadsformat, före valideringen av utkastet', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('POST', '/api/mallar/2026-13', { cookie, body: { kind: 'gift' } });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: FEL_MANAD });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
});

test('POST /api/mallar/<månad> ger 401 utan session, före både månad och utkast', async (t) => {
  const { call } = await apiDatabase(t);

  const { res } = await call('POST', '/api/mallar/2026-13', { body: { kind: 'gift' } });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
  assert.match(res.cookie, /^hemochekonomi_session=;/);
});

test('POST /api/mallar/<månad> med en kropp som inte går att tolka ger 400', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const res = new MockResponse();
  const { handleApiRequest } = await import('../src/server/api.js');
  await handleApiRequest(makeRequest('POST', '{trasig', { cookie }), res, `/api/mallar/${MANAD}`, NU);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
});

// /api/mallar har två former: ett led är månaden (POST), två led är serien och
// månaden (PUT och DELETE). Allt annat är Okänd adress.
test('/api/mallar med noll eller tre led är Okänd adress', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/mallar', '/api/mallar/', '/api/mallar//2026-10', '/api/mallar/t-1/', '/api/mallar/t-1/2026-10/extra']) {
    const { res } = await call('POST', pathname, { cookie, body: MALLKROPP });
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});

test('/api/mallar svarar 405 för en metod vägen inte har', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  // Ett led: bara POST.
  for (const method of ['GET', 'PUT', 'DELETE']) {
    const { res } = await call(method, `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP });
    assert.equal(res.statusCode, 405, `${method} ett led`);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, `${method} ett led`);
  }
  // Två led: PUT och DELETE, alltså 405 för de övriga. Vägen finns, så svaret är
  // 405 och inte 404 — samma regel som för /api/manad/<månad>.
  for (const method of ['GET', 'POST']) {
    const { res } = await call(method, `/api/mallar/t-1/${MANAD}`, { cookie, body: MALLKROPP });
    assert.equal(res.statusCode, 405, `${method} två led`);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, `${method} två led`);
  }
});

// (M24) PUT med "denna": bara den månaden ändras. Vägen är
// PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>, alltså den rad i API-tabellen som bär
// kroppen { amountSek } eller { skipped: true }.
test('M24: PUT /api/poster/<id>/manad/<månad> med amountSek ändrar bara den månaden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = (await call('POST', `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP })).res.body.template;

  const { handled, res } = await call('PUT', `/api/poster/${mall.id}/manad/2026-11`, { cookie, body: { amountSek: '9999' } });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);
  // Svaret är månaden efter ändringen, samma form som GET ger.
  assert.deepEqual(res.body.items.map((item) => [item.name, item.amountOre, item.overridden]), [
    ['Hyra', 999900, true]
  ]);
  assert.deepEqual(res.body.totals, {
    incomeOre: 0,
    expenseOre: 999900,
    savingOre: 0,
    leftOre: -999900
  });

  // Och bara den månaden: oktober och december har mallens belopp.
  for (const månad of ['2026-10', '2026-12']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items.map((item) => [item.amountOre, item.overridden]), [[1250000, false]], månad);
  }
  // November har det nya, läst i en egen hämtning.
  const november = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(november.res.body.items.map((item) => item.amountOre), [999900]);
});

test('M24: PUT med skipped: true tömmer bara den månaden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = (await call('POST', `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP })).res.body.template;

  const { res } = await call('PUT', `/api/poster/${mall.id}/manad/2026-11`, { cookie, body: { skipped: true } });
  assert.equal(res.statusCode, 200, res.text);
  assert.deepEqual(res.body.items, []);
  assert.deepEqual(res.body.totals, { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });

  for (const månad of ['2026-10', '2026-12']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items.map((item) => item.name), ['Hyra'], månad);
  }
});

test('PUT /api/poster/<id>/manad/<månad> ger 400 för en kropp som är varken belopp eller överhoppning', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = (await call('POST', `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP })).res.body.template;

  for (const body of [{}, { skipped: false }, { skipped: 1 }, { belopp: '100' }]) {
    const { res } = await call('PUT', `/api/poster/${mall.id}/manad/2026-11`, { cookie, body });
    assert.equal(res.statusCode, 400, JSON.stringify(body));
    assert.deepEqual(res.body.fieldErrors, [{ field: 'skipped', message: FEL_AVVIKELSE }], JSON.stringify(body));
  }

  const trasigtBelopp = await call('PUT', `/api/poster/${mall.id}/manad/2026-11`, { cookie, body: { amountSek: '12 000' } });
  assert.equal(trasigtBelopp.res.statusCode, 400);
  assert.deepEqual(trasigtBelopp.res.body.fieldErrors, [{
    field: 'amountSek',
    message: 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.'
  }]);

  // Ingen avvikelse nådde databasen.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
});

test('PUT /api/poster/<id>/manad/<månad> ger 400 vid fel månadsformat, före kroppen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = (await call('POST', `/api/mallar/${MANAD}`, { cookie, body: MALLKROPP })).res.body.template;

  const { res } = await call('PUT', `/api/poster/${mall.id}/manad/2026-13`, { cookie, body: {} });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: FEL_MANAD });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
});

test('PUT /api/poster/<id>/manad/<månad> ger 404 för ett id som inte finns', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { res } = await call('PUT', '/api/poster/finns-inte/manad/2026-11', { cookie, body: { amountSek: '100' } });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: FINNS_INTE });
});

test('PUT /api/poster/<id>/manad/<månad> ger 404 och samma text för någon annans mall, som är orörd', async (t) => {
  const { db, call } = await apiDatabase(t);
  const aCookie = await loggaIn(db, call, { email: EPOST, kod: KOD });
  const bCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const bMall = (await call('POST', `/api/mallar/${MANAD}`, { cookie: bCookie, body: { ...MALLKROPP, name: 'Berits hyra' } })).res.body.template;

  const kapning = await call('PUT', `/api/poster/${bMall.id}/manad/2026-11`, { cookie: aCookie, body: { amountSek: '1' } });
  assert.equal(kapning.res.statusCode, 404);
  // Exakt samma svar som för ett id som aldrig funnits.
  const okänt = await call('PUT', '/api/poster/finns-inte/manad/2026-11', { cookie: aCookie, body: { amountSek: '1' } });
  assert.equal(okänt.res.statusCode, kapning.res.statusCode);
  assert.deepEqual(okänt.res.body, kapning.res.body);
  assert.deepEqual(kapning.res.body, { error: FINNS_INTE });

  // Berits mall är orörd, och ingen avvikelse skrevs.
  const b = await call('GET', '/api/manad/2026-11', { cookie: bCookie });
  assert.deepEqual(b.res.body.items.map((item) => [item.name, item.amountOre]), [['Berits hyra', 1250000]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
});

test('PUT /api/poster/<id>/manad/<månad> ger 401 utan session, före både månad och kropp', async (t) => {
  const { call } = await apiDatabase(t);

  const { res } = await call('PUT', '/api/poster/t-1/manad/2026-13', { body: {} });
  assert.equal(res.statusCode, 401);
  assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

test('/api/poster/<id>/manad/ utan månad är Okänd adress, och en annan metod ger 405', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/poster/t-1/manad', '/api/poster/t-1/manad/', '/api/poster//manad/2026-10', '/api/poster/t-1/månad/2026-10', '/api/poster/t-1/manad/2026-10/extra']) {
    const { res } = await call('PUT', pathname, { cookie, body: { amountSek: '100' } });
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
  for (const method of ['GET', 'POST', 'DELETE']) {
    const { res } = await call(method, '/api/poster/t-1/manad/2026-10', { cookie, body: { amountSek: '100' } });
    assert.equal(res.statusCode, 405, method);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, method);
  }
});

// Den gamla vägen DELETE /api/poster/<id> får inte börja matcha den nya vägens
// sökväg. itemMonthFromPath och segmentAfter kan inte båda vara sanna, och
// fallet prövar just det: en engångspost tas bort på sin egen väg och inte av
// den längre.
test('DELETE /api/poster/<id> och PUT /api/poster/<id>/manad/<månad> är två skilda vägar', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const post = (await call('POST', `/api/manad/${MANAD}`, { cookie, body: UTKAST })).res.body.item;

  // Den längre vägen med en engångsposts id: en engångspost är ingen mall, så
  // ingen avvikelse kan skrivas för den.
  const avvikelse = await call('PUT', `/api/poster/${post.id}/manad/${MANAD}`, { cookie, body: { amountSek: '1' } });
  assert.equal(avvikelse.res.statusCode, 404);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);

  // Och den korta vägen fungerar som före etapp 4.
  const borttagning = await call('DELETE', `/api/poster/${post.id}`, { cookie });
  assert.equal(borttagning.res.statusCode, 204);
});

// ---------------------------------------------------------------------------
// Seriens två vägar [etapp 4, efter rättelsen]: PUT och
// DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>. Vilken operation anropet gör avgörs
// av metoden, inte av ett fält i kroppen — fältet omfattning utgick.
// ---------------------------------------------------------------------------

// Skapar en mall från MANAD och svarar med den. Varje fall nedan behöver samma
// utgångsläge, och det byggs genom POST-vägen och inte med en handskriven rad:
// det som prövas är vad vägarna gör med en serie appen själv har skapat.
async function skapaMall(call, cookie, kropp = MALLKROPP, månad = MANAD) {
  const { res } = await call('POST', `/api/mallar/${månad}`, { cookie, body: kropp });
  assert.equal(res.statusCode, 201, res.text);
  return res.body.template;
}

// (M22) PUT /api/mallar/<seriesId>/<månad> ändrar framåt: föregående månad har
// gamla beloppet, denna och nästa det nya.
test('M22: PUT /api/mallar/<seriesId>/<månad> ändrar framåt och lämnar månaden före orörd', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { handled, res } = await call('PUT', `/api/mallar/${mall.seriesId}/2026-11`, {
    cookie,
    body: { ...MALLKROPP, name: 'Hyra höjd', amountSek: '13000' }
  });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200, res.text);

  // Svaret är den nya versionen: samma serie, nytt id, from_month i månaden.
  const ny = res.body.template;
  assert.equal(ny.seriesId, mall.seriesId);
  assert.notEqual(ny.id, mall.id);
  assert.equal(ny.fromMonth, '2026-11');
  assert.equal(ny.amountOre, 1300000);
  assert.equal(ny.name, 'Hyra höjd');
  // Dagen i månaden följer med den gamla versionen: den styr intervallets fas.
  assert.equal(ny.startDate, mall.startDate);

  // Oktober har gamla beloppet och gamla namnet, november och december de nya.
  const oktober = await call('GET', '/api/manad/2026-10', { cookie });
  assert.deepEqual(oktober.res.body.items.map((item) => [item.name, item.amountOre]), [['Hyra', 1250000]]);
  for (const månad of ['2026-11', '2026-12']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items.map((item) => [item.name, item.amountOre]), [['Hyra höjd', 1300000]], månad);
  }
});

// Gränsfallet genom vägen: en ändring från seriens egen första månad ska ge en
// version och inte två, eftersom ingen passerad månad berörs.
test('M22: PUT från seriens egen första månad ger en version, inte två', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { res } = await call('PUT', `/api/mallar/${mall.seriesId}/${MANAD}`, {
    cookie,
    body: { ...MALLKROPP, amountSek: '13000' }
  });
  assert.equal(res.statusCode, 200, res.text);
  assert.equal(res.body.template.id, mall.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);

  const vy = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(vy.res.body.items.map((item) => item.amountOre), [1300000]);
});

// (M23) DELETE /api/mallar/<seriesId>/<månad> avslutar: föregående månad har
// posten, denna och nästa saknar den.
test('M23: DELETE /api/mallar/<seriesId>/<månad> avslutar serien från och med månaden', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { handled, res } = await call('DELETE', `/api/mallar/${mall.seriesId}/2026-11`, { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.text, '');

  const oktober = await call('GET', '/api/manad/2026-10', { cookie });
  assert.deepEqual(oktober.res.body.items.map((item) => item.name), ['Hyra']);
  for (const månad of ['2026-11', '2026-12']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items, [], månad);
  }
  // Raden är inte borttagen: to_month är satt till månaden före, så historiken
  // finns kvar.
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get(mall.id).to_month, '2026-10');
});

// DELETE har ingen kropp. En kropp som skickas ändå ändrar ingenting — vad som
// ska hända står i metoden och i sökvägen.
test('M23: DELETE utan kropp fungerar, och en kropp som skickas ändå ignoreras', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const första = await skapaMall(call, cookie);

  // Inget body-argument alls: ingen kropp skickas.
  const utan = await call('DELETE', `/api/mallar/${första.seriesId}/2026-11`, { cookie });
  assert.equal(utan.res.statusCode, 204);

  const andra = await skapaMall(call, cookie, { ...MALLKROPP, name: 'El' });
  // En kropp som inte går att tolka som något: vägen läser den inte.
  const med = await call('DELETE', `/api/mallar/${andra.seriesId}/2026-11`, { cookie, body: { omfattning: 'hela' } });
  assert.equal(med.res.statusCode, 204);

  const november = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(november.res.body.items, []);
  // Och oktober har båda posterna kvar: ingen passerad månad rördes.
  const oktober = await call('GET', '/api/manad/2026-10', { cookie });
  assert.deepEqual(oktober.res.body.items.map((item) => item.name).sort(), ['El', 'Hyra']);
});

// (M25) en andra ändring från en tidigare månad ger inte två poster: serien
// visas en gång per månad.
test('M25: en andra ändring från en tidigare månad ger en post per månad', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  // Första ändringen: från december.
  const första = await call('PUT', `/api/mallar/${mall.seriesId}/2026-12`, { cookie, body: { ...MALLKROPP, amountSek: '13000' } });
  assert.equal(första.res.statusCode, 200, första.res.text);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 2);

  // Andra ändringen: från november, alltså före den första.
  const andra = await call('PUT', `/api/mallar/${mall.seriesId}/2026-11`, { cookie, body: { ...MALLKROPP, amountSek: '14000' } });
  assert.equal(andra.res.statusCode, 200, andra.res.text);

  // Den framtida versionen är borta: den täckte ingen passerad månad.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 2);

  // Exakt en post per månad, i fem månader i rad.
  for (const månad of ['2026-10', '2026-11', '2026-12', '2027-01', '2027-02']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.equal(vy.res.body.items.length, 1, månad);
  }
  // Och beloppen: oktober det ursprungliga, resten det senaste.
  const oktober = await call('GET', '/api/manad/2026-10', { cookie });
  assert.deepEqual(oktober.res.body.items.map((item) => item.amountOre), [1250000]);
  for (const månad of ['2026-11', '2026-12', '2027-01']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items.map((item) => item.amountOre), [1400000], månad);
  }
});

test('PUT /api/mallar/<seriesId>/<månad> ger 400 med fieldErrors och rör inte serien', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { res } = await call('PUT', `/api/mallar/${mall.seriesId}/2026-11`, {
    cookie,
    body: { kind: 'gift', name: '', amountSek: 'abc', category: 'x', interval: 'weekly', toMonth: '2026-09' }
  });
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body.fieldErrors.map((fel) => fel.field), [
    'kind', 'name', 'amountSek', 'category', 'interval', 'toMonth'
  ]);
  assert.equal(res.body.error, res.body.fieldErrors[0].message);

  // Serien har fortfarande en version, med sitt ursprungliga belopp.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get(mall.id).to_month, null);
  const vy = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(vy.res.body.items.map((item) => item.amountOre), [1250000]);
});

test('PUT och DELETE /api/mallar ger 400 vid fel månadsformat, före kroppen', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const put = await call('PUT', `/api/mallar/${mall.seriesId}/2026-13`, { cookie, body: { kind: 'gift' } });
  assert.equal(put.res.statusCode, 400);
  assert.deepEqual(put.res.body, { error: FEL_MANAD });

  const del = await call('DELETE', `/api/mallar/${mall.seriesId}/oktober`, { cookie });
  assert.equal(del.res.statusCode, 400);
  assert.deepEqual(del.res.body, { error: FEL_MANAD });

  // Serien är orörd.
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get(mall.id).to_month, null);
});

test('PUT /api/mallar med en kropp som inte går att tolka ger 400', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const res = new MockResponse();
  const { handleApiRequest } = await import('../src/server/api.js');
  await handleApiRequest(makeRequest('PUT', '{trasig', { cookie }), res, `/api/mallar/${mall.seriesId}/2026-11`, NU);
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
});

test('PUT och DELETE /api/mallar ger 404 för ett series_id som inte finns', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const put = await call('PUT', '/api/mallar/finns-inte/2026-11', { cookie, body: MALLKROPP });
  assert.equal(put.res.statusCode, 404);
  assert.deepEqual(put.res.body, { error: FINNS_INTE });

  const del = await call('DELETE', '/api/mallar/finns-inte/2026-11', { cookie });
  assert.equal(del.res.statusCode, 404);
  assert.deepEqual(del.res.body, { error: FINNS_INTE });
});

// En månad före seriens första: de två vägarna svarar olika, och skillnaden är
// mätt och avsiktlig — inte specificerad i ARKITEKTUR.md, se paketets
// redovisning.
//
// PUT ger 404: ingen version gäller september, så det finns ingenting att ändra
// från och med den månaden. Att i stället flytta seriens from_month bakåt vore
// att hitta på en operation ingen bett om.
test('PUT /api/mallar ger 404 för en månad före seriens första, och rör inte serien', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { res } = await call('PUT', `/api/mallar/${mall.seriesId}/2026-09`, { cookie, body: MALLKROPP });
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: FINNS_INTE });

  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get(mall.id).to_month, null);
  const vy = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.deepEqual(vy.res.body.items.map((item) => item.amountOre), [1250000]);
});

// DELETE ger 204 och tar bort hela serien. "Avsluta från och med september" för
// en serie som börjar i oktober betyder att varje månad serien någonsin gäller
// ligger i eller efter september, så raden täcker ingen passerad månad och tas
// bort i stället för att få en to_month som bryter schemats CHECK. Samma gren
// som (M12):s fall "endTemplate från seriens egen from_month".
test('DELETE /api/mallar för en månad före seriens första tar bort hela serien', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  const { res } = await call('DELETE', `/api/mallar/${mall.seriesId}/2026-09`, { cookie });
  assert.equal(res.statusCode, 204);
  assert.equal(res.text, '');

  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
  for (const månad of ['2026-09', '2026-10', '2026-11']) {
    const vy = await call('GET', `/api/manad/${månad}`, { cookie });
    assert.deepEqual(vy.res.body.items, [], månad);
  }
  // Ett andra anrop har ingenting att avsluta och ger 404, samma svar som för
  // ett series_id som aldrig funnits.
  const igen = await call('DELETE', `/api/mallar/${mall.seriesId}/2026-09`, { cookie });
  assert.equal(igen.res.statusCode, 404);
  assert.deepEqual(igen.res.body, { error: FINNS_INTE });
});

test('PUT och DELETE /api/mallar ger 404 och samma text för någon annans serie, som är orörd', async (t) => {
  const { db, call } = await apiDatabase(t);
  const aCookie = await loggaIn(db, call, { email: EPOST, kod: KOD });
  const bCookie = await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const bMall = await skapaMall(call, bCookie, { ...MALLKROPP, name: 'Berits hyra' });

  const putKapning = await call('PUT', `/api/mallar/${bMall.seriesId}/2026-11`, { cookie: aCookie, body: { ...MALLKROPP, amountSek: '1' } });
  const putOkänt = await call('PUT', '/api/mallar/finns-inte/2026-11', { cookie: aCookie, body: { ...MALLKROPP, amountSek: '1' } });
  assert.equal(putKapning.res.statusCode, 404);
  assert.equal(putOkänt.res.statusCode, putKapning.res.statusCode);
  assert.deepEqual(putOkänt.res.body, putKapning.res.body);

  const delKapning = await call('DELETE', `/api/mallar/${bMall.seriesId}/2026-11`, { cookie: aCookie });
  const delOkänt = await call('DELETE', '/api/mallar/finns-inte/2026-11', { cookie: aCookie });
  assert.equal(delKapning.res.statusCode, 404);
  assert.equal(delOkänt.res.statusCode, delKapning.res.statusCode);
  assert.deepEqual(delOkänt.res.body, delKapning.res.body);

  // Berits serie har fortfarande en version, orörd, och syns i hans november.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get(bMall.id).to_month, null);
  const b = await call('GET', '/api/manad/2026-11', { cookie: bCookie });
  assert.deepEqual(b.res.body.items.map((item) => [item.name, item.amountOre]), [['Berits hyra', 1250000]]);
});

test('PUT och DELETE /api/mallar ger 401 utan session, före både månad och kropp', async (t) => {
  const { call } = await apiDatabase(t);

  const put = await call('PUT', '/api/mallar/t-1/2026-13', { body: { kind: 'gift' } });
  assert.equal(put.res.statusCode, 401);
  assert.deepEqual(put.res.body, { error: NOT_LOGGED_IN_MESSAGE });
  assert.match(put.res.cookie, /^hemochekonomi_session=;/);

  const del = await call('DELETE', '/api/mallar/t-1/2026-13');
  assert.equal(del.res.statusCode, 401);
  assert.deepEqual(del.res.body, { error: NOT_LOGGED_IN_MESSAGE });
});

// De tre vägarna som rör en mall gör tre olika saker, och ingen av dem får göra
// en annans. Samma serie, tre anrop, tre utfall i samma databas.
test('de tre mallvägarna gör tre olika saker för samma serie', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const mall = await skapaMall(call, cookie);

  // Bara november: en avvikelse, ingen ny version.
  await call('PUT', `/api/poster/${mall.id}/manad/2026-11`, { cookie, body: { amountSek: '9999' } });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 1);

  // Från och med december: en ny version.
  await call('PUT', `/api/mallar/${mall.seriesId}/2026-12`, { cookie, body: { ...MALLKROPP, amountSek: '13000' } });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 2);

  // Avvikelsen i november finns kvar: den hör till den gamla versionen, som
  // fortfarande gäller november.
  const november = await call('GET', '/api/manad/2026-11', { cookie });
  assert.deepEqual(november.res.body.items.map((item) => [item.amountOre, item.overridden]), [[999900, true]]);
  const december = await call('GET', '/api/manad/2026-12', { cookie });
  assert.deepEqual(december.res.body.items.map((item) => [item.amountOre, item.overridden]), [[1300000, false]]);
  // Och oktober är orörd av allt.
  const oktober = await call('GET', '/api/manad/2026-10', { cookie });
  assert.deepEqual(oktober.res.body.items.map((item) => [item.amountOre, item.overridden]), [[1250000, false]]);

  // Avsluta från och med januari: serien tar slut, december är kvar.
  const avslut = await call('DELETE', `/api/mallar/${mall.seriesId}/2027-01`, { cookie });
  assert.equal(avslut.res.statusCode, 204);
  const januari = await call('GET', '/api/manad/2027-01', { cookie });
  assert.deepEqual(januari.res.body.items, []);
  const december2 = await call('GET', '/api/manad/2026-12', { cookie });
  assert.deepEqual(december2.res.body.items.map((item) => item.amountOre), [1300000]);
});
