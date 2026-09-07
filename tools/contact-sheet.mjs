/**
 * Render the 18 article slides as one contact sheet, so the deck can be judged
 * as the set it actually plays as rather than one slide at a time.
 *
 *   GOOGLE_KEY_FILE=... node tools/contact-sheet.mjs [out.png] [slideWidth]
 */
import { PNG } from "pngjs";
import fs from "node:fs";
import { presentationsGet, pageThumbnail } from "../src/google.mjs";
import { PRESENTATION_ID, FIRST_ARTICLE_SLIDE, ARTICLE_SLIDE_COUNT } from "../src/slides.mjs";
import { resampleRGBA, compositeOver } from "../src/image.mjs";

const OUT = process.argv[2] ?? "contact-sheet.png";
const CELL_W = Number(process.argv[3] ?? 224);
const CELL_H = Math.round((CELL_W * 1920) / 1080);
const COLS = 6;                      // 6 x 3 fills exactly 18 cells
const GAP = 12;
const PAD = 16;
const ROWS = Math.ceil(ARTICLE_SLIDE_COUNT / COLS);

const deck = await presentationsGet(PRESENTATION_ID);

const sheet = new PNG({
  width: PAD * 2 + COLS * CELL_W + (COLS - 1) * GAP,
  height: PAD * 2 + ROWS * CELL_H + (ROWS - 1) * GAP,
});
for (let i = 0; i < sheet.data.length; i += 4) {
  sheet.data[i] = 0xf2; sheet.data[i + 1] = 0xf2; sheet.data[i + 2] = 0xef; sheet.data[i + 3] = 255;
}

for (let n = 0; n < ARTICLE_SLIDE_COUNT; n++) {
  const slide = deck.slides[FIRST_ARTICLE_SLIDE + n];
  if (!slide) break;
  const { contentUrl } = await pageThumbnail(PRESENTATION_ID, slide.objectId);
  const src = PNG.sync.read(Buffer.from(await (await fetch(contentUrl)).arrayBuffer()));
  const cell = resampleRGBA(src, CELL_W, CELL_H);
  const col = n % COLS, row = Math.floor(n / COLS);
  compositeOver(
    sheet, cell,
    PAD + col * (CELL_W + GAP),
    PAD + row * (CELL_H + GAP)
  );
  process.stdout.write(`\rslide ${FIRST_ARTICLE_SLIDE + n + 1} …`);
}

const buf = PNG.sync.write(sheet, { colorType: 2 });
fs.writeFileSync(OUT, buf);
console.log(`\n${OUT}  ${sheet.width}x${sheet.height}  ${(buf.length / 1024 / 1024).toFixed(1)}MB`);
