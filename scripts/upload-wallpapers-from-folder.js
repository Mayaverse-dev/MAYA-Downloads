/**
 * Upload local wallpapers from ./Wallpaper/<set>/<file>.png to S3 and append them to data/downloads.json.
 *
 * - Skips Thumbs.db and non-png files.
 * - Uploads full image to: Assets/Wallpaper/Library/<Set>/<Variant>.png
 * - Uploads thumbnail webp to: _thumbs/<fullKey>.webp (same convention as scripts/fix-wallpapers.js)
 * - Adds/updates items in downloads.json with title grouped by folder name.
 *
 * Usage:
 *   S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... S3_BUCKET=... node scripts/upload-wallpapers-from-folder.js
 *
 * Notes:
 * - Requires S3_* vars (same as server.js).
 * - Does not delete or overwrite downloads.json entries unless the id matches.
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const fsp = require('fs').promises;
const path = require('path');
const sharp = require('sharp');
const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

const DATA_PATH = path.join(__dirname, '..', 'data', 'downloads.json');
const WALLPAPER_ROOT = path.join(__dirname, '..', 'Wallpaper');

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

function slug(s) {
  return String(s || '')
    .trim()
    .toLowerCase()
    .replace(/[_\s]+/g, '-')
    .replace(/[^a-z0-9-]+/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function humanizeSetName(dir) {
  // Keep acronyms-ish names readable: RK_SASWAT -> RK SASWAT
  return String(dir || '').replace(/_/g, ' ').trim();
}

function normalizeVariantName(base) {
  const k = String(base || '').toLowerCase().replace(/\s+/g, ' ').trim();
  const map = {
    'andriod': 'Android',
    'android': 'Android',
    'iphones': 'iPhone',
    'iphone': 'iPhone',
    'tablet': 'Tablet',
    'mackbook': 'Macbook',
    'macbook': 'Macbook',
    'ultrawide': 'Ultrawide',
    'standard hd': 'Standard HD',
    '4k ultra hd': '4K Ultra HD',
  };
  return map[k] || base;
}

function wallpaperTypeFromVariant(variant) {
  const v = String(variant || '').toLowerCase();
  if (v.includes('android') || v.includes('iphone') || v.includes('tablet')) return 'mobile';
  return 'desktop';
}

async function listWallpaperFiles() {
  if (!fs.existsSync(WALLPAPER_ROOT)) return [];
  const out = [];
  const sets = await fsp.readdir(WALLPAPER_ROOT);
  for (const set of sets) {
    const setDir = path.join(WALLPAPER_ROOT, set);
    const st = await fsp.stat(setDir);
    if (!st.isDirectory()) continue;
    const files = await fsp.readdir(setDir);
    for (const file of files) {
      if (!/\.png$/i.test(file)) continue;
      if (file.toLowerCase() === 'thumbs.db') continue;
      out.push({ set, file, fullPath: path.join(setDir, file) });
    }
  }
  return out;
}

async function main() {
  const s3 = getS3Client();
  if (!s3) {
    console.error('S3 not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (and optionally S3_BUCKET/S3_ENDPOINT) in .env');
    process.exit(1);
  }
  const bucket = getBucket();

  const raw = await fsp.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) throw new Error('downloads.json must be an array');

  const files = await listWallpaperFiles();
  console.log('Wallpaper files found:', files.length);

  const existingById = new Map(data.map((i) => [i.id, i]));

  for (const item of files) {
    const setTitle = humanizeSetName(item.set);
    const variantBase = path.basename(item.file, path.extname(item.file));
    const variant = normalizeVariantName(variantBase);

    const id = `wp-lib-${slug(setTitle)}-${slug(variant)}`;
    if (existingById.has(id)) {
      console.log('Skip (already in downloads.json):', id);
      continue;
    }

    const buf = await fsp.readFile(item.fullPath);
    const meta = await sharp(buf).metadata();
    const resolution = meta && meta.width && meta.height ? `${meta.width}x${meta.height}` : '';

    const key = `Assets/Wallpaper/Library/${item.set}/${variantBase}.png`.replace(/\\/g, '/');
    const thumbKey = `_thumbs/${key}.webp`.replace(/\\/g, '/');

    // Upload full image
    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buf,
      ContentType: 'image/png',
      ContentLength: buf.length,
    }));

    // Upload thumbnail webp
    const thumbBuf = await sharp(buf)
      .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toBuffer();

    await s3.send(new PutObjectCommand({
      Bucket: bucket,
      Key: thumbKey,
      Body: thumbBuf,
      ContentType: 'image/webp',
      ContentLength: thumbBuf.length,
    }));

    const downloadUrl = getPublicUrl(key);
    const thumbnailUrl = getPublicUrl(thumbKey);
    const fileSize = formatBytes(buf.length);

    const entry = {
      id,
      title: setTitle,
      subtitle: variant,
      description: `${setTitle} wallpaper from the MAYA universe.`,
      category: 'wallpapers',
      type: wallpaperTypeFromVariant(variant),
      resolution: resolution || undefined,
      thumbnailUrl,
      downloadUrl,
      fileSize,
      tags: [slug(setTitle)].filter(Boolean),
      createdAt: new Date().toISOString(),
      visible: true,
    };
    Object.keys(entry).forEach((k) => entry[k] === undefined && delete entry[k]);

    data.unshift(entry);
    existingById.set(id, entry);
    console.log('Uploaded + added:', id, '->', key);
  }

  await fsp.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log('Updated', DATA_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

