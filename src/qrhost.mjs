/**
 * Publishes the per-article QR PNGs somewhere Google can fetch them.
 *
 * replaceImage requires a publicly reachable URL, and Slides copies the bytes
 * into its own storage at that moment -- so the URL only has to be live for a
 * few seconds during the build, not for as long as the slide exists.
 *
 * The PNGs go on an orphan `qr` branch that is force-pushed as a single commit
 * each run. That keeps the repo flat: history never accumulates image blobs,
 * which it would if we committed ~1.8 MB of QR codes to main three times a day.
 *
 * Filenames are the SHA-256 of the article URL, so a given article always maps
 * to the same path with the same bytes and raw.githubusercontent's CDN cache
 * can never serve the wrong code.
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderQr } from "./qr.mjs";

export const QR_BRANCH = process.env.QR_BRANCH || "qr";

export function qrFilename(url) {
  return `${crypto.createHash("sha256").update(url).digest("hex").slice(0, 16)}.png`;
}

/** owner/repo, from the Actions env or the checkout's origin remote. */
export function resolveRepo(cwd = process.cwd()) {
  if (process.env.GITHUB_REPOSITORY) return process.env.GITHUB_REPOSITORY;
  const remote = execFileSync("git", ["remote", "get-url", "origin"], {
    cwd,
    encoding: "utf8",
  }).trim();
  const m = remote.match(/github\.com[:/]([^/]+)\/([^/.]+)/);
  if (!m) throw new Error(`can't parse owner/repo from origin: ${remote}`);
  return `${m[1]}/${m[2]}`;
}

/** GITHUB_TOKEN in Actions; the gh CLI's token when running by hand. */
export function resolveToken() {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  if (process.env.GH_TOKEN) return process.env.GH_TOKEN;
  try {
    return execFileSync("gh", ["auth", "token"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function waitForRaw(url, { timeoutMs = 90000 } = {}) {
  const deadline = Date.now() + timeoutMs;
  let delay = 1000;
  for (;;) {
    try {
      const res = await fetch(url, { method: "HEAD", cache: "no-store" });
      if (res.ok) return true;
    } catch {
      /* keep waiting */
    }
    if (Date.now() > deadline) return false;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 8000);
  }
}

/**
 * Render a QR for every article and push them all to the qr branch.
 *
 * @returns Map<articleUrl, rawUrl>
 */
export async function publishQrs(urls, { cwd = process.cwd(), verify = true } = {}) {
  const repo = resolveRepo(cwd);
  const token = resolveToken();
  if (!token) {
    throw new Error(
      "no GitHub token: set GITHUB_TOKEN, or run `gh auth login` for local runs"
    );
  }

  const work = fs.mkdtempSync(path.join(os.tmpdir(), "dnd-qr-"));
  const mapping = new Map();
  try {
    fs.writeFileSync(
      path.join(work, "README.md"),
      "Generated per-article QR codes for the DND deck.\n" +
        "This branch is force-pushed as a single orphan commit by " +
        "`scripts/update.mjs` and holds no history. Do not edit by hand.\n"
    );
    for (const url of urls) {
      const name = qrFilename(url);
      fs.writeFileSync(path.join(work, name), renderQr(url).buffer);
      mapping.set(url, `https://raw.githubusercontent.com/${repo}/${QR_BRANCH}/${name}`);
    }

    const git = (...args) =>
      execFileSync("git", args, { cwd: work, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    git("init", "-q");
    git("symbolic-ref", "HEAD", `refs/heads/${QR_BRANCH}`);
    git("add", "-A");
    git(
      "-c", "user.name=dnd-updater[bot]",
      "-c", "user.email=dnd-updater@users.noreply.github.com",
      "commit", "-q", "-m", `QR codes for ${urls.length} articles (${new Date().toISOString()})`
    );
    git(
      "push", "--force", "-q",
      `https://x-access-token:${token}@github.com/${repo}.git`,
      `${QR_BRANCH}:${QR_BRANCH}`
    );
  } finally {
    fs.rmSync(work, { recursive: true, force: true });
  }

  if (verify) {
    const first = [...mapping.values()][0];
    if (first && !(await waitForRaw(first))) {
      throw new Error(`QR branch pushed but ${first} never became reachable`);
    }
  }
  return mapping;
}
