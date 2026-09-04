/**
 * Decides where the headline goes on each slide, by looking at the photo.
 *
 * The scrim is readable wherever the picture behind it is dark, even and free
 * of blowouts, and unreadable over a bright busy patch — so rather than pinning
 * the headline at a fixed height on every slide, we score every position it
 * could legally sit at and take the best one.
 *
 * Only the part of the photo the slide actually shows is scored: the centre
 * 43.8% that survives the crop, and only the horizontal span the scrim covers.
 */

import jpeg from "jpeg-js";
import { PNG } from "pngjs";
import * as L from "./layout.mjs";

/** Rec. 601 luma, which tracks perceived brightness closely enough here. */
const luma = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

/** What "bright enough to fight white text through the scrim" means. */
const BRIGHT = 195;

/** Scoring weights. Mean brightness dominates; blowouts and busyness follow. */
export const WEIGHTS = {
  mean: 0.45,
  bright: 0.30,
  rough: 0.25,
  /**
   * A mild pull back toward the template's 40% line, so the headline only
   * moves when there is a real legibility gain — otherwise it would wander
   * between slides and the rotation would lose its rhythm.
   */
  drift: 0.10,
};

/** Roughness (mean absolute horizontal luma step) that counts as fully busy. */
const ROUGH_FULL = 30;

export async function fetchImage(url) {
  const res = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (compatible; dnd-updater)" },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`image HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: png.data };
  }
  const img = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true });
  return { width: img.width, height: img.height, data: img.data };
}

/**
 * The region of the source image the slide shows, given that the photo is
 * cover-cropped into the 1080x1642 photo slot.
 */
export function cropRegion(width, height) {
  const target = L.BODY_W / L.BODY_H;
  const src = width / height;
  if (src > target) {
    const keep = target / src;
    return { x: Math.round((width * (1 - keep)) / 2), y: 0, w: Math.round(width * keep), h: height };
  }
  const keep = src / target;
  return { x: 0, y: Math.round((height * (1 - keep)) / 2), w: width, h: Math.round(height * keep) };
}

/**
 * Per-source-row statistics across the scrim's horizontal span. Computed once,
 * so scoring a candidate position is just an average over its rows rather than
 * a fresh pass over the pixels.
 */
export function rowProfiles(img, crop) {
  const x0 = crop.x + Math.round((L.HEADLINE_X / L.SLIDE_W) * crop.w);
  const x1 = crop.x + Math.round(((L.HEADLINE_X + L.HEADLINE_W) / L.SLIDE_W) * crop.w);
  const lo = Math.max(0, Math.min(x0, img.width - 2));
  const hi = Math.max(lo + 2, Math.min(x1, img.width));

  const mean = new Float32Array(crop.h);
  const bright = new Float32Array(crop.h);
  const rough = new Float32Array(crop.h);

  for (let i = 0; i < crop.h; i++) {
    const y = crop.y + i;
    let sum = 0, nBright = 0, dSum = 0, n = 0;
    let prev = null;
    for (let x = lo; x < hi; x++) {
      const p = (y * img.width + x) * 4;
      const v = luma(img.data[p], img.data[p + 1], img.data[p + 2]);
      sum += v;
      if (v > BRIGHT) nBright++;
      if (prev !== null) dSum += Math.abs(v - prev);
      prev = v;
      n++;
    }
    mean[i] = sum / n;
    bright[i] = nBright / n;
    rough[i] = dSum / Math.max(1, n - 1);
  }
  return { mean, bright, rough, rows: crop.h, xRange: [lo, hi] };
}

/** Slide y (in the photo slot) -> index into the row profiles. */
const rowAt = (slideY, crop) =>
  Math.round(((slideY - L.BODY_TOP) / L.BODY_H) * crop.h);

function scoreBand(prof, crop, topPx, heightPx) {
  const a = Math.max(0, Math.min(prof.rows - 1, rowAt(topPx, crop)));
  const b = Math.max(a + 1, Math.min(prof.rows, rowAt(topPx + heightPx, crop)));
  let mean = 0, bright = 0, rough = 0;
  for (let i = a; i < b; i++) { mean += prof.mean[i]; bright += prof.bright[i]; rough += prof.rough[i]; }
  const n = b - a;
  mean /= n; bright /= n; rough /= n;

  const centre = topPx + heightPx / 2;
  const drift = Math.abs(centre - L.HEADLINE_CENTER_Y) / 700;

  const cost =
    WEIGHTS.mean * (mean / 255) +
    WEIGHTS.bright * bright +
    WEIGHTS.rough * Math.min(1, rough / ROUGH_FULL) +
    WEIGHTS.drift * drift;

  return { topPx, cost, mean, bright, rough, drift };
}

/**
 * Best top edge for a scrim of `heightPx`, scanning the legal range.
 * @returns {{topPx:number, cost:number, mean:number, bright:number,
 *            rough:number, candidates:number, defaultCost:number}}
 */
export function bestPlacement(img, heightPx, { step = 12 } = {}) {
  const crop = cropRegion(img.width, img.height);
  const prof = rowProfiles(img, crop);
  const { minTop, maxTop, clamped } = L.placementRange(heightPx);

  if (clamped) {
    const only = scoreBand(prof, crop, minTop, heightPx);
    return { ...only, candidates: 1, defaultCost: only.cost, clamped: true };
  }

  let best = null;
  let candidates = 0;
  for (let top = minTop; top <= maxTop; top += step) {
    const s = scoreBand(prof, crop, top, heightPx);
    candidates++;
    if (!best || s.cost < best.cost) best = s;
  }
  const fallbackTop = L.HEADLINE_CENTER_Y - heightPx / 2;
  const centred = scoreBand(
    prof, crop,
    Math.max(minTop, Math.min(maxTop, fallbackTop)),
    heightPx
  );
  return { ...best, candidates, defaultCost: centred.cost, clamped: false };
}
