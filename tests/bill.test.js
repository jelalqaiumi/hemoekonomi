// Räkningens kärna, src/core/bill.js [steg 3]. Prövar modulens egna exporter
// direkt, i stället för bara genom src/server/bills.js: en modul under
// src/core/ ska ha en egen testfil som kör dess exporter, i samma paket som
// filen skapas (LARDOMAR.md 2026-08-18).
//
// Statusordningen prövas också av (R1) och (R2) i tests/bills.test.js, genom
// readBills. Här prövas den på billStatus själv, tillsammans med modulens
// ingångsspärrar — de går inte att nå genom datalagret, eftersom schemats CHECK
// står i vägen.
//
// Ingen klocka läses: varje today står som en literal.
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  BILL_STATUSES,
  REMIND_DAYS_DEFAULT,
  REMIND_DAYS_MAX,
  REMIND_DAYS_MIN,
  billStatus,
  daysUntilDue,
  nextBillDueDate,
  validateBillDraft
} from '../src/core/bill.js';
import { INTERVALS } from '../src/core/entry.js';

const IDAG = '2026-09-25';
const NU = '2026-09-25T18:03:00.000Z';

// De värden varje typvakt i projektet ska pröva: -0, NaN, Infinity, en sträng,
// null, 1n och Symbol('x') plus en array, ett Date och ett vanligt objekt
// (LARDOMAR.md 2026-09-02 och 2026-08-24).
const ICKE_TAL = [-0.5, NaN, Infinity, -Infinity, '3', null, 1n, Symbol('x'), {}, [], new Date(), true];

function bill(ändringar = {}) {
  const värden = {
    id: 'b1',
    name: 'Elräkning',
    amountOre: 85000,
    dueDate: '2026-10-15',
    interval: null,
    remindDays: REMIND_DAYS_DEFAULT,
    paidAt: null,
    ...ändringar
  };
  // anchorDate förvalas till dueDate, eftersom det är vad addBill skriver för en
  // ny räkning: den första förfallodagen ÄR seriens ursprungliga dag. Ett fall
  // som prövar en bevarad ursprungsdag efter en eller flera betalningar sätter
  // anchorDate själv, och spridningen nedan låter det värdet vinna.
  return { anchorDate: värden.dueDate, ...värden };
}

// --- BILL_STATUSES -----------------------------------------------------------

test('BILL_STATUSES är de fyra värdena i tabellordning och är fryst', () => {
  // Ordningen ÄR regeln: listan står i samma ordning som tabellen under "Vad
  // readBills svarar", och billStatus läser värdena ur den i stället för att
  // skriva dem en andra gång.
  assert.deepEqual([...BILL_STATUSES], ['betald', 'forfallen', 'paminnelse', 'kommande']);
  assert.equal(Object.isFrozen(BILL_STATUSES), true);
  // Varje värde billStatus kan svara med står i listan, och inget annat.
  const svar = new Set([
    billStatus(bill({ paidAt: NU }), IDAG),
    billStatus(bill({ dueDate: '2026-09-20' }), IDAG),
    billStatus(bill({ dueDate: '2026-09-27', remindDays: 3 }), IDAG),
    billStatus(bill({ dueDate: '2026-10-15', remindDays: 3 }), IDAG)
  ]);
  assert.deepEqual([...svar].sort(), [...BILL_STATUSES].sort());
});

// --- billStatus: de fyra raderna och ordningen -------------------------------

test('billStatus ger de fyra värdena, en rad i tabellen var', () => {
  assert.equal(billStatus(bill({ paidAt: NU }), IDAG), 'betald');
  assert.equal(billStatus(bill({ dueDate: '2026-09-24' }), IDAG), 'forfallen');
  assert.equal(billStatus(bill({ dueDate: '2026-09-28', remindDays: 3 }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-29', remindDays: 3 }), IDAG), 'kommande');
});

test('billStatus låter rad 1 vinna över rad 2: en betald räkning som förfallit är betald', () => {
  // Båda villkoren är sanna samtidigt. Kastas ordningen om svarar funktionen
  // forfallen, och det är just den mutationen raden fäller.
  const förfallenOchBetald = bill({ dueDate: '2026-09-20', paidAt: NU });
  assert.equal(billStatus(förfallenOchBetald, IDAG), 'betald');
  assert.equal(billStatus({ ...förfallenOchBetald, paidAt: null }, IDAG), 'forfallen');
});

test('billStatus låter rad 2 vinna över rad 3: en förfallen räkning är inte en påminnelse', () => {
  // daysUntil är -5 och alltså mindre än remind_days, så rad 3 skulle också
  // svara om den stod först.
  const förfallen = bill({ dueDate: '2026-09-20', remindDays: 3 });
  assert.equal(daysUntilDue(förfallen.dueDate, IDAG), -5);
  assert.equal(billStatus(förfallen, IDAG), 'forfallen');
});

test('billStatus räknar en räkning som förfaller idag som paminnelse, aldrig som forfallen', () => {
  // Gränsen i rad 2 är "före today". Mutationen < 0 -> <= 0 fälls här.
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: REMIND_DAYS_MIN }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-24', remindDays: REMIND_DAYS_MIN }), IDAG), 'forfallen');
});

test('billStatus prövar gränsen för paminnelse på båda sidor av remind_days', () => {
  // Sju dagar kvar. Lika många som remind_days ger paminnelse, en mer ger
  // kommande: mutationen <= -> < fälls av den första raden, <= -> < remindDays + 1
  // av den andra.
  assert.equal(billStatus(bill({ dueDate: '2026-10-02', remindDays: 7 }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-10-02', remindDays: 6 }), IDAG), 'kommande');
  // Och på båda sidor av de två yttre gränserna för fältet.
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: REMIND_DAYS_MIN }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-09-26', remindDays: REMIND_DAYS_MIN }), IDAG), 'kommande');
  assert.equal(billStatus(bill({ dueDate: '2026-10-25', remindDays: REMIND_DAYS_MAX }), IDAG), 'paminnelse');
  assert.equal(billStatus(bill({ dueDate: '2026-10-26', remindDays: REMIND_DAYS_MAX }), IDAG), 'kommande');
});

// --- billStatus: ingångsspärrarna, första träff vinner -----------------------

test('billStatus kastar RangeError för något som inte är ett objekt', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(() => billStatus(value, IDAG), {
      name: 'RangeError',
      message: 'billStatus kräver en räkning som objekt.'
    }, String(value));
  }
  // Ett Date är ett vanligt objekt enligt isPlainObject, modulens ägare till
  // frågan, så det faller på nästa rad i stället — ingen egen, strängare kopia
  // av villkoret (LARDOMAR.md 2026-09-02).
  assert.throws(() => billStatus(new Date(), IDAG), {
    name: 'RangeError',
    message: 'billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "undefined".'
  });
});

test('billStatus kastar RangeError för ett paidAt som varken är en tidsstämpel eller null', () => {
  for (const paidAt of [undefined, '', '   ', 42, 0, true, 1n, Symbol('x'), {}, [], new Date(), NaN]) {
    // Hela meddelandet och inte bara feltypen: en feltyp delas av varje spärr i
    // modulen (LARDOMAR.md 2026-09-16).
    assert.throws(() => billStatus(bill({ paidAt }), IDAG), {
      name: 'RangeError',
      message: `billStatus kräver ett paidAt som en icke-tom sträng eller null, fick "${String(paidAt)}".`
    }, String(paidAt));
  }
});

test('billStatus kastar RangeError för ett remindDays utanför gränserna eller av fel typ', () => {
  for (const remindDays of [...ICKE_TAL, REMIND_DAYS_MIN - 1, REMIND_DAYS_MAX + 1, 2.5, -0.0001]) {
    assert.throws(() => billStatus(bill({ remindDays }), IDAG), {
      name: 'RangeError',
      message: `billStatus kräver ett remindDays mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX}, fick "${String(remindDays)}".`
    }, String(remindDays));
  }
  // -0 är ett heltal i intervallet och tas emot, precis som 0.
  assert.equal(billStatus(bill({ dueDate: IDAG, remindDays: -0 }), IDAG), 'paminnelse');
});

test('billStatus låter compareIsoDates äga frågan "är det här ett datum"', () => {
  // Ingen egen kopia av datumvillkoret: meddelandet bär compareIsoDates namn,
  // och spärren står efter paidAt- och remindDays-raderna, så en betald räkning
  // med ett trasigt dueDate svarar betald i stället för att kasta.
  assert.throws(() => billStatus(bill({ dueDate: '2026-02-30' }), IDAG), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.throws(() => billStatus(bill(), '2026-13-01'), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.equal(billStatus(bill({ dueDate: '2026-02-30', paidAt: NU }), IDAG), 'betald');
});

// --- daysUntilDue ------------------------------------------------------------

test('daysUntilDue räknar dagar framåt och bakåt, och ger +0 för samma dag', () => {
  assert.equal(daysUntilDue('2026-10-02', IDAG), 7);
  assert.equal(daysUntilDue('2026-09-20', IDAG), -5);
  assert.equal(daysUntilDue(IDAG, IDAG), 0);
  // Inget -0 ur någon exporterad funktion i src/core/ (LARDOMAR.md 2026-09-02).
  assert.equal(Object.is(daysUntilDue(IDAG, IDAG), -0), false);
  // Över ett månadsskifte och över ett årsskifte, alltså ingen räkning inom en
  // månad: daysBetween i dates.js äger den, och ingen rad i bill.js subtraherar
  // två datum.
  assert.equal(daysUntilDue('2027-01-01', '2026-12-31'), 1);
  assert.equal(daysUntilDue('2026-03-01', '2026-02-28'), 1);
  assert.equal(daysUntilDue('2028-03-01', '2028-02-28'), 2, 'skottår');
});

test('daysUntilDue låter daysBetween avvisa det som inte är ett datum', () => {
  for (const value of [undefined, null, '', '2026-13-01', 42, 1n, Symbol('x')]) {
    assert.throws(() => daysUntilDue(value, IDAG), {
      name: 'RangeError',
      message: /^daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD/
    }, String(value));
    assert.throws(() => daysUntilDue(IDAG, value), {
      name: 'RangeError',
      message: /^daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD/
    }, String(value));
  }
});

// --- nextBillDueDate ---------------------------------------------------------

test('nextBillDueDate flyttar en period framåt när räkningen betalas i tid', () => {
  // Betalningen sker på förfallodagen. Den dragning som just betalades får inte
  // bli svaret igen, så svaret är en hel period senare.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-10-15'), '2026-11-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'quarterly' }), '2026-10-15'), '2027-01-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'semiannual' }), '2026-10-15'), '2027-04-15');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'yearly' }), '2026-10-15'), '2027-10-15');
});

test('nextBillDueDate flyttar en period framåt också när räkningen betalas i förväg', () => {
  // today ligger före afterPaid, så valet tar afterPaid-grenen.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-10-01'), '2026-11-15');
  // Och när today ligger exakt på afterPaid: jämförelsen är > 0 och inte >= 0,
  // så svaret är detsamma.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-10-15', interval: 'monthly' }), '2026-11-15'), '2026-11-15');
});

test('nextBillDueDate hoppar över de perioder som redan passerat vid en sen betalning', () => {
  // Fallet som gör båda leden i funktionen bärande:
  //   mutation: from = compareIsoDates(today, afterPaid) > 0 ? today : afterPaid
  //             -> afterPaid                      ger EXIT=1, faller här
  //   mutation: return nextDueDate(series, from) -> return from
  //             ger EXIT=1, faller här
  // Ett enda steg framåt hade gett 2026-04-15, en förfallodag som redan har
  // passerat; nextDueDate:s hopp över flera perioder ger 2026-10-15.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-15', interval: 'quarterly' }), '2026-07-20'), '2026-10-15');
  // Samma sak månadsvis, flera år tillbaka: inget varv-för-varv-räknande.
  assert.equal(nextBillDueDate(bill({ dueDate: '2020-03-15', interval: 'monthly' }), '2026-09-25'), '2026-10-15');
  // Och en sen betalning där today råkar vara en dragningsdag: svaret är då den
  // dagen, eftersom nextDueDate svarar med den första dragningen PÅ eller efter.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-15', interval: 'monthly' }), '2026-07-15'), '2026-07-15');
});

test('nextBillDueDate klampar genom nextDueDate för den 29 till 31', () => {
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-31', interval: 'monthly' }), '2026-01-31'), '2026-02-28');
  assert.equal(nextBillDueDate(bill({ dueDate: '2028-01-31', interval: 'monthly' }), '2028-01-31'), '2028-02-29');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-30', interval: 'monthly' }), '2026-01-30'), '2026-02-28');
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-01-29', interval: 'monthly' }), '2026-01-29'), '2026-02-28');
  // Kvartalsvis från den 30 november: februari har inte 30 dagar.
  assert.equal(nextBillDueDate(bill({ dueDate: '2026-11-30', interval: 'quarterly' }), '2026-11-30'), '2027-02-28');
});

test('nextBillDueDate kastar RangeError för en engångsräkning och för ett okänt interval', () => {
  // En engångsräkning har ingen nästa dragning, och frågan ska ställas av
  // anroparen innan den anropar: markBillPaid i src/server/bills.js gör det.
  assert.throws(() => nextBillDueDate(bill({ interval: null }), IDAG), {
    name: 'RangeError',
    message: 'nextBillDueDate kräver ett känt interval, fick "null".'
  });
  // Object.hasOwn och inte ett sanningsprövat uppslag: prototypens nycklar är
  // inga intervall. Hela meddelandet asserteras, aldrig bara feltypen — en
  // feltyp delas av varje spärr i modulen (LARDOMAR.md 2026-09-16).
  for (const interval of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf', 'weekly', '', undefined, 42, 1n]) {
    assert.throws(() => nextBillDueDate(bill({ interval }), IDAG), {
      name: 'RangeError',
      message: `nextBillDueDate kräver ett känt interval, fick "${String(interval)}".`
    }, String(interval));
  }
});

test('nextBillDueDate kastar RangeError för något som inte är ett objekt', () => {
  for (const value of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), []]) {
    assert.throws(() => nextBillDueDate(value, IDAG), {
      name: 'RangeError',
      message: 'nextBillDueDate kräver en räkning som objekt.'
    }, String(value));
  }
});

test('nextBillDueDate låter dates.js avvisa ett dueDate eller ett today som inte är ett datum', () => {
  assert.throws(() => nextBillDueDate(bill({ dueDate: '2026-02-30', interval: 'monthly' }), IDAG), {
    name: 'RangeError',
    message: /^addMonthsClamped kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
  assert.throws(() => nextBillDueDate(bill({ interval: 'monthly' }), '2026-13-01'), {
    name: 'RangeError',
    message: /^compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD/
  });
});

// --- validateBillDraft -------------------------------------------------------

test('validateBillDraft tar emot de fem fälten och räknar om beloppet till ören', () => {
  assert.deepEqual(
    validateBillDraft({ name: '  Elräkning ', amountSek: '850,50', dueDate: '2026-10-15', interval: 'monthly', remindDays: 5 }),
    { ok: true, value: { name: 'Elräkning', amountOre: 85050, dueDate: '2026-10-15', interval: 'monthly', remindDays: 5 } }
  );
});

test('validateBillDraft tar emot de fyra intervallen plus Engångs som tomt', () => {
  for (const interval of INTERVALS) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, true, interval);
    assert.equal(result.value.interval, interval);
  }
  // Engångs skickas som ingen nyckel, null eller den tomma strängen. Alla tre
  // ger null, precis som checkOccurredOn i item.js gör för sitt fält.
  for (const interval of [undefined, null, '', '   ']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, true, String(interval));
    assert.equal(result.value.interval, null, String(interval));
  }
});

test('validateBillDraft ger förvalet för remindDays när fältet är tomt', () => {
  for (const remindDays of [undefined, null, '', '   ']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays });
    assert.equal(result.ok, true, String(remindDays));
    assert.equal(result.value.remindDays, REMIND_DAYS_DEFAULT, String(remindDays));
  }
  // Samma tal som schemats DEFAULT, så att de två spärrarna i två språk inte
  // kan glida isär.
  assert.equal(REMIND_DAYS_DEFAULT, 3);
});

test('validateBillDraft tar emot remindDays som sträng och som tal, med samma svar', () => {
  for (const [sträng, tal] of [['0', 0], ['3', 3], ['30', 30], [' 7 ', 7]]) {
    assert.deepEqual(
      validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: sträng }),
      validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: tal }),
      sträng
    );
  }
  // Och samma meddelande för samma ogiltiga värde oavsett ingångstyp
  // (LARDOMAR.md 2026-08-18).
  for (const [sträng, tal] of [['31', 31], ['-1', -1], ['999', 999]]) {
    const frånSträng = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: sträng });
    const frånTal = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: tal });
    assert.deepEqual(frånSträng, frånTal, sträng);
    assert.equal(frånSträng.errors[0].message, `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`);
  }
});

test('validateBillDraft avvisar ett remindDays som inte är ett heltal i intervallet', () => {
  for (const remindDays of [31, -1, 2.5, NaN, Infinity, '2,5', '3 dagar', 'tre', 1n, Symbol('x'), {}, [], true, new Date(), '0031']) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays });
    assert.equal(result.ok, false, String(remindDays));
    assert.deepEqual(result.errors, [{
      field: 'remindDays',
      message: `Påminn mig mellan ${REMIND_DAYS_MIN} och ${REMIND_DAYS_MAX} dagar innan.`
    }], String(remindDays));
  }
});

test('validateBillDraft avvisar ett remindDays på en miljon tecken utan att läsa hela', () => {
  // Snabbvägen av samma slag som längdspärren i checkName: svaret är avgjort
  // efter fyra tecken (LARDOMAR.md 2026-08-23).
  const start = Date.now();
  const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', remindDays: '1'.repeat(1000000) });
  assert.equal(result.ok, false);
  assert.equal(result.errors[0].field, 'remindDays');
  assert.equal(Date.now() - start < 1000, true, `tog ${Date.now() - start} ms`);
});

test('validateBillDraft kräver en förfallodag och avvisar ett datum som inte finns', () => {
  for (const dueDate of [undefined, null, '', '   ', '2026-10', '20261015', '2026-2-1', '2026-02-30', '2026-13-01', 'imorgon', 42, 1n, Symbol('x'), {}, [], new Date()]) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate });
    assert.equal(result.ok, false, String(dueDate));
    assert.deepEqual(result.errors, [{
      field: 'dueDate',
      message: 'Förfallodag måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD.'
    }], String(dueDate));
  }
  // Trimmas, precis som name: ett fält med blanksteg runt datumet är ett datum.
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: ' 2026-10-15 ' }).value.dueDate, '2026-10-15');
  // Den 29 februari finns bara på skottår, och isValidIsoDate äger frågan.
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2028-02-29' }).ok, true);
  assert.equal(validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-02-29' }).ok, false);
});

test('validateBillDraft avvisar ett intervall som inte är ett av de fyra, med sin egen text', () => {
  for (const interval of ['weekly', 'MONTHLY', 'constructor', 'toString', 42, 1n, Symbol('x'), {}, [], true, new Date()]) {
    const result = validateBillDraft({ name: 'El', amountSek: '100', dueDate: '2026-10-15', interval });
    assert.equal(result.ok, false, String(interval));
    assert.deepEqual(result.errors, [{
      field: 'interval',
      // Modulens egen text och inte checkIntervals: räkningens fält har ett
      // alternativ mer än mallens, och checkIntervals text räknar inte upp det.
      message: 'Välj Engångs, månadsvis, kvartalsvis, halvårsvis eller årsvis.'
    }], String(interval));
  }
});

test('validateBillDraft lånar namnets och beloppets texter av deras ägare i entry.js', () => {
  assert.deepEqual(
    validateBillDraft({ name: '  ', amountSek: '100', dueDate: '2026-10-15' }).errors,
    [{ field: 'name', message: 'Namnet får inte vara tomt.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'a'.repeat(61), amountSek: '100', dueDate: '2026-10-15' }).errors,
    [{ field: 'name', message: 'Namnet får vara högst 60 tecken.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'El', amountSek: '0', dueDate: '2026-10-15' }).errors,
    [{ field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }]
  );
  assert.deepEqual(
    validateBillDraft({ name: 'El', amountSek: '1,005', dueDate: '2026-10-15' }).errors,
    [{ field: 'amountSek', message: 'Beloppet får ha högst två decimaler.' }]
  );
});

test('validateBillDraft prövar alla fem fälten och ger felen i formulärets ordning', () => {
  // Fältordningen är bindande: name, amountSek, dueDate, interval, remindDays.
  // Alla fem prövas, aldrig bara det första — ett formulär med fem fel ska visa
  // fem meddelanden samtidigt.
  const result = validateBillDraft({ name: '', amountSek: 'abc', dueDate: 'nej', interval: 'weekly', remindDays: 99 });
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors.map((fel) => fel.field), ['name', 'amountSek', 'dueDate', 'interval', 'remindDays']);
});

test('validateBillDraft tar emot något som inte är ett objekt och svarar med fem fältfel', () => {
  for (const draft of [undefined, null, 'abc', 42, true, 1n, Symbol('x'), []]) {
    const result = validateBillDraft(draft);
    assert.equal(result.ok, false, String(draft));
    // interval och remindDays saknas, och ett saknat fält är tomt, alltså
    // Engångs respektive förvalet — tre fel och inte fem.
    assert.deepEqual(result.errors.map((fel) => fel.field), ['name', 'amountSek', 'dueDate'], String(draft));
  }
});
