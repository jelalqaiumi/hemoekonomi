// Attrappen för demoläget (ARKITEKTUR.md, "Del 4: demoläge" — "Attrappen").
//
// Modulen ersätter globalThis.fetch innan app.js laddas och svarar på appens
// vägar med samma statuskoder och samma JSON-form som src/server/api.js. Ingen
// Mock Service Worker: skälet står i ARKITEKTUR.md — MSW finns för en app vars
// kod man inte äger, och här ägs varje rad. Följden är att demon är rena
// statiska filer utan byggkedja och utan serviceworker.
//
// Attrappen räknar ingenting själv. Summorna kommer ur monthTotals i
// src/core/budget.js, intervallträffen ur nextDueDate i src/core/schedule.js,
// månadsbegreppet ur src/core/dates.js och valideringen ur
// validateMonthItemDraft, validateTemplateDraft och validateOverrideDraft i
// src/core/item.js. Kärnan körs redan i webbläsaren, så demon visar den verkliga
// logiken och inte en efterhärmning — och "12 000" ger den vägledande
// beloppstexten precis som i den riktiga appen.
//
// Importerna går via ../../core/ och inte via /core/: båda formerna pekar på
// samma fil i webbläsaren, eftersom new URL('../../core/x.js', '…/demo/y.js')
// ger /core/x.js, men bara den relativa formen pekar på src/core/ också när ett
// testfall importerar den här filen från disk.
import { billStatus, daysUntilDue, nextBillDueDate, validateBillDraft } from '../../core/bill.js';
import { monthTotals, sumByKind } from '../../core/budget.js';
import { CATEGORIES } from '../../core/entry.js';
import { goalProgress, validateDepositDraft, validateGoalDraft } from '../../core/goal.js';
import { compareIsoDates, compareMonths, firstDayOfMonth, isValidIsoDate, isValidIsoMonth, monthOfIsoDate, parseIsoDate, shiftMonth, todayIso } from '../../core/dates.js';
import { ITEM_KINDS, validateBudgetDraft, validateMonthItemDraft, validateOverrideDraft, validateTemplateDraft } from '../../core/item.js';
import { FEATURES, hasFeature, isPlanKey, planFor, PLAN_LABELS } from '../../core/plans.js';
import { toCsv } from '../../core/csv.js';
import { reportRows } from '../../core/report.js';
import { reportCsvRows } from '../../core/report-csv.js';
import { nextDueDate } from '../../core/schedule.js';
import { DEMO } from './demolage.js';

// De svenska texter attrappen måste svara med för att svaret ska vara samma
// JSON som serverns. Varje sträng har sin ägare i src/server/, som webbläsaren
// aldrig laddar: auth.js och api.js importerar node:crypto respektive node:fs.
// Kopian är därför oundviklig, och den är inte lämnad obevakad —
// tests/demo.test.js jämför varje sträng här mot ägarens, så att de två inte kan
// glida isär.
//
//   notLoggedIn      NOT_LOGGED_IN_MESSAGE i src/server/auth.js
//   unknownCode      AUTH_MESSAGES.unknownCode i src/server/auth.js
//   entryNotFound    MESSAGES.entryNotFound i src/server/api.js
//   invalidMonth     MESSAGES.invalidMonth i src/server/api.js
//   unknownPath      MESSAGES.unknownPath i src/server/api.js
//   methodNotAllowed MESSAGES.methodNotAllowed i src/server/api.js
//   invalidPlan      MESSAGES.invalidPlan i src/server/api.js
//   invalidToday     MESSAGES.invalidToday i src/server/api.js
//   billNotFound     MESSAGES.billNotFound i src/server/api.js
//   goalNotFound     MESSAGES.goalNotFound i src/server/api.js
//   invalidReportCount MESSAGES.invalidReportCount i src/server/api.js
//
// Rapportens tak [steg 5 del 3]. OVERVIEW_MIN_MONTHS och OVERVIEW_MAX_MONTHS bor i
// src/server/months.js, som webbläsaren inte når, så de kopieras hit. Kopian
// hålls av (D14) i tests/demo.test.js, som prövar gränserna genom beteendet mot
// de importerade konstanterna (ARKITEKTUR.md, "Demon svarar på rapportens
// vägar").
const REPORT_MIN_MONTHS = 1;
const REPORT_MAX_MONTHS = 36;

export const SERVER_TEXTS = Object.freeze({
  notLoggedIn: 'Du är inte inloggad.',
  unknownCode: 'Koden stämmer inte. Begär en ny kod och försök igen.',
  entryNotFound: 'Posten finns inte.',
  invalidMonth: 'Månaden måste anges som ÅÅÅÅ-MM.',
  unknownPath: 'Okänd adress.',
  methodNotAllowed: 'Metoden stöds inte.',
  invalidPlan: 'Välj Bas, Plus eller Premium.',
  // Räkningarnas två texter [steg 3]. invalidToday gäller både datumet i GET:ens
  // sökväg och today i kroppen till betald - samma fält med samma regel.
  invalidToday: 'Dagens datum måste anges som ÅÅÅÅ-MM-DD.',
  billNotFound: 'Räkningen finns inte.',
  // Sparmålets text [steg 4]. Samma sträng som MESSAGES.goalNotFound i
  // src/server/api.js, och gäller både ett mål som aldrig funnits och ett som
  // tillhör någon annan - demon har bara en användare, så bara det första fallet
  // är nåbart här.
  goalNotFound: 'Sparmålet finns inte.',
  // Rapportens text för ett otillåtet antal månader [steg 5 del 3],
  // interpolerad ur taket ovan precis som i src/server/api.js.
  invalidReportCount: `Antalet månader måste vara mellan ${REPORT_MIN_MONTHS} och ${REPORT_MAX_MONTHS}.`
});

// Vägarna, med samma adresser som src/server/api.js.
const AUTH_CODE_PATH = '/api/auth/kod';
const AUTH_LOGIN_PATH = '/api/auth/logga-in';
const AUTH_LOGOUT_PATH = '/api/auth/logga-ut';
const ME_PATH = '/api/mig';
// Planens väg [steg 1 i del 5]. Samma adress som i src/server/api.js.
const PLAN_PATH = '/api/plan';
const API_PREFIX = '/api/';
const MONTH_PATH_PREFIX = '/api/manad/';
const ITEM_PATH_PREFIX = '/api/poster/';
const TEMPLATE_PATH_PREFIX = '/api/mallar/';
const OVERVIEW_PATH_PREFIX = '/api/oversikt/';
// Budgetens två vägar [steg 2]. Samma adresser som src/server/api.js.
const BUDGET_PATH_PREFIX = '/api/budget/';
const ITEM_MONTH_SEGMENT = 'manad';
// Räkningarnas vägar [steg 3]. Samma adresser som src/server/api.js.
const BILLS_PATH = '/api/rakningar';
const BILL_PATH_PREFIX = '/api/rakningar/';
const BILL_PAID_SEGMENT = 'betald';
// Sparmålens vägar [steg 4]. Samma adresser som src/server/api.js.
const GOALS_PATH = '/api/sparmal';
const GOAL_PATH_PREFIX = '/api/sparmal/';
// Sista ledet i /api/sparmal/<id>/insattning. Vägen kom hit när knappen + Sätt in
// byggdes: utan den gör knappen ingenting i den publicerade demon, som är den
// version de flesta ser.
const GOAL_DEPOSIT_SEGMENT = 'insattning';
// Funktionsnyckeln sparmålens vägar kräver. Står som en konstant och inte som en
// sträng på två ställen, av samma skäl som adresserna ovan.
const GOALS_FEATURE = 'savingsGoals';
// Rapportens vägar [steg 5 del 3]: /api/rapport/<ÅÅÅÅ-MM>/<N> och
// /api/rapport/<ÅÅÅÅ-MM>/<N>/csv, samma adresser och samma form på N som i
// src/server/api.js. Mönstret kopieras av samma skäl som taket: api.js går inte
// att ladda i webbläsaren, och (D14) håller kopian.
const REPORT_PATH_PREFIX = '/api/rapport/';
const REPORT_CSV_SEGMENT = 'csv';
const REPORT_COUNT_PATTERN = /^(0|[1-9][0-9]*)$/;
// Funktionsnyckeln rapportens vägar kräver.
const REPORTS_FEATURE = 'reports';
// CSV-svarets typ. Samma Content-Type som sendCsv i src/server/api.js sätter.
const CSV_TYPE = 'text/csv; charset=utf-8';

// Antalet månader i översikten. Samma tolv som OVERVIEW_MONTHS i
// src/server/api.js: antalet står inte i adressen, så en klient kan inte be om
// ett annat antal, och attrappen har därför ingen count att validera.
const OVERVIEW_MONTHS = 12;

// Kodens längd. Samma sex siffror som CODE_LENGTH i src/server/auth.js.
const CODE_DIGITS = 6;

// Namnordningen i steg 5 av kedjan. Språket står utskrivet och hämtas aldrig ur
// körmiljön: i webbläsaren är standardspråket användarens webbläsarspråk, och
// utan 'sv' sorteras Å före Z för en svensk användare men efter för en engelsk
// (LARDOMAR.md 2026-09-12). Samma rad som src/server/months.js har.
const NAME_COLLATOR = new Intl.Collator('sv');

// Ett led i en sökväg, eller null när sökvägen inte har den formen. Samma regler
// som segmentAfter i src/server/api.js: ingen trimning, ingen avkodning, och ett
// tomt led eller ett led med snedstreck är ingen väg alls.
// Leden i /api/rapport/<ÅÅÅÅ-MM>/<N>[/csv], eller null [steg 5 del 3]. Samma
// regler som reportFromPath i src/server/api.js: ingen trimning, ingen
// avkodning, och ett N som inte är ett tal i kanonisk form är ingen adress.
function reportFromPath(pathname) {
  if (!pathname.startsWith(REPORT_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(REPORT_PATH_PREFIX.length).split('/');
  const csv = parts.length === 3 && parts[2] === REPORT_CSV_SEGMENT;
  if (parts.length !== 2 && !csv) {
    return null;
  }
  if (parts[0] === '' || !REPORT_COUNT_PATTERN.test(parts[1])) {
    return null;
  }
  return { month: parts[0], count: Number(parts[1]), csv };
}

function segmentAfter(pathname, prefix) {
  if (!pathname.startsWith(prefix)) {
    return null;
  }
  const segment = pathname.slice(prefix.length);
  if (segment === '' || segment.includes('/')) {
    return null;
  }
  return segment;
}

// De två leden i /api/poster/<id>/manad/<ÅÅÅÅ-MM>.
function itemMonthFromPath(pathname) {
  if (!pathname.startsWith(ITEM_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(ITEM_PATH_PREFIX.length).split('/');
  if (parts.length !== 3 || parts[1] !== ITEM_MONTH_SEGMENT) {
    return null;
  }
  if (parts[0] === '' || parts[2] === '') {
    return null;
  }
  return { itemId: parts[0], month: parts[2] };
}

// De två leden i /api/mallar/<seriesId>/<ÅÅÅÅ-MM>.
function seriesMonthFromPath(pathname) {
  if (!pathname.startsWith(TEMPLATE_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(TEMPLATE_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { seriesId: parts[0], month: parts[1] };
}

// De två leden i /api/budget/<ÅÅÅÅ-MM>/<kategori> [steg 2]. Samma regler som
// budgetCategoryFromPath i src/server/api.js: kategorin prövas inte mot
// CATEGORIES här. En kategori som inte finns matchar ingen rad och ger samma 404
// som en kategori utan tak.
function budgetCategoryFromPath(pathname) {
  if (!pathname.startsWith(BUDGET_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(BUDGET_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    return null;
  }
  return { month: parts[0], category: parts[1] };
}

// Id:t i /api/rakningar/<id>/betald [steg 3], eller null när sökvägen inte har
// den formen. Samma regler som billPaidIdFromPath i src/server/api.js: exakt två
// led, och det andra ska vara betald.
function billPaidIdFromPath(pathname) {
  if (!pathname.startsWith(BILL_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(BILL_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] !== BILL_PAID_SEGMENT) {
    return null;
  }
  return parts[0];
}

// Id:t i /api/sparmal/<id>/insattning [steg 4], eller null när sökvägen inte har
// den formen. Samma regler som goalDepositFromPath i src/server/api.js: exakt två
// led, och det andra ska vara insattning.
//
// Vägen går inte att matcha med segmentAfter, som avvisar varje led som innehåller
// ett snedstreck - det är just det som gör att /api/sparmal/<id> och den här vägen
// inte kan förväxlas med varandra.
function goalDepositIdFromPath(pathname) {
  if (!pathname.startsWith(GOAL_PATH_PREFIX)) {
    return null;
  }
  const parts = pathname.slice(GOAL_PATH_PREFIX.length).split('/');
  if (parts.length !== 2 || parts[0] === '' || parts[1] !== GOAL_DEPOSIT_SEGMENT) {
    return null;
  }
  return parts[0];
}

// Sökvägen ur det app.js skickade. Adressen är alltid absolut-från-roten i
// app.js, men ett URL-objekt och en fullständig adress hanteras också: en
// attrapp som bara förstår en av formerna går sönder av en ändring i app.js i
// stället för att svara.
function pathnameOf(url) {
  const text = String(url);
  if (text.startsWith('/')) {
    const slut = text.search(/[?#]/);
    return slut === -1 ? text : text.slice(0, slut);
  }
  try {
    return new URL(text).pathname;
  } catch {
    return text;
  }
}

// Steg 5 i kedjan i src/server/months.js: slag i ITEM_KINDS ordning, därefter
// namn i svensk ordning, därefter id. Sista ledet finns för att ordningen ska
// vara total.
function compareItems(a, b) {
  const kindOrder = ITEM_KINDS.indexOf(a.kind) - ITEM_KINDS.indexOf(b.kind);
  if (kindOrder !== 0) {
    return kindOrder;
  }
  const nameOrder = NAME_COLLATOR.compare(a.name, b.name);
  if (nameOrder !== 0) {
    return nameOrder;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

// En engångspost som en post i svaret. Samma fält och samma värden som
// toMonthItem i src/server/months.js.
function toMonthItem(row) {
  return {
    id: row.id,
    kind: row.kind,
    name: row.name,
    amountOre: row.amountOre,
    category: row.category,
    // Samma två fält som toMonthItem i src/server/months.js [steg 2]: den dag
    // och den kommentar användaren skrev in, eller null.
    occurredOn: row.occurredOn ?? null,
    note: row.note ?? null,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    // Samma två fält som toMonthItem i src/server/months.js, och null av samma
    // skäl: de två sorternas poster ska ha exakt samma fält [etapp 4, rättelsen
    // "posten bär sitt intervall"].
    interval: null,
    toMonth: null
  };
}

// En mall som en mall i svaret. Samma fält som toTemplate i
// src/server/months.js.
function toTemplate(template) {
  return {
    id: template.id,
    seriesId: template.seriesId,
    kind: template.kind,
    name: template.name,
    amountOre: template.amountOre,
    category: template.category,
    interval: template.interval,
    startDate: template.startDate,
    fromMonth: template.fromMonth,
    toMonth: template.toMonth
  };
}

// En månads innehåll och summor, i minnet. Stegen är readMonth i
// src/server/months.js, i samma ordning och med samma regler — ingen egen
// variant av regeln.
//
// Exporterad utöver att GET-vägen och avvikelsevägen anropar den inne i filen:
// tests/demo.test.js läser kedjan direkt för (D4), (D9) och (D10), eftersom
// frågan "vilka månader träffar en kvartalspost" är kedjans och inte HTTP-lagrets.
//
// Jämförelsen av månader sker som text, precis som SQL:en gör: både år och månad
// är nollutfyllda i ÅÅÅÅ-MM, så den alfabetiska ordningen är den kronologiska.
export function readDemoMonth(state, month) {
  // Steg 1. firstDayOfMonth avgör både om månaden är en månad och ger det värde
  // steg 2 behöver — samma rad, och samma ägare, som readMonth har.
  const firstDay = firstDayOfMonth(month);

  const templates = state.templates.filter(
    (template) =>
      template.fromMonth <= month && (template.toMonth === null || template.toMonth >= month)
  );
  const overrides = state.overrides.filter((override) => override.month === month);
  const oneOffItems = state.monthItems.filter((item) => item.month === month);

  // En mall har högst en avvikelse per månad — samma invariant som schemats
  // UNIQUE (template_id, month) — så uppslaget kan vara en Map utan att något
  // värde skrivs över tyst.
  const overrideByTemplateId = new Map(overrides.map((override) => [override.templateId, override]));

  const items = [];
  for (const template of templates) {
    // Steg 2: intervallträffen. nextDueDate äger både periodräkningen och
    // klampningen för den 29-31. Frågan "dras posten den här månaden" ställs som
    // "ligger den första dragningen den 1:a i månaden eller senare fortfarande i
    // samma månad".
    const dueDate = nextDueDate({ interval: template.interval, startDate: template.startDate }, firstDay);
    if (monthOfIsoDate(dueDate) !== month) {
      continue;
    }
    // Steg 3: avvikelsen för just den här mallversionen. skipped är en boolean
    // här, där SQLite skriver 1 — demon har ingen databas, och kärnans
    // validateOverrideDraft svarar med true och false.
    const override = overrideByTemplateId.get(template.id);
    if (override !== undefined && override.skipped === true) {
      continue;
    }
    const overridden = override !== undefined;
    items.push({
      id: template.id,
      kind: template.kind,
      name: template.name,
      amountOre: overridden ? override.amountOre : template.amountOre,
      category: template.category,
      // En mall har ingen enskild dag och ingen enskild kommentar, precis som
      // readMonth i src/server/months.js ger dem: null i båda [steg 2].
      occurredOn: null,
      note: null,
      dueDate,
      recurring: true,
      seriesId: template.seriesId,
      overridden,
      // Mallens två egna fält, precis som readMonth i src/server/months.js ger
      // dem: gränssnittet förifyller dem för "Från och med <månad>".
      interval: template.interval,
      toMonth: template.toMonth
    });
  }

  // Steg 4: engångsposterna. Ingen dag och inget intervall, alltså ingen
  // dueDate, och en engångspost kan inte ha en avvikelse.
  for (const row of oneOffItems) {
    items.push(toMonthItem(row));
  }

  // Steg 5.
  items.sort(compareItems);
  // Steg 6: summorna. budget.js äger räkningen, inklusive "kvar att leva på" —
  // attrappen adderar ingenting själv.
  // Steg 7: taken [steg 2], räknade ur items ovan och inte ur en egen lista:
  // det som är kvar av ett tak ska vara kvar av exakt de poster månadsvyn visar.
  return { items, totals: monthTotals(items), budgets: budgetLines(state, month, items) };
}

// Månadens tak med utfallet [steg 2]. Stegen är budgetLines i
// src/server/months.js, i samma ordning och med samma regler — ingen egen
// variant av regeln.
//
// Bara kategorier med ett tak kommer med: en kategori utan tak har ingen budget
// att vara kvar av. spentOre räknar bara utgifter, och det är sumByKind i
// src/core/budget.js som avgör vilka poster som är utgifter — attrappen adderar
// ingenting själv och ärver därmed också spärren mot en summa som lämnar det
// säkra heltalsområdet.
//
// leftOre = amountOre - spentOre och får vara negativt: har besökaren dragit
// över taket ska det synas som ett minusbelopp, inte som noll. Differensen är den
// enda räkning funktionen gör.
//
// Ordningen är CATEGORIES ordning, alltså kategoriernas ägares, precis som på
// servern. Den är total: en kategori har högst ett tak per månad, vilket
// PUT-vägen nedan håller på samma sätt som schemats
// UNIQUE (user_id, month, category).
function budgetLines(state, month, items) {
  const amountByCategory = new Map(
    state.budgets
      .filter((row) => row.month === month)
      .map((row) => [row.category, row.amountOre])
  );
  const lines = [];
  for (const category of CATEGORIES) {
    if (!amountByCategory.has(category)) {
      continue;
    }
    const amountOre = amountByCategory.get(category);
    const spentOre = sumByKind(items.filter((item) => item.category === category), 'expense');
    lines.push({ category, amountOre, spentOre, leftOre: amountOre - spentOre });
  }
  return lines;
}

// Tolv månader bredvid varandra, i minnet. Stegen är readOverview i
// src/server/months.js, i samma ordning och med samma regler: varje månads
// summor kommer ur readDemoMonth ovan, alltså ur monthTotals, och en tom månad
// utelämnas inte.
//
// Exporterad utöver att GET-vägen anropar den inne i filen: tests/demo.test.js
// läser serien direkt, eftersom frågan "vilka månader står i översikten" är
// kedjans och inte HTTP-lagrets — samma skäl som readDemoMonth.
export function readDemoOverview(state, endMonth, count) {
  const months = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    months.push({ month, ...readDemoMonth(state, month).totals });
  }

  // savedThisYear täcker januari till och med endMonth i endMonth:s år, oavsett
  // hur långt count sträcker sig bakåt. Månadsnumret läses genom dates.js och
  // klipps inte ur strängen här.
  const januaryOffset = parseIsoDate(firstDayOfMonth(endMonth)).month - 1;
  const yearItems = [];
  for (let offset = januaryOffset; offset >= 0; offset -= 1) {
    for (const item of readDemoMonth(state, shiftMonth(endMonth, -offset)).items) {
      yearItems.push(item);
    }
  }
  // Summan räknas av sumByKind, monthTotals egen summerare, precis som i
  // src/server/months.js: additionen har då en enda ägare i projektet, och
  // spärren mot en summa som lämnar det säkra heltalsområdet följer med.
  return { months, savedThisYear: sumByKind(yearItems, 'saving') };
}

// Rapporten för count månader som slutar med endMonth [steg 5 del 3]. Samma
// kedja som readReport i src/server/reports.js: varje månad läses med
// readDemoMonth, äldst först, och listan lämnas till reportRows. Ingen egen
// räkning, samma regel som (D4).
//
// Exporterad av samma skäl som readDemoOverview: tests/demo.test.js läser den
// direkt.
export function readDemoReport(state, endMonth, count) {
  const monthsData = [];
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonth(endMonth, -offset);
    const { items, budgets } = readDemoMonth(state, month);
    monthsData.push({ month, items, budgets });
  }
  return reportRows(monthsData);
}

// Den version av en serie som gäller en månad, eller null. Samma periodvillkor
// som SQL_TEMPLATE_VERSION_FOR_MONTH i src/server/months.js: högst en version av
// en serie kan gälla en månad, eftersom versionerna läggs efter varandra utan
// överlapp.
function templateVersionForMonth(state, seriesId, month) {
  const match = state.templates.find(
    (template) =>
      template.seriesId === seriesId &&
      template.fromMonth <= month &&
      (template.toMonth === null || template.toMonth >= month)
  );
  return match === undefined ? null : match;
}

// Svarsobjektet. app.js läser status och json(), och ingenting annat; ok står
// med därför att det är en Response-egenskap varje läsare förväntar sig.
//
// Ett svar utan kropp avvisar i json(), precis som i webbläsaren och precis som
// createFetch i tests/helpers/dom.js gör det.
// Svarskroppen för planens två vägar: { plan, features }. Samma form och samma
// upplösning av arvet som planBody i src/server/api.js — hasFeature i
// src/core/plans.js äger upplösningen, och attrappen räknar inte ut den själv.
// En räkning i demons tillstånd som den form GET /api/rakningar svarar med: de
// sju fälten plus daysUntil och status. Båda de räknade fälten kommer ur
// src/core/bill.js, precis som toBillView i src/server/bills.js - demon räknar
// varken dagar eller status själv.
//
// anchorDate står inte i svaret: den kolumnen ingår inte i det gränssnittet får,
// och demons rad bär den bara för framflyttningen.
function toDemoBill(bill, today) {
  return {
    id: bill.id,
    name: bill.name,
    amountOre: bill.amountOre,
    dueDate: bill.dueDate,
    interval: bill.interval,
    remindDays: bill.remindDays,
    paidAt: bill.paidAt,
    daysUntil: daysUntilDue(bill.dueDate, today),
    status: billStatus(bill, today)
  };
}

// Samma skrivväg som addBill och updateBill i src/server/bills.js svarar med:
// de sju fälten utan daysUntil och status, som kräver ett today kroppen inte
// bär.
function toDemoBillWritten(bill) {
  return {
    id: bill.id,
    name: bill.name,
    amountOre: bill.amountOre,
    dueDate: bill.dueDate,
    interval: bill.interval,
    remindDays: bill.remindDays,
    paidAt: bill.paidAt
  };
}

// Sorteringen compareBills i src/server/bills.js skriver ut: due_date, därefter
// namn i svensk ordning, därefter id. Sista ledet finns för att ordningen ska
// vara total.
function compareBills(a, b) {
  const byDate = compareIsoDates(a.dueDate, b.dueDate);
  if (byDate !== 0) {
    return byDate;
  }
  const byName = NAME_COLLATOR.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

// Ett sparmål i demons tillstånd som den form GET /api/sparmal svarar med: de
// fyra fälten ur goals-raden plus de sex räknade. Alla sex kommer ur
// goalProgress i src/core/goal.js, precis som toGoalView i src/server/goals.js -
// demon räknar varken procent, månader eller månadstakt själv.
//
// savedOre är summan av målets insättningar. Summan räknas här och inte i
// goalProgress: på servern är den en SUM i SQL, och demon har ingen databas.
// Additionen är heltal ören och ingenting annat.
function toDemoGoal(goal, deposits, today) {
  const savedOre = deposits
    .filter((deposit) => deposit.goalId === goal.id)
    .reduce((summa, deposit) => summa + deposit.amountOre, 0);
  const bas = {
    id: goal.id,
    name: goal.name,
    targetOre: goal.targetOre,
    targetDate: goal.targetDate
  };
  return { ...bas, ...goalProgress({ ...bas, savedOre }, today) };
}

// Sorteringen compareGoals i src/server/goals.js skriver ut: namn i svensk
// ordning, därefter id. Sista ledet finns för att ordningen ska vara total.
function compareGoals(a, b) {
  const byName = NAME_COLLATOR.compare(a.name, b.name);
  if (byName !== 0) {
    return byName;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
}

function planBody(plan) {
  return { plan, features: FEATURES.filter((feature) => hasFeature(plan, feature)) };
}

function svar(status, json) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => {
      if (json === undefined) {
        throw new SyntaxError('Unexpected end of JSON input');
      }
      return json;
    }
  };
}

// CSV-svaret [steg 5 del 3]: en blob och ingen text, så att gränssnittet läser
// filen med blob() precis som mot servern, och json() avvisar. Bloben byggs ur
// strängen, som börjar med BOM:en: en Blob kodar sin sträng som UTF-8 och tar
// aldrig bort ett inledande tecken. Inga huvuden: gränssnittet läser inget
// huvud, och filnamnet kommer ur reportFileName.
function csvSvar(text) {
  return {
    status: 200,
    ok: true,
    json: async () => {
      throw new SyntaxError('Unexpected token in JSON');
    },
    blob: async () => new Blob([text], { type: CSV_TYPE })
  };
}

// Ett eget värde i stället för null eller undefined: en kropp som innehåller
// exakt "null" är giltig JSON och ska nå valideringen, inte förväxlas med en
// kropp som inte gick att tolka. Samma skäl som UNPARSABLE i src/server/api.js.
const UNPARSABLE = Symbol('unparsable');

function parseBody(body) {
  if (body === undefined || body === null) {
    return undefined;
  }
  try {
    return JSON.parse(String(body));
  } catch {
    return UNPARSABLE;
  }
}

// Kroppen som ett utkast att validera. En kropp som inte gick att tolka blir
// undefined, vilket varje validerare i src/core/item.js svarar på med fältfel —
// samma 400 som serverns UNPARSABLE_MESSAGE ger, med fältens egna texter.
function draftFrom(body) {
  const draft = parseBody(body);
  return draft === UNPARSABLE ? undefined : draft;
}

// Sex siffror, som demons kod. Ingen kryptografisk slump behövs: koden visas i
// bannern för besökaren själv och skickas ingenstans. generateCode i
// src/server/auth.js, som använder node:crypto, går inte att ladda i
// webbläsaren.
function defaultMakeCode() {
  const max = 10 ** CODE_DIGITS;
  return String(Math.floor(Math.random() * max)).padStart(CODE_DIGITS, '0');
}

function defaultMakeId() {
  const webCrypto = globalThis.crypto;
  if (webCrypto !== undefined && typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  // Utan crypto.randomUUID — en gammal webbläsare, eller ett sammanhang som inte
  // är säkert. Id:t behöver bara vara unikt inom demons eget tillstånd.
  return `demo-${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
}

// Attrappen. state är demons tillstånd, som funktionen ändrar på plats; save
// anropas efter varje ändring och är den enda vägen till lagringen; onCode får
// koden när besökaren begär en, så att bannern kan visa den i stället för att
// något mejlas.
//
// Ingen klocka och inget dagens datum: attrappen behöver ingen. Månaden står i
// sökvägen, och den dag seed-datan behöver läses av den som bygger den — så
// klockan läses fortfarande på exakt ett ställe i projektet (CLAUDE.md), och
// attrappen har ingen egen läsning att testa.
export function createDemoFetch({
  state,
  save = () => undefined,
  onCode = () => undefined,
  makeId = defaultMakeId,
  makeCode = defaultMakeCode
}) {
  // Varje svar som ändrat något går genom den här funktionen, så att ingen
  // ändring kan bli kvar bara i minnet.
  const sparaOch = (response) => {
    save(state);
    return response;
  };

  const kraverSession = () =>
    state.loggedIn === true ? null : svar(401, { error: SERVER_TEXTS.notLoggedIn });

  // Månadsspärren, i samma ordning som api.js: sessionen först, månaden sedan.
  // isValidIsoMonth i src/core/dates.js äger frågan — inget eget månadsmönster.
  const kraverManad = (month) =>
    isValidIsoMonth(month) ? null : svar(400, { error: SERVER_TEXTS.invalidMonth });

  const fieldErrorSvar = (errors) => svar(400, { error: errors[0].message, fieldErrors: errors });

  const metodStods = () => svar(405, { error: SERVER_TEXTS.methodNotAllowed });

  // Behörighetsspärren [steg 4], samma form och samma kropp som requireFeature i
  // src/server/api.js: texten plus feature och requiredPlan, så att gränssnittet
  // kan visa rätt låsruta utan att gissa ur strängen.
  //
  // hasFeature och planFor i src/core/plans.js äger både upplösningen av arvet och
  // frågan "vilken plan krävs", och PLAN_LABELS äger planens svenska namn -
  // attrappen räknar ingenting av det själv och skriver ingen plantitel.
  //
  // Till skillnad från budgetens spärr, som api.js kör med 'budget' och som
  // svarar null för varje plan demon kan ha, är den här grenen NÅBAR: demon börjar
  // på Bas, och savingsGoals och reports finns bara från Plus.
  //
  // Funktionen kommer som argument sedan steg 5 del 3, precis som i
  // requireFeature: sparmålens vägar anropar den med GOALS_FEATURE och
  // rapportens med REPORTS_FEATURE.
  const kraverFunktion = (feature) => {
    if (hasFeature(state.plan, feature)) {
      return null;
    }
    const requiredPlan = planFor(feature);
    return svar(403, {
      error: `Funktionen ingår i ${PLAN_LABELS[requiredPlan]}. Uppgradera för att låsa upp.`,
      feature,
      requiredPlan
    });
  };

  // PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>. Versioneringen är changeTemplateFrom i
  // src/server/months.js, uttryckt i minnet: den gamla versionen får
  // toMonth = månaden före, och en ny version med samma seriesId och samma
  // startDate läggs från månaden. Månaderna före behåller det gamla värdet —
  // historiken skrivs aldrig om.
  function andraSerie(seriesId, month, body) {
    const result = validateTemplateDraft(draftFrom(body), month);
    if (!result.ok) {
      return fieldErrorSvar(result.errors);
    }
    const current = templateVersionForMonth(state, seriesId, month);
    if (current === null) {
      return svar(404, { error: SERVER_TEXTS.entryNotFound });
    }
    const previous = shiftMonth(month, -1);
    // Varje version som börjar i månaden eller senare tas bort, utom den version
    // anropet behåller. Utan raden täcker den nya versionen samma månader som en
    // redan befintlig framtida version, och posten visas två gånger.
    state.templates = state.templates.filter(
      (template) =>
        !(template.seriesId === seriesId && template.fromMonth >= month && template.id !== current.id)
    );

    // Gränsfallet: ändringen gäller från samma månad som versionen själv börjar
    // i. Att sätta toMonth = previous ger då en version utan en enda månad,
    // vilket schemats CHECK (to_month IS NULL OR to_month >= from_month) fäller
    // på servern. Villkoret skrivs som jämförelsen mot previous, alltså mot
    // exakt det värde CHECK hade fått.
    if (compareMonths(previous, current.fromMonth) < 0) {
      current.kind = result.value.kind;
      current.name = result.value.name;
      current.amountOre = result.value.amountOre;
      current.category = result.value.category;
      current.interval = result.value.interval;
      current.toMonth = result.value.toMonth;
      return svar(200, { template: toTemplate(current) });
    }

    current.toMonth = previous;
    const template = {
      id: makeId(),
      seriesId: current.seriesId,
      kind: result.value.kind,
      name: result.value.name,
      amountOre: result.value.amountOre,
      category: result.value.category,
      interval: result.value.interval,
      // Samma dag i månaden: startDate styr intervallets fas i steg 2, så en ny
      // dag hade flyttat vilka månader serien träffar.
      startDate: current.startDate,
      fromMonth: month,
      toMonth: result.value.toMonth
    };
    state.templates.push(template);
    return svar(200, { template: toTemplate(template) });
  }

  // DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>. endTemplate i
  // src/server/months.js: den version som löper in i månaden får
  // toMonth = månaden före, och versioner som börjar i månaden eller senare tas
  // bort. Månaderna före är orörda.
  function avslutaSerie(seriesId, month) {
    const previous = shiftMonth(month, -1);
    let berorda = 0;
    for (const template of state.templates) {
      if (
        template.seriesId === seriesId &&
        template.fromMonth < month &&
        (template.toMonth === null || template.toMonth >= month)
      ) {
        template.toMonth = previous;
        berorda += 1;
      }
    }
    const kvar = state.templates.filter(
      (template) => !(template.seriesId === seriesId && template.fromMonth >= month)
    );
    berorda += state.templates.length - kvar.length;
    state.templates = kvar;
    if (berorda === 0) {
      return svar(404, { error: SERVER_TEXTS.entryNotFound });
    }
    return svar(204);
  }

  // PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>. Kroppens två former ägs av
  // validateOverrideDraft i src/core/item.js — attrappen läser varken skipped
  // eller amountSek själv. Svaret är månaden efter ändringen, { items, totals },
  // och inte den ändrade posten: en överhoppad månad har ingen post att svara
  // med.
  function sattAvvikelse(templateId, month, body) {
    const result = validateOverrideDraft(draftFrom(body));
    if (!result.ok) {
      return fieldErrorSvar(result.errors);
    }
    const template = state.templates.find((candidate) => candidate.id === templateId);
    if (template === undefined) {
      return svar(404, { error: SERVER_TEXTS.entryNotFound });
    }
    const befintlig = state.overrides.find(
      (override) => override.templateId === templateId && override.month === month
    );
    if (befintlig === undefined) {
      state.overrides.push({
        id: makeId(),
        templateId,
        month,
        amountOre: result.value.amountOre,
        skipped: result.value.skipped
      });
    } else {
      befintlig.amountOre = result.value.amountOre;
      befintlig.skipped = result.value.skipped;
    }
    const efter = readDemoMonth(state, month);
    return svar(200, { items: efter.items, totals: efter.totals });
  }

  // Attrappens enda utåtvända funktion. async därför att webbläsarens fetch är
  // det: app.js await:ar varje anrop.
  async function demoFetch(url, init = {}) {
    const pathname = pathnameOf(url);
    const method = init.method ?? 'GET';
    const body = init.body;

    if (!pathname.startsWith(API_PREFIX)) {
      return svar(404, { error: SERVER_TEXTS.unknownPath });
    }

    // POST /api/auth/kod. Svarar alltid 202 utan kropp — raden i ARKITEKTUR.md
    // har bara den statuskoden. Attrappen prövar inte adressens form:
    // isValidEmail i src/server/auth.js äger frågan och går inte att ladda i
    // webbläsaren, och en andra handskriven kopia av regeln vore två facit för
    // samma fråga (LARDOMAR.md 2026-09-02).
    if (pathname === AUTH_CODE_PATH) {
      if (method !== 'POST') {
        return metodStods();
      }
      const draft = draftFrom(body);
      state.code = makeCode();
      // Adressen sparas i demons eget tillstånd och skickas ingenstans.
      if (typeof draft?.email === 'string') {
        state.email = draft.email;
      }
      onCode(state.code, state.email);
      return sparaOch(svar(202));
    }

    // POST /api/auth/logga-in. 204 när koden stämmer, annars 400 med serverns
    // egen text för en kod som inte stämmer.
    if (pathname === AUTH_LOGIN_PATH) {
      if (method !== 'POST') {
        return metodStods();
      }
      const code = draftFrom(body)?.code;
      if (typeof state.code !== 'string' || code !== state.code) {
        return svar(400, { error: SERVER_TEXTS.unknownCode });
      }
      state.loggedIn = true;
      state.code = null;
      return sparaOch(svar(204));
    }

    // POST /api/auth/logga-ut. 204 även utan giltig session: utloggning ska
    // aldrig misslyckas.
    if (pathname === AUTH_LOGOUT_PATH) {
      if (method !== 'POST') {
        return metodStods();
      }
      state.loggedIn = false;
      state.code = null;
      return sparaOch(svar(204));
    }

    if (pathname === ME_PATH) {
      if (method !== 'GET') {
        return metodStods();
      }
      return kraverSession() ?? svar(200, { email: state.email });
    }

    // GET och PUT /api/plan [steg 1 i del 5]. Samma statuskoder och samma kropp
    // som src/server/api.js: 200 { plan, features }, 400 vid okänd plan, 401
    // utan session.
    //
    // Bytet är hela poängen med demon: besökaren kan växla plan fritt, och
    // ingen betalning sker och ingen betalning antyds.
    if (pathname === PLAN_PATH) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method === 'GET') {
        return svar(200, planBody(state.plan));
      }
      if (method !== 'PUT') {
        return metodStods();
      }
      // isPlanKey i src/core/plans.js äger frågan "detta är en känd plan".
      // Attrappen skriver ingen egen lista över plannycklar, precis som den
      // inte skriver något eget månadsmönster.
      const plan = draftFrom(body)?.plan;
      if (!isPlanKey(plan)) {
        return svar(400, { error: SERVER_TEXTS.invalidPlan });
      }
      state.plan = plan;
      return sparaOch(svar(200, planBody(plan)));
    }

    const month = segmentAfter(pathname, MONTH_PATH_PREFIX);
    if (month !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'GET' && method !== 'POST') {
        return metodStods();
      }
      const felManad = kraverManad(month);
      if (felManad !== null) {
        return felManad;
      }
      if (method === 'GET') {
        const result = readDemoMonth(state, month);
        // budgets står med sedan steg 2: kortet Budget i månadsvyn ritas ur
        // samma svar, utan en andra hämtning.
        return svar(200, { items: result.items, totals: result.totals, budgets: result.budgets });
      }
      const result = validateMonthItemDraft(draftFrom(body));
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      const row = {
        id: makeId(),
        month,
        kind: result.value.kind,
        name: result.value.name,
        amountOre: result.value.amountOre,
        category: result.value.category,
        occurredOn: result.value.occurredOn,
        note: result.value.note
      };
      state.monthItems.push(row);
      return sparaOch(svar(201, { item: toMonthItem(row) }));
    }

    // DELETE /api/budget/<ÅÅÅÅ-MM>/<kategori> [steg 2]. Prövas före den enkla
    // /api/budget/<månad>, precis som i api.js: den längre vägen är den mer
    // specifika.
    //
    // Behörighetsspärren saknas i båda de här vägarna, och det är avsiktligt:
    // api.js kör requireFeature med 'budget', och budget står i alla tre
    // planerna, så spärren svarar null för varje plan demon kan ha. En kopia av
    // den hade inte kunnat ge något annat svar än det som ges här.
    const budgetCategory = budgetCategoryFromPath(pathname);
    if (budgetCategory !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'DELETE') {
        return metodStods();
      }
      const felManad = kraverManad(budgetCategory.month);
      if (felManad !== null) {
        return felManad;
      }
      const kvar = state.budgets.filter(
        (row) => row.month !== budgetCategory.month || row.category !== budgetCategory.category
      );
      if (kvar.length === state.budgets.length) {
        // Samma text och samma statuskod som för en kategori som aldrig haft
        // ett tak.
        return svar(404, { error: SERVER_TEXTS.entryNotFound });
      }
      state.budgets = kvar;
      return sparaOch(svar(204));
    }

    // PUT /api/budget/<ÅÅÅÅ-MM> [steg 2]. Skapar taket eller ersätter det som
    // finns — schemats UNIQUE (user_id, month, category) gör de två till en
    // operation på servern, och raderna nedan håller samma invariant i minnet:
    // den gamla raden för månaden och kategorin tas bort, och en ny läggs sist.
    //
    // Svaret är månadens budgetar och inte den enda raden som skrevs, precis som
    // handleSetBudget i src/server/api.js: spentOre och leftOre kommer ur
    // readDemoMonth, som är den enda ägaren till formen.
    const budgetMonth = segmentAfter(pathname, BUDGET_PATH_PREFIX);
    if (budgetMonth !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'PUT') {
        return metodStods();
      }
      const felManad = kraverManad(budgetMonth);
      if (felManad !== null) {
        return felManad;
      }
      // Kroppens två fält ägs av validateBudgetDraft i src/core/item.js.
      // Attrappen läser varken category eller amountSek själv och har ingen egen
      // lista över kategorier.
      const result = validateBudgetDraft(draftFrom(body));
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      state.budgets = [
        ...state.budgets.filter(
          (row) => row.month !== budgetMonth || row.category !== result.value.category
        ),
        {
          id: makeId(),
          month: budgetMonth,
          category: result.value.category,
          amountOre: result.value.amountOre
        }
      ];
      return sparaOch(svar(200, { budgets: readDemoMonth(state, budgetMonth).budgets }));
    }

    // POST /api/rakningar/<id>/betald [steg 3]. Prövas före den enkla
    // /api/rakningar/<led>, precis som i api.js: den längre vägen är den mer
    // specifika.
    //
    // De två utfallen är markBillPaid i src/server/bills.js, uttryckta i minnet:
    // en engångsräkning behåller sitt dueDate och får paidAt satt, och en
    // återkommande får nästa förfallodag med paidAt nollställd. anchorDate rörs
    // inte av någondera - en betalning flyttar aldrig seriens fas.
    const billPaidId = billPaidIdFromPath(pathname);
    if (billPaidId !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'POST') {
        return metodStods();
      }
      // draftFrom och inte parseBody: en kropp som inte går att tolka ger
      // undefined, och undefined är inget datum - samma svar som för ett today
      // som saknas. Valfri kedjning av samma skäl som i api.js: en kropp som är
      // null, en sträng eller en array ger undefined.
      const today = draftFrom(body)?.today;
      if (!isValidIsoDate(today)) {
        return svar(400, { error: SERVER_TEXTS.invalidToday });
      }
      const row = state.bills.find((bill) => bill.id === billPaidId);
      if (row === undefined) {
        return svar(404, { error: SERVER_TEXTS.billNotFound });
      }
      if (row.interval === null) {
        // Dagen och inte en tidsstämpel: demon läser ingen klocka här, och
        // ingenting i vyn visar tidpunkten - paidAt behöver bara vara satt för
        // att statusen ska bli betald. Servern skriver nowIso() i samma fält.
        row.paidAt = today;
      } else {
        row.dueDate = nextBillDueDate(row, today);
        row.paidAt = null;
      }
      return sparaOch(svar(200, { bill: toDemoBillWritten(row) }));
    }

    // GET /api/rakningar/<ÅÅÅÅ-MM-DD> [steg 3]. Samma ordning som api.js:
    // sessionen först, metoden, sedan datumet. isValidIsoDate i
    // src/core/dates.js äger frågan - inget eget datummönster här.
    const billToday = segmentAfter(pathname, BILL_PATH_PREFIX);
    if (billToday !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'GET') {
        return metodStods();
      }
      if (!isValidIsoDate(billToday)) {
        return svar(400, { error: SERVER_TEXTS.invalidToday });
      }
      return svar(200, {
        bills: state.bills.map((bill) => toDemoBill(bill, billToday)).sort(compareBills)
      });
    }

    // POST /api/rakningar [steg 3]. Kroppens fem fält ägs av validateBillDraft i
    // src/core/bill.js: attrappen läser varken beloppet, datumet eller
    // intervallet självt.
    if (pathname === BILLS_PATH) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'POST') {
        return metodStods();
      }
      const result = validateBillDraft(draftFrom(body));
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      const bill = {
        id: makeId(),
        name: result.value.name,
        amountOre: result.value.amountOre,
        dueDate: result.value.dueDate,
        // Ankardagen ÄR den första förfallodagen, precis som addBill skriver
        // den.
        anchorDate: result.value.dueDate,
        interval: result.value.interval,
        remindDays: result.value.remindDays,
        paidAt: null
      };
      state.bills.push(bill);
      return sparaOch(svar(201, { bill: toDemoBillWritten(bill) }));
    }

    // Sparmålens vägar [steg 4]. Samma ordning som api.js: sessionen först,
    // BEHÖRIGHETEN sedan, därefter metoden, datumet och valideringen.
    //
    // Behörigheten är det nya här. Till skillnad från budgetens och
    // räkningarnas vägar är 403-grenen NÅBAR: savingsGoals står i PLANS.plus och
    // inte i PLANS.bas, och demon börjar på Bas. Besökaren möter alltså låsraden
    // först och kortet efter ett byte till Plus - det är hela poängen med att
    // seed-datan börjar på Bas.
    //
    // POST /api/sparmal/<id>/insattning [steg 4]. Prövas före den enkla
    // /api/sparmal/<led> nedan, precis som i api.js: den längre vägen är den mer
    // specifika, och segmentAfter svarar null för en sökväg med två led, så de två
    // matchningarna kan inte båda vara sanna.
    //
    // Kroppens två fält ägs av validateDepositDraft i src/core/goal.js. Beloppet
    // får vara NEGATIVT - ett uttag ur sparandet - och får inte vara noll; båda
    // reglerna står där och inte här.
    //
    // Insättningen läggs platt i state.goalDeposits med goalId, precis som
    // tabellen goal_deposits har den: demon speglar schemat och inte en bekvämare
    // form. Målets savedOre räknas aldrig om här - det är toDemoGoal som summerar
    // insättningarna vid nästa GET, så den nya summan går genom goalProgress i
    // src/core/goal.js precis som serverns gör.
    //
    // Svaret är de fyra fälten addDeposit i src/server/goals.js svarar med, och
    // inte målet efteråt: ett 201 beskriver det som skapades, och gränssnittet
    // hämtar listan om för att se det nya savedOre.
    const depositGoalId = goalDepositIdFromPath(pathname);
    if (depositGoalId !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      const utanFunktion = kraverFunktion(GOALS_FEATURE);
      if (utanFunktion !== null) {
        return utanFunktion;
      }
      if (method !== 'POST') {
        return metodStods();
      }
      const result = validateDepositDraft(draftFrom(body));
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      // Målet läses efter valideringen, samma ordning som api.js: där ligger
      // kontrollen inne i addDeposit, alltså efter validateDepositDraft.
      if (!state.goals.some((goal) => goal.id === depositGoalId)) {
        return svar(404, { error: SERVER_TEXTS.goalNotFound });
      }
      const deposit = {
        id: makeId(),
        goalId: depositGoalId,
        amountOre: result.value.amountOre,
        madeOn: result.value.madeOn
      };
      state.goalDeposits.push(deposit);
      return sparaOch(svar(201, { deposit }));
    }

    // GET /api/sparmal/<ÅÅÅÅ-MM-DD>. Prövas före den enkla /api/sparmal nedan,
    // precis som i api.js.
    const goalToday = segmentAfter(pathname, GOAL_PATH_PREFIX);
    if (goalToday !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      const utanFunktion = kraverFunktion(GOALS_FEATURE);
      if (utanFunktion !== null) {
        return utanFunktion;
      }
      if (method !== 'GET') {
        return metodStods();
      }
      if (!isValidIsoDate(goalToday)) {
        return svar(400, { error: SERVER_TEXTS.invalidToday });
      }
      return svar(200, {
        goals: state.goals
          .map((goal) => toDemoGoal(goal, state.goalDeposits, goalToday))
          .sort(compareGoals)
      });
    }

    // POST /api/sparmal [steg 4]. Kroppens tre fält ägs av validateGoalDraft i
    // src/core/goal.js: attrappen läser varken målbeloppet eller slutdatumet
    // självt.
    //
    // Svaret bär de fyra fälten ur goals-raden och ingen av de sex räknade, precis
    // som addGoal i src/server/goals.js: de kräver ett dagens datum som kroppen
    // inte bär, och gränssnittet hämtar listan om efter en sparning.
    if (pathname === GOALS_PATH) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      const utanFunktion = kraverFunktion(GOALS_FEATURE);
      if (utanFunktion !== null) {
        return utanFunktion;
      }
      if (method !== 'POST') {
        return metodStods();
      }
      const result = validateGoalDraft(draftFrom(body));
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      const goal = {
        id: makeId(),
        name: result.value.name,
        targetOre: result.value.targetOre,
        targetDate: result.value.targetDate
      };
      state.goals.push(goal);
      return sparaOch(svar(201, { goal }));
    }

    // GET /api/rapport/<ÅÅÅÅ-MM>/<N> och .../csv [steg 5 del 3]. Samma ordning
    // som api.js: formen (404, ges av att vägen inte matchar), metoden,
    // sessionen, behörigheten, månaden och antalet.
    const report = reportFromPath(pathname);
    if (report !== null) {
      if (method !== 'GET') {
        return metodStods();
      }
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      const utanFunktion = kraverFunktion(REPORTS_FEATURE);
      if (utanFunktion !== null) {
        return utanFunktion;
      }
      const felManad = kraverManad(report.month);
      if (felManad !== null) {
        return felManad;
      }
      if (report.count < REPORT_MIN_MONTHS || report.count > REPORT_MAX_MONTHS) {
        return svar(400, { error: SERVER_TEXTS.invalidReportCount });
      }
      const result = readDemoReport(state, report.month, report.count);
      if (report.csv) {
        return csvSvar(toCsv(reportCsvRows(result)));
      }
      return svar(200, { months: result.months, rows: result.rows, largest: result.largest });
    }

    // GET /api/oversikt/<ÅÅÅÅ-MM>. Samma ordning som api.js: sessionen först,
    // metoden, sedan månaden.
    const overviewMonth = segmentAfter(pathname, OVERVIEW_PATH_PREFIX);
    if (overviewMonth !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'GET') {
        return metodStods();
      }
      const felManad = kraverManad(overviewMonth);
      if (felManad !== null) {
        return felManad;
      }
      const result = readDemoOverview(state, overviewMonth, OVERVIEW_MONTHS);
      return svar(200, { months: result.months, savedThisYear: result.savedThisYear });
    }

    const templateMonth = segmentAfter(pathname, TEMPLATE_PATH_PREFIX);
    if (templateMonth !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'POST') {
        return metodStods();
      }
      const felManad = kraverManad(templateMonth);
      if (felManad !== null) {
        return felManad;
      }
      const result = validateTemplateDraft(draftFrom(body), templateMonth);
      if (!result.ok) {
        return fieldErrorSvar(result.errors);
      }
      const id = makeId();
      const template = {
        id,
        // Första versionen av en serie bär sitt eget id som seriesId, precis som
        // addTemplate i src/server/months.js.
        seriesId: id,
        kind: result.value.kind,
        name: result.value.name,
        amountOre: result.value.amountOre,
        category: result.value.category,
        interval: result.value.interval,
        // Dagen härleds ur månaden och står inte i utkastet: formuläret har
        // inget dagfält, och den enda dag som går att läsa ur "den här månaden"
        // är den första.
        startDate: firstDayOfMonth(templateMonth),
        fromMonth: templateMonth,
        toMonth: result.value.toMonth
      };
      state.templates.push(template);
      return sparaOch(svar(201, { template: toTemplate(template) }));
    }

    const seriesMonth = seriesMonthFromPath(pathname);
    if (seriesMonth !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'PUT' && method !== 'DELETE') {
        return metodStods();
      }
      const felManad = kraverManad(seriesMonth.month);
      if (felManad !== null) {
        return felManad;
      }
      if (method === 'PUT') {
        return sparaOch(andraSerie(seriesMonth.seriesId, seriesMonth.month, body));
      }
      return sparaOch(avslutaSerie(seriesMonth.seriesId, seriesMonth.month));
    }

    // Prövas före den enkla /api/poster/<id>, precis som i api.js: den längre
    // vägen är den mer specifika.
    const itemMonth = itemMonthFromPath(pathname);
    if (itemMonth !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method !== 'PUT') {
        return metodStods();
      }
      const felManad = kraverManad(itemMonth.month);
      if (felManad !== null) {
        return felManad;
      }
      return sparaOch(sattAvvikelse(itemMonth.itemId, itemMonth.month, body));
    }

    const itemId = segmentAfter(pathname, ITEM_PATH_PREFIX);
    if (itemId !== null) {
      const utanSession = kraverSession();
      if (utanSession !== null) {
        return utanSession;
      }
      if (method === 'PUT') {
        const result = validateMonthItemDraft(draftFrom(body));
        if (!result.ok) {
          return fieldErrorSvar(result.errors);
        }
        const row = state.monthItems.find((item) => item.id === itemId);
        if (row === undefined) {
          // Samma text och samma statuskod som för ett id som aldrig funnits.
          return svar(404, { error: SERVER_TEXTS.entryNotFound });
        }
        row.kind = result.value.kind;
        row.name = result.value.name;
        row.amountOre = result.value.amountOre;
        row.category = result.value.category;
        row.occurredOn = result.value.occurredOn;
        row.note = result.value.note;
        return sparaOch(svar(200, { item: toMonthItem(row) }));
      }
      if (method === 'DELETE') {
        const kvar = state.monthItems.filter((item) => item.id !== itemId);
        if (kvar.length === state.monthItems.length) {
          return svar(404, { error: SERVER_TEXTS.entryNotFound });
        }
        state.monthItems = kvar;
        return sparaOch(svar(204));
      }
      return metodStods();
    }

    return svar(404, { error: SERVER_TEXTS.unknownPath });
  }

  // Bara fetch. Ingen annan väg in i attrappen behövs, och en returnerad
  // egenskap utan anropare är en export i förtid (ARKITEKTUR.md,
  // "Teststrategi").
  return { fetch: demoFetch };
}

// Inkopplingen. Är DEMO falsk händer ingenting alls: globalThis.fetch rörs inte,
// och ingen annan fil under demo/ laddas — seed.js, lagring.js och banner.js
// importeras dynamiskt och bara här inne. (D2) prövar det.
//
// Den översta nivåns await är avsiktlig: index.html och landning.html laddar den
// här filen som en modul före /app.js, och ett modulskript med await på översta
// nivån fördröjer nästa modulskript. app.js hinner därför aldrig anropa fetch
// innan attrappen är på plats.
if (DEMO) {
  const { clearState, getStorage, readState, writeState } = await import('./lagring.js');
  const { createSeedState } = await import('./seed.js');
  const { mountBanner } = await import('./banner.js');

  const storage = getStorage();
  const today = todayIso();
  const state = readState(storage) ?? createSeedState(today);

  const banner = mountBanner({
    document: globalThis.document,
    storageMissing: storage === null,
    onReset: () => {
      clearState(storage);
      globalThis.location?.reload();
    },
    onDemoLogin: () => {
      // Seed-datan skrivs tillbaka med loggedIn satt, och sidan laddas om: vilken
      // vy som syns avgörs av GET /api/mig och av ingenting annat, så app.js
      // behöver ingen egen demogren.
      writeState(storage, createSeedState(today));
      globalThis.location?.reload();
    }
  });

  globalThis.fetch = createDemoFetch({
    state,
    today,
    save: (nytt) => writeState(storage, nytt),
    onCode: (code, email) => banner.showCode(code, email)
  }).fetch;
}
