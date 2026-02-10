/**
 * Pledge Manager - Auth Client Middleware
 * 
 * Validates authentication tokens with MAYA Identity Service
 */

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';

/**
 * Validate token with Identity Service
 */
async function validateToken(token) {
    try {
        const response = await fetch(`${AUTH_SERVICE_URL}/auth/validate`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });
        
        const data = await response.json();
        return data.valid ? data.identity : null;
    } catch (err) {
        console.error('[Auth Client] Error validating token:', err.message);
        return null;
    }
}

/**
 * Require authentication middleware
 * Uses MAYA Identity Service for validation
 */
async function requireAuth(req, res, next) {
    try {
        // Get token from Authorization header or cookie
        let token = null;
        
        const authHeader = req.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.maya_token) {
            token = req.cookies.maya_token;
        }
        
        if (!token) {
            // Check session for identityId
            if (req.session && req.session.identityId) {
                const backerModel = require('../db/models/backer');
                const backer = await backerModel.findByIdentityId(req.session.identityId);
                
                if (backer) {
                    req.user = {
                        id: backer.identity_id,
                        email: backer.email
                    };
                    req.identity = {
                        id: backer.identity_id,
                        email: backer.email
                    };
                    return next();
                }
            }
            
            return res.status(401).json({ error: 'Authentication required' });
        }
        
        // Validate with Identity Service
        const identity = await validateToken(token);
        
        if (!identity) {
            return res.status(401).json({ error: 'Invalid or expired token' });
        }
        
        // Attach identity to request
        req.identity = identity;
        
        // For backward compatibility, also set req.user
        // In the future, all code should use req.identity instead
        req.user = {
            id: identity.id,
            email: identity.email
        };
        
        next();
    } catch (err) {
        console.error('[Auth Client] Error:', err.message);
        res.status(500).json({ error: 'Authentication failed' });
    }
}

/**
 * Optional auth - attaches identity if token is valid
 */
async function optionalAuth(req, res, next) {
    try {
        let token = null;
        
        const authHeader = req.get('Authorization');
        if (authHeader && authHeader.startsWith('Bearer ')) {
            token = authHeader.substring(7);
        } else if (req.cookies && req.cookies.maya_token) {
            token = req.cookies.maya_token;
        }
        
        if (token) {
            const identity = await validateToken(token);
            
            if (identity) {
                req.identity = identity;
                req.user = {
                    id: identity.id,
                    email: identity.email
                };
            }
        }
        
        // Check session for identityId
        if (!req.identity && req.session && req.session.identityId) {
            const backerModel = require('../db/models/backer');
            const backer = await backerModel.findByIdentityId(req.session.identityId);
            
            if (backer) {
                req.user = {
                    id: backer.identity_id,
                    email: backer.email
                };
                req.identity = {
                    id: backer.identity_id,
                    email: backer.email
                };
            }
        }
    } catch (err) {
        // Silently fail for optional auth
    }
    
    next();
}

/**
 * Get identity from Identity Service by ID
 */
async function getIdentityById(identityId) {
    try {
        // This would require an API key or internal service auth
        // For now, we'll rely on the token validation
        return null;
    } catch (err) {
        console.error('[Auth Client] Error getting identity:', err.message);
        return null;
    }
}

module.exports = {
    requireAuth,
    optionalAuth,
    validateToken,
    getIdentityById
};
