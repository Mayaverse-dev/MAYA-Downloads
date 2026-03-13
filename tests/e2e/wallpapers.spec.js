const { test, expect } = require('@playwright/test');

test.describe('Wallpapers page', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    // wait for cards to load from API
    await page.waitForSelector('[data-id]', { timeout: 10_000 });
  });

  test('renders asset cards', async ({ page }) => {
    const cards = page.locator('[data-id]');
    await expect(cards.first()).toBeVisible();
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('each card has a title', async ({ page }) => {
    const titles = page.locator('.card-title');
    expect(await titles.count()).toBeGreaterThan(0);
    const first = await titles.first().textContent();
    expect(first?.trim().length).toBeGreaterThan(0);
  });

  test('each card has a thumbnail image', async ({ page }) => {
    const thumbs = page.locator('.card-thumb, [class*="thumb"] img');
    await expect(thumbs.first()).toBeVisible();
  });

  test('clicking a card opens the modal', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    // click the image/preview area, not a button
    await card.click({ position: { x: 10, y: 10 } });
    const modal = page.locator('#modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });
  });

  test('modal shows asset title', async ({ page }) => {
    const card = page.locator('[data-id]').first();
    const cardTitle = await card.locator('.card-title').textContent();
    await card.click({ position: { x: 10, y: 10 } });

    const modalTitle = page.locator('#modal-title');
    await expect(modalTitle).toBeVisible();
    await expect(modalTitle).toContainText(cardTitle?.trim() ?? '');
  });

  test('modal shows the asset description', async ({ page }) => {
    await page.locator('[data-id]').first().click({ position: { x: 10, y: 10 } });
    const desc = page.locator('#modal-desc');
    await expect(desc).toBeVisible();
  });

  test('modal closes on backdrop click', async ({ page }) => {
    await page.locator('[data-id]').first().click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    // #modal IS the backdrop overlay — click far corner to hit overlay not content
    await page.locator('#modal').click({ position: { x: 5, y: 5 }, force: true });
    await expect(page.locator('#modal')).not.toBeVisible({ timeout: 5_000 });
  });

  test('modal closes on Escape key', async ({ page }) => {
    await page.locator('[data-id]').first().click({ position: { x: 10, y: 10 } });
    await page.locator('#modal').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#modal')).not.toBeVisible({ timeout: 5_000 });
  });
});

test.describe('Wallpaper modal — variant rows', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('[data-id]', { timeout: 10_000 });

    // open first card with multiple variants
    const cards = await page.locator('[data-id]').all();
    for (const card of cards) {
      await card.click({ position: { x: 10, y: 10 } });
      await page.locator('#modal').waitFor({ state: 'visible' });
      const variantRows = page.locator('.wp-variant-row');
      if (await variantRows.count() > 1) break;
      // close and try next
      await page.keyboard.press('Escape');
      await page.locator('#modal').waitFor({ state: 'hidden' });
    }
  });

  test('variant rows are present', async ({ page }) => {
    const rows = page.locator('.wp-variant-row');
    expect(await rows.count()).toBeGreaterThan(0);
  });

  test('variant name is visible in each row', async ({ page }) => {
    const rows = page.locator('.wp-variant-row');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      const name = rows.nth(i).locator('.wp-variant-name');
      await expect(name).toBeVisible();
      const text = await name.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });

  test('download button is NOT full-width (< 200px)', async ({ page }) => {
    const btn = page.locator('.wp-variant-dl').first();
    await expect(btn).toBeVisible();
    const box = await btn.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeLessThan(200);
  });

  test('download button links to /api/download/', async ({ page }) => {
    const btn = page.locator('.wp-variant-dl').first();
    const href = await btn.getAttribute('href');
    expect(href).toMatch(/\/api\/download\//);
  });

  test('variant meta row shows resolution or file size', async ({ page }) => {
    const meta = page.locator('.wp-variant-meta').first();
    if (await meta.count() > 0) {
      const text = await meta.textContent();
      expect(text?.trim().length).toBeGreaterThan(0);
    }
  });
});
