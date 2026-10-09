import { test, expect } from '@playwright/test';

test('account doorway stays visible on mobile and only saves after a click', async ({ page }) => {
    let writes = 0;
    await page.route('https://syberlabs.io/admin/api/v1/**', route => {
        const url = route.request().url();
        const headers = { 'Access-Control-Allow-Origin': 'http://localhost:3000', 'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Headers': 'content-type,x-syberlabs-account' };
        if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers });
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
