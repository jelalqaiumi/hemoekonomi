import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { UNPARSABLE_MESSAGE, handleApiRequest } from './api.js';
import { closeDatabase, getDatabase } from './db.js';
import { getCoreDir, getImageDir, getWebDir } from './paths.js';

const DEFAULT_PORT = 3000;

export function resolveHost(env = process.env) {
  if (typeof env.HOST === 'string' && env.HOST.trim() !== '') {
    return env.HOST.trim();
  }
  return env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1';
}

const UNEXPECTED_MESSAGE = 'Ett oväntat fel inträffade. Försök igen.';

const START_MESSAGES = Object.freeze({
  addressInUse: (port) => `Port ${port} är upptagen. Stäng programmet som använder porten, `
    + 'eller sätt PORT till ett annat portnummer och starta om Hem och Ekonomi.',
  accessDenied: (port) => `Port ${port} gick inte att öppna: åtkomst nekades. Sätt PORT till ett annat portnummer.`,
  databaseFailed: 'Databasen gick inte att öppna. Kontrollera DATABASE_URL och försök igen.',
  unexpected: (port) => `Servern kunde inte startas på port ${port}.`
});

const HTML_TYPE = 'text/html; charset=utf-8';
const CSS_TYPE = 'text/css; charset=utf-8';
const JS_TYPE = 'text/javascript; charset=utf-8';

const STATIC_ROUTES = Object.freeze(Object.assign(Object.create(null), {
  '/': { file: 'landning.html', type: HTML_TYPE },
  '/app': { file: 'index.html', type: HTML_TYPE },
  '/integritet': { file: 'integritet.html', type: HTML_TYPE },
  '/landning.css': { file: 'landning.css', type: CSS_TYPE },
  '/tema.css': { file: 'tema.css', type: CSS_TYPE },
  '/style.css': { file: 'style.css', type: CSS_TYPE },
  '/app.js': { file: 'app.js', type: JS_TYPE }
}));

const CORE_PREFIX = '/core/';
const CORE_FILE_PATTERN = /^[a-z0-9-]+\.js$/;

const IMAGE_PREFIX = '/bilder/';
const IMAGE_FILE_PATTERN = /^[a-z0-9-]+\.(png|svg)$/;
const IMAGE_TYPES = Object.freeze(Object.assign(Object.create(null), {
  png: 'image/png',
  svg: 'image/svg+xml'
}));

function sendNotFound(res) {
  res.writeHead(404);
  res.end();
}

function sendJsonError(res, status, message) {
  const text = JSON.stringify({ error: message });
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text)
  });
  res.end(text);
}

function sendUnexpectedError(res, error) {
  console.error('Oväntat fel:', error);
  if (res.headersSent) {
    res.destroy();
    return;
  }
  sendJsonError(res, 500, UNEXPECTED_MESSAGE);
}

function resolveStaticFile(pathname) {
  const route = STATIC_ROUTES[pathname];
  if (route !== undefined) {
    return { filePath: path.join(getWebDir(), route.file), type: route.type };
  }

  if (pathname.startsWith(CORE_PREFIX)) {
    const name = pathname.slice(CORE_PREFIX.length);
    if (!CORE_FILE_PATTERN.test(name)) {
      return null;
    }
    return { filePath: path.join(getCoreDir(), name), type: JS_TYPE };
  }

  if (pathname.startsWith(IMAGE_PREFIX)) {
    const name = pathname.slice(IMAGE_PREFIX.length);
    const imageMatch = IMAGE_FILE_PATTERN.exec(name);
    if (imageMatch === null) {
      return null;
    }
    return { filePath: path.join(getImageDir(), name), type: IMAGE_TYPES[imageMatch[1]] };
  }

  return null;
}

async function readOrNull(filePath) {
  try {
    return await fs.readFile(filePath);
  } catch {
    return null;
  }
}

async function serveStatic(res, pathname) {
  const target = resolveStaticFile(pathname);
  const content = target === null ? null : await readOrNull(target.filePath);
  if (content === null) {
    sendNotFound(res);
    return;
  }
  res.writeHead(200, { 'Content-Type': target.type, 'Content-Length': content.length });
  res.end(content);
}

async function handleRequest(req, res) {
  let pathname;
  try {
    ({ pathname } = new URL(req.url, 'http://127.0.0.1'));
  } catch {
    sendJsonError(res, 400, UNPARSABLE_MESSAGE);
    return;
  }

  if (pathname === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('ok');
    return;
  }

  if (await handleApiRequest(req, res, pathname)) {
    return;
  }

  await serveStatic(res, pathname);
}

function setSecurityHeaders(res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  if (process.env.NODE_ENV === 'production') {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
}

export function createServer(handler = handleRequest) {
  return http.createServer((req, res) => {
    setSecurityHeaders(res);
    try {
      const result = handler(req, res);
      if (typeof result?.then !== 'function') {
        throw new TypeError('hanteraren gav inget löfte');
      }
      result.then(undefined, (error) => sendUnexpectedError(res, error));
    } catch (error) {
      sendUnexpectedError(res, error);
    }
  });
}

export function resolvePort(env = process.env) {
  return Number(env.PORT) || DEFAULT_PORT;
}

export function isDirectRun(argv1, moduleUrl) {
  return argv1 !== undefined && path.resolve(argv1) === fileURLToPath(moduleUrl);
}

export class ServerStartError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ServerStartError';
  }
}

export function asStartError(port, error) {
  if (error?.name === 'DatabaseError') {
    return new ServerStartError(START_MESSAGES.databaseFailed, { cause: error });
  }
  if (error?.code === 'EADDRINUSE') {
    return new ServerStartError(START_MESSAGES.addressInUse(port), { cause: error });
  }
  if (error?.code === 'EACCES') {
    return new ServerStartError(START_MESSAGES.accessDenied(port), { cause: error });
  }
  return new ServerStartError(START_MESSAGES.unexpected(port), { cause: error });
}

export async function start(port = resolvePort(process.env), host = resolveHost(process.env)) {
  try {
    await getDatabase();
    const server = createServer();
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, host, resolve);
    });
    return server;
  } catch (error) {
    throw asStartError(port, error);
  }
}

if (isDirectRun(process.argv[1], import.meta.url)) {
  try {
    const host = resolveHost(process.env);
    const server = await start(resolvePort(process.env), host);
    const { port } = server.address();
    console.log(`Hem och Ekonomi kör på http://${host === '0.0.0.0' ? 'localhost' : host}:${port}`);
    const shutdown = () => {
      server.close(() => {
        closeDatabase().finally(() => process.exit(0));
      });
      setTimeout(() => process.exit(0), 10000).unref();
    };
    process.once('SIGTERM', shutdown);
    process.once('SIGINT', shutdown);
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
