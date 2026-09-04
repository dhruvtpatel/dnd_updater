import { presentationsGet, pageThumbnail } from "../src/google.mjs";
import { PRESENTATION_ID } from "../src/slides.mjs";
import fs from "node:fs";
const SP = "/private/tmp/claude-501/-Users-dhruvpatel-Desktop-Hunterbrook/b645d83c-6a63-4b08-a005-1e5a7c7cad1d/scratchpad";
const want = process.argv.slice(2).map(Number);
const p = await presentationsGet(PRESENTATION_ID);
for (const n of want) {
  const id = p.slides[n - 1].objectId;
  const { contentUrl } = await pageThumbnail(PRESENTATION_ID, id);
  const buf = Buffer.from(await (await fetch(contentUrl)).arrayBuffer());
  fs.writeFileSync(`${SP}/new${n}.png`, buf);
  console.log(`new${n}.png ${(buf.length/1024).toFixed(0)}KB`);
}
