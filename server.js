/**
 * Optional manual override.
 *
 * The scheduled GitHub Action is what normally drives the deck; this is the
 * paste-a-URL escape hatch for putting a specific story on screen out of band.
 * URLs are written to slides 2..n in the order given; the remaining article
 * slides are left as the last scheduled run left them.
 */

import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseArticlePath, resolveArticles, fetchLeadImage } from "./src/news.mjs";
import { publishQrs, resolveToken } from "./src/qrhost.mjs";
import { getPresentation, writeArticles, ARTICLE_SLIDE_COUNT } from "./src/slides.mjs";

const app = express();
const PORT = process.env.PORT || 3000;
const __dirname = path.dirname(fileURLToPath(import.meta.url));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "public")));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/build", async (req, res) => {
  try {
    let urls = req.body.urls ?? req.body.links ?? [];
    if (typeof urls === "string") urls = urls.split("\n");
    urls = urls.map((u) => u.trim()).filter(Boolean).slice(0, ARTICLE_SLIDE_COUNT);
    if (!urls.length) return res.status(400).json({ error: "No URLs provided" });

    const parsed = urls.map((u) => {
      const p = parseArticlePath(u);
      if (!p) throw new Error(`not a Crimson article URL: ${u}`);
      return p;
    });

    // Titles come from the CMS, not the page markup, and keep the given order.
    const resolved = await resolveArticles(parsed);
    const byKey = new Map(resolved.map((a) => [a.key, a]));
    const articles = [];
    for (const p of parsed) {
      const a = byKey.get(p.key);
      if (!a) throw new Error(`article not found: ${p.key}`);
      const image = await fetchLeadImage(a.url).catch(() => null);
      articles.push({ ...a, imageUrl: image?.url ?? null });
    }

    if (resolveToken()) {
      const qr = await publishQrs(articles.map((a) => a.url));
      for (const a of articles) a.qrUrl = qr.get(a.url);
    } else {
      console.warn("no GitHub token; leaving the existing QR images in place");
    }

    const results = await writeArticles(await getPresentation(), articles);
    const failed = results.filter((r) => !r.ok);
    res.status(failed.length ? 500 : 200).json({
      success: !failed.length,
      count: results.length - failed.length,
      slides: results.map((r) => ({
        slide: r.slide, title: r.article.title, ok: r.ok,
        note: r.degraded ?? r.error ?? null,
      })),
    });
  } catch (err) {
    console.error("build failed:", err);
    res.status(500).json({ error: err.message });
  }
});

app.listen(PORT, "0.0.0.0", () => console.log(`listening on ${PORT}`));
