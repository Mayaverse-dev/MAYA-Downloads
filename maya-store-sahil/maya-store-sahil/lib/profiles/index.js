/**
 * Profile Factory
 * 
 * Determines the correct user profile based on backer data.
 * Single source of truth for user type determination.
 */

const BaseProfile = require('./BaseProfile');
const GuestProfile = require('./GuestProfile');
const CollectedBackerProfile = require('./CollectedBackerProfile');
const DroppedBackerProfile = require('./DroppedBackerProfile');
const CanceledBackerProfile = require('./CanceledBackerProfile');
const PoTBackerProfile = require('./PoTBackerProfile');
const LatePledgeProfile = require('./LatePledgeProfile');

/**
 * Create the appropriate profile for a backer
 * 
 * Decision tree:
 * 1. No backer or no KS backer number → Guest
 * 2. Late pledge → LatePledge (retail prices)
 * 3. Status = 'dropped' → Dropped (backer prices, immediate charge)
 * 4. Status = 'canceled' → Canceled (backer prices)
 * 5. Status = 'collected' + PoT → PoT (backer prices, show balance)
 * 6. Status = 'collected' → Collected (backer prices, card-saved)
 * 7. Default → Guest
 * 
 * @param {Object|null} backer - Backer record from database
 * @returns {BaseProfile} - The appropriate profile instance
 */
function createProfile(backer) {
    // No backer data = Guest
    if (!backer) {
        return new GuestProfile(null);
    }
    
    // No KS backer number = Guest (even if record exists)
    if (!backer.ks_backer_number) {
        return new GuestProfile(backer);
    }
    
    // Late pledge = LatePledge (retail prices)
    if (backer.ks_late_pledge === 1) {
        return new LatePledgeProfile(backer);
    }
    
    // Check KS status
    switch (backer.ks_status) {
        case 'dropped':
            return new DroppedBackerProfile(backer);
            
        case 'canceled':
            return new CanceledBackerProfile(backer);
            
        case 'collected':
            // Check if Payment over Time
            if (backer.ks_pledge_over_time === 1) {
                return new PoTBackerProfile(backer);
            }
            return new CollectedBackerProfile(backer);
            
        default:
            // Unknown status - treat as Guest
            console.warn(`Unknown KS status: ${backer.ks_status} for backer ${backer.email}`);
            return new GuestProfile(backer);
    }
}

/**
 * Get profile type from backer data without creating instance
 * Useful for quick checks
 * 
 * @param {Object|null} backer - Backer record
 * @returns {string} - Profile type
 */
function getProfileType(backer) {
    if (!backer || !backer.ks_backer_number) return 'guest';
    if (backer.ks_late_pledge === 1) return 'late_pledge';
    
    switch (backer.ks_status) {
        case 'dropped': return 'dropped';
        case 'canceled': return 'canceled';
        case 'collected':
            return backer.ks_pledge_over_time === 1 ? 'pot' : 'collected';
        default:
            return 'guest';
    }
}

/**
 * Check if a profile type gets backer pricing
 * 
 * @param {string} profileType - Profile type string
 * @returns {boolean}
 */
function profileGetsBackerPricing(profileType) {
    const backerPriceTypes = ['collected', 'dropped', 'canceled', 'pot'];
    return backerPriceTypes.includes(profileType);
}

/**
 * Check if a profile type charges immediately
 * 
 * @param {string} profileType - Profile type string
 * @returns {boolean}
 */
function profileChargesImmediately(profileType) {
    // Only collected and PoT backers get card-saved (bulk charge later)
    // Everyone else (guest, dropped, canceled, late_pledge) pays immediately
    const immediateChargeTypes = ['guest', 'dropped', 'canceled', 'late_pledge'];
    return immediateChargeTypes.includes(profileType);
}

// Export all profile classes for direct access if needed
module.exports = {
    // Factory functions
    createProfile,
    getProfileType,
    profileGetsBackerPricing,
    profileChargesImmediately,
    
    // Profile classes
    BaseProfile,
    GuestProfile,
    CollectedBackerProfile,
    DroppedBackerProfile,
    CanceledBackerProfile,
    PoTBackerProfile,
    LatePledgeProfile
};
