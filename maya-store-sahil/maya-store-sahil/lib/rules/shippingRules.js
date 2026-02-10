/**
 * Shipping Rules Engine
 * 
 * Centralized shipping logic and rules.
 */

// Shipping zones configuration
const SHIPPING_ZONES = {
    // Zone 1: USA
    us: {
        name: 'United States',
        zone: 1,
        baseCost: 0,
        perAddonCost: 0,
        freeShipping: true
    },
    
    // Zone 2: Canada
    ca: {
        name: 'Canada',
        zone: 2,
        baseCost: 15,
        perAddonCost: 5,
        freeShipping: false
    },
    
    // Zone 3: UK
    gb: {
        name: 'United Kingdom',
        zone: 3,
        baseCost: 20,
        perAddonCost: 8,
        freeShipping: false
    },
    
    // Zone 4: EU
    eu: {
        name: 'European Union',
        zone: 4,
        baseCost: 25,
        perAddonCost: 10,
        countries: ['de', 'fr', 'it', 'es', 'nl', 'be', 'at', 'pl', 'pt', 'ie', 
                    'fi', 'se', 'dk', 'cz', 'gr', 'hu', 'ro', 'bg', 'sk', 'si',
                    'hr', 'ee', 'lv', 'lt', 'mt', 'cy', 'lu'],
        freeShipping: false
    },
    
    // Zone 5: Australia/NZ
    oceania: {
        name: 'Australia/New Zealand',
        zone: 5,
        baseCost: 30,
        perAddonCost: 12,
        countries: ['au', 'nz'],
        freeShipping: false
    },
    
    // Zone 6: Rest of World
    row: {
        name: 'Rest of World',
        zone: 6,
        baseCost: 40,
        perAddonCost: 15,
        freeShipping: false
    }
};

// Heavy items that affect shipping
const HEAVY_ITEMS = {
    'deluxe-set': { additionalCost: 10 },
    'hardcover-artbook': { additionalCost: 5 },
    'founders-of-neh': { additionalCost: 5 }
};

/**
 * Get shipping zone for a country
 * @param {string} countryCode - ISO country code (lowercase)
 * @returns {Object} - Zone configuration
 */
function getZone(countryCode) {
    if (!countryCode) return SHIPPING_ZONES.row;
    
    const code = countryCode.toLowerCase();
    
    // Direct matches
    if (code === 'us') return SHIPPING_ZONES.us;
    if (code === 'ca') return SHIPPING_ZONES.ca;
    if (code === 'gb' || code === 'uk') return SHIPPING_ZONES.gb;
    
    // Check EU countries
    if (SHIPPING_ZONES.eu.countries.includes(code)) {
        return SHIPPING_ZONES.eu;
    }
    
    // Check Oceania
    if (SHIPPING_ZONES.oceania.countries.includes(code)) {
        return SHIPPING_ZONES.oceania;
    }
    
    // Default to Rest of World
    return SHIPPING_ZONES.row;
}

/**
 * Calculate shipping cost
 * @param {string} countryCode - Destination country
 * @param {Array} cartItems - Items in cart
 * @param {Object} profile - User profile
 * @returns {Object} - { cost, zone, breakdown }
 */
function calculateShipping(countryCode, cartItems = [], profile = null) {
    const zone = getZone(countryCode);
    
    // Free shipping for US
    if (zone.freeShipping) {
        return {
            cost: 0,
            zone: zone.name,
            breakdown: {
                base: 0,
                addons: 0,
                heavyItems: 0
            }
        };
    }
    
    let baseCost = zone.baseCost;
    let addonsCost = 0;
    let heavyItemsCost = 0;
    
    // Calculate per-addon cost
    let addonCount = 0;
    cartItems.forEach(item => {
        const quantity = parseInt(item.quantity) || 1;
        
        // Check if this is an addon (not a pledge)
        if (item.type === 'addon' || !item.isPledge) {
            addonCount += quantity;
        }
        
        // Check for heavy items
        const sku = (item.sku || item.name || '').toLowerCase().replace(/\s+/g, '-');
        if (HEAVY_ITEMS[sku]) {
            heavyItemsCost += HEAVY_ITEMS[sku].additionalCost * quantity;
        }
    });
    
    // First addon is included in base cost
    addonsCost = Math.max(0, addonCount - 1) * zone.perAddonCost;
    
    const totalCost = baseCost + addonsCost + heavyItemsCost;
    
    return {
        cost: totalCost,
        zone: zone.name,
        breakdown: {
            base: baseCost,
            addons: addonsCost,
            heavyItems: heavyItemsCost
        }
    };
}

/**
 * Check if shipping can be modified
 * @param {Object} backer - Backer record
 * @returns {Object} - { canModify, reason }
 */
function canModifyShipping(backer) {
    if (!backer) {
        return { canModify: true, reason: null };
    }
    
    if (backer.ship_locked === 1) {
        return {
            canModify: false,
            reason: 'Shipping address is locked for fulfillment. Contact support to make changes.'
        };
    }
    
    return { canModify: true, reason: null };
}

/**
 * Validate shipping address
 * @param {Object} address - Address to validate
 * @returns {Object} - { valid, errors }
 */
function validateAddress(address) {
    const errors = [];
    
    if (!address.name && !address.fullName) {
        errors.push('Name is required');
    }
    
    if (!address.address1 && !address.addressLine1) {
        errors.push('Address line 1 is required');
    }
    
    if (!address.city) {
        errors.push('City is required');
    }
    
    if (!address.country) {
        errors.push('Country is required');
    }
    
    if (!address.postal && !address.postalCode) {
        errors.push('Postal code is required');
    }
    
    return {
        valid: errors.length === 0,
        errors
    };
}

/**
 * Get shipping zone list for UI
 */
function getZoneList() {
    return Object.entries(SHIPPING_ZONES).map(([key, zone]) => ({
        id: key,
        name: zone.name,
        baseCost: zone.baseCost,
        perAddonCost: zone.perAddonCost,
        freeShipping: zone.freeShipping
    }));
}

module.exports = {
    SHIPPING_ZONES,
    HEAVY_ITEMS,
    getZone,
    calculateShipping,
    canModifyShipping,
    validateAddress,
    getZoneList
};
