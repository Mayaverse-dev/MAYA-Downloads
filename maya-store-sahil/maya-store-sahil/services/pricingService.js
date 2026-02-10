/**
 * Pricing Service
 * 
 * Centralized pricing logic using user profiles.
 * Single source of truth for all pricing decisions.
 */

const userProfileService = require('./userProfileService');
const productModel = require('../db/models/product');

/**
 * Apply pricing to a list of products based on user profile
 * 
 * @param {Array} products - Array of product objects
 * @param {BaseProfile} profile - User's profile instance
 * @returns {Promise<Array>} - Products with correct pricing applied
 */
async function applyPricing(products, profile) {
    const pricedProducts = [];
    for (const product of products) {
        pricedProducts.push(await profile.applyPricing(product));
    }
    return pricedProducts;
}

/**
 * Apply pricing to products for a user by identity ID
 * 
 * @param {Array} products - Array of product objects
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<Array>} - Products with correct pricing applied
 */
async function applyPricingForUser(products, identityId) {
    const profile = await userProfileService.getProfile(identityId);
    return applyPricing(products, profile);
}

/**
 * Get all products with pricing for a user
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<Object>} - { pledges, addons } with pricing applied
 */
async function getProductsWithPricing(identityId) {
    const profile = await userProfileService.getProfile(identityId);
    const { pledges, addons } = await productModel.findAllProducts();
    
    return {
        pledges: await applyPricing(pledges, profile),
        addons: await applyPricing(addons, profile),
        pricingStrategy: await profile.getPricingStrategy()
    };
}

/**
 * Validate cart prices server-side
 * 
 * @param {Array} cartItems - Cart items from client
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<Object>} - { serverTotal, validatedItems, profile }
 */
async function validateCartPrices(cartItems, identityId) {
    const profile = await userProfileService.getProfile(identityId);
    const useBackerPrices = await profile.useBackerPrices();
    
    let serverTotal = 0;
    const validatedItems = [];
    
    // Max quantity per item - get from rules
    const { getCartLimits } = require('../lib/rules/cartRules');
    const limits = await getCartLimits();
    const MAX_QUANTITY = limits.MAX_QUANTITY_PER_ITEM;
    
    // Validate cart items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        throw new Error('Cart is empty');
    }
    
    for (const item of cartItems) {
        const quantity = parseInt(item.quantity) || 1;
        
        // Validate quantity
        if (quantity < 1) {
            throw new Error(`Invalid quantity for ${item.name}`);
        }
        if (quantity > MAX_QUANTITY) {
            throw new Error(`Maximum quantity per item is ${MAX_QUANTITY}. ${item.name} has ${quantity}.`);
        }
        
        // Special items (pledge upgrades, dropped backer pledges)
        if (item.isPledgeUpgrade || item.isOriginalPledge || item.isDroppedBackerPledge || item.isOriginalAddon) {
            const price = parseFloat(item.price) || 0;
            const itemTotal = price * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: price,
                quantity: quantity,
                subtotal: itemTotal,
                isPledgeUpgrade: item.isPledgeUpgrade || false,
                isOriginalPledge: item.isOriginalPledge || false,
                isDroppedBackerPledge: item.isDroppedBackerPledge || false,
                isOriginalAddon: item.isOriginalAddon || false
            });
            continue;
        }
        
        // Fetch actual price from database
        let dbItem = await productModel.findProductById(item.id);
        if (!dbItem) {
            dbItem = await productModel.findAddonById(item.id);
        }
        
        if (!dbItem) {
            throw new Error(`Item ${item.name} not found in database`);
        }
        
        // Determine correct price based on profile
        let correctPrice = dbItem.price;
        if (useBackerPrices && dbItem.backer_price !== null && dbItem.backer_price !== undefined) {
            correctPrice = dbItem.backer_price;
        }
        
        const itemTotal = correctPrice * quantity;
        serverTotal += itemTotal;
        
        validatedItems.push({
            id: dbItem.id,
            name: dbItem.name,
            price: correctPrice,
            quantity: quantity,
            subtotal: itemTotal,
            isBackerPrice: useBackerPrices
        });
    }
    
    return {
        serverTotal,
        validatedItems,
        profile,
        pricingStrategy: await profile.getPricingStrategy()
    };
}

/**
 * Calculate total with shipping
 * 
 * @param {number} cartTotal - Cart subtotal
 * @param {number} shippingCost - Shipping cost
 * @returns {number} - Total
 */
function calculateTotal(cartTotal, shippingCost) {
    return parseFloat(cartTotal || 0) + parseFloat(shippingCost || 0);
}

/**
 * Validate submitted total against server calculation
 * 
 * @param {number} submittedTotal - Total from client
 * @param {number} expectedTotal - Server-calculated total
 * @param {number} tolerance - Allowed difference (default 0.01)
 * @returns {Object} - { valid, difference }
 */
function validateTotal(submittedTotal, expectedTotal, tolerance = 0.01) {
    const difference = Math.abs(expectedTotal - submittedTotal);
    return {
        valid: difference <= tolerance,
        difference,
        expectedTotal,
        submittedTotal
    };
}

module.exports = {
    // Core pricing functions
    applyPricing,
    applyPricingForUser,
    getProductsWithPricing,
    
    // Validation
    validateCartPrices,
    validateTotal,
    
    // Utilities
    calculateTotal
};
