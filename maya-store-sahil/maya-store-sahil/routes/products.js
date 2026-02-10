const express = require('express');
const router = express.Router();
const pricingService = require('../services/pricingService');
const userProfileService = require('../services/userProfileService');
const itemModel = require('../db/models/item');

// Get all products (pledges + add-ons)
router.get('/', async (req, res) => {
    console.log('\n=== API: Get Products ===');
    
    try {
        const identityId = req.session?.identityId || null;
        const profile = await userProfileService.getProfile(identityId);
        const pricingStrategy = await profile.getPricingStrategy();
        
        console.log(`User Profile: ${profile.getType()}, Pricing: ${pricingStrategy.type.toUpperCase()}`);
        
        // Get products with pricing applied
        const productsData = await pricingService.getProductsWithPricing(identityId);
        const { pledges, addons } = productsData;
        
        // Mark addons explicitly for frontend filtering
        const processedAddons = addons.map(item => ({
            ...item,
            type: 'addon'
        }));
        
        // Combine both
        const allProducts = [...pledges, ...processedAddons];
        
        console.log(`✓ Returning ${allProducts.length} total products (${pledges.length} pledges, ${addons.length} add-ons)`);
        console.log(`✓ Pricing: ${pricingStrategy.type} - ${pricingStrategy.reason}`);
        
        res.json(allProducts);
    } catch (err) {
        console.error('✗ Error fetching products:', err.message);
        res.status(500).json({ error: 'Database error', details: err.message });
    }
});

// Get available add-ons
router.get('/addons', async (req, res) => {
    try {
        const identityId = req.session?.identityId || null;
        const { addons } = await pricingService.getProductsWithPricing(identityId);
        
        res.json(addons);
    } catch (err) {
        console.error('Error fetching addons:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get items included in a pledge
router.get('/pledge/:pledgeId/items', async (req, res) => {
    try {
        const pledgeId = parseInt(req.params.pledgeId);
        const items = await itemModel.getPledgeItems(pledgeId);
        
        // Filter out the pledge itself from the items list
        const filteredItems = items.filter(item => item.id !== pledgeId);
        
        res.json(filteredItems);
    } catch (err) {
        console.error('Error fetching pledge items:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get all pledges with their included items
router.get('/pledges/with-items', async (req, res) => {
    try {
        const pledges = await itemModel.findAllPledges();
        
        // Get items for each pledge
        const pledgesWithItems = await Promise.all(
            pledges.map(async (pledge) => {
                const items = await itemModel.getPledgeItems(pledge.id);
                // Filter out the pledge itself
                const includedItems = items.filter(item => item.id !== pledge.id);
                return {
                    ...pledge,
                    includedItems
                };
            })
        );
        
        res.json(pledgesWithItems);
    } catch (err) {
        console.error('Error fetching pledges with items:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Get Stripe publishable key
router.get('/stripe-key', (req, res) => {
    res.json({ 
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE' 
    });
});

module.exports = router;
