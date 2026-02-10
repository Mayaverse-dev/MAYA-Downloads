require('dotenv').config();
const crypto = require('crypto');
const emailService = require('../services/emailService');

// Database setup - PostgreSQL or SQLite
let pool = null;
let db = null;
let isPostgres = false;

if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    isPostgres = true;
    console.log('✓ Using PostgreSQL database');
} else {
    const sqlite3 = require('sqlite3').verbose();
    db = new sqlite3.Database('./database.db', (err) => {
        if (err) {
            console.error('❌ Error opening database:', err);
            process.exit(1);
        }
        console.log('✓ Using SQLite database');
    });
}

async function query(sql, params = []) {
    if (isPostgres) {
        const result = await pool.query(sql, params);
        return result.rows;
    } else {
        const sqliteQuery = sql.replace(/\$(\d+)/g, '?');
        return new Promise((resolve, reject) => {
            db.all(sqliteQuery, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
    }
}

async function execute(sql, params = []) {
    if (isPostgres) {
        await pool.query(sql, params);
    } else {
        const sqliteQuery = sql.replace(/\$(\d+)/g, '?');
        return new Promise((resolve, reject) => {
            db.run(sqliteQuery, params, function(err) {
                if (err) reject(err);
                else resolve(this);
            });
        });
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function run() {
    try {
        const appUrl = 'https://store.entermaya.com';
        const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(); // 30 days

        const users = await query('SELECT id, email FROM users WHERE email IS NOT NULL');
        console.log(`Found ${users.length} users to send magic links to.`);

        let sent = 0;
        for (const user of users) {
            if (!user.email) continue;
            const token = crypto.randomUUID();
            const link = `${appUrl}/auth/magic?token=${token}`;

            await execute(
                `UPDATE users SET magic_link_token = $1, magic_link_expires_at = $2 WHERE id = $3`,
                [token, expiresAt, user.id]
            );

            const result = await emailService.sendMagicLink(user.email, link);
            if (result.success) sent++;

            // Gentle rate limit
            await delay(150);
            if (sent % 50 === 0) {
                console.log(`Sent ${sent} / ${users.length} magic links...`);
            }
        }

        console.log(`\n✓ Completed sending magic links. Sent: ${sent}/${users.length}`);
    } catch (err) {
        console.error('✗ Error sending magic links:', err);
    } finally {
        if (isPostgres && pool) {
            await pool.end();
        } else if (db) {
            db.close();
        }
    }
}

run();

