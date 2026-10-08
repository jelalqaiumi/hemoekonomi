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
  created_at  TEXT NOT NULL,
  plan        TEXT NOT NULL DEFAULT 'bas' CHECK (plan IN ('bas', 'plus', 'premium'))
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
  created_at  TEXT NOT NULL,
  -- Dagen utgiften gjordes, NULL när användaren inte anger den [steg 2]. Den är
  -- inte dueDate: dueDate räknas fram ur en malls interval och start_date och
  -- står inte i någon kolumn, occurred_on är en dag användaren skriver in. En
  -- post kan ha båda, och de två namnen hålls isär överallt.
  occurred_on TEXT CHECK (occurred_on IS NULL OR occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  -- Fritext, högst 200 tecken. Längden står inte som ett CHECK här: SQLite:s
  -- length() räknar tecken i en annan mening än [...note].length, och kärnan
  -- äger regeln (checkNote i src/core/entry.js).
  note        TEXT
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

-- Ett tak för en kategori och en månad [steg 2]. UNIQUE hindrar två tak för
-- samma kategori och månad, och gör PUT till en enda operation: ON CONFLICT
-- ersätter i stället för att falla.
--
-- category har inget CHECK. Kategorilistan ägs av CATEGORIES i src/core/entry.js
-- och prövas av checkCategory där; ett CHECK här hade blivit en andra kopia som
-- kan glida isär (ARKITEKTUR.md under "Tabellen").
--
-- Ingen egen idx_-rad: UNIQUE (user_id, month, category) ger ett index med
-- user_id och month som sina första kolumner, alltså just det uppslag
-- readMonth gör.
CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,   -- crypto.randomUUID()
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
  category    TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  created_at  TEXT NOT NULL,
  UNIQUE (user_id, month, category)
);

-- En räkning: något som ska betalas, och när [steg 3]. En egen tabell och inte
-- ett fält till på month_items: en månadspost svarar på "vad kostade den här
-- månaden?" och bär occurred_on, en räkning svarar på "vad ska betalas, och
-- när?" och bär due_date plus ett tillstånd (ARKITEKTUR.md, tabellen under "En
-- räkning är inte en månadspost").
--
-- interval är NULL för en engångsräkning. Därav IS NULL i CHECK:en: värdelistan
-- gäller bara när ett värde står där. Listan skrivs för hand i SQL och härleds
-- inte ur INTERVALS i src/core/entry.js, av samma skäl som plan-kolumnens lista
-- inte härleds ur PLANS: ett CHECK är text SQLite tolkar. Kopplingen hålls av
-- (R9) i tests/bills.test.js, som läser villkoret ur sqlite_master.
--
-- remind_days är hur många dagar innan förfallodagen påminnelsen visas; 0
-- betyder på dagen. Gränsen står både här och i kärnan (REMIND_DAYS_MIN och
-- REMIND_DAYS_MAX i src/core/bill.js) — samma två spärrar i två språk som för
-- kind och interval: kärnan ger användaren en svensk text och ett 400, schemat
-- är sista utposten mot ett programmeringsmisstag.
--
-- paid_at är tidpunkten räkningen markerades betald, NULL när den är obetald. En
-- återkommande räkning som betalas får den nollställd igen och ett nytt due_date:
-- raden är alltså alltid den nästa obetalda, och historiken över betalda
-- räkningar lagras inte (PLAN.md beslut 4).
--
-- anchor_date är intervallets fas: den ursprungliga förfallodagen, som styr
-- vilken dag i månaden serien återkommer på. Samma roll som templates.start_date
-- har för en mall. Den sätts till den första förfallodagen när räkningen skapas
-- och ändras aldrig av en betalning — bara när användaren själv ändrar
-- förfallodagen genom PUT. Utan den skulle en klampning bli bestående: en
-- månadsräkning den 31 januari flyttas till den 28 februari, och nästa betalning
-- hade då räknat från den 28:e och gett den 28 mars i stället för den 31
-- (ARKITEKTUR.md, "Klampningen ska inte fastna — en ankardag bevaras").
--
-- Inget eget idx_: ARKITEKTUR.md:s SQL-block är bindande ordagrant och har
-- ingen indexrad, till skillnad från login_codes, sessions och templates ovan.
CREATE TABLE IF NOT EXISTS bills (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  amount_ore    INTEGER NOT NULL CHECK (amount_ore > 0),
  due_date      TEXT NOT NULL CHECK (due_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  anchor_date   TEXT NOT NULL CHECK (anchor_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  interval      TEXT CHECK (interval IS NULL OR interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  remind_days   INTEGER NOT NULL DEFAULT 3 CHECK (remind_days >= 0 AND remind_days <= 30),
  paid_at       TEXT,
  created_at    TEXT NOT NULL
);
`;

// Kolumnen users.plan [steg 1 i del 5]. Står ordagrant som i ARKITEKTUR.md under
// "Kopplingen till schemat", på två ställen med flit: i CREATE TABLE ovan för en
// databas som skapas nu, och här för en databas som redan finns — CREATE TABLE
// IF NOT EXISTS lägger inte till en kolumn i en tabell som är skapad.
//
// Värdelistan skrivs för hand i SQL och härleds inte ur PLANS i
// src/core/plans.js: ett CHECK är text som SQLite tolkar, inte ett uttryck som
// går att bygga av en JavaScript-lista utan att samtidigt öppna för att listan
// klistras in i SQL. Kopplingen mellan de två hålls av (P6) i tests/db.test.js,
// som läser villkoret ur sqlite_master och jämför med Object.keys(PLANS) —
// samma prov som redan binder kind till ITEM_KINDS.
//
// Förvalet 'bas' är hela migreringen: varje befintlig rad får 'bas' av SQLite
// när kolumnen läggs till, så ingen UPDATE behövs och ingen rad skrivs om.
const ADD_PLAN_COLUMN_SQL =
  "ALTER TABLE users ADD COLUMN plan TEXT NOT NULL DEFAULT 'bas' CHECK (plan IN ('bas', 'plus', 'premium'));";

// De två kolumnerna på month_items [steg 2], av samma skäl och på samma två
// ställen som plan ovan: i CREATE TABLE för en databas som skapas nu, och här
// för en databas som redan finns. Villkoret och CHECK-texten står ordagrant som
// i CREATE TABLE — en avvikelse mellan de två hade gjort att en migrerad databas
// avvisade en rad en ny databas tar emot.
//
// Körd på Node v24.19.0: ALTER TABLE ADD COLUMN tar emot ett CHECK på den nya
// kolumnen, och ett INSERT med occurred_on '2026-13-99x' faller därefter med
// errstr 'constraint failed' också i den migrerade databasen. Varje befintlig rad
// får NULL i båda kolumnerna, så ingen UPDATE behövs och ingen rad skrivs om.
const ADD_OCCURRED_ON_COLUMN_SQL =
  "ALTER TABLE month_items ADD COLUMN occurred_on TEXT CHECK (occurred_on IS NULL OR occurred_on GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');";

const ADD_NOTE_COLUMN_SQL = 'ALTER TABLE month_items ADD COLUMN note TEXT;';

// Kolumnen bills.anchor_date [rättelsen till steg 3], på samma två ställen och
// av samma skäl som de tre ovan.
//
// Två satser i en exec: SQLite kräver ett DEFAULT som inte är NULL när en
// NOT NULL-kolumn läggs till, och ett ADD COLUMN skriver inte om befintliga
// rader. Förvalet '1970-01-01' är därför bara det värde som står i schemat
// mellan de två satserna; UPDATE-raden sätter anchor_date = due_date för varje
// befintlig rad direkt efteråt, och det är rätt värde: en räkning som aldrig
// betalats har sin ursprungliga dag kvar i due_date (ARKITEKTUR.md,
// "Migreringen"). Steget körs bara när kolumnen saknas, så UPDATE:n kan inte
// skriva över en anchor_date som redan bär sitt värde.
//
// Körd på Node v24.19.0: ALTER TABLE ADD COLUMN tar emot både NOT NULL DEFAULT
// och CHECK på den nya kolumnen, och ett INSERT med anchor_date 'x' faller
// därefter med errstr 'constraint failed' också i den migrerade databasen.
const ADD_ANCHOR_DATE_COLUMN_SQL =
  `ALTER TABLE bills ADD COLUMN anchor_date TEXT NOT NULL DEFAULT '1970-01-01' CHECK (anchor_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');
UPDATE bills SET anchor_date = due_date;`;

// Varje steg körs bara när kolumnen saknas, och villkoret är kolumnen själv och
// inte PRAGMA user_version: ALTER TABLE ADD COLUMN är ett fel om kolumnen redan
// finns, och en databas som skapats av CREATE TABLE ovan har den från början.
// Ett villkor på user_version hade behövt svara på frågan "finns kolumnen?"
// indirekt, genom ett tal som en äldre körning kan ha satt av ett annat skäl.
//
// Listan står som data och inte som tre if-satser: frågan "finns kolumnen?" har
// då en enda ägande funktion, hasColumn nedan, i stället för en handskriven kopia
// per kolumn (LARDOMAR.md 2026-09-02).
const COLUMN_MIGRATIONS = Object.freeze([
  Object.freeze({ table: 'users', column: 'plan', sql: ADD_PLAN_COLUMN_SQL }),
  Object.freeze({ table: 'month_items', column: 'occurred_on', sql: ADD_OCCURRED_ON_COLUMN_SQL }),
  Object.freeze({ table: 'month_items', column: 'note', sql: ADD_NOTE_COLUMN_SQL }),
  Object.freeze({ table: 'bills', column: 'anchor_date', sql: ADD_ANCHOR_DATE_COLUMN_SQL })
]);

// PRAGMA table_info ger en rad per kolumn. Läses genom prepare().all(), som
// db.test.js redan gör för PRAGMA user_version.
//
// Tabellnamnet kommer ur COLUMN_MIGRATIONS ovan och aldrig utifrån: PRAGMA tar
// inga parametrar, så namnet måste stå i SQL-texten, och den enda listan som
// når hit är den frysta.
function hasColumn(database, table, column) {
  return database
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .some((row) => row.name === column);
}

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

// Flera skrivningar som ska lyckas tillsammans eller inte alls. BEGIN, COMMIT
// och ROLLBACK går genom exec ovan, så ett fel från någon av de tre blir en
// DatabaseError med svensk text precis som varje annan fråga i projektet.
//
// Omslutningen bor här och inte hos anroparen av samma skäl som readRows, exec
// och write flyttades hit i etapp 3: en andra handskriven kopia av samma
// omslutning är just det ägarregeln förbjuder (LARDOMAR.md 2026-09-02).
//
// ROLLBACK har ingen egen felhantering. Faller den är anslutningen obrukbar, och
// ett svalt fel där hade gjort det osynligt; ett try/catch runt raden vore
// dessutom en gren som ingen indata når (LARDOMAR.md 2026-09-04). De två grenar
// funktionen har nås båda: den lyckade av varje anrop, den fallerande av
// (M19) i tests/months.test.js.
//
// SQLite har inga nästlade transaktioner: ett BEGIN inuti en pågående
// transaktion är ett fel. Ingen anropare i src/ anropar därför transaction
// inuti en annan transaction.
export function transaction(db, work) {
  exec(db, 'BEGIN');
  let result;
  try {
    result = work();
  } catch (error) {
    exec(db, 'ROLLBACK');
    throw error;
  }
  exec(db, 'COMMIT');
  return result;
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
    // Samma rad i feltabellen som de tre stegen ovan: en databas vars kolumn
    // inte gick att lägga till kan inte användas, och svaret är därför
    // openFailed och inte en egen text.
    for (const migration of COLUMN_MIGRATIONS) {
      if (!hasColumn(database, migration.table, migration.column)) {
        database.exec(migration.sql);
      }
    }
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
