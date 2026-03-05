// @ts-check
const { defineConfig, devices } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/e2e',
  timeout: 20_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'tests/report', open: 'never' }]],
  use: {
    baseURL: 'http://localhost:3000',
    headless: true,
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
