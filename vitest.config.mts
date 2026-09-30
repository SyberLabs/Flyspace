import { defineConfig } from 'vitest/config';

export default defineConfig({
    resolve: {
        tsconfigPaths: true,
        alias: {
            // `server-only` throws on import outside a React Server Component,
            // which would make every server module untestable. The guard still
            // applies in the real build; here it is a no-op so the modules that
            // hold API keys can actually be covered.
            'server-only': new URL('./test/server-only.stub.ts', import.meta.url).pathname
        }
    },
    test: {
        include: ['src/**/*.{test,spec}.{ts,tsx}'],
        setupFiles: ['./vitest.setup.ts'],
        globals: true
    }
});
