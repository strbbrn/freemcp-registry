import { defineConfig } from '@playwright/test';

const external = process.env.FREEMCP_TEST_URL;
const local = 'http://127.0.0.1:3011';
const executablePath = process.env.FREEMCP_CHROMIUM;

export default defineConfig({
  testDir: './tests/browser',
  workers: 2,
  timeout: 30000,
  use: {
    baseURL: external || local,
    launchOptions: executablePath ? { executablePath } : {},
    trace: 'retain-on-failure',
  },
  webServer: external ? undefined : {
    command: 'bash scripts/start-test-pages.sh',
    url: local,
    timeout: 90000,
  },
});
