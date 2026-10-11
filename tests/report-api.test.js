// Rapportens datalager och två API-vägar [steg 5]: readReport i
// src/server/reports.js och GET /api/rapport/<ÅÅÅÅ-MM>/<N>[/csv] i
// src/server/api.js.
//
// Kravlistan är (RA17) till (RA23) i ARKITEKTUR.md under "Kravlista [steg 5]".
// Utöver dem prövas spärrtabellen "Ingångsspärrar i src/server/reports.js" rad
// för rad. De fallen bär inget (RA)-nummer, därför att tabellen är deras facit
// och ett nummer utan en punkt i kravlistan ser ut som en hänvisning utan att
// vara en (LARDOMAR.md 2026-09-14).
//
// Testar handleApiRequest direkt, utan att starta en server, med en riktig
// databas i en fil per testfall — samma rigg som tests/goal-api.test.js.
//
// Varje assert.throws asserterar hela message (LARDOMAR.md 2026-09-16).
//
// Ingen tid och inget datum läses ur klockan: now skickas in i varje anrop, och
// varje månad står som en literal. En rapport är historik.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { toCsv } from '../src/core/csv.js';
import { PLANS, PLAN_LABELS, hasFeature } from '../src/core/plans.js';
import { reportRows } from '../src/core/report.js';
import { reportCsvRows } from '../src/core/report-csv.js';
import { NOT_LOGGED_IN_MESSAGE, requestCode } from '../src/server/auth.js';
import { DATABASE_MESSAGES, MEMORY_PATH, closeDatabase, getDatabase, openDatabase } from '../src/server/db.js';
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

// Texterna ur tabellerna i ARKITEKTUR.md, skrivna en gång här.
const FEL_MANAD = 'Månaden måste anges som ÅÅÅÅ-MM.';
const OKAND_ADRESS = 'Okänd adress.';
const METOD = 'Metoden stöds inte.';
// Antalets text interpoleras ur taket i months.js, precis som i api.js: talen
// har en ägare och skrivs inte av. Att de är 1 och 36 prövas för sig nedan.
const FEL_ANTAL = `Antalet månader måste vara mellan ${OVERVIEW_MIN_MONTHS} och ${OVERVIEW_MAX_MONTHS}.`;
// 403-texten sätts samman av requireFeature ur PLAN_LABELS, precis som i
// tests/goal-api.test.js: samma kropp som sparmålens, med en annan feature.
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
// samma rigg som tests/goal-api.test.js.
async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-rapport-'));
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

// Loggar in och höjer planen till Plus genom PUT /api/plan — appens egen väg.
// Nya konton får 'bas' av kolumnens DEFAULT.
async function loggaInSomPlus(db, call, options) {
  const cookie = await loggaIn(db, call, options);
  const { res } = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(res.statusCode, 200, res.text);
  return cookie;
}

function userId(db, email) {
  return db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
}

let nästaId = 0;
const nyttId = () => {
  nästaId += 1;
  return `id-${nästaId}`;
};

// Annas tre månader, augusti till oktober 2026:
//   Hyra, en månadsmall för boende på 12 500 kr från augusti
//   Tandläkare, en engångsutgift i september på 950 kr
//   Lön, en engångsinkomst i oktober på 30 000 kr
//   ett tak för boende på 12 000 kr i september (sprack) och 12 500 kr i
//   oktober (lika med taket, alltså inte över det)
function annasPoster(db, anna) {
  addTemplate(anna, '2026-08', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing', interval: 'monthly', toMonth: null }, { db, now: NU, makeId: nyttId });
  addMonthItem(anna, '2026-09', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NU, makeId: nyttId });
  addMonthItem(anna, '2026-10', { kind: 'income', name: 'Lön', amountOre: 3000000, category: 'other' }, { db, now: NU, makeId: nyttId });
  setBudget(anna, '2026-09', 'housing', 1200000, { db, now: NU, makeId: nyttId });
  setBudget(anna, '2026-10', 'housing', 1250000, { db, now: NU, makeId: nyttId });
}

// Berits poster i samma månader. Kategorier och belopp som Anna inte har, så att
// ett läckage syns som en rad eller ett tal som inte ska finnas.
function beritsPoster(db, berit) {
  addMonthItem(berit, '2026-09', { kind: 'saving', name: 'Buffert', amountOre: 77700, category: 'loan' }, { db, now: NU, makeId: nyttId });
  addMonthItem(berit, '2026-10', { kind: 'expense', name: 'Bil', amountOre: 333300, category: 'transport' }, { db, now: NU, makeId: nyttId });
  setBudget(berit, '2026-10', 'housing', 100, { db, now: NU, makeId: nyttId });
}

// Annas rapport, skriven ut för hand ur posterna ovan. Raderna står i
// ITEM_KINDS ordning och därefter CATEGORIES ordning (beslut 1).
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

function kastar(fn, message, etikett) {
  assert.throws(fn, (error) => error instanceof RangeError && error.message === message, etikett);
}

const namn = (value) => (Array.isArray(value) ? `[${String(value)}]` : String(value));

// Varje värde som inte är ett heltal inom taket. 0 och 37 är gränsernas
// grannar; -0 står med därför att Number.isInteger(-0) är sant och värdet därför
// når jämförelsen, där -0 < 1 fäller det (LARDOMAR.md 2026-09-02). 1n och
// Symbol('x') kastar TypeError ur en jämförelse eller interpolation där varje
// annan typ tvingas fram (LARDOMAR.md 2026-08-24).
const OGILTIGA_ANTAL = [0, -0, -1, 37, 1000, 1.5, 12.5, NaN, Infinity, -Infinity, '12', '', null, undefined, true, {}, [], [1], new Date(), 1n, Symbol('x')];

// Varje värde som inte är en månad på formen ÅÅÅÅ-MM.
const OGILTIGA_MANADER = ['2026-13', '2026-00', '2026-1', '26-10', '2026-10-01', ' 2026-10', '', null, undefined, 202610, -0, NaN, {}, [], ['2026-10'], new Date(), 1n, Symbol('x')];

// ---------------------------------------------------------------------------
// Taket: konstanterna exporteras ur months.js och läses därifrån.
// ---------------------------------------------------------------------------

test('taket exporteras ur months.js som 1 och 36', () => {
  assert.equal(OVERVIEW_MIN_MONTHS, 1);
  assert.equal(OVERVIEW_MAX_MONTHS, 36);
});

test('(RA35) textspärren mot taket i reports.js kräver bindningen, med kommentarerna bortrensade', async () => {
  // ARKITEKTUR.md: "1 och 36 står aldrig skrivna i reports.js". Spärren söker
  // inte efter stavningar av talet, eftersom den förra versionen gick förbi med
  // 3 * 12 och med kravtexten flyttad till en kommentar (LARDOMAR.md 2026-10-10).
  // I stället rensas kommentarerna bort först, och därefter krävs att båda
  // jämförelserna i rad 2 läser sina namn ur months.js. Ett tak i någon annan
  // stavning — literalen, ett uttryck eller en lokal konstant — tar bort den
  // jämförelsen och fäller testet.
  const källa = await fs.readFile(new URL('../src/server/reports.js', import.meta.url), 'utf8');
  const kod = källa.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  // Villkoret står på en rad i koden, men jämförelsen görs efter att blanktecken
  // normaliserats, så att en omradbrytning inte fäller testet.
  const platt = kod.replace(/\s+/g, ' ');
  assert.equal(
    platt.includes('if (!Number.isInteger(count) || count < OVERVIEW_MIN_MONTHS || count > OVERVIEW_MAX_MONTHS) {'),
    true,
    'rad 2 i reports.js läser inte golvet och taket ur months.js'
  );
  // Namnen är de importerade ur months.js och inga lokala bindningar med samma
  // namn.
  assert.equal(
    platt.includes("import { OVERVIEW_MAX_MONTHS, OVERVIEW_MIN_MONTHS, readMonth } from './months.js';"),
    true,
    'golvet och taket importeras inte ur months.js'
  );
  assert.equal(/\b(const|let|var)\s+OVERVIEW_(MIN|MAX)_MONTHS\b/.test(kod), false, 'en lokal kopia av taket');
  // Och talet 36 står inte i koden i någon form som en siffra.
  assert.equal(/\b36\b/.test(kod), false, 'talet 36 står i reports.js');
});

// ---------------------------------------------------------------------------
// Spärrtabellen "Ingångsspärrar i src/server/reports.js", rad för rad.
// ---------------------------------------------------------------------------

test('rad 1: en slutmånad som inte är ÅÅÅÅ-MM ger rad 1:s text', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_MANADER) {
    kastar(
      () => readReport('u-1', value, 3, { db }),
      `readReport kräver en månad på formen ÅÅÅÅ-MM, fick "${String(value)}".`,
      namn(value)
    );
  }
});

test('rad 1 vinner över rad 2 när båda är fel', async (t) => {
  const { db } = await apiDatabase(t);
  kastar(() => readReport('u-1', '2026-13', 99, { db }), 'readReport kräver en månad på formen ÅÅÅÅ-MM, fick "2026-13".');
});

test('rad 2: ett antal som inte är ett heltal mellan 1 och 36 ger rad 2:s text', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_ANTAL) {
    kastar(
      () => readReport('u-1', SLUT, value, { db }),
      `readReport kräver ett antal månader mellan 1 och 36, fick "${String(value)}".`,
      namn(value)
    );
  }
});

test('rad 2 godtar båda gränserna, 1 och 36', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual(readReport('u-1', SLUT, 1, { db }).months, [SLUT]);
  const lång = readReport('u-1', SLUT, 36, { db }).months;
  assert.equal(lång.length, 36);
  assert.equal(lång[0], '2023-11');
  assert.equal(lång[35], SLUT);
});

// ---------------------------------------------------------------------------
// (RA17) Taket ärvs ur readOverview: samma meddelandeform för samma indata.
// ---------------------------------------------------------------------------

test('(RA17) readReport med ett antal utanför taket ger samma meddelandeform som readOverview', async (t) => {
  const { db } = await apiDatabase(t);
  for (const value of OGILTIGA_ANTAL) {
    let översikten;
    try {
      readOverview('u-1', SLUT, value, { db });
    } catch (error) {
      översikten = error.message;
    }
    assert.equal(typeof översikten, 'string', `readOverview godtog ${namn(value)}`);
    // Samma form: texten är densamma när funktionens namn byts.
    kastar(() => readReport('u-1', SLUT, value, { db }), översikten.replace('readOverview', 'readReport'), namn(value));
  }
});

test('(RA17) readReport och readOverview godtar samma antal, gräns för gräns', async (t) => {
  const { db } = await apiDatabase(t);
  for (const count of [OVERVIEW_MIN_MONTHS, 2, 12, OVERVIEW_MAX_MONTHS]) {
    assert.equal(readOverview('u-1', SLUT, count, { db }).months.length, count);
    assert.equal(readReport('u-1', SLUT, count, { db }).months.length, count);
  }
});

// ---------------------------------------------------------------------------
// readReport mot riktiga poster. Formen ägs av reportRows; här prövas att
// månaderna läses genom readMonth och kommer i rätt ordning.
// ---------------------------------------------------------------------------

test('readReport ger rapporten ur readMonth, äldst först, med taket per månad', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  const anna = userId(db, EPOST);
  annasPoster(db, anna);
  assert.deepEqual(readReport(anna, SLUT, 3, { db }), ANNAS_RAPPORT);
});

test('readReport är reportRows över readMonth för varje månad, ingen egen räkning', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  const anna = userId(db, EPOST);
  annasPoster(db, anna);
  const månader = ['2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'];
  const väntat = reportRows(månader.map((month) => {
    const { items, budgets } = readMonth(anna, month, { db });
    return { month, items, budgets };
  }));
  assert.deepEqual(readReport(anna, SLUT, 6, { db }), väntat);
  // Tomma månader står med som nollor och utelämnas inte.
  assert.deepEqual(väntat.rows[1].perMonthOre, [0, 0, 0, 1250000, 1250000, 1250000]);
  assert.equal(väntat.rows[1].averageOre, 625000);
});

test('(RA37) readReport läser ur den databas den får, och aldrig ur getDatabase()', async (t) => {
  // Den delade anslutningen i riggen är tom, och posterna står i en egen
  // databas i minnet. Svaret ska komma ur den senare: { db } förs vidare till
  // varje readMonth, och ett anrop utan det hade läst den delade anslutningen.
  await apiDatabase(t);
  const minne = openDatabase(MEMORY_PATH);
  t.after(() => minne.close());
  minne.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run('u-anna', EPOST, NU);
  annasPoster(minne, 'u-anna');
  assert.deepEqual(readReport('u-anna', SLUT, 3, { db: minne }), ANNAS_RAPPORT);
});

test('readReport över ett årsskifte ger månaderna i stigande ordning', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual(readReport('u-1', '2027-02', 4, { db }).months, ['2026-11', '2026-12', '2027-01', '2027-02']);
});

test('readReport för en användare utan poster ger en tom rapport, inget kast', async (t) => {
  const { db } = await apiDatabase(t);
  assert.deepEqual(readReport('ingen', SLUT, 3, { db }), { months: ['2026-08', '2026-09', '2026-10'], rows: [], largest: null });
});

// ---------------------------------------------------------------------------
// (RA18) Båda vägarna, statuskod för statuskod i tabellen: 200, 400, 401, 403,
// 404 och 500.
// ---------------------------------------------------------------------------

const JSON_TYP = 'application/json; charset=utf-8';
const CSV_TYP = 'text/csv; charset=utf-8';

function vägar(month = SLUT, count = '3') {
  return [`/api/rapport/${month}/${count}`, `/api/rapport/${month}/${count}/csv`];
}

test('(RA18) 200 på båda vägarna för Plus', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  annasPoster(db, userId(db, EPOST));
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
  // 0 och 37 är gränsernas grannar, 99 är ARKITEKTUR.md:s eget exempel, och det
  // sista talet är större än vad som ryms exakt i ett Number. 00 stod här tidigare
  // och ger sedan del 3 404, eftersom det inte är ett tal i kanonisk form; det
  // prövas i (RA31).
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
  // ARKITEKTUR.md: texten interpoleras ur OVERVIEW_MIN_MONTHS och
  // OVERVIEW_MAX_MONTHS "så att talen aldrig blir en tredje kopia". Värdet kan
  // inte skilja en interpolation från literalerna 1 och 36 — de ger samma
  // sträng — så skyddet läser källtexten (LARDOMAR.md 2026-09-10, förbudet mot
  // att summera kolumnen). Raden prövas oavsett stavning: med mall,
  // konkatenering eller ett anrop ska båda namnen stå där och ingen siffra.
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
  // ARKITEKTUR.md, "Inledande nollor ger 404 (beslutat i del 3)". Formen för N
  // är /^(0|[1-9][0-9]*)$/: 012 och 0012 vore annars en andra adress för samma
  // rapport, och det är den normalisering segmentAfter-regeln förbjuder.
  // Ersätter fallet "(RA18) gränserna 1 och 36 och ett tal med inledande nolla
  // ger 200", vars påstående om 012 är vänt.
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
  // "En sökväg av fel form ger 404 före metodfrågan" (ARKITEKTUR.md).
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
  annasPoster(db, userId(db, EPOST));
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

test('(RA18) 401 på båda vägarna utan session, och 401 vinner över 403, 400 och taket', async (t) => {
  const { call } = await apiDatabase(t);
  for (const väg of [...vägar(), ...vägar('2026-13'), ...vägar(SLUT, '99')]) {
    const { res } = await call('GET', väg);
    assert.equal(res.statusCode, 401, `${väg}: ${res.text}`);
    assert.deepEqual(res.body, { error: NOT_LOGGED_IN_MESSAGE }, väg);
  }
});

test('(RA18) 404 Okänd adress för ett N som inte är siffror och för en väg med fel form', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  // segmentAfter-regeln: ingen trimning, ingen avkodning och inget tecken. Ett
  // värde som inte matchar exakt finns inte.
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
  // Sessionen läser users och sessions; readMonth läser month_items. Utan den
  // tabellen kastar readRows DatabaseError med texten readFailed.
  db.exec('DROP TABLE month_items');
  for (const väg of vägar()) {
    const { res } = await call('GET', väg, { cookie });
    assert.equal(res.statusCode, 500, `${väg}: ${res.text}`);
    assert.equal(res.headers['Content-Type'], JSON_TYP, väg);
    assert.deepEqual(res.body, { error: DATABASE_MESSAGES.readFailed }, väg);
  }
});

test('(RA33) varje metod utom GET ger 405 på båda vägarna', async (t) => {
  // Villkoret är req.method === 'GET' och inte en uppräkning av förbjudna
  // metoder. PATCH och HEAD står med därför att de är de närliggande värden en
  // uppräkning av POST, PUT och DELETE släpper förbi (LARDOMAR.md 2026-10-10,
  // tre delvillkor). Vid HEAD prövas bara statuskoden: en HEAD-förfrågan har
  // ingen kropp i svaret.
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

// ---------------------------------------------------------------------------
// (RA19) Bas får 403 på båda vägarna, med samma kropp som sparmålens.
// ---------------------------------------------------------------------------

test('(RA19) Bas får 403 på båda vägarna, med feature och requiredPlan i svaret', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  // Förutsättningen, utskriven: ett nytt konto har Bas, och Bas saknar reports.
  assert.equal(db.prepare('SELECT plan FROM users WHERE email = ?').get(EPOST).plan, 'bas');
  assert.equal(hasFeature('bas', 'reports'), false);
  assert.equal(PLANS.plus.features.includes('reports'), true);
  annasPoster(db, userId(db, EPOST));

  // Behörigheten står före månadsspärren och antalet: också en ogiltig månad
  // och ett otillåtet antal ger 403.
  for (const väg of [...vägar(), ...vägar('2026-13'), ...vägar(SLUT, '99')]) {
    const { res } = await call('GET', väg, { cookie });
    assert.equal(res.statusCode, 403, `${väg}: ${res.text}`);
    assert.deepEqual(res.body, { error: LÅST, feature: 'reports', requiredPlan: 'plus' }, väg);
  }
});

test('(RA19) kroppen har samma form och samma text som sparmålens 403', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const sparmål = await call('GET', '/api/sparmal/2026-10-08', { cookie });
  const rapport = await call('GET', vägar()[0], { cookie });
  assert.equal(sparmål.res.statusCode, 403);
  assert.equal(rapport.res.statusCode, 403);
  assert.deepEqual(Object.keys(rapport.res.body), Object.keys(sparmål.res.body));
  assert.equal(rapport.res.body.error, sparmål.res.body.error);
  assert.equal(rapport.res.body.requiredPlan, sparmål.res.body.requiredPlan);
});

// ---------------------------------------------------------------------------
// (RA20) Plus får 200 på båda vägarna, och CSV-vägen svarar text/csv.
// ---------------------------------------------------------------------------

test('(RA20) Plus får 200 på samma vägar där Bas fick 403, och CSV-vägen är text/csv', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  annasPoster(db, userId(db, EPOST));
  for (const väg of vägar()) {
    assert.equal((await call('GET', väg, { cookie })).res.statusCode, 403, väg);
  }
  const uppgradering = await call('PUT', '/api/plan', { cookie, body: { plan: 'plus' } });
  assert.equal(uppgradering.res.statusCode, 200);

  const [jsonväg, csvväg] = vägar();
  const json = await call('GET', jsonväg, { cookie });
  assert.equal(json.res.statusCode, 200);
  assert.deepEqual(json.res.body, ANNAS_RAPPORT);

  const csv = await call('GET', csvväg, { cookie });
  assert.equal(csv.res.statusCode, 200);
  assert.equal(csv.res.headers['Content-Type'], 'text/csv; charset=utf-8');
  assert.equal(csv.res.headers['Content-Length'], Buffer.byteLength(csv.res.text));
  // Filen ordagrant: BOM, rubrikraden, en rad per (kind, category, månad) och
  // CR LF efter varje rad. Escaperna står för tecken som inte syns
  // (LARDOMAR.md 2026-09-14).
  assert.equal(csv.res.text, [
    '\uFEFFSlag;Kategori;Månad;Belopp;Tak;Över tak',
    'Inkomst;Övrigt;2026-08;0,00;;',
    'Inkomst;Övrigt;2026-09;0,00;;',
    'Inkomst;Övrigt;2026-10;30000,00;;',
    'Utgift;Boende;2026-08;12500,00;;',
    'Utgift;Boende;2026-09;12500,00;12000,00;Ja',
    'Utgift;Boende;2026-10;12500,00;12500,00;Nej',
    'Utgift;Övrigt;2026-08;0,00;;',
    'Utgift;Övrigt;2026-09;950,00;;',
    'Utgift;Övrigt;2026-10;0,00;;',
    ''
  ].join('\r\n'));
});

test('(RA20) Premium ärver reports och får 200 på båda vägarna', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const { res } = await call('PUT', '/api/plan', { cookie, body: { plan: 'premium' } });
  assert.equal(res.statusCode, 200);
  for (const väg of vägar()) {
    assert.equal((await call('GET', väg, { cookie })).res.statusCode, 200, väg);
  }
});

// ---------------------------------------------------------------------------
// (RA21) Ett fel på CSV-vägen svarar med JSON, inte med CSV.
// ---------------------------------------------------------------------------

test('(RA21) ett 403 på CSV-vägen svarar JSON och inte CSV', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaIn(db, call);
  const { res } = await call('GET', vägar()[1], { cookie });
  assert.equal(res.statusCode, 403);
  assert.equal(res.headers['Content-Type'], JSON_TYP);
  assert.equal(Object.hasOwn(res.headers, 'Content-Disposition'), false);
  assert.equal(res.text.startsWith('\uFEFF'), false);
  assert.deepEqual(res.body, { error: LÅST, feature: 'reports', requiredPlan: 'plus' });
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
  db.exec('DROP TABLE month_items');
  fel.push(await call('GET', vägar()[1], { cookie }));
  assert.deepEqual(fel.map(({ res }) => res.statusCode), [401, 400, 400, 404, 405, 500]);
  for (const { res } of fel) {
    assert.equal(res.headers['Content-Type'], JSON_TYP, String(res.statusCode));
    assert.equal(Object.hasOwn(res.headers, 'Content-Disposition'), false, String(res.statusCode));
    assert.equal(typeof res.body.error, 'string', String(res.statusCode));
  }
});

// ---------------------------------------------------------------------------
// (RA22) Filnamnet är rent ASCII, huvudet läst ordagrant.
// ---------------------------------------------------------------------------

test('(RA22) Content-Disposition är ordagrant attachment med ett filnamn i rent ASCII', async (t) => {
  const { db, call } = await apiDatabase(t);
  const cookie = await loggaInSomPlus(db, call);
  for (const month of [SLUT, '2027-01', '1999-12']) {
    const { res } = await call('GET', vägar(month)[1], { cookie });
    assert.equal(res.statusCode, 200, res.text);
    const huvud = res.headers['Content-Disposition'];
    assert.equal(huvud, `attachment; filename="hemochekonomi-${month}.csv"`);
    // Varje tecken är synlig ASCII, U+0020 till U+007E: ingen svensk bokstav och
    // inget som kräver RFC 5987-kodning.
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

// ---------------------------------------------------------------------------
// (RA23) En annan användares data syns inte.
// ---------------------------------------------------------------------------

test('(RA23) readReport visar bara användarens egna poster och tak', async (t) => {
  const { db, call } = await apiDatabase(t);
  await loggaIn(db, call);
  await loggaIn(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const anna = userId(db, EPOST);
  const berit = userId(db, ANNAN_EPOST);
  annasPoster(db, anna);
  beritsPoster(db, berit);

  assert.deepEqual(readReport(anna, SLUT, 3, { db }), ANNAS_RAPPORT);
  assert.deepEqual(readReport(berit, SLUT, 3, { db }).rows.map((r) => [r.kind, r.category, r.perMonthOre, r.budgetPerMonthOre]), [
    ['expense', 'housing', [0, 0, 0], [null, null, 100]],
    ['expense', 'transport', [0, 0, 333300], [null, null, null]],
    ['saving', 'loan', [0, 77700, 0], [null, null, null]]
  ]);
});

test('(RA23) båda API-vägarna visar bara den inloggades data', async (t) => {
  const { db, call } = await apiDatabase(t);
  const anna = await loggaInSomPlus(db, call);
  const berit = await loggaInSomPlus(db, call, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  annasPoster(db, userId(db, EPOST));
  beritsPoster(db, userId(db, ANNAN_EPOST));

  const [jsonväg, csvväg] = vägar();
  assert.deepEqual((await call('GET', jsonväg, { cookie: anna })).res.body, ANNAS_RAPPORT);
  const annasFil = (await call('GET', csvväg, { cookie: anna })).res.text;
  assert.equal(annasFil, toCsv(reportCsvRows(ANNAS_RAPPORT)));
  // Berits kategorier och belopp syns inte i Annas fil.
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
