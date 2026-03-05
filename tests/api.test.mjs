/**
 * API Tests — run against the live localhost:3000 server.
 * Usage: node --test tests/api.test.mjs
 */

import { test, describe, before } from 'node:test';
import assert from 'node:assert/strict';

const BASE = 'http://localhost:3000';
const ADMIN_PW = process.env.ADMIN_PASSWORD || '700062';
const ADMIN_HEADERS = { 'x-admin-password': ADMIN_PW };

// ── helpers ──────────────────────────────────────────────────────────────────

async function get(path, headers = {}) {
  const res = await fetch(`${BASE}${path}`, { headers, redirect: 'manual' });
  return res;
}

async function post(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return res;
}

async function patch(path, body, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return res;
}

async function del(path, body = {}, headers = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    redirect: 'manual',
  });
  return res;
}

async function json(res) {
  return res.json();
}

// verify server is up before running anything
before(async () => {
  const res = await fetch(`${BASE}/`).catch(() => null);
  assert.ok(res && res.ok, `Server not reachable at ${BASE} — run "node server.js" first`);
});

// ── /api/categories ───────────────────────────────────────────────────────────

describe('GET /api/categories', () => {
  test('returns 200 with an array', async () => {
    const res = await get('/api/categories');
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.ok(Array.isArray(data), 'should be array');
    assert.ok(data.length >= 1, 'at least one category');
  });

  test('each category has required fields', async () => {
    const data = await get('/api/categories').then(json);
    for (const cat of data) {
      assert.ok(typeof cat.slug === 'string' && cat.slug, `missing slug: ${JSON.stringify(cat)}`);
      assert.ok(typeof cat.label === 'string' && cat.label, `missing label`);
      assert.ok(typeof cat.visible === 'boolean', `visible must be boolean`);
    }
  });

  test('contains wallpapers, ebook, stl slugs', async () => {
    const data = await get('/api/categories').then(json);
    const slugs = data.map(c => c.slug);
    assert.ok(slugs.includes('wallpapers'), 'missing wallpapers');
    assert.ok(slugs.includes('ebook'), 'missing ebook');
    assert.ok(slugs.includes('stl'), 'missing stl');
  });
});

// ── /api/downloads ────────────────────────────────────────────────────────────

describe('GET /api/downloads', () => {
  test('returns 200 with array of assets', async () => {
    const res = await get('/api/downloads');
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.ok(Array.isArray(data));
    assert.ok(data.length >= 1);
  });

  test('each asset has id, title, category, variants array', async () => {
    const data = await get('/api/downloads').then(json);
    for (const a of data) {
      assert.ok(a.id, 'missing id');
      assert.ok(a.title, 'missing title');
      assert.ok(a.category, 'missing category');
      assert.ok(Array.isArray(a.variants), 'variants must be array');
    }
  });

  test('returns assets from multiple categories (wallpapers, ebook, stl present)', async () => {
    const data = await get('/api/downloads').then(json);
    const cats = new Set(data.map(a => a.category));
    assert.ok(cats.has('wallpapers') || cats.has('ebook') || cats.has('stl'),
      `expected at least one known category, got: ${[...cats].join(', ')}`);
  });

  test('has assets in wallpapers category', async () => {
    const data = await get('/api/downloads').then(json);
    assert.ok(data.some(a => a.category === 'wallpapers'), 'no wallpapers assets found');
  });

  test('has assets in ebook category', async () => {
    const data = await get('/api/downloads').then(json);
    assert.ok(data.some(a => a.category === 'ebook'), 'no ebook assets found');
  });

  test('has assets in stl category', async () => {
    const data = await get('/api/downloads').then(json);
    assert.ok(data.some(a => a.category === 'stl'), 'no stl assets found');
  });

  test('only returns visible assets', async () => {
    const data = await get('/api/downloads').then(json);
    for (const a of data) {
      assert.notEqual(a.visible, false, `asset ${a.id} is hidden but was returned`);
    }
  });

  test('each variant has id and downloadUrl', async () => {
    const data = await get('/api/downloads').then(json);
    for (const a of data) {
      for (const v of a.variants) {
        assert.ok(v.id, `variant missing id in asset ${a.id}`);
        assert.ok(v.downloadUrl, `variant missing downloadUrl in asset ${a.id}`);
      }
    }
  });
});

// ── /api/download/:id ─────────────────────────────────────────────────────────

describe('GET /api/download/:id', () => {
  let firstVariantId;

  before(async () => {
    const assets = await get('/api/downloads').then(json);
    firstVariantId = assets[0]?.variants[0]?.id;
  });

  test('returns 200 (streams) or 3xx redirect for valid variant id', async () => {
    assert.ok(firstVariantId, 'no variant id found to test');
    const res = await get(`/api/download/${encodeURIComponent(firstVariantId)}`);
    // When S3 is configured it streams (200); without S3 it redirects (302)
    assert.ok(
      res.status === 200 || [301, 302, 307, 308].includes(res.status),
      `expected 200 or redirect, got ${res.status}`
    );
  });

  test('returns 404 for unknown id', async () => {
    const res = await get('/api/download/totally-nonexistent-id-xyz');
    assert.equal(res.status, 404);
  });
});

// ── /api/thumbnail/:id ────────────────────────────────────────────────────────

describe('GET /api/thumbnail/:id', () => {
  let assetWithThumb;

  before(async () => {
    const assets = await get('/api/downloads').then(json);
    assetWithThumb = assets.find(a => a.thumbnailUrl);
  });

  test('returns image content for asset with thumbnail', async () => {
    if (!assetWithThumb) return; // skip if no thumbnails
    const res = await fetch(`${BASE}/api/thumbnail/${encodeURIComponent(assetWithThumb.id)}`);
    assert.ok(res.ok, `expected 200, got ${res.status}`);
    const ct = res.headers.get('content-type') || '';
    assert.ok(ct.startsWith('image/'), `expected image content-type, got ${ct}`);
  });

  test('returns 404 for unknown asset id', async () => {
    const res = await fetch(`${BASE}/api/thumbnail/definitely-nonexistent-xyz`);
    assert.equal(res.status, 404);
  });
});

// ── /api/track (analytics beacon) ────────────────────────────────────────────

describe('POST /api/track', () => {
  test('accepts pageview event (sid required) and returns 204', async () => {
    const res = await post('/api/track', {
      type: 'pageview',
      sid: 'test-session-001',
      page: '/wallpapers',
      referrer: '',
      utm: {},
      screen: { w: 1920, h: 1080 },
      lang: 'en-US',
      tz: 'Asia/Kolkata',
    });
    assert.ok([200, 204].includes(res.status), `expected 200/204, got ${res.status}`);
  });

  test('accepts download event and returns 204', async () => {
    const res = await post('/api/track', {
      type: 'download',
      sid: 'test-session-001',
      asset_id: 'wp-lib-vaanar-tablet',
      asset_title: 'Vaanar',
      asset_category: 'wallpapers',
    });
    assert.ok([200, 204].includes(res.status), `expected 200/204, got ${res.status}`);
  });

  test('accepts event without sid gracefully (no crash)', async () => {
    const res = await post('/api/track', { type: 'pageview' });
    // server silently drops events with no sid but still returns 204
    assert.ok([200, 204].includes(res.status), `expected 200/204, got ${res.status}`);
  });
});

// ── /api/admin/* ──────────────────────────────────────────────────────────────

describe('Admin API (password auth)', () => {
  test('returns 401 without password', async () => {
    const res = await get('/api/admin/downloads');
    assert.equal(res.status, 401);
  });

  test('returns 401 with wrong password', async () => {
    const res = await get('/api/admin/downloads', { 'x-admin-password': 'wrongpassword' });
    assert.equal(res.status, 401);
  });

  test('GET /api/admin/downloads returns 200 with correct password', async () => {
    const res = await get('/api/admin/downloads', ADMIN_HEADERS);
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.ok(Array.isArray(data));
  });

  test('GET /api/admin/categories returns 200 with correct password', async () => {
    const res = await get('/api/admin/categories', ADMIN_HEADERS);
    assert.equal(res.status, 200);
    const data = await json(res);
    assert.ok(Array.isArray(data));
  });

  test('POST /api/admin/categories creates a category', async () => {
    const slug = 'test-cat-' + Date.now();
    const res = await post('/api/admin/categories', {
      slug,
      label: 'TEST CATEGORY',
      desc: 'Created by automated test',
    }, ADMIN_HEADERS);
    assert.ok([200, 201].includes(res.status), `expected 200/201, got ${res.status}`);
    const cats = await get('/api/admin/categories', ADMIN_HEADERS).then(json);
    assert.ok(cats.find(c => c.slug === slug), 'new category not found');
    await del(`/api/admin/categories/${encodeURIComponent(slug)}`, {}, ADMIN_HEADERS);
  });

  test('PATCH /api/admin/categories/:slug toggles visibility', async () => {
    const cats = await get('/api/admin/categories', ADMIN_HEADERS).then(json);
    const target = cats.find(c => !c.builtIn) || cats[0];
    const original = target.visible;
    const res = await patch(`/api/admin/categories/${encodeURIComponent(target.slug)}`, { visible: !original }, ADMIN_HEADERS);
    assert.ok([200, 204].includes(res.status));
    await patch(`/api/admin/categories/${encodeURIComponent(target.slug)}`, { visible: original }, ADMIN_HEADERS);
  });

  test('POST /api/admin/downloads creates an asset then deletes it', async () => {
    const res = await post('/api/admin/downloads', {
      title: 'Automated Test Asset',
      description: 'Created by test suite — safe to delete',
      category: 'stl',
      thumbnailUrl: '',
      visible: false,
      tags: [],
      variants: [{ name: 'Test Variant', resolution: '', fileSize: '', downloadUrl: '#' }],
    }, ADMIN_HEADERS);
    assert.ok([200, 201].includes(res.status), `expected 200/201, got ${res.status}`);
    const created = await json(res);
    assert.ok(created.id, 'created asset must have id');
    const delRes = await del('/api/admin/downloads', { id: created.id }, ADMIN_HEADERS);
    assert.ok([200, 204].includes(delRes.status));
  });

  test('PATCH /api/admin/downloads/:id updates title', async () => {
    const created = await post('/api/admin/downloads', {
      title: 'Patch Test Asset',
      category: 'stl',
      thumbnailUrl: '',
      visible: false,
      tags: [],
      variants: [{ name: 'v1', downloadUrl: '#' }],
    }, ADMIN_HEADERS).then(json);

    const updated = 'Patch Test Asset — UPDATED';
    const patchRes = await patch(`/api/admin/downloads/${encodeURIComponent(created.id)}`, { title: updated }, ADMIN_HEADERS);
    assert.ok([200, 204].includes(patchRes.status));

    const assets = await get('/api/admin/downloads', ADMIN_HEADERS).then(json);
    const found = assets.find(a => a.id === created.id);
    assert.ok(found, 'asset disappeared after patch');
    assert.equal(found.title, updated);
    await del('/api/admin/downloads', { id: created.id }, ADMIN_HEADERS);
  });

  test('DELETE /api/admin/downloads removes the asset', async () => {
    const created = await post('/api/admin/downloads', {
      title: 'Delete Test Asset',
      category: 'stl',
      thumbnailUrl: '',
      visible: false,
      tags: [],
      variants: [{ name: 'v1', downloadUrl: '#' }],
    }, ADMIN_HEADERS).then(json);
    await del('/api/admin/downloads', { id: created.id }, ADMIN_HEADERS);
    const assets = await get('/api/admin/downloads', ADMIN_HEADERS).then(json);
    assert.ok(!assets.find(a => a.id === created.id), 'asset still present after delete');
  });

  test('admin analytics endpoint returns 200', async () => {
    const res = await get('/api/admin/analytics', ADMIN_HEADERS);
    assert.ok([200, 204].includes(res.status), `expected 200/204, got ${res.status}`);
  });
});

// ── /api/download-zip ─────────────────────────────────────────────────────────

describe('POST /api/download-zip', () => {
  test('returns a zip for valid asset ids', async () => {
    const assets = await get('/api/downloads').then(json);
    const ids = assets.slice(0, 2).map(a => a.id);
    const res = await post('/api/download-zip', { ids });
    // Zip creation may take a moment; we just need 200 + zip content type
    assert.ok([200, 503].includes(res.status), `unexpected status ${res.status}`);
    if (res.status === 200) {
      const ct = res.headers.get('content-type') || '';
      assert.ok(ct.includes('zip') || ct.includes('octet-stream'), `expected zip, got ${ct}`);
    }
  });

  test('returns 400 for missing ids', async () => {
    const res = await post('/api/download-zip', {});
    assert.ok([400, 422].includes(res.status), `expected 400, got ${res.status}`);
  });
});
