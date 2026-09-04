/**
 * Regenerate src/crimson-text-metrics.json from the Crimson Text TTF.
 *
 *   npm i --no-save opentype.js
 *   curl -sLO https://raw.githubusercontent.com/google/fonts/main/ofl/crimsontext/CrimsonText-Regular.ttf
 *   node tools/gen-metrics.mjs CrimsonText-Regular.ttf
 *
 * Only advance widths are needed, so the committed JSON is ~1.7 KB and the
 * updater never has to ship or parse a font at runtime. Google Slides serves
 * "Crimson Text" from Google Fonts, so these metrics are the ones it lays out
 * with -- verified against a real render by tools/verify-layout.mjs.
 */
import opentype from "opentype.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const src = process.argv[2];
if (!src) {
  console.error("usage: node tools/gen-metrics.mjs <CrimsonText-Regular.ttf>");
  process.exit(1);
}
const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)), "..", "src", "crimson-text-metrics.json"
);

const font = opentype.parse(fs.readFileSync(src).buffer);
const upm = font.unitsPerEm;

let chars = "";
for (let c = 0x20; c <= 0x7e; c++) chars += String.fromCharCode(c);
chars += "‘’“”–—… éèñüáíóúçöäÉÖ";   // curly quotes, dashes, ellipsis, accents

const advances = {};
for (const ch of chars) {
  const g = font.charToGlyph(ch);
  if (!g || g.index === 0) continue;   // .notdef; runtime uses fallbackAdvance
  advances[ch] = +(g.advanceWidth / upm).toFixed(6);
}

// Cap height and descender depth drive the optical balance of the headline
// scrim: the eye reads a text block as spanning cap-top to last baseline, with
// descenders hanging into the lower padding.
const os2 = font.tables.os2 || {};
const capHeight = os2.sCapHeight || font.charToGlyph("H").getBoundingBox().y2;
const descInk = Math.min(...[..."gjpqy"].map((c) => font.charToGlyph(c).getBoundingBox().y1));
const ascInk = Math.max(...[..."bdfhklt"].map((c) => font.charToGlyph(c).getBoundingBox().y2));

fs.writeFileSync(out, JSON.stringify({
  family: "Crimson Text",
  weight: 400,
  unitsPerEm: upm,
  ascender: +(font.ascender / upm).toFixed(6),
  descender: +(font.descender / upm).toFixed(6),
  capHeight: +(capHeight / upm).toFixed(6),
  descenderInk: +(Math.abs(descInk) / upm).toFixed(6),
  ascenderInk: +(ascInk / upm).toFixed(6),
  fallbackAdvance: +(font.charToGlyph("n").advanceWidth / upm).toFixed(6),
  advances,
}));
console.log(`${Object.keys(advances).length} glyphs -> ${out} (${fs.statSync(out).size} bytes)`);
console.log(`cap ${(capHeight/upm).toFixed(4)}em  ascInk ${(ascInk/upm).toFixed(4)}em  descInk ${(Math.abs(descInk)/upm).toFixed(4)}em  asc ${(font.ascender/upm).toFixed(4)}  desc ${(font.descender/upm).toFixed(4)}`);
