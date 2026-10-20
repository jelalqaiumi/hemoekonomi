import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

import { getDatabaseFilePath } from './paths.js';

export const SCHEMA_VERSION = 2;

export const MEMORY_PATH = ':memory:';

export class DatabaseError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'DatabaseError';
  }
}

export const DATABASE_MESSAGES = Object.freeze({
  openFailed: 'Databasen kunde inte öppnas. Kontakta den som driftar appen.',
  readFailed: 'Det gick inte att läsa dina uppgifter. Försök igen.',
  writeFailed: 'Det gick inte att spara. Försök igen.',
  constraintFailed: 'Uppgifterna kunde inte sparas: något värde är ogiltigt.'
});

const DATE_CHECK = "~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'";
const MONTH_CHECK = "~ '^[0-9]{4}-[0-9]{2}$'";

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS schema_version (
  version INTEGER NOT NULL
);

-- Ett konto. Skapas vid registrering. Lösenordet lagras aldrig i klartext:
-- password_hash bär scrypt(lösenord, salt, 64) som hex, och saltet står i
-- password_salt.
CREATE TABLE IF NOT EXISTS users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE,
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  created_at     TEXT COLLATE "C" NOT NULL
);

-- Ett försök att logga in, lyckat eller inte. Används för att begränsa antalet
-- försök per e-postadress och per IP-adress.
CREATE TABLE IF NOT EXISTS login_attempts (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  request_ip  TEXT NOT NULL,
  created_at  TEXT COLLATE "C" NOT NULL,
  succeeded   SMALLINT NOT NULL CHECK (succeeded IN (0, 1))
);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON login_attempts (email, created_at);
CREATE INDEX IF NOT EXISTS idx_login_attempts_ip ON login_attempts (request_ip, created_at);

-- En begäran om nytt lösenord. Tokenet finns bara i länken i mejlet; tabellen
-- bär sha256(token) som hex.
CREATE TABLE IF NOT EXISTS password_resets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT COLLATE "C" NOT NULL,
  expires_at  TEXT COLLATE "C" NOT NULL,
  used_at     TEXT,
  request_ip  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_password_resets_user ON password_resets (user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_password_resets_ip ON password_resets (request_ip, created_at);

-- En inloggad session. Tokenet finns bara i användarens cookie; tabellen bär
-- sha256(token) som hex.
CREATE TABLE IF NOT EXISTS sessions (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT COLLATE "C" NOT NULL,
  expires_at  TEXT COLLATE "C" NOT NULL,
  revoked_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions (user_id);

-- En återkommande post, versionerad. En version gäller från from_month till och
-- med to_month; to_month = NULL betyder "gäller framåt utan slut". Alla
-- versioner av samma post delar series_id.
CREATE TABLE IF NOT EXISTS templates (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  series_id   TEXT NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  interval    TEXT NOT NULL CHECK (interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  start_date  TEXT COLLATE "C" NOT NULL CHECK (start_date ${DATE_CHECK}),
  from_month  TEXT COLLATE "C" NOT NULL CHECK (from_month ${MONTH_CHECK}),
  to_month    TEXT COLLATE "C" CHECK (to_month IS NULL OR to_month ${MONTH_CHECK}),
  created_at  TEXT COLLATE "C" NOT NULL,
  CHECK (to_month IS NULL OR to_month >= from_month)
);
CREATE INDEX IF NOT EXISTS idx_templates_user_period ON templates (user_id, from_month, to_month);
CREATE INDEX IF NOT EXISTS idx_templates_series ON templates (user_id, series_id, from_month);

CREATE TABLE IF NOT EXISTS month_items (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT COLLATE "C" NOT NULL CHECK (month ${MONTH_CHECK}),
  kind        TEXT NOT NULL CHECK (kind IN ('income', 'expense', 'saving')),
  name        TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  category    TEXT NOT NULL,
  created_at  TEXT COLLATE "C" NOT NULL,
  occurred_on TEXT COLLATE "C" CHECK (occurred_on IS NULL OR occurred_on ${DATE_CHECK}),
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_month_items_user_month ON month_items (user_id, month);

CREATE TABLE IF NOT EXISTS overrides (
  id           TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_id  TEXT NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  month        TEXT COLLATE "C" NOT NULL CHECK (month ${MONTH_CHECK}),
  amount_ore   INTEGER CHECK (amount_ore IS NULL OR amount_ore > 0),
  skipped      SMALLINT NOT NULL DEFAULT 0 CHECK (skipped IN (0, 1)),
  created_at   TEXT COLLATE "C" NOT NULL,
  CHECK ((skipped = 1 AND amount_ore IS NULL) OR (skipped = 0 AND amount_ore IS NOT NULL)),
  UNIQUE (template_id, month)
);
CREATE INDEX IF NOT EXISTS idx_overrides_user_month ON overrides (user_id, month);

CREATE TABLE IF NOT EXISTS budgets (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  month       TEXT COLLATE "C" NOT NULL CHECK (month ${MONTH_CHECK}),
  category    TEXT NOT NULL,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore > 0),
  created_at  TEXT COLLATE "C" NOT NULL,
  UNIQUE (user_id, month, category)
);

CREATE TABLE IF NOT EXISTS bills (
  id            TEXT PRIMARY KEY,
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  amount_ore    INTEGER NOT NULL CHECK (amount_ore > 0),
  due_date      TEXT COLLATE "C" NOT NULL CHECK (due_date ${DATE_CHECK}),
  anchor_date   TEXT COLLATE "C" NOT NULL CHECK (anchor_date ${DATE_CHECK}),
  interval      TEXT CHECK (interval IS NULL OR interval IN ('monthly', 'quarterly', 'semiannual', 'yearly')),
  remind_days   INTEGER NOT NULL DEFAULT 3 CHECK (remind_days >= 0 AND remind_days <= 30),
  paid_at       TEXT,
  created_at    TEXT COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS goals (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  target_ore  INTEGER NOT NULL CHECK (target_ore > 0),
  target_date TEXT COLLATE "C" CHECK (target_date IS NULL OR target_date ${DATE_CHECK}),
  created_at  TEXT COLLATE "C" NOT NULL
);

CREATE TABLE IF NOT EXISTS goal_deposits (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  goal_id     TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
  amount_ore  INTEGER NOT NULL CHECK (amount_ore <> 0),
  made_on     TEXT COLLATE "C" NOT NULL CHECK (made_on ${DATE_CHECK}),
  created_at  TEXT COLLATE "C" NOT NULL
);
`;

const INT8_OID = 20;
const NUMERIC_OID = 1700;
function parseNumber(value) {
  return value === null ? null : Number(value);
}

export function toPositional(sql) {
  let n = 0;
  return sql.replace(/\?/g, () => {
    n += 1;
    return `$${n}`;
  });
}

function isConstraintError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('23');
}

function asDatabaseError(error, fallbackMessage) {
  if (error instanceof DatabaseError) {
    return error;
  }
  const message = isConstraintError(error) ? DATABASE_MESSAGES.constraintFailed : fallbackMessage;
  return new DatabaseError(message, { cause: error });
}

const activeTransaction = new AsyncLocalStorage();

class Mutex {
  constructor() {
    this.tail = Promise.resolve();
  }

  run(job) {
    const result = this.tail.then(job, job);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}

class Database {
  constructor(engine) {
    this.engine = engine;
    this.closed = false;
  }

  async run(sql, params) {
    if (this.closed) {
      throw new DatabaseError(DATABASE_MESSAGES.readFailed, { cause: new Error('databasen är stängd') });
    }
    const tx = activeTransaction.getStore();
    const query = tx !== undefined && tx.db === this ? tx.query : this.engine.query;
    return query(toPositional(sql), params);
  }

  async transaction(work) {
    const tx = activeTransaction.getStore();
    if (tx !== undefined && tx.db === this) {
      return work();
    }
    let workFailed = false;
    const tracked = async () => {
      try {
        return await work();
      } catch (error) {
        workFailed = true;
        throw error;
      }
    };
    try {
      return await this.engine.transaction((query) => activeTransaction.run({ db: this, query }, tracked));
    } catch (error) {
      if (workFailed) {
        throw error;
      }
      throw asDatabaseError(error, DATABASE_MESSAGES.writeFailed);
    }
  }

  async close() {
    if (this.closed) {
      return;
    }
    this.closed = true;
    await this.engine.close();
  }
}

async function migrate(engine) {
  await engine.exec(SCHEMA_SQL);
  const rows = (await engine.query('SELECT version FROM schema_version', [])).rows;
  if (rows.length === 0) {
    await engine.query('INSERT INTO schema_version (version) VALUES ($1)', [SCHEMA_VERSION]);
  } else if (rows[0].version !== SCHEMA_VERSION) {
    await engine.query('UPDATE schema_version SET version = $1', [SCHEMA_VERSION]);
  }
}

async function openPostgres(connectionString) {
  const { default: pg } = await import('pg');
  pg.types.setTypeParser(INT8_OID, parseNumber);
  pg.types.setTypeParser(NUMERIC_OID, parseNumber);
  const local = /@(localhost|127\.0\.0\.1)(:|\/)/.test(connectionString);
  const pool = new pg.Pool({
    connectionString,
    max: 5,
    ssl: local ? false : { rejectUnauthorized: true }
  });
  pool.on('error', () => {});
  const engine = {
    query: async (sql, params) => {
      const result = await pool.query(sql, params);
      return { rows: result.rows, rowCount: result.rowCount ?? 0 };
    },
    exec: async (sql) => {
      await pool.query(sql);
    },
    transaction: async (work) => {
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        const query = async (sql, params) => {
          const result = await client.query(sql, params);
          return { rows: result.rows, rowCount: result.rowCount ?? 0 };
        };
        const value = await work(query);
        await client.query('COMMIT');
        return value;
      } catch (error) {
        try {
          await client.query('ROLLBACK');
        } catch {
        }
        throw error;
      } finally {
        client.release();
      }
    },
    close: () => pool.end()
  };
  return engine;
}

async function createPglite(dataDir) {
  const { PGlite } = await import('@electric-sql/pglite');
  return PGlite.create(dataDir, { parsers: { [INT8_OID]: parseNumber, [NUMERIC_OID]: parseNumber } });
}

function pgliteEngine(pglite, { prefix = '', onClose = () => pglite.close() } = {}) {
  const mutex = new Mutex();
  const raw = async (sql, params) => {
    if (prefix !== '') {
      await pglite.exec(prefix);
    }
    const result = await pglite.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
  };
  return {
    query: (sql, params) => mutex.run(() => raw(sql, params)),
    exec: (sql) =>
      mutex.run(async () => {
        await pglite.exec(`${prefix}${sql}`);
      }),
    transaction: (work) =>
      mutex.run(async () => {
        await pglite.exec(`${prefix}BEGIN;`);
        try {
          const value = await work(raw);
          await pglite.exec('COMMIT;');
          return value;
        } catch (error) {
          try {
            await pglite.exec('ROLLBACK;');
          } catch {
          }
          throw error;
        }
      }),
    close: onClose
  };
}

let sharedMemory = null;
let memoryCounter = 0;

async function openMemory() {
  if (sharedMemory === null) {
    sharedMemory = createPglite(undefined).then((pglite) => ({ pglite, mutex: new Mutex() }));
  }
  const { pglite, mutex } = await sharedMemory;
  memoryCounter += 1;
  const schema = `test_${process.pid}_${memoryCounter}`;
  const prefix = `SET search_path TO ${schema};`;
  const raw = async (sql, params) => {
    await pglite.exec(prefix);
    const result = await pglite.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? 0 };
  };
  await mutex.run(() => pglite.exec(`CREATE SCHEMA ${schema};`));
  return {
    query: (sql, params) => mutex.run(() => raw(sql, params)),
    exec: (sql) => mutex.run(() => pglite.exec(`${prefix}${sql}`)),
    transaction: (work) =>
      mutex.run(async () => {
        await pglite.exec(`${prefix}BEGIN;`);
        try {
          const value = await work(raw);
          await pglite.exec('COMMIT;');
          return value;
        } catch (error) {
          try {
            await pglite.exec('ROLLBACK;');
          } catch {
          }
          throw error;
        }
      }),
    close: () => mutex.run(() => pglite.exec(`DROP SCHEMA IF EXISTS ${schema} CASCADE;`))
  };
}

async function openPgliteDirectory(dataDir) {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
  } catch (error) {
    throw new DatabaseError(DATABASE_MESSAGES.openFailed, { cause: error });
  }
  const pglite = await createPglite(dataDir);
  return pgliteEngine(pglite);
}

export async function openDatabase(target) {
  if (typeof target !== 'string' || target === '') {
    throw new TypeError('openDatabase kräver en sökväg som en icke-tom sträng.');
  }
  let engine;
  try {
    if (target === MEMORY_PATH) {
      engine = await openMemory();
    } else if (/^postgres(ql)?:\/\//.test(target)) {
      engine = await openPostgres(target);
    } else {
      engine = await openPgliteDirectory(target);
    }
    await migrate(engine);
  } catch (error) {
    if (engine !== undefined) {
      try {
        await engine.close();
      } catch {
      }
    }
    if (error instanceof DatabaseError) {
      throw error;
    }
    throw new DatabaseError(DATABASE_MESSAGES.openFailed, { cause: error });
  }
  return new Database(engine);
}

export async function readRows(db, sql, params = []) {
  try {
    const database = await db;
    return (await database.run(sql, params)).rows;
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.readFailed);
  }
}

export async function exec(db, sql) {
  try {
    const database = await db;
    await database.run(sql, []);
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.writeFailed);
  }
}

export async function write(db, sql, params = []) {
  try {
    const database = await db;
    const result = await database.run(sql, params);
    return { changes: result.rowCount };
  } catch (error) {
    throw asDatabaseError(error, DATABASE_MESSAGES.writeFailed);
  }
}

export async function transaction(db, work) {
  const database = await db;
  return database.transaction(work);
}

export function resolveDatabaseTarget(env = process.env) {
  const url = env.DATABASE_URL;
  if (typeof url === 'string' && url.trim() !== '') {
    return url.trim();
  }
  return getDatabaseFilePath();
}

let sharedDatabase = null;

export function getDatabase() {
  if (sharedDatabase === null) {
    const opening = openDatabase(resolveDatabaseTarget());
    opening.catch(() => {
      if (sharedDatabase === opening) {
        sharedDatabase = null;
      }
    });
    sharedDatabase = opening;
  }
  return sharedDatabase;
}

export async function closeDatabase() {
  if (sharedDatabase !== null) {
    const opening = sharedDatabase;
    sharedDatabase = null;
    let database;
    try {
      database = await opening;
    } catch {
      return;
    }
    try {
      await database.close();
    } catch (error) {
      throw new DatabaseError(DATABASE_MESSAGES.writeFailed, { cause: error });
    }
  }
}

export const INTERNAL = Object.freeze({ SCHEMA_SQL });
