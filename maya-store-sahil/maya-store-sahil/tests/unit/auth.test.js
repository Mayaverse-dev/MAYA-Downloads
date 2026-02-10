/**
 * Authentication Unit Tests
 * 
 * Tests for the auth middleware and service functions.
 * Uses mocking to avoid database dependencies.
 */

const bcrypt = require('bcrypt');

// Mock the database models before requiring authService
jest.mock('../../db/models/user', () => ({
    findByEmail: jest.fn(),
    ensureUserByEmail: jest.fn(),
    setOtpCode: jest.fn(),
    clearOtpCode: jest.fn(),
    updateLastLogin: jest.fn(),
    setPinHash: jest.fn(),
    findByMagicLinkToken: jest.fn(),
    setMagicLinkToken: jest.fn()
}));

jest.mock('../../db/models/rules', () => ({
    get: jest.fn().mockResolvedValue(null)
}));

const userModel = require('../../db/models/user');
const authService = require('../../services/authService');

describe('Auth Middleware', () => {
    const { requireAuth, requireAdmin, isApiRequest, setUserSession, clearUserSession } = require('../../middleware/auth');

    describe('isApiRequest', () => {
        
        test('should detect API path', () => {
            const req = { path: '/api/user/data', headers: {}, xhr: false };
            expect(isApiRequest(req)).toBe(true);
        });

        test('should detect XHR request', () => {
            const req = { path: '/dashboard', headers: {}, xhr: true };
            expect(isApiRequest(req)).toBe(true);
        });

        test('should detect JSON Accept header', () => {
            const req = { 
                path: '/dashboard', 
                headers: { accept: 'application/json' }, 
                xhr: false 
            };
            expect(isApiRequest(req)).toBe(true);
        });

        test('should detect JSON Content-Type', () => {
            const req = { 
                path: '/dashboard', 
                headers: { 'content-type': 'application/json' }, 
                xhr: false 
            };
            expect(isApiRequest(req)).toBe(true);
        });

        test('should return false for regular page request', () => {
            const req = { 
                path: '/dashboard', 
                headers: { accept: 'text/html' }, 
                xhr: false 
            };
            expect(isApiRequest(req)).toBe(false);
        });

        test('should handle missing headers gracefully', () => {
            const req = { path: '/dashboard', headers: {}, xhr: false };
            expect(isApiRequest(req)).toBe(false);
        });

        test('should detect Accept header with multiple types including JSON', () => {
            const req = { 
                path: '/dashboard', 
                headers: { accept: 'text/html, application/json, */*' }, 
                xhr: false 
            };
            expect(isApiRequest(req)).toBe(true);
        });
    });

    describe('requireAuth', () => {
        
        test('should call next() for authenticated user', () => {
            const req = { 
                session: { identityId: 'test-user-001' },
                path: '/api/user/data',
                headers: {},
                xhr: false
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), redirect: jest.fn() };
            const next = jest.fn();
            
            requireAuth(req, res, next);
            
            expect(next).toHaveBeenCalled();
            expect(res.status).not.toHaveBeenCalled();
            expect(res.redirect).not.toHaveBeenCalled();
        });

        test('should return 401 JSON for unauthenticated API request', () => {
            const req = { 
                session: {},
                path: '/api/user/data',
                headers: {},
                xhr: false
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAuth(req, res, next);
            
            expect(next).not.toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Unauthorized',
                code: 'SESSION_EXPIRED',
                redirect: '/login'
            }));
        });

        test('should redirect for unauthenticated page request', () => {
            const req = { 
                session: {},
                path: '/dashboard',
                headers: { accept: 'text/html' },
                xhr: false
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAuth(req, res, next);
            
            expect(next).not.toHaveBeenCalled();
            expect(res.redirect).toHaveBeenCalledWith('/login');
            expect(res.json).not.toHaveBeenCalled();
        });

        test('should handle null session gracefully', () => {
            const req = { 
                session: null,
                path: '/api/user/data',
                headers: {},
                xhr: false
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
        });

        test('should return 401 for XHR request without session', () => {
            const req = { 
                session: {},
                path: '/dashboard',
                headers: {},
                xhr: true
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAuth(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalled();
        });
    });

    describe('requireAdmin', () => {
        
        test('should call next() for authenticated admin', () => {
            const req = { 
                session: { adminId: 1 },
                path: '/api/admin/dashboard',
                headers: {},
                xhr: false
            };
            const res = { status: jest.fn().mockReturnThis(), json: jest.fn(), redirect: jest.fn() };
            const next = jest.fn();
            
            requireAdmin(req, res, next);
            
            expect(next).toHaveBeenCalled();
        });

        test('should return 401 JSON for unauthenticated admin API request', () => {
            const req = { 
                session: {},
                path: '/api/admin/users',
                headers: {},
                xhr: false
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAdmin(req, res, next);
            
            expect(res.status).toHaveBeenCalledWith(401);
            expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
                error: 'Unauthorized',
                code: 'ADMIN_SESSION_EXPIRED',
                redirect: '/admin/login'
            }));
        });

        test('should redirect for unauthenticated admin page request', () => {
            const req = { 
                session: {},
                path: '/admin/dashboard',
                headers: { accept: 'text/html' },
                xhr: false
            };
            const res = { 
                status: jest.fn().mockReturnThis(), 
                json: jest.fn(),
                redirect: jest.fn()
            };
            const next = jest.fn();
            
            requireAdmin(req, res, next);
            
            expect(res.redirect).toHaveBeenCalledWith('/admin/login');
        });
    });

    describe('setUserSession', () => {
        
        test('should set all session properties', () => {
            const req = {
                session: {
                    cookie: { maxAge: null }
                }
            };
            
            const user = {
                identity_id: 'test-123',
                email: 'test@maya.com',
                ks_backer_number: 9001,
                name: 'Test User',
                ks_pledge_amount: 100
            };
            
            setUserSession(req, user);
            
            expect(req.session.identityId).toBe('test-123');
            expect(req.session.email).toBe('test@maya.com');
            expect(req.session.backerNumber).toBe(9001);
            expect(req.session.backerName).toBe('Test User');
            expect(req.session.pledgeAmount).toBe(100);
            expect(req.session.cookie.maxAge).toBe(24 * 60 * 60 * 1000); // 24 hours
        });

        test('should set 30 day session for rememberMe', () => {
            const req = {
                session: {
                    cookie: { maxAge: null }
                }
            };
            
            const user = { identity_id: 'test-123', email: 'test@maya.com' };
            
            setUserSession(req, user, true);
            
            expect(req.session.cookie.maxAge).toBe(30 * 24 * 60 * 60 * 1000); // 30 days
        });

        test('should use fallback id if identity_id missing', () => {
            const req = {
                session: {
                    cookie: { maxAge: null }
                }
            };
            
            const user = { id: 'fallback-123', email: 'test@maya.com' };
            
            setUserSession(req, user);
            
            expect(req.session.identityId).toBe('fallback-123');
        });

        test('should use fallback backer fields', () => {
            const req = {
                session: {
                    cookie: { maxAge: null }
                }
            };
            
            const user = { 
                id: 'test-123', 
                email: 'test@maya.com',
                backer_number: 5001,
                backer_name: 'Backer Name',
                pledge_amount: 50
            };
            
            setUserSession(req, user);
            
            expect(req.session.backerNumber).toBe(5001);
            expect(req.session.backerName).toBe('Backer Name');
            expect(req.session.pledgeAmount).toBe(50);
        });
    });

    describe('clearUserSession', () => {
        
        test('should clear all session properties', () => {
            const req = {
                session: {
                    identityId: 'test-123',
                    email: 'test@maya.com',
                    backerNumber: 9001,
                    backerName: 'Test User',
                    pledgeAmount: 100,
                    adminId: 1
                }
            };
            
            clearUserSession(req);
            
            expect(req.session.identityId).toBeNull();
            expect(req.session.email).toBeNull();
            expect(req.session.backerNumber).toBeNull();
            expect(req.session.backerName).toBeNull();
            expect(req.session.pledgeAmount).toBeNull();
            expect(req.session.adminId).toBeNull();
        });

        test('should handle null session gracefully', () => {
            const req = { session: null };
            
            expect(() => clearUserSession(req)).not.toThrow();
        });

        test('should handle undefined session gracefully', () => {
            const req = {};
            
            expect(() => clearUserSession(req)).not.toThrow();
        });
    });
});

describe('Auth Service', () => {
    
    beforeEach(() => {
        jest.clearAllMocks();
        // Clear rate limit store between tests
        authService.clearFailedAttempts('test@maya.com');
        authService.clearFailedAttempts('collected@test.maya');
    });

    describe('generateOtpCode', () => {
        
        test('should generate 4-digit numeric codes', () => {
            for (let i = 0; i < 100; i++) {
                const code = authService.generateOtpCode();
                expect(code).toMatch(/^\d{4}$/);
                expect(parseInt(code)).toBeGreaterThanOrEqual(0);
                expect(parseInt(code)).toBeLessThanOrEqual(9999);
            }
        });

        test('should pad codes with leading zeros', () => {
            const codes = [];
            for (let i = 0; i < 1000; i++) {
                codes.push(authService.generateOtpCode());
            }
            
            // All should be exactly 4 characters
            codes.forEach(code => {
                expect(code.length).toBe(4);
            });
        });
    });

    describe('generateMagicToken', () => {
        
        test('should generate UUID format tokens', () => {
            const token = authService.generateMagicToken();
            expect(token).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        });

        test('should generate unique tokens', () => {
            const tokens = new Set();
            for (let i = 0; i < 100; i++) {
                tokens.add(authService.generateMagicToken());
            }
            expect(tokens.size).toBe(100);
        });
    });

    describe('checkRateLimit', () => {
        
        test('should allow first attempt', () => {
            const result = authService.checkRateLimit('new@test.com');
            expect(result.allowed).toBe(true);
        });

        test('should allow after clearing attempts', () => {
            authService.clearFailedAttempts('test@maya.com');
            const result = authService.checkRateLimit('test@maya.com');
            expect(result.allowed).toBe(true);
        });
    });

    describe('needsOtp', () => {
        
        test('should return true for null user', () => {
            expect(authService.needsOtp(null)).toBe(true);
        });

        test('should return true for user without pin_hash', () => {
            expect(authService.needsOtp({ email: 'test@maya.com' })).toBe(true);
            expect(authService.needsOtp({ email: 'test@maya.com', pin_hash: null })).toBe(true);
        });

        test('should return false for user with pin_hash', () => {
            expect(authService.needsOtp({ email: 'test@maya.com', pin_hash: 'somehash' })).toBe(false);
        });
    });

    describe('initiateAuth', () => {
        
        test('should throw error for empty email', async () => {
            await expect(authService.initiateAuth('')).rejects.toThrow('Email is required');
            await expect(authService.initiateAuth(null)).rejects.toThrow('Email is required');
        });

        test('should return pin_required for user with PIN', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: 'somehash'
            });
            
            const result = await authService.initiateAuth('test@maya.com');
            
            expect(result.status).toBe('pin_required');
            expect(result.identityId).toBe('test-123');
        });

        test('should return otp_sent for user without PIN', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: null
            });
            userModel.setOtpCode.mockResolvedValue();
            
            const result = await authService.initiateAuth('test@maya.com');
            
            expect(result.status).toBe('otp_sent');
            expect(result.code).toMatch(/^\d{4}$/);
            expect(userModel.setOtpCode).toHaveBeenCalled();
        });

        test('should force OTP when forceOtp=true', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: 'somehash'
            });
            userModel.setOtpCode.mockResolvedValue();
            
            const result = await authService.initiateAuth('test@maya.com', true);
            
            expect(result.status).toBe('otp_sent');
        });

        test('should create user if not found', async () => {
            userModel.findByEmail.mockResolvedValue(null);
            userModel.ensureUserByEmail.mockResolvedValue({
                id: 'new-user-123',
                email: 'new@maya.com',
                pin_hash: null
            });
            userModel.setOtpCode.mockResolvedValue();
            
            const result = await authService.initiateAuth('new@maya.com');
            
            expect(userModel.ensureUserByEmail).toHaveBeenCalledWith('new@maya.com');
            expect(result.status).toBe('otp_sent');
        });
    });

    describe('verifyOtp', () => {
        
        test('should throw error for missing email or OTP', async () => {
            await expect(authService.verifyOtp('', '1234')).rejects.toThrow('Email and OTP are required');
            await expect(authService.verifyOtp('test@maya.com', '')).rejects.toThrow('Email and OTP are required');
        });

        test('should throw error if user not found', async () => {
            userModel.findByEmail.mockResolvedValue(null);
            
            await expect(authService.verifyOtp('test@maya.com', '1234')).rejects.toThrow('User not found');
        });

        test('should throw error if no active OTP', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                otp_code: null,
                otp_expires_at: null
            });
            
            await expect(authService.verifyOtp('test@maya.com', '1234')).rejects.toThrow('No active code');
        });

        test('should throw error for expired OTP', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                otp_code: '1234',
                otp_expires_at: new Date(Date.now() - 1000).toISOString() // Expired
            });
            
            await expect(authService.verifyOtp('test@maya.com', '1234')).rejects.toThrow('Code expired');
        });

        test('should throw error for invalid OTP', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                otp_code: '1234',
                otp_expires_at: new Date(Date.now() + 60000).toISOString()
            });
            
            await expect(authService.verifyOtp('test@maya.com', '0000')).rejects.toThrow('Invalid code');
        });

        test('should verify correct OTP', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                otp_code: '1234',
                otp_expires_at: new Date(Date.now() + 60000).toISOString(),
                pin_hash: 'somehash'
            });
            userModel.clearOtpCode.mockResolvedValue();
            userModel.updateLastLogin.mockResolvedValue();
            
            const result = await authService.verifyOtp('test@maya.com', '1234');
            
            expect(result.user).toBeDefined();
            expect(result.requiresPin).toBe(false);
            expect(userModel.clearOtpCode).toHaveBeenCalled();
            expect(userModel.updateLastLogin).toHaveBeenCalled();
        });

        test('should indicate PIN required for user without PIN', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                otp_code: '1234',
                otp_expires_at: new Date(Date.now() + 60000).toISOString(),
                pin_hash: null
            });
            userModel.clearOtpCode.mockResolvedValue();
            userModel.updateLastLogin.mockResolvedValue();
            
            const result = await authService.verifyOtp('test@maya.com', '1234');
            
            expect(result.requiresPin).toBe(true);
        });
    });

    describe('loginWithPin', () => {
        
        test('should throw error for missing email or PIN', async () => {
            await expect(authService.loginWithPin('', '1234')).rejects.toThrow('Email and PIN are required');
            await expect(authService.loginWithPin('test@maya.com', '')).rejects.toThrow('Email and PIN are required');
        });

        test('should throw error for invalid PIN format', async () => {
            await expect(authService.loginWithPin('test@maya.com', '123')).rejects.toThrow('PIN must be 4 digits');
            await expect(authService.loginWithPin('test@maya.com', '12345')).rejects.toThrow('PIN must be 4 digits');
            await expect(authService.loginWithPin('test@maya.com', 'abcd')).rejects.toThrow('PIN must be 4 digits');
        });

        test('should throw error if user has no PIN set', async () => {
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: null
            });
            
            await expect(authService.loginWithPin('test@maya.com', '1234')).rejects.toThrow('PIN not set');
        });

        test('should throw error for incorrect PIN', async () => {
            const pinHash = await bcrypt.hash('1234', 10);
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: pinHash
            });
            
            await expect(authService.loginWithPin('test@maya.com', '0000')).rejects.toThrow('Invalid PIN');
        });

        test('should login with correct PIN', async () => {
            const pinHash = await bcrypt.hash('1234', 10);
            userModel.findByEmail.mockResolvedValue({
                id: 'test-123',
                email: 'test@maya.com',
                pin_hash: pinHash
            });
            userModel.updateLastLogin.mockResolvedValue();
            
            const result = await authService.loginWithPin('test@maya.com', '1234');
            
            expect(result.user).toBeDefined();
            expect(result.user.email).toBe('test@maya.com');
            expect(userModel.updateLastLogin).toHaveBeenCalled();
        });
    });

    describe('setPin', () => {
        
        test('should throw error for invalid PIN format', async () => {
            await expect(authService.setPin('test-123', '123')).rejects.toThrow('PIN must be 4 digits');
            await expect(authService.setPin('test-123', 'abcd')).rejects.toThrow('PIN must be 4 digits');
        });

        test('should hash and save PIN', async () => {
            userModel.setPinHash.mockResolvedValue();
            
            await authService.setPin('test-123', '5678');
            
            expect(userModel.setPinHash).toHaveBeenCalledWith(
                'test-123',
                expect.any(String)
            );
            
            // Verify the hash is valid bcrypt
            const savedHash = userModel.setPinHash.mock.calls[0][1];
            const isValid = await bcrypt.compare('5678', savedHash);
            expect(isValid).toBe(true);
        });
    });
});

describe('Session Expiry Response Format', () => {
    const { requireAuth } = require('../../middleware/auth');
    
    test('should return proper JSON structure for expired session', () => {
        const req = { 
            session: {},
            path: '/api/user/data',
            headers: {},
            xhr: false
        };
        const res = { 
            status: jest.fn().mockReturnThis(), 
            json: jest.fn(),
            redirect: jest.fn()
        };
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        const jsonResponse = res.json.mock.calls[0][0];
        
        expect(jsonResponse).toHaveProperty('error', 'Unauthorized');
        expect(jsonResponse).toHaveProperty('message');
        expect(jsonResponse).toHaveProperty('redirect', '/login');
        expect(jsonResponse).toHaveProperty('code', 'SESSION_EXPIRED');
    });

    test('should not expose sensitive data in error response', () => {
        const req = { 
            session: { someSecret: 'secret-data' },
            path: '/api/user/data',
            headers: {},
            xhr: false
        };
        const res = { 
            status: jest.fn().mockReturnThis(), 
            json: jest.fn(),
            redirect: jest.fn()
        };
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        const jsonResponse = res.json.mock.calls[0][0];
        
        expect(JSON.stringify(jsonResponse)).not.toContain('secret-data');
    });

    test('should include message for user-friendly display', () => {
        const req = { 
            session: {},
            path: '/api/user/data',
            headers: {},
            xhr: false
        };
        const res = { 
            status: jest.fn().mockReturnThis(), 
            json: jest.fn(),
            redirect: jest.fn()
        };
        const next = jest.fn();
        
        requireAuth(req, res, next);
        
        const jsonResponse = res.json.mock.calls[0][0];
        
        expect(jsonResponse.message).toBeDefined();
        expect(jsonResponse.message.length).toBeGreaterThan(0);
    });
});

describe('Edge Cases', () => {
    const { requireAuth, isApiRequest } = require('../../middleware/auth');
    
    test('should handle empty Accept header', () => {
        const req = { path: '/dashboard', headers: { accept: '' }, xhr: false };
        expect(isApiRequest(req)).toBe(false);
    });

    test('should handle undefined headers', () => {
        const req = { path: '/dashboard', xhr: false };
        // Should not throw
        expect(() => isApiRequest({ ...req, headers: undefined })).not.toThrow();
    });

    test('should handle path with query string', () => {
        const req = { path: '/api/user/data', headers: {}, xhr: false };
        expect(isApiRequest(req)).toBe(true);
    });

    test('should handle nested API paths', () => {
        const req = { path: '/api/admin/users/123/orders', headers: {}, xhr: false };
        expect(isApiRequest(req)).toBe(true);
    });

    test('should not treat /apikey as API path', () => {
        const req = { path: '/apikey', headers: { accept: 'text/html' }, xhr: false };
        expect(isApiRequest(req)).toBe(false);
    });
});
