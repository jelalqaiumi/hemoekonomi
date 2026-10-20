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
import { prepare } from './helpers/sql.js';

const NOW = '2026-09-25T18:03:00.000Z';
const ANNA = 'u-anna';
const BERIT = 'u-berit';

async function freshDatabase() {
  const db = await openDatabase(MEMORY_PATH);
  const insertUser = prepare(db, "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, '', '', ?)");
  await insertUser.run(ANNA, 'anna@example.se', NOW);
  await insertUser.run(BERIT, 'berit@example.se', NOW);
  return db;
}

async function insertTemplate(db, row) {
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
  await prepare(db, `INSERT INTO templates
      (id, user_id, series_id, kind, name, amount_ore, category, interval,
       start_date, from_month, to_month, created_at)
      VALUES (:id, :user_id, :series_id, :kind, :name, :amount_ore, :category,
              :interval, :start_date, :from_month, :to_month, :created_at)`)
    .run(values);
  return values;
}

async function insertMonthItemRow(db, row) {
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
  await prepare(db, `INSERT INTO month_items
      (id, user_id, month, kind, name, amount_ore, category, created_at)
      VALUES (:id, :user_id, :month, :kind, :name, :amount_ore, :category, :created_at)`)
    .run(values);
  return values;
}

async function insertOverrideRow(db, row) {
  await prepare(db, `INSERT INTO overrides
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

async function namesIn(db, userId, month) {
  return (await readMonth(userId, month, { db })).items.map((item) => item.name);
}

test('M1: en engångspost lagd i oktober saknas i september och november', async () => {
  const db = await freshDatabase();
  await insertMonthItemRow(db, { month: '2026-10', name: 'Tandläkare' });

  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Tandläkare']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-09'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);
  db.close();
});

test('M2: en månadsmall syns i tre månader i rad från from_month', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { interval: 'monthly', start_date: '2026-09-15', from_month: '2026-09', name: 'Hyra' });

  for (const month of ['2026-09', '2026-10', '2026-11']) {
    assert.deepEqual(await namesIn(db, ANNA, month), ['Hyra'], month);
  }
  assert.deepEqual(await namesIn(db, ANNA, '2026-08'), []);
  db.close();
});

test('M3: en kvartalsmall syns var tredje månad räknat från start_date', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
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
    assert.deepEqual(await namesIn(db, ANNA, month), names, month);
  }
  assert.equal((await readMonth(ANNA, '2026-04', { db })).items[0].dueDate, '2026-04-30');
  assert.equal((await readMonth(ANNA, '2026-01', { db })).items[0].dueDate, '2026-01-31');
  db.close();
});

test('M4: en halvårsmall syns med sex månader isär', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
    interval: 'semiannual',
    start_date: '2026-03-10',
    from_month: '2026-01',
    name: 'Vägavgift'
  });

  assert.deepEqual(await namesIn(db, ANNA, '2026-03'), ['Vägavgift']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-09'), ['Vägavgift']);
  for (const month of ['2026-04', '2026-05', '2026-06', '2026-07', '2026-08']) {
    assert.deepEqual(await namesIn(db, ANNA, month), [], month);
  }
  db.close();
});

test('M5: månaden efter to_month saknar posten', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
    interval: 'monthly',
    start_date: '2026-01-15',
    from_month: '2026-01',
    to_month: '2026-09',
    name: 'Spotify Family'
  });

  assert.deepEqual(await namesIn(db, ANNA, '2026-09'), ['Spotify Family']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), []);
  db.close();
});

test('M6: en override ändrar beloppet bara i sin månad', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { amount_ore: 19900, name: 'Spotify Family', start_date: '2026-01-15' });
  await insertOverrideRow(db, { month: '2026-10', amount_ore: 24900, skipped: 0 });

  const oktober = (await readMonth(ANNA, '2026-10', { db })).items;
  assert.equal(oktober.length, 1);
  assert.equal(oktober[0].amountOre, 24900);
  assert.equal(oktober[0].overridden, true);

  for (const month of ['2026-09', '2026-11']) {
    const items = (await readMonth(ANNA, month, { db })).items;
    assert.equal(items.length, 1, month);
    assert.equal(items[0].amountOre, 19900, month);
    assert.equal(items[0].overridden, false, month);
  }
  db.close();
});

test('M7: skipped tar bort posten ur sin månad och bara ur den', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { name: 'Gymkort', start_date: '2026-01-15' });
  await insertOverrideRow(db, { month: '2026-10', amount_ore: null, skipped: 1 });

  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-09'), ['Gymkort']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), ['Gymkort']);
  assert.equal((await readMonth(ANNA, '2026-10', { db })).totals.expenseOre, 0);
  db.close();
});

test('M8: två konton, tom lista för det andra', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-anna', user_id: ANNA, name: 'Hyra', start_date: '2026-01-15' });
  await insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10', name: 'Tandläkare' });

  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Hyra', 'Tandläkare']);
  const berit = await readMonth(BERIT, '2026-10', { db });
  assert.deepEqual(berit.items, []);
  assert.deepEqual(berit.totals, { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });
  db.close();
});

test('M9: updateMonthItem mot någon annans id svarar som mot ett okänt id', async () => {
  const db = await freshDatabase();
  await insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10', name: 'Tandläkare', amount_ore: 95000 });

  const draft = { kind: 'expense', name: 'Kapad', amountOre: 100, category: 'other' };
  assert.equal(await updateMonthItem(BERIT, 'm-anna', draft, { db }), null);
  assert.equal(await updateMonthItem(BERIT, 'finns-inte', draft, { db }), null);
  assert.equal(await removeMonthItem(BERIT, 'm-anna', { db }), false);
  assert.equal(await removeMonthItem(BERIT, 'finns-inte', { db }), false);

  const kvar = (await readMonth(ANNA, '2026-10', { db })).items;
  assert.deepEqual(kvar.map((item) => [item.name, item.amountOre]), [['Tandläkare', 95000]]);
  db.close();
});

test('M10: readMonth ger samma summor som monthTotals på dess egna poster', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-lon', kind: 'income', name: 'Lön', amount_ore: 3000000, category: 'other', start_date: '2026-01-25' });
  await insertTemplate(db, { id: 't-hyra', kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', start_date: '2026-01-31' });
  await insertTemplate(db, { id: 't-spar', kind: 'saving', name: 'Buffert', amount_ore: 500000, category: 'other', start_date: '2026-01-05' });
  await insertMonthItemRow(db, { id: 'm-tand', kind: 'expense', name: 'Tandläkare', amount_ore: 95000, month: '2026-10' });

  const { items, totals } = await readMonth(ANNA, '2026-10', { db });
  assert.equal(items.length, 4);
  assert.deepEqual(totals, monthTotals(items));
  assert.deepEqual(totals, {
    incomeOre: 3000000,
    expenseOre: 1345000,
    savingOre: 500000,
    leftOre: 1155000
  });
  db.close();
});

test('posterna sorteras på slag, sedan namn i svensk ordning, sedan id', async () => {
  const db = await freshDatabase();
  await insertMonthItemRow(db, { id: 'm-3', kind: 'saving', name: 'Buffert', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-2', kind: 'expense', name: 'Zebra', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-1', kind: 'expense', name: 'Ångbåt', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-5', kind: 'income', name: 'Lön', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-b', kind: 'expense', name: 'El', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-a', kind: 'expense', name: 'El', month: '2026-10' });

  assert.deepEqual(
    (await readMonth(ANNA, '2026-10', { db })).items.map((item) => [item.kind, item.name, item.id]),
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

test('namnordningen är svensk och skiljer sig från den engelska', async () => {
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true);
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true);

  const db = await freshDatabase();
  await insertMonthItemRow(db, { id: 'm-1', kind: 'expense', name: 'Ångbåt', month: '2026-10' });
  await insertMonthItemRow(db, { id: 'm-2', kind: 'expense', name: 'Zebra', month: '2026-10' });
  const svenska = await namesIn(db, ANNA, '2026-10');
  assert.deepEqual(svenska, ['Zebra', 'Ångbåt']);
  assert.notDeepEqual(svenska, ['Ångbåt', 'Zebra'].sort(new Intl.Collator('en').compare));
  db.close();
});

test('addMonthItem skapar posten och svarar med den', async () => {
  const db = await freshDatabase();
  const skapad = await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-ny' });

  assert.deepEqual(skapad, {
    id: 'm-ny',
    kind: 'expense',
    name: 'Tandläkare',
    amountOre: 95000,
    category: 'other',
    occurredOn: null,
    note: null,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    interval: null,
    toMonth: null
  });
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Tandläkare']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);
  db.close();
});

test('addMonthItem skriver created_at ur now och läser ingen klocka', async () => {
  const db = await freshDatabase();
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-ny' });
  const rows = await prepare(db, 'SELECT created_at FROM month_items WHERE id = ?').all('m-ny');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_at, NOW);
  db.close();
});

test('updateMonthItem ändrar posten och svarar med den', async () => {
  const db = await freshDatabase();
  await insertMonthItemRow(db, { id: 'm-1', month: '2026-10', name: 'Tandläkare', amount_ore: 95000 });

  const ändrad = await updateMonthItem(ANNA, 'm-1', { kind: 'saving', name: 'Tandvård', amountOre: 120000, category: 'other' }, { db });
  assert.equal(ändrad.name, 'Tandvård');
  assert.equal(ändrad.amountOre, 120000);
  assert.equal(ändrad.kind, 'saving');
  assert.deepEqual((await readMonth(ANNA, '2026-10', { db })).totals, {
    incomeOre: 0,
    expenseOre: 0,
    savingOre: 120000,
    leftOre: -120000
  });
  db.close();
});

test('removeMonthItem tar bort posten och svarar true, därefter false', async () => {
  const db = await freshDatabase();
  await insertMonthItemRow(db, { id: 'm-1', month: '2026-10' });

  assert.equal(await removeMonthItem(ANNA, 'm-1', { db }), true);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), []);
  assert.equal(await removeMonthItem(ANNA, 'm-1', { db }), false);
  db.close();
});

test('readMonth avvisar en månad som inte är en månad, före varje fråga', async () => {
  const db = await freshDatabase();
  for (const month of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    await assert.rejects(
      async () => await readMonth(ANNA, month, { db }),
      { name: 'RangeError', message: `firstDayOfMonth kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  db.close();
});

test('addMonthItem avvisar en månad som inte är en månad, före skrivningen', async () => {
  const db = await freshDatabase();
  const draft = { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' };
  for (const month of ['2026-13', '2026-1', '', null, undefined, 202610, 1n, Symbol('x')]) {
    await assert.rejects(
      async () => await addMonthItem(ANNA, month, draft, { db, now: NOW, makeId: () => 'm-ny' }),
      { name: 'RangeError', message: `addMonthItem kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM month_items').all())[0].antal, 0);
  db.close();
});

test('en mall vars start_date ligger efter from_month syns först vid dragningen', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
    interval: 'yearly',
    start_date: '2026-06-30',
    from_month: '2026-01',
    name: 'Domännamn'
  });

  assert.deepEqual(await namesIn(db, ANNA, '2026-01'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-06'), ['Domännamn']);
  assert.deepEqual(await namesIn(db, ANNA, '2027-06'), ['Domännamn']);
  assert.deepEqual(await namesIn(db, ANNA, '2027-05'), []);
  db.close();
});

test('en post ur en mall bär recurring och seriesId, en engångspost inte', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-b', series_id: 't-a', name: 'Spotify Family', start_date: '2026-01-15' });
  await insertMonthItemRow(db, { id: 'm-1', name: 'Tandläkare', month: '2026-10' });

  const items = (await readMonth(ANNA, '2026-10', { db })).items;
  const mall = items.find((item) => item.name === 'Spotify Family');
  const engång = items.find((item) => item.name === 'Tandläkare');
  assert.equal(mall.recurring, true);
  assert.equal(mall.seriesId, 't-a');
  assert.equal(engång.recurring, false);
  assert.equal(engång.seriesId, null);
  assert.deepEqual(Object.keys(mall).sort(), Object.keys(engång).sort());
  db.close();
});

test('(68) posten bär interval och toMonth: mallens värden, och null för en engångspost', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
    id: 't-kvartal',
    name: 'Hemförsäkring',
    interval: 'quarterly',
    start_date: '2026-01-15',
    to_month: '2027-06'
  });
  await insertMonthItemRow(db, { id: 'm-1', name: 'Tandläkare', month: '2026-10' });

  const items = (await readMonth(ANNA, '2026-10', { db })).items;
  const mall = items.find((item) => item.name === 'Hemförsäkring');
  const engång = items.find((item) => item.name === 'Tandläkare');

  assert.equal(mall.interval, 'quarterly');
  assert.equal(mall.toMonth, '2027-06');
  assert.equal(engång.interval, null);
  assert.equal(engång.toMonth, null);
  assert.deepEqual(Object.keys(mall).sort(), Object.keys(engång).sort());
  db.close();
});

test('(68) en mall utan slutmånad ger toMonth null, inte den tomma strängen', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-oandlig', name: 'Hyra', to_month: null, start_date: '2026-01-15' });

  const mall = (await readMonth(ANNA, '2026-10', { db })).items[0];
  assert.equal(mall.toMonth, null);
  assert.equal(mall.interval, 'monthly');
  db.close();
});

const MALLUTKAST = Object.freeze({
  kind: 'expense',
  name: 'Hyra',
  amountOre: 1250000,
  category: 'housing',
  interval: 'monthly',
  toMonth: null
});

async function beloppIn(db, userId, month) {
  return (await readMonth(userId, month, { db })).items.map((item) => [item.name, item.amountOre]);
}

async function templateRows(db, seriesId) {
  return await prepare(db, 'SELECT id, series_id, from_month, to_month, amount_ore, start_date FROM templates WHERE series_id = ? ORDER BY from_month')
    .all(seriesId);
}

test('M11: en mall skapad i oktober syns i oktober, november och december', async () => {
  const db = await freshDatabase();
  const mall = await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' });

  assert.deepEqual(mall, {
    id: 't-ny',
    seriesId: 't-ny',
    kind: 'expense',
    name: 'Hyra',
    amountOre: 1250000,
    category: 'housing',
    interval: 'monthly',
    startDate: '2026-10-01',
    fromMonth: '2026-10',
    toMonth: null
  });
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(await namesIn(db, ANNA, month), ['Hyra'], month);
  }
  assert.deepEqual(await namesIn(db, ANNA, '2026-09'), []);
  db.close();
});

test('M11: toMonth ur utkastet stänger serien, och toMonth null betyder tills vidare', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', { ...MALLUTKAST, name: 'Spotify', toMonth: '2026-11' }, { db, now: NOW, makeId: () => 't-slut' });

  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), ['Spotify']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-12'), []);
  db.close();
});

test('M12: endTemplate från november lämnar oktober orörd och tömmer november', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await endTemplate(ANNA, 't-1', '2026-11', { db }), true);

  assert.deepEqual(await beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-12'), []);
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-1', '2026-10', '2026-10']
  ]);
  db.close();
});

test('M12: endTemplate från seriens egen from_month tar bort versionen', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await endTemplate(ANNA, 't-1', '2026-10', { db }), true);
  assert.deepEqual(await templateRows(db, 't-1'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), []);
  db.close();
});

test('M12: endTemplate mot ett series_id som inte finns svarar false och skriver inget', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await endTemplate(ANNA, 'finns-inte', '2026-11', { db }), false);
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => row.to_month), [null]);
  db.close();
});

test('M13: changeTemplateFrom ger två rader med samma series_id och den gamla avslutad', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  const ny = await changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  assert.equal(ny.id, 't-2');
  assert.equal(ny.seriesId, 't-1');
  assert.equal(ny.fromMonth, '2026-11');
  assert.equal(ny.amountOre, 1300000);
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2026-10', 1250000],
    ['t-2', '2026-11', null, 1300000]
  ]);
  db.close();
});

test('M13: den nya versionen behåller start_date, så kvartalsfasen inte flyttas', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, {
    id: 't-1',
    name: 'Försäkring',
    interval: 'quarterly',
    start_date: '2026-01-20',
    from_month: '2026-01',
    amount_ore: 300000
  });

  const ny = await changeTemplateFrom(ANNA, 't-1', '2026-05', { ...MALLUTKAST, name: 'Försäkring', interval: 'quarterly', amountOre: 350000 }, { db, now: NOW, makeId: () => 't-2' });
  assert.equal(ny.startDate, '2026-01-20');

  assert.deepEqual(await namesIn(db, ANNA, '2026-07'), ['Försäkring']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Försäkring']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-05'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-08'), []);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-07'), [['Försäkring', 350000]]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-04'), [['Försäkring', 300000]]);
  db.close();
});

test('M14: en ändring från november lämnar oktober på gamla beloppet', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  await changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  assert.deepEqual(await beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1300000]]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-12'), [['Hyra', 1300000]]);
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.equal((await readMonth(ANNA, month, { db })).items.length, 1, month);
  }
  db.close();
});

test('M15: en ändring från seriens egen from_month ger en rad, inte två', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  const ändrad = await changeTemplateFrom(ANNA, 't-1', '2026-10', { ...MALLUTKAST, name: 'Hyra ny', amountOre: 1300000, toMonth: '2027-06' }, { db, now: NOW, makeId: () => 't-skulle-inte-skapas' });

  assert.equal(ändrad.id, 't-1');
  assert.equal(ändrad.fromMonth, '2026-10');
  assert.equal(ändrad.toMonth, '2027-06');
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2027-06', 1300000]
  ]);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM templates WHERE id = ?').get('t-skulle-inte-skapas')).antal, 0);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-10'), [['Hyra ny', 1300000]]);
  db.close();
});

test('M15: changeTemplateFrom mot en månad serien inte gäller svarar null och skriver inget', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await changeTemplateFrom(ANNA, 't-1', '2026-09', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' }), null);
  assert.equal(await changeTemplateFrom(ANNA, 'finns-inte', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-3' }), null);
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.to_month]), [['t-1', null]]);
  db.close();
});

test('M16: setOverride ändrar beloppet bara i sin månad', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' }), true);

  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);
  assert.equal((await readMonth(ANNA, '2026-11', { db })).items[0].overridden, true);
  for (const month of ['2026-10', '2026-12']) {
    assert.deepEqual(await beloppIn(db, ANNA, month), [['Hyra', 1250000]], month);
    assert.equal((await readMonth(ANNA, month, { db })).items[0].overridden, false, month);
  }
  db.close();
});

test('M16: ett andra setOverride för samma månad ersätter det första beloppet', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  await setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal(await setOverride(ANNA, 't-1', '2026-11', 111100, { db, now: NOW, makeId: () => 'o-2' }), true);

  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 111100]]);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM overrides').get()).antal, 1);
  db.close();
});

test('M17: skipMonth tömmer sin månad och lämnar grannmånaderna', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  assert.equal(await skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-1' }), true);

  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);
  assert.equal((await readMonth(ANNA, '2026-11', { db })).totals.expenseOre, 0);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Hyra']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-12'), ['Hyra']);
  db.close();
});

test('M17: skipMonth efter setOverride och tvärtom, på samma mall och månad', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  await setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal(await skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-2' }), true);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);

  assert.equal(await setOverride(ANNA, 't-1', '2026-11', 888800, { db, now: NOW, makeId: () => 'o-3' }), true);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 888800]]);
  db.close();
});

test('M18: clearOverride ger mallens belopp tillbaka', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await setOverride(ANNA, 't-1', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);

  assert.equal(await clearOverride(ANNA, 't-1', '2026-11', { db }), true);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  assert.equal((await readMonth(ANNA, '2026-11', { db })).items[0].overridden, false);
  assert.equal(await clearOverride(ANNA, 't-1', '2026-11', { db }), false);
  db.close();
});

test('M18: clearOverride på en överhoppad månad ger posten tillbaka', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await skipMonth(ANNA, 't-1', '2026-11', { db, now: NOW, makeId: () => 'o-1' });

  assert.equal(await clearOverride(ANNA, 't-1', '2026-11', { db }), true);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  db.close();
});

test('M19: en changeTemplateFrom som faller på andra skrivningen lämnar noll ändringar', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });

  await assert.rejects(
    async () => await changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-1' }),
    { name: 'DatabaseError', message: 'Uppgifterna kunde inte sparas: något värde är ogiltigt.' }
  );

  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', null, 1250000]
  ]);
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(await beloppIn(db, ANNA, month), [['Hyra', 1250000]], month);
  }
  db.close();
});

test('M19: endTemplate fullbordar sin transaktion, så ändringen finns efter anropet', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await changeTemplateFrom(ANNA, 't-1', '2026-12', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' });

  assert.equal(await endTemplate(ANNA, 't-1', '2026-11', { db }), true);

  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-1', '2026-10', '2026-10']
  ]);
  assert.deepEqual(await namesIn(db, ANNA, '2026-10'), ['Hyra']);
  assert.deepEqual(await namesIn(db, ANNA, '2026-11'), []);
  assert.deepEqual(await namesIn(db, ANNA, '2026-12'), []);
  db.close();
});

test('M20: Berit når ingen av Annas mallar, och får samma svar som för ett okänt id', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });

  assert.equal(await endTemplate(BERIT, 't-anna', '2026-11', { db }), await endTemplate(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(await endTemplate(BERIT, 't-anna', '2026-11', { db }), false);

  assert.equal(
    await changeTemplateFrom(BERIT, 't-anna', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad' }),
    await changeTemplateFrom(BERIT, 'finns-inte', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad2' })
  );
  assert.equal(await changeTemplateFrom(BERIT, 't-anna', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-kapad3' }), null);

  assert.equal(await setOverride(BERIT, 't-anna', '2026-11', 1, { db, now: NOW, makeId: () => 'o-1' }), await setOverride(BERIT, 'finns-inte', '2026-11', 1, { db, now: NOW, makeId: () => 'o-2' }));
  assert.equal(await setOverride(BERIT, 't-anna', '2026-11', 1, { db, now: NOW, makeId: () => 'o-3' }), false);

  assert.equal(await skipMonth(BERIT, 't-anna', '2026-11', { db, now: NOW, makeId: () => 'o-4' }), await skipMonth(BERIT, 'finns-inte', '2026-11', { db, now: NOW, makeId: () => 'o-5' }));
  assert.equal(await skipMonth(BERIT, 't-anna', '2026-11', { db, now: NOW, makeId: () => 'o-6' }), false);

  assert.equal(await clearOverride(BERIT, 't-anna', '2026-11', { db }), await clearOverride(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(await clearOverride(BERIT, 't-anna', '2026-11', { db }), false);

  assert.deepEqual((await templateRows(db, 't-anna')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-anna', '2026-10', null, 1250000]
  ]);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM overrides').get()).antal, 0);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM templates').get()).antal, 1);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  assert.deepEqual(await namesIn(db, BERIT, '2026-11'), []);
  db.close();
});

test('M20: endTemplate mot någon annans framtida version tar inte bort den', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });

  assert.equal(await endTemplate(BERIT, 't-anna', '2026-11', { db }), await endTemplate(BERIT, 'finns-inte', '2026-11', { db }));
  assert.equal(await endTemplate(BERIT, 't-anna', '2026-11', { db }), false);
  assert.deepEqual((await templateRows(db, 't-anna')).map((row) => [row.id, row.from_month, row.to_month]), [
    ['t-anna', '2026-11', null]
  ]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1250000]]);
  db.close();
});

test('M20: clearOverride mot någon annans mall lämnar avvikelsen kvar', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-anna' });
  await setOverride(ANNA, 't-anna', '2026-11', 999900, { db, now: NOW, makeId: () => 'o-anna' });

  assert.equal(await clearOverride(BERIT, 't-anna', '2026-11', { db }), false);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 999900]]);
  db.close();
});

test('de sex nya funktionerna avvisar en månad som inte är en månad, före skrivningen', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-1', from_month: '2026-01', start_date: '2026-01-15' });
  const fel = ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')];
  const anrop = [
    ['addTemplate', async (month) => await addTemplate(ANNA, month, MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' })],
    ['endTemplate', async (month) => await endTemplate(ANNA, 't-1', month, { db })],
    ['changeTemplateFrom', async (month) => await changeTemplateFrom(ANNA, 't-1', month, MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' })],
    ['setOverride', async (month) => await setOverride(ANNA, 't-1', month, 100, { db, now: NOW, makeId: () => 'o-ny' })],
    ['skipMonth', async (month) => await skipMonth(ANNA, 't-1', month, { db, now: NOW, makeId: () => 'o-ny' })],
    ['clearOverride', async (month) => await clearOverride(ANNA, 't-1', month, { db })]
  ];

  for (const [namn, kör] of anrop) {
    for (const month of fel) {
      await assert.rejects(
        () => kör(month),
        { name: 'RangeError', message: `${namn} kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
        `${namn} ${String(month)}`
      );
    }
  }

  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM templates').get()).antal, 1);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM overrides').get()).antal, 0);
  assert.equal((await prepare(db, 'SELECT to_month FROM templates WHERE id = ?').get('t-1')).to_month, null);
  db.close();
});

test('addTemplate skriver created_at ur now och läser ingen klocka', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-ny' });
  const rows = await prepare(db, 'SELECT created_at FROM templates WHERE id = ?').all('t-ny');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].created_at, NOW);
  db.close();
});

test('changeTemplateFrom tar bort en framtida version, så ingen månad får två poster', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await changeTemplateFrom(ANNA, 't-1', '2026-12', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });
  assert.equal((await templateRows(db, 't-1')).length, 2);

  await changeTemplateFrom(ANNA, 't-1', '2026-11', { ...MALLUTKAST, amountOre: 1400000 }, { db, now: NOW, makeId: () => 't-3' });

  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', '2026-10', 1250000],
    ['t-3', '2026-11', null, 1400000]
  ]);
  for (const month of ['2026-10', '2026-11', '2026-12', '2027-01']) {
    assert.equal((await readMonth(ANNA, month, { db })).items.length, 1, month);
  }
  assert.deepEqual(await beloppIn(db, ANNA, '2026-10'), [['Hyra', 1250000]]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-11'), [['Hyra', 1400000]]);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-12'), [['Hyra', 1400000]]);
  db.close();
});

test('changeTemplateFrom från egen from_month tar bort framtida versioner men behåller sin egen rad', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await changeTemplateFrom(ANNA, 't-1', '2026-12', { ...MALLUTKAST, amountOre: 1300000 }, { db, now: NOW, makeId: () => 't-2' });

  const ändrad = await changeTemplateFrom(ANNA, 't-1', '2026-10', { ...MALLUTKAST, amountOre: 1500000 }, { db, now: NOW, makeId: () => 't-4' });

  assert.equal(ändrad.id, 't-1');
  assert.deepEqual((await templateRows(db, 't-1')).map((row) => [row.id, row.from_month, row.to_month, row.amount_ore]), [
    ['t-1', '2026-10', null, 1500000]
  ]);
  for (const month of ['2026-10', '2026-11', '2026-12']) {
    assert.deepEqual(await beloppIn(db, ANNA, month), [['Hyra', 1500000]], month);
  }
  db.close();
});

test('en avvikelse på en borttagen framtida version försvinner med den', async () => {
  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', MALLUTKAST, { db, now: NOW, makeId: () => 't-1' });
  await changeTemplateFrom(ANNA, 't-1', '2026-12', MALLUTKAST, { db, now: NOW, makeId: () => 't-2' });
  await setOverride(ANNA, 't-2', '2026-12', 999900, { db, now: NOW, makeId: () => 'o-1' });
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM overrides').get()).antal, 1);

  await changeTemplateFrom(ANNA, 't-1', '2026-11', MALLUTKAST, { db, now: NOW, makeId: () => 't-3' });

  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM overrides').get()).antal, 0);
  assert.deepEqual(await beloppIn(db, ANNA, '2026-12'), [['Hyra', 1250000]]);
  db.close();
});

async function insertYear(db, userId = ANNA) {
  await insertTemplate(db, { id: `${userId}-lon`, user_id: userId, kind: 'income', name: 'Lön', amount_ore: 3000000, category: 'other', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
  await insertTemplate(db, { id: `${userId}-hyra`, user_id: userId, kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
  await insertTemplate(db, { id: `${userId}-buffert`, user_id: userId, kind: 'saving', name: 'Buffert', amount_ore: 200000, category: 'savings', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });
}

test('M26: readOverview ger tolv månader, äldst först, med endMonth sist', async () => {
  const db = await freshDatabase();
  await insertYear(db);

  const översikt = await readOverview(ANNA, '2026-10', 12, { db });

  assert.equal(översikt.months.length, 12);
  assert.deepEqual(översikt.months.map((rad) => rad.month), [
    '2025-11', '2025-12', '2026-01', '2026-02', '2026-03', '2026-04',
    '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10'
  ]);
  assert.equal(översikt.months[11].month, '2026-10');
  assert.equal(översikt.months[0].month, '2025-11');
  db.close();
});

test('M27: varje rad i översikten bär exakt de tal readMonth ger för månaden', async () => {
  const db = await freshDatabase();
  await insertYear(db);
  await insertMonthItemRow(db, { id: 'm-tand', month: '2026-08', kind: 'expense', name: 'Tandläkare', amount_ore: 95000, category: 'other' });
  await insertOverrideRow(db, { id: 'o-hyra', template_id: `${ANNA}-hyra`, month: '2026-09', amount_ore: 1300000, skipped: 0 });

  const översikt = await readOverview(ANNA, '2026-10', 12, { db });

  for (const rad of översikt.months) {
    const totals = monthTotals((await readMonth(ANNA, rad.month, { db })).items);
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      totals,
      rad.month
    );
  }
  assert.equal(översikt.months.find((rad) => rad.month === '2026-08').expenseOre, 1250000 + 95000);
  assert.equal(översikt.months.find((rad) => rad.month === '2026-09').expenseOre, 1300000);
  db.close();
});

test('M28: savedThisYear räknar bara innevarande år, också över ett årsskifte', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-2025', kind: 'saving', name: 'Buffert 2025', amount_ore: 500000, category: 'savings', interval: 'monthly', start_date: '2025-01-01', from_month: '2025-01', to_month: '2025-12' });
  await insertTemplate(db, { id: 't-2026', kind: 'saving', name: 'Buffert 2026', amount_ore: 200000, category: 'savings', interval: 'monthly', start_date: '2026-01-01', from_month: '2026-01' });

  const översikt = await readOverview(ANNA, '2026-03', 12, { db });

  assert.equal(översikt.months[0].month, '2025-04');
  assert.equal(översikt.months[0].savingOre, 500000);
  assert.equal(översikt.savedThisYear, 3 * 200000);

  assert.equal((await readOverview(ANNA, '2026-03', 2, { db })).savedThisYear, 3 * 200000);
  assert.equal((await readOverview(ANNA, '2026-01', 12, { db })).savedThisYear, 200000);
  assert.equal((await readOverview(ANNA, '2026-12', 12, { db })).savedThisYear, 12 * 200000);
  db.close();
});

test('M29: en månad utan poster står med i serien, med fyra nollor', async () => {
  const db = await freshDatabase();
  await insertTemplate(db, { id: 't-kort', kind: 'expense', name: 'Hyra', amount_ore: 1250000, category: 'housing', interval: 'monthly', start_date: '2026-09-01', from_month: '2026-09' });

  const översikt = await readOverview(ANNA, '2026-10', 12, { db });

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
  assert.equal(översikt.months[10].expenseOre, 1250000);
  assert.equal(översikt.months[11].expenseOre, 1250000);
  db.close();
});

test('M30: readOverview för Berit ger tomma månader fastän Anna har poster', async () => {
  const db = await freshDatabase();
  await insertYear(db, ANNA);
  await insertMonthItemRow(db, { id: 'm-anna', user_id: ANNA, month: '2026-10' });

  const annas = await readOverview(ANNA, '2026-10', 12, { db });
  const berits = await readOverview(BERIT, '2026-10', 12, { db });

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

test('M31: readOverview avvisar en endMonth som inte är en månad, före varje fråga', async () => {
  const db = await freshDatabase();
  await insertYear(db);
  for (const endMonth of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    await assert.rejects(
      async () => await readOverview(ANNA, endMonth, 12, { db }),
      { name: 'RangeError', message: `readOverview kräver en månad på formen ÅÅÅÅ-MM, fick "${String(endMonth)}".` },
      String(endMonth)
    );
  }
  db.close();
});

test('M31: readOverview avvisar ett antal månader utanför 1 till 36', async () => {
  const db = await freshDatabase();
  await insertYear(db);
  for (const count of [0, -1, 37, 10000, 1e9, 12.5, NaN, Infinity, -Infinity, '12', null, undefined, true, 1n, Symbol('x'), {}]) {
    await assert.rejects(
      async () => await readOverview(ANNA, '2026-10', count, { db }),
      { name: 'RangeError', message: `readOverview kräver ett antal månader mellan 1 och 36, fick "${String(count)}".` },
      String(count)
    );
  }
  assert.equal((await readOverview(ANNA, '2026-10', 1, { db })).months.length, 1);
  assert.equal((await readOverview(ANNA, '2026-10', 1, { db })).months[0].month, '2026-10');
  assert.equal((await readOverview(ANNA, '2026-10', 36, { db })).months.length, 36);
  assert.equal((await readOverview(ANNA, '2026-10', 36, { db })).months[0].month, '2023-11');
  db.close();
});


async function budgetsIn(db, userId, month) {
  return (await readMonth(userId, month, { db })).budgets;
}

test('B1: budget — ett tak satt i oktober saknas i september och november', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'housing', 900000, { db, now: NOW, makeId: () => 'b1' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 900000, spentOre: 0, leftOre: 900000 }
  ]);
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-09'), []);
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-11'), []);
  db.close();
});

test('B2: budget — en inkomst och ett sparande i samma kategori påverkar inte spentOre', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'other', 500000, { db, now: NOW, makeId: () => 'b1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm-utgift' });
  await addMonthItem(ANNA, '2026-10', { kind: 'income', name: 'Såld cykel', amountOre: 2100000, category: 'other' }, { db, now: NOW, makeId: () => 'm-inkomst' });
  await addMonthItem(ANNA, '2026-10', { kind: 'saving', name: 'Buffert', amountOre: 345000, category: 'other' }, { db, now: NOW, makeId: () => 'm-sparande' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 500000, spentOre: 95000, leftOre: 405000 }
  ]);
  const totals = (await readMonth(ANNA, '2026-10', { db })).totals;
  assert.equal(totals.incomeOre, 2100000);
  assert.equal(totals.savingOre, 345000);
  assert.equal(totals.expenseOre, 95000);
  db.close();
});

test('B2: budget — en utgift i en annan kategori påverkar inte takets spentOre', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'other', 500000, { db, now: NOW, makeId: () => 'b1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db, now: NOW, makeId: () => 'm1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' }, { db, now: NOW, makeId: () => 'm2' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 500000, spentOre: 95000, leftOre: 405000 }
  ]);
  db.close();
});

test('B2: budget — en mallpost räknas in i spentOre, med månadens avvikelsebelopp', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'housing', 1500000, { db, now: NOW, makeId: () => 'b1' });
  await insertTemplate(db, { id: 't1', interval: 'monthly', start_date: '2026-09-15', from_month: '2026-09', name: 'Hyra', amount_ore: 1250000, category: 'housing' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 1250000, leftOre: 250000 }
  ]);
  await setOverride(ANNA, 't1', '2026-10', 1400000, { db, now: NOW, makeId: () => 'o1' });
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 1400000, leftOre: 100000 }
  ]);
  await skipMonth(ANNA, 't1', '2026-10', { db, now: NOW, makeId: () => 'o2' });
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'housing', amountOre: 1500000, spentOre: 0, leftOre: 1500000 }
  ]);
  db.close();
});

test('B3: budget — ett överdrag ger ett negativt leftOre, inte noll', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 130000, category: 'other' }, { db, now: NOW, makeId: () => 'm1' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 100000, spentOre: 130000, leftOre: -30000 }
  ]);
  await setBudget(ANNA, '2026-10', 'other', 130000, { db, now: NOW, makeId: () => 'b2' });
  const exakt = (await budgetsIn(db, ANNA, '2026-10'))[0];
  assert.equal(exakt.leftOre, 0);
  assert.equal(Object.is(exakt.leftOre, -0), false);
  db.close();
});

test('B4: budget — ett andra tak för samma kategori och månad ersätter det första', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b1' });
  await setBudget(ANNA, '2026-10', 'other', 250000, { db, now: NOW, makeId: () => 'b2' });

  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM budgets').get()).antal, 1);
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 250000, spentOre: 0, leftOre: 250000 }
  ]);
  await setBudget(ANNA, '2026-11', 'other', 300000, { db, now: NOW, makeId: () => 'b3' });
  await setBudget(ANNA, '2026-10', 'housing', 900000, { db, now: NOW, makeId: () => 'b4' });
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM budgets').get()).antal, 3);
  db.close();
});

test('B5: budget — bara kategorier med ett tak kommer med i listan', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'transport', 200000, { db, now: NOW, makeId: () => 'b1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Buss', amountOre: 95000, category: 'transport' }, { db, now: NOW, makeId: () => 'm1' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Hyra', amountOre: 1250000, category: 'housing' }, { db, now: NOW, makeId: () => 'm2' });
  await addMonthItem(ANNA, '2026-10', { kind: 'expense', name: 'Tandläkare', amountOre: 45000, category: 'other' }, { db, now: NOW, makeId: () => 'm3' });

  assert.deepEqual((await budgetsIn(db, ANNA, '2026-10')).map((rad) => rad.category), ['transport']);
  assert.deepEqual(await budgetsIn(db, ANNA, '2026-09'), []);
  await setBudget(ANNA, '2026-09', 'other', 100000, { db, now: NOW, makeId: () => 'b2' });
  await setBudget(ANNA, '2026-09', 'transport', 200000, { db, now: NOW, makeId: () => 'b3' });
  await setBudget(ANNA, '2026-09', 'housing', 900000, { db, now: NOW, makeId: () => 'b4' });
  const ordning = (await budgetsIn(db, ANNA, '2026-09')).map((rad) => rad.category);
  assert.deepEqual(ordning, ['housing', 'transport', 'other']);
  assert.deepEqual(ordning, CATEGORIES.filter((kategori) => ordning.includes(kategori)));
  db.close();
});

test('B6: budget — en annan användares tak och utgifter syns inte', async () => {
  const db = await freshDatabase();
  await setBudget(ANNA, '2026-10', 'other', 100000, { db, now: NOW, makeId: () => 'b-anna' });
  await setBudget(BERIT, '2026-10', 'other', 900000, { db, now: NOW, makeId: () => 'b-berit' });
  await setBudget(BERIT, '2026-10', 'housing', 700000, { db, now: NOW, makeId: () => 'b-berit-2' });
  await addMonthItem(BERIT, '2026-10', { kind: 'expense', name: 'Hennes tandläkare', amountOre: 55000, category: 'other' }, { db, now: NOW, makeId: () => 'm-berit' });

  assert.deepEqual(await budgetsIn(db, ANNA, '2026-10'), [
    { category: 'other', amountOre: 100000, spentOre: 0, leftOre: 100000 }
  ]);
  assert.deepEqual(await budgetsIn(db, BERIT, '2026-10'), [
    { category: 'housing', amountOre: 700000, spentOre: 0, leftOre: 700000 },
    { category: 'other', amountOre: 900000, spentOre: 55000, leftOre: 845000 }
  ]);
  assert.equal(await removeBudget(ANNA, '2026-10', 'housing', { db }), false);
  assert.deepEqual((await budgetsIn(db, BERIT, '2026-10')).map((rad) => rad.category), ['housing', 'other']);
  db.close();
});

test('B7: budget — occurredOn och note sparas, läses och är null när de inte anges', async () => {
  const db = await freshDatabase();
  const skapad = await addMonthItem(
    ANNA,
    '2026-10',
    { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other', occurredOn: '2026-10-03', note: 'lagning, halva betalt' },
    { db, now: NOW, makeId: () => 'm-med' }
  );
  assert.equal(skapad.occurredOn, '2026-10-03');
  assert.equal(skapad.note, 'lagning, halva betalt');
  assert.equal(skapad.dueDate, null);

  const utan = await addMonthItem(
    ANNA,
    '2026-10',
    { kind: 'expense', name: 'Buss', amountOre: 5000, category: 'transport' },
    { db, now: NOW, makeId: () => 'm-utan' }
  );
  assert.equal(utan.occurredOn, null);
  assert.equal(utan.note, null);

  const poster = (await readMonth(ANNA, '2026-10', { db })).items;
  const medId = poster.find((post) => post.id === 'm-med');
  const utanId = poster.find((post) => post.id === 'm-utan');
  assert.equal(medId.occurredOn, '2026-10-03');
  assert.equal(medId.note, 'lagning, halva betalt');
  assert.equal(utanId.occurredOn, null);
  assert.equal(utanId.note, null);

  const andrad = await updateMonthItem(ANNA, 'm-med', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other', occurredOn: '2026-10-05', note: 'resten betald' }, { db });
  assert.equal(andrad.occurredOn, '2026-10-05');
  assert.equal(andrad.note, 'resten betald');
  const tomd = await updateMonthItem(ANNA, 'm-med', { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, { db });
  assert.equal(tomd.occurredOn, null);
  assert.equal(tomd.note, null);

  await insertTemplate(db, { id: 't1', interval: 'monthly', start_date: '2026-10-15', from_month: '2026-10', name: 'Hyra' });
  const mallpost = (await readMonth(ANNA, '2026-10', { db })).items.find((post) => post.id === 't1');
  assert.equal(mallpost.occurredOn, null);
  assert.equal(mallpost.note, null);
  assert.deepEqual(Object.keys(mallpost).sort(), Object.keys(utanId).sort());
  db.close();
});

test('B8: budget — en kommentar över 200 tecken avvisas med textens exakta lydelse', async () => {
  const texten = 'Kommentaren får vara högst 200 tecken.';
  for (const note of ['a'.repeat(201), '\u{1f600}'.repeat(201), 'a'.repeat(1000000)]) {
    const resultat = validateMonthItemDraft({ kind: 'expense', name: 'Mat', amountSek: '100', category: 'other', note });
    assert.equal(resultat.ok, false, `${[...note].length} tecken`);
    assert.deepEqual(resultat.errors, [{ field: 'note', message: texten }], `${[...note].length} tecken`);
  }
  for (const note of ['a'.repeat(200), '\u{1f600}'.repeat(200)]) {
    const resultat = validateMonthItemDraft({ kind: 'expense', name: 'Mat', amountSek: '100', category: 'other', note });
    assert.equal(resultat.ok, true, `${[...note].length} tecken`);
    assert.equal([...resultat.value.note].length, 200);
  }
  const db = await freshDatabase();
  assert.deepEqual((await readMonth(ANNA, '2026-10', { db })).items, []);
  db.close();
});

test('B9: budget — en mall ignorerar occurredOn och note i stället för att avvisas', async () => {
  const utkast = { kind: 'expense', name: 'Hyra', amountSek: '12500', category: 'housing', interval: 'monthly' };

  const med = validateTemplateDraft({ ...utkast, occurredOn: '2026-10-03', note: 'en kommentar' }, '2026-10');
  assert.equal(med.ok, true);
  assert.deepEqual(Object.keys(med.value).sort(), ['amountOre', 'category', 'interval', 'kind', 'name', 'toMonth']);
  assert.deepEqual(med.value, validateTemplateDraft(utkast, '2026-10').value);

  for (const trasigt of [{ occurredOn: 'i\u00e5r' }, { occurredOn: '2026-02-30' }, { note: 'a'.repeat(201) }, { occurredOn: 42, note: 42 }]) {
    const resultat = validateTemplateDraft({ ...utkast, ...trasigt }, '2026-10');
    assert.equal(resultat.ok, true, JSON.stringify(trasigt));
    assert.equal(Object.hasOwn(resultat.value, 'occurredOn'), false, JSON.stringify(trasigt));
    assert.equal(Object.hasOwn(resultat.value, 'note'), false, JSON.stringify(trasigt));
    assert.equal(validateMonthItemDraft({ ...utkast, ...trasigt }).ok, false, JSON.stringify(trasigt));
  }

  const db = await freshDatabase();
  await addTemplate(ANNA, '2026-10', { ...med.value, occurredOn: '2026-10-03', note: 'en kommentar' }, { db, now: NOW, makeId: () => 't-ny' });
  const mallpost = (await readMonth(ANNA, '2026-10', { db })).items.find((post) => post.id === 't-ny');
  assert.equal(mallpost.occurredOn, null);
  assert.equal(mallpost.note, null);
  db.close();
});

test('B1: budget — setBudget och removeBudget avvisar en månad som inte är en månad', async () => {
  const db = await freshDatabase();
  for (const month of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    await assert.rejects(
      async () => await setBudget(ANNA, month, 'other', 100000, { db, now: NOW, makeId: () => 'b1' }),
      { name: 'RangeError', message: `setBudget kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
    await assert.rejects(
      async () => await removeBudget(ANNA, month, 'other', { db }),
      { name: 'RangeError', message: `removeBudget kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS antal FROM budgets').get()).antal, 0);
  db.close();
});