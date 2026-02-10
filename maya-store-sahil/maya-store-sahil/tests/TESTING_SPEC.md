# MAYA Pledge Manager - Testing Specification

## Overview

This document describes the expected behavior of the MAYA Pledge Manager application for different user types, flows, and edge cases. It serves as the specification for writing comprehensive tests.

---

## 1. User Types & Profiles

The application has 6 distinct user profiles, determined by the `lib/profiles/index.js` factory:

### 1.1 Guest (Non-Backer)
- **Identification**: No `ks_backer_number` in database (NULL)
- **Pricing**: Retail prices (`price` field)
- **Payment**: Immediate charge
- **Pledge Ownership**: None initially; stored in `ks_pledge_id` after purchase
- **Dashboard Access**: Yes (can login via OTP/magic link, sees retail prices)
- **Note**: Login is optional for guests - they can checkout without logging in

### 1.2 Collected Backer
- **Identification**: `ks_backer_number` exists AND `ks_status = 'collected'` AND `ks_pledge_over_time = 0`
- **Pricing**: Backer prices (`backer_price` field)
- **Payment**: Card saved for bulk charge later
- **Pledge Ownership**: Has existing pledge (paid)
- **Dashboard Access**: Yes
- **Special Features**:
  - Can checkout with $0 cart (shipping-only)
  - Can upgrade pledge (pay difference)
  - Cannot downgrade pledge

### 1.3 Payment over Time (PoT) Backer
- **Identification**: `ks_backer_number` exists AND `ks_status = 'collected'` AND `ks_pledge_over_time = 1`
- **Pricing**: Backer prices
- **Payment**: Card saved for bulk charge later
- **Pledge Ownership**: Has existing pledge (partially paid via Kickstarter)
- **Dashboard Access**: Yes
- **Special Features**:
  - Shows payment plan progress
  - Balance managed by Kickstarter

### 1.4 Dropped Backer
- **Identification**: `ks_backer_number` exists AND `ks_status = 'dropped'`
- **Pricing**: Backer prices (honored)
- **Payment**: Immediate charge (must pay now)
- **Pledge Ownership**: Has `ks_pledge_id` in database but payment failed (unpaid)
- **Dashboard Access**: Yes
- **Special Features**:
  - Original pledge auto-added to cart with amount due displayed
  - Shows "Complete Your Pledge" alert
  - Can add add-ons AFTER their pledge is in cart (pledge requirement still applies)
  - Must pay for pledge + any add-ons in single checkout

### 1.5 Canceled Backer
- **Identification**: `ks_backer_number` exists AND `ks_status = 'canceled'`
- **Pricing**: Backer prices (honored)
- **Payment**: Immediate charge
- **Pledge Ownership**: Has `ks_pledge_id` in database but voluntarily canceled (unpaid)
- **Dashboard Access**: Yes
- **Special Features**:
  - Same as Dropped backer - original pledge auto-added to cart
  - Shows cancellation notice
  - Can add add-ons AFTER their pledge is in cart
  - Must pay for pledge + any add-ons in single checkout

### 1.6 Late Pledge Backer
- **Identification**: `ks_backer_number` exists AND `ks_late_pledge = 1`
- **Pricing**: Retail prices (NOT backer prices)
- **Payment**: Card saved for bulk charge later
- **Pledge Ownership**: Has existing pledge
- **Dashboard Access**: Yes

---

## 2. Pricing Matrix

| Profile Type | Pricing | Payment Method |
|--------------|---------|----------------|
| Guest | Retail | Immediate |
| Collected | Backer | Card Saved |
| PoT | Backer | Card Saved |
| Dropped | Backer | Immediate |
| Canceled | Backer | Immediate |
| Late Pledge | Retail | Card Saved |

---

## 3. Authentication Flows

### 3.1 PIN Login Flow
1. User enters email
2. System checks if user has `pin_hash` set
3. If yes → Prompt for 4-digit PIN
4. Verify PIN against bcrypt hash
5. Create session with `identityId`

### 3.2 OTP Login Flow
1. User enters email (no PIN set OR requests OTP)
2. System generates 6-digit OTP
3. OTP sent via email (Resend)
4. User enters OTP
5. Verify OTP (valid for limited time)
6. Create session
7. Optionally prompt to set PIN

### 3.3 Magic Link Flow
1. User receives magic link via email
2. Link contains signed token
3. Token verified and user logged in

### 3.4 Guest Flow
1. No login required
2. Can browse store and add items to cart
3. At checkout, enters email
4. If email belongs to existing backer → Must login
5. If new email → Shadow user created in `backers` table

---

## 4. Store & Cart Behavior

### 4.1 Pledge Selection Rules

#### For Guests/Non-Backers:
- Can select ONE pledge at a time
- Selecting a new pledge replaces the old one
- No quantity selector for pledges
- Selected pledge shows "✓ SELECTED" button
- Other pledges show "ADD TO CART"

#### For Backers with Existing Pledge:
- Current pledge shows "YOUR PLEDGE" badge
- Higher-priced pledges show "UPGRADE +$X" (price difference)
- Lower-priced pledges show "CANNOT DOWNGRADE" (disabled)
- Can only have one upgrade in cart at a time
- **Important**: After completing an upgrade payment, the NEW upgraded pledge becomes "YOUR PLEDGE" (database updated with new `ks_pledge_id`)

### 4.2 Add-on Rules
- **All users**: Must have a pledge to add add-ons (either owned OR in cart)
- **Guests**: Cannot add add-ons until pledge is selected in cart
- **Collected/PoT Backers**: Already have paid pledge, can add add-ons freely
- **Dropped/Canceled Backers**: Have `ks_pledge_id` in database but unpaid - their original pledge is auto-added to cart with amount due shown, then they can add add-ons
- Add-ons have quantity selector (max 10 per item)
- Add-on buttons disabled with "SELECT PLEDGE FIRST" when no pledge exists (owned or in cart)

### 4.3 Cart Persistence
- Cart stored in `sessionStorage` (browser)
- Cart cleared after successful checkout
- Cart survives page refreshes within session

---

## 5. Checkout Flow

### 5.1 Standard Checkout (Guest/Dropped/Canceled)
1. Add items to cart
2. Click "Checkout" → Navigate to `/addons` (cart page)
3. Review cart items
4. Click "Continue" → Navigate to `/checkout`
5. Enter/confirm shipping address
6. Calculate shipping based on country
7. Click "Continue" → Navigate to `/payment`
8. Enter payment details (Stripe Elements)
9. Submit payment → Immediate charge
10. Redirect to `/thankyou`

### 5.2 Card-Saved Checkout (Collected/PoT/Late Pledge)
1. Same as above until step 8
2. Enter payment details
3. Submit → Card saved (not charged)
4. Redirect to `/thankyou`
5. Card charged later during bulk charge

### 5.3 Shipping-Only Checkout (Collected/PoT)
1. User has no items in cart
2. Click "Pay Shipping" on dashboard
3. Navigate to `/checkout`
4. Enter/confirm shipping address
5. Calculate shipping cost
6. Navigate to `/payment`
7. Pay shipping only
8. Redirect to `/thankyou`

---

## 6. Shipping Address

### 6.1 Address Fields
- Full Name (required)
- Address Line 1 (required)
- Address Line 2 (optional)
- City (required)
- State/Province (required for some countries)
- Postal Code (required)
- Country (required)
- Phone (optional)
- Email (required)

### 6.2 Address Modification Rules
- **Normal users**: Can modify anytime before lock
- **Locked users** (`ship_locked = 1`): Cannot modify, must contact support
- **After fulfillment starts**: Address locked automatically

### 6.3 Multiple Addresses
- Users can save multiple addresses
- One address marked as default
- Can select from saved addresses at checkout

---

## 7. Shipping Cost Calculation

### 7.1 Shipping Zones
| Zone | Countries | Base Cost |
|------|-----------|-----------|
| 1 | USA | FREE |
| 2 | Canada | $15 |
| 3 | UK | $20 |
| 4 | EU | $25 |
| 5 | Australia/NZ | $30 |
| 6 | Rest of World | $40 |

### 7.2 Shipping by Pledge Tier
Different pledges have different shipping costs based on weight/contents.

### 7.3 Add-on Shipping
- First add-on included in base cost
- Additional add-ons: +$X per item (varies by zone)
- Heavy items (Built Environments, etc.) have surcharge

---

## 8. Payment Processing

### 8.1 Stripe Integration
- Uses Stripe Payment Elements
- Supports cards, Apple Pay, Google Pay
- 3D Secure when required

### 8.2 Payment Statuses
- `pending` - Order created, awaiting payment
- `succeeded` - Immediate charge successful
- `card_saved` - Card saved for later charge
- `charged` - Bulk charge successful
- `charge_failed` - Bulk charge failed

### 8.3 Order Creation
- Order stored in `backers` table fields (`pm_*` columns)
- Add-ons stored in `backer_items` table
- For guests: `ks_pledge_id` and `ks_pledge_amount` set on order completion

---

## 9. Dashboard Features

### 9.1 Pledge Display
- Shows current pledge tier with image
- Shows pledge value
- Shows payment status (Paid/Pending)

### 9.2 Add-ons Display
- Lists all purchased add-ons
- Shows quantities and prices

### 9.3 Shipping Address
- Shows current shipping address
- Edit button (if not locked)
- Verification status

### 9.4 Payment Info
- Shows saved card (last 4 digits)
- Shows payment status
- Shows amount due (if any)

### 9.5 Alerts
- Dropped backers: "Complete Your Pledge" alert
- Missing address: "Add Shipping Address" alert
- PoT backers: Payment plan progress

---

## 10. Edge Cases & Error Handling

### 10.1 Email Already Exists
- Guest enters email at checkout
- Email belongs to existing KS backer
- Error: "This email is associated with a Kickstarter backer account. Please log in."

### 10.2 Session Expiry
- Session expires during checkout
- User must re-login
- Cart preserved in sessionStorage

### 10.3 Payment Failure
- Card declined
- Show error message
- Allow retry with same or different card

### 10.4 Price Mismatch
- Client sends different price than server calculates
- Server uses server-calculated price (security)
- Log discrepancy for review

### 10.5 Out of Stock (Future)
- Item becomes unavailable
- Remove from cart
- Show notification

---

## 11. Test User Matrix

| Email | Type | PIN | Pledge | Special |
|-------|------|-----|--------|---------|
| test1.collected@maya.test | Collected | 1234 | Humble Vaanar | Has address |
| test2.collected.pot@maya.test | PoT | 1234 | Benevolent Divya | Partial payment |
| test3.dropped@maya.test | Dropped | 1234 | Humble Vaanar | Needs to complete |
| test4.canceled@maya.test | Canceled | 1234 | Industrious Manushya | - |
| test5.nopin@maya.test | Collected | None | Humble Vaanar | OTP flow |
| test6.savedcard@maya.test | Collected | 1234 | Resplendent Garuda | Has saved card |
| test7.latepledge@maya.test | Late Pledge | 1234 | Humble Vaanar | Retail prices |
| test8.multiaddr@maya.test | Collected | 1234 | Industrious Manushya | 3 addresses |
| test9.locked@maya.test | Collected | 1234 | Humble Vaanar | Shipping locked |
| test10.guest@maya.test | Guest | N/A | None | Created at checkout |

---

## 12. API Endpoints to Test

### Auth
- `POST /api/auth/initiate` - Start login flow
- `POST /api/auth/verify-otp` - Verify OTP
- `POST /api/auth/login-pin` - Login with PIN
- `POST /api/auth/set-pin` - Set new PIN
- `POST /api/auth/logout` - Logout

### User
- `GET /api/user/data` - Get user profile data
- `GET /api/user/pledge-context` - Get pledge upgrade/downgrade info
- `POST /api/user/shipping-address` - Save shipping address
- `GET /api/user/addresses` - Get saved addresses

### Products
- `GET /api/products` - Get all products with pricing
- `GET /api/products/pledges` - Get pledge tiers
- `GET /api/products/addons` - Get add-ons

### Payments
- `POST /api/payments/create-payment-intent` - Create Stripe payment
- `POST /api/payments/save-payment-method` - Save card details
- `POST /api/payments/confirm-payment` - Confirm payment
- `POST /api/calculate-shipping` - Calculate shipping cost

### Orders
- `GET /api/orders` - Get user's orders
- `GET /api/orders/:id` - Get specific order

---

## 13. Test Categories

### Unit Tests
- Profile factory logic
- Pricing calculations
- Shipping calculations
- Cart rules validation
- Address validation

### Integration Tests
- Auth flow (PIN + OTP)
- Checkout flow (all user types)
- Payment processing
- Order creation

### E2E Tests
- Complete guest checkout
- Complete backer checkout
- Pledge upgrade flow
- Shipping address modification
- Dashboard functionality

---

## 14. Critical Test Scenarios

1. **Guest purchases pledge** → `ks_pledge_id` stored correctly
2. **Guest returns after purchase** → Shows owned pledge, can upgrade
3. **Backer upgrades pledge** → Pays only difference
4. **Backer completes upgrade payment** → New `ks_pledge_id` stored, shows as "YOUR PLEDGE"
5. **Backer tries to downgrade** → Blocked
6. **Guest tries to add add-on without pledge** → Blocked with message
7. **Dropped backer visits store** → Original pledge auto-added to cart with amount due
8. **Dropped backer adds add-ons** → Allowed only after pledge in cart
9. **Dropped backer completes checkout** → Immediate charge for pledge + add-ons
10. **Collected backer pays shipping only** → Card saved
11. **Existing backer email at guest checkout** → Must login
12. **Locked shipping address** → Cannot modify
13. **Session expires mid-checkout** → Graceful recovery

