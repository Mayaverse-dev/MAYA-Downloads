#!/usr/bin/env node
/**
 * Auto-assign S3 keys to items in database
 * Works with both SQLite (local) and PostgreSQL (production)
 */
require('dotenv').config();
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');

// S3 Setup
const s3Client = new S3Client({
    region: 'auto',
    endpoint: process.env.S3_ENDPOINT_URL,
    credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
});

const BUCKET_NAME = process.env.S3_BUCKET_NAME;

async function autoAssign() {
    // Determine database type
    const isPostgres = !!process.env.DATABASE_URL;
    let db;

    if (isPostgres) {
        const { Pool } = require('pg');
        db = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: { rejectUnauthorized: false }
        });
        db.query = db.query.bind(db);
    } else {
        const sqlite3 = require('sqlite3').verbose();
        const path = require('path');
        const sqliteDb = new sqlite3.Database(path.resolve(__dirname, '../pledgemanager.db'));
        db = {
            query: (sql, params = []) => new Promise((resolve, reject) => {
                // Convert $1, $2 to ? for SQLite
                const sqliteSql = sql.replace(/\$(\d+)/g, '?');
                sqliteDb.all(sqliteSql, params, (err, rows) => {
                    if (err) reject(err);
                    else resolve({ rows: rows || [] });
                });
            }),
            end: () => new Promise(resolve => sqliteDb.close(resolve))
        };
        console.log('Using SQLite database\n');
    }

    try {
        console.log('--- 1. FETCHING DATA FROM S3 ---');
        const s3Command = new ListObjectsV2Command({ Bucket: BUCKET_NAME });
        const s3Response = await s3Client.send(s3Command);
        const s3Keys = (s3Response.Contents || []).map(obj => obj.Key).filter(key => !key.startsWith('_thumbs/') && !key.endsWith('/'));
        console.log(`Found ${s3Keys.length} assets in S3.\n`);

        // Print S3 structure
        console.log('S3 Products:');
        s3Keys.filter(k => k.startsWith('Products/')).forEach(k => console.log('  ' + k));
        console.log('');

        console.log('--- 2. FETCHING ITEMS FROM DB ---');
        const pledges = await db.query("SELECT id, sku, name FROM items WHERE type = 'pledge'");
        const addons = await db.query("SELECT id, sku, name FROM items WHERE type = 'addon'");
        console.log(`Found ${pledges.rows.length} pledges and ${addons.rows.length} add-ons.\n`);

        const normalize = (str) => str.toLowerCase().replace(/[^a-z0-9]/g, '');

        // Manual mappings for known items
        const manualMap = {
            // Pledges
            'humble_vaanar': 'Products/Pledges/vaanar.png',
            'industrious_manushya': 'Products/Pledges/manushya.png',
            'resplendent_garuda': 'Products/Pledges/garuda.png',
            'benevolent_divya': 'Products/Pledges/divya.png',
            'founders_neh': 'Products/Pledges/founders.png',
            // Add-ons
            'paperback': 'Products/Add ons/maya-paperback.png',
            'hardcover': 'Products/Add ons/maya-hardcover.png',
            'ebook': 'Products/Add ons/maya-hardcover.png',
            'audiobook': 'Products/Add ons/maya-audiobook.webp',
            'book2_hc': 'Products/Add ons/maya-hardcover.png',
            'book3_hc': 'Products/Add ons/maya-hardcover.png',
            'book2_live': 'Products/Add ons/maya-hardcover.png',
            'book3_live': 'Products/Add ons/maya-hardcover.png',
            'built_env': 'Products/Add ons/built-environments.png',
            'lorebook': 'Products/Add ons/maya-lorebook.png',
            'pendant': 'Products/Add ons/flitt-locust-pendant.png',
            'art_book': 'Products/Add ons/maya-hardcover.png',
            'character_naming': 'Products/Add ons/maya-hardcover.png',
            'wallpaper': 'Assets/Wallpaper/DESKTOP/HIDAMMA wallpaper DESKTOP.png',
        };

        console.log('--- 3. ASSIGNING PLEDGES ---');
        for (const p of pledges.rows) {
            let s3Key = manualMap[p.sku];
            
            if (!s3Key) {
                // Try to auto-match
                const match = s3Keys.find(key =>
                    key.startsWith('Products/Pledges/') &&
                    normalize(key).includes(normalize(p.name.replace(/The |Humble |Industrious |Resplendent |Benevolent /g, '')))
                );
                s3Key = match;
            }

            if (s3Key && s3Keys.includes(s3Key)) {
                await db.query('UPDATE items SET s3_key = $1 WHERE id = $2', [s3Key, p.id]);
                console.log(`✅ ${p.name} -> ${s3Key}`);
            } else {
                console.log(`❌ No match for pledge: ${p.name} (${p.sku})`);
            }
        }

        console.log('\n--- 4. ASSIGNING ADD-ONS ---');
        for (const a of addons.rows) {
            let s3Key = manualMap[a.sku];
            
            if (!s3Key) {
                // Try to auto-match
                const match = s3Keys.find(key => {
                    if (!key.startsWith('Products/Add ons/') || key.endsWith('/')) return false;
                    const fileName = normalize(key.split('/').pop().split('.')[0]);
                    const addonName = normalize(a.name);
                    return addonName.includes(fileName) || fileName.includes(addonName);
                });
                s3Key = match;
            }

            if (s3Key && s3Keys.includes(s3Key)) {
                await db.query('UPDATE items SET s3_key = $1 WHERE id = $2', [s3Key, a.id]);
                console.log(`✅ ${a.name} -> ${s3Key}`);
            } else {
                console.log(`❌ No match for add-on: ${a.name} (${a.sku})`);
            }
        }

        console.log('\n--- 5. POPULATING ASSETS TABLE ---');
        const renders = s3Keys.filter(k => k.startsWith('Assets/3D Files/Image Renders/'));

        for (const key of s3Keys) {
            let category = null;
            let type = null;
            let name = key.split('/').pop().split('.')[0];
            let metadata = null;

            if (key.startsWith('Assets/Wallpaper/')) {
                category = 'wallpaper';
                type = key.includes('/DESKTOP/') ? 'desktop' : 'phone';
                name = name.replace(' wallpaper', '').replace(' DESKTOP', '');
            } else if (key.startsWith('Assets/3D Files/') && key.endsWith('.stl')) {
                category = '3d';
                type = 'stl';
                const baseName = name.split(' - ')[0].toLowerCase();
                const modelType = baseName.replace(' miniature', '').trim();

                const renderMatch = renders.find(r => {
                    const rName = r.split('/').pop().toLowerCase();
                    const searchName = modelType.replace('vaanar', 'vanaar').replace('gandharva', 'gandharv');
                    return rName.includes(searchName);
                });

                if (renderMatch) {
                    metadata = JSON.stringify({ thumbKey: renderMatch });
                }
                name = name.split(' - ')[0];
            } else if (key.startsWith('Assets/Literature/') && key.endsWith('.pdf')) {
                category = 'literature';
                type = 'pdf';
                name = 'Maya Novel - Chapters 1-6';
            }

            if (category) {
                try {
                    await db.query(`
                        INSERT INTO assets (name, s3_key, category, type, metadata, created_at)
                        VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
                        ON CONFLICT (s3_key) DO UPDATE SET name = $1, category = $3, type = $4, metadata = $5
                    `, [name, key, category, type, metadata]);
                    console.log(`📦 ${category}: ${name}`);
                } catch (e) {
                    // SQLite doesn't support ON CONFLICT the same way
                    try {
                        await db.query('INSERT OR REPLACE INTO assets (name, s3_key, category, type, metadata) VALUES ($1, $2, $3, $4, $5)', 
                            [name, key, category, type, metadata]);
                        console.log(`📦 ${category}: ${name}`);
                    } catch (e2) {
                        console.log(`⚠️ Could not register: ${key}`);
                    }
                }
            }
        }

        console.log('\n--- 6. FINAL VERIFICATION ---');
        const result = await db.query('SELECT id, sku, name, s3_key FROM items ORDER BY id');
        console.log('\nID  | SKU                    | S3 Key');
        console.log('----|------------------------|------------------------------------------');
        result.rows.forEach(r => {
            const status = r.s3_key ? '✓' : '✗';
            console.log(`${status} ${String(r.id).padEnd(3)}| ${r.sku.padEnd(23)}| ${r.s3_key || 'NOT ASSIGNED'}`);
        });

        console.log('\n--- AUTO-ASSIGNMENT COMPLETE ---');

    } catch (err) {
        console.error('Error during auto-assignment:', err);
    } finally {
        await db.end();
    }
}

autoAssign();
