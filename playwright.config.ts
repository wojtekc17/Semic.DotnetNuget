import { defineConfig, devices } from "@playwright/test";

const testPort = 41731;
const testUrl = `http://127.0.0.1:${testPort}`;

export default defineConfig({
  testDir: "./tests",
  timeout: 30000,
  expect: {
    timeout: 5000
  },
  use: {
    baseURL: testUrl,
    trace: "on-first-retry"
  },
  webServer: {
    command: `npm run dev:webview -- --port ${testPort}`,
    url: testUrl,
    reuseExistingServer: !process.env.CI,
    timeout: 30000
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] }
    }
  ]
});
