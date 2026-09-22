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
import { upcoming } from '../src/core/schedule.js';
import { createDom, createFetch, flush, idsFranIndexHtml, loadApp } from './helpers/dom.js';

// Text mot användaren som app.js skriver själv, alltså varken hämtar ur svaret
// eller ur src/core/. Den skrivs av här för att jämföras mot vyn. Uppräkningen
// står utan antal och utan ordet enda — ett påstående med siffra blir falskt av
// nästa tillägg (LARDOMAR.md 2026-09-10, uppräkningen "enda strängen" rättades i
// app.js och lämnades kvar i tests/app.test.js).
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';

// Värdet globalThis.fetch bär innan något testfall har körts, läst på modulnivå.
// Punkt (33):s tredje fall jämför mot det i stället för mot undefined: Node har
// en inbyggd fetch men ingen DOM, så laddaren sparar den inbyggda funktionen i
// sitt tidigareFetch och lägger tillbaka den — rätt beteende, men värdet är då
// en funktion och blir aldrig undefined (ARKITEKTUR.md, "Verifierad miljö").
// Jämförelsen är samma påstående som undefined hade varit i en miljö utan
// inbyggd fetch: att attrappen inte står kvar. En assertion om att fetch bara
// inte är attrappen vore svagare — den passerar också om återställningen lägger
// tillbaka något tredje.
const FETCH_FORE_TESTERNA = globalThis.fetch;

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

// Den dag app.js får av laddaren. Testfilen läser ingen klocka: den dag app.js
// ser är injicerad, så varje fall prövar en känd dag och kan aldrig bli rött av
// att dygnet byts mitt i provet (ARKITEKTUR.md, "Klockan som app.js läser är
// injicerad, inte verklig"). Värdet ligger mitt i en månad med 31 dagar, så att
// en post som startar i dag, i morgon eller i övermorgon ligger i samma månad
// och dagtexterna går att nå utan datumaritmetik i den här filen.
const FRYST_IDAG = '2026-03-15';
// Den andra dagen punkt (27) behöver, skriven och inte uträknad.
const FRYST_NASTA_DAG = '2026-03-16';

// Startar app.js med en plan för fetch-attrappen och lämnar tillbaka attrappen,
// anropslistan och bytDag — laddarens väg att sätta en annan dag mitt i ett
// fall.
async function starta(t, plan, idag = FRYST_IDAG) {
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
  const { bytDag } = await loadApp(t, { document: dom.document, fetch, idag });
  return { dom, anrop, bytDag };
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

// ---------------------------------------- paket 7: kommande dragningar

// Dagen app.js ser är FRYST_IDAG, satt av laddaren. Posternas startdatum är
// därför skrivna som strängar och inte uträknade ur en klocka: FRYST_IDAG,
// dagen efter och dagen därpå ligger alla i mars, som har 31 dagar.
function dragningspost(id, name, startDate) {
  return { id, name, amountSek: 100, interval: 'monthly', startDate, category: 'housing' };
}

// Tre poster som ligger i en ordning som varken är datumordning (Ström, Hyra,
// Bredband) eller bokstavsordning (Bredband, Hyra, Ström). Ett app.js som
// renderar i inmatningsordningen, eller som sorterar själv, faller därför.
function dragningsposter() {
  return [
    dragningspost('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'Bredband', '2026-03-17'),
    dragningspost('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'Ström', '2026-03-15'),
    dragningspost('ffffffff-ffff-4fff-8fff-ffffffffffff', 'Hyra', '2026-03-16')
  ];
}

// (21)
test('tre poster renderas i upcoming-ordningen med namn, datum och dagar kvar', async (t) => {
  const poster = dragningsposter();
  const { dom } = await starta(t, planMedListor(() => poster));

  const lista = dom.falt('upcoming-list');
  assert.equal(lista.children.length, 3);

  // Cellerna per rad, i den ordning ARKITEKTUR.md anger.
  assert.deepEqual(
    lista.children[0].children.map((barn) => barn.className),
    ['upcoming-name', 'upcoming-date', 'upcoming-days']
  );

  const cellerna = (klass) => lista.children.map((rad) => celltext(rad, klass));
  assert.deepEqual(cellerna('upcoming-name'), ['Ström', 'Hyra', 'Bredband']);
  // Datumet ordagrant, som ÅÅÅÅ-MM-DD och utan omskrivning.
  assert.deepEqual(cellerna('upcoming-date'), ['2026-03-15', '2026-03-16', '2026-03-17']);
  assert.deepEqual(cellerna('upcoming-days'), ['Idag', 'Om 1 dag', 'Om 2 dagar']);

  // Samma ordning som upcoming() ger: app.js sorterar ingenting själv, så
  // ändras sorteringen i src/core/schedule.js följer det här testet med.
  assert.deepEqual(
    cellerna('upcoming-name'),
    upcoming(poster, FRYST_IDAG).map((item) => item.entry.name)
  );

  // Tomtexten står inte kvar när kortet har rader.
  assert.equal(dom.falt('upcoming-empty').textContent, '');
});

// (22) Gränsen mellan singular och plural har ett fall på var sida: daysUntil 1
// ger "Om 1 dag" och daysUntil 2 ger "Om 2 dagar".
test('dagtexterna är Idag, Om 1 dag och Om 2 dagar för daysUntil 0, 1 och 2', async (t) => {
  const poster = dragningsposter();
  const { dom } = await starta(t, planMedListor(() => poster));

  // Att de tre posterna verkligen ger 0, 1 och 2 avgörs av schedule.js och inte
  // av app.js. Utan den här raden kan texterna nedan prövas mot fel värden.
  assert.deepEqual(upcoming(poster, FRYST_IDAG).map((item) => item.daysUntil), [0, 1, 2]);

  const dagtext = (index) => celltext(dom.falt('upcoming-list').children[index], 'upcoming-days');
  assert.equal(dagtext(0), 'Idag');
  assert.equal(dagtext(1), 'Om 1 dag');
  assert.equal(dagtext(2), 'Om 2 dagar');
});

// (23) Tomläget i kortet, och de två raderna i clearView.
test('en tom lista ger tomt #upcoming-list och texten i #upcoming-empty', async (t) => {
  const { dom } = await starta(t, () => TOMT_SVAR);

  assert.equal(dom.falt('upcoming-list').children.length, 0);
  assert.equal(dom.falt('upcoming-empty').textContent, 'Inga kommande dragningar ännu.');
});

// Raden i clearView som tömmer #upcoming-empty prövas här. Utgångsläget är det
// motsatta av det förväntade: listan är tom vid sidladdningen, så tomtexten står
// på skärmen när omhämtningen misslyckas och raden måste skriva över den. En
// assertion mot ett element som redan är tomt är sann av sig själv och faller
// inte om raden tas bort (LARDOMAR.md 2026-09-10).
test('en sparning vars omhämtning ger 500 tömmer texten ur #upcoming-empty', async (t) => {
  const felsvar = { status: 500, json: { error: 'Datafilen är skadad och kunde inte läsas: X' } };
  let hamtningar = 0;
  const { dom } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return hamtningar === 1 ? TOMT_SVAR : felsvar;
    }
    return { status: 201, json: POST_ETT };
  });

  assert.equal(dom.falt('upcoming-empty').textContent, 'Inga kommande dragningar ännu.');

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter sparningen');
  assert.equal(
    dom.falt('upcoming-empty').textContent,
    '',
    'kortet påstår att det inte finns några kommande dragningar trots att listan aldrig kom'
  );
});

// Raden i clearView som tömmer #upcoming-list prövas här: kortet har tre rader
// när omhämtningen misslyckas. Utan raden beskriver de en datafil appen inte
// kunde läsa, och en av posterna är dessutom redan borttagen.
test('en borttagning vars omhämtning ger 500 lämnar inga rader i #upcoming-list', async (t) => {
  const poster = dragningsposter();
  const felsvar = { status: 500, json: { error: 'Datafilen är skadad och kunde inte läsas: X' } };
  let hamtningar = 0;
  const { dom } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return hamtningar === 1 ? { status: 200, json: { entries: poster } } : felsvar;
    }
    return { status: 204 };
  });

  assert.equal(dom.falt('upcoming-list').children.length, 3);
  assert.equal(dom.falt('upcoming-empty').textContent, '');

  dom.taBortKnappar()[0].utlos('click');
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter borttagningen');
  assert.equal(
    dom.falt('upcoming-list').children.length,
    0,
    'dragningar för en lista appen inte kunde läsa står kvar i vyn'
  );
  assert.equal(dom.falt('upcoming-empty').textContent, '');
});

// De två nollställningarna i renderUpcoming prövas här, en i vart sitt fall.
// Gemensamt för dem: renderUpcoming anropas två gånger med olika listor, och
// utgångsläget före det andra anropet är det motsatta av det förväntade
// resultatet. Varje fall ovan renderar kortet en enda gång från ett orört
// utgångsläge, och en assertion mot ett element som aldrig har skrivits är sann
// av sig själv (LARDOMAR.md 2026-09-10 och 2026-09-12).

// (24) UPCOMING_LIST.replaceChildren(): en kortare lista efter en längre.
test('en borttagning med lyckad omhämtning lämnar bara de kvarvarande posternas dragningar', async (t) => {
  const poster = dragningsposter();
  // Listan renderas i serverns ordning, så den första Ta bort-knappen hör till
  // den första posten i svaret.
  const borttagen = poster[0];
  const kvar = poster.slice(1);
  let hamtningar = 0;
  const { dom, anrop } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return { status: 200, json: { entries: hamtningar === 1 ? poster : kvar } };
    }
    return { status: 204 };
  });

  // Utgångsläget är det motsatta av det förväntade: tre rader ska bli två.
  assert.equal(dom.falt('upcoming-list').children.length, 3);

  dom.taBortKnappar()[0].utlos('click');
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter borttagningen');
  assert.equal(anrop[1].method, 'DELETE');
  assert.equal(anrop[1].url, `/api/entries/${borttagen.id}`);

  const lista = dom.falt('upcoming-list');
  const namnen = lista.children.map((rad) => celltext(rad, 'upcoming-name'));
  assert.equal(
    lista.children.length,
    2,
    'kortet har fler rader än listan har poster: förra svarets dragningar står kvar'
  );
  assert.deepEqual(namnen, upcoming(kvar, FRYST_IDAG).map((item) => item.entry.name));
  assert.equal(
    namnen.includes(borttagen.name),
    false,
    'en dragning för posten som just togs bort står kvar i kortet'
  );
  // Samma antal som postlistan: de två korten beskriver samma datafil.
  assert.equal(dom.list.children.length, 2);
});

// (25) else-grenen UPCOMING_EMPTY.textContent = '': en icke-tom lista efter en
// tom.
test('en sparning med lyckad omhämtning tar bort tomtexten ur #upcoming-empty', async (t) => {
  const skapad = dragningspost('99999999-9999-4999-8999-999999999999', 'Hyra', FRYST_IDAG);
  let hamtningar = 0;
  const { dom } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return { status: 200, json: { entries: hamtningar === 1 ? [] : [skapad] } };
    }
    return { status: 201, json: skapad };
  });

  // Utgångsläget är det motsatta av det förväntade: tomtexten står på skärmen
  // och ska vara borta när kortet har en rad.
  assert.equal(dom.falt('upcoming-empty').textContent, 'Inga kommande dragningar ännu.');

  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter sparningen');
  assert.equal(dom.falt('upcoming-list').children.length, 1);
  // Den andra renderingens datum, ordagrant: posten startar den dag app.js fick
  // av laddaren och dras därför den dagen.
  const raden = dom.falt('upcoming-list').children[0];
  assert.equal(celltext(raden, 'upcoming-date'), FRYST_IDAG);
  assert.equal(celltext(raden, 'upcoming-days'), 'Idag');
  assert.equal(
    dom.falt('upcoming-empty').textContent,
    '',
    'kortet visar en rad och texten om att det inte finns några dragningar samtidigt'
  );
});

// (26) Datumcellen läser item.nextDueDate och inte item.entry.startDate.
// Kravet ligger i testdatan, inte i assertionens form: varje annan post i den
// här filen startar den frusna dagen eller de närmaste dagarna, och för en post
// som startar i framtiden är nästa dragning startdatumet självt. De två fälten
// bär då samma sträng, och en assertion på det renderade värdet kan inte se
// vilket av dem koden läser (LARDOMAR.md 2026-09-16). Posten nedan startar
// flera år tillbaka och skiljer dem åt.
test('datumkolumnen visar nästa dragning och inte startdatumet', async (t) => {
  const gammal = {
    id: '77777777-7777-4777-8777-777777777777',
    name: 'Hemförsäkring',
    amountSek: 100,
    interval: 'quarterly',
    startDate: '2020-03-31',
    category: 'housing'
  };
  const poster = [
    gammal,
    dragningspost('88888888-8888-4888-8888-888888888888', 'Ström', FRYST_IDAG)
  ];
  const { dom } = await starta(t, planMedListor(() => poster));

  const rader = upcoming(poster, FRYST_IDAG);
  // Provet är bara ett prov om de två fälten skiljer sig åt. Raden faller om
  // testdatan någon gång skrivs om så att de sammanfaller.
  assert.notEqual(
    rader.find((item) => item.entry.id === gammal.id).nextDueDate,
    gammal.startDate,
    'testdatan gör inte nextDueDate och startDate olika: cellen prövar då inte vilket fält koden läser'
  );

  const lista = dom.falt('upcoming-list');
  assert.equal(lista.children.length, 2);
  // Datumen jämförs mot upcoming() och aldrig mot en inskriven datumsträng:
  // facit kommer ur ägaren till frågan, schedule.js, och följer med när
  // algoritmen ändras.
  assert.deepEqual(
    lista.children.map((rad) => celltext(rad, 'upcoming-date')),
    rader.map((item) => item.nextDueDate)
  );
});

// (27) Dagen läses vid varje rendering och inte vid sidladdningen. Kortet
// renderas två gånger med samma lista och olika dag: laddaren sätter FRYST_IDAG
// före den första renderingen, testet byter till FRYST_NASTA_DAG före den
// andra, och den andra renderingen utlöses av en sparning vars omhämtning ger
// 200 med samma lista.
//
// Kravet stod utan prov så länge testfilen läste den verkliga klockan: den står
// still under en körning, så en läsning flyttad till modulens toppnivå gav
// samma svar i varje fall. Laddarens dag går att flytta, och det är det den här
// punkten gör.
test('dagarna räknas om mot den nya dagen när listan hämtas om', async (t) => {
  // En monthly-post som startar FRYST_IDAG: den första renderingen ger Idag,
  // den andra nästa månads dragning.
  const poster = [dragningspost('aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa', 'Ström', FRYST_IDAG)];
  let hamtningar = 0;
  const { dom, bytDag } = await starta(t, (post) => {
    if (post.method === 'GET') {
      hamtningar += 1;
      return { status: 200, json: { entries: poster } };
    }
    return { status: 201, json: poster[0] };
  });

  const lista = dom.falt('upcoming-list');
  const cellerna = (klass) => lista.children.map((rad) => celltext(rad, klass));

  // Första renderingen, mot den dag laddaren satte. Facit kommer ur upcoming()
  // och aldrig ur en inskriven dagtext, som vore ett andra facit.
  const forstaDatum = cellerna('upcoming-date');
  const forstaDagar = cellerna('upcoming-days');
  const forsta = upcoming(poster, FRYST_IDAG);
  assert.deepEqual(cellerna('upcoming-name'), forsta.map((item) => item.entry.name));
  assert.deepEqual(forstaDatum, forsta.map((item) => item.nextDueDate));

  bytDag(FRYST_NASTA_DAG);
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(hamtningar, 2, 'listan hämtades inte om efter sparningen');
  const andraDatum = cellerna('upcoming-date');
  const andraDagar = cellerna('upcoming-days');
  const andra = upcoming(poster, FRYST_NASTA_DAG);
  assert.deepEqual(cellerna('upcoming-name'), andra.map((item) => item.entry.name));
  assert.deepEqual(andraDatum, andra.map((item) => item.nextDueDate));

  // Är cellerna lika prövar fallet ingenting, och då är testdatan fel vald och
  // inte koden. De två raderna nedan är hela punktens bevis: en läsning flyttad
  // till modulens toppnivå ger samma svar i båda renderingarna.
  assert.notDeepEqual(
    andraDatum,
    forstaDatum,
    'datumcellen är oförändrad efter dagbytet: dagen lästes vid laddningen och inte vid renderingen'
  );
  assert.notDeepEqual(
    andraDagar,
    forstaDagar,
    'dagtexten är oförändrad efter dagbytet: dagen lästes vid laddningen och inte vid renderingen'
  );
});

// ---------------------------------------- paket 7: radelementets klass

// Klassnamnet i app.js är enda änden av kopplingen till src/web/style.css som
// går att pröva, och med fel tagg hamnar ett div i en ul. Cellernas klasser
// hade assertioner redan före den här rundan, medan radelementet självt saknade
// en: varken rad.className, item.className eller valet av tagg gick att fälla
// med en mutation (LARDOMAR.md 2026-09-22).

// (28)
test('raden i kortet Kommande dragningar är ett li med klassen upcoming', async (t) => {
  const poster = dragningsposter();
  const { dom } = await starta(t, planMedListor(() => poster));

  const rader = dom.falt('upcoming-list').children;
  assert.equal(rader.length, 3);
  for (const rad of rader) {
    assert.equal(rad.tagName, 'li', 'en rad i kortet är inte ett li');
    assert.equal(
      rad.className,
      'upcoming',
      'radens klass är inte upcoming: reglerna för .upcoming i src/web/style.css träffar den inte'
    );
  }
});

// (29) Samma hål i renderEntries, alltså paket 5:s och 6:s rad.
test('raden i postlistan är ett li med klassen entry', async (t) => {
  const { dom } = await starta(t, planMedListor(() => TRE_POSTER));

  const rader = dom.list.children;
  assert.equal(rader.length, 3);
  for (const rad of rader) {
    assert.equal(rad.tagName, 'li', 'en rad i postlistan är inte ett li');
    assert.equal(
      rad.className,
      'entry',
      'radens klass är inte entry: reglerna för .entry i src/web/style.css träffar den inte'
    );
  }
});

// (30) Ta bort-knappens elementtyp. Selektorn i src/web/style.css är
// button.remove och inte .remove, så elementtypen bär halva regeln — med ett
// span får knappen varken sin egen färg eller det spärrade lägets utseende.
// Klasshalvan asserteras av punkt (12):s celluppräkning och upprepas inte här.
test('Ta bort-knappen är ett button-element', async (t) => {
  const { dom } = await starta(t, planMedListor(() => TRE_POSTER));

  // Knappen plockas på sitt type och varken på sin klass eller på sin tagg:
  // annars skulle klassmutationen fälla den här punkten också, och då går det
  // inte att visa att klasshalvan är punkt (12):s. Cellerna i raden saknar
  // type, så uppslaget kan bara hitta knappen.
  const knappar = dom.list.children.map((rad) => {
    const knapp = rad.children.find((barn) => barn.type === 'button');
    assert.notEqual(knapp, undefined, 'raden saknar Ta bort-knappen');
    return knapp;
  });
  assert.equal(knappar.length, 3);
  for (const knapp of knappar) {
    assert.equal(
      knapp.tagName,
      'button',
      'Ta bort är inte ett button-element: selektorn button.remove i src/web/style.css träffar den inte'
    );
  }
});

// (31) Valen i de två listorna. <select> visar bara <option>, så med fel
// elementtyp är listan tom och formuläret obrukbart. Punkten prövar
// elementtypen och inget annat: att listorna fylls med rätt värden och rätt
// etiketter ägs av punkt (5), och en andra kopia av den assertionen vore ett
// andra facit.
test('valen i de två listorna är option-element', async (t) => {
  const { dom } = await starta(t, () => TOMT_SVAR);

  for (const id of ['interval', 'category']) {
    const valen = dom.falt(id).children;
    assert.notEqual(valen.length, 0, `#${id} fylldes inte alls`);
    for (const val of valen) {
      assert.equal(
        val.tagName,
        'option',
        `ett val i #${id} är inte ett option-element: ett select visar bara option`
      );
    }
  }
});

// ------------------------------------ paket 7: laddarens byte av dag

// (32) Spärren i tests/helpers/frozen-dates.js. Ägaren till frågan "är det här
// en dag" är isValidIsoDate i src/core/dates.js och inte ISO_DATE_PATTERN:
// mönstret äger frågan "rätt form" och säger true om 2026-02-30, medan
// isValidIsoDate äger frågan "finns i kalendern" och säger false. Det senare är
// vad spärren lovar ett svar på, så att ett felskrivet argument fälls i
// laddaren och inte långt inne i src/core/schedule.js — med mönstret ensamt föll
// 2026-02-30 först där, med RangeError: nextDueDate kräver ett dagens datum på
// formen ÅÅÅÅ-MM-DD, och alltså med fel orsak utpekad.
//
// Därför två argument: imorgon har fel form, 2026-02-30 har rätt form men ingen
// kalenderdag, och det är det senare som avgör ägarvalet. Hela meddelandet
// asserteras och inte bara feltypen, av samma skäl som gäller spärrarna i
// src/core/schedule.js: en assertion på enbart feltypen kan inte skilja
// stubbens kast från ett kast längre in (ARKITEKTUR.md, "Stubbens spärrar, och
// varför bara den ena får ett testfall"). Inget av argumenten läser någon
// klocka.
test('laddarens byte av dag avvisar en dag som inte finns i kalendern', async (t) => {
  const { bytDag } = await starta(t, () => TOMT_SVAR);

  for (const dag of ['imorgon', '2026-02-30']) {
    assert.throws(
      () => bytDag(dag),
      {
        name: 'Error',
        message: `frozen-dates kräver ett datum som finns i kalendern på formen ÅÅÅÅ-MM-DD, fick "${dag}".`
      },
      `bytDag godtog ${dag}`
    );
  }
});

// (33) Krav 8: högst en levande instans av app.js åt gången, i hela processen.
// Två modulinstanser delar globalThis.fetch och laddarens dag, så den andra
// skriver över den förstas omvärld medan båda lever vidare med var sin lyssnare
// på attrappens element — och node:test kör after-hookar i registreringsordning,
// så den sist registrerade hooken lägger tillbaka en ögonblicksbild som redan
// var det första anropets värde.
//
// Hela texten asserteras, inte bara feltypen: laddaren har fler kast än det
// här, och feltypen delas av dem alla.
const ANDRA_INSTANSEN_AVVISAS =
  'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.';

test('ett andra loadApp i samma testfall avvisas', async (t) => {
  await starta(t, () => TOMT_SVAR);

  await assert.rejects(
    () => starta(t, () => TOMT_SVAR),
    {
      name: 'Error',
      message: ANDRA_INSTANSEN_AVVISAS
    }
  );
});

// Det fall som skiljer villkoret "en levande instans i processen" från det
// tidigare "en laddning per testkontext": ett underordnat test har en egen
// kontext, så en spärr nycklad på kontexten släpper igenom barnets anrop. Då
// lever båda instanserna samtidigt, och granskarens körning visade att
// förälderns formulärsubmit hamnade i barnets fetch-attrapp (LARDOMAR.md
// 2026-09-22). Ett fall som bara laddar två gånger med samma testkontext kan
// inte se den skillnaden.
test('ett loadApp i ett underordnat test avvisas', async (t) => {
  await starta(t, () => TOMT_SVAR);

  await t.test('barnet har en egen testkontext men samma process', async (barn) => {
    await assert.rejects(
      () => starta(barn, () => TOMT_SVAR),
      {
        name: 'Error',
        message: ANDRA_INSTANSEN_AVVISAS
      }
    );
  });
});

// Att återställningen från fallet ovan blev av. De två globalerna prövas på
// olika sätt, och skälet är körmiljön: bara den ena går att jämföra med
// undefined (se FETCH_FORE_TESTERNA ovan).
//
// Att dagen är osatt asserteras inte: det läget syns bara genom att läsa den,
// och varje stavning av den vägen är en träff i klockkontrollen. Avvisningen i
// krav 8 är det som gör påståendet sant i stället — med högst en levande
// instans finns ingen andra ögonblicksbild som kan vinna (ARKITEKTUR.md,
// krav 8).
test('laddarens after-hook lämnar tillbaka globalThis efter ett avvisat andra anrop', () => {
  assert.equal(globalThis.document, undefined, 'globalThis.document står kvar satt efter förra fallet');
  assert.equal(
    globalThis.fetch,
    FETCH_FORE_TESTERNA,
    'globalThis.fetch är inte värdet från före testfallen: attrappen står kvar'
  );
});
