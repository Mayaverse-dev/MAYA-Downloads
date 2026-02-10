const orderModel = require('../db/models/order');
const emailService = require('./emailService');
const paymentService = require('./paymentService');

// Create order
async function createOrder({ identityId, newAddons, pledgeItem, shippingAddress, shippingCost, addonsSubtotal, total, stripeCustomerId, stripePaymentIntentId, paymentStatus, paid }) {
    return await orderModel.create({
        userId: identityId, // orderModel.create expects userId parameter but it's actually identity_id
        newAddons,
        pledgeItem,
        shippingAddress,
        shippingCost,
        addonsSubtotal,
        total,
        stripeCustomerId,
        stripePaymentIntentId,
        paymentStatus,
        paid
    });
}

// Get order by ID
async function getOrderById(orderId) {
    const order = await orderModel.findById(orderId);
    if (!order) return null;
    
    // Parse JSON fields only if they are strings
    try {
        if (typeof order.new_addons === 'string') {
            order.new_addons = JSON.parse(order.new_addons);
        }
        if (typeof order.shipping_address === 'string') {
            order.shipping_address = JSON.parse(order.shipping_address);
        }
        if (typeof order.comped_items === 'string') {
            order.comped_items = JSON.parse(order.comped_items);
        } else if (!order.comped_items) {
            order.comped_items = [];
        }
    } catch (e) {
        console.error('Error parsing order JSON:', e);
    }
    
    return order;
}

// Get order by payment intent ID
async function getOrderByPaymentIntentId(paymentIntentId) {
    return await orderModel.findByPaymentIntentId(paymentIntentId);
}

// Update order payment method
async function updateOrderPaymentMethod(paymentIntentId, paymentMethodId, paymentStatus, paid) {
    await orderModel.updatePaymentMethod(paymentIntentId, paymentMethodId, paymentStatus, paid);
}

// Bulk charge all orders with saved cards
async function bulkChargeOrders() {
    console.log('\n=== BULK CHARGE ORDERS ===');
    
    const orders = await orderModel.findReadyToCharge();
    console.log(`Found ${orders.length} orders with saved cards ready to charge`);

    if (orders.length === 0) {
        return {
            success: true,
            message: 'No orders to charge',
            charged: 0,
            failed: 0,
            total: 0
        };
    }

    const results = {
        charged: [],
        failed: [],
        total: orders.length
    };

    console.log(`\nProcessing ${orders.length} orders...`);

    // Process each order
    for (let i = 0; i < orders.length; i++) {
        const order = orders[i];
        const paymentMethodId = order.stripe_payment_method_id || order.stripe_payment_method;
        
        console.log(`\n[${i + 1}/${orders.length}] Processing Order #${order.id || order.identity_id}`);
        console.log(`  - Amount: $${order.pm_total || order.total}`);
        console.log(`  - Customer: ${order.stripe_customer_id}`);
        console.log(`  - Payment Method: ${paymentMethodId}`);
        
        try {
            // Charge the saved card using off-session payment
            const chargeAmount = order.pm_total || order.total;
            console.log(`  - Charging $${chargeAmount}...`);
            
            const paymentIntent = await paymentService.chargeOffSession({
                amount: chargeAmount,
                customerId: order.stripe_customer_id,
                paymentMethodId: paymentMethodId,
                metadata: {
                    orderId: order.id.toString(),
                    orderType: 'bulk-charge-autodebit',
                    chargedAt: new Date().toISOString()
                }
            });

            console.log(`  ✓ Payment Intent created: ${paymentIntent.id}`);
            console.log(`  ✓ Status: ${paymentIntent.status}`);

            // Update order status
            await orderModel.updatePaymentStatus(order.id, 'charged', 1, paymentIntent.id);

            // Normalize shipping address if it's not a JSON string
            let shippingAddress = {};
            if (typeof order.shipping_address === 'string') {
                try {
                    shippingAddress = JSON.parse(order.shipping_address);
                } catch (e) {
                    console.warn(`Failed to parse shipping_address for order ${order.id}`);
                }
            } else if (order.shipping_address && typeof order.shipping_address === 'object') {
                shippingAddress = order.shipping_address;
            } else {
                // Use individual columns from backer record
                shippingAddress = {
                    name: order.ship_name,
                    address1: order.ship_address_1,
                    address2: order.ship_address_2,
                    city: order.ship_city,
                    state: order.ship_state,
                    postal: order.ship_postal,
                    country: order.ship_country,
                    phone: order.ship_phone,
                    email: order.email
                };
            }

            results.charged.push({
                orderId: order.id,
                email: shippingAddress.email,
                amount: order.total,
                paymentIntentId: paymentIntent.id
            });

            console.log(`  ✓ Order #${order.id} charged successfully`);

            // Send payment successful email
            try {
                const emailResult = await emailService.sendPaymentSuccessful(order, paymentIntent.id);
                await orderModel.logEmail({
                    orderId: order.id,
                    userId: order.identity_id, // Use identity_id
                    recipientEmail: shippingAddress.email,
                    emailType: 'payment_success',
                    subject: `Order #${order.id} - Payment Confirmation`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            } catch (emailError) {
                console.error(`  ⚠️  Failed to send payment success email for order ${order.id}:`, emailError.message);
            }

        } catch (error) {
            console.error(`  ✗ Failed to charge order ${order.id}`);
            console.error(`    - Error: ${error.message}`);
            
            // Mark as failed
            await orderModel.updatePaymentStatus(order.id, 'charge_failed', 0, null);

            // Normalize shipping address for error report
            let shippingAddress = {};
            if (typeof order.shipping_address === 'string') {
                try {
                    shippingAddress = JSON.parse(order.shipping_address);
                } catch (e) {}
            } else if (order.shipping_address && typeof order.shipping_address === 'object') {
                shippingAddress = order.shipping_address;
            } else {
                shippingAddress = {
                    email: order.email,
                    name: order.ship_name
                };
            }

            results.failed.push({
                orderId: order.id,
                email: shippingAddress.email,
                amount: order.total,
                error: error.message,
                errorCode: error.code
            });

            // Send payment failed email
            try {
                const emailResult = await emailService.sendPaymentFailed(order, error.message, error.code);
                await orderModel.logEmail({
                    orderId: order.id,
                    userId: order.identity_id, // Use identity_id
                    recipientEmail: shippingAddress.email,
                    emailType: 'payment_failed',
                    subject: `Order #${order.id} - Payment Failed`,
                    status: emailResult.success ? 'sent' : 'failed',
                    resendMessageId: emailResult.messageId || null,
                    errorMessage: emailResult.error || null
                });
            } catch (emailError) {
                console.error(`  ⚠️  Failed to send payment failed email for order ${order.id}:`, emailError.message);
            }
        }
    }

    // Summary
    console.log('\n=== BULK CHARGE SUMMARY ===');
    console.log(`Total orders: ${results.total}`);
    console.log(`✓ Successfully charged: ${results.charged.length}`);
    console.log(`✗ Failed: ${results.failed.length}`);
    
    if (results.charged.length > 0) {
        const totalCharged = results.charged.reduce((sum, order) => sum + order.amount, 0);
        console.log(`Total amount charged: $${totalCharged.toFixed(2)}`);
    }
    
    // Send admin summary email
    try {
        const emailResult = await emailService.sendAdminBulkChargeSummary(results);
        await orderModel.logEmail({
            orderId: null,
            userId: null,
            recipientEmail: process.env.ADMIN_EMAIL,
            emailType: 'admin_bulk_charge_summary',
            subject: `Bulk Charge Summary - ${results.charged.length} Succeeded, ${results.failed.length} Failed`,
            status: emailResult.success ? 'sent' : 'failed',
            resendMessageId: emailResult.messageId || null,
            errorMessage: emailResult.error || null
        });
    } catch (emailError) {
        console.error('⚠️  Failed to send admin bulk charge summary email:', emailError.message);
    }
    
    return {
        success: true,
        message: `Bulk charge completed: ${results.charged.length} succeeded, ${results.failed.length} failed`,
        charged: results.charged.length,
        failed: results.failed.length,
        total: results.total,
        totalAmountCharged: results.charged.reduce((sum, order) => sum + order.amount, 0),
        details: results
    };
}

// Charge a single order
async function chargeSingleOrder(orderId) {
    const order = await orderModel.findById(orderId);
    
    if (!order) {
        throw new Error('Order not found');
    }
    
    // Get payment method - field name varies between stripe_payment_method and stripe_payment_method_id
    const paymentMethodId = order.stripe_payment_method_id || order.stripe_payment_method;
    
    if (!order.stripe_customer_id || !paymentMethodId) {
        throw new Error('No saved payment method for this order');
    }
    
    if (order.payment_status === 'charged' || order.paid === 1) {
        throw new Error('Order already charged');
    }
    
    // Charge the saved card
    const paymentIntent = await paymentService.chargeOffSession({
        amount: order.total,
        customerId: order.stripe_customer_id,
        paymentMethodId: paymentMethodId,
        metadata: {
            orderId: orderId.toString(),
            orderType: 'pre-order-charged'
        }
    });
    
    // Update order status
    await orderModel.updatePaymentStatus(orderId, 'charged', 1, paymentIntent.id);
    
    // Send payment successful email
    try {
        const shippingAddress = typeof order.shipping_address === 'string' 
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
        const emailResult = await emailService.sendPaymentSuccessful(order, paymentIntent.id);
        await orderModel.logEmail({
            orderId: order.id,
            userId: order.identity_id || order.user_id, // Use identity_id
            recipientEmail: shippingAddress?.email,
            emailType: 'payment_success',
            subject: `Order #${order.id} - Payment Confirmation`,
            status: emailResult.success ? 'sent' : 'failed',
            resendMessageId: emailResult.messageId || null,
            errorMessage: emailResult.error || null
        });
    } catch (emailError) {
        console.error('⚠️  Failed to send payment success email:', emailError.message);
    }
    
    return {
        success: true,
        paymentIntentId: paymentIntent.id,
        message: `Successfully charged $${order.total.toFixed(2)}`
    };
}

module.exports = {
    createOrder,
    getOrderById,
    getOrderByPaymentIntentId,
    updateOrderPaymentMethod,
    bulkChargeOrders,
    chargeSingleOrder
};
