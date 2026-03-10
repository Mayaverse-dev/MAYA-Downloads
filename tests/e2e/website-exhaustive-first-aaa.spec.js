const { test, expect } = require('@playwright/test');

function buildFixtures() {
  const categories = [
    { slug: 'wallpapers', label: 'Wallpapers', desc: 'High-resolution for desktop and mobile.', visible: true, builtIn: true },
    { slug: 'ebook', label: 'E-Book', desc: 'Free chapters from MAYA Book 1.', visible: true, builtIn: true },
    { slug: 'stl', label: '3D Printables', desc: 'STL files for 3D printing.', visible: true, builtIn: true },
  ];

  const downloads = [
    {
      id: 'wp-open',
      title: 'Vaanar',
      description: 'Unlocked wallpaper set',
      category: 'wallpapers',
      visible: true,
      unlockThreshold: 0,
      variants: [
        { id: 'wp-open-4k', name: '4K', resolution: '3840x2160', fileSize: '8 MB', downloadUrl: '/downloads/wp-open-4k.jpg' },
        { id: 'wp-open-mobile', name: 'Mobile', resolution: '1440x3120', fileSize: '4 MB', downloadUrl: '/downloads/wp-open-mobile.jpg' },
      ],
    },
    {
      id: 'wp-locked',
      title: 'Secret Wallpaper',
      description: 'Locked giveaway',
      category: 'wallpapers',
      visible: true,
      isLocked: true,
      unlockThreshold: 100,
      downloadsRemaining: 25,
      variants: [],
    },
    {
      id: 'stl-1',
      title: 'MAYA Artifact',
      description: 'Printable model',
      category: 'stl',
      visible: true,
      unlockThreshold: 0,
      variants: [
        { id: 'stl-1-main', name: 'Main STL', fileSize: '12 MB', downloadUrl: '/downloads/stl-1-main.stl' },
      ],
    },
    {
      id: 'ebook-soon',
      title: 'Chapter 9',
      description: 'Releasing soon',
      category: 'ebook',
      visible: true,
      unlockThreshold: 0,
      variants: [
        { id: 'ebook-soon-main', name: 'PDF', fileSize: '2 MB', downloadUrl: '#' },
      ],
    },
  ];

  return { categories, downloads };
}

async function mockWebsiteApis(page, options = {}) {
  const fixtures = buildFixtures();
  const categories = options.categories || fixtures.categories;
  const downloads = options.downloads || fixtures.downloads;
  const unlockProgress = options.unlockProgress || {
    totalDownloads: 75,
    hasActiveGoal: true,
    nextThreshold: 100,
    downloadsToNext: 25,
    progressPct: 75,
    nextAsset: {
      id: 'wp-locked',
      title: 'Secret Wallpaper',
      description: 'Locked giveaway',
      category: 'wallpapers',
      thumbnailUrl: '',
      unlockThreshold: 100,
    },
  };

  let zipPayload = null;

  await page.route('**/api/categories', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(categories) });
  });

  await page.route('**/api/downloads', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(downloads) });
  });

  await page.route('**/api/unlocks/progress', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(unlockProgress) });
  });

  await page.route('**/api/track', async (route) => {
    await route.fulfill({ status: 204, body: '' });
  });

  await page.route('**/api/download-zip', async (route) => {
    zipPayload = route.request().postDataJSON();
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: 'PK',
      headers: {
        'content-disposition': 'attachment; filename="maya-stl.zip"',
      },
    });
  });

  return {
    getZipPayload: () => zipPayload,
  };
}

test.describe('Website exhaustive behaviors (FIRST + AAA)', () => {
  test('homepage renders 3 category tiles with correct links', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);

    // Act
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Assert
    const tiles = page.locator('#home-categories-grid .home-box');
    await expect(tiles).toHaveCount(3);
    await expect(tiles.nth(0)).toHaveAttribute('href', '/wallpapers');
    await expect(tiles.nth(1)).toHaveAttribute('href', '/ebook');
    await expect(tiles.nth(2)).toHaveAttribute('href', '/stl');
  });

  test('homepage renders zero category tiles when API returns empty list', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page, { categories: [] });

    // Act
    await page.goto('/', { waitUntil: 'domcontentloaded' });

    // Assert
    await expect(page.locator('#home-categories-grid .home-box')).toHaveCount(0);
  });

  test('wallpapers page renders both unlocked and locked cards', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);

    // Act
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });

    // Assert
    await expect(page.locator('#page-title')).toHaveText('Wallpapers');
    await expect(page.locator('#card-grid .card-preview')).toHaveCount(2);
    await expect(page.locator('#card-grid .card-locked')).toHaveCount(1);
  });

  test('unlock progress strip appears with expected copy for active goal', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);

    // Act
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });

    // Assert
    const strip = page.locator('#unlock-progress');
    await expect(strip).toBeVisible();
    await expect(page.locator('#unlock-next-card')).toContainText('Secret Wallpaper');
    await expect(page.locator('#unlock-next-card')).toContainText('25');
  });

  test('clicking unlocked wallpaper opens modal with variant rows', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });

    // Act
    await page.locator('[data-id="wp-open"]').click({ position: { x: 10, y: 10 } });

    // Assert
    await expect(page.locator('#modal')).toHaveClass(/open/);
    await expect(page.locator('#modal-title')).toHaveText('Vaanar');
    await expect(page.locator('#modal-downloads .wp-variant-row')).toHaveCount(2);
  });

  test('clicking locked wallpaper opens unlock modal and not download modal', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });

    // Act
    await page.locator('[data-id="wp-locked"]').click({ position: { x: 10, y: 10 } });

    // Assert
    await expect(page.locator('#unlock-modal')).toHaveClass(/open/);
    await expect(page.locator('#unlock-modal-copy')).toContainText('25 more downloads needed');
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('unlock share button gives immediate copied feedback', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-id="wp-locked"]').click({ position: { x: 10, y: 10 } });

    // Act
    await page.locator('#unlock-share-btn').click();

    // Assert
    await expect(page.locator('#unlock-share-btn')).toContainText('Link copied');
  });

  test('modal closes when clicking explicit close button', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-id="wp-open"]').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#modal')).toHaveClass(/open/);

    // Act
    await page.locator('#modal-close').click();

    // Assert
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('modal closes when pressing Escape', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-id="wp-open"]').click({ position: { x: 10, y: 10 } });
    await expect(page.locator('#modal')).toHaveClass(/open/);

    // Act
    await page.keyboard.press('Escape');

    // Assert
    await expect(page.locator('#modal')).not.toHaveClass(/open/);
  });

  test('ebook placeholder download renders Coming Soon state', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);

    // Act
    await page.goto('/ebook', { waitUntil: 'domcontentloaded' });

    // Assert
    await expect(page.locator('#card-grid .card-preview')).toHaveCount(1);
    await expect(page.locator('#card-grid .no-url')).toContainText('Coming Soon');
  });

  test('stl page shows direct API download link for single-variant asset', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);

    // Act
    await page.goto('/stl', { waitUntil: 'domcontentloaded' });

    // Assert
    const directLink = page.locator('[data-id="stl-1"] .card-actions a[href*="/api/download/"]');
    await expect(directLink).toHaveCount(1);
    await expect(directLink).toHaveAttribute('href', /\/api\/download\/stl-1-main/);
  });

  test('stl page does not render download-all button in current template', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/stl', { waitUntil: 'domcontentloaded' });

    // Assert
    await expect(page.locator('#download-all-btn')).toHaveCount(0);
  });

  test('modal variant download links are same-tab links in current UI', async ({ page }) => {
    // Arrange
    await mockWebsiteApis(page);
    await page.goto('/wallpapers', { waitUntil: 'domcontentloaded' });
    await page.locator('[data-id="wp-open"]').click({ position: { x: 10, y: 10 } });

    // Assert
    const link = page.locator('#modal-downloads a[href*="/api/download/"]').first();
    await expect(link).not.toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('href', /\/api\/download\/wp-open-4k/);
  });
});
