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
import { CATEGORIES } from '../src/core/entry.js';
import { validateMonthItemDraft, validateTemplateDraft } from '../src/core/item.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import {
  addMonthItem,
  addTemplate,
  changeTemplateFrom,
  clearOverride,
  endTemplate,
  readMonth,
  readOverview,
  removeBudget,
  removeMonthItem,
  setBudget,
  setOverride,
  skipMonth,
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
    // Utkastet bär varken occurredOn eller note, så posten får null i båda
    // [steg 2].
    occurredOn: null,
    note: null,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    // En engångspost bär de två fälten som null: de två sorternas poster ska ha
    // exakt samma fält (ARKITEKTUR.md, rättelsen "posten bär sitt intervall").
    interval: null,
    toMonth: null
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

test('(68) posten bär interval och toMonth: mallens värden, och null för en engångspost', () => {
  const db = freshDatabase();
  // En kvartalsmall med en satt slutmånad, så att båda fälten har ett värde som
  // skiljer sig från förvalet: interval quarterly och inte monthly, to_month en
  // månad och inte null. Ett fält som bär sitt förval kan inte skilja "läst ur
  // raden" från "skrivet för hand".
  insertTemplate(db, {
    id: 't-kvartal',
    name: 'Hemförsäkring',
    interval: 'quarterly',
    start_date: '2026-01-15',
    to_month: '2027-06'
  });
  insertMonthItemRow(db, { id: 'm-1', name: 'Tandläkare', month: '2026-10' });

  const items = readMonth(ANNA, '2026-10', { db }).items;
  const mall = items.find((item) => item.name === 'Hemförsäkring');
  const engång = items.find((item) => item.name === 'Tandläkare');

  assert.equal(mall.interval, 'quarterly');
  assert.equal(mall.toMonth, '2027-06');
  // Engångsposten har inget intervall och ingen slutmånad, och bär fälten som
  // null — inte som undefined och inte alls: gränssnittet förifyller dem ur
  // posten, och ett saknat fält hade gett strängen "undefined" i formuläret.
  assert.equal(engång.interval, null);
  assert.equal(engång.toMonth, null);
  assert.deepEqual(Object.keys(mall).sort(), Object.keys(engång).sort());
  db.close();
});

test('(68) en mall utan slutmånad ger toMonth null, inte den tomma strängen', () => {
  const db = freshDatabase();
  insertTemplate(db, { id: 't-oandlig', name: 'Hyra', to_month: null, start_date: '2026-01-15' });

  const mall = readMonth(ANNA, '2026-10', { db }).items[0];
  assert.equal(mall.toMonth, null);
  assert.equal(mall.interval, 'monthly');
  db.close();
});

// ---------------------------------------------------------------------------
// Mallarna och avvikelserna [etapp 4]: kravlistan (M11) till (M20).
//
// Varje fall bygger sitt utgångsläge genom modulens egna skrivvägar och inte
// genom insertTemplate ovan, utom där facit kräver en mall som börjat tidigare
// än den månad fallet ändrar i. Skälet är att "historiken är oföränderlig" är
// ett påstående om vad funktionerna gör, inte om vad en handskriven rad blir.
// ---------------------------------------------------------------------------

// Mallens utkast, på den form validateTemplateDraft ger: ören och inte kronor,
// och toMonth som null för "tills vidare".
const MALLUTKAST = Object.freeze({
  kind: 'expense',
  name: 'Hyra',
  amountOre: 1250000,
  category: 'housing',
  interval: 'monthly',
  toMonth: null
});

// Namn och belopp i en månad, i den ordning readMonth ger dem.
function beloppIn(db, userId, month) {
  return readMonth(userId, month, { db }).items.map((item) => [item.name, item.amountOre]);
}

function templateRows(db, seriesId) {
  return db
    .prepare('SELECT id, series_id, from_month, to_month, amount_ore, start_date FROM templates WHERE series_id = ? ORDER BY from_month')
    .all(seriesId);
}

// (M11) en mall syns i varje månad från from_month, prövat över tre månader i
// rad. Månaden före from_month har den inte.
test('M11: en mall skapad i oktober syns i oktober, november och december', () => {
  const db = freshDatabase();
  const mall = addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' });

  assert.deepEqual(mall, {
    id: 't-ny',
    seriesId: 't-ny',
    kind: 'expense',
    name: 'Hyra',
    amountOre: 1250000,
    category: 'housing',
    interval: 'monthly',
    // start_date härleds ur månaden: formuläret har inget dagfält.
    startDate: '2026-10-01',
    fromMonth: '2026-10',
    toMonth: null
  });
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(namesIn(db, ANNA, month), ['Hyra'], month);
  }
  assert.deepEqual(namesIn(db, ANNA, '2026-09'), []);
  db.close();
});

test('M11: toMonth ur utkastet stänger serien, och toMonth null betyder tills vidare', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', { ...MALLUTKAST, name: 'Spotify', toMonth: '2026-11' }, { db, now: NOW, makeId: () => 't-slut' });

  assert.deepEqual(namesIn(db, ANNA, '2026-11'), ['Spotify']);
  assert.deepEqual(namesIn(db, ANNA, '2026-12'), []);
  db.close();
});

// (M12) endTemplate lämnar passerade månader orörda: månaden före har posten
// kvar, månaden efter saknar den.
test('M12: endTemplate från november lämnar oktober orörd och tömmer november', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(endTemplate(ANNA, 't-1', '2026-11', { db }), true);

  assert.deepEqual(beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-12'), []);
  // Raden är inte borttagen: to_month är satt till månaden före, så historiken
  // finns kvar att läsa.
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-1', '2026-10', '2026-10']
  ]);
  db.close();
});

// Gränsfallet för endTemplate: serien avslutas från samma månad som den börjar
// i. to_month = månaden före hade då brutit CHECK (to_month IS NULL OR
// to_month >= from_month), så versionen tas i stället bort — den gäller ingen
// månad alls, och ingen passerad månad berörs.
test('M12: endTemplate från seriens egen from_month tar bort versionen', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(endTemplate(ANNA, 't-1', '2026-10', { db }), true);
  assert.deepEqual(templateRows(db, 't-1'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), []);
  db.close();
});

test('M12: endTemplate mot ett series_id som inte finns svarar false och skriver inget', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(endTemplate(ANNA, 'finns-inte', '2026-11', { db }), false);
  assert.deepEqual(templateRows(db, 't-1').map((row) => row.to_month), [null]);
  db.close();
});

// (M13) changeTemplateFrom versionerar: två rader med samma series_id, den gamla
// med to_month satt.
test('M13: changeTemplateFrom ger två rader med samma series_id och den gamla avslutad', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  const ny = changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  assert.equal(ny.id, 't-2');
  assert.equal(ny.seriesId, 't-1');
  assert.equal(ny.fromMonth, '2026-11');
  assert.equal(ny.amountOre, 1300000);
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2026-10', 1250000],
    ['t-2', '2026-11', null, 1300000]
  ]);
  db.close();
});

// Den nya versionen behåller den gamlas start_date. Dagen styr intervallets fas
// i steg 2 av readMonth: en ny dag hade flyttat vilka månader serien träffar.
// Prövat på en kvartalsserie, där fasen syns — med start_date satt till den nya
// månadens första dag hade serien i stället träffat 2026-05, 2026-08 och 2026-11.
test('M13: den nya versionen behåller start_date, så kvartalsfasen inte flyttas', () => {
  const db = freshDatabase();
  insertTemplate(db, {
    id: 't-1',
    name: 'Försäkring',
    interval: 'quarterly',
    start_date: '2026-01-20',
    from_month: '2026-01',
    amount_ore: 300000
  });

  const ny = changeTemplateFrom(ANNA, 't-1', '2026-05', { ...MALLUTKAST, name: 'Försäkring', interval: 'quarterly', amountOre: 350000 }, { db, now: NOW, makeId: () => 't-2' });
  assert.equal(ny.startDate, '2026-01-20');

  // Samma träffmånader som före ändringen: juli och oktober, inte maj och
  // augusti.
  assert.deepEqual(namesIn(db, ANNA, '2026-07'), ['Försäkring']);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Försäkring']);
  assert.deepEqual(namesIn(db, ANNA, '2026-05'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-08'), []);
  // Och beloppet är det nya i juli, som ligger efter ändringen.
  assert.deepEqual(beloppIn(db, ANNA, '2026-07'), [['Försäkring', 350000]]);
  // Medan april, som ligger före, har det gamla.
  assert.deepEqual(beloppIn(db, ANNA, '2026-04'), [['Försäkring', 300000]]);
  db.close();
});

// (M14) ändring framåt rör inte historiken: föregående månad har gamla beloppet,
// denna och nästa det nya.
test('M14: en ändring från november lämnar oktober på gamla beloppet', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  assert.deepEqual(beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1300000]]);
  assert.deepEqual(beloppIn(db, ANNA, '2026-12'), [['Hyra', 1300000]]);
  // Och exakt en post per månad: versionerna överlappar inte.
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.equal(readMonth(ANNA, month, { db }).items.length, 1, month);
  }
  db.close();
});

// (M15) ändring från egen from_month uppdaterar i stället: en rad, inte två.
// Att sätta to_month till månaden före from_month ger to_month < from_month,
// vilket schemats CHECK fäller — och ingen passerad månad berörs, så raden ska
// uppdateras.
test('M15: en ändring från seriens egen from_month ger en rad, inte två', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  const ändrad = changeTemplateFrom(ANNA, 't-1', '2026-10', { ...MALLUTKAST, name: 'Hyra ny', amountOre: 1300000, toMonth: '2027-06' }, { db, now: NOW, makeId: () => 't-skulle-inte-skapas' });

  assert.equal(ändrad.id, 't-1');
  assert.equal(ändrad.fromMonth, '2026-10');
  assert.equal(ändrad.toMonth, '2027-06');
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2027-06', 1300000]
  ]);
  // Ingen rad med det id makeId hade gett: ingen ny version skapades.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates WHERE id = ?').get('t-skulle-inte-skapas').antal, 0);
  assert.deepEqual(beloppIn(db, ANNA, '2026-10'), [['Hyra ny', 1300000]]);
  db.close();
});

test('M15: changeTemplateFrom mot en månad serien inte gäller svarar null och skriver inget', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  // September ligger före from_month, så ingen version gäller den månaden.
  assert.equal(changeTemplateFrom(ANNA, 't-1', '2026-09', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' }), null);
  assert.equal(changeTemplateFrom(ANNA, 'finns-inte', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-3' }), null);
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.to_month]), [['t-1', null]]);
  db.close();
});

// (M16) setOverride ändrar bara sin månad: grannmånaderna oförändrade.
test('M16: setOverride ändrar beloppet bara i sin månad', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' }), true);

  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);
  assert.equal(readMonth(ANNA, '2026-11', { db }).items[0].overridden, true);
  for (const month of ['2026-10', '2026-12']) {
    assert.deepEqual(beloppIn(db, ANNA, month), [['Hyra', 1250000]], month);
    assert.equal(readMonth(ANNA, month, { db }).items[0].overridden, false, month);
  }
  db.close();
});

// En andra avvikelse för samma mall och månad ersätter den första. Utan
// ON CONFLICT hade UNIQUE (template_id, month) fällt skrivningen.
test('M16: ett andra setOverride för samma månad ersätter det första beloppet', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal(setOverride(ANNA, 't-1', '2026-11', 111100, { db, now: NOW, makeId: () => 'o-2' }), true);

  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 111100]]);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 1);
  db.close();
});

// (M17) skipMonth tar bort posten ur en månad, och bara ur den.
test('M17: skipMonth tömmer sin månad och lämnar grannmånaderna', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-1' }), true);

  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);
  assert.equal(readMonth(ANNA, '2026-11', { db }).totals.expenseOre, 0);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Hyra']);
  assert.deepEqual(namesIn(db, ANNA, '2026-12'), ['Hyra']);
  db.close();
});

// En överhoppad månad som i stället får ett belopp, och tvärtom. Schemats CHECK
// tillåter bara en av amount_ore och skipped åt gången, så övergången mellan de
// två måste skriva båda kolumnerna.
test('M17: skipMonth efter setOverride och tvärtom, på samma mall och månad', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal(skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-2' }), true);
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);

  assert.equal(setOverride(ANNA, 't-1', '2026-11', 888800, { db, now: NOW, makeId: () => 'o-3' }), true);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 888800]]);
  db.close();
});

// (M18) clearOverride återställer: mallens belopp tillbaka.
test('M18: clearOverride ger mallens belopp tillbaka', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);

  assert.equal(clearOverride(ANNA, 't-1', '2026-11', { db }), true);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  assert.equal(readMonth(ANNA, '2026-11', { db }).items[0].overridden, false);
  // Ett andra anrop tar inte bort något och svarar false, precis som mot en
  // månad som aldrig haft en avvikelse.
  assert.equal(clearOverride(ANNA, 't-1', '2026-11', { db }), false);
  db.close();
});

test('M18: clearOverride på en överhoppad månad ger posten tillbaka', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-1' });

  assert.equal(clearOverride(ANNA, 't-1', '2026-11', { db }), true);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  db.close();
});

// (M19) transaktionen håller: en changeTemplateFrom som faller halvvägs lämnar
// noll ändringar.
//
// Avbrottet är inte simulerat: makeId ger ett id som redan finns, så INSERT
// bryter PRIMARY KEY efter att UPDATE av den gamla raden redan har körts. Utan
// transaction i db.js blir to_month = 2026-10 kvar på den gamla raden, och
// serien slutar därmed i oktober utan att någon ny version tar över — posten
// försvinner ur varje kommande månad.
test('M19: en changeTemplateFrom som faller på andra skrivningen lämnar noll ändringar', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.throws(
    () => changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-1' }),
    { name: 'DatabaseError', message: 'Uppgifterna kunde inte sparas: något värde är ogiltigt.' }
  );

  // Den gamla raden är orörd: to_month är fortfarande null, och beloppet det
  // gamla.
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', null, 1250000]
  ]);
  // Och månaderna ser ut som före anropet.
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(beloppIn(db, ANNA, month), [['Hyra', 1250000]], month);
  }
  db.close();
});

// Samma avbrott i endTemplate, som också gör två skrivningar: den andra
// skrivningen, DELETE, kan inte falla på ett CHECK, så fallet prövar i stället
// att de två tillsammans lämnar en läsbar serie — och att en transaktion som
// fullbordas verkligen fullbordas, alltså att COMMIT körs.
test('M19: endTemplate fullbordar sin transaktion, så ändringen finns efter anropet', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  changeTemplateFrom(ANNA, 't-1', '2026-12', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' });

  // Två versioner: oktober-november och december och framåt. Serien avslutas
  // från november, alltså mitt i den första versionen och före hela den andra.
  assert.equal(endTemplate(ANNA, 't-1', '2026-11', { db }), true);

  // Steg 1 avslutade den första versionen, steg 2 tog bort den andra.
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-1', '2026-10', '2026-10']
  ]);
  assert.deepEqual(namesIn(db, ANNA, '2026-10'), ['Hyra']);
  assert.deepEqual(namesIn(db, ANNA, '2026-11'), []);
  assert.deepEqual(namesIn(db, ANNA, '2026-12'), []);
  db.close();
});

// (M20) en annan användares mall är onåbar: samma svar som för ett okänt id.
test('M20: Berit når ingen av Annas mallar, och får samma svar som för ett okänt id', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });

  // De fem funktionerna som tar ett id, var och en mot Annas id och mot ett id
  // som inte finns. Svaren ska vara identiska.
  assert.equal(endTemplate(BERIT, 't-anna', '2026-11', { db }), endTemplate(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(endTemplate(BERIT, 't-anna', '2026-11', { db }), false);

  assert.equal(
    changeTemplateFrom(BERIT, 't-anna', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad' }),
    changeTemplateFrom(BERIT, 'finns-inte', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad2' })
  );
  assert.equal(changeTemplateFrom(BERIT, 't-anna', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad3' }), null);

  assert.equal(setOverride(BERIT, 't-anna', '2026-11', 1, { db, now: NOW, makeId: () => 'o-1' }), setOverride(BERIT, 'finns-inte', '2026-11', 1, { db, now: NOW, makeId: () => 'o-2' }));
  assert.equal(setOverride(BERIT, 't-anna', '2026-11', 1, { db, now: NOW, makeId: () => 'o-3' }), false);

  assert.equal(skipMonth(BERIT, 't-anna', '2026-11', { db, now: NOW, makeId: () => 'o-4' }), skipMonth(BERIT, 'finns-inte', '2026-11', { db, now: NOW, makeId: () => 'o-5' }));
  assert.equal(skipMonth(BERIT, 't-anna', '2026-11', { db, now: NOW, makeId: () => 'o-6' }), false);

  assert.equal(clearOverride(BERIT, 't-anna', '2026-11', { db }), clearOverride(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(clearOverride(BERIT, 't-anna', '2026-11', { db }), false);

  // Annas mall är orörd, och ingen avvikelse och ingen ny version skrevs.
  assert.deepEqual(templateRows(db, 't-anna').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-anna', '2026-10', null, 1250000]
  ]);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  // Och Berits egen november är tom.
  assert.deepEqual(namesIn(db, BERIT, '2026-11'), []);
  db.close();
});

// Berit får inte heller ta bort en framtida version av Annas serie. Fallet
// skiljer sig från (M20) ovan: där har Annas version from_month före månaden, så
// SQL_DELETE_TEMPLATES_FROM matchar ingen rad ens utan user_id = ?. Här ligger
// from_month i samma månad som anropet, och det är bara ägarvillkoret i den
// DELETE:en som skiljer de två användarna.
test('M20: endTemplate mot någon annans framtida version tar inte bort den', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });

  assert.equal(endTemplate(BERIT, 't-anna', '2026-11', { db }), endTemplate(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(endTemplate(BERIT, 't-anna', '2026-11', { db }), false);
  assert.deepEqual(templateRows(db, 't-anna').map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-anna', '2026-11', null]
  ]);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  db.close();
});

// En avvikelse som Berit försöker ta bort hos Anna ligger kvar. Fallet skiljer
// sig från (M20) ovan: där fanns ingen avvikelse att träffa, här finns en.
test('M20: clearOverride mot någon annans mall lämnar avvikelsen kvar', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });
  setOverride(ANNA, 't-anna', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-anna' });

  assert.equal(clearOverride(BERIT, 't-anna', '2026-11', { db }), false);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);
  db.close();
});

// Månadsspärren i de sex nya funktionerna. Samma form som för addMonthItem:
// en ogiltig månad blir aldrig en SQL-fråga, och meddelandet namnger funktionen.
test('de sex nya funktionerna avvisar en månad som inte är en månad, före skrivningen', () => {
  const db = freshDatabase();
  insertTemplate(db, { id: 't-1', from_month: '2026-01', start_date: '2026-01-15' });
  const fel = ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')];
  const anrop = [
    ['addTemplate', (month) => addTemplate(ANNA, month, MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' })],
    ['endTemplate', (month) => endTemplate(ANNA, 't-1', month, { db })],
    ['changeTemplateFrom', (month) => changeTemplateFrom(ANNA, 't-1', month, MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' })],
    ['setOverride', (month) => setOverride(ANNA, 't-1', month, 100, { db, now: NOW, makeId: () => 'o-ny' })],
    ['skipMonth', (month) => skipMonth(ANNA, 't-1', month, { db, now: NOW, makeId: () => 'o-ny' })],
    ['clearOverride', (month) => clearOverride(ANNA, 't-1', month, { db })]
  ];

  for (const [namn, kör] of anrop) {
    for (const month of fel) {
      assert.throws(
        () => kör(month),
        { name: 'RangeError', message: `${namn} kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
        `${namn} ${String(month)}`
      );
    }
  }

  // Ingen rad skrevs och ingen ändrades: en mall kvar, noll avvikelser, och
  // to_month fortfarande null.
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM templates').get().antal, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
  assert.equal(db.prepare('SELECT to_month FROM templates WHERE id = ?').get('t-1').to_month, null);
  db.close();
});

test('addTemplate skriver created_at ur now och läser ingen klocka', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' });
  const rows = db.prepare('SELECT created_at FROM templates WHERE id = ?').all('t-ny');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_at, NOW);
  db.close();
});

// Överlappande versioner. Ändras serien först från en framtida månad och
// därefter från en tidigare täcker två versioner samma månader, och posten
// visas två gånger — därför tar changeTemplateFrom bort varje version vars
// from_month ligger i eller efter den månad ändringen gäller, i samma
// transaktion (ARKITEKTUR.md, "Rättelse av etapp 4").
test('changeTemplateFrom tar bort en framtida version, så ingen månad får två poster', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  // Första ändringen: från december. Serien har nu två versioner.
  changeTemplateFrom(ANNA, 't-1', '2026-12', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });
  assert.equal(templateRows(db, 't-1').length, 2);

  // Andra ändringen: från november, alltså före den första ändringen.
  changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1400000 }, { db, now: NOW, makeId: () => 't-3' });

  // t-2 är borta: den började i december och täckte ingen passerad månad.
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2026-10', 1250000],
    ['t-3', '2026-11', null, 1400000]
  ]);
  // Exakt en post per månad, och oktober har kvar sitt gamla belopp.
  for (const month of ['2026-10', '2026-11', '2026-12', '2027-01']) {
    assert.equal(readMonth(ANNA, month, { db }).items.length, 1, month);
  }
  assert.deepEqual(beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(beloppIn(db, ANNA, '2026-11'), [['Hyra', 1400000]]);
  assert.deepEqual(beloppIn(db, ANNA, '2026-12'), [['Hyra', 1400000]]);
  db.close();
});

// Samma borttagning i gränsfallet, där den gamla raden uppdateras i stället för
// att versioneras: raden anropet behåller får inte tas bort, fastän dess
// from_month är samma månad.
test('changeTemplateFrom från egen from_month tar bort framtida versioner men behåller sin egen rad', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  changeTemplateFrom(ANNA, 't-1', '2026-12', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  // Oktober är t-1:s egen from_month: gränsfallet, alltså en uppdatering.
  const ändrad = changeTemplateFrom(ANNA, 't-1', '2026-10', { ...MALLUTKAST, amountOre: 1500000 }, { db, now: NOW, makeId: () => 't-4' });

  assert.equal(ändrad.id, 't-1');
  assert.deepEqual(templateRows(db, 't-1').map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', null, 1500000]
  ]);
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(beloppIn(db, ANNA, month), [['Hyra', 1500000]], month);
  }
  db.close();
});

// Avvikelsen för en borttagen version följer med, genom ON DELETE CASCADE på
// overrides.template_id. Utan PRAGMA foreign_keys = ON hade raden blivit kvar
// och pekat på en mall som inte finns.
test('en avvikelse på en borttagen framtida version försvinner med den', () => {
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  changeTemplateFrom(ANNA, 't-1', '2026-12', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' });
  setOverride(ANNA, 't-2', '2026-12', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 1);

  changeTemplateFrom(ANNA, 't-1', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-3' });

  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM overrides').get().antal, 0);
  assert.deepEqual(beloppIn(db, ANNA, '2026-12'), [['Hyra', 1250000]]);
  db.close();
});

// ---------------------------------------------------------------------------
// Tolvmånadersöversikten [etapp 5]. readOverview läser samma kedja som
// readMonth, en månad i taget, och summerar ingenting själv.
// ---------------------------------------------------------------------------

// Tre mallar som ger en översikt något att visa: inkomst, utgift och sparande,
// alla månadsvisa från januari 2026.
function insertYear(db, userId = ANNA) {
  insertTemplate(db, { id: `${userId}-lon`, user_id: userId, kind: 'income', name: 'Lön', amount_ore: 3000000, category: 'other', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
  insertTemplate(db, { id: `${userId}-hyra`, user_id: userId, kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
  insertTemplate(db, { id: `${userId}-buffert`, user_id: userId, kind: 'saving', name: 'Buffert', amount_ore: 200000, category: 'savings', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
}

// (M26) tolv månader i rätt ordning: äldst först, och den sista är endMonth.
test('M26: readOverview ger tolv månader, äldst först, med endMonth sist', () => {
  const db = freshDatabase();
  insertYear(db);

  const översikt = readOverview(ANNA, '2026-10', 12, { db });

  assert.equal(översikt.months.length, 12);
  assert.deepEqual(översikt.months.map((rad) => rad.month), [
    '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
  ]);
  // Äldst först, inte nyast först: den sista raden är endMonth.
  assert.equal(översikt.months[11].month, '2026-10');
  assert.equal(översikt.months[0].month, '2025-11');
  db.close();
});

// (M27) summorna kommer ur monthTotals: samma tal som readMonth ger för varje
// månad. Jämförelsen sker mot monthTotals(readMonth(...).items) och inte mot
// handräknade tal — ett handräknat facit vore en andra väg till samma summa.
test('M27: varje rad i översikten bär exakt de tal readMonth ger för månaden', () => {
  const db = freshDatabase();
  insertYear(db);
  // En engångspost och en avvikelse, så att inte alla månader är lika: tolv
  // identiska rader kan inte skilja en läsning per månad från en upprepad
  // läsning av samma månad.
  insertMonthItemRow(db, { id: 'm-tand', month: '2026-08', kind: 'expense', name: 'Tandläkare', amount_ore: 95000, category: 'other' });
  insertOverrideRow(db, { id: 'o-hyra', template_id: `${ANNA}-hyra`, month: '2026-09', amount_ore: 1300000, skipped: 0 });

  const översikt = readOverview(ANNA, '2026-10', 12, { db });

  for (const rad of översikt.months) {
    const totals = monthTotals(readMonth(ANNA, rad.month, { db }).items);
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      totals,
      rad.month
    );
  }
  // De två avvikande månaderna syns verkligen i serien, så att loopen ovan inte
  // bara jämför tolv identiska rader.
  assert.equal(översikt.months.find((rad) => rad.month === '2026-08').expenseOre, 1250000 + 95000);
  assert.equal(översikt.months.find((rad) => rad.month === '2026-09').expenseOre, 1300000);
  db.close();
});

// (M28) savedThisYear räknar årets månader, från januari till och med endMonth,
// oavsett hur långt count sträcker sig bakåt. Översikten går över ett årsskifte:
// tolv månader bakåt från mars 2026 börjar i april 2025, men bara januari till
// mars 2026 ska räknas.
test('M28: savedThisYear räknar bara innevarande år, också över ett årsskifte', () => {
  const db = freshDatabase();
  // Sparande hela 2025 och hela 2026, med olika belopp per år: räknas 2025 med
  // blir summan en annan.
  insertTemplate(db, { id: 't-2025', kind: 'saving', name: 'Buffert 2025', amount_ore: 500000, category: 'savings', interval: 'monthly', start_date: '2025-01-01', from_month: '2025-01', to_month: '2025-12' });
  insertTemplate(db, { id: 't-2026', kind: 'saving', name: 'Buffert 2026', amount_ore: 200000, category: 'savings', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });

  const översikt = readOverview(ANNA, '2026-03', 12, { db });

  // Serien börjar i april 2025 och innehåller alltså nio månader med 2025:s
  // sparande — de ska inte vara med i savedThisYear.
  assert.equal(översikt.months[0].month, '2025-04');
  assert.equal(översikt.months[0].savingOre, 500000);
  assert.equal(översikt.savedThisYear, 3 * 200000);

  // Samma svar med en kortare serie: savedThisYear beror på endMonth:s år och
  // inte på count. Här sträcker sig serien inte ens tillbaka till januari.
  assert.equal(readOverview(ANNA, '2026-03', 2, { db }).savedThisYear, 3 * 200000);
  // I januari är det bara januari.
  assert.equal(readOverview(ANNA, '2026-01', 12, { db }).savedThisYear, 200000);
  // Och i december hela året.
  assert.equal(readOverview(ANNA, '2026-12', 12, { db }).savedThisYear, 12 * 200000);
  db.close();
});

// (M29) en tom månad ger fyra nollor och inte en utelämnad rad: utan den ser
// tidslinjen ut att hoppa över tid.
test('M29: en månad utan poster står med i serien, med fyra nollor', () => {
  const db = freshDatabase();
  // Mallen gäller från september. De tio månaderna före är tomma.
  insertTemplate(db, { id: 't-kort', kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', interval: 'monthly', start_date: '2026-09-01', from_month: '2026-09' });

  const översikt = readOverview(ANNA, '2026-10', 12, { db });

  assert.equal(översikt.months.length, 12);
  const tomma = översikt.months.filter((rad) => rad.month < '2026-09');
  assert.equal(tomma.length, 10);
  for (const rad of tomma) {
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 },
      rad.month
    );
  }
  // Månaderna med innehåll är kvar, så serien är inte bara nollor.
  assert.equal(översikt.months[10].expenseOre, 1250000);
  assert.equal(översikt.months[11].expenseOre, 1250000);
  db.close();
});

// (M30) en annan användares data syns inte: Berits konto är tomt fastän Annas
// har tolv månader med poster.
test('M30: readOverview för Berit ger tomma månader fastän Anna har poster', () => {
  const db = freshDatabase();
  insertYear(db, ANNA);
  insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10' });

  const annas = readOverview(ANNA, '2026-10', 12, { db });
  const berits = readOverview(BERIT, '2026-10', 12, { db });

  assert.equal(annas.months[11].incomeOre, 3000000);
  assert.equal(annas.savedThisYear, 10 * 200000);
  assert.equal(berits.months.length, 12);
  assert.deepEqual(berits.months.map((rad) => rad.month), annas.months.map((rad) => rad.month));
  for (const rad of berits.months) {
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 },
      rad.month
    );
  }
  assert.equal(berits.savedThisYear, 0);
  db.close();
});

// (M31) spärrarna, ett fall per rad i tabellen och hela meddelandet asserterat:
// en assert.throws mot enbart feltypen kan inte skilja rad 1 från rad 2
// (LARDOMAR.md 2026-09-16).
test('M31: readOverview avvisar en endMonth som inte är en månad, före varje fråga', () => {
  const db = freshDatabase();
  insertYear(db);
  for (const endMonth of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    assert.throws(
      () => readOverview(ANNA, endMonth, 12, { db }),
      { name: 'RangeError', message: `readOverview kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".` },
      String(endMonth)
    );
  }
  db.close();
});

// (M31) rad 2, med ett eget fall för taket: utan det kan en klient be om
// tiotusen månader och få servern att läsa tiotusen hela kedjor. Båda gränserna
// prövas från båda sidor, eftersom ett villkor med < och > annars kan vara
// skrivet med fel tecken utan att något test märker det.
test('M31: readOverview avvisar ett antal månader utanför 1 till 36', () => {
  const db = freshDatabase();
  insertYear(db);
  for (const count of [0, -1, 37, 10000, 1e9, 12.5, NaN, Infinity, -Infinity, '12', null, undefined, true, 1n, Symbol('x'), {}]) {
    assert.throws(
      () => readOverview(ANNA, '2026-10', count, { db }),
      { name: 'RangeError', message: `readOverview kräver ett antal månader mellan 1 och 36, fick "${String(count)}".` },
      String(count)
    );
  }
  // De två gränserna själva går igenom.
  assert.equal(readOverview(ANNA, '2026-10', 1, { db }).months.length, 1);
  assert.equal(readOverview(ANNA, '2026-10', 1, { db }).months[0].month, '2026-10');
  assert.equal(readOverview(ANNA, '2026-10', 36, { db }).months.length, 36);
  assert.equal(readOverview(ANNA, '2026-10', 36, { db }).months[0].month, '2023-11');
  db.close();
});


// ---------------------------------------------------------------------------
// Budget per kategori [steg 2]: kravlistan (B1) till (B9) i ARKITEKTUR.md under
// "Budget per kategori (bindande)".
//
// Numreringen (B1) till (B9) gäller den här filen. tests/budget.test.js har en
// egen uppsättning (B1) till (B6) för src/core/budget.js, och kravlistan i
// ARKITEKTUR.md delar ut båda. Varje testnamn nedan börjar därför med "B<N>:
// budget" så att det går att se vilken av de två en kryssrad hör till.
// ---------------------------------------------------------------------------

// Taken i en månad, i den ordning readMonth ger dem.
function budgetsIn(db, userId, month) {
  return readMonth(userId, month, { db }).budgets;
}

// (B1) ett tak syns bara i sin månad.
test('B1: budget — ett tak satt i oktober saknas i september och november', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'housing', 900000, { db, now: NOW, makeId: () => 'b1' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 900000, spentOre: 0, leftOre: 900000 }
  ]);
  assert.deepEqual(budgetsIn(db, ANNA, '2026-09'), []);
  assert.deepEqual(budgetsIn(db, ANNA, '2026-11'), []);
  db.close();
});

// (B2) spentOre räknar bara utgifter. En inkomst och ett sparande i samma
// kategori och samma månad ska inte påverka hur mycket som är kvar av ett
// utgiftstak. Beloppen är olika så att ett fel inte kan se rätt ut av en
// slump: hade inkomsten räknats med vore spentOre 2 540 000 och leftOre
// negativt, hade sparandet räknats med vore spentOre 440 000.
test('B2: budget — en inkomst och ett sparande i samma kategori påverkar inte spentOre', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'other', 500000, { db, now: NOW, makeId: () => 'b1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-utgift' });
  addMonthItem(ANNA, '2026-10', { kind: 'income', name: 'Såld cykel', amountOre: 2100000, category: 'other' }, { db, now: NOW, makeId: () => 'm-inkomst' });
  addMonthItem(ANNA, '2026-10', { kind: 'saving', name: 'Buffert', amountOre: 345000, category: 'other' }, { db, now: NOW, makeId: () => 'm-sparande' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 500000, spentOre: 95000, leftOre: 405000 }
  ]);
  // Månadens egna summor ser alla tre posterna: det är bara taket som räknar
  // enbart utgifter.
  const totals = readMonth(ANNA, '2026-10', { db }).totals;
  assert.equal(totals.incomeOre, 2100000);
  assert.equal(totals.savingOre, 345000);
  assert.equal(totals.expenseOre, 95000);
  db.close();
});

// (B2) fortsättning: en utgift i en ANNAN kategori räknas inte heller. Utan
// kategorivillkoret hade spentOre blivit summan av båda utgifterna.
test('B2: budget — en utgift i en annan kategori påverkar inte takets spentOre', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'other', 500000, { db, now: NOW, makeId: () => 'b1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' }, { db, now: NOW, makeId: () => 'm2' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 500000, spentOre: 95000, leftOre: 405000 }
  ]);
  db.close();
});

// (B2) fortsättning: en utgift ur en MALL räknas också, och med avvikelsens
// belopp när månaden har en. Taket gäller månadens utgifter, inte bara de
// engångsposter användaren skrivit in — utan det hade en användare med bara
// återkommande poster sett ett tak som alltid var orört.
test('B2: budget — en mallpost räknas in i spentOre, med månadens avvikelsebelopp', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'housing', 1500000, { db, now: NOW, makeId: () => 'b1' });
  insertTemplate(db, { id: 't1', interval: 'monthly', start_date: '2026-09-15', from_month: '2026-09', name: 'Hyra', amount_ore: 1250000, category: 'housing' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 1250000, leftOre: 250000 }
  ]);
  // Månaden får ett annat belopp: taket ska följa det, inte mallens.
  setOverride(ANNA, 't1', '2026-10', 1400000, { db, now: NOW, makeId: () => 'o1' });
  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 1400000, leftOre: 100000 }
  ]);
  // Och en överhoppad månad har ingen utgift alls.
  skipMonth(ANNA, 't1', '2026-10', { db, now: NOW, makeId: () => 'o2' });
  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 0, leftOre: 1500000 }
  ]);
  db.close();
});

// (B3) leftOre får vara negativt: ett överdrag ska synas som ett minusbelopp och
// aldrig som noll. Ingen spärr mot negativa värden, samma regel som leftOre i
// src/core/budget.js redan har.
test('B3: budget — ett överdrag ger ett negativt leftOre, inte noll', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 130000, category: 'other' }, { db, now: NOW, makeId: () => 'm1' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 100000, spentOre: 130000, leftOre: -30000 }
  ]);
  // Exakt på taket ger 0, och det är ett positivt noll: formatSek(-0) skriver ett
  // minustecken före noll kronor, så -0 får aldrig nå gränssnittet
  // (LARDOMAR.md 2026-09-02). Asserteras med Object.is och aldrig med
  // assert.equal(resultat, 0), som är sant också för -0.
  setBudget(ANNA, '2026-10', 'other', 130000, { db, now: NOW, makeId: () => 'b2' });
  const exakt = budgetsIn(db, ANNA, '2026-10')[0];
  assert.equal(exakt.leftOre, 0);
  assert.equal(Object.is(exakt.leftOre, -0), false);
  db.close();
});

// (B4) PUT ersätter ett befintligt tak: en rad, inte två. Raden räknas i tabellen
// och inte bara i svaret — ett andra INSERT som läggs bredvid ger samma svar så
// länge SELECT:en råkar ta den nyaste raden först.
test('B4: budget — ett andra tak för samma kategori och månad ersätter det första', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b1' });
  setBudget(ANNA, '2026-10', 'other', 250000, { db, now: NOW, makeId: () => 'b2' });

  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM budgets').get().antal, 1);
  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 250000, spentOre: 0, leftOre: 250000 }
  ]);
  // Samma kategori i en annan månad, och en annan kategori i samma månad, är var
  // sin egen rad.
  setBudget(ANNA, '2026-11', 'other', 300000, { db, now: NOW, makeId: () => 'b3' });
  setBudget(ANNA, '2026-10', 'housing', 900000, { db, now: NOW, makeId: () => 'b4' });
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM budgets').get().antal, 3);
  db.close();
});

// (B5) en kategori utan tak saknas i budgets: listan bär bara satta tak. Månaden
// har utgifter i tre kategorier och tak i en.
test('B5: budget — bara kategorier med ett tak kommer med i listan', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'transport', 200000, { db, now: NOW, makeId: () => 'b1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Buss', amountOre: 95000, category: 'transport' }, { db, now: NOW, makeId: () => 'm1' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' }, { db, now: NOW, makeId: () => 'm2' });
  addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 45000, category: 'other' }, { db, now: NOW, makeId: () => 'm3' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10').map((rad) => rad.category), ['transport']);
  // En månad utan tak alls ger en tom lista, aldrig en rad per kategori.
  assert.deepEqual(budgetsIn(db, ANNA, '2026-09'), []);
  // Ordningen är CATEGORIES ordning och inte den ordning taken skrevs i: med tre
  // tak skrivna baklänges ska listan ändå komma i ägarens ordning.
  setBudget(ANNA, '2026-09', 'other', 100000, { db, now: NOW, makeId: () => 'b2' });
  setBudget(ANNA, '2026-09', 'transport', 200000, { db, now: NOW, makeId: () => 'b3' });
  setBudget(ANNA, '2026-09', 'housing', 900000, { db, now: NOW, makeId: () => 'b4' });
  const ordning = budgetsIn(db, ANNA, '2026-09').map((rad) => rad.category);
  assert.deepEqual(ordning, ['housing', 'transport', 'other']);
  assert.deepEqual(ordning, CATEGORIES.filter((kategori) => ordning.includes(kategori)));
  db.close();
});

// (B6) en annan användares tak syns inte. Berit har ett eget tak i samma månad
// och samma kategori, med ett annat belopp, och en egen utgift — ingetdera får
// synas i Annas månad.
test('B6: budget — en annan användares tak och utgifter syns inte', () => {
  const db = freshDatabase();
  setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b-anna' });
  setBudget(BERIT, '2026-10', 'other', 900000, { db, now: NOW, makeId: () => 'b-berit' });
  setBudget(BERIT, '2026-10', 'housing', 700000, { db, now: NOW, makeId: () => 'b-berit-2' });
  addMonthItem(BERIT, '2026-10', { kind: 'expense', name: 'Hennes tandläkare', amountOre: 55000, category: 'other' }, { db, now: NOW, makeId: () => 'm-berit' });

  assert.deepEqual(budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 100000, spentOre: 0, leftOre: 100000 }
  ]);
  assert.deepEqual(budgetsIn(db, BERIT, '2026-10'), [
    { category: 'housing', amountOre: 700000, spentOre: 0, leftOre: 700000 },
    { category: 'other', amountOre: 900000, spentOre: 55000, leftOre: 845000 }
  ]);
  // Och en borttagning rör bara den egna raden.
  assert.equal(removeBudget(ANNA, '2026-10', 'housing', { db }), false);
  assert.deepEqual(budgetsIn(db, BERIT, '2026-10').map((rad) => rad.category), ['housing', 'other']);
  db.close();
});

// (B7) occurred_on och note sparas och läses, och är null när de inte anges.
// Fälten läses på båda vägarna som ger tillbaka en post — svaret från
// addMonthItem och listan ur readMonth — eftersom de byggs av var sin fråga.
test('B7: budget — occurredOn och note sparas, läses och är null när de inte anges', () => {
  const db = freshDatabase();
  const skapad = addMonthItem(
    ANNA,
    '2026-10',
    { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other', occurredOn: '2026-10-03', note: 'lagning, halva betalt' },
    { db, now: NOW, makeId: () => 'm-med' }
  );
  assert.equal(skapad.occurredOn, '2026-10-03');
  assert.equal(skapad.note, 'lagning, halva betalt');
  // occurredOn är inte dueDate: en engångspost har ingen dragningsdag, och de två
  // fälten bär därför olika värden på samma post.
  assert.equal(skapad.dueDate, null);

  const utan = addMonthItem(
    ANNA,
    '2026-10',
    { kind: 'expense', name: 'Buss', amountOre: 5000, category: 'transport' },
    { db, now: NOW, makeId: () => 'm-utan' }
  );
  assert.equal(utan.occurredOn, null);
  assert.equal(utan.note, null);

  // Samma två värden ur readMonth, som läser med en annan fråga.
  const poster = readMonth(ANNA, '2026-10', { db }).items;
  const medId = poster.find((post) => post.id === 'm-med');
  const utanId = poster.find((post) => post.id === 'm-utan');
  assert.equal(medId.occurredOn, '2026-10-03');
  assert.equal(medId.note, 'lagning, halva betalt');
  assert.equal(utanId.occurredOn, null);
  assert.equal(utanId.note, null);

  // En ändring skriver om båda fälten, och kan tömma dem igen.
  const andrad = updateMonthItem(ANNA, 'm-med', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other', occurredOn: '2026-10-05', note: 'resten betald' }, { db });
  assert.equal(andrad.occurredOn, '2026-10-05');
  assert.equal(andrad.note, 'resten betald');
  const tomd = updateMonthItem(ANNA, 'm-med', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db });
  assert.equal(tomd.occurredOn, null);
  assert.equal(tomd.note, null);

  // En mallpost bär de två fälten som null: båda sorternas poster har exakt samma
  // fält, så gränssnittet kan läsa listan utan att fråga varifrån raden kom.
  insertTemplate(db, { id: 't1', interval: 'monthly', start_date: '2026-10-15', from_month: '2026-10', name: 'Hyra' });
  const mallpost = readMonth(ANNA, '2026-10', { db }).items.find((post) => post.id === 't1');
  assert.equal(mallpost.occurredOn, null);
  assert.equal(mallpost.note, null);
  assert.deepEqual(Object.keys(mallpost).sort(), Object.keys(utanId).sort());
  db.close();
});

// (B8) en för lång kommentar avvisas, med texten ordagrant. Valideringen ägs av
// kärnan och inte av schemat: ett CHECK i tabellen hade gett 500 och "något värde
// är ogiltigt" i stället för fältets egen svenska text och ett 400
// (ARKITEKTUR.md, "Två spärrar i två språk").
//
// Längden mäts i tecken och inte i kodenheter: 101 emoji är 101 tecken men 202
// kodenheter, och ska därför gå igenom (LARDOMAR.md 2026-08-18).
test('B8: budget — en kommentar över 200 tecken avvisas med textens exakta lydelse', () => {
  const texten = 'Kommentaren får vara högst 200 tecken.';
  for (const note of ['a'.repeat(201), '\u{1f600}'.repeat(201), 'a'.repeat(1000000)]) {
    const resultat = validateMonthItemDraft({ kind: 'expense', name: 'Mat', amountSek: '100', category: 'other', note });
    assert.equal(resultat.ok, false, `${[...note].length} tecken`);
    assert.deepEqual(resultat.errors, [{ field: 'note', message: texten }], `${[...note].length} tecken`);
  }
  // Exakt 200 tecken går igenom, i båda mätsätten: 200 emoji är 400 kodenheter.
  for (const note of ['a'.repeat(200), '\u{1f600}'.repeat(200)]) {
    const resultat = validateMonthItemDraft({ kind: 'expense', name: 'Mat', amountSek: '100', category: 'other', note });
    assert.equal(resultat.ok, true, `${[...note].length} tecken`);
    assert.equal([...resultat.value.note].length, 200);
  }
  // Och den avvisade kommentaren når aldrig disken: en post utan giltig
  // kommentar skrivs inte.
  const db = freshDatabase();
  assert.deepEqual(readMonth(ANNA, '2026-10', { db }).items, []);
  db.close();
});

// (B9) en mall får inte de två fälten. Valet: fälten IGNORERAS, de avvisas inte.
// Ett utkast som bär occurredOn och note ger ok: true, och value bär varken
// fältet eller ett fel — skälet står i src/core/item.js över
// validateTemplateDraft och i paketets redovisning.
//
// Det prövas i tre led: valideraren tar inte emot fälten, ett ogiltigt värde i
// dem fäller inte en mall, och en mall som skapas med dem bär dem som null i
// månadens lista (det är tabellen templates som inte har kolumnerna).
test('B9: budget — en mall ignorerar occurredOn och note i stället för att avvisas', () => {
  const utkast = { kind: 'expense', name: 'Hyra', amountSek: '12500', category: 'housing', interval: 'monthly' };

  const med = validateTemplateDraft({ ...utkast, occurredOn: '2026-10-03', note: 'en kommentar' }, '2026-10');
  assert.equal(med.ok, true);
  // Fälten står inte i value: inget av dem kan nå en skrivning mot templates.
  assert.deepEqual(Object.keys(med.value).sort(), ['amountOre', 'category', 'interval', 'kind', 'name', 'toMonth']);
  // Samma value som ett utkast utan de två fälten ger.
  assert.deepEqual(med.value, validateTemplateDraft(utkast, '2026-10').value);

  // Ett värde som månadspostens väg hade avvisat fäller inte en mall: fälten
  // prövas inte, de ignoreras.
  for (const trasigt of [{ occurredOn: 'i\u00e5r' }, { occurredOn: '2026-02-30' }, { note: 'a'.repeat(201) }, { occurredOn: 42, note: 42 }]) {
    const resultat = validateTemplateDraft({ ...utkast, ...trasigt }, '2026-10');
    assert.equal(resultat.ok, true, JSON.stringify(trasigt));
    assert.equal(Object.hasOwn(resultat.value, 'occurredOn'), false, JSON.stringify(trasigt));
    assert.equal(Object.hasOwn(resultat.value, 'note'), false, JSON.stringify(trasigt));
    // Samma utkast genom månadspostens väg avvisas däremot: det är där fälten
    // finns.
    assert.equal(validateMonthItemDraft({ ...utkast, ...trasigt }).ok, false, JSON.stringify(trasigt));
  }

  // Och mallposten i månadens lista bär de två fälten som null, inte som det
  // utkastet råkade skicka.
  const db = freshDatabase();
  addTemplate(ANNA, '2026-10', { ...med.value, occurredOn: '2026-10-03', note: 'en kommentar' }, { db, now: NOW, makeId: () => 't-ny' });
  const mallpost = readMonth(ANNA, '2026-10', { db }).items.find((post) => post.id === 't-ny');
  assert.equal(mallpost.occurredOn, null);
  assert.equal(mallpost.note, null);
  db.close();
});

// Spärrarna för de två nya skrivvägarna: en månad som inte är en månad ska aldrig
// bli en SQL-fråga, och hela meddelandet asserteras — en assert.throws mot enbart
// feltypen kan inte skilja en spärr från en annan (LARDOMAR.md 2026-09-16).
test('B1: budget — setBudget och removeBudget avvisar en månad som inte är en månad', () => {
  const db = freshDatabase();
  for (const month of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    assert.throws(
      () => setBudget(ANNA, month, 'other', 100000, { db, now: NOW, makeId: () => 'b1' }),
      { name: 'RangeError', message: `setBudget kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
    assert.throws(
      () => removeBudget(ANNA, month, 'other', { db }),
      { name: 'RangeError', message: `removeBudget kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  assert.equal(db.prepare('SELECT COUNT(*) AS antal FROM budgets').get().antal, 0);
  db.close();
});