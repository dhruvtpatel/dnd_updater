/**
 * Regression test for the typography model in src/layout.mjs.
 *
 * Renders a live article slide, measures the white headline ink inside the
 * scrim, and checks it against what layout.mjs predicted. This is what pins
 * down the two constants that aren't documented anywhere:
 *
 *   - Slides lays out at a 1.20em line height, NOT the font's 1.2998em
 *     ascender+descender. (55pt measured an 88.0px pitch.)
 *   - Usable text width is the box less 0.1in of inset per side, which is the
 *     only value in the bracket implied by the template's real wrap points.
 *
 * Line count is derived from the ink extent rather than by splitting rows into
 * bands: a row-count threshold cuts lines apart at their descenders, so band
 * counting reports phantom extra lines.
 *
 *   GOOGLE_KEY_FILE=... node tools/verify-layout.mjs [slideNumber...]
 */
import { PNG } from "pngjs";
import { presentationsGet, pageThumbnail } from "../src/google.mjs";
import { PRESENTATION_ID, classifySlide } from "../src/slides.mjs";
import * as L from "../src/layout.mjs";

/**
 * Cap-top to descender-bottom for one line of mixed-case Crimson Text,
 * measured off real renders (not the font's nominal 1.2998em line box).
 */
const INK_EM = 0.68;

const deck = await presentationsGet(PRESENTATION_ID);
const wanted = process.argv.slice(2).map(Number);
const slideNos = wanted.length
  ? wanted
  : Array.from({ length: 18 }, (_, i) => i + 2);

let failures = 0;

for (const slideNo of slideNos) {
  const slide = deck.slides[slideNo - 1];
  if (!slide) { console.log(`slide ${slideNo}: not in deck`); failures++; continue; }
  const { headline } = classifySlide(slide);

  const title = (headline.shape?.text?.textElements ?? [])
    .map((t) => t.textRun?.content ?? "").join("").trim();
  const p = L.layoutHeadline(title);

  const boxX = (headline.transform.translateX ?? 0) / L.EMU_PER_PX;
  const boxY = (headline.transform.translateY ?? 0) / L.EMU_PER_PX;
  const boxW = (headline.size.width.magnitude * headline.transform.scaleX) / L.EMU_PER_PX;
  const boxH = (headline.size.height.magnitude * headline.transform.scaleY) / L.EMU_PER_PX;

  const { contentUrl } = await pageThumbnail(PRESENTATION_ID, slide.objectId);
  const png = PNG.sync.read(Buffer.from(await (await fetch(contentUrl)).arrayBuffer()));
  const scale = png.width / L.SLIDE_W;

  // Strictly inside the scrim: behind 41.5%-black a white photo tops out near
  // 149, but a pixel just outside the scrim is a full 255 and reads as text.
  const INSET = 6;
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
  const inked = rows.filter((r) => r.n >= Math.max(6, peak * 0.12));
  if (!inked.length) { console.log(`slide ${slideNo}: no headline ink found`); failures++; continue; }

  const first = inked[0].y / scale;
  const last = inked[inked.length - 1].y / scale;
  const extent = last - first;
  const centre = (first + last) / 2;
  const widest = Math.max(...inked.map((r) => (r.maxx - r.minx) / scale));

  const inkPx = INK_EM * p.sizePt * L.PX_PER_PT;
  const derivedLines = Math.round((extent - inkPx) / p.linePitchPx) + 1;
  const expectedExtent = (p.lineCount - 1) * p.linePitchPx + inkPx;

  const checks = [
    ["line count (from extent)", derivedLines, p.lineCount, 0],
    ["ink extent px", extent, expectedExtent, 12],
    ["ink centre y", centre, L.HEADLINE_CENTER_Y, 14],
    ["box height px", boxH, p.heightPx, 2],
    ["widest line <= usable", widest, boxW - 2 * L.INSET_X_PX, Infinity],
  ];

  const bad = checks.filter(([, got, want, tol]) =>
    tol === Infinity ? !(got <= want) : Math.abs(got - want) > tol);
  failures += bad.length ? 1 : 0;

  console.log(
    `${bad.length ? "FAIL" : "PASS"}  slide ${String(slideNo).padStart(2)}  ` +
    `${p.sizePt}pt/${p.lineCount}L  extent ${extent.toFixed(0)}/${expectedExtent.toFixed(0)}  ` +
    `centre ${centre.toFixed(0)}  widest ${widest.toFixed(0)}  "${title.slice(0, 40)}"`
  );
  for (const [label, got, want, tol] of bad) {
    console.log(`        ${label}: measured ${Number(got).toFixed(2)}, expected ${tol === Infinity ? "<= " : ""}${Number(want).toFixed(2)}`);
  }
}

console.log(`\n${slideNos.length - failures}/${slideNos.length} slides match the layout model`);
process.exit(failures ? 1 : 0);
