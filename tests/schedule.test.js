import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMonthsClamped, daysBetween } from '../src/core/dates.js';
import { INTERVALS } from '../src/core/entry.js';
import { compareUpcoming, MONTHS_PER_PERIOD, nextDueDate, upcoming } from '../src/core/schedule.js';

// En giltig post med de sex fälten. Fält som testet bryr sig om skrivs över.
function post(overrides = {}) {
  return {
    id: 'a1',
    name: 'Hyra',
    amountSek: 1200,
    category: 'housing',
    interval: 'monthly',
    startDate: '2026-01-01',
    ...overrides
  };
}

// Värden som isPlainObject — ägaren till villkoret "vanligt objekt" — säger
// false om, och som därför faller på objektraden. Arrayerna står med därför att
// typeof ger 'object' också för dem.
const ICKE_POSTER = [null, undefined, 'abc', 42, true, 1n, Symbol('x'), [], [1]];

// new Date() står inte i listan ovan: isPlainObject — ägaren till villkoret —
// säger true för ett Date, precis som för yearlyOre i cost.js, och posten faller
// då på intervalraden i stället. Det är facit och har ett eget testfall.

// --- MONTHS_PER_PERIOD -------------------------------------------------------

test('MONTHS_PER_PERIOD och INTERVALS beskriver samma domän', () => {
  assert.deepEqual(Object.keys(MONTHS_PER_PERIOD).sort(), [...INTERVALS].sort());
});

test('MONTHS_PER_PERIOD har periodlängderna 1, 3, 6 och 12', () => {
  assert.deepEqual({ ...MONTHS_PER_PERIOD }, { monthly: 1, quarterly: 3, semiannual: 6, yearly: 12 });
});

test('MONTHS_PER_PERIOD är fryst', () => {
  assert.equal(Object.isFrozen(MONTHS_PER_PERIOD), true);
  assert.throws(() => {
    MONTHS_PER_PERIOD.monthly = 2;
  }, TypeError);
  assert.throws(() => {
    MONTHS_PER_PERIOD.weekly = 1;
  }, TypeError);
  assert.equal(MONTHS_PER_PERIOD.monthly, 1);
});

// --- nextDueDate: facittabellen ur ARKITEKTUR.md ------------------------------

// Raderna är ARKITEKTUR.md:s facit under "Härledning av nästa dragningsdatum",
// ordagrant och i samma ordning.
const FACIT = [
  ['2026-09-01', 'monthly', '2026-08-18', '2026-09-01', 'framtida start'],
  ['2026-08-18', 'monthly', '2026-08-18', '2026-08-18', 'start = idag, 0 dagar kvar'],
  ['2026-01-31', 'monthly', '2026-02-01', '2026-02-28', 'februari är kortare'],
  ['2026-01-31', 'monthly', '2026-03-01', '2026-03-31', 'klampningen smittar inte vidare'],
  ['2024-02-29', 'yearly', '2026-08-18', '2027-02-28', 'skottdag, flera år tillbaka'],
  ['2020-03-31', 'quarterly', '2026-08-18', '2026-09-30', '26 perioder tillbaka, september har 30 dagar'],
  ['2026-12-31', 'quarterly', '2026-08-18', '2026-12-31', 'start i framtiden trots samma år']
];

test('nextDueDate ger facittabellens svar', () => {
  for (const [startDate, interval, today, forvantat, varfor] of FACIT) {
    assert.equal(nextDueDate(post({ startDate, interval }), today), forvantat, `${startDate} ${interval} ${today} — ${varfor}`);
  }
});

test('nextDueDate ligger aldrig före startdatumet, hur långt fram starten än är', () => {
  // Raden fäller Math.max(0, ...): utan den ger diff = -16 och step = 3 ett
  // k = -6, och loopen stannar på 2026-09-30 — tre månader före startdatumet.
  assert.equal(nextDueDate(post({ startDate: '2027-12-31', interval: 'quarterly' }), '2026-08-18'), '2027-12-31');
  assert.equal(nextDueDate(post({ startDate: '2030-01-15', interval: 'yearly' }), '2026-08-18'), '2030-01-15');
  assert.equal(nextDueDate(post({ startDate: '2026-09-30', interval: 'monthly' }), '2026-08-18'), '2026-09-30');
});

test('nextDueDate ger idag eller senare för varje kombination av start och intervall', () => {
  const today = '2026-08-18';
  for (const interval of INTERVALS) {
    for (const startDate of ['1970-01-01', '2020-03-31', '2026-08-17', '2026-08-18', '2026-08-19', '2099-12-31']) {
      const due = nextDueDate(post({ startDate, interval }), today);
      assert.equal(due >= today, true, `${interval} ${startDate} gav ${due}`);
    }
  }
});

test('nextDueDate klampar från startdatumets dag i varje period, aldrig från föregående resultat', () => {
  const entry = post({ startDate: '2026-01-31', interval: 'monthly' });
  const facit = [
    ['2026-01-31', '2026-01-31'],
    ['2026-02-01', '2026-02-28'],
    ['2026-03-01', '2026-03-31'],
    ['2026-04-01', '2026-04-30'],
    ['2026-05-01', '2026-05-31'],
    ['2026-06-01', '2026-06-30']
  ];
  for (const [today, forvantat] of facit) {
    assert.equal(nextDueDate(entry, today), forvantat, today);
  }
});

// Halvårsvis är sex månader per period: posten dras i startmånaden och sex
// månader senare, alltså två gånger om året. Varje rad nedan är ett kört värde.
test('nextDueDate ger halvårspostens dragningar sex månader isär', () => {
  const halvar = post({ startDate: '2026-03-31', interval: 'semiannual' });
  const facit = [
    ['2026-03-01', '2026-03-31', 'starten ligger senare i samma månad'],
    ['2026-03-31', '2026-03-31', 'start = idag, 0 dagar kvar'],
    ['2026-04-01', '2026-09-30', 'sex månader fram, klampat: september har 30 dagar'],
    ['2026-09-30', '2026-09-30', 'dragningsdagen själv'],
    ['2026-10-01', '2027-03-31', 'nästa period är mars igen, på startdatumets dag'],
    ['2027-04-01', '2027-09-30', 'klampningen smittar inte vidare till nästa år']
  ];
  for (const [today, forvantat, varfor] of facit) {
    assert.equal(nextDueDate(halvar, today), forvantat, `${today} — ${varfor}`);
  }

  // En start som inte behöver klampas: dragningarna ligger i januari och juli.
  const januari = post({ startDate: '2026-01-15', interval: 'semiannual' });
  assert.equal(nextDueDate(januari, '2026-02-01'), '2026-07-15');
  assert.equal(nextDueDate(januari, '2026-07-15'), '2026-07-15');
  assert.equal(nextDueDate(januari, '2026-07-16'), '2027-01-15');

  // Tolv perioder tillbaka: augusti och februari, och februari klampas.
  assert.equal(
    nextDueDate(post({ startDate: '2020-08-31', interval: 'semiannual' }), '2026-09-25'),
    '2027-02-28'
  );
});

// Regeln "klampningen räknas om från startDate, aldrig från föregående
// occurrence" står på två kodvägar: steg 2 (k = Math.floor(diff / step)) och
// korrigeringsloopen under den. Facittabellen och testet ovan kör bara den
// första. För monthly kan de två aldrig inträffa samtidigt: loopen körs bara när
// today ligger efter occurrence, och en klampad occurrence ligger alltid på
// månadens sista dag. Bara ett interval vars period är längre än en månad når
// kombinationen, och det
// kräver ett today mitt i perioden (LARDOMAR.md 2026-09-12).
//
// De två fallen nedan kör alltså loopkroppen med en klampad occurrence, och
// bara de fäller mutationen addMonths(entry.startDate, k * step) ->
// addMonths(occurrence, step).
//
// (S1)
test('nextDueDate klampar från startDate också i korrigeringsloopen', () => {
  // quarterly, start den 31:a: perioden efter 2026-01-31 landar på 2026-04-30 —
  // klampat, eftersom april har 30 dagar. Den raden är körd som egen assertion
  // så att det klampade datumet raden under bygger vidare på är prövat och inte
  // bara påstått i en kommentar. Assertionen ser bara returvärdet: hur många
  // perioder steg 2 hoppar över är modulinternt, syns inte här och mäts av
  // (S3) som antalet anrop av addMonths (ARKITEKTUR.md, kravlistan).
  const kvartal = post({ startDate: '2026-01-31', interval: 'quarterly' });
  assert.equal(
    nextDueDate(kvartal, '2026-04-30'),
    '2026-04-30',
    'en occurrence som är lika med today korrigeras inte vidare: svaret är den klampade 2026-04-30'
  );
  // Med today mitt i perioden ligger 2026-04-30 före today, så loopen kör ett
  // varv. Svaret räknas om från startDate: 2026-01-31 + 6 månader = 2026-07-31.
  // Räknat från föregående occurrence hade det blivit 2026-04-30 + 3 månader =
  // 2026-07-30, alltså en dag fel och en dag som inte är startdatumets.
  assert.equal(nextDueDate(kvartal, '2026-06-15'), '2026-07-31');

  // yearly, start på skottdagen: perioden efter 2024-02-29 som inte ligger före
  // today landar på 2027-02-28 — klampat, eftersom 2027 inte är ett skottår.
  // Också den raden prövar bara returvärdet.
  const ar = post({ startDate: '2024-02-29', interval: 'yearly' });
  assert.equal(
    nextDueDate(ar, '2027-02-28'),
    '2027-02-28',
    'en occurrence som är lika med today korrigeras inte vidare: svaret är den klampade 2027-02-28'
  );
  // Loopen kör ett varv och räknar om från startDate: 2024-02-29 + 48 månader =
  // 2028-02-29, ett skottår igen. Räknat från föregående occurrence hade
  // klampningen smittat vidare och gett 2028-02-28.
  assert.equal(nextDueDate(ar, '2027-03-15'), '2028-02-29');
});

test('nextDueDate hoppar direkt till rätt trakt för en start långt tillbaka', () => {
  // 1970-01-31, månadsvis, är 679 perioder tillbaka. Svaret ska vara detsamma
  // som om varje period hade räknats för sig.
  assert.equal(nextDueDate(post({ startDate: '1970-01-31', interval: 'monthly' }), '2026-08-18'), '2026-08-31');
  assert.equal(nextDueDate(post({ startDate: '1970-01-31', interval: 'quarterly' }), '2026-08-18'), '2026-10-31');
  assert.equal(nextDueDate(post({ startDate: '1970-02-28', interval: 'yearly' }), '2026-08-18'), '2027-02-28');
});

// Kravet "steg 2 hoppar till rätt trakt — inget varv-för-varv-räknande från
// 1970" är det enda krav i projektet där de två kodvarianterna ger samma svar
// för varje indata: mutationen let k = Math.max(0, Math.floor(diff / step)) ->
// let k = 0 gav tests 335, pass 335, fail 0 och EXIT=0 för två läsare
// (LARDOMAR.md 2026-09-14). Skillnaden är arbetet, inte värdet: 679 varv i
// stället för ett hopp. En assertion på körtid är förbjuden i projektet, så
// arbetet görs mätbart genom parametern addMonths — occurrence-steget injiceras
// med addMonthsClamped som förval, och omslutningen nedan räknar sina anrop.
//
// Taket är högst 3 anrop och inte ett exakt antal: ett tak mäter arbete och
// fäller varje återgång till varv-för-varv-räkning, medan ett exakt antal skulle
// bli falskt av en tillåten omskrivning av steg 2 (ARKITEKTUR.md, "Steg 2 görs
// mätbart"). Assertionen namnger det som mäts — antalet anrop av addMonths —
// aldrig k, som är modulinternt.
//
// Ett tak fälls bara av fler anrop, aldrig av färre, så det kan inte se att ett
// av de två occurrence-stegen slutat gå genom parametern: mutationen i
// loopkroppen gav tests 339, pass 339, fail 0 och EXIT=0 så länge fallet bara
// mätte en post vars korrigeringsloop kör noll varv (LARDOMAR.md 2026-09-14).
// Därför mäter fallet två poster — en där loopen kör noll varv och en där den
// kör ett — och den andra har också en undre gräns.
//
// Uppmätt på den här maskinen med den ostörda koden och omslutningen nedan:
//   start 1970-01-31 monthly today 2026-08-18: anrop=1 varv=0 svar=2026-08-31
//   start 1970-01-15 monthly today 2026-08-18: anrop=2 varv=1 svar=2026-09-15
// Samma två indata med let k = 0 i stället för steg 2:
//   start 1970-01-31 monthly today 2026-08-18: anrop=680 varv=679 svar=2026-08-31
//   start 1970-01-15 monthly today 2026-08-18: anrop=681 varv=680 svar=2026-09-15
//
// (S3)
test('nextDueDate hoppar till rätt period i stället för att räkna varv för varv', () => {
  // En egen räknare per post: ett delat tal kan inte skilja de två posternas
  // anrop åt, och det är just den skillnaden fallet mäter.
  function raknandeAddMonths() {
    const matning = { anrop: 0 };
    matning.addMonths = (isoDate, months) => {
      matning.anrop += 1;
      return addMonthsClamped(isoDate, months);
    };
    return matning;
  }

  // Noll varv i korrigeringsloopen: occurrence efter steg 2 ligger redan på
  // eller efter today, så taket ser bara steg 2:s anrop.
  const utanVarv = raknandeAddMonths();
  const entry = post({ startDate: '1970-01-31', interval: 'monthly' });
  // Samma svar som utan omslutningen: omslutningen får inte ändra resultatet,
  // annars mäter fallet något annat än produktionsvägen.
  assert.equal(nextDueDate(entry, '2026-08-18', utanVarv.addMonths), '2026-08-31');
  assert.equal(nextDueDate(entry, '2026-08-18'), '2026-08-31');

  assert.ok(
    utanVarv.anrop <= 3,
    `addMonths anropades ${utanVarv.anrop} gånger för startDate 1970-01-31 mot today 2026-08-18: steg 2 hoppar inte till rätt period utan räknar varv för varv`
  );

  // Ett varv i korrigeringsloopen: steg 2 landar på 2026-08-15, som ligger före
  // today, så loopkroppen kör en gång. Ett anrop från vardera stället, alltså
  // två.
  const medVarv = raknandeAddMonths();
  const entryMedVarv = post({ startDate: '1970-01-15', interval: 'monthly' });
  assert.equal(nextDueDate(entryMedVarv, '2026-08-18', medVarv.addMonths), '2026-09-15');
  assert.equal(nextDueDate(entryMedVarv, '2026-08-18'), '2026-09-15');

  // Undre gränsen: den faller så snart ett av de två occurrence-stegen slutar gå
  // genom parametern — loopkroppens steg eller steg 2 — och det är den enda av
  // fallets gränser som kan göra det.
  assert.ok(
    medVarv.anrop >= 2,
    `addMonths anropades ${medVarv.anrop} gånger för startDate 1970-01-15 mot today 2026-08-18, där korrigeringsloopen kör ett varv: ett av occurrence-stegen går inte genom parametern — loopkroppen eller steg 2 anropar addMonthsClamped direkt`
  );
  assert.ok(
    medVarv.anrop <= 3,
    `addMonths anropades ${medVarv.anrop} gånger för startDate 1970-01-15 mot today 2026-08-18: steg 2 hoppar inte till rätt period utan räknar varv för varv`
  );
});

// --- nextDueDate: ingångsspärrar ---------------------------------------------

test('nextDueDate kastar RangeError för något som inte är en post', () => {
  for (const value of ICKE_POSTER) {
    assert.throws(() => nextDueDate(value, '2026-08-18'), {
      name: 'RangeError',
      message: 'nextDueDate kräver en post som objekt.'
    }, String(value));
  }
  // En array med de sex fälten påsatta är inte heller en post.
  const arr = [];
  Object.assign(arr, post());
  assert.throws(() => nextDueDate(arr, '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver en post som objekt.'
  });
});

test('nextDueDate avvisar ett Date på intervalraden, inte på objektraden', () => {
  // isPlainObject äger villkoret "vanligt objekt" och säger true för ett Date.
  // schedule.js skriver ingen egen, strängare kopia — posten faller på nästa rad.
  assert.throws(() => nextDueDate(new Date(), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "undefined".'
  });
  assert.throws(() => upcoming([new Date()], '2026-08-18'), RangeError);
});

// (S4) Prototypnycklarna asserterar hela message och inte bara feltypen. En
// assertion mot enbart RangeError kan inte skilja en spärr från en annan spärr
// längre ned i kedjan: med det sanningsprövade uppslaget kastar koden
// fortfarande RangeError, men från addMonthsClamped och med ett meddelande som
// pekar ut fel orsak — och mutationen överlevde då med grön svit (LARDOMAR.md
// 2026-09-16).
test('nextDueDate kastar RangeError för ett interval utanför tabellen', () => {
  assert.throws(() => nextDueDate(post({ interval: 'weekly' }), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "weekly".'
  });
  assert.throws(() => nextDueDate(post({ interval: undefined }), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "undefined".'
  });
  // Object.hasOwn och inte ett sanningsprövat uppslag: annars hittar de här
  // nycklarna något på prototypen. Hela meddelandet krävs, eftersom det är
  // meddelandet och inte feltypen som skiljer de två skrivsätten åt.
  for (const interval of ['constructor', 'toString', 'hasOwnProperty', '__proto__']) {
    assert.throws(() => nextDueDate(post({ interval }), '2026-08-18'), {
      name: 'RangeError',
      message: `nextDueDate kräver ett känt interval, fick "${interval}".`
    }, interval);
  }
  for (const interval of [null, 0, 1, true, {}, [], 1n, Symbol('x'), NaN, Infinity, -Infinity, -0]) {
    assert.throws(() => nextDueDate(post({ interval }), '2026-08-18'), RangeError, String(interval));
  }
});

test('nextDueDate kastar RangeError för ett startDate som inte är ÅÅÅÅ-MM-DD', () => {
  for (const startDate of ['2026-1-5', '2026-02-30', '2026-13-01', '', ' 2026-08-18', 20260818, null, undefined, 1n, Symbol('x'), NaN, -0, {}, []]) {
    assert.throws(() => nextDueDate(post({ startDate }), '2026-08-18'), RangeError, String(startDate));
  }
  assert.throws(() => nextDueDate(post({ startDate: '2026-02-30' }), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett startDate på formen ÅÅÅÅ-MM-DD, fick "2026-02-30".'
  });
});

test('nextDueDate kastar RangeError för ett dagens datum som inte är ÅÅÅÅ-MM-DD', () => {
  for (const today of ['2026-8-18', '2026-02-30', '', ' 2026-08-18', 20260818, null, undefined, 1n, Symbol('x'), NaN, Infinity, -Infinity, -0, {}, []]) {
    assert.throws(() => nextDueDate(post(), today), RangeError, String(today));
  }
  assert.throws(() => nextDueDate(post(), 'idag'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "idag".'
  });
});

test('nextDueDate kastar RangeError för ett addMonths som inte är en funktion', () => {
  // 1n och Symbol('x') står först i listan: de är de två typer där aritmetik
  // eller ett anrop kastar TypeError i stället för att ge ett hanterbart värde,
  // alltså just de värden en typvakt som räknar vidare missar (LARDOMAR.md
  // 2026-08-24).
  // undefined står inte i listan: det är förvalets signal och prövas för sig
  // längst ned i fallet.
  for (const addMonths of [1n, Symbol('x'), null, 'addMonthsClamped', 42, true, NaN, {}, [], new Date()]) {
    assert.throws(() => nextDueDate(post(), '2026-08-18', addMonths), RangeError, String(addMonths));
  }
  assert.throws(() => nextDueDate(post(), '2026-08-18', null), {
    name: 'RangeError',
    message: 'nextDueDate kräver att addMonths är en funktion, fick "null".'
  });
  assert.throws(() => nextDueDate(post(), '2026-08-18', 1n), {
    name: 'RangeError',
    message: 'nextDueDate kräver att addMonths är en funktion, fick "1".'
  });
  // undefined är förvalet och når aldrig spärren: ett utelämnat argument ger
  // addMonthsClamped. Ett utskrivet undefined gör det också, och det är facit.
  assert.equal(nextDueDate(post(), '2026-08-18', undefined), '2026-09-01');
});

test('en klass tar sig förbi typeof-spärren och kastar TypeError vid anropet', () => {
  // Dokumenterad gräns, inte ett fel i koden: typeof (class C {}) är
  // 'function', så en klass passerar raden typeof addMonths !== 'function', och
  // anropet kastar TypeError: Class constructor C cannot be invoked without
  // 'new'. ARKITEKTUR.md, "Parameterns kontrakt: vad som bevakas och vad som
  // bara är dokumenterat": ledet "går att anropa" har ingen ägare och får ingen
  // spärr i schedule.js — bara ledet "ger ett datum" bevakas, av
  // compareIsoDates.
  //
  // Fallet naglar fast gränsen åt båda hållen. Att ett RangeError inte är ett
  // TypeError gör assertionen till ett krav på att spärren inte finns: inför
  // någon senare en spärr som gör klassen till ett RangeError faller det här
  // fallet, och då ska avsnittet i ARKITEKTUR.md skrivas om först.
  //
  // Klassen är ofarlig att skicka in: den kastar vid anropet och når aldrig
  // korrigeringsloopen. En addMonths som ger ett datum utan att flytta
  // occurrence framåt (() => '1970-01-01') hänger i stället för alltid, och en
  // hängning ger ingen exitkod alls (LARDOMAR.md 2026-09-04) — därför skickar
  // ingen testfil in en sådan.
  //
  // Fallet är onumrerat: det följer av spärrtabellen och är inte det enda som
  // fäller en namngiven mutation.
  class C {}
  assert.throws(() => nextDueDate(post(), '2026-08-18', C), TypeError);
});

test('spärren för addMonths står sist: en trasig post avvisas som post, inte som addMonths', () => {
  // Indatan där placeringen ändrar svaret. Med raden sist ger anropet
  // postspärrens meddelande; med raden först parameterns (ARKITEKTUR.md,
  // "Spärren för det injicerade värdet"). Samma prövning för de tre övriga
  // raderna, så att hela företrädet är kört och inte bara den första.
  assert.throws(() => nextDueDate(5, '2026-09-14', null), {
    name: 'RangeError',
    message: 'nextDueDate kräver en post som objekt.'
  });
  assert.throws(() => nextDueDate(post({ interval: 'weekly' }), '2026-09-14', null), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "weekly".'
  });
  assert.throws(() => nextDueDate(post({ startDate: 'imorgon' }), '2026-09-14', null), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett startDate på formen ÅÅÅÅ-MM-DD, fick "imorgon".'
  });
  assert.throws(() => nextDueDate(post(), 'idag', null), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "idag".'
  });
});

test('ett addMonths som ger något annat än ett datum avvisas av compareIsoDates', () => {
  // Returvärdet har ingen egen spärr i schedule.js: compareIsoDates i dates.js
  // äger frågan "är det här ett datum" och kastar med sitt eget namn. En andra
  // kopia av villkoret här vore samma fel som cost.js svagare kopia av "är
  // detta ett objekt" (LARDOMAR.md 2026-09-02).
  assert.throws(() => nextDueDate(post(), '2026-09-14', () => 'skräp'), {
    name: 'RangeError',
    message: 'compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "skräp" som första argument.'
  });
});

test('nextDueDate läser inte amountSek — beloppet är cost.js domän', () => {
  // Facit, inte en lucka: schedule.js svarar på när en post dras, aldrig på hur
  // mycket den kostar. Ett negativt eller skadat belopp avvisas av cost.js och
  // av entry.js, inte här.
  for (const amountSek of [-100, 0, NaN, Infinity, -Infinity, -0, '199', null, undefined, 1n, Symbol('x')]) {
    assert.equal(nextDueDate(post({ amountSek }), '2026-08-18'), '2026-09-01', String(amountSek));
  }
});

// --- upcoming: fältet daysUntil ----------------------------------------------

// Storheten "dagar kvar" bor i fältet daysUntil på upcomings UpcomingItem, och
// upcoming är enda vägen dit: exporten daysUntilNextDue togs bort i paket 7,
// eftersom den inte ägde något begrepp och inte hade någon anropare i src/
// (ARKITEKTUR.md, beslutsloggen). Proven nedan hade tidigare funktionen som
// ingång och går nu genom en lista, med oförändrad indata och oförändrade
// förväntade tal. Provet som ärvde spärrarna blev efter omskrivningen ordagrant
// samma som "upcoming kastar RangeError för en post som inte duger" och är
// sammanslaget med det; bara raden över ICKE_POSTER var ny och står där nu.

function dagarKvar(entry, today) {
  return upcoming([entry], today)[0].daysUntil;
}

test('upcoming ger daysUntil 0 när nästa dragning är idag', () => {
  const dagar = dagarKvar(post({ startDate: '2026-08-18', interval: 'monthly' }), '2026-08-18');
  assert.equal(dagar, 0);
  assert.equal(Object.is(dagar, -0), false, 'aldrig -0');
});

test('upcoming räknar daysUntil till facittabellens datum', () => {
  const facit = [
    ['2026-09-01', 'monthly', '2026-08-18', 14],
    ['2026-08-18', 'monthly', '2026-08-18', 0],
    ['2026-01-31', 'monthly', '2026-02-01', 27],
    ['2026-01-31', 'monthly', '2026-03-01', 30],
    ['2024-02-29', 'yearly', '2026-08-18', 194],
    ['2020-03-31', 'quarterly', '2026-08-18', 43],
    ['2026-12-31', 'quarterly', '2026-08-18', 135]
  ];
  for (const [startDate, interval, today, forvantat] of facit) {
    assert.equal(dagarKvar(post({ startDate, interval }), today), forvantat, `${startDate} ${interval} ${today}`);
  }
});

test('upcomings daysUntil är aldrig negativ och alltid ett heltal', () => {
  for (const interval of INTERVALS) {
    for (const startDate of ['1970-01-31', '2020-02-29', '2026-08-17', '2026-08-18', '2026-08-19', '2030-01-01']) {
      const dagar = dagarKvar(post({ startDate, interval }), '2026-08-18');
      assert.equal(Number.isSafeInteger(dagar), true, `${interval} ${startDate} gav ${dagar}`);
      assert.equal(dagar >= 0, true, `${interval} ${startDate} gav ${dagar}`);
      assert.equal(Object.is(dagar, -0), false, `${interval} ${startDate}`);
    }
  }
});

test('upcomings daysUntil påverkas inte av sommartid', () => {
  // Sommartid börjar 2026-03-29 och slutar 2026-10-25 i Sverige. Räkningen sker
  // i UTC, så dygnen är 24 timmar även över skiftet.
  assert.equal(dagarKvar(post({ startDate: '2026-03-30', interval: 'monthly' }), '2026-03-28'), 2);
  assert.equal(dagarKvar(post({ startDate: '2026-10-26', interval: 'monthly' }), '2026-10-24'), 2);
});

// --- upcoming ----------------------------------------------------------------

test('upcoming ger tom lista för tom lista', () => {
  assert.deepEqual(upcoming([], '2026-08-18'), []);
});

test('upcoming ger posten, dess nästa dragning och antal dagar kvar', () => {
  const hyra = post({ id: 'a1', name: 'Hyra', startDate: '2026-09-01' });
  const rader = upcoming([hyra], '2026-08-18');
  assert.equal(rader.length, 1);
  assert.equal(rader[0].entry, hyra, 'posten skickas vidare som den är');
  assert.equal(rader[0].nextDueDate, '2026-09-01');
  assert.equal(rader[0].daysUntil, 14);
  assert.deepEqual(Object.keys(rader[0]).sort(), ['daysUntil', 'entry', 'nextDueDate']);
});

test('upcoming sorterar stigande på nästa dragning', () => {
  const entries = [
    post({ id: 'c', name: 'Sent', startDate: '2026-12-01' }),
    post({ id: 'a', name: 'Tidigt', startDate: '2026-08-20' }),
    post({ id: 'b', name: 'Mitten', startDate: '2026-09-15' })
  ];
  const rader = upcoming(entries, '2026-08-18');
  assert.deepEqual(rader.map((rad) => rad.nextDueDate), ['2026-08-20', '2026-09-15', '2026-12-01']);
  assert.deepEqual(rader.map((rad) => rad.entry.id), ['a', 'b', 'c']);
});

test('upcoming avgör lika datum med name i svensk ordning', () => {
  // Å, Ä och Ö sorteras sist i svenskan, efter Z — inte som A och O.
  // localeCompare(b.name, 'sv') skrivs med språket utsatt så att ordningen inte
  // beror på maskinens systemspråk.
  const entries = [
    post({ id: '1', name: 'Ångbåt', startDate: '2026-09-01' }),
    post({ id: '2', name: 'Zebra', startDate: '2026-09-01' }),
    post({ id: '3', name: 'alfa', startDate: '2026-09-01' }),
    post({ id: '4', name: 'Bredband', startDate: '2026-09-01' }),
    post({ id: '5', name: 'Öl', startDate: '2026-09-01' })
  ];
  const rader = upcoming(entries, '2026-08-18');
  assert.deepEqual(rader.map((rad) => rad.entry.name), ['alfa', 'Bredband', 'Zebra', 'Ångbåt', 'Öl']);
  assert.equal('Ångbåt'.localeCompare('Zebra', 'sv') > 0, true, 'Å efter Z');
  assert.equal('Öl'.localeCompare('Ångbåt', 'sv') > 0, true, 'Ö efter Å');
});

// Argumentet 'sv' i localeCompare(b.name, 'sv') finns för att ordningen inte ska
// bero på körmiljöns språk. Testet ovan kan inte visa det: det prövar bara
// utfallet, och utfallet är detsamma så länge maskinens standardspråk råkar vara
// svenskt. Mutationen "ta bort 'sv'" gav tests 331, pass 331, fail 0 och EXIT=0
// på en maskin där new Intl.Collator().resolvedOptions().locale ger sv-SE
// (LARDOMAR.md 2026-09-12). app.js kör i webbläsaren, där språket är
// användarens.
//
// Det här fallet ser därför på vad koden begär och inte bara på vad den råkar
// få: varje kollationsbegäran under sorteringen fångas, och minst en av dem
// måste vara utskriven och ge svensk ordning. Utan argumentet är locales
// undefined i varje anrop, listan över utskrivna begäranden blir tom, och
// fallet faller — oavsett vilket språk maskinen kör med.
//
// Att fånga begäran binder testet till att jämförelsen sker under anropet.
// Skrivs sorteringen om till en kollator som byggs en gång vid modulladdningen
// måste det här fallet skrivas om; en sådan kollator syns inte härifrån.
//
// (S2)
test('upcoming begär svensk kollation utskriven, inte körmiljöns standardspråk', () => {
  // Namnen bär kodpunkterna U+00C5 Å, U+00E5 å och U+00D6 Ö, som är det här
  // fallet prövar. De skrivs rått, som i fallet ovan och i resten av projektet:
  // escapen är till för tecken som inte går att se (LARDOMAR.md 2026-09-14).
  const ANGBAT = 'Ångbåt';
  const ZEBRA = 'Zebra';
  const OL = 'Öl';

  // Motexemplet som gör resten meningsfull: svenskan sorterar Å efter Z,
  // engelskan sorterar det som ett A. Ger de två samma svar i den här
  // körmiljön är ICU-datan inte den väntade, och då säger de här två raderna
  // det i klartext i stället för att fallet nedan blir sant av sig självt.
  assert.equal(new Intl.Collator('sv').compare(ANGBAT, ZEBRA) > 0, true, 'sv: A-ring efter Z');
  assert.equal(new Intl.Collator('en').compare(ANGBAT, ZEBRA) < 0, true, 'en: A-ring som ett A');

  const entries = [
    post({ id: '1', name: ANGBAT, startDate: '2026-09-01' }),
    post({ id: '2', name: ZEBRA, startDate: '2026-09-01' }),
    post({ id: '3', name: OL, startDate: '2026-09-01' })
  ];

  // Begäran fångas på båda sätten att be om en kollation: locales-argumentet
  // till String.prototype.localeCompare och till Intl.Collator. Båda läggs
  // tillbaka i finally, så att inget senare fall i filen ser attrapperna.
  const begarda = [];
  const origLocaleCompare = String.prototype.localeCompare;
  const OrigCollator = Intl.Collator;
  function SpionCollator(locales, options) {
    begarda.push(locales);
    return new OrigCollator(locales, options);
  }
  SpionCollator.prototype = OrigCollator.prototype;
  SpionCollator.supportedLocalesOf = (...args) => OrigCollator.supportedLocalesOf(...args);

  let rader;
  try {
    String.prototype.localeCompare = function (that, locales, options) {
      begarda.push(locales);
      return origLocaleCompare.call(this, that, locales, options);
    };
    Intl.Collator = SpionCollator;
    rader = upcoming(entries, '2026-08-18');
  } finally {
    String.prototype.localeCompare = origLocaleCompare;
    Intl.Collator = OrigCollator;
  }

  assert.deepEqual(rader.map((rad) => rad.entry.name), [ZEBRA, ANGBAT, OL]);
  assert.equal(begarda.length > 0, true, 'sorteringen jämförde aldrig namnen');

  // undefined betyder körmiljöns standardspråk och räknas inte som utskriven.
  const utskrivna = begarda.filter((locales) => locales !== undefined);
  assert.equal(
    utskrivna.length > 0,
    true,
    'kollationen begärdes utan språk: ordningen beror då på körmiljöns standardspråk'
  );
  for (const locales of utskrivna) {
    assert.equal(
      new OrigCollator(locales).compare(ANGBAT, ZEBRA) > 0,
      true,
      'det begärda språket ' + JSON.stringify(locales) + ' ger inte svensk ordning'
    );
  }
});

test('upcoming avgör lika namn med id i vanlig strängjämförelse', () => {
  const entries = [
    post({ id: 'c', name: 'Samma', startDate: '2026-09-01' }),
    post({ id: 'a', name: 'Samma', startDate: '2026-09-01' }),
    post({ id: 'B', name: 'Samma', startDate: '2026-09-01' })
  ];
  const rader = upcoming(entries, '2026-08-18');
  // Vanlig strängjämförelse, inte localeCompare: versalen 'B' har lägre
  // kodpunkt än gemenerna och kommer först.
  assert.deepEqual(rader.map((rad) => rad.entry.id), ['B', 'a', 'c']);
});

test('upcoming ger samma ordning oavsett inmatningsordning', () => {
  const entries = [
    post({ id: '1', name: 'B', startDate: '2026-09-01' }),
    post({ id: '2', name: 'A', startDate: '2026-09-01' }),
    post({ id: '3', name: 'A', startDate: '2026-08-20' }),
    post({ id: '4', name: 'A', startDate: '2026-09-01' })
  ];
  const forvantat = ['3', '2', '4', '1'];
  assert.deepEqual(upcoming(entries, '2026-08-18').map((rad) => rad.entry.id), forvantat);
  assert.deepEqual(upcoming([...entries].reverse(), '2026-08-18').map((rad) => rad.entry.id), forvantat);
  assert.deepEqual(upcoming([entries[2], entries[0], entries[3], entries[1]], '2026-08-18').map((rad) => rad.entry.id), forvantat);
});

test('upcoming kastar RangeError för något som inte är en lista', () => {
  for (const value of ['abc', null, undefined, 42, true, 1n, Symbol('x'), {}, post()]) {
    assert.throws(() => upcoming(value, '2026-08-18'), {
      name: 'RangeError',
      message: 'upcoming kräver en lista med poster.'
    }, String(value));
  }
});

test('upcoming kastar RangeError för en post som inte duger', () => {
  assert.throws(() => upcoming([post(), undefined], '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver en post som objekt.'
  });
  assert.throws(() => upcoming([post({ interval: 'weekly' })], '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "weekly".'
  });
  assert.throws(() => upcoming([post({ interval: undefined })], '2026-08-18'), RangeError);
  assert.throws(() => upcoming([post({ startDate: '2026-02-30' })], '2026-08-18'), RangeError);
  assert.throws(() => upcoming([post()], 'idag'), RangeError);
  // Hit flyttades raden ur det borttagna fallet "daysUntilNextDue ärver
  // nextDueDates spärrar utan att skriva om dem"; filens övriga rader var
  // ordagrant samma som de här.
  for (const value of ICKE_POSTER) {
    assert.throws(() => upcoming([value], '2026-08-18'), RangeError, String(value));
  }
  // Beloppet läses inte av upcoming.
  assert.equal(upcoming([post({ amountSek: -100, startDate: '2026-09-01' })], '2026-08-18')[0].daysUntil, 14);
});

test('upcoming kastar RangeError för ett name som inte är en sträng', () => {
  // Sorteringen anropar localeCompare på name. Kontrollen sker för varje post
  // och inte bara när två datum råkar vara lika.
  for (const name of [undefined, null, 42, true, 1n, Symbol('x'), {}, []]) {
    assert.throws(() => upcoming([post({ name })], '2026-08-18'), RangeError, String(name));
  }
  assert.throws(() => upcoming([post({ name: 42 })], '2026-08-18'), {
    name: 'RangeError',
    message: 'upcoming kräver ett name som sträng, fick "42".'
  });
  // Också med en enda post, där ingen jämförelse görs.
  assert.throws(() => upcoming([post({ name: null })], '2026-08-18'), RangeError);
});

test('upcoming kastar RangeError för ett id som inte är en icke-tom sträng', () => {
  for (const id of ['', '   ', undefined, null, 42, true, 1n, Symbol('x'), {}, []]) {
    assert.throws(() => upcoming([post({ id })], '2026-08-18'), RangeError, String(id));
  }
  assert.throws(() => upcoming([post({ id: '' })], '2026-08-18'), {
    name: 'RangeError',
    message: 'upcoming kräver ett id som är en icke-tom sträng, fick "".'
  });
});

// Fallet hette tidigare "upcoming räknar samma svar som daysUntilNextDue och
// nextDueDate för varje post". daysUntilNextDue finns inte längre, och
// daysUntil jämförs därför med ägarfunktionen daysBetween i dates.js — inte med
// en handskriven kopia av uttrycket här.
test('upcoming räknar samma svar som nextDueDate och daysBetween för varje post', () => {
  const today = '2026-08-18';
  const entries = INTERVALS.flatMap((interval, index) => [
    post({ id: `x${index}`, name: `Post ${index}`, interval, startDate: '2020-03-31' }),
    post({ id: `y${index}`, name: `Post ${index}`, interval, startDate: '2026-12-31' })
  ]);
  for (const rad of upcoming(entries, today)) {
    assert.equal(rad.nextDueDate, nextDueDate(rad.entry, today), rad.entry.id);
    assert.equal(rad.daysUntil, daysBetween(today, rad.nextDueDate), rad.entry.id);
  }
});

// Indata där mer än ett villkor är sant samtidigt, ur tabellen under
// "Ingångsspärrar i src/core/schedule.js" i ARKITEKTUR.md. Loopens ordning
// avgör: nextDueDate-kedjan körs för varje post innan name och id prövas för
// samma post, och posternas ordning i listan avgör vilken post som hinner
// först. De två fallen skiljer sig bara i inmatningsordningen.
test('upcoming ger första postens name-fel när en senare post har ett okänt interval', () => {
  assert.throws(() => upcoming([post({ name: 42 }), post({ interval: 'weekly' })], '2026-08-18'), {
    name: 'RangeError',
    message: 'upcoming kräver ett name som sträng, fick "42".'
  });
});

test('upcoming ger första postens intervalfel när en senare post har ett name som inte är en sträng', () => {
  assert.throws(() => upcoming([post({ interval: 'weekly' }), post({ name: 42 })], '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "weekly".'
  });
});

// (S5) Sista raden i compareUpcoming, return 0;, är modulens enda rad utan
// täckning. Assertionen ligger på jämförarens eget svar och inte på den
// sorterade listan: en sorterad lista kan inte skilja 0 från 1 utan att luta
// sig mot hur körmiljöns sortering behandlar en jämförare som inte är reflexiv,
// och det är inget projektet får bygga ett prov på (LARDOMAR.md 2026-09-22).
//
// Kravet ligger i testdatan: de två posterna är lika på nextDueDate, name och
// id. Skiljer de sig på någon av dem svarar en tidigare rad i kedjan, och
// fallet prövar då inte den sista raden. Att två poster kan bära samma id är
// inget projektet förbjuder — ingenting i src/core/ kräver att id är unikt.
test('compareUpcoming svarar 0 för två poster som är lika på varje nyckel', () => {
  const tvilling = { id: 'a1', name: 'Hyra', startDate: '2026-01-01', interval: 'monthly' };
  const items = upcoming([post(tvilling), post(tvilling)], '2026-01-01');
  assert.equal(items.length, 2);

  const [forsta, andra] = items;
  // Utan de tre raderna nedan kan fallet passera på en tidigare rad i kedjan.
  assert.equal(forsta.nextDueDate, andra.nextDueDate);
  assert.equal(forsta.entry.name, andra.entry.name);
  assert.equal(forsta.entry.id, andra.entry.id);

  assert.equal(compareUpcoming(forsta, andra), 0, 'jämföraren är inte symmetrisk för två lika items');
  assert.equal(compareUpcoming(andra, forsta), 0, 'jämföraren är inte symmetrisk för två lika items');
  assert.equal(compareUpcoming(forsta, forsta), 0, 'jämföraren är inte reflexiv');
});
