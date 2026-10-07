// DOM-attrapp för landningssidan, åt tests/priser.test.js.
//
// Filen är mätapparat och är därför incheckad, aldrig en engångskörning: en
// attrapp som kastas bort gör mätningen omöjlig att göra om (LARDOMAR.md
// 2026-09-07).
//
// Elementet är DemoElement i tests/helpers/demo-dom.js och ingen egen kopia.
// Attrappen behöver bara ett uppslag på id och ett createElement — det är allt
// src/web/priser.js rör.
import assert from 'node:assert/strict';

import { DemoElement } from './demo-dom.js';

// Listan prissidans kort hamnar i. medLista styr om elementet finns:
// landning.html har #pris-lista, index.html har det inte, och priser.js ska då
// inte göra någonting.
export function createLandningDom({ medLista = true } = {}) {
  const registry = new Map();
  let list = null;

  if (medLista) {
    list = new DemoElement('ul');
    list.id = 'pris-lista';
    list.className = 'pris-lista';
    registry.set('pris-lista', list);
  }

  const document = {
    createElement(tagName) {
      return new DemoElement(tagName);
    },
    querySelector(selector) {
      assert.equal(
        selector.startsWith('#'),
        true,
        `landningsattrappen stöder inte selektorn ${selector}`
      );
      return registry.get(selector.slice(1)) ?? null;
    }
  };

  return { document, list };
}
