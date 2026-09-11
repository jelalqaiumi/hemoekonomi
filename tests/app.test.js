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
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { monthlyOre, totalMonthlyOre, totalYearlyOre, yearlyOre } from '../src/core/cost.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '../src/core/entry.js';
import { formatSek, sekToOre } from '../src/core/money.js';
import { createDom, createFetch, flush, idsFranIndexHtml, loadApp } from './helpers/dom.js';

// Text mot användaren som app.js skriver själv, alltså varken hämtar ur svaret
// eller ur src/core/. Den skrivs av här för att jämföras mot vyn. Uppräkningen
// står utan antal och utan ordet enda — ett påstående med siffra blir falskt av
// nästa tillägg (LARDOMAR.md 2026-09-10, uppräkningen "enda strängen" rättades i
// app.js och lämnades kvar i tests/app.test.js).
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

// Paket 6: tre poster à 100,00 kr med var sitt intervall. Just de tre valdes av
// arkitekten därför att kolumnen och totalen då skiljer sig med ett öre —
// kolumnsumman för månad blir 14166 öre medan totalMonthlyOre ger 14167.
const TRE_POSTER = Object.freeze([
  Object.freeze({
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    name: 'Hyra',
    amountSek: 100,
    interval: 'monthly',
    startDate: '2026-01-01',
    category: 'housing'
  }),
  Object.freeze({
    id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
    name: 'Försäkring',
    amountSek: 100,
    interval: 'quarterly',
    startDate: '2026-01-01',
    category: 'insurance'
  }),
  Object.freeze({
    id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
    name: 'Domän',
    amountSek: 100,
    interval: 'yearly',
    startDate: '2026-01-01',
    category: 'other'
  })
]);

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
  assert.equal(celltext(rad, 'entry-amount'), '1\u00a0234,50\u00a0kr');
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

// ------------------------------------ paket 6: kostnad per post och totaler

test('tre poster med var sitt intervall ger sex celler per rad med kostnaden per post', async (t) => {
  const { dom } = await starta(t, planMedListor(() => [...TRE_POSTER]));

  assert.equal(dom.list.children.length, 3);

  for (const [index, post] of TRE_POSTER.entries()) {
    const rad = dom.list.children[index];
    // Sex celler och Ta bort-knappen, i den ordning ARKITEKTUR.md anger.
    assert.deepEqual(
      rad.children.map((barn) => barn.className),
      [
        'entry-name',
        'entry-category',
        'entry-amount',
        'entry-interval',
        'entry-monthly',
        'entry-yearly',
        'remove'
      ],
      `rad ${index} har fel celler`
    );

    // Talen kommer ur src/core/cost.js. Etiketten står i strängen, eftersom
    // raden annars visar tre belopp utan att något skiljer dem åt.
    assert.equal(
      celltext(rad, 'entry-monthly'),
      `Per månad: ${formatSek(monthlyOre(post))}`
    );
    assert.equal(
      celltext(rad, 'entry-yearly'),
      `Per år: ${formatSek(yearlyOre(post))}`
    );
  }

  // Kvartalsposten skriven ut med kodpunkterna: formatSek använder hårt
  // blanksteg (U+00A0) före kr, medan etikettens kolon följs av ett vanligt
  // mellanslag (U+0020). En jämförelse mot 'Per månad: 33,33 kr' med vanligt
  // mellanslag fallerar — LARDOMAR.md 2026-09-02 om formatSek-strängen.
  const kvartal = dom.list.children[1];
  assert.equal(celltext(kvartal, 'entry-monthly'), 'Per månad: 33,33\u00a0kr');
  assert.equal(celltext(kvartal, 'entry-yearly'), 'Per år: 400,00\u00a0kr');
});

test('totalrutan visar totalMonthlyOre och totalYearlyOre för hela listan', async (t) => {
  const poster = [...TRE_POSTER];
  const { dom } = await starta(t, planMedListor(() => poster));

  // Jämförs mot ett anrop av de två exporterna, aldrig mot en inskriven sträng:
  // ändras avrundningsregeln i src/core/cost.js ska det här testet följa med.
  assert.equal(dom.falt('total-monthly').textContent, formatSek(totalMonthlyOre(poster)));
  assert.equal(dom.falt('total-yearly').textContent, formatSek(totalYearlyOre(poster)));
});

test('kolumnen och totalen skiljer sig med ett öre för de tre posterna', async (t) => {
  // Totalen avrundas EN gång ur den exakta årssumman, medan varje rad avrundas
  // för sig. Skillnaden är avsiktlig, och det här fallet finns för att ingen
  // senare byggare ska kunna "laga" den genom att summera kolumnen i app.js.
  const poster = [...TRE_POSTER];
  const { dom } = await starta(t, planMedListor(() => poster));

  // Kolumnen så som den står på skärmen: varje cell är formatSek(monthlyOre).
  for (const [index, post] of poster.entries()) {
    assert.equal(
      celltext(dom.list.children[index], 'entry-monthly'),
      `Per månad: ${formatSek(monthlyOre(post))}`,
      `rad ${index} visar inte monthlyOre`
    );
  }

  const kolumnsumma = poster.reduce((summa, post) => summa + monthlyOre(post), 0);
  assert.equal(kolumnsumma, 14166);
  assert.equal(formatSek(kolumnsumma), '141,66\u00a0kr');

  assert.equal(totalMonthlyOre(poster), 14167);
  assert.equal(
    dom.falt('total-monthly').textContent,
    '141,67\u00a0kr',
    'totalrutan visar kolumnsumman i stället för totalMonthlyOre'
  );

  // Årskolumnen och årstotalen sammanfaller för just de här posterna.
  assert.equal(dom.falt('total-yearly').textContent, '1\u00a0700,00\u00a0kr');
});

// ------------------------------------------------------- paket 6: tomläget

test('en tom lista ger tomläget, en tom lista i vyn och 0,00 kr i båda totalerna', async (t) => {
  const { dom } = await starta(t, () => TOMT_SVAR);

  assert.equal(
    dom.falt('empty-state').textContent,
    'Du har inga poster ännu. Lägg till din första utgift ovan.'
  );
  assert.equal(dom.list.children.length, 0);

  // Totalrutan döljs aldrig: en tom lista visar två nollor.
  assert.equal(formatSek(totalMonthlyOre([])), '0,00\u00a0kr');
  assert.equal(dom.falt('total-monthly').textContent, '0,00\u00a0kr');
  assert.equal(dom.falt('total-yearly').textContent, '0,00\u00a0kr');
});

test('en lista med en post tömmer tomläget', async (t) => {
  // Vyn börjar tom, så tomläget har skrivits en gång. Först när en post kommer
  // till prövas raden som tömmer det igen.
  let poster = [];
  const { dom } = await starta(t, planMedListor(() => poster, (post) => {
    if (post.method === 'POST') {
      poster = [POST_ETT];
      return { status: 201, json: POST_ETT };
    }
    return null;
  }));

  assert.equal(
    dom.falt('empty-state').textContent,
    'Du har inga poster ännu. Lägg till din första utgift ovan.'
  );

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.list.children.length, 1);
  assert.equal(dom.falt('empty-state').textContent, '', 'tomläget stod kvar med en post i listan');
});

// ------------------------ paket 6: vyn när en hämtning misslyckas

// U+2013 EN DASH, skriven som escapesekvens. Bindestreck (U+002D) och tankstreck
// (U+2014) ser nästan likadana ut i källtexten, och en jämförelse mot fel tecken
// skulle aldrig kunna passera. Kodpunkten i app.js är körd och kontrollerad.
const UNKNOWN_TOTAL = '\u2013';

// Punkt (17) i kravlistan, och samtidigt första platsen i uppräkningen "fetch
// avvisas — vid sidladdningen, vid Spara och vid Ta bort". Fallet fäller två
// mutationer: try/catch borttagen ur loadAndRender (ett avvisat fetch blir då en
// ohanterad avvisning från modulens toppnivås await loadAndRender(), och
// starta() kastar innan någon assertion nås) och clearView-anropet struket ur
// samma catch (totalerna står då kvar som tomma strängar).
test('ett avvisat fetch vid sidladdning tömmer vyn, ger \u2013 i båda totalerna och visar den allmänna texten', async (t) => {
  const { dom, anrop } = await starta(t, () => new TypeError('Failed to fetch'));

  assert.equal(anrop.length, 1);
  assert.equal(anrop[0].method, 'GET');
  assert.equal(dom.formError.textContent, GENERAL_ERROR);

  assert.equal(dom.list.children.length, 0);
  // Tomlägets text är ett påstående om datafilen. Appen vet inte om den är tom,
  // bara att den inte kunde läsas — därför den tomma strängen och inte texten.
  assert.equal(dom.falt('empty-state').textContent, '', 'tomlägets text visades trots att listan aldrig kom');
  assert.equal(dom.falt('total-monthly').textContent, UNKNOWN_TOTAL, 'månadstotalen visar inte UNKNOWN_TOTAL');
  assert.equal(dom.falt('total-yearly').textContent, UNKNOWN_TOTAL, 'årstotalen visar inte UNKNOWN_TOTAL');
});

// Punkt (18). Granskarens värsta mätning: en post som redan är borta ur
// datafilen står kvar i vyn, med totaler som räknar med den. Omhämtningen svarar
// 500 här, så fallet prövar den ANDRA misslyckade grenen i loadAndRender —
// statusen som inte är 200. Den avvisade grenen prövas av punkt (17).
test('en borttagning vars omhämtning ger 500 lämnar inget av den gamla listan i vyn', async (t) => {
  const poster = [...TRE_POSTER];
  const felsvar = { status: 500, json: { error: 'Datafilen är skadad och kunde inte läsas: X' } };
  let hamtningar = 0;
  const { dom } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return hamtningar === 1 ? { status: 200, json: { entries: poster } } : felsvar;
    }
    return { status: 204 };
  });

  // Utgångsläget: tre rader och två totaler ur src/core/cost.js.
  assert.equal(dom.list.children.length, 3);
  assert.equal(dom.falt('total-monthly').textContent, formatSek(totalMonthlyOre(poster)));
  assert.equal(dom.falt('total-yearly').textContent, formatSek(totalYearlyOre(poster)));

  dom.taBortKnappar()[0].utlos('click');
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter borttagningen');
  assert.equal(dom.list.children.length, 0, 'en post som redan är borta ur datafilen står kvar i vyn');
  assert.equal(dom.falt('empty-state').textContent, '');
  assert.equal(dom.falt('total-monthly').textContent, UNKNOWN_TOTAL, 'månadstotalen räknar med en borttagen post');
  assert.equal(dom.falt('total-yearly').textContent, UNKNOWN_TOTAL, 'årstotalen räknar med en borttagen post');
  assert.equal(dom.formError.textContent, 'Datafilen är skadad och kunde inte läsas: X');
});

// Tredje och sista platsen i uppräkningen av när GENERAL_ERROR visas: fetch
// avvisas vid Ta bort. Sidladdningen prövas av punkt (17), Spara av fallet
// "ett fetch som kastar visar den allmänna texten" längre upp.
test('ett avvisat fetch vid Ta bort visar den allmänna texten och lämnar raden kvar', async (t) => {
  const poster = [POST_ETT];
  const { dom } = await starta(t, planMedListor(() => poster, () => new TypeError('Failed to fetch')));

  const knapp = dom.taBortKnappar()[0];
  knapp.utlos('click');
  await flush();

  assert.equal(dom.formError.textContent, GENERAL_ERROR);
  // Ingen hämtning misslyckades: DELETE kom aldrig fram, ingen omhämtning
  // startade, och vyn står därför kvar orörd med sin gamla — sanna — lista.
  assert.equal(dom.list.children.length, 1);
  assert.equal(dom.falt('total-monthly').textContent, formatSek(totalMonthlyOre(poster)));
  assert.equal(knapp.disabled, false, 'Ta bort-knappen lämnades avstängd efter ett fel');
});

// Raden i clearView som tömmer #empty-state prövas här och ingen annanstans. De
// två fallen ovan lämnar elementet tomt redan innan clearView körs — i punkt
// (17) har det aldrig skrivits, i punkt (18) tömde renderEntries det — så deras
// assertion är sann av sig själv och faller inte om raden tas bort
// (LARDOMAR.md 2026-09-10, raden som tömmer #empty-state i clearView överlever
// mutation). Här är utgångsläget det motsatta av det förväntade: listan är tom
// vid sidladdningen, så tomlägets text står på skärmen när omhämtningen
// misslyckas, och raden måste skriva över den. Utan raden står två motsägande
// påståenden i vyn samtidigt — "du har inga poster" och två okända totaler.
test('en sparning vars omhämtning ger 500 tömmer tomlägets text ur vyn', async (t) => {
  const felsvar = { status: 500, json: { error: 'Datafilen är skadad och kunde inte läsas: X' } };
  let hamtningar = 0;
  const { dom } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return hamtningar === 1 ? TOMT_SVAR : felsvar;
    }
    return { status: 201, json: POST_ETT };
  });

  // Utgångsläget: tomläget står i vyn, och båda totalerna visar noll.
  assert.equal(
    dom.falt('empty-state').textContent,
    'Du har inga poster ännu. Lägg till din första utgift ovan.'
  );
  assert.equal(dom.falt('total-monthly').textContent, formatSek(totalMonthlyOre([])));

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter sparningen');
  assert.equal(dom.list.children.length, 0);
  assert.equal(
    dom.falt('empty-state').textContent,
    '',
    'tomlägets text står kvar i vyn samtidigt som båda totalerna visar ett okänt tal'
  );
  assert.equal(dom.falt('total-monthly').textContent, UNKNOWN_TOTAL, 'månadstotalen visar inte UNKNOWN_TOTAL');
  assert.equal(dom.falt('total-yearly').textContent, UNKNOWN_TOTAL, 'årstotalen visar inte UNKNOWN_TOTAL');
  assert.equal(dom.formError.textContent, 'Datafilen är skadad och kunde inte läsas: X');
});

// (20) Ett 200 vars kropp inte går att läsa som JSON. Skyddet
// Array.isArray(body.entries) i loadAndRender ser onåbart ut — instrumenterat
// skrivs fallback-grenen noll gånger av resten av sviten — men det är det inte:
// readJson svarar {} för varje svar utan läsbar kropp, så body.entries blir
// undefined. Utan skyddet ger renderEntries "TypeError: entries is not
// iterable", alltså en trasig vy helt utan felmeddelande.
//
// Appens egen serverkod kan inte producera svaret: sendJson skriver alltid en
// fullständig kropp. Det som producerar det är ett 200 som kapas efter
// huvudena — serverprocessen dör mitt i svaret, eller nätet bryter.
test('ett 200 utan läsbar JSON-kropp ger en tom vy och kastar inte', async (t) => {
  const { dom } = await starta(t, () => ({ status: 200 }));

  assert.equal(dom.list.children.length, 0);
  assert.equal(
    dom.falt('empty-state').textContent,
    'Du har inga poster ännu. Lägg till din första utgift ovan.'
  );
  assert.equal(dom.falt('total-monthly').textContent, formatSek(totalMonthlyOre([])));
  assert.equal(dom.falt('total-yearly').textContent, formatSek(totalYearlyOre([])));
});

// ---------------------------------------------------- textspärr: totalerna

// Årstotalen kan inget beteendetest skydda. totalYearlyOre ÄR kolumnsumman —
// årsbeloppet per post avrundas aldrig — så mutationen till en reduce ger samma
// tal för varje indata: granskarens körning gav tests 267, pass 267, fail 0 och
// EXIT=0, utan en enda kryssrad. Månadstotalen skyddas av punkt (14), som lever
// på att avrundningen skiljer de två talen åt med ett öre.
//
// Det som återstår för årshalvan är en spärr som läser källan. En sådan är
// aldrig ett skydd i sig — den prövar en sträng, inte ett beteende — och den
// enda anledningen att den duger här är att det inte finns något beteende att
// pröva. Spärren är därför skriven mot BINDNINGEN och inte mot strängen, och
// prövad mot varje stavning språket tillåter: ett alias i importlistan
// (`totalYearlyOre as X`) och en namnrymdsimport (`import * as cost`) gick förbi
// motsvarande spärr i api.js med ✔ (LARDOMAR.md 2026-09-07).
const APP_KALLA_PATH = fileURLToPath(new URL('../src/web/app.js', import.meta.url));

test('app.js hämtar båda totalerna ur cost.js och räknar inte ut dem själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  // Exakt ett ställe: en andra import — eller ett dynamiskt import('/core/cost.js')
  // — vore en andra väg in i modulen som den namngivna listan nedan inte täcker.
  const forekomster = kalla.split("'/core/cost.js'").length - 1;
  assert.equal(forekomster, 1, `'/core/cost.js' förekommer ${forekomster} gånger i ${APP_KALLA_PATH}`);

  // Namngiven import, alltså aldrig import * as: en namnrymdsimport ger tillgång
  // till varje export utan att något namn står skrivet, och då kan regeln inte
  // läsas ur filen.
  const match = /import\s*\{([^}]*)\}\s*from\s*'\/core\/cost\.js'/.exec(kalla);
  assert.notEqual(
    match,
    null,
    `förekomsten av '/core/cost.js' i ${APP_KALLA_PATH} är ingen namngiven importsats`
  );

  // Varje element normaliseras till sitt importerade namn, så att `totalYearlyOre
  // as X` räknas som totalYearlyOre och inte som ett okänt namn.
  const namn = match[1]
    .split(',')
    .map((del) => del.split(/\s+as\s+/)[0].trim())
    .filter((del) => del !== '');
  for (const kravd of ['totalMonthlyOre', 'totalYearlyOre']) {
    assert.equal(
      namn.includes(kravd),
      true,
      `app.js importerar inte ${kravd}: [${namn.join(', ')}]`
    );
  }

  // Importerad är inte detsamma som anropad: en post kan stå kvar i importlistan
  // medan anropet bytts mot en kolumnsumma. Anropet prövas därför under det namn
  // filen faktiskt använder — aliaset om det finns, annars exportnamnet.
  const lokaltNamn = (exportNamn) => {
    const del = match[1]
      .split(',')
      .map((text) => text.trim())
      .find((text) => text.split(/\s+as\s+/)[0].trim() === exportNamn);
    const delar = del.split(/\s+as\s+/);
    return (delar[1] ?? delar[0]).trim();
  };
  for (const exportNamn of ['totalMonthlyOre', 'totalYearlyOre']) {
    const anrop = `${lokaltNamn(exportNamn)}(`;
    assert.equal(
      kalla.includes(anrop),
      true,
      `app.js importerar ${exportNamn} men anropar aldrig ${anrop}`
    );
  }

  // Ingen egen summering. En reduce är det enda sätt att skriva om en total till
  // en kolumnsumma som inte redan fälls av kravet på anropet ovan; app.js har
  // noll i dag. En for-loop förbjuds inte — renderEntries behöver en.
  assert.equal(
    kalla.includes('.reduce('),
    false,
    'app.js innehåller .reduce( — totalerna hämtas ur cost.js, de summeras inte här'
  );
});
