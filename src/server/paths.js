import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const SRC_DIR = path.dirname(SERVER_DIR);

const DATA_DIR_NAME = 'hemochekonomi';
const DATABASE_DIR_NAME = 'databas';

export function getDatabaseFilePath() {
  const override = process.env.HEMOCHEKONOMI_DB_FILE;
  if (typeof override === 'string' && override.trim() !== '') {
    return override;
  }
  const appData = process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming');
  return path.join(appData, DATA_DIR_NAME, DATABASE_DIR_NAME);
}

export function getWebDir() {
  return path.join(SRC_DIR, 'web');
}

export function getCoreDir() {
  return path.join(SRC_DIR, 'core');
}

export function getImageDir() {
  return path.join(SRC_DIR, 'web', 'bilder');
}
