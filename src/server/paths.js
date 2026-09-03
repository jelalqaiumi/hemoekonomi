// Var appens filer ligger. Enda stället som känner till sökvägar på disk.
// Ligger i src/server/ och får därför importera node:-moduler; src/core/ får
// aldrig importera härifrån.
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(SERVER_DIR);

const DATA_DIR_NAME = 'hemochekonomi';
const DATA_FILE_NAME = 'entries.json';

// Läser miljövariabeln vid varje anrop, aldrig en gång vid modulladdning: en
// cachad sökväg gör lagringen otestbar, eftersom testerna sätter
// HEMOCHEKONOMI_DATA_FILE efter att modulen redan är laddad.
// Tom sträng och en sträng med bara blanktecken räknas som osatt. Värdet
// används därefter ordagrant, utan trim(): en riktig sökväg får innehålla
// blanksteg, och paths.js ska inte ha någon egen åsikt om hur en sökväg ser ut.
export function getDataFilePath() {
  const override = process.env.HEMOCHEKONOMI_DATA_FILE;
  if (typeof override === 'string' && override.trim() !== '') {
    return override;
  }
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, DATA_DIR_NAME, DATA_FILE_NAME);
}

export function getWebDir() {
  return path.join(SRC_DIR, 'web');
}

export function getCoreDir() {
  return path.join(SRC_DIR, 'core');
}
