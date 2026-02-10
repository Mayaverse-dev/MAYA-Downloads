const { query, queryOne, execute } = require('../index');
const bcrypt = require('bcrypt');

// Find admin by email
async function findByEmail(email) {
    return await queryOne('SELECT * FROM admins WHERE email = $1', [email]);
}

// Find admin by ID
async function findById(adminId) {
    return await queryOne('SELECT * FROM admins WHERE id = $1', [adminId]);
}

// Create a new admin
async function create({ email, password, name }) {
    const hash = await bcrypt.hash(password, 10);
    await execute('INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)', 
        [email, hash, name || 'Admin']);
    return await findByEmail(email);
}

// Verify admin password
async function verifyPassword(email, password) {
    const admin = await findByEmail(email);
    if (!admin) return null;
    
    const match = await bcrypt.compare(password, admin.password);
    return match ? admin : null;
}

// Get user count (for admin stats) - now uses backers table
async function getUserCount() {
    const result = await query('SELECT COUNT(*) as total FROM backers');
    return parseInt(result[0]?.total || 0);
}

module.exports = {
    findByEmail,
    findById,
    create,
    verifyPassword,
    getUserCount
};
