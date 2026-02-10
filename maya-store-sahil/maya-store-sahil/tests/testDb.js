/**
 * Test Database Module
 * 
 * Creates and manages a separate SQLite database for testing.
 * NEVER connects to production PostgreSQL.
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcrypt');

const TEST_DB_PATH = process.env.TEST_DB_PATH || path.resolve(__dirname, 'test.db');

let db = null;

/**
 * Convert PostgreSQL-style parameterized queries ($1, $2, etc.) to SQLite-style (?)
 * Also handles some PostgreSQL-specific SQL syntax
 */
function convertPgToSqlite(sql) {
    // Convert $1, $2, etc. to ?
    let converted = sql.replace(/\$\d+/g, '?');
    // Only convert CURRENT_TIMESTAMP to datetime('now') in INSERT/UPDATE statements, not in CREATE TABLE
    // In CREATE TABLE, SQLite accepts CURRENT_TIMESTAMP as default value
    if (!sql.trim().toUpperCase().startsWith('CREATE')) {
        converted = converted.replace(/CURRENT_TIMESTAMP/gi, "datetime('now')");
    }
    return converted;
}

/**
 * Initialize test database with all required tables
 */
async function initialize() {
    return new Promise((resolve, reject) => {
        db = new sqlite3.Database(TEST_DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, async (err) => {
            if (err) {
                console.error('Error opening test database:', err);
                reject(err);
                return;
            }
            
            console.log('✓ Test database opened:', TEST_DB_PATH);
            
            try {
                await createTables();
                await seedTestData();
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

/**
 * Execute SQL query (internal - no conversion)
 */
function executeRaw(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.run(sql, params, function(err) {
            if (err) reject(err);
            else resolve(this);
        });
    });
}

/**
 * Execute SQL query (with PostgreSQL to SQLite conversion)
 */
function execute(sql, params = []) {
    const convertedSql = convertPgToSqlite(sql);
    return executeRaw(convertedSql, params);
}

/**
 * Query all rows (internal - no conversion)
 */
function queryRaw(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.all(sql, params, (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
        });
    });
}

/**
 * Query all rows (with PostgreSQL to SQLite conversion)
 */
function query(sql, params = []) {
    const convertedSql = convertPgToSqlite(sql);
    return queryRaw(convertedSql, params);
}

/**
 * Query single row (internal - no conversion)
 */
function queryOneRaw(sql, params = []) {
    return new Promise((resolve, reject) => {
        db.get(sql, params, (err, row) => {
            if (err) reject(err);
            else resolve(row);
        });
    });
}

/**
 * Query single row (with PostgreSQL to SQLite conversion)
 */
function queryOne(sql, params = []) {
    const convertedSql = convertPgToSqlite(sql);
    return queryOneRaw(convertedSql, params);
}

/**
 * Create all required tables
 */
async function createTables() {
    // Backers table (main user table)
    await execute(`CREATE TABLE IF NOT EXISTS backers (
        identity_id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        name TEXT,
        pin_hash TEXT,
        otp_code TEXT,
        otp_expires_at TEXT,
        last_login_at TEXT,
        
        -- Kickstarter data
        ks_backer_number INTEGER,
        ks_status TEXT,
        ks_pledge_id INTEGER,
        ks_pledge_amount REAL,
        ks_amount_paid REAL DEFAULT 0,
        ks_amount_due REAL DEFAULT 0,
        ks_pledge_over_time INTEGER DEFAULT 0,
        ks_late_pledge INTEGER DEFAULT 0,
        
        -- Shipping address
        ship_name TEXT,
        ship_address_1 TEXT,
        ship_address_2 TEXT,
        ship_city TEXT,
        ship_state TEXT,
        ship_postal TEXT,
        ship_country TEXT,
        ship_country_code TEXT,
        ship_phone TEXT,
        ship_locked INTEGER DEFAULT 0,
        ship_verified INTEGER DEFAULT 0,
        
        -- Stripe data
        stripe_customer_id TEXT,
        stripe_payment_method TEXT,
        stripe_payment_intent TEXT,
        stripe_card_brand TEXT,
        stripe_card_last4 TEXT,
        stripe_card_exp TEXT,
        
        -- Pledge Manager order data
        pm_order_id TEXT,
        pm_addons_subtotal REAL,
        pm_shipping_cost REAL,
        pm_total REAL,
        pm_paid INTEGER DEFAULT 0,
        pm_status TEXT,
        pm_comped_items TEXT,
        pm_created_at TEXT,
        
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT
    )`);
    
    // Items table (products: pledges and addons)
    await execute(`CREATE TABLE IF NOT EXISTS items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sku TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        type TEXT NOT NULL,
        category TEXT NOT NULL,
        price REAL,
        backer_price REAL,
        weight_kg REAL DEFAULT 0,
        image TEXT,
        s3_key TEXT,
        description TEXT,
        active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Pledge items mapping
    await execute(`CREATE TABLE IF NOT EXISTS pledge_items (
        pledge_id INTEGER NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        PRIMARY KEY (pledge_id, item_id)
    )`);
    
    // Backer items (purchased items)
    await execute(`CREATE TABLE IF NOT EXISTS backer_items (
        identity_id TEXT NOT NULL,
        item_id INTEGER NOT NULL,
        quantity INTEGER DEFAULT 1,
        source TEXT NOT NULL,
        price_paid REAL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (identity_id, item_id, source)
    )`);
    
    // User addresses
    await execute(`CREATE TABLE IF NOT EXISTS user_addresses (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    )`);
    
    // Rules table
    await execute(`CREATE TABLE IF NOT EXISTS rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category TEXT NOT NULL,
        rule_key TEXT NOT NULL,
        rule_value TEXT NOT NULL,
        data_type TEXT DEFAULT 'string',
        description TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(category, rule_key)
    )`);
    
    // Admins table
    await execute(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT,
        role TEXT DEFAULT 'admin',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Email logs
    await execute(`CREATE TABLE IF NOT EXISTS email_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        identity_id TEXT,
        email_type TEXT NOT NULL,
        subject TEXT NOT NULL,
        status TEXT DEFAULT 'sent',
        message_id TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    // Project milestones
    await execute(`CREATE TABLE IF NOT EXISTS project_milestones (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        description TEXT,
        status TEXT NOT NULL DEFAULT 'upcoming',
        completed_date TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);
    
    console.log('✓ Test database tables created');
}

/**
 * Seed test data
 */
async function seedTestData() {
    const pinHash = await bcrypt.hash('1234', 10);
    const { randomUUID } = require('crypto');
    
    // Seed pledge tiers (items)
    const pledges = [
        { id: 101, sku: 'pledge-humble-vaanar', name: 'The Humble Vaanar', type: 'pledge', category: 'pledge', price: 25, backer_price: 18 },
        { id: 102, sku: 'pledge-industrious-manushya', name: 'The Industrious Manushya', type: 'pledge', category: 'pledge', price: 50, backer_price: 35 },
        { id: 103, sku: 'pledge-resplendent-garuda', name: 'The Resplendent Garuda', type: 'pledge', category: 'pledge', price: 150, backer_price: 99 },
        { id: 104, sku: 'pledge-benevolent-divya', name: 'The Benevolent Divya', type: 'pledge', category: 'pledge', price: 190, backer_price: 150 },
        { id: 105, sku: 'pledge-founders-of-neh', name: 'Founders of Neh', type: 'pledge', category: 'pledge', price: 1500, backer_price: 1500 }
    ];
    
    for (const pledge of pledges) {
        await execute(`INSERT OR IGNORE INTO items (id, sku, name, type, category, price, backer_price) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [pledge.id, pledge.sku, pledge.name, pledge.type, pledge.category, pledge.price, pledge.backer_price]);
    }
    
    // Seed add-ons
    const addons = [
        { id: 201, sku: 'addon-lorebook', name: 'MAYA Lorebook', type: 'addon', category: 'books', price: 35, backer_price: 25 },
        { id: 202, sku: 'addon-enamel-pin', name: 'MAYA Enamel Pin', type: 'addon', category: 'merch', price: 15, backer_price: 10 },
        { id: 203, sku: 'addon-poster', name: 'MAYA Poster', type: 'addon', category: 'merch', price: 20, backer_price: 15 },
        { id: 204, sku: 'addon-built-environments', name: 'Built Environments', type: 'addon', category: 'books', price: 75, backer_price: 50 }
    ];
    
    for (const addon of addons) {
        await execute(`INSERT OR IGNORE INTO items (id, sku, name, type, category, price, backer_price) VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [addon.id, addon.sku, addon.name, addon.type, addon.category, addon.price, addon.backer_price]);
    }
    
    // Seed test users
    const testUsers = [
        {
            identity_id: 'test-collected-001',
            email: 'collected@test.maya',
            name: 'Collected Backer',
            ks_backer_number: 9001,
            ks_status: 'collected',
            ks_pledge_id: 101,
            ks_pledge_amount: 18,
            ks_amount_paid: 18,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            identity_id: 'test-pot-001',
            email: 'pot@test.maya',
            name: 'PoT Backer',
            ks_backer_number: 9002,
            ks_status: 'collected',
            ks_pledge_id: 104,
            ks_pledge_amount: 150,
            ks_amount_paid: 50,
            ks_amount_due: 100,
            ks_pledge_over_time: 1,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            identity_id: 'test-dropped-001',
            email: 'dropped@test.maya',
            name: 'Dropped Backer',
            ks_backer_number: 9003,
            ks_status: 'dropped',
            ks_pledge_id: 101,
            ks_pledge_amount: 18,
            ks_amount_paid: 0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            identity_id: 'test-canceled-001',
            email: 'canceled@test.maya',
            name: 'Canceled Backer',
            ks_backer_number: 9004,
            ks_status: 'canceled',
            ks_pledge_id: 102,
            ks_pledge_amount: 35,
            ks_amount_paid: 0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            identity_id: 'test-latepledge-001',
            email: 'latepledge@test.maya',
            name: 'Late Pledge Backer',
            ks_backer_number: 9005,
            ks_status: 'collected',
            ks_pledge_id: 101,
            ks_pledge_amount: 25,
            ks_amount_paid: 25,
            ks_pledge_over_time: 0,
            ks_late_pledge: 1,
            pin_hash: pinHash
        },
        {
            identity_id: 'test-guest-001',
            email: 'guest@test.maya',
            name: 'Guest User',
            ks_backer_number: null,
            ks_status: null,
            ks_pledge_id: null,
            ks_pledge_amount: null,
            ks_amount_paid: 0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        }
    ];
    
    for (const user of testUsers) {
        await execute(`INSERT OR IGNORE INTO backers (
            identity_id, email, name, ks_backer_number, ks_status, 
            ks_pledge_id, ks_pledge_amount, ks_amount_paid, ks_amount_due,
            ks_pledge_over_time, ks_late_pledge, pin_hash
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [user.identity_id, user.email, user.name, user.ks_backer_number, user.ks_status,
             user.ks_pledge_id, user.ks_pledge_amount, user.ks_amount_paid, user.ks_amount_due || 0,
             user.ks_pledge_over_time, user.ks_late_pledge, user.pin_hash]);
    }
    
    // Seed rules
    const rules = [
        { category: 'cart', rule_key: 'max_quantity_per_item', rule_value: '10', data_type: 'number' },
        { category: 'profile.guest', rule_key: 'pricing_type', rule_value: 'retail', data_type: 'string' },
        { category: 'profile.guest', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string' },
        { category: 'profile.collected', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string' },
        { category: 'profile.collected', rule_key: 'payment_method', rule_value: 'card_saved', data_type: 'string' },
        { category: 'profile.dropped', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string' },
        { category: 'profile.dropped', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string' },
        { category: 'profile.canceled', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string' },
        { category: 'profile.canceled', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string' },
        { category: 'profile.pot', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string' },
        { category: 'profile.pot', rule_key: 'payment_method', rule_value: 'card_saved', data_type: 'string' },
        { category: 'profile.late_pledge', rule_key: 'pricing_type', rule_value: 'retail', data_type: 'string' },
        { category: 'profile.late_pledge', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string' }
    ];
    
    for (const rule of rules) {
        await execute(`INSERT OR IGNORE INTO rules (category, rule_key, rule_value, data_type) VALUES (?, ?, ?, ?)`,
            [rule.category, rule.rule_key, rule.rule_value, rule.data_type]);
    }
    
    console.log('✓ Test data seeded');
}

/**
 * Clear all data from tables (for test isolation)
 */
async function clearData() {
    await execute('DELETE FROM backer_items');
    await execute('DELETE FROM user_addresses');
    await execute('DELETE FROM email_logs');
    await execute('DELETE FROM backers');
}

/**
 * Reset test data (clear and re-seed)
 */
async function reset() {
    await clearData();
    await seedTestData();
}

/**
 * Close database connection
 */
async function close() {
    return new Promise((resolve, reject) => {
        if (db) {
            db.close((err) => {
                if (err) reject(err);
                else {
                    console.log('✓ Test database closed');
                    resolve();
                }
            });
        } else {
            resolve();
        }
    });
}

/**
 * Get test user by email
 */
async function getTestUser(email) {
    return queryOne('SELECT * FROM backers WHERE email = ?', [email]);
}

/**
 * Get test item by id
 */
async function getTestItem(id) {
    return queryOne('SELECT * FROM items WHERE id = ?', [id]);
}

/**
 * Update test user
 */
async function updateTestUser(email, updates) {
    const keys = Object.keys(updates);
    const values = Object.values(updates);
    const setClause = keys.map(k => `${k} = ?`).join(', ');
    
    await execute(`UPDATE backers SET ${setClause} WHERE email = ?`, [...values, email]);
}

module.exports = {
    initialize,
    execute,
    query,
    queryOne,
    clearData,
    reset,
    close,
    getTestUser,
    getTestItem,
    updateTestUser,
    TEST_DB_PATH
};

