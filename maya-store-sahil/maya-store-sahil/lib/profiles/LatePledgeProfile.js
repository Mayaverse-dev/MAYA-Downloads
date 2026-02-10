const BaseProfile = require('./BaseProfile');

/**
 * LatePledgeProfile - User who pledged after campaign ended
 * 
 * Characteristics:
 * - RETAIL prices (not backer prices)
 * - Card-saved payment (normal flow)
 * - Can purchase freely
 */
class LatePledgeProfile extends BaseProfile {
    getType() {
        return 'late_pledge';
    }
    
    getDisplayName() {
        return 'Late Pledge Backer';
    }
    
    isLatePledge() {
        return true;
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    async getDashboardData() {
        const base = await super.getDashboardData();
        return {
            ...base,
            pledgeStatus: 'late_pledge',
            pledgeStatusMessage: 'Late pledge backer'
        };
    }
    
    getDashboardAlerts() {
        return [];
    }
}

module.exports = LatePledgeProfile;
