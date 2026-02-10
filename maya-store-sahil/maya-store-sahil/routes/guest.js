const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const pricingService = require('../services/pricingService');
const userProfileService = require('../services/userProfileService');
const orderService = require('../services/orderService');
const orderModel = require('../db/models/order');
const backerModel = require('../db/models/backer');
const emailService = require('../services/emailService');
const shippingService = require('../services/shippingService');

// Guest calculate shipping
router.post('/calculate-shipping', (req, res) => {
    const { country, cartItems } = req.body;
    const shippingCost = shippingService.calculateShipping(country, cartItems);
    res.json({ shippingCost });
});

// Check if email belongs to an existing KS backer
router.post('/check-email', async (req, res) => {
    const { email } = req.body;
    
    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    
    try {
        // Get profile by email - this is the single source of truth
        const profile = await userProfileService.getProfileByEmail(email.trim().toLowerCase());
        const profileType = profile.getType();
        
        console.log(`Email check: ${email} - Profile: ${profileType}`);
        
        // Guest profile = not a KS backer, allow guest checkout
        if (profileType === 'guest' || profileType === 'late_pledge') {
            return res.json({ 
                isBacker: false, 
                isDropped: false,
                message: 'Continue as guest'
            });
        }
        
        // Dropped backer - must complete pledge
        if (profileType === 'dropped') {
            const dashboardData = await profile.getDashboardData();
            return res.json({
                isBacker: true,
                isDropped: true,
                requiresLogin: true,
                message: 'Your Kickstarter pledge needs attention. Please log in to complete your pledge.',
                pledgeAmount: dashboardData.pledgeAmount,
                pledgeStatus: dashboardData.ksStatus
            });
        }
        
        // Collected, canceled, or PoT backer - redirect to login for backer prices
        if (['collected', 'canceled', 'pot'].includes(profileType)) {
            const isCanceled = profileType === 'canceled';
            const dashboardData = await profile.getDashboardData();
            
            return res.json({
                isBacker: true,
                isDropped: false,
                isCanceled: isCanceled,
                requiresLogin: true,
                message: isCanceled 
                    ? 'You have a Kickstarter account. Log in to access your backer pricing.'
                    : 'Welcome back! Log in to access your backer pricing and manage your pledge.',
                backerNumber: dashboardData.backerNumber
            });
        }
        
        // Fallback - allow guest checkout
        return res.json({
            isBacker: false,
            isDropped: false,
            message: 'Continue as guest'
        });
        
    } catch (err) {
        console.error('Error checking email:', err);
        res.status(500).json({ error: 'Error checking email' });
    }
});

// Guest create payment intent (immediate charge for non-backers)
router.post('/create-payment-intent', async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost, customerEmail, idempotencyKey } = req.body;
    
    console.log('\n=== Guest Payment Intent Creation ===');
    console.log('Amount: $' + amount);
    console.log('Customer Email:', customerEmail);
    console.log('Idempotency Key:', idempotencyKey || 'none');
    
    try {
        // Empty cart validation
        if (!cartItems || !Array.isArray(cartItems) || cartItems.length === 0) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        
        const emailForOrder = customerEmail || shippingAddress?.email;
        if (!emailForOrder) {
            return res.status(400).json({ error: 'Email is required for guest checkout' });
        }

        // Check profile for this email
        const profile = await userProfileService.getProfileByEmail(emailForOrder.trim().toLowerCase());
        const profileType = profile.getType();
        
        console.log(`Guest checkout profile: ${profileType}`);
        
        // Block dropped backers - they must log in
        if (profileType === 'dropped') {
            return res.status(403).json({
                error: 'Please log in to complete your Kickstarter pledge',
                requiresLogin: true,
                isDropped: true
            });
        }
        
        // KS backer trying guest checkout - allow but warn
        if (['collected', 'canceled', 'pot'].includes(profileType)) {
            console.log('⚠️  KS backer using guest checkout - linking to existing identity');
        }

        // Find or create identity for this email
        const existingBacker = profile.backer;
        const shadowUser = existingBacker || await backerModel.findOrCreateByEmail(emailForOrder, {
            name: shippingAddress?.name || shippingAddress?.fullName
        });
        const shadowIdentityId = shadowUser?.identity_id;
        
        console.log('✓ Guest linked to identity:', shadowIdentityId);

        // Prepare shipping address with email
        const shippingWithEmail = { 
            ...(shippingAddress || {}), 
            email: emailForOrder,
            name: shippingAddress?.fullName || shippingAddress?.name,
            address1: shippingAddress?.addressLine1 || shippingAddress?.address1,
            address2: shippingAddress?.addressLine2 || shippingAddress?.address2,
            postal: shippingAddress?.postalCode || shippingAddress?.postal
        };
        
        // SERVER-SIDE PRICE VALIDATION using profile
        // Guests always get retail prices (profile type is 'guest')
        console.log('Validating guest cart prices server-side...');
        const { serverTotal, validatedItems, pricingStrategy } = await pricingService.validateCartPrices(cartItems, null); // null = guest
        const expectedTotal = serverTotal + parseFloat(shippingCost || 0);
        const submittedTotal = parseFloat(amount);
        
        const validation = pricingService.validateTotal(submittedTotal, expectedTotal);
        if (!validation.valid) {
            console.error('❌ Price mismatch detected!');
            return res.status(400).json({ 
                error: 'Price validation failed',
                details: 'Cart total does not match server calculation. Please refresh and try again.',
                expectedTotal: expectedTotal.toFixed(2),
                submittedTotal: submittedTotal.toFixed(2)
            });
        }
        
        console.log(`✓ Guest price validation passed (${pricingStrategy.type} prices)`);

        const customer = await paymentService.createCustomer(
            emailForOrder,
            shippingAddress.name || shippingAddress.fullName,
            {
                orderType: 'immediate-charge',
                userType: 'guest',
                identityId: shadowIdentityId || 'guest'
            }
        );
        console.log('✓ Guest customer created (for immediate charge):', customer.id);
        
        // Create payment intent - guests always charge immediately
        const paymentIntent = await paymentService.createPaymentIntent({
            amount,
            customerId: customer.id,
            captureMethod: 'automatic', // Charge immediately for guests
            idempotencyKey: idempotencyKey || `guest-${emailForOrder}-${Date.now()}`,
            metadata: {
                identityId: shadowIdentityId || 'guest',
                customerEmail: emailForOrder,
                orderType: 'immediate-charge',
                userType: 'guest',
                totalAmount: (Math.round(amount * 100)).toString()
            }
        });
        console.log('✓ Guest Payment Intent created (immediate charge):', paymentIntent.id);
        
        // Save order to backer record
        const addonsSubtotal = amount - shippingCost;
        await orderService.createOrder({
            identityId: shadowIdentityId,
            newAddons: cartItems,
            shippingAddress: shippingWithEmail,
            shippingCost,
            addonsSubtotal,
            total: amount,
            stripeCustomerId: customer.id,
            stripePaymentIntentId: paymentIntent.id,
            paymentStatus: 'pending',
            paid: 0
        });
        console.log('✓ Guest order saved to database (awaiting payment confirmation)');
        
        // Store identity_id in session for summary page
        req.session.lastOrderId = shadowIdentityId;
        req.session.guestEmail = emailForOrder;
        req.session.save();
        
        res.json({ 
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            identityId: shadowIdentityId
        });
    } catch (error) {
        console.error('✗ Error creating guest Payment Intent:', error.message);
        res.status(500).json({ error: 'Payment setup failed', details: error.message });
    }
});

// Save payment method ID to order (uses backers table now)
router.post('/save-payment-method', async (req, res) => {
    const { paymentMethodId, paymentIntentId, customerEmail } = req.body;
    
    console.log('=== Guest Save Payment Method ===');
    console.log('Payment Intent ID:', paymentIntentId);
    console.log('Payment Method ID:', paymentMethodId);
    console.log('Customer Email:', customerEmail);
    
    try {
        // Find backer by payment intent or email
        let backer = null;
        if (paymentIntentId) {
            backer = await require('../db/index').queryOne(
                'SELECT * FROM backers WHERE stripe_payment_intent = $1',
                [paymentIntentId]
            );
        }
        if (!backer && customerEmail) {
            backer = await backerModel.findByEmail(customerEmail);
        }
        
        if (!backer) {
            console.error('No backer found for payment intent:', paymentIntentId);
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Update backer with payment method
        await backerModel.update(backer.identity_id, {
            stripe_payment_method: paymentMethodId,
            pm_status: 'card_saved'
        });
        
        console.log('✓ Payment method saved for backer:', backer.identity_id);
        
        // Send card saved confirmation email
        try {
            const order = await orderModel.findById(backer.identity_id);
            if (order) {
                const emailResult = await emailService.sendCardSavedConfirmation(order);
                await orderModel.logEmail({
                    orderId: order.id,
                    userId: backer.identity_id,
                    recipientEmail: customerEmail || backer.email,
                    emailType: 'card_saved',
                    subject: `Order Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            }
        } catch (emailError) {
            console.error('⚠️  Failed to send card saved confirmation email:', emailError.message);
        }
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error saving payment method:', err);
        res.status(500).json({ error: 'Failed to save payment method', details: err.message });
    }
});

// Guest confirm payment (uses backers table now)
router.post('/confirm-payment', async (req, res) => {
    const { paymentIntentId } = req.body;
    
    console.log('=== Guest Confirm Payment ===');
    console.log('Payment Intent ID:', paymentIntentId);
    
    try {
        // Find backer by payment intent
        const backer = await require('../db/index').queryOne(
            'SELECT identity_id FROM backers WHERE stripe_payment_intent = $1',
            [paymentIntentId]
        );
        
        if (!backer) {
            console.error('No backer found for payment intent:', paymentIntentId);
            return res.status(404).json({ error: 'Order not found' });
        }
        
        // Update backer payment status
        await backerModel.update(backer.identity_id, {
            pm_paid: 1,
            pm_status: 'paid'
        });
        
        console.log('✓ Payment confirmed for backer:', backer.identity_id);
        
        res.json({ success: true, identityId: backer.identity_id });
    } catch (err) {
        console.error('Error confirming payment:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

module.exports = router;
