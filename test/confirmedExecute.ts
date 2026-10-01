// Test-only. Write and destructive runs dispatch only with the digest of the
// request a person confirmed. Engine tests that exercise what happens AFTER
// that confirmation use this wrapper: it confirms exactly the preview the
// engine would show for the same input, and nothing else. It lives outside
// src/ so no product path can import it.

import {
    executeCapability as executeUnconfirmed,
    previewCapabilityRun,
    type ExecuteOptions
} from '@/core/capabilities/execute';

export function executeConfirmed(
    capabilityId: string,
    input: Record<string, unknown> = {},
    options: ExecuteOptions = {}
): ReturnType<typeof executeUnconfirmed> {
    const preview = previewCapabilityRun(capabilityId, input);
    return executeUnconfirmed(capabilityId, input, {
        ...(preview.ok ? { confirmedRun: preview.preview.digest } : {}),
        ...options
    });
}
