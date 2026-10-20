import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  attributeMap,
  contrast,
  hueSaturation,
  isGreen,
  parseHex,
  readThemes,
  resolveToken,
  stripCssComments
} from './helpers/tema.js';

const TEMA_PATH = fileURLToPath(new URL('../src/web/tema.css', import.meta.url));
const WEB_DIR = fileURLToPath(new URL('../src/web/', import.meta.url));

const THEME_PATTERN =
  /^\s*:root\s*\{([^{}]*)\}\s*@media \(prefers-color-scheme: dark\)\s*\{\s*:root\s*\{([^{}]*)\}\s*\}\s*$/;
const DECLARATION_PATTERN = /(--[a-z0-9-]+)\s*:\s*([^;{}]+);/g;
const HEX_PATTERN = /#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi;
const COLOR_FUNCTION_PATTERN = /\b(rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|light-dark)\s*\(/i;

async function cssFiles() {
  const names = await fs.readdir(WEB_DIR, { recursive: true });
  return names
    .filter((name) => name.endsWith('.css'))
    .map((name) => ({ name: name.split(path.sep).join('/'), file: path.join(WEB_DIR, name) }));
}

const CONTRAST_ROWS = [
  ['FK01', 'ljust', '--text', '--bakgrund', 4.5, '16,41'],
  ['FK02', 'ljust', '--text', '--yta', 4.5, '17,89'],
  ['FK03', 'ljust', '--text', '--yta-mjuk', 4.5, '15,82'],
  ['FK04', 'ljust', '--text-svag', '--yta', 4.5, '7,13'],
  ['FK05', 'ljust', '--text-svag', '--bakgrund', 4.5, '6,54'],
  ['FK06', 'ljust', '--text-svag', '--yta-mjuk', 4.5, '6,30'],
  ['FK07', 'ljust', '--lank', '--yta', 4.5, '10,13'],
  ['FK08', 'ljust', '--lank', '--bakgrund', 4.5, '9,29'],
  ['FK09', 'ljust', '--lank', '--yta-mjuk', 4.5, '8,95'],
  ['FK10', 'ljust', '--lank-hover', '--yta', 4.5, '7,81'],
  ['FK11', 'ljust', '--positiv', '--yta', 4.5, '5,67'],
  ['FK12', 'ljust', '--positiv', '--bakgrund', 4.5, '5,20'],
  ['FK13', 'ljust', '--negativ', '--yta', 4.5, '7,43'],
  ['FK14', 'ljust', '--negativ', '--bakgrund', 4.5, '6,81'],
  ['FK15', 'ljust', '--fel-text', '--yta', 4.5, '7,43'],
  ['FK16', 'ljust', '--fel-text', '--bakgrund', 4.5, '6,81'],
  ['FK17', 'ljust', '--knapp-fylld-text', '--knapp-fylld-yta', 4.5, '10,13'],
  ['FK18', 'ljust', '--knapp-fylld-text', '--knapp-fylld-yta-hover', 4.5, '7,81'],
  ['FK19', 'ljust', '--knapp-kontur-text', '--bakgrund', 4.5, '9,29'],
  ['FK20', 'ljust', '--knapp-guld-text', '--knapp-guld-yta', 4.5, '6,08'],
  ['FK21', 'ljust', '--knapp-guld-text', '--knapp-guld-yta-hover', 4.5, '5,17'],
  ['FK22', 'ljust', '--ikon-grabla', '--yta', 4.5, '7,13'],
  ['FK23', 'ljust', '--ikon-grabla', '--yta-mjuk', 3, '6,30'],
  ['FK24', 'ljust', '--ikon-bla', '--yta', 3, '10,13'],
  ['FK25', 'ljust', '--ikon-bla', '--yta-mjuk', 3, '8,95'],
  ['FK26', 'ljust', '--ikon-bla', '--kant', 3, '7,10'],
  ['FK27', 'ljust', '--guld-grafik', '--yta', 3, '4,44'],
  ['FK28', 'ljust', '--guld-grafik', '--bakgrund', 3, '4,07'],
  ['FK29', 'ljust', '--guld-grafik', '--kant', 3, '3,11'],
  ['FK30', 'ljust', '--text-pa-mork', '--morkt-block', 4.5, '12,39'],
  ['FK31', 'ljust', '--text-svag-pa-mork', '--morkt-block', 4.5, '9,98'],
  ['FK32', 'ljust', '--guld', '--morkt-block', 3, '6,08'],
  ['FK33', 'ljust', '--guld-ljus', '--morkt-block', 4.5, '11,34'],
  ['FK34', 'mörkt', '--text', '--bakgrund', 4.5, '12,39'],
  ['FK35', 'mörkt', '--text', '--yta', 4.5, '9,83'],
  ['FK36', 'mörkt', '--text', '--yta-upphojd', 4.5, '8,66'],
  ['FK37', 'mörkt', '--text', '--yta-mjuk', 4.5, '11,05'],
  ['FK38', 'mörkt', '--text-svag', '--yta', 4.5, '7,92'],
  ['FK39', 'mörkt', '--text-svag', '--yta-upphojd', 4.5, '6,98'],
  ['FK40', 'mörkt', '--text-svag', '--yta-mjuk', 4.5, '8,90'],
  ['FK41', 'mörkt', '--text-svag', '--bakgrund', 4.5, '9,98'],
  ['FK42', 'mörkt', '--lank', '--yta', 4.5, '5,70'],
  ['FK43', 'mörkt', '--lank', '--yta-upphojd', 4.5, '5,02'],
  ['FK44', 'mörkt', '--lank', '--yta-mjuk', 4.5, '6,40'],
  ['FK45', 'mörkt', '--lank', '--bakgrund', 4.5, '7,18'],
  ['FK46', 'mörkt', '--positiv', '--yta', 4.5, '5,53'],
  ['FK47', 'mörkt', '--positiv', '--bakgrund', 4.5, '6,97'],
  ['FK48', 'mörkt', '--negativ', '--yta', 4.5, '5,35'],
  ['FK49', 'mörkt', '--negativ', '--bakgrund', 4.5, '6,75'],
  ['FK50', 'mörkt', '--fel-text', '--yta', 4.5, '5,35'],
  ['FK51', 'mörkt', '--fel-text', '--bakgrund', 4.5, '6,75'],
  ['FK52', 'mörkt', '--knapp-fylld-text', '--knapp-fylld-yta', 4.5, '5,67'],
  ['FK53', 'mörkt', '--knapp-fylld-text', '--knapp-fylld-yta-hover', 4.5, '7,81'],
  ['FK54', 'mörkt', '--knapp-kontur-text', '--bakgrund', 4.5, '7,18'],
  ['FK55', 'mörkt', '--knapp-guld-text', '--knapp-guld-yta', 4.5, '6,08'],
  ['FK56', 'mörkt', '--knapp-guld-text', '--knapp-guld-yta-hover', 4.5, '5,17'],
  ['FK57', 'mörkt', '--ikon-grabla', '--yta', 4.5, '7,11'],
  ['FK58', 'mörkt', '--ikon-grabla', '--yta-upphojd', 3, '6,27'],
  ['FK59', 'mörkt', '--ikon-grabla', '--yta-mjuk', 3, '8,00'],
  ['FK60', 'mörkt', '--ikon-bla', '--yta', 3, '5,70'],
  ['FK61', 'mörkt', '--ikon-bla', '--yta-upphojd', 3, '5,02'],
  ['FK62', 'mörkt', '--ikon-bla', '--yta-mjuk', 3, '6,40'],
  ['FK63', 'mörkt', '--ikon-bla', '--kant', 3, '4,35'],
  ['FK64', 'mörkt', '--guld-grafik', '--yta', 3, '4,82'],
  ['FK65', 'mörkt', '--guld-grafik', '--yta-upphojd', 3, '4,25'],
  ['FK66', 'mörkt', '--guld-grafik', '--kant', 3, '3,68'],
  ['FK67', 'mörkt', '--ikon-guld', '--yta', 3, '8,99'],
  ['FK68', 'mörkt', '--text-pa-mork', '--morkt-block', 4.5, '12,39'],
  ['FK69', 'mörkt', '--text-svag-pa-mork', '--morkt-block', 4.5, '9,98'],
  ['FK70', 'mörkt', '--guld', '--morkt-block', 3, '6,08'],
  ['FK71', 'mörkt', '--guld-ljus', '--morkt-block', 4.5, '11,34']
];

const CONTRAST_UNTESTED = ['2,22'];

test('(FA1) varje rad i kontrasttabellen når sitt krav och har det uppmätta värdet, i båda lägena', async (t) => {
  const raw = await fs.readFile(TEMA_PATH, 'utf8');
  const { lightTokens, darkTokens } = readThemes(raw);
  for (const [id, mode, fgName, bgName, required, measured] of CONTRAST_ROWS) {
    const tokens = mode === 'ljust' ? lightTokens : darkTokens;
    const fg = parseHex(resolveToken(tokens, fgName, mode), `${mode}: ${fgName}`);
    const bg = parseHex(resolveToken(tokens, bgName, mode), `${mode}: ${bgName}`);
    const pair = `${id} (${mode}): ${fgName} ${fg.hex} på ${bgName} ${bg.hex}`;
    assert.equal(fg.hasAlpha, false, `${pair}: förgrunden är inte ogenomskinlig`);
    assert.equal(bg.hasAlpha, false, `${pair}: bakgrunden är inte ogenomskinlig`);
    const ratio = Math.max(contrast(fg, bg), contrast(bg, fg));
    const shown = ratio.toFixed(2).replace('.', ',');
    t.diagnostic(`${pair} ${shown}:1`);
    assert.ok(ratio >= required, `${pair} ger ${ratio}, under kravet ${required}`);
    assert.equal(shown, measured, `${pair} ger ${shown}:1, tabellen säger ${measured}:1`);
  }

  const known = new Set([...CONTRAST_ROWS.map((row) => row[5]), ...CONTRAST_UNTESTED]);
  for (const match of raw.matchAll(/(\d+,\d\d):1/g)) {
    assert.ok(known.has(match[1]), `tema.css nämner ${match[1]}:1, som inte är ett tal i kontrasttabellen`);
  }
});

const FONT_STACK =
  "'Inter', 'Plus Jakarta Sans', system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const VALUE_WORD_PATTERN = /^(#[0-9a-f]{3}|#[0-9a-f]{4}|#[0-9a-f]{6}|#[0-9a-f]{8}|-?\d+(\.\d+)?(px|rem|em|%)?)$/i;

const GREEN_CASES = [
  ['#edf3ec', true],
  ['#e3f0e0', true],
  ['#9acd32', true],
  ['#2E8B57', true],
  ['#3a5', true],
  ['#22aa5580', true],
  ['#feed7e', false],
  ['#808000', false],
  ['#1aa3a3', false]
];

test('(FA2) ingen färg i tema.css är grön, i något av lägena, och varje värde har en tillåten form', async () => {
  const text = stripCssComments(await fs.readFile(TEMA_PATH, 'utf8'));

  const theme = THEME_PATTERN.exec(text);
  assert.ok(theme, 'tema.css består inte av exakt ett ljust och ett mörkt :root');
  for (const [mode, body] of [['ljust läge', theme[1]], ['mörkt läge', theme[2]]]) {
    const declarations = [...body.matchAll(DECLARATION_PATTERN)];
    const rest = body.replace(DECLARATION_PATTERN, '').trim();
    assert.equal(rest, '', `${mode}: texten "${rest}" är ingen deklaration`);
    const seen = new Set();
    for (const [, name, value] of declarations) {
      assert.ok(!seen.has(name), `${mode}: ${name} deklareras två gånger`);
      seen.add(name);

      const collapsed = value.trim().replace(/\s+/g, ' ');
      const allowed =
        /^var\(--[a-z0-9-]+\)$/.test(collapsed) ||
        (name === '--typsnitt' && collapsed === FONT_STACK) ||
        collapsed.split(',').every((part) => part.trim().split(' ').every((word) => VALUE_WORD_PATTERN.test(word)));
      assert.ok(allowed, `${mode}: ${name} har värdet "${collapsed}", som inte har en tillåten form`);
    }
  }

  for (const [hex] of text.matchAll(HEX_PATTERN)) {
    const { hue, s } = hueSaturation(hex);
    assert.equal(isGreen(hex), false, `${hex} är grön: nyans ${hue}, mättnad ${s}`);
  }

  const fn = COLOR_FUNCTION_PATTERN.exec(text);
  assert.equal(fn, null, `tema.css har färgfunktionen ${fn?.[0]}`);

  for (const [hex, green] of GREEN_CASES) {
    assert.equal(isGreen(hex), green, `isGreen(${hex}) ska vara ${green}`);
  }
});

test('(FA3) varje var(--namn) i src/web är deklarerad i tema.css eller i samma fil', async () => {
  const tema = stripCssComments(await fs.readFile(TEMA_PATH, 'utf8'));
  const theme = THEME_PATTERN.exec(tema);
  assert.ok(theme, 'tema.css består inte av exakt ett ljust och ett mörkt :root');
  const light = new Set([...theme[1].matchAll(DECLARATION_PATTERN)].map((match) => match[1]));
  const files = await cssFiles();
  assert.ok(files.length >= 3, `bara ${files.length} .css-filer lästes under src/web`);
  for (const { name, file } of files) {
    const css = stripCssComments(await fs.readFile(file, 'utf8'));
    const own = new Set([...css.matchAll(/(--[a-zA-Z0-9_-]+)\s*:/g)].map((match) => match[1]));
    for (const match of css.matchAll(/var\(\s*(--[a-zA-Z0-9_-]+)/gi)) {
      assert.ok(
        light.has(match[1]) || own.has(match[1]),
        `${name} läser ${match[1]}, som inte är deklarerad i det ljusa :root i tema.css eller i ${name}`
      );
    }
  }
});

const GREEN_NAME_PATTERN =
  /\b[a-z-]*(green|lime|olive|teal|mint|honeydew|chartreuse|aquamarine|turquoise)[a-z-]*\b/i;
const COLOR_PROPERTY_PATTERN =
  /^(color|background|fill|stroke|border|border-(top|right|bottom|left)|outline|box-shadow|text-shadow|column-rule|text-decoration)$|-color$/;
const MEASURE_PATTERN = /^-?\d+(\.\d+)?(px|rem|em|%)?$/;
const COLOR_KEYWORDS = [
  'solid',
  'dashed',
  'dotted',
  'none',
  'transparent',
  'inherit',
  'currentcolor',
  'underline',
  'initial',
  'unset'
];

test('(FA4) ingen stilmall i src/web utom tema.css har en egen färg', async () => {
  const files = (await cssFiles()).filter(({ name }) => name !== 'tema.css');
  assert.ok(files.length >= 2, `bara ${files.length} .css-filer utom tema.css lästes under src/web`);
  for (const { name, file } of files) {
    const css = stripCssComments(await fs.readFile(file, 'utf8'));
    for (const [, body] of css.matchAll(/\{([^{}]*)\}/g)) {
      const hex = body.match(HEX_PATTERN);
      assert.equal(hex, null, `${name} har hexkoden ${hex?.[0]} i en regel`);
      const fn = COLOR_FUNCTION_PATTERN.exec(body);
      assert.equal(fn, null, `${name} har färgfunktionen ${fn?.[0]} i en regel`);
      const green = GREEN_NAME_PATTERN.exec(body);
      assert.equal(green, null, `${name} har färgnamnet ${green?.[0]} i en regel`);
      for (const part of body.split(';')) {
        const declaration = /^\s*([a-zA-Z-]+)\s*:\s*([\s\S]*)$/.exec(part);
        if (declaration === null) {
          continue;
        }
        const property = declaration[1].toLowerCase();
        if (property.startsWith('--') || !COLOR_PROPERTY_PATTERN.test(property)) {
          continue;
        }
        for (const word of declaration[2].toLowerCase().trim().split(/[\s,]+/)) {
          assert.ok(
            /^var\(--[a-z0-9-]+\)$/.test(word) || MEASURE_PATTERN.test(word) || COLOR_KEYWORDS.includes(word),
            `${name}: ${property} har ordet ${word}, som varken är en var(), ett mått eller ett tillåtet ord`
          );
        }
      }
    }
  }
});

const SV_CLASSES = [
  'sv-fyll-bla',
  'sv-fyll-grabla',
  'sv-fyll-guld',
  'sv-linje-bla',
  'sv-linje-grabla',
  'sv-linje-guld',
  'sv-linje-text'
];

test('(FA5) varje sv-klass i landning.html har en egen regel med fill eller stroke i landning.css', async () => {
  const html = (await fs.readFile(path.join(WEB_DIR, 'landning.html'), 'utf8')).replace(/<!--[\s\S]*?-->/g, '');
  const css = stripCssComments(await fs.readFile(path.join(WEB_DIR, 'landning.css'), 'utf8'));
  const words = new Set();
  for (const [, , attributes] of html.matchAll(/<([a-z]+)\b([^>]*)>/gi)) {
    const classes = /\sclass\s*=\s*"([^"]*)"/i.exec(attributes);
    if (classes === null) {
      continue;
    }
    for (const word of classes[1].split(/\s+/)) {
      if (word.startsWith('sv-')) {
        words.add(word);
      }
    }
  }
  const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => [selector.trim(), body]);
  for (const word of words) {
    const own = rules.filter(([selector, body]) => selector === `.${word}` && /(^|[\s;])(fill|stroke)\s*:/.test(body));
    assert.ok(own.length > 0, `landning.html använder ${word}, men landning.css har ingen egen regel .${word} med fill eller stroke`);
  }
  assert.deepEqual([...words].sort(), SV_CLASSES, 'landning.html använder inte exakt de väntade sv-klasserna');
});

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));

test('(FA6) ingen fil i src nämner grönt', async () => {
  const names = (await fs.readdir(SRC_DIR, { recursive: true })).filter((name) => /\.(html|css|js)$/.test(name));
  assert.ok(names.some((name) => name.endsWith('.html')), 'ingen .html-fil lästes under src');
  for (const name of names) {
    const text = await fs.readFile(path.join(SRC_DIR, name), 'utf8');
    text.split('\n').forEach((line, index) => {
      assert.ok(!/gr[öo]n/i.test(line), `src/${name.split(path.sep).join('/')} rad ${index + 1}: ${line.trim()}`);
    });
  }
});

const PAGES = [
  ['landning.html', ['/tema.css', '/landning.css']],
  ['index.html', ['/tema.css', '/style.css']]
];

test('(FA7) landning.html och index.html har ingen egen färg och laddar bara sina stilmallar', async () => {
  for (const [name, stylesheets] of PAGES) {
    const html = await fs.readFile(path.join(WEB_DIR, name), 'utf8');
    const style = /<style\b/i.exec(html);
    assert.equal(style, null, `${name} har ett <style>-element`);
    const attribute = /\s(fill|stroke|color|bgcolor|stop-color|flood-color|lighting-color|style)\s*=/i.exec(html);
    assert.equal(attribute, null, `${name} har attributet ${attribute?.[1]}`);
    const hex = html.match(/(?<!&)#([0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{4}|[0-9a-f]{3})\b/gi);
    assert.equal(hex, null, `${name} har hexkoden ${hex?.[0]}`);
    const hrefs = [];
    for (const [tag] of html.replace(/<!--[\s\S]*?-->/g, '').matchAll(/<link\b[^>]*>/gi)) {
      const attributes = attributeMap(tag);
      const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      if (rel.includes('stylesheet')) {
        hrefs.push(attributes.get('href'));
      }
    }
    assert.deepEqual(hrefs, stylesheets, `${name} laddar stilmallarna ${hrefs.join(', ')}`);
  }
});

test('(FA8) varje kontrasttal i kommentarerna i style.css och landning.css är ett tal ur kontrasttabellen', async () => {
  const known = new Set([...CONTRAST_ROWS.map((row) => row[5]), ...CONTRAST_UNTESTED]);
  for (const name of ['style.css', 'landning.css']) {
    const raw = await fs.readFile(path.join(WEB_DIR, name), 'utf8');
    for (const match of raw.matchAll(/(\d+,\d\d):1/g)) {
      assert.ok(known.has(match[1]), `${name} nämner ${match[1]}:1, som inte är ett tal i kontrasttabellen`);
    }
  }
});
