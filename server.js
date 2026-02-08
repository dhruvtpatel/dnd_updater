import express from "express";
import fetch from "node-fetch";
import * as cheerio from "cheerio";
import path from "path";
import { fileURLToPath } from "url";

import { addSlide } from "./slides.js";

/* ------------------ setup ------------------ */

const app = express();
const PORT = 3000;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/* ---------------- middleware ---------------- */

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static HTML (public/index.html)
app.use(express.static(path.join(__dirname, "public")));

/* ---------------- helpers ---------------- */

async function scrapeCrimsonArticle(url) {
  console.log(`🔍 Fetching ${url}`);

  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch article (${res.status})`);
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Headline
  const title =
    $("h1.css-894m66").first().text().trim() ||
    $("h1.css-1rfyg0l").first().text().trim();

  if (!title) {
    throw new Error("Headline not found");
  }

  // Hero image (ONLY article body, not index cards)
  const image =
    $(".shortcode-large img").first().attr("src") ||
    $(".css-nmmrhs img").first().attr("src");

  if (!image) {
    throw new Error("Hero image not found");
  }

  console.log(`📝 Title: ${title}`);
  console.log(`🖼️ Image: ${image}`);

  return { title, image };
}

/* ---------------- routes ---------------- */

// Health check
app.get("/health", (req, res) => {
  res.json({ ok: true });
});

// Build slides
app.post("/build", async (req, res) => {
  console.log("📦 RAW BODY:", req.body);

  try {
    let urls = req.body.urls || req.body.links;

    // Handle textarea input
    if (typeof urls === "string") {
      urls = urls
        .split("\n")
        .map(u => u.trim())
        .filter(Boolean);
    }

    if (!Array.isArray(urls) || urls.length === 0) {
      console.error("❌ No valid URLs received");
      return res.status(400).json({ error: "No valid URLs provided" });
    }

    console.log(`📰 ${urls.length} articles received`);

    const articles = [];
    for (const url of urls) {
      const article = await scrapeCrimsonArticle(url);
      articles.push(article);
    }

    console.log("🚀 Building slides...");
    for (const article of articles) {
        await addSlide({
            title: article.title,
            image: article.image
        });
    }
    
    console.log("✅ Slides updated successfully");
    res.json({ success: true, count: articles.length });
  } catch (err) {
    console.error("🔥 BUILD ERROR:", err);
    res.status(500).json({ error: err.message });
  }
});

/* ---------------- start server ---------------- */

app.listen(PORT, () => {
  console.log(`✅ Running at http://localhost:${PORT}`);
});
