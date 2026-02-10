const productModel = require('../db/models/product');
const { cart: cartRules } = require('../lib/rules');

// Initialize Stripe (will be passed in)
let stripeClient = null;

function initStripe(stripe) {
    stripeClient = stripe;
}

// Validate cart prices server-side (security critical!)
async function validateCartPrices(cartItems, isLoggedIn) {
    let serverTotal = 0;
    const validatedItems = [];
    
    // Validate cart items
    if (!Array.isArray(cartItems) || cartItems.length === 0) {
        throw new Error('Cart is empty');
    }
    
    for (const item of cartItems) {
        // Validate quantity limits
        const quantity = parseInt(item.quantity) || 1;
        if (quantity < 1) {
            throw new Error(`Invalid quantity for ${item.name}`);
        }
        // Get limit from rules
        const limits = await cartRules.getCartLimits();
        if (quantity > limits.MAX_QUANTITY_PER_ITEM) {
            throw new Error(`Maximum quantity per item is ${limits.MAX_QUANTITY_PER_ITEM}. ${item.name} has ${quantity}.`);
        }
        
        // Special handling for pledge upgrades - use the difference price from cart
        if (item.isPledgeUpgrade) {
            const pledgeUpgradePrice = parseFloat(item.price) || 0;
            const itemTotal = pledgeUpgradePrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: pledgeUpgradePrice,
                quantity: quantity,
                subtotal: itemTotal,
                isPledgeUpgrade: true
            });
            continue; // Skip database lookup for pledge upgrades
        }
        
        // Special handling for original pledges (dropped backers) - use price from cart
        if (item.isOriginalPledge || item.isDroppedBackerPledge) {
            const pledgePrice = parseFloat(item.price) || 0;
            const itemTotal = pledgePrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: pledgePrice,
                quantity: quantity,
                subtotal: itemTotal,
                isOriginalPledge: item.isOriginalPledge || false,
                isDroppedBackerPledge: item.isDroppedBackerPledge || false
            });
            continue;
        }
        
        // Special handling for original Kickstarter addons (dropped backers)
        if (item.isOriginalAddon) {
            const addonPrice = parseFloat(item.price) || 0;
            const itemTotal = addonPrice * quantity;
            serverTotal += itemTotal;
            
            validatedItems.push({
                id: item.id,
                name: item.name,
                price: addonPrice,
                quantity: quantity,
                subtotal: itemTotal,
                isOriginalAddon: true
            });
            continue;
        }
        
        // Fetch actual price from database
        let dbItem = null;
        
        // Try products table first (pledges)
        dbItem = await productModel.findProductById(item.id);
        
        // If not found, try addons table
        if (!dbItem) {
            dbItem = await productModel.findAddonById(item.id);
        }
        
        if (!dbItem) {
            throw new Error(`Item ${item.name} not found in database`);
        }
        
        // Determine correct price based on login status
        let correctPrice = dbItem.price;
        if (isLoggedIn && dbItem.backer_price !== null && dbItem.backer_price !== undefined) {
            correctPrice = dbItem.backer_price;
        }
        
        // Calculate item total (quantity already validated above)
        const itemTotal = correctPrice * quantity;
        serverTotal += itemTotal;
        
        validatedItems.push({
            id: dbItem.id,
            name: dbItem.name,
            price: correctPrice,
            quantity: quantity,
            subtotal: itemTotal
        });
    }
    
    return { serverTotal, validatedItems };
}

// Create Stripe customer
async function createCustomer(email, name, metadata) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    
    return await stripeClient.customers.create({
        email,
        name,
        metadata
    });
}

// Create payment intent with idempotency key support
async function createPaymentIntent({ amount, currency = 'usd', customerId, captureMethod = 'manual', metadata, idempotencyKey }) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    
    const amountInCents = Math.round(amount * 100);
    
    const paymentIntentParams = {
        amount: amountInCents,
        currency,
        customer: customerId,
        setup_future_usage: 'off_session',
        confirmation_method: 'automatic',
        capture_method: captureMethod,
        payment_method_types: ['card'],
        metadata
    };
    
    // Only add options if idempotencyKey is provided
    if (idempotencyKey) {
        return await stripeClient.paymentIntents.create(paymentIntentParams, { idempotencyKey });
    } else {
        return await stripeClient.paymentIntents.create(paymentIntentParams);
    }
}

// Retrieve payment intent
async function retrievePaymentIntent(paymentIntentId) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    return await stripeClient.paymentIntents.retrieve(paymentIntentId);
}

// Cancel payment intent
async function cancelPaymentIntent(paymentIntentId) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    return await stripeClient.paymentIntents.cancel(paymentIntentId);
}

// Charge saved card (off-session) with enhanced logging
async function chargeOffSession({ amount, currency = 'usd', customerId, paymentMethodId, metadata, idempotencyKey }) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    
    const amountInCents = Math.round(amount * 100);
    
    const params = {
        amount: amountInCents,
        currency,
        customer: customerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true
    };
    
    // Only add metadata if it exists
    if (metadata) {
        params.metadata = metadata;
    }
    
    try {
        let paymentIntent;
        if (idempotencyKey) {
            paymentIntent = await stripeClient.paymentIntents.create(params, { idempotencyKey });
        } else {
            paymentIntent = await stripeClient.paymentIntents.create(params);
        }
        
        console.log(`✓ Off-session charge successful: ${paymentIntent.id}, status: ${paymentIntent.status}`);
        return paymentIntent;
    } catch (error) {
        // Enhanced logging for card declines
        console.error('❌ Off-session charge failed:');
        console.error(`  - Customer: ${customerId}`);
        console.error(`  - Payment Method: ${paymentMethodId}`);
        console.error(`  - Amount: $${amount}`);
        console.error(`  - Error Type: ${error.type}`);
        console.error(`  - Error Code: ${error.code}`);
        console.error(`  - Decline Code: ${error.decline_code || 'N/A'}`);
        console.error(`  - Message: ${error.message}`);
        
        // Re-throw with enhanced details
        error.chargeDetails = {
            customerId,
            paymentMethodId,
            amount,
            declineCode: error.decline_code,
            errorCode: error.code
        };
        throw error;
    }
}

// Construct webhook event from request
function constructWebhookEvent(payload, signature, webhookSecret) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    return stripeClient.webhooks.constructEvent(payload, signature, webhookSecret);
}

// Get Stripe client (for direct API calls)
function getStripeClient() {
    return stripeClient;
}

// Retrieve payment method details (card info)
async function retrievePaymentMethod(paymentMethodId) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    return await stripeClient.paymentMethods.retrieve(paymentMethodId);
}

// Get card details from payment method
async function getCardDetails(paymentMethodId) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    if (!paymentMethodId) return null;
    
    try {
        const pm = await stripeClient.paymentMethods.retrieve(paymentMethodId);
        if (pm.card) {
            return {
                brand: pm.card.brand,
                last4: pm.card.last4,
                expMonth: pm.card.exp_month,
                expYear: pm.card.exp_year,
                funding: pm.card.funding
            };
        }
        return null;
    } catch (err) {
        console.error('Error fetching card details:', err.message);
        return null;
    }
}

// List customer's payment methods
async function listCustomerPaymentMethods(customerId) {
    if (!stripeClient) throw new Error('Stripe not initialized');
    if (!customerId) return [];
    
    try {
        const paymentMethods = await stripeClient.paymentMethods.list({
            customer: customerId,
            type: 'card'
        });
        return paymentMethods.data.map(pm => ({
            id: pm.id,
            brand: pm.card.brand,
            last4: pm.card.last4,
            expMonth: pm.card.exp_month,
            expYear: pm.card.exp_year
        }));
    } catch (err) {
        console.error('Error listing payment methods:', err.message);
        return [];
    }
}

module.exports = {
    initStripe,
    validateCartPrices,
    createCustomer,
    createPaymentIntent,
    retrievePaymentIntent,
    retrievePaymentMethod,
    getCardDetails,
    listCustomerPaymentMethods,
    cancelPaymentIntent,
    chargeOffSession,
    constructWebhookEvent,
    getStripeClient
};
