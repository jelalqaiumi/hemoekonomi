// Kärnans CSV-modul, src/core/csv.js [steg 5]. Prövar modulens egna exporter
// direkt: varje fil under src/core/ ska ha en tests/<modul>.test.js som gör det,
// i samma paket som filen skapas (LARDOMAR.md 2026-08-18).
//
// Kravlistan är (RA1) till (RA7) i ARKITEKTUR.md under "Kravlista [steg 5]".
// Utöver dem prövas spärrtabellen "Ingångsspärrar i src/core/csv.js" rad för rad.
// De fallen bär inget (RA)-nummer, därför att tabellen är deras facit och ett
// nummer utan en punkt i kravlistan ser ut som en hänvisning utan att vara en
// (LARDOMAR.md 2026-09-14).
//
// Varje assert.throws som ensam skyddar en rad i spärrtabellen asserterar hela
// message: en feltyp delas av varje spärr i modulen, och en assertion på enbart
// RangeError kan därför inte skilja rad 1 från rad 5 (LARDOMAR.md 2026-09-16).
//
// Ingen klocka läses: modulen har ingen, och ingen testdata bygger på dagens
// datum.
import assert from 'node:assert/strict';
import test from 'node:test';

import { AMOUNT_MAX_SEK, AMOUNT_PATTERN, checkAmountSek } from '../src/core/entry.js';
import { sekToOre } from '../src/core/money.js';
import { csvAmountSek, csvText, toCsv } from '../src/core/csv.js';

// U+FEFF BYTE ORDER MARK och U+000D U+000A, skrivna som escaper. Ett rått tecken
// här går inte att se i en genomläsning (LARDOMAR.md 2026-09-14).
const BOM = '\ufeff';
const CRLF = '\r\n';

// Varje värde som inte är ett säkert heltal och som därför ska nå rad 1. 1n och
// Symbol('x') står med därför att de kastar TypeError ur aritmetik där varje
// annan typ tvingas till NaN, och -0 står medvetet INTE här: -0 är noll skrivet
// med tecken och ett giltigt belopp (LARDOMAR.md 2026-08-24 och 2026-09-02).
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

// Varje värde som inte är en sträng och som därför ska nå rad 2. Samma lista som
// ovan plus talen, eftersom ett tal inte är en sträng.
const ICKE_STRANGAR = [0, -0, 42, NaN, Infinity, -Infinity, null, undefined, true, {}, [], ['a'], new Date(), 1n, Symbol('x')];

// Varje värde som inte är en cell med exakt en nyckel text eller amountOre.
// Arrayerna och new Date() står med därför att ett handskrivet typvillkor släpper
// igenom dem medan isPlainObject inte gör det (LARDOMAR.md 2026-09-02).
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

// ---------------------------------------------------------------------------
// Spärrtabellen rad 1: csvAmountSek kräver ett säkert heltal öre.
// ---------------------------------------------------------------------------

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
  // -0 är ett giltigt belopp: Number.isSafeInteger(-0) är sant, så rad 1 fångar
  // det inte, och normalizeZero i money.js äger normaliseringen. Strängen får
  // aldrig bära ett minustecken för noll.
  assert.equal(csvAmountSek(-0), '0,00');
  assert.equal(csvAmountSek(-0).includes('-'), false);
  assert.equal(csvAmountSek(0), '0,00');

  // Talet på vägen tillbaka är 0 och inte -0. Asserteras med Object.is, aldrig
  // med assert.equal(resultat, 0), som är sant också för -0
  // (LARDOMAR.md 2026-09-02).
  const tillbaka = sekToOre(Number(csvAmountSek(-0).replace(',', '.')));
  assert.equal(Object.is(tillbaka, -0), false);
  assert.equal(tillbaka, 0);
});

// ---------------------------------------------------------------------------
// Spärrtabellen rad 2: csvText kräver en sträng.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Spärrtabellen rad 3, 4 och 5: toCsv.
// ---------------------------------------------------------------------------

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
  // Exakt en nyckel, inte bara att en av dem finns: en cell med båda hade låtit
  // toCsv välja tyst, och det valet är hela poängen med att cellen deklarerar
  // sin typ.
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

// ---------------------------------------------------------------------------
// Ordningen mellan spärrarna. Tabellen säger "första träff vinner", och det är
// sant bara så länge toCsv prövar strukturen fullt ut innan någon cell
// omvandlas. En nästlad loop hade varvat raderna (LARDOMAR.md 2026-09-02).
// ---------------------------------------------------------------------------

test('rad 4 vinner över rad 2 och rad 5 i en tidigare rad', () => {
  // Rad 0 bär en text som inte är en sträng (rad 2) och rad 1 är inte en lista
  // (rad 4). Rad 4 prövas för varje rad innan någon cell omvandlas, så rad 4
  // vinner.
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
  // Rad 5 prövas för varje cell innan någon cell omvandlas, så en trasig cell
  // längst bak vinner över en text eller ett belopp av fel typ längst fram.
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

// ---------------------------------------------------------------------------
// (RA1) BOM först i filen, kodpunkten utskriven i testet.
// ---------------------------------------------------------------------------

test('(RA1) filen börjar med en UTF-8 BOM, kodpunkt U+FEFF', () => {
  const ut = toCsv([[{ text: 'Namn' }]]);
  assert.equal(ut.codePointAt(0), 0xfeff);
  assert.equal(ut.startsWith(BOM), true);
  // Exakt en BOM, och bara först: en BOM mitt i filen är ett synligt tecken i
  // ett kalkylblad.
  assert.equal(ut.indexOf(BOM, 1), -1);
  // Tecknet efter BOM är cellens första tecken, inte ett radslut.
  assert.equal(ut.codePointAt(1), 'N'.codePointAt(0));
});

test('(RA1) en tom lista ger BOM och ingenting mer', () => {
  assert.equal(toCsv([]), BOM);
});

// ---------------------------------------------------------------------------
// (RA2) radslutet är CR LF, inte bara LF.
// ---------------------------------------------------------------------------

test('(RA2) radslutet är CR LF, kodpunkterna U+000D U+000A, och aldrig ett ensamt LF', () => {
  const ut = toCsv([[{ text: 'a' }], [{ text: 'b' }]]);
  assert.equal(ut, `${BOM}a${CRLF}b${CRLF}`);
  // Varje rad slutar med CRLF, också den sista: RFC 4180 tillåter båda, och en
  // avslutare gör regeln "varje rad slutar med CR LF" sann utan ett undantag
  // för sista raden.
  assert.equal(ut.split('\n').length - 1, 2);
  assert.equal(ut.split(CRLF).length - 1, 2);
  // Ett LF som inte föregås av CR är det utfall mutationen CRLF -> LF ger.
  assert.equal(/[^\r]\n/.test(ut), false, 'ett LF utan CR framför betyder att radslutet inte är CR LF');
  assert.equal(ut.codePointAt(ut.length - 2), 0x000d);
  assert.equal(ut.codePointAt(ut.length - 1), 0x000a);
});

test('(RA2) avgränsaren mellan celler är semikolon och inte komma', () => {
  // Fälla 1: beloppen bär decimalkomma, så ett komma som avgränsare bryter varje
  // rad med ett belopp i.
  assert.equal(toCsv([[{ text: 'Mat' }, { amountOre: 123450 }]]), `${BOM}Mat;1234,50${CRLF}`);
});

// ---------------------------------------------------------------------------
// (RA3) de sex injektionstecknen får apostrof, ett fall per tecken.
// ---------------------------------------------------------------------------

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
  // Skyddar listan mot att växa: ett tecken för mycket i den gör ett vanligt
  // postnamn till en cell med en apostrof framför.
  const utan = ['Hyra', 'a', '0', '9,50', ' Hyra', '\nHyra', '"Hyra"', ';', '!', '#', 'Ångbåt', ''];
  for (const text of utan) {
    assert.equal(csvText(text), text, `${JSON.stringify(text)} skulle ha lämnats orörd`);
  }
});

test('(RA3) ett av de sex tecknen mitt i texten ger ingen apostrof', () => {
  // Regeln gäller en cell som BÖRJAR med tecknet. Excel kör inte en formel som
  // inleds mitt i en cell.
  assert.equal(csvText('1+1'), '1+1');
  assert.equal(csvText('a=b'), 'a=b');
  assert.equal(csvText('post@hem'), 'post@hem');
});

// ---------------------------------------------------------------------------
// (RA4) ett negativt belopp får ingen apostrof: regelns bindande undantag.
// ---------------------------------------------------------------------------

test('(RA4) ett negativt belopp får ingen apostrof, trots att strängen börjar med minus', () => {
  // Undantaget är bindande: en apostrof framför ett negativt belopp hade gjort
  // hela beloppskolumnen oläsbar som tal. Beloppsceller produceras av vår egen
  // formaterare och går inte genom csvText.
  assert.equal(csvAmountSek(-123450), '-1234,50');
  assert.equal(toCsv([[{ amountOre: -123450 }]]), `${BOM}-1234,50${CRLF}`);
  assert.equal(toCsv([[{ amountOre: -1 }]]), `${BOM}-0,01${CRLF}`);
  assert.equal(toCsv([[{ amountOre: -123450 }]]).includes("'"), false);
});

test('(RA4) samma tecken i en textcell får apostrof i samma fil som beloppet inte får det', () => {
  // Den skarpaste formen av undantaget: minustecknet står på båda ställena i en
  // och samma rad, och bara textcellen får apostrofen.
  assert.equal(toCsv([[{ text: '-rabatt' }, { amountOre: -50 }]]), `${BOM}'-rabatt;-0,50${CRLF}`);
});

// ---------------------------------------------------------------------------
// (RA5) citering och dubblering.
// ---------------------------------------------------------------------------

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
  // Apostrofen sätts först av csvText och citeringen därefter av toCsv. Excel
  // läser cellens innehåll efter att citeringen tagits bort, så ordningen är den
  // rätta.
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

// ---------------------------------------------------------------------------
// (RA6) beloppsformatet: 1234,50, utan enhet och utan avgränsare.
// ---------------------------------------------------------------------------

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
  // formatSek i money.js får inte användas och härmas inte: dess utdata är
  // "1\u00a0234,50\u00a0kr" med hårt blanksteg U+00A0 som avgränsare, och
  // "\u22120,01" med U+2212 MINUS SIGN för ett negativt belopp. Båda är obrukbara
  // i ett kalkylblad (LARDOMAR.md 2026-09-02 och 2026-09-14).
  for (const ore of [0, 1, -1, 123450, -123450, 999999999, Number.MAX_SAFE_INTEGER]) {
    const sträng = csvAmountSek(ore);
    assert.equal(sträng.includes('\u00a0'), false, `${ore} fick ett hårt blanksteg`);
    assert.equal(sträng.includes('\u0020'), false, `${ore} fick ett vanligt blanksteg`);
    assert.equal(sträng.includes('\u2212'), false, `${ore} fick U+2212 i stället för ASCII-minus`);
    assert.equal(sträng.includes('kr'), false, `${ore} fick en enhet`);
    assert.equal(sträng.includes('.'), false, `${ore} fick en punkt`);
    // Exakt två decimaler efter ett enda komma, valfritt ASCII-minus först.
    assert.equal(/^-?\d+,\d{2}$/.test(sträng), true, `${ore} gav ${JSON.stringify(sträng)}`);
  }
});

// ---------------------------------------------------------------------------
// (RA7) rundgång: varje skrivet belopp läst tillbaka ger samma ören.
//
// Ingången är beloppskedjans STEG 1 i src/core/entry.js — AMOUNT_PATTERN och
// Number(trimmad.replace(',', '.')) — följt av sekToOre, inte validateEntryDraft.
// Skälet är mätt: checkAmountSek rad 1 avvisar v <= 0 med "Beloppet måste vara
// större än 0 kr.", så noll ören och minus ett öre kan inte gå den vägen. Men en
// rapport skriver båda: en kategori kan vara noll en månad, och minus ett öre är
// gränsen nedåt. Rundgångsfrågan är om FORMATET går att läsa tillbaka, inte om
// värdet är ett lagligt postbelopp — det var precis den förväxlingen som gav
// felet LARDOMAR.md 2026-09-22 beskriver, där appen visade ett belopp den själv
// avvisade som "Beloppet måste vara ett tal."
//
// Båda halvorna prövas: formatet för varje belopp, och hela checkAmountSek för
// de belopp vars värde den godtar. För de övriga krävs att skälet aldrig är
// formatet.
// ---------------------------------------------------------------------------

// Gränserna hör med: ett öre, minus ett öre, AMOUNT_MAX_SEK i ören och noll.
// Maxgränsen läses ur sin ägare i entry.js och skrivs inte av.
const MAX_ORE = sekToOre(AMOUNT_MAX_SEK);
const RUNDGANG_ORE = [0, -0, 1, -1, 10, -10, 99, 100, 999, 123450, -123450, MAX_ORE, -MAX_ORE, Number.MAX_SAFE_INTEGER];

test('(RA7) varje skrivet belopp matchar AMOUNT_PATTERN och ger samma antal ören tillbaka', () => {
  assert.equal(MAX_ORE, 999999999);
  for (const ore of RUNDGANG_ORE) {
    const skrivet = csvAmountSek(ore);

    // Steg 1:s formatägare. Underkänner mönstret strängen får användaren
    // "Beloppet måste vara ett tal." för appens egen utdata.
    assert.equal(AMOUNT_PATTERN.test(skrivet), true, `${ore} skrevs som ${JSON.stringify(skrivet)}, som mönstret underkänner`);

    // Steg 1:s tolkning, följd av beloppsvägens enda kronor-till-ören-ägare.
    const tillbaka = sekToOre(Number(skrivet.replace(',', '.')));
    // Samma ANTAL ören. Jämförelsen görs på === och inte med assert.equal, som i
    // strict-läge skiljer 0 från -0 och därför skulle falla för -0 ören fastän
    // -0 === 0: -0 ören och 0 ören är samma belopp. Att det lästa talet inte är
    // -0 prövas på raden under, med Object.is (LARDOMAR.md 2026-09-02).
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
  // Noll, de negativa och ett belopp över maxgränsen är inte lagliga
  // postbelopp. Avgörande är att skälet är en VÄRDEregel: fick användaren
  // formatets texter vore appens egen utdata oläsbar för appen själv.
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

// ---------------------------------------------------------------------------
// Hela filen på en gång: en rapportliknande tabell med rubrikrad, text och
// belopp, där varje fälla är med.
// ---------------------------------------------------------------------------

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
