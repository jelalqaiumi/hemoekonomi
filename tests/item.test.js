import { test } from 'node:test';
import assert from 'node:assert/strict';

import { INTERVALS, checkAmountSek } from '../src/core/entry.js';
import { ITEM_KINDS, ITEM_KIND_LABELS, isItemKind, validateMonthItemDraft, validateOverrideDraft, validateTemplateDraft } from '../src/core/item.js';

test('ITEM_KINDS är de tre slagen i tabellens ordning', () => {
  assert.deepEqual([...ITEM_KINDS], ['income', 'expense', 'saving']);
});

test('ITEM_KINDS är fryst', () => {
  assert.equal(Object.isFrozen(ITEM_KINDS), true);
  assert.throws(() => {
    ITEM_KINDS[0] = 'gift';
  }, TypeError);
  assert.throws(() => {
    ITEM_KINDS.push('gift');
  }, TypeError);
});

// (V9) ITEM_KIND_LABELS [steg 5]: nästa nummer i filens egen serie, och inget
// (RA), enligt kravlistan för tests/report-csv.test.js i ARKITEKTUR.md. Texterna
// är tabellens under "Posttypen: inkomst, utgift eller sparande", tecken för
// tecken som ägaren skriver dem. Nycklarna ska vara exakt ITEM_KINDS: en nyckel
// som saknas ger en tom cell i CSV-filen, och en extra nyckel är ett slag som
// inte finns.
test('(V9) ITEM_KIND_LABELS ger det svenska namnet för exakt de tre slagen, och är fryst', () => {
  assert.deepEqual({ ...ITEM_KIND_LABELS }, { income: 'Inkomst', expense: 'Utgift', saving: 'Sparande' });
  assert.deepEqual(Object.keys(ITEM_KIND_LABELS), [...ITEM_KINDS]);
  assert.equal(Object.isFrozen(ITEM_KIND_LABELS), true);
  assert.throws(() => {
    ITEM_KIND_LABELS.income = 'Lön';
  }, TypeError);
  assert.throws(() => {
    ITEM_KIND_LABELS.gift = 'Gåva';
  }, TypeError);
  assert.equal(ITEM_KIND_LABELS.income, 'Inkomst');
});

test('isItemKind är true för varje värde i ITEM_KINDS', () => {
  for (const kind of ITEM_KINDS) {
    assert.equal(isItemKind(kind), true, kind);
  }
});

// Versaler, blanktecken och prototypnycklar är inte slag. Prototypnycklarna står
// med därför att ett sanningsprövat uppslag i ett objekt hade hittat något på
// prototypen för dem (LARDOMAR.md 2026-09-16), och en lista har inte det
// problemet — testet är beviset för att svaret är false också här.
test('isItemKind är false för varje annat värde och kastar för ingen indata', () => {
  const värden = [
    'gift', '', ' income', 'income ', 'Income', 'INCOME',
    'constructor', 'toString', 'hasOwnProperty', '__proto__', 'valueOf',
    null, undefined, 0, 1, -0, NaN, Infinity, true, false,
    {}, [], ['income'], new Date(), 1n, Symbol('x')
  ];
  for (const value of värden) {
    assert.equal(isItemKind(value), false, String(value));
  }
});

// Månadspostens validering, kravlistan (V1) till (V4) i ARKITEKTUR.md under
// "Månadspostens validering".

// Texten den här modulen äger. De tre övriga fälten prövas mot sina ägares
// texter, lästa ur entry.js-kedjan genom check-funktionerna.
const KIND_TEXT = 'Välj inkomst, utgift eller sparande.';

function draft(overrides = {}) {
  return { kind: 'expense', name: 'Tandläkare', amountSek: '950,50', category: 'other', ...overrides };
}

// (V1) ett giltigt utkast.
test('V1: ett giltigt utkast ger ok och amountOre i heltal ören', () => {
  const resultat = validateMonthItemDraft(draft());
  assert.deepEqual(resultat, {
    ok: true,
    value: {
      kind: 'expense',
      name: 'Tandläkare',
      amountOre: 95050,
      category: 'other',
      // De två valfria fälten står alltid i value, som null när användaren
      // lämnat dem tomma [steg 2]. Två former av samma value hade tvingat varje
      // anropare att fråga vilken av dem den fick.
      occurredOn: null,
      note: null
    }
  });
  // Kronor finns inte kvar i svaret: fältet heter amountOre och amountSek är borta.
  assert.equal(Object.hasOwn(resultat.value, 'amountSek'), false);
  // Beloppet tas emot både som sträng och som tal, av samma ägare.
  assert.equal(validateMonthItemDraft(draft({ amountSek: 950.5 })).value.amountOre, 95050);
  assert.equal(validateMonthItemDraft(draft({ amountSek: '0,01' })).value.amountOre, 1);
  // Namnet trimmas av sin ägare, checkName.
  assert.equal(validateMonthItemDraft(draft({ name: '  Hyra  ' })).value.name, 'Hyra');
});

test('V1: varje slag i ITEM_KINDS godkänns', () => {
  for (const kind of ITEM_KINDS) {
    const resultat = validateMonthItemDraft(draft({ kind }));
    assert.equal(resultat.ok, true, kind);
    assert.equal(resultat.value.kind, kind);
  }
});

// (V2) ogiltigt kind.
test('V2: ett ogiltigt kind ger kind-texten ordagrant', () => {
  for (const kind of ['gift', '', 'Income', 'INCOME', ' expense', 'constructor', '__proto__', undefined, null, 42, 1n, Symbol('x'), {}, []]) {
    const resultat = validateMonthItemDraft(draft({ kind }));
    assert.equal(resultat.ok, false, String(kind));
    assert.deepEqual(resultat.errors, [{ field: 'kind', message: KIND_TEXT }], String(kind));
  }
  // Texten nämner aldrig de engelska nycklarna: användaren ser bara svenska ord.
  for (const nyckel of ITEM_KINDS) {
    assert.equal(KIND_TEXT.includes(nyckel), false, nyckel);
  }
});

// (V3) fyra fel samtidigt, i fältordningen kind, name, amountSek, category.
test('V3: fyra fel ger fyra poster i errors, i fältordningen', () => {
  const resultat = validateMonthItemDraft({ kind: 'gift', name: '', amountSek: 'abc', category: 'x' });
  assert.equal(resultat.ok, false);
  assert.equal(Object.hasOwn(resultat, 'value'), false);
  assert.deepEqual(resultat.errors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category']);
  assert.deepEqual(resultat.errors, [
    { field: 'kind', message: KIND_TEXT },
    { field: 'name', message: 'Namnet får inte vara tomt.' },
    { field: 'amountSek', message: 'Beloppet måste vara ett tal.' },
    { field: 'category', message: 'Välj en giltig kategori.' }
  ]);
});

test('V3: ett utkast som inte är ett objekt ger fyra fel och kastar inte', () => {
  for (const värde of [undefined, null, 'abc', 42, true, [], 1n, Symbol('x')]) {
    const resultat = validateMonthItemDraft(värde);
    assert.equal(resultat.ok, false, String(värde));
    assert.deepEqual(resultat.errors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category'], String(värde));
  }
});

// (V4) beloppet med mellanslag ger ägarens vägledande text och ingen egen.
test('V4: ett belopp med mellanslag ger den vägledande texten ur checkAmountSek', () => {
  const vägledande = 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.';
  for (const amountSek of ['12 000', '12 000 kr', '1 234,50 kr']) {
    const resultat = validateMonthItemDraft(draft({ amountSek }));
    assert.equal(resultat.ok, false, amountSek);
    assert.deepEqual(resultat.errors, [{ field: 'amountSek', message: vägledande }], amountSek);
  }
  // Och texten är ägarens, inte en kopia: samma sträng som checkAmountSek ger
  // för samma värde. Fälls den här raden har item.js skrivit en egen text.
  assert.equal(checkAmountSek('12 000').message, vägledande);
});

test('V4: varje annan beloppsregel kommer också från ägaren', () => {
  for (const amountSek of ['0', '-5', '10000000', '1,234', 'abc', '', null]) {
    const förväntat = checkAmountSek(amountSek).message;
    assert.equal(typeof förväntat, 'string', String(amountSek));
    const resultat = validateMonthItemDraft(draft({ amountSek }));
    assert.deepEqual(resultat.errors, [{ field: 'amountSek', message: förväntat }], String(amountSek));
  }
});

// ---------------------------------------------------------------------------
// validateTemplateDraft [etapp 4]: månadspostens fyra fält plus interval och
// toMonth.
// ---------------------------------------------------------------------------

const MALL_MANAD = '2026-10';

function mallUtkast(extra = {}) {
  return {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '12500',
    category: 'housing',
    interval: 'monthly',
    ...extra
  };
}

test('validateTemplateDraft ger de sex fälten med beloppet i ören och toMonth null', () => {
  const resultat = validateTemplateDraft(mallUtkast(), MALL_MANAD);
  assert.equal(resultat.ok, true);
  assert.deepEqual(resultat.value, {
    kind: 'expense',
    name: 'Hyra',
    amountOre: 1250000,
    category: 'housing',
    interval: 'monthly',
    toMonth: null
  });
});

test('validateTemplateDraft tar emot varje värde i INTERVALS', () => {
  for (const interval of INTERVALS) {
    const resultat = validateTemplateDraft(mallUtkast({ interval }), MALL_MANAD);
    assert.equal(resultat.ok, true, interval);
    assert.equal(resultat.value.interval, interval, interval);
  }
});

// interval får sin text av sin ägare, checkInterval i entry.js. Samma text som
// den gamla formulärvägen ger för samma fel: ingen andra kopia.
test('validateTemplateDraft ger intervallets egen text för ett intervall utanför INTERVALS', () => {
  for (const interval of ['weekly', 'veckovis', 'MONTHLY', '', ' monthly', null, undefined, 42, 1n, Symbol('x'), {}, [], ['monthly']]) {
    const resultat = validateTemplateDraft(mallUtkast({ interval }), MALL_MANAD);
    assert.equal(resultat.ok, false, String(interval));
    assert.deepEqual(
      resultat.errors,
      [{ field: 'interval', message: 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.' }],
      String(interval)
    );
  }
});

// Tomt betyder tills vidare. Alla tre formerna ett formulär kan skicka ger
// samma svar, så ingen anropare behöver veta vilken webbläsaren valde.
test('validateTemplateDraft läser utelämnad, null och tom toMonth som tills vidare', () => {
  for (const toMonth of [undefined, null, '', '   ']) {
    const resultat = validateTemplateDraft(mallUtkast({ toMonth }), MALL_MANAD);
    assert.equal(resultat.ok, true, JSON.stringify(toMonth));
    assert.equal(resultat.value.toMonth, null, JSON.stringify(toMonth));
  }
});

test('validateTemplateDraft tar emot en toMonth i eller efter månaden, trimmad', () => {
  for (const [toMonth, väntat] of [['2026-10', '2026-10'], ['2026-11', '2026-11'], ['2099-12', '2099-12'], ['  2026-12  ', '2026-12']]) {
    const resultat = validateTemplateDraft(mallUtkast({ toMonth }), MALL_MANAD);
    assert.equal(resultat.ok, true, toMonth);
    assert.equal(resultat.value.toMonth, väntat, toMonth);
  }
});

test('validateTemplateDraft ger formattexten för en toMonth som inte är en månad', () => {
  for (const toMonth of ['2026-13', '2026-00', '2026-1', '2026', '2026-10-01', 'oktober', '2026-1O', 202610, 1n, Symbol('x'), {}, [], true]) {
    const resultat = validateTemplateDraft(mallUtkast({ toMonth }), MALL_MANAD);
    assert.equal(resultat.ok, false, String(toMonth));
    assert.deepEqual(
      resultat.errors,
      [{ field: 'toMonth', message: 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.' }],
      String(toMonth)
    );
  }
});

// En slutmånad före den månad mallen gäller från ger en serie utan en enda
// månad. Felet fångas här, med fältets egen text och ett fältfel, i stället för
// av schemats CHECK — som hade gett "Uppgifterna kunde inte sparas: något värde
// är ogiltigt." och ett 500.
test('validateTemplateDraft ger den egna texten för en toMonth före månaden', () => {
  for (const toMonth of ['2026-09', '2026-01', '2025-12', '1970-01']) {
    const resultat = validateTemplateDraft(mallUtkast({ toMonth }), MALL_MANAD);
    assert.equal(resultat.ok, false, toMonth);
    assert.deepEqual(
      resultat.errors,
      [{ field: 'toMonth', message: 'Till och med kan inte vara före den månad posten gäller från.' }],
      toMonth
    );
  }
  // Gränsen: samma månad går igenom, månaden före gör det inte.
  assert.equal(validateTemplateDraft(mallUtkast({ toMonth: '2026-10' }), MALL_MANAD).ok, true);
  assert.equal(validateTemplateDraft(mallUtkast({ toMonth: '2026-09' }), MALL_MANAD).ok, false);
});

// Alla sex fälten prövas, aldrig bara det första, och ordningen är bindande:
// kind, name, amountSek, category, interval, toMonth.
test('validateTemplateDraft ger sex fel i fältordning för ett utkast där allt är fel', () => {
  const resultat = validateTemplateDraft(
    { kind: 'gift', name: '', amountSek: 'abc', category: 'x', interval: 'weekly', toMonth: '2026-09' },
    MALL_MANAD
  );
  assert.equal(resultat.ok, false);
  assert.deepEqual(resultat.errors.map((fel) => fel.field), [
    'kind', 'name', 'amountSek', 'category', 'interval', 'toMonth'
  ]);
});

// Varje fält har en ägare, och de fyra första är validateMonthItemDraft:s.
// Samma utkast genom de två funktionerna ska ge samma fel för de fyra fälten —
// annars finns en andra kopia av något villkor.
test('validateTemplateDraft ger samma fel som validateMonthItemDraft för de fyra gemensamma fälten', () => {
  const trasigt = { kind: 'gift', name: '', amountSek: '12 000', category: 'x' };
  const mall = validateTemplateDraft({ ...trasigt, interval: 'monthly' }, MALL_MANAD);
  const månad = validateMonthItemDraft(trasigt);
  assert.deepEqual(mall.errors, månad.errors);
});

// Ett utkast som inte är ett vanligt objekt ger fältfel och kastar inte, precis
// som validateMonthItemDraft.
test('validateTemplateDraft ger fältfel för ett utkast som inte är ett objekt', () => {
  for (const draft of [undefined, null, 'abc', 42, true, [], 1n, Symbol('x')]) {
    const resultat = validateTemplateDraft(draft, MALL_MANAD);
    assert.equal(resultat.ok, false, String(draft));
    assert.deepEqual(resultat.errors.map((fel) => fel.field), ['kind', 'name', 'amountSek', 'category', 'interval'], String(draft));
  }
});

// Månaden är inget användarfält: api.js har redan avvisat en ogiltig månad i
// sökvägen, så en månad som inte är en månad är ett programmeringsfel och
// kastar i stället för att bli ett fältfel användaren inte kan rätta.
test('validateTemplateDraft kastar RangeError för en månad som inte är en månad', () => {
  for (const month of ['2026-13', '2026-00', '2026-1', '2026-10-01', '', null, undefined, 202610, 1n, Symbol('x')]) {
    assert.throws(
      () => validateTemplateDraft(mallUtkast(), month),
      { name: 'RangeError', message: `validateTemplateDraft kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".` },
      String(month)
    );
  }
});

// ---------------------------------------------------------------------------
// validateOverrideDraft [etapp 4]: kroppens två former för en avvikelse.
// ---------------------------------------------------------------------------

test('validateOverrideDraft läser { skipped: true } som en överhoppning utan belopp', () => {
  assert.deepEqual(validateOverrideDraft({ skipped: true }), {
    ok: true,
    value: { skipped: true, amountOre: null }
  });
});

// skipped prövas före amountSek: en kropp som bär båda ber om två motstridiga
// saker, och överhoppningen är den som går att utföra utan att något belopp
// tolkas. Beloppet i kroppen nedan är ogiltigt och prövas därför aldrig.
test('validateOverrideDraft låter skipped: true vinna över ett amountSek i samma kropp', () => {
  assert.deepEqual(validateOverrideDraft({ skipped: true, amountSek: 'abc' }), {
    ok: true,
    value: { skipped: true, amountOre: null }
  });
});

// Strikt jämförelse mot true: varje annat sanningslikt värde är inte en
// överhoppning utan en kropp utan form.
test('validateOverrideDraft godtar bara true som skipped, inte 1 eller "true"', () => {
  for (const skipped of [1, 'true', 'ja', {}, [], -1, 1n]) {
    const resultat = validateOverrideDraft({ skipped });
    assert.equal(resultat.ok, false, String(skipped));
    assert.deepEqual(
      resultat.errors,
      [{ field: 'skipped', message: 'Ange ett belopp för månaden, eller att posten ska hoppas över.' }],
      String(skipped)
    );
  }
});

test('validateOverrideDraft läser { amountSek } som ett belopp i ören', () => {
  for (const [amountSek, amountOre] of [['950,50', 95050], ['12500', 1250000], [139.5, 13950], ['0,01', 1]]) {
    assert.deepEqual(validateOverrideDraft({ amountSek }), {
      ok: true,
      value: { skipped: false, amountOre }
    }, String(amountSek));
  }
});

// Beloppet får sin text av sin ägare, checkAmountSek i entry.js. Samma text som
// varje annan väg i appen ger för samma fel: ingen andra kopia av kedjan.
test('validateOverrideDraft ger beloppets egen text för ett ogiltigt belopp', () => {
  for (const [amountSek, väntat] of [
    ['abc', 'Beloppet måste vara ett tal.'],
    ['12 000', 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.'],
    ['0', 'Beloppet måste vara större än 0 kr.'],
    ['-5', 'Beloppet måste vara större än 0 kr.'],
    ['1,234', 'Beloppet får ha högst två decimaler.'],
    ['10000000', 'Beloppet får vara högst 9 999 999,99 kr.']
  ]) {
    assert.deepEqual(validateOverrideDraft({ amountSek }), {
      ok: false,
      errors: [{ field: 'amountSek', message: väntat }]
    }, amountSek);
  }
  // Och för varje värde som inte är ett belopp alls.
  for (const amountSek of [null, true, {}, [], 1n, Symbol('x'), NaN, Infinity, -0]) {
    const resultat = validateOverrideDraft({ amountSek });
    assert.equal(resultat.ok, false, String(amountSek));
    assert.equal(resultat.errors[0].field, 'amountSek', String(amountSek));
  }
});

// En kropp som varken är ett belopp eller en överhoppning. amountSek: undefined
// ingår: JSON kan inte uttrycka det, så det svaret är detsamma som för en kropp
// utan nyckeln — skillnaden står utskriven i src/core/item.js.
test('validateOverrideDraft ger formtexten för en kropp som varken är belopp eller överhoppning', () => {
  for (const draft of [{}, { skipped: false }, { belopp: '100' }, { amountSek: undefined }, undefined, null, 'abc', 42, true, [], 1n, Symbol('x')]) {
    const resultat = validateOverrideDraft(draft);
    assert.equal(resultat.ok, false, String(draft));
    assert.deepEqual(
      resultat.errors,
      [{ field: 'skipped', message: 'Ange ett belopp för månaden, eller att posten ska hoppas över.' }],
      String(draft)
    );
  }
});


// ---------------------------------------------------------------------------
// Postens tva nya falt [steg 2]: occurredOn och note. Texterna star i
// src/core/item.js och prövas ordagrant; längdgränsen prövas från båda sidor och
// i båda mätsätten.
// ---------------------------------------------------------------------------

const DATUM_TEXT = 'Datum måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD, eller lämnas tomt.';
const NOTE_TEXT_TYP = 'Kommentaren måste vara text.';
const NOTE_TEXT_LANG = 'Kommentaren får vara högst 200 tecken.';

test('occurredOn och note är valfria: utan dem, som null och som tom sträng ger null', () => {
  // Tre vägar in för "inget värde": nyckeln saknas, null, och den tomma strängen.
  // Alla tre ska ge samma svar, så ingen anropare behöver veta vilken av de tre
  // webbläsaren råkade skicka.
  for (const extra of [{}, { occurredOn: null, note: null }, { occurredOn: '', note: '' }, { occurredOn: '   ', note: '   ' }]) {
    const resultat = validateMonthItemDraft(draft(extra));
    assert.equal(resultat.ok, true, JSON.stringify(extra));
    assert.equal(resultat.value.occurredOn, null, JSON.stringify(extra));
    assert.equal(resultat.value.note, null, JSON.stringify(extra));
  }
});

test('occurredOn tas emot som ett datum och trimmas, och är inte dueDate', () => {
  assert.equal(validateMonthItemDraft(draft({ occurredOn: '2026-10-03' })).value.occurredOn, '2026-10-03');
  assert.equal(validateMonthItemDraft(draft({ occurredOn: '  2026-10-03  ' })).value.occurredOn, '2026-10-03');
  // Den 29:e i februari ett skottår finns, den 30:e finns inte.
  assert.equal(validateMonthItemDraft(draft({ occurredOn: '2024-02-29' })).value.occurredOn, '2024-02-29');
  // Fältet heter occurredOn och aldrig dueDate: dueDate räknas fram ur en malls
  // interval och start_date och kommer aldrig från användaren.
  assert.equal(Object.hasOwn(validateMonthItemDraft(draft({ occurredOn: '2026-10-03' })).value, 'dueDate'), false);
});

test('ett occurredOn som inte är ett giltigt datum avvisas med textens exakta lydelse', () => {
  const trasiga = [
    '2026-10-3', '20261003', '2026-10', '2026-13-01', '2026-00-01', '2026-02-30',
    '2026-04-31', '2026-10-32', '2026-10-00', 'igår', '2026-10-03T00:00:00.000Z',
    42, true, {}, [], 1n, Symbol('x'), new Date('2026-10-03')
  ];
  for (const occurredOn of trasiga) {
    const resultat = validateMonthItemDraft(draft({ occurredOn }));
    assert.equal(resultat.ok, false, String(occurredOn));
    assert.deepEqual(resultat.errors, [{ field: 'occurredOn', message: DATUM_TEXT }], String(occurredOn));
  }
});

test('note trimmas, tar emot 200 tecken och avvisar 201 i tecken och inte i kodenheter', () => {
  assert.equal(validateMonthItemDraft(draft({ note: '  lagning  ' })).value.note, 'lagning');
  // 200 tecken går igenom, 201 avvisas. Emojifallet står med därför att
  // .length ger 400 respektive 402 för samma två strängar: mäts längden i
  // kodenheter avvisas 200 emoji, som är 200 tecken (LARDOMAR.md 2026-08-18).
  for (const tecken of ['a', '\u{1f600}']) {
    assert.equal(validateMonthItemDraft(draft({ note: tecken.repeat(200) })).ok, true, tecken);
    const resultat = validateMonthItemDraft(draft({ note: tecken.repeat(201) }));
    assert.equal(resultat.ok, false, tecken);
    assert.deepEqual(resultat.errors, [{ field: 'note', message: NOTE_TEXT_LANG }], tecken);
  }
  // En miljon tecken ger samma text. Ingen assertion på körtid: ARKITEKTUR.md
  // räknar upp de tillåtna tidsberoende villkoren i projektet, och ett fall som
  // det här står inte där. Att svaret kommer utan mätbar fördröjning är i stället
  // snabbvägens uppgift — avvisandet sker på 2 * NOTE_MAX_LENGTH kodenheter, före
  // spridningen som materialiserar hela indatan (LARDOMAR.md 2026-08-23). Samma
  // form som namnfallet i tests/entry.test.js rad 320.
  assert.deepEqual(
    validateMonthItemDraft(draft({ note: 'a'.repeat(1000000) })).errors,
    [{ field: 'note', message: NOTE_TEXT_LANG }]
  );
});

test('en note som inte är text avvisas med sin egen text', () => {
  for (const note of [42, true, {}, [], 1n, Symbol('x'), new Date()]) {
    const resultat = validateMonthItemDraft(draft({ note }));
    assert.equal(resultat.ok, false, String(note));
    assert.deepEqual(resultat.errors, [{ field: 'note', message: NOTE_TEXT_TYP }], String(note));
  }
});

test('fältordningen i errors är kind, name, amountSek, category, occurredOn, note', () => {
  const resultat = validateMonthItemDraft({
    kind: 'gift',
    name: '',
    amountSek: 'abc',
    category: 'x',
    occurredOn: 'igår',
    note: 42
  });
  assert.equal(resultat.ok, false);
  assert.deepEqual(resultat.errors.map((fel) => fel.field), [
    'kind', 'name', 'amountSek', 'category', 'occurredOn', 'note'
  ]);
  // Alla sex prövas, aldrig bara det första: ett formulär med sex fel ska visa
  // sex meddelanden samtidigt.
  assert.equal(resultat.errors.length, 6);
});