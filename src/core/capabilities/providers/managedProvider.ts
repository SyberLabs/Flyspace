// Managed SaaS catalogs (Pipedream Connect, Composio, or successors) as a
// managed_integration provider. A catalog entry is a candidate description,
// not a dependency: Omni calls the SaaS API directly over http with an oauth
// slot, so no vendor SDK or vendor proxy becomes the integration runtime.
// The token reaches the slot through a host connect flow this module does not
// implement. Until the slot is bound, execution is AUTH_UNBOUND.
//
// See managed.decision.ts for why neither vendor is adopted.

import type { CapabilityEffect, CapabilityInput, CapabilityOutput, HttpMethod } from '../manifest';
import type {
    CapabilityCandidateV1,
    CapabilityDiscovery,
    CapabilityDiscoveryContext,
    CapabilityMaterializationContext,
    CapabilityProposalV1,
    CapabilityProvider,
    ProviderIssue
} from '../provider';
import { ProviderMaterializeError } from '../provider';

export const MANAGED_PROVIDER_ID = 'managed';

export type ManagedVendor = 'pipedream' | 'composio';

export interface ManagedActionDescription {
    vendor: ManagedVendor;
    /** The vendor's app slug, e.g. google_sheets. */
    app: string;
    /** The vendor's action or tool key. Provenance only. */
    actionKey: string;
    title: string;
    description?: string;
    method: HttpMethod;
    baseUrl: string;
    path: string;
    oauth: { scopes: string[] };
    inputs: CapabilityInput[];
    output: CapabilityOutput;
    /** A hint. Admission applies the method floor and refuses anything below it. */
    effectHint?: CapabilityEffect;
    version?: string;
}

export interface ManagedProviderRequest {
    actions: ManagedActionDescription[];
    discoveredAtMs?: number;
}

const KEY_PART = /^[A-Za-z0-9_.-]{1,50}$/;

export function managedExternalId(action: Pick<ManagedActionDescription, 'vendor' | 'app' | 'actionKey'>): string {
    return `${action.vendor}:${action.app}:${action.actionKey}`;
}

export const managedProvider: CapabilityProvider<ManagedProviderRequest> = {
    id: MANAGED_PROVIDER_ID,
    kind: 'managed_integration',

    async discover(request, context?: CapabilityDiscoveryContext): Promise<CapabilityDiscovery> {
        const discoveredAtMs = request.discoveredAtMs ?? context?.nowMs ?? Date.now();
        const { accepted, issues } = screen(request.actions);
        const candidates = accepted.map((action): CapabilityCandidateV1 => ({
            version: 1,
            providerId: MANAGED_PROVIDER_ID,
            externalId: managedExternalId(action),
            title: action.title,
            ...(action.description ? { description: action.description } : {}),
            sourceKind: 'managed_integration',
            origin: new URL(action.baseUrl).origin,
            ...(action.effectHint ? { effectHint: action.effectHint } : {}),
            authHint: 'oauth',
            lifecycleHint: 'sync',
            provenance: { providerId: MANAGED_PROVIDER_ID, sourceLocator: locator(action), discoveredAtMs }
        }));
        return { candidates, issues };
    },

    async materialize(
        candidate: CapabilityCandidateV1,
        context: CapabilityMaterializationContext<ManagedProviderRequest>
    ): Promise<CapabilityProposalV1> {
        const { accepted } = screen(context.request.actions);
        const action = accepted.find(entry => managedExternalId(entry) === candidate.externalId);
        if (!action) throw new ProviderMaterializeError(`${candidate.externalId} is not in the catalog`);
        return {
            version: 1,
            provider: { id: MANAGED_PROVIDER_ID, kind: 'managed_integration' },
            externalIdentity: {
                origin: new URL(action.baseUrl).origin,
                operationId: candidate.externalId,
                sourceLocator: locator(action),
                ...(action.version ? { sourceRevision: action.version.slice(0, 120) } : {})
            },
            title: action.title.slice(0, 120),
            ...(action.description ? { description: action.description.slice(0, 2000) } : {}),
            ...(action.effectHint ? { effectHint: action.effectHint } : {}),
            auth: { kind: 'oauth', scopes: [...action.oauth.scopes] },
            transport: {
                kind: 'http',
                access: 'browser_direct',
                baseUrl: action.baseUrl,
                method: action.method,
                path: action.path
            },
            inputs: action.inputs.map(entry => ({ ...entry })),
            output: { ...action.output },
            execution: { kind: 'sync' },
            provenance: {
                providerId: MANAGED_PROVIDER_ID,
                sourceLocator: locator(action),
                discoveredAtMs: candidate.provenance.discoveredAtMs
            }
        };
    }
};

function screen(actions: ManagedActionDescription[]): { accepted: ManagedActionDescription[]; issues: ProviderIssue[] } {
    const accepted: ManagedActionDescription[] = [];
    const issues: ProviderIssue[] = [];
    for (const action of actions) {
        const externalId = managedExternalId(action);
        if (![action.app, action.actionKey].every(part => typeof part === 'string' && KEY_PART.test(part))) {
            issues.push({ externalId, message: 'app and action keys must be plain identifiers' });
            continue;
        }
        if (action.vendor !== 'pipedream' && action.vendor !== 'composio') {
            issues.push({ externalId, message: 'unknown managed vendor' });
            continue;
        }
        if (!Array.isArray(action.oauth?.scopes) || action.oauth.scopes.length === 0) {
            issues.push({ externalId, message: 'managed actions must name their oauth scopes' });
            continue;
        }
        let url: URL;
        try {
            url = new URL(action.baseUrl);
        } catch {
            issues.push({ externalId, message: 'baseUrl is not a URL' });
            continue;
        }
        if (url.protocol !== 'https:') {
            issues.push({ externalId, message: 'managed actions call the SaaS API over https' });
            continue;
        }
        accepted.push(action);
    }
    return { accepted, issues };
}

function locator(action: ManagedActionDescription): string {
    return `${action.vendor}:${action.app}/${action.actionKey}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// Canned catalog entries. Their shape is Omni's; the vendor, app, and action
// labels say which catalog each stands in for. They were written by hand, not
// fetched from either vendor.
// ---------------------------------------------------------------------------

export const MANAGED_FIXTURE_READ: ManagedActionDescription = {
    vendor: 'pipedream',
    app: 'google_sheets',
    actionKey: 'get-values-in-range',
    title: 'Read a range from a Google Sheet',
    method: 'GET',
    baseUrl: 'https://sheets.googleapis.com/v4',
    path: '/spreadsheets/{spreadsheetId}/values/{range}',
    oauth: { scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] },
    inputs: [
        { name: 'spreadsheetId', in: 'path', required: true, schema: { kind: 'string' } },
        { name: 'range', in: 'path', required: true, schema: { kind: 'string' } }
    ],
    output: {
        schema: {
            kind: 'object',
            properties: {
                range: { kind: 'string' },
                majorDimension: { kind: 'string' },
                values: { kind: 'array', items: { kind: 'array', items: { kind: 'string' } } }
            },
            required: ['range', 'values']
        },
        itemsPath: 'values',
        presentation: 'items'
    },
    version: 'fixture-1'
};

export const MANAGED_FIXTURE_WRITE: ManagedActionDescription = {
    vendor: 'composio',
    app: 'slack',
    actionKey: 'send-message',
    title: 'Post a Slack message',
    method: 'POST',
    baseUrl: 'https://slack.com/api',
    path: '/chat.postMessage',
    oauth: { scopes: ['chat:write'] },
    inputs: [
        {
            name: 'message',
            in: 'body',
            required: true,
            schema: {
                kind: 'object',
                properties: { channel: { kind: 'string' }, text: { kind: 'string' } },
                required: ['channel', 'text'],
                additionalProperties: false
            }
        }
    ],
    output: {
        schema: {
            kind: 'object',
            properties: { ok: { kind: 'boolean' }, ts: { kind: 'string' }, channel: { kind: 'string' } },
            required: ['ok']
        },
        presentation: 'raw'
    },
    version: 'fixture-1'
};
