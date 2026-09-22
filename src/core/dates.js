// Kalenderdatum som strängar "YYYY-MM-DD".
// Ren logik: inga sidoeffekter, inga node:-importer.

// Formatmönstret för ett ISO-datum. Exporteras så att entry.js kan skilja
// "fel format" från "obefintligt datum" utan att duplicera regexen.
export const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// Talet 12 i rollen "antal månader per år", basen i omräkningen mellan ett
// datum och ett löpande månadsnummer (ARKITEKTUR.md: monthIndex(year, month) =
// year * 12 + (month - 1)). Står på fyra ställen i filen och behöver därför en
// namngiven ägare. Ägaren till samma roll i src/core/ i övrigt är
// MONTHS_PER_YEAR i cost.js, men den går inte att importera hit: cost.js
// importerar entry.js, som importerar dates.js, så importen vore en cykel.
// Konstanten är därför modullokal och exporteras inte — ingen annan modul ska
// kunna läsa den härifrån och tro att dates.js äger rollen.
//
// Tolvan i daysInMonth nedan (month > 12) är en annan roll, "högsta
// månadsnummer i ett kalenderdatum", och skrivs inte med den här konstanten.
const MONTHS_PER_YEAR = 12;

// Ett ankarår med fyra siffror. Date.UTC tolkar år 0-99 som 1900-talet
// (Date.UTC(50, 0, 1) ger 1950-01-01), vilket ger fel dagavstånd så snart bara
// det ena datumet ligger under år 100 — naivt räknat ger 0099-12-31 till
// 0100-01-01 hela -693959 dagar i stället för 1. Årsskillnaden läggs därför in
// som ett månadsantal från ett ankarår som aldrig träffar tolkningen; Date.UTC
// normaliserar månadsnummer utanför 0-11 själv.
const UTC_ANCHOR_YEAR = 2000;

const MS_PER_DAY = 86400000;

export function daysInMonth(year, month) {
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    return 0;
  }
  const lengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return lengths[month - 1];
}

export function parseIsoDate(value) {
  if (typeof value !== 'string' || !ISO_DATE_PATTERN.test(value)) {
    return null;
  }
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  // Ingen egen kontroll av månadsnumret: gränsen 1-12 ägs av daysInMonth, som
  // svarar 0 för varje månad utanför den, och dagraden nedan avvisar då redan
  // samma värden. '2026-13-01', '2026-00-10' och '2026-99-01' ger alltså null
  // via daysInMonth(year, month) === 0.
  if (day < 1 || day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month, day };
}

export function isValidIsoDate(value) {
  return parseIsoDate(value) !== null;
}

// { year, month, day } -> "YYYY-MM-DD", nollutfyllt.
//
// Ingen egen kopia av "är detta ett vanligt objekt": ägaren isPlainObject bor i
// entry.js, som importerar dates.js, så en import tillbaka vore en cykel. I
// stället läses fälten med ?. — ett uppslag på null eller undefined kastar
// annars TypeError — och prövas var för sig. För den här funktionen är det
// strikt starkare: ett värde utan tre giltiga datumfält faller på år- eller
// dagraden oavsett vilken sorts värde det är.
export function toIsoDate(parts) {
  const year = parts?.year;
  const month = parts?.month;
  const day = parts?.day;
  // Fyra siffror är ISO_DATE_PATTERNs form. Intervallet 1970-2099 är entry.js
  // regel och prövas medvetet inte här — tre olika frågor, tre olika kontroller.
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    throw new RangeError(`toIsoDate kräver ett år med fyra siffror, fick "${String(year)}".`);
  }
  // Månadsnumret får ingen egen rad: gränsen ägs av daysInMonth, precis som i
  // parseIsoDate. Ett månadsnummer utanför 1-12 ger 0 och faller här.
  if (!Number.isInteger(day) || day < 1 || day > daysInMonth(year, month)) {
    throw new RangeError(`toIsoDate kräver ett datum som finns i kalendern, fick "${String(year)}-${String(month)}-${String(day)}".`);
  }
  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

// Klampningsregeln: målmånaden räknas fram, och dagen sätts till
// Math.min(startdatumets dag, daysInMonth(målår, målmånad)). Klampningen utgår
// alltid från startdatumets ursprungliga dag och aldrig från ett tidigare
// klampat resultat — funktionen får hela steget som ett antal månader och har
// därför inget tidigare resultat att smitta med.
export function addMonthsClamped(isoDate, months) {
  const start = parseIsoDate(isoDate);
  if (start === null) {
    throw new RangeError(`addMonthsClamped kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(isoDate)}".`);
  }
  if (!Number.isInteger(months)) {
    throw new RangeError(`addMonthsClamped kräver ett heltal månader, fick "${String(months)}".`);
  }
  const index = start.year * MONTHS_PER_YEAR + (start.month - 1) + months;
  const year = Math.floor(index / MONTHS_PER_YEAR);
  const month = index - year * MONTHS_PER_YEAR + 1;
  // Ingen egen spärr mot ett år utanför kalendern: toIsoDate äger den gränsen
  // och kastar med sitt eget namn i meddelandet.
  return toIsoDate({ year, month, day: Math.min(start.day, daysInMonth(year, month)) });
}

// -1, 0 eller 1. Formatet "YYYY-MM-DD" sorterar lexikografiskt i datumordning,
// så strängjämförelsen är hela svaret.
export function compareIsoDates(a, b) {
  if (!isValidIsoDate(a)) {
    throw new RangeError(`compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(a)}" som första argument.`);
  }
  if (!isValidIsoDate(b)) {
    throw new RangeError(`compareIsoDates kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(b)}" som andra argument.`);
  }
  if (a < b) {
    return -1;
  }
  if (a > b) {
    return 1;
  }
  return 0;
}

// Antal dygn från fromIso till toIso. Negativt när toIso ligger först.
// UTC används därför att sommartid annars ger 23- och 25-timmarsdygn.
export function daysBetween(fromIso, toIso) {
  const from = parseIsoDate(fromIso);
  if (from === null) {
    throw new RangeError(`daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(fromIso)}" som första argument.`);
  }
  const to = parseIsoDate(toIso);
  if (to === null) {
    throw new RangeError(`daysBetween kräver ett datum på formen ÅÅÅÅ-MM-DD, fick "${String(toIso)}" som andra argument.`);
  }
  // Skillnaden mellan två heltal som är lika ger +0, aldrig -0, så ingen
  // normalisering behövs här. Testfallet står i tests/dates.test.js.
  return (utcMs(to) - utcMs(from)) / MS_PER_DAY;
}

// Projektets enda klockläsning. Alla andra funktioner tar emot dagens datum som
// parameter — utan den regeln går schedule.js inte att testa.
// Lokalt datum, inte UTC: "idag" är det datum användaren ser på sin vägg.
export function todayIso(now = new Date()) {
  if (!(now instanceof Date)) {
    throw new RangeError(`todayIso kräver ett Date, fick "${String(now)}".`);
  }
  if (Number.isNaN(now.getTime())) {
    throw new RangeError('todayIso kräver ett Date som visar ett datum, fick ett ogiltigt Date.');
  }
  return toIsoDate({ year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() });
}

function utcMs(parts) {
  return Date.UTC(UTC_ANCHOR_YEAR, (parts.year - UTC_ANCHOR_YEAR) * MONTHS_PER_YEAR + parts.month - 1, parts.day);
}

function pad(value, width) {
  return String(value).padStart(width, '0');
}

function isLeapYear(year) {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}
