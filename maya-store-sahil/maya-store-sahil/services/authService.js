const crypto = require('crypto');
const bcrypt = require('bcrypt');
const userModel = require('../db/models/user');
const rulesModel = require('../db/models/rules');

// Cache for auth rules (loaded once per request)
let authRulesCache = null;

/**
 * Get auth rules from database
 * @returns {Promise<Object>} Auth rules object
 */
async function getAuthRules() {
    if (authRulesCache) {
        return authRulesCache;
    }
    
    const otpTtlMinutes = await rulesModel.get('auth', 'otp_ttl_minutes') || 15;
    const magicTtlDays = await rulesModel.get('auth', 'magic_link_ttl_days') || 7;
    const rateLimitMinutes = await rulesModel.get('auth', 'rate_limit_minutes') || 10;
    const maxFailedAttempts = await rulesModel.get('auth', 'max_failed_attempts') || 3;
    
    authRulesCache = {
        OTP_TTL_MS: otpTtlMinutes * 60 * 1000,
        MAGIC_TTL_MS: magicTtlDays * 24 * 60 * 60 * 1000,
        RATE_LIMIT_MS: rateLimitMinutes * 60 * 1000,
        MAX_FAILED_ATTEMPTS: maxFailedAttempts
    };
    
    return authRulesCache;
}

// In-memory rate limiting (would use Redis in production)
const rateLimitStore = new Map(); // email -> { attempts: number, lockedUntil: Date }

// Generate a 4-digit OTP code
function generateOtpCode() {
    return String(crypto.randomInt(0, 10000)).padStart(4, '0');
}

// Generate a magic link token
function generateMagicToken() {
    return crypto.randomUUID();
}

// Check rate limit for an email
function checkRateLimit(email) {
    const record = rateLimitStore.get(email.toLowerCase());
    if (!record) return { allowed: true };
    
    if (record.lockedUntil && Date.now() < record.lockedUntil) {
        const remainingMs = record.lockedUntil - Date.now();
        const remainingMin = Math.ceil(remainingMs / 60000);
        return { 
            allowed: false, 
            remainingMinutes: remainingMin,
            message: `Too many failed attempts. Try again in ${remainingMin} minute${remainingMin > 1 ? 's' : ''}.`
        };
    }
    
    // Lock expired, reset
    if (record.lockedUntil && Date.now() >= record.lockedUntil) {
        rateLimitStore.delete(email.toLowerCase());
    }
    
    return { allowed: true };
}

// Record failed attempt
async function recordFailedAttempt(email, type = 'otp') {
    const key = email.toLowerCase();
    const record = rateLimitStore.get(key) || { attempts: 0, lockedUntil: null };
    const rules = await getAuthRules();
    
    record.attempts++;
    console.log(`⚠️  Failed ${type} attempt ${record.attempts}/${rules.MAX_FAILED_ATTEMPTS} for ${email}`);
    
    if (record.attempts >= rules.MAX_FAILED_ATTEMPTS) {
        record.lockedUntil = Date.now() + rules.RATE_LIMIT_MS;
        const lockoutMinutes = rules.RATE_LIMIT_MS / (60 * 1000);
        console.log(`🔒 Account locked for ${lockoutMinutes} minutes: ${email}`);
    }
    
    rateLimitStore.set(key, record);
    return record.attempts >= rules.MAX_FAILED_ATTEMPTS;
}

// Clear failed attempts on successful login
function clearFailedAttempts(email) {
    rateLimitStore.delete(email.toLowerCase());
}

// Check if user needs OTP (only if no PIN set)
// PIN is lifetime - no stale login check
function needsOtp(user) {
    if (!user) return true;
    if (!user.pin_hash) return true;
    return false; // PIN is lifetime, no stale check
}

// Initiate auth flow - decide if PIN or OTP is needed
async function initiateAuth(email, forceOtp = false) {
    if (!email) {
        throw new Error('Email is required');
    }

    // Ensure user exists (create shadow user if needed)
    let user = await userModel.findByEmail(email);
    if (!user) {
        user = await userModel.ensureUserByEmail(email);
    }
    
    if (!user) {
        throw new Error('Could not create user');
    }

    // Determine if OTP is needed
    const requiresOtp = forceOtp || !user.pin_hash;

    if (requiresOtp) {
        const code = generateOtpCode();
        const rules = await getAuthRules();
        const expiresAt = new Date(Date.now() + rules.OTP_TTL_MS).toISOString();
        await userModel.setOtpCode(user.id, code, expiresAt);
        return { status: 'otp_sent', code, identityId: user.id };
    }

    return { status: 'pin_required', identityId: user.id };
}

// Verify OTP code
async function verifyOtp(email, otp) {
    if (!email || !otp) {
        throw new Error('Email and OTP are required');
    }

    // Check rate limit
    const rateCheck = checkRateLimit(email);
    if (!rateCheck.allowed) {
        throw new Error(rateCheck.message);
    }

    const user = await userModel.findByEmail(email);
    if (!user) {
        throw new Error('User not found');
    }

    if (!user.otp_code || !user.otp_expires_at) {
        throw new Error('No active code. Please request a new one.');
    }

    const expires = new Date(user.otp_expires_at).getTime();
    if (Date.now() > expires) {
        throw new Error('Code expired. Please request a new one.');
    }
    
    if (String(otp).trim() !== String(user.otp_code).trim()) {
        // Record failed attempt
        await recordFailedAttempt(email, 'otp');
        throw new Error('Invalid code');
    }

    // Clear rate limit and OTP on success
    clearFailedAttempts(email);
    await userModel.clearOtpCode(user.id);
    await userModel.updateLastLogin(user.id);

    // Ensure identity_id is set
    if (!user.identity_id) {
        user.identity_id = user.id;
    }

    return { user, requiresPin: !user.pin_hash };
}

// Login with PIN (PIN is lifetime - no stale login check)
async function loginWithPin(email, pin) {
    if (!email || !pin) {
        throw new Error('Email and PIN are required');
    }

    if (!/^[0-9]{4}$/.test(pin)) {
        throw new Error('PIN must be 4 digits');
    }

    // Check rate limit
    const rateCheck = checkRateLimit(email);
    if (!rateCheck.allowed) {
        throw new Error(rateCheck.message);
    }

    const user = await userModel.findByEmail(email);
    if (!user || !user.pin_hash) {
        throw new Error('PIN not set. Please verify with code.');
    }

    const match = await bcrypt.compare(pin, user.pin_hash);
    if (!match) {
        // Record failed attempt
        await recordFailedAttempt(email, 'pin');
        throw new Error('Invalid PIN');
    }

    // Clear rate limit on success
    clearFailedAttempts(email);
    
    await userModel.updateLastLogin(user.id);
    
    // Ensure identity_id is set
    if (!user.identity_id) {
        user.identity_id = user.id;
    }
    
    return { user };
}

// Set user PIN
async function setPin(identityId, pin) {
    if (!pin || !/^[0-9]{4}$/.test(pin)) {
        throw new Error('PIN must be 4 digits');
    }
    
    const hash = await bcrypt.hash(pin, 10);
    await userModel.setPinHash(identityId, hash);
}

// Create magic link token
async function createMagicLink(email) {
    const user = await userModel.findByEmail(email);
    if (!user) {
        throw new Error('User not found');
    }

    const token = generateMagicToken();
    const rules = await getAuthRules();
    const expiresAt = new Date(Date.now() + rules.MAGIC_TTL_MS).toISOString();
    await userModel.setMagicLinkToken(user.id, token, expiresAt);

    return { token, identityId: user.id };
}

// Verify magic link token
async function verifyMagicLink(token) {
    if (!token) {
        throw new Error('Missing token');
    }

    const user = await userModel.findByMagicLinkToken(token);
    if (!user) {
        throw new Error('Invalid or expired link');
    }

    const expires = new Date(user.magic_link_expires_at).getTime();
    if (Date.now() > expires) {
        throw new Error('Link expired');
    }

    // Update last login
    await userModel.updateLastLogin(user.id);

    // Ensure identity_id is set
    if (!user.identity_id) {
        user.identity_id = user.id;
    }

    return { user, requiresPin: !user.pin_hash };
}

module.exports = {
    generateOtpCode,
    generateMagicToken,
    checkRateLimit,
    clearFailedAttempts,
    needsOtp,
    initiateAuth,
    verifyOtp,
    loginWithPin,
    setPin,
    createMagicLink,
    verifyMagicLink
};
