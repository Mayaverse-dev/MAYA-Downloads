/**
 * Shipping Rules Unit Tests
 * 
 * Tests shipping zone resolution and cost calculations.
 */

const { getZone, calculateShipping, canModifyShipping, validateAddress, SHIPPING_ZONES } = require('../../lib/rules/shippingRules');

describe('Shipping Zones', () => {
    
    describe('getZone', () => {
        
        test('returns US zone for "us"', () => {
            const zone = getZone('us');
            expect(zone.name).toBe('United States');
            expect(zone.freeShipping).toBe(true);
        });
        
        test('returns US zone for "US" (case insensitive)', () => {
            const zone = getZone('US');
            expect(zone.name).toBe('United States');
        });
        
        test('returns Canada zone for "ca"', () => {
            const zone = getZone('ca');
            expect(zone.name).toBe('Canada');
            expect(zone.baseCost).toBe(15);
        });
        
        test('returns UK zone for "gb"', () => {
            const zone = getZone('gb');
            expect(zone.name).toBe('United Kingdom');
            expect(zone.baseCost).toBe(20);
        });
        
        test('returns UK zone for "uk"', () => {
            const zone = getZone('uk');
            expect(zone.name).toBe('United Kingdom');
        });
        
        test('returns EU zone for EU countries', () => {
            const euCountries = ['de', 'fr', 'it', 'es', 'nl', 'be'];
            for (const country of euCountries) {
                const zone = getZone(country);
                expect(zone.name).toBe('European Union');
                expect(zone.baseCost).toBe(25);
            }
        });
        
        test('returns Oceania zone for Australia', () => {
            const zone = getZone('au');
            expect(zone.name).toBe('Australia/New Zealand');
            expect(zone.baseCost).toBe(30);
        });
        
        test('returns Oceania zone for New Zealand', () => {
            const zone = getZone('nz');
            expect(zone.name).toBe('Australia/New Zealand');
        });
        
        test('returns Rest of World for unknown countries', () => {
            const zone = getZone('jp');
            expect(zone.name).toBe('Rest of World');
            expect(zone.baseCost).toBe(40);
        });
        
        test('returns Rest of World for null/undefined', () => {
            expect(getZone(null).name).toBe('Rest of World');
            expect(getZone(undefined).name).toBe('Rest of World');
        });
    });
    
    describe('calculateShipping', () => {
        
        test('returns free shipping for US', () => {
            const result = calculateShipping('us', []);
            expect(result.cost).toBe(0);
            expect(result.zone).toBe('United States');
            expect(result.breakdown.base).toBe(0);
        });
        
        test('returns base cost for Canada with no items', () => {
            const result = calculateShipping('ca', []);
            expect(result.cost).toBe(15);
            expect(result.zone).toBe('Canada');
        });
        
        test('calculates per-addon cost correctly', () => {
            const cartItems = [
                { name: 'Addon 1', type: 'addon', quantity: 1 },
                { name: 'Addon 2', type: 'addon', quantity: 1 },
                { name: 'Addon 3', type: 'addon', quantity: 1 }
            ];
            
            // Canada: $15 base + (2 extra addons * $5) = $25
            const result = calculateShipping('ca', cartItems);
            expect(result.breakdown.base).toBe(15);
            expect(result.breakdown.addons).toBe(10); // 2 * $5 (first addon free)
            expect(result.cost).toBe(25);
        });
        
        test('handles item quantities correctly', () => {
            const cartItems = [
                { name: 'Addon 1', type: 'addon', quantity: 3 }
            ];
            
            // Canada: $15 base + (2 extra * $5) = $25
            const result = calculateShipping('ca', cartItems);
            expect(result.cost).toBe(25);
        });
        
        test('calculates EU shipping correctly', () => {
            const result = calculateShipping('de', []);
            expect(result.cost).toBe(25);
            expect(result.zone).toBe('European Union');
        });
        
        test('calculates Rest of World shipping correctly', () => {
            const result = calculateShipping('jp', []);
            expect(result.cost).toBe(40);
            expect(result.zone).toBe('Rest of World');
        });
    });
    
    describe('canModifyShipping', () => {
        
        test('returns canModify: true for null backer', () => {
            const result = canModifyShipping(null);
            expect(result.canModify).toBe(true);
            expect(result.reason).toBeNull();
        });
        
        test('returns canModify: true for unlocked backer', () => {
            const backer = { ship_locked: 0 };
            const result = canModifyShipping(backer);
            expect(result.canModify).toBe(true);
        });
        
        test('returns canModify: false for locked backer', () => {
            const backer = { ship_locked: 1 };
            const result = canModifyShipping(backer);
            expect(result.canModify).toBe(false);
            expect(result.reason).toContain('locked');
        });
    });
    
    describe('validateAddress', () => {
        
        test('returns valid: true for complete address', () => {
            const address = {
                name: 'John Doe',
                address1: '123 Main St',
                city: 'New York',
                postal: '10001',
                country: 'United States'
            };
            
            const result = validateAddress(address);
            expect(result.valid).toBe(true);
            expect(result.errors.length).toBe(0);
        });
        
        test('accepts fullName instead of name', () => {
            const address = {
                fullName: 'John Doe',
                addressLine1: '123 Main St',
                city: 'New York',
                postalCode: '10001',
                country: 'United States'
            };
            
            const result = validateAddress(address);
            expect(result.valid).toBe(true);
        });
        
        test('returns errors for missing required fields', () => {
            const address = {};
            
            const result = validateAddress(address);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Name is required');
            expect(result.errors).toContain('Address line 1 is required');
            expect(result.errors).toContain('City is required');
            expect(result.errors).toContain('Country is required');
            expect(result.errors).toContain('Postal code is required');
        });
        
        test('returns specific error messages', () => {
            const address = {
                name: 'John',
                address1: '123 Main St'
                // Missing city, postal, country
            };
            
            const result = validateAddress(address);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('City is required');
            expect(result.errors).toContain('Country is required');
            expect(result.errors).toContain('Postal code is required');
            expect(result.errors).not.toContain('Name is required');
        });
    });
});

