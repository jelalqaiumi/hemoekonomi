import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { REMIND_DAYS_DEFAULT, REMIND_DAYS_MAX, REMIND_DAYS_MIN } from '../src/core/bill.js';
import { INTERVALS } from '../src/core/entry.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addBill, markBillPaid, readBills, removeBill, updateBill } from '../src/server/bills.js';
import { prepare, tableSchema } from './helpers/sql.js';

const NU = '2026-09-25T18:03:00.000Z';
const SENARE = '2026-09-26T09:15:00.000Z';
const IDAG = '2026-09-25';
const ANVANDARE = 'u1';
const ANNAN = 'u2';

async function freshDatabase() {
  const db = await openDatabase(MEMORY_PATH);
  await prepare(db, "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, '', '', ?)").run(ANVANDARE, 'anna@example.se', NU);
  await prepare(db, "INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, '', '', ?)").run(ANNAN, 'berit@example.se', NU);
  return db;
}

function utkast(ändringar = {}) {
  return {
    name: 'Elräkning',
    amountOre: 85000,
    dueDate: '2026-10-15',
    interval: null,
    remindDays: REMIND_DAYS_DEFAULT,
    ...ändringar
  };
}

async function skapa(db, id, ändringar = {}, { userId = ANVANDARE, now = NU } = {}) {
  return await addBill(userId, utkast(ändringar), { db, now, makeId: () => id });
}

test('(R1) de fyra statusvärdena, en rad i tabellen var', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());

  await skapa(db, 'b-betald', { dueDate: '2026-10-15' });
  assert.notEqual(await markBillPaid(ANVANDARE, 'b-betald', IDAG, { db, now: NU }), null);

  await skapa(db, 'b-forfallen', { dueDate: '2026-09-20' });

  await skapa(db, 'b-paminnelse', { dueDate: '2026-09-28', remindDays: 3 });

  await skapa(db, 'b-kommande', { dueDate: '2026-09-29', remindDays: 3 });

  const perId = new Map((await readBills(ANVANDARE, IDAG, { db })).map((bill) => [bill.id, bill]));
  assert.equal(perId.get('b-betald').status, 'betald');
  assert.equal(perId.get('b-forfallen').status, 'forfallen');
  assert.equal(perId.get('b-paminnelse').status, 'paminnelse');
  assert.equal(perId.get('b-kommande').status, 'kommande');

  assert.equal(perId.get('b-forfallen').daysUntil, -5);
  assert.equal(perId.get('b-paminnelse').daysUntil, 3);
  assert.equal(perId.get('b-kommande').daysUntil, 4);
});

test('(R1) en räkning som förfaller idag är paminnelse och inte forfallen', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-idag', { dueDate: IDAG, remindDays: REMIND_DAYS_MIN });
  const [bill] = await readBills(ANVANDARE, IDAG, { db });
  assert.equal(bill.status, 'paminnelse');
  assert.equal(bill.daysUntil, 0);
});

test('(R2) en betald räkning som har förfallit är betald, inte forfallen', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-sen', { dueDate: '2026-09-20' });
  await markBillPaid(ANVANDARE, 'b-sen', '2026-09-22', { db, now: NU });

  const [bill] = await readBills(ANVANDARE, IDAG, { db });
  assert.equal(bill.status, 'betald', 'rad 1 vinner över rad 2');
  assert.equal(bill.paidAt, NU);
  assert.equal(bill.dueDate, '2026-09-20', 'en engångsräkning flyttas inte');
  await skapa(db, 'b-sen-obetald', { dueDate: '2026-09-20' });
  const obetald = (await readBills(ANVANDARE, IDAG, { db })).find((rad) => rad.id === 'b-sen-obetald');
  assert.equal(obetald.status, 'forfallen');
});

test('(R3) en återkommande räkning som betalas får nästa förfallodag och paid_at nollställd', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-el', { dueDate: '2026-10-15', interval: 'monthly' });

  const efter = await markBillPaid(ANVANDARE, 'b-el', '2026-10-15', { db, now: NU });
  assert.equal(efter.dueDate, '2026-11-15');
  assert.equal(efter.paidAt, null);

  const rader = await readBills(ANVANDARE, '2026-10-16', { db });
  assert.equal(rader.length, 1);
  assert.equal(rader[0].id, 'b-el');
  assert.equal(rader[0].dueDate, '2026-11-15');
  assert.equal(rader[0].status, 'kommande');
});

test('(R3) framflyttningen går en period åt gången för de fyra intervallen', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  const förväntat = {
    monthly: '2026-11-15',
    quarterly: '2027-01-15',
    semiannual: '2027-04-15',
    yearly: '2027-10-15'
  };
  for (const interval of INTERVALS) {
    await skapa(db, `b-${interval}`, { dueDate: '2026-10-15', interval });
    const efter = await markBillPaid(ANVANDARE, `b-${interval}`, '2026-10-15', { db, now: NU });
    assert.equal(efter.dueDate, förväntat[interval], interval);
    assert.equal(efter.paidAt, null, interval);
  }
  assert.deepEqual(Object.keys(förväntat).sort(), [...INTERVALS].sort());
});

test('(R3) en betalning långt i efterhand hoppar till den första dragningen framåt', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-sen', { dueDate: '2026-01-15', interval: 'quarterly' });
  const efter = await markBillPaid(ANVANDARE, 'b-sen', '2026-07-20', { db, now: NU });
  assert.equal(efter.dueDate, '2026-10-15');
  assert.equal(efter.paidAt, null);
});

test('(R4) en månadsräkning den 31 januari flyttas till den sista februari', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-2026', { dueDate: '2026-01-31', interval: 'monthly' });
  assert.equal((await markBillPaid(ANVANDARE, 'b-2026', '2026-01-31', { db, now: NU })).dueDate, '2026-02-28');

  await skapa(db, 'b-2028', { dueDate: '2028-01-31', interval: 'monthly' });
  assert.equal((await markBillPaid(ANVANDARE, 'b-2028', '2028-01-31', { db, now: NU })).dueDate, '2028-02-29');
});

test('(R4) klampningen smittar inte vidare: anchor_date bär den ursprungliga dagen', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-31', { dueDate: '2026-01-31', interval: 'monthly' });
  assert.equal((await markBillPaid(ANVANDARE, 'b-31', '2026-01-31', { db, now: NU })).dueDate, '2026-02-28');
  assert.equal((await markBillPaid(ANVANDARE, 'b-31', '2026-02-28', { db, now: NU })).dueDate, '2026-03-31');
  assert.equal((await markBillPaid(ANVANDARE, 'b-31', '2026-03-31', { db, now: NU })).dueDate, '2026-04-30');
  assert.equal((await markBillPaid(ANVANDARE, 'b-31', '2026-04-30', { db, now: NU })).dueDate, '2026-05-31');
});

test('(R5) en engångsräkning som betalas behåller paid_at och faller ur de kommande', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-tand', { dueDate: '2026-10-15', interval: null });
  await skapa(db, 'b-kvar', { dueDate: '2026-10-20', interval: null });

  const efter = await markBillPaid(ANVANDARE, 'b-tand', IDAG, { db, now: NU });
  assert.equal(efter.paidAt, NU);
  assert.equal(efter.dueDate, '2026-10-15', 'en engångsräkning flyttas inte fram');
  assert.equal(efter.interval, null);

  const rader = await readBills(ANVANDARE, IDAG, { db });
  assert.deepEqual(rader.map((rad) => [rad.id, rad.status]), [
    ['b-tand', 'betald'],
    ['b-kvar', 'kommande']
  ]);
  assert.deepEqual(
    rader.filter((rad) => rad.status !== 'betald').map((rad) => rad.id),
    ['b-kvar']
  );
});

test('(R6) sorteringen är due_date, därefter namn i svensk ordning, därefter id', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-9', { dueDate: '2026-10-05', name: 'Zebra' });
  await skapa(db, 'b-4', { dueDate: '2026-10-05', name: 'Ångbåt' });
  await skapa(db, 'b-2', { dueDate: '2026-10-05', name: 'Ångbåt' });
  await skapa(db, 'b-1', { dueDate: '2026-11-01', name: 'Zebra' });

  assert.deepEqual(
    (await readBills(ANVANDARE, IDAG, { db })).map((rad) => [rad.dueDate, rad.name, rad.id]),
    [
      ['2026-10-05', 'Zebra', 'b-9'],
      ['2026-10-05', 'Ångbåt', 'b-2'],
      ['2026-10-05', 'Ångbåt', 'b-4'],
      ['2026-11-01', 'Zebra', 'b-1']
    ]
  );
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true);
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true);
});

test('(R6) kollatorn i bills.js skrivs med språket utsatt i källkoden', async () => {
  const källa = await readFile(new URL('../src/server/bills.js', import.meta.url), 'utf8');
  assert.equal(
    källa.includes("new Intl.Collator('sv')"),
    true,
    'språket ska stå utsatt: i webbläsaren är standardspråket användarens'
  );
  assert.equal(
    /new Intl\.Collator\(\s*\)/.test(källa),
    false,
    'ingen kollator utan språkargument'
  );
  assert.equal(typeof new Intl.Collator().resolvedOptions().locale, 'string');
});

test('(R7) gränsen för paminnelse ligger på remind_days, prövad på båda sidor', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-7', { dueDate: '2026-10-02', remindDays: 7 });
  await skapa(db, 'b-6', { dueDate: '2026-10-02', remindDays: 6 });
  const perId = new Map((await readBills(ANVANDARE, IDAG, { db })).map((rad) => [rad.id, rad]));
  assert.equal(perId.get('b-7').daysUntil, 7);
  assert.equal(perId.get('b-7').status, 'paminnelse');
  assert.equal(perId.get('b-6').daysUntil, 7);
  assert.equal(perId.get('b-6').status, 'kommande');
});

test('(R7) remind_days 0 ger paminnelse på dagen och inte dagen innan', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-noll-idag', { dueDate: IDAG, remindDays: REMIND_DAYS_MIN });
  await skapa(db, 'b-noll-imorgon', { dueDate: '2026-09-26', remindDays: REMIND_DAYS_MIN });
  const perId = new Map((await readBills(ANVANDARE, IDAG, { db })).map((rad) => [rad.id, rad]));
  assert.equal(perId.get('b-noll-idag').status, 'paminnelse');
  assert.equal(perId.get('b-noll-imorgon').status, 'kommande');
});

test('(R7) remind_days 30 är det högsta schemat tar emot', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-30', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX });
  assert.equal((await readBills(ANVANDARE, IDAG, { db }))[0].status, 'paminnelse');
  await assert.rejects(
    async () => await skapa(db, 'b-31', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX + 1 }),
    /Uppgifterna kunde inte sparas/
  );
  await assert.rejects(
    async () => await skapa(db, 'b-minus', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MIN - 1 }),
    /Uppgifterna kunde inte sparas/
  );
});

test('(R8) en annan användares räkningar syns inte och går inte att röra', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-min', { name: 'Min' });
  await skapa(db, 'b-hennes', { name: 'Hennes' }, { userId: ANNAN });

  assert.deepEqual((await readBills(ANVANDARE, IDAG, { db })).map((rad) => rad.id), ['b-min']);
  assert.deepEqual((await readBills(ANNAN, IDAG, { db })).map((rad) => rad.id), ['b-hennes']);

  assert.equal(await updateBill(ANVANDARE, 'b-hennes', utkast({ name: 'Kapad' }), { db }), null);
  assert.equal(await updateBill(ANVANDARE, 'b-finns-inte', utkast(), { db }), null);
  assert.equal(await markBillPaid(ANVANDARE, 'b-hennes', IDAG, { db, now: SENARE }), null);
  assert.equal(await markBillPaid(ANVANDARE, 'b-finns-inte', IDAG, { db, now: SENARE }), null);
  assert.equal(await removeBill(ANVANDARE, 'b-hennes', { db }), false);
  assert.equal(await removeBill(ANVANDARE, 'b-finns-inte', { db }), false);

  const [hennes] = await readBills(ANNAN, IDAG, { db });
  assert.equal(hennes.name, 'Hennes');
  assert.equal(hennes.paidAt, null);
  assert.equal(hennes.dueDate, '2026-10-15');
});

test('(R9) värdelistan i bills interval-CHECK är INTERVALS', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  const schema = tableSchema('bills');
  const lista = (värden) => värden.map((värde) => `'${värde}'`).join(', ');
  assert.equal(
    schema.includes(`interval IS NULL OR interval IN (${lista([...INTERVALS])})`),
    true,
    schema
  );
  assert.equal(
    schema.includes(`remind_days >= ${REMIND_DAYS_MIN} AND remind_days <= ${REMIND_DAYS_MAX}`),
    true,
    schema
  );
  assert.equal(schema.includes(`DEFAULT ${REMIND_DAYS_DEFAULT}`), true, schema);
});

test('(R9) de fyra intervallen och NULL går igenom, allt annat avvisas', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  for (const [index, interval] of [null, ...INTERVALS].entries()) {
    await skapa(db, `b-${index}`, { interval });
  }
  assert.equal(
    (await prepare(db, 'SELECT COUNT(*) AS antal FROM bills').get()).antal,
    INTERVALS.length + 1
  );
  await assert.rejects(async () => await skapa(db, 'b-fel', { interval: 'weekly' }), /Uppgifterna kunde inte sparas/);
});

test('(R9) due_date i fel format och ett belopp som inte är positivt avvisas', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  for (const dueDate of ['2026-2-1', '20261015', '2026-10', '', 'imorgon']) {
    await assert.rejects(
      async () => await skapa(db, `b-${dueDate}`, { dueDate }),
      /Uppgifterna kunde inte sparas/,
      `due_date ${JSON.stringify(dueDate)} skulle ha avvisats`
    );
  }
  for (const amountOre of [0, -1]) {
    await assert.rejects(
      async () => await skapa(db, `b-${amountOre}`, { amountOre }),
      /Uppgifterna kunde inte sparas/,
      `amount_ore ${amountOre} skulle ha avvisats`
    );
  }
});

test('(R9) ett konto som tas bort tar sina räkningar med sig', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-min');
  await skapa(db, 'b-hennes', {}, { userId: ANNAN });
  await prepare(db, 'DELETE FROM users WHERE id = ?').run(ANVANDARE);
  assert.deepEqual(
    (await prepare(db, 'SELECT id FROM bills ORDER BY id').all()).map((rad) => rad.id),
    ['b-hennes']
  );
});

test('addBill skriver de fem fälten och en obetald rad, och svarar med raden på disk', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  const skapad = await skapa(db, 'b-ny', { name: 'Bredband', amountOre: 39900, dueDate: '2026-10-28', interval: 'monthly', remindDays: 5 });
  assert.deepEqual(skapad, {
    id: 'b-ny',
    name: 'Bredband',
    amountOre: 39900,
    dueDate: '2026-10-28',
    interval: 'monthly',
    remindDays: 5,
    paidAt: null
  });
  assert.equal((await prepare(db, 'SELECT created_at FROM bills WHERE id = ?').get('b-ny')).created_at, NU);
});

test('updateBill ändrar de fem fälten och rör aldrig paid_at', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-el', { dueDate: '2026-10-15', interval: null });
  await markBillPaid(ANVANDARE, 'b-el', IDAG, { db, now: NU });

  const ändrad = await updateBill(ANVANDARE, 'b-el', utkast({ name: 'El', amountOre: 99900, dueDate: '2026-11-01', interval: 'quarterly', remindDays: 10 }), { db });
  assert.deepEqual(ändrad, {
    id: 'b-el',
    name: 'El',
    amountOre: 99900,
    dueDate: '2026-11-01',
    interval: 'quarterly',
    remindDays: 10,
    paidAt: NU
  });
});

test('en betald engångsräkning som görs återkommande får paid_at nollställd när den betalas', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-el', { dueDate: '2026-10-15', interval: null });
  assert.equal((await markBillPaid(ANVANDARE, 'b-el', IDAG, { db, now: NU })).paidAt, NU);
  assert.equal((await updateBill(ANVANDARE, 'b-el', utkast({ dueDate: '2026-10-15', interval: 'monthly' }), { db })).paidAt, NU);

  const efter = await markBillPaid(ANVANDARE, 'b-el', '2026-10-15', { db, now: SENARE });
  assert.equal(efter.dueDate, '2026-11-15');
  assert.equal(efter.paidAt, null, 'paid_at ska nollställas när raden flyttas fram');
  assert.equal((await readBills(ANVANDARE, '2026-10-16', { db }))[0].status, 'kommande');
});

test('removeBill tar bort raden och svarar true bara första gången', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-bort');
  assert.equal(await removeBill(ANVANDARE, 'b-bort', { db }), true);
  assert.equal(await removeBill(ANVANDARE, 'b-bort', { db }), false);
  assert.deepEqual(await readBills(ANVANDARE, IDAG, { db }), []);
});

test('readBills och markBillPaid kräver ett dagens datum på formen ÅÅÅÅ-MM-DD', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'b-el');
  for (const today of [undefined, null, '', '2026-13-01', '2026-02-30', '2026-9-25', 42, 1n, Symbol('x'), -0, NaN, {}, [], new Date()]) {
    await assert.rejects(
      async () => await readBills(ANVANDARE, today, { db }),
      /readBills kräver ett dagens datum på formen ÅÅÅÅ-MM-DD/,
      `today ${String(today)} skulle ha avvisats av readBills`
    );
    await assert.rejects(
      async () => await markBillPaid(ANVANDARE, 'b-el', today, { db, now: NU }),
      /markBillPaid kräver ett dagens datum på formen ÅÅÅÅ-MM-DD/,
      `today ${String(today)} skulle ha avvisats av markBillPaid`
    );
  }
  assert.equal((await readBills(ANVANDARE, IDAG, { db }))[0].paidAt, null);
});

test('readBills ger en tom lista för en användare utan räkningar', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  assert.deepEqual(await readBills(ANVANDARE, IDAG, { db }), []);
});
