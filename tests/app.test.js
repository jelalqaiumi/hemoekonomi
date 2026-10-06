// src/web/app.js körd mot en incheckad DOM-attrapp [etapp 3].
//
// Filen prövar de två vyerna: inloggningen med engångskod och månadsvyn med
// månadsväljare, summering, tre listor, formulär och diagram. Kravlistan står i
// ARKITEKTUR.md under "Gränssnittet: inloggning och månadsvy", punkt (37) till
// (56); punkt (32) och (33) är kvar från den gamla filen och rör laddaren, inte
// vyn. De testfall som prövade paket 5 till 8:s formulärvy är BORTTAGNA och inte
// bortkommenterade — ett test som prövar en vy som inte finns ser ut som täckning
// utan att vara det.
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

import { monthLabel } from '../src/core/dates.js';
import { CATEGORY_LABELS, INTERVAL_LABELS } from '../src/core/entry.js';
import { divideRoundHalfUp, formatSek } from '../src/core/money.js';
import { createDom, createFetch, flush, idsFranIndexHtml, loadApp } from './helpers/dom.js';

// Text mot användaren som app.js skriver själv, alltså varken hämtar ur svaret
// eller ur src/core/. Den skrivs av här för att jämföras mot vyn. Uppräkningen
// står utan antal och utan ordet enda — ett påstående med siffra blir falskt av
// nästa tillägg (LARDOMAR.md 2026-09-10).
//
// Strängarna skrivs tecken för tecken som ägaren i src/web/app.js skriver dem, så
// att en sökning på hela strängen hittar varje ställe den prövas (LARDOMAR.md
// 2026-09-14). Undantaget är märket för en återkommande post: det är ett tecken
// utanför ASCII som inte är en bokstav i ett svenskt ord, och det skrivs därför
// som escape på båda ställena.
const GENERAL_ERROR = 'Det gick inte att nå appens server. Försök igen.';
const CHART_EMPTY_TEXT = 'Inga utgifter att visa i diagrammet ännu.';
const CHART_TITLE = 'Utgifter per kategori';
const RECURRING_MARK = '\u21bb';
const RECURRING_TITLE = 'Återkommande varje månad';
const TOM_INKOMSTLISTA = 'Inga inkomster i september ännu - lägg till din första.';
const TOM_UTGIFTSLISTA = 'Inga utgifter i september ännu - lägg till din första.';
const TOMT_SPARANDE = 'Inget sparande i september ännu - lägg till ditt första.';

// Värdet globalThis.fetch bär innan något testfall har körts, läst på modulnivå.
// Punkt (33):s sista fall jämför mot det i stället för mot undefined: Node har en
// inbyggd fetch men ingen DOM, så laddaren sparar den inbyggda funktionen i sitt
// tidigareFetch och lägger tillbaka den — rätt beteende, men värdet är då en
// funktion och blir aldrig undefined (ARKITEKTUR.md, "Verifierad miljö").
const FETCH_FORE_TESTERNA = globalThis.fetch;

// Dagen app.js ser är injicerad av laddaren, så varje fall prövar en känd dag och
// kan aldrig bli rött av att dygnet byts mitt i provet (ARKITEKTUR.md, "Klockan
// som app.js läser är injicerad, inte verklig"). Månaden och grannmånaderna står
// skrivna och är inte uträknade här.
const FRYST_IDAG = '2026-09-16';
const MANAD = '2026-09';
const MANAD_RUBRIK = 'September 2026';
const FOREGAENDE_MANAD = '2026-08';
const FOREGAENDE_RUBRIK = 'Augusti 2026';
const MANADSVAG = `/api/manad/${MANAD}`;

// Den dag och de månader årsskiftesfallen behöver, också skrivna.
const FRYST_IDAG_DECEMBER = '2026-12-05';
const DECEMBER = '2026-12';
const JANUARI_NASTA_AR = '2027-01';
const JANUARI_RUBRIK = 'Januari 2027';

const MIG_200 = Object.freeze({ status: 200, json: { email: 'nils@example.se' } });
const MIG_401 = Object.freeze({ status: 401, json: { error: 'Du är inte inloggad.' } });

const NOLLOR = Object.freeze({ incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 });

// En post på samma form som src/server/months.js lämnar den: ören och inte
// kronor, och fälten som säger om posten kommer från en mall.
function post(id, kind, name, amountOre, category, extra = {}) {
  return {
    id,
    kind,
    name,
    amountOre,
    category,
    dueDate: null,
    recurring: false,
    seriesId: null,
    overridden: false,
    // De två fälten posten bär sedan rättelsen "posten bär sitt intervall".
    // null för en engångspost; en mallpost får sina värden genom extra.
    interval: null,
    toMonth: null,
    ...extra
  };
}

function manadssvar(items, totals = NOLLOR) {
  return { status: 200, json: { items, totals } };
}

// Startar app.js med en plan för fetch-attrappen och lämnar tillbaka attrappen,
// anropslistan och bytDag — laddarens väg att sätta en annan dag mitt i ett fall.
async function starta(t, plan, idag = FRYST_IDAG) {
  const dom = createDom();
  // Det första anropet måste besvaras med en gång: app.js har ett await på
  // toppnivå, så modulen laddas inte färdigt förrän GET /api/mig är besvarad. En
  // plan som lämnar just det anropet hängande skulle ge en väntan utan exitkod,
  // och en hängning är sämre än ett fel — därför blir ett hängande första anrop
  // ett avvisat fetch i stället, och fallet faller på sin egen assertion.
  const forstaSvaretMasteKomma = (anropet, index) => {
    const svar = plan(anropet, index);
    if (index === 0 && svar === null) {
      return new Error('planen lämnade app.js första anrop hängande');
    }
    return svar;
  };
  const { fetch, anrop } = createFetch(forstaSvaretMasteKomma);
  const { bytDag } = await loadApp(t, { document: dom.document, fetch, idag });
  return { dom, anrop, bytDag };
}

// En plan för en inloggad session: 200 på GET /api/mig, månadssvaret ur
// hamtaManad på varje GET av en månad, och resten till ovrigt.
function planInloggad(hamtaManad, ovrigt = () => null) {
  return (anropet, index) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.method === 'GET') {
      return hamtaManad(anropet.url);
    }
    return ovrigt(anropet, index);
  };
}

// Svaren i tur och ordning, det sista upprepat. Formen finns för de fall som
// renderar två gånger med olika indata: en rad som bygger men aldrig tömmer fälls
// bara av en andra rendering vars utgångsläge är den förstas motsats
// (LARDOMAR.md 2026-09-12).
function ikoordning(svar) {
  let nasta = 0;
  return () => svar[Math.min(nasta++, svar.length - 1)];
}

function celltext(rad, className) {
  const cell = rad.children.find((barn) => barn.className === className);
  assert.notEqual(cell, undefined, `raden saknar cellen ${className}`);
  return cell.textContent;
}

function knapp(rad, className) {
  const element = rad.children.find((barn) => barn.className === className);
  assert.notEqual(element, undefined, `raden saknar knappen ${className}`);
  return element;
}

function namnen(dom, listId) {
  return dom.rader(listId).map((rad) => celltext(rad, 'item-name'));
}

function fyllFormularet(dom, { name = 'Hyra', amountSek = '1234,50', category = 'housing' } = {}) {
  dom.falt('item-name').value = name;
  dom.falt('item-amount').value = amountSek;
  dom.falt('item-category').value = category;
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

function kropp(anropet) {
  return JSON.parse(anropet.body);
}

// ------------------------------------------------------- (37) och (38) vyerna

test('(37) ett 401 vid laddningen visar inloggningsvyn och döljer månadsvyn', async (t) => {
  const { dom, anrop } = await starta(t, () => MIG_401);

  // Ett enda anrop: månaden hämtas aldrig utan session.
  assert.equal(anrop.length, 1);
  assert.equal(anrop[0].method, 'GET');
  assert.equal(anrop[0].url, '/api/mig');

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  // Steg ett syns, steg två är dolt: e-postfältet är det användaren möter.
  assert.equal(dom.falt('login-step-email').hidden, false);
  assert.equal(dom.falt('login-step-code').hidden, true);
  // Ingen feltext vid ett 401: inloggningsvyn är beskedet, och "Du är inte
  // inloggad." vore ett besked användaren inte har bett om.
  assert.equal(dom.falt('login-error').textContent, '');
});

test('(38) ett 200 vid laddningen visar månadsvyn med månadens namn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(anrop.length, 2);
  assert.equal(anrop[1].method, 'GET');
  assert.equal(anrop[1].url, MANADSVAG);

  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('month-label').textContent, MANAD_RUBRIK);
  // Kategorierna i formuläret kommer ur src/core/entry.js. Ingen svensk etikett
  // skrivs för hand i app.js.
  const val = dom.falt('item-category').children;
  assert.deepEqual(val.map((option) => option.value), Object.keys(CATEGORY_LABELS));
  assert.deepEqual(val.map((option) => option.textContent), Object.values(CATEGORY_LABELS));
  // Formuläret öppnas av en knapp och är dolt vid start.
  assert.equal(dom.falt('item-form-card').hidden, true);
});

// ------------------------------------------------------ (39) till (41) månaden

test('(39) månadsvyn öppnar den aktuella månaden, räknad ur den frysta dagen', async (t) => {
  // Dagen är den femte december, alltså en annan månad än i övriga fall: en
  // hårdkodad månad i app.js skulle passera de andra fallen men inte det här.
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])), FRYST_IDAG_DECEMBER);

  assert.equal(anrop[1].url, `/api/manad/${DECEMBER}`);
  assert.equal(dom.falt('month-label').textContent, 'December 2026');
});

test('(40) bakåtknappen hämtar föregående månad och byter rubrik', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('month-prev').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(anrop[2].method, 'GET');
  assert.equal(anrop[2].url, `/api/manad/${FOREGAENDE_MANAD}`);
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);
  // Tomtexterna bär den nya månadens namn, inte den gamlas.
  assert.equal(dom.falt('income-empty').textContent, 'Inga inkomster i augusti ännu - lägg till din första.');
});

test('(41) framåtknappen hämtar nästa månad, också över ett årsskifte', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])), FRYST_IDAG_DECEMBER);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(anrop[2].url, `/api/manad/${JANUARI_NASTA_AR}`);
  assert.equal(dom.falt('month-label').textContent, JANUARI_RUBRIK);

  // Ett andra steg framåt räknar vidare från januari och inte från dagens månad.
  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(anrop[3].url, '/api/manad/2027-02');
  assert.equal(dom.falt('month-label').textContent, 'Februari 2027');
});

// -------------------------------------------------- (42) till (45) summeringen

test('(42) summeringens fyra rader kommer ur svarets totals', async (t) => {
  const totals = { incomeOre: 3000000, expenseOre: 1850000, savingOre: 500000, leftOre: 650000 };
  const { dom } = await starta(t, planInloggad(() => manadssvar([], totals)));

  assert.equal(dom.falt('total-income').textContent, formatSek(3000000));
  assert.equal(dom.falt('total-expense').textContent, formatSek(1850000));
  assert.equal(dom.falt('total-saving').textContent, formatSek(500000));
  assert.equal(dom.falt('total-left').textContent, formatSek(650000));
});

test('(43) ett negativt leftOre ger left-negative och noll ger left-positive', async (t) => {
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar([], { incomeOre: 1000000, expenseOre: 1500000, savingOre: 0, leftOre: -500000 }),
        manadssvar([], NOLLOR)
      ])
    )
  );

  assert.equal(dom.falt('total-left').textContent, formatSek(-500000));
  assert.equal(dom.falt('total-left').className.includes('left-negative'), true, dom.falt('total-left').className);
  assert.equal(dom.falt('total-left').className.includes('left-positive'), false);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  // Noll räknas som positivt: en budget som går jämnt upp är inget problem.
  assert.equal(dom.falt('total-left').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').className.includes('left-positive'), true, dom.falt('total-left').className);
  assert.equal(dom.falt('total-left').className.includes('left-negative'), false);
});

test('(44) varje tom lista visar sin egen text med månadens namn i gemener', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('income-empty').textContent, TOM_INKOMSTLISTA);
  assert.equal(dom.falt('expense-empty').textContent, TOM_UTGIFTSLISTA);
  assert.equal(dom.falt('saving-empty').textContent, TOMT_SPARANDE);
  assert.equal(dom.rader('income-list').length, 0);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.rader('saving-list').length, 0);
});

test('(45) summeringen visas med fyra nollor också när alla tre listorna är tomma', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  const noll = formatSek(0);
  assert.equal(dom.falt('total-income').textContent, noll);
  assert.equal(dom.falt('total-expense').textContent, noll);
  assert.equal(dom.falt('total-saving').textContent, noll);
  assert.equal(dom.falt('total-left').textContent, noll);
});

// ---------------------------------------------------- (46) posterna i listorna

function treSlagsposter() {
  return [
    post('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'income', 'Lön', 3000000, 'other'),
    post('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'expense', 'Hyra', 1200000, 'housing', {
      recurring: true,
      seriesId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      dueDate: '2026-09-28'
    }),
    post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 25000, 'other'),
    post('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', 'saving', 'Buffert', 500000, 'other')
  ];
}

test('(46) en mallpost märks med tecknet och titeln, en engångspost saknar dem', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar(treSlagsposter())));

  // Posterna ligger i sin egen lista och i svarets ordning.
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra', 'Bio']);
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
  // Tomtexten är borta ur de listor som har poster.
  assert.equal(dom.falt('income-empty').textContent, '');

  const [hyra, bio] = dom.rader('expense-list');
  assert.equal(celltext(hyra, 'item-category'), CATEGORY_LABELS.housing);
  assert.equal(celltext(hyra, 'item-amount'), formatSek(1200000));

  // Mallposten: märket och titeln.
  const marke = hyra.children.find((barn) => barn.className === 'item-recurring');
  assert.notEqual(marke, undefined, 'mallposten saknar märket');
  assert.equal(marke.textContent, RECURRING_MARK);
  assert.equal(marke.title, RECURRING_TITLE);

  // Engångsposten: inget märke alls.
  assert.equal(bio.children.find((barn) => barn.className === 'item-recurring'), undefined);

  // Varje rad har de två knapparna.
  assert.equal(knapp(bio, 'edit').textContent, 'Ändra');
  assert.equal(knapp(bio, 'remove').textContent, 'Ta bort');
});

// --------------------------------------------------- (47) och (48) diagrammet

function svgen(dom) {
  const barn = dom.falt('chart').children;
  assert.equal(barn.length, 1, 'diagrammet har inte exakt ett barn');
  return barn[0];
}

function elementen(svg, tagName) {
  return svg.children.filter((barn) => barn.tagName === tagName);
}

function medKlass(svg, className) {
  return elementen(svg, 'text').filter((barn) => barn.getAttribute('class') === className);
}

test('(47) diagrammet har en stapel per kategori med utgift och ingen för en kategori utan', async (t) => {
  const poster = [
    // Inkomsten ligger i kategorin Övrigt och får inte ge någon stapel: bara
    // utgifter räknas.
    post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other'),
    post('22222222-2222-4222-8222-222222222222', 'expense', 'Hyra', 1500000, 'housing'),
    post('33333333-3333-4333-8333-333333333333', 'expense', 'Hemförsäkring', 500000, 'insurance'),
    // Två utgifter i samma kategori: kategorin ska ge en stapel, inte två.
    post('44444444-4444-4444-8444-444444444444', 'expense', 'Buss', 200000, 'transport'),
    post('55555555-5555-4555-8555-555555555555', 'expense', 'Bensin', 100000, 'transport')
  ];
  const { dom } = await starta(t, planInloggad(() => manadssvar(poster)));

  const svg = svgen(dom);
  assert.equal(svg.tagName, 'svg');
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('role'), 'img');
  const titlar = elementen(svg, 'title');
  assert.equal(titlar.length, 1);
  assert.equal(titlar[0].textContent, CHART_TITLE);

  // Tre kategorier med utgift, alltså tre staplar — och ingen för Övrigt, som
  // bara har en inkomst.
  const staplar = elementen(svg, 'rect');
  assert.equal(staplar.length, 3);

  const etiketter = medKlass(svg, 'chart-label');
  assert.deepEqual(etiketter.map((barn) => barn.textContent), [
    CATEGORY_LABELS.housing,
    CATEGORY_LABELS.insurance,
    CATEGORY_LABELS.transport
  ]);
  assert.equal(etiketter.some((barn) => barn.textContent === CATEGORY_LABELS.other), false);

  // Beloppet per kategori är summan av kategorins utgifter: 3 000 kr för
  // Transport, alltså inte 2 000 och inte 1 000.
  assert.deepEqual(medKlass(svg, 'chart-amount').map((barn) => barn.textContent), [
    formatSek(1500000),
    formatSek(500000),
    formatSek(300000)
  ]);

  // Längden är andelen av den STÖRSTA kategorin: Boende fyller bredden, och de
  // andra står i proportion till den. Andel av totalen hade gett 65, 22 och 13.
  assert.deepEqual(staplar.map((barn) => barn.getAttribute('width')), ['100', '33', '20']);
});

test('(48) inga utgifter i månaden döljer diagrammet och visar texten i stället', async (t) => {
  const poster = [post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other')];
  const { dom } = await starta(t, planInloggad(() => manadssvar(poster)));

  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
});

test('diagrammet och listorna byter innehåll i båda riktningarna när månaden hämtas om', async (t) => {
  // Tre renderingar, och varje elements utgångsläge är motsatsen till det
  // förväntade: utan tom lista efter en full, och utan full efter en tom, kan
  // varken raden som bygger eller raden som tömmer fällas (LARDOMAR.md
  // 2026-09-12, renderUpcomings två nollställningar överlever mutation).
  const inkomstmanad = () => manadssvar([post('11111111-1111-4111-8111-111111111111', 'income', 'Lön', 3000000, 'other')]);
  const utgiftsmanad = () => manadssvar([post('22222222-2222-4222-8222-222222222222', 'expense', 'Hyra', 1500000, 'housing')]);
  const { dom } = await starta(
    t,
    planInloggad(ikoordning([inkomstmanad(), utgiftsmanad(), inkomstmanad()]))
  );

  // Utgångsläget: inga utgifter, alltså inget diagram och en tomtext.
  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);

  // En månad med en utgift: diagrammet byggs, och tomtexten TÖMS — den raden
  // fälls bara av att utgångsläget var en satt text.
  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('chart').children.length, 1);
  assert.equal(dom.falt('chart-empty').textContent, '');
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra']);
  assert.equal(dom.falt('expense-empty').textContent, '');
  // Inkomstlistan är tom igen: raden från förra månaden står inte kvar.
  assert.equal(dom.rader('income-list').length, 0);
  assert.equal(dom.falt('income-empty').textContent, 'Inga inkomster i oktober ännu - lägg till din första.');

  // Och tillbaka: ingen kvarvarande SVG, tomtexten på plats igen, och
  // utgiftsraden borta.
  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();
  assert.equal(dom.falt('chart').children.length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('expense-empty').textContent, 'Inga utgifter i november ännu - lägg till din första.');
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
});

// -------------------------------- (49) till (53) formuläret, ändra och ta bort

test('(49) en ny utgift skickas som POST och hämtar om månaden', async (t) => {
  const nyPost = post('66666666-6666-4666-8666-666666666666', 'expense', 'Hyra', 123450, 'housing');
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar([]),
        manadssvar([nyPost], { incomeOre: 0, expenseOre: 123450, savingOre: 0, leftOre: -123450 })
      ]),
      () => ({ status: 201, json: { item: nyPost } })
    )
  );

  // Formuläret öppnas av knappen i utgiftslistan.
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('add-expense').utlos('click'), true);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-submit').textContent, 'Spara');

  fyllFormularet(dom);
  assert.equal(skickaFormularet(dom), true, 'app.js kallade inte preventDefault');
  await flush();

  assert.equal(anrop.length, 4);
  assert.equal(anrop[2].method, 'POST');
  assert.equal(anrop[2].url, MANADSVAG);
  // Slaget kommer från vilken lista knappen satt i och är inget fält. Beloppet
  // skickas som den råa strängen ur formuläret — ingen egen tolkning i app.js.
  assert.deepEqual(kropp(anrop[2]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '1234,50',
    category: 'housing'
  });

  // Direktuppdateringen: ett GET för samma månad, och listan växer.
  assert.equal(anrop[3].method, 'GET');
  assert.equal(anrop[3].url, MANADSVAG);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra']);
  assert.equal(dom.falt('total-expense').textContent, formatSek(123450));
  // Formuläret stängs OCH nollställs efter en lyckad sparning: ett dolt formulär
  // ska inte bära den sparade postens värden. Samma closeForm som Avbryt använder,
  // så de två kan inte glida isär.
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
});

test('en ny inkomst och ett nytt sparande skickar sitt eget slag', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({ status: 201, json: { item: null } }))
  );

  for (const [knappId, slag] of [['add-income', 'income'], ['add-saving', 'saving']]) {
    assert.equal(dom.falt(knappId).utlos('click'), true);
    fyllFormularet(dom, { name: 'Post', amountSek: '100', category: 'other' });
    skickaFormularet(dom);
    await flush();
    assert.equal(kropp(anrop.at(-2)).kind, slag, knappId);
  }
});

test('(50) knappen är låst medan anropet pågår och ett andra försök ger inget andra anrop', async (t) => {
  // Planen lämnar POST hängande: knappen ska då vara låst, och ett andra försök
  // ska inte nå servern.
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => null));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(anrop[2].method, 'POST');
  assert.equal(dom.falt('item-submit').disabled, true, 'knappen släpptes innan svaret kom');

  // Ett andra submit medan anropet är i luften. Formulärets eget pågående-läge
  // stoppar det: en submit-händelse behöver inte komma från knappen, så knappens
  // disabled duger inte som enda spärr.
  skickaFormularet(dom);
  await flush();
  assert.equal(anrop.length, 3, 'ett andra försök gav ett andra POST');

  // Svaret kommer, knappen släpps, och omhämtningen blir av.
  anrop[2].svara({ status: 201, json: { item: null } });
  await flush();
  assert.equal(dom.falt('item-submit').disabled, false);
  assert.equal(anrop.length, 4);
  assert.equal(anrop[3].method, 'GET');
});

test('ett andra klick på samma Ta bort-knapp medan anropet är i luften ger inget andra DELETE', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => null));

  const taBort = knapp(dom.rader('saving-list')[0], 'remove');
  assert.equal(taBort.utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(anrop[2].method, 'DELETE');
  assert.equal(taBort.disabled, true);
  // Webbläsaren skickar inget klick till en avstängd knapp, och attrappen gör
  // likadant: utlos svarar false utan att kalla lyssnaren.
  assert.equal(taBort.utlos('click'), false);
  await flush();
  assert.equal(anrop.length, 3);
});

test('(51) Ta bort hämtar om månaden, listan krymper och summorna ändras', async (t) => {
  const kvar = [post('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'income', 'Lön', 3000000, 'other')];
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([
        manadssvar(
          [...kvar, post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 25000, 'other')],
          { incomeOre: 3000000, expenseOre: 25000, savingOre: 0, leftOre: 2975000 }
        ),
        manadssvar(kvar, { incomeOre: 3000000, expenseOre: 0, savingOre: 0, leftOre: 3000000 })
      ]),
      () => ({ status: 204 })
    )
  );

  assert.equal(dom.rader('expense-list').length, 1);
  assert.equal(dom.falt('total-expense').textContent, formatSek(25000));

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(anrop[2].method, 'DELETE');
  assert.equal(anrop[2].url, '/api/poster/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.equal(anrop[3].method, 'GET');
  assert.equal(anrop[3].url, MANADSVAG);

  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('expense-empty').textContent, TOM_UTGIFTSLISTA);
  assert.equal(dom.falt('total-expense').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').textContent, formatSek(3000000));
});

test('(52) Ändra fyller formuläret och sparar posten med PUT', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 200, json: { item: bio } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');

  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-name').value, 'Bio');
  // Fältet är kronor, posten bär ören: 19950 ören är 199,50 kr, skrivet som
  // fältet skriver det.
  assert.equal(dom.falt('item-amount').value, '199.5');
  assert.equal(dom.falt('item-category').value, 'subscription');
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');

  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[2].method, 'PUT');
  assert.equal(anrop[2].url, '/api/poster/dddddddd-dddd-4ddd-8ddd-dddddddddddd');
  assert.deepEqual(kropp(anrop[2]), {
    kind: 'expense',
    name: 'Bio',
    amountSek: '199.5',
    category: 'subscription'
  });
  // Direktuppdateringen sker också efter en ändring.
  assert.equal(anrop[3].method, 'GET');
  assert.equal(anrop[3].url, MANADSVAG);
});

test('en ny post efter en ändring skickas som POST med tomma fält', async (t) => {
  // Formuläret är samma element i båda fallen. Utan nollställningen bär det
  // föregående postens värden, och utan bytet av id blir en ny post ett PUT.
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 201, json: { item: null } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('item-name').value, 'Bio');

  dom.falt('add-income').utlos('click');
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
  assert.equal(dom.falt('item-submit').textContent, 'Spara');

  fyllFormularet(dom, { name: 'Lön', amountSek: '30000', category: 'other' });
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[2].method, 'POST');
  assert.equal(anrop[2].url, MANADSVAG);
  assert.equal(kropp(anrop[2]).kind, 'income');
});

test('(53) ett 400 visar fältfelen vid sina fält och skapar ingen post', async (t) => {
  const svar = {
    status: 400,
    json: {
      error: 'Namnet får inte vara tomt.',
      fieldErrors: [
        { field: 'name', message: 'Namnet får inte vara tomt.' },
        { field: 'amountSek', message: 'Beloppet måste vara större än 0 kr.' }
      ]
    }
  };
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom, { name: '', amountSek: '0' });
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.faltfel('name'), 'Namnet får inte vara tomt.');
  assert.equal(dom.faltfel('amountSek'), 'Beloppet måste vara större än 0 kr.');
  assert.equal(dom.faltfel('category'), '');
  // Den allmänna rutan står tom när fältfelen visades: samma text två gånger på
  // skärmen är ett fel.
  assert.equal(dom.falt('item-form-error').textContent, '');
  // Ingen omhämtning: posten skapades inte, och formuläret står kvar öppet med
  // användarens värden.
  assert.equal(anrop.length, 3);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.rader('expense-list').length, 0);
});

test('ett fel utan fältfel visar serverns text i formulärets allmänna ruta', async (t) => {
  const svar = { status: 500, json: { error: 'Det gick inte att spara. Försök igen.' } };
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('item-form-error').textContent, 'Det gick inte att spara. Försök igen.');
  assert.equal(dom.faltfel('name'), '');
});

test('ett avvisat fetch vid sparningen visar den allmänna texten och släpper knappen', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => new Error('nätet nere')));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('item-form-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('item-submit').disabled, false);
});

test('ett 404 vid Ta bort visar serverns text i månadsvyns allmänna ruta', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar(treSlagsposter()), () => ({ status: 404, json: { error: 'Posten finns inte.' } }))
  );

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, 'Posten finns inte.');
  // Ingen omhämtning på ett 404: vyn står kvar som den var.
  assert.equal(anrop.length, 3);
  assert.equal(dom.rader('saving-list').length, 1);
});

// ---------------------------------------------------- (54) sessionen går ut

test('(54) ett 401 vid en omhämtning visar inloggningsvyn och döljer månadsvyn', async (t) => {
  const { dom } = await starta(t, planInloggad(ikoordning([manadssvar([]), MIG_401])));

  assert.equal(dom.falt('month-view').hidden, false);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  // Steg ett igen: koden från förra sessionen duger inte.
  assert.equal(dom.falt('login-step-email').hidden, false);
  assert.equal(dom.falt('login-step-code').hidden, true);
  // Månadsvyns felruta bär ingen text: vyn är beskedet.
  assert.equal(dom.falt('month-error').textContent, '');
});

test('ett 401 på en sparning visar inloggningsvyn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([]), () => MIG_401));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  // Ingen omhämtning och inget fältfel: sessionen är slut.
  assert.equal(anrop.length, 3);
  assert.equal(dom.falt('item-form-error').textContent, '');
});

test('ett 401 på en borttagning visar inloggningsvyn', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => MIG_401));

  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(anrop.length, 3);
  assert.equal(dom.falt('month-error').textContent, '');
});

// ---------------------------------------------------------- inloggningsflödet

test('Skicka kod ger steg två med adressen i texten', async (t) => {
  const { dom, anrop } = await starta(t, (anropet) => (anropet.url === '/api/mig' ? MIG_401 : { status: 202 }));

  dom.falt('login-email').value = 'nils@example.se';
  assert.equal(dom.falt('send-code').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 2);
  assert.equal(anrop[1].method, 'POST');
  assert.equal(anrop[1].url, '/api/auth/kod');
  assert.deepEqual(kropp(anrop[1]), { email: 'nils@example.se' });

  assert.equal(dom.falt('login-step-email').hidden, true);
  assert.equal(dom.falt('login-step-code').hidden, false);
  assert.equal(dom.falt('code-sent').textContent, 'En kod är skickad till nils@example.se. Den gäller i tio minuter.');
  assert.equal(dom.falt('login-error').textContent, '');
});

test('en kod som stämmer frågar vem som är inloggad och laddar månadsvyn', async (t) => {
  // Det första svaret på /api/mig är 401, det andra 200: sessionen finns först
  // efter den lyckade inloggningen. Adressen i svaret står i gemener medan
  // användaren skrev en versal — servern normaliserar e-posten med trim och
  // gemener, och det är serverns adress som ska stå i vyn.
  let migAnrop = 0;
  const { dom, anrop } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig') {
      migAnrop += 1;
      return migAnrop === 1 ? MIG_401 : { status: 200, json: { email: 'nils@example.se' } };
    }
    if (anropet.url === '/api/auth/kod') {
      return { status: 202 };
    }
    if (anropet.url === '/api/auth/logga-in') {
      return { status: 204 };
    }
    return manadssvar([]);
  });

  dom.falt('login-email').value = 'Nils@Example.se';
  dom.falt('send-code').utlos('click');
  await flush();

  dom.falt('login-code').value = '123456';
  assert.equal(dom.falt('log-in').utlos('click'), true);
  await flush();

  assert.equal(anrop[2].url, '/api/auth/logga-in');
  assert.deepEqual(kropp(anrop[2]), { email: 'Nils@Example.se', code: '123456' });
  // Vilken vy som syns avgörs av GET /api/mig och av ingenting annat: därför ett
  // andra anrop dit, och först därefter månaden.
  assert.equal(anrop[3].url, '/api/mig');
  assert.equal(anrop[4].url, MANADSVAG);
  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('month-label').textContent, MANAD_RUBRIK);
  // Serverns adress, inte den användaren skrev.
  assert.equal(dom.falt('user-email').textContent, 'nils@example.se');
});

test('en kod som inte stämmer visar serverns text ordagrant', async (t) => {
  const serverns = 'Koden stämmer inte. Begär en ny kod och försök igen.';
  const { dom } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_401;
    }
    if (anropet.url === '/api/auth/kod') {
      return { status: 202 };
    }
    return { status: 400, json: { error: serverns } };
  });

  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('send-code').utlos('click');
  await flush();
  dom.falt('login-code').value = '000000';
  dom.falt('log-in').utlos('click');
  await flush();

  assert.equal(dom.falt('login-error').textContent, serverns);
  // Kvar i steg två: användaren ska kunna skriva om koden.
  assert.equal(dom.falt('login-step-code').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
});

test('en spärrad adress visar serverns 429-text och stannar i steg ett', async (t) => {
  const serverns = 'För många koder till den här adressen. Försök igen om en stund.';
  const { dom } = await starta(
    t,
    (anropet) => (anropet.url === '/api/mig' ? MIG_401 : { status: 429, json: { error: serverns } })
  );

  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('send-code').utlos('click');
  await flush();

  assert.equal(dom.falt('login-error').textContent, serverns);
  assert.equal(dom.falt('login-step-email').hidden, false);
  assert.equal(dom.falt('login-step-code').hidden, true);
  assert.equal(dom.falt('code-sent').textContent, '');
});

test('Använd en annan adress går tillbaka till steg ett och tömmer koden', async (t) => {
  const { dom } = await starta(t, (anropet) => (anropet.url === '/api/mig' ? MIG_401 : { status: 202 }));

  dom.falt('login-email').value = 'nils@example.se';
  dom.falt('send-code').utlos('click');
  await flush();
  dom.falt('login-code').value = '123456';

  assert.equal(dom.falt('use-other-email').utlos('click'), true);

  assert.equal(dom.falt('login-step-email').hidden, false);
  assert.equal(dom.falt('login-step-code').hidden, true);
  assert.equal(dom.falt('code-sent').textContent, '');
  assert.equal(dom.falt('login-code').value, '');
});

// ------------------------------------------------------- vyn när något går fel

test('ett avvisat fetch vid laddningen visar den allmänna texten i inloggningsvyn', async (t) => {
  const { dom } = await starta(t, () => new Error('nätet nere'));

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('login-error').textContent, GENERAL_ERROR);
});

test('ett 500 vid laddningen visar serverns text i inloggningsvyn', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(t, () => ({ status: 500, json: { error: serverns } }));

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('login-error').textContent, serverns);
});

test('ett 500 på månadens väg visar serverns text i månadsvyn', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(t, planInloggad(() => ({ status: 500, json: { error: serverns } })));

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('month-error').textContent, serverns);
  assert.equal(dom.falt('month-label').textContent, MANAD_RUBRIK);
});

test('ett avvisat fetch vid en omhämtning visar den allmänna texten', async (t) => {
  const { dom } = await starta(t, planInloggad(ikoordning([manadssvar([]), new Error('nätet nere')])));

  dom.falt('month-next').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('ett 200 utan läsbar JSON-kropp ger nollor och tomma listor och kastar inte', async (t) => {
  // formatSek kastar RangeError för allt som inte är ett heltal, och en kropp som
  // inte går att läsa ger en tom kropp. Vyn visar då nollor i stället för att gå
  // sönder.
  const { dom } = await starta(t, planInloggad(() => ({ status: 200 })));

  assert.equal(dom.falt('total-income').textContent, formatSek(0));
  assert.equal(dom.falt('total-left').textContent, formatSek(0));
  assert.equal(dom.rader('expense-list').length, 0);
  assert.equal(dom.falt('chart-empty').textContent, CHART_EMPTY_TEXT);
});

// ------------------------------ (57) och (58) Logga ut och vem som är inloggad

test('(57) Logga ut anropar utloggningsvägen och visar inloggningsvyn', async (t) => {
  // Planen lämnar utloggningen hängande: knappen ska vara spärrad medan anropet
  // är i luften, och vyn byts först när svaret kommit.
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar(treSlagsposter()), () => null));

  assert.equal(dom.falt('month-view').hidden, false);

  assert.equal(dom.falt('log-out').utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(anrop[2].method, 'POST');
  assert.equal(anrop[2].url, '/api/auth/logga-ut');
  assert.equal(dom.falt('log-out').disabled, true, 'knappen släpptes innan svaret kom');
  assert.equal(dom.falt('month-view').hidden, false, 'vyn byttes innan svaret kom');
  // Ett andra klick medan anropet är i luften ger inget andra anrop.
  assert.equal(dom.falt('log-out').utlos('click'), false);
  assert.equal(anrop.length, 3);

  anrop[2].svara({ status: 204 });
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  // Steg ett: nästa användare ska börja med sin egen adress.
  assert.equal(dom.falt('login-step-email').hidden, false);
  assert.equal(dom.falt('login-step-code').hidden, true);
  assert.equal(dom.falt('log-out').disabled, false);
});

test('ett avvisat fetch vid Logga ut lämnar användaren i månadsvyn med den allmänna texten', async (t) => {
  // Vägen svarar 204 även utan giltig session, så det finns ingen felstatus att
  // pröva. Det enda felet är ett anrop som inte kommer fram.
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar(treSlagsposter()), () => new Error('nätet nere'))
  );

  dom.falt('log-out').utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('login-view').hidden, true);
  // Posterna står kvar: ingenting i vyn nollställs av ett fel.
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
});

test('(58) den inloggade adressen står i månadsvyn', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([])));

  // MIG_200 bär adressen, och det är den som visas — appen skriver aldrig en
  // adress den inte har fått ur svaret.
  assert.equal(dom.falt('user-email').textContent, 'nils@example.se');
});

test('ett 200 från /api/mig utan läsbar kropp visar ingen adress', async (t) => {
  // textContent = undefined skriver strängen "undefined" i webbläsaren, och det
  // vore en adress appen inte har fått.
  const { dom } = await starta(t, (anropet) => (anropet.url === '/api/mig' ? { status: 200 } : manadssvar([])));

  assert.equal(dom.falt('user-email').textContent, '');
  assert.equal(dom.falt('month-view').hidden, false);
});

// ----------------------------------------------------- (59) och (60) Avbryt

test('(59) Avbryt stänger formuläret, tömmer fälten och skickar inget anrop', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  assert.equal(dom.falt('item-form-card').hidden, false);

  assert.equal(dom.falt('item-cancel').utlos('click'), true);

  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-name').value, '');
  assert.equal(dom.falt('item-amount').value, '');
  // Anropslistan är oförändrad: de två anropen är laddningens.
  assert.equal(anrop.length, 2);
});

test('(60) Avbryt rensar fältfelen, så att formuläret öppnas rent nästa gång', async (t) => {
  const svar = {
    status: 400,
    json: {
      error: 'Namnet får inte vara tomt.',
      fieldErrors: [{ field: 'name', message: 'Namnet får inte vara tomt.' }]
    }
  };
  const { dom } = await starta(t, planInloggad(() => manadssvar([]), () => svar));

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom, { name: '' });
  skickaFormularet(dom);
  await flush();
  // Utgångsläget är ett synligt fältfel: utan det kan raden som rensar inte
  // fällas (LARDOMAR.md 2026-09-10).
  assert.equal(dom.faltfel('name'), 'Namnet får inte vara tomt.');

  dom.falt('item-cancel').utlos('click');
  assert.equal(dom.faltfel('name'), '');

  dom.falt('add-income').utlos('click');
  assert.equal(dom.faltfel('name'), '');
});

// --------------------------- (61) till (63) vyn när en hämtning misslyckas

// Posterna och summorna som ska stå kvar. Samma lista i alla tre fallen, så att
// "oförändrad" betyder samma sak i var och en.
const STAENDE_TOTALER = Object.freeze({
  incomeOre: 3000000,
  expenseOre: 1225000,
  savingOre: 500000,
  leftOre: 1275000
});

function kravVynStaende(dom) {
  assert.deepEqual(namnen(dom, 'income-list'), ['Lön']);
  assert.deepEqual(namnen(dom, 'expense-list'), ['Hyra', 'Bio']);
  assert.deepEqual(namnen(dom, 'saving-list'), ['Buffert']);
  assert.equal(dom.falt('total-income').textContent, formatSek(3000000));
  assert.equal(dom.falt('total-expense').textContent, formatSek(1225000));
  assert.equal(dom.falt('total-saving').textContent, formatSek(500000));
  assert.equal(dom.falt('total-left').textContent, formatSek(1275000));
  // Diagrammet står kvar det också: det är en del av samma vy.
  assert.equal(dom.falt('chart').children.length, 1);
  assert.equal(dom.falt('chart-empty').textContent, '');
}

test('(61) ett misslyckat GET lämnar listorna, summeringen och diagrammet stående', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([manadssvar(treSlagsposter(), STAENDE_TOTALER), { status: 500, json: { error: serverns } }])
    )
  );

  kravVynStaende(dom);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('month-error').textContent, serverns);
  // Vyn nollställs aldrig av ett fel: en summa från föregående lyckade hämtning
  // är fortfarande sann om just den månaden.
  kravVynStaende(dom);
  assert.equal(dom.falt('month-view').hidden, false);
});

test('(62) en misslyckad omhämtning efter en ändring lämnar vyn stående', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      ikoordning([manadssvar(treSlagsposter(), STAENDE_TOTALER), { status: 500, json: { error: serverns } }]),
      () => ({ status: 204 })
    )
  );

  kravVynStaende(dom);

  // Borttagningen lyckas, omhämtningen misslyckas.
  knapp(dom.rader('saving-list')[0], 'remove').utlos('click');
  await flush();

  assert.equal(anrop[2].method, 'DELETE');
  assert.equal(anrop[3].method, 'GET');
  assert.equal(dom.falt('month-error').textContent, serverns);
  kravVynStaende(dom);
});

test('en pågående hämtning lämnar den gamla feltexten kvar tills svaret kommit', async (t) => {
  // Fallet där tömningens PLACERING ändrar svaret: raden står på den lyckade
  // vägen och inte först i loadMonth, så texten står kvar tills appen vet
  // utfallet. Töms den vid anropets början försvinner beskedet medan vyn
  // fortfarande visar den månad texten gäller (LARDOMAR.md 2026-09-02).
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(ikoordning([{ status: 500, json: { error: serverns } }, null]))
  );

  assert.equal(dom.falt('month-error').textContent, serverns);

  dom.falt('month-next').utlos('click');
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(dom.falt('month-error').textContent, serverns, 'texten försvann innan svaret kom');

  anrop[2].svara(manadssvar(treSlagsposter(), STAENDE_TOTALER));
  await flush();

  assert.equal(dom.falt('month-error').textContent, '');
  kravVynStaende(dom);
});

test('(63) #month-error töms vid en lyckad hämtning', async (t) => {
  const serverns = 'Det gick inte att läsa dina uppgifter. Försök igen.';
  const { dom } = await starta(
    t,
    planInloggad(
      ikoordning([{ status: 500, json: { error: serverns } }, manadssvar(treSlagsposter(), STAENDE_TOTALER)])
    )
  );

  // Utgångsläget är en satt text: utan den kan raden som tömmer inte fällas.
  assert.equal(dom.falt('month-error').textContent, serverns);

  assert.equal(dom.falt('month-next').utlos('click'), true);
  await flush();

  assert.equal(dom.falt('month-error').textContent, '');
  kravVynStaende(dom);
});

// ------------------- (64) till (67) återkommande poster [etapp 4]

// Frågornas texter och de två valen, ur tabellen under "Gränssnittets två frågor
// skrivs om" i ARKITEKTUR.md. Strängarna skrivs tecken för tecken som ägaren i
// src/web/app.js skriver dem (LARDOMAR.md 2026-09-14). Månadens namn är samma
// sträng som månadsväljarens rubrik, alltså monthLabel, och står skriven här och
// inte uträknad.
const EDIT_QUESTION = 'Vad ska ändras?';
const REMOVE_QUESTION = 'Vad ska tas bort?';
const BARA_MANADEN = `Bara ${MANAD_RUBRIK}`;
const FRAN_OCH_MED_MANADEN = `Från och med ${MANAD_RUBRIK}`;

// En post som kommer från en mall, på samma form som src/server/months.js lämnar
// den: recurring och seriesId satta, och seriens id är en annan sträng än
// postens — mallvägen tar seriens, månadsvägen postens, och ett test där de två
// är samma sträng kan inte skilja vägarna åt (LARDOMAR.md 2026-09-16).
const MALL_ID = '11111111-1111-4111-8111-111111111111';
const SERIE_ID = '22222222-2222-4222-8222-222222222222';

function mallpost(extra = {}) {
  return post(MALL_ID, 'expense', 'Hyra', 1200000, 'housing', {
    dueDate: '2026-09-01',
    recurring: true,
    seriesId: SERIE_ID,
    interval: 'quarterly',
    toMonth: '2027-06',
    ...extra
  });
}

// Frågans ruta i en rad, eller undefined när raden inte har någon.
function fragan(rad) {
  return rad.children.find((barn) => barn.className === 'item-question');
}

function fragetext(rad) {
  const ruta = fragan(rad);
  assert.notEqual(ruta, undefined, 'raden saknar frågans ruta');
  return celltext(ruta, 'question-text');
}

function valen(rad) {
  const ruta = fragan(rad);
  assert.notEqual(ruta, undefined, 'raden saknar frågans ruta');
  return ruta.children.filter((barn) => barn.tagName === 'button');
}

function kryssaAterkommande(dom, kryssad) {
  dom.falt('item-recurring').checked = kryssad;
  assert.equal(dom.falt('item-recurring').utlos('change'), true);
}

test('(64) kryssrutan Återkommande öppnar de två fälten, som är dolda tills den kryssas', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([])));

  assert.equal(dom.falt('add-expense').utlos('click'), true);
  // Utgångsläget: rutan är inte kryssad och blocket är dolt.
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  kryssaAterkommande(dom, true);
  assert.equal(dom.falt('recurring-fields').hidden, false);

  // Och tillbaka. Utgångsläget för det här steget är ett öppet block, så raden
  // som döljer fälten fälls av just det.
  kryssaAterkommande(dom, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  // Avbryt nollställer både rutan och blocket: nästa post ska inte ärva
  // återkommande av den förra.
  kryssaAterkommande(dom, true);
  assert.equal(dom.falt('item-cancel').utlos('click'), true);
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  // Intervallets fyra alternativ kommer ur INTERVAL_LABELS och skrivs inte för
  // hand i app.js.
  assert.deepEqual(
    dom.falt('item-interval').children.map((barn) => [barn.value, barn.textContent]),
    Object.entries(INTERVAL_LABELS)
  );
  // Kryssrutan skickar inget anrop: de två anropen är GET /api/mig och månaden.
  assert.equal(anrop.length, 2);
});

test('(64) en ny post med kryssrutan kryssad skapas som en mall med sina sex fält', async (t) => {
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({ status: 201, json: { template: null } }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  kryssaAterkommande(dom, true);
  dom.falt('item-interval').value = 'quarterly';
  // Till och med lämnas tomt: tomt betyder tills vidare, och checkToMonth i
  // src/core/item.js äger den frågan — app.js skickar strängen orörd.
  dom.falt('item-to-month').value = '';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[2].method, 'POST');
  assert.equal(anrop[2].url, `/api/mallar/${MANAD}`);
  assert.deepEqual(kropp(anrop[2]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '1234,50',
    category: 'housing',
    interval: 'quarterly',
    toMonth: ''
  });
  // Månaden hämtas om, och formuläret stängs med rutan nollställd.
  assert.equal(anrop[3].url, MANADSVAG);
  assert.equal(dom.falt('item-form-card').hidden, true);
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);
});

test('ett 400 från mallvägen visar fältfelen vid interval och toMonth', async (t) => {
  // Texterna är ägarnas: intervallets står i src/core/entry.js, slutmånadens i
  // src/core/item.js. app.js skriver dem vid sina fält och aldrig en egen text.
  const intervalltext = 'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.';
  const slutmanadstext = 'Till och med måste anges som ÅÅÅÅ-MM, eller lämnas tomt.';
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([]), () => ({
      status: 400,
      json: {
        error: intervalltext,
        fieldErrors: [
          { field: 'interval', message: intervalltext },
          { field: 'toMonth', message: slutmanadstext }
        ]
      }
    }))
  );

  dom.falt('add-expense').utlos('click');
  fyllFormularet(dom);
  kryssaAterkommande(dom, true);
  dom.falt('item-to-month').value = 'oktober';
  skickaFormularet(dom);
  await flush();

  assert.equal(dom.faltfel('interval'), intervalltext);
  assert.equal(dom.faltfel('toMonth'), slutmanadstext);
  // Fältfelen står vid sina fält och inte i den allmänna rutan, och formuläret
  // står kvar öppet.
  assert.equal(dom.falt('item-form-error').textContent, '');
  assert.equal(dom.falt('item-form-card').hidden, false);
  // Ingen omhämtning: ingen post skapades.
  assert.equal(anrop.length, 3);
});

test('(65) en mallrads Ändra visar två val med månadens namn i och öppnar inget formulär', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  const rad = dom.rader('expense-list')[0];
  // Rutan finns i raden men är tom och dold innan knappen trycks.
  assert.equal(fragan(rad).hidden, true);
  assert.equal(fragan(rad).children.length, 0);

  assert.equal(knapp(rad, 'edit').utlos('click'), true);

  assert.equal(fragan(rad).hidden, false);
  assert.equal(fragetext(rad), EDIT_QUESTION);
  // TVÅ val, inte tre: Hela serien är borttaget av rättelsen av etapp 4, och
  // ingen varningstext finns därför heller.
  assert.deepEqual(valen(rad).map((val) => val.textContent), [BARA_MANADEN, FRAN_OCH_MED_MANADEN]);
  // Frågan kommer före formuläret: Ändra på en mallrad öppnar det inte självt.
  assert.equal(dom.falt('item-form-card').hidden, true);
  // Och frågan skickar inget anrop.
  assert.equal(anrop.length, 2);
});

test('(65) en mallrads Ta bort visar sin egen fråga med samma två val', async (t) => {
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  const rad = dom.rader('expense-list')[0];
  assert.equal(knapp(rad, 'remove').utlos('click'), true);

  assert.equal(fragetext(rad), REMOVE_QUESTION);
  assert.deepEqual(valen(rad).map((val) => val.textContent), [BARA_MANADEN, FRAN_OCH_MED_MANADEN]);
  // Ta bort på en mallrad tar inte bort något självt: frågan kommer först.
  assert.equal(anrop.length, 2);

  // Den andra frågan ersätter den första i samma ruta: en rad frågar en sak i
  // taget. Utgångsläget är borttagningsfrågan, så bytet fälls av det här steget.
  knapp(rad, 'edit').utlos('click');
  assert.equal(fragetext(rad), EDIT_QUESTION);
});

test('en andra frågas öppning stänger den första, så att två rader aldrig frågar samtidigt', async (t) => {
  const andra = mallpost({
    id: '33333333-3333-4333-8333-333333333333',
    name: 'El',
    seriesId: '44444444-4444-4444-8444-444444444444'
  });
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost(), andra])));

  const [hyra, el] = dom.rader('expense-list');
  knapp(hyra, 'remove').utlos('click');
  assert.equal(fragan(hyra).hidden, false);

  knapp(el, 'edit').utlos('click');
  assert.equal(fragan(el).hidden, false);
  assert.equal(fragan(hyra).hidden, true, 'den första frågan står kvar öppen');
});

test('(66) en engångsposts Ändra öppnar formuläret direkt och raden har ingen fråga', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([bio]), () => ({ status: 200, json: { item: bio } }))
  );

  const rad = dom.rader('expense-list')[0];
  // Ingen ruta alls i raden: en engångspost har inget att fråga om.
  assert.equal(fragan(rad), undefined);

  assert.equal(knapp(rad, 'edit').utlos('click'), true);
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-name').value, 'Bio');
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');
  // Kryssrutan står tom och fälten dolda: en engångspost blir inte återkommande
  // av en ändring, och vägen bär varken interval eller toMonth.
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);

  skickaFormularet(dom);
  await flush();

  // Samma väg som före etapp 4: postens egen, varken månadsvägen eller mallvägen.
  assert.equal(anrop[2].method, 'PUT');
  assert.equal(anrop[2].url, `/api/poster/${bio.id}`);
  assert.deepEqual(kropp(anrop[2]), {
    kind: 'expense',
    name: 'Bio',
    amountSek: '199.5',
    category: 'subscription'
  });
});

// (67) i kravlistan prövade varningstexten på valet Hela serien. Valet är
// borttaget av rättelsen av etapp 4, så raden går inte att bygga: det som är
// kvar att pröva är skillnaden mellan de två valen, alltså vilken väg var och en
// anropar. De två raderna (65) och (67) i ARKITEKTUR.md behöver skrivas om.
test('(67) Ändra: Bara månaden går till postens månadsväg, Från och med månaden till mallvägen', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([mall]), () => ({ status: 200, json: { items: [mall], totals: NOLLOR } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[0].utlos('click'), true);

  // Formuläret öppnas ifyllt, med rutan tom: en avvikelse är ingen mall.
  assert.equal(dom.falt('item-form-card').hidden, false);
  assert.equal(dom.falt('item-amount').value, '12000');
  assert.equal(dom.falt('item-recurring').checked, false);
  assert.equal(dom.falt('recurring-fields').hidden, true);
  assert.equal(dom.falt('item-submit').textContent, 'Spara ändring');

  dom.falt('item-amount').value = '13000';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[2].method, 'PUT');
  assert.equal(anrop[2].url, `/api/poster/${MALL_ID}/manad/${MANAD}`);
  // Kroppen bär amountSek och ingenting annat: en avvikelse har bara en kolumn
  // för belopp.
  assert.deepEqual(kropp(anrop[2]), { amountSek: '13000' });
  // Månaden hämtas om: vyn byggs aldrig ur svaret på en ändring.
  assert.equal(anrop[3].method, 'GET');
  assert.equal(anrop[3].url, MANADSVAG);

  // Det andra valet, från samma rad. Nu är rutan kryssad och de två fälten
  // öppna: en ny version av serien är fortfarande en återkommande post.
  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);
  assert.equal(dom.falt('item-recurring').checked, true);
  assert.equal(dom.falt('recurring-fields').hidden, false);

  dom.falt('item-interval').value = 'quarterly';
  dom.falt('item-to-month').value = '2027-03';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[4].method, 'PUT');
  // Seriens id, inte postens: de två vägarna skiljer sig i både sökväg och kropp.
  assert.equal(anrop[4].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  assert.deepEqual(kropp(anrop[4]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '12000',
    category: 'housing',
    interval: 'quarterly',
    toMonth: '2027-03'
  });
  assert.equal(anrop[5].url, MANADSVAG);
});

test('(67) Ta bort: Bara månaden hoppar över månaden, Från och med månaden avslutar serien', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(
      () => manadssvar([mall]),
      ikoordning([{ status: 200, json: { items: [], totals: NOLLOR } }, { status: 204 }])
    )
  );

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[0].utlos('click'), true);
  await flush();

  assert.equal(anrop[2].method, 'PUT');
  assert.equal(anrop[2].url, `/api/poster/${MALL_ID}/manad/${MANAD}`);
  assert.deepEqual(kropp(anrop[2]), { skipped: true });
  assert.equal(anrop[3].method, 'GET');
  assert.equal(anrop[3].url, MANADSVAG);

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);
  await flush();

  assert.equal(anrop[4].method, 'DELETE');
  assert.equal(anrop[4].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  // Vägen har ingen kropp: vad som ska hända står i metoden och i sökvägen.
  assert.equal(anrop[4].body, undefined);
  assert.equal(anrop[5].method, 'GET');
  assert.equal(anrop[5].url, MANADSVAG);
});

test('(70) Från och med förifyller Intervall och Till och med ur posten', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(valen(dom.rader('expense-list')[0])[1].utlos('click'), true);

  // Kvartalsvis, inte månadsvis: fältets första alternativ är monthly, så ett
  // oförifyllt fält hade visat det (ARKITEKTUR.md, rättelsen "posten bär sitt
  // intervall").
  assert.equal(dom.falt('item-interval').value, 'quarterly');
  assert.equal(dom.falt('item-to-month').value, '2027-06');
});

test('(70) en mall utan slutmånad ger ett tomt Till och med, inte strängen null', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost({ toMonth: null })])));

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');

  assert.equal(dom.falt('item-to-month').value, '');
  assert.equal(dom.falt('item-interval').value, 'quarterly');
});

test('(71) en beloppsändring från och med månaden behåller intervallet', async (t) => {
  const mall = mallpost();
  const { dom, anrop } = await starta(
    t,
    planInloggad(() => manadssvar([mall]), () => ({ status: 200, json: { template: null } }))
  );

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');

  // Användaren ändrar BARA beloppet och rör inte intervallfältet. Det är hela
  // fallet: före rättelsen skickades monthly, och kvartalsposten blev
  // månadsvis utan att något varnade.
  dom.falt('item-amount').value = '13000';
  skickaFormularet(dom);
  await flush();

  assert.equal(anrop[2].method, 'PUT');
  assert.equal(anrop[2].url, `/api/mallar/${SERIE_ID}/${MANAD}`);
  assert.deepEqual(kropp(anrop[2]), {
    kind: 'expense',
    name: 'Hyra',
    amountSek: '13000',
    category: 'housing',
    interval: 'quarterly',
    toMonth: '2027-06'
  });
});

test('(72) Bara månaden döljer de fält som inte går att ändra och visar sin rad', async (t) => {
  const { dom } = await starta(t, planInloggad(() => manadssvar([mallpost()])));

  // Utgångsläget är ett formulär där allt syns: fallet öppnar först Från och med,
  // så att varje rad som döljer fälten fälls av bytet.
  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[1].utlos('click');
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('recurring-fields').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
  assert.equal(dom.falt('month-only-note').textContent, '');

  // Bara månaden: namn, kategori, kryssrutan och de två återkommandefälten är
  // dolda. Beloppet syns — det är det enda overrides kan bära.
  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  valen(dom.rader('expense-list')[0])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);
  assert.equal(dom.falt('category-field').hidden, true);
  assert.equal(dom.falt('recurring-field').hidden, true);
  assert.equal(dom.falt('recurring-fields').hidden, true);
  assert.equal(dom.falt('item-amount').value, '12000');
  assert.equal(dom.falt('month-only-note').hidden, false);
  assert.equal(dom.falt('month-only-note').textContent, `Ändrar bara beloppet för ${MANAD_RUBRIK}.`);

  // Avbryt lägger tillbaka den vanliga vyn: nästa post ska inte öppnas utan
  // namnfält.
  assert.equal(dom.falt('item-cancel').utlos('click'), true);
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
  assert.equal(dom.falt('month-only-note').textContent, '');
});

test('(72) en engångsposts Ändra och en ny post visar alla fält', async (t) => {
  const bio = post('dddddddd-dddd-4ddd-8ddd-dddddddddddd', 'expense', 'Bio', 19950, 'subscription');
  const { dom } = await starta(t, planInloggad(() => manadssvar([bio, mallpost()])));

  // Utgångsläget sätts av mallradens Bara månaden, alltså motsatsen till det
  // förväntade: de tre raderna som visar fälten igen fälls bara så.
  knapp(dom.rader('expense-list')[1], 'edit').utlos('click');
  valen(dom.rader('expense-list')[1])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);

  knapp(dom.rader('expense-list')[0], 'edit').utlos('click');
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('category-field').hidden, false);
  assert.equal(dom.falt('recurring-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);

  // Och för en ny post.
  knapp(dom.rader('expense-list')[1], 'edit').utlos('click');
  valen(dom.rader('expense-list')[1])[0].utlos('click');
  assert.equal(dom.falt('name-field').hidden, true);
  assert.equal(dom.falt('add-income').utlos('click'), true);
  assert.equal(dom.falt('name-field').hidden, false);
  assert.equal(dom.falt('month-only-note').hidden, true);
});

test('valet som utlöser ett anrop är låst tills svaret kommit', async (t) => {
  // Planen lämnar ändringen hängande: valet ska då vara låst, och ett andra
  // klick ska inte nå servern.
  const { dom, anrop } = await starta(t, planInloggad(() => manadssvar([mallpost()]), () => null));

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  const bara = valen(dom.rader('expense-list')[0])[0];
  assert.equal(bara.utlos('click'), true);
  await flush();

  assert.equal(anrop.length, 3);
  assert.equal(bara.disabled, true, 'valet släpptes innan svaret kom');
  assert.equal(bara.utlos('click'), false, 'ett låst val tog emot ett klick');
  await flush();
  assert.equal(anrop.length, 3, 'ett andra klick gav ett andra anrop');

  anrop[2].svara({ status: 200, json: { items: [], totals: NOLLOR } });
  await flush();
  assert.equal(anrop.length, 4);
  assert.equal(anrop[3].url, MANADSVAG);
});

test('ett 404 på en avslutad serie visar serverns text och lämnar valet släppt', async (t) => {
  const serverns = 'Posten finns inte.';
  const { dom } = await starta(
    t,
    planInloggad(() => manadssvar([mallpost()]), () => ({ status: 404, json: { error: serverns } }))
  );

  knapp(dom.rader('expense-list')[0], 'remove').utlos('click');
  const franOchMed = valen(dom.rader('expense-list')[0])[1];
  franOchMed.utlos('click');
  await flush();

  assert.equal(dom.falt('month-error').textContent, serverns);
  assert.equal(franOchMed.disabled, false);
  // Frågan står kvar öppen, så att användaren ser felet och kan försöka igen.
  assert.equal(fragan(dom.rader('expense-list')[0]).hidden, false);
});

// ------------------------------------------------ (55) textspärr: summeringen

// Summeringen har inget beteende att pröva som skiljer "ur svaret" från "räknat ur
// posterna": summorna i svaret ÄR summan av posterna, så en mutation till en egen
// addition ger samma tal för varje indata testet kan skriva. Det som återstår är
// en spärr som läser källan. En sådan är aldrig ett skydd i sig — den prövar en
// sträng, inte ett beteende — och den enda anledningen att den duger här är att det
// inte finns något beteende att pröva.
const APP_KALLA_PATH = fileURLToPath(new URL('../src/web/app.js', import.meta.url));
const SUMMAELEMENT = Object.freeze(['TOTAL_INCOME', 'TOTAL_EXPENSE', 'TOTAL_SAVING', 'TOTAL_LEFT']);

test('(55) app.js räknar aldrig fram summeringen själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  // Ingen reduce någonstans i filen: det är det kortaste sättet att skriva om en
  // total till en egen summa.
  assert.equal(
    kalla.includes('.reduce('),
    false,
    'app.js innehåller .reduce( — summeringens tal kommer ur svaret, de summeras inte här'
  );

  // Ingen sats som rör ett summaelement får innehålla en loop eller en reduce.
  // Diagrammets gruppering per kategori använder en for-loop, och den är tillåten
  // — den rör inget av de fyra elementen.
  for (const sats of kalla.split(';')) {
    const traffar = SUMMAELEMENT.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  // Och varje tal läses ur svarets eget fält.
  for (const falt of ['incomeOre', 'expenseOre', 'savingOre', 'leftOre']) {
    assert.equal(kalla.includes(`totals.${falt}`), true, `app.js läser inte totals.${falt} ur svaret`);
  }
});

// ------------------------------------------------------------- (56) attrappen

test('(56) attrappen har exakt de id:n index.html har', async () => {
  // Utan det här fallet kan index.html få ett nytt element som attrappen saknar,
  // och då prövar varje annat fall en DOM som appen aldrig möter.
  assert.deepEqual(createDom().ids, await idsFranIndexHtml());
});

// ---------------------------------------------------- (32) och (33) laddaren

// (32) Spärren i tests/helpers/frozen-dates.js. Ägaren till frågan "är det här en
// dag" är isValidIsoDate i src/core/dates.js och inte ISO_DATE_PATTERN: mönstret
// äger frågan "rätt form" och säger true om 2026-02-30, medan isValidIsoDate äger
// frågan "finns i kalendern" och säger false. Det senare är vad spärren lovar ett
// svar på, så att ett felskrivet argument fälls i laddaren och inte långt inne i
// src/core/.
//
// Därför två argument: imorgon har fel form, 2026-02-30 har rätt form men ingen
// kalenderdag, och det är det senare som avgör ägarvalet. Hela meddelandet
// asserteras och inte bara feltypen: en assertion på enbart feltypen kan inte
// skilja stubbens kast från ett kast längre in.
test('(32) laddarens byte av dag avvisar en dag som inte finns i kalendern', async (t) => {
  const { bytDag } = await starta(t, () => MIG_401);

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

// (33) Krav 8: högst en levande instans av app.js åt gången, i hela processen. Två
// modulinstanser delar globalThis.fetch och laddarens dag, så den andra skriver
// över den förstas omvärld medan båda lever vidare med var sin lyssnare på
// attrappens element.
//
// Hela texten asserteras, inte bara feltypen: laddaren har fler kast än det här,
// och feltypen delas av dem alla.
const ANDRA_INSTANSEN_AVVISAS =
  'loadApp har redan en levande instans av src/web/app.js: ett andra anrop ger två instanser som delar globalThis och laddarens dag. Ett underordnat test har en egen testkontext men samma process.';

test('(33) ett andra loadApp i samma testfall avvisas', async (t) => {
  await starta(t, () => MIG_401);

  await assert.rejects(
    () => starta(t, () => MIG_401),
    {
      name: 'Error',
      message: ANDRA_INSTANSEN_AVVISAS
    }
  );
});

// Det fall som skiljer villkoret "en levande instans i processen" från det
// tidigare "en laddning per testkontext": ett underordnat test har en egen
// kontext, så en spärr nycklad på kontexten släpper igenom barnets anrop.
test('(33) ett loadApp i ett underordnat test avvisas', async (t) => {
  await starta(t, () => MIG_401);

  await t.test('barnet har en egen testkontext men samma process', async (barn) => {
    await assert.rejects(
      () => starta(barn, () => MIG_401),
      {
        name: 'Error',
        message: ANDRA_INSTANSEN_AVVISAS
      }
    );
  });
});

// Att återställningen från fallet ovan blev av. De två globalerna prövas på olika
// sätt, och skälet är körmiljön: bara den ena går att jämföra med undefined (se
// FETCH_FORE_TESTERNA ovan).
test('(33) laddarens after-hook lämnar tillbaka globalThis efter ett avvisat andra anrop', () => {
  assert.equal(globalThis.document, undefined, 'globalThis.document står kvar satt efter förra fallet');
  assert.equal(
    globalThis.fetch,
    FETCH_FORE_TESTERNA,
    'globalThis.fetch är inte värdet från före testfallen: attrappen står kvar'
  );
});

// De tre talen i översikten, som namn i app.js. Textspärren i (75) läser
// källan och letar efter en loop i samma sats som något av dem.
const OVERSIKTSELEMENT = Object.freeze(['OVERVIEW_SAVED', 'OVERVIEW_AVERAGE', 'OVERVIEW_BEST']);

// En inloggad session där EN väg svarar olika i tur och ordning och varje annan
// GET ger en tom månad.
function ikoordningFor(vag, svar) {
  const nasta = ikoordning(svar);
  return (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === vag) {
      return nasta();
    }
    if (anropet.method === 'GET') {
      return manadssvar([]);
    }
    return null;
  };
}

// ------------------------------------------- (73) till (77) översikten [etapp 5]

// Tolv månader som slutar i den visade månaden, äldst först — samma form som
// src/server/months.js lämnar dem: ören, och fyra tal per månad. Talen står
// skrivna och räknas inte här: leftOre är serverns fält, inte testets summa.
//
// Tabellen har en negativ månad (december 2025), en tom månad (februari 2026)
// och en bästa månad (september 2026), så att varje fall nedan har en månad som
// skiljer sig från sina grannar.
const OVERSIKTSMANADER = Object.freeze([
  Object.freeze({ month: '2025-10', incomeOre: 3000000, expenseOre: 1000000, savingOre: 200000, leftOre: 1800000 }),
  Object.freeze({ month: '2025-11', incomeOre: 3000000, expenseOre: 1100000, savingOre: 200000, leftOre: 1700000 }),
  Object.freeze({ month: '2025-12', incomeOre: 3000000, expenseOre: 4000000, savingOre: 200000, leftOre: -1200000 }),
  Object.freeze({ month: '2026-01', incomeOre: 3000000, expenseOre: 900000, savingOre: 300000, leftOre: 1800000 }),
  Object.freeze({ month: '2026-02', incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 }),
  Object.freeze({ month: '2026-03', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-04', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-05', incomeOre: 3000000, expenseOre: 1200000, savingOre: 100000, leftOre: 1700000 }),
  Object.freeze({ month: '2026-06', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-07', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-08', incomeOre: 3000000, expenseOre: 1000000, savingOre: 100000, leftOre: 1900000 }),
  Object.freeze({ month: '2026-09', incomeOre: 3500007, expenseOre: 1000000, savingOre: 100000, leftOre: 2400007 })
]);

// savedThisYear är serverns eget fält och inte serien summerad: värdet är med
// flit ett annat tal än summan av savingOre i de tolv månaderna, som är
// 1600000 ören. En vy som räknade själv skulle visa 1600000 och falla på (75).
const SPARAT_I_AR = 900000;
// Summan av leftOre i serien, skriven ut. 17700007 ören delat på tolv månader är
// 1475000,5833…, alltså ett värde där "halva öret uppåt" och en avhuggning ger
// olika svar — annars kan inget testfall skilja divideRoundHalfUp från
// Math.floor.
const SUMMA_LEFT = 17700007;
const SNITT_LEFT = 1475001;

const OVERSIKTSVAG = `/api/oversikt/${MANAD}`;
const OVERSIKTSVAG_FOREGAENDE = `/api/oversikt/${FOREGAENDE_MANAD}`;
const OVERSIKTSRUBRIK = 'Översikt till och med September 2026';
const OVERSIKT_DIAGRAMTITEL = 'Kvar att leva på per månad';
const OVERSIKTSSVAR = Object.freeze({
  status: 200,
  json: { months: OVERSIKTSMANADER, savedThisYear: SPARAT_I_AR }
});

// En inloggad session där månadsvägen ger en tom månad och översiktsvägen ger
// serien ovan. Skriven för hand i stället för med planInloggad: den planen
// svarar på VARJE GET med månadssvaret, och översikten är en annan väg.
function planOversikt(svar = OVERSIKTSSVAR) {
  return (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === OVERSIKTSVAG || anropet.url === OVERSIKTSVAG_FOREGAENDE) {
      return svar;
    }
    if (anropet.method === 'GET') {
      return manadssvar([]);
    }
    return null;
  };
}

// Öppnar översikten från en inloggad månadsvy.
async function oppnaOversikten(dom) {
  await flush();
  dom.falt('show-overview').utlos('click');
  await flush();
}

// SVG:n i översiktens diagram, plus staplarna och nollinjen var för sig.
function diagrammet(dom) {
  const barn = dom.falt('overview-chart').children;
  assert.equal(barn.length, 1, 'översiktens diagram har ingen SVG');
  const svg = barn[0];
  return {
    svg,
    titel: svg.children.find((element) => element.tagName === 'title'),
    staplar: svg.children.filter((element) => element.tagName === 'rect'),
    linjer: svg.children.filter((element) => element.tagName === 'line')
  };
}

// Cellen Kvar i en tabellrad. Den bär TVÅ klasser — overview-left plus
// left-positive eller left-negative — så celltext, som jämför hela className,
// hittar den inte.
function kvarcell(rad) {
  const cell = rad.children.find((barn) => barn.className.startsWith('overview-left'));
  assert.notEqual(cell, undefined, 'raden saknar cellen Kvar');
  return cell;
}

test('(73) knappen Översikt hämtar översikten och byter vy', async (t) => {
  const { dom, anrop } = await starta(t, planOversikt());
  await flush();

  // Utgångsläget: månadsvyn syns, översikten är dold, och ingen översikt har
  // hämtats.
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG).length, 0);

  dom.falt('show-overview').utlos('click');
  await flush();

  // Ett eget anrop till översiktens väg, med den visade månaden som slutmånad.
  // Antalet månader står inte i adressen.
  const oversikt = anrop.filter((anropet) => anropet.url === OVERSIKTSVAG);
  assert.equal(oversikt.length, 1);
  assert.equal(oversikt[0].method, 'GET');

  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('overview-view').hidden, false);
  assert.equal(dom.falt('login-view').hidden, true);
  assert.equal(dom.falt('overview-label').textContent, OVERSIKTSRUBRIK);
  // Knappen är påslagen igen när svaret kommit.
  assert.equal(dom.falt('show-overview').disabled, false);
});

test('(73) ett misslyckat anrop lämnar användaren i månadsvyn med en feltext', async (t) => {
  const { dom } = await starta(t, (anropet) => {
    if (anropet.url === '/api/mig') {
      return MIG_200;
    }
    if (anropet.url === OVERSIKTSVAG) {
      return new Error('nätverket föll');
    }
    return manadssvar([]);
  });
  await flush();

  dom.falt('show-overview').utlos('click');
  await flush();

  // Vyn byts INTE: en översikt som visas utan data har tre tomma rutor och en
  // tom tabell, alltså ett tillstånd som varken är tolv månader eller
  // månadsvyn (LARDOMAR.md 2026-09-10).
  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(dom.falt('month-error').textContent, GENERAL_ERROR);
  assert.equal(dom.falt('overview-saved').textContent, '');
  assert.equal(dom.rader('overview-rows').length, 0);
  assert.equal(dom.falt('show-overview').disabled, false);
});

test('(73) ett 401 från översikten visar inloggningsvyn och ingen av de två andra', async (t) => {
  const { dom } = await starta(t, planOversikt({ status: 401, json: { error: 'Du är inte inloggad.' } }));
  await flush();

  dom.falt('show-overview').utlos('click');
  await flush();

  assert.equal(dom.falt('login-view').hidden, false);
  assert.equal(dom.falt('month-view').hidden, true);
  assert.equal(dom.falt('overview-view').hidden, true);
});

test('(74) Tillbaka till månaden byter tillbaka till samma månad som innan', async (t) => {
  const { dom, anrop } = await starta(t, planOversikt());
  await flush();

  // Först en annan månad än dagens, så att "samma månad som innan" går att
  // skilja från "dagens månad".
  dom.falt('month-prev').utlos('click');
  await flush();
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);

  dom.falt('show-overview').utlos('click');
  await flush();
  // Slutmånaden är den visade månaden och inte dagens.
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG_FOREGAENDE).length, 1);
  assert.equal(anrop.filter((anropet) => anropet.url === OVERSIKTSVAG).length, 0);
  assert.equal(dom.falt('overview-view').hidden, false);

  const foreTillbaka = anrop.length;
  dom.falt('back-to-month').utlos('click');
  await flush();

  assert.equal(dom.falt('month-view').hidden, false);
  assert.equal(dom.falt('overview-view').hidden, true);
  assert.equal(dom.falt('login-view').hidden, true);
  // Samma månad som innan, och ingen ny hämtning: månadsvyn står kvar som den
  // var.
  assert.equal(dom.falt('month-label').textContent, FOREGAENDE_RUBRIK);
  assert.equal(anrop.length, foreTillbaka);
});

test('(75) de tre talen kommer ur svaret, och snittet avrundas av money.js', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  // Sparat hittills i år är svarets eget fält. Summan av savingOre i serien är
  // 1600000 ören, alltså ett annat tal — en vy som räknade själv skulle visa
  // det.
  assert.equal(dom.falt('overview-saved').textContent, formatSek(SPARAT_I_AR));
  assert.notEqual(formatSek(SPARAT_I_AR), formatSek(1600000));

  // Snittet: det enda tal app.js räknar fram, avrundat med halva öret uppåt av
  // divideRoundHalfUp i src/core/money.js. Facit kommer ur ägaren, och raden
  // efter visar att en avhuggning hade gett ett annat svar.
  assert.equal(dom.falt('overview-average').textContent, formatSek(divideRoundHalfUp(SUMMA_LEFT, 12)));
  assert.equal(dom.falt('overview-average').textContent, formatSek(SNITT_LEFT));
  assert.notEqual(formatSek(SNITT_LEFT), formatSek(Math.floor(SUMMA_LEFT / 12)));

  // Bästa månaden: högst leftOre i serien, skriven med monthLabel.
  assert.equal(dom.falt('overview-best').textContent, monthLabel('2026-09'));
});

test('(75) app.js räknar aldrig fram översiktens tal själv', async () => {
  const kalla = await fs.readFile(APP_KALLA_PATH, 'utf8');

  // Ingen sats som rör ett av de tre talen får innehålla en loop eller en
  // reduce. Diagrammets och tabellens loopar är tillåtna — de rör inget av de
  // tre elementen — och summan bakom snittet byggs i averageLeftOre, i en egen
  // sats. Förbudet mot .reduce( i hela filen står i (55).
  for (const sats of kalla.split(';')) {
    const traffar = OVERSIKTSELEMENT.filter((namn) => sats.includes(namn));
    if (traffar.length === 0) {
      continue;
    }
    for (const forbjudet of ['reduce', 'for (', 'for(']) {
      assert.equal(
        sats.includes(forbjudet),
        false,
        `satsen med ${traffar.join(', ')} innehåller ${forbjudet}: ${sats.trim()}`
      );
    }
  }

  // Sparat hittills i år läses ur svarets eget fält.
  assert.equal(kalla.includes('savedThisYear'), true, 'app.js läser inte savedThisYear ur svaret');
  // Snittet går genom divideRoundHalfUp och aldrig genom / eller Math.round.
  assert.equal(kalla.includes('divideRoundHalfUp('), true, 'app.js avrundar inte snittet med divideRoundHalfUp');
  assert.equal(kalla.includes('Math.round(sum'), false, 'app.js avrundar snittet med Math.round');
});

test('(76) en negativ månad ritas nedåt från nollinjen och i --negativ', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  const { svg, titel, staplar, linjer } = diagrammet(dom);
  assert.equal(svg.namespace, 'http://www.w3.org/2000/svg');
  assert.equal(svg.getAttribute('role'), 'img');
  assert.equal(titel.textContent, OVERSIKT_DIAGRAMTITEL);
  assert.equal(staplar.length, OVERSIKTSMANADER.length);

  // Nollinjen finns och är ritad som en egen linje: utan den går det inte att
  // se vilka månader som gick back.
  assert.equal(linjer.length, 1);
  assert.equal(linjer[0].getAttribute('class'), 'overview-zero-line');
  const nollinje = Number(linjer[0].getAttribute('y1'));
  assert.equal(Number(linjer[0].getAttribute('y2')), nollinje);
  assert.equal(nollinje > 0, true, 'nollinjen ligger i överkanten, så ingen stapel kan ritas nedåt');

  // December 2025 är index 2 i serien och den enda månaden med negativt kvar.
  const negativ = staplar[2];
  assert.equal(negativ.getAttribute('class'), 'overview-bar overview-bar-negative');
  // Nedåt: stapelns överkant ligger PÅ nollinjen, så den växer nedåt.
  assert.equal(Number(negativ.getAttribute('y')), nollinje);
  assert.equal(Number(negativ.getAttribute('height')) > 0, true);

  // September 2026 har högst kvar och fyller därför halvan uppåt. Uppåt: den
  // undre kanten ligger på nollinjen.
  const positiv = staplar[11];
  assert.equal(positiv.getAttribute('class'), 'overview-bar overview-bar-positive');
  assert.equal(Number(positiv.getAttribute('y')) < nollinje, true);
  assert.equal(
    Number(positiv.getAttribute('y')) + Number(positiv.getAttribute('height')),
    nollinje
  );
  assert.equal(Number(positiv.getAttribute('height')), nollinje);

  // Varje annan månad är positiv, också den tomma: noll räknas som positivt,
  // precis som på raden Kvar att leva på.
  for (const [index, stapel] of staplar.entries()) {
    const forvantad = index === 2 ? 'overview-bar overview-bar-negative' : 'overview-bar overview-bar-positive';
    assert.equal(stapel.getAttribute('class'), forvantad, OVERSIKTSMANADER[index].month);
  }
  // Den tomma månaden har ingen stapel att visa, men nollinjen står kvar.
  assert.equal(Number(staplar[4].getAttribute('height')), 0);
});

test('(77) tabellen har en rad per månad, i samma ordning som diagrammet', async (t) => {
  const { dom } = await starta(t, planOversikt());
  await oppnaOversikten(dom);

  const rader = dom.rader('overview-rows');
  assert.equal(rader.length, OVERSIKTSMANADER.length);

  // Samma ordning som svaret, äldst först, och samma ordning som diagrammets
  // staplar: varje stapel bär sin månad i sin title.
  const { staplar } = diagrammet(dom);
  for (const [index, rad] of rader.entries()) {
    const manaden = OVERSIKTSMANADER[index];
    assert.equal(celltext(rad, 'overview-month'), monthLabel(manaden.month), manaden.month);
    assert.equal(
      staplar[index].children[0].textContent,
      `${monthLabel(manaden.month)}: ${formatSek(manaden.leftOre)}`,
      manaden.month
    );
    assert.equal(celltext(rad, 'overview-income'), formatSek(manaden.incomeOre), manaden.month);
    assert.equal(celltext(rad, 'overview-expense'), formatSek(manaden.expenseOre), manaden.month);
    assert.equal(celltext(rad, 'overview-saving'), formatSek(manaden.savingOre), manaden.month);
    assert.equal(kvarcell(rad).textContent, formatSek(manaden.leftOre), manaden.month);
  }

  // Den tomma månaden står med, med fyra nollor — annars ser tidslinjen ut att
  // hoppa över tid.
  assert.equal(celltext(rader[4], 'overview-month'), monthLabel('2026-02'));
  assert.deepEqual(
    [
      celltext(rader[4], 'overview-income'),
      celltext(rader[4], 'overview-expense'),
      celltext(rader[4], 'overview-saving'),
      kvarcell(rader[4]).textContent
    ],
    [formatSek(0), formatSek(0), formatSek(0), formatSek(0)]
  );

  // Kvar bär samma två klasser som månadsvyns summering, och noll räknas som
  // positivt.
  assert.equal(kvarcell(rader[2]).className, 'overview-left left-negative');
  assert.equal(kvarcell(rader[4]).className, 'overview-left left-positive');
  assert.equal(kvarcell(rader[11]).className, 'overview-left left-positive');
});

// En andra rendering med en kortare serie: en renderingsfunktion som bygger men
// aldrig tömmer fälls bara av ett andra anrop vars utgångsläge är det förstas
// motsats (LARDOMAR.md 2026-09-12).
test('(77) en andra hämtning ersätter tabellen och diagrammet i stället för att bygga på', async (t) => {
  const kortSerie = Object.freeze({
    status: 200,
    json: {
      months: [
        { month: '2026-08', incomeOre: 1000000, expenseOre: 0, savingOre: 0, leftOre: 1000000 },
        { month: '2026-09', incomeOre: 2000000, expenseOre: 0, savingOre: 0, leftOre: 2000000 }
      ],
      savedThisYear: 0
    }
  });
  const { dom } = await starta(t, ikoordningFor(OVERSIKTSVAG, [OVERSIKTSSVAR, kortSerie]));

  await oppnaOversikten(dom);
  assert.equal(dom.rader('overview-rows').length, 12);
  assert.equal(diagrammet(dom).staplar.length, 12);

  dom.falt('back-to-month').utlos('click');
  dom.falt('show-overview').utlos('click');
  await flush();

  assert.equal(dom.rader('overview-rows').length, 2);
  assert.equal(diagrammet(dom).staplar.length, 2);
  assert.equal(celltext(dom.rader('overview-rows')[0], 'overview-month'), monthLabel('2026-08'));
  assert.equal(dom.falt('overview-saved').textContent, formatSek(0));
});
