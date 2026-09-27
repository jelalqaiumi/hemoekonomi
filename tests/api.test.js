// Paket 5: HTTP-API:t. Testar handleApiRequest direkt, utan att starta en
// server — routing, statuskoder och varje felmeddelande i ARKITEKTUR.md:s
// HTTP-API-tabell.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { INTERVALS } from '../src/core/entry.js';
import { handleApiRequest } from '../src/server/api.js';
import { loadEntries, saveEntries } from '../src/server/storage.js';

const GILTIGT_UTKAST = Object.freeze({
  name: 'Hyra',
  amountSek: '8500,50',
  interval: 'monthly',
  startDate: '2026-01-25',
  category: 'housing'
});

// Hängningsspärr, inte en assertion på körtid: raden i tabellen under "Inget test
// asserterar på körtid" i ARKITEKTUR.md. Den bryter väntan på ett
// handleApiRequest som aldrig fullbordar sitt löfte — utan lyssnaren på
// 'error' i readBody svarar ett avbrutet anrop aldrig, och en hängning ger
// ingen exitkod alls. Ett anrop i samma process svarar på millisekunder, så
// 30 000 ms kan inte göra ett prov som blir av till ett falskt fel.
const RESPONSE_TIMEOUT_MS = 30000;

// Antal omgångar i samtidighetsfallen. ARKITEKTUR.md kräver minst 20.
const OMGANGAR = 20;

class MockResponse {
  constructor() {
    this.statusCode = null;
    this.headers = null;
    this.chunks = [];
    this.ended = false;
  }

  writeHead(statusCode, headers) {
    this.statusCode = statusCode;
    this.headers = headers ?? null;
    return this;
  }

  end(chunk) {
    if (chunk !== undefined) {
      this.chunks.push(chunk);
    }
    this.ended = true;
  }

  get text() {
    return this.chunks.join('');
  }

  get body() {
    return JSON.parse(this.text);
  }
}

// setImmediate och inte queueMicrotask: lyssnarna i readBody sätts upp under
// den synkrona delen av handleApiRequest, och setImmediate körs garanterat
// efter den.
function makeRequest(method, body) {
  const req = new EventEmitter();
  req.method = method;
  setImmediate(() => {
    if (typeof body === 'string') {
      req.emit('data', Buffer.from(body, 'utf8'));
    }
    req.emit('end');
  });
  return req;
}

// En förfrågan där klienten bryter anropet mitt i kroppen.
function makeAbortedRequest(method) {
  const req = new EventEmitter();
  req.method = method;
  setImmediate(() => {
    req.emit('error', new Error('ECONNRESET'));
  });
  return req;
}

async function useTempDataFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-api-'));
  const filePath = path.join(dir, 'entries.json');
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  t.after(async () => {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });
  return filePath;
}

async function call(method, pathname, body) {
  const res = new MockResponse();
  const handled = await handleApiRequest(makeRequest(method, body), res, pathname);
  return { handled, res };
}

async function createEntryViaApi(utkast = GILTIGT_UTKAST) {
  const { res } = await call('POST', '/api/entries', JSON.stringify(utkast));
  assert.equal(res.statusCode, 201, res.text);
  return res.body.entry;
}

test('handleApiRequest returnerar false och rör inte svaret för en väg utanför /api', async (t) => {
  await useTempDataFile(t);
  for (const pathname of ['/', '/app.js', '/style.css', '/core/entry.js', '/apple', '/apientries']) {
    const res = new MockResponse();
    const handled = await handleApiRequest(makeRequest('GET'), res, pathname);
    assert.equal(handled, false, pathname);
    assert.equal(res.statusCode, null, pathname);
    assert.equal(res.ended, false, pathname);
  }
});

test('/api utan efterföljande del är en api-väg och ger 404 Okänd adress.', async (t) => {
  await useTempDataFile(t);
  const { handled, res } = await call('GET', '/api');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 404);
  assert.deepEqual(res.body, { error: 'Okänd adress.' });
});

test('en okänd väg under /api/ ger 404 Okänd adress.', async (t) => {
  await useTempDataFile(t);
  for (const pathname of ['/api/', '/api/other', '/api/entry', '/api/entries/a/b', '/api/entries/', '/api/entriesabc']) {
    const { handled, res } = await call('DELETE', pathname);
    assert.equal(handled, true, pathname);
    assert.equal(res.statusCode, 404, pathname);
    assert.deepEqual(res.body, { error: 'Okänd adress.' }, pathname);
  }
});

test('GET /api/entries ger 200 med en tom lista när inget är sparat', async (t) => {
  await useTempDataFile(t);
  const { handled, res } = await call('GET', '/api/entries');
  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'application/json; charset=utf-8');
  assert.deepEqual(res.body, { entries: [] });
});

test('POST /api/entries ger 201 med posten, och posten syns i GET', async (t) => {
  await useTempDataFile(t);
  const { handled, res } = await call('POST', '/api/entries', JSON.stringify(GILTIGT_UTKAST));
  assert.equal(handled, true);
  assert.equal(res.statusCode, 201);

  const { entry } = res.body;
  assert.equal(typeof entry.id, 'string');
  assert.equal(entry.name, 'Hyra');
  // Beloppet tolkas av createEntry: strängen "8500,50" blir talet 8500.5.
  assert.equal(entry.amountSek, 8500.5);
  assert.equal(entry.interval, 'monthly');
  assert.equal(entry.startDate, '2026-01-25');
  assert.equal(entry.category, 'housing');

  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [entry] });
});

test('POST /api/entries tar emot amountSek både som sträng och som tal', async (t) => {
  await useTempDataFile(t);
  const somStrang = await createEntryViaApi({ ...GILTIGT_UTKAST, amountSek: '199,90' });
  const somTal = await createEntryViaApi({ ...GILTIGT_UTKAST, amountSek: 199.9 });
  assert.equal(somStrang.amountSek, 199.9);
  assert.equal(somTal.amountSek, 199.9);
});

test('DELETE /api/entries/<id> ger 204 utan body och tar bort posten', async (t) => {
  await useTempDataFile(t);
  const entry = await createEntryViaApi();
  const kvar = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Elnät' });

  const { handled, res } = await call('DELETE', `/api/entries/${entry.id}`);
  assert.equal(handled, true);
  assert.equal(res.statusCode, 204);
  assert.equal(res.text, '');

  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [kvar] });
});

test('DELETE av ett id som inte finns ger 404 Posten finns inte.', async (t) => {
  await useTempDataFile(t);
  const entry = await createEntryViaApi();

  // Exakt strängjämförelse: varken trimning, versalskillnad eller ett tillagt
  // tecken får matcha.
  for (const id of ['finns-inte', ` ${entry.id}`, `${entry.id} `, entry.id.toUpperCase(), `${entry.id}x`]) {
    const { res } = await call('DELETE', `/api/entries/${id}`);
    assert.equal(res.statusCode, 404, id);
    assert.deepEqual(res.body, { error: 'Posten finns inte.' }, id);
  }

  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [entry] });
});

test('en metod som inte stöds ger 405 Metoden stöds inte.', async (t) => {
  await useTempDataFile(t);
  const entry = await createEntryViaApi();

  for (const method of ['PUT', 'PATCH', 'DELETE']) {
    const { res } = await call(method, '/api/entries');
    assert.equal(res.statusCode, 405, method);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, method);
  }

  for (const method of ['GET', 'POST', 'PUT']) {
    const { res } = await call(method, `/api/entries/${entry.id}`);
    assert.equal(res.statusCode, 405, method);
    assert.deepEqual(res.body, { error: 'Metoden stöds inte.' }, method);
  }
});

test('POST med trasig JSON ger 400 Kunde inte tolka anropet. utan fieldErrors', async (t) => {
  await useTempDataFile(t);
  for (const body of ['{', '{"name":}', 'inte json', '{"name": "A",}']) {
    const { res } = await call('POST', '/api/entries', body);
    assert.equal(res.statusCode, 400, body);
    assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' }, body);
  }
  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [] });
});

test('POST utan body ger 400 Kunde inte tolka anropet.', async (t) => {
  await useTempDataFile(t);
  const { res } = await call('POST', '/api/entries');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' });
});

test('POST där klienten bryter anropet svarar 400 i stället för att hänga', async (t) => {
  await useTempDataFile(t);
  // Tidsgränsen är ingen assertion på körtid utan ett skydd mot en hängning:
  // utan lyssnaren på 'error' i readBody fullbordas löftet aldrig, och ett test
  // som hänger ger ingen exitkod alls.
  const timeout = new Promise((resolve) => {
    setTimeout(() => resolve('HÄNGDE'), RESPONSE_TIMEOUT_MS).unref();
  });
  const res = new MockResponse();
  const utfall = await Promise.race([
    handleApiRequest(makeAbortedRequest('POST'), res, '/api/entries'),
    timeout
  ]);
  assert.notEqual(utfall, 'HÄNGDE', 'handleApiRequest svarade aldrig på ett avbrutet anrop');
  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, { error: 'Kunde inte tolka anropet.' });
});

test('POST med en body som är giltig JSON men inte ett objekt ger fältfel för alla fem fälten', async (t) => {
  await useTempDataFile(t);
  for (const body of ['null', '"abc"', '42', 'true', '[]', '[{"name":"A"}]']) {
    const { res } = await call('POST', '/api/entries', body);
    assert.equal(res.statusCode, 400, body);
    assert.deepEqual(
      res.body.fieldErrors.map((fieldError) => fieldError.field),
      ['name', 'amountSek', 'interval', 'startDate', 'category'],
      body
    );
    assert.equal(res.body.error, 'Namnet får inte vara tomt.', body);
  }
  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [] });
});

test('POST med ogiltiga fält ger 400 med de exakta svenska meddelandena och skapar ingen post', async (t) => {
  await useTempDataFile(t);

  const fall = [
    [{ ...GILTIGT_UTKAST, name: '   ' }, 'name', 'Namnet får inte vara tomt.'],
    [{ ...GILTIGT_UTKAST, name: 'a'.repeat(61) }, 'name', 'Namnet får vara högst 60 tecken.'],
    [{ ...GILTIGT_UTKAST, name: '🎵'.repeat(61) }, 'name', 'Namnet får vara högst 60 tecken.'],
    [{ ...GILTIGT_UTKAST, amountSek: 'abc' }, 'amountSek', 'Beloppet måste vara ett tal.'],
    [{ ...GILTIGT_UTKAST, amountSek: '0' }, 'amountSek', 'Beloppet måste vara större än 0 kr.'],
    [{ ...GILTIGT_UTKAST, amountSek: -5 }, 'amountSek', 'Beloppet måste vara större än 0 kr.'],
    [{ ...GILTIGT_UTKAST, amountSek: '10000000' }, 'amountSek', 'Beloppet får vara högst 9 999 999,99 kr.'],
    [{ ...GILTIGT_UTKAST, amountSek: '1,234' }, 'amountSek', 'Beloppet får ha högst två decimaler.'],
    [
      { ...GILTIGT_UTKAST, interval: 'weekly' },
      'interval',
      'Välj ett giltigt betalningsintervall: månadsvis, kvartalsvis, halvårsvis eller årsvis.'
    ],
    [{ ...GILTIGT_UTKAST, startDate: '25 januari' }, 'startDate', 'Startdatum måste anges som ÅÅÅÅ-MM-DD.'],
    [{ ...GILTIGT_UTKAST, startDate: '' }, 'startDate', 'Startdatum måste anges som ÅÅÅÅ-MM-DD.'],
    [{ ...GILTIGT_UTKAST, startDate: '2026-02-30' }, 'startDate', 'Startdatum är inget giltigt datum.'],
    [
      { ...GILTIGT_UTKAST, startDate: '1969-12-31' },
      'startDate',
      'Startdatum måste ligga mellan 1970-01-01 och 2099-12-31.'
    ],
    [{ ...GILTIGT_UTKAST, category: 'mat' }, 'category', 'Välj en giltig kategori.']
  ];

  for (const [utkast, field, message] of fall) {
    const { res } = await call('POST', '/api/entries', JSON.stringify(utkast));
    assert.equal(res.statusCode, 400, message);
    assert.deepEqual(res.body.fieldErrors, [{ field, message }], message);
    // Toppnivåns error bär första fältfelets meddelande.
    assert.equal(res.body.error, message);
  }

  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [] });
});

test('ett internt id-fel ger 500 utan fieldErrors, inte 400', async (t) => {
  await useTempDataFile(t);
  const riktig = globalThis.crypto;
  Object.defineProperty(globalThis, 'crypto', {
    value: { randomUUID: () => '   ' },
    configurable: true
  });
  t.after(() => {
    Object.defineProperty(globalThis, 'crypto', { value: riktig, configurable: true });
  });

  const { res } = await call('POST', '/api/entries', JSON.stringify(GILTIGT_UTKAST));
  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, { error: 'Posten kunde inte skapas på grund av ett internt fel.' });
  assert.equal(Object.hasOwn(res.body, 'fieldErrors'), false);

  const list = await call('GET', '/api/entries');
  assert.deepEqual(list.res.body, { entries: [] });
});

test('en skadad datafil ger 500 med lagringens svenska text på alla tre vägarna', async (t) => {
  const filePath = await useTempDataFile(t);
  await fs.writeFile(filePath, '{ trasig', 'utf8');
  const vantat = `Datafilen är skadad och kunde inte läsas: ${filePath}`;

  const list = await call('GET', '/api/entries');
  assert.equal(list.res.statusCode, 500);
  assert.deepEqual(list.res.body, { error: vantat });

  const created = await call('POST', '/api/entries', JSON.stringify(GILTIGT_UTKAST));
  assert.equal(created.res.statusCode, 500);
  assert.deepEqual(created.res.body, { error: vantat });

  const removed = await call('DELETE', '/api/entries/nagot-id');
  assert.equal(removed.res.statusCode, 500);
  assert.deepEqual(removed.res.body, { error: vantat });
});

test('en skrivning som misslyckas ger 500 vid både POST och DELETE', async (t) => {
  const filePath = await useTempDataFile(t);
  const entry = await createEntryViaApi();

  // Datafilen hålls öppen av en annan handtagare: fs.rename ger då EPERM på
  // Windows, precis som i tests/storage.test.js rad "rename som misslyckas".
  const handle = await fs.open(filePath, 'r');
  t.after(() => handle.close());
  const vantat = `Datafilen kunde inte sparas: den nya filen gick inte att byta in: ${filePath}`;

  const created = await call('POST', '/api/entries', JSON.stringify({ ...GILTIGT_UTKAST, name: 'Ny' }));
  assert.equal(created.res.statusCode, 500, created.res.text);
  assert.deepEqual(created.res.body, { error: vantat });

  const removed = await call('DELETE', `/api/entries/${entry.id}`);
  assert.equal(removed.res.statusCode, 500, removed.res.text);
  assert.deepEqual(removed.res.body, { error: vantat });

  await handle.close();
  // Ingen av de misslyckade skrivningarna fick ändra det som ligger på disk.
  assert.deepEqual(await loadEntries(), [entry]);
});

test('POST lägger posten sist och rör inte de poster som redan finns', async (t) => {
  await useTempDataFile(t);
  const forst = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Först' });
  const sedan = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Sedan' });
  const list = await call('GET', '/api/entries');
  assert.deepEqual(
    list.res.body.entries.map((entry) => entry.name),
    ['Först', 'Sedan']
  );
  assert.notEqual(forst.id, sedan.id);
});

test('allt som API:t skapar kan lagringen läsa tillbaka', async (t) => {
  await useTempDataFile(t);
  const skapade = [];
  // INTERVALS och inte en egen lista: ett nytt intervall ska prövas här utan
  // att någon uppdaterar raden.
  for (const interval of INTERVALS) {
    skapade.push(await createEntryViaApi({ ...GILTIGT_UTKAST, interval }));
  }
  assert.deepEqual(await loadEntries(), skapade);
  await saveEntries(skapade);
});

// ------------------------------------------------- två samtidiga anrop
//
// Obligatoriskt i paket 5 (ARKITEKTUR.md, "två överlappande anrop får inte
// tappa en ändring"). Två samtidiga anrop är två handleApiRequest som inte
// inväntas var för sig; ingen server behövs. Med loadEntries följt av
// saveEntries i hanterarna gav granskarens körning 20 av 20 omgångar där bara
// en POST blev av och 19 av 20 där bara den ena borttagningen blev av — båda
// gångerna med två svar som sa att det gick bra.

test('två samtidiga POST ger 201 var och två poster på disk', async (t) => {
  const filePath = await useTempDataFile(t);
  for (let omgang = 0; omgang < OMGANGAR; omgang += 1) {
    await fs.rm(filePath, { force: true });

    const [a, b] = await Promise.all([
      call('POST', '/api/entries', JSON.stringify({ ...GILTIGT_UTKAST, name: 'Klick A' })),
      call('POST', '/api/entries', JSON.stringify({ ...GILTIGT_UTKAST, name: 'Klick B' }))
    ]);

    assert.equal(a.res.statusCode, 201, `omgång ${omgang}: ${a.res.text}`);
    assert.equal(b.res.statusCode, 201, `omgång ${omgang}: ${b.res.text}`);
    assert.notEqual(a.res.body.entry.id, b.res.body.entry.id, `omgång ${omgang}: samma id`);

    const kvar = await loadEntries();
    assert.equal(kvar.length, 2, `omgång ${omgang}: ${kvar.length} poster på disk, ${JSON.stringify(kvar.map((e) => e.name))}`);
    assert.deepEqual(kvar.map((entry) => entry.name).sort(), ['Klick A', 'Klick B'], `omgång ${omgang}`);
  }
});

test('två samtidiga DELETE av olika poster ger 204 var och lämnar exakt en post', async (t) => {
  const filePath = await useTempDataFile(t);
  for (let omgang = 0; omgang < OMGANGAR; omgang += 1) {
    await fs.rm(filePath, { force: true });
    const forsta = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Ett' });
    const andra = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Två' });
    const tredje = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Tre' });

    const [a, b] = await Promise.all([
      call('DELETE', `/api/entries/${forsta.id}`),
      call('DELETE', `/api/entries/${andra.id}`)
    ]);

    assert.equal(a.res.statusCode, 204, `omgång ${omgang}: ${a.res.text}`);
    assert.equal(b.res.statusCode, 204, `omgång ${omgang}: ${b.res.text}`);

    const kvar = await loadEntries();
    assert.equal(kvar.length, 1, `omgång ${omgang}: ${JSON.stringify(kvar.map((e) => e.name))}`);
    assert.equal(kvar[0].id, tredje.id, `omgång ${omgang}: fel post kvar`);
  }
});

test('två samtidiga DELETE av samma post ger ett 204 och ett 404', async (t) => {
  const filePath = await useTempDataFile(t);
  for (let omgang = 0; omgang < OMGANGAR; omgang += 1) {
    await fs.rm(filePath, { force: true });
    const entry = await createEntryViaApi({ ...GILTIGT_UTKAST, name: 'Ensam' });

    const svar = await Promise.all([
      call('DELETE', `/api/entries/${entry.id}`),
      call('DELETE', `/api/entries/${entry.id}`)
    ]);

    // Vilket av löftena som får vilken kod är inte bestämt: koderna jämförs som
    // en mängd. Beslutet "finns posten?" fattas inuti köplatsen, så exakt ett
    // anrop kan se posten.
    const koder = svar.map(({ res }) => res.statusCode).sort();
    assert.deepEqual(koder, [204, 404], `omgång ${omgang}`);
    const nekat = svar.find(({ res }) => res.statusCode === 404);
    assert.deepEqual(nekat.res.body, { error: 'Posten finns inte.' }, `omgång ${omgang}`);
    assert.deepEqual(await loadEntries(), [], `omgång ${omgang}: posten låg kvar`);
  }
});

// ------------------------------------------- api.js importerar inte saveEntries
//
// Obligatoriskt i paket 5 (ARKITEKTUR.md, "Paket 5: `api.js` importerar inte
// saveEntries"). Regeln under src/server/storage.js i "Gränssnitt" —
// saveEntries skriver en KÄND lista, och varje läs-ändra-skriv går genom
// updateEntries — var annars bara en mening i det dokumentet, och en mening kan
// paket 6 och 7 inte falla på. Skillnaden mellan de två vägarna är 20 tappade
// poster på 20 omgångar i granskarens körning.

// Sökvägen byggs ur import.meta.url, aldrig ur process.cwd(): en cwd-relativ
// sökväg pekar rätt bara så länge kommandot körs från projektroten
// (LARDOMAR.md 2026-09-04).
const API_PATH = fileURLToPath(new URL('../src/server/api.js', import.meta.url));

test('src/server/api.js importerar från ./storage.js på ett ställe, namngivet och utan saveEntries', async () => {
  const kalla = await fs.readFile(API_PATH, 'utf8');

  // Exakt ett ställe: en andra import — eller ett dynamiskt import('./storage.js')
  // — vore en andra väg in i lagringen som den namngivna listan nedan inte
  // täcker.
  const forekomster = kalla.split("'./storage.js'").length - 1;
  assert.equal(forekomster, 1, `'./storage.js' förekommer ${forekomster} gånger i ${API_PATH}`);

  // Namngiven import, alltså aldrig import * as: en namnrymdsimport ger tillgång
  // till varje export utan att något namn står skrivet, och då kan regeln inte
  // läsas ur filen.
  const match = /import\s*\{([^}]*)\}\s*from\s*'\.\/storage\.js'/.exec(kalla);
  assert.notEqual(
    match,
    null,
    `förekomsten av './storage.js' i ${API_PATH} är ingen namngiven importsats`
  );

  // Regeln gäller BINDNINGEN saveEntries och inte strängen: `saveEntries as
  // spara` importerar samma funktion under ett annat namn, och en jämförelse mot
  // hela listelementet är falsk för just den stavningen — mätt, den släpptes
  // igenom med ✔ (LARDOMAR.md 2026-09-07). Varje element normaliseras därför till
  // sitt importerade namn innan jämförelsen.
  const namn = match[1]
    .split(',')
    .map((del) => del.split(/\s+as\s+/)[0].trim())
    .filter((del) => del !== '');
  assert.equal(
    namn.includes('saveEntries'),
    false,
    `api.js importerar saveEntries: [${namn.join(', ')}]. Varje läs-ändra-skriv går genom updateEntries.`
  );
});
