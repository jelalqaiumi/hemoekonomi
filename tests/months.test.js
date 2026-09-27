// Prövar datalagret i src/server/months.js: kedjan för en månads innehåll,
// ägarregeln per användare och de tre skrivvägarna.
//
// Varje testfall öppnar sin egen databas i minnet och skickar in den genom
// options-argumentet, så att inget fall kan se en rad ett annat fall skrev och
// ingen fil på disken rörs. DatabaseSync är synkron: ingen rad här har await.
//
// Månaden läses aldrig ur klockan: varje månad i filen står som en literal, och
// readMonth tar månaden som argument. Ingen frozen-months-hjälpare finns eller
// behövs (ARKITEKTUR.md, "Månaden injiceras inte i testerna").
import assert from 'node:assert/strict';
import test from 'node:test';

import { monthTotals } from '../src/core/budget.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import {
  addMonthItem,
  readMonth,
  removeMonthItem,
  updateMonthItem
} from '../src/server/months.js';

const NOW = '2026-09-25T18:03:00.000Z';
const ANNA = 'u-anna';
const BERIT = 'u-berit';

// Två konton, så att varje fall kan pröva att den ena aldrig ser den andras
// rader utan att först bygga upp sitt eget utgångsläge.
function freshDatabase() {
  const db = openDatabase(MEMORY_PATH);
  const insertUser = db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)');
  insertUser.run(ANNA, 'anna@example.se', NOW);
  insertUser.run(BERIT, 'berit@example.se', NOW);
  return db;
}

function insertTemplate(db, row) {
  const values = {
    id: 't1',
    user_id: ANNA,
    series_id: null,
    kind: 'expense',
    name: 'Hyra',
    amount_ore: 1250000,
    category: 'housing',
    interval: 'monthly',
    start_date: '2026-01-15',
    from_month: '2026-01',
    to_month: null,
    created_at: NOW,
    ...row
  };
  values.series_id = values.series_id ?? values.id;
  db.prepare(`INSERT INTO templates
      (id, user_id, series_id, kind, name, amount_ore, category, interval,
       start_date, from_month, to_month, created_at)
      VALUES (:id, :user_id, :series_id, :kind, :name, :amount_ore, :category,
              :interval, :start_date, :from_month, :to_month, :created_at)`)
    .run(values);
  return values;
}

function insertMonthItemRow(db, row) {
  const values = {
    id: 'm1',
    user_id: ANNA,
    month: '2026-10',
    kind: 'expense',
    name: 'Tandläkare',
    amount_ore: 95000,
    category: 'other',
    created_at: NOW,
    ...row
  };
  db.prepare(`INSERT INTO month_items
      (id, user_id, month, kind, name, amount_ore, category, created_at)
      VALUES (:id, :user_id, :month, :kind, :name, :amount_ore, :category, :created_at)`)
    .run(values);
  return values;
}

function insertOverrideRow(db, row) {
  db.prepare(`INSERT INTO overrides
      (id, user_id, template_id, month, amount_ore, skipped, created_at)
      VALUES (:id, :user_id, :template_id, :month, :amount_ore, :skipped, :created_at)`)
    .run({
      id: 'o1',
      user_id: ANNA,
      template_id: 't1',
      month: '2026-10',
      amount_ore: null,
      skipped: 0,
      created_at: NOW,
      ...row
    });
}

// Namnen i en månad, i den ordning readMonth ger dem.
function namesIn(db, userId, month) {
  return readMonth(userId, month, { db }).items.map((item) => item.name);
}

// (M1) en engångspost syns bara i sin månad.
test('M1: en engångspost lagd i oktober saknas i september och november', () => {
  const db = freshDatabase();
  insertMonthItemRow(db, { month: '2026-10', name: 'Tandläkare' });

  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Tandläkare']);
  assert.deepEqual(namesIn(db, ANNA, '2026-09'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);
  db.close();
});

// (M2) en månadsmall syns i varje månad från from_month.
test('M2: en månadsmall syns i tre månader i rad från from_month', () => {
  const db = freshDatabase();
  insertTemplate(db, { interval: 'monthly', start_date: '2026-09-15', from_month: '2026-09', name: 'Hyra' });

  for (const month of ['2026-09', '2026-10', '2026-11']) {
    assert.deepEqual(namesIn(db, ANNA, month), ['Hyra'], month);
  }
  // Månaden före from_month har den inte.
  assert.deepEqual(namesIn(db, ANNA, '2026-08'), []);
  db.close();
});

// (M3) en kvartalsmall syns var tredje månad, räknat från start_date, prövat
// över sex månader. start_date den 31:a är med för att klampningen ska ingå:
// nextDueDate ger 2026-04-30 i april, och månaden är då fortfarande april.
test('M3: en kvartalsmall syns var tredje månad räknat från start_date', () => {
  const db = freshDatabase();
  insertTemplate(db, {
    interval: 'quarterly',
    start_date: '2026-01-31',
    from_month: '2026-01',
    name: 'Försäkring'
  });

  const facit = {
    '2026-01': ['Försäkring'],
    '2026-02': [],
    '2026-03': [],
    '2026-04': ['Försäkring'],
    '2026-05': [],
    '2026-06': []
  };
  for (const [month, names] of Object.entries(facit)) {
    assert.deepEqual(namesIn(db, ANNA, month), names, month);
  }
  // Klampningen syns i dueDate: februari har 28 dagar i 2026, april 30.
  assert.equal(readMonth(ANNA, '2026-04', { db }).items[0].dueDate, '2026-04-30');
  assert.equal(readMonth(ANNA, '2026-01', { db }).items[0].dueDate, '2026-01-31');
  db.close();
});

// (M4) en halvårsmall syns var sjätte månad.
test('M4: en halvårsmall syns med sex månader isär', () => {
  const db = freshDatabase();
  insertTemplate(db, {
    interval: 'semiannual',
    start_date: '2026-03-10',
    from_month: '2026-01',
    name: 'Vägavgift'
  });

  assert.deepEqual(namesIn(db, ANNA, '2026-03'), ['Vägavgift']);
  assert.deepEqual(namesIn(db, ANNA, '2026-09'), ['Vägavgift']);
  for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    assert.deepEqual(namesIn(db, ANNA, month), [], month);
  }
  db.close();
});

// (M5) to_month stänger serien.
test('M5: månaden efter to_month saknar posten', () => {
  const db = freshDatabase();
  insertTemplate(db, {
    interval: 'monthly',
    start_date: '2026-01-15',
    from_month: '2026-01',
    to_month: '2026-09',
    name: 'Spotify Family'
  });

  assert.deepEqual(namesIn(db, ANNA, '2026-09'), ['Spotify Family']);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), []);
  db.close();
});

// (M6) en override ändrar beloppet bara i sin månad.
test('M6: en override ändrar beloppet bara i sin månad', () => {
  const db = freshDatabase();
  insertTemplate(db, { amount_ore: 19900, name: 'Spotify Family', start_date: '2026-01-15' });
  insertOverrideRow(db, { month: '2026-10', amount_ore: 24900, skipped: 0 });

  const oktober = readMonth(ANNA, '2026-10', { db }).items;
  assert.equal(oktober.length, 1);
  assert.equal(oktober[0].amountOre, 24900);
  assert.equal(oktober[0].overridden, true);

  for (const month of ['2026-09', '2026-11']) {
    const items = readMonth(ANNA, month, { db }).items;
    assert.equal(items.length, 1, month);
    assert.equal(items[0].amountOre, 19900, month);
    assert.equal(items[0].overridden, false, month);
  }
  db.close();
});

// (M7) skipped tar bort posten ur månaden, och bara ur den.
test('M7: skipped tar bort posten ur sin månad och bara ur den', () => {
  const db = freshDatabase();
  insertTemplate(db, { name: 'Gymkort', start_date: '2026-01-15' });
  insertOverrideRow(db, { month: '2026-10', amount_ore: null, skipped: 1 });

  assert.deepEqual(namesIn(db, ANNA, '2026-10'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-09'), ['Gymkort']);
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), ['Gymkort']);
  // Summorna följer med: den överhoppade månaden har inga ören.
  assert.equal(readMonth(ANNA, '2026-10', { db }).totals.expenseOre, 0);
  db.close();
});

// (M8) en annan användares poster syns aldrig.
test('M8: två konton, tom lista för det andra', () => {
  const db = freshDatabase();
  insertTemplate(db, { id: 't-anna', user_id: ANNA, name: 'Hyra', start_date: '2026-01-15' });
  insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10', name: 'Tandläkare' });

  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Hyra', 'Tandläkare']);
  const berit = readMonth(BERIT, '2026-10', { db });
  assert.deepEqual(berit.items, []);
  assert.deepEqual(berit.totals, { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });
  db.close();
});

// (M9) updateMonthItem och removeMonthItem mot någon annans id ger samma svar
// som mot ett id som inte finns, och rör inte raden.
test('M9: updateMonthItem mot någon annans id svarar som mot ett okänt id', () => {
  const db = freshDatabase();
  insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10', name: 'Tandläkare', amount_ore: 95000 });

  const draft = { kind: 'expense', name: 'Kapad', amountOre: 100, category: 'other' };
  assert.equal(updateMonthItem(BERIT, 'm-anna', draft, { db }), null);
  assert.equal(updateMonthItem(BERIT, 'finns-inte', draft, { db }), null);
  assert.equal(removeMonthItem(BERIT, 'm-anna', { db }), false);
  assert.equal(removeMonthItem(BERIT, 'finns-inte', { db }), false);

  // Raden är orörd: varken namn eller belopp har ändrats, och den finns kvar.
  const kvar = readMonth(ANNA, '2026-10', { db }).items;
  assert.deepEqual(kvar.map((item) => [item.name, item.amountOre]), [['Tandläkare', 95000]]);
  db.close();
});

// (M10) summorna följer posterna.
test('M10: readMonth ger samma summor som monthTotals på dess egna poster', () => {
  const db = freshDatabase();
  insertTemplate(db, { id: 't-lon', kind: 'income', name: 'Lön', amount_ore: 3000000, category: 'other', start_date: '2026-01-25' });
  insertTemplate(db, { id: 't-hyra', kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', start_date: '2026-01-31' });
  insertTemplate(db, { id: 't-spar', kind: 'saving', name: 'Buffert', amount_ore: 500000, category: 'other', start_date: '2026-01-05' });
  insertMonthItemRow(db, { id: 'm-tand', kind: 'expense', name: 'Tandläkare', amount_ore: 95000, month: '2026-10' });

  const { items, totals } = readMonth(ANNA, '2026-10', { db });
  assert.equal(items.length, 4);
  assert.deepEqual(totals, monthTotals(items));
  // Utskrivet facit, så att ett fel i monthTotals inte kan dölja sig i en
  // jämförelse mot sig själv: 3000000 - (1250000 + 95000) - 500000.
  assert.deepEqual(totals, {
    incomeOre: 3000000,
    expenseOre: 1345000,
    savingOre: 500000,
    leftOre: 1155000
  });
  db.close();
});

// Steg 5 i kedjan: slag, därefter namn i svensk ordning, därefter id.
test('posterna sorteras på slag, sedan namn i svensk ordning, sedan id', () => {
  const db = freshDatabase();
  insertMonthItemRow(db, { id: 'm-3', kind: 'saving', name: 'Buffert', month: '2026-10' });
  insertMonthItemRow(db, { id: 'm-2', kind: 'expense', name: 'Zebra', month: '2026-10' });
  insertMonthItemRow(db, { id: 'm-1', kind: 'expense', name: 'Ångbåt', month: '2026-10' });
  insertMonthItemRow(db, { id: 'm-5', kind: 'income', name: 'Lön', month: '2026-10' });
  // Samma slag och samma namn: id avgör, och b kommer efter a.
  insertMonthItemRow(db, { id: 'm-b', kind: 'expense', name: 'El', month: '2026-10' });
  insertMonthItemRow(db, { id: 'm-a', kind: 'expense', name: 'El', month: '2026-10' });

  assert.deepEqual(
    readMonth(ANNA, '2026-10', { db }).items.map((item) => [item.kind, item.name, item.id]),
    [
      ['income', 'Lön', 'm-5'],
      ['expense', 'El', 'm-a'],
      ['expense', 'El', 'm-b'],
      ['expense', 'Zebra', 'm-2'],
      ['expense', 'Ångbåt', 'm-1'],
      ['saving', 'Buffert', 'm-3']
    ]
  );
  db.close();
});

// Språket i sorteringen är utskrivet och beror inte på maskinens språk. Utan
// argumentet 'sv' avgör körmiljöns standardspråk ordningen, och på en engelsk
// maskin kommer Ångbåt då före Zebra (LARDOMAR.md 2026-09-12). De två
// kollatorerna prövas var för sig, så att fallet fäller mutationen "ta bort 'sv'"
// oavsett vilket språk maskinen har.
test('namnordningen är svensk och skiljer sig från den engelska', () => {
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true);
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true);

  const db = freshDatabase();
  insertMonthItemRow(db, { id: 'm-1', kind: 'expense', name: 'Ångbåt', month: '2026-10' });
  insertMonthItemRow(db, { id: 'm-2', kind: 'expense', name: 'Zebra', month: '2026-10' });
  const svenska = namesIn(db, ANNA, '2026-10');
  assert.deepEqual(svenska, ['Zebra', 'Ångbåt']);
  // Och inte den ordning en engelsk kollator ger för samma två namn.
  assert.notDeepEqual(svenska, ['Ångbåt', 'Zebra'].sort(new Intl.Collator('en').compare));
  db.close();
});

// Skrivvägarna: den skapade posten, den ändrade posten och borttagningen.
test('addMonthItem skapar posten och svarar med den', () => {
  const db = freshDatabase();
  const skapad = addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-ny' });

  assert.deepEqual(skapad, {
    id: 'm-ny',
    kind: 'expense',
    name: 'Tandläkare',
    amountOre: 95000,
    category: 'other',
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false
  });
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Tandläkare']);
  // Och bara i sin månad.
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);
  db.close();
});

test('addMonthItem skriver created_at ur now och läser ingen klocka', () => {
  const db = freshDatabase();
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-ny' });
  // Ett skalärt värde och inte deepEqual mot ett objekt: node:sqlite svarar med
  // objekt utan prototyp, och en strikt deepEqual mot ett vanligt objekt faller
  // på just det.
  const rows = db.prepare('SELECT created_at FROM month_items WHERE id = ?').all('m-ny');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_at, NOW);
  db.close();
});

test('updateMonthItem ändrar posten och svarar med den', () => {
  const db = freshDatabase();
  insertMonthItemRow(db, { id: 'm-1', month: '2026-10', name: 'Tandläkare', amount_ore: 95000 });

  const ändrad = updateMonthItem(ANNA, 'm-1', { kind: 'saving', name: 'Tandvård', amountOre: 120000, category: 'other' }, { db });
  assert.equal(ändrad.name, 'Tandvård');
  assert.equal(ändrad.amountOre, 120000);
  assert.equal(ändrad.kind, 'saving');
  assert.deepEqual(readMonth(ANNA, '2026-10', { db }).totals, {
    incomeOre: 0,
    expenseOre: 0,
    savingOre: 120000,
    leftOre: -120000
  });
  db.close();
});

test('removeMonthItem tar bort posten och svarar true, därefter false', () => {
  const db = freshDatabase();
  insertMonthItemRow(db, { id: 'm-1', month: '2026-10' });

  assert.equal(removeMonthItem(ANNA, 'm-1', { db }), true);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), []);
  // Ett andra anrop tar inte bort något och svarar false, precis som mot ett id
  // som aldrig funnits.
  assert.equal(removeMonthItem(ANNA, 'm-1', { db }), false);
  db.close();
});

// Månadsspärren: en ogiltig månad blir aldrig en SQL-fråga. Meddelandet är
// ägarens, firstDayOfMonth i src/core/dates.js, för readMonth — ingen ny text
// för en fråga som redan har en ägare.
test('readMonth avvisar en månad som inte är en månad, före varje fråga', () => {
  const db = freshDatabase();
  for (const month of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    assert.throws(
      () => readMonth(ANNA, month, { db }),
      { name: 'RangeError', message: `firstDayOfMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  db.close();
});

test('addMonthItem avvisar en månad som inte är en månad, före skrivningen', () => {
  const db = freshDatabase();
  const draft = { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' };
  for (const month of ['2026-13', '2026-1', '', null, undefined, 202610, 1n, Symbol('x')]) {
    assert.throws(
      () => addMonthItem(ANNA, month, draft, { db, now: NOW, makeId: () => 'm-ny' }),
      { name: 'RangeError', message: `addMonthItem kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  // Ingen rad skrevs: tabellen är tom efter alla åtta försöken.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM month_items').all()[0].antal, 0);
  db.close();
});

// En mall som börjar senare än from_month ger ingen post före sin första
// dragning: steg 2 avgör det, inte SQL.
test('en mall vars start_date ligger efter from_month syns först vid dragningen', () => {
  const db = freshDatabase();
  insertTemplate(db, {
    interval: 'yearly',
    start_date: '2026-06-30',
    from_month: '2026-01',
    name: 'Domännamn'
  });

  assert.deepEqual(namesIn(db, ANNA, '2026-01'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-06'), ['Domännamn']);
  assert.deepEqual(namesIn(db, ANNA, '2027-06'), ['Domännamn']);
  assert.deepEqual(namesIn(db, ANNA, '2027-05'), []);
  db.close();
});

// En post ur en mall bär de två fälten som säger varifrån den kommer, och en
// engångspost bär dem inte. Samma fältuppsättning i båda fallen.
test('en post ur en mall bär recurring och seriesId, en engångspost inte', () => {
  const db = freshDatabase();
  insertTemplate(db, { id: 't-b', series_id: 't-a', name: 'Spotify Family', start_date: '2026-01-15' });
  insertMonthItemRow(db, { id: 'm-1', name: 'Tandläkare', month: '2026-10' });

  const items = readMonth(ANNA, '2026-10', { db }).items;
  const mall = items.find((item) => item.name === 'Spotify Family');
  const engång = items.find((item) => item.name === 'Tandläkare');
  assert.equal(mall.recurring, true);
  assert.equal(mall.seriesId, 't-a');
  assert.equal(engång.recurring, false);
  assert.equal(engång.seriesId, null);
  assert.deepEqual(Object.keys(mall).sort(), Object.keys(engång).sort());
  db.close();
});
