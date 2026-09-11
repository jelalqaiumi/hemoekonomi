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

const APP_PATH = fileURLToPath(new URL('../../src/web/app.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../../src/web/index.html', import.meta.url));
// Webbläsaren hämtar src/core/ under /core/; i en Node-körning finns ingen
// server, så specifikationerna pekas om till filerna på disk.
const CORE_DIR = new URL('../../src/core/', import.meta.url).href;
const CORE_SPECIFIER = "'/core/";

class FakeElement {
  constructor(tagName, id = '') {
    this.tagName = tagName;
    this.id = id;
    this.className = '';
    this.textContent = '';
    this.value = '';
    this.type = '';
    this.disabled = false;
    this.children = [];
    this.listeners = new Map();
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

// De fem fälten i formuläret, i samma ordning som index.html.
const FALT = Object.freeze([
  { name: 'name', tagName: 'input' },
  { name: 'amountSek', tagName: 'input' },
  { name: 'interval', tagName: 'select' },
  { name: 'startDate', tagName: 'input' },
  { name: 'category', tagName: 'select' }
]);

// Bygger samma id:n som index.html. Testet jämför de två listorna, så en ny rad
// i index.html som attrappen saknar fälls av tests/app.test.js.
export function createDom() {
  const form = new FakeForm('entry-form');
  const registry = new Map([['entry-form', form]]);

  for (const { name, tagName } of FALT) {
    const falt = new FakeElement(tagName, name);
    const fel = new FakeElement('p', `error-${name}`);
    fel.className = 'field-error';
    form.append(falt, fel);
    form.registrera(name, falt);
    registry.set(name, falt);
    registry.set(`error-${name}`, fel);
  }

  const formError = new FakeElement('p', 'form-error');
  formError.className = 'form-error';
  form.append(formError);
  registry.set('form-error', formError);

  const submit = new FakeElement('button', '');
  submit.type = 'submit';
  submit.textContent = 'Spara';
  form.append(submit);

  const list = new FakeElement('ul', 'entry-list');
  registry.set('entry-list', list);

  // Paket 6: tomläget och totalrutans två beloppselement. Hela utökningen av
  // attrappen är tre FakeElement till under just de id:n — ingen ny metod och
  // ingen ny egenskap. Elementen slås upp med falt(), som bara är ett uppslag i
  // registret.
  const emptyState = new FakeElement('p', 'empty-state');
  emptyState.className = 'empty-state';
  registry.set('empty-state', emptyState);

  const totalMonthly = new FakeElement('span', 'total-monthly');
  totalMonthly.className = 'total-amount';
  registry.set('total-monthly', totalMonthly);

  const totalYearly = new FakeElement('span', 'total-yearly');
  totalYearly.className = 'total-amount';
  registry.set('total-yearly', totalYearly);

  const document = {
    querySelector(selector) {
      assert.equal(selector.startsWith('#'), true, `DOM-attrappen stöder inte selektorn ${selector}`);
      return registry.get(selector.slice(1)) ?? null;
    },
    createElement(tagName) {
      return new FakeElement(tagName, '');
    }
  };

  return {
    document,
    form,
    list,
    formError,
    submit,
    ids: [...registry.keys()].sort(),
    falt: (name) => registry.get(name),
    faltfel: (name) => registry.get(`error-${name}`).textContent,
    // Ta bort-knapparna i listan, en per post och i listans ordning.
    taBortKnappar: () => list.children.map((rad) => rad.querySelector('button[type="button"]')),
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
// document och fetch satta på globalThis. Källan läses från disk vid varje
// anrop, så en ändring i filen — också ett syntaxfel — når den här körningen.
export async function loadApp(t, { document, fetch }) {
  const kalla = await fs.readFile(APP_PATH, 'utf8');
  const antal = kalla.split(CORE_SPECIFIER).length - 1;
  assert.notEqual(
    antal,
    0,
    `src/web/app.js importerar inte längre något under ${CORE_SPECIFIER}… — ompekningen träffar ingenting`
  );
  // Ett unikt tillägg per anrop: två identiska data:-adresser är samma modul för
  // laddaren, och app.js har modullokalt tillstånd som inte får följa med till
  // nästa fall.
  const omskriven = `${kalla.replaceAll(CORE_SPECIFIER, `'${CORE_DIR}`)}\n// ${randomUUID()}\n`;

  const tidigareDocument = globalThis.document;
  const tidigareFetch = globalThis.fetch;
  t.after(() => {
    globalThis.document = tidigareDocument;
    globalThis.fetch = tidigareFetch;
  });
  globalThis.document = document;
  globalThis.fetch = fetch;

  const url = `data:text/javascript;base64,${Buffer.from(omskriven, 'utf8').toString('base64')}`;
  return import(url);
}
