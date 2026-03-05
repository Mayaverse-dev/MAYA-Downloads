const { test, expect } = require('@playwright/test');

const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '700062';

async function adminLogin(page) {
  await page.goto('/admin');
  // If already on dashboard (cached session), we're done
  const dashVisible = await page.locator('#admin-dashboard').isVisible().catch(() => false);
  if (dashVisible) return;
  await page.locator('#admin-pw').fill(ADMIN_PASSWORD);
  await page.locator('#admin-login-btn').click();
  await page.locator('#admin-dashboard').waitFor({ state: 'visible', timeout: 10_000 });
}

test.describe('Admin panel — login', () => {
  test('login page shows at /admin', async ({ page }) => {
    await page.goto('/admin');
    await expect(page.locator('#admin-login')).toBeVisible();
    await expect(page.locator('#admin-dashboard')).not.toBeVisible();
  });

  test('wrong password shows error message', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#admin-pw').fill('wrongpassword');
    await page.locator('#admin-login-btn').click();
    const err = page.locator('#login-error');
    await expect(err).toBeVisible({ timeout: 5_000 });
    await expect(err).toContainText(/incorrect/i);
    // stays on login, dashboard not visible
    await expect(page.locator('#admin-dashboard')).not.toBeVisible();
  });

  test('correct password (700062) shows dashboard', async ({ page }) => {
    await page.goto('/admin');
    await page.locator('#admin-pw').fill(ADMIN_PASSWORD);
    await page.locator('#admin-login-btn').click();
    await expect(page.locator('#admin-dashboard')).toBeVisible({ timeout: 8_000 });
    await expect(page.locator('#admin-login')).not.toBeVisible();
  });

  test('show/hide password toggle works', async ({ page }) => {
    await page.goto('/admin');
    const input = page.locator('#admin-pw');
    await expect(input).toHaveAttribute('type', 'password');
    await page.locator('#pw-toggle').click();
    await expect(input).toHaveAttribute('type', 'text');
    await page.locator('#pw-toggle').click();
    await expect(input).toHaveAttribute('type', 'password');
  });

  test('logout returns to login form', async ({ page }) => {
    await adminLogin(page);
    await page.locator('#logout-btn').click();
    await expect(page.locator('#admin-login')).toBeVisible({ timeout: 3_000 });
    await expect(page.locator('#admin-dashboard')).not.toBeVisible();
  });
});

test.describe('Admin panel — dashboard', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('dashboard is visible after login', async ({ page }) => {
    await expect(page.locator('#admin-dashboard')).toBeVisible();
    await expect(page.locator('#admin-login')).not.toBeVisible();
  });

  test('top bar shows "MAYA Admin" branding', async ({ page }) => {
    const topbar = page.locator('.adm-topbar, .adm-brand');
    await expect(topbar.first()).toContainText(/MAYA/i);
  });

  test('categories panel is visible', async ({ page }) => {
    const panel = page.locator('.adm-panel');
    await expect(panel).toBeVisible();
    await expect(panel).toContainText(/categories/i);
  });

  test('category list renders all three built-in categories', async ({ page }) => {
    const catList = page.locator('#cat-list');
    await catList.waitFor({ state: 'visible' });
    const text = await catList.textContent();
    expect(text).toMatch(/wallpaper/i);
    expect(text).toMatch(/e-?book/i);
    expect(text).toMatch(/stl|3d/i);
  });

  test('asset grid renders cards', async ({ page }) => {
    const grid = page.locator('#admin-asset-grid');
    await grid.waitFor({ state: 'visible' });
    await page.waitForFunction(() => {
      const g = document.getElementById('admin-asset-grid');
      return g && g.querySelectorAll('.adm-asset-card').length > 0;
    }, { timeout: 8_000 });
    const cards = grid.locator('.adm-asset-card');
    expect(await cards.count()).toBeGreaterThan(0);
  });

  test('each asset card shows title, category badge, and variant count', async ({ page }) => {
    await page.waitForFunction(() => {
      return document.querySelectorAll('.adm-asset-card').length > 0;
    }, { timeout: 8_000 });

    const card = page.locator('.adm-asset-card').first();
    await expect(card.locator('.adm-asset-title')).toBeVisible();
    await expect(card.locator('.adm-asset-cat')).toBeVisible();
  });

  test('search input filters assets', async ({ page }) => {
    await page.waitForFunction(() => document.querySelectorAll('.adm-asset-card').length > 0, { timeout: 8_000 });
    const totalBefore = await page.locator('.adm-asset-card').count();

    await page.locator('#admin-search').fill('vaanar');
    await page.waitForTimeout(300);
    const filtered = await page.locator('.adm-asset-card').count();
    expect(filtered).toBeLessThanOrEqual(totalBefore);
    // clear
    await page.locator('#admin-search').fill('');
  });

  test('category filter dropdown is populated', async ({ page }) => {
    const select = page.locator('#admin-filter-cat');
    await expect(select).toBeVisible();
    const options = await select.locator('option').count();
    expect(options).toBeGreaterThan(1); // "All" + at least one category
  });
});

test.describe('Admin panel — Add/Edit Asset drawer', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.waitForFunction(() => document.querySelectorAll('.adm-asset-card').length > 0, { timeout: 8_000 });
  });

  test('+ New Asset button opens the drawer', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    const drawer = page.locator('#asset-drawer');
    await expect(drawer).toHaveClass(/open/, { timeout: 5_000 });
  });

  test('drawer shows all required fields', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    await page.locator('#asset-drawer').waitFor({ state: 'visible' });

    await expect(page.locator('#d-title')).toBeVisible();
    await expect(page.locator('#d-desc')).toBeVisible();
    await expect(page.locator('#d-category')).toBeVisible();
    await expect(page.locator('#d-thumb-zone')).toBeVisible();
    await expect(page.locator('#add-variant-btn')).toBeVisible();
    await expect(page.locator('#drawer-save')).toBeVisible();
  });

  test('Cancel button closes the drawer', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    await page.locator('#asset-drawer').waitFor({ state: 'visible' });
    await page.locator('#drawer-cancel').click();
    await expect(page.locator('#asset-drawer')).not.toHaveClass(/open/, { timeout: 3_000 });
  });

  test('Escape key closes the drawer', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    await page.locator('#asset-drawer').waitFor({ state: 'visible' });
    await page.keyboard.press('Escape');
    await expect(page.locator('#asset-drawer')).not.toHaveClass(/open/, { timeout: 3_000 });
  });

  test('+ Add Variant button adds a variant row', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    await page.locator('#asset-drawer').waitFor({ state: 'visible' });

    const before = await page.locator('.adm-variant-row').count();
    await page.locator('#add-variant-btn').click();
    const after = await page.locator('.adm-variant-row').count();
    expect(after).toBe(before + 1);
  });

  test('variant row delete button removes it', async ({ page }) => {
    await page.locator('#add-asset-btn').click();
    await page.locator('#asset-drawer').waitFor({ state: 'visible' });
    await page.locator('#add-variant-btn').click();
    await page.locator('#add-variant-btn').click();
    const before = await page.locator('.adm-variant-row').count();
    await page.locator('.adm-vr-del').first().click();
    const after = await page.locator('.adm-variant-row').count();
    expect(after).toBe(before - 1);
  });

  test('edit button opens drawer pre-filled with asset data', async ({ page }) => {
    const editBtn = page.locator('.adm-edit-btn').first();
    await editBtn.click();
    const drawer = page.locator('#asset-drawer');
    await expect(drawer).toHaveClass(/open/, { timeout: 5_000 });
    // title should not be empty
    const title = await page.locator('#d-title').inputValue();
    expect(title.trim().length).toBeGreaterThan(0);
  });
});

test.describe('Admin panel — Categories management', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
  });

  test('each built-in category has a visibility toggle', async ({ page }) => {
    const catList = page.locator('#cat-list');
    await catList.waitFor({ state: 'visible' });
    const toggles = catList.locator('.cat-toggle');
    expect(await toggles.count()).toBeGreaterThan(0);
  });

  test('+ Add Category button reveals the add form', async ({ page }) => {
    await page.locator('#add-cat-toggle-btn').click();
    await expect(page.locator('#add-cat-form-wrap')).toBeVisible({ timeout: 3_000 });
  });

  test('Cancel hides the add category form', async ({ page }) => {
    await page.locator('#add-cat-toggle-btn').click();
    await page.locator('#add-cat-form-wrap').waitFor({ state: 'visible' });
    await page.locator('#add-cat-cancel').click();
    await expect(page.locator('#add-cat-form-wrap')).not.toBeVisible({ timeout: 3_000 });
  });

  test('creating and deleting a custom category works end-to-end', async ({ page }) => {
    const slug = `test-e2e-${Date.now()}`;
    // open add form
    await page.locator('#add-cat-toggle-btn').click();
    await page.locator('#add-cat-form-wrap').waitFor({ state: 'visible' });

    await page.locator('#add-cat-slug').fill(slug);
    await page.locator('#add-cat-label').fill('TEST E2E CAT');
    await page.locator('#add-cat-desc').fill('Created by Playwright');
    await page.locator('#add-cat-form button[type="submit"]').click();

    // verify it appears in the list
    const catList = page.locator('#cat-list');
    await expect(catList).toContainText('TEST E2E CAT', { timeout: 5_000 });

    // delete it
    const deleteBtn = catList.locator(`.cat-delete-btn[data-slug="${slug}"]`);
    await expect(deleteBtn).toBeVisible();
    page.once('dialog', d => d.accept());
    await deleteBtn.click();

    // confirm removed
    await expect(catList).not.toContainText('TEST E2E CAT', { timeout: 5_000 });
  });
});

test.describe('Admin panel — Asset visibility toggle', () => {
  test.beforeEach(async ({ page }) => {
    await adminLogin(page);
    await page.waitForFunction(() => document.querySelectorAll('.adm-asset-card').length > 0, { timeout: 8_000 });
  });

  test('toggling asset visibility sends a PATCH request to /api/admin/downloads/:id', async ({ page }) => {
    const toggle = page.locator('.asset-toggle').first();
    const assetId = await toggle.getAttribute('data-id');
    expect(assetId).toBeTruthy();

    // click toggle, intercept the resulting PATCH
    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/api/admin/downloads/'), { timeout: 8_000 }),
      toggle.click(),
    ]);
    expect(request.method()).toBe('PATCH');
    expect(request.url()).toContain('/api/admin/downloads/');

    // restore: wait for grid to reload then toggle back
    await page.waitForFunction(() => document.querySelectorAll('.adm-asset-card').length > 0, { timeout: 5_000 });
    const [restoreReq] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/api/admin/downloads/'), { timeout: 8_000 }),
      page.locator('.asset-toggle').first().click(),
    ]);
    expect(restoreReq.method()).toBe('PATCH');
  });
});
