// The explicit decision on managed SaaS vendors as adopted dependencies.
// Omni keeps the managed_integration seam (managedProvider.ts), which can
// describe their catalog entries as candidates. It does not take either SDK.
// Revisit only with a measured OAuth connect and a runtime that keeps
// admission, effect, approval, slots, and receipts in Omni.

export type ManagedVendorDecisionReason =
    | 'no_measured_oauth_connect'
    | 'vendor_becomes_integration_runtime';

export interface ManagedVendorDecision {
    vendor: 'pipedream' | 'composio';
    product: string;
    decision: 'adopt' | 'reject';
    reasons: ManagedVendorDecisionReason[];
    detail: string;
    /** What was actually run. Nothing here was measured against the vendor. */
    measured: false;
    sdkAdded: false;
}

const DETAIL = 'No OAuth connect was performed in this environment (no vendor credentials were present), '
    + 'so there is no measured connect, token refresh, or revocation to rely on. Adopting the SDK would route '
    + 'execution and credentials through the vendor, making it the integration runtime instead of Omni.';

export const managedVendorDecisions: readonly ManagedVendorDecision[] = [
    {
        vendor: 'pipedream',
        product: 'Pipedream Connect',
        decision: 'reject',
        reasons: ['no_measured_oauth_connect', 'vendor_becomes_integration_runtime'],
        detail: DETAIL,
        measured: false,
        sdkAdded: false
    },
    {
        vendor: 'composio',
        product: 'Composio',
        decision: 'reject',
        reasons: ['no_measured_oauth_connect', 'vendor_becomes_integration_runtime'],
        detail: DETAIL,
        measured: false,
        sdkAdded: false
    }
];
