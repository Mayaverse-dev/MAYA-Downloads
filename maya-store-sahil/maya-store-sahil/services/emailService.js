const { Resend } = require('resend');

// Initialize Resend client (only if API key is provided)
let resend = null;
if (process.env.RESEND_API_KEY) {
    resend = new Resend(process.env.RESEND_API_KEY);
} else {
    console.warn('⚠️  RESEND_API_KEY not set. Email functionality will be disabled.');
}

const FROM_EMAIL = 'fulfillment@entermaya.com';
const FROM_NAME = 'MAYA Fulfillment';

// Helper function to format currency
function formatCurrency(amount) {
    return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: 'USD'
    }).format(amount);
}

// Helper function to format order items table
function formatOrderItemsTable(items) {
    if (!items || !Array.isArray(items) || items.length === 0) {
        return '<p>No items in this order.</p>';
    }

    let table = `
        <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
            <thead>
                <tr style="background-color: #2c2c2c; color: white;">
                    <th style="padding: 12px; text-align: left; border: 1px solid #444;">Item</th>
                    <th style="padding: 12px; text-align: center; border: 1px solid #444;">Quantity</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #444;">Price</th>
                    <th style="padding: 12px; text-align: right; border: 1px solid #444;">Total</th>
                </tr>
            </thead>
            <tbody>
    `;

    items.forEach((item, index) => {
        const bgColor = index % 2 === 0 ? '#1e1e1e' : '#2a2a2a';
        const price = parseFloat(item.price || 0);
        const quantity = parseInt(item.quantity || 1);
        const total = price * quantity;

        table += `
            <tr style="background-color: ${bgColor};">
                <td style="padding: 12px; border: 1px solid #444;">${item.name || 'Unknown Item'}</td>
                <td style="padding: 12px; text-align: center; border: 1px solid #444;">${quantity}</td>
                <td style="padding: 12px; text-align: right; border: 1px solid #444;">${formatCurrency(price)}</td>
                <td style="padding: 12px; text-align: right; border: 1px solid #444;">${formatCurrency(total)}</td>
            </tr>
        `;
    });

    table += `
            </tbody>
        </table>
    `;

    return table;
}

// Helper function to format shipping address
function formatShippingAddress(address) {
    if (!address) return '<p>No shipping address provided.</p>';

    return `
        <div style="background-color: #1e1e1e; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <p style="margin: 5px 0;"><strong>${address.fullName || address.name || ''}</strong></p>
            <p style="margin: 5px 0;">${address.addressLine1 || address.address1 || ''}</p>
            ${address.addressLine2 || address.address2 ? `<p style="margin: 5px 0;">${address.addressLine2 || address.address2}</p>` : ''}
            <p style="margin: 5px 0;">
                ${address.city || ''}, ${address.state || ''} ${address.postalCode || address.postal || ''}
            </p>
            <p style="margin: 5px 0;">${address.country || ''}</p>
            ${address.phone ? `<p style="margin: 5px 0;">Phone: ${address.phone}</p>` : ''}
        </div>
    `;
}

// Base email template wrapper
function getEmailTemplate(title, content) {
    return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: Arial, sans-serif; background-color: #0a0a0a; color: #ffffff; margin: 0; padding: 0;">
            <div style="max-width: 600px; margin: 0 auto; background-color: #1e1e1e;">
                <!-- Header -->
                <div style="background-color: #dc2626; padding: 30px; text-align: center;">
                    <h1 style="margin: 0; color: white; font-size: 28px;">MAYA</h1>
                    <p style="margin: 10px 0 0 0; color: rgba(255,255,255,0.9); font-size: 16px;">${title}</p>
                </div>
                
                <!-- Content -->
                <div style="padding: 40px 30px;">
                    ${content}
                </div>
                
                <!-- Footer -->
                <div style="background-color: #2c2c2c; padding: 20px; text-align: center; font-size: 12px; color: #999;">
                    <p style="margin: 0;">© 2025 MAYA. All rights reserved.</p>
                    <p style="margin: 10px 0 0 0;">This is an automated email. Please do not reply.</p>
                </div>
            </div>
        </body>
        </html>
    `;
}

/**
 * Send card saved confirmation email
 */
async function sendCardSavedConfirmation(order) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const shippingAddress = (typeof order.shipping_address === 'string' && order.shipping_address.trim() !== '')
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
        
        const cartItems = (typeof order.new_addons === 'string' && order.new_addons.trim() !== '')
            ? JSON.parse(order.new_addons) 
            : order.new_addons;

        const recipientEmail = shippingAddress?.email;
        if (!recipientEmail) {
            console.warn('⚠️  No email address found for order:', order.id);
            return { success: false, error: 'No recipient email' };
        }

        const orderTotal = parseFloat(order.total || 0);
        const shippingCost = parseFloat(order.shipping_cost || 0);
        const addonsSubtotal = parseFloat(order.addons_subtotal || 0);

        const content = `
            <p>Hello ${shippingAddress?.fullName || shippingAddress?.name || 'Valued Customer'},</p>
            
            <p>Thank you for your order!</p>
            
            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                <h2 style="margin-top: 0; color: #dc2626;">Order Summary</h2>
                <p style="margin: 5px 0;"><strong>Order ID:</strong> #${order.id}</p>
            </div>

            <h3 style="color: #c8b696; margin-top: 30px;">Order Items</h3>
            ${formatOrderItemsTable(cartItems)}

            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <table style="width: 100%;">
                    <tr>
                        <td style="padding: 8px 0; text-align: right;">Subtotal:</td>
                        <td style="padding: 8px 0; text-align: right; padding-left: 20px; font-weight: bold;">${formatCurrency(addonsSubtotal)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; text-align: right;">Shipping:</td>
                        <td style="padding: 8px 0; text-align: right; padding-left: 20px; font-weight: bold;">${formatCurrency(shippingCost)}</td>
                    </tr>
                    <tr style="border-top: 2px solid #444; font-size: 18px;">
                        <td style="padding: 12px 0; text-align: right; font-weight: bold;">Total:</td>
                        <td style="padding: 12px 0; text-align: right; padding-left: 20px; font-weight: bold; color: #dc2626;">${formatCurrency(orderTotal)}</td>
                    </tr>
                </table>
            </div>

            <h3 style="color: #c8b696; margin-top: 30px;">Shipping Address</h3>
            ${formatShippingAddress(shippingAddress)}

            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #059669;">
                <p style="margin: 0;"><strong>What happens next?</strong></p>
                <p style="margin: 10px 0 0 0;">Your order is confirmed and will be processed for fulfillment. You will receive shipping updates as your order progresses.</p>
            </div>

            <p style="margin-top: 30px;">If you have any questions or need to update your payment method, please contact us.</p>
            
            <p>Thank you for your support!</p>
            <p>The MAYA Team</p>
        `;

        const html = getEmailTemplate('Order Confirmation', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: recipientEmail,
            subject: `Order #${order.id} - Order Confirmation`,
            html: html
        });

        console.log('✓ Card saved confirmation email sent to:', recipientEmail);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending card saved confirmation email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send payment successful email
 */
async function sendPaymentSuccessful(order, paymentIntentId) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const shippingAddress = (typeof order.shipping_address === 'string' && order.shipping_address.trim() !== '')
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
        
        const cartItems = (typeof order.new_addons === 'string' && order.new_addons.trim() !== '')
            ? JSON.parse(order.new_addons) 
            : order.new_addons;

        const recipientEmail = shippingAddress?.email;
        if (!recipientEmail) {
            console.warn('⚠️  No email address found for order:', order.id);
            return { success: false, error: 'No recipient email' };
        }

        const orderTotal = parseFloat(order.total || 0);
        const shippingCost = parseFloat(order.shipping_cost || 0);
        const addonsSubtotal = parseFloat(order.addons_subtotal || 0);
        const transactionDate = new Date().toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'long', 
            day: 'numeric' 
        });

        const content = `
            <p>Hello ${shippingAddress?.fullName || shippingAddress?.name || 'Valued Customer'},</p>
            
            <p>Your payment has been successfully processed! Thank you for your order.</p>
            
            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #059669;">
                <h2 style="margin-top: 0; color: #059669;">Payment Receipt</h2>
                <p style="margin: 5px 0;"><strong>Order ID:</strong> #${order.id}</p>
                <p style="margin: 5px 0;"><strong>Transaction ID:</strong> ${paymentIntentId || 'N/A'}</p>
                <p style="margin: 5px 0;"><strong>Date:</strong> ${transactionDate}</p>
                <p style="margin: 5px 0;"><strong>Amount Charged:</strong> <span style="color: #059669; font-size: 20px; font-weight: bold;">${formatCurrency(orderTotal)}</span></p>
            </div>

            <h3 style="color: #c8b696; margin-top: 30px;">Order Items</h3>
            ${formatOrderItemsTable(cartItems)}

            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <table style="width: 100%;">
                    <tr>
                        <td style="padding: 8px 0; text-align: right;">Subtotal:</td>
                        <td style="padding: 8px 0; text-align: right; padding-left: 20px; font-weight: bold;">${formatCurrency(addonsSubtotal)}</td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 0; text-align: right;">Shipping:</td>
                        <td style="padding: 8px 0; text-align: right; padding-left: 20px; font-weight: bold;">${formatCurrency(shippingCost)}</td>
                    </tr>
                    <tr style="border-top: 2px solid #444; font-size: 18px;">
                        <td style="padding: 12px 0; text-align: right; font-weight: bold;">Total Paid:</td>
                        <td style="padding: 12px 0; text-align: right; padding-left: 20px; font-weight: bold; color: #059669;">${formatCurrency(orderTotal)}</td>
                    </tr>
                </table>
            </div>

            <h3 style="color: #c8b696; margin-top: 30px;">Shipping Address</h3>
            ${formatShippingAddress(shippingAddress)}

            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #059669;">
                <p style="margin: 0;"><strong>Next Steps</strong></p>
                <p style="margin: 10px 0 0 0;">Your order is confirmed and will be processed for fulfillment. You will receive shipping updates as your order progresses.</p>
            </div>

            <p style="margin-top: 30px;">If you have any questions about your order, please contact us.</p>
            
            <p>Thank you for your support!</p>
            <p>The MAYA Team</p>
        `;

        const html = getEmailTemplate('Payment Successful', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: recipientEmail,
            subject: `Order #${order.id} - Payment Confirmation`,
            html: html
        });

        console.log('✓ Payment successful email sent to:', recipientEmail);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending payment successful email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send payment failed email
 */
async function sendPaymentFailed(order, errorMessage, errorCode) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const shippingAddress = (typeof order.shipping_address === 'string' && order.shipping_address.trim() !== '')
            ? JSON.parse(order.shipping_address) 
            : order.shipping_address;
        
        const cartItems = (typeof order.new_addons === 'string' && order.new_addons.trim() !== '')
            ? JSON.parse(order.new_addons) 
            : order.new_addons;

        const recipientEmail = shippingAddress?.email;
        if (!recipientEmail) {
            console.warn('⚠️  No email address found for order:', order.id);
            return { success: false, error: 'No recipient email' };
        }

        const orderTotal = parseFloat(order.total || 0);
        const appUrl = process.env.APP_URL || 'https://store.entermaya.com';

        const content = `
            <p>Hello ${shippingAddress?.fullName || shippingAddress?.name || 'Valued Customer'},</p>
            
            <p>We were unable to process your payment for Order #${order.id}. Your card was not charged.</p>
            
            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0; border-left: 4px solid #dc2626;">
                <h2 style="margin-top: 0; color: #dc2626;">Payment Failed</h2>
                <p style="margin: 5px 0;"><strong>Order ID:</strong> #${order.id}</p>
                <p style="margin: 5px 0;"><strong>Amount:</strong> ${formatCurrency(orderTotal)}</p>
                <p style="margin: 5px 0;"><strong>Reason:</strong> ${errorMessage || 'Payment could not be processed'}</p>
                ${errorCode ? `<p style="margin: 5px 0;"><strong>Error Code:</strong> ${errorCode}</p>` : ''}
            </div>

            <h3 style="color: #c8b696; margin-top: 30px;">Order Details</h3>
            ${formatOrderItemsTable(cartItems)}

            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 30px 0; border-left: 4px solid #dc2626;">
                <p style="margin: 0;"><strong>What to do next:</strong></p>
                <ul style="margin: 10px 0; padding-left: 20px;">
                    <li>Check that your card has sufficient funds</li>
                    <li>Verify your card details are correct</li>
                    <li>Contact your bank if the issue persists</li>
                    <li>Update your payment method in the portal if needed</li>
                </ul>
                <p style="margin: 15px 0 0 0;">
                    <a href="${appUrl}" style="background-color: #dc2626; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin-top: 10px;">
                        Update Payment Method
                    </a>
                </p>
            </div>

            <p style="margin-top: 30px;">If you continue to experience issues, please contact our support team for assistance.</p>
            
            <p>Thank you for your patience!</p>
            <p>The MAYA Team</p>
        `;

        const html = getEmailTemplate('Payment Failed', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: recipientEmail,
            subject: `Order #${order.id} - Payment Failed`,
            html: html
        });

        console.log('✓ Payment failed email sent to:', recipientEmail);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending payment failed email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send admin bulk charge summary email
 */
async function sendAdminBulkChargeSummary(results) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    const adminEmail = process.env.ADMIN_EMAIL;
    if (!adminEmail) {
        console.warn('⚠️  Admin email not configured - skipping admin summary email');
        return { success: false, error: 'Admin email not configured' };
    }

    try {
        const totalCharged = results.charged.reduce((sum, order) => sum + (order.amount || 0), 0);
        const totalFailed = results.failed.reduce((sum, order) => sum + (order.amount || 0), 0);

        let failedTable = '';
        if (results.failed.length > 0) {
            failedTable = `
                <h3 style="color: #dc2626; margin-top: 30px;">Failed Charges</h3>
                <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
                    <thead>
                        <tr style="background-color: #2c2c2c; color: white;">
                            <th style="padding: 12px; text-align: left; border: 1px solid #444;">Order ID</th>
                            <th style="padding: 12px; text-align: right; border: 1px solid #444;">Amount</th>
                            <th style="padding: 12px; text-align: left; border: 1px solid #444;">Error</th>
                        </tr>
                    </thead>
                    <tbody>
            `;

            results.failed.forEach((fail, index) => {
                const bgColor = index % 2 === 0 ? '#1e1e1e' : '#2a2a2a';
                failedTable += `
                    <tr style="background-color: ${bgColor};">
                        <td style="padding: 12px; border: 1px solid #444;">#${fail.orderId}</td>
                        <td style="padding: 12px; text-align: right; border: 1px solid #444;">${formatCurrency(fail.amount || 0)}</td>
                        <td style="padding: 12px; border: 1px solid #444;">${fail.error || 'Unknown error'}</td>
                    </tr>
                `;
            });

            failedTable += `
                    </tbody>
                </table>
            `;
        }

        const content = `
            <p>Bulk charge operation completed.</p>
            
            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0;">
                <h2 style="margin-top: 0; color: #c8b696;">Summary</h2>
                <table style="width: 100%;">
                    <tr>
                        <td style="padding: 8px 0;"><strong>Total Orders:</strong></td>
                        <td style="padding: 8px 0; text-align: right;">${results.total}</td>
                    </tr>
                    <tr style="color: #059669;">
                        <td style="padding: 8px 0;"><strong>Successfully Charged:</strong></td>
                        <td style="padding: 8px 0; text-align: right;">${results.charged.length} (${formatCurrency(totalCharged)})</td>
                    </tr>
                    <tr style="color: #dc2626;">
                        <td style="padding: 8px 0;"><strong>Failed:</strong></td>
                        <td style="padding: 8px 0; text-align: right;">${results.failed.length} (${formatCurrency(totalFailed)})</td>
                    </tr>
                </table>
            </div>

            ${results.charged.length > 0 ? `
                <h3 style="color: #059669; margin-top: 30px;">Successfully Charged Orders</h3>
                <p>${results.charged.length} order(s) were successfully charged for a total of ${formatCurrency(totalCharged)}.</p>
            ` : ''}

            ${failedTable}

            <p style="margin-top: 30px; font-size: 14px; color: #999;">
                Operation completed at ${new Date().toLocaleString('en-US', { 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit'
                })}.
            </p>
        `;

        const html = getEmailTemplate('Bulk Charge Summary', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: adminEmail,
            subject: `Bulk Charge Summary - ${results.charged.length} Succeeded, ${results.failed.length} Failed`,
            html: html
        });

        console.log('✓ Admin bulk charge summary email sent to:', adminEmail);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending admin bulk charge summary email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send magic link email
 */
async function sendMagicLink(email, link) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const content = `
            <p>Hello,</p>
            
            <p>Click the button below to log in to your account and set up your PIN.</p>
            
            <div style="text-align: center; margin: 30px 0;">
                <a href="${link}" style="background-color: #dc2626; color: white; padding: 15px 30px; text-decoration: none; border-radius: 6px; font-weight: bold; font-size: 16px;">Login to MAYA</a>
            </div>
            
            <p style="color: #999; font-size: 14px;">Or copy and paste this link into your browser:</p>
            <p style="color: #999; font-size: 14px; word-break: break-all;">${link}</p>
            
            <p style="margin-top: 30px;">This link will expire in 48 hours. If you did not request this email, please ignore it.</p>
            
            <p>The MAYA Team</p>
        `;

        const html = getEmailTemplate('Login Link', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: email,
            subject: 'Login to MAYA',
            html: html
        });

        console.log('✓ Magic link email sent to:', email);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending magic link email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send OTP email
 */
async function sendOTP(email, code) {
    if (!resend) {
        console.warn('⚠️  Resend API key not configured - skipping email');
        return { success: false, error: 'Resend not configured' };
    }

    try {
        const content = `
            <p>Hello,</p>
            
            <p>Your verification code is:</p>
            
            <div style="background-color: #2c2c2c; padding: 20px; border-radius: 8px; margin: 20px 0; text-align: center;">
                <span style="font-size: 32px; font-weight: bold; letter-spacing: 5px; color: #ffffff;">${code}</span>
            </div>
            
            <p>This code will expire in 15 minutes.</p>
            
            <p>If you did not request this code, please ignore this email.</p>
            
            <p>The MAYA Team</p>
        `;

        const html = getEmailTemplate('Verification Code', content);

        const result = await resend.emails.send({
            from: `${FROM_NAME} <${FROM_EMAIL}>`,
            to: email,
            subject: `Your Verification Code: ${code}`,
            html: html
        });

        console.log('✓ OTP email sent to:', email);
        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending OTP email:', error.message);
        return { success: false, error: error.message };
    }
}

/**
 * Send custom email (admin)
 */
async function sendCustomEmail({ to, subject, html }) {
    try {
        const result = await resend.emails.send({
            from: FROM_EMAIL,
            to: [to],
            subject: subject,
            html: html
        });

        return { success: true, messageId: result.data?.id };
    } catch (error) {
        console.error('✗ Error sending custom email:', error.message);
        return { success: false, error: error.message };
    }
}

module.exports = {
    sendCardSavedConfirmation,
    sendPaymentSuccessful,
    sendPaymentFailed,
    sendAdminBulkChargeSummary,
    sendMagicLink,
    sendOTP,
    sendCustomEmail
};

