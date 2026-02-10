const BaseProfile = require('./BaseProfile');

/**
 * DroppedBackerProfile - KS backer whose payment failed
 * 
 * Characteristics:
 * - Backer prices (still honored)
 * - IMMEDIATE payment (must pay now, not card-saved)
 * - CAN buy add-ons (changed from original requirement)
 * - Can upgrade pledge
 * - Dashboard shows pledge completion notice
 */
class DroppedBackerProfile extends BaseProfile {
    getType() {
        return 'dropped';
    }
    
    getDisplayName() {
        return 'Kickstarter Backer (Payment Pending)';
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    // Dropped backers CAN buy add-ons without pledge
    // (user clarified this requirement)
    canBuyAddonsWithoutPledge() {
        return true;
    }
    
    // Show notice to complete pledge but don't block
    requiresPledgeCompletion() {
        return false; // Not required, just encouraged
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
            pledgeStatus: 'dropped',
            pledgeStatusMessage: 'Your Kickstarter payment was not collected',
            originalPledge,
            showPledgeCompletionNotice: true
        };
    }
    
    getDashboardAlerts() {
        const alerts = [];
        const originalPledge = this.getOriginalPledge();
        
        alerts.push({
            type: 'warning',
            title: 'Complete Your Pledge',
            message: `Your original Kickstarter pledge of $${originalPledge?.pledgeAmount || 0} was not collected. Complete your pledge to receive your rewards.`,
            action: 'Complete Pledge',
            actionData: originalPledge
        });
        
        return alerts;
    }
}

module.exports = DroppedBackerProfile;
