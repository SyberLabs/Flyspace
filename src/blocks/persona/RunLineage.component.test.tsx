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

    it('draws a shared upstream run and its own ancestors once under each path (fan-in)', async () => {
        // Root 1 cites A(2) and B(3); both cite C(4); C cites D(5). The server's
        // recursive walk emits one row per path, so D arrives twice at depth 3.
        const d = run('5', [{ id: 'w', kind: 'wire', label: 'Weather' }]);
        const c = run('4', [{ id: 's', kind: 'inference', label: 'D', parentRunId: '5' }]);
        const a = run('2', [{ id: 's', kind: 'inference', label: 'C', parentRunId: '4' }]);
        const b = run('3', [{ id: 's', kind: 'inference', label: 'C', parentRunId: '4' }]);
        const root = run('1', [
            { id: 's1', kind: 'inference', label: 'A', parentRunId: '2' },
            { id: 's2', kind: 'inference', label: 'B', parentRunId: '3' }
        ]);
        const nodes: LineageNode[] = [
            { run: root, depth: 0, childRunId: null, viaLabel: null, isCycle: false },
            { run: a, depth: 1, childRunId: '1', viaLabel: 'A', isCycle: false },
            { run: b, depth: 1, childRunId: '1', viaLabel: 'B', isCycle: false },
            { run: c, depth: 2, childRunId: '2', viaLabel: 'C', isCycle: false },
            { run: c, depth: 2, childRunId: '3', viaLabel: 'C', isCycle: false },
            { run: d, depth: 3, childRunId: '4', viaLabel: 'D', isCycle: false },
            { run: d, depth: 3, childRunId: '4', viaLabel: 'D', isCycle: false }
        ];
        stubFetch(200, { configured: true, depth: 10, root, nodes, hadCycle: false, truncated: false });
        const errors = vi.spyOn(console, 'error').mockImplementation(() => {});

        open('1');

        await screen.findByRole('list', { name: 'Run lineage' });
        const labels = screen.getAllByTestId('lineage-node').map(li => li.querySelector('p')?.textContent ?? '');
        // 1, A, B, C twice (once per path), D twice (once under each C).
        expect(labels).toHaveLength(7);
        expect(labels.filter(t => t.includes('Run 5 '))).toHaveLength(2);
        expect(labels.filter(t => t.includes('Run 4 '))).toHaveLength(2);
        for (const fedC of screen.getAllByRole('list', { name: 'Runs that fed run 4' })) {
            expect(within(fedC).getAllByTestId('lineage-node')).toHaveLength(1);
        }
        expect(errors.mock.calls.some(call => String(call[0]).includes('same key'))).toBe(false);
        expect(screen.queryByText(/not in the ledger/)).toBeNull();
        errors.mockRestore();
    });

    it('says the upstream answer was not recorded, not that nothing fed the run', async () => {
        const root = run('9', [{ id: 'p1', kind: 'inference', label: 'Analyst' }]);
        stubFetch(200, {
            configured: true, depth: 10, root,
            nodes: [{ run: root, depth: 0, childRunId: null, viaLabel: null, isCycle: false }],
            hadCycle: false, truncated: false
        });

        open('9');

        expect(await screen.findByText(
            'Analyst fed this run, but its answer is not in the ledger, so lineage stops there.'
        )).toBeTruthy();
        expect(screen.queryByText(/No upstream persona answer/)).toBeNull();
    });

    it('says the same when a recorded parent edge returned no row', async () => {
        // The parent exists in the source row but the owner check filtered it out.
        const root = run('9', [{ id: 'p1', kind: 'inference', label: 'Scout', parentRunId: '8' }]);
        stubFetch(200, {
            configured: true, depth: 10, root,
            nodes: [{ run: root, depth: 0, childRunId: null, viaLabel: null, isCycle: false }],
            hadCycle: false, truncated: false
        });

        open('9');

        expect(await screen.findByText(/Scout fed this run, but its answer is not in the ledger/)).toBeTruthy();
        expect(screen.queryByText(/No upstream persona answer/)).toBeNull();
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
