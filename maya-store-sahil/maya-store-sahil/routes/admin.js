const express = require('express');
const router = express.Router();
const adminModel = require('../db/models/admin');
const userModel = require('../db/models/user');
const orderModel = require('../db/models/order');
const orderService = require('../services/orderService');
const rulesModel = require('../db/models/rules');
const paymentService = require('../services/paymentService');
const { requireAdmin } = require('../middleware/auth');
const { sanitizeCompedItems } = require('../middleware/validation');
const { query, execute } = require('../db/index');

// Admin login handler
router.post('/login', async (req, res) => {
    const { email, password } = req.body;
    
    try {
        const admin = await adminModel.verifyPassword(email, password);
        
        if (!admin) {
            return res.status(401).json({ error: 'Invalid credentials' });
        }
        
        req.session.adminId = admin.id;
        req.session.adminEmail = admin.email;
        res.json({ success: true, redirect: '/admin/dashboard' });
    } catch (err) {
        console.error('Admin login error:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get admin statistics
router.get('/stats', requireAdmin, async (req, res) => {
    try {
        const stats = {};
        
        stats.totalBackers = await adminModel.getUserCount();
        const orderStats = await orderModel.getStats();
        
        res.json({ ...stats, ...orderStats });
    } catch (err) {
        console.error('Error fetching stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all users
router.get('/users', requireAdmin, async (req, res) => {
    try {
        const users = await userModel.findAll();
        res.json(users);
    } catch (err) {
        console.error('Error fetching users:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all orders
router.get('/orders', requireAdmin, async (req, res) => {
    try {
        const orders = await orderModel.findAll();
        res.json(orders);
    } catch (err) {
        console.error('Error fetching orders:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get ALL backers (unified view)
router.get('/backers', requireAdmin, async (req, res) => {
    try {
        const { status, country, hasOrder, search, limit = 100, offset = 0 } = req.query;
        
        let sql = `
            SELECT 
                identity_id,
                email,
                name,
                ks_backer_number,
                ks_status,
                ks_pledge_over_time,
                ks_country,
                ks_pledge_amount,
                ks_amount_paid,
                pm_total,
                pm_paid,
                pm_status,
                stripe_payment_intent,
                stripe_customer_id,
                stripe_payment_method,
                stripe_card_brand,
                stripe_card_last4,
                stripe_card_exp,
                ship_country,
                ship_verified,
                ship_locked,
                created_at,
                updated_at
            FROM backers
            WHERE 1=1
        `;
        const params = [];
        let paramIndex = 1;
        
        if (status) {
            sql += ` AND ks_status = $${paramIndex++}`;
            params.push(status);
        }
        if (country) {
            sql += ` AND (ks_country = $${paramIndex} OR ship_country = $${paramIndex++})`;
            params.push(country);
        }
        if (hasOrder === 'true') {
            sql += ` AND pm_total IS NOT NULL`;
        } else if (hasOrder === 'false') {
            sql += ` AND pm_total IS NULL`;
        }
        if (search) {
            sql += ` AND (email LIKE $${paramIndex} OR name LIKE $${paramIndex++})`;
            params.push(`%${search}%`);
        }
        
        sql += ` ORDER BY COALESCE(updated_at, created_at) DESC LIMIT $${paramIndex++} OFFSET $${paramIndex++}`;
        params.push(parseInt(limit), parseInt(offset));
        
        const backers = await query(sql, params);
        
        // Get total count
        let countSql = 'SELECT COUNT(*) as total FROM backers WHERE 1=1';
        const countParams = [];
        let countIndex = 1;
        
        if (status) {
            countSql += ` AND ks_status = $${countIndex++}`;
            countParams.push(status);
        }
        if (country) {
            countSql += ` AND (ks_country = $${countIndex} OR ship_country = $${countIndex++})`;
            countParams.push(country);
        }
        if (hasOrder === 'true') {
            countSql += ` AND pm_total IS NOT NULL`;
        } else if (hasOrder === 'false') {
            countSql += ` AND pm_total IS NULL`;
        }
        if (search) {
            countSql += ` AND (email LIKE $${countIndex} OR name LIKE $${countIndex++})`;
            countParams.push(`%${search}%`);
        }
        
        const countResult = await query(countSql, countParams);
        const total = parseInt(countResult[0]?.total || 0);
        
        res.json({ 
            backers, 
            total,
            limit: parseInt(limit),
            offset: parseInt(offset)
        });
    } catch (err) {
        console.error('Error fetching backers:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Verify payment status with Stripe
router.post('/verify-payment/:identityId', requireAdmin, async (req, res) => {
    try {
        const { identityId } = req.params;
        
        // Get backer record
        const backers = await query('SELECT * FROM backers WHERE identity_id = $1', [identityId]);
        const backer = backers[0];
        
        if (!backer) {
            return res.status(404).json({ error: 'Backer not found' });
        }
        
        if (!backer.stripe_payment_intent) {
            return res.status(400).json({ error: 'No payment intent found for this backer' });
        }
        
        // Fetch from Stripe
        console.log('Verifying payment with Stripe for:', backer.email);
        const paymentIntent = await paymentService.retrievePaymentIntent(backer.stripe_payment_intent);
        
        let newStatus = backer.pm_status;
        let newPaid = backer.pm_paid;
        
        // Update based on Stripe status
        if (paymentIntent.status === 'succeeded') {
            newStatus = 'succeeded';
            newPaid = 1;
        } else if (paymentIntent.status === 'requires_capture') {
            newStatus = 'card_saved';
            newPaid = 0;
        } else if (paymentIntent.status === 'canceled') {
            newStatus = 'canceled';
            newPaid = 0;
        } else if (paymentIntent.status === 'requires_payment_method') {
            newStatus = 'failed';
            newPaid = 0;
        } else {
            newStatus = paymentIntent.status;
        }
        
        // Update database if status changed
        if (newStatus !== backer.pm_status || newPaid !== backer.pm_paid) {
            await execute(
                'UPDATE backers SET pm_status = $1, pm_paid = $2, updated_at = $3 WHERE identity_id = $4',
                [newStatus, newPaid, new Date().toISOString(), identityId]
            );
            console.log(`✓ Updated payment status for ${backer.email}: ${backer.pm_status} → ${newStatus}`);
        }
        
        res.json({
            success: true,
            stripeStatus: paymentIntent.status,
            previousStatus: backer.pm_status,
            newStatus,
            paid: newPaid,
            amount: paymentIntent.amount / 100,
            paymentMethod: paymentIntent.payment_method
        });
    } catch (err) {
        console.error('Error verifying payment:', err);
        res.status(500).json({ error: err.message });
    }
});

// Bulk verify all pending payments with Stripe
router.post('/bulk-verify-payments', requireAdmin, async (req, res) => {
    try {
        // Get all backers with pending/unknown payment status
        const pendingBackers = await query(`
            SELECT identity_id, email, stripe_payment_intent, pm_status 
            FROM backers 
            WHERE stripe_payment_intent IS NOT NULL 
            AND (pm_status = 'pending' OR pm_status IS NULL OR pm_paid = 0)
        `);
        
        console.log(`Verifying ${pendingBackers.length} pending payments with Stripe...`);
        
        const results = {
            total: pendingBackers.length,
            updated: 0,
            succeeded: 0,
            failed: 0,
            errors: []
        };
        
        for (const backer of pendingBackers) {
            try {
                const paymentIntent = await paymentService.retrievePaymentIntent(backer.stripe_payment_intent);
                
                let newStatus = backer.pm_status;
                let newPaid = 0;
                
                if (paymentIntent.status === 'succeeded') {
                    newStatus = 'succeeded';
                    newPaid = 1;
                    results.succeeded++;
                } else if (paymentIntent.status === 'requires_capture') {
                    newStatus = 'card_saved';
                } else if (paymentIntent.status === 'canceled' || paymentIntent.status === 'requires_payment_method') {
                    newStatus = 'failed';
                    results.failed++;
                }
                
                if (newStatus !== backer.pm_status) {
                    await execute(
                        'UPDATE backers SET pm_status = $1, pm_paid = $2, updated_at = $3 WHERE identity_id = $4',
                        [newStatus, newPaid, new Date().toISOString(), backer.identity_id]
                    );
                    results.updated++;
                    console.log(`  ✓ ${backer.email}: ${backer.pm_status} → ${newStatus}`);
                }
            } catch (err) {
                results.errors.push({ email: backer.email, error: err.message });
            }
        }
        
        console.log(`✓ Bulk verification complete: ${results.updated} updated, ${results.succeeded} succeeded, ${results.failed} failed`);
        res.json(results);
    } catch (err) {
        console.error('Error in bulk verify:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get email logs with optional type filter
router.get('/email-logs', requireAdmin, async (req, res) => {
    try {
        const { type } = req.query;
        let emailLogs = await orderModel.getEmailLogs(500);
        
        // Filter by type if specified
        if (type) {
            emailLogs = emailLogs.filter(log => log.email_type === type);
        }
        
        const stats = {};
        const totalEmails = emailLogs.length;
        const successfulEmails = emailLogs.filter(log => log.status === 'sent').length;
        const failedEmails = emailLogs.filter(log => log.status === 'failed').length;
        
        const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
        const last24Hours = emailLogs.filter(log => new Date(log.sent_at) > twentyFourHoursAgo).length;

        stats.totalEmails = totalEmails;
        stats.successfulEmails = successfulEmails;
        stats.failedEmails = failedEmails;
        stats.last24Hours = last24Hours;

        res.json({ logs: emailLogs, stats: stats });
    } catch (err) {
        console.error('Error fetching email logs:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get single order (with parsed JSON)
router.get('/orders/:id', requireAdmin, async (req, res) => {
    try {
        const order = await orderService.getOrderById(req.params.id);
        
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }
        
        res.json(order);
    } catch (err) {
        console.error('Error fetching order:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update comped items on an order
router.put('/orders/:id/comped-items', requireAdmin, async (req, res) => {
    const orderId = req.params.id;
    const compedItems = sanitizeCompedItems(req.body.compedItems);

    try {
        await orderModel.updateCompedItems(orderId, compedItems, req.session.adminId);
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating comped items:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Bulk charge all orders with saved cards
router.post('/bulk-charge-orders', requireAdmin, async (req, res) => {
    console.log('\n=== BULK CHARGE ORDERS REQUEST ===');
    console.log('Admin ID:', req.session.adminId);
    console.log('Timestamp:', new Date().toISOString());
    
    try {
        const result = await orderService.bulkChargeOrders();
        res.json(result);
    } catch (error) {
        console.error('\n✗ Error in bulk charge:', error.message);
        res.status(500).json({ 
            error: 'Failed to process bulk charge',
            details: error.message 
        });
    }
});

// Charge a single order
router.post('/charge-order/:orderId', requireAdmin, async (req, res) => {
    const orderId = req.params.orderId;
    
    try {
        const result = await orderService.chargeSingleOrder(orderId);
        res.json(result);
    } catch (error) {
        console.error('Error charging order:', error);
        
        if (error.message.includes('not found') || error.message.includes('No saved payment')) {
            return res.status(400).json({ error: error.message });
        }
        
        res.status(500).json({ error: 'Failed to process charge' });
    }
});

// Export users to CSV
router.get('/export/users', requireAdmin, async (req, res) => {
    try {
        const users = await userModel.findAll();
        
        // Create CSV
        let csv = 'Backer Number,Email,Name,Reward Tier,Pledge Amount,Completed,Created\n';
        users.forEach(user => {
            csv += `${user.backer_number || ''},`;
            csv += `"${user.email || ''}",`;
            csv += `"${user.backer_name || ''}",`;
            csv += `"${user.reward_title || ''}",`;
            csv += `${user.pledge_amount || 0},`;
            csv += `${user.has_completed ? 'Yes' : 'No'},`;
            csv += `"${user.created_at || ''}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=maya-users-export.csv');
        res.send(csv);
    } catch (err) {
        console.error('Error exporting users:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Send custom email
router.post('/send-email', requireAdmin, async (req, res) => {
    const { recipients, subject, message, recipientType } = req.body;
    
    try {
        const emailService = require('../services/emailService');
        let targetEmails = [];
        
        if (recipientType === 'all_backers') {
            const users = await userModel.findAll();
            targetEmails = users.map(u => u.email);
        } else if (recipientType === 'custom') {
            targetEmails = recipients.split(',').map(e => e.trim()).filter(e => e);
        } else if (recipientType === 'specific_backer') {
            const user = await userModel.findByBackerNumber(recipients);
            if (user) targetEmails = [user.email];
        }
        
        if (targetEmails.length === 0) {
            return res.status(400).json({ error: 'No recipients specified' });
        }
        
        const results = {
            total: targetEmails.length,
            sent: 0,
            failed: 0,
            errors: []
        };
        
        for (const email of targetEmails) {
            try {
                await emailService.sendCustomEmail({
                    to: email,
                    subject,
                    html: message
                });
                results.sent++;
            } catch (err) {
                results.failed++;
                results.errors.push({ email, error: err.message });
            }
        }
        
        res.json(results);
    } catch (err) {
        console.error('Error sending emails:', err);
        res.status(500).json({ error: 'Failed to send emails' });
    }
});

// Get products (for admin CRUD)
router.get('/products', requireAdmin, async (req, res) => {
    try {
        const productModel = require('../db/models/product');
        const products = await productModel.findAllAddons();
        res.json(products);
    } catch (err) {
        console.error('Error fetching products:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create product
router.post('/products', requireAdmin, async (req, res) => {
    try {
        const productModel = require('../db/models/product');
        const { name, description, price, image_url, category, stock, is_active } = req.body;
        
        const result = await productModel.create({
            name,
            description,
            price,
            image_url,
            category: category || 'addon',
            stock: stock || null,
            is_active: is_active !== false
        });
        
        res.json(result);
    } catch (err) {
        console.error('Error creating product:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update product
router.put('/products/:id', requireAdmin, async (req, res) => {
    try {
        const productModel = require('../db/models/product');
        const { name, description, price, image_url, category, stock, is_active } = req.body;
        
        await productModel.update(req.params.id, {
            name,
            description,
            price,
            image_url,
            category,
            stock,
            is_active
        });
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete product
router.delete('/products/:id', requireAdmin, async (req, res) => {
    try {
        const productModel = require('../db/models/product');
        await productModel.delete(req.params.id);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting product:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Export orders to CSV
router.get('/export/orders', requireAdmin, async (req, res) => {
    try {
        const productModel = require('../db/models/product');
        const availableAddons = await productModel.findAllAddons();
        const orders = await orderModel.findAll();
        
        // Build CSV header
        let csv = 'Order ID,Backer Number,Backer Name,Email,';
        availableAddons.forEach(addon => {
            csv += `"${addon.name}",`;
        });
        csv += 'Add-ons Subtotal,Shipping Cost,Total,Paid,Payment Status,Stripe Payment Intent ID,';
        csv += 'Full Name,Address Line 1,Address Line 2,City,State,Postal Code,Country,Phone,';
        csv += 'Created Date,Comped Items\n';
        
        // Build rows
        orders.forEach(order => {
            const addons = order.new_addons ? JSON.parse(order.new_addons) : [];
            const address = order.shipping_address ? JSON.parse(order.shipping_address) : {};
            const comped = order.comped_items ? JSON.parse(order.comped_items) : [];
            
            csv += `${order.id},`;
            csv += `${order.backer_number || ''},`;
            csv += `"${order.backer_name || ''}",`;
            csv += `"${order.email || address.email || ''}",`;
            
            availableAddons.forEach(availableAddon => {
                const purchased = addons.find(a => a.id === availableAddon.id || a.name === availableAddon.name);
                csv += `${purchased ? purchased.quantity : 0},`;
            });
            
            csv += `${order.addons_subtotal || 0},`;
            csv += `${order.shipping_cost || 0},`;
            csv += `${order.total || 0},`;
            csv += `${order.paid ? 'Yes' : 'No'},`;
            csv += `"${order.payment_status || 'pending'}",`;
            csv += `"${order.stripe_payment_intent_id || ''}",`;
            
            csv += `"${address.fullName || address.name || ''}",`;
            csv += `"${address.addressLine1 || address.address1 || ''}",`;
            csv += `"${address.addressLine2 || address.address2 || ''}",`;
            csv += `"${address.city || ''}",`;
            csv += `"${address.state || ''}",`;
            csv += `"${address.postalCode || address.postal || ''}",`;
            csv += `"${address.country || ''}",`;
            csv += `"${address.phone || ''}",`;
            csv += `"${order.created_at || ''}",`;
            
            const compedStr = comped.map(c => `${c.name} x${c.quantity}${c.note ? ' (' + c.note + ')' : ''}`).join('; ');
            csv += `"${compedStr}"\n`;
        });
        
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=maya-orders-export.csv');
        res.send(csv);
    } catch (err) {
        console.error('Error exporting orders:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get project milestones (admin)
router.get('/milestones', requireAdmin, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const milestones = await query(
            'SELECT * FROM project_milestones ORDER BY sort_order ASC, created_at ASC'
        );
        res.json({ milestones });
    } catch (err) {
        console.error('Error fetching milestones:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Create or update milestone
router.post('/milestones', requireAdmin, async (req, res) => {
    try {
        const { execute, queryOne } = require('../db/index');
        const { id, title, description, status, completed_date, sort_order } = req.body;
        
        if (id) {
            // Update existing
            await execute(
                `UPDATE project_milestones 
                 SET title = $1, description = $2, status = $3, completed_date = $4, sort_order = $5, updated_at = $6
                 WHERE id = $7`,
                [title, description || null, status, completed_date || null, sort_order || 0, new Date().toISOString(), id]
            );
            const updated = await queryOne('SELECT * FROM project_milestones WHERE id = $1', [id]);
            res.json({ milestone: updated });
        } else {
            // Create new
            await execute(
                `INSERT INTO project_milestones (title, description, status, completed_date, sort_order)
                 VALUES ($1, $2, $3, $4, $5)`,
                [title, description || null, status, completed_date || null, sort_order || 0]
            );
            const created = await queryOne(
                'SELECT * FROM project_milestones WHERE title = $1 ORDER BY id DESC LIMIT 1',
                [title]
            );
            res.json({ milestone: created });
        }
    } catch (err) {
        console.error('Error saving milestone:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete milestone
router.delete('/milestones/:id', requireAdmin, async (req, res) => {
    try {
        const { execute } = require('../db/index');
        await execute('DELETE FROM project_milestones WHERE id = $1', [req.params.id]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting milestone:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Lock/unlock shipping for a backer
router.post('/backers/:identityId/lock-shipping', requireAdmin, async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { lock } = req.body;
        
        await execute(
            `UPDATE backers 
             SET ship_locked = $1, ship_verified = CASE WHEN $1 = 1 THEN 1 ELSE ship_verified END
             WHERE identity_id = $2`,
            [lock ? 1 : 0, req.params.identityId]
        );
        
        console.log(`✓ Shipping ${lock ? 'locked' : 'unlocked'} for backer:`, req.params.identityId);
        res.json({ success: true, locked: lock });
    } catch (err) {
        console.error('Error updating shipping lock:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Bulk lock shipping for all backers with verified addresses
router.post('/bulk-lock-shipping', requireAdmin, async (req, res) => {
    try {
        const { execute, query } = require('../db/index');
        
        const result = await execute(
            `UPDATE backers 
             SET ship_locked = 1 
             WHERE ship_verified = 1 AND ship_address_1 IS NOT NULL`
        );
        
        const count = await query('SELECT COUNT(*) as count FROM backers WHERE ship_locked = 1');
        
        console.log('✓ Bulk shipping lock completed');
        res.json({ success: true, lockedCount: count[0]?.count || 0 });
    } catch (err) {
        console.error('Error bulk locking shipping:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get support requests
router.get('/support-requests', requireAdmin, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const requests = await query(`
            SELECT sr.*, b.name as backer_name, b.ks_backer_number
            FROM support_requests sr
            LEFT JOIN backers b ON sr.identity_id = b.identity_id
            ORDER BY sr.created_at DESC
            LIMIT 100
        `);
        res.json({ requests });
    } catch (err) {
        console.error('Error fetching support requests:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update support request status
router.put('/support-requests/:id', requireAdmin, async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { status, admin_notes } = req.body;
        
        await execute(`
            UPDATE support_requests 
            SET status = $1, admin_notes = $2, resolved_by = $3, resolved_at = $4
            WHERE id = $5
        `, [status, admin_notes || null, req.session.adminId, new Date().toISOString(), req.params.id]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating support request:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all rules (grouped by category)
router.get('/rules', requireAdmin, async (req, res) => {
    try {
        const rules = await rulesModel.getAll();
        res.json(rules);
    } catch (err) {
        console.error('Error fetching rules:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update a rule
router.put('/rules', requireAdmin, async (req, res) => {
    try {
        const { category, key, value, dataType, description } = req.body;
        
        if (!category || !key || value === undefined) {
            return res.status(400).json({ error: 'category, key, and value are required' });
        }
        
        await rulesModel.set(category, key, value, dataType || 'string', description);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating rule:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Sync card details from Stripe for all users with payment methods
router.post('/sync-card-details', requireAdmin, async (req, res) => {
    console.log('\n=== SYNC CARD DETAILS FROM STRIPE ===');
    
    try {
        // Get all backers with payment methods but missing card details
        const backersToSync = await query(`
            SELECT identity_id, email, stripe_payment_method, stripe_customer_id, stripe_card_last4
            FROM backers 
            WHERE (stripe_payment_method IS NOT NULL OR stripe_customer_id IS NOT NULL)
        `);
        
        console.log(`Found ${backersToSync.length} backers to check`);
        
        const results = {
            total: backersToSync.length,
            updated: 0,
            alreadyHaveDetails: 0,
            noPaymentMethod: 0,
            errors: []
        };
        
        for (const backer of backersToSync) {
            try {
                // Skip if already has card details
                if (backer.stripe_card_last4) {
                    results.alreadyHaveDetails++;
                    continue;
                }
                
                let cardDetails = null;
                
                // Try to get card from payment method
                if (backer.stripe_payment_method) {
                    cardDetails = await paymentService.getCardDetails(backer.stripe_payment_method);
                }
                
                // If no payment method, try to list customer's payment methods
                if (!cardDetails && backer.stripe_customer_id) {
                    const cards = await paymentService.listCustomerPaymentMethods(backer.stripe_customer_id);
                    if (cards && cards.length > 0) {
                        cardDetails = cards[0]; // Use first card
                        // Also save the payment method ID
                        await execute(
                            'UPDATE backers SET stripe_payment_method = $1 WHERE identity_id = $2',
                            [cards[0].id, backer.identity_id]
                        );
                    }
                }
                
                if (cardDetails) {
                    await execute(
                        `UPDATE backers 
                         SET stripe_card_brand = $1, stripe_card_last4 = $2, stripe_card_exp = $3, updated_at = $4
                         WHERE identity_id = $5`,
                        [
                            cardDetails.brand,
                            cardDetails.last4,
                            `${cardDetails.expMonth}/${cardDetails.expYear}`,
                            new Date().toISOString(),
                            backer.identity_id
                        ]
                    );
                    results.updated++;
                    console.log(`✓ Updated ${backer.email}: ${cardDetails.brand} ****${cardDetails.last4}`);
                } else {
                    results.noPaymentMethod++;
                }
                
            } catch (err) {
                results.errors.push({ email: backer.email, error: err.message });
                console.error(`✗ Error for ${backer.email}:`, err.message);
            }
        }
        
        console.log(`\n=== SYNC COMPLETE ===`);
        console.log(`Updated: ${results.updated}`);
        console.log(`Already had details: ${results.alreadyHaveDetails}`);
        console.log(`No payment method: ${results.noPaymentMethod}`);
        console.log(`Errors: ${results.errors.length}`);
        
        res.json(results);
    } catch (err) {
        console.error('Error syncing card details:', err);
        res.status(500).json({ error: err.message });
    }
});

// Get card details for a single backer from Stripe
router.get('/backer-card/:identityId', requireAdmin, async (req, res) => {
    try {
        const { identityId } = req.params;
        
        const backers = await query('SELECT * FROM backers WHERE identity_id = $1', [identityId]);
        const backer = backers[0];
        
        if (!backer) {
            return res.status(404).json({ error: 'Backer not found' });
        }
        
        let cardDetails = null;
        
        if (backer.stripe_payment_method) {
            cardDetails = await paymentService.getCardDetails(backer.stripe_payment_method);
        } else if (backer.stripe_customer_id) {
            const cards = await paymentService.listCustomerPaymentMethods(backer.stripe_customer_id);
            if (cards && cards.length > 0) {
                cardDetails = cards[0];
            }
        }
        
        res.json({
            email: backer.email,
            storedCard: {
                brand: backer.stripe_card_brand,
                last4: backer.stripe_card_last4,
                exp: backer.stripe_card_exp
            },
            stripeCard: cardDetails
        });
    } catch (err) {
        console.error('Error fetching card details:', err);
        res.status(500).json({ error: err.message });
    }
});

// =====================
// ASSET MANAGEMENT
// =====================

const s3Service = require('../services/s3Service');
const multer = require('multer');
const upload = multer({ storage: multer.memoryStorage() });

// List assets from S3
router.get('/assets', requireAdmin, async (req, res) => {
    try {
        const { prefix } = req.query;
        
        if (!s3Service.isConfigured()) {
            return res.json({ error: 'S3 not configured', assets: [] });
        }
        
        const assets = await s3Service.listAssets(prefix || '');
        
        res.json(assets.map(item => ({
            key: item.Key,
            size: item.Size,
            lastModified: item.LastModified,
            url: s3Service.getAssetUrl(item.Key)
        })));
    } catch (err) {
        console.error('Error listing assets:', err);
        res.status(500).json({ error: err.message });
    }
});

// Upload asset to S3
router.post('/assets/upload', requireAdmin, upload.single('file'), async (req, res) => {
    try {
        if (!s3Service.isConfigured()) {
            return res.status(400).json({ error: 'S3 not configured' });
        }
        
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }
        
        const { category } = req.body;
        const key = `${category || 'uploads'}/${Date.now()}-${req.file.originalname}`;
        
        await s3Service.uploadAsset(req.file.buffer, key, req.file.mimetype);
        
        // Register in database
        await execute(
            'INSERT INTO assets (name, s3_key, category, type, size_bytes) VALUES ($1, $2, $3, $4, $5)',
            [req.file.originalname, key, category || 'uploads', req.file.mimetype, req.file.size]
        );
        
        res.json({ 
            success: true, 
            key,
            url: s3Service.getAssetUrl(key)
        });
    } catch (err) {
        console.error('Error uploading asset:', err);
        res.status(500).json({ error: err.message });
    }
});

// Delete asset registration (not the actual S3 file)
router.delete('/assets/registration/:key(*)', requireAdmin, async (req, res) => {
    try {
        const { key } = req.params;
        
        await execute('DELETE FROM assets WHERE s3_key = $1', [key]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting asset registration:', err);
        res.status(500).json({ error: err.message });
    }
});

// Assign asset to product
router.put('/assets/assign', requireAdmin, async (req, res) => {
    try {
        const { productId, s3Key } = req.body;
        
        if (!productId || !s3Key) {
            return res.status(400).json({ error: 'Product ID and S3 key required' });
        }
        
        await execute('UPDATE items SET s3_key = $1 WHERE id = $2', [s3Key, productId]);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error assigning asset:', err);
        res.status(500).json({ error: err.message });
    }
});

// Update product details
router.put('/products/:type/:id', requireAdmin, async (req, res) => {
    try {
        const { type, id } = req.params;
        const { name, price, backer_price, description, active, s3_key } = req.body;
        
        const updates = [];
        const params = [];
        let paramIdx = 1;
        
        if (name !== undefined) { updates.push(`name = $${paramIdx++}`); params.push(name); }
        if (price !== undefined) { updates.push(`price = $${paramIdx++}`); params.push(price); }
        if (backer_price !== undefined) { updates.push(`backer_price = $${paramIdx++}`); params.push(backer_price); }
        if (description !== undefined) { updates.push(`description = $${paramIdx++}`); params.push(description); }
        if (active !== undefined) { updates.push(`active = $${paramIdx++}`); params.push(active ? 1 : 0); }
        if (s3_key !== undefined) { updates.push(`s3_key = $${paramIdx++}`); params.push(s3_key); }
        
        if (updates.length === 0) {
            return res.status(400).json({ error: 'No updates provided' });
        }
        
        params.push(id);
        await execute(`UPDATE items SET ${updates.join(', ')} WHERE id = $${paramIdx}`, params);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error updating product:', err);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;
