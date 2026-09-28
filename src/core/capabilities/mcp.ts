// MCP tool schemas compile to the same manifest as OpenAPI.
// Execution stays unbound until a host registers an McpTransport for the
// server id. This module does not open a network connection.

import { canonicalCapabilityId } from './identity';
import { fromJsonSchema } from './jsonSchema';
import {
    approvalForEffect,
    isRecord,
    sealManifest,
    validateManifest,
    type CapabilityEffect,
    type CapabilityInput,
    type CapabilityManifest
} from './manifest';
import type { ValueType } from './valueType';

export interface McpToolAnnotations {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
}

export interface McpToolSchema {
    serverId: string;
    name: string;
    description?: string;
    inputSchema?: unknown;
    outputSchema?: unknown;
    annotations?: McpToolAnnotations;
}

export interface McpCompileResult {
    manifests: CapabilityManifest[];
    errors: Array<{ tool?: string; message: string }>;
}

export interface CompileMcpOptions {
    /** Tool annotations are hints. They classify effect only when the server is trusted. */
    trustedAnnotations?: boolean;
}

export function compileMcpTools(tools: readonly McpToolSchema[], options: CompileMcpOptions = {}): McpCompileResult {
    const manifests: CapabilityManifest[] = [];
    const errors: McpCompileResult['errors'] = [];

    for (const tool of tools) {
        const compiled = compileOne(tool, options.trustedAnnotations === true);
        if ('error' in compiled) errors.push({ tool: tool?.name, message: compiled.error });
        else manifests.push(compiled.manifest);
    }
    return { manifests, errors };
}

function compileOne(tool: McpToolSchema, trustedAnnotations: boolean): { manifest: CapabilityManifest } | { error: string } {
    if (!isRecord(tool) || typeof tool.serverId !== 'string' || typeof tool.name !== 'string') {
        return { error: 'MCP tool needs a serverId and name' };
    }
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(tool.serverId)) return { error: 'serverId is invalid' };
    if (!/^[A-Za-z_][A-Za-z0-9_-]{0,64}$/.test(tool.name)) return { error: 'tool name is invalid' };

    const effect = effectFromAnnotations(tool.annotations, trustedAnnotations);
    const inputs = compileArguments(tool.inputSchema);
    if ('error' in inputs) return inputs;
    const output = compileOutput(tool.outputSchema);
    if ('error' in output) return output;

    const transport = { kind: 'mcp' as const, serverId: tool.serverId, toolName: tool.name };
    const sealed = sealManifest({
        version: 1,
        id: canonicalCapabilityId(transport),
        title: tool.name,
        ...(tool.description ? { description: tool.description.slice(0, 2000) } : {}),
        source: { kind: 'mcp', locator: tool.serverId, operationId: tool.name },
        effect: effect.effect,
        effectSource: trustedAnnotations ? 'annotation' : 'declared',
        approval: approvalForEffect(effect.effect),
        invocation: 'manual',
        auth: { kind: 'none' },
        transport,
        inputs: inputs.inputs,
        output: output
    });
    const validated = validateManifest(sealed);
    if (!validated.ok || !validated.manifest) return { error: validated.errors.join('; ') };
    return { manifest: validated.manifest };
}

function effectFromAnnotations(
    annotations: McpToolAnnotations | undefined,
    trustedAnnotations: boolean
): { effect: CapabilityEffect } {
    if (annotations?.destructiveHint) return { effect: 'destructive' };
    if (trustedAnnotations && annotations?.readOnlyHint) return { effect: 'read' };
    return { effect: 'write' };
}

function compileArguments(schema: unknown): { inputs: CapabilityInput[] } | { error: string } {
    if (schema === undefined) return { inputs: [] };
    const converted = fromJsonSchema(schema);
    if (!converted.ok) return { error: converted.error };
    if (converted.schema.kind !== 'object') {
        return {
            inputs: [{ name: 'args', in: 'argument', required: true, schema: converted.schema }]
        };
    }
    const properties = converted.schema.properties ?? {};
    const required = new Set(converted.schema.required ?? []);
    const inputs = Object.entries(properties).map(([name, child]) => ({
        name,
        in: 'argument' as const,
        required: required.has(name),
        schema: child
    }));
    inputs.sort((a, b) => a.name.localeCompare(b.name));
    return { inputs };
}

function compileOutput(schema: unknown): CapabilityManifest['output'] | { error: string } {
    if (schema === undefined) return { error: 'tool has no output schema' };
    const converted = fromJsonSchema(schema);
    if (!converted.ok) return { error: converted.error };
    return presentationFor(converted.schema);
}

function presentationFor(schema: ValueType): CapabilityManifest['output'] {
    if (schema.kind === 'array') return { schema, presentation: 'items' };
    if (schema.kind === 'string') return { schema, presentation: 'content' };
    return { schema, presentation: 'raw' };
}
