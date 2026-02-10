require('dotenv').config();
const { Pool } = require('pg');

async function checkUsers() {
    const pool = new Pool({
        connectionString: process.env.DATABASE_URL,
    });

    try {
        // Check test user
        const testUser = await pool.query(
            'SELECT id, email, backer_name FROM users WHERE email = $1',
            ['mehul.entermaya@gmail.com']
        );
        console.log('Test User:', testUser.rows.length > 0 ? testUser.rows[0] : 'NOT FOUND');
        
        // Check admin
        const admin = await pool.query(
            'SELECT id, email FROM admins LIMIT 1'
        );
        console.log('Admin:', admin.rows.length > 0 ? admin.rows[0] : 'NOT FOUND');
        
        // List all users with mehul in email
        const allMehul = await pool.query(
            "SELECT id, email, backer_name FROM users WHERE email LIKE '%mehul%' OR email LIKE '%test%'"
        );
        console.log('\nAll test/mehul users:');
        allMehul.rows.forEach(u => console.log(`  - ${u.email} (ID: ${u.id})`));
        
        await pool.end();
    } catch (error) {
        console.error('❌ Error:', error.message);
        await pool.end();
        process.exit(1);
    }
}

checkUsers();

