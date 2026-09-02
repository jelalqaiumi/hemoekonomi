import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  AMOUNT_MAX_SEK,
  AMOUNT_PATTERN,
  CATEGORIES,
  CATEGORY_LABELS,
  ENTRY_FIELDS,
  MAX_YEAR,
  MIN_YEAR,
  INTERVAL_LABELS,
  INTERVALS,
  NAME_MAX_LENGTH,
  canonicalAmountSek,
  createEntry,
  isEntry,
  isPlainObject,
  isValidEntryId,
  validateEntryDraft
} from '../src/core/entry.js';

function validDraft(overrides = {}) {
  return {
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription',
    ...overrides
  };
}

function messagesFor(result, field) {
  assert.equal(result.ok, false, 'posten borde ha avvisats');
  return result.errors.filter((error) => error.field === field).map((error) => error.message);
}

test('konstanterna följer datamodellen', () => {
  assert.deepEqual(INTERVALS, ['monthly', 'quarterly', 'yearly']);
  assert.deepEqual(CATEGORIES, ['housing', 'subscription', 'insurance', 'transport', 'loan', 'other']);
  assert.deepEqual(ENTRY_FIELDS, ['amountSek', 'category', 'id', 'interval', 'name', 'startDate']);
  assert.equal(NAME_MAX_LENGTH, 60);
  assert.equal(AMOUNT_MAX_SEK, 9999999.99);
  assert.equal(AMOUNT_PATTERN.source, /^-?\d{1,15}([.,]\d{1,15})?$/.source);
  assert.equal(AMOUNT_PATTERN.flags, '');
  assert.equal(MIN_YEAR, 1970);
  assert.equal(MAX_YEAR, 2099);
  assert.deepEqual(INTERVAL_LABELS, {
    monthly: 'Månadsvis',
    quarterly: 'Kvartalsvis',
    yearly: 'Årsvis'
  });
  assert.deepEqual(CATEGORY_LABELS, {
    housing: 'Boende',
    subscription: 'Prenumeration',
    insurance: 'Försäkring',
    transport: 'Transport',
    loan: 'Lån',
    other: 'Övrigt'
  });
});

test('de exporterade konstanterna är frysta och går inte att mutera', () => {
  // ESM kör alltid i strict mode, så ett muteringsförsök kastar TypeError i
  // stället för att tyst ignoreras.
  assert.throws(() => ENTRY_FIELDS.push('x'), TypeError);
  assert.deepEqual(ENTRY_FIELDS, ['amountSek', 'category', 'id', 'interval', 'name', 'startDate']);

  assert.throws(() => INTERVALS.push('weekly'), TypeError);
  assert.deepEqual(INTERVALS, ['monthly', 'quarterly', 'yearly']);

  assert.throws(() => CATEGORIES.push('food'), TypeError);
  assert.deepEqual(CATEGORIES, ['housing', 'subscription', 'insurance', 'transport', 'loan', 'other']);

  assert.throws(() => {
    INTERVAL_LABELS.weekly = 'Veckovis';
  }, TypeError);
  assert.equal('weekly' in INTERVAL_LABELS, false);

  assert.throws(() => {
    CATEGORY_LABELS.housing = 'Bostad';
  }, TypeError);
  assert.equal(CATEGORY_LABELS.housing, 'Boende');

  for (const konstant of [INTERVALS, INTERVAL_LABELS, CATEGORIES, CATEGORY_LABELS, ENTRY_FIELDS]) {
    assert.equal(Object.isFrozen(konstant), true);
  }
});

test('en muterad ENTRY_FIELDS kan inte flytta datamodellens gräns i isEntry', () => {
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  assert.throws(() => ENTRY_FIELDS.push('income'), TypeError);
  assert.equal(isEntry({ ...entry, income: 5000 }), false);
  assert.equal(isEntry(entry), true);
});

test('giltig post accepteras', () => {
  const result = validateEntryDraft(validDraft());
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  });
  assert.equal('id' in result.value, false);
});

test('giltig post normaliseras: namnet trimmas och beloppet blir ett tal', () => {
  const result = validateEntryDraft(validDraft({ name: '  Hyra  ', amountSek: '  8995,50  ' }));
  assert.equal(result.ok, true);
  assert.equal(result.value.name, 'Hyra');
  assert.equal(result.value.amountSek, 8995.5);
  assert.equal(typeof result.value.amountSek, 'number');
});

test('alla intervall och kategorier accepteras', () => {
  for (const interval of INTERVALS) {
    assert.equal(validateEntryDraft(validDraft({ interval })).ok, true, interval);
  }
  for (const category of CATEGORIES) {
    assert.equal(validateEntryDraft(validDraft({ category })).ok, true, category);
  }
});

test('createEntry lägger till ett id och rör inte övriga fält', () => {
  const result = createEntry(validDraft(), () => '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234');
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  });
  assert.equal(isEntry(result.value), true);
});

test('createEntry skapar ingen post när utkastet är ogiltigt', () => {
  const result = createEntry(validDraft({ name: '' }), () => 'skulle-inte-anvandas');
  assert.equal(result.ok, false);
  assert.equal('value' in result, false);
});

test('createEntry ger ett internt fel när makeId inte ger en icke-tom sträng', () => {
  // 42, '' och '   ' är alla tre obligatoriska enligt ARKITEKTUR.md
  // ("Interna fel i createEntry"). Blanktecken-fallet är det enda värde där ett
  // handskrivet id.length > 0 och isValidEntryId ger olika svar.
  for (const badId of [42, '', '   ', null, undefined, {}, ['id'], true]) {
    const result = createEntry(validDraft(), () => badId);
    assert.equal(result.ok, false, `id: ${String(badId)}`);
    assert.equal('value' in result, false);
    assert.deepEqual(result.errors, [
      { field: 'id', message: 'Posten kunde inte skapas på grund av ett internt fel.' }
    ]);
  }
});

test('isValidEntryId är sann bara för strängar med minst ett icke-blanktecken', () => {
  for (const value of ['abc', '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234', ' a ', '0', 'å']) {
    assert.equal(isValidEntryId(value), true, JSON.stringify(value));
  }
  for (const value of ['   ', '', '\t\n', 42, 0, null, undefined, {}, ['abc'], true, NaN]) {
    assert.equal(isValidEntryId(value), false, JSON.stringify(value));
  }
});

test('createEntry och isEntry använder samma id-villkor som isValidEntryId', () => {
  const entry = {
    id: 'x',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  // Samma värden genom båda vägarna. Går de isär har villkoret skrivits av för
  // hand på något av ställena.
  for (const id of ['abc', ' a ', '   ', '', 42, null, undefined, {}, true]) {
    const expected = isValidEntryId(id);
    assert.equal(createEntry(validDraft(), () => id).ok, expected, `createEntry, id: ${String(id)}`);
    assert.equal(isEntry({ ...entry, id }), expected, `isEntry, id: ${String(id)}`);
  }
});

test('det interna id-felet blandas inte in bland formulärfelen', () => {
  // field: 'id' är maskinläsbar härkomst, inte en etikett åt användaren, och
  // meddelandet nämner varken "id" eller något annat tekniskt nyckelord.
  const result = createEntry(validDraft(), () => 42);
  assert.equal(result.ok, false);
  assert.equal(result.errors.length, 1, 'inga formulärfel ska följa med');
  assert.equal(result.errors[0].field, 'id');
  assert.equal(/\bid\b/i.test(result.errors[0].message), false);
  // Ett ogiltigt utkast når aldrig id-kontrollen: formulärfelen kommer först.
  const invalid = createEntry(validDraft({ name: '' }), () => 42);
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.errors, [{ field: 'name', message: 'Namnet får inte vara tomt.' }]);
});

test('invariant: allt createEntry returnerar med ok true godkänns av isEntry', () => {
  const alwaysValid = [
    validDraft(),
    validDraft({ name: '  Hyra  ', amountSek: '8995,50', interval: 'quarterly', category: 'housing' }),
    validDraft({ amountSek: '199', interval: 'yearly', startDate: '2024-02-29', category: 'insurance' }),
    validDraft({ name: '🎵'.repeat(60), amountSek: 9999999.99, startDate: '1970-01-01', category: 'loan' }),
    validDraft({ amountSek: 0.01, startDate: '2099-12-31', category: 'other' })
  ];
  // Gränsvärden kring decimalregelns tolerans. De ska avvisas, men invarianten
  // måste hålla oavsett vilken sida av gränsen ett värde hamnar på — det var
  // exakt här den brast: ok: true med amountSek 0, som isEntry underkände.
  const boundary = [
    1e-9, '0,000000001', 9.9e-9, '0,0000000099', 1e-8, '0,00000001',
    0.001, '0,001', 0.005, '0,005', 0.01, '0,01'
  ].map((amountSek) => validDraft({ amountSek }));

  let counter = 0;
  for (const draft of [...alwaysValid, ...boundary]) {
    counter += 1;
    const result = createEntry(draft, () => `id-${counter}`);
    if (result.ok) {
      assert.equal(isEntry(result.value), true, JSON.stringify(result.value));
      assert.equal(result.value.amountSek > 0, true, JSON.stringify(result.value));
    } else {
      assert.equal('value' in result, false, JSON.stringify(draft));
    }
  }

  // De typiska posterna måste dessutom faktiskt vara giltiga, annars skulle
  // testet ovan kunna passera med enbart avvisade utkast.
  for (const draft of alwaysValid) {
    assert.equal(createEntry(draft, () => 'id-x').ok, true, JSON.stringify(draft));
  }
});

test('belopp som avrundas till noll öre avvisas i stället för att lagras som 0', () => {
  // Under decimalregelns tolerans (v * 100 < 1e-6) passerar värdet regel 3 och
  // fångas i stället av omprövningen av regel 1 på det lagrade värdet.
  for (const amountSek of [1e-9, '0,000000001', 9.9e-9, '0,0000000099', 1e-15, '0,000000000000001']) {
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'),
      ['Beloppet måste vara större än 0 kr.'],
      `amountSek: ${JSON.stringify(amountSek)}`
    );
  }
});

test('på andra sidan toleransgränsen vinner decimalregeln', () => {
  // 1e-8 * 100 = 1e-6, alltså precis på toleransen: decimalfelet, inte nollfelet.
  for (const amountSek of [1e-8, '0,00000001', 0.001, '0,001', 0.005, '0,005']) {
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'),
      ['Beloppet får ha högst två decimaler.'],
      `amountSek: ${JSON.stringify(amountSek)}`
    );
  }
  // Minsta godtagbara belopp är ett öre, och det lagras som 0.01.
  for (const amountSek of [0.01, '0,01']) {
    const result = validateEntryDraft(validDraft({ amountSek }));
    assert.equal(result.ok, true, String(amountSek));
    assert.equal(result.value.amountSek, 0.01, String(amountSek));
  }
});

test('createEntry med standard-makeId ger ett id som isEntry godkänner', () => {
  const result = createEntry(validDraft());
  assert.equal(result.ok, true);
  assert.equal(typeof result.value.id, 'string');
  assert.equal(isEntry(result.value), true);
});

test('tomt namn avvisas', () => {
  for (const name of ['', '   ', undefined, null, 42]) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ name })), 'name'), [
      'Namnet får inte vara tomt.'
    ]);
  }
});

test('för långt namn avvisas', () => {
  const tooLong = 'a'.repeat(61);
  assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ name: tooLong })), 'name'), [
    'Namnet får vara högst 60 tecken.'
  ]);
  assert.equal(validateEntryDraft(validDraft({ name: 'a'.repeat(60) })).ok, true);
});

test('namnlängden mäts i tecken, även för tecken utanför BMP', () => {
  // Varje emoji är två UTF-16-kodenheter. 60 tecken ska godtas, 61 avvisas.
  const emoji = '🎵';
  assert.equal(emoji.length, 2, 'testfallet förutsätter ett tecken utanför BMP');
  assert.equal(validateEntryDraft(validDraft({ name: emoji.repeat(60) })).ok, true);
  assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ name: emoji.repeat(61) })), 'name'), [
    'Namnet får vara högst 60 tecken.'
  ]);
  // 31 emoji ger .length 62 men är bara 31 tecken och ska passera.
  assert.equal(validateEntryDraft(validDraft({ name: emoji.repeat(31) })).ok, true);
});

test('namnlängden avvisas billigt utan att hela indatan materialiseras', () => {
  // Lärdomen 2026-08-23: [...trimmed].length byggde en array med ett element per
  // tecken i hela strängen fast svaret var avgjort efter 61 tecken. Snabbvägen
  // trimmed.length > 2 * NAME_MAX_LENGTH svarar utan det. Ingen assertion på
  // körtid här - teststrategin förbjuder det, tiden redovisas som mätning.
  assert.deepEqual(
    messagesFor(validateEntryDraft(validDraft({ name: 'a'.repeat(1000000) })), 'name'),
    ['Namnet får vara högst 60 tecken.']
  );

  // 60 emoji är exakt 120 kodenheter, alltså inte fler än 2 * NAME_MAX_LENGTH.
  // Namnet måste därför nå teckenräkningen och godkännas där. Detta är den enda
  // indata som skiljer snabbvägens > från ett felaktigt >=.
  const emoji = '🎵';
  assert.equal(emoji.repeat(60).length, 2 * NAME_MAX_LENGTH);
  assert.equal(validateEntryDraft(validDraft({ name: emoji.repeat(60) })).ok, true);
});

test('belopp som inte är ett tal avvisas', () => {
  const notNumbers = [
    // Strängar som inte matchar AMOUNT_PATTERN.
    'abc', '', '   ', '12 kr', '50 kr', ',5', '.5', '1 234,50', '1,2,3', '1e3', '-',
    '1234567890123456', '-1234567890123456',
    // Alla andra typer än number och string.
    undefined, null, true, false, {}, [], [199],
    // Tal som inte är finita.
    NaN, Infinity, -Infinity
  ];
  for (const amountSek of notNumbers) {
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'),
      ['Beloppet måste vara ett tal.'],
      `amountSek: ${JSON.stringify(amountSek)}`
    );
  }
});

test('negativt belopp avvisas', () => {
  for (const amountSek of [-50, -0.01, 0, '0', '0,00']) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'), [
      'Beloppet måste vara större än 0 kr.'
    ]);
  }
});

test('belopp med fler än två decimaler avvisas', () => {
  for (const amountSek of [10.001, '10,001']) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'), [
      'Beloppet får ha högst två decimaler.'
    ]);
  }
});

test('för stort belopp avvisas', () => {
  assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ amountSek: 10000000 })), 'amountSek'), [
    'Beloppet får vara högst 9 999 999,99 kr.'
  ]);
  assert.equal(validateEntryDraft(validDraft({ amountSek: 9999999.99 })).ok, true);
});

// Facittabellen i ARKITEKTUR.md ("samma värde, samma fel i båda ingångstyperna").
// Varje rad körs både som sträng och som tal och ska ge identiskt utfall.
const AMOUNT_REJECTED_CASES = [
  ['abc', NaN, 'Beloppet måste vara ett tal.'],
  ['50 kr', Infinity, 'Beloppet måste vara ett tal.'],
  ['', null, 'Beloppet måste vara ett tal.'],
  ['0', 0, 'Beloppet måste vara större än 0 kr.'],
  ['0,000', 0, 'Beloppet måste vara större än 0 kr.'],
  ['-0', -0, 'Beloppet måste vara större än 0 kr.'],
  ['-0,00', -0, 'Beloppet måste vara större än 0 kr.'],
  ['-50', -50, 'Beloppet måste vara större än 0 kr.'],
  ['10000000', 10000000, 'Beloppet får vara högst 9 999 999,99 kr.'],
  ['9999999,995', 9999999.995, 'Beloppet får vara högst 9 999 999,99 kr.'],
  ['1,005', 1.005, 'Beloppet får ha högst två decimaler.'],
  ['0,001', 0.001, 'Beloppet får ha högst två decimaler.']
];

const AMOUNT_ACCEPTED_CASES = [
  ['199', 199, 199],
  ['199,50', 199.5, 199.5],
  ['1,000', 1, 1],
  ['9999999,99', 9999999.99, 9999999.99]
];

test('facit: avvisade belopp ger samma meddelande som sträng och som tal', () => {
  for (const [asString, asNumber, message] of AMOUNT_REJECTED_CASES) {
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek: asString })), 'amountSek'),
      [message],
      `sträng: ${JSON.stringify(asString)}`
    );
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek: asNumber })), 'amountSek'),
      [message],
      `tal: ${String(asNumber)}`
    );
  }
});

test('facit: godkända belopp ger samma normaliserade värde som sträng och som tal', () => {
  for (const [asString, asNumber, expected] of AMOUNT_ACCEPTED_CASES) {
    const fromString = validateEntryDraft(validDraft({ amountSek: asString }));
    const fromNumber = validateEntryDraft(validDraft({ amountSek: asNumber }));
    assert.equal(fromString.ok, true, `sträng: ${asString}`);
    assert.equal(fromNumber.ok, true, `tal: ${asNumber}`);
    assert.equal(fromString.value.amountSek, expected, `sträng: ${asString}`);
    assert.equal(fromNumber.value.amountSek, expected, `tal: ${asNumber}`);
    assert.equal(typeof fromString.value.amountSek, 'number');
  }
});

test("'0,000' och 0 ger identiskt fel, och '1,000' accepteras som 1", () => {
  const fromString = validateEntryDraft(validDraft({ amountSek: '0,000' }));
  const fromNumber = validateEntryDraft(validDraft({ amountSek: 0 }));
  assert.equal(fromString.ok, false);
  assert.deepEqual(fromString.errors, fromNumber.errors);
  assert.deepEqual(messagesFor(fromString, 'amountSek'), ['Beloppet måste vara större än 0 kr.']);

  const thousand = validateEntryDraft(validDraft({ amountSek: '1,000' }));
  assert.equal(thousand.ok, true);
  assert.equal(thousand.value.amountSek, 1);
});

test('beloppet lagras med högst två decimaler och utan flyttalsskräp', () => {
  for (const [raw, expected] of [['199,50', 199.5], [199.5, 199.5], ['1,00', 1], [8995.5, 8995.5]]) {
    const result = validateEntryDraft(validDraft({ amountSek: raw }));
    assert.equal(result.ok, true, String(raw));
    assert.equal(result.value.amountSek, Math.round(result.value.amountSek * 100) / 100, String(raw));
    assert.equal(result.value.amountSek, expected, String(raw));
  }
});

test('okänt betalningsintervall avvisas', () => {
  for (const interval of ['weekly', 'MONTHLY', 'månadsvis', '', undefined, null, 1]) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ interval })), 'interval'), [
      'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis eller årsvis.'
    ]);
  }
});

test('startdatum med fel format avvisas', () => {
  for (const startDate of ['2026-1-5', '31/01/2026', 'imorgon', '', undefined, null, 20260131]) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ startDate })), 'startDate'), [
      'Startdatum måste anges som ÅÅÅÅ-MM-DD.'
    ]);
  }
});

test('startdatum som inte finns i kalendern avvisas', () => {
  for (const startDate of ['2026-02-30', '2026-13-01', '2026-00-10', '2025-02-29', '2026-04-31']) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ startDate })), 'startDate'), [
      'Startdatum är inget giltigt datum.'
    ]);
  }
  assert.equal(validateEntryDraft(validDraft({ startDate: '2024-02-29' })).ok, true);
});

test('startdatum utanför 1970-2099 avvisas', () => {
  for (const startDate of ['1969-12-31', '2100-01-01']) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ startDate })), 'startDate'), [
      'Startdatum måste ligga mellan 1970-01-01 och 2099-12-31.'
    ]);
  }
  assert.equal(validateEntryDraft(validDraft({ startDate: '1970-01-01' })).ok, true);
  assert.equal(validateEntryDraft(validDraft({ startDate: '2099-12-31' })).ok, true);
});

test('okänd kategori avvisas', () => {
  for (const category of ['mat', 'Boende', '', undefined, null, 3]) {
    assert.deepEqual(messagesFor(validateEntryDraft(validDraft({ category })), 'category'), [
      'Välj en giltig kategori.'
    ]);
  }
});

test('alla fältfel returneras, ett per fält och i fältordning', () => {
  const result = validateEntryDraft({});
  assert.equal(result.ok, false);
  assert.deepEqual(result.errors, [
    { field: 'name', message: 'Namnet får inte vara tomt.' },
    { field: 'amountSek', message: 'Beloppet måste vara ett tal.' },
    {
      field: 'interval',
      message: 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis eller årsvis.'
    },
    { field: 'startDate', message: 'Startdatum måste anges som ÅÅÅÅ-MM-DD.' },
    { field: 'category', message: 'Välj en giltig kategori.' }
  ]);
});

test('utkast som inte är ett objekt avvisas utan krasch', () => {
  for (const draft of [undefined, null, 'text', 7, []]) {
    const result = validateEntryDraft(draft);
    assert.equal(result.ok, false);
    assert.equal(result.errors.length, 5);
  }
});

test('isEntry känner igen en färdig post och avvisar ofullständiga', () => {
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  assert.equal(isEntry(entry), true);
  assert.equal(isEntry({ ...entry, id: '' }), false);
  assert.equal(isEntry({ ...entry, amountSek: '199' }), false);
  assert.equal(isEntry({ ...entry, name: ' Spotify ' }), false);
  assert.equal(isEntry({ ...entry, interval: 'weekly' }), false);
  assert.equal(isEntry(null), false);
});

test('isEntry avvisar belopp som avrundas till noll öre i datafilen', () => {
  // Andra halvan av lärdomen 2026-08-19: isEntry är enda spärren när storage.js
  // läser filen från disk, och ett belopp under decimalregelns tolerans slapp
  // förbi där precis som i createEntry. Båda sidor om gränsen testas.
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  for (const amountSek of [1e-15, 1e-9, 9.9e-9, 1e-8, 0.005, 0, -0, -50]) {
    assert.equal(isEntry({ ...entry, amountSek }), false, `amountSek: ${amountSek}`);
  }
  // Minsta belopp som får finnas i datafilen är ett öre.
  assert.equal(isEntry({ ...entry, amountSek: 0.01 }), true);
});

test('isEntry avvisar poster med okända fält', () => {
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  assert.equal(isEntry(entry), true);
  // Fält för bortvalda funktioner (PLAN.md beslut 1-4) får inte slinka igenom.
  assert.equal(isEntry({ ...entry, income: 5000, history: [], nextDueDate: '2026-02-28' }), false);
  assert.equal(isEntry({ ...entry, income: 5000 }), false);
  assert.equal(isEntry({ ...entry, history: [] }), false);
  assert.equal(isEntry({ ...entry, nextDueDate: '2026-02-28' }), false);
  assert.equal(isEntry({ ...entry, accountId: 'abc' }), false);
  assert.equal(isEntry({ ...entry, currency: 'SEK' }), false);
  // Ett saknat fält avvisas också. Vilket villkor som fäller det påstås inte här
  // - lärdomen 2026-08-23 gällde just en kommentar som namngav fel kodväg.
  for (const field of ['id', 'name', 'amountSek', 'interval', 'startDate', 'category']) {
    const incomplete = { ...entry };
    delete incomplete[field];
    assert.equal(isEntry(incomplete), false, `utan ${field}`);
  }
});

test('isEntry avvisar belopp som inte redan är sin kanoniska lagringsform', () => {
  // Lärdomen 2026-08-23: regel 3 är en toleransjämförelse, så 199.999999999
  // passerade regelkedjan medan skrivvägen för samma värde lagrar 200. En
  // datafil kunde alltså innehålla ett belopp som appen därefter räknar med som
  // ett annat tal. Kedjan frågar "är detta godtagbart som indata", isEntry
  // frågar "är detta den form skrivvägen producerar".
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  for (const amountSek of [199.999999999, 199.000000001]) {
    assert.equal(isEntry({ ...entry, amountSek }), false, `amountSek: ${amountSek}`);
  }
  for (const amountSek of [0.01, 199.5, 9999999.99]) {
    assert.equal(isEntry({ ...entry, amountSek }), true, `amountSek: ${amountSek}`);
  }
});

test('canonicalAmountSek är en fixpunkt på sin egen utdata', () => {
  // Invarianten "allt som createEntry returnerar med ok: true godkänns av
  // isEntry" vilar på detta: skrivvägen returnerar canonicalAmountSek(v) och
  // isEntry frågar om värdet är lika med canonicalAmountSek av sig självt.
  // Håller likheten inte för något lagringsbart belopp faller invarianten.
  const avvikande = [];
  for (let ore = 1; ore <= 200000; ore += 1) {
    const kronor = ore / 100;
    if (canonicalAmountSek(kronor) !== kronor) {
      avvikande.push(ore);
    }
  }
  assert.deepEqual(avvikande, [], 'ore-värden där fixpunkten inte håller');

  // Facittabellens giltiga värden, inklusive maxbeloppet.
  for (const ore of [19900, 19950, 100, 1, 999999999]) {
    const kronor = ore / 100;
    assert.equal(canonicalAmountSek(kronor), kronor, `ore: ${ore}`);
  }
});

test('allt som createEntry godkänner godkänns av isEntry, även vid gränserna', () => {
  // Invarianttestet körs med värden från gränserna, inte bara typiska belopp.
  const makeId = () => '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234';
  for (const amountSek of ['0,01', '9999999,99', '199,999999999', 199.999999999, '1,005', 0.01]) {
    const result = createEntry({
      name: 'Spotify Family',
      amountSek,
      interval: 'monthly',
      startDate: '2026-01-31',
      category: 'subscription'
    }, makeId);
    if (result.ok) {
      assert.equal(isEntry(result.value), true, `amountSek: ${amountSek}`);
    }
  }
});

test('isEntry avvisar amountSek av en typ som kanoniseringen inte kan räkna på', () => {
  // Mutationsprövning av delvillkoret `typeof value.amountSek !== 'number'`:
  // utan det anropas canonicalAmountSek med värdet, och för BigInt och Symbol
  // kastar Math.round(v * 100) TypeError i stället för att isEntry svarar false.
  // Likhetskontrollen ensam räcker alltså inte - den kraschar först. Detta är
  // det enda testfall som bara det delvillkoret kan få att fälla avgörandet.
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: 199,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  for (const amountSek of [199n, 0n, Symbol('199')]) {
    assert.equal(isEntry({ ...entry, amountSek }), false, `amountSek: ${String(amountSek)}`);
  }
});

// isPlainObject äger villkoret "är det här ett vanligt objekt" och anropas av
// både isEntry här och yearlyOre i cost.js. Ett Date är ett vanligt objekt; en
// array är det inte, och det är just arrayen den tidigare kopian i cost.js
// släppte igenom.
test('isPlainObject godkänner vanliga objekt och avvisar arrayer och primitiver', () => {
  for (const value of [{}, new Date()]) {
    assert.equal(isPlainObject(value), true, String(value));
  }
  const notObjects = [[], [1], null, undefined, 'abc', 42, true, Symbol('x'), 100n, () => {}];
  for (const value of notObjects) {
    assert.equal(isPlainObject(value), false, String(value));
  }
});

// entry.js importerar konstanten ORE_PER_SEK från money.js men aldrig sekToOre:
// sekToOre kastar RangeError för ett tal som inte är finit, medan
// canonicalAmountSek måste svara med ett tal så att isEntry kan returnera false
// för en datafil med amountSek: NaN i stället för att krascha inläsningen.
test('canonicalAmountSek(NaN) ger NaN och isEntry svarar false utan att kasta', () => {
  assert.equal(Number.isNaN(canonicalAmountSek(NaN)), true);
  assert.equal(Number.isNaN(canonicalAmountSek(Infinity)), false);
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: NaN,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  assert.doesNotThrow(() => isEntry(entry));
  assert.equal(isEntry(entry), false);
});

// --- -0 i entry.js
// Beslutet "-0 normaliseras till 0" ändrar inte valideringen: -0 är noll skrivet
// med tecken, och regel 1 (v <= 0) är sann för det. Ingen ny felsträng infördes.

test('-0 avvisas av regel 1 i alla tre skrivsätten', () => {
  for (const amountSek of [-0, '-0', '-0,00']) {
    assert.deepEqual(
      messagesFor(validateEntryDraft(validDraft({ amountSek })), 'amountSek'),
      ['Beloppet måste vara större än 0 kr.'],
      String(amountSek)
    );
  }
});

// canonicalAmountSek anropar normalizeZero, som äger villkoret "detta är -0".
// Utan anropet lagras -0 och formatSek visar minustecknet U+2212 för användaren.
// Object.is, inte ===: -0 === 0 är true och kan aldrig falla.
test('canonicalAmountSek ger 0 och aldrig -0', () => {
  assert.equal(Object.is(canonicalAmountSek(-0), 0), true);
  assert.equal(Object.is(canonicalAmountSek(-1e-9), 0), true);
  assert.equal(Object.is(canonicalAmountSek(-0.001), 0), true);
  assert.equal(Object.is(canonicalAmountSek(-0.004), 0), true);
  // Ett verkligt negativt belopp normaliseras inte bort.
  assert.equal(canonicalAmountSek(-0.01), -0.01);
});

// isEntry avvisar -0 i steg 6, genom regelkedjans regel 1 — inte i steg 5:
// canonicalAmountSek(-0) är 0 och -0 === 0 är true, så likhetsjämförelsen
// passerar. isEntry får aldrig kasta för värdet.
test('isEntry svarar false för amountSek: -0 utan att kasta', () => {
  const entry = {
    id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
    name: 'Spotify Family',
    amountSek: -0,
    interval: 'monthly',
    startDate: '2026-01-31',
    category: 'subscription'
  };
  assert.doesNotThrow(() => isEntry(entry));
  assert.equal(isEntry(entry), false);
  assert.equal(entry.amountSek === canonicalAmountSek(entry.amountSek), true);
  assert.deepEqual(
    messagesFor(validateEntryDraft(entry), 'amountSek'),
    ['Beloppet måste vara större än 0 kr.']
  );
});
