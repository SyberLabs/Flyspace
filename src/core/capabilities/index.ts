export type {
    CapabilityManifest,
    CapabilityEffect,
    CapabilityApproval,
    CapabilityInput,
    CapabilityTransport,
    AuthBinding,
    ManifestDraft
} from './manifest';
export { validateManifest, sealManifest, approvalForEffect, effectForMethod } from './manifest';
export type { ValueType, ValueKind } from './valueType';
export { validateValue, validateValueType, isAssignable } from './valueType';
export { compileOpenApi } from './openapi';
export type { CompileOpenApiOptions, CompileResult } from './openapi';
export { compileMcpTools } from './mcp';
export type { McpToolSchema } from './mcp';
export { compileBring } from './bring';
export type { BringApiDescription } from './bring';
export { capabilitySecrets } from './secrets';
export {
    executeCapability,
    bindMcpTransport,
    unbindMcpTransport,
    bindLocalHandler,
    unbindLocalHandler,
    getLastResult,
    getExecution,
    latestExecution
} from './execute';
export type { CapabilityExecution, ExecutionStatus, LocalCall } from './execute';
export type { McpTransport } from './execute';
export type { CapabilityResult, TypedValue } from './project';
export { explainPortWire, admitConnection } from './compatibility';
export type { WireProjection, ConnectionAdmission } from './compatibility';
export { canonicalCapabilityId, credentialSlot } from './identity';
export {
    installProposal,
    approveCapability,
    denyCapability,
    uninstallCapability,
    listCapabilities,
    getCapability,
    exportSnapshot,
    restoreSnapshot,
    clearCapabilities,
    runInstalledCapability,
    ensureSpeechCapabilities
} from './registry';
export type { CapabilitySnapshot, InstallResult, RestoreReport } from './registry';
export { resolveWiredInputs } from './wireInputs';
export {
    setSpeechEngine,
    getSpeechEngine,
    speechManifests,
    runSpeechHandler,
    openSpeechSession,
    speechObservations
} from './speech';
export type { SpeechEngine, SpeechSupport, SpeechObservation, SpeechSession, SpeechSource } from './speech';
export { useCapabilityStore } from './store';
