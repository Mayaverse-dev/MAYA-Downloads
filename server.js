require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs').promises;
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const sharp = require('sharp');
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} = require('@aws-sdk/client-s3');
const archiver = require('archiver');
const db = require('./db');
const { createAssetsService } = require('./services/assets');
const unlockService = require('./services/unlocks');
const { createPublicRouter } = require('./routes/public');
const { createAdminRouter } = require('./routes/admin');

const app = express();
const PORT = process.env.PORT || 3000;
const ROOT_DIR = __dirname;
const DATA_PATH = path.join(ROOT_DIR, 'data', 'downloads.json');
const CATS_PATH = path.join(ROOT_DIR, 'data', 'categories.json');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 500 * 1024 * 1024 },
});

app.use(express.json());
app.use(express.static(path.join(ROOT_DIR, 'public'), { index: false }));

function checkAdmin(req) {
  const pw = req.headers['x-admin-password'] || req.query.pw;
  return pw && pw === process.env.ADMIN_PASSWORD;
}

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

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
  if (bytes >= 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return bytes + ' B';
}

const assetService = createAssetsService({
  fs,
  dataPath: DATA_PATH,
  uuidv4,
  toUnlockThreshold: unlockService.toUnlockThreshold,
  getS3Client,
  getBucket,
  keyFromDownloadUrl,
  ListObjectsV2Command,
  DeleteObjectCommand,
});

app.use(createPublicRouter({
  path,
  rootDir: ROOT_DIR,
  db,
  readCats,
  catIsVisible,
  getS3Client,
  getBucket,
  cleanEnv,
  keyFromDownloadUrl,
  GetObjectCommand,
  archiver,
  assetService,
  unlockService,
}));

app.use(createAdminRouter({
  path,
  rootDir: ROOT_DIR,
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
}));

app.listen(PORT, () => {
  console.log('MAYA Downloads running at http://localhost:' + PORT);
});
