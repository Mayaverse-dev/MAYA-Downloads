const express = require('express');
const router = express.Router();
const userModel = require('../db/models/user');
const backerModel = require('../db/models/backer');
const orderModel = require('../db/models/order');
const itemModel = require('../db/models/item');
const userProfileService = require('../services/userProfileService');
const { requireAuth } = require('../middleware/auth');

// Get user data for dashboard
router.get('/data', requireAuth, async (req, res) => {
    try {
        const identityId = req.session.identityId;

        // Get profile - single source of truth for user type
        const profile = await userProfileService.getProfile(identityId);
        const dashboardData = await profile.getDashboardData();
        const dashboardAlerts = await profile.getDashboardAlerts();

        // Get backer with items for detailed data
        const backer = await backerModel.findWithItems(identityId);

        if (!backer) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get pledge name from pledge_id
        let rewardTitle = null;
        if (backer.ks_pledge_id) {
            const pledge = await itemModel.findById(backer.ks_pledge_id);
            rewardTitle = pledge?.name || null;
        }

        // Format items for frontend
        const kickstarterItems = {};
        const kickstarterAddons = {};

        (backer.pledgeItems || []).forEach(item => {
            kickstarterItems[item.sku] = {
                name: item.name,
                quantity: item.quantity || 1
            };
        });

        (backer.addonItems || []).forEach(item => {
            if (item.source === 'ks_addon' || item.source === 'ks_reward') {
                kickstarterAddons[item.sku] = {
                    name: item.name,
                    quantity: item.quantity || 1
                };
            }
        });

        // Combine profile data with backer data
        const userData = {
            // Profile-derived data
            profileType: dashboardData.profileType,
            profileDisplayName: dashboardData.profileDisplayName,
            pricingStrategy: dashboardData.pricingStrategy,
            paymentStrategy: dashboardData.paymentStrategy,
            alerts: dashboardAlerts,

            // Backer data
            email: backer.email,
            name: backer.name,
            identityId: backer.identity_id,
            backerNumber: backer.ks_backer_number,
            backerName: backer.name,
            rewardTitle: rewardTitle,
            pledgeAmount: parseFloat(backer.ks_pledge_amount) || 0,
            amountPaid: parseFloat(backer.ks_amount_paid) || 0,
            amountDue: parseFloat(backer.ks_amount_due) || 0,
            ksAmountDue: parseFloat(backer.ks_amount_due) || 0, // Alias for test compatibility
            pledgedStatus: backer.ks_status || 'collected',
            ksStatus: backer.ks_status || 'collected', // Alias for test compatibility
            ksPledgeOverTime: backer.ks_pledge_over_time === 1 || backer.ks_pledge_over_time === true,
            kickstarterItems: kickstarterItems,
            kickstarterAddons: kickstarterAddons,
            shippingCountry: backer.ks_country || backer.ship_country,
            fulfillmentStatus: backer.fulfillment_status,
            items: {
                pledge: backer.pledgeItems || [],
                addons: backer.addonItems || []
            },
            
            // Full shipping address from ship_* columns
            shippingAddress: {
                name: backer.ship_name,
                street: backer.ship_address_1,
                address1: backer.ship_address_1,
                address2: backer.ship_address_2,
                city: backer.ship_city,
                state: backer.ship_state,
                postal: backer.ship_postal,
                country: backer.ship_country,
                phone: backer.ship_phone
            },
            
            // Payment/Order data from pm_* columns
            orderTotal: backer.pm_total,
            orderStatus: backer.pm_status,
            orderPaid: backer.pm_paid === 1,
            stripeCustomerId: backer.stripe_customer_id,
            
            // Card details
            cardBrand: backer.stripe_card_brand,
            cardLast4: backer.stripe_card_last4
        };

        res.json(userData);
    } catch (err) {
        console.error('Error fetching user data:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get user session info (accessible to everyone)
router.get('/session', (req, res) => {
    const identityId = req.session?.identityId;
    if (identityId) {
        res.json({
            isLoggedIn: true,
            user: {
                identityId: identityId,
                id: identityId, // For backward compatibility
                email: req.session.email || req.session.userEmail,
                backer_number: req.session.backerNumber,
                backer_name: req.session.backerName,
                isBacker: !!req.session.backerNumber
            }
        });
    } else {
        res.json({
            isLoggedIn: false,
            user: null
        });
    }
});

// Get user's pledge info
router.get('/pledge-info', (req, res) => {
    const identityId = req.session?.identityId;
    if (identityId) {
        res.json({
            pledgeAmount: parseFloat(req.session.pledgeAmount) || 0,
            rewardTitle: req.session.rewardTitle || ''
        });
    } else {
        res.json({
            pledgeAmount: 0,
            rewardTitle: ''
        });
    }
});

// Get user orders (add-on purchases from Pledge Manager)
router.get('/orders', requireAuth, async (req, res) => {
    try {
        const identityId = req.session.identityId;
        const backer = await backerModel.findWithItems(identityId);

        if (!backer) {
            return res.json({ orders: [] });
        }

        // Build order-like objects from backer data
        const orders = [];

        // If backer has PM order data, include it
        if (backer.pm_total || backer.pm_addons_subtotal) {
            const pmAddons = (backer.addonItems || []).filter(item =>
                item.source === 'pm_addon'
            );

            orders.push({
                id: backer.pm_order_id || backer.identity_id,
                identity_id: backer.identity_id,
                new_addons: JSON.stringify(pmAddons.map(item => ({
                    id: item.id,
                    name: item.name,
                    quantity: item.quantity,
                    price: item.price_paid || item.price
                }))),
                shipping_address: JSON.stringify({
                    name: backer.ship_name,
                    addressLine1: backer.ship_address_1,
                    addressLine2: backer.ship_address_2,
                    city: backer.ship_city,
                    state: backer.ship_state,
                    postalCode: backer.ship_postal,
                    country: backer.ship_country,
                    phone: backer.ship_phone
                }),
                shipping_cost: backer.pm_shipping_cost || 0,
                addons_subtotal: backer.pm_addons_subtotal || 0,
                total: backer.pm_total || 0,
                paid: backer.pm_paid,
                payment_status: backer.pm_status,
                created_at: backer.pm_created_at || backer.created_at
            });
        }

        res.json({ orders });
    } catch (err) {
        console.error('Error fetching user orders:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get user pledge context with upgrade options
router.get('/pledge-context', requireAuth, async (req, res) => {
    try {
        const identityId = req.session.identityId;
        const backer = await backerModel.findByIdentityId(identityId);

        if (!backer) {
            return res.status(404).json({ error: 'User not found' });
        }

        // Get owned pledge details
        let ownedTier = null;
        let ownedPledgeId = backer.ks_pledge_id;
        let ownedPrice = 0;
        
        if (ownedPledgeId) {
            const ownedPledge = await itemModel.findById(ownedPledgeId);
            if (ownedPledge) {
                ownedTier = ownedPledge.name;
                // Use backer_price since that's what backers actually pay
                ownedPrice = parseFloat(ownedPledge.backer_price) || parseFloat(ownedPledge.price) || 0;
            }
        }

        const pledgedStatus = backer.ks_status || 'collected';

        // Get all pledge tiers
        const productModel = require('../db/models/product');
        const allPledges = await productModel.findAllPledges();

        // Determine upgrade options
        const canUpgradeTo = [];
        const cannotDowngrade = [];

        if (ownedPledgeId && ownedPrice > 0) {
            for (const pledge of allPledges) {
                // Skip the owned pledge
                if (pledge.id === ownedPledgeId) {
                    continue;
                }
                
                // Use backer_price for comparison (what backers actually pay)
                const pledgeBackerPrice = parseFloat(pledge.backer_price) || parseFloat(pledge.price) || 0;

                if (pledgeBackerPrice > ownedPrice) {
                    // Can upgrade - pay the difference
                    canUpgradeTo.push({
                        id: pledge.id,
                        name: pledge.name,
                        price: pledgeBackerPrice,
                        upgradePrice: pledgeBackerPrice - ownedPrice
                    });
                } else {
                    // Cannot downgrade
                    cannotDowngrade.push({
                        id: pledge.id,
                        name: pledge.name,
                        price: pledgeBackerPrice
                    });
                }
            }
        }

        res.json({
            ownedTier,
            ownedPledgeId,
            ownedPrice,
            pledgedStatus,
            canUpgradeTo,
            cannotDowngrade,
            hasPledge: !!ownedTier
        });
    } catch (err) {
        console.error('Error fetching pledge context:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get project milestones (public endpoint)
router.get('/milestones', async (req, res) => {
    try {
        const { query } = require('../db/index');
        const milestones = await query(
            'SELECT * FROM project_milestones ORDER BY sort_order ASC, created_at ASC'
        );
        res.json({ milestones });
    } catch (err) {
        console.error('Error fetching milestones:', err);
        res.json({ milestones: [] });
    }
});

// Get payment status from Stripe (source of truth)
router.get('/payment-status', requireAuth, async (req, res) => {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const identityId = req.session.identityId;
        
        // Get backer record for Stripe customer ID
        const backer = await backerModel.findByIdentityId(identityId);
        
        if (!backer?.stripe_customer_id) {
            // No Stripe customer = no payment
            return res.json({ verified: true, card: null, paymentStatus: null });
        }
        
        const customerId = backer.stripe_customer_id;
        let card = null;
        let paymentStatus = null;
        
        try {
            // Get payment methods (cards) from Stripe
            const paymentMethods = await stripe.paymentMethods.list({
                customer: customerId,
                type: 'card'
            });
            
            if (paymentMethods.data.length > 0) {
                const pm = paymentMethods.data[0];
                card = {
                    brand: pm.card.brand,
                    last4: pm.card.last4,
                    expMonth: pm.card.exp_month,
                    expYear: pm.card.exp_year,
                    paymentMethodId: pm.id
                };
            }
            
            // Get latest payment intent for this customer to check payment status
            const paymentIntents = await stripe.paymentIntents.list({
                customer: customerId,
                limit: 1
            });
            
            if (paymentIntents.data.length > 0) {
                const pi = paymentIntents.data[0];
                // Map Stripe status to our status
                if (pi.status === 'succeeded') {
                    paymentStatus = 'paid';
                } else if (pi.status === 'requires_capture') {
                    paymentStatus = 'authorized';
                } else if (pi.status === 'requires_payment_method' || pi.status === 'canceled') {
                    paymentStatus = 'failed';
                } else {
                    paymentStatus = pi.status; // processing, requires_action, etc.
                }
                
                // Also sync to database for offline access
                await backerModel.update(identityId, {
                    stripe_card_brand: card?.brand || null,
                    stripe_card_last4: card?.last4 || null,
                    pm_status: pi.status,
                    pm_paid: pi.status === 'succeeded' ? 1 : 0
                });
            }
            
            return res.json({ 
                verified: true, 
                card, 
                paymentStatus 
            });
            
        } catch (stripeErr) {
            // Check for live/test mode mismatch
            if (stripeErr.message?.includes('live mode') || stripeErr.message?.includes('test mode')) {
                console.error('Stripe key mismatch:', stripeErr.message);
                return res.json({ verified: false, error: 'key_mismatch' });
            }
            throw stripeErr;
        }
        
    } catch (err) {
        console.error('Error verifying payment status:', err);
        res.json({ verified: false, error: err.message });
    }
});

// Get saved payment methods (fetches from Stripe API)
router.get('/payment-methods', requireAuth, async (req, res) => {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const userModel = require('../db/models/user');
        const identityId = req.session.identityId;
        const user = await userModel.findById(identityId);

        // Get Stripe customer ID from backer record or orders
        const backer = await backerModel.findByIdentityId(identityId);
        const orders = await orderModel.findByUserId(identityId);
        const customerIds = orders
            .filter(o => o.stripe_customer_id)
            .map(o => o.stripe_customer_id);

        // Also check backer record for customer ID
        if (backer?.stripe_customer_id && !customerIds.includes(backer.stripe_customer_id)) {
            customerIds.push(backer.stripe_customer_id);
        }

        if (customerIds.length === 0) {
            return res.json({ paymentMethods: [] });
        }

        // Get unique customer IDs and fetch payment methods
        const uniqueCustomerIds = [...new Set(customerIds)];
        const allPaymentMethods = [];

        let stripeKeyMismatch = false;
        
        for (const customerId of uniqueCustomerIds) {
            try {
                const paymentMethods = await stripe.paymentMethods.list({
                    customer: customerId,
                    type: 'card'
                });

                allPaymentMethods.push(...paymentMethods.data.map(pm => ({
                    paymentMethodId: pm.id,
                    customerId: customerId,
                    last4: pm.card.last4,
                    brand: pm.card.brand,
                    expMonth: pm.card.exp_month,
                    expYear: pm.card.exp_year
                })));
            } catch (err) {
                console.error(`Error fetching payment methods for customer ${customerId}:`, err.message);
                // Detect live/test mode mismatch
                if (err.message && err.message.includes('live mode') || err.message.includes('test mode')) {
                    stripeKeyMismatch = true;
                }
            }
        }

        // Deduplicate by payment method ID
        const uniquePMs = [...new Map(allPaymentMethods.map(pm => [pm.paymentMethodId, pm])).values()];

        res.json({ 
            paymentMethods: uniquePMs,
            stripeKeyMismatch: stripeKeyMismatch,
            verified: !stripeKeyMismatch
        });
    } catch (err) {
        console.error('Error fetching saved payment methods:', err);
        res.json({ paymentMethods: [], error: err.message, verified: false });
    }
});

// Delete payment method (detach from Stripe)
router.delete('/payment-methods/:pmId', requireAuth, async (req, res) => {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const identityId = req.session.identityId;
        const user = await userModel.findById(identityId);

        // Check if user is a backer (must have at least 1 card)
        if (user?.backer_number) {
            const allPMs = await stripe.paymentMethods.list({
                customer: req.body.customerId || null,
                type: 'card'
            });

            // If this is their only card, block deletion
            if (allPMs.data.length <= 1) {
                return res.status(400).json({
                    error: 'Backers must have at least one saved card. Please add a new card before removing this one.'
                });
            }
        }

        // Detach payment method from customer
        await stripe.paymentMethods.detach(req.params.pmId);

        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting payment method:', err);
        res.status(500).json({ error: err.message || 'Failed to delete payment method' });
    }
});

// Legacy endpoint for backward compatibility
router.get('/saved-payment-methods', requireAuth, async (req, res) => {
    try {
        const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
        const identityId = req.session.identityId;
        const orders = await orderModel.findByUserId(identityId);
        const paymentMethodIds = orders
            .filter(o => o.stripe_payment_method_id)
            .map(o => o.stripe_payment_method_id);

        if (paymentMethodIds.length === 0) {
            return res.json({ savedCards: [] });
        }

        const uniquePMIds = [...new Set(paymentMethodIds)];
        const mostRecentPMId = uniquePMIds[0];

        const paymentMethod = await stripe.paymentMethods.retrieve(mostRecentPMId);

        res.json({
            savedCards: [{
                paymentMethodId: paymentMethod.id,
                last4: paymentMethod.card.last4,
                brand: paymentMethod.card.brand,
                expMonth: paymentMethod.card.exp_month,
                expYear: paymentMethod.card.exp_year
            }]
        });
    } catch (err) {
        console.error('Error fetching saved payment methods:', err);
        res.json({ savedCards: [] });
    }
});

// Get saved shipping addresses (from user_addresses table)
router.get('/addresses', requireAuth, async (req, res) => {
    try {
        const identityId = req.session.identityId;
        const { query } = require('../db/index');
        const addresses = await query(
            'SELECT * FROM user_addresses WHERE identity_id = $1 ORDER BY is_default DESC, created_at DESC',
            [identityId]
        );
        res.json({ addresses });
    } catch (err) {
        console.error('Error fetching saved addresses:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Check if user's shipping is locked
router.get('/shipping-status', requireAuth, async (req, res) => {
    try {
        const identityId = req.session.identityId;
        const backer = await backerModel.findByIdentityId(identityId);

        res.json({
            locked: backer?.ship_locked === 1,
            verified: backer?.ship_verified === 1,
            hasAddress: !!(backer?.ship_address_1)
        });
    } catch (err) {
        console.error('Error checking shipping status:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Add new address (max 10 per user)
router.post('/addresses', requireAuth, async (req, res) => {
    try {
        const { query, execute } = require('../db/index');
        const { label, fullName, addressLine1, addressLine2, city, state, postalCode, country, phone, isDefault } = req.body;

        const identityId = req.session.identityId;

        // Check if shipping is locked
        const backer = await backerModel.findByIdentityId(identityId);
        if (backer?.ship_locked === 1) {
            return res.status(403).json({
                error: 'Shipping address is locked for fulfillment. Please contact support if you need to make changes.',
                locked: true
            });
        }

        // Check current count
        const countResult = await query('SELECT COUNT(*) as count FROM user_addresses WHERE identity_id = $1', [identityId]);
        const currentCount = parseInt(countResult[0].count || 0);

        if (currentCount >= 10) {
            return res.status(400).json({ error: 'Maximum 10 addresses allowed. Please delete an address first.' });
        }

        // If setting as default, unset others
        if (isDefault) {
            await execute('UPDATE user_addresses SET is_default = 0 WHERE identity_id = $1', [identityId]);
        }

        await execute(
            `INSERT INTO user_addresses (identity_id, label, full_name, address_line1, address_line2, city, state, postal_code, country, phone, is_default)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [identityId, label || null, fullName, addressLine1, addressLine2 || null, city, state || null, postalCode, country, phone || null, isDefault ? 1 : 0]
        );

        res.json({ success: true });
    } catch (err) {
        console.error('Error adding address:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Update address
router.put('/addresses/:id', requireAuth, async (req, res) => {
    try {
        const { execute, query } = require('../db/index');
        const addressId = parseInt(req.params.id);
        const { fullName, addressLine1, addressLine2, city, state, postalCode, country, phone, isDefault } = req.body;

        const identityId = req.session.identityId;

        // Check if shipping is locked
        const backer = await backerModel.findByIdentityId(identityId);
        if (backer?.ship_locked === 1) {
            return res.status(403).json({
                error: 'Shipping address is locked for fulfillment. Please contact support if you need to make changes.',
                locked: true
            });
        }

        // Verify ownership
        const address = await query('SELECT identity_id FROM user_addresses WHERE id = $1', [addressId]);
        if (!address || address.length === 0 || address[0].identity_id !== identityId) {
            return res.status(404).json({ error: 'Address not found' });
        }

        // If setting as default, unset others
        if (isDefault) {
            await execute('UPDATE user_addresses SET is_default = 0 WHERE identity_id = $1', [identityId]);
        }

        await execute(`
            UPDATE user_addresses 
            SET full_name = $1, address_line1 = $2, address_line2 = $3, city = $4, state = $5, 
                postal_code = $6, country = $7, phone = $8, is_default = $9
            WHERE id = $10 AND identity_id = $11
        `, [fullName, addressLine1, addressLine2 || null, city, state || null, postalCode, country, phone || null, isDefault ? 1 : 0, addressId, identityId]);

        res.json({ success: true });
    } catch (err) {
        console.error('Error updating address:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Delete address
router.delete('/addresses/:id', requireAuth, async (req, res) => {
    try {
        const { execute, query } = require('../db/index');
        const addressId = parseInt(req.params.id);

        const identityId = req.session.identityId;

        // Check if shipping is locked
        const backer = await backerModel.findByIdentityId(identityId);
        if (backer?.ship_locked === 1) {
            return res.status(403).json({
                error: 'Shipping address is locked for fulfillment. Please contact support if you need to make changes.',
                locked: true
            });
        }

        // Verify ownership
        const address = await query('SELECT identity_id FROM user_addresses WHERE id = $1', [addressId]);
        if (!address || address.length === 0 || address[0].identity_id !== identityId) {
            return res.status(404).json({ error: 'Address not found' });
        }

        await execute('DELETE FROM user_addresses WHERE id = $1 AND identity_id = $2', [addressId, identityId]);
        res.json({ success: true });
    } catch (err) {
        console.error('Error deleting address:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Legacy endpoint for backward compatibility
router.get('/saved-addresses', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const identityId = req.session.identityId;
        
        // Get addresses from user_addresses table
        const addresses = await query(
            'SELECT * FROM user_addresses WHERE identity_id = $1 ORDER BY is_default DESC, created_at DESC',
            [identityId]
        );

        // Get backer's saved shipping address from backers table
        const backer = await backerModel.findByIdentityId(identityId);
        let backerAddress = null;
        
        if (backer && backer.ship_address_1) {
            backerAddress = {
                id: 'backer-address',
                identity_id: identityId,
                full_name: backer.ship_name || backer.name,
                fullName: backer.ship_name || backer.name,
                address_line1: backer.ship_address_1,
                addressLine1: backer.ship_address_1,
                address_line2: backer.ship_address_2,
                addressLine2: backer.ship_address_2,
                city: backer.ship_city,
                state: backer.ship_state,
                postal_code: backer.ship_postal,
                postalCode: backer.ship_postal,
                country: backer.ship_country,
                phone: backer.ship_phone,
                email: backer.email,
                is_default: true,
                fromBacker: true
            };
        }

        // Also check orders for addresses (migration support)
        const orders = await orderModel.findByUserId(identityId);
        const orderAddresses = orders
            .filter(o => o.shipping_address)
            .map(o => {
                try {
                    const addr = typeof o.shipping_address === 'string' 
                        ? JSON.parse(o.shipping_address) 
                        : o.shipping_address;
                    return {
                        ...addr,
                        id: 'order-' + o.id,
                        fromOrder: true
                    };
                } catch {
                    return null;
                }
            })
            .filter(a => a !== null);

        // Combine all addresses (backer address first if exists)
        const allAddresses = [];
        if (backerAddress) {
            allAddresses.push(backerAddress);
        }
        allAddresses.push(...addresses, ...orderAddresses);
        
        // Deduplicate by address line + postal code
        const uniqueAddresses = [...new Map(allAddresses.map(a =>
            [(a.address_line1 || a.addressLine1) + (a.postal_code || a.postalCode), a]
        )).values()];

        res.json({ addresses: uniqueAddresses });
    } catch (err) {
        console.error('Error fetching saved addresses:', err);
        res.json({ addresses: [] });
    }
});

// Submit support request (accessible to everyone)
router.post('/support', async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { email, phone, subject, message, pageUrl, userAgent } = req.body;

        if (!email || !message) {
            return res.status(400).json({ error: 'Email and message are required' });
        }

        // Get identity_id if logged in
        const identityId = req.session?.identityId || null;

        await execute(`
            INSERT INTO support_requests (identity_id, email, phone, subject, message, page_url, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [identityId, email, phone || null, subject || 'Support Request', message, pageUrl || null, userAgent || null]);

        console.log('✓ Support request submitted:', email);

        res.json({ success: true, message: 'Your request has been submitted. We will reach out to you soon.' });
    } catch (err) {
        console.error('Error submitting support request:', err);
        res.status(500).json({ error: 'Failed to submit support request' });
    }
});

// Track asset download
router.post('/track-download', requireAuth, async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { assetId, assetName, assetCategory } = req.body;

        if (!assetId || !assetName || !assetCategory) {
            return res.status(400).json({ error: 'Asset info required' });
        }

        const identityId = req.session.identityId;
        const email = req.session.email || req.session.userEmail;
        const ipAddress = req.headers['x-forwarded-for'] || req.connection.remoteAddress;
        const userAgent = req.headers['user-agent'];

        await execute(`
            INSERT INTO download_logs (identity_id, email, asset_id, asset_name, asset_category, ip_address, user_agent)
            VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [identityId, email, assetId, assetName, assetCategory, ipAddress, userAgent]);

        res.json({ success: true });
    } catch (err) {
        console.error('Error tracking download:', err);
        res.status(500).json({ error: 'Failed to track download' });
    }
});

// Get download stats for an asset (admin use)
router.get('/download-stats/:assetId', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const { assetId } = req.params;

        // Get total download count
        const countResult = await query(
            'SELECT COUNT(*) as total, COUNT(DISTINCT identity_id) as unique_users FROM download_logs WHERE asset_id = $1',
            [assetId]
        );

        // Get recent downloaders
        const recentDownloads = await query(
            `SELECT identity_id, email, downloaded_at 
             FROM download_logs 
             WHERE asset_id = $1 
             ORDER BY downloaded_at DESC 
             LIMIT 20`,
            [assetId]
        );

        res.json({
            assetId,
            totalDownloads: countResult[0]?.total || 0,
            uniqueUsers: countResult[0]?.unique_users || 0,
            recentDownloads
        });
    } catch (err) {
        console.error('Error fetching download stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all download stats (admin overview)
router.get('/download-stats', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');

        // Get stats grouped by asset
        const stats = await query(`
            SELECT 
                asset_id,
                asset_name,
                asset_category,
                COUNT(*) as download_count,
                COUNT(DISTINCT identity_id) as unique_users,
                MAX(downloaded_at) as last_download
            FROM download_logs
            GROUP BY asset_id, asset_name, asset_category
            ORDER BY download_count DESC
        `);

        // Get total stats
        const totalResult = await query(
            'SELECT COUNT(*) as total, COUNT(DISTINCT identity_id) as unique_users FROM download_logs'
        );

        res.json({
            assets: stats,
            totalDownloads: totalResult[0]?.total || 0,
            totalUniqueUsers: totalResult[0]?.unique_users || 0
        });
    } catch (err) {
        console.error('Error fetching download stats:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get user's download history
router.get('/my-downloads', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const identityId = req.session.identityId;

        const downloads = await query(
            `SELECT asset_id, asset_name, asset_category, downloaded_at 
             FROM download_logs 
             WHERE identity_id = $1 
             ORDER BY downloaded_at DESC`,
            [identityId]
        );

        res.json({ downloads });
    } catch (err) {
        console.error('Error fetching download history:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================
// ANALYTICS & TRACKING ROUTES
// ============================================

// Track page visit (public - works for both guests and logged in users)
router.post('/track-visit', async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { pagePath, pageTitle, referrer, visitDuration } = req.body;

        const identityId = req.session?.identityId || null;
        const sessionId = req.sessionID || null;
        const isAuthenticated = identityId ? 1 : 0;
        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';
        const userAgent = req.headers['user-agent'] || 'unknown';

        if (!pagePath) {
            return res.status(400).json({ error: 'pagePath is required' });
        }

        await execute(`
            INSERT INTO page_visits (identity_id, session_id, page_path, page_title, referrer, ip_address, user_agent, is_authenticated, visit_duration_ms)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [identityId, sessionId, pagePath, pageTitle || 'Untitled', referrer || null, ipAddress, userAgent, isAuthenticated, visitDuration || null]);

        // Only log if it's a real visit, not a beacon duration update (which might be duplicate log info)
        if (!visitDuration) {
            console.log(`📊 Page visit: ${pagePath} | User: ${identityId || 'guest'} | Auth: ${isAuthenticated}`);
        }

        res.json({ success: true });
    } catch (err) {
        console.error('Error tracking visit:', err);
        res.status(500).json({ error: 'Failed to track visit' });
    }
});

// Track click/interaction event
router.post('/track-click', async (req, res) => {
    try {
        const { execute } = require('../db/index');
        const { pagePath, elementId, elementClass, elementText, eventType, metadata } = req.body;

        const identityId = req.session?.identityId || null;
        const sessionId = req.sessionID || null;
        const ipAddress = req.ip || req.connection?.remoteAddress || 'unknown';

        await execute(`
            INSERT INTO click_events (identity_id, session_id, page_path, element_id, element_class, element_text, event_type, metadata, ip_address)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [identityId, sessionId, pagePath, elementId, elementClass, elementText, eventType || 'click', metadata ? JSON.stringify(metadata) : null, ipAddress]);

        console.log(`🖱️ Click: ${elementId || elementClass || elementText} on ${pagePath} | User: ${identityId || 'guest'}`);

        res.json({ success: true });
    } catch (err) {
        console.error('Error tracking click:', err);
        res.status(500).json({ error: 'Failed to track click' });
    }
});

// Get page visit analytics (admin)
router.get('/analytics/visits', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const { days = 30, page } = req.query;

        // Get visit stats by page
        let sql = `
            SELECT 
                page_path,
                COUNT(*) as total_visits,
                COUNT(DISTINCT session_id) as unique_sessions,
                COUNT(DISTINCT identity_id) as unique_users,
                SUM(CASE WHEN is_authenticated = 1 THEN 1 ELSE 0 END) as authenticated_visits,
                AVG(visit_duration_ms) as avg_duration_ms
            FROM page_visits
            WHERE visited_at >= datetime('now', '-' || $1 || ' days')
        `;

        const params = [days];

        if (page) {
            sql += ` AND page_path LIKE $2`;
            params.push(`%${page}%`);
        }

        sql += ` GROUP BY page_path ORDER BY total_visits DESC LIMIT 50`;

        const stats = await query(sql, params);

        // Get total stats
        const totalResult = await query(`
            SELECT 
                COUNT(*) as total,
                COUNT(DISTINCT session_id) as unique_sessions,
                COUNT(DISTINCT identity_id) as unique_users
            FROM page_visits
            WHERE visited_at >= datetime('now', '-' || $1 || ' days')
        `, [days]);

        res.json({
            pages: stats,
            totals: totalResult[0] || { total: 0, unique_sessions: 0, unique_users: 0 },
            period: `${days} days`
        });
    } catch (err) {
        console.error('Error fetching visit analytics:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get asset-specific analytics (downloads + page visits)
router.get('/analytics/assets', requireAuth, async (req, res) => {
    try {
        const { query } = require('../db/index');
        const { days = 30 } = req.query;

        // Get asset page visits
        const pageVisits = await query(`
            SELECT 
                page_path,
                COUNT(*) as visits,
                COUNT(DISTINCT identity_id) as unique_users
            FROM page_visits
            WHERE page_path LIKE '%/assets%' OR page_path LIKE '%/wallpaper%'
            AND visited_at >= datetime('now', '-' || $1 || ' days')
            GROUP BY page_path
        `, [days]);

        // Get download stats
        const downloads = await query(`
            SELECT 
                asset_category,
                asset_name,
                COUNT(*) as download_count,
                COUNT(DISTINCT identity_id) as unique_downloaders
            FROM download_logs
            WHERE downloaded_at >= datetime('now', '-' || $1 || ' days')
            GROUP BY asset_category, asset_name
            ORDER BY download_count DESC
        `, [days]);

        // Get registered users who downloaded
        const registeredDownloaders = await query(`
            SELECT DISTINCT 
                dl.identity_id,
                dl.email,
                b.name as backer_name,
                b.ks_backer_number,
                COUNT(*) as download_count,
                MAX(dl.downloaded_at) as last_download
            FROM download_logs dl
            LEFT JOIN backers b ON dl.identity_id = b.identity_id
            WHERE dl.identity_id IS NOT NULL
            AND dl.downloaded_at >= datetime('now', '-' || $1 || ' days')
            GROUP BY dl.identity_id
            ORDER BY download_count DESC
            LIMIT 100
        `, [days]);

        res.json({
            pageVisits,
            downloads,
            registeredDownloaders,
            period: `${days} days`
        });
    } catch (err) {
        console.error('Error fetching asset analytics:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
