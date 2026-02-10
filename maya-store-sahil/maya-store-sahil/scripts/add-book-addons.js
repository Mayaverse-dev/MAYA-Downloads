require('dotenv').config();
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();

const newAddons = [
    {
        name: 'MAYA: Seed Takes Root (Paperback)',
        price: 25.00,
        backer_price: 18.00,
        weight: 300,
        image: 'vaanar.png',
        description: 'Paperback edition of MAYA: Seed Takes Root',
        active: 1
    },
    {
        name: 'MAYA: Seed Takes Root (Hardcover)',
        price: 50.00,
        backer_price: 35.00,
        weight: 500,
        image: 'manushya.png',
        description: 'Hardcover edition of MAYA: Seed Takes Root',
        active: 1
    }
];

async function addToPostgres() {
    console.log('\n📦 Adding to PostgreSQL (Railway)...\n');
    
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });
    
    try {
        for (const addon of newAddons) {
            // Check if already exists
            const existing = await pool.query(
                'SELECT id FROM addons WHERE name = $1',
                [addon.name]
            );
            
            if (existing.rows.length > 0) {
                console.log(`  ⚠️  ${addon.name} already exists, updating...`);
                await pool.query(
                    `UPDATE addons SET 
                        price = $1, 
                        backer_price = $2, 
                        weight = $3, 
                        image = $4, 
                        description = $5,
                        active = $6
                    WHERE name = $7`,
                    [addon.price, addon.backer_price, addon.weight, addon.image, addon.description, addon.active, addon.name]
                );
                console.log(`  ✓ Updated: ${addon.name} - Retail: $${addon.price}, Backer: $${addon.backer_price}`);
            } else {
                await pool.query(
                    `INSERT INTO addons (name, price, backer_price, weight, image, description, active)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [addon.name, addon.price, addon.backer_price, addon.weight, addon.image, addon.description, addon.active]
                );
                console.log(`  ✓ Added: ${addon.name} - Retail: $${addon.price}, Backer: $${addon.backer_price}`);
            }
        }
        
        await pool.end();
        console.log('\n✅ PostgreSQL update complete!\n');
        
    } catch (error) {
        console.error('❌ PostgreSQL error:', error.message);
        throw error;
    }
}

async function addToSQLite() {
    console.log('📦 Adding to SQLite (Local)...\n');
    
    return new Promise((resolve, reject) => {
        const db = new sqlite3.Database('./database.db', (err) => {
            if (err) {
                reject(err);
                return;
            }
            
            let completed = 0;
            
            newAddons.forEach(addon => {
                // Check if exists
                db.get('SELECT id FROM addons WHERE name = ?', [addon.name], (err, row) => {
                    if (err) {
                        console.error(`  ❌ Error checking ${addon.name}:`, err.message);
                        completed++;
                        if (completed === newAddons.length) {
                            db.close();
                            resolve();
                        }
                        return;
                    }
                    
                    if (row) {
                        // Update existing
                        db.run(
                            `UPDATE addons SET 
                                price = ?, 
                                backer_price = ?, 
                                weight = ?, 
                                image = ?, 
                                description = ?,
                                active = ?
                            WHERE name = ?`,
                            [addon.price, addon.backer_price, addon.weight, addon.image, addon.description, addon.active, addon.name],
                            (err) => {
                                if (err) {
                                    console.error(`  ❌ Error updating ${addon.name}:`, err.message);
                                } else {
                                    console.log(`  ✓ Updated: ${addon.name} - Retail: $${addon.price}, Backer: $${addon.backer_price}`);
                                }
                                completed++;
                                if (completed === newAddons.length) {
                                    db.close();
                                    resolve();
                                }
                            }
                        );
                    } else {
                        // Insert new
                        db.run(
                            `INSERT INTO addons (name, price, backer_price, weight, image, description, active)
                             VALUES (?, ?, ?, ?, ?, ?, ?)`,
                            [addon.name, addon.price, addon.backer_price, addon.weight, addon.image, addon.description, addon.active],
                            (err) => {
                                if (err) {
                                    console.error(`  ❌ Error adding ${addon.name}:`, err.message);
                                } else {
                                    console.log(`  ✓ Added: ${addon.name} - Retail: $${addon.price}, Backer: $${addon.backer_price}`);
                                }
                                completed++;
                                if (completed === newAddons.length) {
                                    db.close();
                                    resolve();
                                }
                            }
                        );
                    }
                });
            });
        });
    });
}

async function main() {
    console.log('\n🚀 Adding new book add-ons...\n');
    
    const isPostgres = !!process.env.DATABASE_URL;
    
    try {
        if (isPostgres) {
            await addToPostgres();
        } else {
            await addToSQLite();
            console.log('\n✅ SQLite update complete!\n');
        }
        
        console.log('✅ All done! The new add-ons are now available.\n');
        
    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

main();

