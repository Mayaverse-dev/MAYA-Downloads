// Authentication middleware

/**
 * Check if request expects JSON response (API request)
 * @param {Object} req - Express request object
 * @returns {boolean}
 */
function isApiRequest(req) {
    // Check if path starts with /api/
    if (req.path && req.path.startsWith('/api/')) {
        return true;
    }
    
    // Check XMLHttpRequest header (AJAX calls)
    if (req.xhr) {
        return true;
    }
    
    // Handle missing headers object
    const headers = req.headers || {};
    
    // Check Accept header for JSON
    const acceptHeader = headers.accept || '';
    if (acceptHeader.includes('application/json')) {
        return true;
    }
    
    // Check Content-Type for JSON (POST/PUT requests)
    const contentType = headers['content-type'] || '';
    if (contentType.includes('application/json')) {
        return true;
    }
    
    return false;
}

/**
 * Middleware to require user authentication
 * Returns JSON 401 for API requests, redirects for page requests
 */
function requireAuth(req, res, next) {
    if (req.session && req.session.identityId) {
        next();
    } else {
        if (isApiRequest(req)) {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'Session expired or not logged in',
                redirect: '/login',
                code: 'SESSION_EXPIRED'
            });
        }
        // HTML page requests get redirected
        res.redirect('/login');
    }
}

/**
 * Middleware to require admin authentication
 * Returns JSON 401 for API requests, redirects for page requests
 */
function requireAdmin(req, res, next) {
    if (req.session && req.session.adminId) {
        next();
    } else {
        if (isApiRequest(req)) {
            return res.status(401).json({ 
                error: 'Unauthorized', 
                message: 'Admin session expired or not logged in',
                redirect: '/admin/login',
                code: 'ADMIN_SESSION_EXPIRED'
            });
        }
        // HTML page requests get redirected
        res.redirect('/admin/login');
    }
}

/**
 * Optional auth middleware - populates user info if logged in, but doesn't block
 * Useful for routes that work for both guests and logged-in users
 */
function optionalAuth(req, res, next) {
    // Just pass through - session info is already available via req.session
    next();
}

/**
 * Helper to set session from user/backer object
 * @param {Object} req - Express request object
 * @param {Object} user - User/backer data object
 * @param {boolean} rememberMe - Whether to extend session duration
 */
function setUserSession(req, user, rememberMe = false) {
    if (!req.session) {
        throw new Error('Session not initialized');
    }
    
    // Use identity_id (required)
    req.session.identityId = user.identity_id || user.id;
    req.session.email = user.email;
    
    // Backer info (from backers table)
    req.session.backerNumber = user.ks_backer_number || user.backer_number;
    req.session.backerName = user.name || user.backer_name;
    req.session.pledgeAmount = user.ks_pledge_amount || user.pledge_amount;
    
    // Set cookie maxAge based on rememberMe
    if (rememberMe) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
    } else {
        req.session.cookie.maxAge = 24 * 60 * 60 * 1000; // 24 hours
    }
}

/**
 * Helper to clear user session (logout)
 * @param {Object} req - Express request object
 */
function clearUserSession(req) {
    if (req.session) {
        req.session.identityId = null;
        req.session.email = null;
        req.session.backerNumber = null;
        req.session.backerName = null;
        req.session.pledgeAmount = null;
        req.session.adminId = null;
    }
}

module.exports = {
    requireAuth,
    requireAdmin,
    optionalAuth,
    setUserSession,
    clearUserSession,
    isApiRequest
};
