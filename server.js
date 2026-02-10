require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const sharp = require('sharp');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');


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
  res.sendFile(path.join(__dirname, 'public', 'wallpapers.html'));
});
app.get('/ebook', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'ebook.html'));
});
app.get('/stl', (req, res) => {
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

      // Generate thumbnail for images
      const imgMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
      if (imgMimes.includes(req.file.mimetype)) {
        try {
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

      res.json({ url, fileSize, thumbnailUrl });
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

app.listen(PORT, () => {
  console.log('MAYA Downloads running at http://localhost:' + PORT);
});
