const BaseProfile = require('./BaseProfile');

/**
 * CollectedBackerProfile - KS backer with successfully collected payment
 * 
 * Characteristics:
 * - Backer prices
 * - Card-saved payment (for bulk charge later)
 * - Can purchase add-ons freely
 * - Can proceed to checkout with $0 cart (shipping-only)
 */
class CollectedBackerProfile extends BaseProfile {
    getType() {
        return 'collected';
    }
    
    getDisplayName() {
        return 'Kickstarter Backer';
    }
    
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    /**
     * Collected backers can checkout with empty cart to pay shipping only
     * Their pledge is already paid, they just need to confirm shipping
     */
    allowZeroCartCheckout() {
        return true;
    }
    
    /**
     * Check if backer still needs to pay shipping
     */
    needsShippingPayment() {
        // If they have a shipping address but haven't paid shipping yet
        return this.backer?.ship_address_1 && !this.backer?.shipping_paid;
    }
    
    /**
     * Get shipping-only checkout message
     */
    getShippingOnlyMessage() {
        return {
            title: 'Confirm Shipping',
            message: 'Your pledge is paid. Proceed to pay for shipping and confirm your delivery address.',
            buttonText: 'PAY SHIPPING'
        };
    }
    
    async getDashboardData() {
        const base = await super.getDashboardData();
        return {
            ...base,
            pledgeStatus: 'active',
            pledgeStatusMessage: 'Your pledge is confirmed',
            allowZeroCartCheckout: this.allowZeroCartCheckout(),
            needsShippingPayment: this.needsShippingPayment()
        };
    }
    
    getDashboardAlerts() {
        const alerts = [];
        
        // Remind to add shipping address
        if (!this.backer?.ship_address_1) {
            alerts.push({
                type: 'info',
                title: 'Shipping Address Needed',
                message: 'Please add your shipping address to receive your rewards.',
                action: 'Add Address'
            });
        }
        
        // Remind to pay shipping if needed
        if (this.needsShippingPayment()) {
            alerts.push({
                type: 'warning',
                title: 'Shipping Payment Required',
                message: 'Please complete shipping payment to finalize your order.',
                action: 'Pay Shipping'
            });
        }
        
        return alerts;
    }
}

module.exports = CollectedBackerProfile;
