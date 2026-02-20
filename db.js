'use strict';

const Database = require('better-sqlite3');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const db = new Database(path.join(__dirname, 'data', 'analytics.db'));

db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS visits (
    id           TEXT PRIMARY KEY,
    session_id   TEXT NOT NULL,
    ts           TEXT NOT NULL,
    page         TEXT,
    referrer     TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    utm_content  TEXT,
    utm_term     TEXT,
    ip           TEXT,
    country      TEXT,
    region       TEXT,
    city         TEXT,
    isp          TEXT,
    lat          REAL,
    lon          REAL,
    geo_tz       TEXT,
    ua           TEXT,
    browser      TEXT,
    browser_ver  TEXT,
    os           TEXT,
    os_ver       TEXT,
    device       TEXT,
    screen_w     INTEGER,
    screen_h     INTEGER,
    lang         TEXT,
    client_tz    TEXT
  );

  CREATE TABLE IF NOT EXISTS events (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL,
    ts             TEXT NOT NULL,
    type           TEXT NOT NULL,
    asset_id       TEXT,
    asset_title    TEXT,
    asset_category TEXT,
    page           TEXT,
    utm_source     TEXT,
    utm_campaign   TEXT,
    utm_term       TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_v_session  ON visits(session_id);
  CREATE INDEX IF NOT EXISTS idx_v_ts       ON visits(ts);
  CREATE INDEX IF NOT EXISTS idx_v_utm_src  ON visits(utm_source);
  CREATE INDEX IF NOT EXISTS idx_v_country  ON visits(country);
  CREATE INDEX IF NOT EXISTS idx_e_session  ON events(session_id);
  CREATE INDEX IF NOT EXISTS idx_e_ts       ON events(ts);
  CREATE INDEX IF NOT EXISTS idx_e_type     ON events(type);
  CREATE INDEX IF NOT EXISTS idx_e_asset    ON events(asset_id);
`);

const stmtInsertVisit = db.prepare(`
  INSERT OR IGNORE INTO visits
    (id,session_id,ts,page,referrer,utm_source,utm_medium,utm_campaign,utm_content,utm_term,
     ip,country,region,city,isp,lat,lon,geo_tz,ua,browser,browser_ver,os,os_ver,device,
     screen_w,screen_h,lang,client_tz)
  VALUES
    (@id,@session_id,@ts,@page,@referrer,@utm_source,@utm_medium,@utm_campaign,@utm_content,@utm_term,
     @ip,@country,@region,@city,@isp,@lat,@lon,@geo_tz,@ua,@browser,@browser_ver,@os,@os_ver,@device,
     @screen_w,@screen_h,@lang,@client_tz)
`);

const stmtInsertEvent = db.prepare(`
  INSERT INTO events (id,session_id,ts,type,asset_id,asset_title,asset_category,page,utm_source,utm_campaign,utm_term)
  VALUES (@id,@session_id,@ts,@type,@asset_id,@asset_title,@asset_category,@page,@utm_source,@utm_campaign,@utm_term)
`);

function insertVisit(data) {
  stmtInsertVisit.run({ id: uuidv4(), ...data });
}

function insertEvent(data) {
  stmtInsertEvent.run({ id: uuidv4(), ...data });
}

function getStats(days) {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  return {
    visits:          db.prepare(`SELECT COUNT(*) n FROM visits WHERE ts >= ?`).get(since).n,
    downloads:       db.prepare(`SELECT COUNT(*) n FROM events WHERE type='download' AND ts >= ?`).get(since).n,
    unique_sessions: db.prepare(`SELECT COUNT(DISTINCT session_id) n FROM visits WHERE ts >= ?`).get(since).n,
    by_page:         db.prepare(`SELECT page, COUNT(*) n FROM visits WHERE ts >= ? GROUP BY page ORDER BY n DESC`).all(since),
    by_country:      db.prepare(`SELECT country, COUNT(*) n FROM visits WHERE ts >= ? AND country IS NOT NULL AND country != '' GROUP BY country ORDER BY n DESC LIMIT 30`).all(since),
    by_city:         db.prepare(`SELECT city, country, COUNT(*) n FROM visits WHERE ts >= ? AND city IS NOT NULL AND city != '' GROUP BY city, country ORDER BY n DESC LIMIT 30`).all(since),
    by_utm:          db.prepare(`SELECT utm_source, utm_campaign, utm_term, COUNT(*) n FROM visits WHERE ts >= ? AND utm_source IS NOT NULL AND utm_source != '' GROUP BY utm_source, utm_campaign, utm_term ORDER BY n DESC`).all(since),
    by_device:       db.prepare(`SELECT device, COUNT(*) n FROM visits WHERE ts >= ? AND device IS NOT NULL AND device != '' GROUP BY device ORDER BY n DESC`).all(since),
    by_browser:      db.prepare(`SELECT browser, COUNT(*) n FROM visits WHERE ts >= ? AND browser IS NOT NULL AND browser != '' GROUP BY browser ORDER BY n DESC`).all(since),
    by_os:           db.prepare(`SELECT os, COUNT(*) n FROM visits WHERE ts >= ? AND os IS NOT NULL AND os != '' GROUP BY os ORDER BY n DESC`).all(since),
    top_downloads:   db.prepare(`SELECT asset_id, asset_title, asset_category, COUNT(*) n FROM events WHERE type='download' AND ts >= ? GROUP BY asset_id ORDER BY n DESC LIMIT 20`).all(since),
    by_referrer:     db.prepare(`SELECT referrer, COUNT(*) n FROM visits WHERE ts >= ? AND referrer IS NOT NULL AND referrer != '' GROUP BY referrer ORDER BY n DESC LIMIT 20`).all(since),
    recent_visits:   db.prepare(`SELECT ts,page,country,city,device,browser,os,utm_source,utm_campaign,utm_term,referrer,isp,screen_w,screen_h,lang FROM visits ORDER BY ts DESC LIMIT 100`).all(),
    recent_downloads:db.prepare(`SELECT e.ts,e.asset_title,e.asset_category,e.asset_id,v.country,v.city,v.device,v.utm_source,v.utm_campaign,v.utm_term FROM events e LEFT JOIN visits v ON e.session_id=v.session_id WHERE e.type='download' ORDER BY e.ts DESC LIMIT 100`).all(),
  };
}

module.exports = { insertVisit, insertEvent, getStats };
