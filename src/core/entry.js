// Datamodell för en post (fast utgift eller prenumeration) plus validering.
// Ren logik: inga sidoeffekter, inga node:-importer.
// Sex fält, alla obligatoriska: id, name, amountSek, interval, startDate, category.

import { ISO_DATE_PATTERN, isValidIsoDate, parseIsoDate } from './dates.js';

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
  return Math.round(amountSek * 100) / 100;
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
    return { message: MESSAGES.amountNotNumber };
  }

  // Steg 2, i tabellordning. Maxgränsen står före decimalregeln med flit:
  // decimalregeln är en toleransjämförelse där 1e-6 bara håller så länge
  // v * 100 ligger under ungefär 1e9. Kastas ordningen om blir regel 3 oexakt.
  if (v <= 0) {
    return { message: MESSAGES.amountNotPositive };
  }
  if (v > AMOUNT_MAX_SEK) {
    return { message: MESSAGES.amountTooLarge };
  }
  if (Math.abs(v * 100 - Math.round(v * 100)) >= 1e-6) {
    return { message: MESSAGES.amountTooManyDecimals };
  }

  // Regel 1 prövas om på det värde som faktiskt lagras. Kedjan ovan prövar det
  // inkommande talet, men posten får `Math.round(v * 100) / 100`, och varje v
  // vars v * 100 avrundas till noll ryms under decimalregelns tolerans 1e-6
  // (t.ex. 1e-9). Utan den här raden lagras ett belopp som bryter mot "> 0" och
  // som isEntry därefter underkänner. Den står sist för att inte ta över fel
  // som hör hemma på regel 3: 0,001 ger fortfarande decimalfelet.
  const ore = Math.round(v * 100);
  if (ore < 1) {
    return { message: MESSAGES.amountNotPositive };
  }

  // Lagrat värde har alltid högst två decimaler och är fritt från flyttalsskräp.
  // Uttrycket har en ägare — samma funktion som isEntry prövar mot.
  return { value: canonicalAmountSek(v) };
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

function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
