// Hero-fotot på landningssidan (ARKITEKTUR.md del 6, kravlista [hero-foto]).
// Ingen server: filen läser filer från disk. (H1) och (H3) står i
// tests/server.test.js, eftersom de kräver en server.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const PHOTO_PATH = fileURLToPath(new URL('../src/web/bilder/hero-ekonomi.jpg', import.meta.url));
const TEMA_PATH = fileURLToPath(new URL('../src/web/tema.css', import.meta.url));
const LANDNING_CSS_PATH = fileURLToPath(new URL('../src/web/landning.css', import.meta.url));

const MAX_PHOTO_BYTES = 400000;
const MIN_CONTRAST = 4.5;

// SOF-markörerna: varje baseline-, progressiv-, förlustfri- och aritmetisk
// variant. 0xC4 (DHT), 0xC8 (JPG) och 0xCC (DAC) är inte SOF och står inte med.
const SOF_MARKERS = new Set([
  0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf
]);

// Måtten ur den första SOF-markören, eller ett eget fel om ingen hittas före
// SOS (0xDA) eller filens slut.
function readJpegSize(buffer) {
  let i = 2;
  while (i < buffer.length) {
    assert.equal(buffer[i], 0xff, `förväntade 0xFF vid index ${i}, fick 0x${buffer[i].toString(16)}`);
    if (i + 1 >= buffer.length) {
      break;
    }
    const marker = buffer[i + 1];
    if (marker === 0xff) {
      // Fyllnadsbyte: nästa 0xFF är början på samma markör.
      i += 1;
      continue;
    }
    if ((marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) {
      i += 2;
      continue;
    }
    if (marker === 0xda) {
      break;
    }
    if (i + 3 >= buffer.length) {
      break;
    }
    if (SOF_MARKERS.has(marker)) {
      assert.ok(i + 8 < buffer.length, `SOF-markören vid index ${i} är avhuggen`);
      return { height: buffer.readUInt16BE(i + 5), width: buffer.readUInt16BE(i + 7) };
    }
    i += 2 + buffer.readUInt16BE(i + 2);
  }
  assert.fail('hero-ekonomi.jpg har ingen SOF-markör före SOS eller filens slut');
}

test('(H2) hero-fotot är en JPEG på 1920 x 1280 och högst 400 000 byte', async () => {
  const buffer = await fs.readFile(PHOTO_PATH);
  assert.ok(
    buffer.length <= MAX_PHOTO_BYTES,
    `hero-ekonomi.jpg är ${buffer.length} byte, högst ${MAX_PHOTO_BYTES} är tillåtet`
  );
  assert.deepEqual([buffer[0], buffer[1], buffer[2]], [0xff, 0xd8, 0xff], 'filen börjar inte som en JPEG');
  assert.deepEqual(
    [buffer[buffer.length - 2], buffer[buffer.length - 1]],
    [0xff, 0xd9],
    'filen slutar inte som en JPEG'
  );
  const { width, height } = readJpegSize(buffer);
  assert.equal(width, 1920, `bredden är ${width}`);
  assert.equal(height, 1280, `höjden är ${height}`);
});

// --- (H4) ---------------------------------------------------------------

// Tokenvärdena ur ett :root-block. Kommentarerna är redan borttagna.
function readDeclarations(block) {
  const tokens = new Map();
  for (const match of block.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) {
    tokens.set(match[1], match[2].trim());
  }
  return tokens;
}

// Det ljusa läget är det första :root { … }; det mörka är det ljusa med
// :root { … } inuti @media (prefers-color-scheme: dark) ovanpå.
function readThemes(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const light = /:root\s*\{([^}]*)\}/.exec(text);
  assert.ok(light, 'tema.css har inget :root { … }');
  const media = text.indexOf('@media (prefers-color-scheme: dark)');
  assert.notEqual(media, -1, 'tema.css har inget @media (prefers-color-scheme: dark)');
  const dark = /:root\s*\{([^}]*)\}/.exec(text.slice(media));
  assert.ok(dark, 'det mörka läget har inget :root { … }');
  const lightTokens = readDeclarations(light[1]);
  const darkTokens = new Map([...lightTokens, ...readDeclarations(dark[1])]);
  return [
    ['ljust läge', lightTokens],
    ['mörkt läge', darkTokens]
  ];
}

// var(--x) löses upp tills värdet är en hexkod.
function resolveToken(tokens, name, mode) {
  let value = tokens.get(name);
  const seen = new Set([name]);
  for (;;) {
    assert.notEqual(value, undefined, `${mode}: ${name} saknas i tema.css`);
    const reference = /^var\((--[a-z0-9-]+)\)$/.exec(value);
    if (reference === null) {
      return value;
    }
    assert.ok(!seen.has(reference[1]), `${mode}: ${name} refererar till sig själv`);
    seen.add(reference[1]);
    value = tokens.get(reference[1]);
  }
}

function parseHex(value, label) {
  const match = /^#([0-9a-fA-F]{6})([0-9a-fA-F]{2})?$/.exec(value);
  assert.ok(match, `${label} är ${value}, inte en hexkod med 6 eller 8 siffror`);
  const digits = match[1];
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
    a: match[2] === undefined ? 1 : parseInt(match[2], 16) / 255,
    rgb: digits.toLowerCase(),
    hasAlpha: match[2] !== undefined
  };
}

// c = a * s + (1 - a) * b, kanal för kanal (ARKITEKTUR.md, "Hur kontrasten räknas").
function over(top, base) {
  const mix = (s, b) => top.a * s + (1 - top.a) * b;
  return { r: mix(top.r, base.r), g: mix(top.g, base.g), b: mix(top.b, base.b), a: 1 };
}

function luminance(color) {
  const channel = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(light, dark) {
  return (luminance(light) + 0.05) / (luminance(dark) + 0.05);
}

const HERO_TEXTS = ['--text-pa-mork', '--text-svag-pa-mork', '--guld-ljus'];

test('(H4) den ljusa texten i hero når 4,5:1 mot slöjan', async (t) => {
  const css = await fs.readFile(TEMA_PATH, 'utf8');
  const white = parseHex('#ffffff', 'den vita bildpunkten');
  for (const [mode, tokens] of readThemes(css)) {
    const color = (name) => parseHex(resolveToken(tokens, name, mode), `${mode}: ${name}`);
    const opaque = (name) => {
      const parsed = color(name);
      assert.equal(parsed.hasAlpha, false, `${mode}: ${name} ska vara ogenomskinlig`);
      return parsed;
    };

    // (a)
    const sloja = color('--hero-sloja');
    const marin = opaque('--bla-marin');
    assert.equal(sloja.hasAlpha, true, `${mode}: --hero-sloja ska ha 8 siffror`);
    assert.equal(sloja.rgb, marin.rgb, `${mode}: --hero-sloja ska vara --bla-marin med genomskinlighet`);

    const hover = color('--hover-pa-mork');
    const b1 = over(sloja, white);
    const b2 = over(hover, b1);
    const b0 = over(sloja, opaque('--morkt-block'));

    const check = (textName, surface, surfaceName) => {
      const text = opaque(textName);
      assert.ok(
        luminance(text) > luminance(surface),
        `${mode}: ${textName} är inte ljusare än ytan ${surfaceName}`
      );
      const ratio = contrast(text, surface);
      t.diagnostic(`${mode}: ${textName} mot ${surfaceName} ${ratio.toFixed(2)}:1`);
      assert.ok(
        ratio >= MIN_CONTRAST,
        `${mode}: ${textName} mot ytan ${surfaceName} ger ${ratio.toFixed(2)}:1, under ${MIN_CONTRAST}:1`
      );
    };

    // (b)
    for (const name of HERO_TEXTS) {
      check(name, b1, 'B1 (--hero-sloja över #ffffff)');
    }
    // (c)
    check('--text-pa-mork', b2, 'B2 (--hover-pa-mork över B1)');
    // (d)
    for (const name of HERO_TEXTS) {
      check(name, b0, 'B0 (--hero-sloja över --morkt-block)');
    }
  }
});

// --- (H5) ---------------------------------------------------------------

test('(H5) landning.css har fotot och inte gradienten', async () => {
  const landning = await fs.readFile(LANDNING_CSS_PATH, 'utf8');
  const tema = await fs.readFile(TEMA_PATH, 'utf8');
  const match = /^\.hero \{([\s\S]*?)^\}/m.exec(landning);
  assert.ok(match, 'landning.css har inget .hero { … }');
  const block = match[1].replace(/\s+/g, ' ');
  for (const required of [
    'background-color: var(--morkt-block);',
    'background-image: linear-gradient(var(--hero-sloja), var(--hero-sloja)), url("bilder/hero-ekonomi.jpg");',
    'background-size: cover;',
    'background-position: 35% 50%;'
  ]) {
    assert.ok(block.includes(required), `.hero saknar ${required}`);
  }
  assert.equal(block.includes('repeating-linear-gradient'), false, '.hero har repeating-linear-gradient');
  for (const [file, text] of [
    ['landning.css', landning],
    ['tema.css', tema]
  ]) {
    for (const name of ['--hero-fran', '--hero-till', '--rutnat']) {
      assert.equal(text.includes(name), false, `${file} innehåller ${name}`);
    }
  }
});
