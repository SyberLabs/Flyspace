import { test, expect } from '@playwright/test';
import { freshStart, spawnInvestor } from './helpers';

/**
 * THE GOLDEN PATH (apex A3)
 *
 * Every shipped bug this cycle lived in the UI wiring layer that unit tests
 * can't see. This drives what the public preview promises, end to end:
 *
 *   spawn Investor shell → blocks render → wires are live → Think says AI
 *   answers are off → everything survives a reload.
 */
test('golden path: spawn Investor → live wires → Think explains → persists', async ({ page }) => {
    // 1 · Boot from scratch (both persistence engines wiped, so the later
    //     persistence assertions cannot pass vacuously on prior-run data), then
    //     spawn the Investor shell from the Store.
    await freshStart(page);
    await spawnInvestor(page);

    // 2 · Blocks render on the canvas.
    await expect(page.getByText('Strategist').first()).toBeVisible();

    // 3 · Wires are live, drawn from the single wire system.
    await expect(page.getByTestId('wire').first()).toBeVisible();
    expect(await page.getByTestId('wire').count()).toBeGreaterThanOrEqual(5);

    // 4 · Think commits the preview's refusal into the conversation.
    await page.getByTitle('Think').first().click();
    const refusal = page.getByText(/AI answers are off in the public preview\. Live data and wires still work\./);
    await expect(refusal).toBeVisible();

    // 5 · Reload: the shell (blocks, wires, conversation) survives.
    await page.reload();
    await expect(page.getByText('Analyst').first()).toBeVisible();
    await expect(page.getByTestId('wire').first()).toBeVisible();
    await expect(refusal).toBeVisible();
});
