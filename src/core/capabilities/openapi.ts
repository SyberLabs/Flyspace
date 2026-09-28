// OpenAPI 3.x → CapabilityManifest proposals.
// This compiler does not install anything. A manifest becomes callable only
// after validateManifest + installProposal.

import { fromJsonSchema } from './jsonSchema';
import {
    approvalForEffect,
    effectAllowedForMethod,
    effectForMethod,
    isRecord,
    sealManifest,
    validateManifest,
    type CapabilityEffect,
    type CapabilityInput,
    type CapabilityManifest,
    type HttpMethod
} from './manifest';
import type { ValueType } from './valueType';

const METHODS: HttpMethod[] = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'];
const MAX_OPERATIONS = 100;

export interface CompileOpenApiOptions {
    baseUrl?: string;
    /** operationIds to keep. Omit to compile every supported operation. */
    include?: string[];
    locator?: string;
}

export interface CompileIssue {
    operation?: string;
    message: string;
}

export interface CompileResult {
    manifests: CapabilityManifest[];
    errors: CompileIssue[];
}

export function compileOpenApi(spec: unknown, options: CompileOpenApiOptions = {}): CompileResult {
    const errors: CompileIssue[] = [];
    if (!isRecord(spec)) return { manifests: [], errors: [{ message: 'OpenAPI document must be an object' }] };

    const version = typeof spec.openapi === 'string' ? spec.openapi : '';
    if (!version.startsWith('3.')) {
        return { manifests: [], errors: [{ message: 'only OpenAPI 3.x documents are supported' }] };
    }
    if (!isRecord(spec.paths)) {
        return { manifests: [], errors: [{ message: 'OpenAPI document has no paths' }] };
    }

    const base = resolveBaseUrl(spec, options.baseUrl);
    if ('error' in base) return { manifests: [], errors: [{ message: base.error }] };

    const locator = options.locator
        ?? (isRecord(spec.info) && typeof spec.info.title === 'string'
            ? `${spec.info.title}${typeof spec.info.version === 'string' ? `@${spec.info.version}` : ''}`
            : 'openapi');

    const manifests: CapabilityManifest[] = [];
    const usedIds = new Set<string>();
    let count = 0;

    for (const [path, pathItem] of Object.entries(spec.paths)) {
        if (!path.startsWith('/') || !isRecord(pathItem)) continue;
        for (const method of METHODS) {
            const operation = pathItem[method.toLowerCase()];
            if (!isRecord(operation)) continue;
            count += 1;
            if (count > MAX_OPERATIONS) {
                errors.push({ message: `stopped after ${MAX_OPERATIONS} operations` });
                return { manifests, errors };
            }
            const operationId = typeof operation.operationId === 'string' ? operation.operationId : undefined;
            const label = operationId ?? `${method} ${path}`;
            if (options.include && !options.include.includes(operationId ?? label) && !options.include.includes(label)) {
                continue;
            }
            const compiled = compileOperation({
                spec,
                path,
                pathItem,
                method,
                operation,
                operationId,
                label,
                baseUrl: base.url,
                locator,
                usedIds
            });
            if ('error' in compiled) errors.push({ operation: label, message: compiled.error });
            else manifests.push(compiled.manifest);
        }
    }

    return { manifests, errors };
}

function compileOperation(args: {
    spec: Record<string, unknown>;
    path: string;
    pathItem: Record<string, unknown>;
    method: HttpMethod;
    operation: Record<string, unknown>;
    operationId?: string;
    label: string;
    baseUrl: string;
    locator: string;
    usedIds: Set<string>;
}): { manifest: CapabilityManifest } | { error: string } {
    const effectChoice = chooseEffect(args.method, args.operation);
    if ('error' in effectChoice) return effectChoice;

    const auth = resolveAuth(args.spec, args.operation);
    if ('error' in auth) return auth;

    const inputs = collectInputs(args.spec, args.path, args.pathItem, args.operation, args.method);
    if ('error' in inputs) return inputs;

    const output = collectOutput(args.spec, args.operation);
    if ('error' in output) return output;

    const id = uniqueId(args.operationId ?? `${args.method}_${args.path}`, args.usedIds);
    const title = typeof args.operation.summary === 'string' && args.operation.summary.trim()
        ? args.operation.summary.trim().slice(0, 120)
        : args.label.slice(0, 120);
    const description = typeof args.operation.description === 'string'
        ? args.operation.description.slice(0, 2000)
        : undefined;

    const sealed = sealManifest({
        version: 1,
        id,
        title,
        ...(description ? { description } : {}),
        source: {
            kind: 'openapi',
            locator: args.locator.slice(0, 200),
            ...(args.operationId ? { operationId: args.operationId } : {})
        },
        effect: effectChoice.effect,
        effectSource: effectChoice.source,
        approval: approvalForEffect(effectChoice.effect),
        auth: auth.auth,
        transport: { kind: 'http', baseUrl: args.baseUrl, method: args.method, path: args.path },
        inputs: inputs.inputs,
        output: output.output
    });

    const validated = validateManifest(sealed);
    if (!validated.ok || !validated.manifest) {
        return { error: validated.errors.join('; ') };
    }
    return { manifest: validated.manifest };
}

function chooseEffect(
    method: HttpMethod,
    operation: Record<string, unknown>
): { effect: CapabilityEffect; source: 'method' | 'extension' } | { error: string } {
    const extension = operation['x-omni-effect'];
    if (extension === undefined) return { effect: effectForMethod(method), source: 'method' };
    if (extension !== 'read' && extension !== 'compute' && extension !== 'write' && extension !== 'destructive') {
        return { error: 'x-omni-effect must be read, compute, write, or destructive' };
    }
    if (!effectAllowedForMethod(method, extension)) {
        return { error: `${method} cannot be declared ${extension}` };
    }
    return { effect: extension, source: 'extension' };
}

function resolveBaseUrl(spec: Record<string, unknown>, override?: string): { url: string } | { error: string } {
    if (override) return { url: stripTrailingSlash(override) };
    const servers = Array.isArray(spec.servers) ? spec.servers : [];
    const first = servers.find(isRecord);
    const raw = first && typeof first.url === 'string' ? first.url : '';
    if (!raw || raw.includes('{')) return { error: 'provide a concrete server URL or baseUrl option' };
    if (raw.startsWith('/')) return { error: 'relative server URLs need a baseUrl option' };
    return { url: stripTrailingSlash(raw) };
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function resolveAuth(
    spec: Record<string, unknown>,
    operation: Record<string, unknown>
): { auth: CapabilityManifest['auth'] } | { error: string } {
    const requirements = operation.security !== undefined ? operation.security : spec.security;
    if (!Array.isArray(requirements) || requirements.length === 0) return { auth: { kind: 'none' } };

    const schemes = isRecord(spec.components) && isRecord(spec.components.securitySchemes)
        ? spec.components.securitySchemes
        : {};

    for (const requirement of requirements) {
        if (!isRecord(requirement)) continue;
        const names = Object.keys(requirement);
        if (names.length !== 1) return { error: 'requirements that combine several schemes are unsupported' };
        const name = names[0];
        const scheme = schemes[name];
        if (!isRecord(scheme)) return { error: `security scheme ${name} is not defined` };
        const binding = schemeToAuth(name, scheme);
        if ('error' in binding) continue;
        return binding;
    }
    return { error: 'no supported security scheme (apiKey, http bearer, http basic)' };
}

function schemeToAuth(name: string, scheme: Record<string, unknown>): { auth: CapabilityManifest['auth'] } | { error: string } {
    const secretRef = `auth_${slug(name)}`;
    if (scheme.type === 'apiKey' && (scheme.in === 'header' || scheme.in === 'query') && typeof scheme.name === 'string') {
        return { auth: { kind: 'apiKey', in: scheme.in, name: scheme.name, secretRef } };
    }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        return { auth: { kind: 'bearer', secretRef } };
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
        return { auth: { kind: 'basic', secretRef } };
    }
    return { error: `unsupported scheme ${name}` };
}

function collectInputs(
    spec: Record<string, unknown>,
    path: string,
    pathItem: Record<string, unknown>,
    operation: Record<string, unknown>,
    method: HttpMethod
): { inputs: CapabilityInput[] } | { error: string } {
    const parameters = [
        ...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : [])
    ];
    const byKey = new Map<string, Record<string, unknown>>();
    for (const parameter of parameters) {
        const resolved = deref(spec, parameter);
        if (!isRecord(resolved) || typeof resolved.name !== 'string' || typeof resolved.in !== 'string') {
            return { error: 'parameter is missing name or in' };
        }
        if (resolved.in === 'cookie') return { error: 'cookie parameters are unsupported' };
        if (resolved.style && resolved.style !== 'simple' && resolved.style !== 'form') {
            return { error: `parameter style ${String(resolved.style)} is unsupported` };
        }
        byKey.set(`${resolved.in}:${resolved.name}`, resolved);
    }

    const inputs: CapabilityInput[] = [];
    for (const parameter of byKey.values()) {
        const location = parameter.in;
        if (location !== 'path' && location !== 'query' && location !== 'header') {
            return { error: `parameter location ${String(location)} is unsupported` };
        }
        const converted = fromJsonSchema(isRecord(parameter.schema) || Array.isArray(parameter.schema) ? parameter.schema : { type: 'string' }, spec);
        if (!converted.ok) return { error: `${String(parameter.name)}: ${converted.error}` };
        inputs.push({
            name: String(parameter.name),
            in: location,
            required: location === 'path' ? true : parameter.required === true,
            schema: converted.schema
        });
    }

    if (isRecord(operation.requestBody)) {
        if (method === 'GET' || method === 'HEAD') return { error: `${method} cannot declare a request body` };
        const body = deref(spec, operation.requestBody);
        if (!isRecord(body)) return { error: 'requestBody is invalid' };
        const content = isRecord(body.content) ? body.content : {};
        const json = jsonContent(content);
        if (!json) return { error: 'requestBody must be application/json' };
        const converted = fromJsonSchema(json.schema ?? { type: 'object' }, spec);
        if (!converted.ok) return { error: `requestBody: ${converted.error}` };
        inputs.push({
            name: 'body',
            in: 'body',
            required: body.required === true,
            schema: converted.schema
        });
    }

    inputs.sort((a, b) => a.in.localeCompare(b.in) || a.name.localeCompare(b.name));
    return { inputs };
}

function collectOutput(
    spec: Record<string, unknown>,
    operation: Record<string, unknown>
): { output: CapabilityManifest['output'] } | { error: string } {
    const responses = isRecord(operation.responses) ? operation.responses : {};
    const status = Object.keys(responses).filter(code => /^2\d\d$/.test(code)).sort()[0];
    if (!status) {
        return { output: { schema: { kind: 'any' }, presentation: 'raw' } };
    }
    const response = deref(spec, responses[status]);
    if (!isRecord(response)) return { error: 'success response is invalid' };
    if (status === '204' || !isRecord(response.content)) {
        return { output: { schema: { kind: 'null' }, presentation: 'raw' } };
    }
    const json = jsonContent(response.content);
    if (!json) {
        return { output: { schema: { kind: 'any' }, presentation: 'raw' } };
    }
    const converted = fromJsonSchema(json.schema ?? {}, spec);
    if (!converted.ok) {
        return { output: { schema: { kind: 'any', description: converted.error }, presentation: 'raw' } };
    }
    return { output: presentationFor(converted.schema) };
}

function jsonContent(content: Record<string, unknown>): Record<string, unknown> | undefined {
    const exact = content['application/json'];
    if (isRecord(exact)) return exact;
    const key = Object.keys(content).find(entry => entry.includes('json'));
    return key && isRecord(content[key]) ? content[key] as Record<string, unknown> : undefined;
}

function presentationFor(schema: ValueType): CapabilityManifest['output'] {
    if (schema.kind === 'array') return { schema, presentation: 'items' };
    if (schema.kind === 'string') return { schema, presentation: 'content' };
    if (schema.kind === 'object') {
        const props = schema.properties ?? {};
        if (props.items) return { schema, presentation: 'items', itemsPath: 'items', titlePath: 'title' };
        if (props.title || props.name) return { schema, presentation: 'items', titlePath: props.title ? 'title' : 'name' };
    }
    return { schema, presentation: 'raw' };
}

function deref(spec: Record<string, unknown>, value: unknown): unknown {
    if (!isRecord(value) || typeof value.$ref !== 'string' || !value.$ref.startsWith('#/')) return value;
    const parts = value.$ref.slice(2).split('/');
    let current: unknown = spec;
    for (const part of parts) {
        if (!isRecord(current)) return value;
        current = current[part];
    }
    return current ?? value;
}

function uniqueId(seed: string, used: Set<string>): string {
    const base = `cap_${slug(seed)}`.slice(0, 84);
    let id = base;
    let n = 2;
    while (used.has(id)) {
        id = `${base.slice(0, 76)}_${n}`;
        n += 1;
    }
    used.add(id);
    return id;
}

export function slug(value: string): string {
    const out = value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return out.slice(0, 60) || 'op';
}
