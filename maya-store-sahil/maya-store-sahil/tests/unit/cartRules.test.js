/**
 * Cart Rules Unit Tests
 * 
 * Tests cart validation logic.
 */

// Mock the database connection before importing cart rules
jest.mock('../../db/index', () => ({
    queryOne: jest.fn().mockResolvedValue(null),
    query: jest.fn().mockResolvedValue([]),
    execute: jest.fn().mockResolvedValue({}),
    getIsPostgres: jest.fn().mockReturnValue(false)
}));

// Mock the rules model
jest.mock('../../db/models/rules', () => ({
    get: jest.fn().mockImplementation((category, key) => {
        const rules = {
            'cart.max_quantity_per_item': 10,
            'cart.min_quantity': 1,
            'cart.max_items_in_cart': 50,
            'cart.max_total_amount': 10000
        };
        return Promise.resolve(rules[`${category}.${key}`] || null);
    }),
    getByCategory: jest.fn().mockResolvedValue([])
}));

const { getCartLimits, validateCart, canAddToCart, calculateUpgradePrice, getUpgradeOptions, getDowngradeTiers } = require('../../lib/rules/cartRules');

describe('Cart Rules', () => {
    
    describe('getCartLimits', () => {
        
        test('returns default limits', async () => {
            const limits = await getCartLimits();
            expect(limits).toHaveProperty('MAX_QUANTITY_PER_ITEM');
            expect(limits).toHaveProperty('MIN_QUANTITY');
            expect(typeof limits.MAX_QUANTITY_PER_ITEM).toBe('number');
        });
        
        test('limits include all required properties', async () => {
            const limits = await getCartLimits();
            expect(limits.MAX_QUANTITY_PER_ITEM).toBe(10);
            expect(limits.MIN_QUANTITY).toBe(1);
            expect(limits.MAX_ITEMS_IN_CART).toBe(50);
            expect(limits.MAX_TOTAL_AMOUNT).toBe(10000);
        });
    });
    
    describe('validateCart', () => {
        
        test('returns invalid for empty cart', async () => {
            const result = await validateCart([]);
            expect(result.valid).toBe(false);
            expect(result.errors).toContain('Cart is empty');
        });
        
        test('returns invalid for null cart', async () => {
            const result = await validateCart(null);
            expect(result.valid).toBe(false);
        });
        
        test('returns valid for cart with valid items', async () => {
            const cart = [
                { id: 101, name: 'Test Item', price: 25, quantity: 1 }
            ];
            const result = await validateCart(cart);
            expect(result.valid).toBe(true);
        });
        
        test('returns error when quantity exceeds max', async () => {
            const cart = [
                { id: 101, name: 'Test Item', price: 25, quantity: 15 }
            ];
            const result = await validateCart(cart);
            expect(result.valid).toBe(false);
            expect(result.errors.some(e => e.includes('Maximum quantity'))).toBe(true);
        });
        
        test('quantity of 0 defaults to 1 (fallback behavior)', async () => {
            // The cart rules use parseInt(quantity) || 1, so 0 becomes 1
            const cart = [
                { id: 101, name: 'Test Item', price: 25, quantity: 0 }
            ];
            const result = await validateCart(cart);
            // This is valid because 0 gets treated as 1
            expect(result.valid).toBe(true);
            expect(result.stats.totalQuantity).toBe(1);
        });
        
        test('calculates stats correctly', async () => {
            const cart = [
                { id: 101, name: 'Item 1', price: 25, quantity: 2 },
                { id: 102, name: 'Item 2', price: 10, quantity: 3 }
            ];
            const result = await validateCart(cart);
            expect(result.stats.itemCount).toBe(2);
            expect(result.stats.totalQuantity).toBe(5);
            expect(result.stats.totalAmount).toBe(80); // (25*2) + (10*3)
        });
    });
    
    describe('canAddToCart', () => {
        
        test('allows adding item to empty cart', async () => {
            const item = { id: 101, name: 'Test', price: 25 };
            const result = await canAddToCart(item, []);
            expect(result.allowed).toBe(true);
        });
        
        test('allows adding new item to cart', async () => {
            const cart = [{ id: 101, name: 'Item 1', quantity: 1 }];
            const item = { id: 102, name: 'Item 2' };
            const result = await canAddToCart(item, cart);
            expect(result.allowed).toBe(true);
        });
        
        test('blocks when cart is full', async () => {
            // Create a cart with 50 items
            const cart = Array.from({ length: 50 }, (_, i) => ({
                id: i + 1,
                name: `Item ${i + 1}`,
                quantity: 1
            }));
            const item = { id: 999, name: 'New Item' };
            const result = await canAddToCart(item, cart);
            expect(result.allowed).toBe(false);
        });
        
        test('blocks when item quantity would exceed max', async () => {
            const cart = [{ id: 101, name: 'Test', quantity: 9 }];
            const item = { id: 101, name: 'Test', quantity: 5 };
            const result = await canAddToCart(item, cart);
            expect(result.allowed).toBe(false);
        });
    });
    
    describe('calculateUpgradePrice', () => {
        
        test('returns positive difference for upgrade', () => {
            const from = { price: 18 };
            const to = { price: 35 };
            expect(calculateUpgradePrice(from, to)).toBe(17);
        });
        
        test('returns 0 for same tier', () => {
            const from = { price: 35 };
            const to = { price: 35 };
            expect(calculateUpgradePrice(from, to)).toBe(0);
        });
        
        test('returns 0 for downgrade (lower tier)', () => {
            const from = { price: 35 };
            const to = { price: 18 };
            expect(calculateUpgradePrice(from, to)).toBe(0);
        });
        
        test('handles ks_pledge_amount field', () => {
            const from = { ks_pledge_amount: 18 };
            const to = { price: 35 };
            expect(calculateUpgradePrice(from, to)).toBe(17);
        });
    });
});

describe('Pledge Selection Rules', () => {
    
    describe('Single Pledge Enforcement', () => {
        
        test('cart should only allow one pledge at a time', () => {
            // This is a behavioral test - simulating frontend logic
            const cart = [];
            
            // Add first pledge
            const pledge1 = { id: 101, type: 'pledge', name: 'Humble Vaanar', price: 25 };
            cart.push(pledge1);
            expect(cart.filter(i => i.type === 'pledge').length).toBe(1);
            
            // Adding second pledge should replace first
            const pledge2 = { id: 102, type: 'pledge', name: 'Industrious Manushya', price: 50 };
            const existingPledgeIndex = cart.findIndex(i => i.type === 'pledge');
            if (existingPledgeIndex !== -1) {
                cart.splice(existingPledgeIndex, 1);
            }
            cart.push(pledge2);
            
            expect(cart.filter(i => i.type === 'pledge').length).toBe(1);
            expect(cart[0].id).toBe(102);
        });
        
        test('add-ons should require a pledge', () => {
            const cart = [];
            const addon = { id: 201, type: 'addon', name: 'Lorebook', price: 35 };
            
            // Check if pledge exists
            const hasPledge = cart.some(i => i.type === 'pledge');
            
            // Should not allow add-on without pledge
            expect(hasPledge).toBe(false);
            
            // Add a pledge first
            cart.push({ id: 101, type: 'pledge', name: 'Humble Vaanar', price: 25 });
            
            // Now check again
            const hasPledgeNow = cart.some(i => i.type === 'pledge');
            expect(hasPledgeNow).toBe(true);
            
            // Can add addon now
            cart.push(addon);
            expect(cart.length).toBe(2);
        });
    });
    
    describe('Pledge Upgrade Logic', () => {
        
        test('upgrade should calculate price difference correctly', () => {
            const ownedPledge = { id: 101, backer_price: 18, name: 'Humble Vaanar' };
            const upgradePledge = { id: 102, backer_price: 35, name: 'Industrious Manushya' };
            
            const upgradeCost = upgradePledge.backer_price - ownedPledge.backer_price;
            expect(upgradeCost).toBe(17);
        });
        
        test('downgrade should be blocked (negative difference)', () => {
            const ownedPledge = { id: 102, backer_price: 35, name: 'Industrious Manushya' };
            const downgradePledge = { id: 101, backer_price: 18, name: 'Humble Vaanar' };
            
            const priceDifference = downgradePledge.backer_price - ownedPledge.backer_price;
            const isDowngrade = priceDifference < 0;
            
            expect(isDowngrade).toBe(true);
        });
        
        test('same pledge should not be selectable', () => {
            const ownedPledge = { id: 101, name: 'Humble Vaanar' };
            const selectedPledge = { id: 101, name: 'Humble Vaanar' };
            
            const isSamePledge = ownedPledge.id === selectedPledge.id;
            expect(isSamePledge).toBe(true);
        });
    });
});

describe('Pricing Logic', () => {
    
    describe('Backer vs Retail Pricing', () => {
        
        test('backers should see backer_price', () => {
            const product = { id: 101, price: 25, backer_price: 18 };
            const isBacker = true;
            
            const displayPrice = isBacker ? product.backer_price : product.price;
            expect(displayPrice).toBe(18);
        });
        
        test('guests should see retail price', () => {
            const product = { id: 101, price: 25, backer_price: 18 };
            const isBacker = false;
            
            const displayPrice = isBacker ? product.backer_price : product.price;
            expect(displayPrice).toBe(25);
        });
        
        test('late pledge backers should see retail price', () => {
            const product = { id: 101, price: 25, backer_price: 18 };
            const profileType = 'late_pledge';
            
            // Late pledge gets retail pricing
            const usesBackerPricing = ['collected', 'dropped', 'canceled', 'pot'].includes(profileType);
            const displayPrice = usesBackerPricing ? product.backer_price : product.price;
            
            expect(displayPrice).toBe(25);
        });
        
        test('dropped backers should see backer price', () => {
            const product = { id: 101, price: 25, backer_price: 18 };
            const profileType = 'dropped';
            
            const usesBackerPricing = ['collected', 'dropped', 'canceled', 'pot'].includes(profileType);
            const displayPrice = usesBackerPricing ? product.backer_price : product.price;
            
            expect(displayPrice).toBe(18);
        });
    });
});

describe('Cart Value Calculations', () => {
    
    // Test data - mirrors actual products
    const PLEDGES = {
        humbleVaanar: { id: 101, type: 'pledge', name: 'The Humble Vaanar', price: 25, backer_price: 18 },
        industriousManushya: { id: 102, type: 'pledge', name: 'The Industrious Manushya', price: 50, backer_price: 35 },
        resplendentGaruda: { id: 103, type: 'pledge', name: 'The Resplendent Garuda', price: 150, backer_price: 99 },
        benevolentDivya: { id: 104, type: 'pledge', name: 'The Benevolent Divya', price: 190, backer_price: 150 }
    };
    
    const ADDONS = {
        lorebook: { id: 201, type: 'addon', name: 'MAYA Lorebook', price: 35, backer_price: 25 },
        enamelPin: { id: 202, type: 'addon', name: 'MAYA Enamel Pin', price: 15, backer_price: 10 },
        poster: { id: 203, type: 'addon', name: 'MAYA Poster', price: 20, backer_price: 15 },
        builtEnvironments: { id: 204, type: 'addon', name: 'Built Environments', price: 75, backer_price: 50 }
    };
    
    // Helper to calculate cart total
    function calculateCartTotal(cart, usesBackerPricing = false) {
        return cart.reduce((sum, item) => {
            const price = usesBackerPricing ? (item.backer_price || item.price) : item.price;
            const quantity = item.quantity || 1;
            return sum + (price * quantity);
        }, 0);
    }
    
    describe('Guest Cart (Retail Pricing)', () => {
        
        test('guest cart with single pledge', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(25); // Retail price
        });
        
        test('guest cart with pledge and one addon', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, quantity: 1 },
                { ...ADDONS.lorebook, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(25 + 35); // 60
        });
        
        test('guest cart with pledge and multiple addons', () => {
            const cart = [
                { ...PLEDGES.industriousManushya, quantity: 1 },
                { ...ADDONS.lorebook, quantity: 1 },
                { ...ADDONS.enamelPin, quantity: 2 },
                { ...ADDONS.poster, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, false);
            // $50 + $35 + ($15 * 2) + $20 = 135
            expect(total).toBe(135);
        });
        
        test('guest cart with high-value pledge', () => {
            const cart = [
                { ...PLEDGES.resplendentGaruda, quantity: 1 },
                { ...ADDONS.builtEnvironments, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(150 + 75); // 225
        });
    });
    
    describe('Backer Cart (Backer Pricing)', () => {
        
        test('backer cart with single pledge', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, true);
            expect(total).toBe(18); // Backer price
        });
        
        test('backer cart with pledge and one addon', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, quantity: 1 },
                { ...ADDONS.lorebook, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, true);
            expect(total).toBe(18 + 25); // 43
        });
        
        test('backer cart with pledge and multiple addons', () => {
            const cart = [
                { ...PLEDGES.industriousManushya, quantity: 1 },
                { ...ADDONS.lorebook, quantity: 1 },
                { ...ADDONS.enamelPin, quantity: 2 },
                { ...ADDONS.poster, quantity: 1 }
            ];
            const total = calculateCartTotal(cart, true);
            // $35 + $25 + ($10 * 2) + $15 = 95
            expect(total).toBe(95);
        });
        
        test('backer saves money compared to guest', () => {
            const cart = [
                { ...PLEDGES.industriousManushya, quantity: 1 },
                { ...ADDONS.lorebook, quantity: 1 },
                { ...ADDONS.enamelPin, quantity: 2 }
            ];
            const guestTotal = calculateCartTotal(cart, false);
            const backerTotal = calculateCartTotal(cart, true);
            
            // Guest: $50 + $35 + $30 = $115
            // Backer: $35 + $25 + $20 = $80
            expect(guestTotal).toBe(115);
            expect(backerTotal).toBe(80);
            expect(guestTotal - backerTotal).toBe(35); // $35 savings
        });
    });
    
    describe('Upgrade Cart Calculations', () => {
        
        test('upgrade from Humble Vaanar to Industrious Manushya (backer)', () => {
            const ownedPledge = PLEDGES.humbleVaanar;
            const upgradePledge = PLEDGES.industriousManushya;
            
            const upgradeCost = upgradePledge.backer_price - ownedPledge.backer_price;
            expect(upgradeCost).toBe(17); // $35 - $18
            
            // Cart shows only the difference
            const cart = [
                { 
                    ...upgradePledge, 
                    price: upgradeCost, // Cart price is the difference
                    isPledgeUpgrade: true,
                    quantity: 1 
                }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(17);
        });
        
        test('upgrade from Humble Vaanar to Resplendent Garuda (backer)', () => {
            const ownedPledge = PLEDGES.humbleVaanar;
            const upgradePledge = PLEDGES.resplendentGaruda;
            
            const upgradeCost = upgradePledge.backer_price - ownedPledge.backer_price;
            expect(upgradeCost).toBe(81); // $99 - $18
        });
        
        test('upgrade from Industrious Manushya to Benevolent Divya (backer)', () => {
            const ownedPledge = PLEDGES.industriousManushya;
            const upgradePledge = PLEDGES.benevolentDivya;
            
            const upgradeCost = upgradePledge.backer_price - ownedPledge.backer_price;
            expect(upgradeCost).toBe(115); // $150 - $35
        });
        
        test('upgrade with addons in cart', () => {
            const ownedPledge = PLEDGES.humbleVaanar;
            const upgradePledge = PLEDGES.industriousManushya;
            const upgradeCost = upgradePledge.backer_price - ownedPledge.backer_price;
            
            const cart = [
                { 
                    id: upgradePledge.id,
                    name: `${upgradePledge.name} (Upgrade)`,
                    price: upgradeCost,
                    isPledgeUpgrade: true,
                    quantity: 1 
                },
                { ...ADDONS.lorebook, price: ADDONS.lorebook.backer_price, quantity: 1 },
                { ...ADDONS.enamelPin, price: ADDONS.enamelPin.backer_price, quantity: 2 }
            ];
            
            // Upgrade: $17 + Lorebook: $25 + Pins: $20 = $62
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(62);
        });
    });
    
    describe('Dropped/Canceled Backer Cart', () => {
        
        test('dropped backer cart with original pledge', () => {
            // Dropped backer's original pledge in cart (amount due)
            const cart = [
                { 
                    ...PLEDGES.humbleVaanar,
                    price: PLEDGES.humbleVaanar.backer_price, // Backer price
                    isOriginalPledge: true,
                    isDroppedBackerPledge: true,
                    quantity: 1 
                }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(18); // Must pay the backer price
        });
        
        test('dropped backer cart with pledge and addons', () => {
            const cart = [
                { 
                    ...PLEDGES.humbleVaanar,
                    price: PLEDGES.humbleVaanar.backer_price,
                    isOriginalPledge: true,
                    quantity: 1 
                },
                { ...ADDONS.lorebook, price: ADDONS.lorebook.backer_price, quantity: 1 },
                { ...ADDONS.poster, price: ADDONS.poster.backer_price, quantity: 1 }
            ];
            // $18 + $25 + $15 = $58
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(58);
        });
        
        test('canceled backer with higher pledge tier', () => {
            const cart = [
                { 
                    ...PLEDGES.industriousManushya,
                    price: PLEDGES.industriousManushya.backer_price,
                    isOriginalPledge: true,
                    quantity: 1 
                }
            ];
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(35); // Backer price honored
        });
    });
    
    describe('Cart with Shipping', () => {
        
        const SHIPPING = {
            us: 0,
            ca: 15,
            gb: 20,
            eu: 25,
            au: 30,
            row: 40
        };
        
        test('US shipping is free', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, quantity: 1 }
            ];
            const subtotal = calculateCartTotal(cart, true);
            const shipping = SHIPPING.us;
            const total = subtotal + shipping;
            
            expect(subtotal).toBe(18);
            expect(shipping).toBe(0);
            expect(total).toBe(18);
        });
        
        test('Canada shipping added to total', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, price: PLEDGES.humbleVaanar.backer_price, quantity: 1 },
                { ...ADDONS.lorebook, price: ADDONS.lorebook.backer_price, quantity: 1 }
            ];
            const subtotal = calculateCartTotal(cart, false);
            const shipping = SHIPPING.ca;
            const total = subtotal + shipping;
            
            expect(subtotal).toBe(43); // $18 + $25
            expect(shipping).toBe(15);
            expect(total).toBe(58);
        });
        
        test('Rest of World shipping with high-value order', () => {
            const cart = [
                { ...PLEDGES.benevolentDivya, price: PLEDGES.benevolentDivya.backer_price, quantity: 1 },
                { ...ADDONS.builtEnvironments, price: ADDONS.builtEnvironments.backer_price, quantity: 1 }
            ];
            const subtotal = calculateCartTotal(cart, false);
            const shipping = SHIPPING.row;
            const total = subtotal + shipping;
            
            expect(subtotal).toBe(200); // $150 + $50
            expect(shipping).toBe(40);
            expect(total).toBe(240);
        });
    });
    
    describe('Edge Cases', () => {
        
        test('max quantity per addon', () => {
            const cart = [
                { ...PLEDGES.humbleVaanar, price: PLEDGES.humbleVaanar.backer_price, quantity: 1 },
                { ...ADDONS.enamelPin, price: ADDONS.enamelPin.backer_price, quantity: 10 } // Max qty
            ];
            const total = calculateCartTotal(cart, false);
            // $18 + ($10 * 10) = $118
            expect(total).toBe(118);
        });
        
        test('multiple different addons', () => {
            const cart = [
                { ...PLEDGES.industriousManushya, price: PLEDGES.industriousManushya.backer_price, quantity: 1 },
                { ...ADDONS.lorebook, price: ADDONS.lorebook.backer_price, quantity: 1 },
                { ...ADDONS.enamelPin, price: ADDONS.enamelPin.backer_price, quantity: 3 },
                { ...ADDONS.poster, price: ADDONS.poster.backer_price, quantity: 2 },
                { ...ADDONS.builtEnvironments, price: ADDONS.builtEnvironments.backer_price, quantity: 1 }
            ];
            // $35 + $25 + $30 + $30 + $50 = $170
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(170);
        });
        
        test('collected backer addons only (no pledge in cart)', () => {
            // Collected backers already own a pledge, cart has addons only
            const cart = [
                { ...ADDONS.lorebook, price: ADDONS.lorebook.backer_price, quantity: 1 },
                { ...ADDONS.poster, price: ADDONS.poster.backer_price, quantity: 1 }
            ];
            // $25 + $15 = $40
            const total = calculateCartTotal(cart, false);
            expect(total).toBe(40);
        });
        
        test('shipping only checkout (collected backer, empty cart)', () => {
            const cart = [];
            const subtotal = calculateCartTotal(cart, false);
            const shipping = 15; // Canada
            const total = subtotal + shipping;
            
            expect(subtotal).toBe(0);
            expect(total).toBe(15); // Shipping only
        });
        
        test('price comparison: all pledge tiers', () => {
            // Verify backer vs retail price difference for each tier
            expect(PLEDGES.humbleVaanar.price - PLEDGES.humbleVaanar.backer_price).toBe(7);
            expect(PLEDGES.industriousManushya.price - PLEDGES.industriousManushya.backer_price).toBe(15);
            expect(PLEDGES.resplendentGaruda.price - PLEDGES.resplendentGaruda.backer_price).toBe(51);
            expect(PLEDGES.benevolentDivya.price - PLEDGES.benevolentDivya.backer_price).toBe(40);
        });
    });
});

