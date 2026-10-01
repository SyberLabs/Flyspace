// Maxun as a web_data provider. It turns a robot description into an
// untrusted async proposal: the host-bound `maxun` runtime starts the robot
// and polls its run. Maxun owns no canvas state, blocks, or wires, and the
// API key is a credential slot admission derives from the runtime id.
//
// Discovery reads robot descriptions the host already holds. Mapping Maxun's
// own robot listing into these descriptions is not implemented: its response
// shape was not observed from a live account in this environment.

import { MAX_ASYNC_DURATION_MS, type CapabilityOutput } from '../manifest';
import type { ValueType } from '../valueType';
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

export const MAXUN_RUNTIME_ID = 'maxun';
export const MAXUN_API_KEY_HEADER = 'x-api-key';
export const MAXUN_PROVIDER_ID = 'maxun';

/** Maxun's documented `run_robot` waits up to 30 minutes, so the profile allows that much. */
export const MAXUN_DEFAULT_PROFILE = { pollIntervalMs: 5_000, maxDurationMs: 30 * 60_000 } as const;

export type MaxunRobotMode = 'scrape' | 'extract';

export interface MaxunRobotDescription {
    id: string;
    name: string;
    description?: string;
    /** Only scrape (markdown) and extract (named text captures) have a typed result. */
    mode: string;
    /** Text capture names an extract robot promises. Required for extract. */
    fields?: string[];
    /** Maxun's last-modified stamp, kept as the source revision. */
    updatedAt?: string;
}

export interface MaxunRobotCatalog {
    listRobots(signal?: AbortSignal): Promise<MaxunRobotDescription[]>;
}

export interface MaxunProviderRequest {
    robots?: MaxunRobotDescription[];
    catalog?: MaxunRobotCatalog;
    /** Where the robots live, for provenance only. Never used as an endpoint. */
    sourceLocator?: string;
    discoveredAtMs?: number;
    signal?: AbortSignal;
    profile?: { pollIntervalMs: number; maxDurationMs: number };
}

const ROBOT_ID = /^[A-Za-z0-9_.-]{1,100}$/;
const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
const MAX_FIELDS = 40;

interface Planned {
    robot: MaxunRobotDescription;
    mode: MaxunRobotMode;
    output: CapabilityOutput;
}

export function maxunOperation(mode: MaxunRobotMode, robotId: string): string {
    return `${mode}:${robotId}`;
}

export function parseMaxunOperation(operation: string): { mode: MaxunRobotMode; robotId: string } | undefined {
    const match = /^(scrape|extract):([A-Za-z0-9_.-]{1,100})$/.exec(operation);
    return match ? { mode: match[1] as MaxunRobotMode, robotId: match[2] } : undefined;
}

export const maxunProvider: CapabilityProvider<MaxunProviderRequest> = {
    id: MAXUN_PROVIDER_ID,
    kind: 'web_data',

    async discover(request, context?: CapabilityDiscoveryContext): Promise<CapabilityDiscovery> {
        const discoveredAtMs = request.discoveredAtMs ?? context?.nowMs ?? Date.now();
        const { planned, issues } = await plan(request);
        const candidates = planned.map((entry): CapabilityCandidateV1 => ({
            version: 1,
            providerId: MAXUN_PROVIDER_ID,
            externalId: entry.robot.id,
            title: entry.robot.name,
            ...(entry.robot.description ? { description: entry.robot.description } : {}),
            sourceKind: 'web_data',
            effectHint: 'read',
            authHint: 'apiKey',
            lifecycleHint: 'async',
            provenance: {
                providerId: MAXUN_PROVIDER_ID,
                sourceLocator: robotLocator(request, entry.robot.id),
                discoveredAtMs
            }
        }));
        return { candidates, issues };
    },

    async materialize(
        candidate: CapabilityCandidateV1,
        context: CapabilityMaterializationContext<MaxunProviderRequest>
    ): Promise<CapabilityProposalV1> {
        const { planned } = await plan(context.request);
        const entry = planned.find(item => item.robot.id === candidate.externalId);
        if (!entry) throw new ProviderMaterializeError(`robot ${candidate.externalId} is not in the catalog`);
        const profile = context.request.profile ?? MAXUN_DEFAULT_PROFILE;
        const locator = robotLocator(context.request, entry.robot.id);
        return {
            version: 1,
            provider: { id: MAXUN_PROVIDER_ID, kind: 'web_data' },
            externalIdentity: {
                operationId: entry.robot.id,
                sourceLocator: locator,
                ...(entry.robot.updatedAt ? { sourceRevision: entry.robot.updatedAt.slice(0, 120) } : {})
            },
            title: entry.robot.name.slice(0, 120),
            ...(entry.robot.description ? { description: entry.robot.description.slice(0, 2000) } : {}),
            // A hint only. Admission lands at write unless the host trusts this runtime.
            effectHint: 'read',
            auth: { kind: 'apiKey', in: 'header', name: MAXUN_API_KEY_HEADER },
            transport: { kind: 'async', runtimeId: MAXUN_RUNTIME_ID, operation: maxunOperation(entry.mode, entry.robot.id) },
            inputs: [],
            output: entry.output,
            execution: {
                kind: 'async_poll',
                pollIntervalMs: profile.pollIntervalMs,
                maxDurationMs: Math.min(profile.maxDurationMs, MAX_ASYNC_DURATION_MS)
            },
            provenance: {
                providerId: MAXUN_PROVIDER_ID,
                sourceLocator: locator,
                discoveredAtMs: candidate.provenance.discoveredAtMs
            }
        };
    }
};

async function plan(request: MaxunProviderRequest): Promise<{ planned: Planned[]; issues: ProviderIssue[] }> {
    const robots = request.robots ?? (request.catalog ? await request.catalog.listRobots(request.signal) : []);
    const planned: Planned[] = [];
    const issues: ProviderIssue[] = [];
    for (const robot of robots) {
        const externalId = typeof robot?.id === 'string' ? robot.id : undefined;
        if (!externalId || !ROBOT_ID.test(externalId)) {
            issues.push({ ...(externalId ? { externalId } : {}), message: 'robot id is not a plain identifier' });
            continue;
        }
        if (typeof robot.name !== 'string' || robot.name.trim().length === 0) {
            issues.push({ externalId, message: 'robot has no name' });
            continue;
        }
        if (robot.mode === 'scrape') {
            planned.push({ robot, mode: 'scrape', output: SCRAPE_OUTPUT });
            continue;
        }
        if (robot.mode === 'extract') {
            const output = extractOutput(robot.fields);
            if ('error' in output) issues.push({ externalId, message: output.error });
            else planned.push({ robot, mode: 'extract', output: output.output });
            continue;
        }
        issues.push({ externalId, message: `robot mode ${String(robot.mode)} has no typed result in Omni` });
    }
    return { planned, issues };
}

const SCRAPE_OUTPUT: CapabilityOutput = {
    schema: {
        kind: 'object',
        properties: { markdown: { kind: 'string' } },
        required: ['markdown'],
        additionalProperties: false
    },
    presentation: 'content'
};

function extractOutput(fields: unknown): { output: CapabilityOutput } | { error: string } {
    if (!Array.isArray(fields) || fields.length === 0) {
        return { error: 'extract robot declares no fields; an untyped result is not admitted as any' };
    }
    if (fields.length > MAX_FIELDS) return { error: `extract robot declares more than ${MAX_FIELDS} fields` };
    const properties: Record<string, ValueType> = {};
    for (const field of fields) {
        if (typeof field !== 'string' || !FIELD_NAME.test(field)) return { error: `field ${String(field)} is not a plain name` };
        properties[field] = { kind: 'string' };
    }
    return {
        output: {
            schema: { kind: 'object', properties, required: Object.keys(properties), additionalProperties: false },
            presentation: 'raw'
        }
    };
}

function robotLocator(request: MaxunProviderRequest, robotId: string): string {
    const base = (request.sourceLocator ?? 'maxun').slice(0, 120);
    return `${base}/robots/${robotId}`.slice(0, 200);
}
