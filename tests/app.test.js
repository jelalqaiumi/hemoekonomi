// Paket 5: src/web/app.js körd mot en incheckad DOM-attrapp.
//
// Före den här filen hade hela det användarvända lagret noll körd täckning:
// mutationen "ett namn som inte finns plus const trasig = ( ;" gav
// tests 241, pass 241, fail 0 och EXIT=0, eftersom de två tester som rör app.js
// hämtar filen över HTTP och jämför byte mot byte med disken — vilket innehåll
// som helst passerade (LARDOMAR.md 2026-09-07).
//
// Ingen webbläsarautomatisering införs. Filen laddas som modul med
// /core/-specifikationerna ompekade mot src/core/, och attrappen ligger i
// tests/helpers/dom.js så att varje körning går att göra om.
//
// Ingen tidsgräns och ingen timer: allt app.js gör här är löften utan I/O, och
// testet driver dem själv med flush(). fetch-attrappen registrerar sitt anrop
// synkront, så ett uteblivet anrop ger ett fallerat test och aldrig en väntan.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { CATEGORY_LABELS, INTERVAL_LABELS } from '../src/core/entry.js';
import { formatSek, sekToOre } from '../src/core/money.js';
import { createDom, createFetch, flush, idsFranIndexHtml, loadApp } from './helpers/dom.js';

// Enda strängen i app.js som varken kommer från servern eller från src/core/.
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';

const POST_ETT = Object.freeze({
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Hyra',
  amountSek: 1234.5,
  interval: 'monthly',
  startDate: '2026-01-25',
  category: 'housing'
});

const POST_TVA = Object.freeze({
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Strömmen',
  amountSek: 429,
  interval: 'quarterly',
  startDate: '2026-02-01',
  category: 'utilities'
});

const TOMT_SVAR = Object.freeze({ status: 200, json: { entries: [] } });

// Startar app.js med en plan för fetch-attrappen och lämnar tillbaka både
// attrappen och anropslistan.
async function starta(t, plan) {
  const dom = createDom();
  // Det första anropet måste besvaras med en gång: app.js har ett await på
  // toppnivå, så modulen laddas inte färdigt förrän listan är hämtad. En plan
  // som lämnar just det anropet hängande skulle ge en väntan utan exitkod, och
  // en hängning är sämre än ett fel — därför blir ett hängande första anrop ett
  // avvisat fetch i stället, och fallet faller på sin egen assertion.
  const forstaSvaretMasteKomma = (post, index) => {
    const svar = plan(post, index);
    if (index === 0 && svar === null) {
      return new Error('planen lämnade app.js första anrop hängande');
    }
    return svar;
  };
  const { fetch, anrop } = createFetch(forstaSvaretMasteKomma);
  await loadApp(t, { document: dom.document, fetch });
  return { dom, anrop };
}

// En plan som svarar 200 med en lista på varje GET och låter testet svara på
// resten.
function planMedListor(hamtaPoster, ovrigt = () => null) {
  return (anrop, index) => (anrop.method === 'GET'
    ? { status: 200, json: { entries: hamtaPoster() } }
    : ovrigt(anrop, index));
}

function celltext(rad, className) {
  const cell = rad.children.find((barn) => barn.className === className);
  assert.notEqual(cell, undefined, `raden saknar cellen ${className}`);
  return cell.textContent;
}

function fyllFormularet(dom) {
  dom.falt('name').value = 'Hyra';
  dom.falt('amountSek').value = '1234,50';
  dom.falt('interval').value = 'monthly';
  dom.falt('startDate').value = '2026-01-25';
  dom.falt('category').value = 'housing';
}

function skickaFormularet(dom) {
  let forhindrad = false;
  dom.form.utlos('submit', {
    preventDefault() {
      forhindrad = true;
    }
  });
  return forhindrad;
}

// ---------------------------------------------------------------- laddning

test('app.js laddas mot attrappen och fyller de två listorna ur src/core/', async (t) => {
  const { dom, anrop } = await starta(t, () => TOMT_SVAR);

  // Filen hämtar sin lista vid start: ett GET och ingenting annat.
  assert.equal(anrop.length, 1);
  assert.equal(anrop[0].method, 'GET');
  assert.equal(anrop[0].url, '/api/entries');

  // Etiketterna ägs av src/core/entry.js. Ingen svensk etikett skrivs för hand i
  // app.js, och de två select-elementen fylls med nycklarna ur tabellerna.
  const varden = (id) => dom.falt(id).children.map((option) => option.value);
  const etiketter = (id) => dom.falt(id).children.map((option) => option.textContent);
  assert.deepEqual(varden('interval'), Object.keys(INTERVAL_LABELS));
  assert.deepEqual(etiketter('interval'), Object.values(INTERVAL_LABELS));
  assert.deepEqual(varden('category'), Object.keys(CATEGORY_LABELS));
  assert.deepEqual(etiketter('category'), Object.values(CATEGORY_LABELS));

  assert.equal(dom.list.children.length, 0);
  assert.equal(dom.formError.textContent, '');
});

test('attrappen har exakt de id:n index.html har', async () => {
  // Utan det här fallet kan index.html få ett nytt fält som attrappen saknar, och
  // då prövar varje annat fall en DOM som appen aldrig möter.
  assert.deepEqual(createDom().ids, await idsFranIndexHtml());
});

// ---------------------------------------------------------------- fel i svaret

test('ett 400 med två fieldErrors visar båda texterna vid sina fält och lämnar den allmänna rutan tom', async (t) => {
  const svar = {
    status: 400,
    json: {
      error: 'Posten kunde inte sparas.',
      fieldErrors: [
        { field: 'name', message: 'Namnet får inte vara tomt.' },
        { field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }
      ]
    }
  };
  const { dom, anrop } = await starta(t, planMedListor(() => [], () => svar));

  fyllFormularet(dom);
  assert.equal(skickaFormularet(dom), true, 'submit-hanteraren kallade inte preventDefault');
  await flush();

  assert.equal(anrop.length, 2);
  assert.equal(anrop[1].method, 'POST');
  assert.equal(dom.faltfel('name'), 'Namnet får inte vara tomt.');
  assert.equal(dom.faltfel('amountSek'), 'Beloppet måste vara större än 0 kr.');
  assert.equal(dom.formError.textContent, '', 'den allmänna rutan skrevs trots att fältfel visades');
  for (const falt of ['interval', 'startDate', 'category']) {
    assert.equal(dom.faltfel(falt), '', `fältet ${falt} fick ett fel det inte hade`);
  }
  // Ingen lista hämtades om, och formuläret nollställdes inte.
  assert.equal(dom.form.resetAnrop, 0);
  assert.equal(dom.falt('name').value, 'Hyra');
});

test('ett 500 med error visar texten i den allmänna rutan', async (t) => {
  const svar = { status: 500, json: { error: 'Ett oväntat fel inträffade. Försök igen.' } };
  const { dom } = await starta(t, planMedListor(() => [], () => svar));

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.formError.textContent, 'Ett oväntat fel inträffade. Försök igen.');
  assert.equal(dom.faltfel('name'), '');
});

test('ett 500 med en kropp som inte är JSON visar den allmänna texten', async (t) => {
  // Den konkreta indata som når grenen typeof body.error === 'string': readJson
  // svarar {} för varje svar utan läsbar JSON-kropp.
  const { dom } = await starta(t, planMedListor(() => [], () => ({ status: 500 })));

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.formError.textContent, GENERAL_ERROR);
});

test('ett fetch som kastar visar den allmänna texten och lämnar knappen påslagen', async (t) => {
  const { dom } = await starta(t, planMedListor(() => [], () => new TypeError('Failed to fetch')));

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.formError.textContent, GENERAL_ERROR);
  assert.equal(dom.submit.disabled, false, 'Spara-knappen lämnades avstängd efter ett fel');
});

// ---------------------------------------------------------------- lyckad väg

test('en giltig post ger 201, nollställt formulär och beloppet i listan', async (t) => {
  let poster = [];
  const { dom, anrop } = await starta(t, planMedListor(() => poster, (post) => {
    if (post.method === 'POST') {
      poster = [POST_ETT];
      return { status: 201, json: POST_ETT };
    }
    return null;
  }));

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  // Kroppen är utkastet ordagrant: beloppet tolkas på servern, aldrig här.
  assert.equal(anrop[1].method, 'POST');
  assert.deepEqual(JSON.parse(anrop[1].body), {
    name: 'Hyra',
    amountSek: '1234,50',
    interval: 'monthly',
    startDate: '2026-01-25',
    category: 'housing'
  });

  assert.equal(dom.form.resetAnrop, 1, 'formuläret nollställdes inte');
  assert.equal(dom.falt('name').value, '');

  // Listan hämtades om efter sparningen: GET, POST, GET.
  assert.deepEqual(anrop.map((post) => post.method), ['GET', 'POST', 'GET']);
  assert.equal(dom.list.children.length, 1);

  const rad = dom.list.children[0];
  assert.equal(celltext(rad, 'entry-name'), 'Hyra');
  assert.equal(celltext(rad, 'entry-category'), CATEGORY_LABELS.housing);
  assert.equal(celltext(rad, 'entry-interval'), INTERVAL_LABELS.monthly);
  // formatSek skriver hårt blanksteg (U+00A0) både som tusentalsavgränsare och
  // före kr — strängen skrivs därför med kodpunkterna utskrivna.
  assert.equal(celltext(rad, 'entry-amount'), '1 234,50 kr');
  assert.equal(celltext(rad, 'entry-amount'), formatSek(sekToOre(POST_ETT.amountSek)));
  assert.equal(dom.formError.textContent, '');
});

test('två submit i rad medan det första anropet är i luften ger exakt ett POST', async (t) => {
  // Knappens disabled duger inte som enda spärr: en submit-händelse behöver inte
  // komma från knappen. Utan app.js eget pågående-läge blir det två POST, och då
  // sparas posten två gånger.
  let poster = [];
  const { dom, anrop } = await starta(t, planMedListor(() => poster, () => null));

  fyllFormularet(dom);
  skickaFormularet(dom);
  skickaFormularet(dom);

  const skickade = anrop.filter((post) => post.method === 'POST');
  assert.equal(skickade.length, 1, `${skickade.length} POST skickades av två submit i rad`);

  // Svaret kommer, listan hämtas om, och först därefter går ett nytt POST igenom.
  poster = [POST_ETT];
  skickade[0].svara({ status: 201, json: POST_ETT });
  await flush();
  assert.deepEqual(anrop.map((post) => post.method), ['GET', 'POST', 'GET']);

  skickaFormularet(dom);
  assert.equal(anrop.filter((post) => post.method === 'POST').length, 2);
});

test('två olika Ta bort direkt efter varandra ger två DELETE och tömmer listan', async (t) => {
  // Granskarens underkännande av paket 5: knappspärren gäller den egna knappen,
  // och två klick på OLIKA knappar ska båda gå fram.
  let poster = [POST_ETT, POST_TVA];
  const { dom, anrop } = await starta(t, planMedListor(() => poster, () => null));

  assert.equal(dom.list.children.length, 2);
  const knappar = dom.taBortKnappar();
  assert.equal(knappar.length, 2);

  knappar[0].utlos('click');
  knappar[1].utlos('click');

  const borttagningar = anrop.filter((post) => post.method === 'DELETE');
  assert.equal(borttagningar.length, 2, `${borttagningar.length} DELETE av två klick`);
  assert.deepEqual(
    borttagningar.map((post) => post.url),
    [`/api/entries/${POST_ETT.id}`, `/api/entries/${POST_TVA.id}`]
  );

  poster = [];
  for (const borttagning of borttagningar) {
    borttagning.svara({ status: 204 });
  }
  await flush();

  assert.equal(dom.list.children.length, 0);
  assert.equal(dom.formError.textContent, '');
});

test('ett andra klick på samma Ta bort-knapp medan anropet är i luften ger inget andra DELETE', async (t) => {
  // Knappens egen disabled är spärren mot dubbelklick på SAMMA rad. Utan den
  // skickas två DELETE för samma id, och det andra svaret blir 404 med ett fel
  // användaren inte har orsakat.
  let poster = [POST_ETT, POST_TVA];
  const { dom, anrop } = await starta(t, planMedListor(() => poster, () => null));

  const knapp = dom.taBortKnappar()[0];
  knapp.utlos('click');
  assert.equal(knapp.disabled, true, 'knappen spärrades inte under anropet');
  knapp.utlos('click');

  const borttagningar = anrop.filter((post) => post.method === 'DELETE');
  assert.equal(borttagningar.length, 1, `${borttagningar.length} DELETE av två klick på samma knapp`);

  poster = [POST_TVA];
  borttagningar[0].svara({ status: 204 });
  await flush();
  assert.equal(dom.list.children.length, 1);
});

test('en borttagning som ger 404 visar serverns text i den allmänna rutan', async (t) => {
  const poster = [POST_ETT];
  const { dom } = await starta(t, planMedListor(() => poster, () => ({
    status: 404,
    json: { error: 'Posten finns inte.' }
  })));

  dom.taBortKnappar()[0].utlos('click');
  await flush();

  assert.equal(dom.formError.textContent, 'Posten finns inte.');
  // Listan står kvar: en misslyckad borttagning tar inte bort raden i vyn.
  assert.equal(dom.list.children.length, 1);
});
