/**
 * Finds the most recent News articles.
 *
 * Three sources, in order of trust:
 *   1. /section/news/  -- server-rendered, gives the ~11 newest News links.
 *   2. sitemap(year)   -- GraphQL, enumerates every article of a year so we can
 *                         reach back far enough to fill all 18 slots.
 *   3. content(...)    -- GraphQL, the authority on section and title.
 *
 * Section is always verified through content(), never inferred from the page an
 * article was found on, so nothing from Arts/Sports/Flyby/Opinion can slip in.
 */

const GRAPHQL = "https://api.thecrimson.com/graphql";
const SITE = "https://www.thecrimson.com";

/** api.thecrimson.com sits behind Cloudflare and 403s a default UA. */
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export const NEWS_SECTION_ID = "4";

/** Matched unanchored: Flyby lives at /flyby/article/... and columns at /column/<name>/article/... */
const ARTICLE_RE = /\/article\/(\d{4})\/(\d{1,2})\/(\d{1,2})\/([A-Za-z0-9_-]+)\/?/g;

async function gql(query, { timeoutMs = 60000 } = {}) {
  const res = await fetch(GRAPHQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": UA },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`graphql HTTP ${res.status}`);
  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(`graphql: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data ?? {};
}

/** Parse an article path into the key content() wants. */
export function parseArticlePath(pathOrUrl) {
  ARTICLE_RE.lastIndex = 0;
  const m = ARTICLE_RE.exec(pathOrUrl);
  if (!m) return null;
  const [, year, month, day, slug] = m;
  return {
    year: Number(year),
    month: Number(month),
    day: Number(day),
    slug,
    key: `${Number(year)}/${Number(month)}/${Number(day)}/${slug}`,
  };
}

/** The newest News links, in the order the section page lists them. */
export async function fetchSectionNewsPaths() {
  const res = await fetch(`${SITE}/section/news/`, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`section page HTTP ${res.status}`);
  const html = await res.text();
  const seen = new Set();
  const out = [];
  for (const m of html.matchAll(ARTICLE_RE)) {
    const parsed = parseArticlePath(m[0]);
    if (parsed && !seen.has(parsed.key)) {
      seen.add(parsed.key);
      out.push(parsed);
    }
  }
  return out;
}

/** Every article URL the CMS lists for a calendar year. */
export async function fetchSitemapPaths(year) {
  const data = await gql(`{ sitemap(year:${year}) { issues { articles { url } } } }`);
  const seen = new Set();
  const out = [];
  for (const issue of data.sitemap?.issues ?? []) {
    for (const article of issue.articles ?? []) {
      const parsed = parseArticlePath(article.url ?? "");
      if (parsed && !seen.has(parsed.key)) {
        seen.add(parsed.key);
        out.push(parsed);
      }
    }
  }
  return out;
}

/**
 * Resolve title/section/timestamp for a batch of articles.
 * content() is aliased ~20 per POST; slugs can't be aliases so they're indexed.
 */
export async function resolveArticles(parsed, { batchSize = 20 } = {}) {
  const resolved = [];
  for (let i = 0; i < parsed.length; i += batchSize) {
    const chunk = parsed.slice(i, i + batchSize);
    const body = chunk
      .map(
        (p, j) =>
          `a${j}: content(year:${p.year}, month:${p.month}, day:${p.day}, slug:${JSON.stringify(
            p.slug
          )}) { id title url createdOn section { id name } subsection { text } }`
      )
      .join("\n");
    const data = await gql(`{\n${body}\n}`);
    chunk.forEach((p, j) => {
      const c = data[`a${j}`];
      if (!c?.title) return;
      resolved.push({
        id: c.id,
        title: c.title.trim(),
        url: `${SITE}${c.url ?? `/article/${p.year}/${p.month}/${p.day}/${p.slug}/`}`,
        createdOn: c.createdOn,
        sectionId: c.section?.id ?? null,
        sectionName: c.section?.name ?? null,
        subsection: c.subsection?.text ?? null,
        ...p,
      });
    });
  }
  return resolved;
}

/**
 * The article's lead photo, from its og:image tag.
 *
 * og:image is stable markup. The previous implementation reached for emotion
 * class hashes (img.css-8atqhb, .shortcode-large) which change on any Crimson
 * front-end deploy.
 *
 * Crimson derivatives are named <photo>.<W>x<H>_q95_crop-smart_upscale.<ext>.
 * og:image hands out the ~1500px one; a 2000px one usually exists and buys us
 * resolution back, since a landscape photo cropped to this portrait box is
 * upscaled either way.
 */
export async function fetchLeadImage(articleUrl) {
  const res = await fetch(articleUrl, {
    headers: { "User-Agent": UA },
    signal: AbortSignal.timeout(45000),
  });
  if (!res.ok) throw new Error(`article HTTP ${res.status}`);
  const html = await res.text();
  const m =
    html.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i) ||
    html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i);
  if (!m) return null;

  const base = m[1];
  const bigger = await upgradeDerivative(base, html);
  return bigger ?? { url: base, ...parseDerivative(base) };
}

/** Pull the pixel dimensions out of a derivative filename. */
export function parseDerivative(url) {
  const m = url.match(/\.(\d+)x(\d+)_q(\d+)_([a-z_-]+)\.(jpe?g|png|gif|webp)$/i);
  if (!m) return { width: null, height: null };
  return { width: Number(m[1]), height: Number(m[2]) };
}

/**
 * Swap in the largest derivative the page itself references for the same photo
 * (so we only ever ask for one the CMS has actually generated -- arbitrary
 * geometries 404, the thumbnail host does not resize on demand).
 */
async function upgradeDerivative(ogUrl, html) {
  const photo = ogUrl.match(/\/photos\/[\d/]+\/[^.]+\.[a-z]+/i)?.[0];
  if (!photo) return null;
  const candidates = new Set();
  for (const m of html.matchAll(/thumbnails\.thecrimson\.com(\/photos\/[^"'\s)]+)/g)) {
    if (m[1].startsWith(photo)) candidates.add(`https://thumbnails.thecrimson.com${m[1]}`);
  }
  let best = null;
  for (const url of candidates) {
    const dim = parseDerivative(url);
    if (!dim.width) continue;
    if (!best || dim.width > best.width) best = { url, ...dim };
  }
  if (!best || best.width <= (parseDerivative(ogUrl).width ?? 0)) return null;
  return best;
}

/**
 * The `count` newest News articles.
 *
 * Starts from the section page, backfills from the year sitemap (both years if
 * the window straddles Jan 1), verifies every candidate's section, then orders
 * by publication time.
 */
export async function getLatestNews({ count = 18, lookbackDays = 10, now = new Date() } = {}) {
  const cutoff = new Date(now.getTime() - lookbackDays * 86400000);

  const [sectionPaths, ...sitemaps] = await Promise.all([
    fetchSectionNewsPaths().catch((e) => {
      console.warn(`  ! section page unavailable (${e.message}); relying on sitemap`);
      return [];
    }),
    ...[...new Set([now.getUTCFullYear(), cutoff.getUTCFullYear()])].map((y) =>
      fetchSitemapPaths(y)
    ),
  ]);

  const inWindow = sitemaps.flat().filter((p) => {
    const d = new Date(Date.UTC(p.year, p.month - 1, p.day));
    return d >= new Date(Date.UTC(cutoff.getUTCFullYear(), cutoff.getUTCMonth(), cutoff.getUTCDate()));
  });

  const byKey = new Map();
  for (const p of [...sectionPaths, ...inWindow]) byKey.set(p.key, p);

  const resolved = await resolveArticles([...byKey.values()]);
  const news = resolved.filter((a) => a.sectionId === NEWS_SECTION_ID);

  news.sort((a, b) => {
    const ta = Date.parse(a.createdOn ?? "") || 0;
    const tb = Date.parse(b.createdOn ?? "") || 0;
    if (tb !== ta) return tb - ta;
    return Number(b.id) - Number(a.id);
  });

  return { candidates: resolved.length, news, selected: news.slice(0, count) };
}
