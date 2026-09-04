#!/usr/bin/env node
/**
 * Refresh the DND deck with the current top News stories.
 *
 *   node scripts/update.mjs                 # do it
 *   node scripts/update.mjs --dry-run       # plan only, deck untouched
 *   node scripts/update.mjs --no-qr         # leave the existing QR images
 *   node scripts/update.mjs --limit 3       # first N slides only
 *
 * Run on a schedule by .github/workflows/update.yml.
 */

import { getLatestNews, fetchLeadImage } from "../src/news.mjs";
import { publishQrs } from "../src/qrhost.mjs";
import { layoutHeadline } from "../src/layout.mjs";
import { getPresentation, writeArticles, ARTICLE_SLIDE_COUNT } from "../src/slides.mjs";

const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const val = (f, d) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : d;
};

const DRY = has("--dry-run");
const WITH_QR = !has("--no-qr");
const LIMIT = Math.min(Number(val("--limit", ARTICLE_SLIDE_COUNT)), ARTICLE_SLIDE_COUNT);
const LOOKBACK = Number(val("--lookback", 10));

/** Bounded-concurrency map, to stay polite to thecrimson.com. */
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i], i);
      }
    })
  );
  return out;
}

const started = Date.now();
console.log(`\n=== DND update  ${new Date().toISOString()} ===`);

console.log(`\n[1/4] finding News articles (${LOOKBACK}-day lookback)`);
const { candidates, news, selected } = await getLatestNews({ count: LIMIT, lookbackDays: LOOKBACK });
console.log(`      ${candidates} articles resolved, ${news.length} in News, taking ${selected.length}`);
if (!selected.length) {
  console.error("      nothing to publish; leaving the deck alone");
  process.exit(1);
}
if (selected.length < LIMIT) {
  console.warn(`      ! only ${selected.length} of ${LIMIT} slots will be refreshed`);
}

console.log(`\n[2/4] fetching lead photos`);
const articles = await mapLimit(selected, 5, async (a) => {
  let image = null;
  try {
    image = await fetchLeadImage(a.url);
  } catch (e) {
    console.warn(`      ! ${a.slug}: ${e.message}`);
  }
  return { ...a, imageUrl: image?.url ?? null, imageW: image?.width ?? null, imageH: image?.height ?? null };
});
const withPhoto = articles.filter((a) => a.imageUrl).length;
console.log(`      ${withPhoto}/${articles.length} have a lead photo`);

console.log(`\n[3/4] QR codes`);
if (WITH_QR && !DRY) {
  const map = await publishQrs(articles.map((a) => a.url));
  for (const a of articles) a.qrUrl = map.get(a.url);
  console.log(`      published ${map.size} to the qr branch`);
} else {
  console.log(`      skipped (${DRY ? "--dry-run" : "--no-qr"}); existing QR images left in place`);
}

console.log(`\n[4/4] ${DRY ? "planning" : "writing"} slides 2-${1 + articles.length}`);
for (const [i, a] of articles.entries()) {
  const box = layoutHeadline(a.title);
  const dim = a.imageW ? `${a.imageW}x${a.imageH}` : "no photo";
  console.log(
    `  ${String(i + 2).padStart(2)}. ${box.sizePt}pt/${box.lineCount}L  ${dim.padEnd(10)}  ${a.title.slice(0, 62)}`
  );
}

if (DRY) {
  console.log(`\ndry run: deck untouched. ${((Date.now() - started) / 1000).toFixed(1)}s`);
  process.exit(0);
}

const presentation = await getPresentation();
const results = await writeArticles(presentation, articles);

const failed = results.filter((r) => !r.ok);
const degraded = results.filter((r) => r.degraded);
console.log("");
for (const r of degraded) console.warn(`  ~ slide ${r.slide}: ${r.degraded}`);
for (const r of failed) console.error(`  x slide ${r.slide}: ${r.error}`);
console.log(
  `\n${results.length - failed.length}/${results.length} slides updated in ${((Date.now() - started) / 1000).toFixed(1)}s`
);
process.exit(failed.length ? 1 : 0);
