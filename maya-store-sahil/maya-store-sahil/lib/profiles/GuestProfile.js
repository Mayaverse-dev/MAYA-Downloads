const BaseProfile = require('./BaseProfile');

/**
 * GuestProfile - User without KS backer status
 * 
 * Characteristics:
 * - Retail prices (not backer prices)
 * - Immediate payment (no card-saved)
 * - Can purchase freely
 */
class GuestProfile extends BaseProfile {
    getType() {
        return 'guest';
    }
    
    getDisplayName() {
        return 'Guest';
    }
    
    isKsBacker() {
        return false;
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    getDashboardAlerts() {
        return [];
    }
}

module.exports = GuestProfile;
