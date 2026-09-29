// "Bring your API" accepts a structured description, never free text.
// An agent may fill this in. The same validator used for OpenAPI decides
// whether the proposal is a manifest.

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
import { canonicalCapabilityId, credentialSlot } from './identity';
import type { CompileResult } from './openapi';

export interface BringApiDescription {
    id?: string;
    title: string;
    description?: string;
    baseUrl: string;
    method: HttpMethod;
    path: string;
    effect?: CapabilityEffect;
    auth?: CapabilityManifest['auth'];
    inputs?: CapabilityInput[];
    output: {
        schema: ValueType;
        itemsPath?: string;
        titlePath?: string;
        presentation?: CapabilityManifest['output']['presentation'];
    };
}

export function compileBring(description: BringApiDescription): CompileResult {
    if (!isRecord(description)) {
        return { manifests: [], errors: [{ message: 'description must be an object' }] };
    }
    if (typeof description.title !== 'string' || !description.title.trim()) {
        return { manifests: [], errors: [{ message: 'title is required' }] };
    }
    const method = description.method;
    const effect = description.effect ?? effectForMethod(method);
    if (description.effect && !effectAllowedForMethod(method, effect)) {
        return { manifests: [], errors: [{ message: `${method} cannot be declared ${effect}` }] };
    }

    const provided = description.auth;
    const auth = provided && provided.kind !== 'none'
        ? { ...provided, secretRef: credentialSlot(description.baseUrl, provided) }
        : { kind: 'none' as const };
    const transport = {
        kind: 'http' as const,
        access: 'browser_direct' as const,
        baseUrl: description.baseUrl,
        method,
        path: description.path
    };

    const schema = description.output?.schema;
    const presentation = description.output?.presentation
        ?? (schema?.kind === 'array' ? 'items' : schema?.kind === 'string' ? 'content' : 'raw');

    const sealed = sealManifest({
        version: 1,
        id: canonicalCapabilityId(transport),
        title: description.title.trim().slice(0, 120),
        ...(description.description ? { description: description.description.slice(0, 2000) } : {}),
        source: { kind: 'bring', locator: 'bring' },
        effect,
        effectSource: description.effect ? 'declared' : 'method',
        approval: approvalForEffect(effect),
        invocation: 'manual',
        auth,
        transport,
        inputs: description.inputs ?? [],
        output: {
            schema,
            presentation,
            ...(description.output?.itemsPath ? { itemsPath: description.output.itemsPath } : {}),
            ...(description.output?.titlePath ? { titlePath: description.output.titlePath } : {})
        }
    });

    const validated = validateManifest(sealed);
    if (!validated.ok || !validated.manifest) {
        return { manifests: [], errors: [{ message: validated.errors.join('; ') }] };
    }
    return { manifests: [validated.manifest], errors: [] };
}
