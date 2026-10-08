// Datalagret för räkningarna, src/server/bills.js, plus tabellen bills i
// src/server/db.js [steg 3]. Kravlistan (R1) till (R9) i ARKITEKTUR.md under
// "Kravlista [steg 3]".
//
// Varje testfall öppnar sin egen databas i minnet, så att inget fall kan se en
// rad ett annat fall skrev. DatabaseSync är synkron: ingen rad här har await.
//
// Ingen klocka läses: varje today och varje now står som en literal.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { REMIND_DAYS_DEFAULT, REMIND_DAYS_MAX, REMIND_DAYS_MIN } from '../src/core/bill.js';
import { INTERVALS } from '../src/core/entry.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addBill, markBillPaid, readBills, removeBill, updateBill } from '../src/server/bills.js';

const NU = '2026-09-25T18:03:00.000Z';
const SENARE = '2026-09-26T09:15:00.000Z';
const IDAG = '2026-09-25';
const ANVANDARE = 'u1';
const ANNAN = 'u2';

// En databas med två konton, så att varje fall kan pröva att den andres
// räkningar inte syns utan att först bygga upp sitt eget utgångsläge.
function freshDatabase() {
  const db = openDatabase(MEMORY_PATH);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(ANVANDARE, 'anna@example.se', NU);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(ANNAN, 'berit@example.se', NU);
  return db;
}

// Ett utkast med alla fem fälten giltiga, på den form validateBillDraft svarar
// med: amountOre och inte kronor. Varje testfall byter ut de fält fallet gäller.
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

// Lägger till en räkning med ett förutsägbart id, så att assertionerna kan
// namnge raden i stället för att leta upp den.
function skapa(db, id, ändringar = {}, { userId = ANVANDARE, now = NU } = {}) {
  return addBill(userId, utkast(ändringar), { db, now, makeId: () => id });
}

// ---------------------------------------------------------------------------
// (R1) De fyra statusvärdena: ett fall per rad i tabellen, i rätt ordning.
// ---------------------------------------------------------------------------

test('(R1) de fyra statusvärdena, en rad i tabellen var', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());

  // Rad 1: paid_at är satt. En engångsräkning som betalas behåller sitt
  // due_date, så raden ligger kvar och är betald.
  skapa(db, 'b-betald', { dueDate: '2026-10-15' });
  assert.notEqual(markBillPaid(ANVANDARE, 'b-betald', IDAG, { db, now: NU }), null);

  // Rad 2: due_date ligger före today.
  skapa(db, 'b-forfallen', { dueDate: '2026-09-20' });

  // Rad 3: daysUntil <= remind_days. Tre dagar kvar, påminn tre dagar innan.
  skapa(db, 'b-paminnelse', { dueDate: '2026-09-28', remindDays: 3 });

  // Rad 4: annars. Fyra dagar kvar, påminn tre dagar innan.
  skapa(db, 'b-kommande', { dueDate: '2026-09-29', remindDays: 3 });

  const perId = new Map(readBills(ANVANDARE, IDAG, { db }).map((bill) => [bill.id, bill]));
  assert.equal(perId.get('b-betald').status, 'betald');
  assert.equal(perId.get('b-forfallen').status, 'forfallen');
  assert.equal(perId.get('b-paminnelse').status, 'paminnelse');
  assert.equal(perId.get('b-kommande').status, 'kommande');

  // daysUntil räknas med daysBetween och är negativt för den som förfallit.
  assert.equal(perId.get('b-forfallen').daysUntil, -5);
  assert.equal(perId.get('b-paminnelse').daysUntil, 3);
  assert.equal(perId.get('b-kommande').daysUntil, 4);
});

test('(R1) en räkning som förfaller idag är paminnelse och inte forfallen', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Rad 2 är "före today", inte "today eller före": en räkning som förfaller i
  // dag är inte försenad. Mutationen compareIsoDates(...) < 0 -> <= 0 fälls av
  // den här raden.
  skapa(db, 'b-idag', { dueDate: IDAG, remindDays: REMIND_DAYS_MIN });
  const [bill] = readBills(ANVANDARE, IDAG, { db });
  assert.equal(bill.status, 'paminnelse');
  assert.equal(bill.daysUntil, 0);
});

// ---------------------------------------------------------------------------
// (R2) betald vinner över forfallen.
// ---------------------------------------------------------------------------

test('(R2) en betald räkning som har förfallit är betald, inte forfallen', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Räkningen förföll 2026-09-20 och betalades. Läst 2026-09-25 är rad 2 i
  // tabellen sann — due_date ligger före today — men rad 1 står före den.
  skapa(db, 'b-sen', { dueDate: '2026-09-20' });
  markBillPaid(ANVANDARE, 'b-sen', '2026-09-22', { db, now: NU });

  const [bill] = readBills(ANVANDARE, IDAG, { db });
  assert.equal(bill.status, 'betald', 'rad 1 vinner över rad 2');
  assert.equal(bill.paidAt, NU);
  assert.equal(bill.dueDate, '2026-09-20', 'en engångsräkning flyttas inte');
  // Samma räkning utan paid_at ger den andra raden i tabellen. Utan den här
  // jämförelsen prövar fallet ovan inte ordningen, bara att betald finns.
  skapa(db, 'b-sen-obetald', { dueDate: '2026-09-20' });
  const obetald = readBills(ANVANDARE, IDAG, { db }).find((rad) => rad.id === 'b-sen-obetald');
  assert.equal(obetald.status, 'forfallen');
});

// ---------------------------------------------------------------------------
// (R3) En återkommande räkning flyttas fram.
// ---------------------------------------------------------------------------

test('(R3) en återkommande räkning som betalas får nästa förfallodag och paid_at nollställd', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-el', { dueDate: '2026-10-15', interval: 'monthly' });

  const efter = markBillPaid(ANVANDARE, 'b-el', '2026-10-15', { db, now: NU });
  assert.equal(efter.dueDate, '2026-11-15');
  assert.equal(efter.paidAt, null);

  // Raden på disk är densamma: en enda rad, den nästa obetalda. Ingen historik.
  const rader = readBills(ANVANDARE, '2026-10-16', { db });
  assert.equal(rader.length, 1);
  assert.equal(rader[0].id, 'b-el');
  assert.equal(rader[0].dueDate, '2026-11-15');
  assert.equal(rader[0].status, 'kommande');
});

test('(R3) framflyttningen går en period åt gången för de fyra intervallen', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  const förväntat = {
    monthly: '2026-11-15',
    quarterly: '2027-01-15',
    semiannual: '2027-04-15',
    yearly: '2027-10-15'
  };
  // Listan kommer ur INTERVALS och skrivs inte av: mutationen "lägg till ett
  // värde i INTERVALS" ska fälla ett test, och med en handskriven kopia fäller
  // den inget (samma skäl som tests/db.test.js har för ITEM_KINDS).
  for (const interval of INTERVALS) {
    skapa(db, `b-${interval}`, { dueDate: '2026-10-15', interval });
    const efter = markBillPaid(ANVANDARE, `b-${interval}`, '2026-10-15', { db, now: NU });
    assert.equal(efter.dueDate, förväntat[interval], interval);
    assert.equal(efter.paidAt, null, interval);
  }
  assert.deepEqual(Object.keys(förväntat).sort(), [...INTERVALS].sort());
});

test('(R3) en betalning långt i efterhand hoppar till den första dragningen framåt', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Kvartalsräkningen förföll 2026-01-15 och betalas 2026-07-20. Ett enda steg
  // framåt hade gett 2026-04-15, alltså en förfallodag som redan har passerat
  // och som användaren aldrig kommer att betala. Det är nextDueDate:s hopp över
  // flera perioder som ger svaret.
  //
  // Fallet bär två mutationer:
  //   nextBillDueDate: from = compare > 0 ? today : afterPaid -> afterPaid
  //   nextBillDueDate: return nextDueDate(series, from) -> return from
  // Båda ger EXIT=1 och faller här; redovisat i paketet.
  skapa(db, 'b-sen', { dueDate: '2026-01-15', interval: 'quarterly' });
  const efter = markBillPaid(ANVANDARE, 'b-sen', '2026-07-20', { db, now: NU });
  assert.equal(efter.dueDate, '2026-10-15');
  assert.equal(efter.paidAt, null);
});

// ---------------------------------------------------------------------------
// (R4) Klampningen följer med.
// ---------------------------------------------------------------------------

test('(R4) en månadsräkning den 31 januari flyttas till den sista februari', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // 2026 är inget skottår: februari har 28 dagar. Klampningen ägs av
  // addMonthsClamped i dates.js genom nextDueDate, och ingen rad i bills.js
  // eller bill.js räknar den.
  skapa(db, 'b-2026', { dueDate: '2026-01-31', interval: 'monthly' });
  assert.equal(markBillPaid(ANVANDARE, 'b-2026', '2026-01-31', { db, now: NU }).dueDate, '2026-02-28');

  // 2028 är skottår: samma räkning ger den 29:e. Båda sidor av 400-årsregelns
  // enkla fall prövas, så att en handskriven klampning med ett fast 28 faller.
  skapa(db, 'b-2028', { dueDate: '2028-01-31', interval: 'monthly' });
  assert.equal(markBillPaid(ANVANDARE, 'b-2028', '2028-01-31', { db, now: NU }).dueDate, '2028-02-29');
});

test('(R4) klampningen smittar inte vidare: anchor_date bär den ursprungliga dagen', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Raden bar först bara sin nästa förfallodag, och då fastnade klampningen:
  // februari kortade ned den 31:a till den 28:e, och mars gav 28 i stället för
  // 31. Användaren valde att ursprungsdagen ska bevaras, så bills fick
  // anchor_date — samma fält och samma skäl som templates.start_date, och
  // nextDueDate klampar alltid från det och aldrig från föregående resultat.
  // Kedjan nedan är hela beviset: februari kortar, mars ger tillbaka den 31:a.
  skapa(db, 'b-31', { dueDate: '2026-01-31', interval: 'monthly' });
  assert.equal(markBillPaid(ANVANDARE, 'b-31', '2026-01-31', { db, now: NU }).dueDate, '2026-02-28');
  assert.equal(markBillPaid(ANVANDARE, 'b-31', '2026-02-28', { db, now: NU }).dueDate, '2026-03-31');
  assert.equal(markBillPaid(ANVANDARE, 'b-31', '2026-03-31', { db, now: NU }).dueDate, '2026-04-30');
  assert.equal(markBillPaid(ANVANDARE, 'b-31', '2026-04-30', { db, now: NU }).dueDate, '2026-05-31');
});

// ---------------------------------------------------------------------------
// (R5) En engångsräkning blir kvar betald.
// ---------------------------------------------------------------------------

test('(R5) en engångsräkning som betalas behåller paid_at och faller ur de kommande', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-tand', { dueDate: '2026-10-15', interval: null });
  skapa(db, 'b-kvar', { dueDate: '2026-10-20', interval: null });

  const efter = markBillPaid(ANVANDARE, 'b-tand', IDAG, { db, now: NU });
  assert.equal(efter.paidAt, NU);
  assert.equal(efter.dueDate, '2026-10-15', 'en engångsräkning flyttas inte fram');
  assert.equal(efter.interval, null);

  // Raden finns kvar i datalagret — det är gränssnittet som avgör vilka rader
  // kortet visar — men statusen säger betald, och de kommande är de övriga.
  const rader = readBills(ANVANDARE, IDAG, { db });
  assert.deepEqual(rader.map((rad) => [rad.id, rad.status]), [
    ['b-tand', 'betald'],
    ['b-kvar', 'kommande']
  ]);
  assert.deepEqual(
    rader.filter((rad) => rad.status !== 'betald').map((rad) => rad.id),
    ['b-kvar']
  );
});

// ---------------------------------------------------------------------------
// (R6) Sorteringen: datum, namn i svensk ordning, id.
// ---------------------------------------------------------------------------

test('(R6) sorteringen är due_date, därefter namn i svensk ordning, därefter id', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Zebra före Ångbåt är svensk ordning — Å står efter Z i det svenska alfabetet,
  // medan engelsk ordning ger det omvända (Å sorteras som A). Namnen
  // är valda så att en localeCompare utan 'sv' svarar annorlunda, och körningens
  // miljö redovisas i paketet med Intl.Collator().resolvedOptions().locale.
  // Varje led i kedjan är skilt från de två andra, så att en mutation som tar
  // bort ett led ger en annan ordning än den förväntade:
  //   - datum: b-1 ligger en månad senare än de tre andra, men har det lägsta
  //     id:t och ett namn som annars kommer först,
  //   - namn: Zebra kommer före Ångbåt men har det HÖGSTA id:t (b-9), så
  //     namnordningen och id-ordningen är inte samma ordning,
  //   - id: de två Ångbåt-raderna läggs in i omvänd id-ordning (b-4 före b-2),
  //     så en stabil sortering utan id-ledet lämnar dem i insättningsordning.
  skapa(db, 'b-9', { dueDate: '2026-10-05', name: 'Zebra' });
  skapa(db, 'b-4', { dueDate: '2026-10-05', name: 'Ångbåt' });
  skapa(db, 'b-2', { dueDate: '2026-10-05', name: 'Ångbåt' });
  skapa(db, 'b-1', { dueDate: '2026-11-01', name: 'Zebra' });

  assert.deepEqual(
    readBills(ANVANDARE, IDAG, { db }).map((rad) => [rad.dueDate, rad.name, rad.id]),
    [
      ['2026-10-05', 'Zebra', 'b-9'],
      ['2026-10-05', 'Ångbåt', 'b-2'],
      ['2026-10-05', 'Ångbåt', 'b-4'],
      ['2026-11-01', 'Zebra', 'b-1']
    ]
  );
  // Den svenska ordningen är inte maskinens ordning: det här är skillnaden
  // argumentet 'sv' finns för, och den prövas mot en explicit engelsk kollator
  // (LARDOMAR.md 2026-09-12).
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true);
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true);
});

test('(R6) kollatorn i bills.js skrivs med språket utsatt i källkoden', async () => {
  // Utfallet kan inte fälla mutationen "ta bort 'sv'" på den här maskinen:
  // Intl.Collator().resolvedOptions().locale är sv-SE här, så de två skrivsätten
  // ger samma ordning. Körd mutation: new Intl.Collator('sv') ->
  // new Intl.Collator() gav EXIT=0 och fail 0 på hela sviten. En mutation som
  // ger samma värde för varje indata i körmiljön ska därför skyddas av en
  // kontroll av källkoden i stället (LARDOMAR.md 2026-09-10 och 2026-09-12).
  //
  // Miljön som körde mätningen redovisas i assertionen nedan, så att det syns
  // vilken ordning maskinen själv ger.
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
  // Maskinens eget språk, inklistrat i paketets redovisning.
  assert.equal(typeof new Intl.Collator().resolvedOptions().locale, 'string');
});

// ---------------------------------------------------------------------------
// (R7) remind_days styr paminnelse, gränsen prövad på båda sidor.
// ---------------------------------------------------------------------------

test('(R7) gränsen för paminnelse ligger på remind_days, prövad på båda sidor', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Sju dagar kvar. remind_days 7 ger paminnelse (daysUntil <= remind_days),
  // remind_days 6 ger kommande. Mutationen <= -> < fälls av den första raden,
  // mutationen <= -> <= + 1 av den andra.
  skapa(db, 'b-7', { dueDate: '2026-10-02', remindDays: 7 });
  skapa(db, 'b-6', { dueDate: '2026-10-02', remindDays: 6 });
  const perId = new Map(readBills(ANVANDARE, IDAG, { db }).map((rad) => [rad.id, rad]));
  assert.equal(perId.get('b-7').daysUntil, 7);
  assert.equal(perId.get('b-7').status, 'paminnelse');
  assert.equal(perId.get('b-6').daysUntil, 7);
  assert.equal(perId.get('b-6').status, 'kommande');
});

test('(R7) remind_days 0 ger paminnelse på dagen och inte dagen innan', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-noll-idag', { dueDate: IDAG, remindDays: REMIND_DAYS_MIN });
  skapa(db, 'b-noll-imorgon', { dueDate: '2026-09-26', remindDays: REMIND_DAYS_MIN });
  const perId = new Map(readBills(ANVANDARE, IDAG, { db }).map((rad) => [rad.id, rad]));
  assert.equal(perId.get('b-noll-idag').status, 'paminnelse');
  assert.equal(perId.get('b-noll-imorgon').status, 'kommande');
});

test('(R7) remind_days 30 är det högsta schemat tar emot', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-30', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX });
  assert.equal(readBills(ANVANDARE, IDAG, { db })[0].status, 'paminnelse');
  assert.throws(
    () => skapa(db, 'b-31', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX + 1 }),
    /Uppgifterna kunde inte sparas/
  );
  assert.throws(
    () => skapa(db, 'b-minus', { dueDate: '2026-10-25', remindDays: REMIND_DAYS_MIN - 1 }),
    /Uppgifterna kunde inte sparas/
  );
});

// ---------------------------------------------------------------------------
// (R8) En annan användares räkningar syns inte.
// ---------------------------------------------------------------------------

test('(R8) en annan användares räkningar syns inte och går inte att röra', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-min', { name: 'Min' });
  skapa(db, 'b-hennes', { name: 'Hennes' }, { userId: ANNAN });

  assert.deepEqual(readBills(ANVANDARE, IDAG, { db }).map((rad) => rad.id), ['b-min']);
  assert.deepEqual(readBills(ANNAN, IDAG, { db }).map((rad) => rad.id), ['b-hennes']);

  // Varje skrivväg svarar som för ett id som inte finns. Samma svar i båda
  // fallen med flit: användaren ska inte kunna se skillnad.
  assert.equal(updateBill(ANVANDARE, 'b-hennes', utkast({ name: 'Kapad' }), { db }), null);
  assert.equal(updateBill(ANVANDARE, 'b-finns-inte', utkast(), { db }), null);
  assert.equal(markBillPaid(ANVANDARE, 'b-hennes', IDAG, { db, now: SENARE }), null);
  assert.equal(markBillPaid(ANVANDARE, 'b-finns-inte', IDAG, { db, now: SENARE }), null);
  assert.equal(removeBill(ANVANDARE, 'b-hennes', { db }), false);
  assert.equal(removeBill(ANVANDARE, 'b-finns-inte', { db }), false);

  // Och hennes rad är orörd efter alla fyra försöken.
  const [hennes] = readBills(ANNAN, IDAG, { db });
  assert.equal(hennes.name, 'Hennes');
  assert.equal(hennes.paidAt, null);
  assert.equal(hennes.dueDate, '2026-10-15');
});

// ---------------------------------------------------------------------------
// (R9) CHECK-listan är INTERVALS, läst ur sqlite_master.
// ---------------------------------------------------------------------------

test('(R9) värdelistan i bills interval-CHECK är INTERVALS', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  const schema = db
    .prepare("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'bills'")
    .get().sql;
  const lista = (värden) => värden.map((värde) => `'${värde}'`).join(', ');
  // Samma prov som tests/db.test.js har för templates: två listor som beskriver
  // samma domän glider isär, och provet är det som hindrar det. IS NULL står med
  // i villkoret, eftersom en engångsräkning har interval = NULL.
  assert.equal(
    schema.includes(`interval IS NULL OR interval IN (${lista([...INTERVALS])})`),
    true,
    schema
  );
  // Gränsen för remind_days står både i schemat och i src/core/bill.js, och de
  // två ska vara samma tal.
  assert.equal(
    schema.includes(`remind_days >= ${REMIND_DAYS_MIN} AND remind_days <= ${REMIND_DAYS_MAX}`),
    true,
    schema
  );
  assert.equal(schema.includes(`DEFAULT ${REMIND_DAYS_DEFAULT}`), true, schema);
});

test('(R9) de fyra intervallen och NULL går igenom, allt annat avvisas', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  for (const [index, interval] of [null, ...INTERVALS].entries()) {
    skapa(db, `b-${index}`, { interval });
  }
  assert.equal(
    db.prepare('SELECT COUNT(*) AS antal FROM bills').get().antal,
    INTERVALS.length + 1
  );
  assert.throws(() => skapa(db, 'b-fel', { interval: 'weekly' }), /Uppgifterna kunde inte sparas/);
});

test('(R9) due_date i fel format och ett belopp som inte är positivt avvisas', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  for (const dueDate of ['2026-2-1', '20261015', '2026-10', '', 'imorgon']) {
    assert.throws(
      () => skapa(db, `b-${dueDate}`, { dueDate }),
      /Uppgifterna kunde inte sparas/,
      `due_date ${JSON.stringify(dueDate)} skulle ha avvisats`
    );
  }
  for (const amountOre of [0, -1]) {
    assert.throws(
      () => skapa(db, `b-${amountOre}`, { amountOre }),
      /Uppgifterna kunde inte sparas/,
      `amount_ore ${amountOre} skulle ha avvisats`
    );
  }
});

test('(R9) ett konto som tas bort tar sina räkningar med sig', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-min');
  skapa(db, 'b-hennes', {}, { userId: ANNAN });
  db.prepare('DELETE FROM users WHERE id = ?').run(ANVANDARE);
  assert.deepEqual(
    db.prepare('SELECT id FROM bills ORDER BY id').all().map((rad) => rad.id),
    ['b-hennes']
  );
});

// ---------------------------------------------------------------------------
// Modulens övriga vägar: skapa, ändra, ta bort, och spärren för today.
// ---------------------------------------------------------------------------

test('addBill skriver de fem fälten och en obetald rad, och svarar med raden på disk', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  const skapad = skapa(db, 'b-ny', { name: 'Bredband', amountOre: 39900, dueDate: '2026-10-28', interval: 'monthly', remindDays: 5 });
  assert.deepEqual(skapad, {
    id: 'b-ny',
    name: 'Bredband',
    amountOre: 39900,
    dueDate: '2026-10-28',
    interval: 'monthly',
    remindDays: 5,
    paidAt: null
  });
  assert.equal(db.prepare('SELECT created_at FROM bills WHERE id = ?').get('b-ny').created_at, NU);
});

test('updateBill ändrar de fem fälten och rör aldrig paid_at', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-el', { dueDate: '2026-10-15', interval: null });
  markBillPaid(ANVANDARE, 'b-el', IDAG, { db, now: NU });

  const ändrad = updateBill(ANVANDARE, 'b-el', utkast({ name: 'El', amountOre: 99900, dueDate: '2026-11-01', interval: 'quarterly', remindDays: 10 }), { db });
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

test('en betald engångsräkning som görs återkommande får paid_at nollställd när den betalas', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Den indata som når raden paid_at = NULL i SQL_MOVE_BILL_FORWARD. En
  // återkommande räkning har annars alltid paid_at = NULL redan, eftersom
  // markBillPaid bara sätter tidsstämpeln för en engångsräkning och updateBill
  // aldrig rör fältet — vilket betyder att raden utan det här fallet är en gren
  // ingen indata når (LARDOMAR.md 2026-09-04). Vardagsfallet är en användare som
  // märker att en räkning hen betalade kommer tillbaka varje månad.
  //
  // mutation: SET due_date = ?, paid_at = NULL -> SET due_date = ?
  //   ger EXIT=1 och fäller just det här fallet; redovisat i paketet.
  skapa(db, 'b-el', { dueDate: '2026-10-15', interval: null });
  assert.equal(markBillPaid(ANVANDARE, 'b-el', IDAG, { db, now: NU }).paidAt, NU);
  assert.equal(updateBill(ANVANDARE, 'b-el', utkast({ dueDate: '2026-10-15', interval: 'monthly' }), { db }).paidAt, NU);

  const efter = markBillPaid(ANVANDARE, 'b-el', '2026-10-15', { db, now: SENARE });
  assert.equal(efter.dueDate, '2026-11-15');
  assert.equal(efter.paidAt, null, 'paid_at ska nollställas när raden flyttas fram');
  assert.equal(readBills(ANVANDARE, '2026-10-16', { db })[0].status, 'kommande');
});

test('removeBill tar bort raden och svarar true bara första gången', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-bort');
  assert.equal(removeBill(ANVANDARE, 'b-bort', { db }), true);
  assert.equal(removeBill(ANVANDARE, 'b-bort', { db }), false);
  assert.deepEqual(readBills(ANVANDARE, IDAG, { db }), []);
});

test('readBills och markBillPaid kräver ett dagens datum på formen ÅÅÅÅ-MM-DD', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'b-el');
  for (const today of [undefined, null, '', '2026-13-01', '2026-02-30', '2026-9-25', 42, 1n, Symbol('x'), -0, NaN, {}, [], new Date()]) {
    assert.throws(
      () => readBills(ANVANDARE, today, { db }),
      /readBills kräver ett dagens datum på formen ÅÅÅÅ-MM-DD/,
      `today ${String(today)} skulle ha avvisats av readBills`
    );
    assert.throws(
      () => markBillPaid(ANVANDARE, 'b-el', today, { db, now: NU }),
      /markBillPaid kräver ett dagens datum på formen ÅÅÅÅ-MM-DD/,
      `today ${String(today)} skulle ha avvisats av markBillPaid`
    );
  }
  // Och raden är orörd efter varje avvisat anrop: spärren står före varje
  // skrivning.
  assert.equal(readBills(ANVANDARE, IDAG, { db })[0].paidAt, null);
});

test('readBills ger en tom lista för en användare utan räkningar', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  assert.deepEqual(readBills(ANVANDARE, IDAG, { db }), []);
});
