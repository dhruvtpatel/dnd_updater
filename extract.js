import fetch from "node-fetch";
import * as cheerio from "cheerio";

export async function extractCrimsonArticle(url) {
  const html = await fetch(url).then(r => r.text());
  const $ = cheerio.load(html);

  // ---- TITLE (already correct) ----
  const title =
    $("h1.css-894m66").first().text() ||
    $("h1.css-1rfyg0l").first().text() ||
    $("h1").first().text();

  // ---- IMAGE (IMPORTANT FIX) ----

  // 1️⃣ Preferred: hero image inside article body
  let image = $(".shortcode-large img.css-8atqhb")
    .first()
    .attr("src");

  // 2️⃣ Fallback: any large Crimson thumbnail (NOT card thumbnails)
  if (!image) {
    image = $("img")
      .map((_, el) => $(el).attr("src"))
      .get()
      .find(src =>
        src &&
        src.includes("thumbnails.thecrimson.com") &&
        !src.match(/\.\d{2,3}x\d{2,3}_/) // filters out 100x66, 100x69, etc.
      );
  }

  if (!title || !image) {
    throw new Error("Could not extract title or hero image");
  }

  return {
    title: title.trim(),
    image,
    url
  };
}