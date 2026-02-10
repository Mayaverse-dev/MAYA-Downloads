const { execute, queryOne } = require('./index');
const bcrypt = require('bcrypt');

// Attempt to add a column; ignore if it already exists
async function addColumnIfMissing(table, columnDef) {
    try {
        await execute(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`);
        console.log(`✓ Added column to ${table}: ${columnDef}`);
    } catch (err) {
        // SQLite/Postgres will throw if column exists; ignore
        const msg = err.message || '';
        if (msg.includes('duplicate column') || msg.includes('already exists')) {
            return;
        }
        console.warn(`⚠️  Could not add column ${columnDef} to ${table}:`, err.message);
    }
}

// Create default admin account
async function createDefaultAdmin() {
    const adminEmail = process.env.ADMIN_EMAIL || 'hello@entermaya.com';
    const adminPassword = process.env.ADMIN_PASSWORD || 'changeme123';
    
    try {
        const admin = await queryOne('SELECT * FROM admins WHERE email = $1', [adminEmail]);
        if (!admin) {
            const hash = await bcrypt.hash(adminPassword, 10);
            await execute('INSERT INTO admins (email, password, name) VALUES ($1, $2, $3)', 
                [adminEmail, hash, 'Admin']);
            console.log('✓ Default admin created:', adminEmail);
        }
    } catch (err) {
        console.error('Error creating admin:', err);
    }
}

// Create default project milestones
async function createDefaultMilestones() {
    try {
        const existing = await queryOne('SELECT COUNT(*) as count FROM project_milestones');
        if (existing && parseInt(existing.count) > 0) {
            return; // Milestones already exist
        }
        
        const milestones = [
            { title: 'Campaign Funded', description: 'Kickstarter campaign successfully funded', status: 'completed', sort_order: 1, completed_date: '2024-12-15' },
            { title: 'Seed Takes Root', description: 'Manuscript editing finalized', status: 'completed', sort_order: 2, completed_date: '2025-01-10' },
            { title: 'Typesetting & Review', description: 'Book layout and design review', status: 'in_progress', sort_order: 3, completed_date: null },
            { title: 'Print Production', description: 'Books sent to printer', status: 'upcoming', sort_order: 4, completed_date: null },
            { title: 'eBook Launch', description: 'Digital edition available', status: 'upcoming', sort_order: 5, completed_date: null },
            { title: 'Physical Fulfillment', description: 'Books shipped to backers', status: 'upcoming', sort_order: 6, completed_date: null }
        ];
        
        for (const m of milestones) {
            await execute(
                `INSERT INTO project_milestones (title, description, status, sort_order, completed_date) 
                 VALUES ($1, $2, $3, $4, $5)`,
                [m.title, m.description, m.status, m.sort_order, m.completed_date]
            );
        }
        
        console.log('✓ Default project milestones created');
    } catch (err) {
        console.error('Error creating milestones:', err);
    }
}

// Seed default rules - ensures all required rules exist
async function seedDefaultRules() {
    try {
        // Load shipping rates config dynamically to avoid circular dependencies
        const shippingRates = require('../config/shipping-rates');
        
        // Cart rules
        const cartRules = [
            { category: 'cart', rule_key: 'max_quantity_per_item', rule_value: '10', data_type: 'number', description: 'Maximum quantity per item in cart' },
            { category: 'cart', rule_key: 'min_quantity', rule_value: '1', data_type: 'number', description: 'Minimum quantity per item' },
            { category: 'cart', rule_key: 'max_items_in_cart', rule_value: '50', data_type: 'number', description: 'Maximum unique items in cart' },
            { category: 'cart', rule_key: 'max_total_amount', rule_value: '10000', data_type: 'number', description: 'Maximum order total in USD' }
        ];
        
        // Auth rules
        const authRules = [
            { category: 'auth', rule_key: 'otp_ttl_minutes', rule_value: '15', data_type: 'number', description: 'OTP code expiration time in minutes' },
            { category: 'auth', rule_key: 'magic_link_ttl_days', rule_value: '7', data_type: 'number', description: 'Magic link expiration time in days' },
            { category: 'auth', rule_key: 'rate_limit_minutes', rule_value: '10', data_type: 'number', description: 'Rate limit lockout duration in minutes' },
            { category: 'auth', rule_key: 'max_failed_attempts', rule_value: '3', data_type: 'number', description: 'Maximum failed login attempts before lockout' }
        ];
        
        // Profile rules
        const profileRules = [
            { category: 'profile.guest', rule_key: 'pricing_type', rule_value: 'retail', data_type: 'string', description: 'Guest users pay retail prices' },
            { category: 'profile.guest', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string', description: 'Guest payments charged immediately' },
            { category: 'profile.collected', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string', description: 'Collected backers get backer prices' },
            { category: 'profile.collected', rule_key: 'payment_method', rule_value: 'card_saved', data_type: 'string', description: 'Collected backers save card for bulk charge' },
            { category: 'profile.dropped', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string', description: 'Dropped backers still get backer prices' },
            { category: 'profile.dropped', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string', description: 'Dropped backers charged immediately' },
            { category: 'profile.canceled', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string', description: 'Canceled backers still get backer prices' },
            { category: 'profile.canceled', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string', description: 'Canceled backers charged immediately' },
            { category: 'profile.pot', rule_key: 'pricing_type', rule_value: 'backer', data_type: 'string', description: 'Payment-over-time backers get backer prices' },
            { category: 'profile.pot', rule_key: 'payment_method', rule_value: 'card_saved', data_type: 'string', description: 'PoT backers save card for bulk charge' },
            { category: 'profile.late_pledge', rule_key: 'pricing_type', rule_value: 'retail', data_type: 'string', description: 'Late pledge backers pay retail prices' },
            { category: 'profile.late_pledge', rule_key: 'payment_method', rule_value: 'immediate', data_type: 'string', description: 'Late pledge backers charged immediately' }
        ];
        
        // Shipping rules - store zones and rates as JSON
        const shippingRules = [
            { 
                category: 'shipping', 
                rule_key: 'zones', 
                rule_value: JSON.stringify(shippingRates.shippingRates), 
                data_type: 'json', 
                description: 'Shipping zones configuration' 
            }
        ];
        
        // Insert all rules using UPSERT (insert if not exists)
        const allRules = [...cartRules, ...authRules, ...profileRules, ...shippingRules];
        let inserted = 0;
        
        for (const rule of allRules) {
            try {
                // PostgreSQL UPSERT - insert only if not exists (don't update existing)
                await execute(
                    `INSERT INTO rules (category, rule_key, rule_value, data_type, description)
                     VALUES ($1, $2, $3, $4, $5)
                     ON CONFLICT (category, rule_key) DO NOTHING`,
                    [rule.category, rule.rule_key, rule.rule_value, rule.data_type, rule.description]
                );
                inserted++;
            } catch (err) {
                console.warn(`Failed to insert rule ${rule.category}.${rule.rule_key}:`, err.message);
            }
        }
        
        console.log(`✓ Rules table checked - ${allRules.length} rules ensured`);
    } catch (err) {
        console.error('Error seeding rules:', err);
    }
}

// Initialize database tables - PostgreSQL only
async function initializeDatabase() {
    try {
        // Check if backers table exists
        const backersExists = await queryOne(`
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'backers'
            ) as exists
        `).catch(() => null);
        
        if (backersExists && !backersExists.exists) {
            console.log('⚠️  Schema not found. Please run migration script first.');
            return;
        }
        
        console.log('✓ Database schema detected');
        
        // Only create/update tables that might be missing from migration
        // Items table (should already exist from migration)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS items (
                id SERIAL PRIMARY KEY,
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
        } catch (err) {
            // Table might already exist from migration
        }
        
        // Pledge items mapping (should already exist)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS pledge_items (
                pledge_id INTEGER NOT NULL,
                item_id INTEGER NOT NULL,
                quantity INTEGER DEFAULT 1,
                PRIMARY KEY (pledge_id, item_id),
                FOREIGN KEY (pledge_id) REFERENCES items(id),
                FOREIGN KEY (item_id) REFERENCES items(id)
            )`);
        } catch (err) {
            // Table might already exist
        }
        
        // Backers table (should already exist from migration)
        // Just ensure it has all columns
        try {
            await addColumnIfMissing('backers', 'updated_at TEXT');
            await addColumnIfMissing('backers', 'admin_notes TEXT');
            await addColumnIfMissing('backers', 'tags TEXT');
        } catch (err) {
            // Ignore
        }
        
        // Backer items (should already exist)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS backer_items (
                identity_id TEXT NOT NULL,
                item_id INTEGER NOT NULL,
                quantity INTEGER DEFAULT 1,
                source TEXT NOT NULL,
                price_paid REAL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (identity_id, item_id, source),
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id),
                FOREIGN KEY (item_id) REFERENCES items(id)
            )`);
        } catch (err) {
            // Table might already exist
        }
        
        // User addresses (created by migration script, but ensure it exists)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS user_addresses (
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
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id)
            )`);
            
            // Create index
            await execute('CREATE INDEX IF NOT EXISTS idx_user_addresses_identity ON user_addresses(identity_id)').catch(() => {});
        } catch (err) {
            // Table might already exist
        }
        
        // Email logs (should already exist)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS email_logs (
                id SERIAL PRIMARY KEY,
                identity_id TEXT,
                email_type TEXT NOT NULL,
                subject TEXT NOT NULL,
                status TEXT DEFAULT 'sent',
                message_id TEXT,
                sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id)
            )`);
            
            // Create index
            await execute('CREATE INDEX IF NOT EXISTS idx_email_logs_identity ON email_logs(identity_id)').catch(() => {});
        } catch (err) {
            // Table might already exist
        }
        
        // Activity log (should already exist)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS activity_log (
                id SERIAL PRIMARY KEY,
                identity_id TEXT,
                admin_id INTEGER,
                action TEXT NOT NULL,
                details TEXT,
                ip_address TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id),
                FOREIGN KEY (admin_id) REFERENCES admins(id)
            )`);
        } catch (err) {
            // Table might already exist
        }

        // Assets table (for digital downloads)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS assets (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                s3_key TEXT UNIQUE NOT NULL,
                category TEXT NOT NULL,
                type TEXT,
                size_bytes INTEGER,
                metadata TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
            console.log('✓ Assets table ready');
        } catch (err) {
            // Table might already exist
        }

        // Admins table (should already exist)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS admins (
                id SERIAL PRIMARY KEY,
                email TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                name TEXT,
                role TEXT DEFAULT 'admin',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
        } catch (err) {
            // Table might already exist
        }
        
        // Project Milestones table (for admin updates)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS project_milestones (
                id SERIAL PRIMARY KEY,
                title VARCHAR(100) NOT NULL,
                description VARCHAR(255),
                status VARCHAR(20) NOT NULL DEFAULT 'upcoming',
                completed_date DATE,
                sort_order INTEGER DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )`);
        } catch (err) {
            // Table might already exist
        }
        
        // Support requests table (for edge cases, bugs, contact requests)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS support_requests (
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
                resolved_at TIMESTAMP,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id),
                FOREIGN KEY (resolved_by) REFERENCES admins(id)
            )`);
            
            // Create index
            await execute('CREATE INDEX IF NOT EXISTS idx_support_status ON support_requests(status)').catch(() => {});
        } catch (err) {
            // Table might already exist
        }
        
        // Download tracking table (for digital assets)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS download_logs (
                id SERIAL PRIMARY KEY,
                identity_id TEXT,
                email TEXT,
                asset_id TEXT NOT NULL,
                asset_name TEXT NOT NULL,
                asset_category TEXT NOT NULL,
                ip_address TEXT,
                user_agent TEXT,
                downloaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id)
            )`);
            
            // Create indexes for analytics
            await execute('CREATE INDEX IF NOT EXISTS idx_download_asset ON download_logs(asset_id)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_download_identity ON download_logs(identity_id)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_download_category ON download_logs(asset_category)').catch(() => {});
        } catch (err) {
            // Table might already exist
        }
        
        // Page visit tracking table
        try {
            await execute(`CREATE TABLE IF NOT EXISTS page_visits (
                id SERIAL PRIMARY KEY,
                identity_id TEXT,
                session_id TEXT,
                page_path TEXT NOT NULL,
                page_title TEXT,
                referrer TEXT,
                ip_address TEXT,
                user_agent TEXT,
                is_authenticated INTEGER DEFAULT 0,
                visit_duration_ms INTEGER,
                visited_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id)
            )`);
            
            // Create indexes for analytics
            await execute('CREATE INDEX IF NOT EXISTS idx_visits_page ON page_visits(page_path)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_visits_identity ON page_visits(identity_id)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_visits_session ON page_visits(session_id)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_visits_date ON page_visits(visited_at)').catch(() => {});
            console.log('✓ Page visits table ready');
        } catch (err) {
            // Table might already exist
        }
        
        // Click/interaction tracking table
        try {
            await execute(`CREATE TABLE IF NOT EXISTS click_events (
                id SERIAL PRIMARY KEY,
                identity_id TEXT,
                session_id TEXT,
                page_path TEXT NOT NULL,
                element_id TEXT,
                element_class TEXT,
                element_text TEXT,
                event_type TEXT DEFAULT 'click',
                metadata TEXT,
                ip_address TEXT,
                clicked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (identity_id) REFERENCES backers(identity_id)
            )`);
            
            // Create indexes
            await execute('CREATE INDEX IF NOT EXISTS idx_clicks_page ON click_events(page_path)').catch(() => {});
            await execute('CREATE INDEX IF NOT EXISTS idx_clicks_element ON click_events(element_id)').catch(() => {});
            console.log('✓ Click events table ready');
        } catch (err) {
            // Table might already exist
        }
        
        // Rules table (for database-driven rules)
        try {
            await execute(`CREATE TABLE IF NOT EXISTS rules (
                id SERIAL PRIMARY KEY,
                category TEXT NOT NULL,
                rule_key TEXT NOT NULL,
                rule_value TEXT NOT NULL,
                data_type TEXT DEFAULT 'string',
                description TEXT,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE(category, rule_key)
            )`);
            
            // Create index for faster lookups
            await execute('CREATE INDEX IF NOT EXISTS idx_rules_category_key ON rules(category, rule_key)').catch(() => {});
            console.log('✓ Rules table ready');
        } catch (err) {
            // Table might already exist
        }
        
        // Create default admin
        await createDefaultAdmin();
        
        // Create default project milestones
        await createDefaultMilestones();
        
        // Seed default rules
        await seedDefaultRules();
        
        console.log('✓ New schema tables verified/created');
        
    } catch (err) {
        console.error('Error initializing database:', err);
        throw err;
    }
}

module.exports = {
    initializeDatabase,
    addColumnIfMissing
};
