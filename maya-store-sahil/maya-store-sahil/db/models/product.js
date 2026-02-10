const { query, queryOne, execute } = require('../index');
const itemModel = require('./item');

/**
 * Product Model - Now uses items table
 */

// Get all active add-ons
async function findAllAddons() {
    return await itemModel.findAllAddons();
}

// Get addon by ID
async function findAddonById(addonId) {
    return await itemModel.findById(addonId);
}

// Get all active pledges (products)
async function findAllPledges() {
    return await itemModel.findAllPledges();
}

// Get product by ID
async function findProductById(productId) {
    return await itemModel.findById(productId);
}

// Get all products and addons (combined)
async function findAllProducts() {
    const pledges = await itemModel.findAllPledges();
    const addons = await itemModel.findAllAddons();
    
    return { pledges, addons };
}

// Create a new addon
async function createAddon({ name, price, backerPrice, weight, description, image, kickstarterAddonId, sku, category }) {
    const maxId = await queryOne('SELECT MAX(id) as max_id FROM items');
    const newId = (maxId?.max_id || 0) + 1;
    
    await execute(`INSERT INTO items (
        id, sku, name, type, category, price, backer_price, weight_kg, description, image, active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`, 
    [
        newId,
        sku || `ADDON-${newId}`,
        name,
        'addon',
        category || 'addon',
        price,
        backerPrice || null,
        weight || 0,
        description || null,
        image || null
    ]);
    
    return await itemModel.findById(newId);
}

// Update addon pricing
async function updateAddonPricing(addonId, price, backerPrice) {
    await execute('UPDATE items SET price = $1, backer_price = $2 WHERE id = $3', [price, backerPrice, addonId]);
}

// Create a new product (pledge)
async function createProduct({ name, type, price, backerPrice, weight, description, image, sku, category }) {
    const maxId = await queryOne('SELECT MAX(id) as max_id FROM items');
    const newId = (maxId?.max_id || 0) + 1;
    
    await execute(`INSERT INTO items (
        id, sku, name, type, category, price, backer_price, weight_kg, description, image, active
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 1)`, 
    [
        newId,
        sku || `PLEDGE-${newId}`,
        name,
        type || 'pledge',
        category || 'pledge',
        price,
        backerPrice || null,
        weight || 0,
        description || null,
        image || null
    ]);
    
    return await itemModel.findById(newId);
}

// Deactivate addon
async function deactivateAddon(addonId) {
    await execute('UPDATE items SET active = 0 WHERE id = $1', [addonId]);
}

// Deactivate product
async function deactivateProduct(productId) {
    await execute('UPDATE items SET active = 0 WHERE id = $1', [productId]);
}

module.exports = {
    findAllAddons,
    findAddonById,
    findAllPledges,
    findProductById,
    findAllProducts,
    createAddon,
    updateAddonPricing,
    createProduct,
    deactivateAddon,
    deactivateProduct
};
