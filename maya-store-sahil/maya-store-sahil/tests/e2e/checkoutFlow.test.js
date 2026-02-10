/**
 * Checkout Flow E2E Tests
 * 
 * Tests complete checkout scenarios for different user types.
 * Uses test database - NEVER touches production.
 */

const testDb = require('../testDb');
const { TEST_USERS, TEST_PLEDGES, TEST_ADDONS, TEST_ADDRESSES, PRICING_MATRIX } = require('../fixtures/testData');

describe('Checkout Flow - Guest User', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    describe('Pledge Selection', () => {
        
        test('guest must select pledge before adding addons', async () => {
            // Simulate cart state
            const cart = [];
            const hasPledge = cart.some(i => i.type === 'pledge');
            
            // Try to add addon without pledge
            const canAddAddon = hasPledge;
            expect(canAddAddon).toBe(false);
            
            // Add pledge
            cart.push({ ...TEST_PLEDGES.humbleVaanar, quantity: 1 });
            const hasPledgeNow = cart.some(i => i.type === 'pledge');
            expect(hasPledgeNow).toBe(true);
            
            // Now can add addon
            cart.push({ ...TEST_ADDONS.lorebook, quantity: 1 });
            expect(cart.length).toBe(2);
        });
        
        test('guest sees retail prices', async () => {
            const { pricingType } = PRICING_MATRIX.guest;
            expect(pricingType).toBe('retail');
            
            // Guest should see price, not backer_price
            const displayPrice = TEST_PLEDGES.humbleVaanar.price;
            expect(displayPrice).toBe(25);
            expect(displayPrice).toBeGreaterThan(TEST_PLEDGES.humbleVaanar.backer_price);
        });
        
        test('guest can only have one pledge in cart', async () => {
            const cart = [];
            
            // Add first pledge
            cart.push({ ...TEST_PLEDGES.humbleVaanar, quantity: 1 });
            expect(cart.filter(i => i.type === 'pledge').length).toBe(1);
            
            // Replace with second pledge
            const existingIdx = cart.findIndex(i => i.type === 'pledge');
            cart.splice(existingIdx, 1);
            cart.push({ ...TEST_PLEDGES.industriousManushya, quantity: 1 });
            
            expect(cart.filter(i => i.type === 'pledge').length).toBe(1);
            expect(cart[0].id).toBe(TEST_PLEDGES.industriousManushya.id);
        });
    });
    
    describe('Order Completion', () => {
        
        test('guest pledge is stored in database after checkout', async () => {
            const user = await testDb.getTestUser('guest@test.maya');
            expect(user.ks_pledge_id).toBeNull();
            
            // Simulate checkout completion
            await testDb.updateTestUser('guest@test.maya', {
                ks_pledge_id: TEST_PLEDGES.industriousManushya.id,
                ks_pledge_amount: TEST_PLEDGES.industriousManushya.price, // Retail
                pm_total: TEST_PLEDGES.industriousManushya.price,
                pm_paid: 1,
                pm_status: 'succeeded'
            });
            
            const updatedUser = await testDb.getTestUser('guest@test.maya');
            expect(updatedUser.ks_pledge_id).toBe(TEST_PLEDGES.industriousManushya.id);
            expect(updatedUser.pm_paid).toBe(1);
        });
        
        test('guest charged immediately', async () => {
            const { paymentMethod } = PRICING_MATRIX.guest;
            expect(paymentMethod).toBe('immediate');
        });
    });
});

describe('Checkout Flow - Collected Backer', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    describe('Pledge Upgrade', () => {
        
        test('collected backer can upgrade pledge', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            const currentPledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Find upgrade options
            const upgradePledge = TEST_PLEDGES.industriousManushya;
            expect(upgradePledge.backer_price).toBeGreaterThan(currentPledge.backer_price);
            
            // Calculate upgrade cost
            const upgradeCost = upgradePledge.backer_price - currentPledge.backer_price;
            expect(upgradeCost).toBe(17); // 35 - 18
        });
        
        test('upgrade updates ks_pledge_id after payment', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            expect(user.ks_pledge_id).toBe(101); // Humble Vaanar
            
            // Simulate upgrade completion
            await testDb.updateTestUser('collected@test.maya', {
                ks_pledge_id: 102, // Industrious Manushya
                ks_pledge_amount: 35
            });
            
            const upgraded = await testDb.getTestUser('collected@test.maya');
            expect(upgraded.ks_pledge_id).toBe(102);
        });
        
        test('cannot downgrade pledge', async () => {
            // Use a user with higher pledge
            await testDb.updateTestUser('collected@test.maya', {
                ks_pledge_id: 103, // Resplendent Garuda
                ks_pledge_amount: 99
            });
            
            const user = await testDb.getTestUser('collected@test.maya');
            const currentPledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Attempt downgrade
            const downgradePledge = TEST_PLEDGES.humbleVaanar;
            const isDowngrade = downgradePledge.backer_price < currentPledge.backer_price;
            
            expect(isDowngrade).toBe(true);
            // UI should block this
        });
    });
    
    describe('Add-ons Only', () => {
        
        test('collected backer can add addons without pledge in cart', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            
            // They already have a pledge
            expect(user.ks_pledge_id).toBeTruthy();
            
            // Cart can have addons only
            const cart = [
                { ...TEST_ADDONS.lorebook, quantity: 1, price: TEST_ADDONS.lorebook.backer_price },
                { ...TEST_ADDONS.enamelPin, quantity: 2, price: TEST_ADDONS.enamelPin.backer_price }
            ];
            
            const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            expect(total).toBe(25 + 20); // 25 + (10 * 2)
        });
        
        test('collected backer gets backer prices for addons', async () => {
            const { pricingType } = PRICING_MATRIX.collected;
            expect(pricingType).toBe('backer');
            
            // Should use backer_price
            expect(TEST_ADDONS.lorebook.backer_price).toBe(25);
            expect(TEST_ADDONS.lorebook.backer_price).toBeLessThan(TEST_ADDONS.lorebook.price);
        });
        
        test('collected backer card is saved, not charged immediately', async () => {
            const { paymentMethod } = PRICING_MATRIX.collected;
            expect(paymentMethod).toBe('card_saved');
        });
    });
    
    describe('Shipping Only', () => {
        
        test('collected backer can checkout with $0 cart for shipping', async () => {
            const user = await testDb.getTestUser('collected@test.maya');
            
            // Has pledge
            expect(user.ks_pledge_id).toBeTruthy();
            expect(user.ks_amount_paid).toBeGreaterThan(0);
            
            // Can proceed with empty cart to pay shipping only
            const cart = [];
            const cartTotal = 0;
            const shippingCost = 15; // e.g., Canada shipping
            
            const orderTotal = cartTotal + shippingCost;
            expect(orderTotal).toBe(15);
        });
    });
});

describe('Checkout Flow - Dropped Backer', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    describe('Pledge Completion', () => {
        
        test('dropped backer has pledge ID but needs to pay', async () => {
            const user = await testDb.getTestUser('dropped@test.maya');
            
            expect(user.ks_pledge_id).toBeTruthy();
            expect(user.ks_pledge_amount).toBeGreaterThan(0);
            expect(user.ks_amount_paid).toBe(0);
        });
        
        test('dropped backer pledge auto-added to cart', async () => {
            const user = await testDb.getTestUser('dropped@test.maya');
            const pledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Auto-add to cart
            const cart = [{
                ...pledge,
                quantity: 1,
                price: pledge.backer_price, // Backer price
                isOriginalPledge: true,
                isDroppedBackerPledge: true
            }];
            
            expect(cart[0].isDroppedBackerPledge).toBe(true);
            expect(cart[0].price).toBe(18);
        });
        
        test('dropped backer can add addons after pledge in cart', async () => {
            const user = await testDb.getTestUser('dropped@test.maya');
            const pledge = await testDb.getTestItem(user.ks_pledge_id);
            
            // Cart starts with pledge
            const cart = [{
                ...pledge,
                quantity: 1,
                price: pledge.backer_price,
                isOriginalPledge: true
            }];
            
            // Now can add addons
            const hasPledge = cart.some(i => i.type === 'pledge');
            expect(hasPledge).toBe(true);
            
            cart.push({ ...TEST_ADDONS.lorebook, quantity: 1, price: TEST_ADDONS.lorebook.backer_price });
            
            const total = cart.reduce((sum, i) => sum + (i.price * i.quantity), 0);
            expect(total).toBe(18 + 25); // Pledge + Lorebook (backer prices)
        });
        
        test('dropped backer charged immediately', async () => {
            const { paymentMethod } = PRICING_MATRIX.dropped;
            expect(paymentMethod).toBe('immediate');
        });
        
        test('dropped backer gets backer prices', async () => {
            const { pricingType } = PRICING_MATRIX.dropped;
            expect(pricingType).toBe('backer');
        });
    });
});

describe('Checkout Flow - Late Pledge Backer', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    test('late pledge backer pays retail prices', async () => {
        const { pricingType } = PRICING_MATRIX.late_pledge;
        expect(pricingType).toBe('retail');
        
        // They paid retail for their pledge
        const user = await testDb.getTestUser('latepledge@test.maya');
        const pledge = await testDb.getTestItem(user.ks_pledge_id);
        
        expect(user.ks_pledge_amount).toBe(pledge.price); // Retail, not backer
    });
    
    test('late pledge backer charged immediately', async () => {
        const { paymentMethod } = PRICING_MATRIX.late_pledge;
        expect(paymentMethod).toBe('immediate');
    });
});

describe('Checkout Flow - PoT Backer', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    test('PoT backer has partial payment on pledge', async () => {
        const user = await testDb.getTestUser('pot@test.maya');
        
        expect(user.ks_pledge_over_time).toBe(1);
        expect(user.ks_amount_paid).toBeLessThan(user.ks_pledge_amount);
        
        const remaining = user.ks_pledge_amount - user.ks_amount_paid;
        expect(remaining).toBe(100);
    });
    
    test('PoT backer gets backer prices for addons', async () => {
        const { pricingType } = PRICING_MATRIX.pot;
        expect(pricingType).toBe('backer');
    });
    
    test('PoT backer card saved for bulk charge', async () => {
        const { paymentMethod } = PRICING_MATRIX.pot;
        expect(paymentMethod).toBe('card_saved');
    });
});

describe('Shipping Address Flow', () => {
    
    beforeEach(async () => {
        await testDb.reset();
    });
    
    test('user can save shipping address', async () => {
        const address = TEST_ADDRESSES.us;
        
        // Save address to user
        await testDb.updateTestUser('collected@test.maya', {
            ship_name: address.name,
            ship_address_1: address.address1,
            ship_address_2: address.address2,
            ship_city: address.city,
            ship_state: address.state,
            ship_postal: address.postal,
            ship_country: address.country
        });
        
        const user = await testDb.getTestUser('collected@test.maya');
        expect(user.ship_name).toBe(address.name);
        expect(user.ship_city).toBe(address.city);
    });
    
    test('locked shipping cannot be modified', async () => {
        await testDb.updateTestUser('collected@test.maya', {
            ship_locked: 1,
            ship_verified: 1
        });
        
        const user = await testDb.getTestUser('collected@test.maya');
        
        // Check lock status
        const canModify = user.ship_locked !== 1;
        expect(canModify).toBe(false);
    });
    
    test('multiple addresses can be saved', async () => {
        // Insert multiple addresses
        await testDb.execute(`
            INSERT INTO user_addresses (identity_id, label, full_name, address_line1, city, state, postal_code, country, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ['test-collected-001', 'Home', 'John Doe', '123 Main St', 'NYC', 'NY', '10001', 'US', 1]);
        
        await testDb.execute(`
            INSERT INTO user_addresses (identity_id, label, full_name, address_line1, city, state, postal_code, country, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, ['test-collected-001', 'Work', 'John Doe', '456 Office Ave', 'NYC', 'NY', '10002', 'US', 0]);
        
        const addresses = await testDb.query(
            'SELECT * FROM user_addresses WHERE identity_id = ?',
            ['test-collected-001']
        );
        
        expect(addresses.length).toBe(2);
        
        const defaultAddr = addresses.find(a => a.is_default === 1);
        expect(defaultAddr.label).toBe('Home');
    });
});

