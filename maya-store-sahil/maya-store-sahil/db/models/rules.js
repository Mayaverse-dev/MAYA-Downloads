const { query, queryOne, execute } = require('../index');

/**
 * Rules Model - Database-driven rules management
 */

/**
 * Get a single rule value
 * @param {string} category - Rule category (e.g., 'cart', 'profile.guest')
 * @param {string} key - Rule key (e.g., 'max_quantity_per_item', 'pricing_type')
 * @returns {Promise<string|number|boolean|object>} - Parsed rule value
 */
async function get(category, key) {
    const rule = await queryOne(
        'SELECT rule_value, data_type FROM rules WHERE category = $1 AND rule_key = $2',
        [category, key]
    );
    
    if (!rule) {
        return null;
    }
    
    // Parse based on data_type
    switch (rule.data_type) {
        case 'number':
            return parseFloat(rule.rule_value) || 0;
        case 'boolean':
            return rule.rule_value === 'true' || rule.rule_value === '1';
        case 'json':
            try {
                return JSON.parse(rule.rule_value);
            } catch {
                return rule.rule_value;
            }
        default:
            return rule.rule_value;
    }
}

/**
 * Get all rules in a category
 * @param {string} category - Rule category
 * @returns {Promise<Array>} - Array of rule objects
 */
async function getByCategory(category) {
    const rules = await query(
        'SELECT rule_key, rule_value, data_type, description FROM rules WHERE category = $1',
        [category]
    );
    
    return rules.map(rule => {
        let value = rule.rule_value;
        
        // Parse based on data_type
        switch (rule.data_type) {
            case 'number':
                value = parseFloat(rule.rule_value) || 0;
                break;
            case 'boolean':
                value = rule.rule_value === 'true' || rule.rule_value === '1';
                break;
            case 'json':
                try {
                    value = JSON.parse(rule.rule_value);
                } catch {
                    value = rule.rule_value;
                }
                break;
        }
        
        return {
            key: rule.rule_key,
            value,
            dataType: rule.data_type,
            description: rule.description
        };
    });
}

/**
 * Set/update a rule
 * @param {string} category - Rule category
 * @param {string} key - Rule key
 * @param {string|number|boolean|object} value - Rule value
 * @param {string} dataType - Data type ('string', 'number', 'boolean', 'json')
 * @param {string} description - Optional description
 * @returns {Promise<void>}
 */
async function set(category, key, value, dataType = 'string', description = null) {
    let stringValue = String(value);
    
    // Convert to string based on type
    if (dataType === 'json' && typeof value === 'object') {
        stringValue = JSON.stringify(value);
    } else if (dataType === 'boolean') {
        stringValue = value ? 'true' : 'false';
    } else if (dataType === 'number') {
        stringValue = String(value);
    }
    
    // Use INSERT OR REPLACE for SQLite, UPSERT for Postgres
    const isPostgres = require('../index').getIsPostgres();
    
    if (isPostgres) {
        await execute(
            `INSERT INTO rules (category, rule_key, rule_value, data_type, description, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)
             ON CONFLICT (category, rule_key) 
             DO UPDATE SET rule_value = $3, data_type = $4, description = $5, updated_at = CURRENT_TIMESTAMP`,
            [category, key, stringValue, dataType, description]
        );
    } else {
        // SQLite
        await execute(
            `INSERT OR REPLACE INTO rules (category, rule_key, rule_value, data_type, description, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP)`,
            [category, key, stringValue, dataType, description]
        );
    }
}

/**
 * Get all rules (for admin)
 * @returns {Promise<Array>} - All rules grouped by category
 */
async function getAll() {
    const rules = await query(
        'SELECT id, category, rule_key, rule_value, data_type, description, updated_at FROM rules ORDER BY category, rule_key'
    );
    
    // Group by category
    const grouped = {};
    for (const rule of rules) {
        if (!grouped[rule.category]) {
            grouped[rule.category] = [];
        }
        
        let value = rule.rule_value;
        switch (rule.data_type) {
            case 'number':
                value = parseFloat(rule.rule_value) || 0;
                break;
            case 'boolean':
                value = rule.rule_value === 'true' || rule.rule_value === '1';
                break;
            case 'json':
                try {
                    value = JSON.parse(rule.rule_value);
                } catch {
                    value = rule.rule_value;
                }
                break;
        }
        
        grouped[rule.category].push({
            id: rule.id,
            key: rule.rule_key,
            value,
            dataType: rule.data_type,
            description: rule.description,
            updatedAt: rule.updated_at
        });
    }
    
    return grouped;
}

/**
 * Delete a rule
 * @param {string} category - Rule category
 * @param {string} key - Rule key
 * @returns {Promise<void>}
 */
async function remove(category, key) {
    await execute(
        'DELETE FROM rules WHERE category = $1 AND rule_key = $2',
        [category, key]
    );
}

module.exports = {
    get,
    getByCategory,
    set,
    getAll,
    remove
};
