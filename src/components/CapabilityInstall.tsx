'use client';

import { useMemo, useState } from 'react';
import { compileOpenApi } from '@/core/capabilities/openapi';
import { capabilitySecrets } from '@/core/capabilities/secrets';
import { installProposal, approveCapability, denyCapability, uninstallCapability } from '@/core/capabilities/registry';
import { useCapabilityStore } from '@/core/capabilities/store';
import type { CapabilityManifest } from '@/core/capabilities/manifest';

/**
 * The only product door into installProposal.
 * A pasted OpenAPI document is compiled, reviewed, and installed.
 * Secrets go to the session slot. Approval is a separate action.
 */
export function CapabilityInstall() {
    const [open, setOpen] = useState(false);
    const [specText, setSpecText] = useState('');
    const [issues, setIssues] = useState<string[]>([]);
    const [proposals, setProposals] = useState<CapabilityManifest[]>([]);
    const [selected, setSelected] = useState<Record<string, boolean>>({});
    const [secrets, setSecrets] = useState<Record<string, string>>({});
    const installed = useCapabilityStore(state => state.manifests);

    // One slot per origin + scheme + placement, so the first selected manifest
    // that names a slot describes where every value typed into it will go.
    const secretSlots = useMemo(() => {
        const slots = new Map<string, CapabilityManifest>();
        for (const manifest of proposals) {
            if (!selected[manifest.id]) continue;
            const ref = manifest.auth.secretRef;
            if (ref && !slots.has(ref)) slots.set(ref, manifest);
        }
        return slots;
    }, [proposals, selected]);
    const secretRefs = [...secretSlots.keys()];

    const compile = () => {
        let parsed: unknown;
        try {
            parsed = JSON.parse(specText);
        } catch {
            setProposals([]);
            setIssues(['OpenAPI document must be JSON']);
            return;
        }
        const result = compileOpenApi(parsed);
        setProposals(result.manifests);
        setSelected(Object.fromEntries(result.manifests.map(manifest => [manifest.id, true])));
        setIssues(result.errors.map(issue => `${issue.operation ?? 'spec'}: ${issue.message}`));
    };

    const installSelected = () => {
        const missing = secretRefs.filter(ref => !secrets[ref]?.trim() && !capabilitySecrets.get(ref));
        if (missing.length > 0) {
            setIssues(missing.map(ref => `Secret ${ref} is required`));
            return;
        }
        for (const ref of secretRefs) {
            const value = secrets[ref]?.trim();
            if (value) capabilitySecrets.set(ref, value);
        }
        const problems: string[] = [];
        for (const manifest of proposals) {
            if (!selected[manifest.id]) continue;
            const result = installProposal(manifest);
            if (!result.ok) problems.push(`${manifest.title}: ${result.errors.join('; ')}`);
        }
        setSecrets({});
        setIssues(problems);
    };

    return (
        <div className="border-b border-[var(--citadel-border)]">
            <button
                type="button"
                onClick={() => setOpen(value => !value)}
                className="w-full px-4 py-2 text-left text-sm font-medium text-[var(--text-primary)]"
            >
                Bring an API
            </button>
            {open ? (
                <div className="space-y-2 px-4 pb-3">
                    <label className="block text-xs text-[var(--text-muted)]">
                        OpenAPI document
                        <textarea
                            aria-label="OpenAPI document"
                            value={specText}
                            onChange={event => setSpecText(event.target.value)}
                            rows={5}
                            className="mt-1 w-full resize-y rounded border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] p-2 text-xs text-[var(--text-primary)]"
                        />
                    </label>
                    <button type="button" onClick={compile} className="rounded border border-[var(--citadel-border)] px-2 py-1 text-xs">
                        Compile
                    </button>
                    {issues.map(issue => (
                        <p key={issue} className="text-xs text-[var(--truth-red)]">{issue}</p>
                    ))}
                    {proposals.map(manifest => (
                        <label key={manifest.id} className="flex items-start gap-2 text-xs">
                            <input
                                type="checkbox"
                                aria-label={manifest.title}
                                checked={selected[manifest.id] ?? false}
                                onChange={event => setSelected(prev => ({ ...prev, [manifest.id]: event.target.checked }))}
                            />
                            <span>
                                {manifest.title}
                                <span className="ml-1 text-[var(--text-muted)]">{manifest.effect}</span>
                                <Destination manifest={manifest} />
                            </span>
                        </label>
                    ))}
                    {secretRefs.map(ref => (
                        <label key={ref} className="block text-xs text-[var(--text-muted)]">
                            Secret {ref}
                            <Destination manifest={secretSlots.get(ref)!} />
                            <input
                                type="password"
                                aria-label={`Secret ${ref}`}
                                value={secrets[ref] ?? ''}
                                autoComplete="off"
                                onChange={event => setSecrets(prev => ({ ...prev, [ref]: event.target.value }))}
                                className="mt-1 w-full rounded border border-[var(--citadel-border)] bg-[var(--citadel-elevated)] p-1 text-xs"
                            />
                        </label>
                    ))}
                    {proposals.length > 0 ? (
                        <button type="button" onClick={installSelected} className="rounded border border-[var(--citadel-border)] px-2 py-1 text-xs">
                            Install selected
                        </button>
                    ) : null}
                    <InstalledList
                        installed={installed.filter(manifest => manifest.source.locator !== 'speech')}
                    />
                </div>
            ) : null}
        </div>
    );
}

/**
 * Where a request, and the credential on it, will go: the origin the manifest
 * will call and the auth kind and placement as the manifest carries them.
 * A pasted document chooses both, so the title alone must not stand for them.
 */
function Destination({ manifest }: { manifest: CapabilityManifest }) {
    const { auth, transport } = manifest;
    if (transport.kind !== 'http') return null;
    const origin = new URL(transport.baseUrl).origin;
    const placement = [auth.kind, auth.in ? `in ${auth.in}` : null, auth.name ?? null].filter(Boolean).join(' ');
    return (
        <span className="block text-[var(--text-muted)]">
            {origin}
            {auth.kind !== 'none' ? <span className="ml-1">· {placement}</span> : null}
            {auth.in === 'query' ? (
                <span className="ml-1 text-[var(--truth-red)]">Key travels in the URL</span>
            ) : null}
        </span>
    );
}

function InstalledList({ installed }: { installed: CapabilityManifest[] }) {
    if (installed.length === 0) return null;
    return (
        <ul className="space-y-1">
            {installed.map(manifest => {
                const sideEffect = manifest.effect === 'write' || manifest.effect === 'destructive';
                return (
                    <li key={manifest.id} className="text-xs">
                        <span>{manifest.title}</span>
                        <span className="ml-1 text-[var(--text-muted)]">{manifest.effect} · {manifest.approval}</span>
                        {sideEffect && manifest.approval !== 'approved' ? (
                            <button type="button" className="ml-2 underline" onClick={() => approveCapability(manifest.id)}>
                                Approve {manifest.title}
                            </button>
                        ) : null}
                        {sideEffect && manifest.approval !== 'denied' ? (
                            <button type="button" className="ml-2 underline" onClick={() => denyCapability(manifest.id)}>
                                Deny {manifest.title}
                            </button>
                        ) : null}
                        <button type="button" className="ml-2 underline" onClick={() => uninstallCapability(manifest.id)}>
                            Remove {manifest.title}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
