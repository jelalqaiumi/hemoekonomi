import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  AUTH_MESSAGES,
  LOGIN_MAX_FAILURES_PER_EMAIL,
  LOGIN_WINDOW_MS,
  NOT_LOGGED_IN_MESSAGE,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  RESET_MAX_PER_EMAIL,
  RESET_TTL_MS,
  SESSION_COOKIE_NAME,
  SESSION_TTL_MS,
  authenticate,
  checkPassword,
  clearedSessionCookie,
  clientIp,
  deleteAccount,
  isValidEmail,
  logIn,
  logOut,
  normalizeEmail,
  readSessionToken,
  register,
  requestPasswordReset,
  requireSession,
  resetPassword,
  sessionCookie
} from '../src/server/auth.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addMonthItem, readMonth } from '../src/server/months.js';
import { prepare } from './helpers/sql.js';

const NU = '2026-10-17T10:00:00.000Z';
const EPOST = 'anna@example.se';
const LOSENORD = 'ett långt lösenord';
const IP = '198.51.100.7';

function plus(iso, ms) {
  return new Date(Date.parse(iso) + ms).toISOString();
}

async function nyDatabas(t) {
  const db = await openDatabase(MEMORY_PATH);
  t.after(() => db.close());
  return db;
}

async function konto(db, { email = EPOST, password = LOSENORD } = {}) {
  const result = await register(db, { email, password, ip: IP, now: NU });
  assert.equal(result.status, 201, JSON.stringify(result));
  return result;
}

function brevlåda() {
  const brev = [];
  return {
    brev,
    send: async (to, link) => {
      brev.push({ to, link });
      return true;
    },
    token() {
      return new URL(brev.at(-1).link).searchParams.get('aterstall');
    }
  };
}

test('normalizeEmail trimmar och gör om till gemener, och allt som inte är en sträng blir tomt', () => {
  assert.equal(normalizeEmail('  Anna@Example.SE '), 'anna@example.se');
  for (const value of [undefined, null, 42, {}, [], 1n]) {
    assert.equal(normalizeEmail(value), '');
  }
});

test('isValidEmail godtar en vanlig adress och avvisar resten', () => {
  assert.equal(isValidEmail('anna@example.se'), true);
  assert.equal(isValidEmail('a.b+c@sub.example.co.uk'), true);
  for (const value of ['', 'anna', 'anna@', '@example.se', 'anna@example', 'an na@example.se', 'anna@ex ample.se', `${'a'.repeat(250)}@x.se`, null, 1]) {
    assert.equal(isValidEmail(value), false, String(value));
  }
});

test('checkPassword: saknat, för kort, för långt och precis på gränserna', () => {
  assert.equal(checkPassword(undefined), AUTH_MESSAGES.passwordMissing);
  assert.equal(checkPassword(''), AUTH_MESSAGES.passwordMissing);
  assert.equal(checkPassword(12345678901), AUTH_MESSAGES.passwordMissing);
  assert.equal(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH - 1)), AUTH_MESSAGES.passwordTooShort);
  assert.equal(checkPassword('a'.repeat(PASSWORD_MIN_LENGTH)), null);
  assert.equal(checkPassword('a'.repeat(PASSWORD_MAX_LENGTH)), null);
  assert.equal(checkPassword('a'.repeat(PASSWORD_MAX_LENGTH + 1)), AUTH_MESSAGES.passwordTooLong);
});

test('checkPassword räknar tecken och inte kodenheter (LARDOMAR.md 2026-08-18)', () => {
  assert.equal(checkPassword('\u{1F600}'.repeat(PASSWORD_MIN_LENGTH)), null);
  assert.equal(checkPassword('\u{1F600}'.repeat(PASSWORD_MIN_LENGTH - 1)), AUTH_MESSAGES.passwordTooShort);
  assert.equal(checkPassword('\u{1F600}'.repeat(PASSWORD_MAX_LENGTH)), null);
});

test('checkPassword avvisar ett mycket långt lösenord utan att räkna det (LARDOMAR.md 2026-08-23)', () => {
  const start = process.hrtime.bigint();
  assert.equal(checkPassword('a'.repeat(5_000_000)), AUTH_MESSAGES.passwordTooLong);
  const ms = Number(process.hrtime.bigint() - start) / 1e6;
  assert.ok(ms < 500, `${ms} ms`);
});

test('meddelandena om lösenordets längd namnger gränserna', () => {
  assert.equal(AUTH_MESSAGES.passwordTooShort, 'Lösenordet måste vara minst 10 tecken.');
  assert.equal(AUTH_MESSAGES.passwordTooLong, 'Lösenordet får vara högst 200 tecken.');
});

test('register skapar kontot, en session och lagrar aldrig lösenordet i klartext', async (t) => {
  const db = await nyDatabas(t);
  const { token } = await konto(db, { email: '  Anna@Example.se ' });
  const rad = await prepare(db, 'SELECT email, password_hash, password_salt FROM users').get();
  assert.equal(rad.email, EPOST);
  assert.notEqual(rad.password_hash, LOSENORD);
  assert.match(rad.password_hash, /^[0-9a-f]{128}$/);
  assert.match(rad.password_salt, /^[0-9a-f]{32}$/);
  assert.equal(JSON.stringify(rad).includes(LOSENORD), false);
  const session = await authenticate(db, { token, now: NU });
  assert.deepEqual(Object.keys(session).sort(), ['email', 'userId']);
  assert.equal(session.email, EPOST);
});

test('två konton med samma lösenord får olika salt och olika hash', async (t) => {
  const db = await nyDatabas(t);
  await konto(db, { email: 'a@example.se' });
  await konto(db, { email: 'b@example.se' });
  const rader = await prepare(db, 'SELECT password_hash, password_salt FROM users').all();
  assert.notEqual(rader[0].password_salt, rader[1].password_salt);
  assert.notEqual(rader[0].password_hash, rader[1].password_hash);
});

test('register avvisar en ogiltig adress och ett för kort lösenord med fältet utpekat', async (t) => {
  const db = await nyDatabas(t);
  assert.deepEqual(await register(db, { email: 'inte-en-adress', password: LOSENORD, now: NU }), {
    status: 400, message: AUTH_MESSAGES.invalidEmail, field: 'email'
  });
  assert.deepEqual(await register(db, { email: EPOST, password: 'kort', now: NU }), {
    status: 400, message: AUTH_MESSAGES.passwordTooShort, field: 'password'
  });
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM users').get()).antal, 0);
});

test('register ger 409 när adressen redan har ett konto, oavsett skiftläge', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  assert.deepEqual(await register(db, { email: 'ANNA@example.se', password: 'ett annat lösenord', now: NU }), {
    status: 409, message: AUTH_MESSAGES.emailTaken, field: 'email'
  });
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM users').get()).antal, 1);
});

test('två samtidiga registreringar med samma adress ger ett konto och ett 409', async (t) => {
  const db = await nyDatabas(t);
  const svar = await Promise.all([
    register(db, { email: EPOST, password: LOSENORD, now: NU }),
    register(db, { email: EPOST, password: LOSENORD, now: NU })
  ]);
  assert.deepEqual(svar.map((s) => s.status).sort(), [201, 409]);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM users').get()).antal, 1);
});

test('logIn med rätt lösenord ger 204 och en session som fungerar', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const result = await logIn(db, { email: ' ANNA@example.se', password: LOSENORD, ip: IP, now: NU });
  assert.equal(result.status, 204);
  assert.equal((await authenticate(db, { token: result.token, now: NU })).email, EPOST);
});

test('logIn ger samma svar för fel lösenord och för en adress utan konto', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const fel = await logIn(db, { email: EPOST, password: 'fel lösenord här', ip: IP, now: NU });
  const okänd = await logIn(db, { email: 'berit@example.se', password: LOSENORD, ip: IP, now: NU });
  assert.deepEqual(fel, { status: 401, message: AUTH_MESSAGES.wrongCredentials });
  assert.deepEqual(okänd, { status: 401, message: AUTH_MESSAGES.wrongCredentials });
  assert.equal(AUTH_MESSAGES.wrongCredentials, 'Fel e-postadress eller lösenord.');
});

test('logIn avvisar en ogiltig adress och ett tomt lösenord med 400', async (t) => {
  const db = await nyDatabas(t);
  assert.deepEqual(await logIn(db, { email: 'x', password: LOSENORD, now: NU }), { status: 400, message: AUTH_MESSAGES.invalidEmail });
  assert.deepEqual(await logIn(db, { email: EPOST, password: '', now: NU }), { status: 400, message: AUTH_MESSAGES.passwordMissing });
  assert.deepEqual(await logIn(db, { email: EPOST, now: NU }), { status: 400, message: AUTH_MESSAGES.passwordMissing });
});

test('efter för många misslyckade försök spärras adressen, också för rätt lösenord', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL; i += 1) {
    assert.equal((await logIn(db, { email: EPOST, password: 'fel lösenord nr ' + i, ip: `10.0.0.${i}`, now: NU })).status, 401);
  }
  assert.deepEqual(await logIn(db, { email: EPOST, password: LOSENORD, ip: '10.9.9.9', now: NU }), {
    status: 429, message: AUTH_MESSAGES.tooManyLoginAttempts
  });
  const senare = plus(NU, LOGIN_WINDOW_MS + 1000);
  assert.equal((await logIn(db, { email: EPOST, password: LOSENORD, ip: '10.9.9.9', now: senare })).status, 204);
});

test('ett lyckat försök räknas inte mot spärren', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  for (let i = 0; i < LOGIN_MAX_FAILURES_PER_EMAIL + 3; i += 1) {
    assert.equal((await logIn(db, { email: EPOST, password: LOSENORD, ip: IP, now: NU })).status, 204);
  }
});

test('inloggningsförsök äldre än 30 dagar rensas', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  await logIn(db, { email: EPOST, password: 'fel lösenord igen', ip: IP, now: NU });
  const långtSenare = plus(NU, 31 * 24 * 60 * 60 * 1000);
  await logIn(db, { email: EPOST, password: LOSENORD, ip: IP, now: långtSenare });
  const rader = await prepare(db, 'SELECT created_at FROM login_attempts').all();
  assert.deepEqual(rader.map((r) => r.created_at), [långtSenare]);
});

test('authenticate: ett okänt, tomt, utgånget eller återkallat token ger null', async (t) => {
  const db = await nyDatabas(t);
  const { token } = await konto(db);
  for (const value of [undefined, null, '', 'skräp', 42, 'x'.repeat(500)]) {
    assert.equal(await authenticate(db, { token: value, now: NU }), null, String(value));
  }
  assert.notEqual(await authenticate(db, { token, now: plus(NU, SESSION_TTL_MS - 1) }), null);
  assert.equal(await authenticate(db, { token, now: plus(NU, SESSION_TTL_MS) }), null);
  await logOut(db, { token, now: NU });
  assert.equal(await authenticate(db, { token, now: NU }), null);
});

test('requireSession ger texten för den som inte är inloggad', async (t) => {
  const db = await nyDatabas(t);
  assert.deepEqual(await requireSession(db, { token: 'nej', now: NU }), { unauthorized: true, message: NOT_LOGGED_IN_MESSAGE });
});

test('logOut med ett okänt token gör ingenting', async (t) => {
  const db = await nyDatabas(t);
  const { token } = await konto(db);
  await logOut(db, { token: 'okänt', now: NU });
  assert.notEqual(await authenticate(db, { token, now: NU }), null);
});

test('requestPasswordReset skickar en länk med ett token som bara lagras som hash', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const låda = brevlåda();
  const result = await requestPasswordReset(db, { email: 'Anna@example.se', ip: IP, now: NU, appUrl: 'https://hemochekonomi.se', send: låda.send });
  assert.deepEqual(result, { status: 202 });
  assert.equal(låda.brev.length, 1);
  assert.equal(låda.brev[0].to, EPOST);
  assert.match(låda.brev[0].link, /^https:\/\/hemochekonomi\.se\/app\?aterstall=[A-Za-z0-9_-]{43}$/);
  const rad = await prepare(db, 'SELECT token_hash, expires_at, used_at FROM password_resets').get();
  assert.equal(rad.token_hash.includes(låda.token()), false);
  assert.match(rad.token_hash, /^[0-9a-f]{64}$/);
  assert.equal(rad.expires_at, plus(NU, RESET_TTL_MS));
  assert.equal(rad.used_at, null);
});

test('requestPasswordReset svarar 202 för en adress utan konto och skickar inget', async (t) => {
  const db = await nyDatabas(t);
  const låda = brevlåda();
  assert.deepEqual(await requestPasswordReset(db, { email: 'ingen@example.se', ip: IP, now: NU, appUrl: 'http://x', send: låda.send }), { status: 202 });
  assert.equal(låda.brev.length, 0);
});

test('requestPasswordReset: 400 för ogiltig adress, 429 efter tre begäranden, 502 när mejlet inte gick iväg', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const låda = brevlåda();
  assert.deepEqual(await requestPasswordReset(db, { email: 'x', ip: IP, now: NU, appUrl: 'http://x', send: låda.send }), { status: 400, message: AUTH_MESSAGES.invalidEmail });
  for (let i = 0; i < RESET_MAX_PER_EMAIL; i += 1) {
    assert.equal((await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send })).status, 202);
  }
  assert.deepEqual(await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send }), { status: 429, message: AUTH_MESSAGES.tooManyResets });

  const db2 = await nyDatabas(t);
  await konto(db2);
  assert.deepEqual(await requestPasswordReset(db2, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: async () => false }), { status: 502, message: AUTH_MESSAGES.resetSendFailed });
});

test('resetPassword byter lösenordet, återkallar alla sessioner och loggar in', async (t) => {
  const db = await nyDatabas(t);
  const { token: gammalSession } = await konto(db);
  const låda = brevlåda();
  await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send });
  const nytt = 'ett helt nytt lösenord';
  const result = await resetPassword(db, { token: låda.token(), password: nytt, now: NU });
  assert.equal(result.status, 204);
  assert.equal((await authenticate(db, { token: result.token, now: NU })).email, EPOST);
  assert.equal(await authenticate(db, { token: gammalSession, now: NU }), null);
  assert.equal((await logIn(db, { email: EPOST, password: LOSENORD, ip: IP, now: NU })).status, 401);
  assert.equal((await logIn(db, { email: EPOST, password: nytt, ip: IP, now: NU })).status, 204);
});

test('resetPassword: länken går att använda en gång, går ut efter en timme, och ett okänt token avvisas', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const låda = brevlåda();
  const fel = { status: 400, message: AUTH_MESSAGES.invalidResetLink, field: 'token' };

  await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send });
  const token = låda.token();
  assert.equal((await resetPassword(db, { token, password: 'nytt lösenord ett', now: NU })).status, 204);
  assert.deepEqual(await resetPassword(db, { token, password: 'nytt lösenord två', now: NU }), fel);

  await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send });
  assert.deepEqual(await resetPassword(db, { token: låda.token(), password: 'nytt lösenord tre', now: plus(NU, RESET_TTL_MS) }), fel);

  for (const value of [undefined, '', 'okänt-token', 'x'.repeat(500)]) {
    assert.deepEqual(await resetPassword(db, { token: value, password: 'nytt lösenord fyra', now: NU }), fel, String(value));
  }
});

test('resetPassword avvisar ett för kort lösenord och förbrukar inte länken', async (t) => {
  const db = await nyDatabas(t);
  await konto(db);
  const låda = brevlåda();
  await requestPasswordReset(db, { email: EPOST, ip: IP, now: NU, appUrl: 'http://x', send: låda.send });
  assert.deepEqual(await resetPassword(db, { token: låda.token(), password: 'kort', now: NU }), {
    status: 400, message: AUTH_MESSAGES.passwordTooShort, field: 'password'
  });
  assert.equal((await resetPassword(db, { token: låda.token(), password: 'nu ett långt', now: NU })).status, 204);
});

test('deleteAccount kräver rätt lösenord och tar sedan bort kontot och allt som hör till det', async (t) => {
  const db = await nyDatabas(t);
  const { token } = await konto(db);
  const { userId } = await authenticate(db, { token, now: NU });
  await addMonthItem(userId, '2026-10', { kind: 'expense', name: 'Mat', amountOre: 1000, category: 'food' }, { db, now: NU });
  const { token: annans } = await konto(db, { email: 'berit@example.se' });

  assert.deepEqual(await deleteAccount(db, { userId, password: 'fel lösenord här' }), { status: 400, message: AUTH_MESSAGES.wrongPassword });
  assert.deepEqual(await deleteAccount(db, { userId, password: undefined }), { status: 400, message: AUTH_MESSAGES.wrongPassword });
  assert.equal((await readMonth(userId, '2026-10', { db })).items.length, 1);

  assert.deepEqual(await deleteAccount(db, { userId, password: LOSENORD }), { status: 204 });
  for (const tabell of ['users', 'sessions', 'month_items', 'login_attempts']) {
    const rader = await prepare(db, `SELECT * FROM ${tabell}`).all();
    assert.equal(rader.some((r) => r.user_id === userId || r.id === userId || r.email === EPOST), false, tabell);
  }
  assert.equal(await authenticate(db, { token, now: NU }), null);
  assert.equal((await authenticate(db, { token: annans, now: NU })).email, 'berit@example.se');
});

test('deleteAccount för en användare som inte finns ger 401', async (t) => {
  const db = await nyDatabas(t);
  assert.deepEqual(await deleteAccount(db, { userId: 'finns-inte', password: LOSENORD }), { status: 401, message: NOT_LOGGED_IN_MESSAGE });
});

test('sessionscookien är HttpOnly och SameSite=Lax, och Secure bara i drift', () => {
  const tidigare = process.env.NODE_ENV;
  try {
    delete process.env.NODE_ENV;
    assert.equal(sessionCookie('abc'), `${SESSION_COOKIE_NAME}=abc; HttpOnly; Path=/; SameSite=Lax; Max-Age=2592000`);
    assert.equal(clearedSessionCookie(), `${SESSION_COOKIE_NAME}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
    process.env.NODE_ENV = 'production';
    assert.equal(sessionCookie('abc').endsWith('; Secure'), true);
  } finally {
    if (tidigare === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = tidigare;
    }
  }
});

test('readSessionToken hittar cookien bland andra', () => {
  assert.equal(readSessionToken({ headers: { cookie: `a=1; ${SESSION_COOKIE_NAME}=tok; b=2` } }), 'tok');
  assert.equal(readSessionToken({ headers: {} }), null);
  assert.equal(readSessionToken({ headers: { cookie: 'a=1' } }), null);
});

test('clientIp läser X-Forwarded-For bara när TRUST_PROXY=1', () => {
  const req = { headers: { 'x-forwarded-for': '203.0.113.5, 10.0.0.1' }, socket: { remoteAddress: '10.0.0.1' } };
  const tidigare = process.env.TRUST_PROXY;
  try {
    delete process.env.TRUST_PROXY;
    assert.equal(clientIp(req), '10.0.0.1');
    process.env.TRUST_PROXY = '1';
    assert.equal(clientIp(req), '203.0.113.5');
    assert.equal(clientIp({ headers: {}, socket: {} }), 'okänd');
  } finally {
    if (tidigare === undefined) {
      delete process.env.TRUST_PROXY;
    } else {
      process.env.TRUST_PROXY = tidigare;
    }
  }
});
