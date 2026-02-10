/**
 * Auth Routes Integration Tests
 * 
 * Tests the full HTTP request/response cycle for auth endpoints.
 * Uses supertest to simulate HTTP requests.
 * 
 * NOTE: These tests require sqlite3 to be installed.
 * Run `npm install sqlite3` to enable these tests.
 */

// Check if sqlite3 is available before running tests
let sqliteAvailable = false;
try {
    require.resolve('sqlite3');
    sqliteAvailable = true;
} catch (e) {
    console.log('⚠️  Skipping auth integration tests - sqlite3 not installed');
}

// Only run tests if sqlite3 is available
if (sqliteAvailable) {
    const request = require('supertest');
    const express = require('express');
    const session = require('express-session');
    const bcrypt = require('bcrypt');
    const testDb = require('../testDb');

    // Mock the database layer BEFORE loading routes
    // This replaces the PostgreSQL db/index.js with our SQLite test database
    jest.mock('../../db/index.js', () => {
        const testDb = require('../testDb');
        return {
            query: (sql, params) => testDb.query(sql, params),
            queryOne: (sql, params) => testDb.queryOne(sql, params),
            execute: (sql, params) => testDb.execute(sql, params),
            getPool: () => null,
            connect: () => Promise.resolve('sqlite'),
            close: () => testDb.close(),
            getIsPostgres: () => false
        };
    });

    // Mock email service to prevent actual emails
    jest.mock('../../services/emailService', () => ({
        sendOTP: jest.fn().mockResolvedValue({ success: true }),
        sendMagicLink: jest.fn().mockResolvedValue({ success: true })
    }));

    describe('Auth Routes Integration Tests', () => {
        let app;
        let authRoutes;
        let authService;

        beforeAll(async () => {
            // Setup test database
            await testDb.initialize();
            await testDb.reset();
            
            // Create express app for testing
            app = express();
            app.use(express.json());
            app.use(session({
                secret: 'test-secret',
                resave: false,
                saveUninitialized: false,
                cookie: { maxAge: 24 * 60 * 60 * 1000 }
            }));
            
            // Load auth routes (after mocking db)
            authRoutes = require('../../routes/auth');
            authService = require('../../services/authService');
            app.use('/api/auth', authRoutes);
            
            // Add a test endpoint to check session
            app.get('/api/test/session', (req, res) => {
                res.json({
                    identityId: req.session.identityId || null,
                    email: req.session.email || null,
                    isLoggedIn: !!req.session.identityId
                });
            });
        });

        beforeEach(async () => {
            await testDb.reset();
            // Clear rate limits between tests
            authService.clearFailedAttempts('collected@test.maya');
            authService.clearFailedAttempts('guest@test.maya');
            authService.clearFailedAttempts('newuser@test.maya');
        });

        afterAll(async () => {
            await testDb.close();
        });

        describe('POST /api/auth/initiate', () => {
            
            test('should return pin_required for user with PIN', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({ email: 'collected@test.maya' })
                    .expect('Content-Type', /json/)
                    .expect(200);
                
                expect(res.body.status).toBe('pin_required');
            });

            test('should return otp_sent for user without PIN', async () => {
                await testDb.updateTestUser('collected@test.maya', { pin_hash: null });
                
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({ email: 'collected@test.maya' })
                    .expect(200);
                
                expect(res.body.status).toBe('otp_sent');
                // Should NOT expose the OTP code in response
                expect(res.body.code).toBeUndefined();
            });

            test('should return otp_sent when forceOtp is true', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({ email: 'collected@test.maya', forceOtp: true })
                    .expect(200);
                
                expect(res.body.status).toBe('otp_sent');
            });

            test('should create user for unknown email', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({ email: 'newuser@test.maya' })
                    .expect(200);
                
                expect(res.body.status).toBe('otp_sent');
                
                // Verify user was created
                const user = await testDb.getTestUser('newuser@test.maya');
                expect(user).toBeDefined();
            });

            test('should return 400 for invalid email', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({ email: 'not-an-email' })
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });

            test('should return 400 for missing email', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .send({})
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });
        });

        describe('POST /api/auth/login-pin', () => {
            
            test('should login with correct PIN', async () => {
                const agent = request.agent(app);
                
                const res = await agent
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '1234' })
                    .expect(200);
                
                expect(res.body.success).toBe(true);
                expect(res.body.redirect).toBe('/dashboard');
                
                // Verify session was set
                const sessionRes = await agent.get('/api/test/session').expect(200);
                expect(sessionRes.body.isLoggedIn).toBe(true);
                expect(sessionRes.body.email).toBe('collected@test.maya');
            });

            test('should reject incorrect PIN', async () => {
                const res = await request(app)
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '0000' })
                    .expect(401);
                
                expect(res.body.error).toContain('Invalid PIN');
            });

            test('should return 400 for invalid PIN format', async () => {
                const res = await request(app)
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '123' })
                    .expect(400);
                
                expect(res.body.error).toContain('4 digits');
            });

            test('should return 400 for missing email', async () => {
                const res = await request(app)
                    .post('/api/auth/login-pin')
                    .send({ pin: '1234' })
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });
        });

        describe('POST /api/auth/verify-otp', () => {
            let otpCode;
            
            beforeEach(async () => {
                // Generate OTP for test user
                await testDb.updateTestUser('collected@test.maya', { pin_hash: null });
                authService.clearFailedAttempts('collected@test.maya');
                
                const result = await authService.initiateAuth('collected@test.maya');
                otpCode = result.code;
            });

            test('should verify correct OTP', async () => {
                const agent = request.agent(app);
                
                const res = await agent
                    .post('/api/auth/verify-otp')
                    .send({ email: 'collected@test.maya', otp: otpCode })
                    .expect(200);
                
                expect(res.body.success).toBe(true);
                expect(res.body.requiresPin).toBe(true); // No PIN set
            });

            test('should reject invalid OTP', async () => {
                const res = await request(app)
                    .post('/api/auth/verify-otp')
                    .send({ email: 'collected@test.maya', otp: '0000' })
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });

            test('should return 400 for missing OTP', async () => {
                const res = await request(app)
                    .post('/api/auth/verify-otp')
                    .send({ email: 'collected@test.maya' })
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });
        });

        describe('POST /api/auth/set-pin', () => {
            
            test('should set PIN for authenticated user', async () => {
                const agent = request.agent(app);
                
                // First, login via OTP
                await testDb.updateTestUser('collected@test.maya', { pin_hash: null });
                authService.clearFailedAttempts('collected@test.maya');
                const initResult = await authService.initiateAuth('collected@test.maya');
                
                await agent
                    .post('/api/auth/verify-otp')
                    .send({ email: 'collected@test.maya', otp: initResult.code })
                    .expect(200);
                
                // Now set PIN
                const res = await agent
                    .post('/api/auth/set-pin')
                    .send({ pin: '5678' })
                    .expect(200);
                
                expect(res.body.success).toBe(true);
                expect(res.body.redirect).toBe('/dashboard');
                
                // Verify PIN works
                authService.clearFailedAttempts('collected@test.maya');
                const loginResult = await authService.loginWithPin('collected@test.maya', '5678');
                expect(loginResult.user).toBeDefined();
            });

            test('should reject set-pin without authentication', async () => {
                const res = await request(app)
                    .post('/api/auth/set-pin')
                    .send({ pin: '5678' })
                    .expect(401);
                
                expect(res.body.error).toBe('Unauthorized');
                expect(res.body.code).toBe('SESSION_EXPIRED');
            });

            test('should return 400 for invalid PIN format', async () => {
                const agent = request.agent(app);
                
                // Login first
                await testDb.updateTestUser('collected@test.maya', { pin_hash: null });
                authService.clearFailedAttempts('collected@test.maya');
                const initResult = await authService.initiateAuth('collected@test.maya');
                
                await agent
                    .post('/api/auth/verify-otp')
                    .send({ email: 'collected@test.maya', otp: initResult.code })
                    .expect(200);
                
                // Try to set invalid PIN
                const res = await agent
                    .post('/api/auth/set-pin')
                    .send({ pin: '123' })
                    .expect(400);
                
                expect(res.body.error).toContain('4 digits');
            });
        });

        describe('POST /api/auth/forgot-pin', () => {
            
            test('should send OTP for forgot PIN', async () => {
                authService.clearFailedAttempts('collected@test.maya');
                const res = await request(app)
                    .post('/api/auth/forgot-pin')
                    .send({ email: 'collected@test.maya' })
                    .expect(200);
                
                expect(res.body.status).toBe('otp_sent');
                expect(res.body.message).toContain('Verification code sent');
            });

            test('should return 400 for invalid email', async () => {
                const res = await request(app)
                    .post('/api/auth/forgot-pin')
                    .send({ email: 'invalid' })
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });
        });

        describe('POST /api/auth/check-email', () => {
            
            test('should return true for existing backer', async () => {
                const res = await request(app)
                    .post('/api/auth/check-email')
                    .send({ email: 'collected@test.maya' })
                    .expect(200);
                
                expect(res.body.isExistingBacker).toBe(true);
            });

            test('should return false for non-backer', async () => {
                const res = await request(app)
                    .post('/api/auth/check-email')
                    .send({ email: 'guest@test.maya' })
                    .expect(200);
                
                expect(res.body.isExistingBacker).toBe(false);
            });

            test('should return false for unknown email', async () => {
                const res = await request(app)
                    .post('/api/auth/check-email')
                    .send({ email: 'unknown@test.maya' })
                    .expect(200);
                
                expect(res.body.isExistingBacker).toBe(false);
            });
        });

        describe('Session Persistence', () => {
            
            test('should maintain session across requests', async () => {
                const agent = request.agent(app);
                
                // Login
                await agent
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '1234' })
                    .expect(200);
                
                // First session check
                const res1 = await agent.get('/api/test/session').expect(200);
                expect(res1.body.isLoggedIn).toBe(true);
                
                // Second session check
                const res2 = await agent.get('/api/test/session').expect(200);
                expect(res2.body.isLoggedIn).toBe(true);
                expect(res2.body.identityId).toBe(res1.body.identityId);
            });

            test('should not share session between different agents', async () => {
                const agent1 = request.agent(app);
                const agent2 = request.agent(app);
                
                // Login with agent1
                await agent1
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '1234' })
                    .expect(200);
                
                // Agent1 should be logged in
                const res1 = await agent1.get('/api/test/session').expect(200);
                expect(res1.body.isLoggedIn).toBe(true);
                
                // Agent2 should NOT be logged in
                const res2 = await agent2.get('/api/test/session').expect(200);
                expect(res2.body.isLoggedIn).toBe(false);
            });
        });

        describe('Rate Limiting', () => {
            
            test('should lock after multiple failed PIN attempts', async () => {
                authService.clearFailedAttempts('collected@test.maya');
                
                // 3 failed attempts
                for (let i = 0; i < 3; i++) {
                    await request(app)
                        .post('/api/auth/login-pin')
                        .send({ email: 'collected@test.maya', pin: '0000' })
                        .expect(401);
                }
                
                // 4th attempt should be rate limited
                const res = await request(app)
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '1234' }) // Even correct PIN
                    .expect(401);
                
                expect(res.body.error).toContain('Too many failed attempts');
            });
        });

        describe('Content-Type Handling', () => {
            
            test('should return JSON for API requests', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .set('Accept', 'application/json')
                    .send({ email: 'collected@test.maya' })
                    .expect('Content-Type', /json/);
                
                expect(res.body).toBeDefined();
            });

            test('should return JSON error for invalid requests', async () => {
                const res = await request(app)
                    .post('/api/auth/initiate')
                    .set('Accept', 'application/json')
                    .send({})
                    .expect('Content-Type', /json/)
                    .expect(400);
                
                expect(res.body.error).toBeDefined();
            });
        });

        describe('Complete Auth Flows', () => {
            
            test('new user registration flow', async () => {
                const agent = request.agent(app);
                const email = 'newuser@test.maya';
                authService.clearFailedAttempts(email);
                
                // Step 1: Initiate (creates user, sends OTP)
                const initRes = await agent
                    .post('/api/auth/initiate')
                    .send({ email })
                    .expect(200);
                
                expect(initRes.body.status).toBe('otp_sent');
                
                // Get OTP from database
                const user = await testDb.getTestUser(email);
                const otpCode = user.otp_code;
                
                // Step 2: Verify OTP
                const otpRes = await agent
                    .post('/api/auth/verify-otp')
                    .send({ email, otp: otpCode })
                    .expect(200);
                
                expect(otpRes.body.requiresPin).toBe(true);
                
                // Step 3: Set PIN
                const pinRes = await agent
                    .post('/api/auth/set-pin')
                    .send({ pin: '9999' })
                    .expect(200);
                
                expect(pinRes.body.redirect).toBe('/dashboard');
                
                // Step 4: Verify can login with new PIN
                authService.clearFailedAttempts(email);
                
                const loginRes = await request.agent(app)
                    .post('/api/auth/login-pin')
                    .send({ email, pin: '9999' })
                    .expect(200);
                
                expect(loginRes.body.success).toBe(true);
            });

            test('existing user PIN login flow', async () => {
                const agent = request.agent(app);
                
                // Step 1: Initiate
                const initRes = await agent
                    .post('/api/auth/initiate')
                    .send({ email: 'collected@test.maya' })
                    .expect(200);
                
                expect(initRes.body.status).toBe('pin_required');
                
                // Step 2: Login with PIN
                const loginRes = await agent
                    .post('/api/auth/login-pin')
                    .send({ email: 'collected@test.maya', pin: '1234' })
                    .expect(200);
                
                expect(loginRes.body.success).toBe(true);
                
                // Step 3: Verify session
                const sessionRes = await agent.get('/api/test/session').expect(200);
                expect(sessionRes.body.isLoggedIn).toBe(true);
            });

            test('forgot PIN flow', async () => {
                const agent = request.agent(app);
                const email = 'collected@test.maya';
                authService.clearFailedAttempts(email);
                
                // Step 1: Request forgot PIN
                const forgotRes = await agent
                    .post('/api/auth/forgot-pin')
                    .send({ email })
                    .expect(200);
                
                expect(forgotRes.body.status).toBe('otp_sent');
                
                // Get OTP from database
                const user = await testDb.getTestUser(email);
                const otpCode = user.otp_code;
                
                // Step 2: Verify OTP
                await agent
                    .post('/api/auth/verify-otp')
                    .send({ email, otp: otpCode })
                    .expect(200);
                
                // Step 3: Set new PIN
                const pinRes = await agent
                    .post('/api/auth/set-pin')
                    .send({ pin: '5555' })
                    .expect(200);
                
                expect(pinRes.body.success).toBe(true);
                
                // Step 4: Verify new PIN works
                authService.clearFailedAttempts(email);
                
                const loginRes = await request.agent(app)
                    .post('/api/auth/login-pin')
                    .send({ email, pin: '5555' })
                    .expect(200);
                
                expect(loginRes.body.success).toBe(true);
            });
        });
    });
} else {
    // Placeholder test when sqlite3 is not available
    describe('Auth Routes Integration Tests', () => {
        test.skip('skipped - sqlite3 not installed', () => {});
    });
}
