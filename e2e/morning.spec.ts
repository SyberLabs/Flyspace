import { test, expect, type Page, type Route } from '@playwright/test';
import { freshStart, spawnInvestor } from './helpers';

/**
 * THE MORNING (vision.md, "A Day in The Citadel") as an acceptance test.
 *
 *   pre-wired shell loads → ask the Analyst a question → the answer names the
 *   wired sources that informed it → crystallize the insight → wire the
 *   crystal to the Strategist → ask it → the Strategist cites the crystal.
 *
 * Everything outside the app is stubbed at the network layer, so the run is
 * deterministic and needs no keys:
 * - /api/llm answers from this file, with an X-Omni-Run-Id header like the
 *   real route sends when the ledger records a run. The request bodies are
 *   kept, so the test can check what actually reached the model, not only
 *   what the chips claim.
 * - The four Investor data providers return fixed payloads. Hacker News
 *   returns an empty list on purpose: a wired source that carried no data
 *   must not get a chip (AGENTS.md stop condition 2).
 */

const ANALYST_ANSWER = 'Rate-cut odds sit at 62% while US growth held near 2.8%, so risk appetite should stay firm.';
const STRATEGIST_ANSWER = 'This week, keep core positions and size any new risk to the rate-cut odds.';
const QUESTION = 'What stands out across the markets this morning?';
const FOLLOW_UP = 'Given this context, what should I do this week?';

interface LlmCall {
    messages: Array<{ role: string; content: string }>;
    sources: Array<{ id: string; kind: string; label: string; parentRunId?: string }>;
}

async function stubDataProviders(page: Page): Promise<{ hackerNewsServed: () => boolean }> {
    await page.route('**/api/polymarket**', route => route.fulfill({
        json: {
            success: true,
            markets: [{
                id: 'fed-cut-dec',
                question: 'Will the Fed cut rates in December?',
                description: '',
                outcomes: [
                    { id: 'fed-cut-dec_0', name: 'Yes', probability: 0.62 },
                    { id: 'fed-cut-dec_1', name: 'No', probability: 0.38 }
                ],
                volume: 1_250_000,
                liquidity: 90_000,
                endDate: '2030-12-31T00:00:00Z',
                category: 'Economics',
                tags: ['Economics']
            }]
        }
    }));

    await page.route('https://api.coingecko.com/**', route => route.fulfill({
        json: [{
            id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: '',
            current_price: 64_000, market_cap: 1_260_000_000_000, market_cap_rank: 1,
            total_volume: 31_000_000_000, high_24h: 64_500, low_24h: 62_900,
            price_change_24h: 820, price_change_percentage_24h: 1.3,
            market_cap_change_24h: 16_000_000_000, market_cap_change_percentage_24h: 1.3,
            circulating_supply: 19_700_000, ath: 73_700, ath_change_percentage: -13,
            ath_date: '2024-03-14T00:00:00Z', atl: 67.8, atl_change_percentage: 94_000,
            atl_date: '2013-07-06T00:00:00Z', last_updated: '2026-09-30T08:00:00Z'
        }]
    }));

    let hackerNewsServed = false;
    await page.route('https://hacker-news.firebaseio.com/**', route => {
        hackerNewsServed = true;
        return route.fulfill({ json: [] });
    });

    await page.route('https://api.worldbank.org/**', route => route.fulfill({
        json: [
            { page: 1, pages: 1, per_page: 60, total: 2 },
            [
                { indicator: { id: 'NY.GDP.MKTP.KD.ZG', value: 'GDP growth (annual %)' }, country: { id: 'US', value: 'United States' }, date: '2025', value: 2.8 },
                { indicator: { id: 'NY.GDP.MKTP.KD.ZG', value: 'GDP growth (annual %)' }, country: { id: 'US', value: 'United States' }, date: '2024', value: 2.5 }
            ]
        ]
    }));

    return { hackerNewsServed: () => hackerNewsServed };
}

/** Answers streamed turns in order, one scripted answer per turn. */
async function stubLlm(page: Page, answers: string[]): Promise<LlmCall[]> {
    const calls: LlmCall[] = [];
    await page.route('**/api/llm', async (route: Route) => {
        const body = route.request().postDataJSON() as Record<string, unknown>;
        if (body.mode === 'ping') return route.fulfill({ json: { available: true } });

        const index = calls.length;
        calls.push({
            messages: (body.messages as LlmCall['messages']) ?? [],
            sources: (body.sources as LlmCall['sources']) ?? []
        });
        const answer = answers[index] ?? `unscripted turn ${index + 1}`;
        const runId = String(9001 + index);
        if (body.stream !== true) {
            return route.fulfill({ json: { content: answer, tokensUsed: 42, finishReason: 'stop' }, headers: { 'X-Omni-Run-Id': runId } });
        }
        return route.fulfill({
            status: 200,
            contentType: 'text/plain; charset=utf-8',
            headers: { 'X-Omni-Run-Id': runId, 'Cache-Control': 'no-store' },
            body: answer
        });
    });
    return calls;
}

/** The card holding one persona, found by its own input so answers that name it do not match. */
function personaCard(page: Page, name: string) {
    return page.locator('.block-card').filter({ has: page.getByPlaceholder(`Ask ${name}...`) });
}

test.use({ viewport: { width: 1920, height: 1200 } });

test('morning: pre-wired shell → ask → cited answer → crystallize → wire to Strategist → it cites the crystal', async ({ page }) => {
    const providers = await stubDataProviders(page);
    const llmCalls = await stubLlm(page, [ANALYST_ANSWER, STRATEGIST_ANSWER]);

    // 1 · The Investor shell loads with its wires already connected.
    await freshStart(page);
    await spawnInvestor(page);
    await expect(page.getByTestId('wire').first()).toBeVisible();

    // The live blocks have their (stubbed) data before anyone asks.
    await expect(page.getByText('Will the Fed cut rates in December?').first()).toBeVisible();
    await expect(page.getByText('Bitcoin').first()).toBeVisible();
    await expect.poll(providers.hackerNewsServed).toBe(true);

    // 2 · Ask the Analyst a question.
    const analyst = personaCard(page, 'Analyst');
    await analyst.getByPlaceholder('Ask Analyst...').fill(QUESTION);
    await analyst.getByPlaceholder('Ask Analyst...').press('Enter');
    await expect(analyst.getByText(ANALYST_ANSWER)).toBeVisible();

    // 3 · The answer names the wired sources that carried data, and only those.
    const analystChips = analyst.getByTestId('provenance-chip');
    await expect(analystChips).toHaveText(['Polymarket', 'Crypto Markets', 'World Bank'], { useInnerText: true });
    expect(llmCalls).toHaveLength(1);
    expect(llmCalls[0].sources.map(s => s.label).sort()).toEqual(['Crypto Markets', 'Polymarket', 'World Bank']);
    expect(JSON.stringify(llmCalls[0].messages)).toContain(QUESTION);

    // 4 · Crystallize the insight: it becomes a Memory block on the canvas.
    await analyst.getByTitle('Keep this as memory — it becomes a block you can wire anywhere').click();
    await expect(analyst.getByText('Kept in a new Memory block')).toBeVisible();
    const memory = page.locator('.block-card').filter({ has: page.getByPlaceholder('Remember something…') });
    await expect(memory).toBeVisible();
    await expect(memory.getByText(ANALYST_ANSWER)).toBeVisible();

    // 5 · Wire the crystal to the Strategist by dragging from its output port
    //     to the Strategist's input port — the same gesture a user makes.
    //     Investor ships 5 wires and crystallize drew a 6th (Memory → Analyst);
    //     waiting for it keeps the count below from racing that render.
    const strategist = personaCard(page, 'Strategist');
    const wires = page.getByTestId('wire');
    await expect(wires).toHaveCount(6);
    // hover() waits for each port to stop moving (the new block animates in).
    await memory.locator('.wire-port-source').hover();
    await page.mouse.down();
    await strategist.locator('.wire-port-target').hover();
    await page.mouse.up();
    await expect(wires).toHaveCount(7);

    // 6 · Ask the Strategist; it answers from the crystal and says so.
    await strategist.getByPlaceholder('Ask Strategist...').fill(FOLLOW_UP);
    await strategist.getByPlaceholder('Ask Strategist...').press('Enter');
    await expect(strategist.getByText(STRATEGIST_ANSWER)).toBeVisible();

    const memoryChip = strategist.getByTestId('provenance-chip').filter({ hasText: 'Memory' });
    await expect(memoryChip).toBeVisible();
    await expect(memoryChip).toHaveAttribute('title', /Recollection from a Memory block/);

    // What reached the model: the crystal's text, cited as memory, alongside
    // the upstream Analyst answer cited by the run id the stub returned.
    expect(llmCalls).toHaveLength(2);
    const strategistCall = llmCalls[1];
    expect(JSON.stringify(strategistCall.messages)).toContain(ANALYST_ANSWER);
    expect(JSON.stringify(strategistCall.messages)).toContain(FOLLOW_UP);
    expect(strategistCall.sources).toEqual(expect.arrayContaining([
        expect.objectContaining({ kind: 'memory', label: 'Memory' }),
        expect.objectContaining({ kind: 'inference', label: 'Analyst', parentRunId: '9001' })
    ]));
});
