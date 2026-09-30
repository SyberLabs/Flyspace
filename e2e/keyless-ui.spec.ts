import { test, expect } from '@playwright/test';
import { freshStart } from './helpers';

const KEYLESS_ARMORY_NAMES = [
    'Polymarket',
    'Crypto Markets',
    'Hacker News',
    'OpenAlex',
    'World Bank',
    'Earthquakes',
    'Weather',
    'FX Rates',
    'Wikipedia',
    'Open Library',
    'GitHub',
    'Crossref'
];

test('armory shows every keyless block without opening hidden folders', async ({ page }) => {
    await freshStart(page);

    for (const name of KEYLESS_ARMORY_NAMES) {
        await expect(page.locator('.sidebar').getByText(name, { exact: true })).toBeVisible();
    }
});
