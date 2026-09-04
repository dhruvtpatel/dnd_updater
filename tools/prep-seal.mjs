/**
 * One-off: downscale the 4036x4096 Crimson seal to a committed asset.
 *
 *   node tools/prep-seal.mjs <source.png> [width]
 *
 * The source is https://static.thecrimson.com/images/crimson_logo.png (2 MB).
 * We keep a 512px copy in assets/ so the updater needs no network for it.
 */
import { PNG } from "pngjs";
import fs from "node:fs";
import { resampleRGBA } from "../src/image.mjs";

const src = process.argv[2];
const targetW = Number(process.argv[3] ?? 512);
if (!src) {
  console.error("usage: node tools/prep-seal.mjs <source.png> [width]");
  process.exit(1);
}

const png = PNG.sync.read(fs.readFileSync(src));
const targetH = Math.round((png.height / png.width) * targetW);
const out = resampleRGBA(png, targetW, targetH);
const buf = PNG.sync.write(out, { colorType: 6 });
fs.writeFileSync("assets/seal.png", buf);
console.log(`${png.width}x${png.height} -> ${targetW}x${targetH}  (${buf.length} bytes)`);
