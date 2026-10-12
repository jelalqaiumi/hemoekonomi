// De funktionsnycklar som är byggda, enligt regeln i ARKITEKTUR.md under "Det
// demon inte visar": en nyckel är byggd när src/server/api.js anropar
// requireFeature(session, '<nyckeln>') för den, och overview är det enda
// namngivna undantaget. (D17) i tests/demo.test.js och (P14) i
// tests/plans.test.js läser båda regeln härifrån, så att de inte har var sin
// kopia av den.
//
// Funktionen asserterar ingenting. Undantagets två assertioner står i (D17).
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Sökvägen byggs ur import.meta.url och aldrig ur process.cwd()
// (LARDOMAR.md 2026-09-04).
const API_PATH = fileURLToPath(new URL('../../src/server/api.js', import.meta.url));

export async function builtFeatureKeys() {
  const kalla = await fs.readFile(API_PATH, 'utf8');
  // Radkommentarerna tas bort först: api.js har /api/* inuti radkommentarer,
  // och ett /* där hade annars kunnat bli början på en blockkommentarsträff.
  const kod = kalla.replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  const byggda = new Set();
  for (const traff of kod.matchAll(/requireFeature\(session, '([A-Za-z]+)'\)/g)) {
    byggda.add(traff[1]);
  }
  byggda.add('overview');
  return [...byggda];
}
