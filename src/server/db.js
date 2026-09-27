// Databasen: anslutningen, pragman, schemat och PRAGMA user_version.
// Ligger i src/server/ och får därför importera node:-moduler.
//
// DatabaseSync är synkron. Ingen funktion i den här filen är async och ingen
// anropare ska await:a den — ett await på ett värde som inte är ett löfte gömmer
// bara att arbetet redan är klart.
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { getDatabaseFilePath } from './paths.js';

// Schemaversionen står i PRAGMA user_version, inte i en egen tabell. Etapp 1
// sätter 1; ett senare schema höjer talet och kör sitt steg när det lästa talet
// är lägre.
export const SCHEMA_VERSION = 1;

// Den sökväg DatabaseSync tolkar som "ingen fil, bara minne". Testerna öppnar en
// egen sådan databas per testfall.
export const MEMORY_PATH = ':memory:';

// .message är alltid svensk text: den skickas rakt ut till användaren av api.js
// (500 { error }), på samma sätt som StorageError i src/server/storage.js.
// Skillnaden mot StorageError är medveten och står i ARKITEKTUR.md under
// "Databasens fel når aldrig användaren på engelska": StorageError skriver ut
// datafilens sökväg, eftersom den appen kördes lokalt av den som äger filen. Den
// här appen nås över internet, så varken sökväg eller SQL-text får stå i
// .message — en sökväg avslöjar serverns filsystem och SQL-texten avslöjar
// schemat. Originalfelet finns kvar i .cause.
export class DatabaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

// De fyra texterna i tabellen "Felen — ordagrant" i ARKITEKTUR.md, skrivna bara
// här. openFailed används av den här filen; readFailed, writeFailed och
// constraintFailed fick sina första anropare i src/server/auth.js [etapp 2], som
// är den första filen som kör frågor — ingen exporterad funktion här kör någon
// annan fråga än schemat och pragman. Strängarna har därmed en enda ägare, och
// varje anropare läser dem härifrån.
//
// constraintFailed är ett programmeringsfel och inte ett användarfel: all indata
// valideras i src/core/ innan den når datalagret, så ett brutet CHECK betyder
// att valideringen har ett hål. Texten är därför medvetet allmän, och .cause
// bär originalet så att felet går att hitta på servern.
export const DATABASE_MESSAGES = Object.freeze({
  openFailed: 'Databasen kunde inte öppnas. Kontakta den som driftar appen.',
  readFailed: 'Det gick inte att läsa dina uppgifter. Försök igen.',
  writeFailed: 'Det gick inte att spara. Försök igen.',
  constraintFailed: 'Uppgifterna kunde inte sparas: något värde är ogiltigt.'
});

// Pragman sätts på varje anslutning, direkt efter att den öppnats.
// PRAGMA foreign_keys är per anslutning: utan raden är varje REFERENCES i
// schemat nedan bara en kommentar. journal_mode är en egenskap hos filen och
// behöver bara sättas en gång, men raden är idempotent och får därför köras
// varje gång. Mot MEMORY_PATH svarar SQLite 'memory' i stället för 'wal' utan
// att kasta — körd på Node v24.19.0: {"journal_mode":"memory"}.
const PRAGMA_SQL = `
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
`;

// Schemat står ordagrant som i ARKITEKTUR.md under "Datamodell: SQLite-schemat
// (bindande)", med IF NOT EXISTS tillagt på varje CREATE så att anropet är
// ofarligt att göra om. Kolumnen interval behöver inga citationstecken: körd
// mot new DatabaseSync(':memory:') på Node v24.19.0 går CREATE TABLE igenom och
// ett INSERT ger {"id":"t1","interval":"monthly","amount_ore":100}.
const SCHEMA_SQL = `
-- Ett konto. Skapas vid första begäran om en inloggningskod; ingen separat
-- registrering finns.
CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  email       TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL
);

-- En utskickad engångskod. Koden lagras ALDRIG i klartext: kolumnen bär
-- scryptSync(kod, salt, 64) som hex, och saltet står i code_salt.
CREATE TABLE IF NOT EXISTS login_codes (
  id             TEXT PRIMARY KEY,
  user_id        TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash      TEXT NOT NULL,
  code_salt      TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  expires_at     TEXT NOT NULL,
  consumed_at    TEXT,            -- NULL = inte använd ännu
  superseded_at  TEXT,            -- NULL = inte ersatt av en nyare kod
  attempts       INTEGER NOT NULL DEFAULT 0,
  request_ip     TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_login_codes_user ON login_codes (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_login_codes_ip ON login_codes (request_ip, created_at);

-- En inloggad session. Tokenet finns bara i användarens cookie; tabellen bär
-- sha256(token) som hex.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  revoked_at  TEXT                -- NULL = giltig; sätts vid utloggning
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- En återkommande post, versionerad. En version gäller från from_month till och
-- med to_month; to_month = NULL betyder "gäller framåt utan slut". Alla
-- versioner av samma post delar series_id.
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id   TEXT NOT NULL,      -- första versionens id
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  interval    TEXT NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  start_date  TEXT NOT NULL CHECK (start_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  from_month  TEXT NOT NULL CHECK (from_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  to_month    TEXT CHECK (to_month IS NULL OR to_month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  created_at  TEXT NOT NULL,
  CHECK (to_month IS NULL OR to_month >= from_month)
);
CREATE INDEX IF NOT EXISTS idx_templates_user_period ON templates (user_id, from_month, to_month);
CREATE INDEX IF NOT EXISTS idx_templates_series ON templates (user_id, series_id, from_month);

-- En engångspost: gäller exakt en månad och har inget intervall och ingen dag.
CREATE TABLE IF NOT EXISTS month_items (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_month_items_user_month ON month_items (user_id, month);

-- En avvikelse för en enskild månad av en mall: antingen ett annat belopp den
-- månaden, eller att posten hoppas över den månaden. Aldrig båda, aldrig
-- ingenting.
CREATE TABLE IF NOT EXISTS overrides (
  id           TEXT PRIMARY KEY,  -- crypto.randomUUID()
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id  TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  month        TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  amount_ore   INTEGER CHECK (amount_ore IS NULL OR amount_ore > 0),
  skipped      INTEGER NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  created_at   TEXT NOT NULL,
  CHECK ((skipped = 1 AND amount_ore IS NULL) OR (skipped = 0 AND amount_ore IS NOT NULL)),
  UNIQUE (template_id, month)
);
CREATE INDEX IF NOT EXISTS idx_overrides_user_month ON overrides (user_id, month);
`;

// Varje node:sqlite-fraga i projektet gar genom en av de tva funktionerna nedan,
// och ingen av dem slapper ut ett engelskt fel. Lasning ger rad 2 i feltabellen,
// skrivning rad 3, och ett brutet CHECK eller UNIQUE rad 4 - errstr ar
// node:sqlites eget falt och inte en lasning av den engelska texten.
//
// De tre funktionerna skrevs forst modullokalt i src/server/auth.js [etapp 2].
// De flyttades hit i etapp 3, nar src/server/months.js blev en andra anropare:
// en andra handskriven kopia av samma omslutning ar just det agarregeln forbjuder
// (LARDOMAR.md 2026-09-02). Agaren till de svenska texterna, DATABASE_MESSAGES,
// bor redan i den har filen, sa omslutningen hor hit.
function asDatabaseError(error, fallbackMessage) {
  const message = error?.errstr === 'constraint failed'
    ? DATABASE_MESSAGES.constraintFailed
    : fallbackMessage;
  return new DatabaseError(message, { cause: error });
}

export function readRows(db, sql, params) {
  try {
    return db.prepare(sql).all(...params);
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.readFailed);
  }
}

// Satser utan parametrar och utan svar: BEGIN, COMMIT och schemastegen. Samma
// omslutning som write, och skrivningens rad i feltabellen - en sats som korts
// utan att lyckas ar en skrivning som inte blev av.
export function exec(db, sql) {
  try {
    db.exec(sql);
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.writeFailed);
  }
}

export function write(db, sql, params) {
  try {
    return db.prepare(sql).run(...params);
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.writeFailed);
  }
}

// Den anslutning getDatabase() delar ut. null betyder "ingen öppen anslutning".
// En anslutning per process: SQLite äger samtidigheten inuti filen, och
// src/server/lock.js hindrar en andra process på samma maskin.
let sharedDatabase = null;

// Öppnar en anslutning, sätter pragman, skapar schemat om det inte finns och
// sätter PRAGMA user_version. Anropas av getDatabase() för appens databas och
// direkt av testerna, som vill ha en egen databas per testfall.
export function openDatabase(filePath) {
  if (typeof filePath !== 'string' || filePath === '') {
    throw new TypeError('openDatabase kräver en sökväg som en icke-tom sträng.');
  }
  // Katalogen räknas med i "går inte att öppna eller skapa": misslyckas den kan
  // databasen inte skapas, och node:fs-felet bär både engelsk text och sökvägen.
  if (filePath !== MEMORY_PATH) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
    } catch (error) {
      throw new DatabaseError(DATABASE_MESSAGES.openFailed, { cause: error });
    }
  }

  // Varje node:sqlite-anrop i funktionen ligger innanför det här try:t. De fyra
  // stegen är tillsammans "öppna eller skapa databasen" och har därför samma
  // rad i feltabellen: en anropare som får svaret kan inte använda anslutningen
  // vare sig pragman, schemat eller versionen föll.
  let database = null;
  try {
    database = new DatabaseSync(filePath);
    database.exec(PRAGMA_SQL);
    database.exec(SCHEMA_SQL);
    database.exec(`PRAGMA user_version = ${SCHEMA_VERSION};`);
  } catch (error) {
    // Öppnades anslutningen men föll ett senare steg ligger handtaget kvar och
    // håller filen låst — körd på Node v24.19.0 mot en fil som inte är en
    // databas ("file is not a database"): utan stängningen ger fs.rmSync av
    // filen EPERM. Städningen sväljer sitt eget fel, precis som writeToDisk i
    // storage.js: den får inte ersätta det verkliga felet.
    if (database !== null) {
      try {
        database.close();
      } catch {
        // Med flit tom.
      }
    }
    throw new DatabaseError(DATABASE_MESSAGES.openFailed, { cause: error });
  }
  return database;
}

// Appens databas. Sökvägen läses genom getDatabaseFilePath() vid det första
// anropet; därefter delas samma anslutning ut. Byter ett test miljövariabeln
// måste det anropa closeDatabase() först.
export function getDatabase() {
  if (sharedDatabase === null) {
    sharedDatabase = openDatabase(getDatabaseFilePath());
  }
  return sharedDatabase;
}

// Stänger den delade anslutningen om det finns en. Ofarlig att anropa när ingen
// är öppen, så ett test kan städa utan att först fråga.
export function closeDatabase() {
  if (sharedDatabase !== null) {
    const database = sharedDatabase;
    // Nollställs före close(): faller stängningen ska nästa getDatabase() öppna
    // en ny anslutning i stället för att dela ut en som redan är på väg bort.
    sharedDatabase = null;
    try {
      database.close();
    } catch (error) {
      // En stängning som misslyckas betyder att WAL-innehållet kanske inte nådde
      // filen, så svaret är skrivningens rad i feltabellen. Tabellen har ingen
      // egen rad för en stängning; se paketets redovisning.
      throw new DatabaseError(DATABASE_MESSAGES.writeFailed, { cause: error });
    }
  }
}
