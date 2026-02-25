require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const archiver = require('archiver');
const analytics = require('./db');

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
  const host = (req.headers['host'] || '').split(':')[0];
  if (host === 'localhost' || host === '127.0.0.1') return true;
  const pw = req.headers['x-admin-password'] || req.query.pw;
  return pw && pw === process.env.ADMIN_PASSWORD;
}

/** Visible categories: comma-separated env VISIBLE_CATEGORIES (e.g. "ebook"); omit = all */
function getVisibleCategories() {
  const raw = cleanEnv(process.env.VISIBLE_CATEGORIES);
  if (!raw) return ['wallpapers', 'ebook', 'stl'];
  return raw.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
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

async function readData() {
  try {
    const raw = await fs.readFile(DATA_PATH, 'utf8');
    return JSON.parse(raw);
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
app.get('/wallpapers', (req, res) => {
  if (!getVisibleCategories().includes('wallpapers')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'wallpapers.html'));
});
app.get('/ebook', (req, res) => {
  if (!getVisibleCategories().includes('ebook')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'ebook.html'));
});
app.get('/stl', (req, res) => {
  if (!getVisibleCategories().includes('stl')) return res.redirect(302, '/');
  res.sendFile(path.join(__dirname, 'public', 'stl.html'));
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

// ─── Public: analytics + visibility config (no secrets) ─────────────────────
app.get('/api/config', (req, res) => {
  res.json({
    gaId: cleanEnv(process.env.GA_ID) || '',
    metaPixelId: cleanEnv(process.env.META_PIXEL_ID) || '',
    visibleCategories: getVisibleCategories(),
  });
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
    if (obj.CacheControl) res.set('Cache-Control', obj.CacheControl);
    obj.Body.pipe(res);
  } catch (e) {
    console.error('Thumbnail error:', e);
    if (!res.headersSent) res.status(500).end();
  }
});

// ─── Public: stream download from S3 (or redirect if S3 not configured) ─
app.get('/api/download/:id', async (req, res) => {
  try {
    const data = await readData();
    const item = (Array.isArray(data) ? data : []).find((i) => i.id === req.params.id);
    if (!item || !item.downloadUrl || item.downloadUrl === '#') {
      return res.status(404).send('Download not found');
    }
    const s3 = getS3Client();
    if (!s3) {
      console.warn('S3 not configured (missing S3_ACCESS_KEY_ID/S3_SECRET_ACCESS_KEY). Redirecting to direct URL.');
      return res.redirect(302, item.downloadUrl);
    }
    const key = keyFromDownloadUrl(item.downloadUrl);
    if (!key) {
      return res.redirect(302, item.downloadUrl);
    }
    const bucket = getBucket();
    const filename = key.split('/').pop() || 'download';
    // Stream file through server instead of presigned URL redirect
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

// ─── Public: batch download as ZIP ───────────────────────────────────────
app.post('/api/download-zip', async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
  if (ids.length === 0) {
    return res.status(400).json({ error: 'No ids provided' });
  }
  const s3 = getS3Client();
  if (!s3) {
    return res.status(503).json({ error: 'Downloads not available' });
  }
  try {
    const data = await readData();
    const list = Array.isArray(data) ? data : [];
    const items = ids
      .map((id) => list.find((i) => i.id === id))
      .filter((i) => i && i.downloadUrl && i.downloadUrl !== '#');
    if (items.length === 0) {
      return res.status(404).json({ error: 'No valid downloads found' });
    }
    const bucket = getBucket();
    const category = items[0].category || 'downloads';
    const zipName = 'maya-' + category + '.zip';

    res.set('Content-Type', 'application/zip');
    res.set('Content-Disposition', 'attachment; filename="' + zipName.replace(/"/g, '\\"') + '"');

    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      console.error('Zip error:', err);
      if (!res.headersSent) res.status(500).end();
    });
    archive.pipe(res);

    for (const item of items) {
      const key = keyFromDownloadUrl(item.downloadUrl);
      if (!key) continue;
      const ext = path.extname(key) || '';
      const base = (item.title || item.id || 'file').replace(/[<>:"/\\|?*]/g, '-').trim() || item.id;
      const name = base + ext;
      try {
        const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
        const obj = await s3.send(cmd);
        archive.append(obj.Body, { name });
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
    const data = await readData();
    const visible = (Array.isArray(data) ? data : []).filter(
      (i) => i.visible !== false
    );
    res.json(visible);
  } catch (e) {
    res.status(500).json({ error: 'Failed to load downloads' });
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

// ─── Admin: create asset ────────────────────────────────────────────────
app.post('/api/admin/downloads', async (req, res) => {
  if (!checkAdmin(req)) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const data = await readData();
    const body = req.body;
    const item = {
      id: uuidv4(),
      title: body.title,
      subtitle: body.subtitle,
      description: body.description,
      category: body.category,
      type: body.type,
      resolution: body.resolution,
      thumbnailUrl: body.thumbnailUrl || '',
      downloadUrl: body.downloadUrl || '#',
      fileSize: body.fileSize,
      format: body.format,
      tags: body.tags || [],
      chapter: body.chapter,
      visible: body.visible !== false,
      createdAt: new Date().toISOString(),
    };
    Object.keys(item).forEach((k) => item[k] === undefined && delete item[k]);
    data.unshift(item);
    await writeData(data);
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
    const allowed = [
      'title', 'subtitle', 'description', 'category', 'type', 'resolution',
      'thumbnailUrl', 'downloadUrl', 'fileSize', 'format', 'chapter',
      'tags', 'visible',
    ];
    allowed.forEach((k) => {
      if (body[k] !== undefined) data[idx][k] = body[k];
    });
    if (body.visible === true || body.visible === false) {
      data[idx].visible = body.visible;
    }
    await writeData(data);
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
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete' });
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
      await analytics.insertVisit({
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
      await analytics.insertEvent({
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
    res.json(await analytics.getStats(days));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log('MAYA Downloads running at http://localhost:' + PORT);
});
