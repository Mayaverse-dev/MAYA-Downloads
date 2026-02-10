/**
 * User Profile Integration Tests
 * 
 * Tests profile determination and pricing/payment strategies
 * using the test database.
 */

const testDb = require('../testDb');

describe('User Profile Integration', () => {
    
    beforeAll(async () => {
        // Ensure test database is initialized
        await testDb.reset();
    });
    
    describe('Profile Identification from Database', () => {
        
        test('collected backer is identified correctly', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_backer_number).toBe(9001);
            expect(user.ks_status).toBe('collected');
            expect(user.ks_pledge_over_time).toBe(0);
            expect(user.ks_pledge_id).toBe(101);
        });
        
        test('PoT backer is identified correctly', async () => {
            const user = await testDb.getTestUser('pot@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_status).toBe('collected');
            expect(user.ks_pledge_over_time).toBe(1);
            expect(user.ks_amount_paid).toBeLessThan(user.ks_pledge_amount);
        });
        
        test('dropped backer is identified correctly', async () => {
            const user = await testDb.getTestUser('dropped@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_status).toBe('dropped');
            expect(user.ks_pledge_id).toBe(101);
            expect(user.ks_amount_paid).toBe(0);
        });
        
        test('canceled backer is identified correctly', async () => {
            const user = await testDb.getTestUser('canceled@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_status).toBe('canceled');
            expect(user.ks_amount_paid).toBe(0);
        });
        
        test('late pledge backer is identified correctly', async () => {
            const user = await testDb.getTestUser('latepledge@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_late_pledge).toBe(1);
        });
        
        test('guest user has no ks_backer_number', async () => {
            const user = await testDb.getTestUser('guest@test.maya');
            
            expect(user).toBeDefined();
            expect(user.ks_backer_number).toBeNull();
        });
    });
    
    describe('Pledge Data Integrity', () => {
        
        test('collected backer has correct pledge amount', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            const pledge = await testDb.getTestItem(user.ks_pledge_id);
            
            expect(user.ks_pledge_amount).toBe(pledge.backer_price);
        });
        
        test('dropped backer has pledge but no payment', async () => {
            const user = await testDb.getTestUser('dropped@test.maya');
            
            expect(user.ks_pledge_id).toBeTruthy();
            expect(user.ks_pledge_amount).toBeGreaterThan(0);
            expect(user.ks_amount_paid).toBe(0);
            
            const amountDue = user.ks_pledge_amount - user.ks_amount_paid;
            expect(amountDue).toBe(user.ks_pledge_amount);
        });
        
        test('PoT backer has partial payment', async () => {
            const user = await testDb.getTestUser('pot@test.maya');
            
            expect(user.ks_amount_paid).toBeGreaterThan(0);
            expect(user.ks_amount_paid).toBeLessThan(user.ks_pledge_amount);
            
            const remaining = user.ks_pledge_amount - user.ks_amount_paid;
            expect(remaining).toBeGreaterThan(0);
        });
    });
    
    describe('Pledge Tier Pricing', () => {
        
        test('all pledge tiers have both prices', async () => {
            const pledgeIds = [101, 102, 103, 104, 105];
            
            for (const id of pledgeIds) {
                const item = await testDb.getTestItem(id);
                expect(item).toBeDefined();
                expect(item.price).toBeGreaterThan(0);
                expect(item.backer_price).toBeLessThanOrEqual(item.price);
                expect(item.type).toBe('pledge');
            }
        });
        
        test('backer prices are less than or equal to retail', async () => {
            const items = await testDb.query('SELECT * FROM items WHERE type = ?', ['pledge']);
            
            for (const item of items) {
                expect(item.backer_price).toBeLessThanOrEqual(item.price);
            }
        });
        
        test('pledges are sorted by price correctly', async () => {
            const items = await testDb.query(
                'SELECT * FROM items WHERE type = ? ORDER BY backer_price ASC',
                ['pledge']
            );
            
            for (let i = 1; i < items.length; i++) {
                expect(items[i].backer_price).toBeGreaterThanOrEqual(items[i-1].backer_price);
            }
        });
    });
    
    describe('Upgrade Eligibility', () => {
        
        test('collected backer can upgrade to higher tiers', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            const currentPledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Get all pledges higher than current
            const higherPledges = await testDb.query(
                'SELECT * FROM items WHERE type = ? AND backer_price > ?',
                ['pledge', currentPledge.backer_price]
            );
            
            expect(higherPledges.length).toBeGreaterThan(0);
            
            // Each should have a positive upgrade cost
            for (const pledge of higherPledges) {
                const upgradeCost = pledge.backer_price - currentPledge.backer_price;
                expect(upgradeCost).toBeGreaterThan(0);
            }
        });
        
        test('cannot downgrade to lower tiers', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            const currentPledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Get all pledges lower than current
            const lowerPledges = await testDb.query(
                'SELECT * FROM items WHERE type = ? AND backer_price < ? AND id != ?',
                ['pledge', currentPledge.backer_price, currentPledge.id]
            );
            
            // For Humble Vaanar (lowest tier), there should be no lower pledges
            // This test verifies the concept
            for (const pledge of lowerPledges) {
                const priceDiff = pledge.backer_price - currentPledge.backer_price;
                expect(priceDiff).toBeLessThan(0); // Negative = downgrade
            }
        });
    });
});

describe('Guest User Flow', () => {
    
    test('guest can store pledge after purchase', async () => {
        const user = await testDb.getTestUser('guest@test.maya');
        
        // Initially no pledge
        expect(user.ks_pledge_id).toBeNull();
        
        // Simulate purchase by updating ks_pledge_id
        await testDb.updateTestUser('guest@test.maya', {
            ks_pledge_id: 102,
            ks_pledge_amount: 50 // Retail price
        });
        
        // Verify update
        const updatedUser = await testDb.getTestUser('guest@test.maya');
        expect(updatedUser.ks_pledge_id).toBe(102);
        expect(updatedUser.ks_pledge_amount).toBe(50);
        
        // They should still be a guest (no ks_backer_number)
        expect(updatedUser.ks_backer_number).toBeNull();
    });
    
    test('guest with pledge can upgrade', async () => {
        // First ensure guest has a pledge from previous test
        let user = await testDb.getTestUser('guest@test.maya');
        if (!user.ks_pledge_id) {
            await testDb.updateTestUser('guest@test.maya', {
                ks_pledge_id: 101,
                ks_pledge_amount: 25
            });
            user = await testDb.getTestUser('guest@test.maya');
        }
        
        const currentPledge = await testDb.getTestItem(user.ks_pledge_id);
        
        // Get upgrade options (retail price for guests)
        const higherPledges = await testDb.query(
            'SELECT * FROM items WHERE type = ? AND price > ?',
            ['pledge', currentPledge.price]
        );
        
        expect(higherPledges.length).toBeGreaterThan(0);
        
        // Simulate upgrade
        const newPledge = higherPledges[0];
        await testDb.updateTestUser('guest@test.maya', {
            ks_pledge_id: newPledge.id,
            ks_pledge_amount: newPledge.price
        });
        
        // Verify
        const upgradedUser = await testDb.getTestUser('guest@test.maya');
        expect(upgradedUser.ks_pledge_id).toBe(newPledge.id);
    });
});

describe('Dropped/Canceled Backer Flow', () => {
    
    test('dropped backer has pledge ID but needs to pay', async () => {
        const user = await testDb.getTestUser('dropped@test.maya');
        
        expect(user.ks_pledge_id).toBeTruthy();
        expect(user.ks_pledge_amount).toBeGreaterThan(0);
        expect(user.ks_amount_paid).toBe(0);
        
        const amountDue = user.ks_pledge_amount - user.ks_amount_paid;
        expect(amountDue).toBe(user.ks_pledge_amount);
    });
    
    test('dropped backer gets backer pricing', async () => {
        const user = await testDb.getTestUser('dropped@test.maya');
        const pledge = await testDb.getTestItem(user.ks_pledge_id);
        
        // Their pledge amount should be the backer price
        expect(user.ks_pledge_amount).toBe(pledge.backer_price);
    });
    
    test('canceled backer has same behavior as dropped', async () => {
        const user = await testDb.getTestUser('canceled@test.maya');
        
        expect(user.ks_pledge_id).toBeTruthy();
        expect(user.ks_amount_paid).toBe(0);
        
        const pledge = await testDb.getTestItem(user.ks_pledge_id);
        expect(user.ks_pledge_amount).toBe(pledge.backer_price);
    });
});

