import { test, expect } from '@playwright/test';

test('account doorway stays visible on mobile and only saves after a click', async ({ page }) => {
    let writes = 0;
    await page.route('https://syberlabs.io/admin/api/v1/**', route => {
        const url = route.request().url();
        const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-syberlabs-account,x-syberlabs-expected-user' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (!url.endsWith('/account')) expect(route.request().headers()['x-syberlabs-expected-user']).toBe('fixture-user');
        if (route.request().method() === 'POST') writes++;
        const response = url.endsWith('/account')
            ? { version: 1, user: { id: 'fixture-user', label: 'Orbit explorer' }, portalUrl: 'https://syberlabs.io/admin/' }
            : { version: 1, saves: [], save: { id: 'fixture-save', app: 'omni', name: 'My canvas' } };
        return route.fulfill({ headers, json: response });
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const account = page.getByRole('button', { name: 'Account', exact: true });
    await expect(account).toBeVisible();
    const box = await account.boundingBox();
    expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    await account.click();
    await expect(page.getByRole('link', { name: 'Enter your portal ↗' })).toBeVisible();
    expect(writes).toBe(0);
    await page.getByRole('button', { name: 'Save to account', exact: true }).click();
    await expect(page.getByText('Private canvas backup saved to your account.')).toBeVisible();
    expect(writes).toBe(1);
});

test('mobile account list recovers from failure and previews a named restore without changing the canvas', async ({ page }) => {
    let lists = 0;
    let details = 0;
    let writes = 0;
    const createdAt = Date.UTC(2026, 9, 8, 16, 30);
    await page.route('https://syberlabs.io/admin/api/v1/**', route => {
        const request = route.request();
        const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-syberlabs-account,x-syberlabs-expected-user' };
        if (request.method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
        if (request.url().endsWith('/account')) return route.fulfill({ headers, json: { version: 1, user: { id: 'fixture-user', label: 'Orbit explorer' } } });
        expect(request.headers()['x-syberlabs-expected-user']).toBe('fixture-user');
        if (request.method() === 'POST') writes++;
        if (request.url().includes('saves?')) {
            if (++lists === 1) return route.fulfill({ status: 503, headers, json: { error: 'unavailable' } });
            return route.fulfill({ headers, json: { version: 1, saves: [{ id: 'fixture-backup', app: 'omni', name: 'Research orbit', createdAt, bytes: 4096 }] } });
        }
        details++;
        return route.fulfill({ status: 404, headers, json: { error: 'not_found' } });
    });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const account = page.getByRole('button', { name: 'Account', exact: true });
    await account.click();
    await expect(page.getByRole('region', { name: 'Your SyberLabs account' }).getByRole('alert')).toContainText('Couldn’t load your backup list');
    await expect(page.getByText(/^No account backups/)).toHaveCount(0);
    await page.getByRole('button', { name: 'Reload backups' }).click();
    const restore = page.getByRole('button', { name: 'Restore backup Research orbit', exact: true });
    await restore.click();
    const preview = page.getByRole('group', { name: 'Restore Research orbit', exact: true });
    await expect(preview).toContainText('4 KB');
    await expect(preview.locator('time')).toHaveAttribute('datetime', new Date(createdAt).toISOString());
    await expect(preview.getByRole('button', { name: 'Cancel' })).toBeFocused();
    await expect(preview).toBeVisible();
    for (const control of [account, preview.getByRole('button', { name: 'Restore canvas' }), preview.getByRole('button', { name: 'Cancel' })]) {
        const box = await control.boundingBox();
        expect(box!.height).toBeGreaterThanOrEqual(44);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.x + box!.width).toBeLessThanOrEqual(375);
    }
    await page.screenshot({ path: '/tmp/omni-account-ux-mobile.png' });
    await page.keyboard.press('Escape');
    await expect(preview).toHaveCount(0);
    await expect(account).toBeFocused();
    expect(details).toBe(0);
    expect(writes).toBe(0);
});
