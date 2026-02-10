# MAYA Pledge Manager - Architecture Proposal

## Current Problems

1. **Logic Duplication**: User type determination (`isKsBacker`, `isDroppedBacker`) repeated in:
   - `routes/payments.js` (lines 43-59)
   - `routes/products.js` (lines 11-24)
   - `routes/guest.js` (multiple places)

2. **Mixed Concerns**: Routes contain business logic:
   - Pricing decisions in routes
   - User type checks in routes
   - Payment method selection logic in routes

3. **No Profile Pattern**: Each route manually checks user type and applies different logic

4. **Scattered Rules**:
   - Pricing rules: `services/paymentService.js`, `routes/products.js`
   - Shipping rules: `config/shipping-rates.js`, `services/shippingService.js`
   - Validation rules: `services/paymentService.js`, `middleware/validation.js`

## Proposed Clean Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        ROUTES LAYER                          │
│  (HTTP endpoints - thin, delegates to services)             │
│  - routes/auth.js                                            │
│  - routes/payments.js                                        │
│  - routes/products.js                                        │
│  - routes/user.js                                            │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│                     SERVICES LAYER                           │
│  (Business logic orchestration)                             │
│  - services/authService.js                                  │
│  - services/paymentService.js                               │
│  - services/orderService.js                                  │
│  - services/pricingService.js  ← NEW                         │
│  - services/userProfileService.js  ← NEW                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
        ┌───────────────┼───────────────┐
        ▼               ▼               ▼
┌───────────────┐ ┌───────────────┐ ┌───────────────┐
│  PROFILES     │ │   RULES       │ │   MODELS      │
│  (Strategy)   │ │   ENGINE      │ │   (Data)      │
└───────────────┘ └───────────────┘ └───────────────┘
```

## New Structure

### 1. User Profiles (Strategy Pattern)

**`lib/profiles/`** - User type strategies

```
lib/profiles/
├── BaseProfile.js          # Abstract base class
├── GuestProfile.js          # Guest user (retail prices, immediate charge)
├── CollectedBackerProfile.js  # KS collected backer (backer prices, card-saved)
├── DroppedBackerProfile.js    # KS dropped backer (backer prices, immediate charge)
├── CanceledBackerProfile.js    # KS canceled backer (backer prices, normal flow)
├── PoTBackerProfile.js        # Payment over time (backer prices, show balance)
├── LatePledgeProfile.js       # Late pledge (retail prices, normal flow)
└── index.js                # Profile factory
```

**Each Profile implements:**
- `getPricingStrategy()` - Returns pricing rules
- `getPaymentStrategy()` - Returns payment method (immediate vs card-saved)
- `getShippingStrategy()` - Returns shipping rules
- `canPurchase()` - Purchase permissions
- `getDisplayData()` - Dashboard display data

### 2. Rules Engine

**`lib/rules/`** - Centralized business rules

```
lib/rules/
├── pricingRules.js         # Pricing logic (backer vs retail)
├── shippingRules.js        # Shipping calculation rules
├── cartRules.js            # Cart validation rules
├── paymentRules.js          # Payment method rules
└── userRules.js            # User type determination rules
```

### 3. Enhanced Services

**`services/pricingService.js`** (NEW)
- Uses profiles to determine pricing
- Centralized pricing logic
- No duplication

**`services/userProfileService.js`** (NEW)
- Factory for creating user profiles
- Single source of truth for user type determination
- Caches profile instances

## Implementation Example

### Profile Base Class

```javascript
// lib/profiles/BaseProfile.js
class BaseProfile {
    constructor(backer) {
        this.backer = backer;
        this.identityId = backer?.identity_id;
    }
    
    // Abstract methods (must be implemented)
    getPricingStrategy() {
        throw new Error('Must implement getPricingStrategy');
    }
    
    getPaymentStrategy() {
        throw new Error('Must implement getPaymentStrategy');
    }
    
    // Default implementations
    canPurchase() { return true; }
    getDisplayData() { return {}; }
}
```

### Collected Backer Profile

```javascript
// lib/profiles/CollectedBackerProfile.js
const BaseProfile = require('./BaseProfile');

class CollectedBackerProfile extends BaseProfile {
    getPricingStrategy() {
        return {
            type: 'backer',  // Use backer prices
            latePledge: this.backer.ks_late_pledge === 1 ? 'retail' : 'backer'
        };
    }
    
    getPaymentStrategy() {
        return {
            method: 'card_saved',  // Save card for bulk charge
            immediateCharge: false
        };
    }
    
    canPurchase() {
        return true;  // Can buy add-ons freely
    }
}
```

### Profile Factory

```javascript
// lib/profiles/index.js
const GuestProfile = require('./GuestProfile');
const CollectedBackerProfile = require('./CollectedBackerProfile');
const DroppedBackerProfile = require('./DroppedBackerProfile');
// ... etc

function createProfile(backer) {
    if (!backer || !backer.ks_backer_number) {
        return new GuestProfile(null);
    }
    
    if (backer.ks_late_pledge === 1) {
        return new LatePledgeProfile(backer);
    }
    
    switch (backer.ks_status) {
        case 'dropped':
            return new DroppedBackerProfile(backer);
        case 'canceled':
            return new CanceledBackerProfile(backer);
        case 'collected':
            if (backer.ks_pledge_over_time === 1) {
                return new PoTBackerProfile(backer);
            }
            return new CollectedBackerProfile(backer);
        default:
            return new GuestProfile(backer);
    }
}

module.exports = { createProfile };
```

### User Profile Service

```javascript
// services/userProfileService.js
const { createProfile } = require('../lib/profiles');
const backerModel = require('../db/models/backer');

async function getUserProfile(identityId) {
    if (!identityId) {
        return createProfile(null);  // Guest
    }
    
    const backer = await backerModel.findByIdentityId(identityId);
    return createProfile(backer);
}

module.exports = { getUserProfile };
```

### Updated Pricing Service

```javascript
// services/pricingService.js
const userProfileService = require('./userProfileService');

async function getPricingForUser(identityId, items) {
    const profile = await userProfileService.getUserProfile(identityId);
    const strategy = profile.getPricingStrategy();
    
    // Apply pricing based on strategy
    return items.map(item => {
        if (strategy.type === 'backer' && item.backer_price) {
            return { ...item, price: item.backer_price, is_backer_price: true };
        }
        return { ...item, is_backer_price: false };
    });
}
```

### Updated Route (Clean)

```javascript
// routes/products.js (BEFORE - messy)
router.get('/', async (req, res) => {
    const isLoggedIn = !!(req.session && req.session.identityId);
    let isKsBacker = false;
    if (isLoggedIn) {
        const backer = await backerModel.findByIdentityId(req.session.identityId);
        isKsBacker = !!(backer?.ks_backer_number);
    }
    const showBackerPrices = isLoggedIn && isKsBacker;
    // ... pricing logic duplicated here
});

// routes/products.js (AFTER - clean)
router.get('/', async (req, res) => {
    const profile = await userProfileService.getUserProfile(req.session?.identityId);
    const products = await productModel.findAllProducts();
    const pricedProducts = await pricingService.applyPricing(products, profile);
    res.json(pricedProducts);
});
```

## Benefits

1. **Single Source of Truth**: User type logic in one place (profile factory)
2. **No Duplication**: Pricing, payment, shipping logic in profiles
3. **Easy Testing**: Mock profiles for unit tests
4. **Easy Extension**: Add new user type = add new profile class
5. **Clear Separation**: Routes → Services → Profiles → Models
6. **Type Safety**: Each profile enforces its own rules

## Migration Path

1. Create `lib/profiles/` structure
2. Implement base profile and all profile classes
3. Create `services/userProfileService.js`
4. Create `services/pricingService.js`
5. Update routes one by one to use profiles
6. Remove duplicated logic from routes

## File Organization

```
/
├── lib/                    # NEW - Business logic library
│   ├── profiles/          # User type strategies
│   └── rules/             # Business rules engine
├── services/              # Service orchestration
├── routes/                # HTTP endpoints (thin)
├── db/                    # Data access
│   └── models/           # Database models
├── config/                # Configuration
└── middleware/           # Request middleware
```
