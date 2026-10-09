import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 60000,
  expect: { timeout: 10000 },
  workers: 1,
  reporter: 'list',
  webServer: { command: 'node scripts/test-server.mjs', url: 'http://127.0.0.1:4178/article-a', reuseExistingServer: false },
});
