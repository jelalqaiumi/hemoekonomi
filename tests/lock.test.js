// Paket 5: låset på datafilen — en instans i taget.
//
// Obligatoriskt i ARKITEKTUR.md ("Paket 5: två instanser mot samma datafil").
// Fallen prövar processgränsen och kan därför inte prövas inifrån en process:
// varje instans är en riktig barnprocess som startas med
// spawn(process.execPath, [serverPath], …), där serverPath byggs ur
// import.meta.url och aldrig ur process.cwd() (LARDOMAR.md 2026-09-04).
//
// Före låset, uppmätt med två serverprocesser på 3111 och 3112 mot samma
// datafil, 20 omgångar av Promise.all([POST mot A, POST mot B]):
// omgångar där en post tappades: 20 av 20, poster på disk till slut: 20
// (förväntat 40). Det är samma indata som fall 1 nedan.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import { DataFileLockError, acquireDataFileLock, releaseDataFileLock } from '../src/server/lock.js';
import { getDataFilePath, getLockFilePath } from '../src/server/paths.js';
import { ServerStartError, start } from '../src/server/server.js';
import { loadEntries } from '../src/server/storage.js';

const HOST = '127.0.0.1';

// Serverns egen sökväg byggs ur import.meta.url, aldrig ur process.cwd(): en
// cwd-relativ sökväg pekar rätt bara så länge kommandot körs från projektroten.
const SERVER_PATH = fileURLToPath(new URL('../src/server/server.js', import.meta.url));

// Hängningsspärrar, inte mätningar: samma namn, samma minsta värde (30 000 ms)
// och samma skäl som konstanterna i tests/server.test.js och
// tests/storage.test.js. De avgör bara att en väntan som annars vore oändlig ger
// ett fallerat test i stället för en körning utan exitkod.
const CHILD_START_TIMEOUT_MS = 30000;
const RESPONSE_TIMEOUT_MS = 30000;
// Tredje rollen: väntan på att låset släpps av server.once('close', …). Det
// släppandet är ett löfte ingen anropare kan invänta, så väntan måste peka på
// filen. Samma konstruktion och samma minsta värde som de två ovan: den mäter
// ingenting och avgör bara att en väntan som annars vore oändlig ger ett
// fallerat test i stället för en körning utan exitkod.
const LOCK_RELEASE_TIMEOUT_MS = 30000;

// ARKITEKTUR.md kräver minst 20 omgångar i fall 1.
const OMGANGAR = 20;

const GILTIGT_UTKAST = Object.freeze({
  name: 'Hyra',
  amountSek: '8500,50',
  interval: 'monthly',
  startDate: '2026-01-25',
  category: 'housing'
});

// ---------------------------------------------------------------- de fyra strängarna
//
// Rad L1–L2 i tabellen under "Låset på datafilen — en instans i taget", skrivna
// här ordagrant. Rad L1 namnger datafilen, rad L2 låsfilen.

function radL1(pid, dataFilePath) {
  return `Hemochekonomi kör redan i en annan process (pid ${pid}) mot samma datafil: ${dataFilePath}. `
    + 'Stäng den först — två samtidiga körningar mot samma fil kan förstöra dina poster.';
}

function radL2(lockPath) {
  return `Hemochekonomi kunde inte starta: låsfilen ${lockPath} går inte att tolka. `
    + 'Kontrollera att appen inte redan kör, ta bort filen och försök igen.';
}

function radL3(lockPath) {
  return `Hemochekonomi kunde inte starta: låsfilen ${lockPath} gick inte att läsa. `
    + 'Kontrollera att appen inte redan kör, ta bort filen och försök igen.';
}

function radL4(lockPath) {
  return `Hemochekonomi kunde inte starta: låsfilen ${lockPath} gick inte att skapa.`;
}

// Rad L5: processen håller själv låset på den datafilen. Raden namnger
// DATAFILEN och bär ingen pid — det är den egna processen, och en pid som pekar
// på en själv hjälper ingen.
function radL5(dataFilePath) {
  return `Hemochekonomi kör redan i den här processen mot samma datafil: ${dataFilePath}. `
    + 'En datafil används av högst en instans i taget — stäng den första servern innan du startar en ny.';
}

// Låsfilens innehåll är en märkning: pid, kolon, ett uuid och ett radslut.
// Mönstret står här i testet och inte importerat ur modulen: en importerad
// konstant vore samma kod som prövas av sig själv.
const MARKING = /^([0-9]+):[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\n$/;

function assertMarkning(innehall, pid, beskrivning) {
  const match = MARKING.exec(innehall);
  assert.notEqual(match, null, `${beskrivning}: ${JSON.stringify(innehall)} är ingen märkning`);
  assert.equal(Number(match[1]), pid, beskrivning);
}

// ---------------------------------------------------------------- hjälpare

// Låsfilens namn ägs av paths.js och skrivs aldrig för hand här: en handskriven
// `${filePath}.lock` vore en andra kopia av samma regel, och då kan mutationen
// "byt getLockFilePath mot en annan sökväg" inte fällas av det här testet.
function lockPathFor(filePath) {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  try {
    return getLockFilePath();
  } finally {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  }
}

// En egen temporär katalog per testfall. Städningen registreras som en
// after-hook och aldrig som ett finally: ett finally körs inte om testköraren
// avbryter fallet, och en kvarglömd katalog eller miljövariabel skulle då följa
// med till nästa fall.
async function tempDataFile(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return path.join(dir, 'entries.json');
}

// Sätter HEMOCHEKONOMI_DATA_FILE i testprocessen, så att loadEntries() läser
// just den filen, och lämnar tillbaka miljön i en after-hook. Användarens
// riktiga %APPDATA%\hemochekonomi\entries.json får aldrig röras av ett test.
async function useTempDataFile(t) {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  t.after(() => {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  });
  const filePath = await tempDataFile(t);
  process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  assert.equal(getDataFilePath(), filePath);
  assert.equal(getDataFilePath().startsWith(os.tmpdir()), true);
  return filePath;
}

// Sonden. Ingen körning får binda 3000, och PORT=0 hjälper inte: 0 är falskt, så
// resolvePort ger DEFAULT_PORT. En ledig port måste därför hämtas av kärnan med
// listen(0, …) och lämnas tillbaka innan den skickas vidare.
//
// Att instans tvås port är LEDIG är ett krav och ingen detalj: med instans ettas
// port skulle en trasig låsning falla på EADDRINUSE, och fallet vore då bevisat
// av fel spärr.
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

function spawnServer(t, filePath, port) {
  const child = spawn(process.execPath, [SERVER_PATH], {
    env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath, PORT: String(port) },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  const state = { child, port, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  t.after(() => {
    child.kill('SIGKILL');
  });
  return state;
}

function startLine(port) {
  return `Hemochekonomi kör på http://${HOST}:${port}`;
}

function beskriv(state) {
  return `exitCode=${state.child.exitCode}, signalCode=${state.child.signalCode}, `
    + `stdout=${JSON.stringify(state.stdout)}, stderr=${JSON.stringify(state.stderr)}`;
}

// Väntan på ett barn som ska starta är väntan på dess utskrivna rad, och den
// kapplöper mot exit, error och hängningsspärren. Ingen väntan är en tidsgräns
// som räknas som en mätning.
function waitForStartLine(state) {
  const har = () => state.stdout.split(/\r?\n/).includes(startLine(state.port));
  return new Promise((resolve) => {
    if (har()) {
      resolve({ kind: 'rad' });
      return;
    }
    state.child.stdout.on('data', () => {
      if (har()) {
        resolve({ kind: 'rad' });
      }
    });
    state.child.once('exit', () => resolve({ kind: 'exit' }));
    state.child.once('error', (error) => resolve({ kind: 'error', error }));
    AbortSignal.timeout(CHILD_START_TIMEOUT_MS).addEventListener(
      'abort',
      () => resolve({ kind: 'timeout' }),
      { once: true }
    );
  });
}

// Väntan på ett barn som ska vägra är väntan på dess avslut. 'close' och inte
// 'exit': 'close' kommer först när stdout och stderr är tömda, och utan det kan
// en assertion på stderr läsa en halv sträng.
function waitForClose(state) {
  return new Promise((resolve) => {
    state.child.once('close', (code, signal) => resolve({ kind: 'close', code, signal }));
    state.child.once('error', (error) => resolve({ kind: 'error', error }));
    AbortSignal.timeout(CHILD_START_TIMEOUT_MS).addEventListener(
      'abort',
      () => resolve({ kind: 'timeout' }),
      { once: true }
    );
  });
}

async function assertStarted(state) {
  const utfall = await waitForStartLine(state);
  assert.equal(
    utfall.kind,
    'rad',
    `barnprocessen skrev aldrig raden "${startLine(state.port)}" (${utfall.kind}): ${beskriv(state)}`
  );
}

// http.request och en hängningsspärr: en instans som har dött svarar aldrig, och
// en väntan utan slut ger ingen exitkod alls.
function request(port, method, requestPath, body) {
  const svar = new Promise((resolve, reject) => {
    const headers = body === undefined
      ? {}
      : { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) };
    const req = http.request({ host: HOST, port, method, path: requestPath, headers, agent: false }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('error', reject);
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString('utf8') }));
    });
    req.on('error', reject);
    req.end(body);
  });
  const guard = new Promise((resolve) => {
    setTimeout(() => resolve({ status: 'inget svar inom hängningsspärren' }), RESPONSE_TIMEOUT_MS).unref();
  });
  return Promise.race([svar, guard]);
}

// ---------------------------------------------------------------- fall 1

test('fall 1: instans två startar inte mot samma datafil, 20 omgångar', async (t) => {
  const filePath = await useTempDataFile(t);
  const portEtt = await probeFreePort();
  const ettan = spawnServer(t, filePath, portEtt);
  await assertStarted(ettan);

  const vantatStderr = `${radL1(ettan.child.pid, filePath)}\n`;
  let startade = 0;
  let vagrade = 0;

  for (let omgang = 1; omgang <= OMGANGAR; omgang += 1) {
    // En ledig port per omgång: en trasig låsning ska falla på låset och aldrig
    // på EADDRINUSE.
    const portTva = await probeFreePort();
    const tvaan = spawnServer(t, filePath, portTva);
    const utfall = await waitForClose(tvaan);

    assert.equal(
      utfall.kind,
      'close',
      `omgång ${omgang}: instans två avslutades aldrig (${utfall.kind}): ${beskriv(tvaan)}`
    );
    if (tvaan.stdout.split(/\r?\n/).includes(startLine(portTva))) {
      startade += 1;
    }
    if (utfall.code === 1 && tvaan.stdout === '' && tvaan.stderr === vantatStderr) {
      vagrade += 1;
    }
    assert.equal(utfall.code, 1, `omgång ${omgang}: ${beskriv(tvaan)}`);
    assert.equal(tvaan.stdout, '', `omgång ${omgang}: instans två skrev till stdout`);
    assert.equal(tvaan.stderr, vantatStderr, `omgång ${omgang}`);

    // Instans ett lever vidare och svarar som vanligt.
    const svar = await request(portEtt, 'GET', '/api/entries');
    assert.equal(svar.status, 200, `omgång ${omgang}: instans ett svarade ${svar.status}`);
  }

  // Ett POST mot instans ett, och datafilen ska därefter innehålla exakt en
  // post. Före låset gav samma indata 20 tappade poster på 20 omgångar.
  const post = await request(portEtt, 'POST', '/api/entries', JSON.stringify(GILTIGT_UTKAST));
  assert.equal(post.status, 201, post.body);
  const poster = await loadEntries();

  console.log(`omgångar där instans två startade: ${startade} av ${OMGANGAR}`);
  console.log(`omgångar där instans två gav exitkod 1 och rad L1 på stderr: ${vagrade} av ${OMGANGAR}`);
  console.log(`poster på disk efteråt: ${poster.length}`);

  // Båda utfallen räknas i en assertion och inte bara i en console.log
  // (LARDOMAR.md 2026-09-04).
  assert.equal(startade, 0, 'en andra instans startade mot samma datafil');
  assert.equal(vagrade, OMGANGAR, 'någon omgång gav inte exitkod 1 med rad L1 på stderr');
  assert.equal(poster.length, 1);
});

// ---------------------------------------------------------------- fall 2

test('fall 2: två instanser med var sin datafil låser inte varandra', async (t) => {
  // Fallet visar att låset hör till datafilen och inte till processen eller
  // porten: byts getLockFilePath mot en sökväg som inte härleds ur datafilen
  // blockerar den ena instansen den andra, och det här fallet faller.
  const filA = await tempDataFile(t);
  const filB = await tempDataFile(t);
  assert.notEqual(filA, filB);

  const portA = await probeFreePort();
  const portB = await probeFreePort();
  assert.notEqual(portA, portB);

  const a = spawnServer(t, filA, portA);
  const b = spawnServer(t, filB, portB);

  await assertStarted(a);
  await assertStarted(b);

  for (const state of [a, b]) {
    const svar = await request(state.port, 'GET', '/api/entries');
    assert.equal(svar.status, 200, `port ${state.port}: ${beskriv(state)}`);
    assert.equal(state.stderr, '', `port ${state.port} skrev till stderr`);
  }
});

// ---------------------------------------------------------------- fall 3

test('fall 3: ett dött lås tas över av nästa start', async (t) => {
  const filePath = await tempDataFile(t);
  const lockPath = lockPathFor(filePath);

  const forsta = spawnServer(t, filePath, await probeFreePort());
  await assertStarted(forsta);
  assert.equal(await finns(lockPath), true, 'låsfilen skapades aldrig av den första instansen');

  forsta.child.kill('SIGKILL');
  const utfall = await waitForClose(forsta);
  assert.equal(utfall.kind, 'close', `den första instansen avslutades aldrig: ${beskriv(forsta)}`);

  // Utan den här assertionen prövar fallet ingenting: ligger låsfilen inte kvar
  // efter SIGKILL saknar hela ESRCH-grenen indata.
  assert.equal(
    await finns(lockPath),
    true,
    `låsfilen ${lockPath} låg inte kvar efter SIGKILL — ESRCH-grenen saknar då indata`
  );

  const andra = spawnServer(t, filePath, await probeFreePort());
  await assertStarted(andra);
  const svar = await request(andra.port, 'GET', '/api/entries');
  assert.equal(svar.status, 200);
});

async function finns(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------- fall 4

test('fall 4: ett otolkbart lås blockerar starten med rad L2', async (t) => {
  // Utöver de tre innehåll ARKITEKTUR.md räknar upp står här fyra till, ett per
  // delvillkor i tolkningen av märkningen. Utan dem överlever villkoren mutation:
  //   `${pid}\n`  — det GAMLA formatet, bara en pid: den ska ge rad L2 och aldrig
  //                 tolkas som ett giltigt lås.
  //   ' 4711:… '  — mönstret är förankrat med ^ och $, så en märkning med
  //                 blanktecken omkring är ingen märkning.
  //   '0:…'       — process.kill(0, 0) frågar om den EGNA processgruppen och
  //                 svarar alltid "lever", så utan pid <= 0 blir svaret rad L1.
  //   '99…9:…'    — 22 siffror är inget säkert heltal; utan den kontrollen kastar
  //                 process.kill något annat än ESRCH och svaret blir rad L1.
  const uuid = '2f6f4a1e-0d2e-4c1a-9a2b-8f3c5d7e1b04';
  for (const innehall of [
    '',
    'inte en pid',
    `${process.pid}\n`,
    ` 4711:${uuid} `,
    `0:${uuid}\n`,
    `9999999999999999999999:${uuid}\n`
  ]) {
    const filePath = await tempDataFile(t);
    const lockPath = lockPathFor(filePath);
    await fs.writeFile(lockPath, innehall, 'utf8');

    const barn = spawnServer(t, filePath, await probeFreePort());
    const utfall = await waitForClose(barn);
    const namn = JSON.stringify(innehall);

    assert.equal(utfall.kind, 'close', `${namn}: barnet avslutades aldrig: ${beskriv(barn)}`);
    assert.equal(utfall.code, 1, `${namn}: ${beskriv(barn)}`);
    assert.equal(barn.stdout, '', namn);
    assert.equal(barn.stderr, `${radL2(lockPath)}\n`, namn);
    // Låsfilen ligger kvar: låset släpper bara på beviset ESRCH, aldrig på en
    // gissning, och ett otolkbart innehåll är ingen sådan bevisning.
    assert.equal(await finns(lockPath), true, `${namn}: låsfilen togs bort`);
  }
});

// ------------------------------------------------- låsmodulens egna kodvägar
//
// Fallen ovan går genom en barnprocess och når därför bara de kodvägar en
// riktig start passerar. Fallen nedan anropar lock.js direkt: utan dem
// överlever varje delvillkor de prövar en mutation.

test('ett andra anrop i samma process avvisas med rad L5 och rör inte låsfilen', async (t) => {
  // En datafil används av högst EN instans, och två anrop i samma process är två
  // instanser lika mycket som två processer är det. Utan rad L5 delar det andra
  // anropet låset, och dess släpp tar då bort en låsfil den första innehavaren
  // fortfarande använder (LARDOMAR.md 2026-09-07).
  const filePath = await useTempDataFile(t);
  const lockPath = getLockFilePath();

  const forsta = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(forsta));
  assert.equal(forsta, lockPath);
  const innehall = await fs.readFile(lockPath, 'utf8');
  assertMarkning(innehall, process.pid, 'första låset');

  // Exit-hanteraren registreras en gång per process och inte en gång per anrop:
  // utan flaggan exitHandlerRegistered växer listan för varje lås som tas, och
  // Node varnar för en läcka efter elva lyssnare.
  const lyssnareFore = process.listenerCount('exit');

  await assert.rejects(acquireDataFileLock(), (error) => {
    assert.ok(error instanceof DataFileLockError, `förväntade DataFileLockError, fick ${error}`);
    // Rad L5 namnger DATAFILEN och inte låsfilen, och bär ingen pid.
    assert.equal(error.message, radL5(filePath));
    assert.equal(error.message.includes(String(process.pid)), false, error.message);
    return true;
  });

  assert.equal(
    process.listenerCount('exit'),
    lyssnareFore,
    'det avvisade anropet registrerade en exit-hanterare'
  );
  assert.equal(await fs.readFile(lockPath, 'utf8'), innehall, 'låsfilen rördes av det avvisade anropet');
});

test('sekventiella anrop är tillåtna: efter ett släpp går låset att ta igen', async (t) => {
  // Rad L5 gäller SAMTIDIGA anrop. När den första innehavaren släppt finns ingen
  // post kvar i bokföringen, och nästa anrop tar ett nytt lås med en ny märkning
  // — det är den vägen tests/server.test.js går när ett start() följer på ett
  // misslyckat.
  await useTempDataFile(t);
  const lockPath = getLockFilePath();

  const forsta = await acquireDataFileLock();
  const forstaInnehall = await fs.readFile(lockPath, 'utf8');
  await releaseDataFileLock(forsta);
  assert.equal(await finns(lockPath), false, 'releaseDataFileLock tog inte bort vårt eget lås');
  // Idempotent: ett andra släppande av samma sökväg kastar inte och gör ingenting.
  await releaseDataFileLock(forsta);

  // Exit-hanteraren registreras en gång per process och inte en gång per lås:
  // utan flaggan exitHandlerRegistered växer listan för varje lås som tas, och
  // Node varnar för en läcka efter elva lyssnare. Räkningen görs runt det ANDRA
  // låset, eftersom det första kan ha registrerat hanteraren i ett tidigare fall
  // i samma process.
  const lyssnareFore = process.listenerCount('exit');
  const andra = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(andra));
  assert.equal(andra, lockPath);
  const andraInnehall = await fs.readFile(lockPath, 'utf8');
  assertMarkning(andraInnehall, process.pid, 'andra låset');
  assert.equal(
    process.listenerCount('exit'),
    lyssnareFore,
    'det andra låset registrerade en andra exit-hanterare'
  );
  // Ny märkning, inte den gamla: uuid:t är det som skiljer "vårt gamla lås" från
  // "vårt nya" när ett osynkat släpp och en ny start överlappar.
  assert.notEqual(andraInnehall, forstaInnehall, 'det andra låset återanvände den första märkningen');
});

test('fall 9: ett släpp tar inte bort en främmande märkning med den egna pid:en', async (t) => {
  // Indata som når märkningsjämförelsen. Utan fallet är jämförelsen bara en
  // pid-jämförelse, och ingen körning skiljer den från den rätta: en märkning
  // från ett tidigare, redan släppt lås i samma process bär samma pid.
  await useTempDataFile(t);
  const lockPath = getLockFilePath();
  const p = await acquireDataFileLock();

  const frammande = `${process.pid}:2f6f4a1e-0d2e-4c1a-9a2b-8f3c5d7e1b04\n`;
  assert.notEqual(await fs.readFile(lockPath, 'utf8'), frammande);
  await fs.writeFile(lockPath, frammande, 'utf8');

  await releaseDataFileLock(p);
  assert.equal(await finns(lockPath), true, 'släppandet tog en låsfil med en främmande märkning');
  assert.equal(await fs.readFile(lockPath, 'utf8'), frammande);
  await fs.rm(lockPath, { force: true });
});

test('fall 12: releaseDataFileLock med null, undefined och en okänd sökväg rör inte disken', async (t) => {
  // "Ingenting att släppa" är tre indata och en och samma väg: ingen anropare
  // kan säga "släpp det som råkar vara taget".
  //
  // Att låsfilen är oförändrad räcker inte som prov och är förbjudet som enda
  // assertion: utan spärren `token === undefined` läser modulen ändå filen och
  // jämför innehållet med undefined, vilket också lämnar filen i fred. Kravet är
  // NOLL filoperationer, och det mäts genom att räkna anropen till fs.readFile.
  // Räknaren sätts upp och tas bort runt varje anrop, och originalet läggs
  // tillbaka i en after-hook: ett fall som avbryts får inte lämna en patchad
  // kärnmodul efter sig. Jämförelsen av filen står kvar UTÖVER räkningen, aldrig
  // i stället för den.
  //
  // Räkningen förutsätter att lock.js når sina filoperationer genom
  // modulnamnrymden (`import fs from 'node:fs/promises'`): med `import
  // { readFile }` ser den här patchningen ingenting, och då ska mätsättet bytas
  // — kravet på noll filoperationer står kvar. Att räknaren verkligen ser
  // modulens läsningar är inte antaget utan mätt: mutation (f), "ta bort spärren
  // `token === undefined`", fäller just räknarens assertion.
  await useTempDataFile(t);
  const lockPath = getLockFilePath();
  const p = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(p));
  const innehall = await fs.readFile(lockPath, 'utf8');

  const original = fs.readFile;
  t.after(() => {
    fs.readFile = original;
  });

  for (const argument of [null, undefined, `${lockPath}.finns-inte`]) {
    let lasningar = 0;
    fs.readFile = (...args) => {
      lasningar += 1;
      return original(...args);
    };
    try {
      await releaseDataFileLock(argument);
    } finally {
      fs.readFile = original;
    }
    assert.equal(
      lasningar,
      0,
      `releaseDataFileLock(${String(argument)}) läste ${lasningar} gånger från disken`
    );
    assert.equal(
      await fs.readFile(lockPath, 'utf8'),
      innehall,
      `releaseDataFileLock(${String(argument)}) rörde låsfilen`
    );
  }
});

test('en fil där låsfilens katalog ska ligga ger rad L4', async (t) => {
  // mkdir-spärren. Utan sitt try/catch lämnar acquireDataFileLock ett rått
  // OS-fel med engelsk text i stället för ett DataFileLockError.
  const filePath = await useTempDataFile(t);
  const iVagen = path.join(path.dirname(filePath), 'inte-en-katalog');
  await fs.writeFile(iVagen, 'x', 'utf8');
  process.env.HEMOCHEKONOMI_DATA_FILE = path.join(iVagen, 'entries.json');
  const lockPath = getLockFilePath();

  await assert.rejects(acquireDataFileLock(), (error) => {
    assert.ok(error instanceof DataFileLockError, `förväntade DataFileLockError, fick ${error}`);
    assert.equal(error.message, radL4(lockPath));
    assert.ok(error.cause, 'cause var inte satt');
    return true;
  });
});

test('en katalog på låsfilens plats ger rad L3', async (t) => {
  // Läsvägens spärr. Uppmätt på den här maskinen: writeFile med flaggan wx mot
  // en befintlig katalog ger EEXIST, alltså samma kod som en upptagen låsfil, och
  // därefter ger readFile av katalogen EISDIR. Det är indata som når grenen
  // "läsningen kastar" — utan den grenen blir EISDIR i stället rad L2 eller ett
  // rått OS-fel.
  await useTempDataFile(t);
  const lockPath = getLockFilePath();
  await fs.mkdir(lockPath);

  await assert.rejects(acquireDataFileLock(), (error) => {
    assert.ok(error instanceof DataFileLockError, `förväntade DataFileLockError, fick ${error}`);
    assert.equal(error.message, radL3(lockPath));
    assert.ok(error.cause, 'cause var inte satt');
    return true;
  });
});

test('en låsfil som inte går att skapa ger rad L4', async (t) => {
  // writeFile-spärren. Uppmätt på den här maskinen: ett filnamn på 300 tecken
  // gör hela sökvägen längre än Windows MAX_PATH, katalogen går fortfarande att
  // skapa, och writeFile avvisar med ENOENT. Utan try/catch runt writeFile når
  // det råa OS-felet anroparen med engelsk text.
  const filePath = await useTempDataFile(t);
  process.env.HEMOCHEKONOMI_DATA_FILE = path.join(path.dirname(filePath), `${'e'.repeat(300)}.json`);
  const lockPath = getLockFilePath();

  await assert.rejects(acquireDataFileLock(), (error) => {
    assert.ok(error instanceof DataFileLockError, `förväntade DataFileLockError, fick ${error}`);
    assert.equal(error.message, radL4(lockPath));
    assert.ok(error.cause, 'cause var inte satt');
    return true;
  });
});

test('låset släpps när servern stängs, och nästa instans kan då starta', async (t) => {
  // server.once('close', …) i start. Utan den ligger låsfilen kvar med en
  // LEVANDE pid — testprocessens egen — och nästa instans mot samma datafil
  // avvisas med rad L1 fastän ingen server kör.
  const filePath = await useTempDataFile(t);
  const lockPath = getLockFilePath();

  const server = await start(0);
  t.after(() => new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  }));
  assert.equal(await finns(lockPath), true, 'start tog aldrig låset');

  await new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

  // Släppandet är ett löfte ingen anropare kan invänta, så väntan pekar på filen
  // och bryts av hängningsspärren.
  const deadline = Date.now() + LOCK_RELEASE_TIMEOUT_MS;
  while (await finns(lockPath) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.equal(await finns(lockPath), false, `låsfilen ${lockPath} låg kvar efter att servern stängts`);

  const barn = spawnServer(t, filePath, await probeFreePort());
  await assertStarted(barn);
});

// Exit-städningen är den enda synkrona filoperationen i src/ och kan bara nås
// när en process faktiskt avslutas. Barnet startas med node --input-type=module
// -e, alltså utan någon hjälpfil: koden nedan tar låset, säger till, och
// avslutas med process.exit(0) när testet skickar ett tecken på stdin.
const BARNKOD = `
  const { acquireDataFileLock } = await import(${JSON.stringify(new URL('../src/server/lock.js', import.meta.url).href)});
  await acquireDataFileLock();
  process.stdout.write('taget' + String.fromCharCode(10));
  process.stdin.on('data', () => { process.exit(0); });
`;

function spawnLastagare(t, filePath) {
  const child = spawn(process.execPath, ['--input-type=module', '-e', BARNKOD], {
    env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { child, port: null, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  t.after(() => {
    child.kill('SIGKILL');
  });
  return state;
}

function vantaPaRad(state, rad) {
  const har = () => state.stdout.split(/\r?\n/).includes(rad);
  return new Promise((resolve) => {
    if (har()) {
      resolve({ kind: 'rad' });
      return;
    }
    state.child.stdout.on('data', () => {
      if (har()) {
        resolve({ kind: 'rad' });
      }
    });
    state.child.once('exit', () => resolve({ kind: 'exit' }));
    state.child.once('error', (error) => resolve({ kind: 'error', error }));
    AbortSignal.timeout(CHILD_START_TIMEOUT_MS).addEventListener(
      'abort',
      () => resolve({ kind: 'timeout' }),
      { once: true }
    );
  });
}

test('exit-städningen tar bort vårt eget lås men aldrig någon annans', async (t) => {
  // Två körningar av samma barn. Skillnaden är vad låsfilen bär när barnet
  // avslutas, och det är den skillnaden pid-kontrollen i exit-städningen finns
  // för: utan den tar en process som avslutas med sig den låsfil någon annan
  // hunnit skriva sin pid i.
  // Tredje sorten är skälet till att exit-städningen sväljer sina egna fel:
  // tar någon bort låsfilen för hand medan appen kör, kastar readFileSync ett
  // ENOENT inne i en exit-hanterare. Ett kast där blir ett ohanterat undantag
  // och byter ett rent avslut mot engelskt stackspår och en annan exitkod.
  for (const sort of ['eget lås', 'någon annans lås', 'låsfilen är borta']) {
    const filePath = await tempDataFile(t);
    const lockPath = lockPathFor(filePath);
    const barn = spawnLastagare(t, filePath);

    const utfall = await vantaPaRad(barn, 'taget');
    assert.equal(utfall.kind, 'rad', `${sort}: barnet tog aldrig låset: ${beskriv(barn)}`);
    assert.equal(await finns(lockPath), true, `${sort}: låsfilen skapades aldrig`);
    assertMarkning(await fs.readFile(lockPath, 'utf8'), barn.child.pid, sort);

    const annanMarkning = `${barn.child.pid + 1}:2f6f4a1e-0d2e-4c1a-9a2b-8f3c5d7e1b04\n`;
    if (sort === 'någon annans lås') {
      // Någon annan har tagit över låset medan barnet levde.
      await fs.writeFile(lockPath, annanMarkning, 'utf8');
    }
    if (sort === 'låsfilen är borta') {
      await fs.rm(lockPath);
    }

    barn.child.stdin.write('x');
    const slut = await waitForClose(barn);
    assert.equal(slut.kind, 'close', `${sort}: barnet avslutades aldrig: ${beskriv(barn)}`);
    assert.equal(slut.code, 0, `${sort}: ${beskriv(barn)}`);

    assert.equal(barn.stderr, '', `${sort}: exit-städningen skrev till stderr`);

    if (sort === 'eget lås') {
      assert.equal(await finns(lockPath), false, 'exit-städningen tog inte bort vårt eget lås');
    } else if (sort === 'någon annans lås') {
      assert.equal(await finns(lockPath), true, 'exit-städningen tog någon annans lås');
      assert.equal(await fs.readFile(lockPath, 'utf8'), annanMarkning);
    } else {
      assert.equal(await finns(lockPath), false, 'låsfilen kom tillbaka');
    }
  }
});

// ---------------------------------------------------------------- fall 5-8, 10
//
// Fallen nedan prövar ägarskapets bokföring. Porten hålls i fall 5 upptagen av
// en server som SJÄLV har tagit låset — aldrig av en naken http.createServer(),
// alltså den variant där felet inte kan uppstå (LARDOMAR.md 2026-09-07).

function closeServer(server) {
  return new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });
}

test('fall 5: ett andra start() mot första serverns port lämnar låset orört', async (t) => {
  const filePath = await useTempDataFile(t);
  const lockPath = getLockFilePath();

  const s1 = await start(0);
  t.after(() => closeServer(s1));
  const { port } = s1.address();
  const f1 = await fs.readFile(lockPath, 'utf8');
  assertMarkning(f1, process.pid, 'första start');

  // Samma port OCH samma datafil: det är den kombinationen som gav granskaren
  // "låsfil efter att start 2 misslyckades: ENOENT". Att meddelandet är rad L5
  // och inte rad 1:s porttext är beviset att låset svarar före porten.
  await assert.rejects(start(port), (error) => {
    assert.ok(error instanceof ServerStartError, `förväntade ServerStartError, fick ${error}`);
    assert.equal(error.message, radL5(filePath));
    assert.ok(
      error.cause instanceof DataFileLockError,
      `cause var inte ett DataFileLockError: ${error.cause}`
    );
    assert.equal(error.message.includes('Port '), false, error.message);
    assert.equal(error.message.includes('address already in use'), false, error.message);
    return true;
  });

  assert.equal(await finns(lockPath), true, 'låsfilen togs bort av det misslyckade andra start()');
  assert.equal(await fs.readFile(lockPath, 'utf8'), f1, 'låsfilens innehåll ändrades');

  const svar = await request(port, 'GET', '/api/entries');
  assert.equal(svar.status, 200, `den första servern svarade ${svar.status}`);

  // Utan den här halvan prövar fallet bara en sträng och inte det låset finns
  // för: en annan process mot samma datafil ska fortfarande avvisas med rad L1.
  const barn = spawnServer(t, filePath, await probeFreePort());
  const utfall = await waitForClose(barn);
  assert.equal(utfall.kind, 'close', `barnet avslutades aldrig: ${beskriv(barn)}`);
  assert.equal(utfall.code, 1, beskriv(barn));
  assert.equal(barn.stdout, '', 'barnet startade mot en datafil som redan är låst');
  assert.equal(barn.stderr, `${radL1(process.pid, filePath)}\n`);
});

test('fall 6: två datafiler, två lås, två släpp', async (t) => {
  // Med ägarskapet i EN variabel skriver det andra låset över det första, och
  // ett släpp lämnar då "a.json.lock: finns, b.json.lock: BORTA".
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filA = path.join(dir, 'a.json');
  const filB = path.join(dir, 'b.json');
  const lasA = lockPathFor(filA);
  const lasB = lockPathFor(filB);

  const tidigare = process.env.HEMOCHEKONOMI_DATA_FILE;
  t.after(() => {
    if (tidigare === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = tidigare;
    }
  });

  process.env.HEMOCHEKONOMI_DATA_FILE = filA;
  const p1 = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(p1));
  process.env.HEMOCHEKONOMI_DATA_FILE = filB;
  const p2 = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(p2));

  assert.notEqual(p1, p2);
  assert.equal(p1, lasA);
  assert.equal(p2, lasB);
  assert.equal(await finns(lasA), true, 'låsfilen för a.json saknas');
  assert.equal(await finns(lasB), true, 'låsfilen för b.json saknas');

  await releaseDataFileLock(p1);
  assert.equal(await finns(lasA), false, 'släppet av a.json tog inte bort a.json.lock');
  assert.equal(await finns(lasB), true, 'släppet av a.json tog bort b.json.lock');

  await releaseDataFileLock(p2);
  assert.equal(await finns(lasB), false, 'släppet av b.json tog inte bort b.json.lock');

  const kvar = (await fs.readdir(dir)).filter((namn) => namn.endsWith('.lock'));
  assert.deepEqual(kvar, [], `låsfiler kvar i katalogen: ${kvar.join(', ')}`);
});

test('fall 8: ett kvarlämnat lås med den egna pid:en tas över', async (t) => {
  // Indata som når grenen pid === process.pid: en pid som operativsystemet
  // återanvänt, eller ett släpp som inte fick bort filen. Ingen post finns i
  // bokföringen, för annars hade rad L5 vunnit innan disken rördes.
  await useTempDataFile(t);
  const lockPath = getLockFilePath();
  const paskrivet = `${process.pid}:2f6f4a1e-0d2e-4c1a-9a2b-8f3c5d7e1b04\n`;
  await fs.writeFile(lockPath, paskrivet, 'utf8');

  const p = await acquireDataFileLock();
  t.after(() => releaseDataFileLock(p));
  assert.equal(p, lockPath);

  const nu = await fs.readFile(lockPath, 'utf8');
  assert.notEqual(nu, paskrivet, 'låset togs över utan att skrivas om');
  assertMarkning(nu, process.pid, 'övertaget lås');
});

test('fall 10: två överlappande acquireDataFileLock mot samma datafil', async (t) => {
  // Båda startade innan någon av dem hunnit uppfylla sig. Utan köplatsen ser de
  // båda ett heldLocks utan posten, tar sig båda förbi rad L5 och skriver över
  // varandras låsfil.
  const filePath = await useTempDataFile(t);
  const lockPath = getLockFilePath();

  const utfall = await Promise.allSettled([acquireDataFileLock(), acquireDataFileLock()]);
  const uppfyllda = utfall.filter((resultat) => resultat.status === 'fulfilled');
  const avvisade = utfall.filter((resultat) => resultat.status === 'rejected');

  assert.equal(
    uppfyllda.length,
    1,
    `${uppfyllda.length} av 2 anrop tog låset: ${utfall.map((resultat) => resultat.status).join(', ')}`
  );
  assert.equal(avvisade.length, 1);
  assert.equal(uppfyllda[0].value, lockPath);
  assert.ok(
    avvisade[0].reason instanceof DataFileLockError,
    `förväntade DataFileLockError, fick ${avvisade[0].reason}`
  );
  assert.equal(avvisade[0].reason.message, radL5(filePath));

  assert.equal(await finns(lockPath), true, 'låsfilen saknas efter att ett av anropen tog låset');
  assertMarkning(await fs.readFile(lockPath, 'utf8'), process.pid, 'låsfilen');

  // Att filen bär just den uppfylldas märkning visas av att dess släpp tar bort
  // den: släppandet tar aldrig bort en fil vars innehåll inte är exakt den
  // märkning posten bär.
  await releaseDataFileLock(uppfyllda[0].value);
  assert.equal(await finns(lockPath), false, 'låsfilen bar inte den uppfylldas märkning');
});

// Fall 7: exit-städningen tar VARJE lås processen håller. Barnet tar två lås mot
// två datafiler och avslutas med process.exit(0).
const BARNKOD_TVA = `
  const { acquireDataFileLock } = await import(${JSON.stringify(new URL('../src/server/lock.js', import.meta.url).href)});
  process.env.HEMOCHEKONOMI_DATA_FILE = process.env.HEMOCHEKONOMI_FIL_A;
  await acquireDataFileLock();
  process.env.HEMOCHEKONOMI_DATA_FILE = process.env.HEMOCHEKONOMI_FIL_B;
  await acquireDataFileLock();
  process.stdout.write('taget' + String.fromCharCode(10));
  process.stdin.on('data', () => { process.exit(0); });
`;

test('fall 7: exit-städningen tar varje lås processen håller', async (t) => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-lock-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  const filA = path.join(dir, 'a.json');
  const filB = path.join(dir, 'b.json');
  const lasA = lockPathFor(filA);
  const lasB = lockPathFor(filB);

  const child = spawn(process.execPath, ['--input-type=module', '-e', BARNKOD_TVA], {
    env: { ...process.env, HEMOCHEKONOMI_FIL_A: filA, HEMOCHEKONOMI_FIL_B: filB },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const state = { child, port: null, stdout: '', stderr: '' };
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk) => {
    state.stdout += chunk;
  });
  child.stderr.on('data', (chunk) => {
    state.stderr += chunk;
  });
  t.after(() => {
    child.kill('SIGKILL');
  });

  const utfall = await vantaPaRad(state, 'taget');
  assert.equal(utfall.kind, 'rad', `barnet tog aldrig de två låsen: ${beskriv(state)}`);
  assert.equal(await finns(lasA), true, 'låsfilen för a.json skapades aldrig');
  assert.equal(await finns(lasB), true, 'låsfilen för b.json skapades aldrig');
  assertMarkning(await fs.readFile(lasA, 'utf8'), child.pid, 'a.json.lock');
  assertMarkning(await fs.readFile(lasB, 'utf8'), child.pid, 'b.json.lock');

  child.stdin.write('x');
  const slut = await waitForClose(state);
  assert.equal(slut.kind, 'close', `barnet avslutades aldrig: ${beskriv(state)}`);
  assert.equal(slut.code, 0, beskriv(state));
  assert.equal(state.stderr, '', 'exit-städningen skrev till stderr');

  assert.equal(await finns(lasA), false, 'exit-städningen lämnade kvar a.json.lock');
  assert.equal(await finns(lasB), false, 'exit-städningen lämnade kvar b.json.lock');
});
