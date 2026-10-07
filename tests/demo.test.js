// Demoläget: flaggan, attrappen, seed-datan, lagringen och bannern.
// Kravlistan står i ARKITEKTUR.md under "Del 4: demoläge", punkt (D1) till
// (D10), och varje testfall nedan inleds med sitt nummer.
//
// Filerna under src/web/demo/ importeras direkt och behöver ingen ompekning:
// de skriver sina kärnimporter som ../../core/x.js, vilket pekar på src/core/
// både från disk och från webbläsarens /demo/ (samma fil, två vägar). app.js
// skriver /core/ och behöver därför laddaren i tests/helpers/dom.js; demofilerna
// gör inte det.
//
// Ingen tidsgräns och ingen timer: allt attrappen gör är löften utan I/O.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { monthTotals } from '../src/core/budget.js';
import { monthOfIsoDate, shiftMonth } from '../src/core/dates.js';
import { formatSek } from '../src/core/money.js';
import { AUTH_MESSAGES, NOT_LOGGED_IN_MESSAGE } from '../src/server/auth.js';
import { MEMORY_PATH, openDatabase } from '../src/server/db.js';
import { addMonthItem, addTemplate, readMonth } from '../src/server/months.js';
import { mountBanner } from '../src/web/demo/banner.js';
import { createDemoFetch, readDemoMonth, readDemoOverview, SERVER_TEXTS } from '../src/web/demo/demo-fetch.js';
import { DEMO } from '../src/web/demo/demolage.js';
import { clearState, getStorage, readState, STORAGE_KEY, writeState } from '../src/web/demo/lagring.js';
import { FEATURES, hasFeature, PLANS, PLAN_LABELS } from '../src/core/plans.js';
import { createSeedState, DEMO_EMAIL, seedMonths } from '../src/web/demo/seed.js';
import { createDemoDom, createStorage, createThrowingStorage } from './helpers/demo-dom.js';
import { createDom, flush, loadApp } from './helpers/dom.js';

// Dagen står skriven och räknas inte ut: ett testfall som läser klockan kan bli
// rött av att dygnet byts mitt i provet.
const IDAG = '2026-10-06';
const MANAD = '2026-10';
const FOREGAENDE = '2026-09';
const NASTA = '2026-11';

// Beloppen ur tabellen i ARKITEKTUR.md, i heltal ören. De skrivs av här för att
// jämföras mot det attrappen svarar — en seed-fil som tappar en nolla ska fälla
// ett testfall och inte bara se fel ut på skärmen.
const LON_ORE = 3200000;
const HYRA_ORE = 890000;
const EL_ORE = 76000;
const HEMFORSAKRING_ORE = 145000;
// Avvikelsen: elräkningen högre i den föregående månaden.
const EL_VINTER_ORE = 124000;

// Den vägledande beloppstexten, ägd av checkAmountSek i src/core/entry.js.
// Skrivs av här av samma skäl som beloppen ovan.
const BELOPPSTEXT =
  'Skriv beloppet med siffror, utan mellanslag och utan kr. Till exempel 12000 eller 139,50.';

const DEMO_FETCH_PATH = fileURLToPath(new URL('../src/web/demo/demo-fetch.js', import.meta.url));
const DEMOLAGE_PATH = fileURLToPath(new URL('../src/web/demo/demolage.js', import.meta.url));
const API_PATH = fileURLToPath(new URL('../src/server/api.js', import.meta.url));
const INDEX_PATH = fileURLToPath(new URL('../src/web/index.html', import.meta.url));
const LANDNING_PATH = fileURLToPath(new URL('../src/web/landning.html', import.meta.url));

// En attrapp plus ett tillstånd, som varje fall nedan börjar med.
function riggning({ storage = createStorage(), today = IDAG } = {}) {
  const state = readState(storage) ?? createSeedState(today);
  const demo = createDemoFetch({
    state,
    save: (nytt) => writeState(storage, nytt)
  });
  return { state, storage, fetch: demo.fetch };
}

async function json(response) {
  return response.json();
}

// ---------------------------------------------------------------- (D1)

test('(D1) DEMO är falsk som förval, och raden står så i filen', async () => {
  assert.equal(DEMO, false);
  // Flaggan är det enda som skiljer demon från den riktiga appen, så värdet
  // prövas både som värde och som den rad en publicering byter.
  const kalla = await fs.readFile(DEMOLAGE_PATH, 'utf8');
  assert.equal(kalla.includes('export const DEMO = false;'), true, 'raden i demolage.js');
  assert.equal(kalla.includes('export const DEMO = true;'), false);
});

// ---------------------------------------------------------------- (D2)

test('(D2) med DEMO falsk rörs globalThis.fetch inte, och ingen annan demofil laddas', async () => {
  // Modulen är redan importerad högst upp i filen, alltså körd med DEMO falsk.
  // Hade DEMO-grenen körts vore globalThis.fetch utbytt mot attrappens egen
  // demoFetch. Jämförelsen sker mot funktionens namn och inte mot ett värde
  // läst efter importen: ett sådant värde är detsamma som det aktuella och
  // skulle vara sant oavsett vad importen gjorde.
  assert.notEqual(globalThis.fetch?.name, 'demoFetch', 'globalThis.fetch orörd');

  const kalla = await fs.readFile(DEMO_FETCH_PATH, 'utf8');
  // Varje statisk import av en fil under demo/ — alltså varje fil som laddas
  // oavsett flaggan. Den enda som får stå där är flaggan själv.
  const statiska = [...kalla.matchAll(/^import[^\n]*from '(\.\/[^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(statiska, ['./demolage.js'], 'statiska demo-importer i demo-fetch.js');
  // De tre övriga laddas dynamiskt, och bara inne i DEMO-grenen.
  for (const fil of ['./lagring.js', './seed.js', './banner.js']) {
    assert.equal(kalla.includes(`await import('${fil}')`), true, `dynamisk import av ${fil}`);
  }
});

test('(D2) båda sidorna laddar attrappen som modul, och index.html gör det före app.js', async () => {
  const index = await fs.readFile(INDEX_PATH, 'utf8');
  const landning = await fs.readFile(LANDNING_PATH, 'utf8');
  const demoTagg = '<script type="module" src="/demo/demo-fetch.js"></script>';
  const appTagg = '<script type="module" src="/app.js"></script>';

  assert.equal(index.includes(demoTagg), true, 'index.html laddar attrappen');
  assert.equal(landning.includes(demoTagg), true, 'landning.html laddar attrappen');
  // Ordningen är bärande: ett modulskript med await på översta nivån fördröjer
  // nästa modulskript, så attrappen är på plats innan app.js anropar fetch.
  assert.equal(
    index.indexOf(demoTagg) < index.indexOf(appTagg),
    true,
    'attrappen står före app.js i index.html'
  );
});

// ---------------------------------------------------------------- (D3)

test('(D3) varje svensk text attrappen svarar med är ägarens, tecken för tecken', async () => {
  // Två av ägarna går att importera: NOT_LOGGED_IN_MESSAGE och AUTH_MESSAGES
  // exporteras ur src/server/auth.js.
  assert.equal(SERVER_TEXTS.notLoggedIn, NOT_LOGGED_IN_MESSAGE);
  assert.equal(SERVER_TEXTS.unknownCode, AUTH_MESSAGES.unknownCode);
  // De fyra övriga står i MESSAGES i src/server/api.js, som är modullokal och
  // inte exporterad. Kopian jämförs därför mot filens egen rad: en ändring av
  // texten i api.js fäller det här testfallet.
  const api = await fs.readFile(API_PATH, 'utf8');
  for (const [nyckel, text] of [
    ['entryNotFound', SERVER_TEXTS.entryNotFound],
    ['invalidMonth', SERVER_TEXTS.invalidMonth],
    ['unknownPath', SERVER_TEXTS.unknownPath],
    ['methodNotAllowed', SERVER_TEXTS.methodNotAllowed],
    ['invalidPlan', SERVER_TEXTS.invalidPlan]
  ]) {
    assert.equal(api.includes(`${nyckel}: '${text}'`), true, `${nyckel} i src/server/api.js`);
  }
});

test('(D3) de fyra inloggningsvägarna svarar som servern', async () => {
  const { fetch, state } = riggning();

  // GET /api/mig: 200 med adressen när sessionen finns.
  const mig = await fetch('/api/mig');
  assert.equal(mig.status, 200);
  assert.deepEqual(await json(mig), { email: DEMO_EMAIL });

  // POST /api/auth/logga-ut: 204 utan kropp, och därefter 401 på /api/mig.
  const ut = await fetch('/api/auth/logga-ut', { method: 'POST' });
  assert.equal(ut.status, 204);
  await assert.rejects(() => ut.json(), SyntaxError, '204 har ingen läsbar kropp');

  const utloggad = await fetch('/api/mig');
  assert.equal(utloggad.status, 401);
  assert.deepEqual(await json(utloggad), { error: SERVER_TEXTS.notLoggedIn });

  // POST /api/auth/kod: 202 utan kropp. Koden hamnar i demons tillstånd.
  let visadKod = null;
  const medKod = createDemoFetch({
    state,
    onCode: (code) => {
      visadKod = code;
    },
    makeCode: () => '424242'
  }).fetch;
  const kod = await medKod('/api/auth/kod', {
    method: 'POST',
    body: JSON.stringify({ email: 'nagon@exempel.se' })
  });
  assert.equal(kod.status, 202);
  await assert.rejects(() => kod.json(), SyntaxError);
  assert.equal(visadKod, '424242', 'koden visas i bannern i stället för att mejlas');

  // POST /api/auth/logga-in: 400 med serverns text när koden inte stämmer.
  const fel = await medKod('/api/auth/logga-in', {
    method: 'POST',
    body: JSON.stringify({ email: 'nagon@exempel.se', code: '000000' })
  });
  assert.equal(fel.status, 400);
  assert.deepEqual(await json(fel), { error: SERVER_TEXTS.unknownCode });

  // 204 när den stämmer.
  const in_ = await medKod('/api/auth/logga-in', {
    method: 'POST',
    body: JSON.stringify({ email: 'nagon@exempel.se', code: '424242' })
  });
  assert.equal(in_.status, 204);
  assert.equal((await medKod('/api/mig')).status, 200);
});

test('(D3) månadens och postens vägar svarar som servern', async () => {
  const { fetch } = riggning();

  // GET /api/manad/<ÅÅÅÅ-MM>: 200 med items och totals.
  const manad = await fetch(`/api/manad/${MANAD}`);
  assert.equal(manad.status, 200);
  const kropp = await json(manad);
  assert.deepEqual(Object.keys(kropp).sort(), ['items', 'totals']);
  assert.deepEqual(Object.keys(kropp.totals).sort(), [
    'expenseOre',
    'incomeOre',
    'leftOre',
    'savingOre'
  ]);
  // Posterna har exakt de fält src/server/months.js ger dem, så gränssnittet
  // kan läsa listan utan att fråga varifrån raden kom.
  assert.deepEqual(Object.keys(kropp.items[0]).sort(), [
    'amountOre',
    'category',
    'dueDate',
    'id',
    'interval',
    'kind',
    'name',
    'note',
    'occurredOn',
    'overridden',
    'recurring',
    'seriesId',
    'toMonth'
  ]);

  // En månad som inte är en månad: 400 med månadens text.
  const felManad = await fetch('/api/manad/2026-13-01');
  assert.equal(felManad.status, 400);
  assert.deepEqual(await json(felManad), { error: SERVER_TEXTS.invalidMonth });

  // POST /api/manad/<ÅÅÅÅ-MM>: 201 med posten.
  const ny = await fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'expense', name: 'Tandläkare', amountSek: '950', category: 'other' })
  });
  assert.equal(ny.status, 201);
  const { item } = await json(ny);
  assert.equal(item.amountOre, 95000);
  assert.equal(item.recurring, false);
  assert.equal(item.dueDate, null);

  // PUT /api/poster/<id>: 200 med den ändrade posten.
  const andrad = await fetch(`/api/poster/${item.id}`, {
    method: 'PUT',
    body: JSON.stringify({ kind: 'expense', name: 'Tandläkare', amountSek: '1150', category: 'other' })
  });
  assert.equal(andrad.status, 200);
  assert.equal((await json(andrad)).item.amountOre, 115000);

  // DELETE /api/poster/<id>: 204, och 404 andra gången.
  const bort = await fetch(`/api/poster/${item.id}`, { method: 'DELETE' });
  assert.equal(bort.status, 204);
  const igen = await fetch(`/api/poster/${item.id}`, { method: 'DELETE' });
  assert.equal(igen.status, 404);
  assert.deepEqual(await json(igen), { error: SERVER_TEXTS.entryNotFound });

  // En metod vägen inte har, och en adress som inte finns.
  const metod = await fetch(`/api/manad/${MANAD}`, { method: 'PATCH' });
  assert.equal(metod.status, 405);
  assert.deepEqual(await json(metod), { error: SERVER_TEXTS.methodNotAllowed });
  const okand = await fetch('/api/nagot-annat');
  assert.equal(okand.status, 404);
  assert.deepEqual(await json(okand), { error: SERVER_TEXTS.unknownPath });
});

test('(D3) mallvägarna svarar som servern och versionerar utan att skriva om historiken', async () => {
  const { fetch, state } = riggning();

  // POST /api/mallar/<ÅÅÅÅ-MM>: 201 med mallen.
  const skapad = await fetch(`/api/mallar/${MANAD}`, {
    method: 'POST',
    body: JSON.stringify({
      kind: 'expense',
      name: 'Gym',
      amountSek: '399',
      category: 'subscription',
      interval: 'monthly'
    })
  });
  assert.equal(skapad.status, 201);
  const { template } = await json(skapad);
  assert.deepEqual(Object.keys(template).sort(), [
    'amountOre',
    'category',
    'fromMonth',
    'id',
    'interval',
    'kind',
    'name',
    'seriesId',
    'startDate',
    'toMonth'
  ]);
  assert.equal(template.seriesId, template.id, 'första versionen bär sitt eget id');
  assert.equal(template.fromMonth, MANAD);
  assert.equal(template.startDate, `${MANAD}-01`);

  // PUT /api/mallar/<seriesId>/<ÅÅÅÅ-MM>: 200 med den nya versionen. Ändringen
  // gäller från nästa månad, så den här månaden behåller det gamla beloppet.
  const andrad = await fetch(`/api/mallar/${template.seriesId}/${NASTA}`, {
    method: 'PUT',
    body: JSON.stringify({
      kind: 'expense',
      name: 'Gym',
      amountSek: '449',
      category: 'subscription',
      interval: 'monthly'
    })
  });
  assert.equal(andrad.status, 200);
  const nyVersion = (await json(andrad)).template;
  assert.equal(nyVersion.seriesId, template.seriesId, 'samma serie');
  assert.notEqual(nyVersion.id, template.id, 'en ny version och inte samma rad');
  assert.equal(nyVersion.fromMonth, NASTA);

  const gymDenHar = readDemoMonth(state, MANAD).items.find((post) => post.name === 'Gym');
  const gymNasta = readDemoMonth(state, NASTA).items.find((post) => post.name === 'Gym');
  assert.equal(gymDenHar.amountOre, 39900, 'historiken orörd');
  assert.equal(gymNasta.amountOre, 44900, 'den nya versionen gäller framåt');

  // DELETE /api/mallar/<seriesId>/<ÅÅÅÅ-MM>: 204, och 404 för en serie som inte
  // finns.
  const avslutad = await fetch(`/api/mallar/${template.seriesId}/${NASTA}`, { method: 'DELETE' });
  assert.equal(avslutad.status, 204);
  assert.equal(
    readDemoMonth(state, NASTA).items.some((post) => post.name === 'Gym'),
    false,
    'serien syns inte längre från den månaden'
  );
  assert.equal(
    readDemoMonth(state, MANAD).items.some((post) => post.name === 'Gym'),
    true,
    'månaderna före är orörda'
  );
  const okand = await fetch(`/api/mallar/finns-inte/${MANAD}`, { method: 'DELETE' });
  assert.equal(okand.status, 404);
  assert.deepEqual(await json(okand), { error: SERVER_TEXTS.entryNotFound });
});

test('(D3) avvikelsevägen svarar med hela månaden, precis som servern', async () => {
  const { fetch, state } = riggning();
  const fore = readDemoMonth(state, MANAD).items.find((post) => post.name === 'El');
  assert.equal(fore.amountOre, EL_ORE);

  const svar = await fetch(`/api/poster/demo-el/manad/${MANAD}`, {
    method: 'PUT',
    body: JSON.stringify({ amountSek: '1395' })
  });
  assert.equal(svar.status, 200);
  const kropp = await json(svar);
  assert.deepEqual(Object.keys(kropp).sort(), ['items', 'totals']);
  const el = kropp.items.find((post) => post.name === 'El');
  assert.equal(el.amountOre, 139500);
  assert.equal(el.overridden, true);

  // { skipped: true } tar bort posten ur månaden.
  const hoppad = await fetch(`/api/poster/demo-el/manad/${MANAD}`, {
    method: 'PUT',
    body: JSON.stringify({ skipped: true })
  });
  assert.equal(hoppad.status, 200);
  assert.equal(
    (await json(hoppad)).items.some((post) => post.name === 'El'),
    false
  );

  // En mall som inte finns: 404 med samma text som för en post som inte finns.
  const okand = await fetch(`/api/poster/finns-inte/manad/${MANAD}`, {
    method: 'PUT',
    body: JSON.stringify({ amountSek: '10' })
  });
  assert.equal(okand.status, 404);
  assert.deepEqual(await json(okand), { error: SERVER_TEXTS.entryNotFound });
});

// ---------------------------------------------------------------- (D4)

// (69) Fältlistorna jämförs mot SERVERN och inte mot en handskriven lista: en
// lista skriven här är ett andra facit, och den som lägger till ett fält i
// src/server/months.js rättar den inte (LARDOMAR.md 2026-09-02). Jämförelsen
// görs för båda sorternas poster, eftersom mallposten och engångsposten byggs av
// var sin gren i båda filerna.
test('(69) demons poster har exakt de fält src/server/months.js ger dem', async () => {
  const db = openDatabase(MEMORY_PATH);
  const anvandare = 'u-demo';
  db.prepare('INSERT INTO users (id, email, created_at) VALUES (?, ?, ?)')
    .run(anvandare, DEMO_EMAIL, `${IDAG}T12:00:00.000Z`);

  const utkast = {
    kind: 'expense',
    name: 'Hemförsäkring',
    amountOre: HEMFORSAKRING_ORE,
    category: 'insurance'
  };
  addTemplate(anvandare, MANAD, { ...utkast, interval: 'quarterly', toMonth: null }, {
    db,
    now: `${IDAG}T12:00:00.000Z`,
    makeId: () => 't-demo'
  });
  addMonthItem(anvandare, MANAD, { kind: 'expense', name: 'Tandläkare', amountOre: 95000, category: 'other' }, {
    db,
    now: `${IDAG}T12:00:00.000Z`,
    makeId: () => 'm-demo'
  });
  const serverns = readMonth(anvandare, MANAD, { db }).items;
  db.close();

  // Demons sida. Seed-datan är bara mallar, så engångsposten läggs till genom
  // attrappens egen POST — samma väg gränssnittet använder, och den enda som
  // bygger en engångspost i demon.
  const { state, fetch } = riggning();
  const ny = await fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ kind: 'expense', name: 'Tandläkare', amountSek: '950', category: 'other' })
  });
  assert.equal(ny.status, 201);
  const demons = readDemoMonth(state, MANAD).items;

  const falten = (poster, villkor) => {
    const post = poster.find(villkor);
    assert.notEqual(post, undefined, 'posten saknas i listan');
    return Object.keys(post).sort();
  };

  const serverMall = falten(serverns, (post) => post.recurring === true);
  const demoMall = falten(demons, (post) => post.recurring === true);
  assert.deepEqual(demoMall, serverMall);

  const serverEngang = falten(serverns, (post) => post.recurring === false);
  const demoEngang = falten(demons, (post) => post.recurring === false);
  assert.deepEqual(demoEngang, serverEngang);

  // Och de två sorterna har samma fält i båda filerna, så att gränssnittet kan
  // läsa listan utan att fråga varifrån raden kom.
  assert.deepEqual(demoMall, demoEngang);
  // De två nya fälten ingår OCH bär mallens värden: utan de här raderna
  // passerar jämförelsen också om båda filerna tappar fälten samtidigt.
  // Mallen skapas genom attrappens egen mallväg, med ett intervall och en
  // slutmånad som skiljer sig från förvalen — ett fält som bär sitt förval kan
  // inte skilja "läst ur mallen" från "skrivet för hand".
  const kvartal = await fetch(`/api/mallar/${MANAD}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      kind: 'expense',
      name: 'Vägavgift',
      amountSek: '450',
      category: 'transport',
      interval: 'quarterly',
      toMonth: '2027-06'
    })
  });
  assert.equal(kvartal.status, 201);

  const efter = readDemoMonth(state, MANAD).items;
  const skapad = efter.find((post) => post.name === 'Vägavgift');
  assert.notEqual(skapad, undefined, 'den skapade mallen syns inte i månaden');
  assert.equal(skapad.interval, 'quarterly');
  assert.equal(skapad.toMonth, '2027-06');
  // En mall utan slutmånad bär null, och engångsposten null på båda.
  assert.equal(efter.find((post) => post.name === 'Hyra').interval, 'monthly');
  assert.equal(efter.find((post) => post.name === 'Hyra').toMonth, null);
  const engangsposten = efter.find((post) => post.recurring === false);
  assert.equal(engangsposten.interval, null);
  assert.equal(engangsposten.toMonth, null);
});

test('(D4) summorna kommer ur monthTotals och räknas inte av attrappen', async () => {
  const { fetch } = riggning();
  for (const manad of seedMonths(IDAG)) {
    const kropp = await json(await fetch(`/api/manad/${manad}`));
    // Samma lista genom samma ägare ska ge samma fyra tal. Är ett tal uträknat
    // i attrappen i stället faller raden.
    assert.deepEqual(kropp.totals, monthTotals(kropp.items), `summorna för ${manad}`);
  }

  // Och attrappen innehåller ingen egen summering. Spärren är skriven om de två
  // former en egen räkning skulle ta: en reduce över listan, eller en addition
  // av amountOre.
  const kalla = await fs.readFile(DEMO_FETCH_PATH, 'utf8');
  // Spärren prövar BINDNINGEN och inte importradens exakta text: etapp 5 lade
  // sumByKind till samma rad, och en spärr som läser hela raden faller då för en
  // ändring som inte rör det den skyddar. Varje element normaliseras med
  // split(/\s+as\s+/)[0] av samma skäl som importspärren i tests/api.test.js
  // (LARDOMAR.md 2026-09-07, textspärren mot saveEntries går förbi med ett
  // alias).
  const budgetImport = /import \{([^}]*)\} from '\.\.\/\.\.\/core\/budget\.js';/.exec(kalla);
  assert.notEqual(budgetImport, null, 'attrappen importerar inte från budget.js');
  const budgetBindningar = budgetImport[1].split(',').map((del) => del.split(/\s+as\s+/)[0].trim());
  assert.equal(
    budgetBindningar.includes('monthTotals'),
    true,
    'attrappen hämtar summorna ur budget.js'
  );
  assert.equal(kalla.includes('totals: monthTotals(items)'), true, 'och anropar den');
  assert.equal(/\.reduce\(/.test(kalla), false, 'ingen reduce i attrappen');
  assert.equal(/amountOre \+/.test(kalla), false, 'inget belopp adderas i attrappen');
});

test('(D4) kvar att leva på är inkomst minus utgift minus sparande, räknat av budget.js', async () => {
  const { fetch } = riggning();
  const { totals } = await json(await fetch(`/api/manad/${MANAD}`));
  assert.equal(totals.leftOre, totals.incomeOre - totals.expenseOre - totals.savingOre);
  assert.equal(totals.incomeOre > 0, true);
});

// ---------------------------------------------------------------- (D5)

test('(D5) 12 000 ger den vägledande beloppstexten, som i den riktiga appen', async () => {
  const { fetch } = riggning();
  const svar = await fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'expense', name: 'Resa', amountSek: '12 000', category: 'other' })
  });
  assert.equal(svar.status, 400);
  const kropp = await json(svar);
  assert.equal(kropp.error, BELOPPSTEXT);
  assert.deepEqual(kropp.fieldErrors, [{ field: 'amountSek', message: BELOPPSTEXT }]);
});

test('(D5) en tom kropp ger fältfel för alla fyra fälten, i validerarens ordning', async () => {
  const { fetch } = riggning();
  const svar = await fetch(`/api/manad/${MANAD}`, { method: 'POST', body: JSON.stringify({}) });
  assert.equal(svar.status, 400);
  const kropp = await json(svar);
  assert.deepEqual(
    kropp.fieldErrors.map((fel) => fel.field),
    ['kind', 'name', 'amountSek', 'category']
  );
  assert.equal(kropp.error, kropp.fieldErrors[0].message, 'error är det första felet');
});

// ---------------------------------------------------------------- (D6)

test('(D6) en ny post överlever en omladdning', async () => {
  const storage = createStorage();
  const forsta = riggning({ storage });
  const svar = await forsta.fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'expense', name: 'Cykelservice', amountSek: '640', category: 'transport' })
  });
  assert.equal(svar.status, 201);

  // Omladdningen: ett nytt tillstånd läses ur lagringen, precis som
  // demo-fetch.js gör vid sidladdningen.
  const andra = riggning({ storage });
  const kropp = await json(await andra.fetch(`/api/manad/${MANAD}`));
  const post = kropp.items.find((rad) => rad.name === 'Cykelservice');
  assert.notEqual(post, undefined, 'posten läst tillbaka ur localStorage');
  assert.equal(post.amountOre, 64000);
  assert.equal(readState(storage) === null, false, 'tillståndet ligger under demons nyckel');
});

// ---------------------------------------------------------------- (D7)

test('(D7) Återställ demo tömmer nyckeln och ger seed-datan tillbaka', async () => {
  const storage = createStorage();
  const forsta = riggning({ storage });
  await forsta.fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'expense', name: 'Cykelservice', amountSek: '640', category: 'transport' })
  });
  assert.equal(readState(storage) === null, false);

  // Det Återställ demo gör: tömmer nyckeln. Nästa laddning har ingenting att
  // läsa och börjar om från seed-datan.
  clearState(storage);
  assert.equal(readState(storage), null, 'nyckeln tömd');

  const efter = riggning({ storage });
  const kropp = await json(await efter.fetch(`/api/manad/${MANAD}`));
  assert.equal(
    kropp.items.some((rad) => rad.name === 'Cykelservice'),
    false,
    'ändringen borta'
  );
  assert.deepEqual(
    kropp.items.map((rad) => rad.name),
    readDemoMonth(createSeedState(IDAG), MANAD).items.map((rad) => rad.name),
    'ursprunget tillbaka'
  );
});

test('(D7) ett sparat tillstånd med fel form kasseras i stället för att halvt användas', () => {
  const storage = createStorage();
  for (const skrap of ['inte json', '"abc"', 'null', '[]', '{"version":2}', '{}']) {
    storage.setItem(STORAGE_KEY, skrap);
    assert.equal(readState(storage), null, `kasserar ${skrap}`);
  }
});

// ---------------------------------------------------------------- (D8)

test('(D8) utan localStorage visar demon ändå seed-datan, och ändringar går igenom', async () => {
  const kastande = createThrowingStorage();
  // Läsningen kastar, alltså finns inget sparat tillstånd att läsa.
  assert.equal(readState(kastande), null);
  assert.equal(writeState(kastande, { version: 1 }), false, 'skrivningen kastar och svarar false');
  assert.equal(clearState(kastande), false);

  const { fetch } = riggning({ storage: kastande });
  const kropp = await json(await fetch(`/api/manad/${MANAD}`));
  assert.equal(
    kropp.items.some((rad) => rad.name === 'Hyra'),
    true,
    'seed-datan visas ändå'
  );

  // En ändring går igenom i minnet och svarar 201, trots att den inte kan
  // sparas: en demo utan lagring ska fungera, bara glömma vid omladdning.
  const svar = await fetch(`/api/manad/${MANAD}`, {
    method: 'POST',
    body: JSON.stringify({ kind: 'saving', name: 'Semesterkassa', amountSek: '500', category: 'other' })
  });
  assert.equal(svar.status, 201);
  const efter = await json(await fetch(`/api/manad/${MANAD}`));
  assert.equal(
    efter.items.some((rad) => rad.name === 'Semesterkassa'),
    true,
    'ändringen finns i minnet'
  );

  // Och getStorage svarar null när globalThis.localStorage inte finns alls,
  // vilket är läget i en Node-körning.
  assert.equal(getStorage(), null);
});

// ---------------------------------------------------------------- (D9) och (D10)

test('(D9) en återkommande post följer med i tre månader i rad', async () => {
  const { fetch } = riggning();
  const manader = seedMonths(IDAG);
  assert.deepEqual(manader, [FOREGAENDE, MANAD, NASTA]);

  for (const manad of manader) {
    const kropp = await json(await fetch(`/api/manad/${manad}`));
    const hyra = kropp.items.find((rad) => rad.name === 'Hyra');
    assert.notEqual(hyra, undefined, `Hyra syns i ${manad}`);
    assert.equal(hyra.amountOre, HYRA_ORE);
    assert.equal(hyra.recurring, true, 'märket för en mall');
    assert.equal(hyra.seriesId, 'demo-hyra');
    const lon = kropp.items.find((rad) => rad.name === 'Lön');
    assert.equal(lon.amountOre, LON_ORE, `Lön syns i ${manad}`);
  }
});

test('(D9) avvikelsen gäller en enda månad, och övriga behåller mallens belopp', async () => {
  const { fetch } = riggning();
  const belopp = [];
  for (const manad of seedMonths(IDAG)) {
    const kropp = await json(await fetch(`/api/manad/${manad}`));
    const el = kropp.items.find((rad) => rad.name === 'El');
    belopp.push([manad, el.amountOre, el.overridden]);
  }
  assert.deepEqual(belopp, [
    [FOREGAENDE, EL_VINTER_ORE, true],
    [MANAD, EL_ORE, false],
    [NASTA, EL_ORE, false]
  ]);
});

test('(D10) kvartalsposten och halvårsposten syns bara sina månader', async () => {
  const { fetch } = riggning();
  const traffar = { Hemförsäkring: [], Bilskatt: [] };
  for (const manad of seedMonths(IDAG)) {
    const kropp = await json(await fetch(`/api/manad/${manad}`));
    for (const namn of Object.keys(traffar)) {
      if (kropp.items.some((rad) => rad.name === namn)) {
        traffar[namn].push(manad);
      }
    }
  }
  // En träff var bland de tre månaderna: kvartalsposten i den aktuella,
  // halvårsposten i den föregående.
  assert.deepEqual(traffar.Hemförsäkring, [MANAD]);
  assert.deepEqual(traffar.Bilskatt, [FOREGAENDE]);

  const kropp = await json(await fetch(`/api/manad/${MANAD}`));
  assert.equal(
    kropp.items.find((rad) => rad.name === 'Hemförsäkring').amountOre,
    HEMFORSAKRING_ORE
  );
});

// ---------------------------------------------------------------- bannern

test('bannern ritas högst upp, går att fälla ihop men aldrig dölja, och visar koden', () => {
  const dom = createDemoDom();
  let aterstalld = 0;
  let demoinloggad = 0;
  const banner = mountBanner({
    document: dom.document,
    onReset: () => {
      aterstalld += 1;
    },
    onDemoLogin: () => {
      demoinloggad += 1;
    }
  });

  assert.equal(dom.body.children[0], banner.element, 'bannern ligger först i body');
  const texter = dom.body.attlingar().map((element) => element.textContent);
  assert.equal(texter.includes('Demoversion - ingen riktig data eller betalning.'), true);
  assert.equal(texter.includes('Se koden på GitHub'), true);
  assert.equal(texter.includes('Återställ demo'), true);
  // Knappen visas bara där inloggningsvyn finns, alltså i appen och inte på
  // landningssidan.
  assert.equal(texter.includes('Logga in som demoanvändare'), true);

  // Stilmallen laddas av bannern själv, så att ingen regel finns på sidan när
  // DEMO är falsk.
  assert.deepEqual(
    dom.head.children.map((element) => element.href),
    ['/demo/banner.css']
  );

  // Koden visas i bannern i stället för att mejlas.
  const kod = dom.medKlass('demo-banner-kod');
  assert.equal(kod.hidden, true, 'ingen kod innan någon begärt en');
  banner.showCode('424242', 'nagon@exempel.se');
  assert.equal(kod.hidden, false);
  assert.equal(kod.textContent, 'Demoläge: koden till nagon@exempel.se är 424242. Inget mejl skickas.');

  // Ihopfälld: en smal remsa, men raden med texten står kvar.
  const knappar = dom.alla('demo-banner-knapp');
  const fall = knappar.at(-1);
  assert.equal(fall.textContent, 'Fäll ihop');
  fall.utlos('click');
  assert.equal(banner.element.className, 'demo-banner demo-banner-ihopfalld');
  assert.equal(fall.textContent, 'Visa mer');
  assert.equal(dom.medKlass('demo-banner-text').textContent, 'Demoversion - ingen riktig data eller betalning.');
  assert.equal(dom.medKlass('demo-banner-hjalp').hidden, true);
  fall.utlos('click');
  assert.equal(banner.element.className, 'demo-banner');
  assert.equal(dom.medKlass('demo-banner-hjalp').hidden, false);

  // De två knapparna anropar sina hanterare.
  knappar[0].utlos('click');
  assert.equal(aterstalld, 1);
  dom.medKlass('demo-login').utlos('click');
  assert.equal(demoinloggad, 1);
});

test('bannern säger till när webbläsaren inte ger demon någon lagring', () => {
  const utanLagring = createDemoDom({ loginStepEmail: false });
  mountBanner({ document: utanLagring.document, storageMissing: true });
  assert.equal(
    utanLagring.medKlass('demo-banner-hjalp').textContent.includes('ingen lagring'),
    true
  );
  // Utan inloggningsvy ingen demoinloggningsknapp.
  assert.equal(utanLagring.medKlass('demo-login'), null);

  const medLagring = createDemoDom();
  mountBanner({ document: medLagring.document });
  assert.equal(
    medLagring.medKlass('demo-banner-hjalp').textContent.includes('ingen lagring'),
    false
  );
  // Uppräkningen av det demon inte visar står i bannerns hjälptext.
  for (const ord of ['Prisplaner', 'sparmål', 'delat hushåll', 'Mina funktioner']) {
    assert.equal(medLagring.medKlass('demo-banner-hjalp').textContent.includes(ord), true, ord);
  }
});

// ---------------------------------------------------------------- app.js körd mot attrappen

test('src/web/app.js körd mot attrappen visar demons månad, summor och kategorier', async (t) => {
  const dom = createDom();
  const storage = createStorage();
  const { fetch, state } = riggning({ storage });

  await loadApp(t, { document: dom.document, fetch, idag: IDAG });
  await flush();

  // Vilken vy som syns avgörs av GET /api/mig, och demon börjar inloggad.
  assert.equal(dom.monthView.hidden, false);
  assert.equal(dom.loginView.hidden, true);
  assert.equal(dom.falt('user-email').textContent, DEMO_EMAIL);
  assert.equal(dom.falt('month-label').textContent, 'Oktober 2026');

  const totals = readDemoMonth(state, MANAD).totals;
  assert.equal(dom.falt('total-income').textContent, formatSek(totals.incomeOre));
  assert.equal(dom.falt('total-expense').textContent, formatSek(totals.expenseOre));
  assert.equal(dom.falt('total-saving').textContent, formatSek(totals.savingOre));
  assert.equal(dom.falt('total-left').textContent, formatSek(totals.leftOre));

  // Raderna: namn, kategori, belopp och märket för en återkommande post.
  const utgifter = dom
    .rader('expense-list')
    .map((rad) => rad.children.map((cell) => cell.textContent));
  assert.deepEqual(utgifter[0].slice(0, 3), ['El', 'Boende', formatSek(EL_ORE)]);
  assert.equal(utgifter[0][3], '↻', 'märket för en mall');

  // Månadsväljaren bläddrar, och kvartalsposten försvinner ur den föregående
  // månaden.
  dom.falt('month-prev').utlos('click');
  await flush();
  assert.equal(dom.falt('month-label').textContent, 'September 2026');
  const namnForegaende = dom.rader('expense-list').map((rad) => rad.children[0].textContent);
  assert.equal(namnForegaende.includes('Hemförsäkring'), false);
  assert.equal(namnForegaende.includes('Bilskatt'), true);
  // Avvikelsen syns: elräkningen är högre den månaden.
  const el = dom.rader('expense-list').find((rad) => rad.children[0].textContent === 'El');
  assert.equal(el.children[2].textContent, formatSek(EL_VINTER_ORE));

  // Formuläret: 12 000 ger den vägledande texten vid beloppsfältet, precis som
  // mot den riktiga servern.
  dom.falt('add-expense').utlos('click');
  dom.falt('item-name').value = 'Resa';
  dom.falt('item-amount').value = '12 000';
  dom.falt('item-category').value = 'other';
  dom.falt('item-form').utlos('submit', { preventDefault: () => undefined });
  await flush();
  assert.equal(dom.faltfel('amountSek'), BELOPPSTEXT);

  // Ett giltigt belopp sparas, hamnar i listan och i lagringen.
  dom.falt('item-amount').value = '1200';
  dom.falt('item-form').utlos('submit', { preventDefault: () => undefined });
  await flush();
  assert.equal(dom.faltfel('amountSek'), '');
  const efter = dom.rader('expense-list').map((rad) => rad.children[0].textContent);
  assert.equal(efter.includes('Resa'), true);
  assert.equal(
    readState(storage).monthItems.some((rad) => rad.name === 'Resa'),
    true,
    'posten sparad i localStorage'
  );
});

// De tre månadskonstanterna är skrivna och inte uträknade, så att ett testfall
// aldrig kan bli rött av att dygnet byts mitt i provet. Raden nedan prövar att de
// stämmer med den skrivna dagen — annars mäter varje fall ovan en annan månad än
// det påstår.
test('de skrivna månaderna stämmer med den skrivna dagen', () => {
  assert.equal(monthOfIsoDate(IDAG), MANAD);
  assert.equal(shiftMonth(MANAD, -1), FOREGAENDE);
  assert.equal(shiftMonth(MANAD, 1), NASTA);
});

// ----------------------------------------------- översikten i demoläget [etapp 5]

// Attrappen svarar på GET /api/oversikt/<ÅÅÅÅ-MM> med samma form som
// src/server/api.js, så att en besökare ser översikten och inte en feltext.
//
// Seed-datan sträcker sig tre månader: den tidigaste, den aktuella och den
// kommande. Tolv månader bakåt från den aktuella rymmer bara de två första av
// dem, så tio av tolv rader är tomma — och de står med, med fyra nollor. En
// utelämnad rad hade fått tidslinjen att se ut att hoppa över tid.
test('attrappen svarar på översiktens väg med tolv månader och savedThisYear', async () => {
  const { fetch } = riggning();

  const response = await fetch(`/api/oversikt/${MANAD}`);
  assert.equal(response.status, 200);
  const kropp = await json(response);

  assert.equal(kropp.months.length, 12);
  // Äldst först, och den sista är den efterfrågade månaden.
  assert.equal(kropp.months[11].month, MANAD);
  assert.equal(kropp.months[0].month, shiftMonth(MANAD, -11));
  assert.deepEqual(Object.keys(kropp).sort(), ['months', 'savedThisYear']);

  // Varje rad bär de fyra talen ur monthTotals för just den månaden: samma
  // ägare som en enskild månad, ingen andra väg till ett tal.
  for (const rad of kropp.months) {
    const manadens = readDemoMonth(createSeedState(IDAG), rad.month);
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      monthTotals(manadens.items),
      rad.month
    );
  }

  // De två månader seed-datan faktiskt når har innehåll, och de tio före är
  // tomma utan att vara utelämnade. Tio och inte nio: serien slutar i den
  // aktuella månaden, så seed-datans tredje månad (den kommande) ligger utanför
  // den, och av de tolv raderna är exakt två fyllda.
  const tidigaste = seedMonths(IDAG)[0];
  assert.equal(kropp.months.find((rad) => rad.month === tidigaste).incomeOre > 0, true);
  assert.equal(kropp.months.find((rad) => rad.month === MANAD).incomeOre > 0, true);
  const tomma = kropp.months.filter((rad) => rad.month < tidigaste);
  assert.equal(tomma.length, 10);
  for (const rad of tomma) {
    assert.deepEqual(
      { incomeOre: rad.incomeOre, expenseOre: rad.expenseOre, savingOre: rad.savingOre, leftOre: rad.leftOre },
      { incomeOre: 0, expenseOre: 0, savingOre: 0, leftOre: 0 },
      rad.month
    );
  }

  // savedThisYear är årets sparande till och med den aktuella månaden. Seed-datan
  // har sparande i den tidigaste och den aktuella månaden, alltså två månader av
  // de tio i året.
  assert.equal(kropp.savedThisYear > 0, true);
  assert.equal(kropp.savedThisYear, readDemoOverview(createSeedState(IDAG), MANAD, 12).savedThisYear);
});

test('attrappens översiktsväg kräver session, rätt metod och en riktig månad', async () => {
  const { fetch } = riggning();

  for (const manad of ['2026-13', '2026-1', 'oktober']) {
    const response = await fetch(`/api/oversikt/${manad}`);
    assert.equal(response.status, 400, manad);
    assert.deepEqual(await json(response), { error: SERVER_TEXTS.invalidMonth }, manad);
  }

  const fel = await fetch(`/api/oversikt/${MANAD}`, { method: 'POST', body: '{}' });
  assert.equal(fel.status, 405);
  assert.deepEqual(await json(fel), { error: SERVER_TEXTS.methodNotAllowed });

  // Utloggad: sessionsspärren går före månadsspärren, precis som i api.js.
  const utloggad = riggning();
  utloggad.state.loggedIn = false;
  const utan = await utloggad.fetch('/api/oversikt/2026-13');
  assert.equal(utan.status, 401);
  assert.deepEqual(await json(utan), { error: SERVER_TEXTS.notLoggedIn });
});

// --------------------------------------------- Planens två vägar i demoläget

// Demon ska kunna växla plan, så att en besökare ser funktioner låsas och låsas
// upp (ARKITEKTUR.md, "Del 5: planer och behörighet"). Attrappen svarar därför
// på samma två vägar som servern, med samma statuskoder och samma kropp.
test('demoläget svarar på GET och PUT /api/plan som servern', async () => {
  const { fetch, state } = riggning();

  const funktionerFor = (plan) => FEATURES.filter((feature) => hasFeature(plan, feature));

  // GET: demoanvändaren börjar på Bas, samma förval som kolumnen users.plan.
  const forst = await fetch('/api/plan');
  assert.equal(forst.status, 200);
  assert.deepEqual(await json(forst), { plan: 'bas', features: funktionerFor('bas') });

  // PUT: varje plan i PLANS, i ordning. Listan kommer ur modulen och skrivs
  // inte av här.
  for (const plan of Object.keys(PLANS)) {
    const bytt = await fetch('/api/plan', { method: 'PUT', body: JSON.stringify({ plan }) });
    assert.equal(bytt.status, 200, plan);
    assert.deepEqual(await json(bytt), { plan, features: funktionerFor(plan) }, plan);
    // Tillståndet bär värdet, och en GET efteråt ger samma svar.
    assert.equal(state.plan, plan, plan);
    const igen = await fetch('/api/plan');
    assert.deepEqual(await json(igen), { plan, features: funktionerFor(plan) }, plan);
  }

  // Premium har varje lägre plans funktioner: listan växer med arvet.
  assert.deepEqual((await json(await fetch('/api/plan'))).features, [...FEATURES]);

  // 400 med serverns text för en okänd plan, och tillståndet är orört.
  for (const plan of ['guld', 'Bas', '', null, 42, ['bas'], undefined]) {
    const fel = await fetch('/api/plan', { method: 'PUT', body: JSON.stringify({ plan }) });
    assert.equal(fel.status, 400, JSON.stringify(plan));
    assert.deepEqual(await json(fel), { error: SERVER_TEXTS.invalidPlan }, JSON.stringify(plan));
    assert.equal(state.plan, 'premium', JSON.stringify(plan));
  }

  // 405 för en metod vägen inte har.
  const metod = await fetch('/api/plan', { method: 'DELETE' });
  assert.equal(metod.status, 405);
  assert.deepEqual(await json(metod), { error: SERVER_TEXTS.methodNotAllowed });

  // 401 utan session, och sessionsspärren står före valideringen: en okänd plan
  // utan session ger 401 och inte 400.
  state.loggedIn = false;
  const utan = await fetch('/api/plan');
  assert.equal(utan.status, 401);
  assert.deepEqual(await json(utan), { error: SERVER_TEXTS.notLoggedIn });
  const utanPut = await fetch('/api/plan', { method: 'PUT', body: JSON.stringify({ plan: 'guld' }) });
  assert.equal(utanPut.status, 401);
  assert.deepEqual(await json(utanPut), { error: SERVER_TEXTS.notLoggedIn });
});

test('ett planbyte i demoläget sparas i lagringen och överlever en omladdning', async () => {
  const storage = createStorage();
  const forst = riggning({ storage });
  assert.equal(forst.state.plan, 'bas');

  const bytt = await forst.fetch('/api/plan', { method: 'PUT', body: JSON.stringify({ plan: 'plus' }) });
  assert.equal(bytt.status, 200);

  // En ny riggning läser tillståndet ur lagringen, precis som en omladdning av
  // sidan gör.
  const efter = riggning({ storage });
  assert.equal(efter.state.plan, 'plus');
  assert.deepEqual(await json(await efter.fetch('/api/plan')), {
    plan: 'plus',
    features: FEATURES.filter((feature) => hasFeature('plus', feature))
  });

  // Ett sparat tillstånd utan plan - alltså ett som sparades före det här
  // steget - kasseras av readState, och demon läser om seed-datan i stället
  // för att halvt använda det.
  const utanPlan = { ...efter.state };
  delete utanPlan.plan;
  storage.setItem(STORAGE_KEY, JSON.stringify(utanPlan));
  assert.equal(readState(storage), null);
  // Och ett sparat tillstånd med en plan som inte finns kasseras också: utan
  // raden hade värdet nått hasFeature, som kastar RangeError.
  storage.setItem(STORAGE_KEY, JSON.stringify({ ...efter.state, plan: 'guld' }));
  assert.equal(readState(storage), null);
  assert.equal(riggning({ storage }).state.plan, 'bas');
});

test('PLAN_LABELS och seed-datans plan hör ihop med PLANS', () => {
  // Seed-datans plan är en nyckel i PLANS, och den har ett svenskt namn: utan
  // det hade vyn Min plan visat en tom rad för demoanvändaren.
  const state = createSeedState(IDAG);
  assert.equal(Object.hasOwn(PLANS, state.plan), true, state.plan);
  assert.equal(PLAN_LABELS[state.plan], 'Bas');
});
