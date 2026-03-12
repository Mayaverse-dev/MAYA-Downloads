'use strict';

const express = require('express');

function createPublicRouter(deps) {
  const {
    path,
    rootDir,
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
  } = deps;

  const router = express.Router();
  const DEFAULT_DISCORD_INVITE = 'https://discord.gg/qsVMynfNZb';
  const DISCORD_INVITE_CACHE_TTL_MS = 5 * 60 * 1000;
  let discordInviteCache = { url: null, checkedAt: 0 };
  const EVENT_DEDUP_WINDOW_MS = 2500;
  const eventDedupCache = new Map();

  function normalizeInviteUrl(url) {
    const clean = cleanEnv(url);
    if (!clean) return '';
    try {
      const u = new URL(clean);
      if (!/^https?:$/.test(u.protocol)) return '';
      return u.toString();
    } catch (e) {
      return '';
    }
  }

  function parseDiscordInviteCode(url) {
    try {
      const u = new URL(url);
      if (u.hostname === 'discord.gg') {
        return u.pathname.replace(/^\/+/, '').split('/')[0] || '';
      }
      if (u.hostname === 'discord.com' || u.hostname === 'www.discord.com') {
        const parts = u.pathname.split('/').filter(Boolean);
        if (parts[0] === 'invite' && parts[1]) return parts[1];
      }
    } catch (e) {}
    return '';
  }

  async function isDiscordInviteValid(url) {
    const code = parseDiscordInviteCode(url);
    if (!code) return false;
    try {
      const r = await fetch(`https://discord.com/api/v10/invites/${encodeURIComponent(code)}?with_counts=true`);
      return r.ok;
    } catch (e) {
      return false;
    }
  }

  function getDiscordInviteCandidates() {
    const candidates = [
      normalizeInviteUrl(process.env.DISCORD_INVITE_URL),
      normalizeInviteUrl(process.env.DISCORD_INVITE_FALLBACK_URL),
      DEFAULT_DISCORD_INVITE,
    ].filter(Boolean);
    return [...new Set(candidates)];
  }

  async function resolveDiscordInviteUrl() {
    const now = Date.now();
    if (discordInviteCache.url && (now - discordInviteCache.checkedAt) < DISCORD_INVITE_CACHE_TTL_MS) {
      return discordInviteCache.url;
    }
    const candidates = getDiscordInviteCandidates();
    for (const url of candidates) {
      if (await isDiscordInviteValid(url)) {
        discordInviteCache = { url, checkedAt: now };
        return url;
      }
    }
    const fallback = candidates[0] || DEFAULT_DISCORD_INVITE;
    discordInviteCache = { url: fallback, checkedAt: now };
    return fallback;
  }

  function shouldDedupDownloadEvent(body) {
    if (!body || body.type !== 'download' || !body.sid || !body.asset_id) return false;
    const now = Date.now();
    const key = `${body.sid}|${body.asset_id}|${body.page || ''}`;
    const prev = Number(eventDedupCache.get(key) || 0);
    eventDedupCache.set(key, now);
    if (eventDedupCache.size > 5000) {
      const cutoff = now - EVENT_DEDUP_WINDOW_MS * 4;
      for (const [k, ts] of eventDedupCache.entries()) {
        if (ts < cutoff) eventDedupCache.delete(k);
      }
    }
    return prev > 0 && (now - prev) < EVENT_DEDUP_WINDOW_MS;
  }

  router.get('/', (req, res) => {
    res.sendFile(path.join(rootDir, 'public', 'index.html'));
  });

  router.get('/wallpapers', async (req, res) => {
    if (!await catIsVisible('wallpapers')) return res.redirect(302, '/');
    res.sendFile(path.join(rootDir, 'public', 'category-page.html'));
  });

  router.get('/ebook', async (req, res) => {
    if (!await catIsVisible('ebook')) return res.redirect(302, '/');
    res.sendFile(path.join(rootDir, 'public', 'category-page.html'));
  });

  router.get('/stl', async (req, res) => {
    if (!await catIsVisible('stl')) return res.redirect(302, '/');
    res.sendFile(path.join(rootDir, 'public', 'category-page.html'));
  });

  router.get('/c/:slug', async (req, res) => {
    const cats = await readCats();
    const cat = cats.find((c) => c.slug === req.params.slug);
    if (!cat || !cat.visible) return res.redirect(302, '/');
    res.sendFile(path.join(rootDir, 'public', 'category-page.html'));
  });

  router.get('/api/health', (req, res) => {
    const s3 = getS3Client();
    res.json({
      s3Configured: !!s3,
      hasAccessKeyId: !!cleanEnv(process.env.S3_ACCESS_KEY_ID),
      hasSecretAccessKey: !!cleanEnv(process.env.S3_SECRET_ACCESS_KEY),
      bucket: getBucket(),
      endpoint: cleanEnv(process.env.S3_ENDPOINT) || '(default)',
    });
  });

  router.get('/api/config', (req, res) => {
    res.json({
      gaId: cleanEnv(process.env.GA_ID) || '',
      metaPixelId: cleanEnv(process.env.META_PIXEL_ID) || '',
    });
  });

  router.get('/api/discord-invite', async (req, res) => {
    try {
      res.json({ url: await resolveDiscordInviteUrl() });
    } catch (e) {
      res.json({ url: DEFAULT_DISCORD_INVITE });
    }
  });

  router.get('/discord', async (req, res) => {
    try {
      return res.redirect(302, await resolveDiscordInviteUrl());
    } catch (e) {
      return res.redirect(302, DEFAULT_DISCORD_INVITE);
    }
  });

  router.get('/api/categories', async (req, res) => {
    try {
      const cats = await readCats();
      res.json(cats.filter((c) => c.visible !== false).sort((a, b) => (a.order || 99) - (b.order || 99)));
    } catch (e) {
      res.status(500).json({ error: 'Failed to load categories' });
    }
  });

  async function loadAssetList(req, res, next) {
    try {
      const data = await assetService.readData();
      req.assetList = Array.isArray(data) ? data : [];
      next();
    } catch (e) {
      res.status(500).json({ error: 'Failed to load assets' });
    }
  }

  async function loadAssetContext(req, res, next) {
    try {
      const [data, totalDownloads, gamificationEnabled] = await Promise.all([
        assetService.readData(),
        db.getAllTimeDownloadCount(),
        db.getGamificationEnabled(),
      ]);
      req.assetContext = {
        list: Array.isArray(data) ? data : [],
        totalDownloads: Number(totalDownloads || 0),
        gamificationEnabled: !!gamificationEnabled,
      };
      next();
    } catch (e) {
      res.status(500).json({ error: 'Failed to load assets' });
    }
  }

  router.get('/api/thumbnail/:id', loadAssetList, async (req, res) => {
    try {
      const item = req.assetList.find((i) => i.id === req.params.id);
      if (!item || !item.thumbnailUrl || item.thumbnailUrl === '#') return res.status(404).end();
      const s3 = getS3Client();
      if (!s3) return res.status(503).end();
      const key = keyFromDownloadUrl(item.thumbnailUrl);
      if (!key) return res.status(404).end();
      const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
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

  router.get('/api/preview-image/:id', loadAssetList, async (req, res) => {
    try {
      const item = req.assetList.find((i) => i.id === req.params.id);
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
      const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
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

  router.get('/api/download/:id', loadAssetContext, async (req, res) => {
    try {
      const { list, totalDownloads, gamificationEnabled } = req.assetContext;
      const reqId = req.params.id;
      let downloadUrl = null;
      let matchedAsset = null;

      const asset = list.find((i) => i.id === reqId);
      if (asset) {
        matchedAsset = asset;
        const v = (asset.variants || []).find((v) => v.downloadUrl && v.downloadUrl !== '#');
        if (v) downloadUrl = v.downloadUrl;
      }

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
      if (gamificationEnabled && !unlockService.isUnlocked(matchedAsset, totalDownloads)) {
        return res.status(403).send('Asset is locked');
      }

      const s3 = getS3Client();
      if (!s3) return res.redirect(302, downloadUrl);
      const key = keyFromDownloadUrl(downloadUrl);
      if (!key) return res.redirect(302, downloadUrl);
      const filename = key.split('/').pop() || 'download';
      const s3Resp = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
      res.set('Content-Disposition', 'attachment; filename="' + filename.replace(/"/g, '\\"') + '"');
      if (s3Resp.ContentType) res.set('Content-Type', s3Resp.ContentType);
      if (s3Resp.ContentLength) res.set('Content-Length', String(s3Resp.ContentLength));
      s3Resp.Body.pipe(res);
    } catch (e) {
      console.error('Download error:', e);
      res.status(500).send('Download failed');
    }
  });

  router.post('/api/download-zip', loadAssetContext, async (req, res) => {
    const ids = Array.isArray(req.body && req.body.ids) ? req.body.ids : [];
    if (ids.length === 0) return res.status(400).json({ error: 'No ids provided' });
    const s3 = getS3Client();
    if (!s3) return res.status(503).json({ error: 'Downloads not available' });
    try {
      const { list, totalDownloads, gamificationEnabled } = req.assetContext;
      const toZip = [];
      for (const id of ids) {
        const asset = list.find((i) => i.id === id);
        if (!asset) continue;
        if (gamificationEnabled && !unlockService.isUnlocked(asset, totalDownloads)) continue;
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

      for (const { asset, variant } of toZip) {
        const key = keyFromDownloadUrl(variant.downloadUrl);
        if (!key) continue;
        const ext = path.extname(key) || '';
        const baseName = [asset.title, variant.name].filter(Boolean).join('-').replace(/[<>:"/\\|?*]/g, '-').trim() || asset.id;
        try {
          const obj = await s3.send(new GetObjectCommand({ Bucket: getBucket(), Key: key }));
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

  router.get('/api/downloads', loadAssetContext, async (req, res) => {
    try {
      const { list, totalDownloads, gamificationEnabled } = req.assetContext;
      const visible = list.filter((i) => i.visible !== false);
      res.json(visible.map((asset) => (
        gamificationEnabled
          ? unlockService.sanitizePublicAsset(asset, totalDownloads)
          : unlockService.sanitizePublicAssetNoGamification(asset)
      )));
    } catch (e) {
      res.status(500).json({ error: 'Failed to load downloads' });
    }
  });

  router.get('/api/unlocks/progress', loadAssetContext, async (req, res) => {
    try {
      const { list, totalDownloads, gamificationEnabled } = req.assetContext;
      const visible = list.filter((i) => i.visible !== false);
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
      res.json(unlockService.buildUnlockProgress(visible, totalDownloads));
    } catch (e) {
      res.status(500).json({ error: 'Failed to load unlock progress' });
    }
  });

  function getIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (fwd) return fwd.split(',')[0].trim();
    return req.socket.remoteAddress || '';
  }

  function parseUA(ua) {
    if (!ua) return { browser: '', bver: '', os: '', osver: '', device: 'desktop' };
    let browser = '';
    let bver = '';
    let os = '';
    let osver = '';
    let device = 'desktop';
    let m;
    if (/Mobi|Android(?!.*Tablet)|iPhone|iPod|Windows Phone/i.test(ua)) device = 'mobile';
    else if (/iPad|Tablet|PlayBook/i.test(ua)) device = 'tablet';
    if ((m = ua.match(/Edg\/([\d.]+)/))) { browser = 'Edge'; bver = m[1]; }
    else if ((m = ua.match(/OPR\/([\d.]+)/))) { browser = 'Opera'; bver = m[1]; }
    else if ((m = ua.match(/SamsungBrowser\/([\d.]+)/))) { browser = 'Samsung'; bver = m[1]; }
    else if ((m = ua.match(/Chrome\/([\d.]+)/))) { browser = 'Chrome'; bver = m[1]; }
    else if ((m = ua.match(/Firefox\/([\d.]+)/))) { browser = 'Firefox'; bver = m[1]; }
    else if ((m = ua.match(/Version\/([\d.]+).*Safari/))) { browser = 'Safari'; bver = m[1]; }
    if ((m = ua.match(/Windows NT ([\d.]+)/))) { os = 'Windows'; osver = m[1]; }
    else if ((m = ua.match(/Mac OS X ([\d_]+)/))) { os = 'macOS'; osver = m[1].replace(/_/g, '.'); }
    else if ((m = ua.match(/Android ([\d.]+)/))) { os = 'Android'; osver = m[1]; }
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
        country: d.country || '',
        region: d.regionName || '',
        city: d.city || '',
        isp: d.isp || '',
        lat: d.lat || 0,
        lon: d.lon || 0,
        tz: d.timezone || '',
      };
      if (geoCache.size > 5000) geoCache.clear();
      geoCache.set(ip, geo);
      return geo;
    } catch {
      return { country: '', region: '', city: '', isp: '', lat: 0, lon: 0, tz: '' };
    }
  }

  router.post('/api/track', async (req, res) => {
    res.status(204).end();
    try {
      const body = req.body;
      if (!body || !body.type || !body.sid) return;
      const ip = getIp(req);
      const ua = req.headers['user-agent'] || '';
      const { browser, bver, os, osver, device } = parseUA(ua);
      const utm = body.utm || {};
      const ts = new Date().toISOString();
      const s = (v, n) => (String(v || '')).slice(0, n);

      if (body.type === 'pageview') {
        const geo = await getGeo(ip);
        await db.insertVisit({
          session_id: body.sid,
          ts,
          page: s(body.page, 200),
          referrer: s(body.referrer, 500),
          utm_source: s(utm.source, 100),
          utm_medium: s(utm.medium, 100),
          utm_campaign: s(utm.campaign, 100),
          utm_content: s(utm.content, 100),
          utm_term: s(utm.term, 100),
          ip: s(ip, 45),
          country: geo.country,
          region: geo.region,
          city: geo.city,
          isp: geo.isp,
          lat: geo.lat,
          lon: geo.lon,
          geo_tz: geo.tz,
          ua: s(ua, 300),
          browser,
          browser_ver: bver,
          os,
          os_ver: osver,
          device,
          screen_w: body.screen && body.screen.w ? Number(body.screen.w) : null,
          screen_h: body.screen && body.screen.h ? Number(body.screen.h) : null,
          lang: s(body.lang, 20),
          client_tz: s(body.tz, 60),
        });
      } else {
        if (shouldDedupDownloadEvent(body)) return;
        await db.insertEvent({
          session_id: body.sid,
          ts,
          type: s(body.type, 30),
          asset_id: s(body.asset_id, 100),
          asset_title: s(body.asset_title, 200),
          asset_category: s(body.asset_category, 50),
          page: s(body.page, 200),
          utm_source: s(utm.source, 100),
          utm_campaign: s(utm.campaign, 100),
          utm_term: s(utm.term, 100),
        });
      }
    } catch (e) {
      console.error('Track error:', e.message);
    }
  });

  return router;
}

module.exports = { createPublicRouter };
