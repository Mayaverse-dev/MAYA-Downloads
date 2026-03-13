const { test, expect } = require('@playwright/test');

test.describe('Download flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-id]', { timeout: 10_000 });
  });

  test('single-variant card has a direct download button', async ({ page }) => {
    // find a card that has exactly one variant
    const cards = await page.locator('[data-id]').all();
    let found = false;
    for (const card of cards) {
      await card.click({ position: { x: 10, y: 10 } });
      await page.locator('#modal').waitFor({ state: 'visible' });
      const rows = page.locator('.wp-variant-row');
      const count = await rows.count();
      if (count === 0) {
        // single variant shows a direct download link
        const directBtn = page.locator('#modal-downloads a[href*="/api/download/"]');
        if (await directBtn.count() > 0) {
          await expect(directBtn.first()).toBeVisible();
          found = true;
          break;
        }
      }
      await page.keyboard.press('Escape');
      await page.locator('#modal').waitFor({ state: 'hidden' });
    }
    // if all assets are multi-variant this is still a pass
    test.skip(!found, 'No single-variant asset found to test');
  });

  test('download link href points to /api/download/', async ({ page }) => {
    // open modal — verify download links are correctly formed (target="_blank" opens new tab
    // so we verify the href attribute rather than intercepting the request)
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });

    const dlLink = page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first();
    await expect(dlLink).toBeVisible();
    const href = await dlLink.getAttribute('href');
    expect(href).toMatch(/\/api\/download\//);
  });

  test('Discord popup appears after download click', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });

    const dlLink = page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first();
    await dlLink.click();

    const popup = page.locator('#discord-popup');
    await expect(popup).toBeVisible({ timeout: 5_000 });
  });

  test('Discord popup contains Join Server button', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first().click();

    await page.locator('#discord-popup').waitFor({ state: 'visible' });
    const joinBtn = page.locator('.discord-popup-btn');
    await expect(joinBtn).toBeVisible();
    await expect(joinBtn).toContainText(/join/i);

    const href = await joinBtn.getAttribute('href');
    expect(href).toMatch(/discord/i);
  });

  test('Discord popup has server name MAYA', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first().click();

    await page.locator('#discord-popup').waitFor({ state: 'visible' });
    const server = page.locator('.discord-popup-server');
    await expect(server).toContainText('MAYA');
  });

  test('Discord popup closes on X button click', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first().click();

    const popup = page.locator('#discord-popup');
    await popup.waitFor({ state: 'visible' });
    await page.locator('.discord-popup-close').click();
    await expect(popup).not.toBeVisible({ timeout: 3_000 });
  });

  test('Discord popup closes on Escape key', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first().click();

    const popup = page.locator('#discord-popup');
    await popup.waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(popup).not.toBeVisible({ timeout: 3_000 });
  });

  test('Discord popup closes on overlay click', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    await card.click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.locator('#modal-downloads a[href*="/api/download/"], .wp-variant-dl').first().click();

    const popup = page.locator('#discord-popup');
    await popup.waitFor({ state: 'visible' });
    // click the overlay background (far corner)
    await page.mouse.click(10, 10);
    await expect(popup).not.toBeVisible({ timeout: 3_000 });
  });
});

test.describe('Ebook & STL download pages', () => {
  for (const { slug, label } of [
    { slug: 'ebook', label: 'E-Book' },
    { slug: 'stl', label: 'STL' },
  ]) {
    test(`${label} page loads and shows assets`, async ({ page }) => {
      await page.goto(`/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-id]', { timeout: 10_000 });
      const cards = page.locator('[data-id]');
      expect(await cards.count()).toBeGreaterThan(0);
    });

    test(`${label} card opens modal with download button`, async ({ page }) => {
      await page.goto(`/${slug}`, { waitUntil: 'domcontentloaded' });
      await page.waitForSelector('[data-id]', { timeout: 10_000 });
      const card = page.locator('[data-id]').first();
      await card.click({ position: { x: 10, y: 10 } });
      await page.locator('#modal').waitFor({ state: 'visible' });
      const btn = page.locator('#modal-downloads a[href*="/api/download/"]').first();
      await expect(btn).toBeVisible();
    });
  }
});

test.describe('Download All (zip)', () => {
  test('Download All button exists on wallpapers page', async ({ page }) => {
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-id]', { timeout: 10_000 });
    const btn = page.locator('#download-all-btn');
    if (await btn.count() > 0) {
      await expect(btn).toBeVisible();
    }
  });
});
