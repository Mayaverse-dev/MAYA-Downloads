// Load environment variables - prefer .env.local for local development
if (require('fs').existsSync('.env.local')) {
    require('dotenv').config({ path: '.env.local' });
} else {
    require('dotenv').config();
}

if (process.env.NEW_RELIC_LICENSE_KEY) {
    require('newrelic');
}

const express = require('express');
const session = require('express-session');
const pgSession = require('connect-pg-simple')(session);
const compression = require('compression');
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// Database
const db = require('./db/index');
const schema = require('./db/schema');

// Services
const paymentService = require('./services/paymentService');
const s3Service = require('./services/s3Service');

// Routes
const authRoutes = require('./routes/auth');
const userRoutes = require('./routes/user');
const productsRoutes = require('./routes/products');
const ordersRoutes = require('./routes/orders');
const paymentsRoutes = require('./routes/payments');
const adminRoutes = require('./routes/admin');
const guestRoutes = require('./routes/guest');

// Middleware
const { errorHandler } = require('./middleware/errorHandler');

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// MAINTENANCE MODE - Set to true to show maintenance page
// ============================================
const MAINTENANCE_MODE = process.env.MAINTENANCE_MODE === 'true';

// Initialize Stripe in payment service
paymentService.initStripe(stripe);

// Middleware
app.use(compression());

// Maintenance mode middleware - serves maintenance page for all non-static routes
if (MAINTENANCE_MODE) {
    app.use((req, res, next) => {
        // Allow static assets to load (for maintenance page styling)
        if (req.path.startsWith('/images/') || req.path.startsWith('/css/') || req.path.startsWith('/js/')) {
            return next();
        }
        // Serve maintenance page for all other routes
        return res.status(503).sendFile(path.join(__dirname, 'views', 'maintenance.html'));
    });
}

// Stripe webhook needs raw body - must be before express.json()
app.post('/api/stripe-webhook',
    express.raw({ type: 'application/json' }),
    async (req, res) => {
        const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

        if (!webhookSecret) {
            console.warn('⚠️  STRIPE_WEBHOOK_SECRET not configured - skipping webhook verification');
            return res.status(400).json({ error: 'Webhook secret not configured' });
        }

        const signature = req.headers['stripe-signature'];
        let event;

        try {
            event = paymentService.constructWebhookEvent(req.body, signature, webhookSecret);
        } catch (err) {
            console.error('❌ Webhook signature verification failed:', err.message);
            return res.status(400).json({ error: 'Webhook signature verification failed' });
        }

        console.log(`\n=== Stripe Webhook: ${event.type} ===`);

        const backerModel = require('./db/models/backer');
        const orderModel = require('./db/models/order');
        const emailService = require('./services/emailService');

        try {
            switch (event.type) {
                case 'payment_intent.succeeded':
                    const paymentIntent = event.data.object;
                    console.log('✓ Payment succeeded:', paymentIntent.id);
                    console.log('  Amount: $' + (paymentIntent.amount / 100).toFixed(2));
                    console.log('  Customer:', paymentIntent.customer);

                    // Update backer record
                    const backer = await require('./db/index').queryOne(
                        'SELECT identity_id, email FROM backers WHERE stripe_payment_intent = $1',
                        [paymentIntent.id]
                    );

                    if (backer) {
                        await backerModel.update(backer.identity_id, {
                            pm_paid: 1,
                            pm_status: 'paid',
                            stripe_payment_method: paymentIntent.payment_method
                        });
                        console.log('✓ Updated backer:', backer.identity_id);

                        // Send confirmation email
                        try {
                            const order = await orderModel.findById(backer.identity_id);
                            if (order) {
                                await emailService.sendPaymentSuccessful(order, paymentIntent.id);
                                await orderModel.logEmail({
                                    orderId: order.id,
                                    userId: backer.identity_id,
                                    recipientEmail: backer.email,
                                    emailType: 'payment_success',
                                    subject: 'Payment Confirmation',
                                    status: 'sent'
                                });
                            }
                        } catch (emailErr) {
                            console.error('⚠️  Failed to send payment success email:', emailErr.message);
                        }
                    }
                    break;

                case 'payment_intent.payment_failed':
                    const failedIntent = event.data.object;
                    const lastError = failedIntent.last_payment_error;

                    console.error('❌ Payment failed:', failedIntent.id);
                    console.error('  Decline code:', lastError?.decline_code || 'N/A');
                    console.error('  Error code:', lastError?.code || 'N/A');
                    console.error('  Message:', lastError?.message || 'Unknown error');

                    // Update backer record
                    const failedBacker = await require('./db/index').queryOne(
                        'SELECT identity_id, email FROM backers WHERE stripe_payment_intent = $1',
                        [failedIntent.id]
                    );

                    if (failedBacker) {
                        await backerModel.update(failedBacker.identity_id, {
                            pm_status: 'failed'
                        });

                        // Send failure notification
                        try {
                            const order = await orderModel.findById(failedBacker.identity_id);
                            if (order) {
                                await emailService.sendPaymentFailed(order, lastError?.message, lastError?.decline_code);
                                await orderModel.logEmail({
                                    orderId: order.id,
                                    userId: failedBacker.identity_id,
                                    recipientEmail: failedBacker.email,
                                    emailType: 'payment_failed',
                                    subject: 'Payment Failed',
                                    status: 'sent'
                                });
                            }
                        } catch (emailErr) {
                            console.error('⚠️  Failed to send payment failed email:', emailErr.message);
                        }
                    }
                    break;

                case 'charge.refunded':
                    const refund = event.data.object;
                    console.log('💰 Refund processed:', refund.id);
                    console.log('  Amount refunded: $' + (refund.amount_refunded / 100).toFixed(2));
                    break;

                case 'charge.dispute.created':
                    const dispute = event.data.object;
                    console.error('⚠️  DISPUTE CREATED:', dispute.id);
                    console.error('  Amount:', dispute.amount);
                    console.error('  Reason:', dispute.reason);
                    // TODO: Alert admin
                    break;

                default:
                    console.log('Unhandled event type:', event.type);
            }

            res.json({ received: true });
        } catch (err) {
            console.error('Error processing webhook:', err);
            res.status(500).json({ error: 'Webhook processing failed' });
        }
    }
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session store - PostgreSQL backed for persistence across deploys
const sessionStore = new pgSession({
    pool: db.getPool(),
    tableName: 'user_sessions',
    createTableIfMissing: true,
    pruneSessionInterval: 60 * 15 // Prune expired sessions every 15 min
});

app.use(session({
    store: sessionStore,
    secret: process.env.SESSION_SECRET || 'maya-secret-change-this',
    resave: false,
    saveUninitialized: false,
    cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
        secure: process.env.NODE_ENV === 'production',
        httpOnly: true,
        sameSite: 'lax'
    }
}));

// New Relic page view tracking
const { trackPageView } = require('./middleware/newrelicTracking');
app.use(trackPageView);

// Serve static files with caching
app.use(express.static('public', {
    maxAge: process.env.NODE_ENV === 'production' ? '7d' : '1h',
    etag: true,
    lastModified: true
}));

// Handle favicon requests to prevent 404 errors
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// ============================================
// S3 THUMBNAIL PROXY
// ============================================

// Debug endpoint to check S3 configuration
app.get('/api/debug/s3-status', (req, res) => {
    res.json({
        configured: s3Service.isConfigured(),
        endpoint: process.env.S3_ENDPOINT_URL ? 'SET' : 'MISSING',
        accessKey: process.env.S3_ACCESS_KEY_ID ? 'SET' : 'MISSING',
        secretKey: process.env.S3_SECRET_ACCESS_KEY ? 'SET' : 'MISSING',
        bucket: process.env.S3_BUCKET_NAME || 'MISSING',
        nodeEnv: process.env.NODE_ENV || 'not set'
    });
});

// Thumbnail proxy route - serves optimized images from S3
app.get('/api/assets/thumbnail', async (req, res) => {
    try {
        const key = req.query.key;
        console.log(`[Thumbnail] === REQUEST START ===`);
        console.log(`[Thumbnail] Key: ${key}`);
        console.log(`[Thumbnail] S3_ENDPOINT_URL: ${process.env.S3_ENDPOINT_URL ? 'SET' : 'NOT SET'}`);
        console.log(`[Thumbnail] S3_ACCESS_KEY_ID: ${process.env.S3_ACCESS_KEY_ID ? 'SET' : 'NOT SET'}`);
        console.log(`[Thumbnail] S3_SECRET_ACCESS_KEY: ${process.env.S3_SECRET_ACCESS_KEY ? 'SET' : 'NOT SET'}`);
        console.log(`[Thumbnail] S3_BUCKET_NAME: ${process.env.S3_BUCKET_NAME ? process.env.S3_BUCKET_NAME : 'NOT SET'}`);
        console.log(`[Thumbnail] isConfigured: ${s3Service.isConfigured()}`);

        if (!key) return res.status(400).send('Key is required');

        if (!s3Service.isConfigured()) {
            console.log(`[Thumbnail] FAILED - S3 not configured`);
            return res.status(503).json({
                error: 'S3 not configured',
                endpoint: process.env.S3_ENDPOINT_URL ? 'set' : 'missing',
                accessKey: process.env.S3_ACCESS_KEY_ID ? 'set' : 'missing',
                secretKey: process.env.S3_SECRET_ACCESS_KEY ? 'set' : 'missing',
                bucket: process.env.S3_BUCKET_NAME ? 'set' : 'missing'
            });
        }

        const thumbKey = `_thumbs/${key}.webp`;
        console.log(`[Thumbnail] Request for: ${key}`);

        try {
            // Try to fetch existing thumbnail from S3
            const thumbStream = await s3Service.getAsset(thumbKey);
            console.log(`[Thumbnail] Serving cached: ${thumbKey}`);
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            thumbStream.pipe(res);
        } catch (e) {
            // Thumbnail doesn't exist, generate it on the fly
            console.log(`[Thumbnail] Not in cache, generating: ${key}`);
            try {
                const originalStream = await s3Service.getAsset(key);

                // Collect stream into buffer
                const chunks = [];
                for await (const chunk of originalStream) {
                    chunks.push(chunk);
                }
                const originalBuffer = Buffer.concat(chunks);
                console.log(`[Thumbnail] Original fetched, size: ${originalBuffer.length} bytes`);

                if (originalBuffer.length === 0) {
                    throw new Error('Fetched original is empty');
                }

                const thumbBuffer = await s3Service.generateThumbnail(originalBuffer);
                console.log(`[Thumbnail] Generation successful, size: ${thumbBuffer.length} bytes`);

                // Upload generated thumb to S3 for next time
                try {
                    await s3Service.uploadAsset(thumbBuffer, thumbKey, 'image/webp');
                    console.log(`[Thumbnail] Cached successfully: ${thumbKey}`);
                } catch (uploadErr) {
                    console.warn(`[Thumbnail] Failed to cache: ${uploadErr.message}`);
                }

                res.setHeader('Content-Type', 'image/webp');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                res.send(thumbBuffer);
            } catch (origErr) {
                console.error(`[Thumbnail] Failed to fetch original: ${origErr.message}`);
                res.status(404).send('Image not found');
            }
        }
    } catch (err) {
        console.error('[Thumbnail] Error:', err);
        res.status(500).send('Thumbnail generation failed');
    }
});

// Preview route - serves medium-sized images (1200px) for modal viewing
app.get('/api/assets/preview', async (req, res) => {
    try {
        const key = req.query.key;
        if (!key) return res.status(400).send('Key is required');

        if (!s3Service.isConfigured()) {
            return res.status(503).send('S3 not configured');
        }

        const previewKey = `_previews/${key}.webp`;

        try {
            // Try to fetch existing preview from S3
            const previewStream = await s3Service.getAsset(previewKey);
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Cache-Control', 'public, max-age=31536000');
            previewStream.pipe(res);
        } catch (e) {
            // Preview doesn't exist, generate it
            try {
                const originalStream = await s3Service.getAsset(key);
                const chunks = [];
                for await (const chunk of originalStream) {
                    chunks.push(chunk);
                }
                const originalBuffer = Buffer.concat(chunks);

                if (originalBuffer.length === 0) {
                    throw new Error('Original is empty');
                }

                // Generate 1200px preview (larger than thumbnail, smaller than original)
                const sharp = require('sharp');
                const previewBuffer = await sharp(originalBuffer)
                    .resize(1200, null, { withoutEnlargement: true })
                    .webp({ quality: 85 })
                    .toBuffer();

                // Cache the preview in S3
                try {
                    await s3Service.uploadAsset(previewBuffer, previewKey, 'image/webp');
                } catch (uploadErr) {
                    console.warn('[Preview] Failed to cache:', uploadErr.message);
                }

                res.setHeader('Content-Type', 'image/webp');
                res.setHeader('Cache-Control', 'public, max-age=31536000');
                res.send(previewBuffer);
            } catch (origErr) {
                console.error('[Preview] Failed:', origErr.message);
                res.status(404).send('Image not found');
            }
        }
    } catch (err) {
        console.error('[Preview] Error:', err);
        res.status(500).send('Preview generation failed');
    }
});

// Download asset - proxies file from S3 (handles private bucket auth)
app.get('/api/assets/download', async (req, res) => {
    try {
        const key = req.query.key;
        if (!key) return res.status(400).send('Key is required');

        if (!s3Service.isConfigured()) {
            return res.status(503).send('S3 not configured');
        }

        console.log(`[Download] Fetching: ${key}`);
        const stream = await s3Service.getAsset(key);

        // Determine content type
        const ext = key.split('.').pop().toLowerCase();
        const contentTypes = {
            'pdf': 'application/pdf',
            'epub': 'application/epub+zip',
            'png': 'image/png',
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'webp': 'image/webp',
            'gif': 'image/gif',
            'stl': 'model/stl',
            'obj': 'model/obj',
            'fbx': 'application/octet-stream',
            'gltf': 'model/gltf+json',
            'glb': 'model/gltf-binary'
        };

        const filename = key.split('/').pop();
        res.setHeader('Content-Type', contentTypes[ext] || 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('Cache-Control', 'public, max-age=86400');

        stream.pipe(res);
    } catch (err) {
        console.error('[Download] Error:', err);
        res.status(404).send('File not found');
    }
});

// Get digital assets by category
app.get('/api/assets/:category', async (req, res) => {
    try {
        const category = req.params.category;

        // First try database
        const dbAssets = await db.query('SELECT * FROM assets WHERE category = $1', [category]);

        if (dbAssets && dbAssets.length > 0) {
            // Special handling for 3D category - group models with their images
            if (category === '3d') {
                // Filter for model files only
                const models = dbAssets.filter(a => {
                    const ext = a.s3_key.split('.').pop().toLowerCase();
                    return ['stl', 'obj', 'fbx', 'gltf', 'glb'].includes(ext);
                });

                const processedAssets = models.map(asset => {
                    let thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent(asset.s3_key)}`;

                    // Use metadata thumbKey if available
                    if (asset.metadata) {
                        try {
                            const meta = typeof asset.metadata === 'string' ? JSON.parse(asset.metadata) : asset.metadata;
                            if (meta.thumbKey) {
                                thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent(meta.thumbKey)}`;
                            }
                        } catch (e) { }
                    }

                    return {
                        id: asset.id,
                        name: asset.name,
                        key: asset.s3_key,
                        type: asset.type,
                        url: `/api/assets/download?key=${encodeURIComponent(asset.s3_key)}`,
                        thumbUrl: thumbUrl
                    };
                });
                return res.json(processedAssets);
            }

            const processedAssets = dbAssets.map(asset => {
                let thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent(asset.s3_key)}`;

                // Default thumbnail for literature
                if (category === 'literature') {
                    thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent('Products/Pledges/vaanar.png')}`;
                }

                if (asset.metadata) {
                    try {
                        const meta = typeof asset.metadata === 'string' ? JSON.parse(asset.metadata) : asset.metadata;
                        if (meta.thumbKey) {
                            thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent(meta.thumbKey)}`;
                        }
                    } catch (e) { }
                }

                return {
                    id: asset.id,
                    name: asset.name,
                    key: asset.s3_key,
                    type: asset.type,
                    url: `/api/assets/download?key=${encodeURIComponent(asset.s3_key)}`,
                    thumbUrl: thumbUrl
                };
            });
            return res.json(processedAssets);
        }

        // Fallback: List from S3 directly based on category prefix
        if (s3Service.isConfigured()) {
            const prefixMap = {
                'wallpaper': ['Assets/Wallpaper/', 'Wallpapers/'],
                'literature': ['Assets/Literature/', 'Literature/'],
                '3d': ['Assets/3D Files/', '3D/', 'Assets/3D/']
            };

            const prefixes = prefixMap[category];
            if (prefixes) {
                try {
                    let s3Assets = [];
                    let prefix = '';
                    // Try each prefix until we find content
                    for (const p of prefixes) {
                        const items = await s3Service.listAssets(p);
                        if (items && items.length > 1) { // >1 because the folder itself is often an item
                            s3Assets = items;
                            prefix = p; // Store the successful prefix
                            break;
                        }
                    }

                    if (s3Assets.length === 0) return res.json([]);

                    const filtered = s3Assets.filter(item =>
                        item.Key !== prefix &&
                        !item.Key.endsWith('/') &&
                        !item.Key.includes('_thumbs/')
                    );

                    if (category === '3d') {
                        // Separate 3D models and image renders
                        const models = filtered.filter(item => {
                            const ext = item.Key.split('.').pop().toLowerCase();
                            return ['stl', 'obj', 'fbx', 'gltf', 'glb'].includes(ext);
                        });
                        const renders = filtered.filter(item => {
                            const ext = item.Key.split('.').pop().toLowerCase();
                            return ['png', 'jpg', 'jpeg', 'webp'].includes(ext);
                        });

                        const processedS3 = models.map((item, idx) => {
                            const filename = item.Key.split('/').pop();
                            const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
                            // Extract core name for matching (e.g. "Manushya" from "Manushya Miniature - Prabhakar")
                            const modelCoreName = nameWithoutExt.split(' ')[0].toLowerCase();

                            // Find matching render image
                            const render = renders.find(r => {
                                const rName = r.Key.split('/').pop().toLowerCase();
                                return rName.includes(modelCoreName);
                            });

                            return {
                                id: `s3-${idx}-${Date.now()}`,
                                name: nameWithoutExt.replace(/[-_]/g, ' '),
                                key: item.Key,
                                type: '3d',
                                url: `/api/assets/download?key=${encodeURIComponent(item.Key)}`,
                                thumbUrl: `/api/assets/thumbnail?key=${encodeURIComponent(render ? render.Key : item.Key)}`
                            };
                        });
                        return res.json(processedS3);
                    }

                    const processedS3 = filtered.map((item, idx) => {
                        const filename = item.Key.split('/').pop();
                        const ext = filename.split('.').pop().toLowerCase();
                        const typeMap = {
                            'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'webp': 'image', 'gif': 'image',
                            'pdf': 'document', 'epub': 'ebook',
                            'stl': '3d', 'obj': '3d', 'fbx': '3d', 'gltf': '3d', 'glb': '3d'
                        };

                        let thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent(item.Key)}`;
                        let previewUrl = null;

                        // Default thumbnail for literature
                        if (category === 'literature') {
                            thumbUrl = `/api/assets/thumbnail?key=${encodeURIComponent('Products/Pledges/vaanar.png')}`;
                        }

                        // Add preview URL for wallpapers (medium-sized for modal viewing)
                        if (category === 'wallpaper') {
                            previewUrl = `/api/assets/preview?key=${encodeURIComponent(item.Key)}`;
                        }

                        return {
                            id: `s3-${idx}-${Date.now()}`,
                            name: filename.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '),
                            key: item.Key,
                            type: typeMap[ext] || ext,
                            url: `/api/assets/download?key=${encodeURIComponent(item.Key)}`,
                            thumbUrl: thumbUrl,
                            previewUrl: previewUrl
                        };
                    });

                    return res.json(processedS3);
                } catch (s3Err) {
                    console.log(`No S3 assets found for ${category}:`, s3Err.message);
                }
            }
        }

        // Return empty if nothing found
        res.json([]);
    } catch (err) {
        console.error('Error fetching assets:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// ============================================
// VIEW ROUTES (HTML Pages)
// ============================================

// Public store homepage
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'store.html'));
});

// Login page
app.get('/login', (req, res) => {
    if (req.session.identityId && !req.query.setPin) {
        res.redirect('/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'login.html'));
    }
});

// Dashboard - View Kickstarter order
const { requireAuth } = require('./middleware/auth');
app.get('/dashboard', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'dashboard.html'));
});

// Add-ons/Cart page
app.get('/addons', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'addons.html'));
});

// Shipping page
app.get('/shipping', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'shipping.html'));
});

// Checkout page
app.get('/checkout', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'checkout.html'));
});

// Shipping address management page
app.get('/shipping', requireAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'shipping.html'));
});

// Thank you page
app.get('/thankyou', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'thankyou.html'));
});

// Test component page
app.get('/test-component', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'test-component.html'));
});

// Terms of Service
app.get('/terms', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'terms.html'));
});

// Privacy Policy
app.get('/privacy', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'privacy.html'));
});

// Assets landing page
app.get('/assets', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'assets.html'));
});

// Wallpaper Page
app.get('/assets/wallpaper', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'wallpaper.html'));
});

// Literature Page
app.get('/assets/literature', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'literature.html'));
});

// 3D Files Page
app.get('/assets/3d', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', '3d_files.html'));
});

// Payment page (alternative checkout flow)
app.get('/payment', (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'payment.html'));
});

// Logout
app.get('/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/');
});

// Admin pages
const { requireAdmin } = require('./middleware/auth');
app.get('/admin/login', (req, res) => {
    if (req.session.adminId) {
        res.redirect('/admin/dashboard');
    } else {
        res.sendFile(path.join(__dirname, 'views', 'admin', 'login.html'));
    }
});

app.get('/admin/dashboard', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'dashboard.html'));
});

app.get('/admin/control-panel', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'control-panel.html'));
});

app.get('/admin/assets', requireAdmin, (req, res) => {
    res.sendFile(path.join(__dirname, 'views', 'admin', 'assets.html'));
});

app.get('/admin/logout', (req, res) => {
    req.session.destroy();
    res.redirect('/admin/login');
});

// Guest pages (redirects)
app.get('/guest/shipping', (req, res) => {
    res.redirect('/shipping');
});

app.get('/guest/checkout', (req, res) => {
    res.redirect('/checkout');
});

app.get('/guest/thankyou', (req, res) => {
    res.redirect('/thankyou');
});

// ============================================
// API ROUTES
// ============================================

// Auth routes
app.use('/api/auth', authRoutes);
app.use('/auth', authRoutes); // For magic link

// User routes
app.use('/api/user', userRoutes);

// Products routes
app.use('/api/products', productsRoutes);

// Backward compatibility routes - these were top-level in the old API
const productModel = require('./db/models/product');
app.get('/api/addons', async (req, res) => {
    try {
        const addons = await productModel.findAllAddons();
        const isLoggedIn = !!(req.session && req.session.identityId);

        const processedAddons = addons.map(addon => {
            if (isLoggedIn && addon.backer_price !== null && addon.backer_price !== undefined) {
                return {
                    ...addon,
                    original_price: addon.price,
                    price: addon.backer_price,
                    is_backer_price: true
                };
            }
            return {
                ...addon,
                is_backer_price: false
            };
        });

        res.json(processedAddons);
    } catch (err) {
        console.error('Error fetching addons:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

app.get('/api/stripe-key', (req, res) => {
    res.json({
        publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || 'pk_test_YOUR_KEY_HERE'
    });
});

// Rules endpoint for frontend
const rulesModel = require('./db/models/rules');
app.get('/api/rules/client', async (req, res) => {
    try {
        const cartRules = await rulesModel.getByCategory('cart');
        const rules = {};

        cartRules.forEach(rule => {
            const camelKey = rule.key.split('_').map((word, i) =>
                i === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)
            ).join('');
            rules[camelKey] = rule.value;
        });

        res.json({ cart: rules });
    } catch (err) {
        console.error('Error fetching client rules:', err);
        res.status(500).json({ error: 'Database error' });
    }
});

// Orders routes
app.use('/api', ordersRoutes); // Mounts /api/calculate-shipping, /api/shipping/save, etc.
app.use('/api/order', ordersRoutes); // Mounts /api/order/summary

// Payments routes
app.use('/api', paymentsRoutes); // Mounts /api/create-payment-intent, etc.

// Admin routes
app.use('/api/admin', adminRoutes);
app.use('/admin', adminRoutes); // For /admin/login POST

// Guest routes
app.use('/api/guest', guestRoutes);

// ============================================
// ERROR HANDLING
// ============================================

app.use(errorHandler);

// ============================================
// DATABASE INITIALIZATION & SERVER START
// ============================================

async function startServer() {
    try {
        // Connect to database
        await db.connect();

        // Initialize database schema
        await schema.initializeDatabase();

        // Start server
        app.listen(PORT, '0.0.0.0', () => {
            console.log(`\n🚀 MAYA Pledge Manager running on http://localhost:${PORT}`);
            console.log(`\n📋 Next steps:`);
            console.log(`   1. Set DATABASE_URL in .env (or Railway will auto-provide it)`);
            console.log(`   2. Import Kickstarter CSV: npm run import-csv path-to-csv.csv`);
            console.log(`   3. Admin login at: http://localhost:${PORT}/admin/login\n`);
        });
    } catch (err) {
        console.error('Failed to start server:', err);
        process.exit(1);
    }
}

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\nShutting down gracefully...');
    await db.close();
    console.log('Database connections closed.');
    process.exit(0);
});

// Start the server
startServer();
