import jsQR from "jsqr";
import { PNG } from "pngjs";
import { renderQr } from "../src/qr.mjs";

const urls = [
  "https://www.thecrimson.com/article/2026/9/4/hks-asbestos-investigation/",
  "https://www.thecrimson.com/article/2026/9/3/lander-brownsberger-recount-four-votes/",
  "https://www.thecrimson.com/article/2026/9/4/extended-annenberg-hours/",
  "https://www.thecrimson.com/article/2026/9/4/harvard-plans-extended-annenberg-hours-first-year-community-building/",
  "https://www.thecrimson.com/article/2026/9/2/decker-mackay-rematch-eighth-term/",
];

/** Nearest-neighbour downscale, to simulate a scanner seeing the slide-size QR. */
function shrink(png, outW) {
  const out = new PNG({ width: outW, height: outW });
  const s = png.width / outW;
  for (let y = 0; y < outW; y++)
    for (let x = 0; x < outW; x++) {
      const si = ((Math.floor(y * s) * png.width) + Math.floor(x * s)) * 4;
      const di = (y * outW + x) * 4;
      out.data[di] = png.data[si]; out.data[di+1] = png.data[si+1];
      out.data[di+2] = png.data[si+2]; out.data[di+3] = 255;
    }
  return out;
}

let pass = 0, total = 0;
for (const url of urls) {
  const r = renderQr(url);
  const png = PNG.sync.read(r.buffer);
  const trials = [
    ["native  " + r.size + "px", png],
    ["slide   326px", shrink(png, 326)],
    ["display 652px", shrink(png, 652)],
  ];
  console.log(`\nv${r.version} ${r.modules}mod pad=${r.padModules} (${(r.padModules**2/r.modules**2*100).toFixed(1)}% occluded)  len=${url.length}`);
  for (const [label, im] of trials) {
    total++;
    const out = jsQR(new Uint8ClampedArray(im.data), im.width, im.height);
    const ok = out?.data === url;
    if (ok) pass++;
    console.log(`   ${ok ? "PASS" : "FAIL"}  ${label}  ${ok ? "" : "-> " + (out?.data ?? "(no read)")}`);
  }
}
console.log(`\n${pass}/${total} decodes matched the source URL exactly`);
process.exit(pass === total ? 0 : 1);
