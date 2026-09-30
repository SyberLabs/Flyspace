import { defineConfig, devices } from '@playwright/test';

/**
 * Golden-path e2e (apex A3). Runs against the production build (`next start`)
 * with OMNI_E2E=1 so /api/llm serves a deterministic mock — the full client
 * pipeline (spawn shell → wires → Think → streaming render) is exercised
 * without a real LLM provider or external keys.
 *
 * Local usage: `npm run build && npm run test:e2e`
 */
export default defineConfig({
    testDir: './e2e',
    timeout: 60_000,
    fullyParallel: false,
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
        reuseExistingServer: false,
        timeout: 120_000,
        env: {
            OMNI_E2E: '1'
        }
    }
});
