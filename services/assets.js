'use strict';

function createAssetsService({
  fs,
  db,
  dataPath,
  uuidv4,
  toUnlockThreshold,
  getS3Client,
  getBucket,
  keyFromDownloadUrl,
  ListObjectsV2Command,
  DeleteObjectCommand,
}) {
  const ORPHAN_CUTOFF_DAYS = 7;

  function normalizeTitle(title) {
    return (title || '').trim().replace(/\s*\(\d+\)\s*$/, '').trim();
  }

  function migrateToVariants(data) {
    if (!Array.isArray(data) || data.length === 0) return { data, changed: false };
    const needsMigration = data.some((item) => 'downloadUrl' in item && !Array.isArray(item.variants));
    if (!needsMigration) return { data, changed: false };

    const alreadyNew = data.filter((i) => Array.isArray(i.variants));
    const oldFlat = data.filter((i) => !Array.isArray(i.variants));

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

    for (const item of nonWp) {
      const {
        id, title, description, category, format, chapter, thumbnailUrl, visible, createdAt, tags,
        downloadUrl, fileSize, resolution, subtitle,
      } = item;
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

  async function readData() {
    const canUseDb = !!(db && typeof db.getAssetsData === 'function' && typeof db.saveAssetsData === 'function');
    if (canUseDb) {
      try {
        const dbData = await db.getAssetsData();
        if (Array.isArray(dbData) && dbData.length > 0) {
          const { data, changed } = migrateToVariants(dbData);
          if (changed) await db.saveAssetsData(data);
          return data;
        }
      } catch (e) {
        // fall through to file
      }
    }
    try {
      const raw = await fs.readFile(dataPath, 'utf8');
      const parsed = JSON.parse(raw);
      const { data, changed } = migrateToVariants(parsed);
      if (changed) {
        writeData(data).catch((e) => console.warn('Migration write failed:', e.message));
      }
      if (canUseDb) {
        db.saveAssetsData(data).catch((e) => console.warn('Assets DB sync failed:', e.message));
      }
      return data;
    } catch (e) {
      return [];
    }
  }

  async function writeData(data) {
    if (db && typeof db.saveAssetsData === 'function') {
      await db.saveAssetsData(data);
    }
    await fs.writeFile(dataPath, JSON.stringify(data, null, 2), 'utf8');
  }

  function createAdminAsset(body) {
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
    return item;
  }

  function applyAdminAssetPatch(asset, body) {
    const scalarFields = ['title', 'description', 'category', 'thumbnailUrl', 'format', 'chapter', 'tags', 'visible'];
    scalarFields.forEach((k) => { if (body[k] !== undefined) asset[k] = body[k]; });
    if (body.unlockThreshold !== undefined) {
      asset.unlockThreshold = toUnlockThreshold(body.unlockThreshold);
    }
    if (Array.isArray(body.variants)) {
      asset.variants = body.variants.map((v) => ({
        id: v.id || uuidv4(),
        name: v.name || 'Download',
        resolution: v.resolution || '',
        fileSize: v.fileSize || '',
        downloadUrl: v.downloadUrl || '#',
      }));
    }
    return asset;
  }

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
            const listResp = await s3.send(new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: continuationToken,
              })
            );
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

  return {
    readData,
    writeData,
    createAdminAsset,
    applyAdminAssetPatch,
    scheduleOrphanCleanup,
  };
}

module.exports = { createAssetsService };
