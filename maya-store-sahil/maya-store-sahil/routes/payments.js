const express = require('express');
const router = express.Router();
const paymentService = require('../services/paymentService');
const pricingService = require('../services/pricingService');
const userProfileService = require('../services/userProfileService');
const orderService = require('../services/orderService');
const orderModel = require('../db/models/order');
const userModel = require('../db/models/user');
const emailService = require('../services/emailService');
const { requireAuth } = require('../middleware/auth');

// Create payment intent (accessible to both backers and guests)
router.post('/create-payment-intent', async (req, res) => {
    const { amount, cartItems, shippingAddress, shippingCost, isShippingOnly } = req.body;
    
    console.log('\n=== Payment Intent Creation Request ===');
    console.log('Amount: $' + amount);
    console.log('Cart Items:', cartItems?.length || 0);
    console.log('Shipping Only:', isShippingOnly || false);
    console.log('Shipping Address Email:', shippingAddress?.email || 'N/A');
    console.log('Shipping Cost: $' + (shippingCost || 0));
    
    try {
        // Validate inputs
        if (!shippingAddress) {
            return res.status(400).json({ error: 'Missing shipping address', code: 'MISSING_ADDRESS' });
        }
        
        if (!shippingAddress.email) {
            return res.status(400).json({ error: 'Missing email address', code: 'MISSING_EMAIL' });
        }
        
        if (!shippingAddress.country) {
            return res.status(400).json({ error: 'Missing country', code: 'MISSING_COUNTRY' });
        }
        
        // Determine identity first (needed for shipping-only validation)
        const isAuthenticated = req.session && req.session.identityId;
        let identityId = isAuthenticated ? req.session.identityId : null;
        const userEmail = shippingAddress.email || (isAuthenticated ? (req.session.email || req.session.userEmail) : null);
        
        // Check if shipping-only payment is allowed for this user
        const itemsArray = cartItems || [];
        if (itemsArray.length === 0 && !isShippingOnly) {
            return res.status(400).json({ error: 'Cart is empty' });
        }
        
        // For shipping-only, verify user is a collected/pot backer
        if (isShippingOnly) {
            if (!isAuthenticated) {
                return res.status(400).json({ error: 'Must be logged in for shipping-only payment' });
            }
            
            // Check backer record directly for more reliable validation
            const backerModel = require('../db/models/backer');
            const backer = await backerModel.findByIdentityId(identityId);
            
            if (!backer) {
                return res.status(400).json({ error: 'Backer record not found' });
            }
            
            // Check both profile type and backer status for validation
            const profile = await userProfileService.getProfile(identityId);
            const profileType = profile.getType();
            const ksStatus = backer.ks_status;
            const isPoT = backer.ks_pledge_over_time === 1;
            
            console.log('🔍 Shipping-only check:');
            console.log('  Identity ID:', identityId);
            console.log('  Profile Type:', profileType);
            console.log('  KS Status:', ksStatus);
            console.log('  Is PoT:', isPoT);
            console.log('  Expected: collected status or pot profile');
            
            // Allow if: profile is collected/pot OR backer status is 'collected'
            const isCollectedProfile = profileType === 'collected' || profileType === 'pot';
            const isCollectedStatus = ksStatus === 'collected';
            
            if (!isCollectedProfile && !isCollectedStatus) {
                return res.status(400).json({ 
                    error: `Shipping-only payment not allowed. Profile: ${profileType}, Status: ${ksStatus}` 
                });
            }
            console.log('✓ Shipping-only payment authorized for', profileType, 'backer (status:', ksStatus + ')');
        }

        // Shadow user creation for guests to link orders
        if (!identityId && userEmail) {
            console.log('👤 Guest checkout - checking email:', userEmail);
            
            try {
                // First check if email belongs to an existing Kickstarter backer
                const backerModel = require('../db/models/backer');
                const existingBacker = await backerModel.findByEmail(userEmail.toLowerCase().trim());
                
                if (existingBacker && existingBacker.ks_backer_number) {
                    // Email belongs to a Kickstarter backer - they must log in
                    console.log('⚠️  Email belongs to existing backer #' + existingBacker.ks_backer_number);
                    return res.status(400).json({ 
                        error: 'This email is associated with a Kickstarter backer account. Please log in to continue.',
                        code: 'BACKER_LOGIN_REQUIRED',
                        backerNumber: existingBacker.ks_backer_number
                    });
                }
                
                // Create shadow user for true guests (non-backers)
                console.log('Creating shadow user for guest...');
                const shadowUser = await userModel.ensureUserByEmail(userEmail, shippingAddress.fullName || shippingAddress.name);
                identityId = shadowUser ? (shadowUser.identity_id || shadowUser.id) : null;
                console.log('✓ Shadow user created:', identityId);
            } catch (shadowErr) {
                console.error('Error in shadow user creation:', shadowErr.message);
                console.error('Stack:', shadowErr.stack);
                // Continue without shadow user - order will be orphaned but still work
            }
        }
        
        // Get user profile - THIS IS THE CENTRAL DECISION MAKER
        console.log('Getting user profile for identityId:', identityId || 'null (guest)');
        let profile, pricingStrategy, paymentStrategy;
        try {
            profile = await userProfileService.getProfile(identityId);
            pricingStrategy = await profile.getPricingStrategy();
            paymentStrategy = await profile.getPaymentStrategy();
        } catch (profileErr) {
            console.error('Error getting user profile:', profileErr.message);
            console.error('Stack:', profileErr.stack);
            throw new Error('Failed to determine user profile: ' + profileErr.message);
        }
        
        console.log(`User Profile: ${profile.getType()}`);
        console.log(`  Pricing: ${pricingStrategy.type} - ${pricingStrategy.reason}`);
        console.log(`  Payment: ${paymentStrategy.method} - ${paymentStrategy.reason}`);
        
        // SERVER-SIDE PRICE CALCULATION
        const calculatedShipping = parseFloat(shippingCost || 0);
        let serverTotal = 0;
        let validatedItems = [];
        
        if (isShippingOnly) {
            // Shipping-only payment - no cart items to validate
            console.log('Processing shipping-only payment...');
            serverTotal = 0;
            validatedItems = [];
        } else {
            // Normal flow - validate cart prices
            console.log(`Calculating cart prices server-side...`);
            console.log('Cart items to validate:', JSON.stringify(itemsArray, null, 2));
            try {
                const priceResult = await pricingService.validateCartPrices(itemsArray, identityId);
                serverTotal = priceResult.serverTotal;
                validatedItems = priceResult.validatedItems;
            } catch (priceErr) {
                console.error('Error validating cart prices:', priceErr.message);
                console.error('Stack:', priceErr.stack);
                throw new Error('Cart validation failed: ' + priceErr.message);
            }
        }
        
        const expectedTotal = serverTotal + calculatedShipping;
        const submittedTotal = parseFloat(amount || 0);
        
        // Log any price difference (for debugging) but use server-calculated amount
        if (Math.abs(expectedTotal - submittedTotal) > 0.01) {
            console.log('⚠️  Price adjustment:');
            console.log(`  Client sent: $${submittedTotal.toFixed(2)}`);
            console.log(`  Server calculated: $${expectedTotal.toFixed(2)}`);
            console.log(`  Using server amount for payment`);
        }
        
        // ALWAYS use server-calculated total for payment (security)
        const finalAmount = expectedTotal;
        
        console.log('✓ Price calculation complete');
        console.log(`  Cart subtotal: $${serverTotal.toFixed(2)}`);
        console.log(`  Shipping: $${calculatedShipping.toFixed(2)}`);
        console.log(`  Total: $${finalAmount.toFixed(2)}`);
        console.log(`  Pricing: ${pricingStrategy.type}`);
        
        // Determine payment method from profile
        const chargeImmediately = await profile.chargeImmediately();
        const captureMethod = await profile.getStripeCaptureMethod();
        const orderType = chargeImmediately ? 'immediate-charge' : 'pre-order-autodebit';
        
        // Check if user already has a Stripe customer ID (reuse existing customer)
        let customer;
        let customerId = null;
        
        if (identityId) {
            const backerModel = require('../db/models/backer');
            const existingBacker = await backerModel.findByIdentityId(identityId);
            if (existingBacker && existingBacker.stripe_customer_id) {
                customerId = existingBacker.stripe_customer_id;
                console.log('✓ Reusing existing Stripe customer:', customerId);
            }
        }
        
        // Only create new customer if we don't have one
        if (!customerId) {
            console.log('Creating new Stripe customer...');
            try {
                customer = await paymentService.createCustomer(
                    userEmail,
                    shippingAddress.fullName || shippingAddress.name,
                    {
                        identityId: identityId ? identityId.toString() : 'guest',
                        userId: identityId ? identityId.toString() : 'guest',
                        orderType,
                        userType: profile.getType()
                    }
                );
                customerId = customer.id;
                console.log('✓ Customer created:', customerId);
            } catch (stripeErr) {
                console.error('Error creating Stripe customer:', stripeErr.message);
                console.error('Stack:', stripeErr.stack);
                throw new Error('Failed to create payment customer: ' + stripeErr.message);
            }
        }
        
        console.log(`Creating Payment Intent (${chargeImmediately ? 'immediate charge' : 'save card for later'})...`);
        let paymentIntent;
        try {
            paymentIntent = await paymentService.createPaymentIntent({
                amount: finalAmount,
                customerId: customerId,
                captureMethod,
                metadata: {
                    identityId: identityId ? identityId.toString() : 'guest',
                    userId: identityId ? identityId.toString() : 'guest',
                    userEmail: userEmail || 'unknown',
                    orderAmount: finalAmount.toString(),
                    orderType,
                    userType: profile.getType()
                }
            });
            console.log('✓ Payment Intent created:', paymentIntent.id);
        } catch (stripeErr) {
            console.error('Error creating Payment Intent:', stripeErr.message);
            console.error('Stack:', stripeErr.stack);
            throw new Error('Failed to create payment intent: ' + stripeErr.message);
        }
        
        console.log('Saving order to database...');
        const addonsSubtotal = serverTotal;
        const paymentStatus = chargeImmediately ? 'succeeded' : 'pending';
        const paidStatus = chargeImmediately ? 1 : 0;
        
        // Extract pledge item from cart (if any) - for non-backer pledge purchases
        const pledgeItem = validatedItems.find(item => item.type === 'pledge');
        const addonItems = validatedItems.filter(item => item.type !== 'pledge');
        
        if (pledgeItem) {
            console.log('📦 Pledge item found in cart:', pledgeItem.name, '($' + pledgeItem.price + ')');
        }
        
        try {
            await orderService.createOrder({
                identityId: identityId || null,
                newAddons: addonItems,
                pledgeItem: pledgeItem || null,
                shippingAddress,
                shippingCost: calculatedShipping,
                addonsSubtotal,
                total: finalAmount,
                stripeCustomerId: customerId,
                stripePaymentIntentId: paymentIntent.id,
                paymentStatus,
                paid: paidStatus
            });
            console.log('✓ Order saved to database');
        } catch (orderErr) {
            console.error('Error saving order to database:', orderErr.message);
            console.error('Stack:', orderErr.stack);
            // Don't fail the payment if order save fails - payment intent is already created
            console.warn('⚠️  Continuing despite order save failure - payment intent created:', paymentIntent.id);
        }
        
        // Store order ID in session for summary page
        try {
            const savedOrder = await orderService.getOrderByPaymentIntentId(paymentIntent.id);
            if (savedOrder) {
                req.session.lastOrderId = savedOrder.id;
                await new Promise((resolve, reject) => {
                    req.session.save((err) => {
                        if (err) reject(err);
                        else resolve();
                    });
                });
            }
        } catch (sessionErr) {
            console.warn('Failed to save order ID to session:', sessionErr.message);
            // Non-critical - continue
        }
        
        res.json({ 
            clientSecret: paymentIntent.client_secret,
            customerId: customerId,
            paymentIntentId: paymentIntent.id,
            // Return calculated amounts so client can update display
            calculatedTotal: finalAmount,
            calculatedSubtotal: serverTotal,
            calculatedShipping: calculatedShipping,
            pricingType: pricingStrategy.type
        });
    } catch (error) {
        console.error('\n✗ Unexpected error in payment setup');
        console.error('  - Error:', error.message);
        console.error('  - Stack:', error.stack);
        console.error('  - Request body:', JSON.stringify({
            amount: req.body.amount,
            cartItemsCount: req.body.cartItems?.length || 0,
            isShippingOnly: req.body.isShippingOnly,
            hasShippingAddress: !!req.body.shippingAddress,
            shippingCost: req.body.shippingCost
        }, null, 2));
        
        // Return more helpful error for debugging
        const errorResponse = { 
            error: 'Payment setup failed',
            details: error.message,
            code: 'PAYMENT_SETUP_ERROR'
        };
        
        // Add specific error codes for common issues
        if (error.message.includes('Cart is empty')) {
            errorResponse.code = 'CART_EMPTY';
        } else if (error.message.includes('not found')) {
            errorResponse.code = 'ITEM_NOT_FOUND';
        } else if (error.message.includes('database') || error.message.includes('SQLITE')) {
            errorResponse.code = 'DATABASE_ERROR';
        } else if (error.message.includes('Stripe') || error.message.includes('stripe')) {
            errorResponse.code = 'STRIPE_ERROR';
        } else if (error.message.includes('profile')) {
            errorResponse.code = 'PROFILE_ERROR';
        }
        
        res.status(500).json(errorResponse);
    }
});

// Cancel payment authorization
router.post('/cancel-payment-authorization', async (req, res) => {
    const { paymentIntentId } = req.body;
    
    console.log('\n=== Cancelling Payment Authorization ===');
    console.log('Payment Intent ID:', paymentIntentId);
    
    try {
        const cancelled = await paymentService.cancelPaymentIntent(paymentIntentId);
        console.log('✓ Payment authorization cancelled');
        console.log('  - Status:', cancelled.status);
        
        res.json({ success: true, status: cancelled.status });
    } catch (err) {
        console.error('✗ Error cancelling authorization:', err.message);
        res.json({ success: false, error: err.message });
    }
});

// Save payment method after payment intent succeeds
router.post('/save-payment-method', async (req, res) => {
    const { paymentIntentId, paymentMethodId } = req.body;
    
    console.log('=== Saving Payment Method ===');
    console.log('Payment Intent ID:', paymentIntentId);
    console.log('Payment Method ID:', paymentMethodId);
    
    try {
        let finalPaymentMethodId = paymentMethodId;
        
        if (!finalPaymentMethodId && paymentIntentId) {
            console.log('Retrieving Payment Intent from Stripe...');
            const paymentIntent = await paymentService.retrievePaymentIntent(paymentIntentId);
            finalPaymentMethodId = paymentIntent.payment_method;
            console.log('✓ Extracted payment method from Payment Intent:', finalPaymentMethodId);
        }
        
        if (!finalPaymentMethodId) {
            console.error('✗ No payment method ID available');
            return res.status(400).json({ error: 'Payment method ID is required' });
        }
        
        console.log('Retrieving Payment Intent status...');
        const paymentIntent = await paymentService.retrievePaymentIntent(paymentIntentId);
        console.log('✓ Payment Intent status:', paymentIntent.status);
        
        let paymentStatus = 'card_saved';
        let paidStatus = 0;
        
        if (paymentIntent.status === 'succeeded') {
            paymentStatus = 'succeeded';
            paidStatus = 1;
            console.log('✓ Payment succeeded - customer charged immediately');
        } else if (paymentIntent.status === 'requires_capture') {
            paymentStatus = 'card_saved';
            paidStatus = 0;
            console.log('✓ Card authorized - will be charged when items ship');
        }
        
        console.log('Updating order in database...');
        await orderService.updateOrderPaymentMethod(paymentIntentId, finalPaymentMethodId, paymentStatus, paidStatus);
        
        // Fetch and save card details from Stripe
        console.log('Fetching card details from Stripe...');
        const cardDetails = await paymentService.getCardDetails(finalPaymentMethodId);
        if (cardDetails) {
            console.log('✓ Card details:', cardDetails.brand, '****', cardDetails.last4);
            
            // Update backer with card details
            const backerModel = require('../db/models/backer');
            const backer = await backerModel.findByStripePaymentIntent(paymentIntentId);
            console.log('Looking for backer with payment intent:', paymentIntentId);
            
            if (backer) {
                console.log('✓ Found backer:', backer.email, backer.identity_id);
                await backerModel.update(backer.identity_id, {
                    stripe_card_brand: cardDetails.brand,
                    stripe_card_last4: cardDetails.last4,
                    stripe_card_exp: `${cardDetails.expMonth}/${cardDetails.expYear}`
                });
                console.log('✓ Card details saved to database');
            } else {
                console.error('✗ No backer found for payment intent:', paymentIntentId);
                console.log('Attempting to find via order service...');
                
                // Try to find via order
                const order = await orderService.getOrderByPaymentIntentId(paymentIntentId);
                if (order && order.identity_id) {
                    console.log('✓ Found order with identity_id:', order.identity_id);
                    await backerModel.update(order.identity_id, {
                        stripe_card_brand: cardDetails.brand,
                        stripe_card_last4: cardDetails.last4,
                        stripe_card_exp: `${cardDetails.expMonth}/${cardDetails.expYear}`,
                        stripe_payment_intent: paymentIntentId
                    });
                    console.log('✓ Card details saved via order lookup');
                } else {
                    console.error('✗ Could not find backer or order for payment intent');
                }
            }
        } else {
            console.log('⚠️ No card details returned from Stripe for payment method:', finalPaymentMethodId);
        }
        
        console.log('✓ Payment method saved successfully');
        
        // Send card saved confirmation email
        try {
            const order = await orderService.getOrderByPaymentIntentId(paymentIntentId);
            if (order) {
                const emailResult = await emailService.sendCardSavedConfirmation(order);
                await orderModel.logEmail({
                    orderId: order.id,
                    userId: order.user_id,
                    recipientEmail: order.shipping_address?.email,
                    emailType: 'card_saved',
                    subject: `Order #${order.id} - Order Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            }
        } catch (emailError) {
            console.error('⚠️  Failed to send card saved confirmation email:', emailError.message);
        }
        
        res.json({ 
            success: true,
            paymentMethodId: finalPaymentMethodId,
            cardDetails: cardDetails || null
        });
    } catch (err) {
        console.error('✗ Error saving payment method:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// Confirm payment
router.post('/confirm-payment', requireAuth, async (req, res) => {
    const { paymentIntentId } = req.body;
    
    try {
        const identityId = req.session.identityId;
        await orderModel.confirmPayment(paymentIntentId, identityId);
        await userModel.markAsCompleted(identityId);
        
        res.json({ success: true });
    } catch (err) {
        console.error('Error confirming payment:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Verify payment status with Stripe (real-time check)
router.post('/verify-payment-status', async (req, res) => {
    const { paymentIntentId } = req.body;
    
    if (!paymentIntentId) {
        return res.status(400).json({ error: 'Payment intent ID required' });
    }
    
    console.log('=== Verifying Payment Status ===');
    console.log('Payment Intent ID:', paymentIntentId);
    
    try {
        // Fetch current status from Stripe
        const paymentIntent = await paymentService.retrievePaymentIntent(paymentIntentId);
        
        console.log('Stripe Status:', paymentIntent.status);
        console.log('Amount:', paymentIntent.amount / 100);
        
        let dbStatus = 'pending';
        let paid = false;
        let message = '';
        
        switch (paymentIntent.status) {
            case 'succeeded':
                dbStatus = 'succeeded';
                paid = true;
                message = 'Payment successful';
                break;
            case 'requires_capture':
                dbStatus = 'card_saved';
                paid = false;
                message = 'Card authorized - will be charged later';
                break;
            case 'processing':
                dbStatus = 'processing';
                paid = false;
                message = 'Payment is processing';
                break;
            case 'requires_payment_method':
                dbStatus = 'failed';
                paid = false;
                message = 'Payment failed - card was declined';
                break;
            case 'requires_action':
                dbStatus = 'requires_action';
                paid = false;
                message = 'Additional authentication required';
                break;
            case 'canceled':
                dbStatus = 'canceled';
                paid = false;
                message = 'Payment was canceled';
                break;
            default:
                dbStatus = paymentIntent.status;
                message = `Payment status: ${paymentIntent.status}`;
        }
        
        // Update database with latest status
        const backerModel = require('../db/models/backer');
        const backer = await backerModel.findByStripePaymentIntent(paymentIntentId);
        
        if (backer) {
            await backerModel.update(backer.identity_id, {
                pm_status: dbStatus,
                pm_paid: paid ? 1 : 0
            });
            console.log('✓ Updated backer payment status:', dbStatus);
        }
        
        res.json({
            success: true,
            status: paymentIntent.status,
            dbStatus,
            paid,
            message,
            amount: paymentIntent.amount / 100,
            currency: paymentIntent.currency
        });
        
    } catch (err) {
        console.error('Error verifying payment:', err.message);
        res.status(500).json({ 
            success: false, 
            error: err.message,
            status: 'error'
        });
    }
});

module.exports = router;
