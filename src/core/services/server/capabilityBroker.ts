// Server fetch broker.
// The client sends a manifest. The server rebuilds the URL from that manifest,
// checks egress, and connects to the resolved public address. It does not
// accept a free-form URL, and it does not perform write or destructive calls:
// approval lives on the client, so a brokered write would be self-approval.

import { assessEgress } from '@/core/capabilities/egress';
import { canonicalize, sha256 } from '@/core/capabilities/hash';
import { validateManifest, type CapabilityManifest } from '@/core/capabilities/manifest';
import type { PinnedRequest, PinnedResponse } from './pinnedFetch';
import type { ServerExecution, ServerLedger } from './capability.ledger';

const MAX_BODY = 1_000_000;
const WINDOW_MS = 60_000;
const MAX_PER_WINDOW = 30;

const hits = new Map<string, number[]>();

export interface BrokerDeps {
    ledger: ServerLedger;
    resolve: (hostname: string) => Promise<string[]>;
    fetch: (request: PinnedRequest) => Promise<PinnedResponse>;
    now?: () => number;
}

export async function handleCapabilityBroker(
    body: unknown,
    deps: BrokerDeps
): Promise<{ status: number; body: unknown }> {
    const parsed = parseBody(body);
    if ('error' in parsed) return json(400, parsed.error);
    const { manifest, input, idempotencyKey, secret } = parsed;

    if (manifest.transport.kind !== 'http' || manifest.transport.access !== 'server_broker') {
        return json(400, 'broker only accepts server_broker http capabilities');
    }
    if (manifest.effect === 'write' || manifest.effect === 'destructive') {
        return json(403, 'broker refuses write and destructive capabilities');
    }
    if (manifest.approval !== 'auto') {
        return json(403, 'broker capability is not approved to run');
    }
    if (!allow(manifest.id, deps.now?.() ?? Date.now())) {
        return json(429, 'broker rate limit exceeded');
    }

    let url: URL;
    try {
        url = buildUrl(manifest, input);
    } catch {
        return json(400, 'broker URL could not be built');
    }

    if (manifest.auth.kind === 'apiKey' && manifest.auth.in === 'query' && manifest.auth.name && secret) {
        url.searchParams.set(manifest.auth.name, `${manifest.auth.prefix ?? ''}${secret}`);
    }

    const host = url.hostname.replace(/^\[|\]$/g, '');
    const addresses = isIp(host) ? [host] : await deps.resolve(host).catch(() => []);
    const egress = assessEgress(url, addresses.map(address => ({ address })));
    if (!egress.ok) return json(403, egress.reason);

    const inputDigest = sha256(canonicalize(input));
    const runId = `run_${sha256(`${manifest.digest}|${idempotencyKey}`).slice(0, 16)}`;
    const row: ServerExecution = {
        runId,
        capabilityId: manifest.id,
        manifestDigest: manifest.digest,
        effect: manifest.effect,
        inputDigest,
        idempotencyKey,
        status: 'admitted'
    };
    const admission = await deps.ledger.admit(row);
    if (admission.kind !== 'new') {
        return json(admission.kind === 'conflict' ? 409 : 200, {
            replayed: true,
            executionStatus: admission.row.status,
            runId: admission.row.runId,
            error: admission.kind === 'conflict'
                ? { code: 'IDEMPOTENCY_CONFLICT', message: 'Idempotency key was already used for a different input' }
                : admission.row.error
                    ? { code: admission.row.status === 'uncertain' ? 'EFFECT_UNCERTAIN' : 'UPSTREAM_ERROR', message: admission.row.error }
                    : undefined
        });
    }

    await deps.ledger.markDispatched(admission.row.runId);
    const headers = applyAuth(manifest, secret);
    try {
        const response = await deps.fetch({
            url,
            address: addresses[0],
            method: manifest.transport.method,
            headers,
            signal: undefined,
            maxBytes: MAX_BODY
        });
        if (response.status >= 300 && response.status < 400) {
            await deps.ledger.finish(admission.row.runId, 'failed', 'Redirects are not followed');
            return json(502, { runId: admission.row.runId, executionStatus: 'failed', error: { code: 'HTTP_REDIRECT_REFUSED', message: 'Redirects are not followed' } });
        }
        if (response.status < 200 || response.status >= 300) {
            await deps.ledger.finish(admission.row.runId, 'failed', `HTTP ${response.status}`);
            return json(502, { runId: admission.row.runId, executionStatus: 'failed', error: { code: 'HTTP_ERROR', message: `HTTP ${response.status}` } });
        }
        const value = response.text.trim() === '' ? null : JSON.parse(response.text) as unknown;
        await deps.ledger.finish(admission.row.runId, 'succeeded');
        return json(200, { runId: admission.row.runId, executionStatus: 'succeeded', value });
    } catch (error) {
        const message = scrub(error instanceof Error ? error.message : 'Broker request failed', secret);
        await deps.ledger.finish(admission.row.runId, 'failed', message);
        return json(502, { runId: admission.row.runId, executionStatus: 'failed', error: { code: 'UPSTREAM_ERROR', message } });
    }
}

function parseBody(body: unknown): {
    manifest: CapabilityManifest;
    input: Record<string, unknown>;
    idempotencyKey: string;
    secret?: string;
} | { error: string } {
    if (!body || typeof body !== 'object') return { error: 'broker body must be an object' };
    const record = body as Record<string, unknown>;
    const validated = validateManifest(record.manifest);
    if (!validated.ok || !validated.manifest) return { error: validated.errors.join('; ') };
    if (!record.input || typeof record.input !== 'object' || Array.isArray(record.input)) {
        return { error: 'broker input must be an object' };
    }
    if (typeof record.idempotencyKey !== 'string' || !/^[A-Za-z0-9._~-]{8,128}$/.test(record.idempotencyKey)) {
        return { error: 'broker idempotency key is invalid' };
    }
    const secret = typeof record.secret === 'string' ? record.secret : undefined;
    return {
        manifest: validated.manifest,
        input: record.input as Record<string, unknown>,
        idempotencyKey: record.idempotencyKey,
        ...(secret ? { secret } : {})
    };
}

function buildUrl(manifest: CapabilityManifest, input: Record<string, unknown>): URL {
    if (manifest.transport.kind !== 'http') throw new Error('not http');
    const path = manifest.transport.path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        const value = input[name];
        return encodeURIComponent(value === undefined ? '' : String(value));
    });
    const base = manifest.transport.baseUrl.endsWith('/') ? manifest.transport.baseUrl : `${manifest.transport.baseUrl}/`;
    const url = new URL(path.startsWith('/') ? path.slice(1) : path, base);
    for (const entry of manifest.inputs) {
        if (input[entry.name] === undefined || entry.in !== 'query') continue;
        const value = input[entry.name];
        url.searchParams.set(entry.name, typeof value === 'string' ? value : JSON.stringify(value));
    }
    return url;
}

function applyAuth(manifest: CapabilityManifest, secret: string | undefined): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (manifest.auth.kind === 'none' || !secret) return headers;
    if (manifest.auth.kind === 'bearer') headers.authorization = `Bearer ${secret}`;
    else if (manifest.auth.kind === 'basic') headers.authorization = `Basic ${Buffer.from(secret).toString('base64')}`;
    else if (manifest.auth.kind === 'apiKey' && manifest.auth.name && manifest.auth.in !== 'query') {
        headers[manifest.auth.name] = `${manifest.auth.prefix ?? ''}${secret}`;
    }
    return headers;
}

function allow(capabilityId: string, now: number): boolean {
    const recent = (hits.get(capabilityId) ?? []).filter(at => now - at < WINDOW_MS);
    if (recent.length >= MAX_PER_WINDOW) {
        hits.set(capabilityId, recent);
        return false;
    }
    recent.push(now);
    hits.set(capabilityId, recent);
    return true;
}

function scrub(message: string, secret: string | undefined): string {
    if (!secret || secret.length < 8) return message;
    return message.split(secret).join('[redacted]');
}

function isIp(host: string): boolean {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');
}

function json(status: number, body: unknown): { status: number; body: unknown } {
    return { status, body: typeof body === 'string' ? { error: body } : body };
}
