'use strict';

const express = require('express');

function createAdminRouter(deps) {
  const {
    path,
    rootDir,
    checkAdmin,
    db,
    readCats,
    writeCats,
    getS3Client,
    getBucket,
    getPublicUrl,
    formatBytes,
    upload,
    sharp,
    uuidv4,
    PutObjectCommand,
    assetService,
  } = deps;

  const router = express.Router();

  router.get('/admin', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'admin.html'));
  });

  router.get('/api/admin/downloads', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await assetService.readData();
      res.json(Array.isArray(data) ? data : []);
    } catch (e) {
      res.status(500).json({ error: 'Failed to load' });
    }
  });

  router.post(
    '/api/admin/upload',
    (req, res, next) => {
      if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
      next();
    },
    upload.single('file'),
    async (req, res) => {
      if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
      const s3 = getS3Client();
      const bucket = getBucket();
      if (!s3) return res.status(503).json({ error: 'S3 not configured' });
      try {
        const ext = path.extname(req.file.originalname) || '';
        const base = `uploads/${uuidv4()}${ext}`;
        const key = base.replace(/\\/g, '/');

        await s3.send(new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: req.file.buffer,
          ContentType: req.file.mimetype,
          ContentLength: req.file.size,
          CacheControl: 'public, max-age=31536000, immutable',
        }));

        const url = getPublicUrl(key);
        const fileSize = formatBytes(req.file.size);
        let thumbnailUrl = null;
        let imageWidth = null;
        let imageHeight = null;
        let resolution = null;

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
            await s3.send(new PutObjectCommand({
              Bucket: bucket,
              Key: thumbKey,
              Body: thumbBuffer,
              ContentType: 'image/jpeg',
              ContentLength: thumbBuffer.length,
              CacheControl: 'public, max-age=31536000, immutable',
            }));
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

  router.post('/api/admin/downloads', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await assetService.readData();
      const item = assetService.createAdminAsset(req.body || {});
      data.unshift(item);
      await assetService.writeData(data);
      assetService.scheduleOrphanCleanup();
      res.json(item);
    } catch (e) {
      res.status(500).json({ error: 'Failed to save' });
    }
  });

  router.patch('/api/admin/downloads/:id', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await assetService.readData();
      const id = req.params.id;
      const idx = data.findIndex((i) => i.id === id);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      assetService.applyAdminAssetPatch(data[idx], req.body || {});
      await assetService.writeData(data);
      assetService.scheduleOrphanCleanup();
      res.json(data[idx]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to update' });
    }
  });

  router.delete('/api/admin/downloads', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const id = req.body && req.body.id;
      let data = await assetService.readData();
      data = data.filter((i) => i.id !== id);
      await assetService.writeData(data);
      assetService.scheduleOrphanCleanup();
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ error: 'Failed to delete' });
    }
  });

  router.get('/api/admin/categories', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const cats = await readCats();
      res.json(cats.sort((a, b) => (a.order || 99) - (b.order || 99)));
    } catch (e) {
      res.status(500).json({ error: 'Failed to load categories' });
    }
  });

  router.post('/api/admin/categories', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const cats = await readCats();
      const { slug, label, desc } = req.body || {};
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

  router.patch('/api/admin/categories/:slug', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const cats = await readCats();
      const idx = cats.findIndex((c) => c.slug === req.params.slug);
      if (idx === -1) return res.status(404).json({ error: 'Not found' });
      const allowed = ['visible', 'label', 'desc', 'order'];
      allowed.forEach((k) => { if (req.body && req.body[k] !== undefined) cats[idx][k] = req.body[k]; });
      await writeCats(cats);
      res.json(cats[idx]);
    } catch (e) {
      res.status(500).json({ error: 'Failed to update category' });
    }
  });

  router.delete('/api/admin/categories/:slug', async (req, res) => {
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

  router.get('/api/admin/analytics', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const days = Math.min(Math.max(parseInt(req.query.days, 10) || 30, 1), 365);
      res.json(await db.getStats(days));
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/api/admin/dashboard', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      res.json(await db.getDownloadDashboard());
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to load dashboard' });
    }
  });

  router.get('/api/admin/download-data', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const data = await db.getDownloadData({
        limit: req.query.limit,
        offset: req.query.offset,
        from: req.query.from,
        to: req.query.to,
        asset_id: req.query.asset_id,
        session_id: req.query.session_id,
      });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to load download data' });
    }
  });

  router.get('/api/admin/gamification', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const enabled = await db.getGamificationEnabled();
      res.json({ enabled });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to load gamification setting' });
    }
  });

  router.patch('/api/admin/gamification', async (req, res) => {
    if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
    try {
      const enabled = req.body && req.body.enabled !== false;
      await db.setGamificationEnabled(enabled);
      res.json({ enabled });
    } catch (e) {
      res.status(500).json({ error: e.message || 'Failed to update gamification setting' });
    }
  });

  return router;
}

module.exports = { createAdminRouter };
