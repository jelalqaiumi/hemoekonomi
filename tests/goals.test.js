import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GOAL_STATUSES, PERCENT_FULL, PERCENT_MIN } from '../src/core/goal.js';
import { DATABASE_MESSAGES, DatabaseError, MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addDeposit, addGoal, readGoals, removeGoal, updateGoal } from '../src/server/goals.js';
import { prepare } from './helpers/sql.js';

const NU = '2026-10-08T18:03:00.000Z';
const IDAG = '2026-10-08';
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
    name: 'Buffert',
    targetOre: 5000000,
    targetDate: '2027-06-30',
    ...ändringar
  };
}

async function skapa(db, id, ändringar = {}, { userId = ANVANDARE } = {}) {
  return await addGoal(userId, utkast(ändringar), { db, now: NU, makeId: () => id });
}

async function sattIn(db, goalId, id, amountOre, { madeOn = '2026-10-01', userId = ANVANDARE } = {}) {
  return await addDeposit(userId, goalId, { amountOre, madeOn }, { db, now: NU, makeId: () => id });
}

async function enda(db, { userId = ANVANDARE, today = IDAG } = {}) {
  const mål = await readGoals(userId, today, { db });
  assert.equal(mål.length, 1, 'testfallet förutsätter exakt ett sparmål');
  return mål[0];
}

test('(SM1) savedOre summerar insättningarna, inklusive ett negativt uttag', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-buffert');

  assert.equal((await enda(db)).savedOre, 0, 'ett mål utan insättningar har sparat noll');

  await sattIn(db, 'g-buffert', 'd-1', 2000000);
  await sattIn(db, 'g-buffert', 'd-2', 1000000, { madeOn: '2026-09-01' });
  assert.equal((await enda(db)).savedOre, 3000000, 'två insättningar summeras');

  await sattIn(db, 'g-buffert', 'd-3', -160000, { madeOn: '2026-10-05' });
  assert.equal((await enda(db)).savedOre, 2840000, 'ett uttag dras av från summan');

  await sattIn(db, 'g-buffert', 'd-4', -3000000, { madeOn: '2026-10-06' });
  const mål = await enda(db);
  assert.equal(mål.savedOre, -160000, 'savedOre får vara negativ');
  assert.equal(mål.leftOre, 5160000, 'hela målet plus skulden står kvar som leftOre');
});

test('(SM2) leftOre är aldrig negativ: ett överskridet mål ger noll kvar', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-resa', { targetOre: 1000000 });

  await sattIn(db, 'g-resa', 'd-1', 1000000);
  assert.equal((await enda(db)).leftOre, 0, 'ett mål som nåtts exakt har noll kvar');

  await sattIn(db, 'g-resa', 'd-2', 250000, { madeOn: '2026-10-05' });
  const mål = await enda(db);
  assert.equal(mål.savedOre, 1250000, 'savedOre visar hela det insatta beloppet');
  assert.equal(mål.leftOre, 0, 'ett överskridet mål har noll kvar, aldrig -250000');
  assert.equal(mål.perMonthOre, 0, 'inget kvar att spara ger noll per månad');
});

test('(SM3) percent klipps i båda ändar', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());

  await skapa(db, 'g-over', { targetOre: 1000000 });
  await sattIn(db, 'g-over', 'd-over', 1400000);

  await skapa(db, 'g-under', { targetOre: 1000000, name: 'Cykel' });
  await sattIn(db, 'g-under', 'd-under', -120000);

  await skapa(db, 'g-mitt', { targetOre: 1000000, name: 'Dator' });
  await sattIn(db, 'g-mitt', 'd-mitt', 567000);

  const perId = new Map((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-over').percent, PERCENT_FULL, '140 procent klipps till 100');
  assert.equal(perId.get('g-over').savedOre, 1400000, 'savedOre bär sanningen, inte percent');
  assert.equal(perId.get('g-under').percent, PERCENT_MIN, 'ett negativt sparat ger noll procent');
  assert.equal(perId.get('g-under').savedOre, -120000, 'savedOre bär sanningen, inte percent');
  assert.equal(perId.get('g-mitt').percent, 56, '56,7 procent avrundas nedåt till 56');

  await skapa(db, 'g-tom', { targetOre: 1000000, name: 'Elgitarr' });
  const tom = (await readGoals(ANVANDARE, IDAG, { db })).find((mål) => mål.id === 'g-tom');
  assert.equal(tom.percent, PERCENT_MIN, 'noll insatt är noll procent');
});

test('(SM4) ett mål utan slutdatum har monthsLeft null och perMonthOre null', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-utan', { targetDate: null });
  await sattIn(db, 'g-utan', 'd-1', 1000000);

  const mål = await enda(db);
  assert.equal(mål.targetDate, null, 'kolumnen target_date är NULL');
  assert.equal(mål.monthsLeft, null, 'utan slutdatum finns ingen månad att räkna till');
  assert.equal(mål.perMonthOre, null, 'utan slutdatum finns ingen månadstakt');
  assert.equal(mål.savedOre, 1000000);
  assert.equal(mål.leftOre, 4000000);
  assert.equal(mål.percent, 20);
  assert.equal(mål.status, 'pagaende');

  await addGoal(ANVANDARE, { name: 'Resa', targetOre: 2000000 }, { db, now: NU, makeId: () => 'g-nyckellos' });
  const utanNyckel = (await readGoals(ANVANDARE, IDAG, { db })).find((mål2) => mål2.id === 'g-nyckellos');
  assert.equal(utanNyckel.targetDate, null);
  assert.equal(utanNyckel.monthsLeft, null);
  assert.equal(utanNyckel.perMonthOre, null);
});

test('(SM5) monthsLeft noll ger hela leftOre som perMonthOre', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());

  await skapa(db, 'g-denna', { targetOre: 1000000, targetDate: '2026-10-31' });
  await sattIn(db, 'g-denna', 'd-denna', 400000);

  await skapa(db, 'g-passerat', { targetOre: 1000000, targetDate: '2026-09-30', name: 'Cykel' });
  await sattIn(db, 'g-passerat', 'd-passerat', 400000);

  await skapa(db, 'g-nasta', { targetOre: 1000000, targetDate: '2026-11-01', name: 'Dator' });
  await sattIn(db, 'g-nasta', 'd-nasta', 400000);

  const perId = new Map((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-denna').monthsLeft, 0, 'slutdatum i denna månad ger noll');
  assert.equal(perId.get('g-denna').perMonthOre, 600000, 'hela leftOre ska sparas nu');
  assert.equal(perId.get('g-passerat').monthsLeft, 0, 'ett passerat slutdatum ger noll, aldrig minus ett');
  assert.equal(perId.get('g-passerat').perMonthOre, 600000, 'hela leftOre, ingen division med noll');
  assert.equal(perId.get('g-nasta').monthsLeft, 1, 'nästa månad ger en');
  assert.equal(perId.get('g-nasta').perMonthOre, 600000, 'en månad kvar ger också hela beloppet');

  await skapa(db, 'g-tva', { targetOre: 1000000, targetDate: '2026-12-24', name: 'Elgitarr' });
  await sattIn(db, 'g-tva', 'd-tva', 400000);
  const tvåMånader = (await readGoals(ANVANDARE, IDAG, { db })).find((mål) => mål.id === 'g-tva');
  assert.equal(tvåMånader.monthsLeft, 2);
  assert.equal(tvåMånader.perMonthOre, 300000);

  await skapa(db, 'g-udda', { targetOre: 100001, targetDate: '2027-01-15', name: 'Fiol' });
  const udda = (await readGoals(ANVANDARE, IDAG, { db })).find((mål) => mål.id === 'g-udda');
  assert.equal(udda.monthsLeft, 3);
  assert.equal(udda.perMonthOre, 33334, 'halva öret uppåt, ägd av divideRoundHalfUp');
});

test('(SM6) de fyra raderna i statustabellen, en rad i taget', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());

  await skapa(db, 'g-klart', { targetOre: 1000000, targetDate: '2027-06-30' });
  await sattIn(db, 'g-klart', 'd-klart', 1000000);

  await skapa(db, 'g-utan-datum', { targetOre: 1000000, targetDate: null, name: 'Cykel' });

  await skapa(db, 'g-forsenat', { targetOre: 1000000, targetDate: '2026-10-07', name: 'Dator' });

  await skapa(db, 'g-pagaende', { targetOre: 1000000, targetDate: '2026-10-09', name: 'Elgitarr' });

  const perId = new Map((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-klart').status, 'klart', 'rad 1');
  assert.equal(perId.get('g-utan-datum').status, 'pagaende', 'rad 2');
  assert.equal(perId.get('g-forsenat').status, 'forsenat', 'rad 3');
  assert.equal(perId.get('g-pagaende').status, 'pagaende', 'rad 4');

  for (const mål of perId.values()) {
    assert.equal(GOAL_STATUSES.includes(mål.status), true, mål.status);
  }
});

test('(SM6) ett slutdatum som är idag är pagaende och inte forsenat', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-idag', { targetOre: 1000000, targetDate: IDAG });
  assert.equal((await enda(db)).status, 'pagaende');
  assert.equal((await enda(db)).monthsLeft, 0, 'samma månad ger noll månader kvar');
});

test('(SM7) ett nått mål med passerat slutdatum är klart, inte forsenat', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-natt', { targetOre: 1000000, targetDate: '2026-09-30' });
  await sattIn(db, 'g-natt', 'd-natt', 1000000, { madeOn: '2026-09-20' });
  assert.equal((await enda(db)).status, 'klart', 'rad 1 vinner över rad 3');

  await skapa(db, 'g-inte-natt', { targetOre: 1000000, targetDate: '2026-09-30', name: 'Cykel' });
  const inteNått = (await readGoals(ANVANDARE, IDAG, { db })).find((mål) => mål.id === 'g-inte-natt');
  assert.equal(inteNått.status, 'forsenat');
});

test('(SM8) en annan användares sparmål syns inte och går inte att röra', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-mitt', { name: 'Mitt mål' });
  await skapa(db, 'g-hennes', { name: 'Hennes mål' }, { userId: ANNAN });
  await sattIn(db, 'g-hennes', 'd-hennes', 500000, { userId: ANNAN });

  assert.deepEqual((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => mål.id), ['g-mitt']);
  assert.deepEqual((await readGoals(ANNAN, IDAG, { db })).map((mål) => mål.id), ['g-hennes']);

  assert.equal(await updateGoal(ANVANDARE, 'g-hennes', utkast({ name: 'Stulet' }), { db }), null);
  assert.equal(await updateGoal(ANVANDARE, 'g-finns-inte', utkast(), { db }), null, 'samma svar som för ett okänt id');
  assert.equal((await readGoals(ANNAN, IDAG, { db }))[0].name, 'Hennes mål', 'raden är oförändrad');

  assert.equal(await removeGoal(ANVANDARE, 'g-hennes', { db }), false);
  assert.equal(await removeGoal(ANVANDARE, 'g-finns-inte', { db }), false, 'samma svar som för ett okänt id');
  assert.equal((await readGoals(ANNAN, IDAG, { db })).length, 1, 'raden finns kvar');

  assert.equal(await addDeposit(ANVANDARE, 'g-hennes', { amountOre: 100000, madeOn: '2026-10-01' }, { db, now: NU, makeId: () => 'd-stulen' }), null);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS n FROM goal_deposits').get()).n, 1, 'ingen rad skrevs');
  assert.equal((await readGoals(ANNAN, IDAG, { db }))[0].savedOre, 500000, 'den andres savedOre är oförändrad');
});

test('(SM9) en insättning på noll avvisas av schemats CHECK', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-buffert');

  await assert.rejects(
    async () => await sattIn(db, 'g-buffert', 'd-noll', 0),
    (error) => {
      assert.equal(error instanceof DatabaseError, true, 'ska vara en DatabaseError');
      assert.equal(error.message, DATABASE_MESSAGES.constraintFailed);
      return true;
    }
  );
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS n FROM goal_deposits').get()).n, 0, 'ingen rad skrevs');

  assert.notEqual(await sattIn(db, 'g-buffert', 'd-minus', -1), null, 'ett negativt belopp tas emot');
  assert.equal((await enda(db)).savedOre, -1);

  for (const targetOre of [0, -1]) {
    await assert.rejects(
      async () => await skapa(db, `g-${targetOre}`, { targetOre }),
      (error) => {
        assert.equal(error instanceof DatabaseError, true);
        assert.equal(error.message, DATABASE_MESSAGES.constraintFailed);
        return true;
      },
      `target_ore ${targetOre}`
    );
  }
});

test('(SM10) ett borttaget sparmål tar sina insättningar med sig', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-bort');
  await skapa(db, 'g-kvar', { name: 'Cykel' });
  await sattIn(db, 'g-bort', 'd-bort-1', 300000);
  await sattIn(db, 'g-bort', 'd-bort-2', -50000, { madeOn: '2026-10-05' });
  await sattIn(db, 'g-kvar', 'd-kvar', 700000);
  assert.equal((await prepare(db, 'SELECT COUNT(*) AS n FROM goal_deposits').get()).n, 3);

  assert.equal(await removeGoal(ANVANDARE, 'g-bort', { db }), true);

  assert.deepEqual(
    (await prepare(db, 'SELECT id FROM goal_deposits ORDER BY id').all()).map((rad) => rad.id),
    ['d-kvar']
  );
  assert.deepEqual((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => mål.id), ['g-kvar']);
  assert.equal((await enda(db)).savedOre, 700000);
});

test('readGoals sorterar på namn i svensk ordning och därefter på id', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-3', { name: 'Zebra' });
  await skapa(db, 'g-1', { name: 'Ångbåt' });
  await skapa(db, 'g-2', { name: 'Bil' });
  await skapa(db, 'g-5', { name: 'Bil' });
  await skapa(db, 'g-4', { name: 'Bil' });

  assert.deepEqual((await readGoals(ANVANDARE, IDAG, { db })).map((mål) => [mål.name, mål.id]), [
    ['Bil', 'g-2'],
    ['Bil', 'g-4'],
    ['Bil', 'g-5'],
    ['Zebra', 'g-3'],
    ['Ångbåt', 'g-1']
  ]);
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true, 'svensk ordning sätter Å efter Z');
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true, 'engelsk ordning sätter Å före Z');
});

test('src/server/goals.js begär svensk kollation utskriven, inte körmiljöns standardspråk', async () => {
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true, 'sv: Å efter Z');
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true, 'en: Å som ett A');

  const källa = await readFile(fileURLToPath(new URL('../src/server/goals.js', import.meta.url)), 'utf8');
  const begäranden = [...källa.matchAll(/new\s+Intl\.Collator\s*\(([^)]*)\)/g)].map((träff) => träff[1].trim());
  assert.equal(begäranden.length > 0, true, 'filen bygger ingen kollator: sorteringen jämför inte namn');

  for (const argument of begäranden) {
    const match = /^'([^']+)'|^"([^"]+)"/.exec(argument);
    assert.notEqual(match, null, `kollationen begärdes med ${JSON.stringify(argument)}: språket är inte utskrivet, och ordningen beror då på körmiljöns standardspråk`);
    const språk = match[1] ?? match[2];
    assert.equal(
      new Intl.Collator(språk).compare('Ångbåt', 'Zebra') > 0,
      true,
      `det begärda språket ${JSON.stringify(språk)} ger inte svensk ordning`
    );
  }
});

test('readGoals svarar med exakt de tio fälten i ARKITEKTUR.md', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-buffert');
  await sattIn(db, 'g-buffert', 'd-1', 100000);
  assert.deepEqual(Object.keys(await enda(db)).sort(), [
    'id', 'leftOre', 'monthsLeft', 'name', 'perMonthOre', 'percent', 'savedOre', 'status', 'targetDate', 'targetOre'
  ]);
});

test('addGoal och updateGoal svarar med de fyra fälten ur goals-raden', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  const skapat = await skapa(db, 'g-buffert');
  assert.deepEqual(Object.keys(skapat).sort(), ['id', 'name', 'targetDate', 'targetOre']);

  const ändrat = await updateGoal(ANVANDARE, 'g-buffert', utkast({ name: 'Ny buffert', targetOre: 7000000, targetDate: null }), { db });
  assert.deepEqual(ändrat, { id: 'g-buffert', name: 'Ny buffert', targetOre: 7000000, targetDate: null });
});

test('updateGoal rör inte insättningarna', async (t) => {
  const db = await freshDatabase();
  t.after(() => db.close());
  await skapa(db, 'g-buffert', { targetOre: 1000000 });
  await sattIn(db, 'g-buffert', 'd-1', 500000);
  assert.equal((await enda(db)).percent, 50);

  await updateGoal(ANVANDARE, 'g-buffert', utkast({ targetOre: 2000000 }), { db });
  const mål = await enda(db);
  assert.equal(mål.savedOre, 500000, 'insättningen är kvar');
  assert.equal(mål.percent, 25);
  assert.equal(mål.leftOre, 1500000);
});
