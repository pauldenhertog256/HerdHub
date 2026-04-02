import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './test/e2e',
  timeout: 30000,
  use: {
    baseURL: 'http://localhost:5175',
    headless: false,          // keep visible so you can watch
    viewport: { width: 1280, height: 900 },
    video: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
});
