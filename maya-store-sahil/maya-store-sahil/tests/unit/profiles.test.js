/**
 * Profile Unit Tests
 * 
 * Tests profile factory logic and individual profile behaviors.
 */

const { createProfile, getProfileType, profileGetsBackerPricing, profileChargesImmediately } = require('../../lib/profiles');

describe('Profile Factory', () => {
    
    describe('createProfile', () => {
        
        test('returns GuestProfile when backer is null', () => {
            const profile = createProfile(null);
            expect(profile.getType()).toBe('guest');
        });
        
        test('returns GuestProfile when backer has no ks_backer_number', () => {
            const backer = { email: 'test@test.com', name: 'Test' };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('guest');
        });
        
        test('returns CollectedBackerProfile for collected status', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_over_time: 0
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('collected');
        });
        
        test('returns PoTBackerProfile for collected status with payment over time', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_over_time: 1
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('pot');
        });
        
        test('returns DroppedBackerProfile for dropped status', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'dropped'
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('dropped');
        });
        
        test('returns CanceledBackerProfile for canceled status', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'canceled'
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('canceled');
        });
        
        test('returns LatePledgeProfile when ks_late_pledge is 1', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_late_pledge: 1
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('late_pledge');
        });
        
        test('late pledge takes precedence over collected status', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_late_pledge: 1,
                ks_pledge_over_time: 0
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('late_pledge');
        });
        
        test('returns GuestProfile for unknown status', () => {
            const backer = {
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'unknown_status'
            };
            const profile = createProfile(backer);
            expect(profile.getType()).toBe('guest');
        });
    });
    
    describe('getProfileType', () => {
        
        test('returns "guest" for null backer', () => {
            expect(getProfileType(null)).toBe('guest');
        });
        
        test('returns "guest" for backer without ks_backer_number', () => {
            expect(getProfileType({ email: 'test@test.com' })).toBe('guest');
        });
        
        test('returns "collected" for collected backer', () => {
            expect(getProfileType({
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_over_time: 0
            })).toBe('collected');
        });
        
        test('returns "pot" for PoT backer', () => {
            expect(getProfileType({
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_over_time: 1
            })).toBe('pot');
        });
        
        test('returns "dropped" for dropped backer', () => {
            expect(getProfileType({
                ks_backer_number: 1001,
                ks_status: 'dropped'
            })).toBe('dropped');
        });
        
        test('returns "late_pledge" for late pledge backer', () => {
            expect(getProfileType({
                ks_backer_number: 1001,
                ks_late_pledge: 1
            })).toBe('late_pledge');
        });
    });
    
    describe('profileGetsBackerPricing', () => {
        
        test('returns false for guest', () => {
            expect(profileGetsBackerPricing('guest')).toBe(false);
        });
        
        test('returns true for collected', () => {
            expect(profileGetsBackerPricing('collected')).toBe(true);
        });
        
        test('returns true for pot', () => {
            expect(profileGetsBackerPricing('pot')).toBe(true);
        });
        
        test('returns true for dropped', () => {
            expect(profileGetsBackerPricing('dropped')).toBe(true);
        });
        
        test('returns true for canceled', () => {
            expect(profileGetsBackerPricing('canceled')).toBe(true);
        });
        
        test('returns false for late_pledge', () => {
            expect(profileGetsBackerPricing('late_pledge')).toBe(false);
        });
    });
    
    describe('profileChargesImmediately', () => {
        
        test('returns true for guest', () => {
            expect(profileChargesImmediately('guest')).toBe(true);
        });
        
        test('returns false for collected', () => {
            expect(profileChargesImmediately('collected')).toBe(false);
        });
        
        test('returns false for pot', () => {
            expect(profileChargesImmediately('pot')).toBe(false);
        });
        
        test('returns true for dropped', () => {
            expect(profileChargesImmediately('dropped')).toBe(true);
        });
        
        test('returns true for canceled', () => {
            expect(profileChargesImmediately('canceled')).toBe(true);
        });
        
        test('returns true for late_pledge', () => {
            expect(profileChargesImmediately('late_pledge')).toBe(true);
        });
    });
});

describe('Individual Profile Behaviors', () => {
    
    describe('GuestProfile', () => {
        let profile;
        
        beforeEach(() => {
            profile = createProfile(null);
        });
        
        test('isKsBacker returns false', () => {
            expect(profile.isKsBacker()).toBe(false);
        });
        
        test('canPurchase returns allowed: true', () => {
            const result = profile.canPurchase();
            expect(result.allowed).toBe(true);
        });
        
        test('getDisplayName returns "Guest"', () => {
            expect(profile.getDisplayName()).toBe('Guest');
        });
    });
    
    describe('CollectedBackerProfile', () => {
        let profile;
        
        beforeEach(() => {
            profile = createProfile({
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_id: 101,
                ks_pledge_amount: 18
            });
        });
        
        test('isKsBacker returns true', () => {
            expect(profile.isKsBacker()).toBe(true);
        });
        
        test('canPurchase returns allowed: true', () => {
            const result = profile.canPurchase();
            expect(result.allowed).toBe(true);
        });
        
        test('allowZeroCartCheckout returns true', () => {
            expect(profile.allowZeroCartCheckout()).toBe(true);
        });
    });
    
    describe('DroppedBackerProfile', () => {
        let profile;
        
        beforeEach(() => {
            profile = createProfile({
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'dropped',
                ks_pledge_id: 101,
                ks_pledge_amount: 18,
                ks_amount_paid: 0
            });
        });
        
        test('isKsBacker returns true', () => {
            expect(profile.isKsBacker()).toBe(true);
        });
        
        test('canPurchase returns allowed: true', () => {
            const result = profile.canPurchase();
            expect(result.allowed).toBe(true);
        });
        
        test('getOriginalPledge returns correct pledge info', () => {
            const pledge = profile.getOriginalPledge();
            expect(pledge).toEqual({
                pledgeId: 101,
                pledgeAmount: 18,
                amountPaid: 0,
                amountDue: 18
            });
        });
        
        test('getDashboardAlerts includes pledge completion alert', () => {
            const alerts = profile.getDashboardAlerts();
            expect(alerts.length).toBeGreaterThan(0);
            expect(alerts[0].title).toBe('Complete Your Pledge');
        });
    });
    
    describe('PoTBackerProfile', () => {
        let profile;
        
        beforeEach(() => {
            profile = createProfile({
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_status: 'collected',
                ks_pledge_over_time: 1,
                ks_pledge_id: 104,
                ks_pledge_amount: 150,
                ks_amount_paid: 50,
                ks_amount_due: 100
            });
        });
        
        test('getPaymentPlanStatus returns correct status', () => {
            const status = profile.getPaymentPlanStatus();
            expect(status.pledgeAmount).toBe(150);
            expect(status.amountPaid).toBe(50);
            expect(status.amountDue).toBe(100);
            expect(status.percentPaid).toBe(33);
            expect(status.isComplete).toBe(false);
        });
    });
    
    describe('LatePledgeProfile', () => {
        let profile;
        
        beforeEach(() => {
            profile = createProfile({
                email: 'test@test.com',
                ks_backer_number: 1001,
                ks_late_pledge: 1
            });
        });
        
        test('isLatePledge returns true', () => {
            expect(profile.isLatePledge()).toBe(true);
        });
        
        test('isKsBacker returns true (they have a backer number)', () => {
            expect(profile.isKsBacker()).toBe(true);
        });
    });
});

