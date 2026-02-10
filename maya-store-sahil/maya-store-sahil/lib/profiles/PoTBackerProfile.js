const BaseProfile = require('./BaseProfile');

/**
 * PoTBackerProfile - Payment over Time backer
 * 
 * Characteristics:
 * - Backer prices
 * - Card-saved payment for add-ons
 * - Shows remaining balance on pledge
 * - Pledge payments managed by Kickstarter
 */
class PoTBackerProfile extends BaseProfile {
    getType() {
        return 'pot';
    }
    
    getDisplayName() {
        return 'Kickstarter Backer (Payment Plan)';
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    /**
     * Get payment plan status
     */
    getPaymentPlanStatus() {
        if (!this.backer) return null;
        
        const pledgeAmount = this.backer.ks_pledge_amount || 0;
        const amountPaid = this.backer.ks_amount_paid || 0;
        const amountDue = this.backer.ks_amount_due || (pledgeAmount - amountPaid);
        
        return {
            pledgeAmount,
            amountPaid,
            amountDue,
            percentPaid: pledgeAmount > 0 ? Math.round((amountPaid / pledgeAmount) * 100) : 0,
            isComplete: amountDue <= 0
        };
    }
    
    async getDashboardData() {
        const base = await super.getDashboardData();
        const paymentPlanStatus = this.getPaymentPlanStatus();
        
        return {
            ...base,
            pledgeStatus: 'payment_plan',
            pledgeStatusMessage: 'Payment plan in progress',
            paymentPlanStatus,
            showPaymentPlanNotice: true
        };
    }
    
    getDashboardAlerts() {
        const alerts = [];
        const status = this.getPaymentPlanStatus();
        
        if (status && !status.isComplete) {
            alerts.push({
                type: 'info',
                title: 'Payment Plan Active',
                message: `You've paid $${status.amountPaid} of $${status.pledgeAmount} (${status.percentPaid}% complete). Remaining balance: $${status.amountDue}. Payment is managed by Kickstarter.`,
                action: null
            });
        } else if (status && status.isComplete) {
            alerts.push({
                type: 'success',
                title: 'Payment Plan Complete',
                message: 'Your payment plan is fully paid!',
                action: null
            });
        }
        
        return alerts;
    }
}

module.exports = PoTBackerProfile;
