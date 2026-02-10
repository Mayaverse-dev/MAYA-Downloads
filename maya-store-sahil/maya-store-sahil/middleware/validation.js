// Input validation middleware

function validateEmail(email) {
    if (!email || typeof email !== 'string') return false;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
}

function validatePin(pin) {
    return pin && /^[0-9]{4}$/.test(pin);
}

function validateOtp(otp) {
    return otp && /^[0-9]{4}$/.test(otp);
}

function validateAmount(amount) {
    const num = parseFloat(amount);
    return !isNaN(num) && num > 0;
}

function sanitizeCompedItems(items) {
    if (!Array.isArray(items)) return [];
    
    return items.map(item => ({
        id: item.id || null,
        name: String(item.name || '').slice(0, 200),
        quantity: Math.max(0, parseInt(item.quantity || 0, 10)),
        price: 0,
        weight: 0,
        excludeFromShipping: true,
        note: item.note ? String(item.note).slice(0, 500) : undefined
    })).filter(i => i.quantity > 0 && i.name);
}

module.exports = {
    validateEmail,
    validatePin,
    validateOtp,
    validateAmount,
    sanitizeCompedItems
};
