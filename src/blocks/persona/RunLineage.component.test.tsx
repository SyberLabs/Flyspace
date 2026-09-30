// @vitest-environment happy-dom
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, within, cleanup } from '@testing-library/react';
import { LineageToggle } from './RunLineage';
import type { LedgerRunRow, LineageNode, RunSource } from '@/core/services/server/inference.ledger';

function run(id: string, sources: RunSource[], outputExcerpt: string | null = null): LedgerRunRow {
    return {
        id,
        provider: 'anthropic',
        model: 'claude-test',
        streamed: true,
        status: 'succeeded',
        startedAt: '2026-09-30T00:00:00Z',
        finishedAt: '2026-09-30T00:00:01Z',
        latencyMs: 1000,
        messageCount: 2,
        promptChars: 100,
        promptExcerpt: null,
        temperature: null,
        maxTokens: null,
        outputChars: outputExcerpt?.length ?? null,
        outputExcerpt,
        tokensUsed: null,
        finishReason: null,
        error: null,
        sources
    };
}

function stubFetch(status: number, body: unknown) {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(body), { status }));
    vi.stubGlobal('fetch', fetchMock);
    return fetchMock;
}

afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
});

function open(runId = '42') {
    render(<LineageToggle runId={runId} />);
    const button = screen.getByRole('button', { name: /lineage/i });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    return button;
}

describe('LineageToggle', () => {
    it('draws the upstream runs, the chip each was cited under, and raw sources at each level', async () => {
        const root = run('42', [
            { id: 'w1', kind: 'wire', label: 'BTC price' },
            { id: 'p1', kind: 'inference', label: 'Analyst', parentRunId: '41' }
        ], 'Strategist says hold.');
        const parent = run('41', [{ id: 'w2', kind: 'wire', label: 'Polymarket odds' }], 'Analyst says stable.');
        const nodes: LineageNode[] = [
            { run: root, depth: 0, childRunId: null, viaLabel: null, isCycle: false },
            { run: parent, depth: 1, childRunId: '42', viaLabel: 'Analyst', isCycle: false }
        ];
        const fetchMock = stubFetch(200, {
            configured: true, depth: 10, root, nodes, hadCycle: false, truncated: false
        });

        open();

        const tree = await screen.findByRole('list', { name: 'Run lineage' });
        expect(fetchMock).toHaveBeenCalledWith('/api/inference-runs/42/lineage', { cache: 'no-store' });
        expect(within(tree).getAllByTestId('lineage-node')).toHaveLength(2);
        expect(within(screen.getByRole('list', { name: 'Sources of run 42' })).getByText('BTC price')).toBeTruthy();
        const upstream = screen.getByRole('list', { name: 'Runs that fed run 42' });
        expect(within(upstream).getByText(/Cited as/).textContent).toContain('Analyst');
        expect(within(upstream).getByText('Polymarket odds')).toBeTruthy();
        expect(within(upstream).getByText('Analyst says stable.')).toBeTruthy();
    });

    it('says so when the run had no upstream persona', async () => {
        const root = run('7', [{ id: 'w1', kind: 'wire', label: 'Weather' }]);
        stubFetch(200, {
            configured: true, depth: 10, root,
            nodes: [{ run: root, depth: 0, childRunId: null, viaLabel: null, isCycle: false }],
            hadCycle: false, truncated: false
        });

        open('7');

        expect(await screen.findByText('No upstream persona answer fed this run.')).toBeTruthy();
        expect(screen.getAllByTestId('lineage-node')).toHaveLength(1);
        expect(screen.getByText('Weather')).toBeTruthy();
    });

    it('shows an honest message, not a tree, when the ledger is not configured', async () => {
        stubFetch(200, { configured: false, depth: 10, root: null, nodes: [], hadCycle: false, truncated: false });

        open();

        expect(await screen.findByText(/inference ledger is not configured/)).toBeTruthy();
        expect(screen.queryByTestId('lineage-node')).toBeNull();
    });

    it.each([
        [503, /ledger is unavailable/],
        [401, /signed-in session/],
        [404, /no record of run 42/]
    ])('explains a %i without inventing data', async (status, message) => {
        stubFetch(status, { error: 'x' });

        open();

        expect(await screen.findByText(message)).toBeTruthy();
        expect(screen.queryByTestId('lineage-node')).toBeNull();
    });
});
