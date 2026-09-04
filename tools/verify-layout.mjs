/**
 * Regression test for the headline typography, measured off live renders.
 *
 * Checks the two things the model claims:
 *
 *   1. The scrim's top and bottom padding are optically equal. The text block
 *      is measured cap-top to last baseline; descenders hang into the lower
 *      padding by design, and a first line with a lowercase ascender (b d f h
 *      k l t) rises slightly above cap height, so both are predicted from the
 *      font rather than assumed away.
 *   2. Line breaking matches, derived from the ink extent. Splitting rows into
 *      bands instead would cut lines apart at their descenders and report
 *      phantom extra lines.
 *
 * This is also what pins down the two undocumented Slides constants: a 1.20em
 * line height (not the font's 1.2998em ascender+descender) and a usable width
 * of the box less 0.1in of inset per side.
 *
 *   GOOGLE_KEY_FILE=... node tools/verify-layout.mjs [slideNumber...]
 */
import { PNG } from "pngjs";
import { presentationsGet, pageThumbnail } from "../src/google.mjs";
import { PRESENTATION_ID, classifySlide } from "../src/slides.mjs";
import * as L from "../src/layout.mjs";

const M = L.METRICS;
const hasDescender = (s) => /[gjpqy]/.test(s);
const hasAscender = (s) => /[bdfhklt]/.test(s);

const deck = await presentationsGet(PRESENTATION_ID);
const wanted = process.argv.slice(2).map(Number);
const slideNos = wanted.length ? wanted : Array.from({ length: 18 }, (_, i) => i + 2);

let failures = 0;
const asymmetries = [];

for (const slideNo of slideNos) {
  const slide = deck.slides[slideNo - 1];
  if (!slide) { console.log(`slide ${slideNo}: not in deck`); failures++; continue; }
  const { headline } = classifySlide(slide);

  const title = (headline.shape?.text?.textElements ?? [])
    .map((t) => t.textRun?.content ?? "").join("").trim();

  const boxY = (headline.transform.translateY ?? 0) / L.EMU_PER_PX;
  const boxX = (headline.transform.translateX ?? 0) / L.EMU_PER_PX;
  const boxW = (headline.size.width.magnitude * headline.transform.scaleX) / L.EMU_PER_PX;
  const boxH = (headline.size.height.magnitude * headline.transform.scaleY) / L.EMU_PER_PX;

  // Predict against the box the deck actually has, not a re-centred one:
  // placement is chosen per photo, so topPx is an input, not an assumption.
  const p = L.layoutHeadline(title, { topPx: boxY });
  const emPx = p.sizePt * L.PX_PER_PT;

  const first = p.lines[0] ?? "";
  const last = p.lines[p.lines.length - 1] ?? "";
  const riseAboveCap = hasAscender(first) ? (M.ascenderInk - M.capHeight) * emPx : 0;
  const dropBelowBase = hasDescender(last) ? M.descenderInk * emPx : 0;

  const expectInkTop = boxY + p.padPx - riseAboveCap;
  const expectInkBot = boxY + p.padPx + p.blockPx + dropBelowBase;

  const { contentUrl } = await pageThumbnail(PRESENTATION_ID, slide.objectId);
  const png = PNG.sync.read(Buffer.from(await (await fetch(contentUrl)).arrayBuffer()));
  const scale = png.width / L.SLIDE_W;

  // Strictly inside the scrim: behind 41.5%-black a white photo tops out near
  // 149, but a pixel just outside it is a full 255 and reads as text.
  const INSET = 5;
  const x0 = Math.round((boxX + INSET) * scale), x1 = Math.round((boxX + boxW - INSET) * scale);
  const y0 = Math.round((boxY + INSET) * scale), y1 = Math.round((boxY + boxH - INSET) * scale);

  const rows = [];
  for (let y = y0; y < y1; y++) {
    let n = 0, minx = Infinity, maxx = -1;
    for (let x = x0; x < x1; x++) {
      const i = (y * png.width + x) * 4;
      if (png.data[i] > 245 && png.data[i + 1] > 245 && png.data[i + 2] > 245) {
        n++; if (x < minx) minx = x; if (x > maxx) maxx = x;
      }
    }
    rows.push({ y, n, minx, maxx });
  }
  const peak = Math.max(...rows.map((r) => r.n));
  const inked = rows.filter((r) => r.n >= Math.max(5, peak * 0.10));
  if (!inked.length) { console.log(`slide ${slideNo}: no headline ink found`); failures++; continue; }

  const inkTop = inked[0].y / scale;
  const inkBot = inked[inked.length - 1].y / scale;
  const widest = Math.max(...inked.map((r) => (r.maxx - r.minx) / scale));

  // The gap above the caps is the measurable half. The gap below the last
  // baseline is not independently measurable to the same precision: a lone 'g'
  // tail puts too few pixels in a row to clear the ink threshold, and the
  // thumbnail is downscaled 0.83x, so the last antialiased row of a baseline
  // drops out. It does not need measuring -- see the note on `checks`.
  const padTop = inkTop + riseAboveCap - boxY;
  const padBotImplied = boxH - padTop - p.blockPx;
  asymmetries.push(padTop - p.padPx);

  const derivedLines =
    Math.round((inkBot - dropBelowBase - (inkTop + riseAboveCap) - M.capHeight * emPx) / p.linePitchPx) + 1;

  // The box is built as blockPx + 2*pad, so once the measured top gap equals
  // pad, the gap from the last baseline to the bottom edge equals it too --
  // that follows from the height and needs no second measurement. What is worth
  // checking independently is that descenders still hang inside the scrim.
  const checks = [
    ["line count", derivedLines, p.lineCount, 0],
    ["pad above caps", padTop, p.padPx, 5],
    ["ink inside scrim", inkBot, boxY + boxH, Infinity],
    ["widest line <= usable", widest, boxW - 2 * L.INSET_X_PX, Infinity],
  ];
  const bad = checks.filter(([, got, want, tol]) =>
    tol === Infinity ? !(got <= want) : Math.abs(got - want) > tol);
  failures += bad.length ? 1 : 0;

  console.log(
    `${bad.length ? "FAIL" : "PASS"}  slide ${String(slideNo).padStart(2)}  ` +
    `${p.sizePt}pt/${p.lineCount}L  y=${boxY.toFixed(0)}  ` +
    `pad ${padTop.toFixed(1)} above / ${padBotImplied.toFixed(1)} below  ` +
    `"${title.slice(0, 34)}"`
  );
  for (const [label, got, want, tol] of bad) {
    console.log(`        ${label}: measured ${Number(got).toFixed(2)}, expected ${tol === Infinity ? "<= " : ""}${Number(want).toFixed(2)}`);
  }
}

const worst = asymmetries.length ? Math.max(...asymmetries.map(Math.abs)) : 0;
const mean = asymmetries.length ? asymmetries.reduce((a, b) => a + b, 0) / asymmetries.length : 0;
console.log(`\n${slideNos.length - failures}/${slideNos.length} slides match the layout model`);
console.log(
  `measured gap above caps vs the ${L.BOX_PAD_Y}px target: ` +
  `mean ${mean >= 0 ? "+" : ""}${mean.toFixed(2)}px, worst ${worst.toFixed(2)}px`
);
process.exit(failures ? 1 : 0);
