/**
 * Geometry + typography for the DND article slides.
 *
 * The deck is 1080x1920 px portrait signage (10287000 x 18288000 EMU).
 * Everything here is expressed in slide pixels and converted to EMU at the edge,
 * because the Slides API only lets you resize an existing element through its
 * transform -- there is no updatePageElementSize.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const METRICS = JSON.parse(
  fs.readFileSync(path.join(__dirname, "crimson-text-metrics.json"), "utf8")
);

export const EMU_PER_PX = 9525;

export const SLIDE_W = 1080;
export const SLIDE_H = 1920;

/** The masthead band ends at y=182 and the footer band starts at y=1824. */
export const BODY_TOP = 182;
export const BODY_BOTTOM = 1824;
export const BODY_W = SLIDE_W;
export const BODY_H = BODY_BOTTOM - BODY_TOP; // 1642

/** Headline scrim: matches the hand-built template (913px wide at x=138). */
export const HEADLINE_X = 138;
export const HEADLINE_W = 913;
/**
 * Vertical centre of the scrim. Measured off the template render (slide 14's
 * box centre was 768.2), so boxes grow symmetrically about the same axis
 * instead of drifting the way the old RELATIVE transforms did.
 */
export const HEADLINE_CENTER_Y = 768;

/**
 * Slides renders text at the point size given, independent of the element's
 * transform, and the page is 810pt wide across 1080px.
 */
export const PX_PER_PT = SLIDE_W / 810; // 1.3333

/**
 * Slides lays out at "normal" line height -- 1.20em -- not the font's
 * ascender+descender (1.2998em). Measured: 55pt wrapped at an 88.0px pitch.
 */
export const LINE_HEIGHT_EM = 1.2;

/**
 * Slides puts the FIRST baseline exactly 1.00em below the top of the text
 * block, then steps by LINE_HEIGHT_EM. It is not the font's ascent (0.949em)
 * and not half-leading plus ascent (0.899em) -- both of those predict the wrong
 * top padding. Solved from two independent live renders with different box
 * sizes and different paragraph spacing: 1.0027em and 0.9941em.
 */
export const FIRST_BASELINE_EM = 1.0;

/** Default Slides text insets are 0.1in horizontally, 0.05in vertically. */
export const INSET_X_PX = 9.6;

/**
 * Padding between the text block and the scrim edge, top and bottom.
 *
 * The block is measured cap-top to last baseline, which is what the eye reads
 * as the text's extent — descenders hang into the lower padding. Set to 34 to
 * match the optical weight the hand-built template had.
 */
export const BOX_PAD_Y = 34;

/** Largest first. Only drops a step when the headline would exceed MAX_LINES. */
export const FONT_LADDER = [55, 50, 46, 42, 38];
export const MAX_LINES = 5;

/** The template's translucent-black scrim. */
export const SCRIM_ALPHA = 0.4154;

/** The QR sits at y=1502; the headline must clear it. */
export const QR_TOP = 1502;
/** Keep the scrim off the masthead seam and the QR. */
export const PLACEMENT_MARGIN = 24;

export const pxToEmu = (px) => Math.round(px * EMU_PER_PX);

/** Advance width of a string, in em. */
export function advanceEm(text) {
  let em = 0;
  for (const ch of text) em += METRICS.advances[ch] ?? METRICS.fallbackAdvance;
  return em;
}

/** Advance width of a string in slide px at a given point size. */
export function textWidthPx(text, sizePt) {
  return advanceEm(text) * sizePt * PX_PER_PT;
}

/**
 * Greedy word wrap, matching how Slides breaks lines: on spaces, against the
 * box width less its horizontal insets. A single word wider than the line is
 * left to overflow rather than split, which is what Slides does too.
 */
export function wrapText(text, sizePt, boxWidthPx = HEADLINE_W) {
  const usable = boxWidthPx - 2 * INSET_X_PX;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (cur && textWidthPx(candidate, sizePt) > usable) {
      lines.push(cur);
      cur = word;
    } else {
      cur = candidate;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * Pick the biggest size on the ladder that keeps the headline inside MAX_LINES,
 * then size the scrim so its top and bottom padding are optically equal.
 *
 * Slides centres text vertically with contentAlignment MIDDLE, and where the
 * ink lands inside that centred block is fixed by the font, not by the box —
 * so resizing the box can never equalise the padding on its own. Crimson Text
 * has a tall ascender (0.949em) relative to its cap height (0.641em), which
 * leaves the block sitting low and the gap above the caps visibly larger than
 * the gap below the last baseline. The paragraph's spaceAbove is the only lever
 * that shifts the block within the box, so the correction goes there.
 */
export function layoutHeadline(title, { boxWidthPx = HEADLINE_W, topPx = null } = {}) {
  let sizePt = FONT_LADDER[FONT_LADDER.length - 1];
  let lines = wrapText(title, sizePt, boxWidthPx);
  for (const candidate of FONT_LADDER) {
    const wrapped = wrapText(title, candidate, boxWidthPx);
    if (wrapped.length <= MAX_LINES) {
      sizePt = candidate;
      lines = wrapped;
      break;
    }
  }

  const emPx = sizePt * PX_PER_PT;
  const linePitchPx = emPx * LINE_HEIGHT_EM;

  // Cap-top of the first line to the baseline of the last.
  const blockPx = (lines.length - 1) * linePitchPx + METRICS.capHeight * emPx;
  const heightPx = blockPx + 2 * BOX_PAD_Y;

  // Shift that centres the cap-to-baseline block in the box. Solving
  //   padTop = padBottom  for the shift S gives  S = L - (2*FB - cap)*em,
  // which is negative for Crimson Text -- the block needs to move up, so it
  // lands on spaceBelow rather than spaceAbove.
  const balancePx = (LINE_HEIGHT_EM - 2 * FIRST_BASELINE_EM + METRICS.capHeight) * emPx;

  const height = heightPx;
  const top = topPx ?? HEADLINE_CENTER_Y - height / 2;

  return {
    sizePt,
    lines,
    lineCount: lines.length,
    linePitchPx,
    blockPx,
    heightPx: height,
    balancePt: balancePx / PX_PER_PT,
    padPx: BOX_PAD_Y,
    topPx: top,
    widthPx: boxWidthPx,
    leftPx: HEADLINE_X,
  };
}

/**
 * Where a scrim of this height is allowed to sit: below the masthead seam,
 * clear of the QR block.
 */
export function placementRange(heightPx) {
  const minTop = BODY_TOP + PLACEMENT_MARGIN;
  const maxTop = QR_TOP - PLACEMENT_MARGIN - heightPx;
  if (maxTop < minTop) {
    const mid = (BODY_TOP + QR_TOP) / 2 - heightPx / 2;
    return { minTop: mid, maxTop: mid, clamped: true };
  }
  return { minTop, maxTop, clamped: false };
}

/**
 * An ABSOLUTE transform that renders `elementBaseSize` at exactly
 * targetW x targetH px, positioned at (targetX, targetY).
 *
 * ABSOLUTE matters: the old code used applyMode RELATIVE, so every run
 * multiplied the previous run's scale. Re-running was not idempotent.
 */
export function absoluteTransform(baseSize, targetX, targetY, targetW, targetH) {
  const baseW = baseSize.width.magnitude;
  const baseH = baseSize.height.magnitude;
  if (!baseW || !baseH) throw new Error("element has no base size");
  return {
    scaleX: pxToEmu(targetW) / baseW,
    scaleY: pxToEmu(targetH) / baseH,
    translateX: pxToEmu(targetX),
    translateY: pxToEmu(targetY),
    unit: "EMU",
  };
}
