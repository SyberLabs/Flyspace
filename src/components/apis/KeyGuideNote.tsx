'use client';

import { useState } from 'react';
import type { KeyGuide } from '@/core/capabilities/keyGuide';
import { testKey } from '@/core/capabilities/keyGuide';
import { useCapabilityStore } from '@/core/capabilities/store';
import type { CapabilityManifest } from '@/core/capabilities/manifest';

/** The host a guide link goes to, shown so a person knows where they are sent. */
function hostOf(url: string): string {
    try {
        const parsed = new URL(url);
        return `${parsed.host}${parsed.pathname === '/' ? '' : parsed.pathname}`;
    } catch {
        return url;
    }
}

/**
 * Where to get the key and what it costs, under a key field. A link from the
 * spec says so; a guide written from the provider's pages adds what signing
 * up asks for, the free tier, and any limit worth knowing first.
 */
export function KeyGuideNote({ guide }: { guide: KeyGuide }) {
    return (
        <div className="space-y-0.5 text-[10px] leading-snug text-[var(--text-secondary)]" data-testid="key-guide">
            <a
                href={guide.url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 font-medium text-[var(--citadel-primary)] underline"
            >
                Get a key at {hostOf(guide.url)} ↗
            </a>
            {guide.source === 'spec' ? (
                <p className="text-[var(--text-muted)]">Link from the API&apos;s own description.</p>
            ) : (
                <>
                    <p>{guide.requires}</p>
                    {guide.freeTier ? <p>Free tier: {guide.freeTier}</p> : null}
                    {guide.caveat ? <p className="text-[var(--truth-amber)]">{guide.caveat}</p> : null}
                </>
            )}
        </div>
    );
}

/**
 * Run the guide's cheap read with the key in the session, and say whether it
 * worked. Only for an installed API whose guide names a test.
 */
export function TestKeyButton({ guide, manifest }: { guide: KeyGuide; manifest: CapabilityManifest }) {
    const manifests = useCapabilityStore(state => state.manifests);
    const [state, setState] = useState<{ running: boolean; result?: { ok: boolean; message: string } }>({ running: false });
    if (!guide.test) return null;
    const installedId = (operationId: string) => manifests.find(m =>
        m.source.locator === manifest.source.locator && m.source.operationId === operationId)?.id;
    const ready = installedId(guide.test.operationId) !== undefined;

    return (
        <span className="inline-flex flex-wrap items-center gap-2">
            <button
                type="button"
                disabled={!ready || state.running}
                title={ready ? undefined : 'Install the operation the test uses first'}
                onClick={async () => {
                    setState({ running: true });
                    setState({ running: false, result: await testKey(guide, installedId) });
                }}
                className="rounded border border-[var(--citadel-border)] px-2 py-0.5 hover:bg-[var(--citadel-elevated)] disabled:opacity-50"
            >
                {state.running ? 'Testing…' : 'Test key'}
            </button>
            {state.result ? (
                <span role="status" className={state.result.ok ? 'text-[var(--truth-green)]' : 'text-[var(--truth-red)] [overflow-wrap:anywhere]'}>
                    {state.result.ok ? '✓ ' : ''}{state.result.message}
                </span>
            ) : null}
        </span>
    );
}
