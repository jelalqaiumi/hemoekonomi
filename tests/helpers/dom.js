// DOM-attrapp och laddare för src/web/app.js.
//
// Filen är mätapparaten för tests/app.test.js och är därför incheckad, aldrig en
// engångskörning i en temporärkatalog: en attrapp som kastas bort gör mätningen
// omöjlig att göra om (LARDOMAR.md 2026-09-07, src/web/app.js kan göras
// syntaktiskt trasig utan att npm test faller).
//
// Attrappen är avsiktligt liten och sträng: en selektor eller ett element den
// inte känner till ger ett kast och aldrig null. En attrapp som svarar null på
// något den inte förstår låter app.js gå sönder tyst, och då mäter testet
// ingenting.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import { setFrozenDay, snapshotFrozenDay } from './frozen-dates.js';

const APP_PATH = fileURLToPath(new URL('../../src/web/app.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../../src/web/index.html', import.meta.url));
// Webbläsaren hämtar src/core/ under /core/; i en Node-körning finns ingen
// server, så specifikationerna pekas om till filerna på disk.
const CORE_DIR = new URL('../../src/core/', import.meta.url).href;
const CORE_SPECIFIER = "'/core/";
// Den modul app.js läser dagens datum ur. Adressen byggs ur import.meta.url och
// aldrig ur process.cwd() (LARDOMAR.md 2026-09-04), och ompekningen görs efter
// den allmänna /core/-ompekningen ovan — specifikationen är då redan en
// file:-adress.
const CORE_DAY_SPECIFIER = `'${CORE_DIR}dates.js'`;
const FROZEN_DAY_SPECIFIER = `'${new URL('./frozen-dates.js', import.meta.url).href}'`;

// Om en instans av src/web/app.js lever just nu. Villkoret är högst en levande
// instans åt gången, i hela processen (ARKITEKTUR.md, krav 8): två
// modulinstanser delar globalThis.fetch och laddarens dag, så den andra skriver
// över den förstas omvärld medan båda lever vidare med var sin lyssnare på
// attrappens element. node:test kör dessutom after-hookar i
// registreringsordning, så den sist registrerade hooken lägger tillbaka en
// ögonblicksbild som redan var det första anropets värde — och då återställs
// ingenting.
//
// Flaggan nycklas på processen och inte på testkontexten. Den tidigare lydelsen
// höll en WeakSet över de testkontexter som redan laddat, och ett underordnat
// test har en egen kontext: granskarens körning visade att ett loadApp inuti ett
// t.test passerade spärren, att båda instanserna levde samtidigt och att
// förälderns formulärsubmit hamnade i barnets fetch-attrapp (LARDOMAR.md
// 2026-09-22). Villkoret är därför skrivet om det som är farligt — två levande
// instanser — och inte om den nyckel som råkade ligga närmast.
let appLaddad = false;

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    // Kryssrutan Återkommande bär sitt värde i checked och inte i value, precis
    // som i webbläsaren: app.js läser .checked och sätter den själv i varje
    // formulärläge.
    this.checked = false;
    // hidden och title är egenskaper app.js sätter: hidden byter vy och döljer
    // formuläret, title bär texten på märket för en återkommande post.
    this.hidden = false;
    this.title = '';
    this.children = [];
    this.listeners = new Map();
    this.attributes = new Map();
  }

  // Attributen diagrammets SVG behöver. Ett attribut är inte en egenskap: role,
  // viewBox och width finns bara som attribut i en SVG, och attrappen håller dem
  // därför åtskilda från textContent och className.
  setAttribute(name, value) {
    this.attributes.set(name, value);
  }

  getAttribute(name) {
    return this.attributes.has(name) ? this.attributes.get(name) : null;
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(type, listener) {
    const lista = this.listeners.get(type) ?? [];
    lista.push(listener);
    this.listeners.set(type, lista);
  }

  // Testets sida av händelsen. Namnet är inte dispatchEvent: attrappen har inga
  // Event-objekt och ska inte se ut som om den hade det.
  //
  // Ett avstängt element får inget klick. Det är webbläsarens beteende och inte
  // en förenkling: app.js egen kommentar bygger på det ("webbläsaren skickar
  // inget klick till en avstängd knapp"), och en attrapp som ändå kallar
  // lyssnaren skulle pröva en händelse som aldrig inträffar. Submit går däremot
  // fram oavsett — en submit-händelse behöver inte komma från knappen, och det
  // är därför app.js har ett eget pågående-läge.
  utlos(type, event = {}) {
    const lista = this.listeners.get(type) ?? [];
    assert.notEqual(lista.length, 0, `ingen ${type}-lyssnare på #${this.id || this.tagName}`);
    if (type === 'click' && this.disabled) {
      return false;
    }
    for (const listener of lista) {
      listener(event);
    }
    return true;
  }

  // Alla ättlingar, i dokumentordning.
  attlingar() {
    const alla = [];
    for (const barn of this.children) {
      alla.push(barn, ...barn.attlingar());
    }
    return alla;
  }

  querySelector(selector) {
    if (selector.startsWith('#')) {
      const id = selector.slice(1);
      return this.attlingar().find((element) => element.id === id) ?? null;
    }
    const attribut = /^([a-z]+)\[type="([a-z]+)"\]$/.exec(selector);
    if (attribut !== null) {
      const [, tagName, type] = attribut;
      return this.attlingar().find(
        (element) => element.tagName === tagName && element.type === type
      ) ?? null;
    }
    throw new Error(`DOM-attrappen stöder inte selektorn ${selector}`);
  }
}

// Formuläret, med elements och reset. Båda används av app.js.
class FakeForm extends FakeElement {
  constructor(id) {
    super('form', id);
    this.elements = Object.create(null);
    this.resetAnrop = 0;
  }

  registrera(name, element) {
    this.elements[name] = element;
  }

  reset() {
    this.resetAnrop += 1;
    for (const element of Object.values(this.elements)) {
      element.value = '';
    }
  }
}

// De tre fälten i formuläret. Fältets id i index.html och namnet app.js läser ur
// FORM.elements är inte samma sträng — beloppet har id item-amount och namnet
// amountSek — så attrappen registrerar båda, och felrutans id följer namnet,
// precis som index.html skriver det.
const FALT = Object.freeze([
  { name: 'name', id: 'item-name', tagName: 'input' },
  { name: 'amountSek', id: 'item-amount', tagName: 'input' },
  { name: 'category', id: 'item-category', tagName: 'select' }
]);

// De två fälten kryssrutan Återkommande öppnar [etapp 4]. De ligger i
// #recurring-fields, som app.js döljer och visar, och är registrerade i
// formulärets elements precis som de tre ovan — FORM.reset() nollställer dem,
// så att ett värde från en tidigare post inte följer med till nästa sparning.
const ATERKOMMANDE_FALT = Object.freeze([
  { name: 'interval', id: 'item-interval', tagName: 'select' },
  { name: 'toMonth', id: 'item-to-month', tagName: 'input' }
]);

// De tre listorna, i index.html:s ordning. Varje slag ger tre id:n: knappen som
// öppnar formuläret, listan och tomtexten.
const LISTOR = Object.freeze(['income', 'expense', 'saving']);

// Bygger samma id:n som index.html. Testet jämför de två listorna, så ett nytt id
// i index.html som attrappen saknar fälls av tests/app.test.js.
export function createDom() {
  const registry = new Map();

  const skapa = (tagName, id, egenskaper = {}) => {
    const element = new FakeElement(tagName, id);
    Object.assign(element, egenskaper);
    registry.set(id, element);
    return element;
  };

  // Inloggningsvyn. Steg två bär hidden från början, precis som index.html
  // skriver attributet; app.js byter det när koden är skickad.
  const loginView = skapa('section', 'login-view');
  const stepEmail = skapa('div', 'login-step-email');
  stepEmail.append(
    skapa('input', 'login-email', { type: 'email' }),
    skapa('button', 'send-code', { type: 'button', textContent: 'Skicka kod' })
  );
  const stepCode = skapa('div', 'login-step-code', { hidden: true });
  stepCode.append(
    skapa('p', 'code-sent', { className: 'lead' }),
    skapa('input', 'login-code', { type: 'text' }),
    skapa('button', 'log-in', { type: 'button', textContent: 'Logga in' }),
    skapa('button', 'use-other-email', { type: 'button', textContent: 'Använd en annan adress' })
  );
  loginView.append(stepEmail, stepCode, skapa('p', 'login-error', { className: 'form-error' }));

  // Månadsvyn, dold från början: vilken vy som syns avgörs av GET /api/mig.
  const monthView = skapa('section', 'month-view', { hidden: true });
  monthView.append(
    skapa('span', 'user-email'),
    skapa('button', 'log-out', { type: 'button', textContent: 'Logga ut' }),
    skapa('button', 'month-prev', { type: 'button', textContent: 'Föregående' }),
    skapa('h2', 'month-label'),
    skapa('button', 'month-next', { type: 'button', textContent: 'Nästa' }),
    skapa('span', 'total-income', { className: 'summary-amount' }),
    skapa('span', 'total-expense', { className: 'summary-amount' }),
    skapa('span', 'total-saving', { className: 'summary-amount' }),
    skapa('span', 'total-left', { className: 'summary-amount' })
  );

  // Formuläret öppnas av en knapp och är dolt från början.
  const formCard = skapa('section', 'item-form-card', { hidden: true });
  const form = new FakeForm('item-form');
  registry.set('item-form', form);
  // Raden som säger vad läget Bara <månad> ändrar, dold från början precis som
  // index.html skriver attributet.
  form.append(skapa('p', 'month-only-note', { className: 'lead', hidden: true }));
  // Namn och kategori ligger i ett fältblock med eget id: app.js döljer blocken
  // i läget Bara <månad>, där beloppet är det enda som går att ändra. Beloppet
  // har därför inget block — det döljs aldrig.
  const faltblock = Object.freeze({ name: 'name-field', category: 'category-field' });
  for (const { name, id, tagName } of FALT) {
    const falt = skapa(tagName, id);
    const fel = skapa('p', `error-${name}`, { className: 'field-error' });
    if (Object.hasOwn(faltblock, name)) {
      const block = skapa('div', faltblock[name], { className: 'field' });
      block.append(falt, fel);
      form.append(block);
    } else {
      form.append(falt, fel);
    }
    form.registrera(name, falt);
  }
  // Kryssrutan Återkommande och de två fälten den öppnar. Rutan ligger utanför
  // #recurring-fields: den syns alltid, och det är den som öppnar blocket.
  const recurringField = skapa('div', 'recurring-field', { className: 'field field-checkbox' });
  recurringField.append(skapa('input', 'item-recurring', { type: 'checkbox' }));
  form.append(recurringField);
  const recurringFields = skapa('div', 'recurring-fields', { hidden: true });
  for (const { name, id, tagName } of ATERKOMMANDE_FALT) {
    const falt = skapa(tagName, id);
    const fel = skapa('p', `error-${name}`, { className: 'field-error' });
    recurringFields.append(falt, fel);
    form.registrera(name, falt);
  }
  form.append(recurringFields);
  form.append(
    skapa('p', 'item-form-error', { className: 'form-error' }),
    skapa('button', 'item-submit', { type: 'submit', textContent: 'Spara' }),
    skapa('button', 'item-cancel', { type: 'button', textContent: 'Avbryt' })
  );
  formCard.append(form);
  monthView.append(formCard);

  for (const slag of LISTOR) {
    monthView.append(
      skapa('button', `add-${slag}`, { type: 'button', className: 'add' }),
      skapa('ul', `${slag}-list`, { className: 'item-list' }),
      skapa('p', `${slag}-empty`, { className: 'empty-state' })
    );
  }

  monthView.append(
    skapa('div', 'chart', { className: 'chart' }),
    skapa('p', 'chart-empty', { className: 'empty-state' }),
    skapa('p', 'month-error', { className: 'form-error' })
  );

  const document = {
    querySelector(selector) {
      assert.equal(selector.startsWith('#'), true, `DOM-attrappen stöder inte selektorn ${selector}`);
      return registry.get(selector.slice(1)) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName, '');
    },
    // Diagrammet byggs med createElementNS: document.createElement('svg') ger i
    // webbläsaren ett HTML-element som inte ritas som en SVG, så namnrymden är
    // inget pynt. Attrappen sparar den, så att ett testfall kan pröva att den är
    // satt.
    createElementNS(namespace, tagName) {
      const element = new FakeElement(tagName, '');
      element.namespace = namespace;
      return element;
    }
  };

  return {
    document,
    form,
    loginView,
    monthView,
    ids: [...registry.keys()].sort(),
    // Uppslag på id. Namnet är kvar från den gamla vyn, där varje uppslag var ett
    // formulärfält; funktionen har alltid bara varit ett uppslag i registret.
    falt: (id) => registry.get(id),
    faltfel: (field) => registry.get(`error-${field}`).textContent,
    // Raderna i en lista, i listans ordning.
    rader: (id) => registry.get(id).children,
    text: (element) => element.textContent
  };
}

// Id:n som index.html själv skriver ut. Attrappen ska ha exakt dessa.
export async function idsFranIndexHtml() {
  const html = await fs.readFile(INDEX_PATH, 'utf8');
  return [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]).sort();
}

// fetch-attrappen. Varje anrop registreras med metod, sökväg och kropp. Svaret
// bestäms av planen: ger den ett svar besvaras anropet med en gång, ger den null
// lämnas löftet hängande tills testet självt anropar anrop.svara eller
// anrop.kasta. Ingen tidsgräns och ingen timer behövs — allt är löften i samma
// process, och testet driver dem.
export function createFetch(plan) {
  const anrop = [];

  const svarsobjekt = (svar) => ({
    status: svar.status,
    json: async () => {
      if (svar.json === undefined) {
        // Ett svar utan läsbar JSON-kropp: response.json() avvisar, precis som i
        // webbläsaren.
        throw new SyntaxError('Unexpected token in JSON');
      }
      return svar.json;
    }
  });

  const fetchAttrapp = (url, init = {}) => {
    const post = {
      url,
      method: init.method ?? 'GET',
      body: init.body,
      svara: null,
      kasta: null
    };
    anrop.push(post);

    const svar = plan(post, anrop.length - 1);
    if (svar === null) {
      return new Promise((resolve, reject) => {
        post.svara = (senare) => resolve(svarsobjekt(senare));
        post.kasta = reject;
      });
    }
    if (svar instanceof Error) {
      return Promise.reject(svar);
    }
    return Promise.resolve(svarsobjekt(svar));
  };

  return { fetch: fetchAttrapp, anrop };
}

// Flödar ut alla väntande mikrotasker. Allt app.js gör i ett test är löften utan
// I/O, så ett bestämt antal varv räcker och ingen tidsgräns behövs.
export async function flush(varv = 50) {
  for (let i = 0; i < varv; i += 1) {
    await Promise.resolve();
  }
}

// Laddar src/web/app.js med /core/-specifikationerna ompekade mot src/core/ och
// document, fetch och dagens datum satta av laddaren. Källan läses från disk vid
// varje anrop, så en ändring i filen — också ett syntaxfel — når den här
// körningen.
//
// idag är en sträng på formen ÅÅÅÅ-MM-DD. Laddaren äger dagen precis som den
// äger document och fetch: app.js läser den själv vid varje rendering, och en
// attrapp utan ställbar dag kan varken pröva en annan dag än den som råkar vara
// i dag eller undgå att bli röd när dygnet byts mitt i ett prov (ARKITEKTUR.md,
// "Klockan som app.js läser är injicerad, inte verklig").
//
// Returvärdet bär modulen och bytDag, den väg ett testfall sätter en annan dag
// mitt i ett fall utan att självt importera hjälpfilen.
export async function loadApp(t, { document, fetch, idag }) {
  // Prövas innan något tillstånd rörs: varken globalThis, laddarens dag eller
  // en after-hook får hinna ändras av ett anrop som ska avvisas.
  if (appLaddad) {
    throw new Error(
      'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.'
    );
  }

  const kalla = await fs.readFile(APP_PATH, 'utf8');
  const antal = kalla.split(CORE_SPECIFIER).length - 1;
  assert.notEqual(
    antal,
    0,
    `src/web/app.js importerar inte längre något under ${CORE_SPECIFIER}… — ompekningen träffar ingenting`
  );

  const medCore = kalla.replaceAll(CORE_SPECIFIER, `'${CORE_DIR}`);
  // Exakt ett utbyte, inte minst ett: slutar app.js läsa dagens datum ur
  // /core/dates.js ska laddningen falla i stället för att tyst sluta mäta —
  // samma skäl som assertionen ovan.
  const antalDagar = medCore.split(CORE_DAY_SPECIFIER).length - 1;
  assert.equal(
    antalDagar,
    1,
    `src/web/app.js ska importera dagens datum från /core/dates.js på exakt ett ställe, hittade ${antalDagar}`
  );

  // Ett unikt tillägg per anrop: två identiska data:-adresser är samma modul för
  // laddaren, och app.js har modullokalt tillstånd som inte får följa med till
  // nästa fall.
  const omskriven = `${medCore.replaceAll(CORE_DAY_SPECIFIER, FROZEN_DAY_SPECIFIER)}\n// ${randomUUID()}\n`;

  const tidigareDocument = globalThis.document;
  const tidigareFetch = globalThis.fetch;
  const aterstallDag = snapshotFrozenDay();
  // Ordningen är bindande (ARKITEKTUR.md, krav 8): flaggan prövas först, hooken
  // registreras därefter, och flaggan sätts sist. En flagga som sätts före
  // hooken blir kvar när import() avvisar — och det gör den så snart app.js har
  // ett syntaxfel, varpå resten av filen låses av en spärr som ingen hook kan
  // nollställa. Hooken är därför registrerad före importen.
  t.after(() => {
    appLaddad = false;
    globalThis.document = tidigareDocument;
    globalThis.fetch = tidigareFetch;
    aterstallDag();
  });
  appLaddad = true;
  globalThis.document = document;
  globalThis.fetch = fetch;
  // Dagen sätts före importen: app.js har ett await på toppnivå som renderar
  // kortet redan under laddningen.
  setFrozenDay(idag);

  const url = `data:text/javascript;base64,${Buffer.from(omskriven, 'utf8').toString('base64')}`;
  const modul = await import(url);
  return { modul, bytDag: setFrozenDay };
}
