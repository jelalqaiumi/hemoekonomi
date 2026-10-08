// Kärnans sparmålsmodul, src/core/goal.js [steg 4]. Prövar modulens egna
// exporter direkt: varje fil under src/core/ ska ha en tests/<modul>.test.js som
// gör det, i samma paket som filen skapas (LARDOMAR.md 2026-08-18).
//
// Kravlistan (S1) till (S10) i ARKITEKTUR.md gäller tests/goals.test.js, som
// prövar samma räkning genom en riktig databas. Den här filen prövar det
// datalagret inte kan nå: ingångsspärrarnas texter, gränsvärdena i
// beloppskedjorna och valideringen av ett utkast från användaren.
//
// Ingen klocka läses: varje dagens datum står som en literal.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AMOUNT_MAX_SEK } from '../src/core/entry.js';
import {
  GOAL_STATUSES,
  PERCENT_FULL,
  PERCENT_MIN,
  goalProgress,
  goalStatus,
  validateDepositDraft,
  validateGoalDraft
} from '../src/core/goal.js';

const IDAG = '2026-10-08';

function mål(ändringar = {}) {
  return { targetOre: 5000000, targetDate: '2027-06-30', savedOre: 2840000, ...ändringar };
}

// Varje värde som inte är ett tal och som får en typvakt att kasta i stället för
// att svara. 1n och Symbol('x') står med därför att de kastar TypeError ur
// aritmetik och jämförelser där varje annan typ tvingas till NaN, och -0 därför
// att inget Number.is*-predikat skiljer det från 0 (LARDOMAR.md 2026-08-24 och
// 2026-09-02).
const ICKE_TAL = ['', 'abc', null, undefined, NaN, Infinity, -Infinity, 1.5, true, {}, [], new Date(), 1n, Symbol('x')];

// ---------------------------------------------------------------------------
// GOAL_STATUSES och procentskalans två ändar.
// ---------------------------------------------------------------------------

test('GOAL_STATUSES är de tre värdena i tabellordning och är fryst', () => {
  assert.deepEqual([...GOAL_STATUSES], ['klart', 'pagaende', 'forsenat']);
  assert.equal(Object.isFrozen(GOAL_STATUSES), true);
  assert.equal(PERCENT_MIN, 0);
  assert.equal(PERCENT_FULL, 100);
});

// ---------------------------------------------------------------------------
// goalStatus: ingångsspärrarna. Texterna prövas ordagrant och inte bara feltypen
// — en feltyp delas av varje spärr i modulen (LARDOMAR.md 2026-09-16).
// ---------------------------------------------------------------------------

test('goalStatus kastar för något som inte är ett objekt', () => {
  // [] och [1] står med därför att isPlainObject i entry.js äger villkoret och
  // har ett !Array.isArray(value) — utan det hade en array med fälten påsatta
  // tagit sig igenom (LARDOMAR.md 2026-09-02).
  for (const värde of [null, undefined, 'abc', 42, true, 1n, Symbol('x'), [], [1]]) {
    assert.throws(
      () => goalStatus(värde, IDAG),
      { name: 'RangeError', message: 'goalStatus kräver ett sparmål som objekt.' },
      String(värde)
    );
  }
  // Ett Date är ett objekt för isPlainObject, som är ägaren till frågan: det är
  // inte en array och inte null. Körd: new Date() faller därför på nästa rad i
  // kedjan i stället, med targetOre-texten — alltså fortfarande ett RangeError och
  // aldrig ett tyst svar. Samma utfall som billStatus ger för samma indata,
  // eftersom de delar ägare.
  assert.throws(
    () => goalStatus(new Date(), IDAG),
    { name: 'RangeError', message: 'goalStatus kräver ett targetOre större än 0, fick "undefined".' }
  );
});

test('goalStatus kastar för ett targetOre som inte är ett heltal större än 0', () => {
  for (const targetOre of [...ICKE_TAL, 0, -0, -1, Number.MAX_SAFE_INTEGER + 2]) {
    assert.throws(
      () => goalStatus(mål({ targetOre }), IDAG),
      (error) => {
        assert.equal(error.name, 'RangeError');
        assert.equal(error.message, `goalStatus kräver ett targetOre större än 0, fick "${String(targetOre)}".`);
        return true;
      },
      String(targetOre)
    );
  }
  // Gränsen nedifrån: ett öre är giltigt.
  assert.equal(goalStatus(mål({ targetOre: 1, savedOre: 0 }), IDAG), 'pagaende');
});

test('goalStatus kastar för ett savedOre som inte är ett säkert heltal', () => {
  for (const savedOre of ICKE_TAL) {
    assert.throws(
      () => goalStatus(mål({ savedOre }), IDAG),
      (error) => {
        assert.equal(error.message, `goalStatus kräver ett savedOre som ett säkert heltal, fick "${String(savedOre)}".`);
        return true;
      },
      String(savedOre)
    );
  }
  // Noll och negativt är däremot giltiga: savedOre får vara negativ.
  assert.equal(goalStatus(mål({ savedOre: 0 }), IDAG), 'pagaende');
  assert.equal(goalStatus(mål({ savedOre: -500 }), IDAG), 'pagaende');
  // -0 passerar spärren och normaliseras av goalProgress till 0. Asserteras med
  // Object.is, aldrig med en likhet mot 0, som är sann för -0.
  assert.equal(Object.is(goalProgress(mål({ savedOre: -0 }), IDAG).savedOre, -0), false);
});

test('goalStatus kastar för ett targetDate som varken är ett datum eller null', () => {
  for (const targetDate of ['', 'abc', '2026-13-01', '2026-02-30', '2026-6-30', 42, true, {}, [], 1n, Symbol('x')]) {
    assert.throws(
      () => goalStatus(mål({ targetDate }), IDAG),
      (error) => {
        assert.equal(error.message, `goalStatus kräver ett targetDate på formen ÅÅÅÅ-MM-DD eller null, fick "${String(targetDate)}".`);
        return true;
      },
      String(targetDate)
    );
  }
  // undefined är inte null och avvisas därför också: kolumnen bär ett datum eller
  // NULL, och ett utkast utan nyckeln är ett programmeringsfel i datalagret.
  assert.throws(() => goalStatus(mål({ targetDate: undefined }), IDAG), { name: 'RangeError' });
});

test('goalStatus kastar för ett dagens datum som inte är ett datum, också utan slutdatum', () => {
  for (const today of ['', 'abc', '2026-02-30', null, undefined, 42, 1n, Symbol('x')]) {
    assert.throws(
      () => goalStatus(mål(), today),
      (error) => {
        assert.equal(error.message, `goalStatus kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
        return true;
      },
      String(today)
    );
    // Rad 2 i statustabellen svarar innan jämförelsen körs för ett mål utan
    // slutdatum. Utan den egna today-raden hade ett ogiltigt dagens datum då
    // passerat tyst.
    assert.throws(
      () => goalStatus(mål({ targetDate: null }), today),
      (error) => {
        assert.equal(error.message, `goalStatus kräver ett dagens datum på formen ÅÅÅÅ-MM-DD, fick "${String(today)}".`);
        return true;
      },
      `utan slutdatum: ${String(today)}`
    );
  }
});

test('goalProgress ärver hela spärrkedjan från goalStatus', () => {
  // Meddelandet namnger goalStatus också när felet uppstår i goalProgress: kedjan
  // har en enda ägare, och en andra kopia vore två facit för samma fråga.
  assert.throws(() => goalProgress(null, IDAG), { message: 'goalStatus kräver ett sparmål som objekt.' });
  assert.throws(() => goalProgress(mål({ savedOre: 'x' }), IDAG), { message: 'goalStatus kräver ett savedOre som ett säkert heltal, fick "x".' });
});

// ---------------------------------------------------------------------------
// goalProgress: de sex fälten direkt, utan databas.
// ---------------------------------------------------------------------------

test('goalProgress svarar med exakt de sex räknade fälten', () => {
  assert.deepEqual(goalProgress(mål(), IDAG), {
    savedOre: 2840000,
    leftOre: 2160000,
    percent: 56,
    monthsLeft: 8,
    perMonthOre: 270000,
    status: 'pagaende'
  });
});

test('goalProgress räknar hela månader på månaden och aldrig på dagen', () => {
  // Den 1 och den 31 i samma målmånad ger samma antal hela månader: skillnaden är
  // mellan två månadsnummer, inte ett antal dagar delat med 30.
  assert.equal(goalProgress(mål({ targetDate: '2026-12-01' }), IDAG).monthsLeft, 2);
  assert.equal(goalProgress(mål({ targetDate: '2026-12-31' }), IDAG).monthsLeft, 2);
  // Över ett årsskifte, så att tolvan i omräkningen prövas.
  assert.equal(goalProgress(mål({ targetDate: '2027-10-08' }), IDAG).monthsLeft, 12);
  assert.equal(goalProgress(mål({ targetDate: '2028-01-01' }), IDAG).monthsLeft, 15);
  // Och bakåt över ett årsskifte: aldrig negativt.
  assert.equal(goalProgress(mål({ targetDate: '2025-01-01' }), IDAG).monthsLeft, 0);
});

test('goalProgress klipper percent utan att lämna det säkra heltalsområdet', () => {
  // De två ytterfallen prövas före multiplikationen, så ett mycket stort savedOre
  // kan inte göra savedOre * PERCENT_FULL osäkert. targetDate är null här, så att
  // raden prövar klippningen och ingenting annat.
  const stort = goalProgress(mål({ savedOre: Number.MAX_SAFE_INTEGER, targetDate: null }), IDAG);
  assert.equal(stort.percent, PERCENT_FULL);
  assert.equal(stort.leftOre, 0);
  assert.equal(stort.status, 'klart');
  const litet = goalProgress(mål({ savedOre: -Number.MAX_SAFE_INTEGER, targetDate: null }), IDAG);
  assert.equal(litet.percent, PERCENT_MIN);
  // Gränsen mellan mittengrenen och den övre: ett öre under målet ger 99 procent.
  assert.equal(goalProgress({ targetOre: 100, targetDate: null, savedOre: 99 }, IDAG).percent, 99);
  assert.equal(goalProgress({ targetOre: 100, targetDate: null, savedOre: 100 }, IDAG).percent, PERCENT_FULL);
  // Och mellan mittengrenen och den nedre: ett öre insatt av tusen ger 0 procent,
  // avrundat nedåt, men går genom divisionen.
  assert.equal(goalProgress({ targetOre: 1000, targetDate: null, savedOre: 1 }, IDAG).percent, 0);
});

test('goalProgress kastar i stället för att svara oexakt när leftOre lämnar det säkra området', () => {
  // leftOre blir här målet plus hela skulden, alltså större än
  // Number.MAX_SAFE_INTEGER, och divisionen går genom divideRoundHalfUp i
  // money.js. Den äger giltighetsområdet och kastar med sitt eget namn i
  // meddelandet — ingen funktion i src/core/ får svara med ett tyst oexakt tal
  // (LARDOMAR.md 2026-09-02). Inget vägen genom API:t kan nå hit: schemats CHECK
  // och validateDepositDraft håller varje enskilt belopp under 999999999 ören.
  assert.throws(
    () => goalProgress(mål({ savedOre: -Number.MAX_SAFE_INTEGER }), IDAG),
    { name: 'RangeError', message: 'divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.' }
  );
});

// ---------------------------------------------------------------------------
// validateGoalDraft.
// ---------------------------------------------------------------------------

test('validateGoalDraft tar emot de tre fälten och räknar om beloppet till ören', () => {
  assert.deepEqual(validateGoalDraft({ name: '  Buffert  ', targetSek: '50 000'.replace(' ', ''), targetDate: ' 2027-06-30 ' }), {
    ok: true,
    value: { name: 'Buffert', targetOre: 5000000, targetDate: '2027-06-30' }
  });
  // Komma som decimaltecken, precis som i varje annat beloppsfält i appen.
  assert.equal(validateGoalDraft({ name: 'Resa', targetSek: '1234,56' }).value.targetOre, 123456);
  // Ett tal och inte en sträng ger samma svar: samma värde ska ge samma utfall
  // oavsett ingångstyp.
  assert.equal(validateGoalDraft({ name: 'Resa', targetSek: 1234.56 }).value.targetOre, 123456);
});

test('validateGoalDraft gör slutdatumet valfritt: tomt, null och ingen nyckel ger null', () => {
  for (const targetDate of [undefined, null, '', '   ']) {
    const resultat = validateGoalDraft({ name: 'Resa', targetSek: '1000', targetDate });
    assert.equal(resultat.ok, true, String(targetDate));
    assert.equal(resultat.value.targetDate, null, String(targetDate));
  }
  // value bär alltid nyckeln, också när den är null: två former av samma value
  // hade tvingat varje anropare att fråga vilken av dem den fick.
  assert.deepEqual(Object.keys(validateGoalDraft({ name: 'Resa', targetSek: '1000' }).value).sort(), ['name', 'targetDate', 'targetOre']);
});

test('validateGoalDraft tar emot ett slutdatum som redan har passerat', () => {
  // Ett passerat slutdatum är giltigt och ger statusen forsenat. Att avvisa det
  // hade gjort rad 3 i statustabellen onåbar för varje mål användaren skapar.
  const resultat = validateGoalDraft({ name: 'Resa', targetSek: '1000', targetDate: '1970-01-01' });
  assert.equal(resultat.ok, true);
  assert.equal(resultat.value.targetDate, '1970-01-01');
});

test('validateGoalDraft rapporterar alla tre fälten i formulärets ordning', () => {
  const resultat = validateGoalDraft({ name: '', targetSek: 'abc', targetDate: '2026-02-30' });
  assert.equal(resultat.ok, false);
  assert.deepEqual(resultat.errors.map((fel) => fel.field), ['name', 'targetSek', 'targetDate']);
  assert.deepEqual(resultat.errors.map((fel) => fel.message), [
    'Namnet får inte vara tomt.',
    'Målbeloppet måste vara ett tal.',
    'Slutdatum måste anges som ÅÅÅÅ-MM-DD.'
  ]);
});

test('validateGoalDraft skiljer "inte ett tal" från ett ogiltigt värde', () => {
  const inteTal = ['abc', '', null, undefined, {}, [], true, NaN, Infinity, 1n, Symbol('x')];
  for (const targetSek of inteTal) {
    const resultat = validateGoalDraft({ name: 'Resa', targetSek });
    assert.equal(resultat.errors[0].message, 'Målbeloppet måste vara ett tal.', String(targetSek));
  }
  // Värden som ÄR tal men bryter mot en av värdereglerna får den andra texten:
  // noll, negativt, för stort, för många decimaler och ett belopp som avrundas
  // till noll ören.
  for (const targetSek of [0, '0', -1, '-1', AMOUNT_MAX_SEK + 0.01, '10000000', '1,234', 1e-9, '0,000000001']) {
    const resultat = validateGoalDraft({ name: 'Resa', targetSek });
    assert.equal(
      resultat.errors[0].message,
      'Målbeloppet måste vara ett belopp större än 0 kr, med högst två decimaler.',
      String(targetSek)
    );
  }
  // Gränserna: ett öre och maxbeloppet går igenom.
  assert.equal(validateGoalDraft({ name: 'Resa', targetSek: '0,01' }).value.targetOre, 1);
  assert.equal(validateGoalDraft({ name: 'Resa', targetSek: String(AMOUNT_MAX_SEK) }).value.targetOre, 999999999);
});

test('validateGoalDraft hanterar ett utkast som inte är ett objekt', () => {
  for (const utkast of [null, undefined, 'abc', 42, [], true]) {
    const resultat = validateGoalDraft(utkast);
    assert.equal(resultat.ok, false, String(utkast));
    assert.deepEqual(resultat.errors.map((fel) => fel.field), ['name', 'targetSek'], String(utkast));
  }
});

// ---------------------------------------------------------------------------
// validateDepositDraft. Den enda beloppskedjan i projektet som tar emot ett
// negativt belopp.
// ---------------------------------------------------------------------------

test('validateDepositDraft tar emot ett positivt och ett negativt belopp', () => {
  assert.deepEqual(validateDepositDraft({ amountSek: '1200,50', madeOn: '2026-10-01' }), {
    ok: true,
    value: { amountOre: 120050, madeOn: '2026-10-01' }
  });
  // Uttaget: den som tar ut pengar ur sitt sparande ska kunna registrera det.
  assert.deepEqual(validateDepositDraft({ amountSek: '-1200,50', madeOn: '2026-10-01' }), {
    ok: true,
    value: { amountOre: -120050, madeOn: '2026-10-01' }
  });
  // Samma värde som tal ger samma svar: en enda regelkedja för båda ingångstyperna
  // (LARDOMAR.md 2026-08-18).
  assert.equal(validateDepositDraft({ amountSek: -1200.5, madeOn: '2026-10-01' }).value.amountOre, -120050);
  // Gränserna, ett öre i vardera riktningen.
  assert.equal(validateDepositDraft({ amountSek: '0,01', madeOn: '2026-10-01' }).value.amountOre, 1);
  assert.equal(validateDepositDraft({ amountSek: '-0,01', madeOn: '2026-10-01' }).value.amountOre, -1);
});

test('validateDepositDraft avvisar noll, också när beloppet avrundas till noll ören', () => {
  const noll = 'Beloppet får inte vara 0 kr. Skriv ett minustecken framför för ett uttag.';
  // Noll skrivet på varje sätt kedjan kan få det, inklusive -0 — inget
  // Number.is*-predikat skiljer -0 från 0, så raden prövas explicit
  // (LARDOMAR.md 2026-09-02).
  for (const amountSek of ['0', '0,00', '-0', '-0,00', 0, -0]) {
    const resultat = validateDepositDraft({ amountSek, madeOn: '2026-10-01' });
    assert.equal(resultat.ok, false, String(amountSek));
    assert.equal(resultat.errors[0].message, noll, String(amountSek));
  }
  // Ett belopp under ett halvt öre avrundas till noll ören och får samma text, inte
  // decimalfelet: regel 1 prövas om på det värde som lagras. Båda sidor om
  // toleransgränsen, som sträng och som tal.
  for (const amountSek of ['0,000000001', '-0,000000001', 1e-9, -1e-9, 1e-15]) {
    const resultat = validateDepositDraft({ amountSek, madeOn: '2026-10-01' });
    assert.equal(resultat.ok, false, String(amountSek));
    assert.equal(resultat.errors[0].message, noll, String(amountSek));
  }
  // Strax ovanför toleransen vinner decimalregeln i stället, och det är rätt
  // ordning: 0,004 kr och 0,005 kr är tal med tre decimaler, och det är det
  // användaren ska rätta. Körda utfall, båda sidor om halva öret — samma
  // förhållande som checkAmountSek i entry.js har för 0,001.
  for (const amountSek of ['0,004', '0,005', '-0,004', '-0,005']) {
    assert.equal(
      validateDepositDraft({ amountSek, madeOn: '2026-10-01' }).errors[0].message,
      'Beloppet får ha högst två decimaler.',
      String(amountSek)
    );
  }
});

test('validateDepositDraft avvisar ett belopp som inte är ett tal, för stort eller för exakt', () => {
  for (const amountSek of ['abc', '', null, undefined, {}, [], true, NaN, Infinity, -Infinity, 1n, Symbol('x')]) {
    assert.equal(
      validateDepositDraft({ amountSek, madeOn: '2026-10-01' }).errors[0].message,
      'Beloppet måste vara ett tal.',
      String(amountSek)
    );
  }
  // Gränsen gäller i båda riktningarna: ett uttag får inte heller vara större än
  // maxbeloppet.
  for (const amountSek of ['10000000', '-10000000', AMOUNT_MAX_SEK + 0.01, -(AMOUNT_MAX_SEK + 0.01)]) {
    assert.equal(
      validateDepositDraft({ amountSek, madeOn: '2026-10-01' }).errors[0].message,
      'Beloppet får vara högst 9 999 999,99 kr.',
      String(amountSek)
    );
  }
  for (const amountSek of ['1,234', '-1,234', 1.234, -1.234]) {
    assert.equal(
      validateDepositDraft({ amountSek, madeOn: '2026-10-01' }).errors[0].message,
      'Beloppet får ha högst två decimaler.',
      String(amountSek)
    );
  }
});

test('validateDepositDraft kräver ett datum och rapporterar båda fälten i ordning', () => {
  for (const madeOn of ['', '   ', 'abc', '2026-02-30', '2026-13-01', null, undefined, 42, {}, [], 1n, Symbol('x')]) {
    const resultat = validateDepositDraft({ amountSek: '100', madeOn });
    assert.equal(resultat.ok, false, String(madeOn));
    assert.deepEqual(resultat.errors, [{ field: 'madeOn', message: 'Datum måste anges som ÅÅÅÅ-MM-DD.' }], String(madeOn));
  }
  const båda = validateDepositDraft({ amountSek: '0', madeOn: 'x' });
  assert.deepEqual(båda.errors.map((fel) => fel.field), ['amountSek', 'madeOn']);
  // Omgivande blanksteg trimmas, som i varje annat datumfält i appen.
  assert.equal(validateDepositDraft({ amountSek: '100', madeOn: ' 2026-10-01 ' }).value.madeOn, '2026-10-01');
});

test('validateDepositDraft hanterar ett utkast som inte är ett objekt', () => {
  for (const utkast of [null, undefined, 'abc', 42, [], true]) {
    const resultat = validateDepositDraft(utkast);
    assert.equal(resultat.ok, false, String(utkast));
    assert.deepEqual(resultat.errors.map((fel) => fel.field), ['amountSek', 'madeOn'], String(utkast));
  }
});
