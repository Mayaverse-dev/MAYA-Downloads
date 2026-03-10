require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const archiver = require('archiver');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const DATA_PATH = path.join(__dirname, 'data', 'downloads.json');

// Multer: memory storage for S3 upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 }, // 500 MB
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public'), { index: false }));

function checkAdmin(req) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  return pw && pw === process.env.ADMIN_PASSWORD;
}

const CATS_PATH = path.join(__dirname, 'data', 'categories.json');

async function readCats() {
  let cats = await db.getCategories();
  if (cats.length === 0) {
    try {
      const raw = await fs.readFile(CATS_PATH, 'utf8');
      cats = JSON.parse(raw);
      await db.saveCategories(cats);
    } catch (e) {
      // no file or parse error
    }
  }
  return cats;
}

async function writeCats(cats) {
  await db.saveCategories(cats);
}

async function catIsVisible(slug) {
  const cats = await readCats();
  const cat = cats.find((c) => c.slug === slug);
  return !!(cat && cat.visible !== false);
}

/** Trim whitespace/newlines and strip accidental leading = or tab chars from env values */
function cleanEnv(val) {
  if (!val) return val;
  return val.replace(/^[\s=]+/, '').replace(/[\s]+$/, '');
}

function getS3Client() {
  const endpoint = cleanEnv(process.env.S3_ENDPOINT) || 'https://t3.storageapi.dev';
  const accessKeyId = cleanEnv(process.env.S3_ACCESS_KEY_ID);
  const secretAccessKey = cleanEnv(process.env.S3_SECRET_ACCESS_KEY);
  if (!accessKeyId || !secretAccessKey) return null;
  return new S3Client({
    endpoint,
    region: cleanEnv(process.env.S3_REGION) || 'auto',
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true,
  });
}

function getBucket() {
  return cleanEnv(process.env.S3_BUCKET) || 'embedded-drop-iunbltzf2y1';
}

/** Build public URL for a key (Tigris style: endpoint/bucket/key) */
function getPublicUrl(key) {
  const endpoint = (cleanEnv(process.env.S3_ENDPOINT) || 'https://t3.storageapi.dev').replace(/\/$/, '');
  const bucket = getBucket();
  const encodedKey = key.split('/').map((s) => encodeURIComponent(s)).join('/');
  return `${endpoint}/${bucket}/${encodedKey}`;
}

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

function toUnlockThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function isUnlocked(asset, totalDownloads) {
  const threshold = toUnlockThreshold(asset && asset.unlockThreshold);
  return threshold === 0 || totalDownloads >= threshold;
}

function sanitizePublicAsset(asset, totalDownloads) {
  const threshold = toUnlockThreshold(asset.unlockThreshold);
  const unlocked = isUnlocked(asset, totalDownloads);
  const downloadsRemaining = unlocked ? 0 : Math.max(0, threshold - totalDownloads);
  const base = {
    ...asset,
    unlockThreshold: threshold,
    isLocked: !unlocked,
    downloadsRemaining,
  };
  if (unlocked) return base;
  return {
    ...base,
    // Never expose variant download URLs while locked.
    variants: [],
  };
}

function sanitizePublicAssetNoGamification(asset) {
  return {
    ...asset,
    unlockThreshold: toUnlockThreshold(asset.unlockThreshold),
    isLocked: false,
    downloadsRemaining: 0,
  };
}

function buildUnlockProgress(assets, totalDownloads) {
  const withGoals = assets
    .map((a) => ({ asset: a, threshold: toUnlockThreshold(a.unlockThreshold) }))
    .filter((x) => x.threshold > 0)
    .sort((a, b) => a.threshold - b.threshold);
  const next = withGoals.find((x) => totalDownloads < x.threshold) || null;
  if (!next) {
    return {
      totalDownloads,
      hasActiveGoal: false,
      nextThreshold: null,
      downloadsToNext: 0,
      progressPct: 100,
      nextAsset: null,
    };
  }
  return {
    totalDownloads,
    hasActiveGoal: true,
    nextThreshold: next.threshold,
    downloadsToNext: Math.max(0, next.threshold - totalDownloads),
    progressPct: Math.max(0, Math.min(100, Math.round((totalDownloads / next.threshold) * 100))),
    nextAsset: {
      id: next.asset.id,
      title: next.asset.title || '',
      description: next.asset.description || '',
      category: next.asset.category || '',
      thumbnailUrl: next.asset.thumbnailUrl || '',
      unlockThreshold: next.threshold,
    },
  };
}

/** Extract S3 key from a stored downloadUrl (e.g. https://t3.storageapi.dev/bucket/key/path) */
function keyFromDownloadUrl(downloadUrl) {
  if (!downloadUrl || downloadUrl === '#') return null;
  try {
    const u = new URL(downloadUrl);
    const pathname = u.pathname.replace(/^\/+/, '');
    const bucket = getBucket();
    const prefix = bucket + '/';
    if (pathname.startsWith(prefix)) {
      return decodeURIComponent(pathname.slice(prefix.length));
    }
    return null;
  } catch (e) {
    return null;
  }
}

const ORPHAN_CUTOFF_DAYS = 7;

/** Normalize wallpaper title: strip trailing "(N)" */
function normalizeTitle(title) {
  return (title || '').trim().replace(/\s*\(\d+\)\s*$/, '').trim();
}

/**
 * One-time migration: convert flat items (old schema) → new assets-with-variants schema.
 * Idempotent: items already in new format are passed through unchanged.
 */
function migrateToVariants(data) {
  if (!Array.isArray(data) || data.length === 0) return { data, changed: false };
  const needsMigration = data.some((item) => 'downloadUrl' in item && !Array.isArray(item.variants));
  if (!needsMigration) return { data, changed: false };

  const alreadyNew = data.filter((i) => Array.isArray(i.variants));
  const oldFlat = data.filter((i) => !Array.isArray(i.variants));

  // Group flat wallpapers by normalized title
  const wpGroups = {};
  const nonWp = [];
  for (const item of oldFlat) {
    if (item.category === 'wallpapers') {
      const key = normalizeTitle(item.title);
      if (!wpGroups[key]) wpGroups[key] = [];
      wpGroups[key].push(item);
    } else {
      nonWp.push(item);
    }
  }

  const migrated = [];

  // Convert wallpaper groups → single asset with variants
  for (const [title, items] of Object.entries(wpGroups)) {
    const primary = items.find((i) => i.type === 'desktop') || items[0];
    migrated.push({
      id: primary.id,
      title,
      description: primary.description || '',
      category: 'wallpapers',
      thumbnailUrl: primary.thumbnailUrl || '',
      visible: items.every((i) => i.visible !== false),
      createdAt: primary.createdAt || new Date().toISOString(),
      tags: primary.tags || [],
      unlockThreshold: toUnlockThreshold(primary.unlockThreshold),
      variants: items.map((item) => ({
        id: item.id,
        name: item.subtitle || item.type || 'Download',
        resolution: item.resolution || '',
        fileSize: item.fileSize || '',
        downloadUrl: item.downloadUrl || '#',
      })),
    });
  }

  // Convert non-wallpaper flat items → single-variant asset
  for (const item of nonWp) {
    const { id, title, description, category, format, chapter, thumbnailUrl, visible, createdAt, tags,
            downloadUrl, fileSize, resolution, subtitle } = item;
    migrated.push({
      id,
      title,
      description: description || '',
      category,
      ...(format !== undefined && { format }),
      ...(chapter !== undefined && { chapter }),
      thumbnailUrl: thumbnailUrl || '',
      visible: visible !== false,
      createdAt: createdAt || new Date().toISOString(),
      tags: tags || [],
      unlockThreshold: toUnlockThreshold(item.unlockThreshold),
      variants: [{
        id: uuidv4(),
        name: subtitle || 'Download',
        resolution: resolution || '',
        fileSize: fileSize || '',
        downloadUrl: downloadUrl || '#',
      }],
    });
  }

  return { data: [...alreadyNew, ...migrated], changed: true };
}

/** Remove S3 objects that are no longer referenced by any asset and are older than ORPHAN_CUTOFF_DAYS. Runs in background. */
function scheduleOrphanCleanup() {
  setImmediate(async () => {
    const s3 = getS3Client();
    const bucket = getBucket();
    if (!s3) return;
    try {
      const data = await readData();
      const list = Array.isArray(data) ? data : [];
      const referencedKeys = new Set();
      for (const item of list) {
        const thumbKey = keyFromDownloadUrl(item.thumbnailUrl);
        if (thumbKey) referencedKeys.add(thumbKey);
        for (const v of (item.variants || [])) {
          const vKey = keyFromDownloadUrl(v.downloadUrl);
          if (vKey) referencedKeys.add(vKey);
        }
      }
      const cutoff = new Date(Date.now() - ORPHAN_CUTOFF_DAYS * 24 * 60 * 60 * 1000);
      const prefixes = ['uploads/', 'uploads/thumbs/', 'Assets/', '_thumbs/'];
      for (const prefix of prefixes) {
        let continuationToken;
        do {
          const listCmd = new ListObjectsV2Command({
            Bucket: bucket,
            Prefix: prefix,
            ContinuationToken: continuationToken,
          });
          const listResp = await s3.send(listCmd);
          const contents = listResp.Contents || [];
          for (const obj of contents) {
            const key = obj.Key;
            if (!key || referencedKeys.has(key)) continue;
            const lastMod = obj.LastModified ? new Date(obj.LastModified) : null;
            if (lastMod && lastMod < cutoff) {
              try {
                await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
                console.log('Orphan S3 deleted:', key);
              } catch (err) {
                console.warn('Orphan delete failed:', key, err.message);
              }
            }
          }
          continuationToken = listResp.NextContinuationToken;
        } while (continuationToken);
      }
    } catch (e) {
      console.warn('Orphan cleanup error:', e.message);
    }
  });
}

async function readData() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    const { data, changed } = migrateToVariants(parsed);
    if (changed) {
      // Write back new format; don't await to avoid blocking reads
      writeData(data).catch((e) => console.warn('Migration write failed:', e.message));
    }
    return data;
  } catch (e) {
    return [];
  }
}

async function writeData(data) {
  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Pages ─────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});
app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});
app.get('/wallpapers', async (req, res) => {
  if (!await catIsVisible('wallpapers')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'wallpapers.html'));
});
app.get('/ebook', async (req, res) => {
  if (!await catIsVisible('ebook')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'ebook.html'));
});
app.get('/stl', async (req, res) => {
  if (!await catIsVisible('stl')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'stl.html'));
});
app.get('/c/:slug', async (req, res) => {
  const cats = await readCats();
  const cat = cats.find((c) => c.slug === req.params.slug && !c.builtIn);
  if (!cat || !cat.visible) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'category-page.html'));
});

// ─── Health check (S3 diagnostics) ──────────────────────────────────────
app.get('/api/health', (req, res) => {
  const s3 = getS3Client();
  res.json({
    s3Configured: !!s3,
    hasAccessKeyId: !!cleanEnv(process.env.S3_ACCESS_KEY_ID),
    hasSecretAccessKey: !!cleanEnv(process.env.S3_SECRET_ACCESS_KEY),
    bucket: getBucket(),
    endpoint: cleanEnv(process.env.S3_ENDPOINT) || '(default)',
  });
});

// ─── Public: analytics config ────────────────────────────────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    gaId: cleanEnv(process.env.GA_ID) || '',
    metaPixelId: cleanEnv(process.env.META_PIXEL_ID) || '',
  });
});

// ─── Public: categories (visible only) ────────────────────────────────────
app.get('/api/categories', async (req, res) => {
  try {
    const cats = await readCats();
    res.json(cats.filter((c) => c.visible !== false).sort((a, b) => (a.order || 99) - (b.order || 99)));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

// ─── Public: stream thumbnail from S3 (so thumbnails work with private bucket) ─
app.get('/api/thumbnail/:id', async (req, res) => {
  try {
    const data = await readData();
    const item = (Array.isArray(data) ? data : []).find((i) => i.id === req.params.id);
    if (!item || !item.thumbnailUrl || item.thumbnailUrl === '#') {
      return res.status(404).end();
    }
    const s3 = getS3Client();
    if (!s3) return res.status(503).end();
    const key = keyFromDownloadUrl(item.thumbnailUrl);
    if (!key) return res.status(404).end();
    const bucket = getBucket();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj = await s3.send(command);
    if (obj.ContentType) res.set('Content-Type', obj.ContentType);
    res.set('Cache-Control', obj.CacheControl || 'public, max-age=31536000, immutable');
    if (obj.ETag) res.set('ETag', String(obj.ETag));
    if (obj.LastModified) res.set('Last-Modified', new Date(obj.LastModified).toUTCString());
    obj.Body.pipe(res);
  } catch (e) {
    console.error('Thumbnail error:', e);
    if (!res.headersSent) res.status(500).end();
  }
});

// ─── Public: stream best available high-res preview image ───────────────────
app.get('/api/preview-image/:id', async (req, res) => {
  try {
    const data = await readData();
    const item = (Array.isArray(data) ? data : []).find((i) => i.id === req.params.id);
    if (!item) return res.status(404).end();

    const isImageUrl = (url) => {
      if (!url || url === '#') return false;
      try {
        const u = new URL(url);
        return /\.(avif|webp|png|jpe?g|gif)$/i.test(u.pathname || '');
      } catch (_) {
        return /\.(avif|webp|png|jpe?g|gif)(\?.*)?$/i.test(url);
      }
    };

    const areaFromResolution = (resolution) => {
      const m = String(resolution || '').match(/^(\d+)\s*x\s*(\d+)$/i);
      if (!m) return 0;
      return Number(m[1]) * Number(m[2]);
    };

    const imageVariants = (item.variants || [])
      .filter((v) => v && isImageUrl(v.downloadUrl))
      .sort((a, b) => areaFromResolution(b.resolution) - areaFromResolution(a.resolution));

    const bestImageUrl =
      (imageVariants[0] && imageVariants[0].downloadUrl) ||
      (isImageUrl(item.thumbnailUrl) ? item.thumbnailUrl : '') ||
      ((item.variants || []).find((v) => v && v.downloadUrl && v.downloadUrl !== '#') || {}).downloadUrl ||
      '';

    if (!bestImageUrl || bestImageUrl === '#') return res.status(404).end();

    const s3 = getS3Client();
    if (!s3) return res.redirect(302, bestImageUrl);

    const key = keyFromDownloadUrl(bestImageUrl);
    if (!key) return res.redirect(302, bestImageUrl);
    const bucket = getBucket();
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const obj = await s3.send(command);
    if (obj.ContentType) res.set('Content-Type', obj.ContentType);
    res.set('Cache-Control', obj.CacheControl || 'public, max-age=31536000, immutable');
    if (obj.ETag) res.set('ETag', String(obj.ETag));
    if (obj.LastModified) res.set('Last-Modified', new Date(obj.LastModified).toUTCString());
    obj.Body.pipe(res);
  } catch (e) {
    console.error('Preview image error:', e);
    if (!res.headersSent) res.status(500).end();
  }
});

// ─── Public: stream download from S3 — id can be asset id or variant id ─
app.get('/api/download/:id', async (req, res) => {
  try {
    const gamificationEnabled = await db.getGamificationEnabled();
    const data = await readData();
    const list = Array.isArray(data) ? data : [];
    const reqId = req.params.id;
    let downloadUrl = null;
    let matchedAsset = null;

    // Match asset id → use first downloadable variant
    const asset = list.find((i) => i.id === reqId);
    if (asset) {
      matchedAsset = asset;
      const v = (asset.variants || []).find((v) => v.downloadUrl && v.downloadUrl !== '#');
      if (v) downloadUrl = v.downloadUrl;
    }

    // Match variant id across all assets
    if (!downloadUrl) {
      for (const a of list) {
        const v = (a.variants || []).find((v) => v.id === reqId);
        if (v && v.downloadUrl && v.downloadUrl !== '#') {
          matchedAsset = a;
          downloadUrl = v.downloadUrl;
          break;
        }
      }
    }

    if (!downloadUrl) return res.status(404).send('Download not found');
    const totalDownloads = await db.getAllTimeDownloadCount();
    if (gamificationEnabled && !isUnlocked(matchedAsset, totalDownloads)) {
      return res.status(403).send('Asset is locked');
    }

    const s3 = getS3Client();
    if (!s3) return res.redirect(302, downloadUrl);

    const key = keyFromDownloadUrl(downloadUrl);
    if (!key) return res.redirect(302, downloadUrl);

    const bucket = getBucket();
    const filename = key.split('/').pop() || 'download';
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const s3Resp = await s3.send(command);
    res.set('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '\\"') + '"');
    if (s3Resp.ContentType) res.set('Content-Type', s3Resp.ContentType);
    if (s3Resp.ContentLength) res.set('Content-Length', String(s3Resp.ContentLength));
    s3Resp.Body.pipe(res);
  } catch (e) {
    console.error('Download error:', e);
    res.status(500).send('Download failed');
  }
});

// ─── Public: batch download as ZIP (asset ids → all variants zipped) ─────
app.post('/api/download-zip', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) return res.status(400).json({ error: 'No ids provided' });
  const s3 = getS3Client();
  if (!s3) return res.status(503).json({ error: 'Downloads not available' });
  try {
    const gamificationEnabled = await db.getGamificationEnabled();
    const data = await readData();
    const list = Array.isArray(data) ? data : [];
    const totalDownloads = await db.getAllTimeDownloadCount();

    // Collect (asset, variant) pairs
    const toZip = [];
    for (const id of ids) {
      const asset = list.find((i) => i.id === id);
      if (!asset) continue;
      if (gamificationEnabled && !isUnlocked(asset, totalDownloads)) continue;
      for (const v of (asset.variants || [])) {
        if (v.downloadUrl && v.downloadUrl !== '#') toZip.push({ asset, variant: v });
      }
    }
    if (toZip.length === 0) return res.status(404).json({ error: 'No valid downloads found' });

    const category = toZip[0].asset.category || 'downloads';
    const zipName = 'maya-' + category + '.zip';
    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="' + zipName.replace(/"/g, '\\"') + '"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('Zip error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    const bucket = getBucket();
    for (const { asset, variant } of toZip) {
      const key = keyFromDownloadUrl(variant.downloadUrl);
      if (!key) continue;
      const ext = path.extname(key) || '';
      const baseName = [asset.title, variant.name].filter(Boolean).join('-').replace(/[<>:"/\\|?*]/g, '-').trim() || asset.id;
      try {
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const obj = await s3.send(cmd);
        archive.append(obj.Body, { name: baseName + ext });
      } catch (e) {
        console.warn('Skip zip entry:', key, e.message);
      }
    }
    await archive.finalize();
  } catch (e) {
    console.error('Download zip error:', e);
    if (!res.headersSent) res.status(500).json({ error: 'Failed to create zip' });
  }
});

// ─── Public API: only visible assets ─────────────────────────────────────
app.get('/api/downloads', async (req, res) => {
  try {
    const gamificationEnabled = await db.getGamificationEnabled();
    const data = await readData();
    const totalDownloads = await db.getAllTimeDownloadCount();
    const visible = (Array.isArray(data) ? data : []).filter(
      (i) => i.visible !== false
    );
    res.json(visible.map((asset) => (
      gamificationEnabled
        ? sanitizePublicAsset(asset, totalDownloads)
        : sanitizePublicAssetNoGamification(asset)
    )));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load downloads' });
  }
});

// ─── Public: unlock progress summary ───────────────────────────────────────
app.get('/api/unlocks/progress', async (req, res) => {
  try {
    const gamificationEnabled = await db.getGamificationEnabled();
    const data = await readData();
    const visible = (Array.isArray(data) ? data : []).filter((i) => i.visible !== false);
    const totalDownloads = await db.getAllTimeDownloadCount();
    if (!gamificationEnabled) {
      return res.json({
        totalDownloads,
        hasActiveGoal: false,
        nextThreshold: null,
        downloadsToNext: 0,
        progressPct: 100,
        nextAsset: null,
      });
    }
    res.json(buildUnlockProgress(visible, totalDownloads));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load unlock progress' });
  }
});

// ─── Admin: all assets ──────────────────────────────────────────────────
app.get('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    res.json(Array.isArray(data) ? data : []);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load' });
  }
});

// ─── Admin: upload file to S3 ───────────────────────────────────────────
app.post(
  '/api/admin/upload',
  (req, res, next) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    next();
  },
  upload.single('file'),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    const s3 = getS3Client();
    const bucket = getBucket();
    if (!s3) {
      return res.status(503).json({ error: 'S3 not configured' });
    }
    try {
      const ext = path.extname(req.file.originalname) || '';
      const base = `uploads/${uuidv4()}${ext}`;
      const key = base.replace(/\\/g, '/');

      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          ContentLength: req.file.size,
          CacheControl: 'public, max-age=31536000, immutable',
        })
      );
      const url = getPublicUrl(key);
      const fileSize = formatBytes(req.file.size);
      let thumbnailUrl = null;
      let imageWidth = null;
      let imageHeight = null;
      let resolution = null;

      // Generate thumbnail for images
      const imgMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (imgMimes.includes(req.file.mimetype)) {
        try {
          const meta = await sharp(req.file.buffer).metadata();
          if (meta && meta.width && meta.height) {
            imageWidth = meta.width;
            imageHeight = meta.height;
            resolution = `${meta.width}x${meta.height}`;
          }
          const thumbBuffer = await sharp(req.file.buffer)
            .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          const thumbKey = `uploads/thumbs/${path.basename(key, path.extname(key))}.jpg`;
          await s3.send(
            new PutObjectCommand({
              Bucket: bucket,
              Key: thumbKey,
              Body: thumbBuffer,
              ContentType: 'image/jpeg',
              ContentLength: thumbBuffer.length,
              CacheControl: 'public, max-age=31536000, immutable',
            })
          );
          thumbnailUrl = getPublicUrl(thumbKey);
        } catch (err) {
          console.warn('Thumbnail generation failed:', err.message);
        }
      }

      res.json({ url, fileSize, thumbnailUrl, imageWidth, imageHeight, resolution });
    } catch (e) {
      console.error('Upload error:', e);
      res.status(500).json({ error: e.message || 'Upload failed' });
    }
  }
);

// ─── Admin: create asset (new variants schema) ──────────────────────────
app.post('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    const body = req.body;
    const item = {
      id: uuidv4(),
      title: body.title || '',
      description: body.description || '',
      category: body.category || '',
      thumbnailUrl: body.thumbnailUrl || '',
      visible: body.visible !== false,
      unlockThreshold: toUnlockThreshold(body.unlockThreshold),
      createdAt: new Date().toISOString(),
      tags: body.tags || [],
      variants: Array.isArray(body.variants) ? body.variants.map((v) => ({
        id: v.id || uuidv4(),
        name: v.name || 'Download',
        resolution: v.resolution || '',
        fileSize: v.fileSize || '',
        downloadUrl: v.downloadUrl || '#',
      })) : [],
    };
    if (body.format !== undefined) item.format = body.format;
    if (body.chapter !== undefined) item.chapter = body.chapter;
    data.unshift(item);
    await writeData(data);
    scheduleOrphanCleanup();
    res.json(item);
  } catch (e) {
    res.status(500).json({ error: 'Failed to save' });
  }
});

// ─── Admin: update asset ─────────────────────────────────────────────────
app.patch('/api/admin/downloads/:id', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    const id = req.params.id;
    const idx = data.findIndex((i) => i.id === id);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const body = req.body;
    const scalarFields = ['title', 'description', 'category', 'thumbnailUrl', 'format', 'chapter', 'tags', 'visible'];
    scalarFields.forEach((k) => { if (body[k] !== undefined) data[idx][k] = body[k]; });
    if (body.unlockThreshold !== undefined) {
      data[idx].unlockThreshold = toUnlockThreshold(body.unlockThreshold);
    }
    if (Array.isArray(body.variants)) {
      data[idx].variants = body.variants.map((v) => ({
        id: v.id || uuidv4(),
        name: v.name || 'Download',
        resolution: v.resolution || '',
        fileSize: v.fileSize || '',
        downloadUrl: v.downloadUrl || '#',
      }));
    }
    await writeData(data);
    scheduleOrphanCleanup();
    res.json(data[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

// ─── Admin: delete asset ────────────────────────────────────────────────
app.delete('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const { id } = req.body;
    let data = await readData();
    data = data.filter((i) => i.id !== id);
    await writeData(data);
    scheduleOrphanCleanup();
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// ─── Admin: categories CRUD ───────────────────────────────────────────────
app.get('/api/admin/categories', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cats = await readCats();
    res.json(cats.sort((a, b) => (a.order || 99) - (b.order || 99)));
  } catch (e) {
    res.status(500).json({ error: 'Failed to load categories' });
  }
});

app.post('/api/admin/categories', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cats = await readCats();
    const { slug, label, desc } = req.body;
    if (!slug || !label) return res.status(400).json({ error: 'slug and label required' });
    const clean = slug.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
    if (cats.find((c) => c.slug === clean)) return res.status(409).json({ error: 'Category already exists' });
    const cat = { slug: clean, label, desc: desc || '', colorClass: 'home-box-custom', visible: true, order: cats.length + 1, builtIn: false };
    cats.push(cat);
    await writeCats(cats);
    res.json(cat);
  } catch (e) {
    res.status(500).json({ error: 'Failed to add category' });
  }
});

app.patch('/api/admin/categories/:slug', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const cats = await readCats();
    const idx = cats.findIndex((c) => c.slug === req.params.slug);
    if (idx === -1) return res.status(404).json({ error: 'Not found' });
    const allowed = ['visible', 'label', 'desc', 'order'];
    allowed.forEach((k) => { if (req.body[k] !== undefined) cats[idx][k] = req.body[k]; });
    await writeCats(cats);
    res.json(cats[idx]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update category' });
  }
});

app.delete('/api/admin/categories/:slug', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    let cats = await readCats();
    const cat = cats.find((c) => c.slug === req.params.slug);
    if (!cat) return res.status(404).json({ error: 'Not found' });
    if (cat.builtIn) return res.status(403).json({ error: 'Cannot delete a built-in category' });
    cats = cats.filter((c) => c.slug !== req.params.slug);
    await writeCats(cats);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete category' });
  }
});

// ─── Tracking helpers ────────────────────────────────────────────────────
function getIp(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (fwd) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || '';
}

function parseUA(ua) {
  if (!ua) return { browser: '', bver: '', os: '', osver: '', device: 'desktop' };
  let browser = '', bver = '', os = '', osver = '', device = 'desktop', m;
  if (/Mobi|Android(?!.*Tablet)|iPhone|iPod|Windows Phone/i.test(ua)) device = 'mobile';
  else if (/iPad|Tablet|PlayBook/i.test(ua)) device = 'tablet';
  if      ((m = ua.match(/Edg\/([\d.]+)/)))           { browser = 'Edge';    bver = m[1]; }
  else if ((m = ua.match(/OPR\/([\d.]+)/)))            { browser = 'Opera';   bver = m[1]; }
  else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) { browser = 'Samsung'; bver = m[1]; }
  else if ((m = ua.match(/Chrome\/([\d.]+)/)))         { browser = 'Chrome';  bver = m[1]; }
  else if ((m = ua.match(/Firefox\/([\d.]+)/)))        { browser = 'Firefox'; bver = m[1]; }
  else if ((m = ua.match(/Version\/([\d.]+).*Safari/))){ browser = 'Safari';  bver = m[1]; }
  if      ((m = ua.match(/Windows NT ([\d.]+)/)))      { os = 'Windows'; osver = m[1]; }
  else if ((m = ua.match(/Mac OS X ([\d_]+)/)))        { os = 'macOS';   osver = m[1].replace(/_/g, '.'); }
  else if ((m = ua.match(/Android ([\d.]+)/)))         { os = 'Android'; osver = m[1]; }
  else if (/iPhone|iPad|iPod/.test(ua) && (m = ua.match(/OS ([\d_]+)/))) { os = 'iOS'; osver = m[1].replace(/_/g, '.'); }
  else if (/Linux/.test(ua)) os = 'Linux';
  return { browser, bver, os, osver, device };
}

const geoCache = new Map();
async function getGeo(ip) {
  const localRanges = ['127.', '::1', '192.168.', '10.', '172.'];
  if (!ip || localRanges.some((p) => ip.startsWith(p))) {
    return { country: 'Local', region: '', city: '', isp: '', lat: 0, lon: 0, tz: '' };
  }
  if (geoCache.has(ip)) return geoCache.get(ip);
  try {
    const r = await fetch(`http://ip-api.com/json/${ip}?fields=country,regionName,city,isp,lat,lon,timezone`);
    const d = await r.json();
    const geo = {
      country: d.country || '', region: d.regionName || '', city: d.city || '',
      isp: d.isp || '', lat: d.lat || 0, lon: d.lon || 0, tz: d.timezone || '',
    };
    if (geoCache.size > 5000) geoCache.clear();
    geoCache.set(ip, geo);
    return geo;
  } catch {
    return { country: '', region: '', city: '', isp: '', lat: 0, lon: 0, tz: '' };
  }
}

// ─── Public: receive tracking beacon ─────────────────────────────────────
app.post('/api/track', async (req, res) => {
  res.status(204).end();
  try {
    const body = req.body;
    if (!body || !body.type || !body.sid) return;
    const ip  = getIp(req);
    const ua  = req.headers['user-agent'] || '';
    const { browser, bver, os, osver, device } = parseUA(ua);
    const utm = body.utm || {};
    const ts  = new Date().toISOString();
    const s = (v, n) => (String(v || '')).slice(0, n);

    if (body.type === 'pageview') {
      const geo = await getGeo(ip);
      await db.insertVisit({
        session_id:   body.sid,
        ts,
        page:         s(body.page, 200),
        referrer:     s(body.referrer, 500),
        utm_source:   s(utm.source, 100),
        utm_medium:   s(utm.medium, 100),
        utm_campaign: s(utm.campaign, 100),
        utm_content:  s(utm.content, 100),
        utm_term:     s(utm.term, 100),
        ip:           s(ip, 45),
        country:      geo.country,
        region:       geo.region,
        city:         geo.city,
        isp:          geo.isp,
        lat:          geo.lat,
        lon:          geo.lon,
        geo_tz:       geo.tz,
        ua:           s(ua, 300),
        browser,
        browser_ver:  bver,
        os,
        os_ver:       osver,
        device,
        screen_w:     body.screen && body.screen.w ? Number(body.screen.w) : null,
        screen_h:     body.screen && body.screen.h ? Number(body.screen.h) : null,
        lang:         s(body.lang, 20),
        client_tz:    s(body.tz, 60),
      });
    } else {
      await db.insertEvent({
        session_id:     body.sid,
        ts,
        type:           s(body.type, 30),
        asset_id:       s(body.asset_id, 100),
        asset_title:    s(body.asset_title, 200),
        asset_category: s(body.asset_category, 50),
        page:           s(body.page, 200),
        utm_source:     s(utm.source, 100),
        utm_campaign:   s(utm.campaign, 100),
        utm_term:       s(utm.term, 100),
      });
    }
  } catch (e) {
    console.error('Track error:', e.message);
  }
});

// ─── Admin: analytics stats ───────────────────────────────────────────────
app.get('/api/admin/analytics', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const days = Math.min(Math.max(parseInt(req.query.days) || 30, 1), 365);
    res.json(await db.getStats(days));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/admin/dashboard', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    res.json(await db.getDownloadDashboard());
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load dashboard' });
  }
});

app.get('/api/admin/gamification', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const enabled = await db.getGamificationEnabled();
    res.json({ enabled });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to load gamification setting' });
  }
});

app.patch('/api/admin/gamification', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const enabled = req.body && req.body.enabled !== false;
    await db.setGamificationEnabled(enabled);
    res.json({ enabled });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to update gamification setting' });
  }
});

app.listen(PORT, () => {
  console.log('MAYA Downloads running at http://localhost:' + PORT);
});
