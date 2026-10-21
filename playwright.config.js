import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: 'e2e',
    timeout: 180000,
    expect: { timeout: 20000 },
    fullyParallel: false,
    retries: 0,
    use: {
        headless: true,
        viewport: { width: 1280, height: 800 },
        trace: 'off',
    },
});
