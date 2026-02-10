const { query, queryOne, execute } = require('../index');

/**
 * Item Model - Master SKU list operations
 */

// Get all items
async function findAll(filters = {}) {
    let sql = 'SELECT * FROM items WHERE 1=1';
    const params = [];
    let paramIndex = 1;
    
    if (filters.active !== undefined) {
        sql += ` AND active = $${paramIndex}`;
        params.push(filters.active ? 1 : 0);
        paramIndex++;
    }
    
    if (filters.type) {
        sql += ` AND type = $${paramIndex}`;
        params.push(filters.type);
        paramIndex++;
    }
    
    if (filters.category) {
        sql += ` AND category = $${paramIndex}`;
        params.push(filters.category);
        paramIndex++;
    }
    
    sql += ' ORDER BY id';
    
    return await query(sql, params);
}

// Get item by ID
async function findById(itemId) {
    return await queryOne('SELECT * FROM items WHERE id = $1 AND active = 1', [itemId]);
}

// Get item by SKU
async function findBySku(sku) {
    return await queryOne('SELECT * FROM items WHERE sku = $1 AND active = 1', [sku]);
}

// Get all add-ons (purchasable items, not pledges)
async function findAllAddons() {
    return await query(`
        SELECT * FROM items 
        WHERE type = 'addon' AND active = 1 
        ORDER BY id
    `);
}

// Get all pledges
async function findAllPledges() {
    return await query(`
        SELECT * FROM items 
        WHERE type = 'pledge' AND active = 1 
        ORDER BY id
    `);
}

// Get items for a pledge (from pledge_items mapping)
async function getPledgeItems(pledgeId) {
    return await query(`
        SELECT i.*, pi.quantity 
        FROM items i
        JOIN pledge_items pi ON i.id = pi.item_id
        WHERE pi.pledge_id = $1
        ORDER BY i.id
    `, [pledgeId]);
}

// Get pledge by reward title (for KS migration)
async function findPledgeByRewardTitle(rewardTitle) {
    const titleMap = {
        'The Humble Vaanar': 101,
        'The Industrious Manushya': 102,
        'The Resplendent Garuda': 103,
        'The Benevolent Divya': 104,
        'Founders of Neh': 105
    };
    
    const pledgeId = titleMap[rewardTitle];
    if (!pledgeId) return null;
    
    return await findById(pledgeId);
}

module.exports = {
    findAll,
    findById,
    findBySku,
    findAllAddons,
    findAllPledges,
    getPledgeItems,
    findPledgeByRewardTitle
};
