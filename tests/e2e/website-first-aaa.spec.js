const { test, expect } = require('@playwright/test');

const categoriesFixture = [
  { slug: 'wallpapers', label: 'Wallpapers', desc: 'High-resolution for desktop and mobile.', visible: true, builtIn: true },
  { slug: 'ebook', label: 'E-Book', desc: 'Free chapters from MAYA Book 1.', visible: true, builtIn: true },
  { slug: 'stl', label: '3D Printables', desc: 'STL files for 3D printing.', visible: true, builtIn: true },
];

const downloadsFixture = [
  {
    id: 'wp-1',
    title: 'Vaanar',
    description: 'Wallpaper set',
    category: 'wallpapers',
    visible: true,
    variants: [
      { id: 'wp-1-4k', name: '4K', resolution: '3840x2160', fileSize: '8 MB', downloadUrl: '/downloads/wp-1-4k.jpg' },
      { id: 'wp-1-mobile', name: 'Mobile', resolution: '1440x3120', fileSize: '4 MB', downloadUrl: '/downloads/wp-1-mobile.jpg' },
    ],
  },
  {
    id: 'stl-1',
    title: 'MAYA Artifact',
    description: 'Printable model',
    category: 'stl',
    visible: true,
    variants: [{ id: 'stl-1-main', name: 'Main STL', fileSize: '12 MB', downloadUrl: '/downloads/stl-1-main.stl' }],
  },
];

async function mockCoreApi(page) {
  await page.route('**/api/categories', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(categoriesFixture) });
  });
  await page.route('**/api/downloads', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(downloadsFixture) });
  });
  await page.route('**/api/unlocks/progress', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ totalDownloads: 0, hasActiveGoal: false }),
    });
  });
  await page.route('**/api/track', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });
}

test.describe('Website core flows (FIRST + AAA)', () => {
  test('homepage renders built-in category boxes from API', async ({ page }) => {
    // Arrange
    await mockCoreApi(page);

    // Act
    await page.goto('/');

    // Assert
    const boxes = page.locator('#home-categories-grid .home-box');
    await expect(boxes).toHaveCount(3);
    await expect(boxes.nth(0)).toContainText('Wallpapers');
    await expect(boxes.nth(1)).toContainText('E-Book');
    await expect(boxes.nth(2)).toContainText('3D Printables');
  });

  test('wallpapers page renders section title and cards', async ({ page }) => {
    // Arrange
    await mockCoreApi(page);

    // Act
    await page.goto('/wallpapers');

    // Assert
    await expect(page.locator('#page-title')).toHaveText('Wallpapers');
    await expect(page.locator('#card-grid .card-preview')).toHaveCount(1);
  });

  test('opening multi-variant wallpaper shows variant rows in modal', async ({ page }) => {
    // Arrange
    await mockCoreApi(page);
    await page.goto('/wallpapers');

    // Act
    await page.locator('#card-grid .card-preview').first().click({ position: { x: 10, y: 10 } });

    // Assert
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#modal-title')).toHaveText('Vaanar');
    await expect(page.locator('#modal-downloads .wp-variant-row')).toHaveCount(2);
  });

  test('pressing Escape closes opened modal', async ({ page }) => {
    // Arrange
    await mockCoreApi(page);
    await page.goto('/wallpapers');
    await page.locator('#card-grid .card-preview').first().click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#modal')).toHaveClass(/open/);

    // Act
    await page.keyboard.press('Escape');

    // Assert
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('stl single-variant card renders direct API download link', async ({ page }) => {
    // Arrange
    await mockCoreApi(page);

    // Act
    await page.goto('/stl');

    // Assert
    const directLink = page.locator('#card-grid .card-preview .card-actions a[href*="/api/download/"]');
    await expect(directLink).toHaveCount(1);
    await expect(directLink).toHaveAttribute('href', /\/api\/download\/stl-1-main/);
  });
});
