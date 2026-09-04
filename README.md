# dnd_updater

Keeps the Crimson's DND signage deck
([DND 2026 Slides](https://docs.google.com/presentation/d/1gAESsmpHSvhEYYqoKCFiSdAd7J32iBZa9avDlENKrk0/edit))
on the day's News, automatically.

Three times a day it finds the newest News stories, and rewrites slides 2–19
with each story's headline, lead photo, and its own QR code.

## How it runs

`.github/workflows/update.yml` fires at **9am, 12pm and 4pm ET** — 9am because
that's when most News publishes, the later two to pick up anything that broke
during the day. GitHub cron is UTC-only, so both DST offsets are scheduled and
the job checks the real `America/New_York` hour before doing anything; that
gives exactly three runs a day year-round instead of the times sliding twice a
year. There's also a `workflow_dispatch` button with `limit` and `dry_run`
inputs.

Run it by hand:

```bash
GOOGLE_KEY_FILE=./credentials.json npm run update
```

```bash
GOOGLE_KEY_FILE=./credentials.json npm run dry-run
```

`--dry-run` resolves everything and prints the plan without touching the deck.
`--limit N` does the first N slides only. `--no-qr` leaves the existing QR
images alone. `--lookback D` changes how far back to look for stories
(default 10 days).

## How it picks stories

1. `thecrimson.com/section/news/` is server-rendered and lists the ~11 newest
   News links.
2. `sitemap(year)` on the undocumented GraphQL API at
   `api.thecrimson.com/graphql` enumerates every article of a year, which is how
   we reach back far enough to fill all 18 slots. (Needs a browser `User-Agent`
   or Cloudflare 403s. Introspection is off.)
3. `content(year, month, day, slug)` is the authority on **section** and
   **title**.

Section is always verified through `content()`, never inferred from the page an
article was found on, so nothing from Arts, Sports, Flyby or Opinion can slip
in. News is section id `4`. Stories are then ordered by `createdOn`, newest
first, and the top 18 win.

The lead photo comes from the article's `og:image` meta tag. That's deliberate:
the previous version reached for emotion class hashes (`img.css-8atqhb`,
`.shortcode-large`) which change on any Crimson front-end deploy.

## The photo crop

The slides are 1080×1920 portrait and the photo area is 1080×1642. Crimson lead
photos are 3:2 landscape, so filling that box means keeping only **43.8% of the
frame's width**. Two things follow:

- The crop is **centred**, via `replaceImage` with `CENTER_CROP` on an element
  sized to exactly the photo area. The old code sized the element to the
  photo's own 3:2 shape and hung it off both edges of the slide, so the visible
  slice was wherever the template happened to sit — that's what produced the
  blurry, off-centre column close-ups.
- `og:image` serves a ~1500px derivative, but a **2000px** one usually exists
  for the same photo. Using it puts 877 source pixels across the 1080px box —
  a 1.23× upscale instead of 1.64×.

Arbitrary geometries 404: `thumbnails.thecrimson.com` serves pre-generated
derivatives and does not resize on demand, so only sizes the article page
itself references are requested.

## The headline

Headlines are set in Crimson Text on a translucent-black scrim, sized to hug
their own line count and centred at y=768 on every slide.

Line breaking is computed from real font metrics
(`src/crimson-text-metrics.json`, ~1.7 KB of advance widths) rather than a
characters-per-line guess. Two constants were measured off live renders, since
neither is documented:

- Slides lays out at a **1.20em** line height, not the font's 1.2998em
  ascender+descender. At 55pt that's an 88.0px pitch.
- Usable text width is the box less **0.1in of inset per side**.

`npm run verify:layout` checks the model against live renders. The model
reproduces the hand-built template slide's four line breaks and its box height
to within 1px.

Type is 55pt wherever the headline fits in five lines, stepping down the ladder
(50/46/42/38) only when it doesn't.

## The QR codes

Each slide's QR points at **its own article**, not the site homepage.

The design matches the deck's original hand-made code, measured off it: 2-module
quiet zone, and the Crimson seal in a grid-aligned white pad covering 32% of the
width. Error correction is **H** (30% recoverable) because that pad destroys
~10% of the codewords.

`npm run verify:qr` renders codes and decodes them back with `jsqr`, including at
the 326px size they actually render at on the slide.

`replaceImage` needs a publicly reachable URL, and Slides copies the bytes into
its own storage at that moment — so the URL only has to be live for a few
seconds during the build. The PNGs go on an orphan **`qr` branch** that is
force-pushed as a single commit each run, which keeps history free of image
blobs (committing ~1.8 MB of QR codes to `main` three times a day would not).
Filenames are the SHA-256 of the article URL, so a given article always maps to
the same path with the same bytes and raw.githubusercontent's CDN cache can
never serve the wrong code.

## Slides are never created or deleted

The deck stays at exactly 19 pages and every element keeps its `objectId`, so
whatever you last adjusted by hand in the template stays put. Each run
overwrites the photo, QR and headline in place.

The three roles on a slide are found **by geometry**, not by `objectId` suffix:
the hand-built template numbers its elements differently from the
API-duplicated ones (`g3931a6d5deb_2_0` vs `SLIDES_API..._1`), so suffix
matching silently picks the wrong element. The headline box is found by its
`CRIMSON_HEADLINE_BOX` alt text.

All transforms are `ABSOLUTE`. The previous version used `RELATIVE`, which
multiplied the previous run's scale every time, so the deck drifted a little
further out of alignment on each build.

There's one `batchUpdate` per slide, so a single unfetchable photo can't roll
back the other 17; a slide that fails is retried with its previous photo left in
place.

## Setup

The workflow needs one secret, `GOOGLE_CREDENTIALS`: the full JSON of a service
account with edit access to the presentation (share the deck with the service
account's email). `GITHUB_TOKEN` is provided automatically and only needs
`contents: write`, which the workflow requests.

```bash
gh secret set GOOGLE_CREDENTIALS --repo dhruvtpatel/dnd_updater < credentials.json
```

Locally, point `GOOGLE_KEY_FILE` at the key file, or set `GOOGLE_CREDENTIALS`
to its contents. `credentials.json` is gitignored.

## Manual override

`server.js` is the paste-a-URL escape hatch for putting a specific story on
screen out of band; it writes the URLs you give it to slides 2..n in order and
leaves the rest as the last scheduled run left them.

```bash
GOOGLE_KEY_FILE=./credentials.json npm run serve
```

## Layout

| | |
|---|---|
| `scripts/update.mjs` | the scheduled entry point |
| `src/news.mjs` | finding and section-verifying articles |
| `src/layout.mjs` | slide geometry, font metrics, line breaking |
| `src/qr.mjs` | QR rendering with the seal |
| `src/qrhost.mjs` | pushing QRs where Google can fetch them |
| `src/slides.mjs` | the Slides API requests |
| `src/google.mjs` | service-account JWT + REST |
| `src/image.mjs` | resample/composite, so no native image deps |
| `tools/verify-qr.mjs` | render → decode round-trip |
| `tools/verify-layout.mjs` | typography model vs live renders |
| `tools/shoot.mjs` | save slide renders as PNGs |
| `tools/gen-metrics.mjs` | rebuild the font metrics JSON |
| `tools/prep-seal.mjs` | rebuild `assets/seal.png` |

Runtime dependencies are `express`, `qrcode` and `pngjs`. The Google client is
plain `fetch` — the `googleapis` SDK's HTTP stack times out on reads in some
environments, and this needs exactly two endpoints.
