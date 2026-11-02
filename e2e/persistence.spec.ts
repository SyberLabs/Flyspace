import { test, expect } from '@playwright/test';
import { freshStart, spawnInvestor } from './helpers';

/**
 * A block's fetch params must survive a reload. They used to vanish because
 * they lived only in component state.
 */
test('persistence: block params survive a reload', async ({ page }) => {
    await freshStart(page);
    await spawnInvestor(page);

    const country = page.getByPlaceholder('Country (USA or all)');
    await expect(country).toHaveValue('USA');
    await country.fill('GBR');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(country).toHaveValue('GBR');

    await page.reload();

    await expect(page.getByPlaceholder('Country (USA or all)')).toHaveValue('GBR');
});
