// Prövar att schemat i src/server/db.js gör det ARKITEKTUR.md lovar: att varje
// tabell finns, att främmandenycklarna är påslagna, och att varje CHECK-villkor
// avvisar den rad det finns för.
//
// Varje testfall öppnar sin egen databas i minnet, så att inget fall kan se en
// rad ett annat fall skrev. DatabaseSync är synkron: ingen rad här har await.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { INTERVALS } from '../src/core/entry.js';
import { ITEM_KINDS } from '../src/core/item.js';
import { PLANS } from '../src/core/plans.js';
import {
  DatabaseError,
  MEMORY_PATH,
  SCHEMA_VERSION,
  closeDatabase,
  getDatabase,
  openDatabase
} from '../src/server/db.js';

// Alfabetisk ordning, som frågan mot sqlite_master sorterar i. goal_deposits och
// goals tillkom i steg 4. Inget antal i någon mening om listan: ett antal i en
// mening som inleder en uppräkning blir falskt av nästa tabell
// (LARDOMAR.md 2026-09-12).
const TABLES = ['bills', 'budgets', 'goal_deposits', 'goals', 'login_codes', 'month_items', 'overrides', 'sessions', 'templates', 'users'];

const NOW = '2026-09-25T18:03:00.000Z';
const USER_ID = 'u1';
const TEMPLATE_ID = 't1';

// En databas med ett konto och en mall, så att ett testfall kan skriva en rad
// som pekar på dem utan att först bygga upp sitt eget utgångsläge.
function freshDatabase() {
  const db = openDatabase(MEMORY_PATH);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .run(USER_ID, 'anna@example.se', NOW);
  db.prepare(`INSERT INTO templates
      (id, user_id, series_id, kind, name, amount_ore, category, interval,
       start_date, from_month, to_month, created_at)
      VALUES (?, ?, ?, 'expense', 'Hyra', 1250000, 'housing', 'monthly',
              '2026-01-31', '2026-01', NULL, ?)`)
    .run(TEMPLATE_ID, USER_ID, TEMPLATE_ID, NOW);
  return db;
}

// En engångspost med alla fält giltiga. Varje testfall byter ut ett enda fält,
// så att det som fälls är det fält fallet handlar om.
function monthItem(overrides = {}) {
  return {
    id: 'm1',
    user_id: USER_ID,
    month: '2026-02',
    kind: 'expense',
    name: 'Tandläkare',
    amount_ore: 95000,
    category: 'other',
    created_at: NOW,
    ...overrides
  };
}

function insertMonthItem(db, row) {
  db.prepare(`INSERT INTO month_items
      (id, user_id, month, kind, name, amount_ore, category, created_at)
      VALUES (:id, :user_id, :month, :kind, :name, :amount_ore, :category, :created_at)`)
    .run(row);
}

function insertOverride(db, row) {
  db.prepare(`INSERT INTO overrides
      (id, user_id, template_id, month, amount_ore, skipped, created_at)
      VALUES (:id, :user_id, :template_id, :month, :amount_ore, :skipped, :created_at)`)
    .run({
      id: 'o1',
      user_id: USER_ID,
      template_id: TEMPLATE_ID,
      month: '2026-02',
      amount_ore: 50000,
      skipped: 0,
      created_at: NOW,
      ...row
    });
}

test('varje tabell i schemat skapas', () => {
  const db = openDatabase(MEMORY_PATH);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(names, TABLES);
  db.close();
});

test('varje index i schemat skapas', () => {
  const db = openDatabase(MEMORY_PATH);
  const names = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%' ORDER BY name")
    .all()
    .map((row) => row.name);
  assert.deepEqual(names, [
    'idx_login_codes_ip',
    'idx_login_codes_user',
    'idx_month_items_user_month',
    'idx_overrides_user_month',
    'idx_sessions_user',
    'idx_templates_series',
    'idx_templates_user_period'
  ]);
  db.close();
});

test('PRAGMA user_version är schemaversionen', () => {
  const db = openDatabase(MEMORY_PATH);
  // Raderna node:sqlite ger tillbaka har null som prototyp, så de jämförs fält
  // för fält och aldrig med deepEqual mot ett objektliteral.
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
  assert.equal(SCHEMA_VERSION, 1);
  db.close();
});

test('PRAGMA foreign_keys är på, och en rad med okänt user_id avvisas', () => {
  const db = freshDatabase();
  assert.equal(db.prepare('PRAGMA foreign_keys').get().foreign_keys, 1);
  assert.throws(
    () => insertMonthItem(db, monthItem({ user_id: 'finns-inte' })),
    /FOREIGN KEY constraint failed/
  );
  // Samma sak för overrides, som har två främmandenycklar: en okänd template_id
  // ska avvisas fastän user_id finns.
  assert.throws(
    () => insertOverride(db, { template_id: 'finns-inte' }),
    /FOREIGN KEY constraint failed/
  );
  db.close();
});

test('kind utanför de tillåtna värdena avvisas', () => {
  const db = freshDatabase();
  assert.throws(
    () => insertMonthItem(db, monthItem({ kind: 'gift' })),
    /CHECK constraint failed: kind IN \('income', 'expense', 'saving'\)/
  );
  // De tillåtna går igenom, så villkoret avvisar inte för mycket. Listan kommer ur
  // ITEM_KINDS och skrivs inte av här: skälet är att mutationen "lägg till ett värde
  // i ITEM_KINDS" ska fälla ett test, och med en handskriven kopia fäller den inget.
  for (const [index, kind] of [...ITEM_KINDS].entries()) {
    insertMonthItem(db, monthItem({ id: `m-${index}`, kind }));
  }
  assert.equal(
    db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal,
    ITEM_KINDS.length
  );
  db.close();
});

// Provet ARKITEKTUR.md kräver under "Två spärrar i två språk": värdelistan i
// schemats CHECK ska vara densamma som ägarens lista i src/core/. Samma sorts
// prov som tests/cost.test.js har för PAYMENTS_PER_YEAR mot INTERVALS, och det
// finns av samma skäl: två listor som beskriver samma domän glider isär.
test('värdelistorna i schemats CHECK är ITEM_KINDS och INTERVALS', () => {
  const db = freshDatabase();
  const schema = db
    .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name IN ('month_items', 'templates')")
    .all();
  const text = schema.map((row) => row.sql).join('\n');
  const lista = (värden) => värden.map((värde) => `'${värde}'`).join(', ');

  assert.equal(text.includes(`kind IN (${lista([...ITEM_KINDS])})`), true, text);
  assert.equal(text.includes(`interval IN (${lista([...INTERVALS])})`), true, text);
  db.close();
});

test('interval utanför de fyra tillåtna värdena avvisas', () => {
  const db = freshDatabase();
  assert.throws(
    () => db.prepare(`INSERT INTO templates
        (id, user_id, series_id, kind, name, amount_ore, category, interval,
         start_date, from_month, to_month, created_at)
        VALUES ('t-fel', ?, 't-fel', 'expense', 'Sopor', 100, 'other', 'weekly',
                '2026-01-01', '2026-01', NULL, ?)`).run(USER_ID, NOW),
    /CHECK constraint failed: interval IN \('monthly', 'quarterly', 'semiannual', 'yearly'\)/
  );
  db.close();
});

test('ett amount_ore som inte är positivt avvisas', () => {
  const db = freshDatabase();
  for (const amount of [0, -1, -95000]) {
    assert.throws(
      () => insertMonthItem(db, monthItem({ amount_ore: amount })),
      /CHECK constraint failed: amount_ore > 0/,
      `amount_ore ${amount} skulle ha avvisats`
    );
  }
  // Ett öre är det minsta beloppet som får finnas.
  insertMonthItem(db, monthItem({ amount_ore: 1 }));
  assert.equal(db.prepare('SELECT amount_ore FROM month_items').get().amount_ore, 1);
  db.close();
});

test('en month i fel format avvisas', () => {
  const db = freshDatabase();
  for (const month of ['2026-1', '202602', '2026-02-01', '', 'februari']) {
    assert.throws(
      () => insertMonthItem(db, monthItem({ month })),
      /CHECK constraint failed: month GLOB/,
      `month ${JSON.stringify(month)} skulle ha avvisats`
    );
  }
  db.close();
});

test('ett start_date i fel format avvisas', () => {
  const db = freshDatabase();
  assert.throws(
    () => db.prepare(`INSERT INTO templates
        (id, user_id, series_id, kind, name, amount_ore, category, interval,
         start_date, from_month, to_month, created_at)
        VALUES ('t-fel', ?, 't-fel', 'expense', 'Sopor', 100, 'other', 'monthly',
                '2026-1-1', '2026-01', NULL, ?)`).run(USER_ID, NOW),
    /CHECK constraint failed: start_date GLOB/
  );
  db.close();
});

test('en to_month före from_month avvisas', () => {
  const db = freshDatabase();
  const insert = (id, fromMonth, toMonth) =>
    db.prepare(`INSERT INTO templates
        (id, user_id, series_id, kind, name, amount_ore, category, interval,
         start_date, from_month, to_month, created_at)
        VALUES (?, ?, ?, 'expense', 'Bredband', 49900, 'subscription', 'monthly',
                '2026-01-15', ?, ?, ?)`)
      .run(id, USER_ID, id, fromMonth, toMonth, NOW);

  assert.throws(
    () => insert('t-fel', '2026-05', '2026-04'),
    /CHECK constraint failed: to_month IS NULL OR to_month >= from_month/
  );
  // Samma månad är tillåtet, och NULL betyder "gäller framåt utan slut".
  insert('t-lika', '2026-05', '2026-05');
  insert('t-oppen', '2026-05', null);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 3);
  db.close();
});

test('UNIQUE (template_id, month) i overrides avvisas vid dubblett', () => {
  const db = freshDatabase();
  insertOverride(db, { id: 'o1', month: '2026-02', amount_ore: 50000 });
  assert.throws(
    () => insertOverride(db, { id: 'o2', month: '2026-02', amount_ore: 60000 }),
    /UNIQUE constraint failed: overrides.template_id, overrides.month/
  );
  // En annan månad för samma mall är en annan rad och ska gå igenom.
  insertOverride(db, { id: 'o3', month: '2026-03', amount_ore: 60000 });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 2);
  db.close();
});

test('en override har antingen ett belopp eller är överhoppad, aldrig båda och aldrig ingen', () => {
  const db = freshDatabase();
  const villkor = /CHECK constraint failed: \(skipped = 1 AND amount_ore IS NULL\) OR \(skipped = 0 AND amount_ore IS NOT NULL\)/;

  assert.throws(
    () => insertOverride(db, { id: 'o-ingen', amount_ore: null, skipped: 0 }),
    villkor,
    'varken belopp eller överhoppad skulle ha avvisats'
  );
  assert.throws(
    () => insertOverride(db, { id: 'o-bada', amount_ore: 50000, skipped: 1 }),
    villkor,
    'både belopp och överhoppad skulle ha avvisats'
  );

  insertOverride(db, { id: 'o-belopp', month: '2026-02', amount_ore: 50000, skipped: 0 });
  insertOverride(db, { id: 'o-hoppad', month: '2026-03', amount_ore: null, skipped: 1 });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 2);

  // skipped är 0 eller 1 och ingenting annat.
  assert.throws(
    () => insertOverride(db, { id: 'o-tva', month: '2026-04', amount_ore: null, skipped: 2 }),
    /CHECK constraint failed: skipped IN \(0, 1\)/
  );
  db.close();
});

test('ett konto som tas bort tar sina rader med sig', () => {
  const db = freshDatabase();
  insertMonthItem(db, monthItem());
  insertOverride(db, {});
  db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').get().antal, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
  db.close();
});

// --------------------------------------------------------------------------
// Budgetens tabell och postens två nya kolumner [steg 2].
// --------------------------------------------------------------------------

function insertBudget(db, overrides = {}) {
  const values = {
    id: 'b1',
    user_id: USER_ID,
    month: '2026-02',
    category: 'housing',
    amount_ore: 900000,
    created_at: NOW,
    ...overrides
  };
  db.prepare(`INSERT INTO budgets (id, user_id, month, category, amount_ore, created_at)
      VALUES (:id, :user_id, :month, :category, :amount_ore, :created_at)`)
    .run(values);
  return values;
}

test('UNIQUE (user_id, month, category) i budgets avvisas vid dubblett', () => {
  const db = freshDatabase();
  insertBudget(db, { id: 'b1' });
  assert.throws(
    () => insertBudget(db, { id: 'b2' }),
    /UNIQUE constraint failed: budgets.user_id, budgets.month, budgets.category/
  );
  // En annan månad och en annan kategori är var sin egen rad.
  insertBudget(db, { id: 'b3', month: '2026-03' });
  insertBudget(db, { id: 'b4', category: 'transport' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM budgets').get().antal, 3);
  db.close();
});

test('budgets har CHECK på month och amount_ore, och ingen lista över kategorier', () => {
  const db = freshDatabase();
  for (const month of ['2026-2', '202602', '2026-02-01', '', 'februari']) {
    assert.throws(
      () => insertBudget(db, { id: `b-${month}`, month }),
      /CHECK constraint failed: month GLOB/,
      `month ${JSON.stringify(month)} skulle ha avvisats`
    );
  }
  for (const amount of [0, -1]) {
    assert.throws(
      () => insertBudget(db, { id: `b-${amount}`, amount_ore: amount }),
      /CHECK constraint failed: amount_ore > 0/,
      `amount_ore ${amount} skulle ha avvisats`
    );
  }
  // Kategorin har med flit inget CHECK: listan ägs av CATEGORIES i
  // src/core/entry.js och prövas av checkCategory där, så schemat tar emot också
  // en kategori som inte står i listan (ARKITEKTUR.md under "Tabellen"). Raden
  // nedan ska alltså gå igenom — faller den finns en andra kopia av
  // kategorilistan i schemat.
  insertBudget(db, { id: 'b-okand', category: 'mat' });
  assert.equal(db.prepare('SELECT category FROM budgets WHERE id = ?').get('b-okand').category, 'mat');
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'budgets'")
    .get().sql;
  assert.equal(schema.includes('category IN ('), false, schema);
  db.close();
});

test('ett konto som tas bort tar sina budgetar med sig', () => {
  const db = freshDatabase();
  insertBudget(db, {});
  db.prepare('DELETE FROM users WHERE id = ?').run(USER_ID);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM budgets').get().antal, 0);
  db.close();
});

test('occurred_on i fel format avvisas, och båda kolumnerna är null när de inte anges', () => {
  const db = freshDatabase();
  for (const occurredOn of ['2026-2-1', '20260201', '2026-02', '', 'igår']) {
    assert.throws(
      () => db.prepare(`INSERT INTO month_items
          (id, user_id, month, kind, name, amount_ore, category, created_at, occurred_on)
          VALUES (?, ?, '2026-02', 'expense', 'Mat', 10000, 'other', ?, ?)`)
        .run(`m-${occurredOn}`, USER_ID, NOW, occurredOn),
      /CHECK constraint failed: occurred_on IS NULL OR occurred_on GLOB/,
      `occurred_on ${JSON.stringify(occurredOn)} skulle ha avvisats`
    );
  }
  // En rad som inte nämner de två kolumnerna får null i båda.
  insertMonthItem(db, monthItem());
  const rad = db.prepare('SELECT occurred_on, note FROM month_items WHERE id = ?').get('m1');
  assert.equal(rad.occurred_on, null);
  assert.equal(rad.note, null);
  db.close();
});

test('note har ingen längdgräns i schemat: regeln ägs av kärnan', () => {
  const db = freshDatabase();
  // 201 tecken är ett fel för användaren, men schemat ska inte vara den som
  // avgör det: kärnan (checkNote) ger den svenska texten och ett 400, medan ett
  // CHECK här hade gett 500 och "något värde är ogiltigt" (ARKITEKTUR.md, "Två
  // spärrar i två språk").
  db.prepare(`INSERT INTO month_items
      (id, user_id, month, kind, name, amount_ore, category, created_at, note)
      VALUES ('m-lang', ?, '2026-02', 'expense', 'Mat', 10000, 'other', ?, ?)`)
    .run(USER_ID, NOW, 'a'.repeat(201));
  assert.equal(db.prepare('SELECT note FROM month_items WHERE id = ?').get('m-lang').note.length, 201);
  db.close();
});

// Migreringen av de två kolumnerna, samma prov som (P7) gör för plan: en databas
// som redan finns ska få kolumnerna utan att byggas om, och ett andra öppnande
// ska inte köra ALTER TABLE igen.
test('en befintlig month_items får occurred_on och note utan att byggas om', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'gammal.sqlite');
  try {
    // Tabellen som etapp 3 skapade, utan de två kolumnerna, med en rad i den.
    const gammal = new DatabaseSync(filePath);
    gammal.exec(`CREATE TABLE month_items (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      month       TEXT NOT NULL,
      kind        TEXT NOT NULL,
      name        TEXT NOT NULL,
      amount_ore  INTEGER NOT NULL,
      category    TEXT NOT NULL,
      created_at  TEXT NOT NULL
    );`);
    gammal.prepare(`INSERT INTO month_items
        (id, user_id, month, kind, name, amount_ore, category, created_at)
        VALUES ('m-gammal', ?, '2026-02', 'expense', 'Tandläkare', 95000, 'other', ?)`)
      .run(USER_ID, NOW);
    gammal.close();

    const migrerad = openDatabase(filePath);
    const kolumner = migrerad.prepare('PRAGMA table_info(month_items)').all().map((row) => row.name);
    assert.equal(kolumner.includes('occurred_on'), true, kolumner.join());
    assert.equal(kolumner.includes('note'), true, kolumner.join());
    // Den befintliga raden är orörd och har null i de två nya kolumnerna.
    const rad = migrerad.prepare('SELECT name, amount_ore, occurred_on, note FROM month_items WHERE id = ?').get('m-gammal');
    assert.equal(rad.name, 'Tandläkare');
    assert.equal(rad.amount_ore, 95000);
    assert.equal(rad.occurred_on, null);
    assert.equal(rad.note, null);
    // CHECK:en följde med ALTER TABLE och gäller i den migrerade databasen.
    assert.throws(
      () => migrerad.prepare('UPDATE month_items SET occurred_on = ? WHERE id = ?').run('2026-2-1', 'm-gammal'),
      /CHECK constraint failed: occurred_on IS NULL OR occurred_on GLOB/
    );
    // Och de tabeller som tillkommit sedan den gamla databasen skapades finns med
    // i samma öppnande: budgets [steg 2] och bills [steg 3]. CREATE TABLE
    // IF NOT EXISTS är hela migreringen för en ny TABELL — steget körs bara när
    // tabellen saknas, och en databas som redan har den rörs inte. Det är skillnaden
    // mot en ny KOLUMN, som behöver ett eget ALTER TABLE i COLUMN_MIGRATIONS.
    //
    // Två skilda frågor med tabellnamnet i SQL-texten och inte en loop med en
    // parameter: en parametriserad fråga per varv lämnade WAL-filen öppen, och
    // städningen i finally föll då med EPERM, Permission denied på katalogen (körd).
    assert.equal(
      migrerad.prepare("SELECT COUNT(*) AS antal FROM sqlite_master WHERE type = 'table' AND name = 'budgets'").get().antal,
      1
    );
    assert.equal(
      migrerad.prepare("SELECT COUNT(*) AS antal FROM sqlite_master WHERE type = 'table' AND name = 'bills'").get().antal,
      1
    );
    migrerad.prepare('UPDATE month_items SET occurred_on = ?, note = ? WHERE id = ?')
      .run('2026-02-14', 'betald kontant', 'm-gammal');
    migrerad.close();

    // Ett andra öppnande kör inte ALTER TABLE igen: ett andra ADD COLUMN med
    // samma namn är ett fel, och steget körs bara när kolumnen saknas.
    const igen = openDatabase(filePath);
    const efter = igen.prepare('SELECT occurred_on, note FROM month_items WHERE id = ?').get('m-gammal');
    assert.equal(efter.occurred_on, '2026-02-14');
    assert.equal(efter.note, 'betald kontant');
    igen.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// (P6) Samma prov som för ITEM_KINDS och INTERVALS ovan, för plan-kolumnen:
// värdelistan i schemats CHECK ska vara densamma som Object.keys(PLANS) i
// src/core/plans.js. Utan provet kan en plan läggas till i modulen utan att
// databasen tar emot den, och tvärtom.
test('(P6) värdelistan i plan-kolumnens CHECK är Object.keys(PLANS)', () => {
  const db = freshDatabase();
  const sql = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'users'")
    .get().sql;
  const lista = Object.keys(PLANS).map((key) => `'${key}'`).join(', ');
  assert.equal(sql.includes(`plan IN (${lista})`), true, sql);

  // Varje plannyckel går igenom, så villkoret avvisar inte för mycket. Listan
  // kommer ur PLANS och skrivs inte av här: mutationen "lägg till en plan i
  // PLANS" ska fälla ett test, och med en handskriven kopia fäller den inget.
  for (const [index, plan] of Object.keys(PLANS).entries()) {
    db.prepare('INSERT INTO users (id, email, created_at, plan) VALUES (?, ?, ?, ?)')
      .run(`p-${index}`, `plan-${index}@example.se`, NOW, plan);
  }
  assert.equal(
    db.prepare('SELECT COUNT(*) AS antal FROM users WHERE plan = ?').get(Object.keys(PLANS)[0]).antal,
    // Kontot i freshDatabase har också 'bas', genom förvalet.
    2
  );
  // Ett värde utanför listan avvisas av databasen och inte bara av koden.
  assert.throws(
    () => db.prepare('INSERT INTO users (id, email, created_at, plan) VALUES (?, ?, ?, ?)')
      .run('p-fel', 'guld@example.se', NOW, 'guld'),
    /CHECK constraint failed: plan IN \('bas', 'plus', 'premium'\)/
  );
  // NOT NULL: kolumnen får inte vara tom heller.
  assert.throws(
    () => db.prepare('INSERT INTO users (id, email, created_at, plan) VALUES (?, ?, ?, ?)')
      .run('p-null', 'null@example.se', NOW, null),
    /NOT NULL constraint failed: users.plan/
  );
  db.close();
});

// (P7) Förvalet är 'bas', både för en rad som skrivs utan plan i en ny databas
// och för en rad som redan fanns när kolumnen lades till.
test('(P7) en rad utan plan får bas, också i en databas som saknade kolumnen', () => {
  // Första halvan: en databas som skapas nu. INSERT:en nämner inte plan.
  const db = openDatabase(MEMORY_PATH);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .run(USER_ID, 'anna@example.se', NOW);
  assert.equal(db.prepare('SELECT plan FROM users WHERE id = ?').get(USER_ID).plan, 'bas');
  assert.equal(Object.keys(PLANS)[0], 'bas');
  db.close();

  // Andra halvan: en databas som redan finns, med den users-tabell etapp 2
  // skapade och en rad i den. Migreringen ska lägga till kolumnen och ge den
  // befintliga raden 'bas' genom förvalet — ingen rad skrivs om, och databasen
  // behöver inte byggas om.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'gammal.sqlite');
  try {
    const gammal = new DatabaseSync(filePath);
    gammal.exec(`CREATE TABLE users (
      id          TEXT PRIMARY KEY,
      email       TEXT NOT NULL UNIQUE,
      created_at  TEXT NOT NULL
    );`);
    gammal.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(USER_ID, 'anna@example.se', NOW);
    assert.equal(
      gammal.prepare('PRAGMA table_info(users)').all().some((row) => row.name === 'plan'),
      false
    );
    gammal.close();

    const migrerad = openDatabase(filePath);
    assert.equal(migrerad.prepare('SELECT plan FROM users WHERE id = ?').get(USER_ID).plan, 'bas');
    // Raden är i övrigt orörd: migreringen rör inget annat än kolumnen.
    const rad = migrerad.prepare('SELECT id, email, created_at FROM users WHERE id = ?').get(USER_ID);
    assert.equal(rad.email, 'anna@example.se');
    assert.equal(rad.created_at, NOW);
    // CHECK:en följde med ALTER TABLE och gäller i den migrerade databasen.
    assert.throws(
      () => migrerad.prepare('INSERT INTO users (id, email, created_at, plan) VALUES (?, ?, ?, ?)')
        .run('p-fel', 'guld@example.se', NOW, 'guld'),
      /CHECK constraint failed: plan IN \('bas', 'plus', 'premium'\)/
    );
    // Ett tredje öppnande kör inte ALTER TABLE igen: ett andra ADD COLUMN med
    // samma namn är ett fel, och steget körs bara när kolumnen saknas.
    migrerad.prepare('UPDATE users SET plan = ? WHERE id = ?').run('plus', USER_ID);
    migrerad.close();
    const igen = openDatabase(filePath);
    assert.equal(igen.prepare('SELECT plan FROM users WHERE id = ?').get(USER_ID).plan, 'plus');
    igen.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('att köra schemaskapandet två gånger är ofarligt', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'igen.sqlite');
  try {
    const first = openDatabase(filePath);
    first.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(USER_ID, 'anna@example.se', NOW);
    first.close();

    // Samma fil öppnad en andra gång: schemat skapas om, raden finns kvar och
    // tabellerna är fortfarande de i TABLES. Ingen siffra i meningen: ett antal i
    // en mening som inleder en uppräkning blir falskt av nästa tabell
    // (LARDOMAR.md 2026-09-12).
    const second = openDatabase(filePath);
    assert.equal(second.prepare('SELECT COUNT(*) AS antal FROM users').get().antal, 1);
    const names = second
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
      .all()
      .map((row) => row.name);
    assert.deepEqual(names, TABLES);
    assert.equal(second.prepare('PRAGMA user_version').get().user_version, SCHEMA_VERSION);
    second.close();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('openDatabase kräver en sökväg som en icke-tom sträng', () => {
  for (const value of [undefined, null, '', 42, {}]) {
    assert.throws(() => openDatabase(value), TypeError);
  }
});

test('getDatabase öppnar filen ur HEMOCHEKONOMI_DB_FILE och closeDatabase stänger den', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'delad.sqlite');
  const before = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = filePath;
  try {
    const db = getDatabase();
    // Samma anrop en andra gång ger samma anslutning, inte en ny.
    assert.equal(getDatabase(), db);
    db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
      .run(USER_ID, 'anna@example.se', NOW);
    assert.equal(fs.existsSync(filePath), true);

    closeDatabase();
    // Efter stängningen går den gamla anslutningen inte att använda, och nästa
    // getDatabase() öppnar samma fil på nytt med raden kvar.
    assert.throws(() => db.prepare('SELECT 1').get());
    assert.equal(getDatabase().prepare('SELECT COUNT(*) AS antal FROM users').get().antal, 1);
  } finally {
    closeDatabase();
    // closeDatabase är ofarlig att anropa när ingen anslutning är öppen.
    closeDatabase();
    if (before === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = before;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- DatabaseError -----------------------------------------------------------
// (D1) till (D4) ur testkravtabellen i ARKITEKTUR.md under "Databasens fel når
// aldrig användaren på engelska". De svenska texterna skrivs ordagrant här och i
// src/server/db.js och ingenstans annars, så att en sökning på strängen hittar
// varje ställe den prövas.
const OPEN_FAILED = 'Databasen kunde inte öppnas. Kontakta den som driftar appen.';
const WRITE_FAILED = 'Det gick inte att spara. Försök igen.';

// Den engelska text som inte får nå användaren. Listan är (D4):s tre mönster.
const ENGELSKA = ['constraint failed', 'SQLITE_', 'unable to open'];

// Fångar felet från ett anrop som ska kasta, så att varje krav prövas mot samma
// fel utan att anropet görs om.
function fangaFel(arbete) {
  try {
    arbete();
  } catch (error) {
    return error;
  }
  assert.fail('anropet skulle ha kastat');
}

// (D1) till (D4) för ett fel som node:sqlite kastar redan i konstruktorn.
test('(D1)-(D4): en sökväg som inte går att öppna ger DatabaseError med svensk text', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  try {
    // En katalog är ingen databasfil: node:sqlite svarar "unable to open
    // database file" på engelska.
    const fel = fangaFel(() => openDatabase(dir));

    // (D1)
    assert.equal(fel instanceof DatabaseError, true);
    assert.equal(fel.name, 'DatabaseError');
    assert.equal(fel.message, OPEN_FAILED);

    // (D2)
    assert.equal(fel.cause instanceof Error, true);
    assert.equal(fel.cause.code, 'ERR_SQLITE_ERROR');
    assert.match(fel.cause.message, /unable to open database file/);

    // (D3): varken hela sökvägen eller dess sista led står i meddelandet.
    assert.equal(fel.message.includes(dir), false);
    assert.equal(fel.message.includes(path.basename(dir)), false);

    // (D4)
    for (const text of ENGELSKA) {
      assert.equal(fel.message.includes(text), false, `"${text}" läcker ut i meddelandet`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Samma fyra krav för ett fel som kommer först efter att anslutningen öppnats,
// alltså den andra av de två grenarna i openDatabase catch. Fallet prövar också
// att handtaget stängs: gör det inte det håller det filen låst.
test('(D1)-(D4): en fil som inte är en databas ger samma fel, och handtaget stängs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'inte-en-db.sqlite');
  fs.writeFileSync(filePath, 'det här är ingen databas\n'.repeat(100));
  try {
    const fel = fangaFel(() => openDatabase(filePath));
    assert.equal(fel instanceof DatabaseError, true);
    assert.equal(fel.message, OPEN_FAILED);
    assert.equal(fel.cause instanceof Error, true);
    assert.equal(fel.cause.code, 'ERR_SQLITE_ERROR');
    assert.match(fel.cause.message, /file is not a database/);
    assert.equal(fel.message.includes(filePath), false);
    for (const text of ENGELSKA) {
      assert.equal(fel.message.includes(text), false, `"${text}" läcker ut i meddelandet`);
    }

    // Anslutningen öppnades innan schemat föll. Stängdes den inte håller
    // handtaget filen låst, och den här raden ger då EPERM (mätt på Node
    // v24.19.0 på Windows).
    fs.rmSync(filePath);
    assert.equal(fs.existsSync(filePath), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// closeDatabase är den andra funktionen i filen som anropar en
// node:sqlite-metod. Fallet når dess catch.
test('closeDatabase ger DatabaseError när anslutningen redan är stängd', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const filePath = path.join(dir, 'stangd.sqlite');
  const before = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = filePath;
  try {
    const db = getDatabase();
    // Stängs anslutningen utan att gå genom closeDatabase vet modulen inte om
    // det, och node:sqlite svarar "database is not open" på engelska.
    db.close();

    const fel = fangaFel(() => closeDatabase());
    assert.equal(fel instanceof DatabaseError, true);
    assert.equal(fel.message, WRITE_FAILED);
    assert.equal(fel.cause instanceof Error, true);
    assert.equal(fel.cause.code, 'ERR_INVALID_STATE');
    for (const text of ENGELSKA) {
      assert.equal(fel.message.includes(text), false, `"${text}" läcker ut i meddelandet`);
    }

    // Den delade anslutningen nollställdes före close(), så ett andra anrop är
    // ofarligt och nästa getDatabase() öppnar filen på nytt.
    closeDatabase();
    assert.equal(getDatabase().prepare('SELECT COUNT(*) AS antal FROM users').get().antal, 0);
  } finally {
    closeDatabase();
    if (before === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = before;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// Katalogsteget i openDatabase räknas till "går inte att öppna eller skapa":
// node:fs-felet bär både engelsk text och sökvägen, och ingen av dem får nå
// användaren. Mätt på Node v24.19.0: "ENOTDIR: not a directory, mkdir
// '<sökväg>'".
test('(D1)-(D4): en katalog som inte går att skapa ger DatabaseError utan sökväg', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hemochekonomi-db-'));
  const enFil = path.join(dir, 'en-fil.txt');
  fs.writeFileSync(enFil, 'x');
  const filePath = path.join(enFil, 'under', 'hemochekonomi.sqlite');
  try {
    const fel = fangaFel(() => openDatabase(filePath));
    assert.equal(fel instanceof DatabaseError, true);
    assert.equal(fel.message, OPEN_FAILED);
    assert.equal(fel.cause instanceof Error, true);
    assert.equal(fel.cause.code, 'ENOTDIR');
    assert.equal(fel.message.includes(enFil), false);
    assert.equal(fel.message.includes('not a directory'), false);
    for (const text of ENGELSKA) {
      assert.equal(fel.message.includes(text), false, `"${text}" läcker ut i meddelandet`);
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
