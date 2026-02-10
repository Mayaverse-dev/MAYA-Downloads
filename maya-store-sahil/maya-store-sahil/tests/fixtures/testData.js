/**
 * Test Fixtures
 * 
 * Static test data for use in tests.
 */

// Test Users
const TEST_USERS = {
    collected: {
        identity_id: 'test-collected-001',
        email: 'collected@test.maya',
        name: 'Collected Backer',
        ks_backer_number: 9001,
        ks_status: 'collected',
        ks_pledge_id: 101,
        ks_pledge_amount: 18,
        ks_amount_paid: 18,
        ks_pledge_over_time: 0,
        ks_late_pledge: 0
    },
    
    pot: {
        identity_id: 'test-pot-001',
        email: 'pot@test.maya',
        name: 'PoT Backer',
        ks_backer_number: 9002,
        ks_status: 'collected',
        ks_pledge_id: 104,
        ks_pledge_amount: 150,
        ks_amount_paid: 50,
        ks_amount_due: 100,
        ks_pledge_over_time: 1,
        ks_late_pledge: 0
    },
    
    dropped: {
        identity_id: 'test-dropped-001',
        email: 'dropped@test.maya',
        name: 'Dropped Backer',
        ks_backer_number: 9003,
        ks_status: 'dropped',
        ks_pledge_id: 101,
        ks_pledge_amount: 18,
        ks_amount_paid: 0,
        ks_pledge_over_time: 0,
        ks_late_pledge: 0
    },
    
    canceled: {
        identity_id: 'test-canceled-001',
        email: 'canceled@test.maya',
        name: 'Canceled Backer',
        ks_backer_number: 9004,
        ks_status: 'canceled',
        ks_pledge_id: 102,
        ks_pledge_amount: 35,
        ks_amount_paid: 0,
        ks_pledge_over_time: 0,
        ks_late_pledge: 0
    },
    
    latePledge: {
        identity_id: 'test-latepledge-001',
        email: 'latepledge@test.maya',
        name: 'Late Pledge Backer',
        ks_backer_number: 9005,
        ks_status: 'collected',
        ks_pledge_id: 101,
        ks_pledge_amount: 25, // Retail price
        ks_amount_paid: 25,
        ks_pledge_over_time: 0,
        ks_late_pledge: 1
    },
    
    guest: {
        identity_id: 'test-guest-001',
        email: 'guest@test.maya',
        name: 'Guest User',
        ks_backer_number: null,
        ks_status: null,
        ks_pledge_id: null,
        ks_pledge_amount: null,
        ks_amount_paid: 0,
        ks_pledge_over_time: 0,
        ks_late_pledge: 0
    }
};

// Test Pledges
const TEST_PLEDGES = {
    humbleVaanar: {
        id: 101,
        sku: 'pledge-humble-vaanar',
        name: 'The Humble Vaanar',
        type: 'pledge',
        category: 'pledge',
        price: 25,
        backer_price: 18
    },
    
    industriousManushya: {
        id: 102,
        sku: 'pledge-industrious-manushya',
        name: 'The Industrious Manushya',
        type: 'pledge',
        category: 'pledge',
        price: 50,
        backer_price: 35
    },
    
    resplendentGaruda: {
        id: 103,
        sku: 'pledge-resplendent-garuda',
        name: 'The Resplendent Garuda',
        type: 'pledge',
        category: 'pledge',
        price: 150,
        backer_price: 99
    },
    
    benevolentDivya: {
        id: 104,
        sku: 'pledge-benevolent-divya',
        name: 'The Benevolent Divya',
        type: 'pledge',
        category: 'pledge',
        price: 190,
        backer_price: 150
    },
    
    foundersOfNeh: {
        id: 105,
        sku: 'pledge-founders-of-neh',
        name: 'Founders of Neh',
        type: 'pledge',
        category: 'pledge',
        price: 1500,
        backer_price: 1500
    }
};

// Test Add-ons
const TEST_ADDONS = {
    lorebook: {
        id: 201,
        sku: 'addon-lorebook',
        name: 'MAYA Lorebook',
        type: 'addon',
        category: 'books',
        price: 35,
        backer_price: 25
    },
    
    enamelPin: {
        id: 202,
        sku: 'addon-enamel-pin',
        name: 'MAYA Enamel Pin',
        type: 'addon',
        category: 'merch',
        price: 15,
        backer_price: 10
    },
    
    poster: {
        id: 203,
        sku: 'addon-poster',
        name: 'MAYA Poster',
        type: 'addon',
        category: 'merch',
        price: 20,
        backer_price: 15
    },
    
    builtEnvironments: {
        id: 204,
        sku: 'addon-built-environments',
        name: 'Built Environments',
        type: 'addon',
        category: 'books',
        price: 75,
        backer_price: 50
    }
};

// Test Addresses
const TEST_ADDRESSES = {
    us: {
        name: 'John Doe',
        address1: '123 Main St',
        address2: 'Apt 4B',
        city: 'New York',
        state: 'NY',
        postal: '10001',
        country: 'United States',
        countryCode: 'us',
        phone: '+1-555-123-4567',
        email: 'john@test.maya'
    },
    
    canada: {
        name: 'Jane Smith',
        address1: '456 Maple Ave',
        city: 'Toronto',
        state: 'ON',
        postal: 'M5V 1A1',
        country: 'Canada',
        countryCode: 'ca',
        phone: '+1-416-555-7890',
        email: 'jane@test.maya'
    },
    
    uk: {
        name: 'Bob Wilson',
        address1: '10 Downing St',
        city: 'London',
        state: '',
        postal: 'SW1A 2AA',
        country: 'United Kingdom',
        countryCode: 'gb',
        phone: '+44-20-1234-5678',
        email: 'bob@test.maya'
    },
    
    germany: {
        name: 'Hans Mueller',
        address1: 'Hauptstraße 1',
        city: 'Berlin',
        state: '',
        postal: '10115',
        country: 'Germany',
        countryCode: 'de',
        phone: '+49-30-1234567',
        email: 'hans@test.maya'
    },
    
    australia: {
        name: 'Sarah Johnson',
        address1: '100 George St',
        city: 'Sydney',
        state: 'NSW',
        postal: '2000',
        country: 'Australia',
        countryCode: 'au',
        phone: '+61-2-1234-5678',
        email: 'sarah@test.maya'
    }
};

// Test Cart Items
const TEST_CARTS = {
    guestWithPledge: [
        { ...TEST_PLEDGES.humbleVaanar, quantity: 1 }
    ],
    
    guestWithPledgeAndAddons: [
        { ...TEST_PLEDGES.industriousManushya, quantity: 1 },
        { ...TEST_ADDONS.lorebook, quantity: 1 },
        { ...TEST_ADDONS.enamelPin, quantity: 2 }
    ],
    
    backerUpgrade: [
        { 
            id: 102, 
            name: 'The Industrious Manushya (Upgrade)', 
            price: 17, // Difference from Humble Vaanar
            type: 'pledge',
            isPledgeUpgrade: true,
            originalPrice: 35,
            currentPledgeAmount: 18,
            currentPledgeName: 'The Humble Vaanar',
            quantity: 1
        }
    ],
    
    backerAddonsOnly: [
        { ...TEST_ADDONS.lorebook, quantity: 1 },
        { ...TEST_ADDONS.poster, quantity: 1 }
    ],
    
    droppedBackerWithPledge: [
        { 
            ...TEST_PLEDGES.humbleVaanar, 
            quantity: 1,
            isOriginalPledge: true,
            isDroppedBackerPledge: true
        }
    ]
};

// Pricing Matrix for validation
const PRICING_MATRIX = {
    guest: { pricingType: 'retail', paymentMethod: 'immediate' },
    collected: { pricingType: 'backer', paymentMethod: 'card_saved' },
    pot: { pricingType: 'backer', paymentMethod: 'card_saved' },
    dropped: { pricingType: 'backer', paymentMethod: 'immediate' },
    canceled: { pricingType: 'backer', paymentMethod: 'immediate' },
    late_pledge: { pricingType: 'retail', paymentMethod: 'immediate' }
};

// Shipping expectations
const SHIPPING_EXPECTATIONS = {
    us: { cost: 0, zone: 'United States' },
    ca: { cost: 15, zone: 'Canada' },
    gb: { cost: 20, zone: 'United Kingdom' },
    de: { cost: 25, zone: 'European Union' },
    au: { cost: 30, zone: 'Australia/New Zealand' },
    jp: { cost: 40, zone: 'Rest of World' }
};

module.exports = {
    TEST_USERS,
    TEST_PLEDGES,
    TEST_ADDONS,
    TEST_ADDRESSES,
    TEST_CARTS,
    PRICING_MATRIX,
    SHIPPING_EXPECTATIONS
};

