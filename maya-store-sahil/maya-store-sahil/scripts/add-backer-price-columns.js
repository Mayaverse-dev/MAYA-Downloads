require('dotenv').config();
const { Pool } = require('pg');

async function addColumns() {
    console.log('\n🔧 Adding backer_price columns...\n');
    
    if (!process.env.DATABASE_URL) {
        console.error('❌ DATABASE_URL not set.');
        process.exit(1);
    }
    
    try {
        const pool = new Pool({
            connectionString: process.env.DATABASE_URL,
            ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
        });
        
        console.log('✓ Connected to PostgreSQL database');
        
        // Add column to products table
        try {
            await pool.query('ALTER TABLE products ADD COLUMN IF NOT EXISTS backer_price REAL');
            console.log('✓ Added backer_price column to products table');
        } catch (err) {
            console.log('⚠️  Products table:', err.message);
        }
        
        // Add column to addons table
        try {
            await pool.query('ALTER TABLE addons ADD COLUMN IF NOT EXISTS backer_price REAL');
            console.log('✓ Added backer_price column to addons table');
        } catch (err) {
            console.log('⚠️  Addons table:', err.message);
        }
        
        await pool.end();
        console.log('\n✅ Columns added successfully!\n');
        
    } catch (error) {
        console.error('\n❌ Failed:', error.message);
        process.exit(1);
    }
}

addColumns();

