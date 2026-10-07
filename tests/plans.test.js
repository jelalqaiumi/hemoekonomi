// Kravlistan (P1) till (P5) för src/core/plans.js i ARKITEKTUR.md under
// "Del 5: planer och behörighet".
//
// Modulen är ren kärna och har inga sidoeffekter: inget fall behöver något
// utgångsläge och inget fall städar.
import assert from 'node:assert/strict';
import test from 'node:test';

import { FEATURES, FEATURE_LABELS, PLANS, PLAN_LABELS, hasFeature, isPlanKey, planFor } from '../src/core/plans.js';

// Varje funktion som står i någon plans lista, i planordning. Används av (P5)
// och av det prov som binder PLAN_LABELS till PLANS.
function featuresInPlans() {
  return Object.keys(PLANS).flatMap((key) => [...PLANS[key].features]);
}

// (P1) hasFeature ärver uppåt.
test('hasFeature ärver uppåt: Premium har budget, Bas har inte reports', () => {
  // Premium har varje lägre plans funktion, fastän ingen av dem står i
  // premium.features.
  assert.equal(hasFeature('premium', 'budget'), true);
  assert.equal(hasFeature('premium', 'reports'), true);
  assert.equal(hasFeature('premium', 'prioritySupport'), true);

  // Arvet går bara uppåt: bas har inte plus funktioner, plus inte premiums.
  assert.equal(hasFeature('bas', 'reports'), false);
  assert.equal(hasFeature('bas', 'savingsGoals'), false);
  assert.equal(hasFeature('plus', 'customFeatures'), false);

  // Plus har både sina egna och bas funktioner.
  assert.equal(hasFeature('plus', 'reports'), true);
  assert.equal(hasFeature('plus', 'billReminders'), true);

  // Hela tabellen prövad i ett svep, så att ingen enskild ruta kan glida: en
  // plan har en funktion exakt när funktionen står i planens egen lista eller i
  // en lägres. Jämförelsevärdet räknas ut ur PLANS på ett annat sätt än
  // hasFeature gör det — ett index i planordningen mot ett slice-och-some.
  const keys = Object.keys(PLANS);
  for (const [planIndex, plan] of keys.entries()) {
    for (const feature of FEATURES) {
      const ownerIndex = keys.findIndex((key) => PLANS[key].features.includes(feature));
      assert.equal(
        hasFeature(plan, feature),
        ownerIndex <= planIndex,
        `${plan} och ${feature}`
      );
    }
  }
});

// (P2) En okänd funktion kastar, med hela meddelandet asserterat.
test('hasFeature kastar RangeError för en okänd funktion', () => {
  // Meddelandet står ordagrant i ARKITEKTUR.md: hasFeature kräver en känd
  // funktion, fick "<värdet>". Hela texten asserteras och inte bara feltypen:
  // modulen har två RangeError, och en assertion på enbart typen kan inte
  // skilja planspärren från funktionsspärren (LARDOMAR.md 2026-09-16).
  assert.throws(
    () => hasFeature('premium', 'raports'),
    {
      name: 'RangeError',
      message: 'hasFeature kräver en känd funktion, fick "raports".'
    }
  );
  // Funktionsspärren prövas före planspärren: en okänd funktion ger
  // funktionstexten också när planen är okänd.
  assert.throws(
    () => hasFeature('guld', 'raports'),
    { message: 'hasFeature kräver en känd funktion, fick "raports".' }
  );
  // Typer som kastar i aritmetik eller i en mall-literal: includes använder
  // SameValueZero och String() klarar en Symbol, så varje värde når sitt
  // RangeError i stället för ett TypeError.
  for (const [värde, text] of [
    [undefined, 'undefined'],
    [null, 'null'],
    ['', ''],
    ['budget ', 'budget '],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    [42, '42'],
    [1n, '1'],
    [Symbol('x'), 'Symbol(x)'],
    [{}, '[object Object]']
  ]) {
    assert.throws(
      () => hasFeature('bas', värde),
      { message: `hasFeature kräver en känd funktion, fick "${text}".` },
      `funktionen ${String(värde)}`
    );
  }
  // Samma spärr för planen, med modulens andra text. Prototypnycklarna står
  // med därför att PLANS är ett objekt: ett sanningsprövat uppslag hade hittat
  // något på prototypen, Object.hasOwn gör det inte.
  for (const [värde, text] of [
    ['guld', 'guld'],
    ['Bas', 'Bas'],
    ['constructor', 'constructor'],
    ['toString', 'toString'],
    ['hasOwnProperty', 'hasOwnProperty'],
    ['__proto__', '__proto__'],
    [undefined, 'undefined'],
    [null, 'null'],
    [1n, '1'],
    [Symbol('x'), 'Symbol(x)']
  ]) {
    assert.throws(
      () => hasFeature(värde, 'budget'),
      { name: 'RangeError', message: `hasFeature kräver en känd plan, fick "${text}".` },
      `planen ${String(värde)}`
    );
  }
});

// (P3) planFor ger den lägsta planen.
test('planFor ger den lägsta plan som har funktionen', () => {
  assert.equal(planFor('reports'), 'plus');
  assert.equal(planFor('budget'), 'bas');
  assert.equal(planFor('billReminders'), 'bas');
  assert.equal(planFor('overview'), 'bas');
  assert.equal(planFor('savingsGoals'), 'plus');
  assert.equal(planFor('sharedHousehold'), 'plus');
  assert.equal(planFor('customFeatures'), 'premium');
  assert.equal(planFor('prioritySupport'), 'premium');

  // Varje nyckel i FEATURES har en plan, och den planen är den vars egen lista
  // bär nyckeln. Utan det här provet kunde planFor svara undefined för en
  // funktion ingen plan har, och 403-svaret hade då saknat requiredPlan.
  const keys = Object.keys(PLANS);
  for (const feature of FEATURES) {
    const ägare = keys.find((key) => PLANS[key].features.includes(feature));
    assert.equal(planFor(feature), ägare, feature);
    assert.equal(typeof planFor(feature), 'string', feature);
  }

  // Ingen egen spärr: en okänd funktion avvisas av hasFeature, med dess text.
  assert.throws(
    () => planFor('raports'),
    { name: 'RangeError', message: 'hasFeature kräver en känd funktion, fick "raports".' }
  );
});

// (P4) Listorna är frysta.
test('PLANS, FEATURES och PLAN_LABELS är frysta i varje lager', () => {
  assert.equal(Object.isFrozen(PLANS), true);
  assert.equal(Object.isFrozen(FEATURES), true);
  assert.equal(Object.isFrozen(PLAN_LABELS), true);
  for (const key of Object.keys(PLANS)) {
    assert.equal(Object.isFrozen(PLANS[key]), true, `planen ${key}`);
    assert.equal(Object.isFrozen(PLANS[key].features), true, `funktionerna i ${key}`);
  }

  // Object.freeze håller: en skrivning i en modul utan 'use strict' hade varit
  // tyst, men en ES-modul är alltid strikt, så varje försök kastar TypeError.
  // Det som prövas är att värdet står kvar efteråt — det är den egenskapen
  // behörigheten vilar på.
  assert.throws(() => {
    PLANS.bas = { priceOre: 0, features: [] };
  }, TypeError);
  assert.throws(() => {
    PLANS.bas.priceOre = 1;
  }, TypeError);
  assert.throws(() => {
    PLANS.bas.features.push('reports');
  }, TypeError);
  assert.throws(() => {
    FEATURES.push('gratis');
  }, TypeError);
  assert.throws(() => {
    PLAN_LABELS.bas = 'Gratis';
  }, TypeError);

  assert.equal(PLANS.bas.priceOre, 9900);
  assert.deepEqual([...PLANS.bas.features], ['budget', 'billReminders', 'overview']);
  assert.equal(FEATURES.length, 8);
  assert.equal(PLAN_LABELS.bas, 'Bas');

  // Priserna står i ören, som varje annat belopp i projektet: heltal, och inget
  // av dem är ett kronbelopp som råkat bli kvar.
  assert.deepEqual(
    Object.keys(PLANS).map((key) => PLANS[key].priceOre),
    [9900, 14900, 17900]
  );
  for (const key of Object.keys(PLANS)) {
    assert.equal(Number.isInteger(PLANS[key].priceOre), true, key);
  }
});

// (P5) FEATURES täcker varje plans funktioner.
test('FEATURES och planernas funktionslistor innehåller exakt samma nycklar', () => {
  const iPlanerna = featuresInPlans();

  // Ingen nyckel i en plan saknas i FEATURES, och ingen nyckel i FEATURES
  // saknas i planerna. Likhet i båda riktningarna, så att planFor alltid har
  // en plan att svara med.
  assert.deepEqual([...iPlanerna].sort(), [...FEATURES].sort());

  // Ingen nyckel står två gånger: en funktion har exakt en lägsta plan, och
  // arvet skulle annars räkna upp samma nyckel i två listor.
  assert.equal(new Set(iPlanerna).size, iPlanerna.length, iPlanerna.join(', '));

  // De tre plannyckarna och deras svenska namn hör ihop: PLAN_LABELS får inte
  // sakna en plan och inte bära ett namn för en plan som inte finns. 403-svarets
  // text läser PLAN_LABELS[planFor(feature)], och en saknad nyckel hade gett
  // texten undefined.
  assert.deepEqual(Object.keys(PLAN_LABELS), Object.keys(PLANS));
  assert.deepEqual(Object.keys(PLANS), ['bas', 'plus', 'premium']);
});

// isPlanKey är ägaren till villkoret "detta är en känd plan" och har två
// anropare: hasFeature ovan och PUT /api/plan i src/server/api.js. Fallet prövar
// exporten direkt, eftersom en modul inte får lämnas vidare med bara indirekt
// täckning (LARDOMAR.md 2026-08-18).
test('isPlanKey svarar true för exakt de tre plannycklarna', () => {
  for (const plan of Object.keys(PLANS)) {
    assert.equal(isPlanKey(plan), true, plan);
  }
  assert.equal(Object.keys(PLANS).filter((key) => isPlanKey(key)).length, 3);

  // typeof-raden i isPlanKey är inte överflödig: en nyckel i ett uppslag tvingas
  // till en sträng, så utan raden är ['bas'] och { toString: () => 'bas' } båda
  // kända planer — och PUT /api/plan svarade då 500 från databasens CHECK i
  // stället för 400 med den svenska texten.
  for (const värde of [
    ['bas'],
    ['plus'],
    { toString: () => 'bas' },
    new String('bas'),
    'guld',
    'Bas',
    'bas ',
    ' bas',
    '',
    'constructor',
    'toString',
    'hasOwnProperty',
    '__proto__',
    undefined,
    null,
    42,
    true,
    {},
    [],
    new Date(),
    1n,
    Symbol('x')
  ]) {
    assert.equal(isPlanKey(värde), false, String(typeof värde === 'symbol' ? 'Symbol' : värde));
  }
});

// FEATURE_LABELS bär funktionernas svenska namn och läses av prissidan och av
// vyn Min plan. En nyckel som saknas hade visats som sin engelska nyckel, och
// användaren ser aldrig dem.
test('FEATURE_LABELS har ett svenskt namn för varje nyckel i FEATURES', () => {
  assert.equal(Object.isFrozen(FEATURE_LABELS), true);
  assert.deepEqual(Object.keys(FEATURE_LABELS), [...FEATURES]);
  for (const feature of FEATURES) {
    const namn = FEATURE_LABELS[feature];
    assert.equal(typeof namn, 'string', feature);
    assert.notEqual(namn, '', feature);
    // Namnet är inte nyckeln: ett namn som råkat bli nyckeln är ett namn på
    // engelska.
    assert.notEqual(namn, feature, feature);
  }
  // De texter prissidan visade som inskriven text innan korten renderades ur
  // PLANS, tecken för tecken.
  assert.equal(FEATURE_LABELS.budget, 'Budget och utgiftsregistrering');
  assert.equal(FEATURE_LABELS.reports, 'Diagram och rapporter');
  assert.equal(FEATURE_LABELS.prioritySupport, 'Prioriterad support');
});
