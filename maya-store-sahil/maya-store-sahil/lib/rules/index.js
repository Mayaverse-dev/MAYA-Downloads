/**
 * Rules Engine - Index
 * 
 * Centralized export of all business rules.
 */

const shippingRules = require('./shippingRules');
const cartRules = require('./cartRules');

module.exports = {
    shipping: shippingRules,
    cart: cartRules,
    
    // Re-export commonly used functions
    calculateShipping: shippingRules.calculateShipping,
    validateCart: cartRules.validateCart,
    canAddToCart: cartRules.canAddToCart,
    getUpgradeOptions: cartRules.getUpgradeOptions
};
