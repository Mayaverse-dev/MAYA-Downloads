const BaseProfile = require('./BaseProfile');

/**
 * CanceledBackerProfile - KS backer who voluntarily canceled
 * 
 * Characteristics:
 * - BACKER prices (still honored per user requirement)
 * - IMMEDIATE payment (like dropped, must pay now)
 * - Can purchase freely
 * - Should complete their original pledge
 */
class CanceledBackerProfile extends BaseProfile {
    getType() {
        return 'canceled';
    }
    
    getDisplayName() {
        return 'Kickstarter Backer (Canceled)';
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    // Canceled backers CAN buy add-ons without pledge (like dropped)
    canBuyAddonsWithoutPledge() {
        return true;
    }
    
    /**
     * Get the original pledge details for re-purchase
     */
    getOriginalPledge() {
        if (!this.backer) return null;
        
        return {
            pledgeId: this.backer.ks_pledge_id,
            pledgeAmount: this.backer.ks_pledge_amount || 0,
            amountPaid: this.backer.ks_amount_paid || 0,
            amountDue: (this.backer.ks_pledge_amount || 0) - (this.backer.ks_amount_paid || 0)
        };
    }
    
    async getDashboardData() {
        const base = await super.getDashboardData();
        const originalPledge = this.getOriginalPledge();
        
        return {
            ...base,
            pledgeStatus: 'canceled',
            pledgeStatusMessage: 'Your original pledge was canceled',
            originalPledge,
            showCanceledNotice: true,
            showPledgeCompletionNotice: true
        };
    }
    
    getDashboardAlerts() {
        const alerts = [];
        const originalPledge = this.getOriginalPledge();
        
        alerts.push({
            type: 'warning',
            title: 'Complete Your Pledge',
            message: `Your original Kickstarter pledge of $${originalPledge?.pledgeAmount || 0} was canceled. Complete your pledge to receive your rewards at backer prices.`,
            action: 'Complete Pledge',
            actionData: originalPledge
        });
        
        return alerts;
    }
}

module.exports = CanceledBackerProfile;
