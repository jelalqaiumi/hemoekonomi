import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DatabaseError, closeDatabase } from '../src/server/db.js';
import {
  getCoreDir,
  getImageDir,
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

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

function useTempDataFile(t) {
  const previous = process.env.HEMOCHEKONOMI_DB_FILE;
  process.env.HEMOCHEKONOMI_DB_FILE = ':memory:';
  void closeDatabase();
  t.after(async () => {
    await closeDatabase();
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DB_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DB_FILE = previous;
    }
  });
  return Promise.resolve(':memory:');
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
  await assertFileServed(port, '/integritet', path.join(getWebDir(), 'integritet.html'), HTML_TYPE);
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('/ ger landningssidan och /app ger appen, och de är inte samma fil', async (t) => {
  const { port } = await useServer(t);
  const landning = await rawRequest(port, '/');
  const app = await rawRequest(port, '/app');
  assert.equal(landning.status, 200);
  assert.equal(app.status, 200);
  assert.notEqual(landning.body.length, app.body.length);
  assert.equal(landning.body.equals(app.body), false);

  const landningstext = landning.body.toString('utf8');
  const apptext = app.body.toString('utf8');
  assert.equal(landningstext.includes('Full koll på hemmet och ekonomin på ett ställe'), true);
  assert.equal(landningstext.includes('/landning.css'), true);
  assert.equal(apptext.includes('/app.js'), true);
  assert.equal(apptext.includes('id="login-view"'), true);
  assert.equal(landningstext.includes('/app.js'), false);
  assert.equal(apptext.includes('/landning.css'), false);
});

test('(H6) bilderna under /bilder/ ger 200 med sin egen Content-Type', async (t) => {
  const { port } = await useServer(t);
  await assertFileServed(
    port,
    '/bilder/hem-ekonomi-logga.svg',
    path.join(getImageDir(), 'hem-ekonomi-logga.svg'),
    SVG_TYPE
  );
  await assertFileServed(port, '/bilder/hero.png', path.join(getImageDir(), 'hero.png'), PNG_TYPE);
});

test('(H9) landning.css pekar ut hero-bilden, och adressen ger image/png', async (t) => {
  const css = await fs.readFile(path.join(getWebDir(), 'landning.css'), 'utf8');
  const urls = [...css.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((match) => match[2]);
  assert.deepEqual(urls, ['bilder/hero.png'], `landning.css har url(): ${urls.join(', ')}`);
  assert.equal(/image-set\s*\(/i.test(css), false, 'landning.css innehåller image-set(');
  const pathname = new URL(urls[0], 'http://127.0.0.1/landning.css').pathname;
  assert.equal(pathname, '/bilder/hero.png');
  const { port } = await useServer(t);
  await assertFileServed(port, pathname, path.join(getImageDir(), 'hero.png'), PNG_TYPE);
});

test('(H7) src/web/bilder har exakt loggorna och hero-bilden, och varje bild levereras under /bilder/ med sitt eget innehåll', async (t) => {
  const imageDir = getImageDir();
  const names = (await fs.readdir(imageDir)).sort();
  assert.deepEqual(names, ['hem-ekonomi-ikon.svg', 'hem-ekonomi-logga-vit.svg', 'hem-ekonomi-logga.svg', 'hero.png']);
  const { port } = await useServer(t);
  for (const name of names) {
    const type = name.endsWith('.svg') ? SVG_TYPE : PNG_TYPE;
    await assertFileServed(port, `/bilder/${name}`, path.join(imageDir, name), type);
  }
});

test('sökvägsfiltret för /bilder/: en sökväg ut ur bildkatalogen ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  for (const rawPath of [
    '/bilder/../index.html',
    '/bilder/..%2findex.html',
    '/bilder/../../package.json',
    '/bilder/%2e%2e/index.html',
    '/bilder/..%2Fserver%2Fpaths.js',
    '/bilder/under/hero.png',
    '/bilder/Hero.png',
    '/bilder/HERO.PNG',
    '/bilder/hero.png%00.png',
    '/bilder/hero.png.',
    '/bilder/hero.png::$DATA',
    '/bilder/hero.txt',
    '/bilder/hero.js',
    '/bilder/finns-inte.png',
    '/bilder/finns-inte.svg',
    '/bilder/hero.PNG',
    '/bilder/HERO.png',
    '/bilder/hem-ekonomi-ikon.SVG',
    '/bilder/HEM-EKONOMI-IKON.svg',
    '/bilder/',
    '/bilder'
  ]) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/bilder/hero.png', path.join(getImageDir(), 'hero.png'), PNG_TYPE);
});

test('en sökväg utanför /bilder/ ger 404 även när dess svans är ett bildfilnamn', async (t) => {
  const { port } = await useServer(t);
  for (const rawPath of ['/bilden/hero.png', '/xxxxxxxhero.png', '/bilder2/hero.png']) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/bilder/hero.png', path.join(getImageDir(), 'hero.png'), PNG_TYPE);
});

test('varje modul i src/core levereras under /core/ med sitt eget innehåll', async (t) => {
  const coreDir = getCoreDir();
  const names = (await fs.readdir(coreDir)).filter((name) => name.endsWith('.js')).sort();
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
  await assertStaticNotFound(port, '/finns-inte');
});

test('GET /api/mig hanteras av api.js och inte av den statiska vägen', async (t) => {
  const { port } = await useServer(t);
  const res = await rawRequest(port, '/api/mig');
  assert.equal(res.status, 401);
  assert.equal(res.headers['content-type'], JSON_TYPE);
  assert.deepEqual(JSON.parse(res.body.toString('utf8')), { error: 'Du är inte inloggad.' });
});

test('GET /healthz svarar 200 ok för värdtjänstens hälsokontroll', async (t) => {
  const { port } = await useServer(t);
  const res = await rawRequest(port, '/healthz');
  assert.equal(res.status, 200);
  assert.equal(res.body.toString('utf8'), 'ok');
});

test('varje svar bär säkerhetshuvudena', async (t) => {
  const { port } = await useServer(t);
  for (const väg of ['/', '/app', '/api/mig', '/finns-inte']) {
    const res = await rawRequest(port, väg);
    assert.equal(res.headers['x-content-type-options'], 'nosniff', väg);
    assert.equal(res.headers['x-frame-options'], 'DENY', väg);
    assert.equal(res.headers['referrer-policy'], 'same-origin', väg);
  }
});

test('sökvägsfiltret: de obligatoriska sonderna ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
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
  for (const rawPath of ['/core/Entry.js', '/core/ENTRY.JS', '/core/entry.JS']) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('en sökväg utanför /core/ ger 404 även när dess svans är ett kärnfilnamn', async (t) => {
  const { port } = await useServer(t);
  for (const rawPath of ['/apps/entry.js', '/xxxxxentry.js', '/core2/entry.js']) {
    await assertStaticNotFound(port, rawPath);
  }
  await assertFileServed(port, '/core/entry.js', path.join(getCoreDir(), 'entry.js'), JS_TYPE);
});

test('ett filnamn som matchar mönstret men saknas på disk ger 404 utan kropp', async (t) => {
  const { port } = await useServer(t);
  for (const rawPath of ['/core/finns-inte.js', '/core/x-y-z9.js', '/core/a.js']) {
    await assertStaticNotFound(port, rawPath);
  }
});

test('start(0) lyssnar på 127.0.0.1 med en tilldelad port och svarar på /', async (t) => {
  await useTempDataFile(t);
  const server = await start(0);
  t.after(() => closeServer(server));
  const address = server.address();
  assert.equal(address.address, HOST);
  assert.equal(typeof address.port, 'number');
  assert.notEqual(address.port, 0);
  await assertFileServed(address.port, '/', path.join(getWebDir(), 'landning.html'), HTML_TYPE);
});

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

const SERVER_URL = new URL('../src/server/server.js', import.meta.url).href;
const SERVER_PATH = fileURLToPath(SERVER_URL);

const CHILD_START_TIMEOUT_MS = 30000;

test('resolvePort: facittabellens sex rader, ett anrop per rad', () => {
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
  assert.equal(isDirectRun(SERVER_PATH, SERVER_URL), true);
  const kringvag = `${path.dirname(SERVER_PATH)}${path.sep}..${path.sep}server${path.sep}server.js`;
  assert.notEqual(kringvag, SERVER_PATH);
  assert.equal(isDirectRun(kringvag, SERVER_URL), true);
  assert.equal(isDirectRun(fileURLToPath(import.meta.url), SERVER_URL), false);
  assert.equal(isDirectRun(path.join(path.dirname(SERVER_PATH), 'api.js'), SERVER_URL), false);
  assert.equal(isDirectRun(undefined, SERVER_URL), false);
});

test('start() utan argument lyssnar på den port PORT anger', async (t) => {
  await useTempDataFile(t);
  const port = await probeFreePort();
  usePortEnv(t, String(port));
  assert.equal(resolvePort(), port);
  const server = await start();
  t.after(() => closeServer(server));
  const address = server.address();
  assert.equal(address.address, HOST);
  assert.equal(address.port, port, 'start() band en annan port än PORT angav');
  const res = await rawRequest(port, '/healthz');
  assert.equal(res.status, 200);
});

test('node src/server/server.js startar servern, skriver sin rad och svarar på /', async (t) => {
  const filePath = await useTempDataFile(t);
  const port = await probeFreePort();
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, HEMOCHEKONOMI_DB_FILE: ':memory:', PORT: String(port) },
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

  const vantadRad = `Hem och Ekonomi kör på http://${HOST}:${port}`;
  const harRaden = () => stdout.split(/\r?\n/).includes(vantadRad);
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

const RESPONSE_TIMEOUT_MS = 30000;
const CR_LF = String.fromCharCode(13) + String.fromCharCode(10);
const HANGDE = Symbol('hängde');

function hangGuard() {
  return new Promise((resolve) => {
    setTimeout(() => resolve(HANGDE), RESPONSE_TIMEOUT_MS).unref();
  });
}

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

async function useHandlerServer(t, handler) {
  await useTempDataFile(t);
  const server = createServer(handler);
  t.after(() => closeServer(server));
  await new Promise((resolve) => {
    server.listen(0, HOST, resolve);
  });
  return server.address().port;
}

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
    const efter = await rawRequest(port, '/healthz');
    assert.equal(efter.status, 200, `${line}: servern svarade inte efteråt`);
  }
});

test('OPTIONS * HTTP/1.1 ger 404 utan kropp och servern lever vidare', async (t) => {
  const { port } = await useServer(t);
  const res = await rawLineResponse(port, 'OPTIONS * HTTP/1.1');
  assert.equal(res.status, 404, res.statusLine);
  assert.equal(kroppsinnehall(res.body), '', `kroppen var ${JSON.stringify(res.body)}`);
  assert.equal(/^Content-Type:/im.test(res.huvuden), false, res.huvuden);
  const efter = await rawRequest(port, '/healthz');
  assert.equal(efter.status, 200);
});

test('rad S2: en hanterare som kastar ger 500 med svensk text, och nästa anrop besvaras', async (t) => {
  for (const sort of ['sync', 'async']) {
    const port = await useHandlerServer(t, kastarForsta(sort));
    const res = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
    assert.equal(res.status, 500, `${sort}: ${res.statusLine}`);
    assert.equal(res.huvuden.includes('Content-Type: application/json; charset=utf-8'), true, sort);
    assert.deepEqual(JSON.parse(res.body), { error: 'Ett oväntat fel inträffade. Försök igen.' }, sort);

    const efter = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
    assert.equal(efter.status, 404, `${sort}: ${efter.statusLine}`);
    assert.equal(kroppsinnehall(efter.body), '', sort);
  }
});

test('det brutna kontraktet: createServer(() => undefined) ger 500 med rad S2:s kropp på två anrop i rad', async (t) => {
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
  const port = await useHandlerServer(t, async (req, res) => {
    if (forsta) {
      forsta = false;
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Length': 100 });
      throw new Error('trasig');
    }
    res.writeHead(404);
    res.end();
  });

  const utfall = await Promise.race([sendRawLine(port, 'GET /vad-som-helst HTTP/1.1'), hangGuard()]);
  assert.notEqual(utfall, HANGDE, 'sockeln gav varken ett svar eller en stängning');
  assert.equal(utfall.text, '', `klienten fick ${JSON.stringify(utfall.text)}`);

  const efter = await rawLineResponse(port, 'GET /vad-som-helst HTTP/1.1');
  assert.equal(efter.status, 404, efter.statusLine);
  assert.equal(kroppsinnehall(efter.body), '');
});

function upptagenText(port) {
  return `Port ${port} är upptagen. Stäng programmet som använder porten, `
    + 'eller sätt PORT till ett annat portnummer och starta om Hem och Ekonomi.';
}

test('asStartError: tabellens fyra rader, ett anrop per rad', () => {
  const port = 3098;

  const dbFel = new DatabaseError('Databasen kunde inte öppnas. Kontakta den som driftar appen.');
  const rad0 = asStartError(port, dbFel);
  assert.ok(rad0 instanceof ServerStartError, `rad 0: förväntade ServerStartError, fick ${rad0}`);
  assert.equal(rad0.message, 'Databasen gick inte att öppna. Kontrollera DATABASE_URL och försök igen.');
  assert.equal(rad0.cause, dbFel);

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

  const utanCode = new Error('något helt annat');
  assert.equal(asStartError(port, utanCode).message, `Servern kunde inte startas på port ${port}.`);
});

test('start på en upptagen port avvisas med rad 1:s svenska text i stället för att krascha', async (t) => {
  await useTempDataFile(t);
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

  const efter = await start(0);
  t.after(() => closeServer(efter));
  const res = await rawRequest(efter.address().port, '/healthz');
  assert.equal(res.status, 200);
});

test('node src/server/server.js mot en upptagen port skriver svensk text till stderr och avslutas med 1', async (t) => {
  const filePath = await useTempDataFile(t);
  const upptagen = http.createServer();
  t.after(() => closeServer(upptagen));
  await new Promise((resolve) => {
    upptagen.listen(0, HOST, resolve);
  });
  const { port } = upptagen.address();

  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, HEMOCHEKONOMI_DB_FILE: ':memory:', PORT: String(port) },
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
    + 'eller sätt PORT till ett annat portnummer och starta om Hem och Ekonomi.\n'
  );
  assert.equal(stderr.includes('address already in use'), false, stderr);
  assert.equal(stderr.includes('Error:'), false, stderr);
});
