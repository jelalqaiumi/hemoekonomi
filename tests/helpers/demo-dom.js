// DOM- och lagringsattrapper för src/web/demo/.
//
// Filen är mätapparaten för tests/demo.test.js och för tests/priser.test.js
// genom tests/helpers/landning-dom.js, och är därför incheckad, aldrig
// en engångskörning: en attrapp som kastas bort gör mätningen omöjlig att göra
// om (LARDOMAR.md 2026-09-07).
//
// Attrappen är avsiktligt liten. Den är inte DOM-attrappen i
// tests/helpers/dom.js och ska inte vara det: den filen bygger exakt de id:n
// index.html skriver, åt app.js, och ett tillägg där hade mätt något annat.
// Den här attrappen behöver head, body och ett uppslag på id, och ingenting mer
// — det är allt banner.js rör.
import assert from 'node:assert/strict';

// Elementattrappen. Exporterad därför att tests/helpers/landning-dom.js bygger
// prissidans dokument på samma klass: ett andra, nästan likadant element är två
// ägare till samma rader (LARDOMAR.md 2026-09-02).
export class DemoElement {
  constructor(tagName) {
    this.tagName = tagName;
    this.id = '';
    this.className = '';
    this.textContent = '';
    this.type = '';
    this.rel = '';
    this.href = '';
    this.hidden = false;
    this.children = [];
    this.listeners = new Map();
  }

  append(...nodes) {
    this.children.push(...nodes);
  }

  prepend(...nodes) {
    this.children.unshift(...nodes);
  }

  // Samma semantik som i webbläsaren: de gamla barnen ersätts, inte utökas. En
  // renderingsfunktion som anropas två gånger ska inte dubblera sin lista.
  replaceChildren(...nodes) {
    this.children = [...nodes];
  }

  addEventListener(type, listener) {
    const lista = this.listeners.get(type) ?? [];
    lista.push(listener);
    this.listeners.set(type, lista);
  }

  // Testets sida av händelsen. Namnet är inte dispatchEvent: attrappen har inga
  // Event-objekt och ska inte se ut som om den hade det. Samma form som utlos i
  // tests/helpers/dom.js.
  utlos(type) {
    const lista = this.listeners.get(type) ?? [];
    assert.notEqual(lista.length, 0, `ingen ${type}-lyssnare på ${this.tagName}.${this.className}`);
    for (const listener of lista) {
      listener({});
    }
  }

  // Alla ättlingar, i dokumentordning.
  attlingar() {
    const alla = [];
    for (const barn of this.children) {
      alla.push(barn, ...barn.attlingar());
    }
    return alla;
  }
}

// Ett dokument med head och body. loginStepEmail styr om attrappen har
// inloggningsvyns första steg: index.html har det, landningssidan inte, och
// banner.js lägger knappen "Logga in som demoanvändare" bara när elementet
// finns.
export function createDemoDom({ loginStepEmail = true } = {}) {
  const head = new DemoElement('head');
  const body = new DemoElement('body');
  const registry = new Map();

  if (loginStepEmail) {
    const steg = new DemoElement('div');
    steg.id = 'login-step-email';
    body.append(steg);
    registry.set('login-step-email', steg);
  }

  const document = {
    head,
    body,
    createElement(tagName) {
      return new DemoElement(tagName);
    },
    querySelector(selector) {
      assert.equal(
        selector.startsWith('#'),
        true,
        `demo-attrappen stöder inte selektorn ${selector}`
      );
      return registry.get(selector.slice(1)) ?? null;
    }
  };

  return {
    document,
    head,
    body,
    // Första elementet med klassnamnet, någonstans i body. Klassnamnet jämförs
    // ord för ord: banner.js skriver flera klasser på samma element.
    medKlass: (className) =>
      body
        .attlingar()
        .find((element) => element.className.split(' ').includes(className)) ?? null,
    alla: (className) =>
      body.attlingar().filter((element) => element.className.split(' ').includes(className))
  };
}

// En localStorage som fungerar. Minnet ligger i en Map, och nycklarna är
// strängar precis som i webbläsaren.
export function createStorage() {
  const minne = new Map();
  return {
    getItem: (key) => (minne.has(key) ? minne.get(key) : null),
    setItem: (key, value) => {
      minne.set(key, String(value));
    },
    removeItem: (key) => {
      minne.delete(key);
    },
    // Testets egen väg in i minnet, inte en del av Storage-gränssnittet.
    raknaNycklar: () => minne.size
  };
}

// En localStorage som kastar vid varje anrop — privat läge, lagring blockerad.
// (D8) prövar att demon fungerar ändå.
export function createThrowingStorage() {
  const kasta = () => {
    throw new Error('lagring blockerad');
  };
  return { getItem: kasta, setItem: kasta, removeItem: kasta };
}
