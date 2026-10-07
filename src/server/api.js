// Routing och JSON-svar för /api/*. Enda stället som översätter ett HTTP-anrop
// till ett anrop i kärnan eller i lagringen.
//
// Beloppet tolkas på exakt ett ställe i projektet: createEntry i src/core/entry.js.
// Den här filen gör ingen parseFloat, ingen Number() och ingen trimning av ett
// belopp — råvärdet ur anropets JSON skickas vidare orört.
import { isValidIsoMonth, nowIso } from '../core/dates.js';
import { createEntry } from '../core/entry.js';
import { validateBudgetDraft, validateMonthItemDraft, validateOverrideDraft, validateTemplateDraft } from '../core/item.js';
import { FEATURES, PLAN_LABELS, hasFeature, isPlanKey, planFor } from '../core/plans.js';
import {
  AUTH_MESSAGES,
  clearedSessionCookie,
  clientIp,
  logOut,
  readSessionToken,
  requestCode,
  requireSession,
  sessionCookie,
  setPlan,
  verifyCode
} from './auth.js';
import { getDatabase } from './db.js';
import {
  addMonthItem,
  addTemplate,
  changeTemplateFrom,
  endTemplate,
  readMonth,
  readOverview,
  removeBudget,
  removeMonthItem,
  setBudget,
  setOverride,
  skipMonth,
  updateMonthItem
} from './months.js';
import { loadEntries, updateEntries } from './storage.js';

// Ägs här och läses av server.js för rad S1 ("Ett trasigt anrop får inte döda
// appen"). Texten säger "anropet", inte "kroppen", och täcker därför både en
// kropp som inte gick att tolka och en förfrågningsrad som inte gick att tolka.
// En handskriven kopia i server.js vore en andra text för samma sak.
export const UNPARSABLE_MESSAGE = 'Kunde inte tolka anropet.';

// Svenska strängar mot användaren. De står i ARKITEKTUR.md under "HTTP-API" och
// skrivs bara här.
const MESSAGES = Object.freeze({
  unknownPath: 'Okänd adress.',
  methodNotAllowed: 'Metoden stöds inte.',
  // Samma sträng för "posten finns inte" och "posten tillhör någon annan", med
  // flit: användaren ska inte kunna se skillnad på de två, och två olika
  // strängar för samma svar vore två facit (ARKITEKTUR.md, "Månadens API").
  entryNotFound: 'Posten finns inte.',
  invalidMonth: 'Månaden måste anges som ÅÅÅÅ-MM.',
  // Texten för en plan som inte står i PLANS [steg 1 i del 5]. Står under
  // "Byta plan" i ARKITEKTUR.md och nämner de tre svenska namnen, aldrig de
  // engelska nycklarna bas, plus och premium — användaren ser aldrig dem.
  invalidPlan: 'Välj Bas, Plus eller Premium.'
});

const API_PREFIX = '/api/';
const ENTRIES_PATH = '/api/entries';
const ENTRY_PATH_PREFIX = '/api/entries/';

// Månadens två vägar [etapp 3]. Adresserna är svenska, precis som
// inloggningens: /api/manad/<ÅÅÅÅ-MM> och /api/poster/<id>.
const MONTH_PATH_PREFIX = '/api/manad/';
const ITEM_PATH_PREFIX = '/api/poster/';

// Översiktens väg [etapp 5]: /api/oversikt/<ÅÅÅÅ-MM>. Adressen är svensk,
// precis som månadens.
const OVERVIEW_PATH_PREFIX = '/api/oversikt/';
// Antalet månader i översikten. Står här och inte i vägen: en klient ska inte
// kunna be om ett annat antal förrän det finns ett skäl, och ett antal i
// adressen hade gjort taket i readOverview till det enda som skiljer tolv
// månader från tiotusen. count är ändå ett argument i datalagret, eftersom
// testerna behöver kortare serier.
const OVERVIEW_MONTHS = 12;

// Mallarnas vägar [etapp 4]. Adressen är svensk, precis som månadens.
const TEMPLATE_PATH_PREFIX = '/api/mallar/';
// Ledet mellan postens id och månaden i /api/poster/<id>/manad/<ÅÅÅÅ-MM>. Står
// som en konstant och inte som en literal i matchningen: samma svenska ord som
// MONTH_PATH_PREFIX bär, och två stavningar av det hade kunnat glida isär.
const ITEM_MONTH_SEGMENT = 'manad';

// Planens väg [steg 1 i del 5]. Adressen är ett ord som är detsamma på svenska
// och engelska, så den behöver ingen översättning.
const PLAN_PATH = '/api/plan';

// Budgetens väg [steg 2]: /api/budget/<ÅÅÅÅ-MM> och
// /api/budget/<ÅÅÅÅ-MM>/<kategori>. Ordet budget är detsamma på svenska och
// engelska, precis som plan, så adressen behöver ingen översättning.
const BUDGET_PATH_PREFIX = '/api/budget/';

// Inloggningens fyra vägar [etapp 2].
const AUTH_CODE_PATH = '/api/auth/kod';
const AUTH_LOGIN_PATH = '/api/auth/logga-in';
const AUTH_LOGOUT_PATH = '/api/auth/logga-ut';
const ME_PATH = '/api/mig';

// Ett eget värde i stället för null eller undefined: en kropp som innehåller
// exakt "null" är giltig JSON och ska nå createEntry, inte förväxlas med en
// kropp som inte gick att tolka.
const UNPARSABLE = Symbol('unparsable');

function sendJson(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

// Läser hela kroppen. Avvisas strömmen (klienten bryter anropet mitt i) svarar
// funktionen null, och POST-vägen behandlar det som en kropp som inte gick att
// tolka — annars skulle löftet aldrig fullbordas och anropet hänga för alltid.
function readBody(req) {
  return new Promise((resolve) => {
    const chunks = [];
    req.on('data', (chunk) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {
      resolve(null);
    });
  });
}

function parseBody(text) {
  if (text === null) {
    return UNPARSABLE;
  }
  try {
    return JSON.parse(text);
  } catch {
    return UNPARSABLE;
  }
}

// Sista ledet i sökvägen efter ett prefix, ordagrant. Ingen trimning, ingen
// avkodning och ingen normalisering: ett värde som inte matchar exakt finns
// inte. Ett tomt led och ett led som innehåller / är ingen väg alls utan
// "annat /api/*", alltså Okänd adress.
//
// Ägaren till regeln: den stod skriven för hand i entryIdFromPath fram till
// etapp 3, och månadens två vägar behöver exakt samma regel. Två handskrivna
// kopior kan glida isär utan att något test märker det (LARDOMAR.md
// 2026-09-02).
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

// De två leden i /api/poster/<id>/manad/<ÅÅÅÅ-MM>, eller null när sökvägen inte
// har den formen. Samma regler som segmentAfter: ingen trimning, ingen
// avkodning, och ett tomt led är ingen väg alls.
//
// Vägen går inte att matcha med segmentAfter, som avvisar varje led som
// innehåller ett snedstreck — det är just det som gör att /api/poster/<id> och
// den här vägen inte kan förväxlas med varandra.
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

// De två leden i /api/mallar/<seriesId>/<ÅÅÅÅ-MM>, eller null när sökvägen inte
// har den formen. Samma regler som segmentAfter och itemMonthFromPath: ingen
// trimning, ingen avkodning, och ett tomt led är ingen väg alls.
//
// Månaden prövas inte här utan i hanteraren, precis som för /api/manad/<månad>:
// vägen finns, och en månad som inte är en månad ska ge 400 med månadens text
// och inte 404 Okänd adress.
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

// De två leden i /api/budget/<ÅÅÅÅ-MM>/<kategori>, eller null när sökvägen inte
// har den formen [steg 2]. Samma regler som seriesMonthFromPath: ingen trimning,
// ingen avkodning, och ett tomt led är ingen väg alls.
//
// Varken månaden eller kategorin prövas här utan i hanteraren: vägen finns, och
// en månad som inte är en månad ska ge 400 med månadens text och inte 404 Okänd
// adress. Kategorin prövas inte alls på den här vägen — se handleDeleteBudget.
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

// Returnerar true om anropet hanterades, false om det inte var en /api-väg.
//
// now är tidsstämpeln anropet ska räknas mot, injicerad av samma skäl som
// dagens datum injiceras i src/core/schedule.js: en hanterare som läser klockan
// själv går inte att testa. Förvalet är projektets enda tidsstämpelläsning,
// nowIso() i src/core/dates.js, och server.js anropar funktionen med tre
// argument och får därmed den verkliga klockan.
export async function handleApiRequest(req, res, pathname, now = nowIso()) {
  if (pathname !== '/api' && !pathname.startsWith(API_PREFIX)) {
    return false;
  }

  if (pathname === AUTH_CODE_PATH) {
    if (req.method === 'POST') {
      await handleRequestCode(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_LOGIN_PATH) {
    if (req.method === 'POST') {
      await handleLogin(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === AUTH_LOGOUT_PATH) {
    if (req.method === 'POST') {
      handleLogout(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === ME_PATH) {
    if (req.method === 'GET') {
      handleMe(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === PLAN_PATH) {
    if (req.method === 'GET') {
      handleReadPlan(req, res, now);
      return true;
    }
    if (req.method === 'PUT') {
      await handleChangePlan(req, res, now);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  if (pathname === ENTRIES_PATH) {
    if (req.method === 'GET') {
      await handleList(res);
      return true;
    }
    if (req.method === 'POST') {
      await handleCreate(req, res);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const id = segmentAfter(pathname, ENTRY_PATH_PREFIX);
  if (id !== null) {
    if (req.method === 'DELETE') {
      await handleDelete(res, id);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  // Prövas före den enkla /api/budget/<månad>, fastän ordningen inte avgör något:
  // segmentAfter svarar null för en sökväg med fler än ett led, så de två
  // matchningarna kan inte båda vara sanna. Den längre vägen står först för att
  // den är den mer specifika — samma ordning som för postens två vägar nedan.
  const budgetCategory = budgetCategoryFromPath(pathname);
  if (budgetCategory !== null) {
    if (req.method === 'DELETE') {
      handleDeleteBudget(req, res, now, budgetCategory.month, budgetCategory.category);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const budgetMonth = segmentAfter(pathname, BUDGET_PATH_PREFIX);
  if (budgetMonth !== null) {
    if (req.method === 'PUT') {
      await handleSetBudget(req, res, now, budgetMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const month = segmentAfter(pathname, MONTH_PATH_PREFIX);
  if (month !== null) {
    if (req.method === 'GET') {
      handleReadMonth(req, res, now, month);
      return true;
    }
    if (req.method === 'POST') {
      await handleCreateMonthItem(req, res, now, month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const overviewMonth = segmentAfter(pathname, OVERVIEW_PATH_PREFIX);
  if (overviewMonth !== null) {
    if (req.method === 'GET') {
      handleReadOverview(req, res, now, overviewMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const templateMonth = segmentAfter(pathname, TEMPLATE_PATH_PREFIX);
  if (templateMonth !== null) {
    if (req.method === 'POST') {
      await handleCreateTemplate(req, res, now, templateMonth);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  // De två vägar som gäller en hel serie. Vilken operation anropet gör avgörs av
  // metoden och inte av ett fält i kroppen: PUT ändrar från och med månaden,
  // DELETE avslutar serien från och med månaden (ARKITEKTUR.md, "Rättelse av
  // etapp 4" — fältet omfattning utgick).
  const seriesMonth = seriesMonthFromPath(pathname);
  if (seriesMonth !== null) {
    if (req.method === 'PUT') {
      await handleChangeTemplate(req, res, now, seriesMonth.seriesId, seriesMonth.month);
      return true;
    }
    if (req.method === 'DELETE') {
      handleEndTemplate(req, res, now, seriesMonth.seriesId, seriesMonth.month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  // Prövas före den enkla /api/poster/<id>, fastän ordningen inte avgör något:
  // segmentAfter svarar null för en sökväg med fler än ett led, så de två
  // matchningarna kan inte båda vara sanna. Den längre vägen står först för att
  // den är den mer specifika.
  const itemMonth = itemMonthFromPath(pathname);
  if (itemMonth !== null) {
    if (req.method === 'PUT') {
      await handleSetMonthOverride(req, res, now, itemMonth.itemId, itemMonth.month);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  const itemId = segmentAfter(pathname, ITEM_PATH_PREFIX);
  if (itemId !== null) {
    if (req.method === 'PUT') {
      await handleUpdateMonthItem(req, res, now, itemId);
      return true;
    }
    if (req.method === 'DELETE') {
      handleDeleteMonthItem(req, res, now, itemId);
      return true;
    }
    sendJson(res, 405, { error: MESSAGES.methodNotAllowed });
    return true;
  }

  sendJson(res, 404, { error: MESSAGES.unknownPath });
  return true;
}

// Sessionsspärren, gemensam för månadens vägar. Svaret är användarens id, eller
// null när funktionen redan har svarat klienten — anroparen returnerar då utan
// att göra något mer.
//
// 401 ges av sessionsspärren innan vägen körs, inte av vägen själv
// (ARKITEKTUR.md, "API-vägar"). user_id kommer ur sessionen och aldrig ur
// anropet.
function sessionOrNull(req, res, now) {
  let guard;
  try {
    guard = requireSession(getDatabase(), { token: readSessionToken(req), now });
  } catch (error) {
    // db.js, auth.js och months.js kastar bara DatabaseError, och dess .message
    // är svensk text avsedd att visas för användaren.
    sendJson(res, 500, { error: error.message });
    return null;
  }
  if (guard.unauthorized === true) {
    sendUnauthorized(res, guard.message);
    return null;
  }
  return guard.session;
}

// Samma spärr, för de vägar som bara behöver användarens id. Byggd på
// sessionOrNull och inte som en andra kopia: 401-svaret och 500-svaret har en
// enda ägare, och en kopia per form är en kopia som kan glida.
function sessionUserId(req, res, now) {
  const session = sessionOrNull(req, res, now);
  return session === null ? null : session.userId;
}

// Behörighetsspärren, byggd som en funktion varje skyddad väg går genom — aldrig
// en kontroll upprepad per väg, eftersom en upprepad kontroll är en som glöms på
// en väg (ARKITEKTUR.md under "Behörigheten på servern").
//
// Svaret är null när planen räcker, annars kroppen till ett 403. Anroparen
// skickar den: funktionen tar session och feature och ingenting mer, precis som
// signaturen i ARKITEKTUR.md, och är därmed ren — den rör aldrig res.
//
// feature och requiredPlan står i svaret för att gränssnittet ska kunna visa rätt
// ruta utan att gissa ur texten. requiredPlan kommer ur planFor och PLAN_LABELS
// ger det svenska namnet; ingen av de två skrivs av här.
//
// Spärren prövas efter sessionen men före allt annat. Ordningen är bindande:
// session, behörighet, månadsspärr, validering, datalager. En utan session ska få
// 401 och inte 403 — annars avslöjar svaret vilka funktioner som finns för den
// som inte är inloggad.
//
// Grenen som ger ett 403 har i dag ingen nåbar indata: den enda skyddade vägen är
// budgetens, och budget står i alla tre planerna, så hasFeature är true för varje
// plan en session kan bära (körd: bas, plus och premium ger alla true). Mutation
// "ta bort if-satsen" överlever därför hela sviten, och det är väntat —
// ARKITEKTUR.md skriver ut skälet: vägen går ändå genom spärren "så att den dagen
// något ändras finns kontrollen på plats". Samma form som user_id = ? i
// SQL_TEMPLATE_BY_ID i months.js, som också står för en regel och inte för ett
// nåbart fall. Raden går inte att pröva med en riktig session förrän en väg
// skyddas av en funktion som inte finns i Bas; (P8) och (P9) i ARKITEKTUR.md är
// kvar hos arkitekten av exakt det skälet.
function requireFeature(session, feature) {
  if (hasFeature(session.plan, feature)) {
    return null;
  }
  const requiredPlan = planFor(feature);
  return {
    error: `Funktionen ingår i ${PLAN_LABELS[requiredPlan]}. Uppgradera för att låsa upp.`,
    feature,
    requiredPlan
  };
}

// Svarskroppen för planens två vägar: { plan, features }. En enda ägare till
// formen, så att GET och PUT inte kan svara olika — gränssnittet ritar om vyn
// ur PUT:ens svar utan en andra hämtning.
//
// features är de funktioner planen *har*, med arvet upplöst: hasFeature i
// src/core/plans.js äger upplösningen, och den här filen räknar inte ut den
// själv. Ordningen är FEATURES ordning, alltså planordning.
function planBody(plan) {
  return { plan, features: FEATURES.filter((feature) => hasFeature(plan, feature)) };
}

// GET /api/plan [steg 1 i del 5]. 200 { plan, features }, 401 utan session,
// 500 vid DatabaseError.
//
// Planen läses ur sessionen och aldrig ur anropet, av samma skäl som user_id:
// sessionen är den enda källan till vem användaren är och vad hen har betalt
// för. Ingen extra fråga mot databasen behövs — requireSession läser redan
// kontots rad.
function handleReadPlan(req, res, now) {
  const session = sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  sendJson(res, 200, planBody(session.plan));
}

// PUT /api/plan [steg 1 i del 5]. 200 { plan, features }, 400 vid okänd plan,
// 401 utan session, 500 vid DatabaseError.
//
// Samma bindande ordning som varje annan skrivväg: sessionsspärren,
// valideringen, sedan datalagret. Vägen har ingen månadsspärr — den gäller
// kontot och inte en månad.
//
// Ingen betalning sker och ingen betalning förbereds: bytet är en UPDATE av en
// kolumn. Att svaret kommer direkt är hela poängen med demon — gränssnittet
// visar texten om att ingen betalning genomförs.
async function handleChangePlan(req, res, now) {
  const session = sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  // isPlanKey i src/core/plans.js äger villkoret "detta är en känd plan". Det
  // här lagret skriver ingen egen lista över plannycklar, precis som det inte
  // skriver något eget månadsmönster. Allt som inte är en plannyckel — null, en
  // array, ett objekt, en felstavad nyckel — ger samma 400 med samma text.
  const plan = body?.plan;
  if (!isPlanKey(plan)) {
    sendJson(res, 400, { error: MESSAGES.invalidPlan });
    return;
  }
  try {
    setPlan(getDatabase(), { userId: session.userId, plan });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  // Svaret bär den nya planen och ingenting annat: en nedgradering raderar
  // ingen rad, så ingen lista behöver skickas med och ingen ändring behöver
  // ångras (ARKITEKTUR.md, "Nedgradering raderar ingen data").
  sendJson(res, 200, planBody(plan));
}

// GET /api/manad/<ÅÅÅÅ-MM>. 200 med poster och summor, 400 vid fel
// månadsformat, 401 utan session, 500 vid DatabaseError.
function handleReadMonth(req, res, now, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  // Månadsspärren prövas innan datalagret nås: en ogiltig månad ska aldrig bli
  // en SQL-fråga. isValidIsoMonth i src/core/dates.js äger frågan, och det här
  // lagret skriver inget eget månadsmönster.
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let result;
  try {
    result = readMonth(userId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  // budgets står med sedan steg 2: kortet Budget i månadsvyn ritas ur samma svar
  // som listan och summorna, så vyn behöver inte en andra hämtning.
  sendJson(res, 200, { items: result.items, totals: result.totals, budgets: result.budgets });
}

// PUT /api/budget/<ÅÅÅÅ-MM> [steg 2]. 200 med månadens budgetar, 400 med
// fieldErrors, 401 utan session, 403 utan behörighet, 500 vid DatabaseError.
//
// Ordningen är den bindande: sessionsspärren, behörigheten, månadsspärren,
// valideringen, sedan datalagret. Steg fyra före steg fem betyder att ett
// ogiltigt tak aldrig blir en SQL-fråga.
//
// Vägen skapar taket eller ersätter det som finns — UNIQUE i schemat gör det till
// en operation, så kroppen behöver inget fält som säger vilket av de två som
// avses.
//
// Svaret är månadens budgetar och inte den enda raden som skrevs: kortet Budget
// visar en rad per kategori med ett tak, så gränssnittet kan rita om hela kortet
// ur svaret utan en andra hämtning. spentOre och leftOre kommer därmed ur
// readMonth, som är den enda ägaren till formen.
async function handleSetBudget(req, res, now, month) {
  const session = sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const denied = requireFeature(session, 'budget');
  if (denied !== null) {
    sendJson(res, 403, denied);
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  // Kroppens två fält ägs av validateBudgetDraft i src/core/item.js. Det här
  // lagret läser varken category eller amountSek själv, och har ingen egen lista
  // över kategorier.
  const result = validateBudgetDraft(body);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let budgets;
  try {
    setBudget(session.userId, month, result.value.category, result.value.amountOre, { now });
    budgets = readMonth(session.userId, month).budgets;
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { budgets });
}

// DELETE /api/budget/<ÅÅÅÅ-MM>/<kategori> [steg 2]. 204, 400 vid fel
// månadsformat, 401, 403, 404 när taket inte finns eller tillhör någon annan,
// 500.
//
// Vägen har ingen kropp och därför ingen 400 utöver månadsspärrens — vad som ska
// hända står i metoden och i sökvägen. Funktionen är inte async av just det
// skälet: den väntar inte på readBody.
//
// Kategorin prövas inte mot CATEGORIES. En kategori som inte finns matchar ingen
// rad, och svaret blir då detsamma som för en kategori utan tak: 404 med samma
// text som för en post som inte finns. Tabellen under "API-vägar" räknar upp
// 204, 401, 404 och 500 för den här vägen och ingen 400 för kategorin, så en
// egen spärr här hade lagt till ett svar tabellen inte har.
function handleDeleteBudget(req, res, now, month, category) {
  const session = sessionOrNull(req, res, now);
  if (session === null) {
    return;
  }
  const denied = requireFeature(session, 'budget');
  if (denied !== null) {
    sendJson(res, 403, denied);
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let removed;
  try {
    // Beslutet "finns taket?" fattas av SQL:s WHERE med user_id = ?, inte av en
    // läsning före: ett tak som tillhör någon annan matchar då ingen rad, och
    // svaret blir detsamma som för en kategori som aldrig haft ett tak.
    removed = removeBudget(session.userId, month, category);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

// GET /api/oversikt/<ÅÅÅÅ-MM> [etapp 5]. 200 med { months, savedThisYear },
// 400 vid fel månadsformat, 401 utan session, 500 vid DatabaseError.
//
// Samma ordning som handleReadMonth ovan: sessionsspärren, månadsspärren, sedan
// datalagret. Månaden prövas här fastän readOverview prövar den igen — en
// ogiltig månad ska bli ett 400 med den svenska texten ur MESSAGES och aldrig
// ett 500 med ett RangeError-meddelande som namnger en funktion i datalagret.
function handleReadOverview(req, res, now, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let result;
  try {
    result = readOverview(userId, month, OVERVIEW_MONTHS);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { months: result.months, savedThisYear: result.savedThisYear });
}

// DELETE /api/poster/<id>. 204, 401, 404 om posten inte finns eller tillhör
// någon annan, 500 vid DatabaseError.
function handleDeleteMonthItem(req, res, now, itemId) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  let removed;
  try {
    // Beslutet "finns posten?" fattas av SQL:s WHERE med user_id = ?, inte av en
    // läsning före: en post som tillhör någon annan matchar då ingen rad, och
    // svaret blir detsamma som för ett id som aldrig funnits.
    removed = removeMonthItem(userId, itemId);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!removed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

// POST /api/manad/<ÅÅÅÅ-MM>. 201 med posten, 400 med fieldErrors, 401, 500.
// Ordningen är bindande: sessionsspärren, månadsspärren, valideringen, sedan
// datalagret. Steg tre före steg fyra betyder att en ogiltig post aldrig blir en
// SQL-fråga.
async function handleCreateMonthItem(req, res, now, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  // draft skickas orört vidare. Allt som inte är ett vanligt objekt — null, en
  // array, en sträng — hanteras av validateMonthItemDraft och ger fältfel.
  const result = validateMonthItemDraft(draft);
  if (!result.ok) {
    // Samma form som den gamla formulärvägen: error är det första felet, och
    // fieldErrors är listan orörd. Alla fyra fälten kan stå i listan, och alla
    // fyra finns i formuläret — ingen post har ett field som saknar
    // motsvarighet, till skillnad från id-felet i createEntry.
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let item;
  try {
    item = addMonthItem(userId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { item });
}

// PUT /api/poster/<id>. 200 med posten, 400, 401, 404 om posten inte finns eller
// tillhör någon annan, 500. Samma ordning som POST.
async function handleUpdateMonthItem(req, res, now, itemId) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateMonthItemDraft(draft);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let item;
  try {
    item = updateMonthItem(userId, itemId, result.value);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (item === null) {
    // Samma text och samma statuskod som för ett id som aldrig funnits.
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  sendJson(res, 200, { item });
}

// POST /api/mallar/<ÅÅÅÅ-MM>. 201 med mallen, 400 med fieldErrors, 401, 500.
// Samma bindande ordning som POST /api/manad/<ÅÅÅÅ-MM>: sessionsspärren,
// månadsspärren, valideringen, sedan datalagret. Steg tre före steg fyra
// betyder att en ogiltig mall aldrig blir en SQL-fråga.
async function handleCreateTemplate(req, res, now, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  // draft skickas orört vidare. Allt som inte är ett vanligt objekt hanteras av
  // validateTemplateDraft och ger fältfel. Månaden är andra argumentet och inte
  // ett fält i kroppen: slutmånaden prövas mot den månad mallen gäller från, och
  // den står i sökvägen.
  const result = validateTemplateDraft(draft, month);
  if (!result.ok) {
    // Samma form som månadspostens väg: error är det första felet, fieldErrors
    // är listan orörd. Alla sex fälten finns i formuläret, så ingen post har ett
    // field utan motsvarighet i gränssnittet.
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let template;
  try {
    template = addTemplate(userId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { template });
}

// PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>. 200 med den nya versionen, 400 med
// fieldErrors, 401, 404 om serien inte finns eller tillhör någon annan, 500.
//
// Kroppen är densamma som POST:ens: mallens sex fält. Samma bindande ordning
// som varje annan skrivväg — sessionsspärren, månadsspärren, valideringen,
// datalagret.
async function handleChangeTemplate(req, res, now, seriesId, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  const result = validateTemplateDraft(draft, month);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let template;
  try {
    template = changeTemplateFrom(userId, seriesId, month, result.value, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (template === null) {
    // Samma text och samma statuskod som för ett series_id som aldrig funnits.
    // changeTemplateFrom svarar null både då, när serien tillhör någon annan och
    // när ingen version gäller månaden.
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  sendJson(res, 200, { template });
}

// DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>. 204, 401, 404, 500.
//
// Vägen har ingen kropp och därför ingen 400 utöver månadsspärrens — vad som
// ska hända står i metoden och i sökvägen, ingenting läses ur anropets kropp.
// Funktionen är inte async av just det skälet: den väntar inte på readBody.
function handleEndTemplate(req, res, now, seriesId, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  let ended;
  try {
    // Beslutet "finns serien?" fattas av SQL:s WHERE med user_id = ?, inte av en
    // läsning före: en serie som tillhör någon annan matchar då ingen rad, och
    // svaret blir detsamma som för ett id som aldrig funnits.
    ended = endTemplate(userId, seriesId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!ended) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  res.writeHead(204);
  res.end();
}

// PUT /api/poster/<id>/manad/<ÅÅÅÅ-MM>. 200, 400, 401, 404 om mallen inte finns
// eller tillhör någon annan, 500. Samma ordning som POST.
//
// Svaret är månaden efter ändringen, { items, totals }, och inte den ändrade
// posten: en överhoppad månad har ingen post att svara med, och en väg ska ha
// en kroppsform och inte två. Formen är densamma som GET /api/manad/<ÅÅÅÅ-MM>
// ger, så gränssnittet kan rita om vyn ur svaret utan en andra hämtning.
async function handleSetMonthOverride(req, res, now, templateId, month) {
  const userId = sessionUserId(req, res, now);
  if (userId === null) {
    return;
  }
  if (!isValidIsoMonth(month)) {
    sendJson(res, 400, { error: MESSAGES.invalidMonth });
    return;
  }
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }
  // Kroppens två former ägs av validateOverrideDraft i src/core/item.js. Det här
  // lagret läser varken skipped eller amountSek själv.
  const result = validateOverrideDraft(body);
  if (!result.ok) {
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }
  let changed;
  try {
    // Beslutet "finns mallen?" fattas av SQL:s WHERE med user_id = ?, inte av en
    // läsning före: en mall som tillhör någon annan matchar då ingen rad, och
    // svaret blir detsamma som för ett id som aldrig funnits.
    changed = result.value.skipped
      ? skipMonth(userId, templateId, month, { now })
      : setOverride(userId, templateId, month, result.value.amountOre, { now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  if (!changed) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }
  let result2;
  try {
    result2 = readMonth(userId, month);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  // Samma tre fält som GET /api/manad/<ÅÅÅÅ-MM> ger. Formen ska vara densamma,
  // så att gränssnittet kan rita om hela vyn ur svaret utan en andra hämtning —
  // och en avvikelse ändrar månadens utgifter, alltså också spentOre och leftOre
  // i varje tak.
  sendJson(res, 200, { items: result2.items, totals: result2.totals, budgets: result2.budgets });
}

// 401 med rensad cookie. En session som saknas, är återkallad eller har gått ut
// ska inte skickas tillbaka vid nästa anrop. Ägaren till svaret: det stod
// skrivet för hand i handleMe fram till etapp 3, och månadens vägar behöver
// samma svar.
function sendUnauthorized(res, message) {
  const text = JSON.stringify({ error: message });
  res.writeHead(401, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Set-Cookie': clearedSessionCookie()
  });
  res.end(text);
}

async function handleList(res) {
  let entries;
  try {
    // GET läser bara och använder loadEntries; updateEntries är för de två
    // vägar som ändrar filen.
    entries = await loadEntries();
  } catch (error) {
    // storage.js kastar bara StorageError, och dess .message är svensk text
    // avsedd att visas för användaren.
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 200, { entries });
}

async function handleCreate(req, res) {
  const draft = parseBody(await readBody(req));
  if (draft === UNPARSABLE) {
    sendJson(res, 400, { error: UNPARSABLE_MESSAGE });
    return;
  }

  // draft skickas orört vidare. Allt som inte är ett vanligt objekt — null, en
  // array, en sträng — hanteras av validateEntryDraft och ger fältfel.
  //
  // createEntry anropas före updateEntries, aldrig inuti mutera: ett
  // valideringsfel ska ge 400 utan att någon köplats tas i anspråk, precis som
  // skrivvägens rad 1-3 avvisar utan att röra disken.
  const result = createEntry(draft);
  if (!result.ok) {
    // Statuskoden avgörs av felets ursprung, inte av returtypen. Ett fel med
    // field: 'id' kan bara orsakas av ett programmeringsmisstag i appen, aldrig
    // av användarens anrop: 500, och utan fieldErrors — 'id' finns inte i
    // formuläret och skulle bli osynligt som fältfel. fieldErrors bär därmed
    // alltid bara de fem formulärfälten, vilket app.js showErrors bygger på.
    const internal = result.errors.find((error) => error.field === 'id');
    if (internal !== undefined) {
      sendJson(res, 500, { error: internal.message });
      return;
    }
    sendJson(res, 400, { error: result.errors[0].message, fieldErrors: result.errors });
    return;
  }

  try {
    // Ett enda anrop, aldrig loadEntries följt av saveEntries: läsningen och
    // skrivningen ska ligga i samma köplats, annars tappar två överlappande
    // POST varandras post.
    await updateEntries((entries) => [...entries, result.value]);
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  sendJson(res, 201, { entry: result.value });
}

async function handleDelete(res, id) {
  let remaining;
  try {
    // Beslutet "finns posten?" fattas inuti köplatsen, av mutera, och inte av
    // en läsning före den: två samtidiga DELETE av samma id ger då exakt ett
    // 204 och exakt ett 404. mutera kastar aldrig och svarar null för
    // "skriv inte".
    remaining = await updateEntries((entries) => {
      const kept = entries.filter((entry) => entry.id !== id);
      return kept.length === entries.length ? null : kept;
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (remaining === null) {
    sendJson(res, 404, { error: MESSAGES.entryNotFound });
    return;
  }

  res.writeHead(204);
  res.end();
}

// POST /api/auth/kod. Svarar alltid 202 när ingen spärr slår till, oavsett om
// adressen har ett konto: att begära en kod får inte avslöja om kontot finns.
// Statuskoderna är de fyra på vägens rad i HTTP-API-tabellen och inga andra —
// 202, 400 rad 1, 429 rad 8 eller 9, och 500 rad 10 om utskicket misslyckas.
async function handleRequestCode(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: AUTH_MESSAGES.invalidEmail });
    return;
  }

  let result;
  try {
    result = await requestCode(getDatabase(), {
      email: body?.email,
      ip: clientIp(req),
      now
    });
  } catch (error) {
    // db.js och auth.js kastar bara DatabaseError, och dess .message är svensk
    // text avsedd att visas för användaren — samma väg som StorageError.
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (result.status === 202) {
    res.writeHead(202);
    res.end();
    return;
  }
  sendJson(res, result.status, { error: result.message });
}

// POST /api/auth/logga-in. 204 med sessionscookie, 400 rad 1, 2, 3, 5, 6 eller
// 7, och 429 rad 4.
async function handleLogin(req, res, now) {
  const body = parseBody(await readBody(req));
  if (body === UNPARSABLE) {
    sendJson(res, 400, { error: AUTH_MESSAGES.invalidEmail });
    return;
  }

  let result;
  try {
    result = verifyCode(getDatabase(), {
      email: body?.email,
      code: body?.code,
      now
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (result.status !== 204) {
    sendJson(res, result.status, { error: result.message });
    return;
  }

  res.writeHead(204, { 'Set-Cookie': sessionCookie(result.token) });
  res.end();
}

// POST /api/auth/logga-ut. Svarar 204 även utan giltig session: utloggning ska
// aldrig misslyckas. Cookien rensas i samma svar.
function handleLogout(req, res, now) {
  try {
    logOut(getDatabase(), { token: readSessionToken(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }
  res.writeHead(204, { 'Set-Cookie': clearedSessionCookie() });
  res.end();
}

// GET /api/mig. 200 med e-postadressen, 401 om inte inloggad. Vägen går genom
// requireSession, som är den enda spärren — user_id kommer ur sessionen och
// aldrig ur anropet.
function handleMe(req, res, now) {
  let guard;
  try {
    guard = requireSession(getDatabase(), { token: readSessionToken(req), now });
  } catch (error) {
    sendJson(res, 500, { error: error.message });
    return;
  }

  if (guard.unauthorized === true) {
    // Cookien rensas i samma svar, av ägaren till 401-svaret nedan.
    sendUnauthorized(res, guard.message);
    return;
  }

  sendJson(res, 200, { email: guard.session.email });
}
