// Datamodell för en post (fast utgift eller prenumeration) plus validering.
// Ren logik: inga sidoeffekter, inga node:-importer.
// Sex fält, alla obligatoriska: id, name, amountSek, interval, startDate, category.

import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate } from './dates.js';
// Konstanten och normalizeZero, inget annat: de funktioner i money.js som kan
// kasta importeras inte, eftersom canonicalAmountSek måste kunna anropas med
// vilket number som helst och svara med ett tal, medan sekToOre kastar för ett
// tal som inte är finit. canonicalAmountSek(NaN) ska ge NaN så att isEntry kan
// svara false i stället för att kasta. normalizeZero är undantaget som gör det
// möjligt: den har medvetet ingen ingångsspärr och kastar för ingen indata.
import { ORE_PER_SEK, normalizeZero } from './money.js';

// De sammansatta konstanterna fryses. En ägare till en regel är verkningslös om
// vilken importör som helst kan skriva om ägarens värde — ENTRY_FIELDS.push(...)
// skulle annars flytta datamodellens gräns för hela processen.
export const INTERVALS = Object.freeze(['monthly', 'quarterly', 'yearly']);

export const INTERVAL_LABELS = Object.freeze({
  monthly: 'Månadsvis',
  quarterly: 'Kvartalsvis',
  yearly: 'Årsvis'
});

export const CATEGORIES = Object.freeze([
  'housing', 'subscription', 'insurance', 'transport', 'loan', 'other'
]);

export const CATEGORY_LABELS = Object.freeze({
  housing: 'Boende',
  subscription: 'Prenumeration',
  insurance: 'Försäkring',
  transport: 'Transport',
  loan: 'Lån',
  other: 'Övrigt'
});

export const NAME_MAX_LENGTH = 60;

export const AMOUNT_MAX_SEK = 9999999.99;

// Mönstret har ett enda jobb: avgöra om strängen alls är ett tal i decimalform.
// Det avgör varken värdeintervall eller antal decimaler — det gör regelkedjan i
// checkAmountSek. Därför är det medvetet tillåtande: '-50' ska nå regeln
// "större än 0 kr" precis som talet -50, och '10000000' ska nå maxgränsen.
// 15 siffror är ingen värderegel, bara en garanti för att Number(...) alltid
// ger ett finit tal långt under Number.MAX_SAFE_INTEGER.
export const AMOUNT_PATTERN = /^-?\d{1,15}([.,]\d{1,15})?$/;

// Avgör bara VILKEN av steg 1:s två texter som gäller, aldrig om ett värde är
// giltigt: allt AMOUNT_PATTERN underkänner är fortfarande ogiltigt. Mönstret
// säger "det här ser ut som ett skrivet belopp" — siffror med avgränsare och
// ett valfritt kr — och då får användaren texten som säger hur beloppet ska
// skrivas i stället för att bara få veta att det inte är ett tal.
//
// Båda blanktecknen står som escaper: \u0020 är det tangentbordet ger
// och \u00a0 det appen själv visar i formatSek-strängen. Ett mönster där man inte
// kan se vilket blanktecken som avses är oläsbart (LARDOMAR.md 2026-09-14).
export const AMOUNT_HINT_PATTERN = /^-?[\d.,\u0020\u00a0]*\d[\d.,\u0020\u00a0]*(?:kr)?$/i;

// Snabbväg av samma slag som längdspärren i checkName: AMOUNT_HINT_PATTERN
// läser hela strängen, medan AMOUNT_PATTERN avgör sitt svar på de första
// tecknen. Utan gränsen kostar ett amountSek på 50 000 000 tecken en
// genomläsning av hela indatan för att svara (LARDOMAR.md 2026-08-23). 40 är en
// billig övre uppskattning: ett minustecken, femton siffror med avgränsare, ett
// decimaltecken, femton decimaler och ' kr'.
export const AMOUNT_HINT_MAX_LENGTH = 40;

export const MIN_YEAR = 1970;
export const MAX_YEAR = 2099;

// Postens sex fält, sorterade. Fältlistan är fastställd i ARKITEKTUR.md och
// används av isEntry för att avvisa okända fält.
export const ENTRY_FIELDS = Object.freeze([
  'amountSek', 'category', 'id', 'interval', 'name', 'startDate'
]);

// Meddelandena byggs ur konstanterna ovan så att text och regel inte kan glida isär.
const MESSAGES = {
  nameEmpty: 'Namnet får inte vara tomt.',
  nameTooLong: `Namnet får vara högst ${NAME_MAX_LENGTH} tecken.`,
  amountNotNumber: 'Beloppet måste vara ett tal.',
  amountHint: 'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.',
  amountNotPositive: 'Beloppet måste vara större än 0 kr.',
  amountTooManyDecimals: 'Beloppet får ha högst två decimaler.',
  amountTooLarge: `Beloppet får vara högst ${formatAmountLimitSek(AMOUNT_MAX_SEK)} kr.`,
  interval: 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis eller årsvis.',
  dateFormat: 'Startdatum måste anges som ÅÅÅÅ-MM-DD.',
  dateInvalid: 'Startdatum är inget giltigt datum.',
  dateOutOfRange: `Startdatum måste ligga mellan ${MIN_YEAR}-01-01 och ${MAX_YEAR}-12-31.`,
  category: 'Välj en giltig kategori.',
  idInvalid: 'Posten kunde inte skapas på grund av ett internt fel.'
};

// "9 999 999,99" — vanliga mellanslag som tusentalsavgränsare, komma som
// decimaltecken. Egen formatering i stället för Intl, som ger hårt mellanslag.
function formatAmountLimitSek(amountSek) {
  const [whole, fraction] = amountSek.toFixed(2).split('.');
  return `${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')},${fraction}`;
}

export function validateEntryDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const name = checkName(source.name);
  if (name.message) {
    errors.push({ field: 'name', message: name.message });
  } else {
    value.name = name.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    value.amountSek = amount.value;
  }

  const interval = checkInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const startDate = checkStartDate(source.startDate);
  if (startDate.message) {
    errors.push({ field: 'startDate', message: startDate.message });
  } else {
    value.startDate = startDate.value;
  }

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name: value.name,
      amountSek: value.amountSek,
      interval: value.interval,
      startDate: value.startDate,
      category: value.category
    }
  };
}

export function createEntry(draft, makeId = () => crypto.randomUUID()) {
  const result = validateEntryDraft(draft);
  if (!result.ok) {
    return result;
  }
  // Internt fel, inte ett formulärfel: makeId kan bara vara trasig genom ett
  // programmeringsmisstag. Returneras som ValidationResult, kastas aldrig.
  // Villkoret ägs av isValidEntryId — samma anrop som isEntry gör.
  const id = makeId();
  if (!isValidEntryId(id)) {
    return { ok: false, errors: [{ field: 'id', message: MESSAGES.idInvalid }] };
  }
  return {
    ok: true,
    value: {
      id,
      name: result.value.name,
      amountSek: result.value.amountSek,
      interval: result.value.interval,
      startDate: result.value.startDate,
      category: result.value.category
    }
  };
}

// Enda definitionen av id-villkoret i projektet. Både createEntry och isEntry
// anropar den här funktionen; ingen av dem har en egen kopia av villkoret.
// trim() och inte bara length: ett id av bara blanktecken bär ingen information
// och kan inte identifiera en post i DELETE /api/entries/<id>.
export function isValidEntryId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

// Den kanoniska lagringsformen för ett belopp — enda definitionen. Både
// skrivvägen (checkAmountSek) och läsvägen (isEntry) anropar den, så de kan
// inte glida isär om avrundningen någon gång byter form.
export function canonicalAmountSek(amountSek) {
  // normalizeZero äger villkoret "detta är -0": Math.round(-0.001 * ORE_PER_SEK)
  // ger -0, och -0 / ORE_PER_SEK ger -0. Den lagrade formen ska vara 0.
  return normalizeZero(Math.round(amountSek * ORE_PER_SEK) / ORE_PER_SEK);
}

export function isEntry(value) {
  if (!isPlainObject(value)) {
    return false;
  }
  // Exakt de sex fälten, varken fler eller färre, i ett enda odelbart villkor.
  // isEntry är enda spärren när storage.js läser filen från disk, så saknade,
  // extra och felstavade fält måste alla avvisas här. JSON.stringify i stället
  // för join: join skulle göra jämförelsen beroende av att inget fältnamn
  // innehåller avgränsartecknet.
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify(ENTRY_FIELDS)) {
    return false;
  }
  // Id:t lagras exakt som makeId() gav det, utan trimning. Till skillnad från
  // name ställs alltså inget krav på att value.id === value.id.trim().
  if (!isValidEntryId(value.id)) {
    return false;
  }
  // Steg 4 och 5: fälten som skrivvägen normaliserar måste redan vara sin
  // kanoniska form. Regelkedjan avgör om ett värde är godtagbart som indata —
  // det här avgör om det är den form skrivvägen producerar. Utan steg 5 släpps
  // 199.999999999 in i datafilen och räknas därefter som 200.
  if (typeof value.name !== 'string' || value.name !== value.name.trim()) {
    return false;
  }
  if (typeof value.amountSek !== 'number'
    || value.amountSek !== canonicalAmountSek(value.amountSek)) {
    return false;
  }
  return validateEntryDraft(value).ok;
}

function checkName(raw) {
  if (typeof raw !== 'string') {
    return { message: MESSAGES.nameEmpty };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { message: MESSAGES.nameEmpty };
  }
  // Snabbväg, inte en egen regel: en kodpunkt är i UTF-16 antingen en eller två
  // kodenheter, så fler än 2 * NAME_MAX_LENGTH kodenheter betyder alltid fler än
  // NAME_MAX_LENGTH tecken. Villkoret kan därför bara vara sant för strängar som
  // raden nedan ändå hade avvisat, med samma meddelande — men det svarar utan
  // att materialisera hela indatan. Utan den kostade ett namn på 50 000 000
  // tecken 2,8 sekunder och 1,7 GB heap.
  if (trimmed.length > 2 * NAME_MAX_LENGTH) {
    return { message: MESSAGES.nameTooLong };
  }
  // [...text].length räknar tecken, text.length räknar UTF-16-kodenheter och
  // gör varje emoji till två.
  if ([...trimmed].length > NAME_MAX_LENGTH) {
    return { message: MESSAGES.nameTooLong };
  }
  return { value: trimmed };
}

// En enda valideringsväg. Steg 1 normaliserar råvärdet till ett finit tal,
// steg 2 kör en ordnad regelkedja på talet. Ingen regel i kedjan får titta på
// råvärdets typ eller på hur strängen såg ut — samma värde ska ge samma
// meddelande oavsett om det kom in som sträng eller som tal.
function checkAmountSek(raw) {
  // Steg 1. Enda felet som kan uppstå här är "måste vara ett tal".
  const v = normalizeAmountSek(raw);
  if (v === null) {
    return { message: amountNotNumberMessage(raw) };
  }

  // Steg 2, i tabellordning. Maxgränsen står före decimalregeln med flit:
  // decimalregeln är en toleransjämförelse där 1e-6 bara håller så länge
  // v * ORE_PER_SEK ligger under ungefär 1e9. Kastas ordningen om blir regel 3
  // oexakt.
  if (v <= 0) {
    return { message: MESSAGES.amountNotPositive };
  }
  if (v > AMOUNT_MAX_SEK) {
    return { message: MESSAGES.amountTooLarge };
  }
  if (Math.abs(v * ORE_PER_SEK - Math.round(v * ORE_PER_SEK)) >= 1e-6) {
    return { message: MESSAGES.amountTooManyDecimals };
  }

  // Regel 1 prövas om på det värde som faktiskt lagras. Kedjan ovan prövar det
  // inkommande talet, men posten får `Math.round(v * ORE_PER_SEK) / ORE_PER_SEK`,
  // och varje v vars v * ORE_PER_SEK avrundas till noll ryms under
  // decimalregelns tolerans 1e-6 (t.ex. 1e-9). Utan den här raden lagras ett
  // belopp som bryter mot "> 0" och som isEntry därefter underkänner. Den står
  // sist för att inte ta över fel som hör hemma på regel 3: 0,001 ger
  // fortfarande decimalfelet.
  const ore = Math.round(v * ORE_PER_SEK);
  if (ore < 1) {
    return { message: MESSAGES.amountNotPositive };
  }

  // Lagrat värde har alltid högst två decimaler och är fritt från flyttalsskräp.
  // Uttrycket har en ägare — samma funktion som isEntry prövar mot.
  return { value: canonicalAmountSek(v) };
}

// Vilken av steg 1:s två texter ett råvärde som inte gav ett finit tal ska få.
// Ordningen är bindande (ARKITEKTUR.md, "Den vägledande texten för ett skrivet
// belopp"): typen först, längden därefter, formen sist. Raden skiljer inte på
// number och string för något värde som kan uttryckas i båda formerna — den
// gäller bara strängar som inte är tal alls, och '12 000' finns inte som number.
function amountNotNumberMessage(raw) {
  if (typeof raw !== 'string') {
    return MESSAGES.amountNotNumber;
  }
  const trimmed = raw.trim();
  if (trimmed.length > AMOUNT_HINT_MAX_LENGTH) {
    return MESSAGES.amountNotNumber;
  }
  if (AMOUNT_HINT_PATTERN.test(trimmed)) {
    return MESSAGES.amountHint;
  }
  return MESSAGES.amountNotNumber;
}

// Returnerar ett finit tal, eller null när råvärdet inte är ett tal alls.
function normalizeAmountSek(raw) {
  if (typeof raw === 'number') {
    return Number.isFinite(raw) ? raw : null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!AMOUNT_PATTERN.test(trimmed)) {
      return null;
    }
    return Number(trimmed.replace(',', '.'));
  }
  return null;
}

function checkInterval(raw) {
  if (typeof raw !== 'string' || !INTERVALS.includes(raw)) {
    return { message: MESSAGES.interval };
  }
  return { value: raw };
}

function checkStartDate(raw) {
  if (typeof raw !== 'string' || !ISO_DATE_PATTERN.test(raw)) {
    return { message: MESSAGES.dateFormat };
  }
  if (!isValidIsoDate(raw)) {
    return { message: MESSAGES.dateInvalid };
  }
  const { year } = parseIsoDate(raw);
  if (year < MIN_YEAR || year > MAX_YEAR) {
    return { message: MESSAGES.dateOutOfRange };
  }
  return { value: raw };
}

function checkCategory(raw) {
  if (typeof raw !== 'string' || !CATEGORIES.includes(raw)) {
    return { message: MESSAGES.category };
  }
  return { value: raw };
}

// Enda definitionen av "vanligt objekt" i projektet: inte null, inte en array.
// Exporteras därför att cost.js prövar samma sak i yearlyOre och inte får ha en
// egen, svagare kopia. Beroendet är riktat och cykelfritt: cost.js importerar
// entry.js, medan entry.js importerar bara dates.js och money.js.
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
