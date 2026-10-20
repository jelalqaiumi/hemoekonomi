import assert from 'node:assert/strict';
import test from 'node:test';

import { AMOUNT_MAX_SEK, AMOUNT_PATTERN, checkAmountSek } from '../src/core/entry.js';
import { sekToOre } from '../src/core/money.js';
import { csvAmountSek, csvText, toCsv } from '../src/core/csv.js';

const BOM = '\ufeff';
const CRLF = '\r\n';

const ICKE_ORETAL = [
  NaN,
  Infinity,
  -Infinity,
  '1234',
  '',
  null,
  undefined,
  true,
  1.5,
  1e300,
  Number.MAX_SAFE_INTEGER + 2,
  {},
  [],
  [1],
  new Date(),
  1n,
  Symbol('x')
];

const ICKE_STRANGAR = [0, -0, 42, NaN, Infinity, -Infinity, null, undefined, true, {}, [], ['a'], new Date(), 1n, Symbol('x')];

const ICKE_CELLER = [
  {},
  { text: 'a', amountOre: 1 },
  { text: 'a', extra: 1 },
  { belopp: 1 },
  { Text: 'a' },
  null,
  undefined,
  'abc',
  42,
  true,
  [],
  [1],
  [{ text: 'a' }],
  new Date(),
  1n,
  Symbol('x')
];

test('spärrtabellen rad 1: csvAmountSek kastar med hela meddelandet för ett tal som inte är ett säkert heltal', () => {
  assert.throws(
    () => csvAmountSek(1.5),
    { name: 'RangeError', message: 'csvAmountSek kräver ett säkert heltal öre.' }
  );
});

test('spärrtabellen rad 1: varje värde som inte är ett säkert heltal öre ger samma meddelande', () => {
  for (const värde of ICKE_ORETAL) {
    assert.throws(
      () => csvAmountSek(värde),
      { name: 'RangeError', message: 'csvAmountSek kräver ett säkert heltal öre.' },
      `${String(värde)} skulle ha nått rad 1`
    );
  }
});

test('csvAmountSek tar emot -0, kastar inte och ger 0,00', () => {
  assert.equal(csvAmountSek(-0), '0,00');
  assert.equal(csvAmountSek(-0).includes('-'), false);
  assert.equal(csvAmountSek(0), '0,00');

  const tillbaka = sekToOre(Number(csvAmountSek(-0).replace(',', '.')));
  assert.equal(Object.is(tillbaka, -0), false);
  assert.equal(tillbaka, 0);
});

test('spärrtabellen rad 2: csvText kastar med hela meddelandet för ett tal', () => {
  assert.throws(
    () => csvText(42),
    { name: 'RangeError', message: 'csvText kräver en sträng.' }
  );
});

test('spärrtabellen rad 2: varje värde som inte är en sträng ger samma meddelande', () => {
  for (const värde of ICKE_STRANGAR) {
    assert.throws(
      () => csvText(värde),
      { name: 'RangeError', message: 'csvText kräver en sträng.' },
      `${String(värde)} skulle ha nått rad 2`
    );
  }
});

test('spärrtabellen rad 2 gäller också en text inuti en cell', () => {
  assert.throws(
    () => toCsv([[{ text: 42 }]]),
    { name: 'RangeError', message: 'csvText kräver en sträng.' }
  );
});

test('spärrtabellen rad 3: toCsv kastar med hela meddelandet för något som inte är en lista', () => {
  assert.throws(
    () => toCsv({ rows: [] }),
    { name: 'RangeError', message: 'toCsv kräver en lista med rader.' }
  );
  for (const värde of [null, undefined, 'abc', 42, true, new Date(), 1n, Symbol('x')]) {
    assert.throws(
      () => toCsv(värde),
      { name: 'RangeError', message: 'toCsv kräver en lista med rader.' },
      `${String(värde)} skulle ha nått rad 3`
    );
  }
});

test('spärrtabellen rad 4: meddelandet namnger radens index', () => {
  assert.throws(
    () => toCsv(['inte en rad']),
    { name: 'RangeError', message: 'toCsv kräver att varje rad är en lista, raden på index 0 är det inte.' }
  );
  assert.throws(
    () => toCsv([[{ text: 'a' }], [{ text: 'b' }], { text: 'c' }]),
    { name: 'RangeError', message: 'toCsv kräver att varje rad är en lista, raden på index 2 är det inte.' }
  );
});

test('spärrtabellen rad 5: meddelandet namnger rad och kolumn', () => {
  assert.throws(
    () => toCsv([[{ text: 'a' }, {}]]),
    { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 0 kolumn 1.' }
  );
  assert.throws(
    () => toCsv([[{ text: 'a' }], [{ amountOre: 1 }, { text: 'b' }, 'nej']]),
    { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 1 kolumn 2.' }
  );
});

test('spärrtabellen rad 5: en cell med båda nycklarna avvisas, inte vald tyst', () => {
  assert.throws(
    () => toCsv([[{ text: 'a', amountOre: 1 }]]),
    { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 0 kolumn 0.' }
  );
});

test('spärrtabellen rad 5: varje värde som inte är en cell med exakt en nyckel ger samma meddelande', () => {
  for (const värde of ICKE_CELLER) {
    assert.throws(
      () => toCsv([[värde]]),
      { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 0 kolumn 0.' },
      `${String(värde)} skulle ha nått rad 5`
    );
  }
});

test('spärrtabellen rad 1 gäller också ett belopp inuti en cell', () => {
  assert.throws(
    () => toCsv([[{ amountOre: 1.5 }]]),
    { name: 'RangeError', message: 'csvAmountSek kräver ett säkert heltal öre.' }
  );
});

test('rad 4 vinner över rad 2 och rad 5 i en tidigare rad', () => {
  assert.throws(
    () => toCsv([[{ text: 42 }], 'inte en rad']),
    { name: 'RangeError', message: 'toCsv kräver att varje rad är en lista, raden på index 1 är det inte.' }
  );
  assert.throws(
    () => toCsv([[{}], 'inte en rad']),
    { name: 'RangeError', message: 'toCsv kräver att varje rad är en lista, raden på index 1 är det inte.' }
  );
});

test('rad 5 i en senare rad vinner över rad 1 och rad 2 i en tidigare', () => {
  assert.throws(
    () => toCsv([[{ text: 42 }], [{}]]),
    { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 1 kolumn 0.' }
  );
  assert.throws(
    () => toCsv([[{ amountOre: 1.5 }], [{}]]),
    { name: 'RangeError', message: 'toCsv kräver en cell med text eller amountOre, rad 1 kolumn 0.' }
  );
});

test('rad 3 vinner över allt annat', () => {
  assert.throws(
    () => toCsv('nej'),
    { name: 'RangeError', message: 'toCsv kräver en lista med rader.' }
  );
});

test('(RA1) filen börjar med en UTF-8 BOM, kodpunkt U+FEFF', () => {
  const ut = toCsv([[{ text: 'Namn' }]]);
  assert.equal(ut.codePointAt(0), 0xfeff);
  assert.equal(ut.startsWith(BOM), true);
  assert.equal(ut.indexOf(BOM, 1), -1);
  assert.equal(ut.codePointAt(1), 'N'.codePointAt(0));
});

test('(RA1) en tom lista ger BOM och ingenting mer', () => {
  assert.equal(toCsv([]), BOM);
});

test('(RA2) radslutet är CR LF, kodpunkterna U+000D U+000A, och aldrig ett ensamt LF', () => {
  const ut = toCsv([[{ text: 'a' }], [{ text: 'b' }]]);
  assert.equal(ut, `${BOM}a${CRLF}b${CRLF}`);
  assert.equal(ut.split('\n').length - 1, 2);
  assert.equal(ut.split(CRLF).length - 1, 2);
  assert.equal(/[^\r]\n/.test(ut), false, 'ett LF utan CR framför betyder att radslutet inte är CR LF');
  assert.equal(ut.codePointAt(ut.length - 2), 0x000d);
  assert.equal(ut.codePointAt(ut.length - 1), 0x000a);
});

test('(RA2) avgränsaren mellan celler är semikolon och inte komma', () => {
  assert.equal(toCsv([[{ text: 'Mat' }, { amountOre: 123450 }]]), `${BOM}Mat;1234,50${CRLF}`);
});

test('(RA3) en text som börjar med likhetstecken får en apostrof', () => {
  assert.equal(csvText('=1+1'), "'=1+1");
});

test('(RA3) en text som börjar med plus får en apostrof', () => {
  assert.equal(csvText('+46 70'), "'+46 70");
});

test('(RA3) en text som börjar med minus får en apostrof', () => {
  assert.equal(csvText('-rabatt'), "'-rabatt");
});

test('(RA3) en text som börjar med snabel-a får en apostrof', () => {
  assert.equal(csvText('@SUM'), "'@SUM");
});

test('(RA3) en text som börjar med tabb, U+0009, får en apostrof', () => {
  assert.equal(csvText('\tHyra'), "'\tHyra");
});

test('(RA3) en text som börjar med CR, U+000D, får en apostrof', () => {
  assert.equal(csvText('\rHyra'), "'\rHyra");
});

test('(RA3) apostrofen sätts också när texten går genom toCsv', () => {
  assert.equal(toCsv([[{ text: '=1+1' }]]), `${BOM}'=1+1${CRLF}`);
});

test('(RA3) en text som inte börjar med något av de sex tecknen får ingen apostrof', () => {
  const utan = ['Hyra', 'a', '0', '9,50', ' Hyra', '\nHyra', '"Hyra"', ';', '!', '#', 'Ångbåt', ''];
  for (const text of utan) {
    assert.equal(csvText(text), text, `${JSON.stringify(text)} skulle ha lämnats orörd`);
  }
});

test('(RA3) ett av de sex tecknen mitt i texten ger ingen apostrof', () => {
  assert.equal(csvText('1+1'), '1+1');
  assert.equal(csvText('a=b'), 'a=b');
  assert.equal(csvText('post@hem'), 'post@hem');
});

test('(RA4) ett negativt belopp får ingen apostrof, trots att strängen börjar med minus', () => {
  assert.equal(csvAmountSek(-123450), '-1234,50');
  assert.equal(toCsv([[{ amountOre: -123450 }]]), `${BOM}-1234,50${CRLF}`);
  assert.equal(toCsv([[{ amountOre: -1 }]]), `${BOM}-0,01${CRLF}`);
  assert.equal(toCsv([[{ amountOre: -123450 }]]).includes("'"), false);
});

test('(RA4) samma tecken i en textcell får apostrof i samma fil som beloppet inte får det', () => {
  assert.equal(toCsv([[{ text: '-rabatt' }, { amountOre: -50 }]]), `${BOM}'-rabatt;-0,50${CRLF}`);
});

test('(RA5) en cell med semikolon citeras', () => {
  assert.equal(toCsv([[{ text: 'Mat; dryck' }]]), `${BOM}"Mat; dryck"${CRLF}`);
});

test('(RA5) ett inre citattecken dubbleras och cellen citeras', () => {
  assert.equal(toCsv([[{ text: 'He"j' }]]), `${BOM}"He""j"${CRLF}`);
  assert.equal(toCsv([[{ text: '""' }]]), `${BOM}""""""${CRLF}`);
});

test('(RA5) ett radbrott i en cell citeras, både LF och CR', () => {
  assert.equal(toCsv([[{ text: 'Rad\nbrott' }]]), `${BOM}"Rad\nbrott"${CRLF}`);
  assert.equal(toCsv([[{ text: 'Rad\rbrott' }]]), `${BOM}"Rad\rbrott"${CRLF}`);
  assert.equal(toCsv([[{ text: `Rad${CRLF}brott` }]]), `${BOM}"Rad${CRLF}brott"${CRLF}`);
});

test('(RA5) semikolon, citattecken och radbrott i samma cell', () => {
  assert.equal(toCsv([[{ text: 'a;b"c\nd' }]]), `${BOM}"a;b""c\nd"${CRLF}`);
});

test('(RA5) apostrofen hamnar inuti citattecknen när båda reglerna gäller', () => {
  assert.equal(toCsv([[{ text: '=1;2' }]]), `${BOM}"'=1;2"${CRLF}`);
});

test('(RA5) en cell utan något av de tre tecknen citeras inte', () => {
  for (const text of ['Hyra', 'a,b', "'=1", 'Ångbåt', '', ' ']) {
    assert.equal(toCsv([[{ text }]]), `${BOM}${text}${CRLF}`, `${JSON.stringify(text)} skulle inte ha citerats`);
  }
  assert.equal(toCsv([[{ amountOre: -123450 }]]).includes('"'), false);
});

test('(RA5) citeringen gäller cell för cell och inte hela raden', () => {
  assert.equal(
    toCsv([[{ text: 'Mat;dryck' }, { text: 'Hyra' }, { amountOre: 100 }]]),
    `${BOM}"Mat;dryck";Hyra;1,00${CRLF}`
  );
});

test('(RA6) beloppet skrivs med decimalkomma, två decimaler, ingen enhet och ingen tusentalsavgränsare', () => {
  assert.equal(csvAmountSek(123450), '1234,50');
  assert.equal(csvAmountSek(0), '0,00');
  assert.equal(csvAmountSek(1), '0,01');
  assert.equal(csvAmountSek(-1), '-0,01');
  assert.equal(csvAmountSek(10), '0,10');
  assert.equal(csvAmountSek(99), '0,99');
  assert.equal(csvAmountSek(100), '1,00');
  assert.equal(csvAmountSek(999999999), '9999999,99');
  assert.equal(csvAmountSek(-999999999), '-9999999,99');
  assert.equal(csvAmountSek(Number.MAX_SAFE_INTEGER), '90071992547409,91');
});

test('(RA6) beloppet bär inget hårt blanksteg, ingen enhet och inget minustecken utom ASCII-minus', () => {
  for (const ore of [0, 1, -1, 123450, -123450, 999999999, Number.MAX_SAFE_INTEGER]) {
    const sträng = csvAmountSek(ore);
    assert.equal(sträng.includes('\u00a0'), false, `${ore} fick ett hårt blanksteg`);
    assert.equal(sträng.includes('\u0020'), false, `${ore} fick ett vanligt blanksteg`);
    assert.equal(sträng.includes('\u2212'), false, `${ore} fick U+2212 i stället för ASCII-minus`);
    assert.equal(sträng.includes('kr'), false, `${ore} fick en enhet`);
    assert.equal(sträng.includes('.'), false, `${ore} fick en punkt`);
    assert.equal(/^-?\d+,\d{2}$/.test(sträng), true, `${ore} gav ${JSON.stringify(sträng)}`);
  }
});

const MAX_ORE = sekToOre(AMOUNT_MAX_SEK);
const RUNDGANG_ORE = [0, -0, 1, -1, 10, -10, 99, 100, 999, 123450, -123450, MAX_ORE, -MAX_ORE, Number.MAX_SAFE_INTEGER];

test('(RA7) varje skrivet belopp matchar AMOUNT_PATTERN och ger samma antal ören tillbaka', () => {
  assert.equal(MAX_ORE, 999999999);
  for (const ore of RUNDGANG_ORE) {
    const skrivet = csvAmountSek(ore);

    assert.equal(AMOUNT_PATTERN.test(skrivet), true, `${ore} skrevs som ${JSON.stringify(skrivet)}, som mönstret underkänner`);

    const tillbaka = sekToOre(Number(skrivet.replace(',', '.')));
    assert.equal(tillbaka === ore, true, `${ore} lästes tillbaka som ${tillbaka}`);
    assert.equal(Object.is(tillbaka, -0), false, `${ore} lästes tillbaka som -0`);
  }
});

test('(RA7) hela checkAmountSek ger samma ören tillbaka för varje belopp den godtar', () => {
  const godtagna = RUNDGANG_ORE.filter((ore) => ore >= 1 && ore <= MAX_ORE);
  assert.equal(godtagna.length, 7);
  for (const ore of godtagna) {
    const skrivet = csvAmountSek(ore);
    const svar = checkAmountSek(skrivet);
    assert.equal(svar.message, undefined, `${skrivet} avvisades med ${svar.message}`);
    assert.equal(sekToOre(svar.value), ore, `${ore} lästes tillbaka som ${sekToOre(svar.value)} ören`);
  }
});

test('(RA7) de belopp checkAmountSek avvisar avvisas på värdet, aldrig på formatet', () => {
  const avvisade = RUNDGANG_ORE.filter((ore) => !(ore >= 1 && ore <= MAX_ORE));
  assert.equal(avvisade.length, 7);
  for (const ore of avvisade) {
    const skrivet = csvAmountSek(ore);
    const svar = checkAmountSek(skrivet);
    assert.equal(typeof svar.message, 'string', `${skrivet} godtogs oväntat`);
    assert.notEqual(svar.message, 'Beloppet måste vara ett tal.', `${skrivet} avvisades på formatet`);
    assert.notEqual(
      svar.message,
      'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.',
      `${skrivet} fick den vägledande formattexten`
    );
  }
});

test('en hel fil bär BOM, semikolon, CR LF, apostrof, citering och beloppsformat samtidigt', () => {
  const ut = toCsv([
    [{ text: 'Kategori' }, { text: 'Snitt' }, { text: 'Summa' }],
    [{ text: 'Mat; dryck' }, { amountOre: 141666 }, { amountOre: 849999 }],
    [{ text: '=SUMMA(A1)' }, { amountOre: -1 }, { amountOre: 0 }]
  ]);
  assert.equal(
    ut,
    `${BOM}Kategori;Snitt;Summa${CRLF}"Mat; dryck";1416,66;8499,99${CRLF}'=SUMMA(A1);-0,01;0,00${CRLF}`
  );
  assert.equal(ut.split(CRLF).length - 1, 3);
});

test('en rad utan celler ger ett tomt radslut, och en cell utan text ger en tom cell', () => {
  assert.equal(toCsv([[]]), `${BOM}${CRLF}`);
  assert.equal(toCsv([[{ text: '' }, { text: '' }]]), `${BOM};${CRLF}`);
});
