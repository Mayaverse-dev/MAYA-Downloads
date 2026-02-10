const { shippingRates, resolveZone } = require('../config/shipping-rates');
const { shipping: shippingRules } = require('../lib/rules');

// Calculate shipping cost for a country and cart
function calculateShipping(country, cartItems = []) {
    const normalize = (str = '') => str.trim().toLowerCase();
    const zone = resolveZone(country || '');
    const rates = shippingRates[zone] || shippingRates['REST OF WORLD'];

    let total = 0;

    // Identify pledge tier in cart (by name match)
    const pledgeEntry = cartItems.find(item => {
        const n = normalize(item.name || '');
        return [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].some(key => n.includes(key));
    });

    if (pledgeEntry) {
        const pledgeName = [
            'humble vaanar',
            'industrious manushya',
            'resplendent garuda',
            'benevolent divya',
            'founders of neh'
        ].find(key => normalize(pledgeEntry.name || '').includes(key));
        if (pledgeName && rates.pledges?.[pledgeName]) {
            total += rates.pledges[pledgeName];
        }
    }

    // Add-on shipping (Built Environments / Lorebook / Paperback / Hardcover)
    cartItems.forEach(item => {
        const n = normalize(item.name || '');
        const qty = item.quantity || 1;
        if (n.includes('built environments')) {
            total += (rates.addons?.['Built Environments'] || 0) * qty;
        } else if (n.includes('lorebook')) {
            total += (rates.addons?.['Lorebook'] || 0) * qty;
        } else if (n.includes('paperback')) {
            total += (rates.addons?.['Paperback'] || 0) * qty;
        } else if (n.includes('hardcover')) {
            total += (rates.addons?.['Hardcover'] || 0) * qty;
        }
    });

    return total;
}

// Get shipping zones and rates (for admin/debug)
function getShippingRates() {
    return { shippingRates, resolveZone };
}

// Check if shipping can be modified (delegated to rules engine)
function canModifyShipping(backer) {
    return shippingRules.canModifyShipping(backer);
}

// Validate shipping address (delegated to rules engine)
function validateAddress(address) {
    return shippingRules.validateAddress(address);
}

// Get shipping zone list for UI
function getZoneList() {
    return shippingRules.getZoneList();
}

module.exports = {
    calculateShipping,
    getShippingRates,
    canModifyShipping,
    validateAddress,
    getZoneList
};
