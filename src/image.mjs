/** Minimal RGBA image helpers, so the updater needs no native image deps. */
import { PNG } from "pngjs";

/**
 * Box-filter downscale.
 *
 * Colours are averaged premultiplied by alpha: the seal PNG has arbitrary RGB
 * under its fully-transparent pixels, and averaging those in unpremultiplied
 * would ring a dark halo around the artwork.
 */
export function resampleRGBA(src, outW, outH) {
  const out = new PNG({ width: outW, height: outH });
  const sx = src.width / outW;
  const sy = src.height / outH;
  for (let y = 0; y < outH; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.max(y0 + 1, Math.min(src.height, Math.ceil((y + 1) * sy)));
    for (let x = 0; x < outW; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.max(x0 + 1, Math.min(src.width, Math.ceil((x + 1) * sx)));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * src.width + xx) * 4;
          const al = src.data[i + 3] / 255;
          r += src.data[i] * al;
          g += src.data[i + 1] * al;
          b += src.data[i + 2] * al;
          a += al;
          n++;
        }
      }
      const o = (y * outW + x) * 4;
      if (a > 0) {
        out.data[o] = Math.round(r / a);
        out.data[o + 1] = Math.round(g / a);
        out.data[o + 2] = Math.round(b / a);
      }
      out.data[o + 3] = Math.round((a / n) * 255);
    }
  }
  return out;
}

/** Alpha-composite `fg` over `dst` at (dx, dy). `dst` is treated as opaque. */
export function compositeOver(dst, fg, dx, dy) {
  for (let y = 0; y < fg.height; y++) {
    const ty = dy + y;
    if (ty < 0 || ty >= dst.height) continue;
    for (let x = 0; x < fg.width; x++) {
      const tx = dx + x;
      if (tx < 0 || tx >= dst.width) continue;
      const s = (y * fg.width + x) * 4;
      const a = fg.data[s + 3] / 255;
      if (a === 0) continue;
      const d = (ty * dst.width + tx) * 4;
      for (let c = 0; c < 3; c++) {
        dst.data[d + c] = Math.round(fg.data[s + c] * a + dst.data[d + c] * (1 - a));
      }
      dst.data[d + 3] = 255;
    }
  }
  return dst;
}
