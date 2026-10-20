import { test } from 'node:test';
import assert from 'node:assert/strict';

import { addMonthsClamped, daysBetween } from '../src/core/dates.js';
import { INTERVALS } from '../src/core/entry.js';
import { compareUpcoming, MONTHS_PER_PERIOD, nextDueDate, upcoming } from '../src/core/schedule.js';

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

const ICKE_POSTER = [null, undefined, 'abc', 42, true, 1n, Symbol('x'), [], [1]];

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

  const januari = post({ startDate: '2026-01-15', interval: 'semiannual' });
  assert.equal(nextDueDate(januari, '2026-02-01'), '2026-07-15');
  assert.equal(nextDueDate(januari, '2026-07-15'), '2026-07-15');
  assert.equal(nextDueDate(januari, '2026-07-16'), '2027-01-15');

  assert.equal(
    nextDueDate(post({ startDate: '2020-08-31', interval: 'semiannual' }), '2026-09-25'),
    '2027-02-28'
  );
});

test('nextDueDate klampar från startDate också i korrigeringsloopen', () => {
  const kvartal = post({ startDate: '2026-01-31', interval: 'quarterly' });
  assert.equal(
    nextDueDate(kvartal, '2026-04-30'),
    '2026-04-30',
    'en occurrence som är lika med today korrigeras inte vidare: svaret är den klampade 2026-04-30'
  );
  assert.equal(nextDueDate(kvartal, '2026-06-15'), '2026-07-31');

  const ar = post({ startDate: '2024-02-29', interval: 'yearly' });
  assert.equal(
    nextDueDate(ar, '2027-02-28'),
    '2027-02-28',
    'en occurrence som är lika med today korrigeras inte vidare: svaret är den klampade 2027-02-28'
  );
  assert.equal(nextDueDate(ar, '2027-03-15'), '2028-02-29');
});

test('nextDueDate hoppar direkt till rätt trakt för en start långt tillbaka', () => {
  assert.equal(nextDueDate(post({ startDate: '1970-01-31', interval: 'monthly' }), '2026-08-18'), '2026-08-31');
  assert.equal(nextDueDate(post({ startDate: '1970-01-31', interval: 'quarterly' }), '2026-08-18'), '2026-10-31');
  assert.equal(nextDueDate(post({ startDate: '1970-02-28', interval: 'yearly' }), '2026-08-18'), '2027-02-28');
});

test('nextDueDate hoppar till rätt period i stället för att räkna varv för varv', () => {
  function raknandeAddMonths() {
    const matning = { anrop: 0 };
    matning.addMonths = (isoDate, months) => {
      matning.anrop += 1;
      return addMonthsClamped(isoDate, months);
    };
    return matning;
  }

  const utanVarv = raknandeAddMonths();
  const entry = post({ startDate: '1970-01-31', interval: 'monthly' });
  assert.equal(nextDueDate(entry, '2026-08-18', utanVarv.addMonths), '2026-08-31');
  assert.equal(nextDueDate(entry, '2026-08-18'), '2026-08-31');

  assert.ok(
    utanVarv.anrop <= 3,
    `addMonths anropades ${utanVarv.anrop} gånger för startDate 1970-01-31 mot today 2026-08-18: steg 2 hoppar inte till rätt period utan räknar varv för varv`
  );

  const medVarv = raknandeAddMonths();
  const entryMedVarv = post({ startDate: '1970-01-15', interval: 'monthly' });
  assert.equal(nextDueDate(entryMedVarv, '2026-08-18', medVarv.addMonths), '2026-09-15');
  assert.equal(nextDueDate(entryMedVarv, '2026-08-18'), '2026-09-15');

  assert.ok(
    medVarv.anrop >= 2,
    `addMonths anropades ${medVarv.anrop} gånger för startDate 1970-01-15 mot today 2026-08-18, där korrigeringsloopen kör ett varv: ett av occurrence-stegen går inte genom parametern — loopkroppen eller steg 2 anropar addMonthsClamped direkt`
  );
  assert.ok(
    medVarv.anrop <= 3,
    `addMonths anropades ${medVarv.anrop} gånger för startDate 1970-01-15 mot today 2026-08-18: steg 2 hoppar inte till rätt period utan räknar varv för varv`
  );
});

test('nextDueDate kastar RangeError för något som inte är en post', () => {
  for (const value of ICKE_POSTER) {
    assert.throws(() => nextDueDate(value, '2026-08-18'), {
      name: 'RangeError',
      message: 'nextDueDate kräver en post som objekt.'
    }, String(value));
  }
  const arr = [];
  Object.assign(arr, post());
  assert.throws(() => nextDueDate(arr, '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver en post som objekt.'
  });
});

test('nextDueDate avvisar ett Date på intervalraden, inte på objektraden', () => {
  assert.throws(() => nextDueDate(new Date(), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "undefined".'
  });
  assert.throws(() => upcoming([new Date()], '2026-08-18'), RangeError);
});

test('nextDueDate kastar RangeError för ett interval utanför tabellen', () => {
  assert.throws(() => nextDueDate(post({ interval: 'weekly' }), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "weekly".'
  });
  assert.throws(() => nextDueDate(post({ interval: undefined }), '2026-08-18'), {
    name: 'RangeError',
    message: 'nextDueDate kräver ett känt interval, fick "undefined".'
  });
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
  assert.equal(nextDueDate(post(), '2026-08-18', undefined), '2026-09-01');
});

test('en klass tar sig förbi typeof-spärren och kastar TypeError vid anropet', () => {
  class C {}
  assert.throws(() => nextDueDate(post(), '2026-08-18', C), TypeError);
});

test('spärren för addMonths står sist: en trasig post avvisas som post, inte som addMonths', () => {
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
  assert.throws(() => nextDueDate(post(), '2026-09-14', () => 'skräp'), {
    name: 'RangeError',
    message: 'compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "skräp" som första argument.'
  });
});

test('nextDueDate läser inte amountSek — beloppet är cost.js domän', () => {
  for (const amountSek of [-100, 0, NaN, Infinity, -Infinity, -0, '199', null, undefined, 1n, Symbol('x')]) {
    assert.equal(nextDueDate(post({ amountSek }), '2026-08-18'), '2026-09-01', String(amountSek));
  }
});

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
  assert.equal(dagarKvar(post({ startDate: '2026-03-30', interval: 'monthly' }), '2026-03-28'), 2);
  assert.equal(dagarKvar(post({ startDate: '2026-10-26', interval: 'monthly' }), '2026-10-24'), 2);
});

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

test('upcoming begär svensk kollation utskriven, inte körmiljöns standardspråk', () => {
  const ANGBAT = 'Ångbåt';
  const ZEBRA = 'Zebra';
  const OL = 'Öl';

  assert.equal(new Intl.Collator('sv').compare(ANGBAT, ZEBRA) > 0, true, 'sv: A-ring efter Z');
  assert.equal(new Intl.Collator('en').compare(ANGBAT, ZEBRA) < 0, true, 'en: A-ring som ett A');

  const entries = [
    post({ id: '1', name: ANGBAT, startDate: '2026-09-01' }),
    post({ id: '2', name: ZEBRA, startDate: '2026-09-01' }),
    post({ id: '3', name: OL, startDate: '2026-09-01' })
  ];

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
  for (const value of ICKE_POSTER) {
    assert.throws(() => upcoming([value], '2026-08-18'), RangeError, String(value));
  }
  assert.equal(upcoming([post({ amountSek: -100, startDate: '2026-09-01' })], '2026-08-18')[0].daysUntil, 14);
});

test('upcoming kastar RangeError för ett name som inte är en sträng', () => {
  for (const name of [undefined, null, 42, true, 1n, Symbol('x'), {}, []]) {
    assert.throws(() => upcoming([post({ name })], '2026-08-18'), RangeError, String(name));
  }
  assert.throws(() => upcoming([post({ name: 42 })], '2026-08-18'), {
    name: 'RangeError',
    message: 'upcoming kräver ett name som sträng, fick "42".'
  });
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

test('compareUpcoming svarar 0 för två poster som är lika på varje nyckel', () => {
  const tvilling = { id: 'a1', name: 'Hyra', startDate: '2026-01-01', interval: 'monthly' };
  const items = upcoming([post(tvilling), post(tvilling)], '2026-01-01');
  assert.equal(items.length, 2);

  const [forsta, andra] = items;
  assert.equal(forsta.nextDueDate, andra.nextDueDate);
  assert.equal(forsta.entry.name, andra.entry.name);
  assert.equal(forsta.entry.id, andra.entry.id);

  assert.equal(compareUpcoming(forsta, andra), 0, 'jämföraren är inte symmetrisk för två lika items');
  assert.equal(compareUpcoming(andra, forsta), 0, 'jämföraren är inte symmetrisk för två lika items');
  assert.equal(compareUpcoming(forsta, forsta), 0, 'jämföraren är inte reflexiv');
});
