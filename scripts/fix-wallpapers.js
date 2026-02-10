/**
 * Run on localhost: download all wallpapers from S3, regenerate thumbnails,
 * fix mobile wallpaper titles. Updates data/downloads.json in place.
 *
 * Usage: node scripts/fix-wallpapers.js
 * Requires: .env with S3_* vars (same as server)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const path = require('path');
const fs = require('fs').promises;
const sharp = require('sharp');
const { S3Client, GetObjectCommand, PutObjectCommand } = require('@aws-sdk/client-s3');

const DATA_PATH = path.join(__dirname, '..', 'data', 'downloads.json');

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

function keyFromDownloadUrl(downloadUrl, bucket) {
  if (!downloadUrl || downloadUrl === '#') return null;
  try {
    const u = new URL(downloadUrl);
    const pathname = u.pathname.replace(/^\/+/, '');
    const prefix = bucket + '/';
    if (pathname.startsWith(prefix)) {
      return decodeURIComponent(pathname.slice(prefix.length));
    }
    return null;
  } catch (e) {
    return null;
  }
}

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}

// Friendly titles for mobile wallpapers (remove codes like GA03, KU02)
const MOBILE_TITLE_FIX = {
  'Garuda GA03': 'Garuda',
  'Kuli KU02': 'Kuli',
  'Naag NA06': 'Naag',
  'Rakshasi RK01': 'Rakshasi',
  'Rakshasi RK04': 'Rakshasi (2)',
  'Vaanar ENV05': 'Vaanar',
};

async function main() {
  const s3 = getS3Client();
  if (!s3) {
    console.error('S3 not configured. Set S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY in .env');
    process.exit(1);
  }
  const bucket = getBucket();
  console.log('Bucket:', bucket);

  const raw = await fs.readFile(DATA_PATH, 'utf8');
  const data = JSON.parse(raw);
  if (!Array.isArray(data)) {
    console.error('downloads.json is not an array');
    process.exit(1);
  }

  const wallpapers = data.filter((i) => i.category === 'wallpapers');
  console.log('Wallpapers to process:', wallpapers.length);

  for (const item of wallpapers) {
    const key = keyFromDownloadUrl(item.downloadUrl, bucket);
    if (!key) {
      console.warn('Skip (no key):', item.id);
      continue;
    }

    // Fix mobile title
    if (item.type === 'mobile' && item.title && MOBILE_TITLE_FIX[item.title]) {
      item.title = MOBILE_TITLE_FIX[item.title];
      console.log('Renamed:', item.id, '->', item.title);
    }

    // Download full image from S3
    let buffer;
    try {
      const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
      const obj = await s3.send(cmd);
      buffer = await streamToBuffer(obj.Body);
    } catch (e) {
      console.warn('Download failed', item.id, e.message);
      continue;
    }

    // Thumbnail: same path under _thumbs with .webp suffix (e.g. key.png -> _thumbs/key.png.webp)
    const thumbKey = '_thumbs/' + key + '.webp';
    try {
      const thumbBuffer = await sharp(buffer)
        .resize(400, 400, { fit: 'inside', withoutEnlargement: true })
        .webp({ quality: 80 })
        .toBuffer();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: thumbKey,
          Body: thumbBuffer,
          ContentType: 'image/webp',
          ContentLength: thumbBuffer.length,
        })
      );
      item.thumbnailUrl = getPublicUrl(thumbKey);
      console.log('Thumb:', item.id, thumbKey);
    } catch (e) {
      console.warn('Thumb failed', item.id, e.message);
    }
  }

  await fs.writeFile(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
  console.log('Wrote', DATA_PATH);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
