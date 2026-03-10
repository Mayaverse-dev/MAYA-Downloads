'use strict';

const { v4: uuidv4 } = require('uuid');
const path = require('path');

// Column order is the contract — must stay in sync between inserts and DDL
const VISIT_COLS = [
  'id', 'session_id', 'ts', 'page', 'referrer',
  'utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term',
  'ip', 'country', 'region', 'city', 'isp', 'lat', 'lon', 'geo_tz',
  'ua', 'browser', 'browser_ver', 'os', 'os_ver', 'device',
  'screen_w', 'screen_h', 'lang', 'client_tz',
];

const EVENT_COLS = [
  'id', 'session_id', 'ts', 'type',
  'asset_id', 'asset_title', 'asset_category', 'page',
  'utm_source', 'utm_campaign', 'utm_term',
];

function mapCategoryRow(row) {
  return {
    slug: row.slug,
    label: row.label,
    desc: row.desc || '',
    colorClass: row.color_class || 'home-box-custom',
    visible: row.visible !== false && row.visible !== 0,
    order: row.sort_order ?? 99,
    builtIn: row.built_in === true || row.built_in === 1,
  };
}

function toCategoryDbRow(category) {
  return {
    slug: category.slug,
    label: category.label ?? '',
    desc: category.desc ?? '',
    colorClass: category.colorClass ?? 'home-box-custom',
    visible: category.visible !== false ? 1 : 0,
    order: category.order ?? 99,
    builtIn: category.builtIn ? 1 : 0,
  };
}

// Valid SQL for both SQLite and Postgres
const DDL = `
  CREATE TABLE IF NOT EXISTS visits (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts TEXT NOT NULL,
    page TEXT, referrer TEXT,
    utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, utm_content TEXT, utm_term TEXT,
    ip TEXT, country TEXT, region TEXT, city TEXT, isp TEXT,
    lat REAL, lon REAL, geo_tz TEXT,
    ua TEXT, browser TEXT, browser_ver TEXT, os TEXT, os_ver TEXT, device TEXT,
    screen_w INTEGER, screen_h INTEGER, lang TEXT, client_tz TEXT
  );
  CREATE TABLE IF NOT EXISTS events (
    id TEXT PRIMARY KEY, session_id TEXT NOT NULL, ts TEXT NOT NULL, type TEXT NOT NULL,
    asset_id TEXT, asset_title TEXT, asset_category TEXT, page TEXT,
    utm_source TEXT, utm_campaign TEXT, utm_term TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_v_session ON visits(session_id);
  CREATE INDEX IF NOT EXISTS idx_v_ts      ON visits(ts);
  CREATE INDEX IF NOT EXISTS idx_v_utm_src ON visits(utm_source);
  CREATE INDEX IF NOT EXISTS idx_v_country ON visits(country);
  CREATE INDEX IF NOT EXISTS idx_e_session ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_e_ts      ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_e_type    ON events(type);
  CREATE INDEX IF NOT EXISTS idx_e_asset   ON events(asset_id);

  CREATE TABLE IF NOT EXISTS categories (
    slug TEXT PRIMARY KEY,
    label TEXT NOT NULL,
    "desc" TEXT,
    color_class TEXT,
    visible INTEGER NOT NULL DEFAULT 1,
    sort_order INTEGER NOT NULL DEFAULT 0,
    built_in INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`;

// ── PostgreSQL ─────────────────────────────────────────────────────────────
if (process.env.DATABASE_URL) {
  const { Pool } = require('pg');

  const dbUrl = process.env.DATABASE_URL;
  const noSsl = /localhost|127\.0\.0\.1|\.railway\.internal/.test(dbUrl);
  const pool = new Pool({
    connectionString: dbUrl,
    ssl: noSsl ? false : { rejectUnauthorized: false },
  });

  // Lazy DDL: run once on first use, retry if it failed
  let pgReady = null;
  function ensureReady() {
    if (!pgReady) pgReady = pool.query(DDL).catch((e) => { pgReady = null; throw e; });
    return pgReady;
  }

  const VISIT_SQL = `INSERT INTO visits (${VISIT_COLS.join(',')}) VALUES (${VISIT_COLS.map((_, i) => '$' + (i + 1)).join(',')}) ON CONFLICT (id) DO NOTHING`;
  const EVENT_SQL = `INSERT INTO events (${EVENT_COLS.join(',')}) VALUES (${EVENT_COLS.map((_, i) => '$' + (i + 1)).join(',')})`;

  async function insertVisit(data) {
    await ensureReady();
    const row = { id: uuidv4(), ...data };
    await pool.query(VISIT_SQL, VISIT_COLS.map((k) => row[k] ?? null));
  }

  async function insertEvent(data) {
    await ensureReady();
    const row = { id: uuidv4(), ...data };
    await pool.query(EVENT_SQL, EVENT_COLS.map((k) => row[k] ?? null));
  }

  async function getStats(days) {
    await ensureReady();
    const since = new Date(Date.now() - days * 86400000).toISOString();
    const p = [since];

    const [v, dl, us, byPage, byCountry, byCity, byUtm, byDevice, byBrowser, byOs, topDl, byRef, recentV, recentDl] =
      await Promise.all([
        pool.query(`SELECT COUNT(*) n FROM visits WHERE ts >= $1`, p),
        pool.query(`SELECT COUNT(*) n FROM events WHERE type='download' AND ts >= $1`, p),
        pool.query(`SELECT COUNT(DISTINCT session_id) n FROM visits WHERE ts >= $1`, p),
        pool.query(`SELECT page, COUNT(*) n FROM visits WHERE ts >= $1 GROUP BY page ORDER BY n DESC`, p),
        pool.query(`SELECT country, COUNT(*) n FROM visits WHERE ts >= $1 AND country IS NOT NULL AND country <> '' GROUP BY country ORDER BY n DESC LIMIT 30`, p),
        pool.query(`SELECT city, country, COUNT(*) n FROM visits WHERE ts >= $1 AND city IS NOT NULL AND city <> '' GROUP BY city, country ORDER BY n DESC LIMIT 30`, p),
        pool.query(`SELECT utm_source, utm_campaign, utm_term, COUNT(*) n FROM visits WHERE ts >= $1 AND utm_source IS NOT NULL AND utm_source <> '' GROUP BY utm_source, utm_campaign, utm_term ORDER BY n DESC`, p),
        pool.query(`SELECT device, COUNT(*) n FROM visits WHERE ts >= $1 AND device IS NOT NULL AND device <> '' GROUP BY device ORDER BY n DESC`, p),
        pool.query(`SELECT browser, COUNT(*) n FROM visits WHERE ts >= $1 AND browser IS NOT NULL AND browser <> '' GROUP BY browser ORDER BY n DESC`, p),
        pool.query(`SELECT os, COUNT(*) n FROM visits WHERE ts >= $1 AND os IS NOT NULL AND os <> '' GROUP BY os ORDER BY n DESC`, p),
        pool.query(`SELECT asset_id, asset_title, asset_category, COUNT(*) n FROM events WHERE type='download' AND ts >= $1 GROUP BY asset_id, asset_title, asset_category ORDER BY n DESC LIMIT 20`, p),
        pool.query(`SELECT referrer, COUNT(*) n FROM visits WHERE ts >= $1 AND referrer IS NOT NULL AND referrer <> '' GROUP BY referrer ORDER BY n DESC LIMIT 20`, p),
        pool.query(`SELECT ts,page,country,city,device,browser,os,utm_source,utm_campaign,utm_term,referrer,isp,screen_w,screen_h,lang FROM visits ORDER BY ts DESC LIMIT 100`),
        pool.query(`SELECT e.ts,e.asset_title,e.asset_category,e.asset_id,v.country,v.city,v.device,v.utm_source,v.utm_campaign,v.utm_term FROM events e LEFT JOIN visits v ON e.session_id=v.session_id WHERE e.type='download' ORDER BY e.ts DESC LIMIT 100`),
      ]);

    return {
      visits:           Number(v.rows[0].n),
      downloads:        Number(dl.rows[0].n),
      unique_sessions:  Number(us.rows[0].n),
      by_page:          byPage.rows,
      by_country:       byCountry.rows,
      by_city:          byCity.rows,
      by_utm:           byUtm.rows,
      by_device:        byDevice.rows,
      by_browser:       byBrowser.rows,
      by_os:            byOs.rows,
      top_downloads:    topDl.rows,
      by_referrer:      byRef.rows,
      recent_visits:    recentV.rows,
      recent_downloads: recentDl.rows,
    };
  }

  async function getAllTimeDownloadCount() {
    await ensureReady();
    const r = await pool.query(`SELECT COUNT(*) n FROM events WHERE type='download'`);
    return Number((r.rows && r.rows[0] && r.rows[0].n) || 0);
  }

  async function getDownloadDashboard() {
    await ensureReady();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const [allTime, last24h, byAssetId] = await Promise.all([
      pool.query(`SELECT COUNT(*) n FROM events WHERE type='download'`),
      pool.query(`SELECT COUNT(*) n FROM events WHERE type='download' AND ts >= $1`, [since]),
      pool.query(`
        SELECT asset_id, COUNT(*) n
        FROM events
        WHERE type='download' AND asset_id IS NOT NULL AND asset_id <> ''
        GROUP BY asset_id
      `),
    ]);
    return {
      total_downloads: Number((allTime.rows && allTime.rows[0] && allTime.rows[0].n) || 0),
      downloads_24h: Number((last24h.rows && last24h.rows[0] && last24h.rows[0].n) || 0),
      by_asset_id: (byAssetId.rows || []).map((r) => ({
        asset_id: r.asset_id,
        n: Number(r.n || 0),
      })),
    };
  }

  async function getGamificationEnabled() {
    await ensureReady();
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('gamification_enabled', '1') ON CONFLICT (key) DO NOTHING`
    );
    const r = await pool.query(`SELECT value FROM app_settings WHERE key = 'gamification_enabled' LIMIT 1`);
    const v = (r.rows && r.rows[0] && r.rows[0].value) || '1';
    return !(v === '0' || v === 'false');
  }

  async function setGamificationEnabled(enabled) {
    await ensureReady();
    const v = enabled ? '1' : '0';
    await pool.query(
      `INSERT INTO app_settings (key, value) VALUES ('gamification_enabled', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [v]
    );
    return enabled;
  }

  async function getCategories() {
    await ensureReady();
    const r = await pool.query('SELECT slug, label, "desc", color_class, visible, sort_order, built_in FROM categories ORDER BY sort_order, slug');
    return (r.rows || []).map(mapCategoryRow);
  }

  async function saveCategories(cats) {
    await ensureReady();
    const rows = (cats || []).map(toCategoryDbRow).filter((c) => c.slug);
    const slugs = rows.map((c) => c.slug);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const c of rows) {
        await client.query(
          `INSERT INTO categories (slug, label, "desc", color_class, visible, sort_order, built_in)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (slug) DO UPDATE SET
             label = EXCLUDED.label,
             "desc" = EXCLUDED."desc",
             color_class = EXCLUDED.color_class,
             visible = EXCLUDED.visible,
             sort_order = EXCLUDED.sort_order,
             built_in = EXCLUDED.built_in`,
          [
            c.slug,
            c.label,
            c.desc,
            c.colorClass,
            c.visible,
            c.order,
            c.builtIn,
          ]
        );
      }
      if (slugs.length === 0) {
        await client.query('DELETE FROM categories');
      } else {
        await client.query('DELETE FROM categories WHERE NOT (slug = ANY($1::text[]))', [slugs]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }

  module.exports = {
    insertVisit,
    insertEvent,
    getStats,
    getAllTimeDownloadCount,
    getDownloadDashboard,
    getGamificationEnabled,
    setGamificationEnabled,
    getCategories,
    saveCategories,
  };

} else {
  // ── SQLite (local dev) ────────────────────────────────────────────────────
  const Database = require('better-sqlite3');
  const db = new Database(path.join(__dirname, 'data', 'analytics.db'));
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');
  db.exec(DDL);

  const stmtInsertVisit = db.prepare(
    `INSERT OR IGNORE INTO visits (${VISIT_COLS.join(',')}) VALUES (${VISIT_COLS.map((k) => '@' + k).join(',')})`
  );
  const stmtInsertEvent = db.prepare(
    `INSERT INTO events (${EVENT_COLS.join(',')}) VALUES (${EVENT_COLS.map((k) => '@' + k).join(',')})`
  );

  function insertVisit(data) {
    stmtInsertVisit.run({ id: uuidv4(), ...data });
    return Promise.resolve();
  }

  function insertEvent(data) {
    stmtInsertEvent.run({ id: uuidv4(), ...data });
    return Promise.resolve();
  }

  function getCategories() {
    try {
      const rows = db.prepare('SELECT slug, label, "desc", color_class, visible, sort_order, built_in FROM categories ORDER BY sort_order, slug').all();
      return Promise.resolve((rows || []).map(mapCategoryRow));
    } catch (e) {
      return Promise.resolve([]);
    }
  }

  function saveCategories(cats) {
    const upsert = db.prepare(`
      INSERT INTO categories (slug, label, "desc", color_class, visible, sort_order, built_in)
      VALUES (@slug, @label, @desc, @colorClass, @visible, @order, @builtIn)
      ON CONFLICT(slug) DO UPDATE SET
        label = excluded.label,
        "desc" = excluded."desc",
        color_class = excluded.color_class,
        visible = excluded.visible,
        sort_order = excluded.sort_order,
        built_in = excluded.built_in
    `);
    const delMissing = db.prepare(
      `DELETE FROM categories
       WHERE slug NOT IN (SELECT value FROM json_each(?))`
    );
    const delAll = db.prepare('DELETE FROM categories');
    db.transaction(() => {
      const rows = (cats || []).map(toCategoryDbRow).filter((c) => c.slug);
      for (const row of rows) {
        upsert.run(row);
      }
      if (rows.length === 0) {
        delAll.run();
      } else {
        delMissing.run(JSON.stringify(rows.map((c) => c.slug)));
      }
    })();
    return Promise.resolve();
  }

  function getStats(days) {
    const since = new Date(Date.now() - days * 86400000).toISOString();
    return Promise.resolve({
      visits:           db.prepare(`SELECT COUNT(*) n FROM visits WHERE ts >= ?`).get(since).n,
      downloads:        db.prepare(`SELECT COUNT(*) n FROM events WHERE type='download' AND ts >= ?`).get(since).n,
      unique_sessions:  db.prepare(`SELECT COUNT(DISTINCT session_id) n FROM visits WHERE ts >= ?`).get(since).n,
      by_page:          db.prepare(`SELECT page, COUNT(*) n FROM visits WHERE ts >= ? GROUP BY page ORDER BY n DESC`).all(since),
      by_country:       db.prepare(`SELECT country, COUNT(*) n FROM visits WHERE ts >= ? AND country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC LIMIT 30`).all(since),
      by_city:          db.prepare(`SELECT city, country, COUNT(*) n FROM visits WHERE ts >= ? AND city IS NOT NULL AND city != '' GROUP BY city, country ORDER BY n DESC LIMIT 30`).all(since),
      by_utm:           db.prepare(`SELECT utm_source, utm_campaign, utm_term, COUNT(*) n FROM visits WHERE ts >= ? AND utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source, utm_campaign, utm_term ORDER BY n DESC`).all(since),
      by_device:        db.prepare(`SELECT device, COUNT(*) n FROM visits WHERE ts >= ? AND device IS NOT NULL AND device != '' GROUP BY device ORDER BY n DESC`).all(since),
      by_browser:       db.prepare(`SELECT browser, COUNT(*) n FROM visits WHERE ts >= ? AND browser IS NOT NULL AND browser != '' GROUP BY browser ORDER BY n DESC`).all(since),
      by_os:            db.prepare(`SELECT os, COUNT(*) n FROM visits WHERE ts >= ? AND os IS NOT NULL AND os != '' GROUP BY os ORDER BY n DESC`).all(since),
      top_downloads:    db.prepare(`SELECT asset_id, asset_title, asset_category, COUNT(*) n FROM events WHERE type='download' AND ts >= ? GROUP BY asset_id, asset_title, asset_category ORDER BY n DESC LIMIT 20`).all(since),
      by_referrer:      db.prepare(`SELECT referrer, COUNT(*) n FROM visits WHERE ts >= ? AND referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY n DESC LIMIT 20`).all(since),
      recent_visits:    db.prepare(`SELECT ts,page,country,city,device,browser,os,utm_source,utm_campaign,utm_term,referrer,isp,screen_w,screen_h,lang FROM visits ORDER BY ts DESC LIMIT 100`).all(),
      recent_downloads: db.prepare(`SELECT e.ts,e.asset_title,e.asset_category,e.asset_id,v.country,v.city,v.device,v.utm_source,v.utm_campaign,v.utm_term FROM events e LEFT JOIN visits v ON e.session_id=v.session_id WHERE e.type='download' ORDER BY e.ts DESC LIMIT 100`).all(),
    });
  }

  function getAllTimeDownloadCount() {
    const row = db.prepare(`SELECT COUNT(*) n FROM events WHERE type='download'`).get();
    return Promise.resolve(Number((row && row.n) || 0));
  }

  function getDownloadDashboard() {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const total = db.prepare(`SELECT COUNT(*) n FROM events WHERE type='download'`).get();
    const day = db.prepare(`SELECT COUNT(*) n FROM events WHERE type='download' AND ts >= ?`).get(since);
    const rows = db.prepare(`
      SELECT asset_id, COUNT(*) n
      FROM events
      WHERE type='download' AND asset_id IS NOT NULL AND asset_id != ''
      GROUP BY asset_id
    `).all();
    return Promise.resolve({
      total_downloads: Number((total && total.n) || 0),
      downloads_24h: Number((day && day.n) || 0),
      by_asset_id: (rows || []).map((r) => ({
        asset_id: r.asset_id,
        n: Number(r.n || 0),
      })),
    });
  }

  function getGamificationEnabled() {
    db.prepare(`INSERT OR IGNORE INTO app_settings (key, value) VALUES ('gamification_enabled', '1')`).run();
    const row = db.prepare(`SELECT value FROM app_settings WHERE key = 'gamification_enabled'`).get();
    const v = (row && row.value) || '1';
    return Promise.resolve(!(v === '0' || v === 'false'));
  }

  function setGamificationEnabled(enabled) {
    db.prepare(`
      INSERT INTO app_settings (key, value) VALUES ('gamification_enabled', ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(enabled ? '1' : '0');
    return Promise.resolve(enabled);
  }

  module.exports = {
    insertVisit,
    insertEvent,
    getStats,
    getAllTimeDownloadCount,
    getDownloadDashboard,
    getGamificationEnabled,
    setGamificationEnabled,
    getCategories,
    saveCategories,
  };
}
