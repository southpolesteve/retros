import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false, // Run tests serially since they share the dev server
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1, // Single worker to avoid port conflicts
  reporter: [['html', { open: 'never' }], ['list']],
  timeout: 30000,
  

  
  use: {
    baseURL: 'http://localhost:8787',
    trace: 'on-first-retry',
    actionTimeout: 10000,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  // Start dev server before running tests
  webServer: {
    command: 'pnpm run dev:test',
    url: 'http://localhost:8787',
    reuseExistingServer: false, // Always start fresh to ensure clean D1 state
    timeout: 30000,
  },
});
