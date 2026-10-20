import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const WEB = fileURLToPath(new URL('../src/web/', import.meta.url));

function synligText(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|svg)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/g, ' ')
    .replace(/\s+/g, ' ');
}

const FORBJUDET = [
  /\bdemo/i,
  /\bBas\b/,
  /\bPlus\b/,
  /\bPremium\b/,
  /\d+ kr\/mån/,
  /engångskod/i,
  /egen dator/i,
  /lokalt/i,
  /Min plan/,
  /Se planer/,
  /Uppgradera/
];

for (const fil of ['landning.html', 'index.html', 'integritet.html']) {
  test(`${fil} lovar inget som inte finns`, async () => {
    const text = synligText(await fs.readFile(`${WEB}${fil}`, 'utf8'));
    for (const mönster of FORBJUDET) {
      assert.equal(mönster.test(text), false, `${fil}: ${mönster} i "${text.match(mönster)?.[0]}"`);
    }
  });
}

test('landningssidan säger att appen är gratis och länkar till integritetspolicyn', async () => {
  const html = await fs.readFile(`${WEB}landning.html`, 'utf8');
  const text = synligText(html);
  assert.match(text, /Gratis att använda/);
  assert.match(text, /0 kr/);
  assert.equal(html.includes('href="/integritet"'), true);
  assert.equal(html.includes('href="/app?registrera"'), true);
  assert.equal(html.includes('/demo/'), false);
  assert.equal(html.includes('/priser.js'), false);
});

test('appens sida laddar inget demoskript och har inloggningens fyra lägen i ett formulär', async () => {
  const html = await fs.readFile(`${WEB}index.html`, 'utf8');
  assert.equal(html.includes('/demo/'), false);
  for (const id of ['login-form', 'login-email', 'login-password', 'tab-login', 'tab-register', 'forgot-link', 'back-to-login']) {
    assert.equal(html.includes(`id="${id}"`), true, id);
  }
  assert.match(html, /<input id="login-password" name="password" type="password" autocomplete="current-password" \/>/);
  assert.equal(html.includes('href="/integritet"'), true);
});

test('integritetspolicyn har kontaktadressen och inga platshållare', async () => {
  const html = await fs.readFile(`${WEB}integritet.html`, 'utf8');
  assert.equal(/\[[A-ZÅÄÖ -]+\]/.test(html), false, 'en platshållare står kvar');
  assert.equal(html.includes('<a href="mailto:info@hemochekonomi.se">info@hemochekonomi.se</a>'), true);
  assert.equal(html.includes('hotmail'), false);
  assert.equal(html.includes('Qaiumi'), false);
});

test('landningssidan har kontaktadressen i sidfoten och bland vanliga frågor', async () => {
  const html = await fs.readFile(`${WEB}landning.html`, 'utf8');
  assert.equal(html.includes('<a href="mailto:info@hemochekonomi.se">Kontakt</a>'), true);
  assert.equal(html.includes('<summary>Hur kontaktar jag er?</summary>'), true);
  assert.equal(html.includes('<a href="mailto:info@hemochekonomi.se">info@hemochekonomi.se</a>'), true);
});
