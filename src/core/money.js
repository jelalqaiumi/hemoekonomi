// Öre, kronor, avrundning och formatering.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
// All beloppsaritmetik i appen sker i heltal öre. Kronor är endast in- och utdata.
//
// Giltighetsområde för hela modulen: öretalen räknas i Number, som bär hela
// heltal bara upp till Number.MAX_SAFE_INTEGER. Modulen påstår ingenting om
// värden utanför det området — den kastar RangeError i stället för att svara.

export const ORE_PER_SEK = 100;

// Enda definitionen i projektet av villkoret "detta är -0". -0 avvisas inte
// någonstans i src/core/ — det är noll skrivet med tecken (-0 === 0) och
// normaliseras till 0. Inget Number.is*-predikat skiljer de två talen åt:
// Number.isFinite(-0), Number.isInteger(-0) och Number.isSafeInteger(-0) är alla
// true. Utan normaliseringen visar formatSek strängen "\u22120,00\u00a0kr"
// för användaren: U+2212 MINUS SIGN och U+00A0 hårt blanksteg, båda skrivna
// med escape som ARKITEKTUR.md kräver (LARDOMAR.md 2026-09-14).
//
// Medvetet ingen ingångsspärr, och det är ett namngivet undantag från regeln att
// varje exporterad funktion i modulen har samma ingångskontroll och feltyp:
// funktionen avgör en identitet, inte ett värde, och Object.is kastar för ingen
// indata. normalizeZero(NaN) ger NaN och normalizeZero(1n) ger 1n. Kastade den
// för icke-finit indata kunde canonicalAmountSek i entry.js inte anropa den, och
// isEntry får inte kasta.
export function normalizeZero(value) {
  return Object.is(value, -0) ? 0 : value;
}

// Kronor in, heltal öre ut. Enda stället där ett kronbelopp blir öre.
export function sekToOre(amountSek) {
  // Number.isFinite coercar inte: BigInt och Symbol ger false i stället för att
  // kasta TypeError, och NaN/Infinity/-Infinity avvisas här i stället för att
  // föras vidare som ett skadat ören-tal.
  if (!Number.isFinite(amountSek)) {
    throw new RangeError('sekToOre kräver ett finit tal.');
  }
  // Math.round(-0.001) ger -0, liksom Math.round(-0) — normaliseras av ägaren.
  return normalizeZero(Math.round(amountSek * ORE_PER_SEK));
}

// Öre tillbaka till kronor. Endast för visning — resultatet är ett flyttal och
// får aldrig adderas eller divideras.
//
// Ägare till visningsvägens ingångsspärr. formatSek skriver inte av villkoret
// utan går genom den här funktionen och ärver det. Number.isSafeInteger är valt
// framför Number.isInteger: det är strikt starkare och avvisar dessutom 1e300,
// som är ett heltal men inte ett säkert.
export function oreToSek(ore) {
  if (!Number.isSafeInteger(ore)) {
    throw new RangeError('oreToSek kräver ett säkert heltal öre.');
  }
  // -0 / 100 ger -0 — normaliseras av ägaren. formatSek har inget eget anrop
  // utan ärver normaliseringen härifrån, samma ägarregel som för spärren ovan.
  return normalizeZero(ore / ORE_PER_SEK);
}

// Heltalsdivision med "halva öret uppåt".
// Alla täljare i appen är icke-negativa — cost.js avvisar negativa belopp och
// tillåter exakt 0 — så uppåt och bort-från-noll är samma sak.
//
// Giltighetsområde: mellanledet 2 * numerator + denominator räknas i Number och
// bär hela heltal bara upp till Number.MAX_SAFE_INTEGER. Utanför det området
// kastar regel 4 nedan RangeError i stället för att funktionen svarar.
//
// Regel 4 står sist därför att den räknar på båda argumenten: körd före
// regel 1–3 skulle en sträng få ett meddelande om summan i stället för om
// täljaren, och en BigInt kasta TypeError från aritmetiken i stället för
// modulens RangeError.
export function divideRoundHalfUp(numerator, denominator) {
  if (!Number.isInteger(numerator)) {
    throw new RangeError('divideRoundHalfUp kräver ett heltal som täljare.');
  }
  if (!Number.isInteger(denominator)) {
    throw new RangeError('divideRoundHalfUp kräver ett heltal som nämnare.');
  }
  if (denominator <= 0) {
    throw new RangeError('divideRoundHalfUp kräver en nämnare större än 0.');
  }
  if (!Number.isSafeInteger(2 * numerator + denominator)) {
    throw new RangeError('divideRoundHalfUp kräver att 2 * täljaren + nämnaren är ett säkert heltal.');
  }
  return Math.floor((2 * numerator + denominator) / (2 * denominator));
}

const SEK_FORMATTER = new Intl.NumberFormat('sv-SE', {
  style: 'currency',
  currency: 'SEK',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

// Visningsformat. Formatering görs bara i gränssnittet, aldrig före en beräkning.
// Ingen egen ingångsspärr: villkoret ägs av oreToSek och ärvs härifrån.
export function formatSek(ore) {
  return SEK_FORMATTER.format(oreToSek(ore));
}
