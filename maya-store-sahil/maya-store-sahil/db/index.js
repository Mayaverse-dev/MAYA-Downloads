const { Pool } = require('pg');

// Create pool immediately at module load (needed for session store)
let pool = null;

function createPool() {
    if (pool) return pool;
    
    if (process.env.PGHOST && process.env.PGDATABASE) {
        const isLocal = process.env.PGHOST === 'localhost' || process.env.PGHOST === '127.0.0.1';
        
        pool = new Pool({
            host: process.env.PGHOST,
            port: process.env.PGPORT || 5432,
            user: process.env.PGUSER,
            password: process.env.PGPASSWORD,
            database: process.env.PGDATABASE,
            ssl: isLocal ? false : { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000  // Increased from 5s to 10s for Railway
        });
    } else if (process.env.DATABASE_URL) {
        const connectionString = process.env.DATABASE_URL;
        const isLocal = connectionString.includes('localhost') || connectionString.includes('127.0.0.1');
        
        pool = new Pool({
            connectionString: connectionString,
            ssl: isLocal ? false : { rejectUnauthorized: false },
            max: 20,
            idleTimeoutMillis: 30000,
            connectionTimeoutMillis: 10000  // Increased from 5s to 10s for Railway
        });
    }
    
    return pool;
}

// Create pool at module load
createPool();

async function connect(retries = 5, delay = 3000) {
    if (!pool) {
        // Try creating pool again in case env vars weren't loaded yet
        createPool();
    }
    
    if (!pool) {
        throw new Error('No PostgreSQL credentials found. Set DATABASE_URL or PG* environment variables.');
    }
    
    const host = process.env.PGHOST || (process.env.DATABASE_URL?.split('@')[1]?.split('/')[0]) || 'database';
    
    for (let attempt = 1; attempt <= retries; attempt++) {
        try {
            console.log(`Attempting DB connection to: ${host} (attempt ${attempt}/${retries})`);
            
            const client = await pool.connect();
            console.log('✓ Connected to PostgreSQL database');
            client.release();
            return 'postgres';
        } catch (err) {
            console.error(`Error connecting to PostgreSQL (attempt ${attempt}/${retries}):`, err.message);
            
            if (attempt === retries) {
                throw err;
            }
            
            console.log(`Retrying in ${delay / 1000} seconds...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// Get the pool for external use (e.g., session store)
function getPool() {
    if (!pool) {
        createPool();
    }
    return pool;
}

// Database query wrapper
async function query(sql, params = []) {
    if (!pool) throw new Error('Database pool not initialized');
    const result = await pool.query(sql, params);
    return result.rows;
}

async function queryOne(sql, params = []) {
    if (!pool) throw new Error('Database pool not initialized');
    const result = await pool.query(sql, params);
    return result.rows[0];
}

async function execute(sql, params = []) {
    if (!pool) throw new Error('Database pool not initialized');
    return await pool.query(sql, params);
}

function getIsPostgres() {
    return true; // Always PostgreSQL now
}

function close() {
    if (pool) {
        return pool.end();
    }
    return Promise.resolve();
}

module.exports = {
    connect,
    getPool,
    query,
    queryOne,
    execute,
    getIsPostgres,
    close
};
