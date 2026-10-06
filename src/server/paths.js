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
const DATABASE_FILE_NAME = 'hemochekonomi.sqlite';

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

// Databasfilen [etapp 1]. Samma villkor för miljövariabeln som
// getDataFilePath: läses vid varje anrop, tom sträng och bara blanktecken
// räknas som osatt, och ett satt värde används ordagrant utan trim().
// Förvalet ligger i samma katalog som datafilen, alltså under
// %APPDATA%\hemochekonomi\ — men sökvägen härleds inte ur getDataFilePath():
// den som sätter HEMOCHEKONOMI_DATA_FILE ska inte flytta databasen med den.
export function getDatabaseFilePath() {
  const override = process.env.HEMOCHEKONOMI_DB_FILE;
  if (typeof override === 'string' && override.trim() !== '') {
    return override;
  }
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, DATA_DIR_NAME, DATABASE_FILE_NAME);
}

export function getWebDir() {
  return path.join(SRC_DIR, 'web');
}

export function getCoreDir() {
  return path.join(SRC_DIR, 'core');
}

// Bildkatalogen under src/web/. En egen funktion och inte ett 'bilder' som
// server.js fogar ihop själv: den här filen är enda stället som känner till
// sökvägar på disk, och ett katalognamn är en del av en sökväg.
export function getImageDir() {
  return path.join(SRC_DIR, 'web', 'bilder');
}

// Demokatalogen under src/web/. Samma form och samma skäl som getImageDir:
// den här filen är enda stället som känner till sökvägar på disk.
export function getDemoDir() {
  return path.join(SRC_DIR, 'web', 'demo');
}

// Låsfilen hör till datafilen och inte till porten: två instanser med var sin
// HEMOCHEKONOMI_DATA_FILE låser inte varandra. Sökvägen läses genom
// getDataFilePath() och aldrig ur miljövariabeln själv — två uppslag vore två
// kopior av samma regel. Suffixet .lock kan aldrig krocka med skrivvägens
// temporärnamn, som slutar på .tmp.
export function getLockFilePath() {
  return `${getDataFilePath()}.lock`;
}
