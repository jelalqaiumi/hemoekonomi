import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fork } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

import { isEntry } from '../src/core/entry.js';
import { getCoreDir, getDataFilePath, getWebDir } from '../src/server/paths.js';
import { STORAGE_VERSION, StorageError, loadEntries, saveEntries } from '../src/server/storage.js';
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
      assert.deepEqual(await loadEntries(), entries, label);
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
      assert.deepEqual(await loadEntries(), b, `omgång ${round}`);
      assert.deepEqual((await fs.readdir(dir)).sort(), ['entries.json'], `omgång ${round}`);
    }
  });
});

test('en skrivning som dödas med SIGKILL lämnar antingen den gamla eller den nya listan', async () => {
  await withDataFile(async (filePath) => {
    const before = sampleEntries();
    await saveEntries(before);

    const childList = childEntries();
    const outcomes = { gammal: 0, ny: 0 };

    for (let i = 0; i < 20; i += 1) {
      const child = fork('tests/helpers/interrupted-save.js', [], {
        env: { ...process.env, HEMOCHEKONOMI_DATA_FILE: filePath }
      });
      const exited = new Promise((resolve) => child.once('exit', resolve));
      await new Promise((resolve) => child.once('message', resolve));
      await sleep(i);
      child.kill('SIGKILL');
      await exited;

      // Punkt 4 i teststrategin: avbrottet får aldrig ge en tredje utgång.
      // loadEntries kastar inte, och listan är antingen den gamla eller
      // barnets. Det är den här assertionen mutationen ska fälla.
      const after = await loadEntries();
      try {
        assert.deepEqual(after, before);
        outcomes.gammal += 1;
      } catch {
        assert.deepEqual(
          after,
          childList,
          `avbrottet efter ${i} ms gav varken den gamla eller den nya listan (${after.length} poster)`
        );
        outcomes.ny += 1;
      }
    }

    // Redovisningskrav, inte assertion: fördelningen mellan utfallen.
    console.log(`  SIGKILL-fördelning: gamla listan ${outcomes.gammal}, barnets lista ${outcomes.ny}`);
  });
});
