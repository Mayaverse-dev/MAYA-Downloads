/**
 * MAYA Pledge Manager - Shared Application Logic
 * Centralizes Cart, Auth, API, and UI logic to prevent duplication.
 */

const App = {
    // API Service - Handles fetch requests with proper error handling
    API: {
        /**
         * Make an API request with automatic session expiry handling
         * @param {string} url - The API endpoint URL
         * @param {Object} options - Fetch options (method, body, headers, etc.)
         * @returns {Promise<Object>} - The parsed JSON response
         * @throws {Error} - On network error, session expiry, or API error
         */
        async fetch(url, options = {}) {
            // Set default headers for JSON
            const headers = {
                'Accept': 'application/json',
                ...options.headers
            };
            
            // Add Content-Type for requests with body
            if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
                headers['Content-Type'] = 'application/json';
                options.body = JSON.stringify(options.body);
            }
            
            try {
                const response = await fetch(url, { ...options, headers });
                
                // Check content type before parsing
                const contentType = response.headers.get('content-type') || '';
                
                // If we got HTML instead of JSON, session likely expired
                if (contentType.includes('text/html')) {
                    console.warn('Received HTML instead of JSON - possible session expiry');
                    
                    // Check if it's a redirect to login
                    if (response.redirected && (response.url.includes('/login') || response.url.includes('/'))) {
                        this.handleSessionExpired('/login');
                        throw new Error('Session expired - redirecting to login');
                    }
                    
                    throw new Error('Unexpected HTML response from API');
                }
                
                // Parse JSON response
                let data;
                try {
                    data = await response.json();
                } catch (parseError) {
                    console.error('Failed to parse JSON response:', parseError);
                    throw new Error('Invalid response format from server');
                }
                
                // Handle 401 Unauthorized
                if (response.status === 401) {
                    const redirectUrl = data.redirect || '/login';
                    console.warn('Session expired:', data.message || 'Unauthorized');
                    this.handleSessionExpired(redirectUrl);
                    throw new Error(data.message || 'Session expired');
                }
                
                // Handle other error responses
                if (!response.ok) {
                    const errorMessage = data.error || data.message || `API error: ${response.status}`;
                    throw new Error(errorMessage);
                }
                
                return data;
            } catch (error) {
                // Re-throw if it's our custom error
                if (error.message.includes('Session expired') || 
                    error.message.includes('Unauthorized') ||
                    error.message.includes('redirecting')) {
                    throw error;
                }
                
                // Network errors
                if (error.name === 'TypeError' && error.message.includes('fetch')) {
                    console.error('Network error:', error);
                    throw new Error('Network error - please check your connection');
                }
                
                throw error;
            }
        },
        
        /**
         * Handle session expiry - redirect to login
         * @param {string} redirectUrl - URL to redirect to
         */
        handleSessionExpired(redirectUrl = '/login') {
            // Store current URL for redirect after login (optional enhancement)
            const currentPath = window.location.pathname;
            if (currentPath !== '/login' && currentPath !== '/' && currentPath !== '/logout') {
                sessionStorage.setItem('returnUrl', currentPath);
            }
            
            // Clear any stale session data
            App.Auth.user = null;
            App.Auth.isBacker = false;
            
            // Redirect to login
            window.location.href = redirectUrl;
        },
        
        /**
         * Shorthand for GET requests
         * @param {string} url - The API endpoint URL
         * @returns {Promise<Object>}
         */
        async get(url) {
            return this.fetch(url, { method: 'GET' });
        },
        
        /**
         * Shorthand for POST requests
         * @param {string} url - The API endpoint URL
         * @param {Object} body - Request body (will be JSON stringified)
         * @returns {Promise<Object>}
         */
        async post(url, body = {}) {
            return this.fetch(url, { 
                method: 'POST', 
                body 
            });
        },
        
        /**
         * Shorthand for PUT requests
         * @param {string} url - The API endpoint URL
         * @param {Object} body - Request body (will be JSON stringified)
         * @returns {Promise<Object>}
         */
        async put(url, body = {}) {
            return this.fetch(url, { 
                method: 'PUT', 
                body 
            });
        },
        
        /**
         * Shorthand for DELETE requests
         * @param {string} url - The API endpoint URL
         * @returns {Promise<Object>}
         */
        async delete(url) {
            return this.fetch(url, { method: 'DELETE' });
        }
    },

    // Cart Service
    Cart: {
        items: [],
        
        // Cart validation rules (loaded from API)
        MAX_QUANTITY_PER_ITEM: 10, // Default, will be updated from API
        
        async init() {
            this.items = JSON.parse(sessionStorage.getItem('cart')) || [];
            
            // Fetch rules from API (use raw fetch since this is non-critical)
            try {
                const response = await fetch('/api/rules/client');
                if (response.ok) {
                    const data = await response.json();
                    if (data.cart && data.cart.maxQuantityPerItem) {
                        this.MAX_QUANTITY_PER_ITEM = data.cart.maxQuantityPerItem;
                    }
                }
            } catch (err) {
                console.warn('Failed to fetch cart rules, using defaults:', err);
            }
            
            this.updateUI();
        },
        
        add(product) {
            const existingItem = this.items.find(item => item.id === product.id);
            
            // For pledges, don't increment quantity - only one allowed
            if (product.type === 'pledge' && existingItem) {
                console.log('Pledge already in cart, not adding duplicate');
                return false;
            }
            
            if (existingItem) {
                // Check max quantity rule
                if (existingItem.quantity >= this.MAX_QUANTITY_PER_ITEM) {
                    console.warn(`Maximum quantity (${this.MAX_QUANTITY_PER_ITEM}) reached for ${product.name}`);
                    return false;
                }
                existingItem.quantity++;
                this.save();
                this.updateUI();
                return true;
            }

            this.items.push({
                id: product.id,
                name: product.name,
                price: typeof product.price === 'string' ? parseFloat(product.price) : product.price,
                weight: product.weight || 0,
                quantity: 1,
                type: product.type, // Preserve type (pledge/addon)
                // Preserve special flags if passed
                isPledgeUpgrade: product.isPledgeUpgrade,
                isDroppedBackerPledge: product.isDroppedBackerPledge,
                isOriginalPledge: product.isOriginalPledge,
                originalPrice: product.originalPrice,
                currentPledgeAmount: product.currentPledgeAmount,
                currentPledgeName: product.currentPledgeName
            });

            this.save();
            this.updateUI();
            
            // Return true to indicate success
            return true;
        },

        remove(productId) {
            this.items = this.items.filter(item => item.id !== productId);
            this.save();
            this.updateUI();
        },

        updateQuantity(productId, change) {
            const item = this.items.find(item => item.id === productId);
            if (!item) return false;

            // Prevent quantity changes for special items
            if (item.isOriginalPledge || item.isOriginalAddon) return false;

            const newQty = item.quantity + change;
            
            // Enforce min/max limits
            if (newQty < 1) return false;
            if (newQty > this.MAX_QUANTITY_PER_ITEM) {
                console.warn(`Maximum quantity (${this.MAX_QUANTITY_PER_ITEM}) reached for ${item.name}`);
                return false;
            }
            
            item.quantity = newQty;
            this.save();
            this.updateUI();
            return true;
        },

        clear() {
            this.items = [];
            this.save();
            this.updateUI();
        },

        save() {
            sessionStorage.setItem('cart', JSON.stringify(this.items));
        },

        calculateTotal() {
            return this.items.reduce((sum, item) => sum + (item.price * item.quantity), 0);
        },

        calculateItemCount() {
            // Base count on distinct items or total quantity? 
            // Previous logic: addonItems (sum of qty) + 1 (if logged in backer)
            // Let's stick to total quantity for now + logic in updateUI handles the badge specifics
            return this.items.reduce((sum, item) => sum + item.quantity, 0);
        },

        hasPledge() {
            const pledgeNames = ['humble vaanar', 'industrious manushya', 'resplendent garuda', 'benevolent divya', 'founders of neh'];
            return this.items.some(item => {
                const name = item.name.toLowerCase();
                return pledgeNames.some(p => name.includes(p)) || item.type === 'pledge';
            });
        },

        updateUI() {
            const badge = document.getElementById('cart-badge') || document.getElementById('cart-count-badge');
            const count = this.calculateItemCount();
            
            if (badge) {
                if (count > 0) {
                    badge.textContent = count;
                    badge.style.display = 'flex';
                    badge.classList.remove('hidden');
                    App.UI.glitchElement(badge.id);
                } else {
                    badge.style.display = 'none';
                    badge.classList.add('hidden');
                }
            }

            // Check if shipping is pending (shipping address saved but payment not completed)
            const shippingAddress = sessionStorage.getItem('shippingAddress');
            const hasShippingPending = shippingAddress && shippingAddress !== '{}' && shippingAddress !== 'null';
            
            // Simple glow on cart button when has items OR shipping is pending
            // Check both cart-nav-btn (store navbar) and cart-btn (dashboard)
            const cartBtn = document.getElementById('cart-nav-btn') || document.querySelector('.cart-btn');
            if (cartBtn) {
                const shouldGlow = count > 0 || hasShippingPending;
                cartBtn.classList.toggle('has-items', shouldGlow);
            }
        }
    },

    // Auth Service
    Auth: {
        user: null,
        isBacker: false,
        isDroppedBacker: false,

        async checkStatus() {
            try {
                // Use raw fetch for session check since it's a public endpoint
                const response = await fetch('/api/user/session');
                const data = await response.json();
                
                if (data.isLoggedIn && data.user) {
                    this.user = data.user;
                    this.isBacker = !!data.user.backer_number;
                    this.isDroppedBacker = false; // Default
                    
                    // Smart cart initialization for dropped/canceled backers (only on non-dashboard pages)
                    // These backers need to pay for their pledge, so auto-add it to cart
                    if (this.isBacker && !window.location.pathname.includes('/dashboard')) {
                        try {
                            const userData = await App.API.get('/api/user/data');
                            
                            const needsPledgePayment = ['dropped', 'canceled'].includes(userData.pledgedStatus) ||
                                                       ['dropped', 'canceled'].includes(userData.profileType);
                            
                            if (needsPledgePayment) {
                                this.isDroppedBacker = true; // Treat canceled same as dropped
                                this.autoAddDroppedBackerPledge(userData);
                            }
                        } catch (err) {
                            // Don't redirect on error here - just log it
                            if (!err.message.includes('Session expired')) {
                                console.log('Could not fetch user data for cart init:', err.message);
                            }
                        }
                    }
                    
                    this.updateNav(true);
                    return this.user;
                } else {
                    this.user = null;
                    this.isBacker = false;
                    this.updateNav(false);
                    return null;
                }
            } catch (error) {
                console.error('Auth check failed:', error);
                this.updateNav(false);
                return null;
            }
        },

        autoAddDroppedBackerPledge(userData) {
            const pledgeId = 'pledge-' + userData.backerNumber;
            const alreadyInCart = App.Cart.items.some(item => item.id === pledgeId);
            
            if (!alreadyInCart && userData.pledgeAmount && userData.rewardTitle) {
                const pledgeProduct = {
                    id: pledgeId,
                    name: userData.rewardTitle,
                    price: userData.pledgeAmount,
                    quantity: 1,
                    isOriginalPledge: true,
                    weight: 0
                };
                
                App.Cart.add(pledgeProduct);
                console.log('✓ Auto-added dropped backer pledge to cart:', userData.rewardTitle);
            }
        },

        updateNav(isLoggedIn) {
            const navRight = document.querySelector('.nav-right');
            const navUserLink = document.getElementById('nav-user-link');
            
            // Update Profile/Login button in store navbar (all pages with this button)
            const profileBtns = document.querySelectorAll('a[href="/login"]');
            profileBtns.forEach(btn => {
                if (btn.textContent.trim() === 'PROFILE' || btn.textContent.trim() === 'LOG IN') {
                    if (isLoggedIn) {
                        btn.href = '/dashboard';
                        btn.textContent = 'PROFILE';
                    } else {
                        btn.href = '/login';
                        btn.textContent = 'LOG IN';
                    }
                }
            });
            
            // Different pages have different nav structures, handle gracefully
            if (navUserLink) {
                // Dashboard/Checkout/Shipping/Addons style
                if (isLoggedIn) {
                    navUserLink.href = '/dashboard';
                    // If we have a logout link container
                    const logoutContainer = document.getElementById('nav-right-content');
                    if (logoutContainer) {
                        logoutContainer.innerHTML = `<a href="#" onclick="App.Auth.logout(); return false;" class="text-white no-underline font-weight-500 hover:opacity-70 transition-colors">Logout</a>`;
                    }
                } else {
                    navUserLink.href = '/login';
                    const logoutContainer = document.getElementById('nav-right-content');
                    if (logoutContainer) {
                        logoutContainer.innerHTML = `
                            <a href="/login" class="text-white no-underline font-weight-500 hover:opacity-70 transition-colors">Login</a>
                            <span class="text-muted mx-8">|</span>
                            <a href="/" class="text-white no-underline font-weight-500 hover:opacity-70 transition-colors">Shop</a>
                        `;
                    }
                }
            }
            
            // Adjust cart badge for COLLECTED/POT backers only (implicitly +1 for their paid pledge)
            // Dropped backers already have their pledge in the cart, so don't add +1
            if (this.isBacker && !this.isDroppedBacker) {
                const badge = document.getElementById('cart-badge') || document.getElementById('cart-count-badge');
                if (badge) {
                    const currentCount = parseInt(badge.textContent || '0');
                    if (currentCount > 0 || App.Cart.items.length > 0) {
                        badge.textContent = App.Cart.calculateItemCount() + 1;
                        badge.style.display = 'flex';
                        badge.classList.remove('hidden');
                    }
                }
            }
        },

        logout() {
            sessionStorage.removeItem('cart');
            localStorage.removeItem('originalPledgeInfo');
            window.location.href = '/logout'; // Server handles redirect
        }
    },

    // UI Utilities
    UI: {
        showError(message, containerId = 'error-container') {
            const container = document.getElementById(containerId);
            if (!container) return alert(message);
            
            container.innerHTML = `<div class="alert alert-error bg-red text-white p-12-20 rounded-8 mb-20 text-14 border-2 border-red">${message}</div>`;
            container.style.display = 'block';
            window.scrollTo({ top: 0, behavior: 'smooth' });
            
            setTimeout(() => {
                container.innerHTML = '';
                container.style.display = 'none';
            }, 5000);
        },

        showLoading(containerId) {
            const container = document.getElementById(containerId);
            if (container) {
                container.innerHTML = '<div class="spinner w-40 h-40 border-4 border-subtle border-t-red rounded-full animate-spin mx-auto"></div>';
            }
        },
        
        formatPrice(price) {
            return '$' + parseFloat(price).toFixed(2);
        },

        // "Nothing" Glitch Effect
        glitchElement(elementId) {
            const el = document.getElementById(elementId);
            if (!el) return;

            el.classList.add('glitch-active');
            setTimeout(() => {
                el.classList.remove('glitch-active');
            }, 300);
        }
    }
};

// Initialize app on load
document.addEventListener('DOMContentLoaded', async () => {
    await App.Cart.init();
    App.Auth.checkStatus();
});
