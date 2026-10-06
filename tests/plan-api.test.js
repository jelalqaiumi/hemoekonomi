// Planens två vägar [steg 1 i del 5]: GET /api/plan och PUT /api/plan. Testar
// handleApiRequest direkt, utan att starta en server, med en riktig databas i en
// fil per testfall — samma rigg som tests/month-api.test.js.
//
// Kravlistan i ARKITEKTUR.md under "Del 5: planer och behörighet" har sex punkter
// för den här filen, (P8) till (P13). Tre av dem är byggda här: (P11), (P12) och
// (P13). (P8), (P9) och (P10):s 403-hälft kräver en väg som är skyddad av en
// Plus-funktion, och ARKITEKTUR.md namnger ingen sådan väg — ingen av de
// befintliga vägarna står i filen med en funktionsnyckel. De tre punkterna är
// därför lämnade tillbaka till arkitekten i stället för byggda mot en gissad
// koppling mellan väg och funktion. Se paketets redovisning.
//
// Ingen tid läses ur klockan: now skickas in i varje anrop.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FEATURES, PLANS, hasFeature } from '../src/core/plans.js';
import { NOT_LOGGED_IN_MESSAGE, requestCode } from '../src/server/auth.js';
import { closeDatabase, getDatabase } from '../src/server/db.js';
import { addMonthItem } from '../src/server/months.js';

const NU = '2026-09-25T10:00:00.000Z';
const IP = '198.51.100.7';
const EPOST = 'anna@example.se';
const KOD = '123456';
const MANAD = '2026-10';

// Texten ur tabellen i ARKITEKTUR.md under "Byta plan".
const FEL_PLAN = 'Välj Bas, Plus eller Premium.';
const EJ_TOLKBAR = 'Kunde inte tolka anropet.';

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

// setImmediate och inte queueMicrotask: lyssnarna i readBody sätts upp under den
// synkrona delen av handleApiRequest.
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
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-plan-'));
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
    async call(method, pathname, { body, rawBody, cookie, now = NU } = {}) {
      const res = new MockResponse();
      const text = rawBody === undefined
        ? (body === undefined ? undefined : JSON.stringify(body))
        : rawBody;
      const handled = await handleApiRequest(
        makeRequest(method, text, { cookie }),
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

function userRow(db, email) {
  return db.prepare('SELECT id, email, created_at, plan FROM users WHERE email = ?').get(email);
}

// De funktioner en plan har, räknat ur FEATURES och hasFeature. Används som
// jämförelsevärde: svaret ska bära exakt den listan, och testet skriver därför
// inte av någon lista för hand.
function funktionerFor(plan) {
  return FEATURES.filter((feature) => hasFeature(plan, feature));
}

test('GET /api/plan ger 200 med kontots plan och dess funktioner', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  const { handled, res } = await call('GET', '/api/plan', { cookie });
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  // Ett nytt konto har 'bas' genom kolumnens förval, och inget i inloggningen
  // sätter planen.
  assert.deepEqual(res.body, { plan: 'bas', features: funktionerFor('bas') });
  // Listan är de tre bas-funktionerna och inga andra: Plus och Premium ingår
  // inte, och arvet går bara uppåt.
  assert.deepEqual(res.body.features, ['budget', 'billReminders', 'overview']);
});

// (P11) PUT /api/plan byter, och GET visar den nya.
test('(P11) PUT /api/plan byter plan, och GET visar den nya', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  // Varje plan i PLANS prövas, i ordning: listan kommer ur modulen och skrivs
  // inte av här, så mutationen "lägg till en plan" fäller det här fallet.
  for (const plan of Object.keys(PLANS)) {
    const { res } = await call('PUT', '/api/plan', { cookie, body: { plan } });
    assert.equal(res.statusCode, 200, `${plan}: ${res.text}`);
    assert.deepEqual(res.body, { plan, features: funktionerFor(plan) }, plan);

    // GET efter PUT ger samma svar: planen ligger i databasen och inte bara i
    // PUT:ens svarskropp.
    const efter = await call('GET', '/api/plan', { cookie });
    assert.equal(efter.res.statusCode, 200);
    assert.deepEqual(efter.res.body, { plan, features: funktionerFor(plan) }, plan);

    // Och raden i databasen bär värdet, inte bara svaret.
    assert.equal(userRow(db, EPOST).plan, plan, plan);
  }

  // Premium har varje lägre plans funktioner, så listan växer med arvet: det är
  // skillnaden mellan svaret och PLANS[plan].features.
  const { res } = await call('PUT', '/api/plan', { cookie, body: { plan: 'premium' } });
  assert.equal(res.body.features.length, FEATURES.length);
  assert.deepEqual(res.body.features, [...FEATURES]);
});

// (P12) Okänd plan ger 400, med texten ordagrant.
test('(P12) PUT /api/plan ger 400 med texten vid okänd plan, och ändrar ingenting', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  // Utgångsläget är 'plus', så ett fel inte kan se ut som en lyckad ändring
  // tillbaka till förvalet.
  await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(userRow(db, EPOST).plan, 'plus');

  for (const plan of [
    'guld',
    'Bas',
    'bas ',
    '',
    'constructor',
    'toString',
    '__proto__',
    undefined,
    null,
    42,
    true,
    ['bas'],
    { plan: 'bas' }
  ]) {
    const { res } = await call('PUT', '/api/plan', { cookie, body: { plan } });
    assert.equal(res.statusCode, 400, `${JSON.stringify(plan)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_PLAN }, JSON.stringify(plan));
    // Datalagret nåddes aldrig: valideringen står före det.
    assert.equal(userRow(db, EPOST).plan, 'plus', JSON.stringify(plan));
  }

  // En kropp som inte är ett objekt, och en kropp utan fältet alls, ger samma
  // 400 med samma text.
  for (const body of [null, 'bas', 42, [], {}, { plans: 'bas' }]) {
    const { res } = await call('PUT', '/api/plan', { cookie, body });
    assert.equal(res.statusCode, 400, `${JSON.stringify(body)}: ${res.text}`);
    assert.deepEqual(res.body, { error: FEL_PLAN }, JSON.stringify(body));
  }

  // En kropp som inte är JSON ger kroppsfelets text och inte planfelets: de två
  // felen har två texter, och ordningen är bindande — kroppen tolkas före
  // fältet prövas.
  const trasig = await call('PUT', '/api/plan', { cookie, rawBody: '{plan:' });
  assert.equal(trasig.res.statusCode, 400);
  assert.deepEqual(trasig.res.body, { error: EJ_TOLKBAR });
  assert.equal(userRow(db, EPOST).plan, 'plus');
});

// (P10):s första hälft. Hälften om 403 kräver en väg skyddad av en
// Plus-funktion och är lämnad tillbaka till arkitekten; se filens inledning.
test('GET och PUT /api/plan utan session ger 401 och rensar cookien', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const method of ['GET', 'PUT']) {
    // Ingen cookie alls.
    const utan = await call(method, '/api/plan', { body: { plan: 'plus' } });
    assert.equal(utan.res.statusCode, 401, method);
    assert.deepEqual(utan.res.body, { error: NOT_LOGGED_IN_MESSAGE }, method);
    assert.match(utan.res.cookie, /Max-Age=0/, method);

    // En cookie som inte hör till någon session.
    const fel = await call(method, '/api/plan', {
      cookie: 'hemochekonomi_session=finns-inte',
      body: { plan: 'plus' }
    });
    assert.equal(fel.res.statusCode, 401, method);
    assert.deepEqual(fel.res.body, { error: NOT_LOGGED_IN_MESSAGE }, method);
  }

  // Sessionsspärren står före valideringen: en okänd plan utan session ger 401
  // och inte 400. Annars avslöjar svaret vilka planer som finns för den som
  // inte är inloggad.
  const okand = await call('PUT', '/api/plan', { body: { plan: 'guld' } });
  assert.equal(okand.res.statusCode, 401);
  assert.deepEqual(okand.res.body, { error: NOT_LOGGED_IN_MESSAGE });

  // Ingen rad ändrades av något av anropen ovan.
  assert.equal(userRow(db, EPOST).plan, 'bas');
  // Och med session fungerar vägen, så 401 inte kommer av något annat.
  const med = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(med.res.statusCode, 200);
});

// (P13) Nedgradering raderar ingen data.
test('(P13) nedgradering raderar inget: en rad skapad på Plus är oförändrad efter ned- och uppgradering', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const userId = userRow(db, EPOST).id;

  // Uppgradera till Plus och skapa data där.
  const upp = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(upp.res.statusCode, 200);

  const { res: skapad } = await call('POST', `/api/manad/${MANAD}`, {
    cookie,
    body: { kind: 'saving', name: 'Sparmål: resa', amountSek: '1500,50', category: 'other' }
  });
  assert.equal(skapad.statusCode, 201, skapad.text);
  // Dessutom en mall, så att provet gäller mer än en tabell.
  addMonthItem(
    userId,
    MANAD,
    { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' },
    { db, now: NU, makeId: () => 'm-hyra' }
  );

  // Varje rad i de två tabellerna, läst före nedgraderingen.
  const las = () => ({
    monthItems: db.prepare('SELECT id, user_id, month, kind, name, amount_ore, category, created_at FROM month_items WHERE user_id = ? ORDER BY id').all(userId),
    templates: db.prepare('SELECT id, series_id, kind, name, amount_ore FROM templates WHERE user_id = ? ORDER BY id').all(userId)
  });
  const fore = las();
  assert.equal(fore.monthItems.length, 2, 'utgångsläget ska ha två poster');

  // Ned till Bas. Inget raderas.
  const ned = await call('PUT', '/api/plan', { cookie, body: { plan: 'bas' } });
  assert.equal(ned.res.statusCode, 200);
  assert.deepEqual(ned.res.body, { plan: 'bas', features: funktionerFor('bas') });

  const underBas = las();
  // En billigare assertion först, som fäller med ett läsbart besked innan
  // deepEqual bygger en diff: antalet rader (LARDOMAR.md 2026-09-07).
  assert.equal(underBas.monthItems.length, fore.monthItems.length, 'en rad försvann vid nedgraderingen');
  assert.deepEqual(underBas, fore, 'raderna ändrades av nedgraderingen');

  // Upp igen. Fortfarande oförändrat, byte för byte.
  const igen = await call('PUT', '/api/plan', { cookie, body: { plan: 'premium' } });
  assert.equal(igen.res.statusCode, 200);
  const efter = las();
  assert.equal(efter.monthItems.length, fore.monthItems.length, 'en rad försvann vid uppgraderingen');
  assert.deepEqual(efter, fore, 'raderna ändrades av uppgraderingen');

  // Och data är synlig igen genom appens egen väg: samma två poster, samma
  // summor.
  const manad = await call('GET', `/api/manad/${MANAD}`, { cookie });
  assert.equal(manad.res.statusCode, 200);
  assert.deepEqual(
    manad.res.body.items.map((item) => [item.kind, item.name, item.amountOre]),
    [
      ['expense', 'Hyra', 1250000],
      ['saving', 'Sparmål: resa', 150050]
    ]
  );
});

test('en annan metod mot /api/plan ger 405', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const method of ['POST', 'DELETE', 'PATCH']) {
    const { handled, res } = await call(method, '/api/plan', { cookie, body: { plan: 'plus' } });
    assert.equal(handled, true, method);
    assert.equal(res.statusCode, 405, method);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, method);
  }
  // Planen är oförändrad: 405 rör inte datalagret.
  assert.equal(userRow(db, EPOST).plan, 'bas');
});

test('/api/plan/ och /api/planer är okända adresser', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);

  for (const pathname of ['/api/plan/', '/api/plan/bas', '/api/planer']) {
    const { handled, res } = await call('GET', pathname, { cookie });
    assert.equal(handled, true, pathname);
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});
