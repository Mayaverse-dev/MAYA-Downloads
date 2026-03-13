const { test, expect } = require('@playwright/test');

test.describe('Homepage', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' });
  });

  test('has correct page title', async ({ page }) => {
    await expect(page).toHaveTitle(/MAYA/i);
  });

  test('displays "MAYA Downloads" header', async ({ page }) => {
    const heading = page.locator('h1, .site-title, [class*="title"]').first();
    await expect(heading).toContainText('MAYA Downloads');
  });

  test('displays subheading copy', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toContain('Free to download');
    expect(body).toContain('No login required');
  });

  test('renders all three category boxes', async ({ page }) => {
    const body = await page.textContent('body');
    expect(body).toMatch(/wallpaper/i);
    expect(body).toMatch(/e-?book/i);
    expect(body).toMatch(/3d printable|stl/i);
  });

  test('category boxes are clickable links', async ({ page }) => {
    const links = page.locator('a[href*="wallpapers"], a[href*="ebook"], a[href*="stl"]');
    await expect(links.first()).toBeVisible();
  });

  test('clicking wallpapers navigates to /wallpapers', async ({ page }) => {
    const link = page.locator('a[href*="wallpapers"]').first();
    await link.click();
    await expect(page).toHaveURL(/wallpapers/);
  });

  test('footer has social media links', async ({ page }) => {
    const footer = page.locator('footer');
    await expect(footer).toBeVisible();
    const links = footer.locator('a');
    await expect(links).toHaveCount(await links.count());
    expect(await links.count()).toBeGreaterThan(0);
  });
});
