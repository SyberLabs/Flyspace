'use client';

// ============================================
// PROJECT OMNI: RUN LINEAGE
// The chips under an answer show one hop. In a cascade the real grounding is
// several hops back, and the upstream blocks have refetched since. The ledger
// kept it (INFERENCE_LEDGER.md); this reads it back through
// GET /api/inference-runs/:id/lineage and draws the tree.
//
// It renders only what the server returned. No ledger, no auth, or a failed
// query is said plainly; nothing is filled in.
// ============================================

import { useState } from 'react';
import { GitBranch, Loader2 } from 'lucide-react';
// Type-only: erased at compile time, so no server code reaches the bundle.
import type { LineageNode, LedgerRunRow, RunLineage as LineageBody } from '@/core/services/server/inference.ledger';

type LineageResponse = LineageBody & { configured: boolean; depth: number };

type LoadState =
    | { kind: 'loading' }
    | { kind: 'unavailable'; message: string }
    | { kind: 'loaded'; lineage: LineageResponse };

const NOT_RECORDED =
    'The inference ledger is not configured here, so no lineage was recorded for this answer.';

/** Map every non-tree answer to one honest sentence. */
export async function fetchLineage(runId: string): Promise<LoadState> {
    let res: Response;
    try {
        res = await fetch(`/api/inference-runs/${encodeURIComponent(runId)}/lineage`, { cache: 'no-store' });
    } catch {
        return { kind: 'unavailable', message: 'Could not reach the server to load lineage.' };
    }
    if (res.status === 401 || res.status === 403) {
        return { kind: 'unavailable', message: 'Lineage needs a signed-in session, and this browser has none.' };
    }
    if (res.status === 404) {
        return { kind: 'unavailable', message: `The ledger has no record of run ${runId}.` };
    }
    if (!res.ok) {
        return { kind: 'unavailable', message: 'The ledger is unavailable right now, so lineage could not be loaded.' };
    }
    let body: LineageResponse;
    try {
        body = (await res.json()) as LineageResponse;
    } catch {
        return { kind: 'unavailable', message: 'The server returned a lineage response that could not be read.' };
    }
    if (!body.configured || !body.root) return { kind: 'unavailable', message: NOT_RECORDED };
    return { kind: 'loaded', lineage: body };
}

/** Toggle shown on an answer that carries a recorded run id. */
export function LineageToggle({ runId }: { runId: string }) {
    const [open, setOpen] = useState(false);
    const [state, setState] = useState<LoadState | null>(null);
    const panelId = `lineage-${runId}`;

    const toggle = () => {
        const next = !open;
        setOpen(next);
        // Load once per open-from-closed; a retry is closing and reopening.
        if (next && state?.kind !== 'loaded') {
            setState({ kind: 'loading' });
            void fetchLineage(runId).then(setState);
        }
    };

    return (
        <div className="mt-1.5">
            <button
                type="button"
                onClick={toggle}
                aria-expanded={open}
                aria-controls={panelId}
                className="flex items-center gap-1 text-[10px] text-[var(--text-muted)] hover:text-[var(--citadel-primary-glow)] transition-colors"
                title="Show the recorded runs and sources behind this answer"
            >
                <GitBranch className="w-3 h-3" aria-hidden="true" />
                {open ? 'Hide lineage' : 'Lineage'}
            </button>
            {open && (
                <div
                    id={panelId}
                    role="region"
                    aria-label={`Lineage of run ${runId}`}
                    className="mt-1 p-2 rounded border border-[var(--citadel-border)] bg-[var(--citadel-void)]/60 text-[10px] text-[var(--text-secondary)]"
                >
                    <LineageContent state={state} />
                </div>
            )}
        </div>
    );
}

function LineageContent({ state }: { state: LoadState | null }) {
    if (!state || state.kind === 'loading') {
        return (
            <p className="flex items-center gap-1 text-[var(--text-muted)]" role="status">
                <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                Loading lineage…
            </p>
        );
    }
    if (state.kind === 'unavailable') {
        return <p role="status" className="text-[var(--text-muted)]">{state.message}</p>;
    }

    const { lineage } = state;
    const root = lineage.nodes.find(n => n.depth === 0);
    if (!root) return <p role="status" className="text-[var(--text-muted)]">{NOT_RECORDED}</p>;

    const graph: LineageGraph = { edges: buildEdges(lineage.nodes), maxDepth: lineage.depth };
    const rootFedByPersona = root.run.sources.some(s => s.kind === 'inference');

    return (
        <div>
            <ul aria-label="Run lineage" className="space-y-1">
                <LineageItem run={root.run} via={null} depth={0} ancestors={[]} graph={graph} />
            </ul>
            {!rootFedByPersona && (
                <p className="mt-1 text-[var(--text-muted)]">No upstream persona answer fed this run.</p>
            )}
            {lineage.truncated && (
                <p className="mt-1 text-[var(--truth-amber)]">The walk hit its depth limit; there is more above.</p>
            )}
            {lineage.hadCycle && (
                <p className="mt-1 text-[var(--truth-amber)]">A cycle was found and not followed.</p>
            )}
        </div>
    );
}

interface Edge {
    run: LedgerRunRow;
    via: string | null;
}

interface LineageGraph {
    /** Child run id -> the distinct runs that fed it, one per (run, cited label). */
    edges: Map<string, Edge[]>;
    /** The depth limit the server walked to; nothing deeper was fetched. */
    maxDepth: number;
}

/**
 * The server's recursive walk emits one row per path, so a shared upstream run
 * (a diamond) and everything above it arrive once for every route to it.
 * Collapse those rows into the edges they describe and draw the tree from the
 * edges, so each ancestor appears once under each path.
 */
function buildEdges(nodes: LineageNode[]): Map<string, Edge[]> {
    const edges = new Map<string, Edge[]>();
    const seen = new Set<string>();
    for (const n of nodes) {
        if (n.childRunId === null) continue;
        const key = `${n.childRunId}>${n.run.id}:${n.viaLabel ?? ''}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const list = edges.get(n.childRunId) ?? [];
        list.push({ run: n.run, via: n.viaLabel });
        edges.set(n.childRunId, list);
    }
    return edges;
}

function LineageItem({ run, via, depth, ancestors, graph }: {
    run: LedgerRunRow;
    via: string | null;
    depth: number;
    ancestors: string[];
    graph: LineageGraph;
}) {
    // Same rule as the server walk: a run already on this path is shown once,
    // marked, and not followed. Whether it is a cycle depends on the path, so
    // it is decided here rather than taken from a row that may describe
    // another path.
    const isCycle = ancestors.includes(run.id);
    const expanded = !isCycle && depth < graph.maxDepth;
    const upstream = expanded ? graph.edges.get(run.id) ?? [] : [];
    const path = [...ancestors, run.id];
    // Persona sources the ledger could not follow: the upstream turn was never
    // recorded (no parentRunId), or its row did not come back. Past the depth
    // limit the truncation note says so instead.
    const unfollowed = expanded
        ? run.sources.filter(s =>
            s.kind === 'inference' &&
            !upstream.some(e => e.run.id === s.parentRunId && e.via === s.label))
        : [];

    return (
        <li data-testid="lineage-node" className="pl-2 border-l border-[var(--citadel-border)]">
            <RunSummary run={run} via={via} isCycle={isCycle} />
            {run.sources.length > 0 && (
                <ul aria-label={`Sources of run ${run.id}`} className="mt-0.5 flex flex-wrap gap-1">
                    {run.sources.map(s => (
                        <li
                            key={s.id}
                            className={
                                s.kind === 'wire'
                                    ? 'px-1 rounded border border-[var(--citadel-secondary)]/40 text-[var(--citadel-secondary)]'
                                    : 'px-1 rounded border border-dashed border-[var(--citadel-border)] text-[var(--text-muted)]'
                            }
                        >
                            {s.label}
                            <span className="sr-only"> ({s.kind})</span>
                        </li>
                    ))}
                </ul>
            )}
            {unfollowed.map(s => (
                <p key={s.id} className="mt-0.5 text-[var(--text-muted)]">
                    {s.label} fed this run, but its answer is not in the ledger, so lineage stops there.
                </p>
            ))}
            {upstream.length > 0 && (
                <ul aria-label={`Runs that fed run ${run.id}`} className="mt-1 ml-1 space-y-1">
                    {upstream.map(e => (
                        <LineageItem
                            key={`${e.run.id}:${e.via ?? ''}`}
                            run={e.run}
                            via={e.via}
                            depth={depth + 1}
                            ancestors={path}
                            graph={graph}
                        />
                    ))}
                </ul>
            )}
        </li>
    );
}

function RunSummary({ run, via, isCycle }: { run: LedgerRunRow; via: string | null; isCycle: boolean }) {
    return (
        <div>
            <p className="text-[var(--text-primary)]">
                {via ? <>Cited as <span className="font-semibold">{via}</span> · </> : null}
                Run {run.id} · {run.model} · {run.status}
                {isCycle && <span className="text-[var(--truth-amber)]"> · cycle, not followed</span>}
            </p>
            {run.outputExcerpt && (
                <p className="text-[var(--text-muted)] line-clamp-2" title={run.outputExcerpt}>
                    {run.outputExcerpt}
                </p>
            )}
        </div>
    );
}
