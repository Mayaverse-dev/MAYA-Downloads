/**
 * Test Setup - Initializes test environment
 * 
 * IMPORTANT: Some tests use a separate SQLite database (test.db)
 * Unit tests that mock dependencies don't need SQLite.
 */

const path = require('path');
const fs = require('fs');

// Force test mode
process.env.NODE_ENV = 'test';

// Use a separate test database file path
const TEST_DB_PATH = path.resolve(__dirname, 'test.db');
process.env.TEST_DB_PATH = TEST_DB_PATH;

// Check if sqlite3 is available
let testDb = null;
let sqliteAvailable = false;

try {
    require.resolve('sqlite3');
    sqliteAvailable = true;
} catch (e) {
    console.log('⚠️  sqlite3 not installed - integration tests requiring DB will be skipped');
}

// Clean up test database before all tests (only if sqlite3 is available)
beforeAll(async () => {
    if (sqliteAvailable) {
        try {
            // Remove existing test database to start fresh
            if (fs.existsSync(TEST_DB_PATH)) {
                fs.unlinkSync(TEST_DB_PATH);
            }
            
            // Initialize test database
            testDb = require('./testDb');
            await testDb.initialize();
        } catch (err) {
            console.warn('⚠️  Could not initialize test database:', err.message);
        }
    }
});

// Clean up after all tests
afterAll(async () => {
    if (testDb) {
        try {
            await testDb.close();
        } catch (err) {
            // Ignore close errors
        }
    }
});

// Global test utilities
global.testUtils = {
    TEST_DB_PATH,
    sqliteAvailable,
    
    // Helper to wait for async operations
    wait: (ms) => new Promise(resolve => setTimeout(resolve, ms)),
    
    // Helper to generate unique email
    uniqueEmail: () => `test_${Date.now()}_${Math.random().toString(36).slice(2)}@test.maya`,
    
    // Skip test if sqlite not available
    skipIfNoSqlite: () => {
        if (!sqliteAvailable) {
            return test.skip;
        }
        return test;
    }
};
