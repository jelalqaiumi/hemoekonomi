// Etapp 2: inloggningen med engångskod. Kravlistan (A1) till (A12) i
// ARKITEKTUR.md under "Inloggning med engångskod", med varje felmeddelande
// asserterat ordagrant mot AUTH_MESSAGES — texterna ägs av src/server/auth.js
// och skrivs därför inte av som literaler här.
//
// Filen läser ingen klocka. Varje tidsstämpel är en literal som skickas in som
// parametern now, på samma sätt som dagens datum injiceras i tests/app.test.js.
// En sökning efter klockans källor i den här filen ska ge noll träffar:
// grep -nE "\b(Date|Temporal|performance|hrtime|todayIso|nowIso|setTimeout|setInterval|setImmediate|AbortSignal)\b|Promise\.race" tests/auth.test.js
// — setImmediate är det enda undantaget, och det står i makeRequest nedan, som
// bara flödar ut en ström och inte läser någon tid.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  AUTH_MESSAGES,
  CODE_LENGTH,
  CODE_MAX_ATTEMPTS,
  CODE_TTL_MS,
  EMAIL_WINDOW_MS,
  IP_WINDOW_MS,
  SALT_BYTES,
  SCRYPT_KEYLEN,
  EMAIL_MAX_PER_WINDOW,
  IP_MAX_PER_WINDOW,
  NOT_LOGGED_IN_MESSAGE,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  UNKNOWN_IP,
  authenticate,
  clientIp,
  logOut,
  requestCode,
  requireSession,
  sessionCookie,
  verifyCode
} from '../src/server/auth.js';
import {
  DATABASE_MESSAGES,
  DatabaseError,
  MEMORY_PATH,
  closeDatabase,
  getDatabase,
  openDatabase
} from '../src/server/db.js';

// Källtexten till src/server/auth.js. Två av modulens egenskaper går inte att se
// i ett värde — en jämförelse som tar lika lång tid oavsett utfall, och ett tal
// som är skrivet som en konstant i stället för som en literal — och prövas
// därför i texten. Sökvägen byggs ur import.meta.url och aldrig ur
// process.cwd(): ett test ska gå att köra från en annan katalog (LARDOMAR.md
// 2026-09-04).
const AUTH_SOURCE = await fs.readFile(
  fileURLToPath(new URL('../src/server/auth.js', import.meta.url)),
  'utf8'
);

// Tidsstämplarna är literaler, aldrig räknade ur en klocka. Relationerna mellan
// dem står utskrivna, och testfallet "tidsstämplarna i filen svarar mot
// konstanterna" nedan prövar dem mot CODE_TTL_MS och SESSION_TTL_MS utan att
// läsa någon tid.
const NU = '2026-09-25T10:00:00.000Z';
// NU + CODE_TTL_MS (tio minuter) plus en millisekund: koden har då gått ut.
const EFTER_TTL = '2026-09-25T10:10:00.001Z';
// NU + SESSION_TTL_MS (30 dygn) plus en millisekund: sessionen har då gått ut.
const EFTER_SESSION = '2026-10-25T10:00:00.001Z';

const EPOST = 'anna@example.se';
const ANNAN_EPOST = 'bo@example.se';
const KOD = '123456';
const ANNAN_KOD = '654321';
const FEL_KOD = '000000';
const IP = '198.51.100.7';
const ANNAN_IP = '203.0.113.9';

// Sekunderna i cookiens Max-Age, räknade ur konstanten och aldrig skrivna som
// ett tal: 30 dygn i millisekunder delat med 1000.
const MAX_AGE_SEKUNDER = SESSION_TTL_MS / 1000;

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
// Ingen tid läses — anropet flödar bara ut strömmen.
function makeRequest(method, body, { cookie, forwardedFor, remoteAddress = IP } = {}) {
  const req = new EventEmitter();
  req.method = method;
  req.headers = {};
  if (typeof cookie === 'string') {
    req.headers.cookie = cookie;
  }
  if (typeof forwardedFor === 'string') {
    req.headers['x-forwarded-for'] = forwardedFor;
  }
  req.socket = { remoteAddress };
  setImmediate(() => {
    if (typeof body === 'string') {
      req.emit('data', Buffer.from(body, 'utf8'));
    }
    req.emit('end');
  });
  return req;
}

// Databasen för ett testfall som går genom auth.js direkt: en egen i minnet, så
// att inget fall kan se en rad ett annat fall skrev.
function freshDatabase() {
  return openDatabase(MEMORY_PATH);
}

// Databasen för ett testfall som går genom handleApiRequest: api.js hämtar sin
// anslutning med getDatabase(), som läser HEMOCHEKONOMI_DB_FILE. En fil per
// testfall, och den delade anslutningen stängs både före och efter.
async function apiDatabase(t) {
  const { handleApiRequest } = await import('../src/server/api.js');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-auth-'));
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

// Begär en kod med en känd kod i stället för en slumpad. Injektionen är samma
// mönster som makeId i createEntry: testet ska kunna veta vilken kod som
// skickades utan att koden lämnar modulen i produktionskoden.
async function begarKod(db, { email = EPOST, ip = IP, now = NU, kod = KOD } = {}) {
  return requestCode(db, { email, ip, now, makeCode: () => kod });
}

// Raden i login_codes för en adress, läst genom user_id enligt ägarregeln.
function kodrader(db, email) {
  const user = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
  if (user === undefined) {
    return [];
  }
  return db
    .prepare(`SELECT id, attempts, consumed_at, superseded_at, expires_at
                FROM login_codes WHERE user_id = ? ORDER BY created_at DESC, rowid DESC`)
    .all(user.id);
}

test('tidsstämplarna i filen svarar mot konstanterna', () => {
  // Relationen mellan literalerna prövas utan att någon klocka läses: talen
  // kommer ur auth.js konstanter, och literalerna står överst i filen.
  assert.equal(CODE_TTL_MS, 10 * 60 * 1000, 'CODE_TTL_MS är tio minuter');
  assert.equal(EFTER_TTL, '2026-09-25T10:10:00.001Z', 'EFTER_TTL är NU + CODE_TTL_MS + 1 ms');
  assert.equal(SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000, 'SESSION_TTL_MS är 30 dygn');
  assert.equal(EFTER_SESSION, '2026-10-25T10:00:00.001Z', 'EFTER_SESSION är NU + SESSION_TTL_MS + 1 ms');
});

test('rad 1: en adress utan giltigt format avvisas på båda vägarna', async () => {
  const db = freshDatabase();
  for (const trasig of ['', '   ', 'anna', 'anna@example', 'anna@@example.se', 'a b@example.se', null, 42, {}]) {
    const begaran = await begarKod(db, { email: trasig });
    assert.equal(begaran.status, 400, `begäran för ${String(trasig)}`);
    assert.equal(begaran.message, AUTH_MESSAGES.invalidEmail);
    const inloggning = verifyCode(db, { email: trasig, code: KOD, now: NU });
    assert.equal(inloggning.status, 400, `inloggning för ${String(trasig)}`);
    assert.equal(inloggning.message, AUTH_MESSAGES.invalidEmail);
  }
  // Ingen rad skrevs för någon av dem: rad 1 vinner före allt annat.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM users').get().antal, 0);
  db.close();
});

test('rad 2: en kod som inte är sex siffror avvisas', async () => {
  const db = freshDatabase();
  await begarKod(db);
  for (const trasig of ['', '12345', '1234567', '12345a', ' 123456', '123 456', null, 123456, {}]) {
    const svar = verifyCode(db, { email: EPOST, code: trasig, now: NU });
    assert.equal(svar.status, 400, `kod ${String(trasig)}`);
    assert.equal(svar.message, AUTH_MESSAGES.invalidCodeFormat);
  }
  // Rad 2 vinner före rad 8: inget försök räknades upp.
  assert.equal(kodrader(db, EPOST)[0].attempts, 0);
  db.close();
});

test('(A1) en giltig kod loggar in', async (t) => {
  const { db, call } = await apiDatabase(t);
  assert.equal((await begarKod(db)).status, 202);

  const inloggning = await call('POST', '/api/auth/logga-in', { body: { email: EPOST, code: KOD } });
  assert.equal(inloggning.res.statusCode, 204, inloggning.res.text);
  assert.equal(inloggning.res.text, '', 'ingen kropp på 204');

  const cookie = inloggning.res.cookie;
  assert.match(cookie, new RegExp(`^${SESSION_COOKIE_NAME}=`), 'cookien heter hemochekonomi_session');
  assert.match(cookie, /; HttpOnly/, 'HttpOnly');
  assert.match(cookie, /; Path=\//, 'Path=/');
  assert.match(cookie, /; SameSite=Lax/, 'SameSite=Lax');
  assert.match(cookie, new RegExp(`; Max-Age=${MAX_AGE_SEKUNDER}$`), 'Max-Age ur SESSION_TTL_MS');
  assert.equal(/; Secure/.test(cookie), false, 'Secure sätts bara i drift');

  const mig = await call('GET', '/api/mig', { cookie });
  assert.equal(mig.res.statusCode, 200, mig.res.text);
  assert.deepEqual(mig.res.body, { email: EPOST });

  // Koden är förbrukad, och ingen klartextkod finns i raden.
  const rad = kodrader(db, EPOST)[0];
  assert.equal(rad.consumed_at, NU);
  const lagrad = db.prepare('SELECT code_hash, code_salt FROM login_codes WHERE id = ?').get(rad.id);
  assert.equal(lagrad.code_hash.includes(KOD), false, 'kodhashen innehåller inte koden');
  assert.equal(lagrad.code_salt.includes(KOD), false, 'saltet innehåller inte koden');
});

test('(A2) en utgången kod avvisas', async () => {
  const db = freshDatabase();
  await begarKod(db);
  const svar = verifyCode(db, { email: EPOST, code: KOD, now: EFTER_TTL });
  assert.equal(svar.status, 400);
  assert.equal(svar.message, AUTH_MESSAGES.codeExpired);
  // Samma kod strax innan gränsen duger: skillnaden är tiden och inget annat.
  assert.equal(verifyCode(db, { email: EPOST, code: KOD, now: NU }).status, 204);
  db.close();
});

test('(A3) en felaktig kod avvisas och räknar upp försöket', async () => {
  const db = freshDatabase();
  await begarKod(db);
  assert.equal(kodrader(db, EPOST)[0].attempts, 0);

  const svar = verifyCode(db, { email: EPOST, code: FEL_KOD, now: NU });
  assert.equal(svar.status, 400);
  assert.equal(svar.message, AUTH_MESSAGES.unknownCode);
  assert.equal(kodrader(db, EPOST)[0].attempts, 1, 'antalet försök ökat med ett');

  assert.equal(verifyCode(db, { email: EPOST, code: FEL_KOD, now: NU }).message, AUTH_MESSAGES.unknownCode);
  assert.equal(kodrader(db, EPOST)[0].attempts, 2);
  db.close();
});

test('(A4) en återanvänd kod avvisas', async () => {
  const db = freshDatabase();
  await begarKod(db);
  assert.equal(verifyCode(db, { email: EPOST, code: KOD, now: NU }).status, 204);

  const igen = verifyCode(db, { email: EPOST, code: KOD, now: NU });
  assert.equal(igen.status, 400);
  assert.equal(igen.message, AUTH_MESSAGES.codeConsumed);
  db.close();
});

test('(A5) för många försök bränner koden', async () => {
  const db = freshDatabase();
  await begarKod(db);
  for (let forsok = 1; forsok <= CODE_MAX_ATTEMPTS; forsok += 1) {
    const svar = verifyCode(db, { email: EPOST, code: FEL_KOD, now: NU });
    assert.equal(svar.message, AUTH_MESSAGES.unknownCode, `försök ${forsok}`);
    assert.equal(kodrader(db, EPOST)[0].attempts, forsok);
  }

  // Därefter den rätta koden: rad 4 vinner, och koden är bränd.
  const ratt = verifyCode(db, { email: EPOST, code: KOD, now: NU });
  assert.equal(ratt.status, 429);
  assert.equal(ratt.message, AUTH_MESSAGES.tooManyAttempts);
  assert.equal(kodrader(db, EPOST)[0].consumed_at, null, 'ingen session skapades');
  db.close();
});

test('(A6) en ersatt kod avvisas', async () => {
  const db = freshDatabase();
  await begarKod(db, { kod: KOD });
  await begarKod(db, { kod: ANNAN_KOD });

  const forsta = verifyCode(db, { email: EPOST, code: KOD, now: NU });
  assert.equal(forsta.status, 400);
  assert.equal(forsta.message, AUTH_MESSAGES.codeSuperseded);

  // Den senaste koden duger, och rad 6 gällde alltså kodens ordning och inte
  // dess giltighetstid: båda koderna är ogångna.
  assert.equal(verifyCode(db, { email: EPOST, code: ANNAN_KOD, now: NU }).status, 204);
  db.close();
});

test('(A7) okänd e-post avslöjas inte', async () => {
  const db = freshDatabase();
  // En adress med konto och en utan får samma svar på en begäran ...
  await begarKod(db, { email: EPOST });
  const okand = await begarKod(db, { email: ANNAN_EPOST });
  assert.equal(okand.status, 202);
  assert.equal(okand.message, undefined, 'ingen text på 202');

  // ... och samma text för en felaktig kod.
  const medKonto = verifyCode(db, { email: EPOST, code: FEL_KOD, now: NU });
  const utanKonto = verifyCode(db, { email: 'ingen@example.se', code: FEL_KOD, now: NU });
  assert.equal(medKonto.message, AUTH_MESSAGES.unknownCode);
  assert.equal(utanKonto.message, AUTH_MESSAGES.unknownCode);
  assert.equal(utanKonto.status, medKonto.status);
  db.close();
});

test('(A8) för många utskick per e-post', async () => {
  const db = freshDatabase();
  for (let nummer = 1; nummer <= EMAIL_MAX_PER_WINDOW; nummer += 1) {
    const svar = await begarKod(db);
    assert.equal(svar.status, 202, `utskick ${nummer}`);
  }

  const ettTill = await begarKod(db);
  assert.equal(ettTill.status, 429);
  assert.equal(ettTill.message, AUTH_MESSAGES.tooManyForEmail);
  assert.equal(kodrader(db, EPOST).length, EMAIL_MAX_PER_WINDOW, 'den spärrade begäran skrev ingen kod');
  db.close();
});

test('(A9) för många utskick per IP', async () => {
  const db = freshDatabase();
  // IP_MAX_PER_WINDOW utskick från samma adress, fördelade över flera
  // e-postadresser så att det är IP-gränsen och inte adressgränsen som nås.
  let utskick = 0;
  let adress = 0;
  while (utskick < IP_MAX_PER_WINDOW) {
    adress += 1;
    const email = `person${adress}@example.se`;
    for (let nummer = 0; nummer < EMAIL_MAX_PER_WINDOW && utskick < IP_MAX_PER_WINDOW; nummer += 1) {
      const svar = await begarKod(db, { email, ip: IP });
      assert.equal(svar.status, 202, `utskick ${utskick + 1}`);
      utskick += 1;
    }
  }

  const ettTill = await begarKod(db, { email: 'sist@example.se', ip: IP });
  assert.equal(ettTill.status, 429);
  assert.equal(ettTill.message, AUTH_MESSAGES.tooManyForIp);

  // En annan anslutning är opåverkad: gränsen gäller adressen den räknades på.
  assert.equal((await begarKod(db, { email: 'sist@example.se', ip: ANNAN_IP })).status, 202);
  db.close();
});

test('(A10) utloggning återkallar sessionen', async (t) => {
  const { db, call } = await apiDatabase(t);
  await begarKod(db);
  const inloggning = await call('POST', '/api/auth/logga-in', { body: { email: EPOST, code: KOD } });
  const cookie = inloggning.res.cookie;
  assert.equal((await call('GET', '/api/mig', { cookie })).res.statusCode, 200);

  const utloggning = await call('POST', '/api/auth/logga-ut', { cookie });
  assert.equal(utloggning.res.statusCode, 204);
  assert.match(utloggning.res.cookie, /Max-Age=0/, 'cookien upphör omedelbart');

  const efter = await call('GET', '/api/mig', { cookie });
  assert.equal(efter.res.statusCode, 401);
  assert.deepEqual(efter.res.body, { error: NOT_LOGGED_IN_MESSAGE });
  assert.match(efter.res.cookie, /Max-Age=0/, 'cookien rensas i samma svar');

  // Utloggning utan giltig session svarar också 204: utloggning ska aldrig
  // misslyckas.
  assert.equal((await call('POST', '/api/auth/logga-ut', {})).res.statusCode, 204);
});

test('(A11) X-Forwarded-For litas inte på utan TRUST_PROXY', async (t) => {
  const tidigare = process.env.TRUST_PROXY;
  t.after(() => {
    if (tidigare === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = tidigare;
    }
  });

  delete process.env.TRUST_PROXY;
  const ett = makeRequest('POST', undefined, { forwardedFor: '198.51.100.1', remoteAddress: IP });
  const tva = makeRequest('POST', undefined, { forwardedFor: '198.51.100.2', remoteAddress: IP });
  assert.equal(clientIp(ett), IP, 'anslutningens fjärradress används');
  assert.equal(clientIp(tva), IP);
  assert.equal(clientIp(ett), clientIp(tva), 'två anrop med olika huvud är samma klient');

  // Och att huvudet verkligen läses när variabeln är satt: utan den här raden
  // kunde clientIp ha struntat i huvudet helt och ändå passera ovan.
  process.env.TRUST_PROXY = '1';
  assert.equal(clientIp(ett), '198.51.100.1');
  assert.equal(clientIp(tva), '198.51.100.2');
  assert.notEqual(clientIp(ett), clientIp(tva));

  // Första kommaseparerade värdet, trimmat.
  const kedja = makeRequest('POST', undefined, { forwardedFor: ' 203.0.113.4 , 70.41.3.18 ', remoteAddress: IP });
  assert.equal(clientIp(kedja), '203.0.113.4');

  // Utan både huvud och fjärradress skrivs UNKNOWN_IP, aldrig en tom sträng:
  // request_ip är NOT NULL.
  const naken = new EventEmitter();
  naken.headers = {};
  assert.equal(clientIp(naken), UNKNOWN_IP);
});

test('(A12) en annan användares data är onåbar', async (t) => {
  const { db, call } = await apiDatabase(t);

  // Två konton, båda inloggade.
  await begarKod(db, { email: EPOST, kod: KOD });
  const aCookie = (await call('POST', '/api/auth/logga-in', { body: { email: EPOST, code: KOD } })).res.cookie;
  await begarKod(db, { email: ANNAN_EPOST, kod: ANNAN_KOD });
  const bSvar = await call('POST', '/api/auth/logga-in', { body: { email: ANNAN_EPOST, code: ANNAN_KOD } });
  assert.equal(bSvar.res.statusCode, 204);

  // A:s cookie ger A:s uppgifter och aldrig B:s, oavsett vad anropet påstår.
  const mig = await call('GET', '/api/mig', { cookie: aCookie });
  assert.deepEqual(mig.res.body, { email: EPOST });
  assert.equal(mig.res.text.includes(ANNAN_EPOST), false, 'B:s adress finns inte i svaret');

  // user_id kommer ur sessionen och aldrig ur kroppen: ett user_id i JSON är
  // inte ett fält appen läser.
  const bUser = db.prepare('SELECT id FROM users WHERE email = ?').get(ANNAN_EPOST);
  const paminnelse = await call('GET', '/api/mig', { cookie: aCookie, body: { user_id: bUser.id } });
  assert.deepEqual(paminnelse.res.body, { email: EPOST });

  // B:s kod duger inte för A: uppslaget i login_codes bär user_id, så A ser
  // aldrig B:s rader. A får en ny, ogången kod först — annars är A:s senaste kod
  // den redan förbrukade från inloggningen ovan, och då vinner rad 5 före rad 8.
  await begarKod(db, { email: EPOST, kod: '111111' });
  await begarKod(db, { email: ANNAN_EPOST, kod: '222222' });
  const korsvis = verifyCode(db, { email: EPOST, code: '222222', now: NU });
  assert.equal(korsvis.status, 400);
  assert.equal(korsvis.message, AUTH_MESSAGES.unknownCode);
  // Försöket räknades upp på A:s egen kod och inte på B:s.
  assert.equal(kodrader(db, EPOST)[0].attempts, 1, 'A:s kod bär försöket');
  assert.equal(kodrader(db, ANNAN_EPOST)[0].attempts, 0, 'B:s kod är orörd');
  // Och A:s egen nya kod duger fortfarande.
  assert.equal(verifyCode(db, { email: EPOST, code: '111111', now: NU }).status, 204);

  // Utan cookie når anropet aldrig datalagret: spärren svarar innan någon fråga
  // förbereds. Attrappen kastar för varje prepare, så ett anrop som rörde
  // databasen skulle falla här i stället för att svara med "inte inloggad".
  const kastandeDb = {
    prepare() {
      throw new Error('datalagret rördes utan giltig session');
    }
  };
  for (const token of [null, '', undefined, 42]) {
    const utfall = requireSession(kastandeDb, { token, now: NU });
    assert.equal(utfall.unauthorized, true, `token ${String(token)}`);
    assert.equal(utfall.message, NOT_LOGGED_IN_MESSAGE);
  }

  // Med en cookie som inte hör till någon session körs exakt en sats: uppslaget
  // i sessions på token_hash, som är ägarregelns andra undantag och den sats som
  // avgör vem användaren är. Ingen tabell med user_id rörs, så ett okänt token
  // kan inte läsa någons rader.
  const satser = [];
  const spionDb = {
    prepare(sql) {
      satser.push(sql);
      return db.prepare(sql);
    }
  };
  const okant = requireSession(spionDb, { token: 'inte-ett-token', now: NU });
  assert.equal(okant.unauthorized, true);
  assert.equal(okant.message, NOT_LOGGED_IN_MESSAGE);
  assert.equal(satser.length, 1, `satserna som kördes: ${satser.join(' | ')}`);
  assert.match(satser[0], /FROM sessions WHERE token_hash = \?/);
  for (const tabell of ['templates', 'month_items', 'overrides', 'login_codes']) {
    assert.equal(satser.join(' ').includes(tabell), false, `${tabell} rördes`);
  }

  // En session som gått ut eller är återkallad är också "inte inloggad".
  const bToken = /=([^;]+)/.exec(bSvar.res.cookie)[1];
  assert.equal(authenticate(db, { token: bToken, now: NU }).email, ANNAN_EPOST);
  assert.equal(authenticate(db, { token: bToken, now: EFTER_SESSION }), null, 'utgången session');
  logOut(db, { token: bToken, now: NU });
  assert.equal(authenticate(db, { token: bToken, now: NU }), null, 'återkallad session');

  // Ingen av de tre anropen ovan kunde ha varit en läsning av A:s session:
  // tokenet är B:s, och sessionCookie skriver tokenet ordagrant.
  assert.equal(sessionCookie(bToken).startsWith(`${SESSION_COOKIE_NAME}=${bToken};`), true);
});

test('rad 10: ett misslyckat utskick svarar rad 10 och lämnar ingen kod kvar', async (t) => {
  const tidigareNyckel = process.env.RESEND_API_KEY;
  const tidigareFran = process.env.RESEND_FROM;
  t.after(() => {
    if (tidigareNyckel === undefined) {
      delete process.env.RESEND_API_KEY;
    } else {
      process.env.RESEND_API_KEY = tidigareNyckel;
    }
    if (tidigareFran === undefined) {
      delete process.env.RESEND_FROM;
    } else {
      process.env.RESEND_FROM = tidigareFran;
    }
  });

  const db = freshDatabase();
  // Ett utskick som lyckas först, så att fallet visar skillnaden: den kod som
  // gick ut ligger kvar, den som inte kunde skickas gör det inte.
  await begarKod(db);
  assert.equal(kodrader(db, EPOST).length, 1);

  // Drift utan avsändaradress: brevet går inte att skicka.
  process.env.RESEND_API_KEY = 'testnyckel';
  delete process.env.RESEND_FROM;
  const svar = await begarKod(db, { kod: ANNAN_KOD });
  assert.equal(svar.status, 500);
  assert.equal(svar.message, AUTH_MESSAGES.sendFailed);

  const rader = kodrader(db, EPOST);
  assert.equal(rader.length, 1, 'koden som inte kunde skickas är borta');
  // Den kod som ligger kvar är den första, och den är ersatt — begäran hann
  // sätta superseded_at innan utskicket föll. Den som begär en ny kod får därför
  // rad 6 tills ett utskick lyckas, aldrig en kod utan motsvarighet i brevet.
  assert.equal(rader[0].superseded_at, NU);
  assert.equal(verifyCode(db, { email: EPOST, code: KOD, now: NU }).message, AUTH_MESSAGES.codeSuperseded);

  // Och gränsen per adress räknar inte den kod användaren inte kan ta emot.
  assert.equal(kodrader(db, EPOST).length, 1);
  db.close();
});

test('de nio konstanterna har tabellens värden', () => {
  // Tabellen "Namngivna konstanter" i ARKITEKTUR.md, rad för rad.
  assert.equal(CODE_LENGTH, 6);
  assert.equal(CODE_TTL_MS, 10 * 60 * 1000);
  assert.equal(CODE_MAX_ATTEMPTS, 5);
  assert.equal(EMAIL_WINDOW_MS, 60 * 60 * 1000);
  assert.equal(EMAIL_MAX_PER_WINDOW, 5);
  assert.equal(IP_WINDOW_MS, 60 * 60 * 1000);
  assert.equal(IP_MAX_PER_WINDOW, 20);
  assert.equal(SESSION_TTL_MS, 30 * 24 * 60 * 60 * 1000);
  assert.equal(SCRYPT_KEYLEN, 64);
  // Saltets längd står i samma avsnitt som "ett salt om 16 byte".
  assert.equal(SALT_BYTES, 16);
});

test('kodens hash jämförs med timingSafeEqual och aldrig med en likhet', () => {
  // Mutationen "timingSafeEqual byts mot ===" ger samma svar för varje indata:
  // skillnaden är körningstiden, inte värdet, och den kan inget värde asserta.
  // Spärren läser därför källtexten, på samma sätt som testet som kräver att
  // src/server/api.js inte importerar saveEntries. Mönstret matchar både
  // crypto.timingSafeEqual(...) och en importerad timingSafeEqual(...) — varje
  // stavning språket tillåter för samma anrop.
  assert.match(
    AUTH_SOURCE,
    /(?:crypto\.)?timingSafeEqual\(/,
    'jämförelsen går genom timingSafeEqual'
  );
  assert.equal(
    /code_hash\s*===|hashCode\([^)]*\)\s*===/.test(AUTH_SOURCE),
    false,
    'ingen kodhash jämförs med ==='
  );
  // Och hashen är den enda formen koden lagras i: ingen SQL skriver en kolumn
  // som skulle bära koden i klartext.
  assert.match(AUTH_SOURCE, /INSERT INTO login_codes\s*\n\s*\(id, user_id, code_hash, code_salt/);
});

test('cookiens Max-Age räknas ur SESSION_TTL_MS och inte ur ett tal i koden', () => {
  // Mutationen "skriv 2592000 i stället för SESSION_TTL_MS / MS_PER_SECOND" ger
  // samma sträng i dag och kan därför inte fällas på ett värde. Talet är ändå
  // fel att skriva: ARKITEKTUR.md säger att en literal på anropsstället är ett
  // fel, och en ändrad SESSION_TTL_MS skulle annars ge en cookie som lever
  // längre än sessionen.
  const kropp = AUTH_SOURCE.slice(AUTH_SOURCE.indexOf('export function sessionCookie'))
    .split('}')[0];
  assert.match(kropp, /SESSION_TTL_MS/, 'Max-Age kommer ur konstanten');
  assert.equal(/\d{2,}/.test(kropp), false, `inget tal står i sessionCookie: ${kropp}`);
  // Och strängen bär det tal konstanten ger.
  assert.match(sessionCookie('t'), new RegExp(`; Max-Age=${MAX_AGE_SEKUNDER}$`));
});

test('ett fel från node:sqlite blir DatabaseError med svensk text', async () => {
  const db = freshDatabase();

  // En läsning som faller: rad 2 i feltabellen.
  const lasfel = new Error('SQLITE_ERROR: no such table: users');
  const kastarVidLasning = {
    prepare() {
      throw lasfel;
    }
  };
  await assert.rejects(
    () => begarKod(kastarVidLasning),
    (error) => {
      assert.equal(error instanceof DatabaseError, true);
      assert.equal(error.message, DATABASE_MESSAGES.readFailed);
      assert.equal(error.cause, lasfel, 'originalfelet finns kvar i cause');
      assert.equal(error.message.includes('SQLITE_'), false, 'ingen engelsk text läcker');
      return true;
    }
  );

  // En skrivning som faller: rad 3. SELECT går till den riktiga databasen, run
  // kastar — så det är skrivvägen och inte läsvägen som prövas.
  const skrivfel = new Error('SQLITE_READONLY: attempt to write a readonly database');
  const kastarVidSkrivning = {
    prepare(sql) {
      const statement = db.prepare(sql);
      if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
        return {
          run() {
            throw skrivfel;
          }
        };
      }
      return statement;
    },
    exec(sql) {
      return db.exec(sql);
    }
  };
  await assert.rejects(
    () => begarKod(kastarVidSkrivning),
    (error) => {
      assert.equal(error instanceof DatabaseError, true);
      assert.equal(error.message, DATABASE_MESSAGES.writeFailed);
      assert.equal(error.cause, skrivfel);
      return true;
    }
  );
  db.close();
});

test('den nyaste koden avgörs av insättningsordningen och aldrig av id', () => {
  // Två koder med samma created_at, vilket är vad två begäran inom samma
  // millisekund ger. Den nyaste är den som sattes in sist, och det är den som
  // ska bära ett misslyckat försök — inte den vars slumpade id råkar sortera
  // högst. Ordningen provas tio gånger med nya id:n, så att ett utfall som beror
  // på slumpen inte kan passera.
  //
  // Fallet fylls med SQL och inte genom requestCode, eftersom requestCode
  // ersätter den förra koden och då vinner rad 6 innan rad 8 nås. Vad som provas
  // här är vilken rad koden räknar som den nyaste, inte kedjans ordning.
  for (let omgang = 1; omgang <= 10; omgang += 1) {
    const db = freshDatabase();
    const userId = `u${omgang}`;
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(userId, EPOST, NU);
    const rader = [
      { id: 'zzzz-aldst', hash: 'a'.repeat(128) },
      { id: 'aaaa-nyast', hash: 'b'.repeat(128) }
    ];
    for (const rad of rader) {
      db.prepare(`INSERT INTO login_codes
          (id, user_id, code_hash, code_salt, created_at, expires_at, consumed_at,
           superseded_at, attempts, request_ip)
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`)
        .run(rad.id, userId, rad.hash, 'ff'.repeat(16), NU, EFTER_TTL, IP);
    }

    // Ingen av hasharna hör till FEL_KOD, så rad 8 avgör och försöket räknas på
    // den nyaste raden.
    const svar = verifyCode(db, { email: EPOST, code: FEL_KOD, now: NU });
    assert.equal(svar.message, AUTH_MESSAGES.unknownCode, `omgång ${omgang}`);
    const efter = db
      .prepare('SELECT id, attempts FROM login_codes WHERE user_id = ? ORDER BY attempts DESC')
      .all(userId);
    assert.equal(efter[0].id, 'aaaa-nyast', `omgång ${omgang}: den sist inlagda raden bär försöket`);
    assert.equal(efter[0].attempts, 1);
    assert.equal(efter[1].attempts, 0, 'den äldre raden är orörd');
    db.close();
  }
});
