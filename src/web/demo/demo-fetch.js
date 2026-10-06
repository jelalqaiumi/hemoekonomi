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
import { monthTotals } from '../../core/budget.js';
import { compareMonths, firstDayOfMonth, isValidIsoMonth, monthOfIsoDate, shiftMonth, todayIso } from '../../core/dates.js';
import { ITEM_KINDS, validateMonthItemDraft, validateOverrideDraft, validateTemplateDraft } from '../../core/item.js';
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
export const SERVER_TEXTS = Object.freeze({
  notLoggedIn: 'Du är inte inloggad.',
  unknownCode: 'Koden stämmer inte. Begär en ny kod och försök igen.',
  entryNotFound: 'Posten finns inte.',
  invalidMonth: 'Månaden måste anges som ÅÅÅÅ-MM.',
  unknownPath: 'Okänd adress.',
  methodNotAllowed: 'Metoden stöds inte.'
});

// Vägarna, med samma adresser som src/server/api.js.
const AUTH_CODE_PATH = '/api/auth/kod';
const AUTH_LOGIN_PATH = '/api/auth/logga-in';
const AUTH_LOGOUT_PATH = '/api/auth/logga-ut';
const ME_PATH = '/api/mig';
const API_PREFIX = '/api/';
const MONTH_PATH_PREFIX = '/api/manad/';
const ITEM_PATH_PREFIX = '/api/poster/';
const TEMPLATE_PATH_PREFIX = '/api/mallar/';
const ITEM_MONTH_SEGMENT = 'manad';

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
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false
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
      dueDate,
      recurring: true,
      seriesId: template.seriesId,
      overridden
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
  return { items, totals: monthTotals(items) };
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
        return svar(200, { items: result.items, totals: result.totals });
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
        category: result.value.category
      };
      state.monthItems.push(row);
      return sparaOch(svar(201, { item: toMonthItem(row) }));
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
