const { query, queryOne, execute } = require('../index');

/**
 * Backer Model - Unified backer operations using identity_id
 */

// Find backer by identity_id
async function findByIdentityId(identityId) {
    return await queryOne('SELECT * FROM backers WHERE identity_id = $1', [identityId]);
}

// Find backer by email
async function findByEmail(email) {
    return await queryOne('SELECT * FROM backers WHERE email = $1', [email]);
}

// Find backer by Stripe payment intent
async function findByStripePaymentIntent(paymentIntentId) {
    return await queryOne('SELECT * FROM backers WHERE stripe_payment_intent = $1', [paymentIntentId]);
}

// Find or create backer by email (for guests)
async function findOrCreateByEmail(email, defaults = {}) {
    let backer = await findByEmail(email);
    
    if (!backer) {
        // Generate UUID for new identity
        const { randomUUID } = require('crypto');
        const identityId = randomUUID();
        
        await execute(`INSERT INTO backers (identity_id, email, name, created_at) 
            VALUES ($1, $2, $3, CURRENT_TIMESTAMP)`, 
            [identityId, email, defaults.name || null]);
        
        backer = await findByIdentityId(identityId);
    }
    
    return backer;
}

// Update backer
async function update(identityId, updates) {
    const fields = [];
    const values = [];
    let paramIndex = 1;
    
    Object.keys(updates).forEach(key => {
        if (updates[key] !== undefined) {
            fields.push(`${key} = $${paramIndex}`);
            values.push(updates[key]);
            paramIndex++;
        }
    });
    
    if (fields.length === 0) return null;
    
    // Add updated_at as parameterized value to avoid CURRENT_TIMESTAMP conversion issue
    if (!updates.updated_at) {
        fields.push(`updated_at = $${paramIndex}`);
        values.push(new Date().toISOString());
        paramIndex++;
    }
    
    values.push(identityId);
    await execute(`UPDATE backers SET ${fields.join(', ')} WHERE identity_id = $${paramIndex}`, values);
    
    return await findByIdentityId(identityId);
}

// Get all backers (with pagination)
async function findAll(limit = 100, offset = 0) {
    return await query('SELECT * FROM backers ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
}

// Get backer with all items (pledge + add-ons)
async function findWithItems(identityId) {
    const backer = await findByIdentityId(identityId);
    if (!backer) return null;
    
    // Get pledge items (from pledge_items table)
    let pledgeItems = [];
    if (backer.ks_pledge_id) {
        pledgeItems = await query(`
            SELECT i.*, pi.quantity 
            FROM items i
            JOIN pledge_items pi ON i.id = pi.item_id
            WHERE pi.pledge_id = $1
        `, [backer.ks_pledge_id]);
    }
    
    // Get add-on items (from backer_items table)
    const addonItems = await query(`
        SELECT i.*, bi.quantity, bi.source, bi.price_paid
        FROM items i
        JOIN backer_items bi ON i.id = bi.item_id
        WHERE bi.identity_id = $1
    `, [identityId]);
    
    return {
        ...backer,
        pledgeItems,
        addonItems
    };
}

// Get backer stats
async function getStats(identityId) {
    const backer = await findWithItems(identityId);
    if (!backer) return null;
    
    const totalItems = (backer.pledgeItems || []).length + (backer.addonItems || []).length;
    const totalValue = (backer.ks_pledge_amount || 0) + (backer.pm_addons_subtotal || 0);
    
    return {
        totalItems,
        totalValue,
        hasPledge: !!backer.ks_pledge_id,
        hasAddons: (backer.addonItems || []).length > 0,
        fulfillmentStatus: backer.fulfillment_status
    };
}

module.exports = {
    findByIdentityId,
    findByEmail,
    findByStripePaymentIntent,
    findOrCreateByEmail,
    update,
    findAll,
    findWithItems,
    getStats
};
