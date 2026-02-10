const express = require('express');
const router = express.Router();
const authService = require('../services/authService');
const emailService = require('../services/emailService');
const userModel = require('../db/models/user');
const { requireAuth, setUserSession } = require('../middleware/auth');
const { validateEmail, validatePin, validateOtp } = require('../middleware/validation');

// Start auth flow: decide PIN vs OTP
router.post('/initiate', async (req, res) => {
    try {
        const { email, forceOtp, rememberMe } = req.body;
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        // Store rememberMe in session for later use
        if (rememberMe !== undefined) {
            req.session.rememberMe = rememberMe;
        }

        const result = await authService.initiateAuth(email, forceOtp);
        
        // Send OTP email if needed
        if (result.status === 'otp_sent') {
            try {
                await emailService.sendOTP(email, result.code);
            } catch (emailErr) {
                console.error('Failed to send OTP email:', emailErr);
            }
            // Don't expose the code in response (for security)
            return res.json({ status: 'otp_sent' });
        }

        return res.json({ status: result.status });
    } catch (err) {
        console.error('Auth initiate error:', err);
        res.status(500).json({ error: err.message || 'Failed to start auth' });
    }
});

// Verify OTP
router.post('/verify-otp', async (req, res) => {
    try {
        const { email, otp, rememberMe } = req.body;
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        
        if (!validateOtp(otp)) {
            return res.status(400).json({ error: 'Valid OTP is required' });
        }

        const result = await authService.verifyOtp(email, otp);
        const shouldRemember = rememberMe !== undefined ? rememberMe : req.session.rememberMe || false;
        setUserSession(req, result.user, shouldRemember);

        if (result.requiresPin) {
            return res.json({ success: true, requiresPin: true });
        }

        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Verify OTP error:', err);
        res.status(400).json({ error: err.message || 'Failed to verify code' });
    }
});

// Login with PIN
router.post('/login-pin', async (req, res) => {
    try {
        const { email, pin, rememberMe } = req.body;
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        
        if (!validatePin(pin)) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }

        const result = await authService.loginWithPin(email, pin);
        
        // If login is stale, OTP was sent
        if (result.status === 'otp_required') {
            try {
                await emailService.sendOTP(email, result.code);
            } catch (emailErr) {
                console.error('Failed to send OTP email:', emailErr);
            }
            return res.json({ status: 'otp_sent', reason: result.reason });
        }

        // Successful PIN login
        const shouldRemember = rememberMe !== undefined ? rememberMe : req.session.rememberMe || false;
        setUserSession(req, result.user, shouldRemember);
        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('PIN login error:', err);
        res.status(401).json({ error: err.message || 'Failed to login' });
    }
});

// Set PIN (requires active session)
router.post('/set-pin', requireAuth, async (req, res) => {
    try {
        const { pin } = req.body;
        
        if (!validatePin(pin)) {
            return res.status(400).json({ error: 'PIN must be 4 digits' });
        }

        const identityId = req.session.identityId;
        await authService.setPin(identityId, pin);
        return res.json({ success: true, redirect: '/dashboard' });
    } catch (err) {
        console.error('Set PIN error:', err);
        res.status(500).json({ error: err.message || 'Failed to set PIN' });
    }
});

// Magic link handler
router.get('/magic', async (req, res) => {
    try {
        const { token } = req.query;
        
        const result = await authService.verifyMagicLink(token);
        setUserSession(req, result.user);

        if (result.requiresPin) {
            return res.redirect('/login?setPin=1');
        }
        
        return res.redirect('/dashboard');
    } catch (err) {
        console.error('Magic link error:', err);
        res.status(400).send(err.message || 'Failed to process link');
    }
});

// Forgot PIN - resend OTP to reset PIN
router.post('/forgot-pin', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!validateEmail(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }

        // Force OTP flow
        const result = await authService.initiateAuth(email, true);
        
        if (result.status === 'otp_sent') {
            try {
                await emailService.sendOTP(email, result.code);
            } catch (emailErr) {
                console.error('Failed to send OTP email:', emailErr);
            }
            return res.json({ status: 'otp_sent', message: 'Verification code sent. Use it to set a new PIN.' });
        }

        return res.json({ status: result.status });
    } catch (err) {
        console.error('Forgot PIN error:', err);
        res.status(500).json({ error: err.message || 'Failed to process request' });
    }
});

// Check if email belongs to an existing Kickstarter backer
router.post('/check-email', async (req, res) => {
    try {
        const { email } = req.body;
        
        if (!email) {
            return res.json({ isExistingBacker: false });
        }
        
        const backerModel = require('../db/models/backer');
        const backer = await backerModel.findByEmail(email.toLowerCase().trim());
        
        // Only flag as existing backer if they have a KS backer number (actual backers)
        const isExistingBacker = !!(backer && backer.ks_backer_number);
        
        res.json({ isExistingBacker });
    } catch (err) {
        console.error('Email check error:', err);
        res.json({ isExistingBacker: false });
    }
});

module.exports = router;
