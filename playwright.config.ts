import { defineConfig } from '@playwright/test';
const port = Number(process.env.E2E_PORT ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid E2E_PORT');
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  // Editor tests create/remove auto-discovered stage files; other pages would hot-reload.
  workers: 1,
  timeout: 30000,
  reporter: 'list',
  use: {
    baseURL,
    browserName: 'chromium',
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: {
    command: `npm run dev -- --port ${port} --strictPort`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
  },
});
