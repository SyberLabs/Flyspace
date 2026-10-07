// OpenAPI 3.x → CapabilityManifest proposals.
// This compiler does not install anything. A manifest becomes callable only
// after validateManifest + installProposal.

import { looksLikeKey } from './credentialName';
import { canonicalCapabilityId, credentialSlot } from './identity';
import { fromJsonSchema } from './jsonSchema';
import {
    approvalForEffect,
    effectAllowedForMethod,
    effectForMethod,
    isInputHint,
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

export interface CompileIssue {
    operation?: string;
    message: string;
}

export interface CompileResult {
    manifests: CapabilityManifest[];
    errors: CompileIssue[];
}

export interface CompileOptions {
    /**
     * Where the document came from, when the host knows better than the
     * document does: the catalog spec URL for a registry install. Recorded as
     * the manifest's source locator. A pasted document has no such place, so
     * its locator stays `title@version` from the document itself.
     */
    sourceLocator?: string;
}

export function compileOpenApi(spec: unknown, options: CompileOptions = {}): CompileResult {
    const errors: CompileIssue[] = [];
    if (!isRecord(spec)) return { manifests: [], errors: [{ message: 'OpenAPI document must be an object' }] };

    const version = typeof spec.openapi === 'string' ? spec.openapi : '';
    if (!version.startsWith('3.')) {
        return { manifests: [], errors: [{ message: 'only OpenAPI 3.x documents are supported' }] };
    }
    if (!isRecord(spec.paths)) {
        return { manifests: [], errors: [{ message: 'OpenAPI document has no paths' }] };
    }

    const base = resolveBaseUrl(spec);
    if ('error' in base) return { manifests: [], errors: [{ message: base.error }] };

    const locator = options.sourceLocator
        ?? (isRecord(spec.info) && typeof spec.info.title === 'string'
            ? `${spec.info.title}${typeof spec.info.version === 'string' ? `@${spec.info.version}` : ''}`
            : 'openapi');

    const titles = operationTitles(spec.paths);
    const manifests: CapabilityManifest[] = [];
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
            const compiled = compileOperation({
                spec,
                path,
                pathItem,
                method,
                operation,
                operationId,
                label,
                title: titles.get(`${method} ${path}`) ?? label.slice(0, MAX_TITLE),
                baseUrl: base.url,
                locator
            });
            if ('error' in compiled) errors.push({ operation: label, message: compiled.error });
            else manifests.push(compiled.manifest);
        }
    }

    return { manifests, errors };
}

const MAX_TITLE = 120;

/**
 * Every operation's title, decided for the whole document so two operations
 * never share one. A title is the summary, else `operationId`, else
 * `METHOD /path`. Real specs reuse summaries: Visual Crossing's directory spec
 * gives three timeline paths the same summary and no operationId, which
 * installed as three indistinguishable blocks. Where titles collide, each gets
 * the part of its path where the group differs ("· {location}/{startdate}"),
 * and the method if that still is not enough.
 */
function operationTitles(paths: Record<string, unknown>): Map<string, string> {
    const ops: Array<{ key: string; method: HttpMethod; path: string; title: string }> = [];
    for (const [path, pathItem] of Object.entries(paths)) {
        if (!path.startsWith('/') || !isRecord(pathItem)) continue;
        for (const method of METHODS) {
            const operation = pathItem[method.toLowerCase()];
            if (!isRecord(operation)) continue;
            const summary = typeof operation.summary === 'string' ? operation.summary.trim() : '';
            const operationId = typeof operation.operationId === 'string' ? operation.operationId : '';
            ops.push({ key: `${method} ${path}`, method, path, title: summary || operationId || `${method} ${path}` });
        }
    }

    const groups = new Map<string, typeof ops>();
    for (const op of ops) groups.set(op.title, [...(groups.get(op.title) ?? []), op]);

    const titles = new Map<string, string>();
    for (const [base, group] of groups) {
        if (group.length === 1) {
            titles.set(group[0].key, base.slice(0, MAX_TITLE));
            continue;
        }
        const segments = group.map(op => op.path.split('/').filter(Boolean));
        let shared = 0;
        // Only literal segments count as shared: a path parameter is part of
        // what the caller must supply, so it stays in every suffix.
        while (segments.every(s => shared < s.length && s[shared] === segments[0][shared] && !s[shared].startsWith('{'))) shared++;
        const suffixes = group.map((op, i) => segments[i].slice(shared).join('/') || segments[i].at(-1) || '/');
        const suffixCounts = new Map<string, number>();
        for (const suffix of suffixes) suffixCounts.set(suffix, (suffixCounts.get(suffix) ?? 0) + 1);
        group.forEach((op, i) => {
            const tail = suffixCounts.get(suffixes[i])! > 1 ? `${op.method} ${suffixes[i]}` : suffixes[i];
            const room = MAX_TITLE - tail.length - 3;
            titles.set(op.key, `${base.slice(0, Math.max(1, room))} · ${tail}`.slice(0, MAX_TITLE));
        });
    }
    return titles;
}

function compileOperation(args: {
    spec: Record<string, unknown>;
    path: string;
    pathItem: Record<string, unknown>;
    method: HttpMethod;
    operation: Record<string, unknown>;
    operationId?: string;
    label: string;
    /** Decided for the whole spec at once, so same-summary operations get distinct titles. */
    title: string;
    baseUrl: string;
    locator: string;
}): { manifest: CapabilityManifest } | { error: string } {
    const effectChoice = chooseEffect(args.method, args.operation);
    if ('error' in effectChoice) return effectChoice;

    const auth = resolveAuth(args.spec, args.operation, args.baseUrl);
    if ('error' in auth) return auth;

    const inputs = collectInputs(args.spec, args.path, args.pathItem, args.operation, args.method);
    if ('error' in inputs) return inputs;

    const output = collectOutput(args.spec, args.operation);
    if ('error' in output) return output;

    const transport = {
        kind: 'http' as const,
        access: 'browser_direct' as const,
        baseUrl: args.baseUrl,
        method: args.method,
        path: args.path
    };
    const title = args.title;
    const description = typeof args.operation.description === 'string'
        ? args.operation.description.slice(0, 2000)
        : undefined;

    const sealed = sealManifest({
        version: 1,
        id: canonicalCapabilityId(transport),
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
        invocation: 'manual',
        auth: auth.auth,
        transport,
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

function resolveBaseUrl(spec: Record<string, unknown>): { url: string } | { error: string } {
    const servers = Array.isArray(spec.servers) ? spec.servers : [];
    const first = servers.find(isRecord);
    const raw = first && typeof first.url === 'string' ? first.url : '';
    if (!raw || raw.includes('{')) return { error: 'provide a concrete server URL' };
    if (raw.startsWith('/')) return { error: 'relative server URLs are not supported' };
    try {
        const parsed = new URL(raw);
        if (parsed.search || parsed.hash) return { error: 'server URLs cannot carry a query or fragment' };
    } catch {
        return { error: 'provide a concrete server URL' };
    }
    return { url: stripTrailingSlash(raw) };
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

function resolveAuth(
    spec: Record<string, unknown>,
    operation: Record<string, unknown>,
    baseUrl: string
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
        const binding = schemeToAuth(baseUrl, name, scheme);
        if ('error' in binding) continue;
        return binding;
    }
    return { error: 'no supported security scheme (apiKey, http bearer, http basic)' };
}

function schemeToAuth(baseUrl: string, name: string, scheme: Record<string, unknown>): { auth: CapabilityManifest['auth'] } | { error: string } {
    const secretRef = (auth: { kind: 'apiKey' | 'bearer' | 'basic'; in?: 'header' | 'query'; name?: string }) =>
        credentialSlot(baseUrl, auth);
    const placement = scheme.in === 'header' ? 'header' as const : scheme.in === 'query' ? 'query' as const : undefined;
    if (scheme.type === 'apiKey' && placement && typeof scheme.name === 'string') {
        const auth = { kind: 'apiKey' as const, in: placement, name: scheme.name };
        return { auth: { ...auth, secretRef: secretRef(auth) } };
    }
    if (scheme.type === 'http' && scheme.scheme === 'bearer') {
        const auth = { kind: 'bearer' as const };
        return { auth: { ...auth, secretRef: secretRef(auth) } };
    }
    if (scheme.type === 'http' && scheme.scheme === 'basic') {
        const auth = { kind: 'basic' as const };
        return { auth: { ...auth, secretRef: secretRef(auth) } };
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
        if ((location === 'query' || location === 'header') && (converted.schema.kind === 'object' || converted.schema.kind === 'array')) {
            return { error: `${String(parameter.name)}: compound ${location} parameters are outside the supported subset` };
        }
        const name = String(parameter.name);
        const schema = withParameterDescription(converted.schema, parameter.description);
        const hints = looksLikeKey(name) ? {} : inputHints(parameter, deref(spec, parameter.schema));
        inputs.push({
            name,
            in: location,
            required: location === 'path' ? true : parameter.required === true,
            schema,
            ...hints
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

/**
 * Most specs describe a parameter on the parameter object, not its schema.
 * Keep that text with the input, so a field can say what it is for.
 */
function withParameterDescription(schema: ValueType, description: unknown): ValueType {
    if (schema.description || typeof description !== 'string' || description.trim() === '') return schema;
    return { ...schema, description: description.trim().slice(0, 500) };
}

/** A primitive example and default from the spec, where it gives them. */
function inputHints(parameter: Record<string, unknown>, schema: unknown): Pick<CapabilityInput, 'example' | 'default'> {
    const fromSchema = isRecord(schema) ? schema : {};
    const examples = isRecord(parameter.examples) ? Object.values(parameter.examples) : [];
    const firstExample = examples.map(entry => (isRecord(entry) ? entry.value : undefined)).find(value => value !== undefined);
    const example = [parameter.example, fromSchema.example, firstExample].find(isInputHint);
    const fallback = isInputHint(fromSchema.default) ? fromSchema.default : undefined;
    return {
        ...(example !== undefined ? { example } : {}),
        ...(fallback !== undefined ? { default: fallback } : {})
    };
}

function collectOutput(
    spec: Record<string, unknown>,
    operation: Record<string, unknown>
): { output: CapabilityManifest['output'] } | { error: string } {
    const responses = isRecord(operation.responses) ? operation.responses : {};
    const status = Object.keys(responses).filter(code => /^2\d\d$/.test(code)).sort()[0];
    if (!status) return { error: 'operation has no success response' };
    const response = deref(spec, responses[status]);
    if (!isRecord(response)) return { error: 'success response is invalid' };
    if (status === '204' || !isRecord(response.content)) {
        return { output: { schema: { kind: 'null' }, presentation: 'raw' } };
    }
    const json = jsonContent(response.content);
    if (!json) return { error: 'only application/json responses are in the supported subset' };
    if (json.schema === undefined) return { error: 'response schema is required' };
    const converted = fromJsonSchema(json.schema, spec);
    if (!converted.ok) return { error: converted.error };
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
