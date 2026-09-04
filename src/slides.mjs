/**
 * Rewrites the 18 article slides in place.
 *
 * Slides are never created or deleted: the deck stays at exactly 19 pages and
 * every element keeps its objectId, so the design stays whatever it was last
 * edited to be by hand. Each run overwrites the hero photo, the QR code and the
 * headline on slides 2..19 with the current top 18 News stories.
 *
 * All transforms are ABSOLUTE. The previous implementation used RELATIVE, which
 * multiplied the previous run's scale every time -- the deck drifted a little
 * further out of alignment on each build.
 */

import { presentationsGet, presentationsBatchUpdate } from "./google.mjs";
import * as L from "./layout.mjs";

export const PRESENTATION_ID =
  process.env.PRESENTATION_ID || "1gAESsmpHSvhEYYqoKCFiSdAd7J32iBZa9avDlENKrk0";

/** Slide 1 is the branding card; the article cards follow it. */
export const FIRST_ARTICLE_SLIDE = 1; // 0-based index
export const ARTICLE_SLIDE_COUNT = 18;

const HEADLINE_ALT = "CRIMSON_HEADLINE_BOX";



/** Rendered size of an element in slide px. */
function renderedSize(el) {
  return {
    w: (el.size.width.magnitude * (el.transform?.scaleX ?? 1)) / L.EMU_PER_PX,
    h: (el.size.height.magnitude * (el.transform?.scaleY ?? 1)) / L.EMU_PER_PX,
    x: (el.transform?.translateX ?? 0) / L.EMU_PER_PX,
    y: (el.transform?.translateY ?? 0) / L.EMU_PER_PX,
  };
}

/**
 * Identify the three roles on an article slide by geometry.
 *
 * Deliberately not by objectId suffix: the hand-built template slide numbers
 * its elements differently from the API-duplicated ones (g3931a6d5deb_2_0 vs
 * SLIDES_API..._1), so suffix matching would silently pick the wrong element.
 */
export function classifySlide(slide) {
  const els = slide.pageElements ?? [];
  const images = els.filter((el) => el.image);

  const qr = images.find((el) => {
    const s = renderedSize(el);
    return s.y > 1400 && Math.abs(s.w - s.h) < 12 && s.w > 200 && s.w < 420;
  });
  const logo = images.find((el) => {
    const s = renderedSize(el);
    return el !== qr && s.y < L.BODY_TOP && s.h <= 220;
  });
  const hero = images
    .filter((el) => el !== qr && el !== logo)
    .sort((a, b) => {
      const sa = renderedSize(a), sb = renderedSize(b);
      return sb.w * sb.h - sa.w * sa.h;
    })[0];

  const headline =
    els.find((el) => el.title === HEADLINE_ALT || el.description === HEADLINE_ALT) ??
    els.find((el) => el.shape?.shapeType === "TEXT_BOX" && el.shape?.text);

  const missing = [];
  if (!hero) missing.push("hero image");
  if (!qr) missing.push("QR image");
  if (!headline) missing.push(`headline box (alt text "${HEADLINE_ALT}")`);
  if (missing.length) {
    throw new Error(`slide ${slide.objectId}: could not find ${missing.join(", ")}`);
  }
  return { hero, qr, logo, headline };
}

/** Whether a shape currently holds any text (deleteText fails on an empty one). */
function hasText(el) {
  return (el.shape?.text?.textElements ?? []).some((t) => t.textRun?.content?.length);
}

/**
 * The requests that turn one slide into one article.
 * @param {object} slide           a slide from presentations.get
 * @param {object} article         { title, url, imageUrl }
 * @param {boolean} includeImage   false retries text/QR only when a photo 400s
 */
export function slideRequests(slide, article, { includeImage = true, includeQr = true } = {}) {
  const { hero, qr, headline } = classifySlide(slide);
  const box = L.layoutHeadline(article.title);
  const requests = [];

  if (includeImage && article.imageUrl) {
    // Make the element exactly the body box, then let CENTER_CROP fill it.
    // CENTER_CROP centres and preserves aspect ratio -- the old code sized the
    // element to the photo's own 3:2 shape and hung it off both edges of the
    // slide, so the visible slice was wherever the template happened to sit.
    requests.push(
      {
        updatePageElementTransform: {
          objectId: hero.objectId,
          applyMode: "ABSOLUTE",
          transform: L.absoluteTransform(hero.size, 0, L.BODY_TOP, L.BODY_W, L.BODY_H),
        },
      },
      {
        updateImageProperties: {
          objectId: hero.objectId,
          imageProperties: {
            cropProperties: { leftOffset: 0, rightOffset: 0, topOffset: 0, bottomOffset: 0 },
          },
          fields: "cropProperties",
        },
      },
      {
        replaceImage: {
          imageObjectId: hero.objectId,
          url: article.imageUrl,
          imageReplaceMethod: "CENTER_CROP",
        },
      }
    );
  }

  if (includeQr && article.qrUrl) {
    requests.push({
      replaceImage: {
        imageObjectId: qr.objectId,
        url: article.qrUrl,
        imageReplaceMethod: "CENTER_INSIDE",
      },
    });
  }

  if (hasText(headline)) {
    requests.push({ deleteText: { objectId: headline.objectId, textRange: { type: "ALL" } } });
  }
  requests.push(
    { insertText: { objectId: headline.objectId, insertionIndex: 0, text: article.title } },
    {
      updateTextStyle: {
        objectId: headline.objectId,
        textRange: { type: "ALL" },
        style: {
          fontFamily: L.METRICS.family,
          fontSize: { magnitude: box.sizePt, unit: "PT" },
          foregroundColor: { opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } } },
          bold: false,
          italic: false,
        },
        fields: "fontFamily,fontSize,foregroundColor,bold,italic",
      },
    },
    {
      // spaceAbove/spaceBelow are zeroed: the box is sized to hug its lines and
      // centred by contentAlignment, so paragraph padding only fought with it.
      updateParagraphStyle: {
        objectId: headline.objectId,
        textRange: { type: "ALL" },
        style: {
          alignment: "CENTER",
          lineSpacing: 100,
          spaceAbove: { magnitude: 0, unit: "PT" },
          spaceBelow: { magnitude: 0, unit: "PT" },
        },
        fields: "alignment,lineSpacing,spaceAbove,spaceBelow",
      },
    },
    {
      updateShapeProperties: {
        objectId: headline.objectId,
        shapeProperties: {
          contentAlignment: "MIDDLE",
          shapeBackgroundFill: {
            solidFill: { color: { rgbColor: { red: 0, green: 0, blue: 0 } }, alpha: L.SCRIM_ALPHA },
          },
        },
        fields: "contentAlignment,shapeBackgroundFill.solidFill",
      },
    },
    {
      updatePageElementTransform: {
        objectId: headline.objectId,
        applyMode: "ABSOLUTE",
        transform: L.absoluteTransform(
          headline.size,
          box.leftPx,
          box.topPx,
          box.widthPx,
          box.heightPx
        ),
      },
    }
  );

  return { requests, box };
}

export function getPresentation() {
  return presentationsGet(PRESENTATION_ID);
}

/**
 * Write `articles` onto the article slides, one batchUpdate per slide so a
 * single unfetchable photo can't roll back the other 17.
 */
export async function writeArticles(presentation, articles) {
  const pages = presentation.slides ?? [];
  const results = [];

  for (let i = 0; i < Math.min(articles.length, ARTICLE_SLIDE_COUNT); i++) {
    const slide = pages[FIRST_ARTICLE_SLIDE + i];
    if (!slide) break;
    const article = articles[i];
    const { requests, box } = slideRequests(slide, article);

    try {
      await presentationsBatchUpdate(PRESENTATION_ID, requests);
      results.push({ slide: FIRST_ARTICLE_SLIDE + i + 1, article, box, ok: true });
    } catch (err) {
      const msg = err.message;
      // Most likely the photo URL: retry with the old photo left in place.
      try {
        const retry = slideRequests(slide, article, { includeImage: false });
        await presentationsBatchUpdate(PRESENTATION_ID, retry.requests);
        results.push({
          slide: FIRST_ARTICLE_SLIDE + i + 1, article, box, ok: true,
          degraded: `kept previous photo (${msg})`,
        });
      } catch (err2) {
        results.push({
          slide: FIRST_ARTICLE_SLIDE + i + 1, article, ok: false,
          error: err2.message,
        });
      }
    }
  }
  return results;
}
