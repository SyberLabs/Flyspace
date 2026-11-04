import { defineConfig, devices } from '@playwright/test';

/**
 * Golden-path e2e (apex A3). Runs against the Next build (`next start`).
 *
 * Local usage: `npm run build:next && npm run test:e2e`
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    retries: process.env.CI ? 1 : 0,
    reporter: process.env.CI ? [['github'], ['list']] : 'list',
    use: {
        baseURL: 'http://localhost:3000',
        trace: 'retain-on-failure',
        ...devices['Desktop Chrome']
    },
    webServer: {
        command: 'npm run start',
        port: 3000,
        timeout: 120_000
    }
});
