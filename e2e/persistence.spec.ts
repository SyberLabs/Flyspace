import { test, expect } from '@playwright/test';
import { freshStart, spawnInvestor, waitForMockAnswer } from './helpers';

/**
 * Think → Crystallize must produce something the user can SEE: a Memory block,
 * wired back, holding the text. That Memory entry and a block's fetch params
 * must survive a reload. Params used to vanish because they lived only in
 * component state.
 */
test('persistence: Crystallize creates a wired Memory block; it and block params survive a reload', async ({ page }) => {
    await freshStart(page);
    await spawnInvestor(page);

    const wiresBefore = await page.getByTestId('wire').count();

    const country = page.getByPlaceholder('Country (USA or all)');
    await expect(country).toHaveValue('USA');
    await country.fill('GBR');
    await page.getByRole('button', { name: 'Apply' }).click();
    await expect(country).toHaveValue('GBR');

    await page.getByTitle('Think').first().click();
    await waitForMockAnswer(page);
    await page.getByTitle('Keep this as memory — it becomes a block you can wire anywhere').click();
    await expect(page.getByText('Kept in a new Memory block')).toBeVisible();
    await expect(page.getByText('Memory').first()).toBeVisible();
    await expect(page.getByPlaceholder('Remember something…')).toBeVisible();
    expect(await page.getByTestId('wire').count()).toBeGreaterThan(wiresBefore);

    await page.reload();

    await expect(page.getByPlaceholder('Country (USA or all)')).toHaveValue('GBR');
    await expect(page.getByText('E2E MOCK RESPONSE').nth(1)).toBeVisible();
    await expect(page.getByPlaceholder('Remember something…')).toBeVisible();
});
