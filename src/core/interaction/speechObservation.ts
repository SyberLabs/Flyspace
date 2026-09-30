// SpeechObservation v1 and the SpeechAdapter seam.
// A provider produces evidence. OmniOS owns the session, the ids, and every effect.

export interface SpeechProvenance {
    adapterId: string;
    providerName?: string;
    model?: string;
    revision?: string;
}

export interface SpeechAlternative {
    transcript: string;
    confidence?: number;
}

export interface SpeechObservationV1 {
    version: 1;
    sessionId: string;
    observationId: string;
    provider: SpeechProvenance;
    locale?: string;
    startedAtMs: number;
    endedAtMs?: number;
    receivedAtMs: number;
    transcript: string;
    final: boolean;
    /** Advisory. Never a reason to skip validation. */
    confidence?: number;
    alternatives?: SpeechAlternative[];
    source: 'microphone';
}

export interface SpeechAdapterStartInput {
    sessionId: string;
    locale?: string;
    signal: AbortSignal;
    onObservation(observation: SpeechObservationV1): void;
}

export interface SpeechCapture {
    /** Shown while listening so a remote provider is never mistaken for a local one. */
    readonly provider: SpeechProvenance;
    /** `browser` means the browser decides where audio goes; `remote` means OmniOS streams it to a provider. */
    readonly transport: 'browser' | 'remote' | 'synthetic';
    /** Ends capture and resolves the one final observation, or null when nothing was heard. */
    stop(): Promise<SpeechObservationV1 | null>;
    /** Drops the microphone. No observation follows a cancel. */
    cancel(): Promise<void>;
}

export interface SpeechAdapter {
    readonly id: string;
    /** `synthetic` adapters are scripts and fixtures. Their timings are never measurements. */
    readonly captureKind: 'live' | 'synthetic';
    start(input: SpeechAdapterStartInput): Promise<SpeechCapture>;
}

export type SpeechErrorCode =
    | 'unsupported'
    | 'unconfigured'
    | 'permission-denied'
    | 'no-microphone'
    | 'network'
    | 'disconnected'
    | 'timeout'
    | 'aborted'
    | 'provider-error';

export class SpeechAdapterError extends Error {
    constructor(readonly code: SpeechErrorCode, message: string = SPEECH_ERROR_MESSAGES[code]) {
        super(message);
        this.name = 'SpeechAdapterError';
    }
}

export const SPEECH_ERROR_MESSAGES: Record<SpeechErrorCode, string> = {
    unsupported: 'This browser has no speech recognition.',
    unconfigured: 'Remote transcription is not configured.',
    'permission-denied': 'Microphone permission was refused.',
    'no-microphone': 'No microphone is available.',
    network: 'Speech recognition needs a network connection.',
    disconnected: 'The speech provider disconnected.',
    timeout: 'The speech provider did not finish in time.',
    aborted: 'Listening was cancelled.',
    'provider-error': 'Speech recognition failed.'
};

export function normalizeSpeechError(error: unknown): SpeechAdapterError {
    if (error instanceof SpeechAdapterError) return error;
    if (error && typeof error === 'object' && 'name' in error) {
        const name = String((error as { name: unknown }).name);
        if (name === 'NotAllowedError' || name === 'SecurityError') return new SpeechAdapterError('permission-denied');
        if (name === 'NotFoundError' || name === 'OverconstrainedError') return new SpeechAdapterError('no-microphone');
        if (name === 'AbortError') return new SpeechAdapterError('aborted');
    }
    return new SpeechAdapterError('provider-error');
}

let sessionSequence = 0;

/** Session ids are minted by OmniOS on press, never taken from a provider. */
export function createSpeechSessionId(): string {
    sessionSequence += 1;
    const random = globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2);
    return `omni-speech-${sessionSequence}-${random}`;
}

export const MAX_TRANSCRIPT_CHARS = 2000;

const OBSERVATION_KEYS = new Set([
    'version', 'sessionId', 'observationId', 'provider', 'locale', 'startedAtMs', 'endedAtMs',
    'receivedAtMs', 'transcript', 'final', 'confidence', 'alternatives', 'source'
]);
const PROVENANCE_KEYS = new Set(['adapterId', 'providerName', 'model', 'revision']);
const ALTERNATIVE_KEYS = new Set(['transcript', 'confidence']);

function onlyKeys(value: object, allowed: Set<string>): boolean {
    return Object.keys(value).every(key => allowed.has(key));
}

function nonEmpty(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
}

function optionalString(value: unknown): boolean {
    return value === undefined || nonEmpty(value);
}

function finite(value: unknown): value is number {
    return typeof value === 'number' && Number.isFinite(value);
}

function unitInterval(value: unknown): boolean {
    return value === undefined || (finite(value) && value >= 0 && value <= 1);
}

/** Strict shape check. Extra fields (raw audio included) are rejected, not ignored. */
export function isSpeechObservationV1(value: unknown): value is SpeechObservationV1 {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const candidate = value as Record<string, unknown>;
    if (!onlyKeys(candidate, OBSERVATION_KEYS)) return false;
    if (candidate.version !== 1 || candidate.source !== 'microphone') return false;
    if (!nonEmpty(candidate.sessionId) || !nonEmpty(candidate.observationId)) return false;
    const provider = candidate.provider;
    if (!provider || typeof provider !== 'object' || Array.isArray(provider)) return false;
    const provenance = provider as Record<string, unknown>;
    if (!onlyKeys(provenance, PROVENANCE_KEYS) || !nonEmpty(provenance.adapterId)) return false;
    if (!optionalString(provenance.providerName) || !optionalString(provenance.model) || !optionalString(provenance.revision)) return false;
    if (!optionalString(candidate.locale)) return false;
    if (!finite(candidate.startedAtMs) || !finite(candidate.receivedAtMs)) return false;
    if (candidate.endedAtMs !== undefined && !finite(candidate.endedAtMs)) return false;
    if (typeof candidate.transcript !== 'string' || candidate.transcript.length > MAX_TRANSCRIPT_CHARS) return false;
    if (typeof candidate.final !== 'boolean') return false;
    if (!unitInterval(candidate.confidence)) return false;
    if (candidate.alternatives !== undefined) {
        if (!Array.isArray(candidate.alternatives) || candidate.alternatives.length > 10) return false;
        for (const alternative of candidate.alternatives) {
            if (!alternative || typeof alternative !== 'object' || Array.isArray(alternative)) return false;
            const entry = alternative as Record<string, unknown>;
            if (!onlyKeys(entry, ALTERNATIVE_KEYS)) return false;
            if (typeof entry.transcript !== 'string' || entry.transcript.length > MAX_TRANSCRIPT_CHARS) return false;
            if (!unitInterval(entry.confidence)) return false;
        }
    }
    return true;
}

/** Builds observations for one session with OmniOS-owned ids and clock. */
export function observationFactory(input: {
    sessionId: string;
    provider: SpeechProvenance;
    locale?: string;
    startedAtMs: number;
    now?: () => number;
}) {
    let sequence = 0;
    const now = input.now ?? Date.now;
    return (fields: {
        transcript: string;
        final: boolean;
        endedAtMs?: number;
        confidence?: number;
        alternatives?: SpeechAlternative[];
    }): SpeechObservationV1 => {
        sequence += 1;
        const observation: SpeechObservationV1 = {
            version: 1,
            sessionId: input.sessionId,
            observationId: `${input.sessionId}:${sequence}`,
            provider: { ...input.provider },
            startedAtMs: input.startedAtMs,
            receivedAtMs: now(),
            transcript: fields.transcript.slice(0, MAX_TRANSCRIPT_CHARS),
            final: fields.final,
            source: 'microphone'
        };
        if (input.locale) observation.locale = input.locale;
        if (fields.endedAtMs !== undefined) observation.endedAtMs = fields.endedAtMs;
        if (fields.confidence !== undefined) observation.confidence = fields.confidence;
        if (fields.alternatives?.length) observation.alternatives = fields.alternatives;
        return observation;
    };
}
