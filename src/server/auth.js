import crypto from 'node:crypto';
import { promisify } from 'node:util';

import { readRows, transaction, write } from './db.js';

const scrypt = promisify(crypto.scrypt);

export const PASSWORD_MIN_LENGTH = 10;
export const PASSWORD_MAX_LENGTH = 200;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SCRYPT_KEYLEN = 64;
export const SALT_BYTES = 16;
export const TOKEN_BYTES = 32;

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES_PER_EMAIL = 10;
export const LOGIN_MAX_FAILURES_PER_IP = 50;

export const RESET_TTL_MS = 60 * 60 * 1000;
export const RESET_WINDOW_MS = 60 * 60 * 1000;
export const RESET_MAX_PER_EMAIL = 3;
export const RESET_MAX_PER_IP = 10;

const MS_PER_SECOND = 1000;

export const AUTH_MESSAGES = Object.freeze({
  invalidEmail: 'Ange en giltig e-postadress.',
  passwordMissing: 'Ange ett lösenord.',
  passwordTooShort: `Lösenordet måste vara minst ${PASSWORD_MIN_LENGTH} tecken.`,
  passwordTooLong: `Lösenordet får vara högst ${PASSWORD_MAX_LENGTH} tecken.`,
  emailTaken: 'Det finns redan ett konto med den e-postadressen. Logga in i stället.',
  wrongCredentials: 'Fel e-postadress eller lösenord.',
  tooManyLoginAttempts: 'För många misslyckade inloggningar. Vänta en kvart och försök igen.',
  tooManyResets: 'För många begäranden om nytt lösenord. Försök igen om en stund.',
  resetSendFailed: 'Det gick inte att skicka mejlet. Försök igen om en stund.',
  invalidResetLink: 'Länken är ogiltig eller har gått ut. Begär en ny länk.',
  wrongPassword: 'Lösenordet stämmer inte.'
});

export const NOT_LOGGED_IN_MESSAGE = 'Du är inte inloggad.';

export const SESSION_COOKIE_NAME = 'hemochekonomi_session';

export const UNKNOWN_IP = 'okänd';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;
const EMAIL_MAX_LENGTH = 254;

const RESEND_ENDPOINT = 'https://api.resend.com/emails';
const RESET_MAIL_SUBJECT = 'Nytt lösenord till Hem och Ekonomi';

const DUMMY_SALT = crypto.randomBytes(SALT_BYTES).toString('hex');
let dummyHash = null;

export function normalizeEmail(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim().toLowerCase();
}

export function isValidEmail(email) {
  return typeof email === 'string' && email.length <= EMAIL_MAX_LENGTH && EMAIL_PATTERN.test(email);
}

export function checkPassword(password) {
  if (typeof password !== 'string' || password === '') {
    return AUTH_MESSAGES.passwordMissing;
  }
  if (password.length > 2 * PASSWORD_MAX_LENGTH) {
    return AUTH_MESSAGES.passwordTooLong;
  }
  const length = [...password].length;
  if (length < PASSWORD_MIN_LENGTH) {
    return AUTH_MESSAGES.passwordTooShort;
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return AUTH_MESSAGES.passwordTooLong;
  }
  return null;
}

async function hashPassword(password, saltHex) {
  const key = await scrypt(password.normalize('NFC'), Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN);
  return key.toString('hex');
}

async function passwordMatches(password, row) {
  const stored = Buffer.from(row.password_hash, 'hex');
  if (stored.length !== SCRYPT_KEYLEN) {
    return false;
  }
  const candidate = Buffer.from(await hashPassword(password, row.password_salt), 'hex');
  return crypto.timingSafeEqual(stored, candidate);
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function generateToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString('base64url');
}

function shiftIso(now, ms) {
  const base = Date.parse(now);
  if (!Number.isFinite(base)) {
    throw new RangeError(`auth kräver en tidsstämpel på formen ÅÅÅÅ-MM-DDTHH:MM:SS.sssZ, fick "${String(now)}".`);
  }
  return new Date(base + ms).toISOString();
}

async function findUserByEmail(db, email) {
  const rows = await readRows(
    db,
    'SELECT id, email, password_hash, password_salt FROM users WHERE email = ?',
    [email]
  );
  return rows.length === 0 ? null : rows[0];
}

async function findUserById(db, userId) {
  const rows = await readRows(
    db,
    'SELECT id, email, password_hash, password_salt FROM users WHERE id = ?',
    [userId]
  );
  return rows.length === 0 ? null : rows[0];
}

async function createSession(db, userId, now, makeId, makeToken) {
  const token = makeToken();
  await write(
    db,
    `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, NULL)`,
    [makeId(), userId, hashToken(token), now, shiftIso(now, SESSION_TTL_MS)]
  );
  return token;
}

async function countFailures(db, column, value, since) {
  const rows = await readRows(
    db,
    `SELECT COUNT(*) AS antal FROM login_attempts
      WHERE ${column} = ? AND succeeded = 0 AND created_at >= ?`,
    [value, since]
  );
  return rows[0].antal;
}

export const ATTEMPT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;

async function recordAttempt(db, { email, ip, now, succeeded, makeId }) {
  const cutoff = shiftIso(now, -ATTEMPT_RETENTION_MS);
  await write(db, 'DELETE FROM login_attempts WHERE created_at < ?', [cutoff]);
  await write(db, 'DELETE FROM password_resets WHERE created_at < ?', [cutoff]);
  await write(
    db,
    'INSERT INTO login_attempts (id, email, request_ip, created_at, succeeded) VALUES (?, ?, ?, ?, ?)',
    [makeId(), email, ip, now, succeeded ? 1 : 0]
  );
}

export async function register(db, {
  email: rawEmail,
  password,
  ip = UNKNOWN_IP,
  now,
  makeId = () => crypto.randomUUID(),
  makeToken = generateToken,
  makeSalt = () => crypto.randomBytes(SALT_BYTES).toString('hex')
}) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { status: 400, message: AUTH_MESSAGES.invalidEmail, field: 'email' };
  }
  const passwordError = checkPassword(password);
  if (passwordError !== null) {
    return { status: 400, message: passwordError, field: 'password' };
  }
  if ((await findUserByEmail(db, email)) !== null) {
    return { status: 409, message: AUTH_MESSAGES.emailTaken, field: 'email' };
  }

  const salt = makeSalt();
  const hash = await hashPassword(password, salt);
  const userId = makeId();
  let token;
  try {
    token = await transaction(db, async () => {
      await write(
        db,
        'INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)',
        [userId, email, hash, salt, now]
      );
      return createSession(db, userId, now, makeId, makeToken);
    });
  } catch (error) {
    if ((await findUserByEmail(db, email)) !== null) {
      return { status: 409, message: AUTH_MESSAGES.emailTaken, field: 'email' };
    }
    throw error;
  }
  return { status: 201, token };
}

export async function logIn(db, {
  email: rawEmail,
  password,
  ip = UNKNOWN_IP,
  now,
  makeId = () => crypto.randomUUID(),
  makeToken = generateToken
}) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { status: 400, message: AUTH_MESSAGES.invalidEmail };
  }
  if (typeof password !== 'string' || password === '') {
    return { status: 400, message: AUTH_MESSAGES.passwordMissing };
  }
  if (password.length > 2 * PASSWORD_MAX_LENGTH) {
    return { status: 401, message: AUTH_MESSAGES.wrongCredentials };
  }

  const since = shiftIso(now, -LOGIN_WINDOW_MS);
  if (
    (await countFailures(db, 'email', email, since)) >= LOGIN_MAX_FAILURES_PER_EMAIL ||
    (await countFailures(db, 'request_ip', ip, since)) >= LOGIN_MAX_FAILURES_PER_IP
  ) {
    return { status: 429, message: AUTH_MESSAGES.tooManyLoginAttempts };
  }

  const user = await findUserByEmail(db, email);
  let ok;
  if (user === null) {
    if (dummyHash === null) {
      dummyHash = await hashPassword('ingen-sådan-användare', DUMMY_SALT);
    }
    await passwordMatches(password, { password_hash: dummyHash, password_salt: DUMMY_SALT });
    ok = false;
  } else {
    ok = await passwordMatches(password, user);
  }

  await recordAttempt(db, { email, ip, now, succeeded: ok, makeId });
  if (!ok) {
    return { status: 401, message: AUTH_MESSAGES.wrongCredentials };
  }
  const token = await createSession(db, user.id, now, makeId, makeToken);
  return { status: 204, token };
}

export async function requestPasswordReset(db, {
  email: rawEmail,
  ip = UNKNOWN_IP,
  now,
  appUrl,
  makeId = () => crypto.randomUUID(),
  makeToken = generateToken,
  send = sendResetMail
}) {
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { status: 400, message: AUTH_MESSAGES.invalidEmail };
  }

  const since = shiftIso(now, -RESET_WINDOW_MS);
  const perIp = (await readRows(
    db,
    'SELECT COUNT(*) AS antal FROM password_resets WHERE request_ip = ? AND created_at >= ?',
    [ip, since]
  ))[0].antal;
  if (perIp >= RESET_MAX_PER_IP) {
    return { status: 429, message: AUTH_MESSAGES.tooManyResets };
  }

  const user = await findUserByEmail(db, email);
  if (user === null) {
    return { status: 202 };
  }
  const perUser = (await readRows(
    db,
    'SELECT COUNT(*) AS antal FROM password_resets WHERE user_id = ? AND created_at >= ?',
    [user.id, since]
  ))[0].antal;
  if (perUser >= RESET_MAX_PER_EMAIL) {
    return { status: 429, message: AUTH_MESSAGES.tooManyResets };
  }

  const token = makeToken();
  await write(
    db,
    `INSERT INTO password_resets (id, user_id, token_hash, created_at, expires_at, used_at, request_ip)
     VALUES (?, ?, ?, ?, ?, NULL, ?)`,
    [makeId(), user.id, hashToken(token), now, shiftIso(now, RESET_TTL_MS), ip]
  );
  const link = `${appUrl}/app?aterstall=${token}`;
  const sent = await send(user.email, link);
  if (!sent) {
    return { status: 502, message: AUTH_MESSAGES.resetSendFailed };
  }
  return { status: 202 };
}

export async function resetPassword(db, {
  token,
  password,
  now,
  makeId = () => crypto.randomUUID(),
  makeToken = generateToken,
  makeSalt = () => crypto.randomBytes(SALT_BYTES).toString('hex')
}) {
  if (typeof token !== 'string' || token === '' || token.length > 200) {
    return { status: 400, message: AUTH_MESSAGES.invalidResetLink, field: 'token' };
  }
  const passwordError = checkPassword(password);
  if (passwordError !== null) {
    return { status: 400, message: passwordError, field: 'password' };
  }
  const salt = makeSalt();
  const hash = await hashPassword(password, salt);

  return transaction(db, async () => {
    const rows = await readRows(
      db,
      'SELECT id, user_id, expires_at, used_at FROM password_resets WHERE token_hash = ?',
      [hashToken(token)]
    );
    if (rows.length === 0 || rows[0].used_at !== null || rows[0].expires_at <= now) {
      return { status: 400, message: AUTH_MESSAGES.invalidResetLink, field: 'token' };
    }
    const reset = rows[0];
    await write(db, 'UPDATE password_resets SET used_at = ? WHERE user_id = ? AND used_at IS NULL', [now, reset.user_id]);
    await write(db, 'UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?', [hash, salt, reset.user_id]);
    await write(db, 'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL', [now, reset.user_id]);
    const sessionToken = await createSession(db, reset.user_id, now, makeId, makeToken);
    return { status: 204, token: sessionToken };
  });
}

export async function deleteAccount(db, { userId, password }) {
  const user = await findUserById(db, userId);
  if (user === null) {
    return { status: 401, message: NOT_LOGGED_IN_MESSAGE };
  }
  if (typeof password !== 'string' || password === '' || password.length > 2 * PASSWORD_MAX_LENGTH) {
    return { status: 400, message: AUTH_MESSAGES.wrongPassword };
  }
  if (!(await passwordMatches(password, user))) {
    return { status: 400, message: AUTH_MESSAGES.wrongPassword };
  }
  await transaction(db, async () => {
    await write(db, 'DELETE FROM login_attempts WHERE email = ?', [user.email]);
    await write(db, 'DELETE FROM users WHERE id = ?', [userId]);
  });
  return { status: 204 };
}

export async function authenticate(db, { token, now }) {
  if (typeof token !== 'string' || token === '' || token.length > 200) {
    return null;
  }
  const rows = await readRows(
    db,
    'SELECT id, user_id, expires_at, revoked_at FROM sessions WHERE token_hash = ?',
    [hashToken(token)]
  );
  if (rows.length === 0) {
    return null;
  }
  const session = rows[0];
  if (session.revoked_at !== null || session.expires_at <= now) {
    return null;
  }
  const user = await findUserById(db, session.user_id);
  if (user === null) {
    return null;
  }
  return { userId: user.id, email: user.email };
}

export async function logOut(db, { token, now }) {
  const session = await authenticate(db, { token, now });
  if (session === null) {
    return;
  }
  await write(
    db,
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash = ?',
    [now, session.userId, hashToken(token)]
  );
}

export async function requireSession(db, { token, now }) {
  const session = await authenticate(db, { token, now });
  if (session === null) {
    return { unauthorized: true, message: NOT_LOGGED_IN_MESSAGE };
  }
  return { session };
}

export function clientIp(req) {
  if (process.env.TRUST_PROXY === '1') {
    const header = req?.headers?.['x-forwarded-for'];
    if (typeof header === 'string' && header.trim() !== '') {
      return header.split(',')[0].trim();
    }
  }
  const remote = req?.socket?.remoteAddress;
  return typeof remote === 'string' && remote !== '' ? remote : UNKNOWN_IP;
}

export function sessionCookie(token) {
  return cookieHeader(token, SESSION_TTL_MS / MS_PER_SECOND);
}

export function clearedSessionCookie() {
  return cookieHeader('', 0);
}

function cookieHeader(value, maxAgeSeconds) {
  const parts = [
    `${SESSION_COOKIE_NAME}=${value}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`
  ];
  if (isProduction()) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

export function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export function readSessionToken(req) {
  const header = req?.headers?.cookie;
  if (typeof header !== 'string') {
    return null;
  }
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) {
      continue;
    }
    if (part.slice(0, separator).trim() === SESSION_COOKIE_NAME) {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}

function resetMailText(link) {
  return [
    'Hej!',
    '',
    'Någon (förhoppningsvis du) har bett om ett nytt lösenord till Hem och Ekonomi.',
    'Öppna länken nedan för att välja ett nytt lösenord. Länken gäller i en timme.',
    '',
    link,
    '',
    'Har du inte bett om det kan du strunta i det här mejlet. Ditt lösenord är oförändrat.'
  ].join('\n');
}

export async function sendResetMail(email, link) {
  const apiKey = process.env.RESEND_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    if (isProduction()) {
      return false;
    }
    console.log(`Länk för nytt lösenord till ${email}: ${link}`);
    return true;
  }
  const from = process.env.RESEND_FROM;
  if (typeof from !== 'string' || from.trim() === '') {
    return false;
  }
  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [email], subject: RESET_MAIL_SUBJECT, text: resetMailText(link) })
    });
    return response.ok;
  } catch {
    return false;
  }
}
