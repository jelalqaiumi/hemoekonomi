// Inloggningen med engångskod: koden, dess livscykel, villkorskedjan, de tio
// svenska felmeddelandena och sessionen. Ligger i src/server/ och får därför
// importera node:-moduler.
//
// Ingen funktion här läser klockan. Tiden kommer in som parametern now, en
// tidsstämpel på formen nowIso() ger (2026-09-24T18:03:00.000Z) — utan den
// regeln går varken en utgången kod eller ett tidsfönster att testa. Samma
// regel som dagens datum redan har i src/core/schedule.js.
//
// Koden står i klartext på exakt ett ställe i projektet: utvecklingslägets rad i
// sendCode nedan. Den lagras aldrig i klartext, den returneras aldrig till en
// anropare och den står aldrig i ett felmeddelande.
import crypto from 'node:crypto';

// Omslutningen av varje node:sqlite-anrop ägs av db.js, som också äger de
// svenska texterna i DATABASE_MESSAGES. Funktionerna stod modullokalt här fram
// till etapp 3 och flyttades då till sin ägare, när src/server/months.js blev en
// andra anropare: en andra handskriven kopia av samma omslutning är just det
// ägarregeln förbjuder (LARDOMAR.md 2026-09-02).
import { exec, readRows, write } from './db.js';

// Namngivna konstanter ur tabellen i ARKITEKTUR.md under "Inloggning med
// engångskod". En literal på anropsstället är ett fel.
export const CODE_LENGTH = 6;
export const CODE_TTL_MS = 10 * 60 * 1000;
export const CODE_MAX_ATTEMPTS = 5;
export const EMAIL_WINDOW_MS = 60 * 60 * 1000;
export const EMAIL_MAX_PER_WINDOW = 5;
export const IP_WINDOW_MS = 60 * 60 * 1000;
export const IP_MAX_PER_WINDOW = 20;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
export const SCRYPT_KEYLEN = 64;

// Saltets längd i byte. Står i ARKITEKTUR.md som "ett salt om 16 byte" och får
// därför en egen namngiven ägare, precis som de nio talen i tabellen.
export const SALT_BYTES = 16;

// Millisekunder per sekund, i rollen "omräkning till cookiens Max-Age", som
// anges i sekunder medan SESSION_TTL_MS är millisekunder.
const MS_PER_SECOND = 1000;

// Basen koden genereras i. randomInt över hela intervallet för CODE_LENGTH
// siffror är 0 till 10^CODE_LENGTH, och nollutfyllnaden gör varje utfall lika
// långt — 42 blir 000042, aldrig en femsiffrig kod.
const DECIMAL_BASE = 10;

// De tio texterna i tabellen "Felmeddelanden — ordagrant". Skrivs bara här.
// Ingen av dem avslöjar om en e-postadress finns i databasen: unknownCode är
// med flit samma text för rad 3 och rad 8, så att en felaktig kod och en kod
// som inte finns inte går att skilja åt i svaret.
export const AUTH_MESSAGES = Object.freeze({
  invalidEmail: 'Ange en giltig e-postadress.',
  invalidCodeFormat: 'Koden ska vara sex siffror.',
  unknownCode: 'Koden stämmer inte. Begär en ny kod och försök igen.',
  tooManyAttempts: 'För många försök på den här koden. Begär en ny kod.',
  codeConsumed: 'Koden är redan använd. Begär en ny kod.',
  codeSuperseded: 'En nyare kod har skickats. Använd den senaste koden.',
  codeExpired: 'Koden har gått ut. Begär en ny kod.',
  tooManyForEmail: 'För många koder till den här adressen. Försök igen om en stund.',
  tooManyForIp: 'För många koder från den här anslutningen. Försök igen om en stund.',
  sendFailed: 'Det gick inte att skicka koden. Försök igen.'
});

// Texten för ett anrop utan giltig session. Står i ARKITEKTUR.md under
// "Sessionen" och skrivs bara här.
export const NOT_LOGGED_IN_MESSAGE = 'Du är inte inloggad.';

// Cookiens namn, ordagrant ur ARKITEKTUR.md.
export const SESSION_COOKIE_NAME = 'hemochekonomi_session';

// Den adress som skrivs i login_codes.request_ip när anslutningens fjärradress
// inte går att läsa. Kolumnen är NOT NULL, och en tom sträng vore en adress som
// varje sådant anrop delar utan att det syns i raden.
export const UNKNOWN_IP = 'okänd';

// Mönstret för koden användaren matar in: exakt CODE_LENGTH siffror, inget
// annat. Skrivs ur konstanten och inte som /^\d{6}$/, så att en ändring av
// CODE_LENGTH inte lämnar ett hårdskrivet 6 kvar.
const CODE_PATTERN = new RegExp(`^\\d{${CODE_LENGTH}}$`);

// Formen på en e-postadress. Se paketets redovisning: ARKITEKTUR.md namnger
// ingen ägare och inget mönster för den här regeln, och raden ska skrivas in
// där innan paketet räknas som klart. Mönstret är avsiktligt tillåtande — en
// adress som ser rimlig ut ska nå utskicket, och det verkliga provet är att
// koden kommer fram.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)+$/;

// Resends HTTPS-API. Utskicket är ett POST med JSON och inget beroende.
const RESEND_ENDPOINT = 'https://api.resend.com/emails';

// Ämnesraden och brödtexten i brevet. Svensk text mot användaren, och koden
// står bara i brödtexten som skickas till adressen — aldrig i en logg.
const MAIL_SUBJECT = 'Din inloggningskod till Hemochekonomi';

function mailText(code) {
  return `Din inloggningskod är ${code}. Den gäller i tio minuter.`;
}

// Normaliseringen av en e-postadress, ordagrant som ARKITEKTUR.md skriver den:
// raw.trim().toLowerCase(). Allt som inte är en sträng ger den tomma strängen,
// som EMAIL_PATTERN avvisar.
export function normalizeEmail(raw) {
  if (typeof raw !== 'string') {
    return '';
  }
  return raw.trim().toLowerCase();
}

export function isValidEmail(email) {
  return typeof email === 'string' && EMAIL_PATTERN.test(email);
}

// Koden: CODE_LENGTH siffror ur crypto.randomInt, nollutfylld till full längd.
// randomInt är kryptografiskt säker; Math.random är det inte och får inte
// användas.
export function generateCode() {
  const max = DECIMAL_BASE ** CODE_LENGTH;
  return String(crypto.randomInt(0, max)).padStart(CODE_LENGTH, '0');
}

// Hashen av en kod: scryptSync med ett salt om SALT_BYTES byte och
// SCRYPT_KEYLEN byte utdata, som hex. Saltet lagras i login_codes.code_salt.
function hashCode(code, saltHex) {
  return crypto.scryptSync(code, Buffer.from(saltHex, 'hex'), SCRYPT_KEYLEN).toString('hex');
}

// Jämförelsen sker med crypto.timingSafeEqual: en vanlig likhetsjämförelse
// läcker information genom sin körningstid. timingSafeEqual kastar för buffertar
// av olika längd, så längden prövas först — ett code_hash med fel längd kan bara
// komma ur en skadad rad och är då inte en träff.
function codeMatches(code, row) {
  const stored = Buffer.from(row.code_hash, 'hex');
  if (stored.length !== SCRYPT_KEYLEN) {
    return false;
  }
  const candidate = Buffer.from(hashCode(code, row.code_salt), 'hex');
  return crypto.timingSafeEqual(stored, candidate);
}

// Sessionstokenet hashas med sha256 och inte med scrypt: tokenet är redan
// tillräckligt med slump, till skillnad från en sexsiffrig kod.
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

// Tidsstämpeln ms millisekunder efter now. now kommer utifrån, så ingen klocka
// läses här. Ett now som inte går att tolka kastar hellre än att skriva en rad
// med tidsstämpeln "Invalid Date".
function shiftIso(now, ms) {
  const base = Date.parse(now);
  if (!Number.isFinite(base)) {
    throw new RangeError(`auth kräver en tidsstämpel på formen ÅÅÅÅ-MM-DDTHH:MM:SS.sssZ, fick "${String(now)}".`);
  }
  return new Date(base + ms).toISOString();
}

// Uppslaget i users på email. Ett av de två undantagen från regeln att varje
// SELECT ska bära user_id: det här är satsen som avgör vem användaren är och
// kan därför inte filtrera på svaret.
function findUserByEmail(db, email) {
  const rows = readRows(db, 'SELECT id, email FROM users WHERE email = ?', [email]);
  return rows.length === 0 ? null : rows[0];
}

// Uppslaget i users på id, det andra undantaget.
function findUserById(db, userId) {
  const rows = readRows(db, 'SELECT id, email FROM users WHERE id = ?', [userId]);
  return rows.length === 0 ? null : rows[0];
}

function createUser(db, email, now, makeId) {
  const id = makeId();
  write(db, 'INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)', [id, email, now]);
  return { id, email };
}

// Antalet koder till en adress inom EMAIL_WINDOW_MS. Bär user_id enligt
// ägarregeln: koderna hör till kontot, inte till en fri e-poststräng.
function countCodesForUser(db, userId, since) {
  const rows = readRows(
    db,
    'SELECT COUNT(*) AS antal FROM login_codes WHERE user_id = ? AND created_at >= ?',
    [userId, since]
  );
  return rows[0].antal;
}

// Antalet koder från en IP inom IP_WINDOW_MS. Satsen kan inte bära user_id:
// gränsen gäller anslutningen och ska räkna över alla konton, vilket är hela
// skälet till indexet idx_login_codes_ip (request_ip, created_at). Se paketets
// redovisning: ägarregeln i ARKITEKTUR.md räknar upp två undantag och behöver
// ett tredje för den här satsen.
function countCodesForIp(db, ip, since) {
  const rows = readRows(
    db,
    'SELECT COUNT(*) AS antal FROM login_codes WHERE request_ip = ? AND created_at >= ?',
    [ip, since]
  );
  return rows[0].antal;
}

// Kodens rader för ett konto, nyaste först. created_at är samma sträng för två
// rader som skrivs inom samma millisekund, så den kan inte ensam avgöra vilken
// kod som är den nyaste. Andra nyckeln är därför rowid, SQLites egen
// insättningsordning, och aldrig id: id är ett randomUUID, och en sortering på
// det ger den kod vars slumptal råkar vara störst. Uppmätt: med `id DESC` gav
// (A12) i tests/auth.test.js "Koden är redan använd. Begär en ny kod." i stället
// för rad 3 i en av två körningar, eftersom A:s två koder delar created_at.
//
// rowid är inte ett id appen visar eller lagrar någonstans — det används bara
// här, som ordningstal. Radens id är fortfarande det UUID schemat kräver.
function codesForUser(db, userId) {
  return readRows(
    db,
    `SELECT id, user_id, code_hash, code_salt, created_at, expires_at,
            consumed_at, superseded_at, attempts
       FROM login_codes
      WHERE user_id = ?
      ORDER BY created_at DESC, rowid DESC`,
    [userId]
  );
}

// Begär en kod. Svarar alltid 202 när inget spärrvillkor slår till, oavsett om
// adressen har ett konto: att begära en kod får inte avslöja om kontot finns.
// Finns inget konto skapas det i samma anrop — registrering och inloggning är
// samma väg.
//
// makeCode och makeId är injicerbara av samma skäl som makeId i createEntry:
// ett test ska kunna veta vilken kod som skickades utan att koden lämnar
// modulen.
export async function requestCode(db, { email: rawEmail, ip, now, makeCode = generateCode, makeId = () => crypto.randomUUID() }) {
  // Rad 1 i villkorskedjan.
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { status: 400, message: AUTH_MESSAGES.invalidEmail };
  }

  const requestIp = typeof ip === 'string' && ip !== '' ? ip : UNKNOWN_IP;

  // Rad 9 prövas före rad 8: en spärrad anslutning ska inte kunna räkna upp
  // fönstret för en adress den inte äger. Båda svaren finns i tabellen för
  // vägen, och ordningen mellan dem ändrar bara vilket av de två 429-svaren en
  // anropare som bryter båda gränserna får.
  if (countCodesForIp(db, requestIp, shiftIso(now, -IP_WINDOW_MS)) >= IP_MAX_PER_WINDOW) {
    return { status: 429, message: AUTH_MESSAGES.tooManyForIp };
  }

  const existing = findUserByEmail(db, email);
  if (existing !== null
    && countCodesForUser(db, existing.id, shiftIso(now, -EMAIL_WINDOW_MS)) >= EMAIL_MAX_PER_WINDOW) {
    return { status: 429, message: AUTH_MESSAGES.tooManyForEmail };
  }

  const user = existing ?? createUser(db, email, now, makeId);

  const code = makeCode();
  const saltHex = crypto.randomBytes(SALT_BYTES).toString('hex');
  const codeId = makeId();
  const expiresAt = shiftIso(now, CODE_TTL_MS);

  // Ersättningen och den nya koden ligger i samma transaktion: annars kan en
  // avbruten skrivning lämna varje tidigare kod ersatt utan att någon ny kod
  // finns, och användaren har då ingen kod som duger.
  inTransaction(db, () => {
    // En ersatt kod duger inte längre, även om dess expires_at inte har
    // passerat: annars kan den som begär tre koder använda den första, och
    // CODE_MAX_ATTEMPTS blir en gräns per kod i stället för per inloggning.
    write(
      db,
      `UPDATE login_codes SET superseded_at = ?
        WHERE user_id = ? AND consumed_at IS NULL AND superseded_at IS NULL AND expires_at > ?`,
      [now, user.id, now]
    );
    write(
      db,
      `INSERT INTO login_codes
         (id, user_id, code_hash, code_salt, created_at, expires_at, consumed_at,
          superseded_at, attempts, request_ip)
       VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, 0, ?)`,
      [codeId, user.id, hashCode(code, saltHex), saltHex, now, expiresAt, requestIp]
    );
  });

  const sent = await sendCode(email, code);
  if (!sent) {
    // En kod användaren inte kan ta emot får inte ligga kvar och räkna mot
    // EMAIL_MAX_PER_WINDOW.
    inTransaction(db, () => {
      write(db, 'DELETE FROM login_codes WHERE user_id = ? AND id = ?', [user.id, codeId]);
    });
    return { status: 500, message: AUTH_MESSAGES.sendFailed };
  }

  return { status: 202 };
}

// Villkorskedjan vid inmatad kod. Ordningen är den bindande tabellens, och
// första träff vinner.
//
// Raderna 5, 6 och 7 är påståenden om en bestämd kod, och vilken kod det är
// avgörs av hashen: den rad vars hash stämmer är den kod användaren matade in.
// Stämmer ingen rad prövas rad 4 mot den nyaste koden, som är den kod försöken
// räknas på, och svaret blir därefter rad 8 — som ger samma text som rad 3.
export function verifyCode(db, { email: rawEmail, code, now, makeId = () => crypto.randomUUID() }) {
  // Rad 1.
  const email = normalizeEmail(rawEmail);
  if (!isValidEmail(email)) {
    return { status: 400, message: AUTH_MESSAGES.invalidEmail };
  }

  // Rad 2.
  if (typeof code !== 'string' || !CODE_PATTERN.test(code)) {
    return { status: 400, message: AUTH_MESSAGES.invalidCodeFormat };
  }

  // Rad 3: ingen kod finns för e-posten. En adress utan konto och ett konto
  // utan kod ger samma svar som en felaktig kod.
  const user = findUserByEmail(db, email);
  if (user === null) {
    return { status: 400, message: AUTH_MESSAGES.unknownCode };
  }
  const codes = codesForUser(db, user.id);
  if (codes.length === 0) {
    return { status: 400, message: AUTH_MESSAGES.unknownCode };
  }

  const matching = codes.find((row) => codeMatches(code, row));
  const target = matching ?? codes[0];

  // Rad 4, före rad 5, 6 och 7 med avsikt: är försöken uttömda ska användaren
  // få veta det även om koden dessutom hunnit gå ut.
  if (target.attempts >= CODE_MAX_ATTEMPTS) {
    return { status: 429, message: AUTH_MESSAGES.tooManyAttempts };
  }

  // Rad 5.
  if (target.consumed_at !== null) {
    return { status: 400, message: AUTH_MESSAGES.codeConsumed };
  }

  // Rad 6.
  if (target.superseded_at !== null) {
    return { status: 400, message: AUTH_MESSAGES.codeSuperseded };
  }

  // Rad 7. Tidsstämplarna är UTC på samma form, så en strängjämförelse är
  // samma ordning som en tidsjämförelse.
  if (target.expires_at <= now) {
    return { status: 400, message: AUTH_MESSAGES.codeExpired };
  }

  // Rad 8: hashen stämmer inte. Samma text som rad 3, och antalet försök ökas
  // med ett på den kod försöken räknas på.
  if (matching === undefined) {
    write(
      db,
      'UPDATE login_codes SET attempts = attempts + 1 WHERE user_id = ? AND id = ?',
      [user.id, target.id]
    );
    return { status: 400, message: AUTH_MESSAGES.unknownCode };
  }

  // Rad 9. Koden förbrukas och sessionen skapas i samma transaktion: en
  // session utan förbrukad kod vore en kod som duger en andra gång.
  const token = crypto.randomUUID();
  const sessionId = makeId();
  inTransaction(db, () => {
    write(
      db,
      'UPDATE login_codes SET consumed_at = ? WHERE user_id = ? AND id = ?',
      [now, user.id, matching.id]
    );
    write(
      db,
      `INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at, revoked_at)
       VALUES (?, ?, ?, ?, ?, NULL)`,
      [sessionId, user.id, hashToken(token), now, shiftIso(now, SESSION_TTL_MS)]
    );
  });

  return { status: 204, token };
}

// Vem är användaren? Uppslaget sker på token_hash — det andra av ägarregelns
// två undantag, och den sats som avgör vem användaren är.
// Svarar null för en session som saknas, är återkallad eller har gått ut; den
// som anropar behandlar null som "inte inloggad".
export function authenticate(db, { token, now }) {
  if (typeof token !== 'string' || token === '') {
    return null;
  }
  const rows = readRows(
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
  const user = findUserById(db, session.user_id);
  if (user === null) {
    return null;
  }
  return { userId: user.id, email: user.email };
}

// Utloggning. Sätter revoked_at och svarar aldrig med ett fel: utloggning ska
// alltid gå igenom, också utan giltig session. UPDATE:n bär user_id enligt
// ägarregeln, och user_id kommer ur sessionen och aldrig ur anropet.
export function logOut(db, { token, now }) {
  const session = authenticate(db, { token, now });
  if (session === null) {
    return;
  }
  write(
    db,
    'UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND token_hash = ?',
    [now, session.userId, hashToken(token)]
  );
}

// Den enda spärren mot ett anrop utan giltig session. Varje skyddad väg går
// genom den här funktionen i stället för att upprepa kontrollen: en kopia per
// väg är en kopia som kan glömmas i nästa väg som skrivs.
//
// Svarar { session } för en giltig session och { unauthorized: true } annars.
// Anroparen når aldrig datalagret för sina egna tabeller utan ett session-svar,
// och user_id kommer ur sessionen — aldrig ur kroppen, sökvägen eller
// frågesträngen.
export function requireSession(db, { token, now }) {
  const session = authenticate(db, { token, now });
  if (session === null) {
    return { unauthorized: true, message: NOT_LOGGED_IN_MESSAGE };
  }
  return { session };
}

// Klientens adress. X-Forwarded-For litas på endast när TRUST_PROXY är '1':
// utan proxy kan vem som helst sätta huvudet själv och därmed kringgå både
// IP_MAX_PER_WINDOW och EMAIL_MAX_PER_WINDOW. Första kommaseparerade värdet,
// trimmat, eftersom proxyn lägger till sitt eget värde sist.
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

// Sessionscookien. HttpOnly, Path=/ och SameSite=Lax alltid; Max-Age ur
// SESSION_TTL_MS. Secure bara i drift: över http://127.0.0.1 skulle Secure
// göra att webbläsaren aldrig skickar tillbaka cookien, och inloggningen hade
// då varit omöjlig att prova lokalt. SameSite=Lax och inte Strict, så att
// cookien följer med när användaren kommer till appen från en länk i e-posten.
export function sessionCookie(token) {
  return cookieHeader(token, SESSION_TTL_MS / MS_PER_SECOND);
}

// Cookien som upphör omedelbart: Max-Age 0 och ett tomt värde.
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

// Tokenet ur cookiehuvudet. Ingen avkodning och ingen normalisering: tokenet är
// ett randomUUID och innehåller bara tecken som är sig själva i en cookie.
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

// Utskicket. Svarar true när koden är på väg till adressen och false annars —
// aldrig ett kast, eftersom ett misslyckat utskick är rad 10 och inte ett
// internt fel.
//
// Utan RESEND_API_KEY är det utvecklingsläge: koden skrivs på stdout. Det är
// den enda platsen i projektet där en kod får stå i klartext, och den finns för
// att inloggningsflödet ska gå att prova utan e-postkonto.
async function sendCode(email, code) {
  const apiKey = process.env.RESEND_API_KEY;
  if (typeof apiKey !== 'string' || apiKey.trim() === '') {
    // Utvecklingslägets kodrad.
    console.log(`Inloggningskod till ${email}: ${code} (gäller i tio minuter)`);
    return true;
  }

  const from = process.env.RESEND_FROM;
  if (typeof from !== 'string' || from.trim() === '') {
    // RESEND_FROM krävs när RESEND_API_KEY är satt. Utan avsändare går brevet
    // inte att skicka, och svaret är därför rad 10 och inte ett kast.
    return false;
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        from,
        to: [email],
        subject: MAIL_SUBJECT,
        text: mailText(code)
      })
    });
    return response.ok;
  } catch {
    // Ett nätverksfel är ett misslyckat utskick och inget annat. Felet får inte
    // föras vidare: det bär engelsk text, och användaren ska läsa rad 10.
    return false;
  }
}

// En transaktion runt ett antal skrivningar. BEGIN, arbetet, COMMIT — och
// ROLLBACK om något faller, så att en halv ändring aldrig blir kvar.
// Städningen sväljer sitt eget fel: den får inte ersätta det verkliga felet.
function inTransaction(db, work) {
  exec(db, 'BEGIN');
  try {
    work();
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Med flit tom.
    }
    throw error;
  }
  exec(db, 'COMMIT');
}

