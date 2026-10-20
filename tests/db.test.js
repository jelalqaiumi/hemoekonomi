import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { INTERVALS } from '../src/core/entry.js';
import { ITEM_KINDS } from '../src/core/item.js';
import {
  DATABASE_MESSAGES,
  DatabaseError,
  MEMORY_PATH,
  SCHEMA_VERSION,
  closeDatabase,
  getDatabase,
  openDatabase,
  readRows,
  resolveDatabaseTarget,
  toPositional,
  transaction,
  write
} from '../src/server/db.js';
import { insertUser, tableSchema } from './helpers/sql.js';

const NU = '2026-10-17T10:00:00.000Z';

async function nyDatabas(t) {
  const db = await openDatabase(MEMORY_PATH);
  t.after(() => db.close());
  return db;
}

const TABELLER = [
  'bills', 'budgets', 'goal_deposits', 'goals', 'login_attempts', 'month_items', 'overrides',
  'password_resets', 'schema_version', 'sessions', 'templates', 'users'
];

test('toPositional numrerar om varje ? i ordning', () => {
  assert.equal(toPositional('SELECT ? , ?, ?'), 'SELECT $1 , $2, $3');
  assert.equal(toPositional('SELECT 1'), 'SELECT 1');
});

test('openDatabase kräver en icke-tom sträng', async () => {
  for (const value of [undefined, null, '', 42]) {
    await assert.rejects(() => openDatabase(value), TypeError, String(value));
  }
});

test('schemat skapar exakt de tabeller appen använder, och versionen står i schema_version', async (t) => {
  const db = await nyDatabas(t);
  const rader = await readRows(
    db,
    "SELECT table_name FROM information_schema.tables WHERE table_schema = current_schema() ORDER BY table_name"
  );
  assert.deepEqual(rader.map((r) => r.table_name), TABELLER);
  assert.deepEqual(await readRows(db, 'SELECT version FROM schema_version'), [{ version: SCHEMA_VERSION }]);
});

test('två minnesdatabaser ser inte varandras rader', async (t) => {
  const a = await nyDatabas(t);
  const b = await nyDatabas(t);
  await insertUser(a, 'u-a', 'a@example.se', NU);
  assert.equal((await readRows(a, 'SELECT id FROM users')).length, 1);
  assert.equal((await readRows(b, 'SELECT id FROM users')).length, 0);
});

test('COUNT och SUM kommer tillbaka som tal och inte som strängar', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  const [rad] = await readRows(db, "SELECT COUNT(*) AS antal, SUM(LENGTH(email)) AS summa FROM users");
  assert.deepEqual(rad, { antal: 1, summa: 12 });
});

test('write svarar antalet ändrade rader i changes', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  await insertUser(db, 'u-b', 'b@example.se', NU);
  assert.deepEqual(await write(db, 'UPDATE users SET created_at = ? WHERE id <> ?', [NU, 'ingen']), { changes: 2 });
  assert.deepEqual(await write(db, 'DELETE FROM users WHERE id = ?', ['finns-inte']), { changes: 0 });
});

test('textkolumnerna jämförs bytevis, som i SQLite', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  for (const [id, from] of [['t1', '2026-09'], ['t2', '2026-10'], ['t3', '2026-12']]) {
    await write(
      db,
      `INSERT INTO templates (id, user_id, series_id, kind, name, amount_ore, category, interval, start_date, from_month, created_at)
       VALUES (?, 'u-a', ?, 'expense', 'x', 1, 'other', 'monthly', '2026-01-01', ?, ?)`,
      [id, id, from, NU]
    );
  }
  const rader = await readRows(db, "SELECT id FROM templates WHERE from_month <= ? ORDER BY from_month DESC", ['2026-10']);
  assert.deepEqual(rader.map((r) => r.id), ['t2', 't1']);
});

test('ett brutet CHECK ger DatabaseError med texten constraintFailed och originalet i cause', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  const fel = await write(
    db,
    "INSERT INTO month_items (id, user_id, month, kind, name, amount_ore, category, created_at) VALUES ('m', 'u-a', '2026-13x', 'expense', 'x', 1, 'food', ?)",
    [NU]
  ).then(() => null, (error) => error);
  assert.ok(fel instanceof DatabaseError);
  assert.equal(fel.message, DATABASE_MESSAGES.constraintFailed);
  assert.equal(fel.cause.code, '23514');
});

test('UNIQUE och främmande nyckel ger också constraintFailed', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  await assert.rejects(() => insertUser(db, 'u-b', 'a@example.se', NU), { message: DATABASE_MESSAGES.constraintFailed });
  await assert.rejects(
    () => write(db, "INSERT INTO sessions (id, user_id, token_hash, created_at, expires_at) VALUES ('s', 'finns-inte', 'h', ?, ?)", [NU, NU]),
    { message: DATABASE_MESSAGES.constraintFailed }
  );
});

test('ett läsfel ger readFailed och ett skrivfel writeFailed, och ingen SQL står i meddelandet', async (t) => {
  const db = await nyDatabas(t);
  await assert.rejects(() => readRows(db, 'SELECT * FROM finns_inte'), (error) => error instanceof DatabaseError && error.message === DATABASE_MESSAGES.readFailed);
  await assert.rejects(() => write(db, 'UPDATE finns_inte SET x = 1'), (error) => error instanceof DatabaseError && error.message === DATABASE_MESSAGES.writeFailed);
});

test('transaction rullar tillbaka allt när arbetet kastar', async (t) => {
  const db = await nyDatabas(t);
  await assert.rejects(
    () => transaction(db, async () => {
      await insertUser(db, 'u-a', 'a@example.se', NU);
      throw new Error('avbrott');
    }),
    /avbrott/
  );
  assert.deepEqual(await readRows(db, 'SELECT id FROM users'), []);
});

test('transaction committar, och en inre transaction ingår i den yttre', async (t) => {
  const db = await nyDatabas(t);
  const svar = await transaction(db, async () => {
    await insertUser(db, 'u-a', 'a@example.se', NU);
    await transaction(db, async () => insertUser(db, 'u-b', 'b@example.se', NU));
    return 'klart';
  });
  assert.equal(svar, 'klart');
  assert.equal((await readRows(db, 'SELECT id FROM users')).length, 2);
});

test('en fråga utanför transaktionen väntar tills den är klar och ser aldrig ett halvt läge', async (t) => {
  const db = await nyDatabas(t);
  let släpp;
  const spärr = new Promise((resolve) => {
    släpp = resolve;
  });
  const pågår = transaction(db, async () => {
    await insertUser(db, 'u-a', 'a@example.se', NU);
    await spärr;
    await insertUser(db, 'u-b', 'b@example.se', NU);
  });
  const läsning = readRows(db, 'SELECT id FROM users ORDER BY id');
  släpp();
  await pågår;
  assert.deepEqual((await läsning).map((r) => r.id), ['u-a', 'u-b']);
});

test('ON DELETE CASCADE tar bort allt som hör till en användare', async (t) => {
  const db = await nyDatabas(t);
  await insertUser(db, 'u-a', 'a@example.se', NU);
  await write(db, "INSERT INTO budgets (id, user_id, month, category, amount_ore, created_at) VALUES ('b', 'u-a', '2026-10', 'food', 100, ?)", [NU]);
  await write(db, 'DELETE FROM users WHERE id = ?', ['u-a']);
  assert.deepEqual(await readRows(db, 'SELECT id FROM budgets'), []);
});

test('schemats värdelistor är kärnans listor', () => {
  const lista = (värden) => värden.map((v) => `'${v}'`).join(', ');
  assert.equal(tableSchema('templates').includes(`interval IN (${lista([...INTERVALS])})`), true);
  assert.equal(tableSchema('templates').includes(`kind IN (${lista([...ITEM_KINDS])})`), true);
  assert.equal(tableSchema('month_items').includes(`kind IN (${lista([...ITEM_KINDS])})`), true);
});

test('resolveDatabaseTarget väljer DATABASE_URL när den är satt, annars den lokala katalogen', () => {
  assert.equal(resolveDatabaseTarget({ DATABASE_URL: ' postgresql://u:p@host/db ' }), 'postgresql://u:p@host/db');
  const tidigare = process.env.HEMOCHEKONOMI_DB_FILE;
  try {
    process.env.HEMOCHEKONOMI_DB_FILE = '/tmp/x';
    assert.equal(resolveDatabaseTarget({}), '/tmp/x');
    assert.equal(resolveDatabaseTarget({ DATABASE_URL: '  ' }), '/tmp/x');
  } finally {
    if (tidigare === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = tidigare;
    }
  }
});

test('getDatabase öppnar en gång och closeDatabase stänger', async (t) => {
  const tidigare = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = MEMORY_PATH;
  t.after(async () => {
    await closeDatabase();
    if (tidigare === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = tidigare;
    }
  });
  await closeDatabase();
  assert.equal(getDatabase(), getDatabase());
  await insertUser(getDatabase(), 'u-a', 'a@example.se', NU);
  assert.equal((await readRows(getDatabase(), 'SELECT id FROM users')).length, 1);
  await closeDatabase();
  assert.equal((await readRows(getDatabase(), 'SELECT id FROM users')).length, 0);
});

test('en lokal databas i en katalog finns kvar efter att den stängts och öppnats igen', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const första = await openDatabase(path.join(dir, 'databas'));
  await insertUser(första, 'u-a', 'a@example.se', NU);
  await första.close();
  const andra = await openDatabase(path.join(dir, 'databas'));
  t.after(async () => {
    await andra.close();
    await fs.rm(dir, { recursive: true, force: true });
  });
  assert.deepEqual(await readRows(andra, 'SELECT email FROM users'), [{ email: 'a@example.se' }]);
});

test('en anslutningssträng till en server som inte svarar ger openFailed', async () => {
  await assert.rejects(
    () => openDatabase('postgresql://u:p@127.0.0.1:1/db'),
    (error) => error instanceof DatabaseError && error.message === DATABASE_MESSAGES.openFailed
  );
});
