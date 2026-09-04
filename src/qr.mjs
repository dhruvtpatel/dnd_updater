/**
 * Per-article QR codes, matching the deck's existing hand-made code.
 *
 * Measured off the template's QR (1147x1147, module 31px):
 *   - 33x33 modules (version 4) with a 2-module quiet zone
 *   - an 11x11-module white pad, grid-aligned and dead-centre
 *   - the Crimson seal drawn into that pad, 32.9% of the QR's width
 *
 * We keep the proportions and let the version float, since article URLs are
 * much longer than the site URL the original encoded. Error correction is H
 * (30% recoverable) because the centre pad destroys ~10% of the codewords.
 */

import QRCode from "qrcode";
import { PNG } from "pngjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resampleRGBA, compositeOver } from "./image.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEAL_PATH = path.join(__dirname, "..", "assets", "seal.png");

/** Quiet zone, in modules. 2 matches the template. */
export const QUIET_MODULES = 2;
/** Seal pad as a fraction of the QR's module count (template: 11/33). */
export const SEAL_FRACTION = 0.32;
/** Roughly the template's 1147px. Module size is rounded to whole pixels. */
export const TARGET_PX = 900;

let sealCache = null;
function loadSeal() {
  if (!sealCache) sealCache = PNG.sync.read(fs.readFileSync(SEAL_PATH));
  return sealCache;
}

/**
 * Render a QR PNG for `text`.
 * @returns {{buffer: Buffer, size: number, modules: number, version: number,
 *            modulePx: number, padModules: number}}
 */
export function renderQr(text, { withSeal = true, targetPx = TARGET_PX } = {}) {
  const qr = QRCode.create(text, { errorCorrectionLevel: "H" });
  const n = qr.modules.size;
  const total = n + 2 * QUIET_MODULES;

  const modulePx = Math.max(1, Math.round(targetPx / total));
  const size = modulePx * total;

  const png = new PNG({ width: size, height: size });
  png.data.fill(255);

  // The centre pad is an odd number of modules so it centres on the middle one.
  let padModules = 0;
  if (withSeal) {
    padModules = Math.round(SEAL_FRACTION * n);
    if (padModules % 2 === 0) padModules -= 1;
  }
  const padStart = (n - padModules) >> 1;
  const padEnd = padStart + padModules - 1;
  const inPad = (row, col) =>
    padModules > 0 && row >= padStart && row <= padEnd && col >= padStart && col <= padEnd;

  for (let row = 0; row < n; row++) {
    for (let col = 0; col < n; col++) {
      if (!qr.modules.get(row, col) || inPad(row, col)) continue;
      const x0 = (col + QUIET_MODULES) * modulePx;
      const y0 = (row + QUIET_MODULES) * modulePx;
      for (let y = y0; y < y0 + modulePx; y++) {
        for (let x = x0; x < x0 + modulePx; x++) {
          const i = (y * size + x) * 4;
          png.data[i] = 0;
          png.data[i + 1] = 0;
          png.data[i + 2] = 0;
          png.data[i + 3] = 255;
        }
      }
    }
  }

  if (padModules > 0) {
    const padPx = padModules * modulePx;
    const seal = loadSeal();
    // Fit the seal inside the pad, preserving aspect (the seal is 512x520).
    const scale = Math.min(padPx / seal.width, padPx / seal.height);
    const sw = Math.max(1, Math.round(seal.width * scale));
    const sh = Math.max(1, Math.round(seal.height * scale));
    const scaled = resampleRGBA(seal, sw, sh);
    const originPx = (padStart + QUIET_MODULES) * modulePx;
    compositeOver(
      png,
      scaled,
      originPx + Math.round((padPx - sw) / 2),
      originPx + Math.round((padPx - sh) / 2)
    );
  }

  return {
    buffer: PNG.sync.write(png, { colorType: 2 }),
    size,
    modules: n,
    version: qr.version,
    modulePx,
    padModules,
  };
}
