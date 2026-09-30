// ============================================
// PROJECT OMNI: LLM PROXY ROUTE
// Server-side proxy for LLM calls. Keys are read from process.env here and
// never shipped to the client. See IMPLEMENTATION_PLAN.md (Phase 3).
// ============================================

import { NextRequest, NextResponse } from 'next/server';
import {
    runComplete,
    runStream,
    ProviderResponseError,
    isProviderConfigured,
    checkProviderAvailable,
    type ServerLLMProvider,
    type ServerLLMRequest,
    type LLMMessage
} from '@/core/services/server/llm.adapters';
import { resolveModel } from '@/core/models.registry';
import { openRun, MAX_SOURCES, normalizePostgresBigintId, type RunSource, type SourceKind } from '@/core/services/server/inference.ledger';

export const runtime = 'nodejs';

/**
 * Carries the ledger row id back to the client, which needs it to record that
 * a later persona turn consumed THIS answer (see INFERENCE_LEDGER.md,
 * "Lineage"). A header rather than the body because the streaming response is
 * plain text: adding a field to it would change the stream contract that
 * llm.service and the e2e golden path depend on.
 *
 * Absent when nothing was recorded — no database, or a failed open.
 */
export const RUN_ID_HEADER = 'X-Omni-Run-Id';
const INFERENCE_DEADLINE_MS = 60_000;
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;

async function readRequestJson(request: Request, signal: AbortSignal): Promise<unknown> {
    if (!request.body) throw new Error('empty request body');
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    let consumed = false;
    const abortRead = () => { void reader.cancel(signal.reason).catch(() => undefined); };
    let rejectAbort!: (reason: unknown) => void;
    const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
    const failRead = () => rejectAbort(signal.reason);
    signal.addEventListener('abort', abortRead, { once: true });
    signal.addEventListener('abort', failRead, { once: true });
    try {
        while (true) {
            if (signal.aborted) throw signal.reason;
            const result = await Promise.race([reader.read(), aborted]);
            if (result.done) { consumed = true; break; }
            size += result.value.byteLength;
            if (size > MAX_REQUEST_BYTES) throw new Error('request body too large');
            chunks.push(result.value);
        }
        const bytes = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
        return JSON.parse(new TextDecoder().decode(bytes));
    } finally {
        signal.removeEventListener('abort', abortRead);
        signal.removeEventListener('abort', failRead);
        if (!consumed) await reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
}

const VALID_PROVIDERS: ServerLLMProvider[] = ['local', 'anthropic', 'google'];
const VALID_ROLES = new Set(['system', 'user', 'assistant']);
const VALID_SOURCE_KINDS = new Set<string>(['wire', 'memory', 'inference']);

const MAX_MESSAGES = 100;
const MAX_TOTAL_CHARS = 200_000;
const MAX_OUTPUT_TOKENS = 8192;
const MAX_SOURCE_FIELD_CHARS = 200;

interface ParsedBody {
    provider: ServerLLMProvider;
    model: string;
    messages: LLMMessage[];
    options?: { temperature?: number; maxTokens?: number };
    stream?: boolean;
    /**
     * What fed this turn, as the caller computed it. Recorded in the ledger
     * only — it never reaches a provider, so a bad value costs a record and
     * nothing else. Column widths are enforced here, not by a 400.
     */
    sources: RunSource[];
}

/**
 * Provenance the client volunteered. Anything malformed is dropped rather
 * than rejected: a wrong label must not cost the user their answer.
 */
function parseSources(raw: unknown): RunSource[] {
    if (!Array.isArray(raw)) return [];
    const out: RunSource[] = [];
    for (const entry of raw.slice(0, MAX_SOURCES)) {
        if (!entry || typeof entry !== 'object') continue;
        const s = entry as Record<string, unknown>;
        if (typeof s.id !== 'string' || !s.id.trim()) continue;
        if (typeof s.kind !== 'string' || !VALID_SOURCE_KINDS.has(s.kind)) continue;
        const label = typeof s.label === 'string' && s.label.trim() ? s.label : s.id;
        // A parent run id is a bigint key, so only digits can be one. Anything
        // else is dropped rather than handed to the driver to reject.
        const parentRunId = typeof s.parentRunId === 'string'
            ? normalizePostgresBigintId(s.parentRunId)
            : undefined;
        out.push({
            id: s.id.slice(0, MAX_SOURCE_FIELD_CHARS),
            kind: s.kind as SourceKind,
            label: label.slice(0, MAX_SOURCE_FIELD_CHARS),
            ...(parentRunId ? { parentRunId } : {})
        });
    }
    return out;
}

/** Validate + clamp the request body. Returns an error string on failure. */
function parseBody(raw: unknown): { ok: true; body: ParsedBody } | { ok: false; error: string } {
    if (!raw || typeof raw !== 'object') return { ok: false, error: 'Invalid request body' };
    const b = raw as Record<string, unknown>;

    const provider = b.provider as ServerLLMProvider;
    if (!VALID_PROVIDERS.includes(provider)) {
        return { ok: false, error: `Unsupported provider: ${String(b.provider)}` };
    }

    const model = typeof b.model === 'string' && b.model.trim() ? b.model.trim() : '';
    if (!model && provider !== 'local') {
        return { ok: false, error: 'Missing model' };
    }

    if (!Array.isArray(b.messages) || b.messages.length === 0) {
        return { ok: false, error: 'messages must be a non-empty array' };
    }
    if (b.messages.length > MAX_MESSAGES) {
        return { ok: false, error: `Too many messages (max ${MAX_MESSAGES})` };
    }

    let totalChars = 0;
    const messages: LLMMessage[] = [];
    for (const m of b.messages as unknown[]) {
        if (!m || typeof m !== 'object') return { ok: false, error: 'Invalid message' };
        const msg = m as Record<string, unknown>;
        if (typeof msg.role !== 'string' || !VALID_ROLES.has(msg.role)) {
            return { ok: false, error: `Invalid message role: ${String(msg.role)}` };
        }
        if (typeof msg.content !== 'string') {
            return { ok: false, error: 'Message content must be a string' };
        }
        totalChars += msg.content.length;
        messages.push({ role: msg.role as LLMMessage['role'], content: msg.content });
    }
    if (totalChars > MAX_TOTAL_CHARS) {
        return { ok: false, error: 'Request too large' };
    }

    const rawOptions = (b.options as Record<string, unknown>) || {};
    const options: ParsedBody['options'] = {};
    if (typeof rawOptions.temperature === 'number') {
        options.temperature = Math.min(2, Math.max(0, rawOptions.temperature));
    }
    if (typeof rawOptions.maxTokens === 'number') {
        options.maxTokens = Math.min(MAX_OUTPUT_TOKENS, Math.max(1, Math.floor(rawOptions.maxTokens)));
    }

    return {
        ok: true,
        body: {
            provider, model, messages, options,
            stream: b.stream === true,
            sources: parseSources(b.sources)
        }
    };
}

// ============================================
// E2E TEST DOUBLE
// When the server runs with OMNI_E2E=1 (never set in production), the route
// answers with deterministic canned output so the golden-path e2e can exercise
// the full client pipeline (persona block → streaming render) without a real
// provider. Server-side env var only — clients cannot trigger this.
// ============================================
const E2E_RESPONSE = 'E2E MOCK RESPONSE — grounded analysis of the wired data.';

function e2eDouble(rawObj: Record<string, unknown>): Response {
    if (rawObj.mode === 'ping') {
        return NextResponse.json({ available: true }, { status: 200 });
    }
    if (rawObj.stream === true) {
        const encoder = new TextEncoder();
        const chunks = E2E_RESPONSE.split(' ').map(w => `${w} `);
        const body = new ReadableStream<Uint8Array>({
            async start(controller) {
                for (const chunk of chunks) {
                    controller.enqueue(encoder.encode(chunk));
                    await new Promise(r => setTimeout(r, 15));
                }
                controller.close();
            }
        });
        return new Response(body, {
            headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }
        });
    }
    return NextResponse.json({ content: E2E_RESPONSE, tokensUsed: 42, finishReason: 'stop' });
}

/** Omitted entirely when nothing was recorded, rather than sent as 'null'. */
function runIdHeader(id: string | null): Record<string, string> {
    return id ? { [RUN_ID_HEADER]: id } : {};
}

async function beforeDeadline<T>(work: Promise<T>, signal: AbortSignal): Promise<T | undefined> {
    if (signal.aborted) return undefined;
    let onAbort!: () => void;
    const aborted = new Promise<undefined>(resolve => {
        onAbort = () => resolve(undefined);
        signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        return await Promise.race([work, aborted]);
    } finally {
        signal.removeEventListener('abort', onAbort);
    }
}

export async function POST(request: NextRequest) {
    if (process.env.OMNI_PUBLIC_DEMO === '1') {
        return NextResponse.json({ error: 'AI answers are unavailable in the public preview.' }, { status: 503 });
    }
    const inferenceAbort = new AbortController();
    const inferenceSignal = AbortSignal.any([
        request.signal,
        inferenceAbort.signal,
        AbortSignal.timeout(INFERENCE_DEADLINE_MS)
    ]);

    let raw: unknown;
    try {
        raw = await readRequestJson(request, inferenceSignal);
    } catch {
        if (inferenceSignal.aborted) return new Response(null, { status: request.signal.aborted ? 499 : 504 });
        return NextResponse.json({ error: 'Invalid JSON or request body exceeds 2 MiB' }, { status: 400 });
    }

    if (process.env.OMNI_E2E === '1') {
        const rawObj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
        return e2eDouble(rawObj);
    }

    // Lightweight availability probe (mode: 'ping') — checks key presence for
    // cloud providers and actually pings Ollama for local, WITHOUT running a
    // real completion. Always 200 with { available } so the client can branch
    // cleanly instead of misreading a failed generation as "available".
    const rawObj = (raw && typeof raw === 'object') ? (raw as Record<string, unknown>) : {};
    if (rawObj.mode === 'ping') {
        const provider = rawObj.provider as ServerLLMProvider;
        if (!VALID_PROVIDERS.includes(provider)) {
            return NextResponse.json({ available: false, error: 'Unsupported provider' }, { status: 200 });
        }
        const available = await checkProviderAvailable({
            provider, model: '', messages: [], signal: inferenceSignal
        });
        return NextResponse.json({ available }, { status: 200 });
    }

    const parsed = parseBody(raw);
    if (!parsed.ok) {
        return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { provider, messages, options, stream, sources } = parsed.body;
    // Defense in depth: heal known-deprecated model ids server-side so stale
    // clients (old persisted configs) don't 404 against providers (apex A5).
    const model = resolveModel(provider, parsed.body.model);

    if (!isProviderConfigured(provider)) {
        return NextResponse.json(
            { error: `${provider} is not configured on the server. Set the corresponding API key in .env.` },
            { status: 503 }
        );
    }

    const req: ServerLLMRequest = {
        provider, model, messages, options,
        signal: inferenceSignal
    };

    // The ledger row opens before the provider is called, so an execution that
    // never comes back is still visible as a 'running' row. `openRun` never
    // throws and returns a no-op handle when Postgres is not configured.
    const openingRun = openRun({
        provider,
        model: model || provider,
        streamed: Boolean(stream),
        messageCount: messages.length,
        promptChars: messages.reduce((n, m) => n + m.content.length, 0),
        prompt: messages.findLast(m => m.role === 'user')?.content,
        temperature: options?.temperature,
        maxTokens: options?.maxTokens,
        sources
    });
    const run = await beforeDeadline(openingRun, inferenceSignal);
    if (!run) return new Response(null, { status: request.signal.aborted ? 499 : 504 });

    if (inferenceSignal.aborted) {
        if (run.id) await run.uncertain(new Error('Deadline expired before provider dispatch'));
        return new Response(null, { status: request.signal.aborted ? 499 : 504 });
    }

    try {
        if (stream) {
            // `meter` passes chunks straight through and closes the row when
            // the stream ends, is cancelled, or breaks mid-flight.
            const body = run.meter(await runStream(req), reason => inferenceAbort.abort(reason));
            return new Response(body, {
                headers: {
                    'Content-Type': 'text/plain; charset=utf-8',
                    'Cache-Control': 'no-store',
                    ...runIdHeader(run.id)
                }
            });
        }
        const result = await runComplete(req);
        await run.succeeded({
            output: result.content,
            tokensUsed: result.tokensUsed,
            finishReason: result.finishReason
        });
        return NextResponse.json(result, { headers: runIdHeader(run.id) });
    } catch (err) {
        // Never reflect raw upstream errors to the client (may contain
        // keys/PII). The ledger keeps a scrubbed copy so a 502 is diagnosable.
        console.error('[api/llm] provider call failed');
        const uncertain = inferenceSignal.aborted || !(err instanceof ProviderResponseError)
            || !err.isDefinitiveRejection;
        if (uncertain) {
            await run.uncertain(err);
        } else {
            await run.failed(err);
        }
        if (request.signal.aborted) return new Response(null, { status: 499 });
        if (inferenceSignal.aborted) {
            return NextResponse.json({ error: 'Inference deadline exceeded' }, { status: 504 });
        }
        return NextResponse.json(
            { error: uncertain
                ? 'LLM provider request failed; the provider outcome may be unresolved.'
                : 'LLM provider request failed. Check server logs.' },
            { status: 502 }
        );
    }
}
