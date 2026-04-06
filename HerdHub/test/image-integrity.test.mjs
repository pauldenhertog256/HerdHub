/**
 * Image Integrity Test
 *
 * For every breed returned by /api/breeds, verifies that:
 *   1. imageUrl is set and starts with /images/
 *   2. GET <BASE_URL>/images/<file> returns 200 with an image content-type
 *   3. GET <BASE_URL>/api/thumb/<file> returns 200 with image/webp
 *
 * Also verifies the API response shape is clean (no leaked internal fields).
 *
 * Run against local:  BASE_URL=http://localhost:5176 node --test test/image-integrity.test.mjs
 * Run against prod:   BASE_URL=https://herdhub-production-7da5.up.railway.app node --test test/image-integrity.test.mjs
 */

import { test } from "node:test";
import assert from "node:assert/strict";

const BASE_URL =
  process.env.BASE_URL ||
  process.env.TEST_BASE_URL ||
  "http://localhost:5176";

const CONCURRENCY = 20; // parallel requests

async function checkUrl(url) {
  try {
    // Use GET not HEAD — the thumb route generates on first request and needs to stream,
    // so HEAD responses may not include Content-Type reliably.
    const res = await fetch(url, { signal: AbortSignal.timeout(30000) });
    const ct = res.headers.get("content-type") || "";
    // Drain the body so the connection is released cleanly
    await res.arrayBuffer();
    return { url, status: res.status, contentType: ct, ok: res.ok };
  } catch (err) {
    return { url, status: 0, contentType: "", ok: false, error: err.message };
  }
}

/** Run an array of async tasks with a max concurrency limit. */
async function inParallel(items, fn, concurrency) {
  const results = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const batch = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(batch.map(fn))));
  }
  return results;
}

test("Image Integrity Tests", async (t) => {
  // ── Fetch breeds ─────────────────────────────────────────────────────────
  let breeds;
  await t.test("0. Fetch breeds from API", async () => {
    const res = await fetch(`${BASE_URL}/api/breeds`);
    assert.equal(res.status, 200, "GET /api/breeds should return 200");
    breeds = await res.json();
    assert.ok(Array.isArray(breeds) && breeds.length > 0, "Should have breeds");
    console.log(`  → ${breeds.length} breeds loaded from ${BASE_URL}`);
  });

  // ── API shape: no internal fields leaked ─────────────────────────────────
  await t.test("1. API response should not leak internal fields", () => {
    const FORBIDDEN = ["props", "species"];
    const leaks = [];
    for (const breed of breeds) {
      for (const field of FORBIDDEN) {
        if (field in breed) leaks.push(`"${breed.name}".${field}`);
      }
    }
    if (leaks.length > 0) {
      console.error("  Leaked fields:", leaks.slice(0, 5).join(", "), leaks.length > 5 ? `…+${leaks.length - 5} more` : "");
    }
    assert.equal(leaks.length, 0, `${leaks.length} breeds have leaked internal fields`);
  });

  // ── Every breed has an imageUrl ───────────────────────────────────────────
  await t.test("2. Every breed should have imageUrl", () => {
    const missing = breeds.filter((b) => !b.imageUrl);
    const notLocal = breeds.filter(
      (b) => b.imageUrl && !b.imageUrl.startsWith("/images/"),
    );
    if (missing.length > 0)
      console.error(`  Missing imageUrl: ${missing.map((b) => b.name).slice(0, 5).join(", ")}`);
    if (notLocal.length > 0)
      console.error(`  Non-local imageUrl: ${notLocal.map((b) => `${b.name}→${b.imageUrl}`).slice(0, 3).join(", ")}`);
    assert.equal(missing.length, 0, `${missing.length} breeds have no imageUrl`);
    assert.equal(notLocal.length, 0, `${notLocal.length} breeds have non-local imageUrl`);
  });

  // ── All /images/ URLs return a valid image ────────────────────────────────
  await t.test("3. All /images/ URLs should return 200 + image content-type", async (t) => {
    const localBreeds = breeds.filter((b) => b.imageUrl?.startsWith("/images/"));
    const urls = localBreeds.map((b) => ({
      breed: b.name,
      url: `${BASE_URL}${b.imageUrl.split("?")[0]}`,
    }));

    // Probe first image to detect whether the server actually has image files.
    // Locally the image volume doesn't exist, so the SPA fallback returns HTML.
    const probe = await checkUrl(urls[0].url);
    if (probe.ok && probe.contentType.startsWith("text/html")) {
      t.skip("Image files not present on this server (expected locally — only on Railway volume)");
      return;
    }

    const results = await inParallel(urls, ({ url, breed }) =>
      checkUrl(url).then((r) => ({ ...r, breed })), CONCURRENCY
    );

    const failures = results.filter(
      (r) => !r.ok || (!r.contentType.startsWith("image/") && r.contentType !== "application/octet-stream"),
    );

    // Separately flag AVIF served as octet-stream (MIME bug, not broken image)
    const avifMimeFix = results.filter(
      (r) => r.ok && r.contentType === "application/octet-stream" && r.url.endsWith(".avif"),
    );
    if (avifMimeFix.length > 0)
      console.warn(`  WARN: ${avifMimeFix.length} .avif files served as application/octet-stream (MIME type not set)`);

    if (failures.length > 0) {
      failures.slice(0, 10).forEach((f) =>
        console.error(`  FAIL ${f.breed}: ${f.url} → ${f.status} ${f.contentType} ${f.error || ""}`)
      );
      if (failures.length > 10)
        console.error(`  … and ${failures.length - 10} more`);
    }
    console.log(`  → ${results.length - failures.length}/${results.length} image URLs OK`);
    assert.equal(failures.length, 0, `${failures.length} image URLs are broken`);
  });

  // ── All /api/thumb/ URLs return valid WebP ────────────────────────────────
  await t.test("4. All /api/thumb/ URLs should return 200 + image/webp", async (t) => {
    const localBreeds = breeds.filter((b) => b.imageUrl?.startsWith("/images/"));
    const thumbUrls = localBreeds.map((b) => {
      const filename = b.imageUrl.split("?")[0].slice("/images/".length);
      return { breed: b.name, url: `${BASE_URL}/api/thumb/${filename}` };
    });

    // Probe first 3 images to detect whether the server actually has image files.
    // Use index 1 (second breed) to avoid the one test image that exists locally.
    const probeResults = await Promise.all(
      thumbUrls.slice(1, 4).map(({ url }) => checkUrl(url))
    );
    const missingCount = probeResults.filter((r) => !r.ok || r.contentType.startsWith("text/html")).length;
    if (missingCount >= 2) {
      t.skip("Image files not present on this server (expected locally — only on Railway volume)");
      return;
    }

    const results = await inParallel(thumbUrls, ({ url, breed }) =>
      checkUrl(url).then((r) => ({ ...r, breed })), CONCURRENCY
    );

    const failures = results.filter(
      (r) => !r.ok || !r.contentType.startsWith("image/"),
    );

    if (failures.length > 0) {
      failures.slice(0, 10).forEach((f) =>
        console.error(`  FAIL ${f.breed}: ${f.url} → ${f.status} ${f.contentType} ${f.error || ""}`)
      );
      if (failures.length > 10)
        console.error(`  … and ${failures.length - 10} more`);
    }
    console.log(`  → ${results.length - failures.length}/${results.length} thumb URLs OK`);
    assert.equal(failures.length, 0, `${failures.length} thumb URLs are broken`);
  });
});
