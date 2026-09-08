import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

import { isEntry } from '../src/core/entry.js';
import { getCoreDir, getDataFilePath, getWebDir } from '../src/server/paths.js';
import { STORAGE_VERSION, StorageError, loadEntries, saveEntries, updateEntries } from '../src/server/storage.js';
import { childEntries } from './helpers/interrupted-save.js';

// Två giltiga poster med fasta datum. Inget i den här filen får bero på dagens
// datum — determinismkravet i teststrategin.
function sampleEntries() {
  return [
    {
      id: '6f1c0f3a-6b8f-4a9f-9a1a-0e2b5c7d1234',
      name: 'Spotify Family',
      amountSek: 199,
      interval: 'monthly',
      startDate: '2026-01-31',
      category: 'subscription'
    },
    {
      id: 'b2c3d4e5-6f70-4812-9a3b-4c5d6e7f8091',
      name: 'Hemförsäkring',
      amountSek: 1249.5,
      interval: 'yearly',
      startDate: '2026-03-01',
      category: 'insurance'
    }
  ];
}

// Kör run() med HEMOCHEKONOMI_DATA_FILE satt till en fil under os.tmpdir() och
// städar upp katalogen efteråt. Assertionen på sökvägen är spärren mot att ett
// testfall skriver i användarens riktiga %APPDATA%-katalog.
async function withDataFile(run) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'hemochekonomi-test-'));
  const filePath = path.join(dir, 'entries.json');
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  try {
    assert.equal(getDataFilePath(), filePath);
    assert.equal(getDataFilePath().startsWith(os.tmpdir()), true);
    await run(filePath, dir);
  } finally {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
}

async function rejectsWithMessage(run, message) {
  await assert.rejects(run, (error) => {
    assert.ok(error instanceof StorageError, `förväntade StorageError, fick ${error}`);
    assert.equal(error.name, 'StorageError');
    assert.equal(error.message, message);
    return true;
  });
}

// Många giltiga poster med samma form men olika id och name, så att två listor
// går att skilja åt post för post om innehållet skulle blandas.
function manyEntries(count, prefix) {
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      id: `${prefix}-${index}`,
      name: `${prefix} post ${index}`,
      amountSek: 99.5,
      interval: 'monthly',
      startDate: '2026-01-15',
      category: 'subscription'
    });
  }
  return entries;
}

// Billig jämförelse av två poster: fälten är platta och alla värden är
// primitiver, så nycklarnas antal plus Object.is per nyckel avgör frågan utan
// att något meddelande byggs. Object.is skiljer dessutom -0 från 0, precis som
// assert.deepStrictEqual gör.
function entriesDiffer(actual, expected) {
  if (actual === expected) {
    return false;
  }
  if (actual === null || expected === null
    || typeof actual !== 'object' || typeof expected !== 'object') {
    return true;
  }
  const actualKeys = Object.keys(actual);
  if (actualKeys.length !== Object.keys(expected).length) {
    return true;
  }
  for (const key of actualKeys) {
    if (!Object.is(actual[key], expected[key])) {
      return true;
    }
  }
  return false;
}

// Jämför två postlistor så att ett verkligt fel rapporteras i stället för att
// spränga minnet. En assert.deepEqual mot en lång lista är billig bara när den
// lyckas: kastvägen bygger först en fullständig util.inspect-diff, och
// granskarens mätning på den här maskinen gav 60 344 ms och +8922 MB rss för
// 20 000 mot 20 000 poster där hälften skiljer, 63 340 ms och +9353 MB när alla
// skiljer, och 48 595 ms och +8734 MB för 3 mot 20 000 poster — samma
// jämförelse med bara en post som skiljer kostar 200 ms och +119 MB. Kostnaden
// följer alltså diffens storlek, inte listans.
//
// Två billigare assertioner fäller därför först: antalet poster, och därefter
// det första avvikande indexet med index och den enskilda posten i meddelandet.
// Först när båda har passerat körs assert.deepEqual mot hela listan som
// slutkontroll — och då är den känt lyckad och därmed billig. Följer av
// LARDOMAR.md (2026-09-07, den dyra diffen togs bort ur grenvalet men står kvar
// i grenkropparna).
function assertSameEntries(actual, expected, label) {
  assert.ok(Array.isArray(actual), `${label}: förväntade en array, fick ${typeof actual}`);
  assert.equal(actual.length, expected.length, `${label}: fel antal poster`);

  let firstDiff = -1;
  for (let index = 0; index < expected.length; index += 1) {
    if (entriesDiffer(actual[index], expected[index])) {
      firstDiff = index;
      break;
    }
  }

  if (firstDiff !== -1) {
    // Bara den enskilda posten jämförs här: diffen blir läsbar och liten.
    assert.deepEqual(
      actual[firstDiff],
      expected[firstDiff],
      `${label}: första avvikande post har index ${firstDiff}`
    );
    // Nås bara om deepEqual godkänner ett par som entriesDiffer förkastade.
    // Meddelandet är kort med flit — hela listan får aldrig inspekteras här.
    assert.fail(`${label}: post ${firstDiff} skiljer sig utan att deepEqual såg det`);
  }

  assert.deepEqual(actual, expected, label);
}

// Temporärfilens namn är modullokalt och innehåller ett UUID som testet inte
// kan förutsäga. Katalogen läses därför i stället för namnet — det är den enda
// vägen som inte blir en andra kopia av regeln.
async function tempFilesIn(dir) {
  return (await fs.readdir(dir)).filter((name) => name.endsWith('.tmp'));
}

async function exists(filePath) {
  try {
    await fs.stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

// Barnprocessens sökväg byggs ur import.meta.url, aldrig ur process.cwd():
// en cwd-relativ sökväg hittar bara filen så länge kommandot körs från
// projektroten, och barnet dör annars innan sitt första meddelande.
const CHILD_PATH = fileURLToPath(new URL('./helpers/interrupted-save.js', import.meta.url));

// Hängningsspärr, inte en dödandetid: barnet ska vara igång på bråkdelen av en
// sekund, och tiden nedan finns bara för att ett barn som aldrig startar ska ge
// ett fallerat test i stället för en väntan utan exitkod.
const CHILD_START_TIMEOUT_MS = 30000;

function forkChild(filePath, entryCount) {
  const child = fork(CHILD_PATH, [], {
    env: {
      ...process.env,
      HEMOCHEKONOMI_DATA_FILE: filePath,
      HEMOCHEKONOMI_TEST_ENTRY_COUNT: String(entryCount)
    },
    stdio: ['ignore', 'ignore', 'pipe', 'ipc']
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => {
    stderr += chunk;
  });
  return { child, stderrText: () => stderr };
}

// Väntar på barnets 'startar', men aldrig för alltid: meddelandet kapplöper mot
// exit, error och en timeout. Vinner något annat faller testet med barnets
// exitCode, signalCode och stderr — en hängning ger ingen exitkod alls, och då
// går kravet i CLAUDE.md att kontrollera utgångskoden inte att uppfylla.
async function waitForChildStart(child, stderrText) {
  const outcome = await new Promise((resolve) => {
    child.once('message', () => resolve({ kind: 'meddelande' }));
    child.once('exit', () => resolve({ kind: 'exit' }));
    child.once('error', (error) => resolve({ kind: 'error', error }));
    AbortSignal.timeout(CHILD_START_TIMEOUT_MS).addEventListener(
      'abort',
      () => resolve({ kind: 'timeout' }),
      { once: true }
    );
  });

  if (outcome.kind !== 'meddelande') {
    child.kill('SIGKILL');
    const orsak = outcome.error ? `${outcome.kind}: ${outcome.error.message}` : outcome.kind;
    assert.fail(
      `barnprocessen ${CHILD_PATH} skickade aldrig "startar" (${orsak}): `
      + `exitCode=${child.exitCode}, signalCode=${child.signalCode}, stderr=${stderrText()}`
    );
  }
}

// Punkt 3 i teststrategin: dödandetiden härleds ur en mätning. Mätomgången
// dödar inte barnet utan tar tiden från att 'startar' togs emot till exit.
async function matTKlar(filePath, entryCount) {
  const { child, stderrText } = forkChild(filePath, entryCount);
  const exited = new Promise((resolve) => child.once('exit', resolve));
  await waitForChildStart(child, stderrText);
  const start = performance.now();
  await exited;
  return performance.now() - start;
}

// ---------------------------------------------------------------- paths.js

test('getDataFilePath läser HEMOCHEKONOMI_DATA_FILE vid varje anrop', () => {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  try {
    process.env.HEMOCHEKONOMI_DATA_FILE = path.join(os.tmpdir(), 'ett.json');
    assert.equal(getDataFilePath(), path.join(os.tmpdir(), 'ett.json'));
    // Samma modulinstans, nytt svar: sökvägen får inte cachas vid laddning.
    process.env.HEMOCHEKONOMI_DATA_FILE = path.join(os.tmpdir(), 'tva.json');
    assert.equal(getDataFilePath(), path.join(os.tmpdir(), 'tva.json'));
  } finally {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  }
});

test('getDataFilePath ger %APPDATA%-sökvägen när variabeln inte är satt eller är tom', () => {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  const previousAppData = process.env.APPDATA;
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  const expected = path.join(appData, 'hemochekonomi', 'entries.json');
  try {
    delete process.env.HEMOCHEKONOMI_DATA_FILE;
    assert.equal(getDataFilePath(), expected);
    process.env.HEMOCHEKONOMI_DATA_FILE = '';
    assert.equal(getDataFilePath(), expected);
    // Bara blanktecken räknas som osatt: tre blanksteg, en tabb och en
    // radbrytning ger alla standardsökvägen.
    for (const blank of ['   ', ' ', '\t', '\n', ' \t\n ']) {
      process.env.HEMOCHEKONOMI_DATA_FILE = blank;
      assert.equal(getDataFilePath(), expected, JSON.stringify(blank));
    }

    // Utan APPDATA används hemkatalogens AppData\Roaming. Sökvägen räknas bara
    // ut — inget testfall skriver någonsin i den.
    delete process.env.APPDATA;
    assert.equal(
      getDataFilePath(),
      path.join(os.homedir(), 'AppData', 'Roaming', 'hemochekonomi', 'entries.json')
    );
  } finally {
    if (previousAppData === undefined) {
      delete process.env.APPDATA;
    } else {
      process.env.APPDATA = previousAppData;
    }
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  }
});

test('getDataFilePath returnerar en satt sökväg ordagrant, utan trim', () => {
  const previous = process.env.HEMOCHEKONOMI_DATA_FILE;
  try {
    // En riktig sökväg får innehålla blanksteg, också först. Villkoret trimmar
    // för att avgöra om variabeln är satt — värdet trimmas aldrig.
    for (const value of [
      ' ' + path.join(os.tmpdir(), 'med-inledande-blanksteg.json'),
      path.join(os.tmpdir(), 'med avslutande blanksteg.json') + ' ',
      '  ' + path.join(os.tmpdir(), 'tva blanksteg.json') + '  '
    ]) {
      process.env.HEMOCHEKONOMI_DATA_FILE = value;
      assert.equal(getDataFilePath(), value);
      assert.notEqual(getDataFilePath(), value.trim());
    }
  } finally {
    if (previous === undefined) {
      delete process.env.HEMOCHEKONOMI_DATA_FILE;
    } else {
      process.env.HEMOCHEKONOMI_DATA_FILE = previous;
    }
  }
});

test('getWebDir och getCoreDir pekar på src/web och src/core', () => {
  assert.equal(path.basename(getWebDir()), 'web');
  assert.equal(path.basename(path.dirname(getWebDir())), 'src');
  assert.equal(path.isAbsolute(getWebDir()), true);
  assert.equal(path.basename(getCoreDir()), 'core');
  assert.equal(path.basename(path.dirname(getCoreDir())), 'src');
  assert.equal(path.isAbsolute(getCoreDir()), true);
  assert.equal(path.dirname(getWebDir()), path.dirname(getCoreDir()));
});

// -------------------------------------------------------------- storage.js

test('STORAGE_VERSION är 1', () => {
  assert.equal(STORAGE_VERSION, 1);
});

test('StorageError är ett Error med namnet StorageError', () => {
  const error = new StorageError('Datafilen har fel innehåll: C:\\x\\entries.json');
  assert.ok(error instanceof Error);
  assert.ok(error instanceof StorageError);
  assert.equal(error.name, 'StorageError');
});

test('poster som sparats läses tillbaka identiskt i en ny körning', async () => {
  await withDataFile(async () => {
    const entries = sampleEntries();
    await saveEntries(entries);

    // "Ny körning": modulen importeras på nytt med cache-brytande query, så
    // ingenting kan komma från modulminnet i den här processen.
    const fresh = await import('../src/server/storage.js?fresh=' + Date.now());
    assert.notEqual(fresh.loadEntries, loadEntries);

    const readBack = await fresh.loadEntries();
    assert.deepEqual(readBack, entries);
    assert.equal(JSON.stringify(readBack), JSON.stringify(sampleEntries()));
    for (const entry of readBack) {
      assert.equal(isEntry(entry), true);
    }
  });
});

test('tom lista sparas och läses tillbaka som tom lista', async () => {
  await withDataFile(async (filePath) => {
    await saveEntries([]);
    assert.equal(await fs.readFile(filePath, 'utf8'), '{\n  "version": 1,\n  "entries": []\n}\n');

    const fresh = await import('../src/server/storage.js?fresh=' + Date.now());
    assert.deepEqual(await fresh.loadEntries(), []);
  });
});

test('filen skrivs UTF-8, indenterad med 2 mellanslag och avslutad med radbrytning', async () => {
  await withDataFile(async (filePath) => {
    const entries = [{
      id: 'a1',
      name: 'Räksmörgås 🍤',
      amountSek: 99.5,
      interval: 'quarterly',
      startDate: '2026-02-28',
      category: 'other'
    }];
    await saveEntries(entries);

    const text = await fs.readFile(filePath, 'utf8');
    assert.equal(text, JSON.stringify({ version: 1, entries }, null, 2) + '\n');
    assert.equal(text.endsWith('\n'), true);
    assert.equal(text.endsWith('\n\n'), false);
    const lines = text.split('\n');
    assert.equal(lines[1], '  "version": 1,');
    assert.equal(lines[3], '    {');
    assert.equal(text.includes('\t'), false);

    // UTF-8 på disk: bytena är exakt UTF-8-kodningen av texten, och åäö samt
    // ett tecken utanför BMP överlever vägen tillbaka.
    const bytes = await fs.readFile(filePath);
    assert.deepEqual(bytes, Buffer.from(text, 'utf8'));
    assert.equal(bytes.includes(Buffer.from('Räksmörgås 🍤', 'utf8')), true);
    assert.deepEqual(await loadEntries(), entries);
  });
});

test('saknad fil ger tom lista och skapar ingen fil', async () => {
  await withDataFile(async (filePath, dir) => {
    assert.equal(await exists(filePath), false);
    assert.deepEqual(await loadEntries(), []);
    assert.equal(await exists(filePath), false);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test('saknad katalog ger tom lista och skapar ingen katalog', async () => {
  await withDataFile(async (filePath, dir) => {
    const deep = path.join(dir, 'saknas', 'entries.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = deep;
    assert.deepEqual(await loadEntries(), []);
    assert.equal(await exists(path.join(dir, 'saknas')), false);
    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('tom fil ger tom lista', async () => {
  await withDataFile(async (filePath) => {
    await fs.writeFile(filePath, '', 'utf8');
    assert.deepEqual(await loadEntries(), []);
  });
});

test('fil med bara blanktecken ger tom lista', async () => {
  await withDataFile(async (filePath) => {
    for (const blank of [' ', '\n', '\r\n', '\t', '   \n\t\r\n  ']) {
      await fs.writeFile(filePath, blank, 'utf8');
      assert.deepEqual(await loadEntries(), []);
    }
  });
});

test('ogiltig JSON ger Datafilen är skadad och kunde inte läsas', async () => {
  await withDataFile(async (filePath) => {
    const broken = ['{', '{ "version": 1, "entries": [ ', 'inte json alls', '{ "version": 1, }'];
    for (const content of broken) {
      await fs.writeFile(filePath, content, 'utf8');
      await rejectsWithMessage(
        () => loadEntries(),
        `Datafilen är skadad och kunde inte läsas: ${filePath}`
      );
    }
  });
});

test('JSON som inte är ett objekt ger Datafilen har fel innehåll', async () => {
  await withDataFile(async (filePath) => {
    for (const content of ['null', '42', '"text"', 'true', '[]', '[1, 2]']) {
      await fs.writeFile(filePath, content, 'utf8');
      await rejectsWithMessage(
        () => loadEntries(),
        `Datafilen har fel innehåll: ${filePath}`
      );
    }
  });
});

test('entries som inte är en array ger Datafilen har fel innehåll', async () => {
  await withDataFile(async (filePath) => {
    for (const entries of ['{}', '"abc"', '42', 'null', 'true']) {
      await fs.writeFile(filePath, `{ "version": 1, "entries": ${entries} }`, 'utf8');
      await rejectsWithMessage(
        () => loadEntries(),
        `Datafilen har fel innehåll: ${filePath}`
      );
    }
    await fs.writeFile(filePath, '{ "version": 1 }', 'utf8');
    await rejectsWithMessage(
      () => loadEntries(),
      `Datafilen har fel innehåll: ${filePath}`
    );
  });
});

test('saknad eller okänd version ger Datafilen har en version som appen inte känner igen', async () => {
  await withDataFile(async (filePath) => {
    const entries = JSON.stringify(sampleEntries());
    for (const version of ['0', '2', '"1"', 'null', 'true', '1.5']) {
      await fs.writeFile(filePath, `{ "version": ${version}, "entries": ${entries} }`, 'utf8');
      await rejectsWithMessage(
        () => loadEntries(),
        `Datafilen har en version som appen inte känner igen: ${filePath}`
      );
    }
    await fs.writeFile(filePath, `{ "entries": ${entries} }`, 'utf8');
    await rejectsWithMessage(
      () => loadEntries(),
      `Datafilen har en version som appen inte känner igen: ${filePath}`
    );
  });
});

test('en ogiltig post ger Datafilen innehåller en ogiltig post', async () => {
  const valid = sampleEntries()[0];

  const missingField = { ...valid };
  delete missingField.startDate;

  const wrongType = { ...valid, amountSek: '199' };

  const unknownField = { ...valid, income: 5000 };

  const cases = [
    ['saknat fält', missingField],
    ['fel typ på ett fält', wrongType],
    ['okänt extra fält', unknownField]
  ];

  await withDataFile(async (filePath) => {
    for (const [label, entry] of cases) {
      // isEntry är enda domaren över om posten är giltig; storage.js har ingen
      // egen kontroll av id, belopp eller datum.
      assert.equal(isEntry(entry), false, label);
      await fs.writeFile(
        filePath,
        JSON.stringify({ version: 1, entries: [entry] }, null, 2) + '\n',
        'utf8'
      );
      await rejectsWithMessage(
        () => loadEntries(),
        `Datafilen innehåller en ogiltig post: ${filePath}`
      );
    }

    // Också när den ogiltiga posten står sist bland giltiga poster.
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 1, entries: [...sampleEntries(), unknownField] }, null, 2) + '\n',
      'utf8'
    );
    await rejectsWithMessage(
      () => loadEntries(),
      `Datafilen innehåller en ogiltig post: ${filePath}`
    );
  });
});

test('när två rader i lästabellen är sanna samtidigt vinner den lägre siffran', async () => {
  await withDataFile(async (filePath) => {
    // Rad 5 och rad 6 är båda sanna: entries är inte en array och version är
    // inte 1. Rad 5 vinner.
    await fs.writeFile(filePath, '{ "version": 2, "entries": 42 }', 'utf8');
    await rejectsWithMessage(
      () => loadEntries(),
      `Datafilen har fel innehåll: ${filePath}`
    );

    // Rad 6 och rad 7 är båda sanna: version är inte 1 och posten är ogiltig.
    // Rad 6 vinner.
    const invalid = { ...sampleEntries()[0], income: 5000 };
    assert.equal(isEntry(invalid), false);
    await fs.writeFile(
      filePath,
      JSON.stringify({ version: 2, entries: [invalid] }, null, 2) + '\n',
      'utf8'
    );
    await rejectsWithMessage(
      () => loadEntries(),
      `Datafilen har en version som appen inte känner igen: ${filePath}`
    );
  });
});

test('läsfel från operativsystemet ger svensk text och cause satt till originalfelet', async () => {
  await withDataFile(async (filePath, dir) => {
    // En katalog på datafilens plats: fs.readFile ger EISDIR, inte ENOENT.
    const asDirectory = path.join(dir, 'katalog.json');
    await fs.mkdir(asDirectory);
    process.env.HEMOCHEKONOMI_DATA_FILE = asDirectory;

    await assert.rejects(() => loadEntries(), (error) => {
      assert.ok(error instanceof StorageError);
      assert.equal(error.message, `Datafilen kunde inte läsas: ${asDirectory}`);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.code, 'EISDIR');
      return true;
    });

    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('saveEntries skapar katalogen vid behov', async () => {
  await withDataFile(async (filePath, dir) => {
    const deep = path.join(dir, 'ny', 'katalog', 'entries.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = deep;
    await saveEntries(sampleEntries());
    assert.equal(await exists(deep), true);
    assert.deepEqual(await loadEntries(), sampleEntries());
    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('ingen temporärfil ligger kvar efter en lyckad skrivning', async () => {
  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    assert.equal(await exists(filePath), true);
    assert.deepEqual(await tempFilesIn(dir), []);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json']);

    // Också vid överskrivning av en befintlig fil.
    await saveEntries([]);
    assert.deepEqual(await tempFilesIn(dir), []);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json']);
  });
});

test('temporärfilens namn härleds inte enbart ur datafilens namn', async () => {
  await withDataFile(async (filePath, dir) => {
    // En katalog upptar exakt det namn en suffixregel (filePath + '.tmp')
    // skulle välja. Ett namn som är unikt per anrop bryr sig inte om den.
    await fs.mkdir(filePath + '.tmp');

    await saveEntries(sampleEntries());

    assert.deepEqual(await loadEntries(), sampleEntries());
    assert.deepEqual(
      (await fs.readdir(dir)).sort(),
      ['entries.json', 'entries.json.tmp']
    );
  });
});

// ------------------------------------------- skrivvägen: rad 1-3, validering

test('rad 1: allt som inte är en array avvisas och rör inte disken', async () => {
  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    const before = await fs.readFile(filePath);
    const filesBefore = (await fs.readdir(dir)).sort();

    for (const value of [undefined, null, 'abc', { a: 1 }, 42, true, 1n, Symbol('x')]) {
      await rejectsWithMessage(
        () => saveEntries(value),
        'Posterna kunde inte sparas: listan över poster är ogiltig.'
      );
      assert.deepEqual(await fs.readFile(filePath), before, String(value?.toString?.() ?? value));
      assert.deepEqual((await fs.readdir(dir)).sort(), filesBefore);
    }
  });
});

test('rad 1: ett avvisat anrop skapar varken katalog eller fil', async () => {
  await withDataFile(async (filePath, dir) => {
    const deep = path.join(dir, 'skapas-aldrig', 'entries.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = deep;

    await rejectsWithMessage(
      () => saveEntries('abc'),
      'Posterna kunde inte sparas: listan över poster är ogiltig.'
    );
    assert.equal(await exists(path.join(dir, 'skapas-aldrig')), false);
    assert.deepEqual(await fs.readdir(dir), []);

    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('rad 2: en post som isEntry underkänner avvisas med sitt nummer', async () => {
  const valid = sampleEntries()[0];
  const circular = { ...valid };
  circular.self = circular;

  const cases = [
    ['undefined som andra element', [valid, undefined], 2],
    ['okänt fält', [{ ...valid, income: 5000 }], 1],
    ['fel typ på amountSek', [{ ...valid, amountSek: '199' }], 1],
    ['amountSek som BigInt', [{ ...valid, amountSek: 1n }], 1],
    ['amountSek som Symbol', [{ ...valid, amountSek: Symbol('x') }], 1],
    ['saknat fält', [{ ...valid, startDate: undefined }], 1],
    ['cirkulär post', [circular], 1],
    ['två ogiltiga poster: lägsta index vinner', [null, undefined], 1],
    ['ogiltig post sist', [valid, valid, { ...valid, id: '   ' }], 3]
  ];

  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    const before = await fs.readFile(filePath);
    const filesBefore = (await fs.readdir(dir)).sort();

    for (const [label, entries, number] of cases) {
      // isEntry är enda domaren, samma funktion som läsvägen frågar.
      assert.equal(isEntry(entries[number - 1]), false, label);
      await rejectsWithMessage(
        () => saveEntries(entries),
        `Posterna kunde inte sparas: post nummer ${number} är ogiltig.`
      );
      assert.deepEqual(await fs.readFile(filePath), before, label);
      assert.deepEqual((await fs.readdir(dir)).sort(), filesBefore, label);
    }
  });
});

test('rad 3: en post vars toJSON kastar ger JSON-felet och rör inte disken', async () => {
  const valid = sampleEntries()[0];
  // toJSON är ingen egen nyckel, så isEntry ser sex fält och godkänner posten,
  // medan JSON.stringify frågar efter toJSON och får ett kast.
  const trap = new Proxy(valid, {
    get: (target, key) => (key === 'toJSON' ? () => { throw new Error('nej'); } : target[key])
  });

  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    const before = await fs.readFile(filePath);
    const filesBefore = (await fs.readdir(dir)).sort();

    assert.equal(isEntry(trap), true);

    await assert.rejects(() => saveEntries([trap]), (error) => {
      assert.ok(error instanceof StorageError, `förväntade StorageError, fick ${error}`);
      assert.equal(error.message, 'Posterna kunde inte sparas: de gick inte att omvandla till JSON.');
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, 'nej');
      return true;
    });

    assert.deepEqual(await fs.readFile(filePath), before);
    assert.deepEqual((await fs.readdir(dir)).sort(), filesBefore);
  });
});

test('rad 7: ett kast från isEntry blir StorageError utan sökväg', async () => {
  const valid = sampleEntries()[0];
  // Object.keys går genom ownKeys och kastar inte, men isEntry kastar så snart
  // den läser ett fält — ett fel som ingen annan rad i tabellen fångar.
  const trap = new Proxy(valid, { get() { throw new Error('nej'); } });

  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    const before = await fs.readFile(filePath);
    const filesBefore = (await fs.readdir(dir)).sort();

    assert.throws(() => isEntry(trap), /nej/);

    await assert.rejects(() => saveEntries([trap]), (error) => {
      assert.ok(error instanceof StorageError, `förväntade StorageError, fick ${error}`);
      assert.equal(error.message, 'Posterna kunde inte sparas: ett oväntat fel inträffade.');
      // Rad 7 får ingen sökväg alls.
      assert.equal(error.message.includes(filePath), false);
      assert.ok(error.cause instanceof Error);
      assert.equal(error.cause.message, 'nej');
      return true;
    });

    assert.deepEqual(await fs.readFile(filePath), before);
    assert.deepEqual((await fs.readdir(dir)).sort(), filesBefore);
  });
});

// --------------------------------------------- skrivvägen: rad 4-6, OS-felen

// Gemensam kontroll för rad 4-6: svensk text, cause satt, ingen engelsk
// OS-text i meddelandet och ingen kvarliggande temporärfil.
function osErrorCheck(message, filePath) {
  return (error) => {
    assert.ok(error instanceof StorageError, `förväntade StorageError, fick ${error}`);
    assert.equal(error.message, message);
    assert.ok(error.cause);
    assert.equal(error.message.includes('operation not permitted'), false);
    assert.equal(error.message.includes('illegal operation'), false);
    assert.equal(error.message.includes('EPERM'), false);
    // Sökvägen i meddelandet är datafilens, aldrig temporärfilens.
    assert.equal(error.message.endsWith(filePath), true);
    assert.equal(error.message.includes('.tmp'), false);
    return true;
  };
}

test('rad 4: mkdir som misslyckas ger katalogfelet', async () => {
  await withDataFile(async (filePath, dir) => {
    // En fil ligger där katalogen skulle skapas: mkdir ger ENOTDIR.
    await fs.writeFile(path.join(dir, 'enfil'), 'x', 'utf8');
    const target = path.join(dir, 'enfil', 'hemochekonomi', 'entries.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = target;

    await assert.rejects(
      () => saveEntries(sampleEntries()),
      osErrorCheck(`Datafilen kunde inte sparas: katalogen gick inte att skapa: ${target}`, target)
    );
    assert.deepEqual(await tempFilesIn(dir), []);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['enfil']);

    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('rad 5: writeFile som misslyckas ger skrivfelet', async () => {
  await withDataFile(async (filePath, dir) => {
    // Katalogen är giltig men filnamnet går inte att skapa i den här miljön.
    const target = path.join(dir, 'ogiltigt?namn.json');
    process.env.HEMOCHEKONOMI_DATA_FILE = target;

    await assert.rejects(
      () => saveEntries(sampleEntries()),
      osErrorCheck(`Datafilen kunde inte sparas: skrivningen misslyckades: ${target}`, target)
    );
    assert.deepEqual(await tempFilesIn(dir), []);
    assert.deepEqual(await fs.readdir(dir), []);

    process.env.HEMOCHEKONOMI_DATA_FILE = filePath;
  });
});

test('rad 6: rename som misslyckas ger inbytesfelet och lämnar datafilen orörd', async () => {
  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());
    const before = await fs.readFile(filePath);

    // Datafilen hålls öppen för läsning: rename ger EPERM på den här maskinen.
    const handle = await fs.open(filePath, 'r');
    try {
      await assert.rejects(
        () => saveEntries([]),
        osErrorCheck(`Datafilen kunde inte sparas: den nya filen gick inte att byta in: ${filePath}`, filePath)
      );
    } finally {
      await handle.close();
    }

    assert.deepEqual(await fs.readFile(filePath), before);
    assert.deepEqual(await loadEntries(), sampleEntries());
    assert.deepEqual(await tempFilesIn(dir), []);
    assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json']);
  });
});

test('ett misslyckat anrop blockerar inte nästa', async () => {
  await withDataFile(async (filePath, dir) => {
    await saveEntries(sampleEntries());

    const handle = await fs.open(filePath, 'r');
    try {
      await assert.rejects(() => saveEntries([]), StorageError);
    } finally {
      await handle.close();
    }

    // Kedjan går vidare efter en avvisning: nästa anrop skriver som vanligt.
    await saveEntries([sampleEntries()[1]]);
    assert.deepEqual(await loadEntries(), [sampleEntries()[1]]);
    assert.deepEqual(await tempFilesIn(dir), []);
  });
});

// -------------------------------------------------- skrivvägens invarianter

test('allt som saveEntries accepterar kan loadEntries läsa tillbaka', async () => {
  const lists = [
    ['tom lista', []],
    ['två poster', sampleEntries()],
    ['femtio poster', manyEntries(50, 'invariant')],
    ['emoji i namnet', [{ ...sampleEntries()[0], name: 'Räksmörgås 🍤' }]],
    ['minsta belopp', [{ ...sampleEntries()[0], amountSek: 0.01 }]],
    ['största belopp', [{ ...sampleEntries()[0], amountSek: 9999999.99 }]]
  ];

  await withDataFile(async () => {
    for (const [label, entries] of lists) {
      await saveEntries(entries);
      assertSameEntries(await loadEntries(), entries, label);
    }
  });
});

test('två överlappande saveEntries: båda uppfylls och sista anropet vinner', async () => {
  await withDataFile(async (filePath, dir) => {
    // Olika längd, olika id och olika name: en blandning skulle synas direkt.
    // Det stora anropet blir klart sist utan kö — utan kön vinner alltså a.
    const a = manyEntries(3000, 'a');
    const b = manyEntries(1500, 'b');

    for (let round = 0; round < 20; round += 1) {
      const results = await Promise.allSettled([saveEntries(a), saveEntries(b)]);
      assert.deepEqual(
        results.map((result) => result.status),
        ['fulfilled', 'fulfilled'],
        `omgång ${round}: ${results.map((r) => r.reason?.message).join(' | ')}`
      );
      // b har 1 500 poster: en misslyckad deepEqual mot hela listan skulle bygga
      // en fullständig diff, så assertSameEntries fäller på antal och index först.
      assertSameEntries(await loadEntries(), b, `omgång ${round}`);
      assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json'], `omgång ${round}`);
    }
  });
});

// Storleken är uppmätt, inte vald: med kön borttagen ur loadEntries gav 10 000
// poster (1 897 818 byte) 19 avvisningar av 20 omgångar och 20 000 poster
// (3 817 818 byte) 20 av 20, i båda anropsordningarna. Testet använder det
// senare, så att läsningen med säkerhet fortfarande pågår när rename körs.
const OVERLAP_ENTRY_COUNT = 20000;

test('en läsning och en skrivning som överlappar: båda uppfylls och anropsordningen avgör', async () => {
  await withDataFile(async (filePath, dir) => {
    const stor = manyEntries(OVERLAP_ENTRY_COUNT, 'stor');
    const b = manyEntries(3, 'b');

    for (const ordning of ['skrivning först', 'läsning först']) {
      for (let round = 0; round < 20; round += 1) {
        // Den stora listan ligger på disk före varje omgång: läsningen ska
        // fortfarande pågå när rename körs. b är en annan lista än den.
        await saveEntries(stor);

        const results = ordning === 'skrivning först'
          ? await Promise.allSettled([saveEntries(b), loadEntries()])
          : await Promise.allSettled([loadEntries(), saveEntries(b)]);

        // En avvisning med rad 6:s meddelande betyder att läsningen inte gick
        // genom kön: fs.rename ger EPERM när datafilen är öppen någon annanstans.
        assert.deepEqual(
          results.map((result) => result.status),
          ['fulfilled', 'fulfilled'],
          `${ordning}, omgång ${round}: ${results.map((r) => r.reason?.message).join(' | ')}`
        );

        // Anropsordningen avgör vad läsningen ser: efter skrivningen ger den b,
        // före skrivningen ger den listan som låg på disk före omgången.
        // Samma mätning som i assertSameEntries gäller här: läsningens värde kan
        // vara 20 000 poster, och b är 3 — ett misslyckat deepEqual mellan dem
        // kostade 48 595 ms och +8734 MB i granskarens körning.
        if (ordning === 'skrivning först') {
          assertSameEntries(results[1].value, b, `${ordning}, omgång ${round}`);
        } else {
          assertSameEntries(results[0].value, stor, `${ordning}, omgång ${round}`);
        }

        assertSameEntries(await loadEntries(), b, `${ordning}, omgång ${round}`);
        assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json'], `${ordning}, omgång ${round}`);
      }
    }
  });
});

test('en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den nya listan', async () => {
  await withDataFile(async (filePath) => {
    const before = sampleEntries();

    // Antal omgångar, inte en tid. Punkt 3 kräver minst 20; talet nedan är
    // uppmätt, inte valt. Med 20 omgångar fällde punkt 6:s mutation (direkt
    // fs.writeFile i stället för temporärfil plus rename) det här testet i 1 av
    // 30 körningar på den här maskinen — dödandet måste träffa tiden mellan
    // trunkeringen och sista byten, och den tiden är cirka 0,2 ms av ett
    // fönster på cirka 120 ms. Varje omgång är ett nytt försök i samma fönster,
    // så fler omgångar höjer chansen att någon träffar: med 200 omgångar föll
    // testet i 9 av 10 muterade körningar, alla på punkt 4:s assertioner
    // (8 gånger "lämnade en datafil som inte gick att läsa", 1 gång "varken den
    // gamla eller barnets lista (0 poster)"). Priset är körtid: testet tar
    // cirka 37 s i stället för 3,5 s.
    const rounds = 200;
    // Punkt 2: minst 20 000 poster, och punkt 7 fördubblar antalet om varje
    // omgång hann bli klar. Punkt 7 fördubblar i stället fönstrets övre gräns
    // om varje dödande landade före rename.
    let entryCount = 20000;
    let windowFactor = 2;
    let counters = { gamlaListan: 0, barnetsLista: 0 };
    const attempts = [];

    // Punkt 7: högst tre försök totalt, och tKlar mäts om före varje försök.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const childList = childEntries(entryCount);

      // Punkt 1: utgångslistan får inte vara tom och ska ha ett annat antal
      // poster än barnets lista. Skälet är rad 3 i "Beteende vid läsning": en
      // tom fil läses som []. Vore utgångslistan tom skulle en avbruten
      // skrivning som lämnar en tom fil räknas som den gamla listan och passera
      // oupptäckt. Antalen måste dessutom skilja sig för att grenvalet på
      // after.length ska kunna avgöra vilken lista som ligger på disk — punkt 7
      // kan fördubbla entryCount, så villkoret prövas i varje försök.
      assert.notEqual(before.length, 0, 'punkt 1: utgångslistan får inte vara tom');
      assert.notEqual(
        before.length,
        childList.length,
        `punkt 1: utgångslistan och barnets lista har samma antal poster (${before.length})`
      );

      const tKlar = await matTKlar(filePath, entryCount);

      // Omgång i av N väntar Math.round((i * windowFactor * tKlar) / (N - 1))
      // millisekunder efter meddelandet. Inget millisekundtal står som konstant.
      const delays = [];
      for (let i = 0; i < rounds; i += 1) {
        delays.push(Math.round((i * windowFactor * tKlar) / (rounds - 1)));
      }

      counters = { gamlaListan: 0, barnetsLista: 0 };
      for (let i = 0; i < rounds; i += 1) {
        // Utgångsläget läggs tillbaka före varje omgång, också efter en omgång
        // där barnets lista vann: annars skulle nästa omgång räkna barnets
        // lista som den gamla.
        await saveEntries(before);

        const { child, stderrText } = forkChild(filePath, entryCount);
        const exited = new Promise((resolve) => child.once('exit', resolve));
        await waitForChildStart(child, stderrText);
        await sleep(delays[i]);
        child.kill('SIGKILL');
        await exited;

        // Punkt 4: avbrottet får aldrig ge en tredje utgång. loadEntries kastar
        // inte, och listan är antingen den gamla eller barnets. Det är de här
        // assertionerna mutationen ska fälla.
        let after;
        try {
          after = await loadEntries();
        } catch (error) {
          assert.fail(
            `avbrottet efter ${delays[i]} ms lämnade en datafil som inte gick att läsa: ${error.message}`
          );
        }

        // Grenvalet sker på after.length, aldrig på ett kast: ett
        // assert.deepEqual som *misslyckas* betalar hela util.inspect-diffen
        // (mätt: 20 000 poster, 52,7 s och +9,2 GB rss), och ett enda sådant
        // kast fick nästa fork att falla med "spawn UNKNOWN" /
        // "VirtualAlloc failed". Punkt 1 gör längderna till ett giltigt grenval:
        // utgångslistan är inte tom och har ett annat antal poster än barnets.
        // Grenkroppen jämför fortfarande hela listan, men genom
        // assertSameEntries, som fäller på antal och första avvikande index
        // innan deepEqual körs — kostnaden ligger i diffen, inte i placeringen.
        if (after.length === before.length) {
          assertSameEntries(
            after,
            before,
            `avbrottet efter ${delays[i]} ms gav ${after.length} poster som inte är den gamla listan`
          );
          counters.gamlaListan += 1;
        } else if (after.length === childList.length) {
          assertSameEntries(
            after,
            childList,
            `avbrottet efter ${delays[i]} ms gav ${after.length} poster som inte är barnets lista`
          );
          counters.barnetsLista += 1;
        } else {
          // Punkt 4: ingen tredje utgång godtas.
          assert.fail(
            `avbrottet efter ${delays[i]} ms gav varken den gamla eller barnets lista (${after.length} poster)`
          );
        }
      }

      attempts.push({
        forsok: attempt,
        poster: entryCount,
        tKlarMs: Math.round(tKlar),
        fonsterMs: `0…${Math.round(windowFactor * tKlar)}`,
        dodandetiderMs: delays.join(','),
        gamlaListan: counters.gamlaListan,
        barnetsLista: counters.barnetsLista
      });

      if (counters.gamlaListan >= 1 && counters.barnetsLista >= 1) {
        break;
      }
      // Punkt 7: barnets lista aldrig sedd betyder att varje dödande landade
      // före rename — vidga fönstret. Den gamla listan aldrig sedd betyder att
      // barnet blev klart före även det tidigaste dödandet — öka postantalet.
      if (counters.barnetsLista === 0) {
        windowFactor *= 2;
      }
      if (counters.gamlaListan === 0) {
        entryCount *= 2;
      }
    }

    // Redovisningskrav: mätvärden och fördelning per försök.
    for (const attempt of attempts) {
      console.log(`  SIGKILL-försök ${JSON.stringify(attempt)}`);
    }

    // Punkt 4: båda grenarna ska ha körts. En körning där någondera grenen
    // kördes noll gånger är ett fallerat test, inte ett godkänt.
    assert.ok(
      counters.gamlaListan >= 1,
      `ingen omgång gav den gamla listan efter ${attempts.length} försök: ${JSON.stringify(attempts)}`
    );
    assert.ok(
      counters.barnetsLista >= 1,
      `ingen omgång gav barnets lista efter ${attempts.length} försök: ${JSON.stringify(attempts)}`
    );
  });
});

// ---------------------------------------------------------- updateEntries
//
// Paket 5. Läs–ändra–skriv innanför en enda köplats (ARKITEKTUR.md,
// "Läs–ändra–skriv i ett steg"). Felen är läsvägens och skrivvägens, med två
// tillägg: U1 (mutera kastar) och U2 (mutera svarar null).

test('updateEntries skriver den lista mutera returnerar och svarar med den', async () => {
  await withDataFile(async () => {
    const [forst, andra] = sampleEntries();
    await saveEntries([forst]);

    const svar = await updateEntries((entries) => {
      assertSameEntries(entries, [forst], 'mutera fick inte filens innehåll');
      return [...entries, andra];
    });

    assertSameEntries(svar, [forst, andra], 'updateEntries svarade fel lista');
    assertSameEntries(await loadEntries(), [forst, andra], 'filen fick fel innehåll');
  });
});

test('updateEntries mot en fil som saknas ger mutera en tom lista', async () => {
  await withDataFile(async (filePath) => {
    const [forst] = sampleEntries();
    const svar = await updateEntries((entries) => {
      assert.deepEqual(entries, []);
      return [forst];
    });
    assertSameEntries(svar, [forst], 'updateEntries svarade fel lista');
    assert.equal(await exists(filePath), true);
  });
});

test('U2: mutera som svarar null skriver inte och ger null', async () => {
  await withDataFile(async (filePath, dir) => {
    const [forst] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);

    assert.equal(await updateEntries(() => null), null);

    assert.deepEqual(await fs.readFile(filePath), fore);
    assertSameEntries(await loadEntries(), [forst], 'filen ändrades av ett null-svar');
    assert.deepEqual(await tempFilesIn(dir), []);
  });
});

test('U2: null mot en fil som saknas skapar ingen fil', async () => {
  await withDataFile(async (filePath, dir) => {
    assert.equal(await updateEntries(() => null), null);
    assert.equal(await exists(filePath), false);
    assert.deepEqual(await fs.readdir(dir), []);
  });
});

test('U1: mutera som kastar ger rad 7:s meddelande med cause och rör inte disken', async () => {
  await withDataFile(async (filePath, dir) => {
    const [forst] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);
    const orsak = new Error('mutera gick sönder');

    await assert.rejects(
      () => updateEntries(() => {
        throw orsak;
      }),
      (error) => {
        assert.ok(error instanceof StorageError, `förväntade StorageError, fick ${error}`);
        assert.equal(error.message, 'Posterna kunde inte sparas: ett oväntat fel inträffade.');
        assert.equal(error.cause, orsak);
        return true;
      }
    );

    assert.deepEqual(await fs.readFile(filePath), fore);
    assert.deepEqual(await tempFilesIn(dir), []);
  });
});

test('rad 1 i skrivtabellen gäller inuti köplatsen: mutera som inte ger en array', async () => {
  await withDataFile(async (filePath, dir) => {
    const [forst] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);

    for (const varde of [undefined, 'abc', 42, { a: 1 }, true]) {
      await rejectsWithMessage(
        () => updateEntries(() => varde),
        'Posterna kunde inte sparas: listan över poster är ogiltig.'
      );
      assert.deepEqual(await fs.readFile(filePath), fore, String(varde));
      assert.deepEqual(await tempFilesIn(dir), [], String(varde));
    }
  });
});

test('rad 2 i skrivtabellen gäller inuti köplatsen: lägsta ogiltiga index vinner', async () => {
  await withDataFile(async (filePath) => {
    const [forst, andra] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);

    await rejectsWithMessage(
      () => updateEntries(() => [forst, { ...andra, amountSek: '199' }]),
      'Posterna kunde inte sparas: post nummer 2 är ogiltig.'
    );
    await rejectsWithMessage(
      () => updateEntries(() => [{ ...forst, income: 5000 }, andra]),
      'Posterna kunde inte sparas: post nummer 1 är ogiltig.'
    );

    assert.deepEqual(await fs.readFile(filePath), fore);
  });
});

test('rad 3 i skrivtabellen gäller inuti köplatsen: en post vars toJSON kastar', async () => {
  await withDataFile(async (filePath, dir) => {
    const [forst] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);

    // toJSON är ingen egen nyckel, så isEntry ser sex fält och godkänner posten,
    // medan JSON.stringify frågar efter toJSON och får ett kast.
    const trasig = new Proxy(forst, {
      get: (target, key) => (key === 'toJSON'
        ? () => {
            throw new Error('nej');
          }
        : target[key])
    });

    await rejectsWithMessage(
      () => updateEntries(() => [trasig]),
      'Posterna kunde inte sparas: de gick inte att omvandla till JSON.'
    );

    assert.deepEqual(await fs.readFile(filePath), fore);
    assert.deepEqual(await tempFilesIn(dir), []);
  });
});

test('läsvägens fel når anroparen oförändrat genom updateEntries', async () => {
  await withDataFile(async (filePath) => {
    await fs.writeFile(filePath, '{ trasig', 'utf8');
    let muteraKordes = false;
    await rejectsWithMessage(
      () => updateEntries((entries) => {
        muteraKordes = true;
        return entries;
      }),
      `Datafilen är skadad och kunde inte läsas: ${filePath}`
    );
    assert.equal(muteraKordes, false, 'mutera kördes trots att läsningen misslyckades');
  });
});

test('rad 6 i skrivtabellen gäller inuti köplatsen: rename som misslyckas', async () => {
  await withDataFile(async (filePath, dir) => {
    const [forst, andra] = sampleEntries();
    await saveEntries([forst]);
    const fore = await fs.readFile(filePath);

    // Datafilen hålls öppen av en annan handtagare: fs.rename ger då EPERM på
    // den här maskinen, precis som i saveEntries-fallet ovan.
    const handle = await fs.open(filePath, 'r');
    try {
      await rejectsWithMessage(
        () => updateEntries((entries) => [...entries, andra]),
        `Datafilen kunde inte sparas: den nya filen gick inte att byta in: ${filePath}`
      );
    } finally {
      await handle.close();
    }

    assert.deepEqual(await fs.readFile(filePath), fore);
    assert.deepEqual(await tempFilesIn(dir), []);
  });
});

test('två överlappande updateEntries: båda ändringarna blir av, ingen går förlorad', async () => {
  await withDataFile(async () => {
    const [forst, andra] = sampleEntries();
    // Facit: anropsordningen avgör, det andra anropet ser resultatet av det
    // första, och ett därpå följande loadEntries ger båda ändringarna. Utan den
    // gemensamma köplatsen läser anrop två samma utgångsläge som anrop ett och
    // skriver över det.
    for (let omgang = 0; omgang < 20; omgang += 1) {
      await saveEntries([]);
      const [ettSvar, tvaSvar] = await Promise.all([
        updateEntries((entries) => [...entries, forst]),
        updateEntries((entries) => [...entries, andra])
      ]);
      assertSameEntries(ettSvar, [forst], `omgång ${omgang}: första anropets svar`);
      assertSameEntries(tvaSvar, [forst, andra], `omgång ${omgang}: andra anropets svar`);
      assertSameEntries(await loadEntries(), [forst, andra], `omgång ${omgang}: filen`);
    }
  });
});

test('updateEntries och saveEntries som överlappar: sista anropet vinner', async () => {
  await withDataFile(async () => {
    const [forst, andra] = sampleEntries();
    await saveEntries([]);
    const resultat = await Promise.allSettled([
      updateEntries((entries) => [...entries, forst]),
      saveEntries([andra])
    ]);
    assert.deepEqual(resultat.map((r) => r.status), ['fulfilled', 'fulfilled']);
    assertSameEntries(await loadEntries(), [andra], 'sista anropet vann inte');
  });
});

test('updateEntries låser sig inte mot en samtidig loadEntries', async () => {
  await withDataFile(async () => {
    const [forst, andra] = sampleEntries();
    await saveEntries([forst]);
    // Skulle updateEntries anropa den exporterade loadEntries inifrån sin
    // köplats vore det en låsning: kön väntar då på sig själv.
    const resultat = await Promise.allSettled([
      updateEntries((entries) => [...entries, andra]),
      loadEntries()
    ]);
    assert.deepEqual(resultat.map((r) => r.status), ['fulfilled', 'fulfilled']);
    // Anropsordningen avgör: läsningen ställdes i kön efter skrivningen och ser
    // därför dess resultat, precis som facit för två överlappande anrop säger.
    assertSameEntries(resultat[1].value, [forst, andra], 'läsningen såg inte skrivningens resultat');
    assertSameEntries(await loadEntries(), [forst, andra], 'filen efteråt');
  });
});

test('ett misslyckat updateEntries blockerar inte nästa', async () => {
  await withDataFile(async () => {
    const [forst] = sampleEntries();
    await saveEntries([]);
    const misslyckat = updateEntries(() => {
      throw new Error('mutera gick sönder');
    });
    const nasta = updateEntries((entries) => [...entries, forst]);

    await assert.rejects(misslyckat, StorageError);
    // Kedjan går vidare efter en avvisning: det första anropets fel får aldrig
    // bli det andra anropets fel, och det andra får inte hoppas över.
    assertSameEntries(await nasta, [forst], 'nästa anrop kom inte fram');
    assertSameEntries(await loadEntries(), [forst], 'filen efteråt');
  });
});
