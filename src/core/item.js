// Posttypen: inkomst, utgift eller sparande.
// Ren logik: inga sidoeffekter, inga node:-importer — samma fil körs i webbläsaren.
//
// Modulen importerar bara ur src/core/: checkName, checkAmountSek och
// checkCategory är ägarna till tre av månadspostens fyra fält, och sekToOre är
// ägaren till omräkningen kronor till öre. Beroendet är riktat och cykelfritt:
// entry.js importerar aldrig item.js.
//
// Modulen äger listan över tillåtna värden för fältet kind och ingenting annat.
// ARKITEKTUR.md under "Posttypen: inkomst, utgift eller sparande" skriver ut
// ägarskapet ordagrant: "Ägaren till listan är ITEM_KINDS i src/core/item.js".
// Listan står därför inte skriven en andra gång i src/core/budget.js — den
// importeras härifrån, av samma skäl som cost.js anropar isPlainObject i
// entry.js i stället för att skriva av villkoret (LARDOMAR.md 2026-09-02).
//
// ITEM_KIND_LABELS, som samma avsnitt namnger, är inte byggd här: den har ingen
// anropare i src/ förrän gränssnittet visar etiketterna, och en export utan
// användare får inga meningsfulla tester (ARKITEKTUR.md, "Teststrategi").

import { compareMonths, isValidIsoDate, isValidIsoMonth } from './dates.js';
import { checkAmountSek, checkCategory, checkInterval, checkName, isPlainObject } from './entry.js';
import { sekToOre } from './money.js';

// Kommentarens längd, i tecken [steg 2]. Står som ett namn och inte som en
// literal: talet läses både av villkoret i checkNote och av meddelandet, alltså i
// samma roll på två ställen, och två handskrivna kopior kan glida isär utan att
// något test märker det. Inte exporterad: ingen anropare utanför modulen läser
// talet ännu.
const NOTE_MAX_LENGTH = 200;

// Den text den här modulen äger, ur tabellen "Den text som saknades" i
// ARKITEKTUR.md. De tre övriga fälten ger exakt de texter deras ägare redan ger.
// Texten nämner inte de engelska nycklarna income, expense och saving —
// användaren ser aldrig dem.
const MESSAGES = Object.freeze({
  kind: 'Välj inkomst, utgift eller sparande.',
  // De två texterna för fältet Till och med [etapp 4]. interval får sin text av
  // sin ägare, checkInterval i entry.js; toMonth har ingen ägare sedan tidigare
  // och får den här. Texten nämner inte kolumnnamnet to_month — användaren ser
  // bara fältets etikett.
  toMonthFormat: 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.',
  toMonthBeforeFrom: 'Till och med kan inte vara före den månad posten gäller från.',
  // Texten för en avvikelse som varken är ett belopp eller en överhoppning
  // [etapp 4].
  overrideShape: 'Ange ett belopp för månaden, eller att posten ska hoppas över.',
  // De tre texterna för postens två nya fält [steg 2]. Fälten heter Datum och
  // Kommentar i formuläret, och texterna namnger etiketterna och aldrig
  // kolumnnamnen occurred_on och note — användaren ser aldrig dem.
  //
  // occurredOn har en enda text för alla tre felen (inte en sträng, fel format,
  // ett datum som inte finns), av samma skäl som toMonthFormat har en för sina
  // två: isValidIsoDate avgör format och giltighet i samma fråga, så en andra
  // text hade krävt en andra kontroll att hålla i takt med den.
  occurredOn: 'Datum måste vara ett giltigt datum på formen ÅÅÅÅ-MM-DD, eller lämnas tomt.',
  noteNotText: 'Kommentaren måste vara text.',
  noteTooLong: `Kommentaren får vara högst ${NOTE_MAX_LENGTH} tecken.`
});

// Ordningen är inte fri: den är sorteringsordningen för slag i en månads
// innehåll (ARKITEKTUR.md, kedjans steg 5) och samma ordning som tabellen över
// posttypen. Fryst av samma skäl som INTERVALS och CATEGORIES i entry.js: en
// importör som skriver om ett värde skulle annars ändra hela appens beräkning
// utan att någon fil visar det.
export const ITEM_KINDS = Object.freeze(['income', 'expense', 'saving']);

// Enda definitionen i projektet av villkoret "detta är ett känt slag".
// ITEM_KINDS.includes och inte ett uppslag i ett objekt: en lista har ingen
// prototyp att hitta 'constructor' på, så frågan behöver ingen Object.hasOwn
// (jämför PAYMENTS_PER_YEAR i cost.js, som är ett objekt och därför har det).
//
// Medvetet ingen ingångsspärr och ingen feltyp: funktionen avgör en tillhörighet
// och svarar false för varje värde som inte står i listan, också 1n och
// Symbol('x') — includes använder SameValueZero och kastar för ingen indata.
export function isItemKind(value) {
  return ITEM_KINDS.includes(value);
}

// De fyra fält en månadspost och en mall har gemensamt: kind, name, amountSek och
// category. Svaret är { errors, value }, där errors är tom när alla fyra gick
// igenom.
//
// Tre av fälten har redan en ägare i entry.js — checkName, checkAmountSek och
// checkCategory — och de anropas härifrån i stället för att skrivas av. kind är
// det enda fältet den här modulen äger, och dess text står i tabellen "Den text
// som saknades" i ARKITEKTUR.md.
//
// Fältordningen är bindande och avgör ordningen i errors: kind, name, amountSek,
// category. Alla fyra prövas, aldrig bara det första — ett formulär med fyra fel
// ska visa fyra meddelanden samtidigt, samma beteende som validateEntryDraft
// redan har.
//
// Funktionen bröts ut i steg 2. Fram till dess anropade validateTemplateDraft
// validateMonthItemDraft för de fyra fälten, och det går inte längre: en
// månadspost har två fält till (occurredOn och note) som en mall uttryckligen
// inte har, och en mall får varken ta emot dem i sitt value eller avvisas för
// dem. De fyra fälten har fortfarande en enda ägande kodväg — den här — så ingen
// kopia av något villkor har tillkommit.
function checkSharedFields(source) {
  const errors = [];
  const value = {};

  if (!isItemKind(source.kind)) {
    errors.push({ field: 'kind', message: MESSAGES.kind });
  } else {
    value.kind = source.kind;
  }

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
    // sekToOre är enda stället där ett kronbelopp blir öre. Kastar inte här:
    // checkAmountSek har redan avvisat allt som inte är ett finit tal, och dess
    // fjärde steg kräver att det avrundade värdet är minst ett öre.
    value.amountOre = sekToOre(amount.value);
  }

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  return { errors, value };
}

// Månadspostens sex fält från användaren, validerade och omräknade till ören:
// de fyra gemensamma plus occurredOn och note [steg 2].
//
// Fältordningen i errors är bindande: kind, name, amountSek, category,
// occurredOn, note. De två sista står sist därför att de står sist i formuläret.
// Alla sex prövas, aldrig bara det första.
//
// value bär alltid occurredOn och note, också när användaren lämnat dem tomma —
// då som null, precis som toMonth. Två former av samma value hade tvingat varje
// anropare att fråga vilken av dem den fick.
//
// value bär amountOre och aldrig kronor: omvandlingen sker i checkSharedFields,
// med sekToOre, eftersom item.js är kärna och får importera kärna. Kronor finns
// därmed bara i det användaren skrev och i det formatSek skriver ut.
export function validateMonthItemDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const { errors, value } = checkSharedFields(source);

  const occurredOn = checkOccurredOn(source.occurredOn);
  if (occurredOn.message) {
    errors.push({ field: 'occurredOn', message: occurredOn.message });
  } else {
    value.occurredOn = occurredOn.value;
  }

  const note = checkNote(source.note);
  if (note.message) {
    errors.push({ field: 'note', message: note.message });
  } else {
    value.note = note.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Dagen utgiften gjordes, eller null när användaren inte anger den [steg 2].
// Enda definitionen av villkoret.
//
// Fältet är inte dueDate. dueDate räknas fram ur en malls interval och
// start_date av nextDueDate i src/core/schedule.js och kommer aldrig från
// användaren; occurredOn är en dag användaren skriver in och räknas aldrig fram.
// En post kan bära båda, och de två namnen hålls isär överallt.
//
// Tomt betyder "ingen dag angiven": fältet är valfritt, och ett formulär som inte
// fyller i det skickar antingen ingen nyckel alls, null eller den tomma strängen.
// Alla tre ger samma svar, null, precis som checkToMonth gör för sitt fält.
//
// Giltigheten ägs av isValidIsoDate i dates.js, som prövar både formatet och att
// datumet finns — '2026-02-30' matchar mönstret men är inget datum. Ingen
// årsgräns prövas: checkStartDate i entry.js har en, därför att ett startdatum
// styr en serie av dragningar, medan en inskriven utgiftsdag inte styr någon
// beräkning.
function checkOccurredOn(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.occurredOn };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoDate(trimmed)) {
    return { message: MESSAGES.occurredOn };
  }
  return { value: trimmed };
}

// Postens kommentar, eller null när den är tom [steg 2]. Enda definitionen av
// villkoret.
//
// Tomt betyder "ingen kommentar", på samma tre sätt som för occurredOn ovan.
// Texten trimmas, precis som checkName trimmar namnet, så att ett fält med bara
// blanksteg blir null och inte en rad med osynligt innehåll.
function checkNote(raw) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.noteNotText };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  // Snabbväg, inte en egen regel, ordagrant samma konstruktion som checkName:
  // en kodpunkt är i UTF-16 antingen en eller två kodenheter, så fler än
  // 2 * NOTE_MAX_LENGTH kodenheter betyder alltid fler än NOTE_MAX_LENGTH
  // tecken. Villkoret kan därför bara vara sant för strängar som raden nedan
  // ändå hade avvisat, med samma meddelande — men det svarar utan att
  // materialisera hela indatan (LARDOMAR.md 2026-08-23).
  if (trimmed.length > 2 * NOTE_MAX_LENGTH) {
    return { message: MESSAGES.noteTooLong };
  }
  // [...text].length räknar tecken, text.length räknar UTF-16-kodenheter och
  // gör varje emoji till två.
  if ([...trimmed].length > NOTE_MAX_LENGTH) {
    return { message: MESSAGES.noteTooLong };
  }
  return { value: trimmed };
}

// Mallens utkast [etapp 4]: de fyra gemensamma fälten plus interval och toMonth.
//
// Funktionen anropar checkSharedFields i stället för att pröva kind, name,
// amountSek och category en andra gång, och checkInterval i entry.js i stället
// för att skriva av INTERVALS-villkoret. Varje fält har därmed exakt en ägare:
// entry.js äger name, amountSek, category och interval, den här modulen äger
// kind och toMonth. En handskriven kopia av något av dem här vore två facit för
// samma fråga (LARDOMAR.md 2026-09-02).
//
// En mall har inte occurredOn och note [steg 2]: en återkommande post har ingen
// enskild dag och ingen enskild kommentar. De två fälten prövas därför inte här
// och står aldrig i value — ett utkast som bär dem får dem ignorerade, inte
// avvisade. Skälet står i paketets redovisning (B9): ett avvisande hade behövt
// en egen svensk text och ett fältfel på ett fält formuläret döljer när
// kryssrutan Återkommande är ikryssad, och ett meddelande på ett dolt fält är ett
// meddelande användaren inte ser (LARDOMAR.md 2026-09-07). Ingenting går förlorat
// i tysthet: svarets template-objekt visar exakt vilka fält som sparades.
//
// month är den månad mallen ska gälla från. Den är ingen användarinput när
// funktionen anropas — api.js har redan avvisat en ogiltig månad i sökvägen med
// isValidIsoMonth — så en månad som inte är en månad är ett programmeringsfel
// och kastar, i stället för att bli ett fältfel användaren inte kan rätta.
//
// Fältordningen i errors är bindande och följer formuläret: kind, name,
// amountSek, category, interval, toMonth. De två sista står sist därför att
// kryssrutan Återkommande öppnar dem under de fyra andra. Alla sex prövas,
// aldrig bara det första.
export function validateTemplateDraft(draft, month) {
  if (!isValidIsoMonth(month)) {
    throw new RangeError(`validateTemplateDraft kräver en månad på formen ÅÅÅÅ-MM, fick "${String(month)}".`);
  }
  const source = isPlainObject(draft) ? draft : {};
  const { errors, value } = checkSharedFields(source);

  const interval = checkInterval(source.interval);
  if (interval.message) {
    errors.push({ field: 'interval', message: interval.message });
  } else {
    value.interval = interval.value;
  }

  const toMonth = checkToMonth(source.toMonth, month);
  if (toMonth.message) {
    errors.push({ field: 'toMonth', message: toMonth.message });
  } else {
    value.toMonth = toMonth.value;
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Slutmånaden, eller null för "tills vidare". Enda definitionen av villkoret.
//
// Tomt betyder tills vidare: fältet Till och med är valfritt, och ett formulär
// som inte fyller i det skickar antingen ingen nyckel alls, null eller den tomma
// strängen. Alla tre ger samma svar, null, så ingen anropare behöver veta vilken
// av de tre webbläsaren råkade skicka.
//
// Jämförelsen mot month ägs av compareMonths i dates.js. Den finns här och inte
// bara som schemats CHECK (to_month IS NULL OR to_month >= from_month), eftersom
// ett brutet CHECK ger användaren "Uppgifterna kunde inte sparas: något värde är
// ogiltigt." och ett 500 — ett fel i ett fält användaren själv fyllt i ska ge
// fältets egen text och ett 400 ("Två spärrar i två språk").
function checkToMonth(raw, month) {
  if (raw === undefined || raw === null) {
    return { value: null };
  }
  if (typeof raw !== 'string') {
    return { message: MESSAGES.toMonthFormat };
  }
  const trimmed = raw.trim();
  if (trimmed === '') {
    return { value: null };
  }
  if (!isValidIsoMonth(trimmed)) {
    return { message: MESSAGES.toMonthFormat };
  }
  if (compareMonths(trimmed, month) < 0) {
    return { message: MESSAGES.toMonthBeforeFrom };
  }
  return { value: trimmed };
}

// Budgettakets utkast [steg 2]: en kategori och ett belopp. Kroppen i
// PUT /api/budget/<ÅÅÅÅ-MM>.
//
// Båda fälten har redan en ägare i entry.js — checkCategory och checkAmountSek —
// och de anropas härifrån i stället för att skrivas av. Funktionen äger alltså
// ingen egen text: varje meddelande kommer från fältets ägare, och ett tak som
// avvisas säger exakt samma sak som en post som avvisas för samma fel.
//
// Kategorin prövas mot CATEGORIES i kärnan och inte mot ett CHECK i tabellen
// budgets: kategorilistan ägs av entry.js, och ett CHECK där hade blivit en andra
// kopia som kan glida isär (ARKITEKTUR.md under "Tabellen"). Följden är att
// schemat tar emot en okänd kategori och att den här funktionen är den enda
// spärren mot en — den är därför obligatorisk på skrivvägen.
//
// Fältordningen i errors är bindande och följer formuläret: category, amountSek.
// Båda prövas, aldrig bara det första.
//
// value bär amountOre och aldrig kronor, precis som månadspostens utkast.
export function validateBudgetDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};
  const errors = [];
  const value = {};

  const category = checkCategory(source.category);
  if (category.message) {
    errors.push({ field: 'category', message: category.message });
  } else {
    value.category = category.value;
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    errors.push({ field: 'amountSek', message: amount.message });
  } else {
    // Samma omvandling och samma ägare som i checkSharedFields. Kastar inte här:
    // checkAmountSek har redan avvisat allt som inte är ett finit tal, och dess
    // fjärde steg kräver att det avrundade värdet är minst ett öre — alltså
    // precis vad schemats CHECK (amount_ore > 0) kräver.
    value.amountOre = sekToOre(amount.value);
  }

  if (errors.length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, value };
}

// Avvikelsens utkast [etapp 4]: antingen ett annat belopp för en enda månad,
// eller att posten hoppas över den månaden. Aldrig båda, aldrig ingenting —
// samma villkor som schemats
// CHECK ((skipped = 1 AND amount_ore IS NULL) OR (skipped = 0 AND amount_ore IS NOT NULL)),
// uttryckt en gång till på kärnans språk, där det kan ge användaren en svensk
// text och ett 400 i stället för ett 500 ("Två spärrar i två språk").
//
// Kroppen har två former, och den här funktionen är ägaren till frågan vilken
// av dem ett anrop har: { skipped: true } eller { amountSek }. Beloppet prövas
// av sin ägare, checkAmountSek i entry.js, och räknas om av sekToOre — ingen
// andra kopia av beloppskedjan.
//
// skipped prövas före amountSek: en kropp som bär båda är en kropp som ber om
// två motstridiga saker, och "hoppa över" är den som går att utföra utan att
// något belopp behöver tolkas. Fältordningen i errors är därmed skipped,
// amountSek.
export function validateOverrideDraft(draft) {
  const source = isPlainObject(draft) ? draft : {};

  if (source.skipped === true) {
    return { ok: true, value: { skipped: true, amountOre: null } };
  }

  // Jämförelsen mot undefined och inte Object.hasOwn: de två skiljer sig bara
  // för en kropp med amountSek: undefined, och JSON kan inte uttrycka det —
  // JSON.stringify utelämnar nyckeln. Skillnaden är alltså onåbar genom API:t,
  // och en onåbar skillnad är ingen spärr (LARDOMAR.md 2026-09-04). Körd
  // mutation: Object.hasOwn(source, 'amountSek') i stället ger EXIT=0 och
  // fail 0 på hela sviten.
  if (source.amountSek === undefined) {
    return { ok: false, errors: [{ field: 'skipped', message: MESSAGES.overrideShape }] };
  }

  const amount = checkAmountSek(source.amountSek);
  if (amount.message) {
    return { ok: false, errors: [{ field: 'amountSek', message: amount.message }] };
  }
  return { ok: true, value: { skipped: false, amountOre: sekToOre(amount.value) } };
}
