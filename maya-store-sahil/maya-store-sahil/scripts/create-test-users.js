const { randomUUID } = require('crypto');
const bcrypt = require('bcrypt');
const { query, execute, connect } = require('../db/index');

async function createTestUsers() {
    // Initialize database connection
    console.log('Initializing database connection...');
    await connect();
    console.log('✓ Database connected\n');
    console.log('Creating 10 test users...\n');
    
    // First, hash PIN "1234" properly
    const pinHash = await bcrypt.hash('1234', 10);
    console.log('✓ PIN hash generated for "1234"');
    
    const users = [
        {
            email: 'test1.collected@maya.test',
            name: 'Test User 1',
            ks_backer_number: 9001,
            ks_status: 'collected',
            ks_pledge_id: 101, // Humble Vaanar
            ks_pledge_amount: 18.0,
            ks_amount_paid: 18.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash,
            ship_name: 'Test User 1',
            ship_address_1: '123 Test St',
            ship_city: 'New York',
            ship_state: 'NY',
            ship_postal: '10001',
            ship_country: 'United States',
            ship_country_code: 'US'
        },
        {
            email: 'test2.collected.pot@maya.test',
            name: 'Test User 2',
            ks_backer_number: 9002,
            ks_status: 'collected',
            ks_pledge_id: 104, // Benevolent Divya
            ks_pledge_amount: 150.0,
            ks_amount_paid: 50.0, // Partial payment
            ks_amount_due: 100.0, // Remaining
            ks_pledge_over_time: 1,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            email: 'test3.dropped@maya.test',
            name: 'Test User 3',
            ks_backer_number: 9003,
            ks_status: 'dropped',
            ks_pledge_id: 101, // Humble Vaanar
            ks_pledge_amount: 18.0,
            ks_amount_paid: 0.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            email: 'test4.canceled@maya.test',
            name: 'Test User 4',
            ks_backer_number: 9004,
            ks_status: 'canceled',
            ks_pledge_id: 102, // Industrious Manushya
            ks_pledge_amount: 35.0,
            ks_amount_paid: 0.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            email: 'test5.nopin@maya.test',
            name: 'Test User 5',
            ks_backer_number: 9005,
            ks_status: 'collected',
            ks_pledge_id: 101, // Humble Vaanar
            ks_pledge_amount: 18.0,
            ks_amount_paid: 18.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: null // No PIN - will test OTP flow
        },
        {
            email: 'test6.savedcard@maya.test',
            name: 'Test User 6',
            ks_backer_number: 9006,
            ks_status: 'collected',
            ks_pledge_id: 103, // Resplendent Garuda
            ks_pledge_amount: 99.0,
            ks_amount_paid: 99.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash,
            stripe_payment_method: 'pm_test_card_saved',
            stripe_card_brand: 'visa',
            stripe_card_last4: '4242',
            ship_name: 'Test User 6',
            ship_address_1: '456 Card St',
            ship_city: 'Los Angeles',
            ship_state: 'CA',
            ship_postal: '90001',
            ship_country: 'United States',
            ship_country_code: 'US'
        },
        {
            email: 'test7.latepledge@maya.test',
            name: 'Test User 7',
            ks_backer_number: 9007,
            ks_status: 'collected',
            ks_pledge_id: 101, // Humble Vaanar
            ks_pledge_amount: 18.0,
            ks_amount_paid: 18.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 1, // Late pledge - should get retail prices
            pin_hash: pinHash
        },
        {
            email: 'test8.multiaddr@maya.test',
            name: 'Test User 8',
            ks_backer_number: 9008,
            ks_status: 'collected',
            ks_pledge_id: 102, // Industrious Manushya
            ks_pledge_amount: 35.0,
            ks_amount_paid: 35.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash
        },
        {
            email: 'test9.locked@maya.test',
            name: 'Test User 9',
            ks_backer_number: 9009,
            ks_status: 'collected',
            ks_pledge_id: 101, // Humble Vaanar
            ks_pledge_amount: 18.0,
            ks_amount_paid: 18.0,
            ks_pledge_over_time: 0,
            ks_late_pledge: 0,
            pin_hash: pinHash,
            ship_name: 'Test User 9',
            ship_address_1: '789 Locked St',
            ship_city: 'Chicago',
            ship_state: 'IL',
            ship_postal: '60601',
            ship_country: 'United States',
            ship_country_code: 'US',
            ship_locked: 1,
            ship_verified: 1
        },
        // test10.guest@maya.test - No record, will be created during guest checkout
    ];
    
    // Delete existing test users first
    console.log('Cleaning up existing test users...');
    for (const user of users) {
        await execute('DELETE FROM backers WHERE email = $1', [user.email]);
        await execute('DELETE FROM user_addresses WHERE identity_id IN (SELECT identity_id FROM backers WHERE email = $1)', [user.email]);
    }
    console.log('✓ Cleaned up\n');
    
    // Insert users
    for (let i = 0; i < users.length; i++) {
        const user = users[i];
        const identityId = randomUUID();
        
        await execute(`
            INSERT INTO backers (
                identity_id, email, name,
                ks_backer_number, ks_status, ks_pledge_id, ks_pledge_amount,
                ks_amount_paid, ks_amount_due, ks_pledge_over_time, ks_late_pledge,
                pin_hash,
                stripe_payment_method, stripe_card_brand, stripe_card_last4,
                ship_name, ship_address_1, ship_city, ship_state, ship_postal, ship_country, ship_country_code,
                ship_locked, ship_verified
            ) VALUES (
                $1, $2, $3,
                $4, $5, $6, $7,
                $8, $9, $10, $11,
                $12,
                $13, $14, $15,
                $16, $17, $18, $19, $20, $21, $22,
                $23, $24
            )
        `, [
            identityId,
            user.email,
            user.name,
            user.ks_backer_number,
            user.ks_status,
            user.ks_pledge_id,
            user.ks_pledge_amount,
            user.ks_amount_paid || 0,
            user.ks_amount_due || null,
            user.ks_pledge_over_time,
            user.ks_late_pledge,
            user.pin_hash,
            user.stripe_payment_method || null,
            user.stripe_card_brand || null,
            user.stripe_card_last4 || null,
            user.ship_name || null,
            user.ship_address_1 || null,
            user.ship_city || null,
            user.ship_state || null,
            user.ship_postal || null,
            user.ship_country || null,
            user.ship_country_code || null,
            user.ship_locked || 0,
            user.ship_verified || 0
        ]);
        
        console.log(`✓ Created user ${i + 1}: ${user.email} (${user.ks_status})`);
        
        // Create pledge_items entry
        await execute(`
            INSERT INTO pledge_items (pledge_id, item_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
        `, [user.ks_pledge_id, user.ks_pledge_id]);
        
        // Create multiple addresses for test8
        if (user.email === 'test8.multiaddr@maya.test') {
            const addresses = [
                { label: 'Home', full_name: 'Test User 8', address_line1: '100 Main St', city: 'New York', state: 'NY', postal_code: '10001', country: 'United States', is_default: 1 },
                { label: 'Work', full_name: 'Test User 8', address_line1: '200 Office Ave', city: 'Brooklyn', state: 'NY', postal_code: '11201', country: 'United States', is_default: 0 },
                { label: 'Vacation', full_name: 'Test User 8', address_line1: '300 Beach Rd', city: 'Miami', state: 'FL', postal_code: '33101', country: 'United States', is_default: 0 }
            ];
            
            for (const addr of addresses) {
                await execute(`
                    INSERT INTO user_addresses (
                        identity_id, label, full_name, address_line1, city, state, postal_code, country, is_default
                    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                `, [
                    identityId,
                    addr.label,
                    addr.full_name,
                    addr.address_line1,
                    addr.city,
                    addr.state,
                    addr.postal_code,
                    addr.country,
                    addr.is_default ? 1 : 0
                ]);
            }
            console.log(`  → Created 3 addresses for ${user.email}`);
        }
    }
    
    console.log('\n✓ All test users created successfully!');
    console.log('\nTest Users Summary:');
    console.log('1. test1.collected@maya.test - Standard collected backer with PIN and address');
    console.log('2. test2.collected.pot@maya.test - Payment over time backer');
    console.log('3. test3.dropped@maya.test - Dropped backer (needs to complete pledge)');
    console.log('4. test4.canceled@maya.test - Canceled backer (should get backer prices)');
    console.log('5. test5.nopin@maya.test - Collected backer without PIN (OTP flow)');
    console.log('6. test6.savedcard@maya.test - Backer with saved card and address');
    console.log('7. test7.latepledge@maya.test - Late pledge (should get retail prices)');
    console.log('8. test8.multiaddr@maya.test - Multiple addresses (3 addresses)');
    console.log('9. test9.locked@maya.test - Shipping locked backer');
    console.log('10. test10.guest@maya.test - No record (will be created during guest checkout)');
    console.log('\nAll PINs are: 1234');
    
    process.exit(0);
}

createTestUsers().catch(err => {
    console.error('Error creating test users:', err);
    process.exit(1);
});
