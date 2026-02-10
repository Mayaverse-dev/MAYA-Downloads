/**
 * User Profile Service
 * 
 * Provides unified access to user profiles throughout the application.
 * Single source of truth for user type determination.
 */

const { createProfile, getProfileType } = require('../lib/profiles');
const backerModel = require('../db/models/backer');

// Simple in-memory cache for profiles (cleared on each request)
const profileCache = new Map();

/**
 * Get user profile by identity ID
 * 
 * @param {string|null} identityId - User's identity ID (UUID)
 * @returns {Promise<BaseProfile>} - User's profile instance
 */
async function getProfile(identityId) {
    // No identity = Guest
    if (!identityId) {
        return createProfile(null);
    }
    
    // Check cache
    if (profileCache.has(identityId)) {
        return profileCache.get(identityId);
    }
    
    // Fetch backer from database
    const backer = await backerModel.findByIdentityId(identityId);
    
    // Create profile
    const profile = createProfile(backer);
    
    // Cache for this request
    profileCache.set(identityId, profile);
    
    return profile;
}

/**
 * Get user profile by email
 * 
 * @param {string} email - User's email address
 * @returns {Promise<BaseProfile>} - User's profile instance
 */
async function getProfileByEmail(email) {
    if (!email) {
        return createProfile(null);
    }
    
    const backer = await backerModel.findByEmail(email.toLowerCase().trim());
    return createProfile(backer);
}

/**
 * Get user profile from session
 * 
 * @param {Object} session - Express session object
 * @returns {Promise<BaseProfile>} - User's profile instance
 */
async function getProfileFromSession(session) {
    const identityId = session?.identityId;
    return await getProfile(identityId);
}

/**
 * Get profile type without creating full instance
 * Useful for quick checks
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<string>} - Profile type string
 */
async function getProfileTypeById(identityId) {
    if (!identityId) return 'guest';
    
    const backer = await backerModel.findByIdentityId(identityId);
    return getProfileType(backer);
}

/**
 * Check if user should see backer prices
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<boolean>}
 */
async function shouldShowBackerPrices(identityId) {
    const profile = await getProfile(identityId);
    return await profile.useBackerPrices();
}

/**
 * Check if user's payments should be charged immediately
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<boolean>}
 */
async function shouldChargeImmediately(identityId) {
    const profile = await getProfile(identityId);
    return await profile.chargeImmediately();
}

/**
 * Get user's dashboard data
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<Object>} - Dashboard data
 */
async function getDashboardData(identityId) {
    const profile = await getProfile(identityId);
    return await profile.getDashboardData();
}

/**
 * Get user's dashboard alerts
 * 
 * @param {string|null} identityId - User's identity ID
 * @returns {Promise<Array>} - Array of alert objects
 */
async function getDashboardAlerts(identityId) {
    const profile = await getProfile(identityId);
    return await profile.getDashboardAlerts();
}

/**
 * Clear profile cache (call at end of request)
 */
function clearCache() {
    profileCache.clear();
}

/**
 * Middleware to attach profile to request
 * Use: app.use(userProfileService.middleware())
 */
function middleware() {
    return async (req, res, next) => {
        try {
            // Attach profile getter to request
            req.getProfile = async () => {
                return await getProfileFromSession(req.session);
            };
            
            // Clear cache at end of request
            res.on('finish', () => {
                clearCache();
            });
            
            next();
        } catch (err) {
            console.error('Profile middleware error:', err);
            next(err);
        }
    };
}

module.exports = {
    // Core functions
    getProfile,
    getProfileByEmail,
    getProfileFromSession,
    getProfileTypeById,
    
    // Convenience functions
    shouldShowBackerPrices,
    shouldChargeImmediately,
    getDashboardData,
    getDashboardAlerts,
    
    // Cache management
    clearCache,
    
    // Middleware
    middleware
};
