const { query, queryOne, execute } = require('../index');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const backerModel = require('./backer');

/**
 * User Model - Auth operations using backers table
 * This is now a compatibility layer that uses the backers table
 */

// Create or find a shadow user (for guests/non-backers)
async function ensureUserByEmail(email, name) {
    if (!email) return null;
    const normalized = email.trim().toLowerCase();
    
    // Use backer model's findOrCreate
    const backer = await backerModel.findOrCreateByEmail(normalized, { name });
    
    // Return in old format for compatibility
    return {
        id: backer.identity_id, // Map identity_id to id for compatibility
        email: backer.email,
        backer_name: backer.name,
        backer_number: backer.ks_backer_number,
        reward_title: null, // Will be looked up from pledge_id if needed
        pledge_amount: backer.ks_pledge_amount
    };
}

// Get user by ID (now identity_id)
async function findById(userId) {
    // userId is now identity_id (UUID)
    const backer = await backerModel.findByIdentityId(userId);
    if (!backer) return null;
    
    // Map to old format for compatibility
    return mapBackerToUser(backer);
}

// Get user by email
async function findByEmail(email) {
    const normalized = email.trim().toLowerCase();
    const backer = await backerModel.findByEmail(normalized);
    if (!backer) return null;
    
    return mapBackerToUser(backer);
}

// Map backer to user format (for backward compatibility)
function mapBackerToUser(backer) {
    return {
        id: backer.identity_id, // Map identity_id to id
        email: backer.email,
        backer_name: backer.name,
        backer_number: backer.ks_backer_number,
        backer_uid: backer.ks_backer_uid,
        reward_title: null, // Will be looked up from pledge_id if needed
        pledge_amount: backer.ks_pledge_amount,
        amount_paid: backer.ks_amount_paid,
        amount_due: backer.ks_amount_due,
        pledged_status: backer.ks_status,
        fulfillment_status: backer.fulfillment_status,
        // Auth fields
        pin_hash: backer.pin_hash,
        otp_code: backer.otp_code,
        otp_expires_at: backer.otp_expires_at,
        last_login_at: backer.last_login_at
    };
}

// Update user's last login timestamp
async function updateLastLogin(userId) {
    await backerModel.update(userId, { last_login_at: new Date().toISOString() });
}

// Set user's PIN
async function setPinHash(userId, pinHash) {
    await backerModel.update(userId, { 
        pin_hash: pinHash, 
        last_login_at: new Date().toISOString() 
    });
}

// Set OTP code and expiration
async function setOtpCode(userId, otpCode, expiresAt) {
    await backerModel.update(userId, { 
        otp_code: otpCode, 
        otp_expires_at: expiresAt 
    });
}

// Clear OTP code
async function clearOtpCode(userId) {
    await backerModel.update(userId, { 
        otp_code: null, 
        otp_expires_at: null 
    });
}

// Set magic link token and expiration (stored in backers table)
async function setMagicLinkToken(userId, token, expiresAt) {
    // Store in a JSON field or use otp_code/otp_expires_at for magic links
    // For now, reuse OTP fields
    await backerModel.update(userId, { 
        otp_code: token, 
        otp_expires_at: expiresAt 
    });
}

// Find user by magic link token
async function findByMagicLinkToken(token) {
    // Reuse OTP fields for magic link tokens
    return await queryOne(
        'SELECT * FROM backers WHERE otp_code = $1 AND otp_expires_at IS NOT NULL AND otp_expires_at > datetime(\'now\')', 
        [token]
    ).then(backer => backer ? mapBackerToUser(backer) : null);
}

// Mark user as completed (no longer needed, but kept for compatibility)
async function markAsCompleted(userId) {
    // This field doesn't exist in new schema, skip
    return;
}

// Get all users (for admin) - now returns backers
async function findAll() {
    const backers = await backerModel.findAll(1000, 0);
    return backers.map(mapBackerToUser);
}

// Find user by backer number
async function findByBackerNumber(backerNumber) {
    const backer = await queryOne('SELECT * FROM backers WHERE ks_backer_number = $1', [backerNumber]);
    if (!backer) return null;
    return mapBackerToUser(backer);
}

// Create a new user (for admin/manual creation)
async function create({ email, password, backerNumber, backerName, rewardTitle, pledgeAmount }) {
    const normalized = email.trim().toLowerCase();
    const hash = await bcrypt.hash(password, 10);
    
    // Create backer with password hash stored in pin_hash (for compatibility)
    const { randomUUID } = require('crypto');
    const identityId = randomUUID();
    
    await execute(
        `INSERT INTO backers (identity_id, email, name, ks_backer_number, ks_pledge_amount, pin_hash, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, CURRENT_TIMESTAMP)`,
        [identityId, normalized, backerName || null, backerNumber || null, pledgeAmount || null, hash]
    );
    
    return await findByEmail(normalized);
}

module.exports = {
    ensureUserByEmail,
    findById,
    findByEmail,
    findByBackerNumber,
    updateLastLogin,
    setPinHash,
    setOtpCode,
    clearOtpCode,
    setMagicLinkToken,
    findByMagicLinkToken,
    markAsCompleted,
    findAll,
    create
};
