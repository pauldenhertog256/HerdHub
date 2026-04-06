/**
 * E2E test: Edit breed image URL
 *
 * Verifies that typing a URL into the "Image URL" field in the Edit Breed
 * dialog saves correctly and the card grid reflects the new image.
 *
 * Setup/teardown:
 *   - Creates a dedicated test admin account (e2e_admin_<runId>@test.invalid).
 *   - Each test creates its own fresh breed and deletes it afterwards.
 *   - The test admin is deleted at the end of the suite.
 *
 * Covers:
 *   1. Admin editing master list  (All Breeds tab) — card src + API grid state
 *   2. Admin editing My Herd copy (My Herd tab)   — card src + API grid state
 */

import { test, expect } from "@playwright/test";
import assert from "node:assert/strict";

const BASE_URL = "http://localhost:5175";
const API_URL = "http://localhost:5176";
const SEED_ADMIN_EMAIL = process.env.SEED_ADMIN_EMAIL ?? "admin@herdhub.com";
const SEED_ADMIN_PASSWORD =
  process.env.SEED_ADMIN_PASSWORD ??
  (() => {
    throw new Error("Set SEED_ADMIN_PASSWORD env var");
  })();

// External image URL served by the Vite dev server's public/ directory.
// Used to exercise the "paste a URL → server downloads it" code path
// without touching the internet.
const EXT_IMAGE_URL = "http://localhost:5175/test_cow.jpg";

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiPost(url, body, cookieStr) {
  return fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieStr ? { Cookie: cookieStr } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function apiLogin(email, password) {
  const res = await apiPost(`${API_URL}/api/login`, { email, password });
  assert(res.ok, `Login failed: ${res.status}`);
  return res.headers.get("set-cookie").split(";")[0];
}

async function apiCreateBreed(name, cookieStr) {
  const res = await apiPost(`${API_URL}/api/breeds`, { name }, cookieStr);
  assert(res.status === 201, `Create breed failed: ${res.status}`);
  return res.json();
}

async function apiDeleteBreed(id, cookieStr) {
  await fetch(`${API_URL}/api/breeds/${id}`, {
    method: "DELETE",
    headers: { Cookie: cookieStr },
  });
}

/**
 * Upload a tiny red JPEG for a temporary breed and return its absolute http:// URL.
 * The seed breed is deleted immediately; the image file remains on disk for the test.
 */
async function getExternalImageUrl() {
  return EXT_IMAGE_URL;
}

// ── Browser helpers ───────────────────────────────────────────────────────────

/** Inject a session cookie into the browser context and navigate to the app. */
async function loginViaAPI(page, cookieStr) {
  const eqIdx = cookieStr.indexOf("=");
  const name = cookieStr.slice(0, eqIdx).trim();
  const value = cookieStr.slice(eqIdx + 1).trim();
  await page
    .context()
    .addCookies([{ name, value, domain: "localhost", path: "/" }]);
  await page.goto(BASE_URL);
  await page.waitForLoadState("networkidle");
  await page.waitForSelector(".MuiCard-root", { timeout: 10000 });
}

/** Find the card for a specific breed by typing its name into the search bar first (grid is virtualized). */
async function findCardByName(page, breedName) {
  const searchBox = page.locator('input[placeholder*="Search"]');

  // Clear and type breed name to trigger search
  await searchBox.clear();
  await searchBox.fill(breedName);

  // Wait for debounce + virtualized grid to re-render filtered results
  await page.waitForTimeout(600);

  // Find the card - virtualized grids render only visible items
  const card = page.locator(".MuiCard-root").filter({ hasText: breedName });
  await expect(card).toBeVisible({ timeout: 8000 });
  return card;
}

/** Hover a card and click its edit (pencil) button. */
async function clickEditOnCard(page, card) {
  await card.hover();
  const editBtn = card.locator('button:has(svg[data-testid="EditIcon"])');
  await editBtn.waitFor({ state: "visible", timeout: 5000 });
  await editBtn.click();
}

// ── Suite setup / teardown ────────────────────────────────────────────────────

const runId = Date.now();
let testAdminEmail, testAdminPassword, testAdminId, seedCookie;

test.beforeAll(async () => {
  testAdminEmail = `e2e_admin_${runId}@test.invalid`;
  testAdminPassword = `E2eAdmin${runId}!`;
  seedCookie = await apiLogin(SEED_ADMIN_EMAIL, SEED_ADMIN_PASSWORD);

  const res = await apiPost(
    `${API_URL}/api/accounts`,
    { email: testAdminEmail, password: testAdminPassword, role: "admin" },
    seedCookie,
  );
  const resBody = await res.text();
  assert(
    res.ok || res.status === 201,
    `Create test admin failed: ${res.status} ${resBody}`,
  );
  const acct = JSON.parse(resBody);
  testAdminId = acct.id;
});

test.afterAll(async () => {
  if (testAdminId) {
    await fetch(`${API_URL}/api/accounts/${testAdminId}`, {
      method: "DELETE",
      headers: { Cookie: seedCookie },
    });
  }
});

// ── tests ─────────────────────────────────────────────────────────────────────

test.describe("Edit Breed — Image URL field", () => {
  test("1 — Admin: typing a URL in Edit (All Breeds) saves and shows image on card", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const adminCk = await apiLogin(testAdminEmail, testAdminPassword);
    const externalUrl = await getExternalImageUrl();
    const breed = await apiCreateBreed(`e2e_master_${runId}`, adminCk);

    try {
      await loginViaAPI(page, adminCk);

      const card = await findCardByName(page, breed.name);
      await clickEditOnCard(page, card);

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const urlField = dialog.getByLabel(/image url/i);
      await urlField.clear();
      await urlField.fill(externalUrl);

      await page.screenshot({ path: "test-results/before-save-master.png" });
      await dialog.getByRole("button", { name: /save changes/i }).click();
      await expect(dialog).toBeHidden({ timeout: 5000 });

      // Server generates thumb synchronously — 1.5 s is generous headroom for re-render
      await page.waitForTimeout(1500);

      // ── browser / grid check ──────────────────────────────────────────────
      const updatedCard = page
        .locator(".MuiCard-root")
        .filter({ hasText: breed.name });
      const cardImg = updatedCard.locator("img").first();
      await expect(cardImg).toBeVisible({ timeout: 10000 });
      const src = await cardImg.getAttribute("src");
      console.log("Card img src after save (master):", src);
      await page.screenshot({ path: "test-results/after-save-master.png" });

      expect(
        src,
        "img src should be a local /images/ or /api/thumb/ path",
      ).toMatch(/\/(images|api\/thumb)\//);
      expect(src, "img src should NOT remain an external URL").not.toMatch(
        /^https?:\/\//,
      );

      // ── API / grid-state check ────────────────────────────────────────────
      const breeds = await (await fetch(`${API_URL}/api/breeds`)).json();
      const inGrid = breeds.find((b) => b.id === breed.id);
      expect(
        inGrid,
        "Breed should appear in GET /api/breeds after edit",
      ).toBeTruthy();
      expect(
        inGrid.imageUrl,
        "GET /api/breeds should show a local imageUrl after edit",
      ).toMatch(/^\/images\//);
    } finally {
      await apiDeleteBreed(breed.id, adminCk);
    }
  });

  test("2 — Admin: typing a URL in Edit (My Herd) saves and shows image on card", async ({
    page,
  }) => {
    test.setTimeout(60000);
    const adminCk = await apiLogin(testAdminEmail, testAdminPassword);
    const externalUrl = await getExternalImageUrl();
    const breed = await apiCreateBreed(`e2e_myherd_${runId}`, adminCk);

    try {
      await loginViaAPI(page, adminCk);

      // Add the test breed to My Herd via bookmark button
      const card = await findCardByName(page, breed.name);
      await card.hover();
      const addBtn = card.locator(
        'button:has(svg[data-testid="BookmarkAddIcon"])',
      );
      if (await addBtn.isVisible({ timeout: 1000 }).catch(() => false)) {
        await addBtn.click();
        await page.waitForTimeout(500);
      }

      // Switch to My Herd tab
      await page.locator('[role="tab"]').nth(1).click();
      await page.waitForSelector(".MuiCard-root", { timeout: 10000 });

      const herdCard = page
        .locator(".MuiCard-root")
        .filter({ hasText: breed.name });
      await expect(herdCard).toBeVisible({ timeout: 10000 });
      await clickEditOnCard(page, herdCard);

      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();

      const urlField = dialog.getByLabel(/image url/i);
      await urlField.clear();
      await urlField.fill(externalUrl);

      await page.screenshot({ path: "test-results/before-save-myherd.png" });
      await dialog.getByRole("button", { name: /save changes/i }).click();
      await expect(dialog).toBeHidden({ timeout: 5000 });

      await page.waitForTimeout(1500);

      // ── browser / grid check ──────────────────────────────────────────────
      const updatedCard = page
        .locator(".MuiCard-root")
        .filter({ hasText: breed.name });
      const cardImg = updatedCard.locator("img").first();
      await expect(cardImg).toBeVisible({ timeout: 10000 });
      const src = await cardImg.getAttribute("src");
      console.log("Card img src after save (myherd):", src);
      await page.screenshot({ path: "test-results/after-save-myherd.png" });

      expect(src).toMatch(/\/(images|api\/thumb)\//);
      expect(src).not.toMatch(/^https?:\/\//);

      // ── API / grid-state check ────────────────────────────────────────────
      const herd = await (
        await fetch(`${API_URL}/api/myherd`, { headers: { Cookie: adminCk } })
      ).json();
      const inHerd = herd.find((b) => b.id === breed.id);
      expect(
        inHerd,
        "Breed should appear in GET /api/myherd after edit",
      ).toBeTruthy();
      expect(
        inHerd.imageUrl,
        "GET /api/myherd should show a local imageUrl after edit",
      ).toMatch(/^\/images\//);
    } finally {
      await apiDeleteBreed(breed.id, adminCk);
    }
  });
});
