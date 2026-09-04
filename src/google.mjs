/**
 * Minimal Google Slides REST client.
 *
 * Service-account JWT + fetch, rather than the googleapis SDK: the SDK's HTTP
 * stack times out on reads in some environments, and this needs exactly two
 * endpoints. Keeps the dependency surface to zero for the auth path.
 */

import crypto from "node:crypto";
import fs from "node:fs";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/presentations";
const b64u = (b) => Buffer.from(b).toString("base64url");

/** Service-account key from GOOGLE_CREDENTIALS (JSON) or a key file. */
export function loadServiceAccount() {
  const raw = process.env.GOOGLE_CREDENTIALS;
  if (raw) return JSON.parse(raw);
  const file = process.env.GOOGLE_KEY_FILE || "./credentials.json";
  if (!fs.existsSync(file)) {
    throw new Error(
      `no service-account key: set GOOGLE_CREDENTIALS (the JSON) or GOOGLE_KEY_FILE (a path); looked for ${file}`
    );
  }
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

let cached = null;

export async function getAccessToken({ scopes = [SCOPE] } = {}) {
  if (cached && cached.expiresAt > Date.now() + 60000) return cached.token;
  const key = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = b64u(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64u(
    JSON.stringify({
      iss: key.client_email,
      scope: scopes.join(" "),
      aud: TOKEN_URL,
      iat: now,
      exp: now + 3600,
    })
  );
  const sig = crypto
    .createSign("RSA-SHA256")
    .update(`${header}.${claim}`)
    .sign(key.private_key)
    .toString("base64url");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${header}.${claim}.${sig}`,
    }),
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json();
  if (!json.access_token) {
    throw new Error(`token exchange failed: ${json.error_description || JSON.stringify(json)}`);
  }
  cached = { token: json.access_token, expiresAt: Date.now() + (json.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function call(url, init = {}) {
  const token = await getAccessToken();
  const res = await fetch(url, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(120000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(json.error?.message || `HTTP ${res.status}`);
    err.status = res.status;
    err.details = json.error;
    throw err;
  }
  return json;
}

export function presentationsGet(presentationId) {
  return call(`https://slides.googleapis.com/v1/presentations/${presentationId}`);
}

export function presentationsBatchUpdate(presentationId, requests) {
  return call(`https://slides.googleapis.com/v1/presentations/${presentationId}:batchUpdate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ requests }),
  });
}

export function pageThumbnail(presentationId, pageObjectId, size = "LARGE") {
  return call(
    `https://slides.googleapis.com/v1/presentations/${presentationId}/pages/${pageObjectId}/thumbnail` +
      `?thumbnailProperties.thumbnailSize=${size}`
  );
}
