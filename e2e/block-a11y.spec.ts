import { test, expect, type Page } from '@playwright/test';
import { freshStart, spawnInvestor } from './helpers';

/**
 * A block card is not a button. dnd-kit's drag role lives on the grip only,
 * so controls inside a card keep their own names (FINDINGS.md: the whole
 * World Bank card used to be a second "Apply" button).
 */

/** The block's committed canvas x (the draggable wrapper's `left`), not its animating box. */
async function blockX(page: Page, name: string): Promise<number> {
    return page.getByRole('button', { name: `Move ${name}` }).evaluate((el) => {
        const wrapper = el.closest('.block-card')?.parentElement;
        return wrapper ? parseFloat(wrapper.style.left) : NaN;
    });
}

/** The in-flight dnd-kit x offset on the block's wrapper, 0 when not dragging. */
async function dragOffsetX(page: Page, name: string): Promise<number> {
    return page.getByRole('button', { name: `Move ${name}` }).evaluate((el) => {
        const t = (el.closest('.block-card')?.parentElement as HTMLElement | null)?.style.transform ?? '';
        const m = /translate3d\((-?[\d.]+)px/.exec(t);
        return m ? parseFloat(m[1]) : 0;
    });
}

/** Wait until the card's layout animation settles, so dnd-kit measures a still rect. */
async function waitForStill(page: Page, name: string): Promise<void> {
    const handle = page.getByRole('button', { name: `Move ${name}` });
    let last = '';
    await expect.poll(async () => {
        const box = JSON.stringify(await handle.boundingBox());
        const still = box === last;
        last = box;
        return still;
    }, { intervals: [100] }).toBe(true);
}

test('block a11y: the card has no button role and inner controls keep unique names', async ({ page }) => {
    await freshStart(page);
    await spawnInvestor(page);

    await expect(page.getByPlaceholder('Country (USA or all)')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply' })).toHaveCount(1);

    const cards = page.locator('.block-card');
    const cardCount = await cards.count();
    expect(cardCount).toBeGreaterThan(0);
    // No ancestor of any card (the dnd-kit draggable wrapper included) is a button.
    await expect(page.locator('[role="button"]:has(.block-card), button:has(.block-card)')).toHaveCount(0);
    // Each card exposes exactly one drag handle, named for its block.
    await expect(page.locator('.block-card [aria-roledescription="draggable"]')).toHaveCount(cardCount);
    await expect(page.getByRole('button', { name: 'Move World Bank' })).toHaveCount(1);
});

test('block a11y: the drag handle moves a block by pointer and by keyboard', async ({ page }) => {
    await freshStart(page);
    await spawnInvestor(page);

    const handle = page.getByRole('button', { name: 'Move World Bank' });
    await expect(handle).toBeVisible();

    // Pointer drag on the grip.
    const start = await blockX(page, 'World Bank');
    const box = (await handle.boundingBox())!;
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + 60, y, { steps: 10 });
    await page.mouse.move(box.x + 120, y, { steps: 10 });
    await page.mouse.up();
    await expect.poll(() => blockX(page, 'World Bank')).toBeGreaterThanOrEqual(start + 80);

    // Keyboard drag: Space picks up, ArrowRight moves (25px each), Space drops.
    await waitForStill(page, 'World Bank');
    const afterPointer = await blockX(page, 'World Bank');
    await handle.focus();
    await page.keyboard.press('Space');
    await expect(handle).toHaveAttribute('aria-pressed', 'true');
    // Each press is confirmed before the next.
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => dragOffsetX(page, 'World Bank')).toBeGreaterThan(0);
    const firstStep = await dragOffsetX(page, 'World Bank');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => dragOffsetX(page, 'World Bank')).toBeGreaterThan(firstStep);
    await page.keyboard.press('Space');
    await expect(handle).not.toHaveAttribute('aria-pressed', 'true');
    await expect.poll(() => blockX(page, 'World Bank')).toBeGreaterThanOrEqual(afterPointer + 40);
});
