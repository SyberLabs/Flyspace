import { test, expect } from '@playwright/test';
import { freshStart, spawnInvestor, waitForMockAnswer } from './helpers';

/**
 * THE GOLDEN PATH (apex A3)
 *
 * Institutionalizes this project's hardest-won lesson: every shipped bug this
 * cycle lived in the UI wiring layer that unit tests can't see (canvas not
 * following the active shell, fake Think handlers, inert template wires).
 * This spec drives the real app through the core promise, end to end:
 *
 *   spawn Investor shell → blocks render → wires are LIVE → Think streams a
 *   response into the persona → everything survives a reload.
 *
 * The LLM is the OMNI_E2E server double (deterministic; no keys, no network).
 */
test('golden path: spawn Investor → live wires → Think streams → persists', async ({ page }) => {
    // 1 · Boot from scratch (both persistence engines wiped, so the later
    //     persistence assertions cannot pass vacuously on prior-run data), then
    //     spawn the Investor shell from the Store.
    await freshStart(page);
    await spawnInvestor(page);

    // 2 · Blocks render on the canvas (data cluster + personas; spawnInvestor
    //     already saw the Analyst).
    await expect(page.getByText('Strategist').first()).toBeVisible();

    // 3 · Wires are LIVE — drawn from the single wire system (A1 regression:
    //     template pre-wiring used to be invisible and inert).
    await expect(page.getByTestId('wire').first()).toBeVisible();
    expect(await page.getByTestId('wire').count()).toBeGreaterThanOrEqual(5);

    // 4 · Think — the persona streams a (mock) LLM response grounded in the
    //     wired context. This exercises ping → stream → token-render. Wait for
    //     the stream to COMPLETE before reloading — reloading mid-stream aborts
    //     the fetch and the draft is replaced with an error message (defensible
    //     app behavior; a test race).
    await page.getByTitle('Think').first().click();
    await waitForMockAnswer(page);

    // 5 · Persistence — reload and the spawned shell (blocks + wires + the
    //     conversation) survives via the persisted stores.
    await page.reload();
    await expect(page.getByText('Analyst').first()).toBeVisible();
    await expect(page.getByTestId('wire').first()).toBeVisible();
    await expect(page.getByText('E2E MOCK RESPONSE')).toBeVisible();
});
