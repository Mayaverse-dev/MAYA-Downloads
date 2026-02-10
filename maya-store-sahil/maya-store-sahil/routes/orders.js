const express = require('express');
const router = express.Router();
const orderService = require('../services/orderService');
const shippingService = require('../services/shippingService');
const backerModel = require('../db/models/backer');
const itemModel = require('../db/models/item');

// Calculate shipping (accessible to both backers and guests)
router.post('/calculate-shipping', async (req, res) => {
    const { country, cart, cartItems: cartItemsFromBody, isShippingOnly } = req.body;

    // Accept both 'cart' and 'cartItems' parameter names
    const inputCart = cart || cartItemsFromBody || [];
    
    // If cart is empty but user is logged in backer, include their pledge for shipping calculation
    let cartItems = Array.isArray(inputCart) ? [...inputCart] : [];
    
    // For logged-in users with empty cart (shipping-only), fetch their pledge
    if ((cartItems.length === 0 || isShippingOnly) && req.session?.identityId) {
        try {
            const backer = await backerModel.findByIdentityId(req.session.identityId);
            if (backer && backer.ks_pledge_id) {
                const pledge = await itemModel.findById(backer.ks_pledge_id);
                if (pledge) {
                    console.log('Adding backer pledge for shipping calc:', pledge.name);
                    cartItems.push({
                        name: pledge.name,
                        quantity: 1
                    });
                }
            }
        } catch (err) {
            console.error('Error fetching backer pledge for shipping:', err);
        }
    }
    
    // Fallback: check session rewardTitle
    if (cartItems.length === 0 && req.session?.rewardTitle) {
        cartItems.push({
            name: req.session.rewardTitle,
            quantity: 1
        });
    }

    const shippingCost = shippingService.calculateShipping(country, cartItems);
    console.log(`Shipping calculated: $${shippingCost} for ${country} with ${cartItems.length} items`);
    res.json({ shippingCost });
});

// Save shipping address (accessible to both backers and guests)
router.post('/shipping/save', (req, res) => {
    const shippingAddress = req.body;
    
    // Store shipping address in session
    req.session.shippingAddress = shippingAddress;
    
    res.json({ 
        success: true, 
        message: 'Shipping address saved successfully' 
    });
});

// Get order summary for thank you page
router.get('/summary', async (req, res) => {
    try {
        const orderId = req.session.lastOrderId;
        if (!orderId) {
            return res.status(404).json({ error: 'No recent order found' });
        }

        const order = await orderService.getOrderById(orderId);
        if (!order) {
            return res.status(404).json({ error: 'Order not found' });
        }

        // Order is already parsed by service
        // Return safe summary data
        res.json({
            id: order.id,
            total: order.total,
            shippingCost: order.shipping_cost,
            addonsSubtotal: order.addons_subtotal,
            shippingAddress: order.shipping_address,
            items: order.new_addons,
            status: order.payment_status,
            date: order.created_at
        });
    } catch (err) {
        console.error('Error fetching order summary:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
