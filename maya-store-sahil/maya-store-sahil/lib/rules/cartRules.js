/**
 * Cart Rules Engine
 * 
 * Centralized cart validation and business rules.
 */

const rulesModel = require('../../db/models/rules');

// Cache for cart limits (loaded once per request)
let cartLimitsCache = null;

/**
 * Get cart limits from database
 * @returns {Promise<Object>} Cart limits object
 */
async function getCartLimits() {
    if (cartLimitsCache) {
        return cartLimitsCache;
    }
    
    const maxQuantity = await rulesModel.get('cart', 'max_quantity_per_item') || 10;
    const minQuantity = await rulesModel.get('cart', 'min_quantity') || 1;
    const maxItems = await rulesModel.get('cart', 'max_items_in_cart') || 50;
    const maxTotal = await rulesModel.get('cart', 'max_total_amount') || 10000;
    
    cartLimitsCache = {
        MAX_QUANTITY_PER_ITEM: maxQuantity,
        MIN_QUANTITY: minQuantity,
        MAX_ITEMS_IN_CART: maxItems,
        MAX_TOTAL_AMOUNT: maxTotal
    };
    
    return cartLimitsCache;
}

// For backward compatibility, export a getter
const CART_LIMITS = new Proxy({}, {
    get: function(target, prop) {
        throw new Error('CART_LIMITS is now async. Use await getCartLimits() instead.');
    }
});

// Pledge tiers (ordered by value for upgrade logic)
const PLEDGE_TIERS = [
    { id: 'ebook-only', name: 'Ebook Only', price: 15 },
    { id: 'standard', name: 'Standard Edition', price: 45 },
    { id: 'deluxe', name: 'Deluxe Edition', price: 75 },
    { id: 'collectors', name: 'Collectors Edition', price: 150 },
    { id: 'founders-of-neh', name: 'Founders of Neh', price: 500 }
];

/**
 * Validate cart items
 * @param {Array} cartItems - Cart items to validate
 * @param {Object} profile - User profile
 * @returns {Promise<Object>} - { valid, errors, warnings }
 */
async function validateCart(cartItems, profile = null) {
    const errors = [];
    const warnings = [];
    
    // Empty cart
    if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
        errors.push('Cart is empty');
        return { valid: false, errors, warnings };
    }
    
    const limits = await getCartLimits();
    
    // Too many items
    if (cartItems.length > limits.MAX_ITEMS_IN_CART) {
        errors.push(`Maximum ${limits.MAX_ITEMS_IN_CART} unique items allowed in cart`);
    }
    
    let pledgeCount = 0;
    let totalQuantity = 0;
    let totalAmount = 0;
    
    for (const item of cartItems) {
        const quantity = parseInt(item.quantity) || 1;
        const price = parseFloat(item.price) || 0;
        
        // Quantity limits
        if (quantity < limits.MIN_QUANTITY) {
            errors.push(`${item.name}: Minimum quantity is ${limits.MIN_QUANTITY}`);
        }
        
        if (quantity > limits.MAX_QUANTITY_PER_ITEM) {
            errors.push(`${item.name}: Maximum quantity is ${limits.MAX_QUANTITY_PER_ITEM}`);
        }
        
        // Track pledges
        if (item.isPledge || item.type === 'pledge') {
            pledgeCount += quantity;
        }
        
        totalQuantity += quantity;
        totalAmount += price * quantity;
    }
    
    // Check pledge count
    if (pledgeCount > 1 && !profile?.isKsBacker()) {
        warnings.push('Multiple pledges detected. Are you sure?');
    }
    
    // Check total amount
    if (totalAmount > limits.MAX_TOTAL_AMOUNT) {
        errors.push(`Order total exceeds maximum of $${limits.MAX_TOTAL_AMOUNT}`);
    }
    
    return {
        valid: errors.length === 0,
        errors,
        warnings,
        stats: {
            itemCount: cartItems.length,
            totalQuantity,
            pledgeCount,
            totalAmount
        }
    };
}

/**
 * Check if user can add item to cart
 * @param {Object} item - Item to add
 * @param {Array} currentCart - Current cart items
 * @param {Object} profile - User profile
 * @returns {Promise<Object>} - { allowed, reason }
 */
async function canAddToCart(item, currentCart = [], profile = null) {
    const limits = await getCartLimits();
    
    // Check cart size limit
    if (currentCart.length >= limits.MAX_ITEMS_IN_CART) {
        return {
            allowed: false,
            reason: `Maximum ${limits.MAX_ITEMS_IN_CART} items in cart`
        };
    }
    
    // Check if item already in cart (quantity limit)
    const existingItem = currentCart.find(i => i.id === item.id);
    if (existingItem) {
        const newQuantity = (existingItem.quantity || 1) + (item.quantity || 1);
        if (newQuantity > limits.MAX_QUANTITY_PER_ITEM) {
            return {
                allowed: false,
                reason: `Maximum quantity of ${limits.MAX_QUANTITY_PER_ITEM} reached`
            };
        }
    }
    
    return { allowed: true, reason: null };
}

/**
 * Get upgrade options for a pledge
 * @param {string} currentPledgeId - Current pledge ID
 * @param {number} currentPrice - Current pledge price
 * @returns {Array} - Available upgrades
 */
function getUpgradeOptions(currentPledgeId, currentPrice = 0) {
    const currentTier = PLEDGE_TIERS.find(t => t.id === currentPledgeId);
    const currentTierPrice = currentTier?.price || currentPrice;
    
    return PLEDGE_TIERS
        .filter(tier => tier.price > currentTierPrice)
        .map(tier => ({
            ...tier,
            upgradePrice: tier.price - currentTierPrice,
            isPledgeUpgrade: true
        }));
}

/**
 * Get downgrade info (for display, downgrades not allowed)
 * @param {string} currentPledgeId - Current pledge ID
 * @param {number} currentPrice - Current pledge price
 * @returns {Array} - Tiers that cannot be selected
 */
function getDowngradeTiers(currentPledgeId, currentPrice = 0) {
    const currentTier = PLEDGE_TIERS.find(t => t.id === currentPledgeId);
    const currentTierPrice = currentTier?.price || currentPrice;
    
    return PLEDGE_TIERS
        .filter(tier => tier.price < currentTierPrice)
        .map(tier => ({
            ...tier,
            reason: 'Cannot downgrade pledge'
        }));
}

/**
 * Calculate upgrade price
 * @param {Object} fromPledge - Current pledge
 * @param {Object} toPledge - Target pledge
 * @returns {number} - Upgrade price (difference)
 */
function calculateUpgradePrice(fromPledge, toPledge) {
    const fromPrice = parseFloat(fromPledge?.price || fromPledge?.ks_pledge_amount || 0);
    const toPrice = parseFloat(toPledge?.price || 0);
    
    if (toPrice <= fromPrice) {
        return 0; // No upgrade price for same or lower tier
    }
    
    return toPrice - fromPrice;
}

module.exports = {
    getCartLimits,
    CART_LIMITS, // Deprecated - use getCartLimits() instead
    PLEDGE_TIERS,
    validateCart,
    canAddToCart,
    getUpgradeOptions,
    getDowngradeTiers,
    calculateUpgradePrice
};
