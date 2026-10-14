// Loggan och faviconen (ARKITEKTUR.md del 8, kravlista [logga]). Ingen server
// och inga tidsgränser: filen läser filer från disk. Punkterna som kräver en
// server, (H6) till (H8), står i tests/server.test.js.

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SRC_DIR = fileURLToPath(new URL('../src/', import.meta.url));
const IMAGE_DIR = fileURLToPath(new URL('../src/web/bilder/', import.meta.url));
const LANDNING_HTML_PATH = fileURLToPath(new URL('../src/web/landning.html', import.meta.url));
const INDEX_HTML_PATH = fileURLToPath(new URL('../src/web/index.html', import.meta.url));
const LANDNING_CSS_PATH = fileURLToPath(new URL('../src/web/landning.css', import.meta.url));
const STYLE_CSS_PATH = fileURLToPath(new URL('../src/web/style.css', import.meta.url));
const TEMA_CSS_PATH = fileURLToPath(new URL('../src/web/tema.css', import.meta.url));

// Led 3:s attributmönster (ARKITEKTUR.md, "Kaskadspärren [hero-kaskad]").
const ATTRIBUTE_PATTERN = /([^\s=\/>"']+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>]+))/g;

function attributeValue(match) {
  return match[2] ?? match[3] ?? match[4];
}

// --- (L1) ---------------------------------------------------------------

const SVG_FILES = [
  {
    name: 'hem-ekonomi-logga.svg',
    openingTag:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428.38 104" width="428" height="104">',
    fills: ['#0B2C63', '#4A5875', '#E3A21A', '#FFFFFF']
  },
  {
    name: 'hem-ekonomi-logga-vit.svg',
    openingTag:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 428.38 104" width="428" height="104">',
    fills: ['#0B2C63', '#D6DEEC', '#E3A21A', '#FFFFFF']
  },
  {
    name: 'hem-ekonomi-ikon.svg',
    openingTag:
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 104.00 104" width="104" height="104">',
    fills: ['#0B2C63', '#E3A21A', '#FFFFFF']
  }
];

const ALLOWED_ATTRIBUTES = Object.freeze({
  svg: ['xmlns', 'viewBox', 'width', 'height'],
  rect: ['x', 'y', 'width', 'height', 'rx', 'fill'],
  path: ['d', 'fill']
});

const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

test('(L1) loggorna i src/web/bilder är användarens svg-filer utan skript eller externa referenser', async () => {
  for (const file of SVG_FILES) {
    const buffer = await fs.readFile(path.join(IMAGE_DIR, file.name));

    // (a) Bara ASCII: fäller en BOM och varje tecken utanför ASCII.
    const firstNonAscii = buffer.findIndex((byte) => byte >= 0x80);
    assert.equal(
      firstNonAscii,
      -1,
      `${file.name}: byte ${firstNonAscii} har värdet ${buffer[firstNonAscii]}, inte under 0x80`
    );
    const text = buffer.toString('latin1');

    // (b) Den öppnande taggen.
    assert.ok(
      text.startsWith(file.openingTag),
      `${file.name} börjar inte med ${file.openingTag}`
    );

    // (c) Slutet.
    assert.match(text, /<\/svg>(\r?\n)?$/, `${file.name} slutar inte med </svg>`);

    // (d) Inga deklarationer, instruktioner eller entiteter.
    for (const forbidden of ['<!', '<?', '&']) {
      assert.equal(text.includes(forbidden), false, `${file.name} innehåller ${forbidden}`);
    }

    // (e) Taggarna.
    const tags = [...text.matchAll(/<(\/?)([^\s>\/]+)([^>]*)>/g)].map((match) => ({
      tag: match[1] + match[2],
      name: match[2],
      attributes: match[3]
    }));
    assert.ok(tags.length >= 2, `${file.name} har färre än två taggar`);
    assert.equal(tags[0].tag, 'svg', `${file.name}: den första taggen är ${tags[0].tag}`);
    assert.equal(tags[tags.length - 1].tag, '/svg', `${file.name}: den sista taggen är ${tags[tags.length - 1].tag}`);
    for (const [index, tag] of tags.slice(1, -1).entries()) {
      assert.ok(
        tag.tag === 'rect' || tag.tag === 'path',
        `${file.name}: tagg ${index + 1} är ${tag.tag}, inte rect eller path`
      );
    }

    // (f) Ingen text utanför taggarna.
    const outside = text.replace(/<(\/?)([^\s>\/]+)([^>]*)>/g, '');
    assert.equal(outside.trim(), '', `${file.name} har text utanför taggarna`);

    // (g) och (h) Attributen.
    const fills = new Set();
    for (const tag of tags) {
      const matches = [...tag.attributes.matchAll(ATTRIBUTE_PATTERN)];
      const rest = tag.attributes.replace(ATTRIBUTE_PATTERN, '');
      assert.match(rest, /^\s*\/?\s*$/, `${file.name}: <${tag.tag}> har en rest utanför attributen: ${rest}`);
      const allowed = tag.tag.startsWith('/') ? [] : ALLOWED_ATTRIBUTES[tag.name];
      for (const match of matches) {
        const name = match[1];
        const value = attributeValue(match);
        assert.ok(
          allowed.includes(name),
          `${file.name}: <${tag.tag}> har attributet ${name}, som inte är tillåtet`
        );
        if (name === 'xmlns') {
          assert.equal(value, SVG_NAMESPACE, `${file.name}: xmlns är ${value}`);
        }
        if (name === 'fill') {
          assert.match(value, /^#[0-9A-F]{6}$/, `${file.name}: fill är ${value}`);
          fills.add(value);
        }
      }
    }

    // (i) Färgerna.
    assert.deepEqual([...fills].sort(), file.fills, `${file.name} har fel fill-värden`);
  }
});

// --- (L2) ---------------------------------------------------------------

function stripHtmlComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, '');
}

function readAttributes(tag) {
  const attributes = {};
  for (const match of tag.replace(/^<[a-zA-Z]+/, '').matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1].toLowerCase()] = attributeValue(match);
  }
  return attributes;
}

function readTags(html, pattern) {
  return [...stripHtmlComments(html).matchAll(pattern)].map((match) => readAttributes(match[0]));
}

function isIcon(attributes) {
  return typeof attributes.rel === 'string' && attributes.rel.toLowerCase().split(/\s+/).includes('icon');
}

test('(L2) sidorna pekar ut rätt logga, med bildens egen storlek, och faviconen är ikonen', async () => {
  const landning = await fs.readFile(LANDNING_HTML_PATH, 'utf8');
  const index = await fs.readFile(INDEX_HTML_PATH, 'utf8');

  // (a)
  assert.deepEqual(readTags(landning, /<img\b[^>]*>/gi), [
    {
      class: 'markessymbol',
      src: '/bilder/hem-ekonomi-logga.svg',
      alt: '',
      width: '428',
      height: '104',
      decoding: 'async'
    },
    {
      class: 'markessymbol',
      src: '/bilder/hem-ekonomi-logga-vit.svg',
      alt: '',
      width: '428',
      height: '104',
      decoding: 'async'
    }
  ]);

  // (b)
  assert.deepEqual(readTags(index, /<img\b[^>]*>/gi), [
    {
      class: 'sidomeny-logga',
      src: '/bilder/hem-ekonomi-logga.svg',
      alt: '',
      width: '428',
      height: '104',
      decoding: 'async'
    }
  ]);

  // (c)
  assert.deepEqual(readTags(landning, /<link\b[^>]*>/gi).filter(isIcon), [
    { rel: 'icon', href: '/bilder/hem-ekonomi-ikon.svg', type: 'image/svg+xml' }
  ]);
  assert.deepEqual(readTags(index, /<link\b[^>]*>/gi).filter(isIcon), []);
});

// --- (L3) ---------------------------------------------------------------

function normalizeCss(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\s+/g, ' ');
}

function readRules(css) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((match) => [match[1].trim(), match[2].trim()]);
}

test('(L3) loggornas stilregler och plattans token', async () => {
  // (a)
  const landning = normalizeCss(await fs.readFile(LANDNING_CSS_PATH, 'utf8'));
  assert.deepEqual(
    readRules(landning).filter(([selector]) => selector.includes('markes')),
    [
      [
        '.markeslank, .sidfot-marke',
        'display: inline-flex; align-items: center; gap: 0.5rem; text-decoration: none; color: inherit; min-width: 0;'
      ],
      ['.markessymbol', 'height: 2rem; width: auto; flex: none;'],
      [
        '.markeslank .markessymbol',
        'box-sizing: content-box; padding: 0.15rem; border-radius: var(--radie-liten); background: var(--logga-platta);'
      ],
      [
        '.markesnamn',
        'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;'
      ],
      ['.markessymbol', 'height: 2.5rem;']
    ]
  );
  assert.equal(
    landning.split('@media (prefers-color-scheme: dark) { .markeslank .markessymbol {').length - 1,
    1,
    'landning.css har inte plattan i det mörka läget exakt en gång'
  );

  // (b)
  const style = normalizeCss(await fs.readFile(STYLE_CSS_PATH, 'utf8'));
  assert.deepEqual(
    readRules(style).filter(
      ([selector]) => selector.includes('sidomeny-logga') || selector.includes('sidomeny-namn')
    ),
    [
      [
        '.sidomeny-logga',
        'height: 2.5rem; width: auto; flex: none; padding: 0.2rem; border-radius: var(--radie-liten); background: var(--logga-platta);'
      ],
      [
        '.sidomeny-namn',
        'position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap;'
      ]
    ]
  );

  // (c)
  const tema = normalizeCss(await fs.readFile(TEMA_CSS_PATH, 'utf8'));
  assert.equal(tema.split('--logga-platta:').length - 1, 1, 'tema.css har inte --logga-platta exakt en gång');
  const declaration = tema.indexOf('--logga-platta: #f7f5ef;');
  assert.notEqual(declaration, -1, 'tema.css har inte --logga-platta: #f7f5ef;');
  const dark = tema.indexOf('@media (prefers-color-scheme: dark)');
  assert.notEqual(dark, -1, 'tema.css har inget mörkt läge');
  assert.ok(declaration < dark, '--logga-platta står inte före det mörka läget');
});

// --- (L4) ---------------------------------------------------------------

const REMOVED_LOGOS = ['logga.png', 'logga-liten', 'logga-beskuren'];

test('(L4) ingen fil i src nämner de borttagna png-loggorna', async () => {
  const entries = await fs.readdir(SRC_DIR, { recursive: true });
  const files = entries.filter((entry) => /\.(html|css|js)$/.test(entry));
  assert.ok(
    files.some((entry) => entry.endsWith('.html')),
    `ingen .html-fil lästes under ${SRC_DIR}`
  );
  for (const file of files) {
    // Kommentarerna står kvar: en kommentar som nämner en borttagen fil är en
    // osann uppgift om vad sidan hämtar.
    const text = await fs.readFile(path.join(SRC_DIR, file), 'utf8');
    for (const removed of REMOVED_LOGOS) {
      assert.equal(text.includes(removed), false, `${file} nämner ${removed}`);
    }
  }
});
