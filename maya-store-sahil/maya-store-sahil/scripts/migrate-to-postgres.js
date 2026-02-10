#!/usr/bin/env node
/**
 * FAST SQLite to PostgreSQL Migration using COPY protocol
 * Schema matches SQLite exactly
 */

const { Pool } = require('pg');
const copyFrom = require('pg-copy-streams').from;
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const { Readable } = require('stream');

const SQLITE_PATH = path.resolve(__dirname, '../pledgemanager.db');

const TABLES = [
    'items', 'pledge_items', 'admins', 'rules', 'project_milestones', 
    'assets', 'backers', 'backer_items', 'user_addresses',
    'email_logs', 'activity_log', 'support_requests', 'download_logs'
];

// PostgreSQL schema that matches SQLite exactly
const CREATE_SQL = `
DROP TABLE IF EXISTS download_logs CASCADE;
DROP TABLE IF EXISTS support_requests CASCADE;
DROP TABLE IF EXISTS activity_log CASCADE;
DROP TABLE IF EXISTS email_logs CASCADE;
DROP TABLE IF EXISTS user_addresses CASCADE;
DROP TABLE IF EXISTS backer_items CASCADE;
DROP TABLE IF EXISTS backers CASCADE;
DROP TABLE IF EXISTS pledge_items CASCADE;
DROP TABLE IF EXISTS assets CASCADE;
DROP TABLE IF EXISTS project_milestones CASCADE;
DROP TABLE IF EXISTS rules CASCADE;
DROP TABLE IF EXISTS admins CASCADE;
DROP TABLE IF EXISTS items CASCADE;

CREATE TABLE items (
    id SERIAL PRIMARY KEY,
    sku TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    type TEXT NOT NULL,
    category TEXT NOT NULL,
    price REAL,
    backer_price REAL,
    weight_kg REAL DEFAULT 0,
    image TEXT,
    description TEXT,
    active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    s3_key TEXT
);

CREATE TABLE pledge_items (
    pledge_id INTEGER NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    PRIMARY KEY (pledge_id, item_id)
);

CREATE TABLE backers (
    identity_id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    pin_hash TEXT,
    otp_code TEXT,
    otp_expires_at TEXT,
    last_login_at TEXT,
    name TEXT,
    avatar TEXT,
    ks_backer_number TEXT,
    ks_backer_uid TEXT,
    ks_pledge_id TEXT,
    ks_pledge_amount TEXT,
    ks_amount_paid TEXT,
    ks_amount_due TEXT,
    ks_bonus_support TEXT,
    ks_status TEXT,
    ks_pledged_at TEXT,
    ks_late_pledge TEXT,
    ks_pledge_over_time TEXT,
    ks_country TEXT,
    ks_notes TEXT,
    fulfillment_status TEXT DEFAULT 'pending',
    fulfillment_date TEXT,
    tracking_number TEXT,
    tracking_carrier TEXT,
    pm_order_id TEXT,
    pm_status TEXT,
    pm_addons_subtotal TEXT,
    pm_shipping_cost TEXT,
    pm_total TEXT,
    pm_paid TEXT,
    pm_created_at TEXT,
    pm_comped_items TEXT,
    ship_name TEXT,
    ship_address_1 TEXT,
    ship_address_2 TEXT,
    ship_city TEXT,
    ship_state TEXT,
    ship_postal TEXT,
    ship_country TEXT,
    ship_country_code TEXT,
    ship_phone TEXT,
    ship_verified TEXT,
    ship_locked TEXT,
    stripe_customer_id TEXT,
    stripe_payment_intent TEXT,
    stripe_payment_method TEXT,
    stripe_card_brand TEXT,
    stripe_card_last4 TEXT,
    stripe_card_exp TEXT,
    email_verified TEXT,
    email_opt_in TEXT,
    last_email_at TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT,
    admin_notes TEXT,
    tags TEXT
);

CREATE TABLE backer_items (
    identity_id TEXT NOT NULL,
    item_id INTEGER NOT NULL,
    quantity INTEGER DEFAULT 1,
    source TEXT NOT NULL,
    price_paid REAL,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (identity_id, item_id, source)
);

CREATE TABLE admins (
    id SERIAL PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    name TEXT,
    role TEXT DEFAULT 'admin',
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE rules (
    id SERIAL PRIMARY KEY,
    category TEXT NOT NULL,
    rule_key TEXT NOT NULL,
    rule_value TEXT NOT NULL,
    data_type TEXT DEFAULT 'string',
    description TEXT,
    updated_at TEXT,
    UNIQUE(category, rule_key)
);

CREATE TABLE project_milestones (
    id SERIAL PRIMARY KEY,
    title VARCHAR(100) NOT NULL,
    description VARCHAR(255),
    status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
    completed_date DATE,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT,
    updated_at TEXT
);

CREATE TABLE assets (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    s3_key TEXT UNIQUE NOT NULL,
    category TEXT NOT NULL,
    type TEXT,
    size_bytes INTEGER,
    metadata TEXT,
    created_at TEXT
);

CREATE TABLE email_logs (
    id SERIAL PRIMARY KEY,
    identity_id TEXT,
    email_type TEXT NOT NULL,
    subject TEXT NOT NULL,
    status TEXT DEFAULT 'sent',
    message_id TEXT,
    sent_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE activity_log (
    id SERIAL PRIMARY KEY,
    identity_id TEXT,
    admin_id INTEGER,
    action TEXT NOT NULL,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE user_addresses (
    id SERIAL PRIMARY KEY,
    identity_id TEXT NOT NULL,
    label TEXT,
    full_name TEXT NOT NULL,
    address_line1 TEXT NOT NULL,
    address_line2 TEXT,
    city TEXT NOT NULL,
    state TEXT,
    postal_code TEXT NOT NULL,
    country TEXT NOT NULL,
    phone TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE support_requests (
    id SERIAL PRIMARY KEY,
    identity_id TEXT,
    email TEXT NOT NULL,
    phone TEXT,
    subject TEXT,
    message TEXT NOT NULL,
    page_url TEXT,
    user_agent TEXT,
    status TEXT DEFAULT 'pending',
    admin_notes TEXT,
    resolved_by INTEGER,
    resolved_at TEXT,
    created_at TEXT
);

CREATE TABLE download_logs (
    id SERIAL PRIMARY KEY,
    identity_id TEXT,
    email TEXT,
    asset_id TEXT NOT NULL,
    asset_name TEXT NOT NULL,
    asset_category TEXT NOT NULL,
    ip_address TEXT,
    user_agent TEXT,
    downloaded_at TEXT
);

CREATE INDEX idx_backers_email ON backers(email);
CREATE INDEX idx_backers_ks_status ON backers(ks_status);
CREATE INDEX idx_backers_pm_status ON backers(pm_status);
CREATE INDEX idx_email_logs_identity ON email_logs(identity_id);
CREATE INDEX idx_backer_items_identity ON backer_items(identity_id);
CREATE INDEX idx_backer_items_item ON backer_items(item_id);
CREATE INDEX idx_user_addresses_identity ON user_addresses(identity_id);
CREATE INDEX idx_support_status ON support_requests(status);
CREATE INDEX idx_download_asset ON download_logs(asset_id);
CREATE INDEX idx_download_identity ON download_logs(identity_id);
CREATE INDEX idx_download_category ON download_logs(asset_category);
CREATE INDEX idx_rules_category_key ON rules(category, rule_key);
`;

function sqliteAll(db, sql) {
    return new Promise((resolve, reject) => {
        db.all(sql, (err, rows) => err ? reject(err) : resolve(rows || []));
    });
}

function escapeCopyValue(val) {
    if (val === null || val === undefined) return '\\N';
    const str = String(val);
    return str.replace(/\\/g, '\\\\').replace(/\t/g, '\\t').replace(/\n/g, '\\n').replace(/\r/g, '\\r');
}

function rowsToCopyStream(rows, cols) {
    const lines = rows.map(row => cols.map(c => escapeCopyValue(row[c])).join('\t'));
    return Readable.from(lines.join('\n') + '\n');
}

async function copyTable(pgClient, table, rows, cols) {
    return new Promise((resolve, reject) => {
        const stream = pgClient.query(copyFrom(`COPY ${table} (${cols.join(',')}) FROM STDIN`));
        const dataStream = rowsToCopyStream(rows, cols);
        stream.on('error', reject);
        stream.on('finish', resolve);
        dataStream.on('error', reject);
        dataStream.pipe(stream);
    });
}

async function migrate() {
    const start = Date.now();
    console.log('\n⚡ FAST SQLite → PostgreSQL Migration\n');
    
    const sqlite = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY);
    console.log('✓ SQLite connected');
    
    const pg = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    const client = await pg.connect();
    console.log('✓ PostgreSQL connected\n');
    
    // Create all tables with exact schema
    console.log('Creating tables...');
    for (const sql of CREATE_SQL.split(';').filter(s => s.trim())) {
        try { await client.query(sql); } catch(e) { console.log('  ⚠️', e.message.substring(0, 50)); }
    }
    console.log('✓ Schema ready\n');
    
    let totalRows = 0;
    
    for (const table of TABLES) {
        try {
            const rows = await sqliteAll(sqlite, `SELECT * FROM ${table}`);
            if (!rows.length) { console.log(`⏭️  ${table}: empty`); continue; }
            
            const cols = Object.keys(rows[0]);
            const t0 = Date.now();
            await copyTable(client, table, rows, cols);
            
            console.log(`✓ ${table}: ${rows.length} rows (${((Date.now()-t0)/1000).toFixed(1)}s)`);
            totalRows += rows.length;
        } catch(e) {
            console.log(`✗ ${table}: ${e.message.substring(0, 60)}`);
        }
    }
    
    // Reset sequences for tables with SERIAL id
    console.log('\nResetting sequences...');
    for (const t of ['items','admins','rules','project_milestones','assets','email_logs','activity_log','support_requests','download_logs','user_addresses']) {
        try {
            const r = await client.query(`SELECT MAX(id) as m FROM ${t}`);
            if (r.rows[0]?.m) await client.query(`SELECT setval('${t}_id_seq', $1)`, [r.rows[0].m]);
        } catch(e) {}
    }
    
    console.log(`\n✅ Done! ${totalRows} rows in ${((Date.now()-start)/1000).toFixed(1)}s\n`);
    
    client.release();
    sqlite.close();
    await pg.end();
}

migrate().catch(e => { console.error('Error:', e.message); process.exit(1); });
