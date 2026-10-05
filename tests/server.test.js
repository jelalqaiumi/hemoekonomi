// Paket 5: HTTP-servern och den statiska filservern i src/server/server.js.
// Det här är den enda testfilen som går över riktig HTTP: det är routningen,
// statuskoderna, svarshuvudena och sökvägsfiltret som prövas, och inget av det
// går att pröva utan en lyssnande socket. API:ts innehåll prövas av
// tests/api.test.js, som anropar handleApiRequest direkt.
//
// Ingen körning binder 3000 (ARKITEKTUR.md, Teststrategi). Routnings- och
// filtertesterna startar servern på port 0 och låter kärnan tilldela en ledig
// port; de två sista testfallen behöver ett utskrivet portnummer och får det av
// sonden längst ned i filen — också det en port kärnan har delat ut, aldrig en
// som testet har valt själv. En körning kan därför aldrig krocka med en app som
// användaren redan har igång.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DataFileLockError } from '../src/server/lock.js';
import {
  getCoreDir,
  getDataFilePath,
  getImageDir,
  getLockFilePath,
  getWebDir
} from '../src/server/paths.js';
import {
  ServerStartError,
  asStartError,
  createServer,
  isDirectRun,
  resolvePort,
  start
} from '../src/server/server.js';

const HOST = '127.0.0.1';

const HTML_TYPE = 'text/html; charset=utf-8';
const CSS_TYPE = 'text/css; charset=utf-8';
const JS_TYPE = 'text/javascript; charset=utf-8';
const JSON_TYPE = 'application/json; charset=utf-8';
const PNG_TYPE = 'image/png';
const SVG_TYPE = 'image/svg+xml';

// http.request och inte fetch: både fetch och new URL() normaliserar bort
// punktsegment och avkodar delar av sökvägen innan anropet skickas, så en
// traversal-sond via fetch prövar ingenting alls. Här går sökvägen ut i
// förfrågningsraden ordagrant, precis som en angripares klient skulle skicka
// den.
//
// agent: false ger en egen socket per anrop, som stängs när svaret är läst. Med
// standardagenten (keep-alive sedan Node 19) skulle sockeln hållas öppen och
// server.close() vänta på att någon annan stänger den.
function rawRequest(port, rawPath, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, method, path: rawPath, agent: false },
      (res) => {
        const chunks = [];
        res.on('data', (chunk) => {
          chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => {
          resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) });
        });
      }
    );
    req.on('error', reject);
    req.end();
  });
}

// Stänger både lyssnaren och de sockets som är kvar. closeAllConnections först:
// server.close() väntar annars på varje öppen anslutning, och en väntan utan
// slut är samma sak som en hängning.
function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    // Callbacken körs även för en server som redan är stängd (då med ett
    // ERR_SERVER_NOT_RUNNING som argument), så anropet går att göra två gånger.
    server.close(() => resolve());
  });
}

// Städningen registreras som en after-hook och aldrig som ett finally: ett
// finally i en async-funktion körs inte om testköraren avbryter testet efter
// ett ohanterat kast någon annanstans i processen, och en kvarglömd lyssnare
// gör då att npm test aldrig avslutas — utan exitkod går kravet i CLAUDE.md
// inte att kontrollera (LARDOMAR.md 2026-09-04). Uppmätt: med städningen i ett
// finally slutade två av mutationskörningarna nedan i en process som aldrig
// tog slut (EXIT=124 från en yttre timeout); med after-hookar ger samma
// mutationer exit 1.
function useTempDataFile(t) {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  t.after(async () => {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  });
  return fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-server-')).then((dir) => {
    t.after(() => fs.rm(dir, { recursive: true, force: true }));
    const filePath = path.join(dir, 'entries.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
    // Användarens riktiga %APPDATA%\hemochekonomi\entries.json får aldrig röras
    // av ett test. Samma spärr som tests/storage.test.js har.
    assert.equal(getDataFilePath(), filePath);
    assert.equal(getDataFilePath().startsWith(os.tmpdir()), true);
    return filePath;
  });
}

async function useServer(t) {
  const filePath = await useTempDataFile(t);
  const server = createServer();
  t.after(() => closeServer(server));
  await new Promise((resolve) => {
    server.listen(0, HOST, resolve);
  });
  const address = server.address();
  assert.equal(address.address, HOST);
  assert.equal(typeof address.port, 'number');
  assert.notEqual(address.port, 0);
  return { port: address.port, filePath };
}

// Facit för den statiska 404:an: statusraden är hela svaret. Ingen kropp och
// ingen Content-Type (ARKITEKTUR.md, "Statiska filer").
async function assertStaticNotFound(port, rawPath) {
  const res = await rawRequest(port, rawPath);
  assert.equal(res.status, 404, rawPath);
  assert.equal(
    res.body.length,
    0,
    `${rawPath} gav en kropp på ${res.body.length} byte: ${res.body.toString('utf8').slice(0, 80)}`
  );
  assert.equal(res.headers['content-type'], undefined, rawPath);
}

async function assertFileServed(port, rawPath, filePath, type) {
  const expected = await fs.readFile(filePath);
  const res = await rawRequest(port, rawPath);
  assert.equal(res.status, 200, rawPath);
  assert.equal(res.headers['content-type'], type, rawPath);
  assert.equal(res.headers['content-length'], String(expected.length), rawPath);
  assert.equal(res.body.length, expected.length, rawPath);
  // equals() och inte deepEqual: två buffertar på tiotusentals byte som skiljer
  // sig skulle få deepEqual att bygga en fullständig diff innan meddelandet
  // trunkeras (LARDOMAR.md 2026-09-07). Längden ovan är den billiga assertionen
  // som faller först.
  assert.equal(res.body.equals(expected), true, `${rawPath} levererade inte innehållet i ${filePath}`);
}

test('varje rad i STATIC_ROUTES ger 200 med exakt den Content-Type tabellen anger', async (t) => {
  const { port } = await useServer(t);
  await assertFileServed(port, '/', path.join(getWebDir(), 'landning.html'), HTML_TYPE);
  await assertFileServed(port, '/app', path.join(getWebDir(), 'index.html'), HTML_TYPE);
  await assertFileServed(port, '/landning.css', path.join(getWebDir(), 'landning.css'), CSS_TYPE);
  await assertFileServed(port, '/tema.css', path.join(getWebDir(), 'tema.css'), CSS_TYPE);
  await assertFileServed(port, '/style.css', path.join(getWebDir(), 'style.css'), CSS_TYPE);
  await assertFileServed(port, '/app.js', path.join(getWebDir(), 'app.js'), JS_TYPE);
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('/ ger landningssidan och /app ger appen, och de är inte samma fil', async (t) => {
  const { port } = await useServer(t);
  const landning = await rawRequest(port, '/');
  const app = await rawRequest(port, '/app');
  assert.equal(landning.status, 200);
  assert.equal(app.status, 200);
  // Den billiga assertionen först: två buffertar som skiljer sig i längd
  // behöver ingen jämförelse byte för byte (LARDOMAR.md 2026-09-07).
  assert.notEqual(landning.body.length, app.body.length);
  assert.equal(landning.body.equals(app.body), false);

  // Vilken av de två som är vilken avgörs av innehållet och inte av längden.
  // Körd i en kopia av trädet:
  //   mutation: '/' och '/app' byter fil med varandra i STATIC_ROUTES ger
  //   EXIT=1, fail 3 och ✖ varje rad i STATIC_ROUTES ger 200 med exakt den
  //   Content-Type tabellen anger, ✖ / ger landningssidan och /app ger appen,
  //   och de är inte samma fil, ✖ start(0) lyssnar på 127.0.0.1 med en
  //   tilldelad port och svarar på /.
  const landningstext = landning.body.toString('utf8');
  const apptext = app.body.toString('utf8');
  assert.equal(landningstext.includes('Full koll på hemmet och ekonomin på ett ställe'), true);
  assert.equal(landningstext.includes('/landning.css'), true);
  assert.equal(apptext.includes('/app.js'), true);
  assert.equal(apptext.includes('id="login-view"'), true);
  // Landningssidan hämtar varken app.js eller style.css, och appen hämtar
  // varken landning.css eller loggan: filerna är två och blandas inte.
  assert.equal(landningstext.includes('/app.js'), false);
  assert.equal(apptext.includes('/landning.css'), false);
});

test('bilderna under /bilder/ ger 200 med sin egen Content-Type', async (t) => {
  const { port } = await useServer(t);
  // Ändelsen och ingenting annat avgör innehållstypen. Körd i en kopia:
  //   mutation: type: IMAGE_TYPES[match[1]] -> type: IMAGE_TYPES.png ger
  //   EXIT=1, fail 2 och ✖ bilderna under /bilder/ ger 200 med sin egen
  //   Content-Type samt ✖ varje bild i src/web/bilder levereras under
  //   /bilder/ med sitt eget innehåll.
  await assertFileServed(port, '/bilder/logga.png', path.join(getImageDir(), 'logga.png'), PNG_TYPE);
  await assertFileServed(port, '/bilder/symbol.svg', path.join(getImageDir(), 'symbol.svg'), SVG_TYPE);
  await assertFileServed(
    port,
    '/bilder/symbol-mork.svg',
    path.join(getImageDir(), 'symbol-mork.svg'),
    SVG_TYPE
  );
});

test('varje bild i src/web/bilder levereras under /bilder/ med sitt eget innehåll', async (t) => {
  const imageDir = getImageDir();
  const names = (await fs.readdir(imageDir))
    .filter((name) => name.endsWith('.png') || name.endsWith('.svg'))
    .sort();
  // Listan läses ur katalogen så att en ny bild kommer med utan att den här
  // filen ändras; antalet asserteras så att en tom katalog inte tyst gör
  // testet innehållslöst. Samma form som testet för /core/ ovan.
  assert.ok(names.length >= 3, `förväntade minst tre bilder i ${imageDir}, fick ${names.join(', ')}`);
  const { port } = await useServer(t);
  for (const name of names) {
    const type = name.endsWith('.png') ? PNG_TYPE : SVG_TYPE;
    await assertFileServed(port, `/bilder/${name}`, path.join(imageDir, name), type);
  }
});

test('sökvägsfiltret för /bilder/: en sökväg ut ur bildkatalogen ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  // Samma sonder som /core/ prövas med, översatta till bildvägen. Ingen av dem
  // får leverera en enda byte.
  //
  // Vilken sond som mäter filtret är körd och inte gissad, i en kopia av
  // trädet under scratchpad:
  //   mutation: IMAGE_FILE_PATTERN.exec(name) + null-kontrollen ersatt av ett
  //   uppslag av ändelsen utan någon kontroll alls ger EXIT=1, fail 1 och
  //   ✖ sökvägsfiltret för /bilder/: en sökväg ut ur bildkatalogen ger 404
  //   utan kropp, med meddelandet "/bilder/Logga.png ... 200 !== 404".
  // Det är alltså det versala namnet som fäller mutationen, precis som för
  // /core/: punktsegmenten normaliseras bort av new URL() innan
  // resolveStaticFile ser sökvägen, så traversal-sonderna ger 404 även utan
  // filtret. De står kvar som sonder ändå — de ska ge 404, och ett test som
  // bara prövar det filtret råkar fånga vore inget skydd mot att
  // normaliseringen byts ut.
  for (const rawPath of [
    '/bilder/../index.html',
    '/bilder/..%2findex.html',
    '/bilder/../../package.json',
    '/bilder/%2e%2e/index.html',
    '/bilder/..%2Fserver%2Fpaths.js',
    '/bilder/under/logga.png',
    '/bilder/Logga.png',
    '/bilder/LOGGA.PNG',
    '/bilder/logga.PNG',
    '/bilder/logga.png%00.png',
    '/bilder/logga.png.',
    '/bilder/logga.txt',
    '/bilder/logga.js',
    '/bilder/finns-inte.png',
    '/bilder/',
    '/bilder'
  ]) {
    await assertStaticNotFound(port, rawPath);
  }
  // Kontrollsond: filen är nåbar med sitt rätta namn, så 404 ovan beror på
  // filtret och inte på att servern slutat leverera bilder.
  await assertFileServed(port, '/bilder/logga.png', path.join(getImageDir(), 'logga.png'), PNG_TYPE);
});

test('en sökväg utanför /bilder/ ger 404 även när dess svans är ett bildfilnamn', async (t) => {
  const { port } = await useServer(t);
  // /bilden/ är exakt lika långt som /bilder/, så utan prefixkontrollen skulle
  // slice ge "logga.png" och servern leverera bilden från en väg som aldrig
  // funnits. Körd i en kopia av trädet:
  //   mutation: if (pathname.startsWith(IMAGE_PREFIX)) -> if (true) ger
  //   EXIT=1, fail 1 och ✖ en sökväg utanför /bilder/ ger 404 även när dess
  //   svans är ett bildfilnamn.
  for (const rawPath of ['/bilden/logga.png', '/xxxxxxxlogga.png', '/bilder2/logga.png']) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/bilder/logga.png', path.join(getImageDir(), 'logga.png'), PNG_TYPE);
});

test('varje modul i src/core levereras under /core/ med sitt eget innehåll', async (t) => {
  const coreDir = getCoreDir();
  const names = (await fs.readdir(coreDir)).filter((name) => name.endsWith('.js')).sort();
  // Kärnan har fyra moduler i dag och kan få fler i paket 7. Listan läses ur
  // katalogen så att en ny modul kommer med utan att den här filen ändras;
  // antalet asserteras så att en tom katalog inte tyst gör testet innehållslöst.
  assert.ok(names.length >= 4, `förväntade minst fyra moduler i ${coreDir}, fick ${names.join(', ')}`);
  const { port } = await useServer(t);
  for (const name of names) {
    await assertFileServed(port, `/core/${name}`, path.join(coreDir, name), JS_TYPE);
  }
});

test('en okänd statisk sökväg ger 404 utan kropp och utan Content-Type', async (t) => {
  const { port } = await useServer(t);
  for (const rawPath of [
    '/finns-inte',
    '/index.html',
    '/web/index.html',
    '/style.css.map',
    '/APP.JS',
    '/favicon.ico',
    '/core',
    '/core/',
    '/landning.html',
    '/tema.css.map',
    '/App',
    '/app/',
    '/app/index.html'
  ]) {
    await assertStaticNotFound(port, rawPath);
  }
});

test('GET /api/finns-inte ger 404 med JSON-kroppen medan GET /finns-inte ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  const res = await rawRequest(port, '/api/finns-inte');
  assert.equal(res.status, 404);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: 'Okänd adress.' });
  // Skillnaden mellan de två 404-svaren är avsiktlig och står som facit i
  // ARKITEKTUR.md: formen { "error": ... } gäller /api/* och ingenting annat.
  await assertStaticNotFound(port, '/finns-inte');
});

test('GET /api/entries hanteras av api.js och inte av den statiska vägen', async (t) => {
  const { port } = await useServer(t);
  const res = await rawRequest(port, '/api/entries');
  assert.equal(res.status, 200);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), { entries: [] });
});

test('sökvägsfiltret: de obligatoriska sonderna ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  // De sex sonderna ARKITEKTUR.md räknar upp under "Teststrategi", plus fyra
  // varianter av samma angrepp. Ingen av dem får leverera en enda byte, och
  // ingen fil utanför src/core/ får nås: assertionen kräver noll byte i kroppen.
  for (const rawPath of [
    '/core/../server/paths.js',
    '/core/..%2fpaths.js',
    '/core/../../package.json',
    '/core/Entry.js',
    '/core/under/entry.js',
    '/core/entry.txt',
    '/core/%2e%2e/paths.js',
    '/core/..%2Fserver%2Fpaths.js',
    '/core/entry.js%00.js',
    '/core/entry.js.'
  ]) {
    await assertStaticNotFound(port, rawPath);
  }
});

test('ett versalt filnamn under /core/ ger 404 fastän filsystemet är skiftlägesokänsligt', async (t) => {
  const { port } = await useServer(t);
  // Det här är den sond som mäter CORE_FILE_PATTERN. Traversal-sonderna ovan
  // ger 404 även utan filtret, eftersom new URL() normaliserar bort
  // punktsegmenten innan resolveStaticFile ser sökvägen; ett versalt namn når
  // däremot path.join och öppnar entry.js på ett skiftlägesokänsligt
  // filsystem. Uppmätt: med kontrollen mot CORE_FILE_PATTERN borttagen svarar
  // servern 200 med hela entry.js på alla tre sonderna.
  for (const rawPath of ['/core/Entry.js', '/core/ENTRY.JS', '/core/entry.JS']) {
    await assertStaticNotFound(port, rawPath);
  }
  // Kontrollsond: filen är nåbar med gemener, så 404 ovan beror på filtret och
  // inte på att filen saknas.
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('en sökväg utanför /core/ ger 404 även när dess svans är ett kärnfilnamn', async (t) => {
  const { port } = await useServer(t);
  // /apps/ är exakt lika långt som /core/, så utan prefixkontrollen skulle
  // pathname.slice(CORE_PREFIX.length) ge "entry.js" och servern leverera
  // kärnmodulen från en väg som aldrig funnits. Uppmätt: med kontrollen
  // borttagen svarar /apps/entry.js 200 med hela entry.js.
  for (const rawPath of ['/apps/entry.js', '/xxxxxentry.js', '/core2/entry.js']) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('ett filnamn som matchar mönstret men saknas på disk ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  // Rutten finns, filen gör det inte: läsfelet ska bli ett 404 och aldrig ett
  // kast som river hela anropet.
  for (const rawPath of ['/core/finns-inte.js', '/core/x-y-z9.js', '/core/a.js']) {
    await assertStaticNotFound(port, rawPath);
  }
});

test('start(0) lyssnar på 127.0.0.1 med en tilldelad port och svarar på /', async (t) => {
  await useTempDataFile(t);
  // Port 0 skickas in explicit: start() utan argument skulle binda 3000 och
  // krocka med en app som användaren redan har igång.
  const server = await start(0);
  t.after(() => closeServer(server));
  const address = server.address();
  assert.equal(address.address, HOST);
  assert.equal(typeof address.port, 'number');
  assert.notEqual(address.port, 0);
  await assertFileServed(address.port, '/', path.join(getWebDir(), 'landning.html'), HTML_TYPE);
});

// ---------------------------------------------- portvalet och autostarten
//
// Portvalet och autostartvillkoret prövas var för sig (ARKITEKTUR.md,
// "Teststrategi", punkt 1–4). Skälet till uppdelningen är att de två annars bara
// nås via start() utan argument respektive via att filen körs direkt, och ingen
// indata inifrån processen når dem utan att en fast port bands.

// Sonden. Ingen körning får binda 3000, och PORT=0 hjälper inte: 0 är falskt, så
// uttrycket ger DEFAULT_PORT (facittabellens rad '0'). En ledig port måste därför
// hämtas av kärnan med listen(0, …) och lämnas tillbaka innan den skickas vidare.
async function probeFreePort() {
  const server = http.createServer();
  await new Promise((resolve) => {
    server.listen(0, HOST, resolve);
  });
  const { port } = server.address();
  assert.equal(typeof port, 'number');
  assert.notEqual(port, 0);
  await new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
  return port;
}

// Sätter PORT för ett testfall och lämnar tillbaka miljön i en after-hook, aldrig
// i ett finally: ett finally körs inte när testköraren avbryter fallet efter ett
// ohanterat kast, och en kvarlämnad PORT skulle då styra varje senare fall.
function usePortEnv(t, value) {
  const previous = process.env.PORT;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.PORT;
    } else {
      process.env.PORT = previous;
    }
  });
  process.env.PORT = value;
}

// Serverns egen sökväg byggs ur import.meta.url, aldrig ur process.cwd(): en
// cwd-relativ sökväg pekar rätt bara så länge kommandot körs från projektroten
// (LARDOMAR.md 2026-09-04).
const SERVER_URL = new URL('../src/server/server.js', import.meta.url).href;
const SERVER_PATH = fileURLToPath(SERVER_URL);

// Hängningsspärr, inte en dödandetid: samma namn, samma minsta värde och samma
// skäl som konstanten i tests/storage.test.js (ARKITEKTUR.md, atomicitetstestets
// punkt 8). Den mäter ingenting och kan inte påverka utfallet av ett prov som
// blir av — den avgör bara att en barnprocess som aldrig hörs av ger ett fallerat
// test i stället för en väntan utan exitkod.
const CHILD_START_TIMEOUT_MS = 30000;

test('resolvePort: facittabellens sex rader, ett anrop per rad', () => {
  // Facittabellen under "src/server/server.js" i ARKITEKTUR.md. Miljön skickas in
  // som ett eget objekt per rad: inget anrop binder en port och inget rör
  // process.env.
  const beforePort = process.env.PORT;
  const rader = [
    { namn: 'osatt (undefined)', env: {}, vantat: 3000 },
    { namn: "''", env: { PORT: '' }, vantat: 3000 },
    { namn: "'   '", env: { PORT: '   ' }, vantat: 3000 },
    { namn: "'abc'", env: { PORT: 'abc' }, vantat: 3000 },
    { namn: "'0'", env: { PORT: '0' }, vantat: 3000 },
    { namn: "'8080'", env: { PORT: '8080' }, vantat: 8080 }
  ];
  for (const { namn, env, vantat } of rader) {
    assert.equal(resolvePort(env), vantat, `facittabellens rad PORT = ${namn}`);
  }
  assert.equal(process.env.PORT, beforePort, 'resolvePort ändrade process.env.PORT');
});

test('isDirectRun: serverns egen sökväg ger true, varje annan argv1 ger false', () => {
  // Båda utfallen prövas direkt, utan att något startas (ARKITEKTUR.md, punkt 2).
  assert.equal(isDirectRun(SERVER_PATH, SERVER_URL), true);
  // Samma fil, men en onormaliserad sökväg: path.resolve normaliserar, precis som
  // när npm start skickar in argv[1].
  // Sträng och inte path.join: path.join normaliserar bort punktsegmentet redan
  // här, och då prövar raden ingenting. Här når det ojämnade segmentet
  // path.resolve inuti isDirectRun, precis som ett argv[1] från ett skal gör.
  const kringvag = `${path.dirname(SERVER_PATH)}${path.sep}..${path.sep}server${path.sep}server.js`;
  assert.notEqual(kringvag, SERVER_PATH);
  assert.equal(isDirectRun(kringvag, SERVER_URL), true);
  // En annan fil: den här testfilen är den som faktiskt importerar servern.
  assert.equal(isDirectRun(fileURLToPath(import.meta.url), SERVER_URL), false);
  assert.equal(isDirectRun(path.join(path.dirname(SERVER_PATH), 'api.js'), SERVER_URL), false);
  // argv1 saknas helt: utan förstakontrollen skulle path.resolve(undefined) kasta
  // ett TypeError i stället för att svara false.
  assert.equal(isDirectRun(undefined, SERVER_URL), false);
});

test('start() utan argument lyssnar på den port PORT anger', async (t) => {
  await useTempDataFile(t);
  // Porten är kärnans, aldrig testets eget val: se probeFreePort ovan.
  const port = await probeFreePort();
  usePortEnv(t, String(port));
  // resolvePort() utan argument prövas här och bara här: default-parametern
  // env = process.env är den enda väg som läser miljön av sig själv, och
  // facittabellens anrop skickar alltid in sin egen miljö.
  assert.equal(resolvePort(), port);
  const server = await start();
  t.after(() => closeServer(server));
  const address = server.address();
  assert.equal(address.address, HOST);
  assert.equal(address.port, port, 'start() band en annan port än PORT angav');
  const res = await rawRequest(port, '/api/entries');
  assert.equal(res.status, 200);
});

test('node src/server/server.js startar servern, skriver sin rad och svarar på /', async (t) => {
  // Autostartens kropp — start(), server.address() och utskriften — nås inte av
  // något anrop inifrån processen och prövas därför i en barnprocess
  // (ARKITEKTUR.md, punkt 4). Det är samtidigt projektets enda automatiska prov
  // av npm start.
  const filePath = await useTempDataFile(t);
  const port = await probeFreePort();
  // Datafilen är en temporär fil: en spawnad server som skriver i användarens
  // riktiga datafil vore ett testfall som ändrar användarens data.
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    child.kill('SIGKILL');
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  const vantadRad = `Hemochekonomi kör på http://${HOST}:${port}`;
  const harRaden = () => stdout.split(/\r?\n/).includes(vantadRad);
  // Väntan på raden kapplöper mot exit, error och en timeout. Vinner något annat
  // faller testet med barnets exitCode, signalCode och stderr — en hängning ger
  // ingen exitkod alls, och då går kravet i CLAUDE.md att kontrollera
  // utgångskoden inte att uppfylla.
  const outcome = await new Promise((resolve) => {
    child.stdout.on('data', () => {
      if (harRaden()) {
        resolve({ kind: 'rad' });
      }
    });
    child.once('exit', () => resolve({ kind: 'exit' }));
    child.once('error', (error) => resolve({ kind: 'error', error }));
    AbortSignal.timeout(CHILD_START_TIMEOUT_MS).addEventListener(
      'abort',
      () => resolve({ kind: 'timeout' }),
      { once: true }
    );
  });

  if (outcome.kind !== 'rad') {
    // Sondens port kan tas av något annat mellan sonden och barnets listen. Då
    // avslutas barnet med EADDRINUSE, och orsaken skrivs ut i klartext i stället
    // för att testet hänger eller faller med en obegriplig text.
    const upptagen = stderr.includes('EADDRINUSE')
      ? ` Orsak: porten ${port} togs av något annat mellan sonden och barnets listen (EADDRINUSE).`
      : '';
    const orsak = outcome.error ? `${outcome.kind}: ${outcome.error.message}` : outcome.kind;
    assert.fail(
      `barnprocessen ${SERVER_PATH} skrev aldrig raden "${vantadRad}" (${orsak}): `
      + `exitCode=${child.exitCode}, signalCode=${child.signalCode}, `
      + `stdout=${JSON.stringify(stdout)}, stderr=${stderr}${upptagen}`
    );
  }

  const res = await rawRequest(port, '/');
  assert.equal(res.status, 200);
});

// ------------------------------------- ett trasigt anrop får inte döda appen
//
// Obligatoriskt i paket 5 (ARKITEKTUR.md, "Ett trasigt anrop får inte döda
// appen" och teststrategins motsvarande punkt). Förfrågningsraderna skickas som
// råa byte över en net.Socket: http.request({ path }) ger alltid en sökväg i
// origin-form och kan därför aldrig nå felet.

// Hängningsspärr, inte en assertion på körtid: raden i tabellen under "Inget
// test asserterar på körtid" i ARKITEKTUR.md. Den bryter väntan på ett svar som
// aldrig kommer på sockeln och på ett start() som aldrig fullbordar sitt löfte —
// utan .catch(...) i createServer respektive once('error', reject) i start
// kommer inget svar respektive inget avslut, och en hängning ger ingen exitkod
// alls. Ett anrop i samma process svarar på millisekunder, så 30 000 ms kan inte
// göra ett prov som blir av till ett falskt fel.
const RESPONSE_TIMEOUT_MS = 30000;
const CR_LF = String.fromCharCode(13) + String.fromCharCode(10);
const HANGDE = Symbol('hängde');

function hangGuard() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(HANGDE), RESPONSE_TIMEOUT_MS).unref();
  });
}

// Skickar en förfrågningsrad ordagrant och läser allt som kommer tillbaka.
// Sockelfel (servern stänger mitt i svaret) är ett utfall och inte ett kast:
// rad S3 provoceras just genom att svaret bryts.
function sendRawLine(port, line) {
  return new Promise((resolve) => {
    let fel = null;
    let text = '';
    const socket = net.connect(port, HOST, () => {
      socket.write(`${line}\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
    });
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      text += chunk;
    });
    socket.on('error', (error) => {
      fel = error;
    });
    socket.on('close', () => resolve({ text, fel }));
  });
}

// Ett svar utan kropp ser olika ut på tråden beroende på hur det skickas. Ett
// 404 utan Content-Length skickas chunkat, och då avslutas svaret med en tom
// avslutschunk (siffran noll följd av två radbrytningspar). Innehållet är noll
// byte i båda formerna, och det är innehållet facit talar om — rawRequest ovan
// gör samma avkodning åt oss när anropet går via http.request.
const CHUNKAD_TOM_KROPP = '0' + CR_LF + CR_LF;

function kroppsinnehall(body) {
  return body === CHUNKAD_TOM_KROPP ? '' : body;
}

async function rawLineResponse(port, line) {
  const utfall = await Promise.race([sendRawLine(port, line), hangGuard()]);
  assert.notEqual(utfall, HANGDE, `inget svar kom på sockeln för förfrågningsraden ${line}`);
  const [huvuden, ...rest] = utfall.text.split('\r\n\r\n');
  const statusLine = huvuden.split('\r\n')[0];
  return {
    statusLine,
    status: Number(statusLine.split(' ')[1]),
    huvuden,
    body: rest.join('\r\n\r\n'),
    fel: utfall.fel
  };
}

// Startar en server med en egen hanterare — den seam ARKITEKTUR.md kräver för
// rad S2 och S3: utan den finns ingen indata som når spärren i createServer.
async function useHandlerServer(t, handler) {
  await useTempDataFile(t);
  const server = createServer(handler);
  t.after(() => closeServer(server));
  await new Promise((resolve) => {
    server.listen(0, HOST, resolve);
  });
  return server.address().port;
}

// Kastar på sitt första anrop och svarar som en okänd statisk sökväg därefter.
// Det andra, vanliga anropet är beviset att processen lever. Den synkrona
// varianten returnerar ett löfte i det icke-kastande fallet, eftersom
// createServer skriver handler(req, res).catch(...).
function kastarForsta(sort) {
  let forsta = true;
  if (sort === 'async') {
    return async (req, res) => {
      if (forsta) {
        forsta = false;
        throw new Error('trasig');
      }
      res.writeHead(404);
      res.end();
    };
  }
  return (req, res) => {
    if (forsta) {
      forsta = false;
      throw new Error('trasig');
    }
    res.writeHead(404);
    res.end();
    return Promise.resolve();
  };
}

test('rad S1: en förfrågningsrad som new URL inte kan tolka ger 400 och servern lever vidare', async (t) => {
  const { port } = await useServer(t);
  // Körd utredning: alla fyra raderna passerar Nodes HTTP-parser och når
  // lyssnaren med req.url ordagrant, och new URL kastar TypeError med
  // code ERR_INVALID_URL för var och en.
  for (const line of [
    'GET http://[v1.x]/ HTTP/1.1',
    'GET http://[::1 HTTP/1.1',
    'GET https://[fe80::1%25]/ HTTP/1.1',
    'GET http://%/ HTTP/1.1'
  ]) {
    const res = await rawLineResponse(port, line);
    assert.equal(res.status, 400, `${line}: ${res.statusLine}`);
    assert.equal(res.huvuden.includes('Content-Type: application/json; charset=utf-8'), true, line);
    assert.deepEqual(JSON.parse(res.body), { error: 'Kunde inte tolka anropet.' }, line);
    // Beviset att processen lever: nästa anrop besvaras som vanligt.
    const efter = await rawRequest(port, '/api/entries');
    assert.equal(efter.status, 200, `${line}: servern svarade inte efteråt`);
  }
});

test('OPTIONS * HTTP/1.1 ger 404 utan kropp och servern lever vidare', async (t) => {
  const { port } = await useServer(t);
  // Raden är ingen webbläsarförfrågan och är därför just den sortens indata som
  // aldrig prövats. Körd: req.url blir "*", new URL("*", basen) ger pathname
  // "/*", alltså en okänd statisk sökväg — inget fall för rad S1.
  const res = await rawLineResponse(port, 'OPTIONS * HTTP/1.1');
  assert.equal(res.status, 404, res.statusLine);
  assert.equal(kroppsinnehall(res.body), '', `kroppen var ${JSON.stringify(res.body)}`);
  assert.equal(res.huvuden.includes('Content-Type'), false, res.huvuden);
  const efter = await rawRequest(port, '/api/entries');
  assert.equal(efter.status, 200);
});

test('rad S2: en hanterare som kastar ger 500 med svensk text, och nästa anrop besvaras', async (t) => {
  for (const sort of ['sync', 'async']) {
    const port = await useHandlerServer(t, kastarForsta(sort));
    const res = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
    assert.equal(res.status, 500, `${sort}: ${res.statusLine}`);
    assert.equal(res.huvuden.includes('Content-Type: application/json; charset=utf-8'), true, sort);
    assert.deepEqual(JSON.parse(res.body), { error: 'Ett oväntat fel inträffade. Försök igen.' }, sort);

    // Det andra, vanliga anropet: 404 utan kropp — beviset att processen lever.
    const efter = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
    assert.equal(efter.status, 404, `${sort}: ${efter.statusLine}`);
    assert.equal(kroppsinnehall(efter.body), '', sort);
  }
});

test('det brutna kontraktet: createServer(() => undefined) ger 500 med rad S2:s kropp på två anrop i rad', async (t) => {
  // ARKITEKTUR.md, teststrategin: handler ska enligt kontraktet returnera ett
  // löfte. En hanterare som returnerar undefined bryter kontraktet, och då kastar
  // .catch(...) ett TypeError inne i samma try — det kastet fångas av try/catch
  // och besvaras som rad S2. Fallet finns just för att skilja de två
  // konstruktionerna i createServer åt: .catch(...) kan inte fånga ett fel som
  // uppstår när .catch(...) självt anropas.
  //
  // Körd (utfallet var arkitektens läsning och okört): båda anropen gav
  // HTTP/1.1 500 Internal Server Error med Content-Type
  // application/json; charset=utf-8 och kroppen
  // {"error":"Ett oväntat fel inträffade. Försök igen."}.
  //
  // Två anrop i rad och ingen 404-gren: hanteraren bryter kontraktet vid varje
  // anrop, så beviset att processen lever är att det andra anropet också
  // besvaras — inte att det svarar något annat.
  const port = await useHandlerServer(t, () => undefined);
  for (const nummer of [1, 2]) {
    const res = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
    assert.equal(res.status, 500, `anrop ${nummer}: ${res.statusLine}`);
    assert.equal(
      res.huvuden.includes('Content-Type: application/json; charset=utf-8'),
      true,
      `anrop ${nummer}: ${res.huvuden}`
    );
    assert.deepEqual(
      JSON.parse(res.body),
      { error: 'Ett oväntat fel inträffade. Försök igen.' },
      `anrop ${nummer}`
    );
  }
});

test('rad S3: en hanterare som kastar efter writeHead avbryter svaret utan att döda processen', async (t) => {
  let forsta = true;
  // async, till skillnad från den synkrona varianten i rad S2-fallet: kastet
  // blir då en avvisning, och det är .catch(...) i createServer som ska fånga det.
  const port = await useHandlerServer(t, async (req, res) => {
    if (forsta) {
      forsta = false;
      // Svaret är påbörjat: det utlovar 100 byte som aldrig kommer.
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 100 });
      throw new Error('trasig');
    }
    res.writeHead(404);
    res.end();
  });

  const utfall = await Promise.race([sendRawLine(port, 'GET /vad-som-helst HTTP/1.1'), hangGuard()]);
  assert.notEqual(utfall, HANGDE, 'sockeln gav varken ett svar eller en stängning');
  // Svaret var påbörjat (headersSent är true efter writeHead), men huvudena
  // spolas först vid write eller end: när sendUnexpectedError stänger sockeln
  // med res.destroy() har ingenting hunnit ut på tråden. Klienten ser alltså ett
  // avbrutet svar — inget statussvar, ingen kropp — och inte de utlovade 100
  // byten.
  assert.equal(utfall.text, '', `klienten fick ${JSON.stringify(utfall.text)}`);

  const efter = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
  assert.equal(efter.status, 404, efter.statusLine);
  assert.equal(kroppsinnehall(efter.body), '');
});

// -------------------------------------------------- npm start på en upptagen port
//
// Obligatoriskt i paket 5 (ARKITEKTUR.md, "Beteende vid start"). asStartError
// anropas direkt, en gång per rad i tabellen, och rad 1 provoceras dessutom på
// riktigt. Före rättningen skrev den andra processen tolv rader engelskt
// stackspår och avslutades med EXIT=1 utan ett enda svenskt ord.

// Tabellens tre strängar, skrivna här ordagrant. Porten är bara ett tal i en
// sträng i de tre direktanropen — inget av dem binder någonting.
function upptagenText(port) {
  return `Port ${port} är upptagen. Stäng programmet som använder porten, `
    + 'eller sätt PORT till ett annat portnummer och starta om Hemochekonomi.';
}

test('asStartError: tabellens fyra rader, ett anrop per rad', () => {
  const port = 3098;

  // Rad 0: ett DataFileLockError går vidare med sitt eget meddelande ordagrant.
  // Ingen ny sträng skrivs, och portnumret får aldrig smyga in i den — låset
  // handlar om datafilen, inte om porten. Utan raden skulle rad 3 skriva över
  // låsets svenska text med en mening om porten.
  const lasFel = new DataFileLockError(
    'Hemochekonomi kör redan i en annan process (pid 4711) mot samma datafil: C:\\tmp\\entries.json. '
    + 'Stäng den först — två samtidiga körningar mot samma fil kan förstöra dina poster.'
  );
  const rad0 = asStartError(port, lasFel);
  assert.ok(rad0 instanceof ServerStartError, `rad 0: förväntade ServerStartError, fick ${rad0}`);
  assert.equal(rad0.name, 'ServerStartError');
  assert.equal(rad0.message, lasFel.message);
  assert.equal(rad0.message.includes(String(port)), false, rad0.message);
  assert.equal(rad0.cause, lasFel);

  const rader = [
    ['EADDRINUSE', upptagenText(port)],
    ['EACCES', `Port ${port} gick inte att öppna: åtkomst nekades. Sätt PORT till ett annat portnummer.`],
    ['EFELSTAVAT', `Servern kunde inte startas på port ${port}.`]
  ];

  for (const [code, vantat] of rader) {
    const original = Object.assign(new Error('listen ' + code), { code });
    const fel = asStartError(port, original);
    assert.ok(fel instanceof ServerStartError, `${code}: förväntade ServerStartError, fick ${fel}`);
    assert.equal(fel.name, 'ServerStartError', code);
    assert.equal(fel.message, vantat, code);
    assert.equal(fel.cause, original, code);
  }

  // Ett fel utan code alls är också rad 3: invarianten ska hålla för ett fel
  // ingen har sett.
  const utanCode = new Error('något helt annat');
  assert.equal(asStartError(port, utanCode).message, `Servern kunde inte startas på port ${port}.`);
});

test('start på en upptagen port avvisas med rad 1:s svenska text i stället för att krascha', async (t) => {
  await useTempDataFile(t);
  // Porten är kärnans, aldrig testets eget val, och den hålls upptagen av en
  // egen server under hela fallet.
  const upptagen = http.createServer();
  t.after(() => closeServer(upptagen));
  await new Promise((resolve) => {
    upptagen.listen(0, HOST, resolve);
  });
  const { port } = upptagen.address();

  const utfall = await Promise.race([
    start(port).then((server) => ({ sort: 'server', server }), (error) => ({ sort: 'fel', error })),
    hangGuard()
  ]);
  assert.notEqual(
    utfall,
    HANGDE,
    'start() svarade aldrig: löftet varken uppfylldes eller avvisades inom hängningsspärren'
  );
  if (utfall.sort === 'server') {
    t.after(() => closeServer(utfall.server));
  }
  assert.equal(utfall.sort, 'fel', 'start() lyckades binda en port som redan var upptagen');

  const { error } = utfall;
  assert.ok(error instanceof ServerStartError, `förväntade ServerStartError, fick ${error}`);
  assert.equal(error.message, upptagenText(port));
  assert.equal(error.message.includes('address already in use'), false, error.message);
  assert.ok(error.cause, 'cause var inte satt');
  assert.equal(error.cause.code, 'EADDRINUSE');

  // Låset togs före listen och ska vara släppt igen: misslyckas listen anropas
  // releaseDataFileLock innan felet kastas vidare. Utan det släppandet ligger
  // låsfilen kvar med den här processens levande pid, och nästa start mot samma
  // datafil — i en annan process — avvisas med rad L1 fastän ingen server kör.
  assert.equal(
    await fs.access(getLockFilePath()).then(() => true, () => false),
    false,
    'låsfilen låg kvar efter ett misslyckat listen'
  );

  // Testprocessen lever vidare, och start fungerar fortfarande.
  const efter = await start(0);
  t.after(() => closeServer(efter));
  const res = await rawRequest(efter.address().port, '/api/entries');
  assert.equal(res.status, 200);
});

test('node src/server/server.js mot en upptagen port skriver svensk text till stderr och avslutas med 1', async (t) => {
  // Autostartens felgren nås inte av något anrop inifrån processen: den prövas
  // i en barnprocess, precis som den lyckade grenen ovan. Det här är projektets
  // enda automatiska prov av npm start när porten är upptagen.
  const filePath = await useTempDataFile(t);
  const upptagen = http.createServer();
  t.after(() => closeServer(upptagen));
  await new Promise((resolve) => {
    upptagen.listen(0, HOST, resolve);
  });
  const { port } = upptagen.address();

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  t.after(() => {
    child.kill('SIGKILL');
  });

  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });

  // Samma hängningsspärr som den lyckade grenen: ett barn som aldrig avslutas
  // ska ge ett fallerat test i stället för en väntan utan exitkod.
  const utfall = await Promise.race([
    new Promise((resolve) => {
      child.once('exit', (code) => resolve({ sort: 'exit', code }));
      child.once('error', (error) => resolve({ sort: 'error', error }));
    }),
    new Promise((resolve) => {
      setTimeout(() => resolve({ sort: 'timeout' }), CHILD_START_TIMEOUT_MS).unref();
    })
  ]);

  assert.equal(
    utfall.sort,
    'exit',
    `barnprocessen avslutades aldrig (${utfall.sort}): stdout=${JSON.stringify(stdout)}, stderr=${stderr}`
  );
  assert.equal(utfall.code, 1, `stderr=${stderr}`);
  assert.equal(stdout, '', 'ett misslyckat listen får inte skriva någon rad till stdout');
  assert.equal(
    stderr,
    `Port ${port} är upptagen. Stäng programmet som använder porten, `
    + 'eller sätt PORT till ett annat portnummer och starta om Hemochekonomi.\n'
  );
  assert.equal(stderr.includes('address already in use'), false, stderr);
  assert.equal(stderr.includes('Error:'), false, stderr);
});
