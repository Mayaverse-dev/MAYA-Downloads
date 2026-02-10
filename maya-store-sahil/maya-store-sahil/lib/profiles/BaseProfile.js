/**
 * BaseProfile - Abstract base class for all user profiles
 * 
 * Each profile encapsulates:
 * - Pricing strategy (backer vs retail)
 * - Payment strategy (immediate vs card-saved)
 * - Shipping rules
 * - Purchase permissions
 * - Dashboard display data
 */
const rulesModel = require('../../db/models/rules');

class BaseProfile {
    constructor(backer = null) {
        this.backer = backer;
        this.identityId = backer?.identity_id || null;
        this.email = backer?.email || null;
    }
    
    // ==================== IDENTITY ====================
    
    /**
     * Profile type identifier
     * @returns {string} - 'guest', 'collected', 'dropped', 'canceled', 'pot', 'late_pledge'
     */
    getType() {
        throw new Error('Subclass must implement getType()');
    }
    
    /**
     * Human-readable profile name
     */
    getDisplayName() {
        return this.getType().replace('_', ' ').toUpperCase();
    }
    
    /**
     * Is this a KS backer (has backer number)?
     */
    isKsBacker() {
        return !!(this.backer?.ks_backer_number);
    }
    
    /**
     * Is this a late pledge (not original KS campaign)?
     */
    isLatePledge() {
        return this.backer?.ks_late_pledge === 1;
    }
    
    // ==================== PRICING ====================
    
    /**
     * Get pricing strategy for this user type
     * @returns {Promise<Object>} { type: 'backer'|'retail', reason: string }
     */
    async getPricingStrategy() {
        const profileType = this.getType();
        const pricingType = await rulesModel.get(`profile.${profileType}`, 'pricing_type') || 'retail';
        const displayName = this.getDisplayName();
        
        return {
            type: pricingType,
            reason: pricingType === 'backer' 
                ? `${displayName} receives exclusive backer pricing`
                : `${displayName} pays retail prices`
        };
    }
    
    /**
     * Should this user see backer prices?
     */
    async useBackerPrices() {
        const strategy = await this.getPricingStrategy();
        return strategy.type === 'backer';
    }
    
    /**
     * Apply pricing to a product
     * @param {Object} product - Product with price and backer_price
     * @returns {Promise<Object>} - Product with correct price applied
     */
    async applyPricing(product) {
        const strategy = await this.getPricingStrategy();
        
        if (strategy.type === 'backer' && product.backer_price !== null && product.backer_price !== undefined) {
            return {
                ...product,
                original_price: product.price,
                price: product.backer_price,
                is_backer_price: true
            };
        }
        
        return {
            ...product,
            is_backer_price: false
        };
    }
    
    // ==================== PAYMENT ====================
    
    /**
     * Get payment strategy for this user type
     * @returns {Promise<Object>} { method: 'immediate'|'card_saved', reason: string }
     */
    async getPaymentStrategy() {
        const profileType = this.getType();
        const paymentMethod = await rulesModel.get(`profile.${profileType}`, 'payment_method') || 'immediate';
        const displayName = this.getDisplayName();
        
        return {
            method: paymentMethod,
            reason: paymentMethod === 'card_saved' 
                ? `${displayName} card saved for bulk charge when items ship`
                : `${displayName} payments are charged immediately`
        };
    }
    
    /**
     * Should payment be charged immediately?
     */
    async chargeImmediately() {
        const strategy = await this.getPaymentStrategy();
        return strategy.method === 'immediate';
    }
    
    /**
     * Get Stripe capture method based on payment strategy
     */
    async getStripeCaptureMethod() {
        const immediate = await this.chargeImmediately();
        return immediate ? 'automatic' : 'manual';
    }
    
    // ==================== PERMISSIONS ====================
    
    /**
     * Can this user make purchases?
     * @returns {Object} { allowed: boolean, reason: string }
     */
    canPurchase() {
        return { allowed: true, reason: null };
    }
    
    /**
     * Can this user buy add-ons without completing pledge first?
     */
    canBuyAddonsWithoutPledge() {
        return true;
    }
    
    /**
     * Does this user need to complete their pledge first?
     */
    requiresPledgeCompletion() {
        return false;
    }
    
    // ==================== DASHBOARD ====================
    
    /**
     * Get data for dashboard display
     * @returns {Promise<Object>} - Dashboard-specific data
     */
    async getDashboardData() {
        const backer = this.backer || {};
        const pricingStrategy = await this.getPricingStrategy();
        const paymentStrategy = await this.getPaymentStrategy();
        
        return {
            profileType: this.getType(),
            profileDisplayName: this.getDisplayName(),
            isKsBacker: this.isKsBacker(),
            isLatePledge: this.isLatePledge(),
            
            // Identity
            identityId: this.identityId,
            email: this.email,
            name: backer.name,
            backerNumber: backer.ks_backer_number,
            
            // Pledge info
            pledgeId: backer.ks_pledge_id,
            pledgeAmount: backer.ks_pledge_amount || 0,
            amountPaid: backer.ks_amount_paid || 0,
            amountDue: backer.ks_amount_due || 0,
            ksStatus: backer.ks_status,
            ksPledgeOverTime: backer.ks_pledge_over_time === 1,
            
            // Pricing
            pricingStrategy,
            useBackerPrices: pricingStrategy.type === 'backer',
            
            // Payment
            paymentStrategy,
            
            // Permissions
            canPurchase: this.canPurchase(),
            requiresPledgeCompletion: this.requiresPledgeCompletion()
        };
    }
    
    /**
     * Get any alerts/notices to show on dashboard
     * @returns {Array<{type: string, title: string, message: string, action?: string}>}
     */
    getDashboardAlerts() {
        return [];
    }
    
    // ==================== SERIALIZATION ====================
    
    /**
     * Convert profile to JSON-safe object
     */
    async toJSON() {
        const pricingStrategy = await this.getPricingStrategy();
        const paymentStrategy = await this.getPaymentStrategy();
        
        return {
            type: this.getType(),
            identityId: this.identityId,
            email: this.email,
            pricing: pricingStrategy,
            payment: paymentStrategy,
            permissions: {
                canPurchase: this.canPurchase(),
                canBuyAddonsWithoutPledge: this.canBuyAddonsWithoutPledge(),
                requiresPledgeCompletion: this.requiresPledgeCompletion()
            }
        };
    }
}

module.exports = BaseProfile;
