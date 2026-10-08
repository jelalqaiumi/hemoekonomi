// Datalagret för sparmålen, src/server/goals.js, plus tabellerna goals och
// goal_deposits i src/server/db.js [steg 4]. Kravlistan (SM1) till (SM10) i
// ARKITEKTUR.md under "Kravlista [steg 4]".
//
// Varje testfall öppnar sin egen databas i minnet, så att inget fall kan se en rad
// ett annat fall skrev. DatabaseSync är synkron: ingen rad här har await.
//
// Ingen klocka läses: varje today och varje now står som en literal.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { GOAL_STATUSES, PERCENT_FULL, PERCENT_MIN } from '../src/core/goal.js';
import { DATABASE_MESSAGES, DatabaseError, MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addDeposit, addGoal, readGoals, removeGoal, updateGoal } from '../src/server/goals.js';

const NU = '2026-10-08T18:03:00.000Z';
const IDAG = '2026-10-08';
const ANVANDARE = 'u1';
const ANNAN = 'u2';

// En databas med två konton, så att varje fall kan pröva att den andres sparmål
// inte syns utan att först bygga upp sitt eget utgångsläge.
function freshDatabase() {
  const db = openDatabase(MEMORY_PATH);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(ANVANDARE, 'anna@example.se', NU);
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)').run(ANNAN, 'berit@example.se', NU);
  return db;
}

// Ett utkast med alla tre fälten giltiga, på den form validateGoalDraft svarar
// med: targetOre och inte kronor. Varje testfall byter ut de fält fallet gäller.
function utkast(ändringar = {}) {
  return {
    name: 'Buffert',
    targetOre: 5000000,
    targetDate: '2027-06-30',
    ...ändringar
  };
}

// Lägger till ett mål med ett förutsägbart id, så att assertionerna kan namnge
// raden i stället för att leta upp den.
function skapa(db, id, ändringar = {}, { userId = ANVANDARE } = {}) {
  return addGoal(userId, utkast(ändringar), { db, now: NU, makeId: () => id });
}

// Lägger till en insättning med ett förutsägbart id.
function sattIn(db, goalId, id, amountOre, { madeOn = '2026-10-01', userId = ANVANDARE } = {}) {
  return addDeposit(userId, goalId, { amountOre, madeOn }, { db, now: NU, makeId: () => id });
}

function enda(db, { userId = ANVANDARE, today = IDAG } = {}) {
  const mål = readGoals(userId, today, { db });
  assert.equal(mål.length, 1, 'testfallet förutsätter exakt ett sparmål');
  return mål[0];
}

// ---------------------------------------------------------------------------
// (SM1) savedOre summerar insättningarna, inklusive ett negativt uttag.
// ---------------------------------------------------------------------------

test('(SM1) savedOre summerar insättningarna, inklusive ett negativt uttag', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-buffert');

  // Utan insättningar är summan 0 och inte null: SUM över noll rader ger NULL i
  // SQL, och COALESCE i SAVED_ORE_COLUMN äger översättningen till noll.
  assert.equal(enda(db).savedOre, 0, 'ett mål utan insättningar har sparat noll');

  sattIn(db, 'g-buffert', 'd-1', 2000000);
  sattIn(db, 'g-buffert', 'd-2', 1000000, { madeOn: '2026-09-01' });
  assert.equal(enda(db).savedOre, 3000000, 'två insättningar summeras');

  // Det negativa uttaget är hela poängen med CHECK (amount_ore <> 0) i stället
  // för > 0: den som tar ut pengar ska kunna registrera det, annars visar målet
  // mer än som finns.
  sattIn(db, 'g-buffert', 'd-3', -160000, { madeOn: '2026-10-05' });
  assert.equal(enda(db).savedOre, 2840000, 'ett uttag dras av från summan');

  // Och summan kan bli negativ: uttagen får överstiga insättningarna. savedOre
  // och leftOre svarar på olika frågor, och det är bara leftOre som har en
  // nedre gräns.
  sattIn(db, 'g-buffert', 'd-4', -3000000, { madeOn: '2026-10-06' });
  const mål = enda(db);
  assert.equal(mål.savedOre, -160000, 'savedOre får vara negativ');
  assert.equal(mål.leftOre, 5160000, 'hela målet plus skulden står kvar som leftOre');
});

// ---------------------------------------------------------------------------
// (SM2) leftOre är aldrig negativ: ett överskridet mål ger noll.
// ---------------------------------------------------------------------------

test('(SM2) leftOre är aldrig negativ: ett överskridet mål ger noll kvar', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-resa', { targetOre: 1000000 });

  // Exakt på målet: noll kvar, och gränsfallet skrivs ut för sig. Mutationen
  // Math.max(0, ...) -> (targetOre - savedOre) ger samma svar här, så raden
  // nedan med det överskridna målet är den som fäller den.
  sattIn(db, 'g-resa', 'd-1', 1000000);
  assert.equal(enda(db).leftOre, 0, 'ett mål som nåtts exakt har noll kvar');

  sattIn(db, 'g-resa', 'd-2', 250000, { madeOn: '2026-10-05' });
  const mål = enda(db);
  assert.equal(mål.savedOre, 1250000, 'savedOre visar hela det insatta beloppet');
  assert.equal(mål.leftOre, 0, 'ett överskridet mål har noll kvar, aldrig -250000');
  // perMonthOre följer leftOre och blir därmed noll: det finns inget kvar att
  // spara. Utan klampningen hade raden visat ett negativt månadsbelopp.
  assert.equal(mål.perMonthOre, 0, 'inget kvar att spara ger noll per månad');
});

// ---------------------------------------------------------------------------
// (SM3) percent klipps i båda ändar: noll som lägst, 100 som högst.
// ---------------------------------------------------------------------------

test('(SM3) percent klipps i båda ändar', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());

  // Övre änden: 140 procent av målet ger 100, inte 140. En progressruta kan inte
  // rita 140 procent.
  skapa(db, 'g-over', { targetOre: 1000000 });
  sattIn(db, 'g-over', 'd-over', 1400000);

  // Nedre änden: uttagen överstiger insättningarna, alltså minus tolv procent
  // räknat. Svaret ska vara 0.
  skapa(db, 'g-under', { targetOre: 1000000, name: 'Cykel' });
  sattIn(db, 'g-under', 'd-under', -120000);

  // Mitten, så att de två ytterfallen inte kan passera med ett percent som alltid
  // är noll eller alltid hundra.
  skapa(db, 'g-mitt', { targetOre: 1000000, name: 'Dator' });
  sattIn(db, 'g-mitt', 'd-mitt', 567000);

  const perId = new Map(readGoals(ANVANDARE, IDAG, { db }).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-over').percent, PERCENT_FULL, '140 procent klipps till 100');
  assert.equal(perId.get('g-over').savedOre, 1400000, 'savedOre bär sanningen, inte percent');
  assert.equal(perId.get('g-under').percent, PERCENT_MIN, 'ett negativt sparat ger noll procent');
  assert.equal(perId.get('g-under').savedOre, -120000, 'savedOre bär sanningen, inte percent');
  // Avrundning nedåt: 56,7 procent ger 56 och aldrig 57.
  assert.equal(perId.get('g-mitt').percent, 56, '56,7 procent avrundas nedåt till 56');

  // Noll insatt är gränsen mellan de två grenarna i klippningen och prövas för
  // sig: mutationen savedOre <= 0 -> savedOre < 0 ger samma svar här, men raden
  // visar att noll insatt är noll procent och inte något annat.
  skapa(db, 'g-tom', { targetOre: 1000000, name: 'Elgitarr' });
  const tom = readGoals(ANVANDARE, IDAG, { db }).find((mål) => mål.id === 'g-tom');
  assert.equal(tom.percent, PERCENT_MIN, 'noll insatt är noll procent');
});

// ---------------------------------------------------------------------------
// (SM4) perMonthOre utan slutdatum är null, och monthsLeft också.
// ---------------------------------------------------------------------------

test('(SM4) ett mål utan slutdatum har monthsLeft null och perMonthOre null', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-utan', { targetDate: null });
  sattIn(db, 'g-utan', 'd-1', 1000000);

  const mål = enda(db);
  assert.equal(mål.targetDate, null, 'kolumnen target_date är NULL');
  assert.equal(mål.monthsLeft, null, 'utan slutdatum finns ingen månad att räkna till');
  assert.equal(mål.perMonthOre, null, 'utan slutdatum finns ingen månadstakt');
  // De fyra övriga fälten räknas ändå: ett mål utan slutdatum har ett sparat, ett
  // kvar, en procent och en status.
  assert.equal(mål.savedOre, 1000000);
  assert.equal(mål.leftOre, 4000000);
  assert.equal(mål.percent, 20);
  assert.equal(mål.status, 'pagaende');

  // Ett mål som skapas utan nyckeln alls hamnar i samma läge: addGoal skriver NULL
  // och inte undefined, som node:sqlite inte kan binda.
  addGoal(ANVANDARE, { name: 'Resa', targetOre: 2000000 }, { db, now: NU, makeId: () => 'g-nyckellos' });
  const utanNyckel = readGoals(ANVANDARE, IDAG, { db }).find((mål2) => mål2.id === 'g-nyckellos');
  assert.equal(utanNyckel.targetDate, null);
  assert.equal(utanNyckel.monthsLeft, null);
  assert.equal(utanNyckel.perMonthOre, null);
});

// ---------------------------------------------------------------------------
// (SM5) monthsLeft noll ger hela leftOre som perMonthOre. Ingen division med noll.
// ---------------------------------------------------------------------------

test('(SM5) monthsLeft noll ger hela leftOre som perMonthOre', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());

  // Slutdatumet ligger senare i samma månad som today. Hela månader är noll, och
  // allt som återstår ska sparas nu.
  skapa(db, 'g-denna', { targetOre: 1000000, targetDate: '2026-10-31' });
  sattIn(db, 'g-denna', 'd-denna', 400000);

  // Slutdatumet har passerat. Också noll hela månader, och samma svar.
  skapa(db, 'g-passerat', { targetOre: 1000000, targetDate: '2026-09-30', name: 'Cykel' });
  sattIn(db, 'g-passerat', 'd-passerat', 400000);

  // En månad kvar, så att fallet ovan inte kan passera med ett perMonthOre som
  // alltid är leftOre.
  skapa(db, 'g-nasta', { targetOre: 1000000, targetDate: '2026-11-01', name: 'Dator' });
  sattIn(db, 'g-nasta', 'd-nasta', 400000);

  const perId = new Map(readGoals(ANVANDARE, IDAG, { db }).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-denna').monthsLeft, 0, 'slutdatum i denna månad ger noll');
  assert.equal(perId.get('g-denna').perMonthOre, 600000, 'hela leftOre ska sparas nu');
  assert.equal(perId.get('g-passerat').monthsLeft, 0, 'ett passerat slutdatum ger noll, aldrig minus ett');
  assert.equal(perId.get('g-passerat').perMonthOre, 600000, 'hela leftOre, ingen division med noll');
  assert.equal(perId.get('g-nasta').monthsLeft, 1, 'nästa månad ger en');
  assert.equal(perId.get('g-nasta').perMonthOre, 600000, 'en månad kvar ger också hela beloppet');

  // Två månader kvar delar beloppet, så att raden ovan prövar divisionen och inte
  // bara att talet råkar vara detsamma. 600000 / 2 ger 300000 jämnt.
  skapa(db, 'g-tva', { targetOre: 1000000, targetDate: '2026-12-24', name: 'Elgitarr' });
  sattIn(db, 'g-tva', 'd-tva', 400000);
  const tvåMånader = readGoals(ANVANDARE, IDAG, { db }).find((mål) => mål.id === 'g-tva');
  assert.equal(tvåMånader.monthsLeft, 2);
  assert.equal(tvåMånader.perMonthOre, 300000);

  // Och halva öret uppåt genom divideRoundHalfUp: 100001 öre på tre månader ger
  // 33333,67 öre, alltså 33334 och inte 33333.
  skapa(db, 'g-udda', { targetOre: 100001, targetDate: '2027-01-15', name: 'Fiol' });
  const udda = readGoals(ANVANDARE, IDAG, { db }).find((mål) => mål.id === 'g-udda');
  assert.equal(udda.monthsLeft, 3);
  assert.equal(udda.perMonthOre, 33334, 'halva öret uppåt, ägd av divideRoundHalfUp');
});

// ---------------------------------------------------------------------------
// (SM6) De fyra raderna i statustabellen, en rad i taget och i ordning.
// ---------------------------------------------------------------------------

test('(SM6) de fyra raderna i statustabellen, en rad i taget', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());

  // Rad 1: savedOre >= targetOre.
  skapa(db, 'g-klart', { targetOre: 1000000, targetDate: '2027-06-30' });
  sattIn(db, 'g-klart', 'd-klart', 1000000);

  // Rad 2: targetDate saknas.
  skapa(db, 'g-utan-datum', { targetOre: 1000000, targetDate: null, name: 'Cykel' });

  // Rad 3: targetDate har passerat.
  skapa(db, 'g-forsenat', { targetOre: 1000000, targetDate: '2026-10-07', name: 'Dator' });

  // Rad 4: annars.
  skapa(db, 'g-pagaende', { targetOre: 1000000, targetDate: '2026-10-09', name: 'Elgitarr' });

  const perId = new Map(readGoals(ANVANDARE, IDAG, { db }).map((mål) => [mål.id, mål]));
  assert.equal(perId.get('g-klart').status, 'klart', 'rad 1');
  assert.equal(perId.get('g-utan-datum').status, 'pagaende', 'rad 2');
  assert.equal(perId.get('g-forsenat').status, 'forsenat', 'rad 3');
  assert.equal(perId.get('g-pagaende').status, 'pagaende', 'rad 4');

  // Varje värde i tabellen står i GOAL_STATUSES, och inget annat värde kan komma
  // ut. Listan är ägaren, och raden binder de fyra svaren till den.
  for (const mål of perId.values()) {
    assert.equal(GOAL_STATUSES.includes(mål.status), true, mål.status);
  }
});

test('(SM6) ett slutdatum som är idag är pagaende och inte forsenat', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Rad 3 är "har passerat", inte "idag eller tidigare": ett mål som går ut i dag
  // är inte försenat. Mutationen compareIsoDates(...) < 0 -> <= 0 fälls av den här
  // raden.
  skapa(db, 'g-idag', { targetOre: 1000000, targetDate: IDAG });
  assert.equal(enda(db).status, 'pagaende');
  assert.equal(enda(db).monthsLeft, 0, 'samma månad ger noll månader kvar');
});

// ---------------------------------------------------------------------------
// (SM7) klart vinner över forsenat.
// ---------------------------------------------------------------------------

test('(SM7) ett nått mål med passerat slutdatum är klart, inte forsenat', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  // Slutdatumet låg 2026-09-30 och är passerat, alltså är rad 3 i tabellen sann —
  // men rad 1 står före den.
  skapa(db, 'g-natt', { targetOre: 1000000, targetDate: '2026-09-30' });
  sattIn(db, 'g-natt', 'd-natt', 1000000, { madeOn: '2026-09-20' });
  assert.equal(enda(db).status, 'klart', 'rad 1 vinner över rad 3');

  // Samma mål utan insättningen ger rad 3. Utan den här jämförelsen prövar fallet
  // ovan inte ordningen, bara att klart finns.
  skapa(db, 'g-inte-natt', { targetOre: 1000000, targetDate: '2026-09-30', name: 'Cykel' });
  const inteNått = readGoals(ANVANDARE, IDAG, { db }).find((mål) => mål.id === 'g-inte-natt');
  assert.equal(inteNått.status, 'forsenat');
});

// ---------------------------------------------------------------------------
// (SM8) En annan användares mål syns inte, och går inte att röra.
// ---------------------------------------------------------------------------

test('(SM8) en annan användares sparmål syns inte och går inte att röra', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-mitt', { name: 'Mitt mål' });
  skapa(db, 'g-hennes', { name: 'Hennes mål' }, { userId: ANNAN });
  sattIn(db, 'g-hennes', 'd-hennes', 500000, { userId: ANNAN });

  assert.deepEqual(readGoals(ANVANDARE, IDAG, { db }).map((mål) => mål.id), ['g-mitt']);
  assert.deepEqual(readGoals(ANNAN, IDAG, { db }).map((mål) => mål.id), ['g-hennes']);

  // Ett UPDATE mot den andres id matchar noll rader, och svaret är null — samma
  // svar som för ett id som aldrig funnits.
  assert.equal(updateGoal(ANVANDARE, 'g-hennes', utkast({ name: 'Stulet' }), { db }), null);
  assert.equal(updateGoal(ANVANDARE, 'g-finns-inte', utkast(), { db }), null, 'samma svar som för ett okänt id');
  assert.equal(readGoals(ANNAN, IDAG, { db })[0].name, 'Hennes mål', 'raden är oförändrad');

  // Samma för DELETE.
  assert.equal(removeGoal(ANVANDARE, 'g-hennes', { db }), false);
  assert.equal(removeGoal(ANVANDARE, 'g-finns-inte', { db }), false, 'samma svar som för ett okänt id');
  assert.equal(readGoals(ANNAN, IDAG, { db }).length, 1, 'raden finns kvar');

  // Och för en insättning. Främmande nyckeln goal_id kräver bara att målet finns,
  // inte att det är användarens — utan läsningen i addDeposit hade raden nedan
  // skapat en insättning på den andres mål.
  assert.equal(addDeposit(ANVANDARE, 'g-hennes', { amountOre: 100000, madeOn: '2026-10-01' }, { db, now: NU, makeId: () => 'd-stulen' }), null);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM goal_deposits').get().n, 1, 'ingen rad skrevs');
  assert.equal(readGoals(ANNAN, IDAG, { db })[0].savedOre, 500000, 'den andres savedOre är oförändrad');
});

// ---------------------------------------------------------------------------
// (SM9) En insättning på noll avvisas: CHECK (amount_ore <> 0) håller.
// ---------------------------------------------------------------------------

test('(SM9) en insättning på noll avvisas av schemats CHECK', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-buffert');

  // DatabaseError med svensk text, inte ett engelskt SQLite-fel: write i db.js
  // översätter errstr 'constraint failed' till constraintFailed.
  assert.throws(
    () => sattIn(db, 'g-buffert', 'd-noll', 0),
    (error) => {
      assert.equal(error instanceof DatabaseError, true, 'ska vara en DatabaseError');
      assert.equal(error.message, DATABASE_MESSAGES.constraintFailed);
      return true;
    }
  );
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM goal_deposits').get().n, 0, 'ingen rad skrevs');

  // Ett negativt belopp går däremot igenom. Utan den här raden prövar fallet ovan
  // inte att villkoret är <> 0 — ett CHECK med > 0 hade avvisat båda.
  assert.notEqual(sattIn(db, 'g-buffert', 'd-minus', -1), null, 'ett negativt belopp tas emot');
  assert.equal(enda(db).savedOre, -1);

  // Och ett målbelopp på noll avvisas av CHECK (target_ore > 0) — där är noll och
  // negativt samma sak, till skillnad från insättningens.
  for (const targetOre of [0, -1]) {
    assert.throws(
      () => skapa(db, `g-${targetOre}`, { targetOre }),
      (error) => {
        assert.equal(error instanceof DatabaseError, true);
        assert.equal(error.message, DATABASE_MESSAGES.constraintFailed);
        return true;
      },
      `target_ore ${targetOre}`
    );
  }
});

// ---------------------------------------------------------------------------
// (SM10) Ett borttaget mål tar sina insättningar med sig: ON DELETE CASCADE.
// ---------------------------------------------------------------------------

test('(SM10) ett borttaget sparmål tar sina insättningar med sig', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-bort');
  skapa(db, 'g-kvar', { name: 'Cykel' });
  sattIn(db, 'g-bort', 'd-bort-1', 300000);
  sattIn(db, 'g-bort', 'd-bort-2', -50000, { madeOn: '2026-10-05' });
  sattIn(db, 'g-kvar', 'd-kvar', 700000);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM goal_deposits').get().n, 3);

  assert.equal(removeGoal(ANVANDARE, 'g-bort', { db }), true);

  // Bara målets egna insättningar följde med. Raden som hör till det andra målet
  // står kvar — en CASCADE som tog allt hade passerat ett test som bara räknar
  // till noll.
  assert.deepEqual(
    db.prepare('SELECT id FROM goal_deposits ORDER BY id').all().map((rad) => rad.id),
    ['d-kvar']
  );
  assert.deepEqual(readGoals(ANVANDARE, IDAG, { db }).map((mål) => mål.id), ['g-kvar']);
  assert.equal(enda(db).savedOre, 700000);
});

// ---------------------------------------------------------------------------
// Sorteringen och de tio fälten. Ingen egen punkt i kravlistan, men ordningen
// måste vara total för att vyn inte ska hoppa mellan två läsningar, och fältlistan
// är det kontrakt gränssnittet läser.
// ---------------------------------------------------------------------------

test('readGoals sorterar på namn i svensk ordning och därefter på id', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-3', { name: 'Zebra' });
  skapa(db, 'g-1', { name: 'Ångbåt' });
  skapa(db, 'g-2', { name: 'Bil' });
  // Två mål med samma namn: id avgör, så ordningen är total.
  skapa(db, 'g-5', { name: 'Bil' });
  skapa(db, 'g-4', { name: 'Bil' });

  assert.deepEqual(readGoals(ANVANDARE, IDAG, { db }).map((mål) => [mål.name, mål.id]), [
    ['Bil', 'g-2'],
    ['Bil', 'g-4'],
    ['Bil', 'g-5'],
    ['Zebra', 'g-3'],
    // Å efter Z i svensk ordning. Med körmiljöns språk i stället för 'sv' hade en
    // engelsk maskin satt Ångbåt först (LARDOMAR.md 2026-09-12).
    ['Ångbåt', 'g-1']
  ]);
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true, 'svensk ordning sätter Å efter Z');
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true, 'engelsk ordning sätter Å före Z');
});

// Argumentet 'sv' i new Intl.Collator('sv') finns för att ordningen inte ska bero
// på körmiljöns språk. Fallet ovan kan inte visa det: det prövar bara utfallet, och
// utfallet är detsamma så länge maskinens standardspråk råkar vara svenskt. Körd på
// den här maskinen: new Intl.Collator().resolvedOptions().locale ger sv-SE, så
// mutationen "ta bort 'sv'" ger samma ordning och överlever
// (LARDOMAR.md 2026-09-12).
//
// Spionen i tests/schedule.test.js går inte att använda här: NAME_COLLATOR byggs en
// gång vid modulladdningen, alltså innan något testfall kan byta ut Intl.Collator.
// Den kollatorn syns inte från ett anrop. Skyddet är därför en kontroll av
// källtexten, samma form som testet "src/server/api.js importerar ... utan
// saveEntries" i tests/api.test.js — och det prövas med varje stavning språket
// tillåter för samma sak: inget argument, en tom sträng, undefined och ett språk som
// inte ger svensk ordning ska alla falla.
test('src/server/goals.js begär svensk kollation utskriven, inte körmiljöns standardspråk', async () => {
  // Motexemplet som gör resten meningsfull: svenskan sorterar Å efter Z, engelskan
  // sorterar det som ett A. Ger de två samma svar är ICU-datan inte den väntade.
  assert.equal(new Intl.Collator('sv').compare('Ångbåt', 'Zebra') > 0, true, 'sv: Å efter Z');
  assert.equal(new Intl.Collator('en').compare('Ångbåt', 'Zebra') < 0, true, 'en: Å som ett A');

  const källa = await readFile(fileURLToPath(new URL('../src/server/goals.js', import.meta.url)), 'utf8');
  // Varje konstruktion av en kollator i filen, oavsett hur argumentet är skrivet.
  // Mönstret fångar också new Intl.Collator() och new Intl.Collator(undefined), så
  // att de stavningarna faller på kontrollen nedan i stället för att inte räknas.
  const begäranden = [...källa.matchAll(/new\s+Intl\.Collator\s*\(([^)]*)\)/g)].map((träff) => träff[1].trim());
  assert.equal(begäranden.length > 0, true, 'filen bygger ingen kollator: sorteringen jämför inte namn');

  for (const argument of begäranden) {
    // En enkel- eller dubbelciterad icke-tom strängliteral, och ingenting annat.
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

test('readGoals svarar med exakt de tio fälten i ARKITEKTUR.md', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-buffert');
  sattIn(db, 'g-buffert', 'd-1', 100000);
  assert.deepEqual(Object.keys(enda(db)).sort(), [
    'id', 'leftOre', 'monthsLeft', 'name', 'perMonthOre', 'percent', 'savedOre', 'status', 'targetDate', 'targetOre'
  ]);
});

test('addGoal och updateGoal svarar med de fyra fälten ur goals-raden', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  const skapat = skapa(db, 'g-buffert');
  assert.deepEqual(Object.keys(skapat).sort(), ['id', 'name', 'targetDate', 'targetOre']);

  const ändrat = updateGoal(ANVANDARE, 'g-buffert', utkast({ name: 'Ny buffert', targetOre: 7000000, targetDate: null }), { db });
  assert.deepEqual(ändrat, { id: 'g-buffert', name: 'Ny buffert', targetOre: 7000000, targetDate: null });
});

test('updateGoal rör inte insättningarna', (t) => {
  const db = freshDatabase();
  t.after(() => db.close());
  skapa(db, 'g-buffert', { targetOre: 1000000 });
  sattIn(db, 'g-buffert', 'd-1', 500000);
  assert.equal(enda(db).percent, 50);

  // Ett höjt målbelopp sänker percent och höjer leftOre. savedOre är ett faktum
  // och inte en följd av målet.
  updateGoal(ANVANDARE, 'g-buffert', utkast({ targetOre: 2000000 }), { db });
  const mål = enda(db);
  assert.equal(mål.savedOre, 500000, 'insättningen är kvar');
  assert.equal(mål.percent, 25);
  assert.equal(mål.leftOre, 1500000);
});
