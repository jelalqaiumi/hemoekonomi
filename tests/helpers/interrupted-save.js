// Barnprocess för atomicitetstestet i tests/storage.test.js. Filnamnet slutar
// medvetet inte på .test.js: testköraren ska aldrig köra den här filen.
//
// Filen har två roller. Körs den som huvudmodul (fork) skickar den 'startar'
// och anropar därefter saveEntries — det är den skrivning föräldern dödar med
// SIGKILL. Importeras den bygger den bara listan, så att föräldern kan jämföra
// med exakt de poster barnet försökte skriva utan en andra kopia av listan.
import { pathToFileURL } from 'node:url';

import { saveEntries } from '../../src/server/storage.js';

// Minst 20 000 poster enligt teststrategin i ARKITEKTUR.md: skrivningen ska
// vara lång nog att hinna avbrytas. Föräldern kan höja antalet med
// HEMOCHEKONOMI_TEST_ENTRY_COUNT (punkt 7: fördubbla antalet poster när varje
// omgång hann bli klar). Saknas variabeln skriver barnet 20 000 poster.
const DEFAULT_CHILD_ENTRY_COUNT = 20000;
const requestedCount = Number(process.env.HEMOCHEKONOMI_TEST_ENTRY_COUNT);
export const CHILD_ENTRY_COUNT = Number.isInteger(requestedCount) && requestedCount > 0
  ? requestedCount
  : DEFAULT_CHILD_ENTRY_COUNT;

export function childEntries(count = CHILD_ENTRY_COUNT) {
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    entries.push({
      id: `barn-${index}`,
      name: `Barnets post ${index}`,
      amountSek: 99.5,
      interval: 'monthly',
      startDate: '2026-01-15',
      category: 'subscription'
    });
  }
  return entries;
}

const runAsChild = typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;

if (runAsChild) {
  const entries = childEntries();
  // Omedelbart före skrivningen: föräldern börjar räkna sina millisekunder här.
  process.send('startar');
  await saveEntries(entries);
}
