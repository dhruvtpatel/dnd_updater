import { google } from "googleapis";

/* ============================================================
   CONFIG
============================================================ */

const PRESENTATION_ID =
  "1gAESsmpHSvhEYYqoKCFiSdAd7J32iBZa9avDlENKrk0";

const TEMPLATE_SLIDE_ID = "g38dd12a4ca0_0_0";

// ALT TEXT on the headline rectangle
const HEADLINE_ALT_TEXT = "CRIMSON_HEADLINE_BOX";

const auth = new google.auth.GoogleAuth({
  credentials: process.env.GOOGLE_CREDENTIALS
    ? JSON.parse(process.env.GOOGLE_CREDENTIALS)
    : undefined,
  keyFile: process.env.GOOGLE_CREDENTIALS ? undefined : "./credentials.json",
  scopes: ["https://www.googleapis.com/auth/presentations"]
});


const slides = google.slides({ version: "v1", auth });

const EMU_PER_PX = 9525;

/* ============================================================
   HELPERS
============================================================ */

function estimateLineCount(text) {
  const CHARS_PER_LINE = 26;
  return Math.max(1, Math.ceil(text.length / CHARS_PER_LINE));
}

/* ============================================================
   MAIN
============================================================ */

export async function addSlide({ title, image }) {
  /* 1️⃣ Duplicate template slide */
  const duplicate = await slides.presentations.batchUpdate({
    presentationId: PRESENTATION_ID,
    requestBody: {
      requests: [{ duplicateObject: { objectId: TEMPLATE_SLIDE_ID } }]
    }
  });

  const newSlideId =
    duplicate.data.replies[0].duplicateObject.objectId;

  /* 2️⃣ Fetch slide */
  const presentation = await slides.presentations.get({
    presentationId: PRESENTATION_ID
  });

  const slide = presentation.data.slides.find(
    s => s.objectId === newSlideId
  );
  if (!slide) throw new Error("Slide not found");

  /* 3️⃣ Hero image */
  const heroImage = slide.pageElements.find(el => el.image);
  if (!heroImage) throw new Error("Hero image not found");

  /* 4️⃣ Headline box via alt text */
  const headlineBox = slide.pageElements.find(
    el =>
      el.title === HEADLINE_ALT_TEXT ||
      el.description === HEADLINE_ALT_TEXT
  );

  if (!headlineBox) {
    throw new Error(
      "Headline box not found — alt text must be CRIMSON_HEADLINE_BOX"
    );
  }

  const HEADLINE_ID = headlineBox.objectId;

  /* ============================================================
     TYPOGRAPHY + PADDING LOGIC
  ============================================================ */

  const lines = estimateLineCount(title);

  // Keep text readable
  const LINE_SPACING = 100; // ≈ Google Slides default

  // True padding (this is the important part)
  const SPACE_ABOVE_PT = 18 + lines * 6;
  const SPACE_BELOW_PT = 22 + lines * 8;

  // Grow box without squishing
  const SCALE_Y = 1 + lines * 0.12;

  // Re-center growth
  const TRANSLATE_Y =
    -(lines * 14 * EMU_PER_PX);

  /* ============================================================
     REQUESTS
  ============================================================ */

  const requests = [
    // Replace hero image (keeps logo + z-order)
    {
      replaceImage: {
        imageObjectId: heroImage.objectId,
        url: image
      }
    },

    // Clear old headline
    {
      deleteText: {
        objectId: HEADLINE_ID,
        textRange: { type: "ALL" }
      }
    },

    // Insert headline
    {
      insertText: {
        objectId: HEADLINE_ID,
        insertionIndex: 0,
        text: title
      }
    },

    // Text style (NO weird spacing)
    {
      updateTextStyle: {
        objectId: HEADLINE_ID,
        style: {
          fontFamily: "Crimson Text",
          fontSize: { magnitude: 55, unit: "PT" },
          foregroundColor: {
            opaqueColor: { rgbColor: { red: 1, green: 1, blue: 1 } }
          }
        },
        fields: "fontFamily,fontSize,foregroundColor"
      }
    },

    // Paragraph padding (THIS is the padding)
    {
      updateParagraphStyle: {
        objectId: HEADLINE_ID,
        style: {
          lineSpacing: LINE_SPACING,
          spaceAbove: { magnitude: SPACE_ABOVE_PT, unit: "PT" },
          spaceBelow: { magnitude: SPACE_BELOW_PT, unit: "PT" }
        },
        fields: "lineSpacing,spaceAbove,spaceBelow"
      }
    },

    // Grow box vertically without squish
    {
      updatePageElementTransform: {
        objectId: HEADLINE_ID,
        applyMode: "RELATIVE",
        transform: {
          scaleX: 1,
          scaleY: SCALE_Y,
          translateX: 0,
          translateY: TRANSLATE_Y,
          unit: "EMU"
        }
      }
    }
  ];

  /* 7️⃣ Execute */
  await slides.presentations.batchUpdate({
    presentationId: PRESENTATION_ID,
    requestBody: { requests }
  });
}