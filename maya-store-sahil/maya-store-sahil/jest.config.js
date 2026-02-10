module.exports = {
    testEnvironment: 'node',
    testMatch: [
        '**/tests/**/*.test.js'
    ],
    setupFilesAfterEnv: ['./tests/setup.js'],
    testTimeout: 30000,
    verbose: true,
    forceExit: true,
    clearMocks: true,
    // Run tests serially to avoid database conflicts
    maxWorkers: 1,
    // Coverage settings
    collectCoverageFrom: [
        'lib/**/*.js',
        'services/**/*.js',
        'routes/**/*.js',
        'db/models/**/*.js',
        '!**/node_modules/**'
    ]
};

