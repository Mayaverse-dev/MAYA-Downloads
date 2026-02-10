const { query, queryOne, execute } = require('../index');
const backerModel = require('./backer');

/**
 * Order Model - Now uses backers table and backer_items
 * Orders are stored as fields in the backers table
 */

// Create a new order (updates backer record and creates backer_items)
async function create({ userId, identityId: paramIdentityId, newAddons, pledgeItem, shippingAddress, shippingCost, addonsSubtotal, total, stripeCustomerId, stripePaymentIntentId, paymentStatus, paid }) {
    // Support both userId and identityId parameters
    const identityId = paramIdentityId || userId;
    
    if (!identityId) {
        throw new Error('identity_id is required to create an order');
    }
    
    // Normalize shipping address field names
    const normalizedAddress = {
        name: shippingAddress?.name || shippingAddress?.fullName || null,
        address1: shippingAddress?.address1 || shippingAddress?.addressLine1 || null,
        address2: shippingAddress?.address2 || shippingAddress?.addressLine2 || null,
        city: shippingAddress?.city || null,
        state: shippingAddress?.state || null,
        postal: shippingAddress?.postal || shippingAddress?.postalCode || null,
        country: shippingAddress?.country || null,
        phone: shippingAddress?.phone || null,
        email: shippingAddress?.email || null
    };
    
    // Build update object for backer record
    const backerUpdate = {
        pm_addons_subtotal: addonsSubtotal,
        pm_shipping_cost: shippingCost,
        pm_total: total,
        pm_paid: paid ? 1 : 0,
        pm_status: paymentStatus || 'pending',
        stripe_customer_id: stripeCustomerId,
        stripe_payment_intent: stripePaymentIntentId,
        pm_created_at: new Date().toISOString(),
        // Update shipping address
        ship_name: normalizedAddress.name,
        ship_address_1: normalizedAddress.address1,
        ship_address_2: normalizedAddress.address2,
        ship_city: normalizedAddress.city,
        ship_state: normalizedAddress.state,
        ship_postal: normalizedAddress.postal,
        ship_country: normalizedAddress.country,
        ship_phone: normalizedAddress.phone
    };
    
    // If cart contains a pledge (for guests/non-backers purchasing a pledge), store it
    // This enables upgrade/downgrade logic for returning non-backers
    if (pledgeItem && pledgeItem.id) {
        console.log('📦 Storing pledge for non-backer:', pledgeItem.name, '($' + pledgeItem.price + ')');
        backerUpdate.ks_pledge_id = pledgeItem.id;
        backerUpdate.ks_pledge_amount = pledgeItem.price;
    }
    
    // Update backer record with order info
    await backerModel.update(identityId, backerUpdate);
    
    // Create backer_items entries for add-ons
    if (Array.isArray(newAddons) && newAddons.length > 0) {
        for (const addon of newAddons) {
            await execute(`
                INSERT INTO backer_items (identity_id, item_id, quantity, source, price_paid)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT(identity_id, item_id, source) DO UPDATE SET
                    quantity = backer_items.quantity + EXCLUDED.quantity,
                    price_paid = EXCLUDED.price_paid
            `, [
                identityId,
                addon.id || addon.item_id,
                addon.quantity || 1,
                'pm_addon',
                addon.price || null
            ]);
        }
    }
    
    // Return order-like object for compatibility
    const backer = await backerModel.findByIdentityId(identityId);
    return {
        id: backer.pm_order_id || identityId, // Use pm_order_id if exists
        identity_id: identityId,
        user_id: identityId, // Legacy field name, actually identity_id
        new_addons: newAddons,
        shipping_address: shippingAddress,
        shipping_cost: shippingCost,
        addons_subtotal: addonsSubtotal,
        total: total,
        stripe_customer_id: stripeCustomerId,
        stripe_payment_intent_id: stripePaymentIntentId,
        payment_status: paymentStatus,
        paid: paid ? 1 : 0,
        created_at: backer.pm_created_at || new Date().toISOString()
    };
}

// Get order by ID (now looks up by identity_id or pm_order_id)
async function findById(orderId) {
    // Try to find by pm_order_id first, then by identity_id
    let backer = await queryOne('SELECT * FROM backers WHERE pm_order_id = $1', [orderId]);
    if (!backer) {
        backer = await queryOne('SELECT * FROM backers WHERE identity_id = $1', [orderId]);
    }
    if (!backer) return null;
    
    // Get add-on items
    const addonItems = await query(`
        SELECT i.*, bi.quantity, bi.price_paid
        FROM items i
        JOIN backer_items bi ON i.id = bi.item_id
        WHERE bi.identity_id = $1 AND bi.source = 'pm_addon'
    `, [backer.identity_id]);
    
    return {
        id: backer.pm_order_id || backer.identity_id,
        identity_id: backer.identity_id,
        user_id: backer.identity_id,
        email: backer.email,
        backer_number: backer.ks_backer_number,
        backer_name: backer.name,
        new_addons: addonItems.map(item => ({
            id: item.id,
            name: item.name,
            quantity: item.quantity,
            price: item.price_paid || item.price
        })),
        shipping_address: {
            name: backer.ship_name,
            address1: backer.ship_address_1,
            address2: backer.ship_address_2,
            city: backer.ship_city,
            state: backer.ship_state,
            postal: backer.ship_postal,
            country: backer.ship_country,
            phone: backer.ship_phone,
            email: backer.email
        },
        shipping_cost: backer.pm_shipping_cost,
        addons_subtotal: backer.pm_addons_subtotal,
        total: backer.pm_total,
        stripe_customer_id: backer.stripe_customer_id,
        stripe_payment_intent_id: backer.stripe_payment_intent,
        stripe_payment_method: backer.stripe_payment_method,
        stripe_payment_method_id: backer.stripe_payment_method,
        payment_status: backer.pm_status,
        paid: backer.pm_paid,
        comped_items: backer.pm_comped_items,
        created_at: backer.pm_created_at || backer.created_at
    };
}

// Get order by payment intent ID
async function findByPaymentIntentId(paymentIntentId) {
    const backer = await queryOne('SELECT * FROM backers WHERE stripe_payment_intent = $1', [paymentIntentId]);
    if (!backer) return null;
    
    return await findById(backer.identity_id);
}

// Update payment method ID
async function updatePaymentMethod(paymentIntentId, paymentMethodId, paymentStatus, paid) {
    await backerModel.update(
        (await queryOne('SELECT identity_id FROM backers WHERE stripe_payment_intent = $1', [paymentIntentId]))?.identity_id,
        {
            stripe_payment_method: paymentMethodId,
            pm_status: paymentStatus,
            pm_paid: paid ? 1 : 0
        }
    );
}

// Update order payment status
async function updatePaymentStatus(orderId, paymentStatus, paid, paymentIntentId) {
    console.log(`  Updating payment status for order: ${orderId}`);
    console.log(`    - Status: ${paymentStatus}, Paid: ${paid}, PI: ${paymentIntentId}`);
    
    // Pass orderId twice for SQLite compatibility (each ? needs a parameter)
    const backer = await queryOne('SELECT identity_id FROM backers WHERE pm_order_id = $1 OR identity_id = $2', [orderId, orderId]);
    const identityId = backer?.identity_id;
    
    if (!identityId) {
        console.log(`    ✗ Could not find backer for orderId: ${orderId}`);
        return;
    }
    
    console.log(`    - Found identity_id: ${identityId}`);
    
    await backerModel.update(identityId, {
        pm_paid: paid ? 1 : 0,
        pm_status: paymentStatus,
        stripe_payment_intent: paymentIntentId
    });
    
    console.log(`    ✓ Payment status updated`);
}

// Confirm payment
async function confirmPayment(paymentIntentId, userId) {
    // userId is now identity_id
    await backerModel.update(userId, {
        pm_paid: 1,
        pm_status: 'paid'
    });
}

// Get all orders with saved cards ready to charge
async function findReadyToCharge() {
    return await query(`
        SELECT * FROM backers 
        WHERE pm_status = 'card_saved' 
        AND pm_paid = 0 
        AND stripe_customer_id IS NOT NULL 
        AND stripe_payment_method IS NOT NULL
    `);
}

// Get all orders (for admin)
async function findAll() {
    return await query(`
        SELECT 
            identity_id as id,
            identity_id,
            email,
            ks_backer_number as backer_number,
            name as backer_name,
            pm_order_id,
            pm_status as payment_status,
            pm_total as total,
            pm_paid as paid,
            pm_created_at as created_at
        FROM backers 
        WHERE pm_order_id IS NOT NULL OR pm_total IS NOT NULL
        ORDER BY pm_created_at DESC, created_at DESC
    `);
}

// Update comped items (stored in backers.pm_comped_items)
async function updateCompedItems(orderId, compedItems, adminId) {
    const identityId = (await queryOne('SELECT identity_id FROM backers WHERE pm_order_id = $1 OR identity_id = $2', [orderId, orderId]))?.identity_id;
    if (!identityId) return;
    
    await backerModel.update(identityId, {
        pm_comped_items: JSON.stringify(compedItems)
    });
}

// Get order statistics (for admin)
async function getStats() {
    const stats = {};
    
    const r1 = await query('SELECT COUNT(*) as total FROM backers WHERE pm_paid = 1');
    stats.completedOrders = parseInt(r1[0]?.total || 0);
    
    const r2 = await query('SELECT SUM(pm_total) as revenue FROM backers WHERE pm_paid = 1');
    stats.totalRevenue = parseFloat(r2[0]?.revenue || 0);
    
    const r3 = await query('SELECT COUNT(*) as total FROM backers WHERE pm_paid = 0 AND pm_total IS NOT NULL');
    stats.pendingOrders = parseInt(r3[0]?.total || 0);
    
    return stats;
}

// Helper function to log emails to database
async function logEmail({ orderId, userId, recipientEmail, emailType, subject, status, resendMessageId, errorMessage }) {
    try {
        // Get identity_id from orderId or userId
        let identityId = null;
        if (orderId) {
            const backer = await queryOne('SELECT identity_id FROM backers WHERE pm_order_id = $1 OR identity_id = $2', [orderId, orderId]);
            identityId = backer?.identity_id;
        }
        if (!identityId && userId) {
            identityId = userId; // userId is now identity_id
        }
        
        await execute(`INSERT INTO email_logs (
            identity_id, email_type, subject, 
            status, message_id
        ) VALUES ($1, $2, $3, $4, $5)`, 
        [
            identityId,
            emailType,
            subject,
            status,
            resendMessageId || null
        ]);
    } catch (err) {
        console.error('⚠️  Failed to log email to database:', err.message);
    }
}

// Get email logs (for admin)
async function getEmailLogs(limit = 500) {
    return await query(`
        SELECT el.*, b.email, b.name as backer_name, b.ks_backer_number
        FROM email_logs el
        LEFT JOIN backers b ON el.identity_id = b.identity_id
        ORDER BY el.sent_at DESC 
        LIMIT $1
    `, [limit]);
}

// Find all orders by user ID (now identity_id)
async function findByUserId(userId) {
    // userId is now identity_id
    const backer = await backerModel.findByIdentityId(userId);
    if (!backer || !backer.pm_order_id) return [];
    
    // Return array with single order (backer record)
    return [await findById(backer.identity_id)];
}

module.exports = {
    create,
    findById,
    findByPaymentIntentId,
    updatePaymentMethod,
    updatePaymentStatus,
    confirmPayment,
    findReadyToCharge,
    findAll,
    updateCompedItems,
    getStats,
    logEmail,
    getEmailLogs,
    findByUserId
};
