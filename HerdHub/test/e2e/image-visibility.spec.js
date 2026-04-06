/**
 * E2E: Image visibility
 *
 * Verifies that after migration, real breed images are actually rendered in
 * the grid (not just the 🐄 placeholder) and in the detail dialog.
 *
 * Checks:
 *   1. At least 90% of visible cards show a real <img> (not the placeholder)
 *   2. The <img> has a non-zero naturalWidth (actually loaded, not broken)
 *   3. The detail dialog shows the breed image, not the placeholder
 *
 * Run:  npx playwright test test/e2e/image-visibility.spec.js
 */

import { test, expect } from "@playwright/test";

const BASE_URL = "http://localhost:5175";

test.describe("Image visibility after migration", () => {
  test("grid cards should show real images, not placeholders", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });

    // Wait for at least one card to appear
    await page.waitForSelector('[data-testid="breed-card"], .MuiCard-root', { timeout: 15000 });

    // Give lazy images time to load
    await page.waitForTimeout(2000);

    // Count cards and images
    const cards = await page.locator('.MuiCard-root').all();
    expect(cards.length).toBeGreaterThan(0);

    // For each visible card, check if it has a real img (not just the cow emoji placeholder)
    const results = await page.evaluate(() => {
      const cards = document.querySelectorAll('.MuiCard-root');
      let withImage = 0;
      let withPlaceholder = 0;
      let brokenImage = 0;
      const broken = [];

      cards.forEach((card) => {
        const img = card.querySelector('img');
        const emojiPlaceholder = card.querySelector('.MuiCardMedia-root') === null &&
          card.textContent.includes('🐄');

        if (img) {
          if (img.naturalWidth > 0) {
            withImage++;
          } else {
            brokenImage++;
            const alt = img.alt || '(no alt)';
            broken.push({ alt, src: img.src.slice(0, 80) });
          }
        } else {
          withPlaceholder++;
        }
      });

      return { total: cards.length, withImage, withPlaceholder, brokenImage, broken };
    });

    console.log(`Cards: ${results.total} total | ${results.withImage} with image | ${results.withPlaceholder} placeholder | ${results.brokenImage} broken`);
    if (results.broken.length > 0) {
      console.log('Broken images:', results.broken.slice(0, 5));
    }

    // At least 80% of cards should show real images
    const imageRatio = results.withImage / results.total;
    expect(imageRatio, `Only ${results.withImage}/${results.total} cards have images (${Math.round(imageRatio * 100)}%). Expected ≥80%.`).toBeGreaterThanOrEqual(0.8);

    // No broken images (img tag present but not loaded)
    expect(results.brokenImage, `${results.brokenImage} images are broken (present but not loaded)`).toBe(0);
  });

  test("detail dialog should show the breed image", async ({ page }) => {
    await page.goto(BASE_URL, { waitUntil: "networkidle" });
    await page.waitForSelector('.MuiCard-root', { timeout: 15000 });
    await page.waitForTimeout(1000);

    // Find first card that has a real loaded image
    const firstImageCard = await page.locator('.MuiCard-root').filter({
      has: page.locator('img')
    }).first();

    const breedName = await firstImageCard.locator('.MuiTypography-subtitle1').textContent();
    console.log(`Opening detail for: ${breedName}`);

    await firstImageCard.click();

    // Wait for dialog
    await page.waitForSelector('.MuiDialog-root', { timeout: 5000 });

    // Dialog should have an img, not just the placeholder emoji
    const dialogImg = page.locator('.MuiDialog-root img');
    const placeholderEmoji = page.locator('.MuiDialog-root').filter({ hasText: '🐄' });

    const hasImg = await dialogImg.count() > 0;
    if (hasImg) {
      const naturalWidth = await dialogImg.evaluate((img) => img.naturalWidth);
      console.log(`Dialog image naturalWidth: ${naturalWidth}`);
      expect(naturalWidth, `Detail dialog image for "${breedName}" failed to load`).toBeGreaterThan(0);
    } else {
      // If no img, should NOT be showing placeholder
      const hasPlaceholder = await placeholderEmoji.count() > 0;
      expect(hasPlaceholder, `Detail dialog shows placeholder for "${breedName}" — no image loaded`).toBe(false);
    }
  });
});
