// OpenAI Realtime transcription over WebRTC, behind SpeechAdapter.
// The adapter id is provenance. Nothing here knows about commands or the canvas.

import {
    normalizeSpeechError,
    observationFactory,
    SpeechAdapterError,
    type SpeechAdapter,
    type SpeechCapture,
    type SpeechErrorCode,
    type SpeechObservationV1
} from './speechObservation';

export const OPENAI_REALTIME_ADAPTER_ID = 'openai-realtime';
export const REALTIME_SESSION_ROUTE = '/api/speech/realtime-session';
export const REALTIME_CALLS_URL = 'https://api.openai.com/v1/realtime/calls';

/** Configuration bounds, not measured latencies. */
const CONNECT_TIMEOUT_MS = 10_000;
const FINALIZE_TIMEOUT_MS = 5_000;

/** The narrow browser surface the adapter needs. Tests inject fakes; no network in unit tests. */
export interface RealtimeTransport {
    fetch(url: string, init: RequestInit): Promise<Response>;
    getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
    createPeer(): RTCPeerConnection;
}

export function browserRealtimeTransport(): RealtimeTransport {
    return {
        fetch: (url, init) => fetch(url, init),
        getUserMedia(constraints) {
            if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
                return Promise.reject(new SpeechAdapterError('no-microphone'));
            }
            return navigator.mediaDevices.getUserMedia(constraints);
        },
        createPeer() {
            if (typeof RTCPeerConnection === 'undefined') throw new SpeechAdapterError('unsupported', 'This browser has no WebRTC.');
            return new RTCPeerConnection();
        }
    };
}

export interface RealtimeAdapterOptions {
    sessionRoute?: string;
    callsUrl?: string;
    now?: () => number;
    connectTimeoutMs?: number;
    finalizeTimeoutMs?: number;
}

interface RealtimeSession {
    clientSecret: string;
    model: string;
}

function aborted(): SpeechAdapterError {
    return new SpeechAdapterError('aborted');
}

async function mintSession(transport: RealtimeTransport, route: string, locale: string, signal: AbortSignal): Promise<RealtimeSession> {
    let response: Response;
    try {
        response = await transport.fetch(route, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ locale }),
            signal,
            cache: 'no-store'
        });
    } catch {
        throw signal.aborted ? aborted() : new SpeechAdapterError('network');
    }
    if (response.status === 503) {
        const body = await response.json().catch(() => null) as { error?: unknown } | null;
        throw new SpeechAdapterError(body?.error === 'unconfigured' ? 'unconfigured' : 'provider-error');
    }
    if (!response.ok) throw new SpeechAdapterError('provider-error');
    const body = await response.json().catch(() => null) as { clientSecret?: unknown; model?: unknown } | null;
    if (typeof body?.clientSecret !== 'string' || !body.clientSecret) throw new SpeechAdapterError('provider-error');
    return { clientSecret: body.clientSecret, model: typeof body.model === 'string' ? body.model : 'unknown' };
}

function waitFor(ready: () => boolean, subscribe: (wake: () => void) => void, timeoutMs: number, signal: AbortSignal): Promise<'ready' | 'timeout' | 'aborted'> {
    return new Promise(resolve => {
        if (ready()) return resolve('ready');
        const timer = setTimeout(() => finish('timeout'), timeoutMs);
        const onAbort = () => finish('aborted');
        function finish(result: 'ready' | 'timeout' | 'aborted') {
            clearTimeout(timer);
            signal.removeEventListener('abort', onAbort);
            resolve(result);
        }
        signal.addEventListener('abort', onAbort, { once: true });
        subscribe(() => {
            if (ready()) finish('ready');
        });
    });
}

interface RealtimeEvent {
    type?: unknown;
    item_id?: unknown;
    delta?: unknown;
    transcript?: unknown;
    error?: { code?: unknown } | null;
}

export function openaiRealtimeAdapter(
    transport: RealtimeTransport = browserRealtimeTransport(),
    options: RealtimeAdapterOptions = {}
): SpeechAdapter & { probe(): Promise<boolean> } {
    const now = options.now ?? Date.now;
    const route = options.sessionRoute ?? REALTIME_SESSION_ROUTE;
    const callsUrl = options.callsUrl ?? REALTIME_CALLS_URL;
    const connectTimeoutMs = options.connectTimeoutMs ?? CONNECT_TIMEOUT_MS;
    const finalizeTimeoutMs = options.finalizeTimeoutMs ?? FINALIZE_TIMEOUT_MS;

    return {
        id: OPENAI_REALTIME_ADAPTER_ID,
        captureKind: 'live',

        /** Asks OmniOS whether remote transcription is configured. Opens no microphone. */
        async probe() {
            try {
                const response = await transport.fetch(route, { method: 'GET', cache: 'no-store' });
                if (!response.ok) return false;
                const body = await response.json().catch(() => null) as { configured?: unknown } | null;
                return body?.configured === true;
            } catch {
                return false;
            }
        },

        async start(input): Promise<SpeechCapture> {
            const locale = input.locale ?? 'en-US';
            const startedAtMs = now();
            const local = new AbortController();
            const signal = AbortSignal.any([input.signal, local.signal]);
            let stream: MediaStream | null = null;
            let peer: RTCPeerConnection | null = null;
            let channel: RTCDataChannel | null = null;
            let closed = false;
            let failure: SpeechErrorCode | null = null;
            let emptyCommit = false;
            let commitSent = false;
            let committedAfterSend = false;
            const items: string[] = [];
            const deltas = new Map<string, string>();
            const completed = new Map<string, string>();
            const wakers = new Set<() => void>();
            const wake = () => wakers.forEach(fn => fn());
            const subscribe = (fn: () => void) => { wakers.add(fn); };

            const stopMicrophone = () => stream?.getTracks().forEach(track => track.stop());
            const teardown = () => {
                closed = true;
                stopMicrophone();
                try { channel?.close(); } catch { /* already closed */ }
                try { peer?.close(); } catch { /* already closed */ }
                wakers.clear();
            };
            const fail = (code: SpeechErrorCode) => {
                if (closed) return;
                failure ??= code;
                wake();
            };
            const cancel = () => {
                if (closed) return;
                local.abort();
                teardown();
            };
            input.signal.addEventListener('abort', cancel, { once: true });

            let session: RealtimeSession;
            const provider = { adapterId: OPENAI_REALTIME_ADAPTER_ID, providerName: 'OpenAI Realtime' };
            try {
                if (signal.aborted) throw aborted();
                session = await mintSession(transport, route, locale, signal);
                if (signal.aborted) throw aborted();
                try {
                    stream = await transport.getUserMedia({ audio: true });
                } catch (error) {
                    throw normalizeSpeechError(error);
                }
                if (signal.aborted) throw aborted();
                peer = transport.createPeer();
                for (const track of stream.getTracks()) peer.addTrack(track, stream);
                channel = peer.createDataChannel('oai-events');

                const transcriptSoFar = () => items
                    .map(id => completed.get(id) ?? deltas.get(id) ?? '')
                    .join(' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                const observe = observationFactory({
                    sessionId: input.sessionId,
                    provider: { ...provider, model: session.model },
                    locale,
                    startedAtMs,
                    now
                });
                const track = (id: string) => { if (!items.includes(id)) items.push(id); };

                channel.onmessage = message => {
                    if (closed) return;
                    let event: RealtimeEvent;
                    try {
                        event = JSON.parse(String(message.data)) as RealtimeEvent;
                    } catch {
                        return;
                    }
                    const id = typeof event.item_id === 'string' ? event.item_id : null;
                    switch (event.type) {
                        case 'input_audio_buffer.committed':
                            if (id) track(id);
                            if (commitSent) committedAfterSend = true;
                            break;
                        case 'conversation.item.input_audio_transcription.delta':
                            if (!id || typeof event.delta !== 'string') return;
                            track(id);
                            deltas.set(id, (deltas.get(id) ?? '') + event.delta);
                            if (transcriptSoFar()) input.onObservation(observe({ transcript: transcriptSoFar(), final: false }));
                            break;
                        case 'conversation.item.input_audio_transcription.completed':
                            if (!id || typeof event.transcript !== 'string') return;
                            track(id);
                            completed.set(id, event.transcript);
                            break;
                        case 'conversation.item.input_audio_transcription.failed':
                            fail('provider-error');
                            return;
                        case 'error':
                            if (event.error?.code === 'input_audio_buffer_commit_empty') emptyCommit = true;
                            else fail('provider-error');
                            break;
                        default:
                            return;
                    }
                    wake();
                };
                channel.onclose = () => fail('disconnected');
                const dropped = () => {
                    const state = peer?.connectionState;
                    if (state === 'failed' || state === 'disconnected' || state === 'closed') fail('disconnected');
                };
                peer.onconnectionstatechange = dropped;
                const openChannel = channel;
                openChannel.onopen = wake;

                const offer = await peer.createOffer();
                await peer.setLocalDescription(offer);
                let answer: Response;
                try {
                    answer = await transport.fetch(callsUrl, {
                        method: 'POST',
                        body: offer.sdp ?? '',
                        headers: {
                            Authorization: `Bearer ${session.clientSecret}`,
                            'Content-Type': 'application/sdp'
                        },
                        signal
                    });
                } catch {
                    throw signal.aborted ? aborted() : new SpeechAdapterError('network');
                }
                if (!answer.ok) throw new SpeechAdapterError('provider-error');
                await peer.setRemoteDescription({ type: 'answer', sdp: await answer.text() });
                const opened = await waitFor(
                    () => failure !== null || openChannel.readyState === 'open',
                    subscribe,
                    connectTimeoutMs,
                    signal
                );
                if (opened === 'aborted') throw aborted();
                if (opened === 'timeout') throw new SpeechAdapterError('timeout');
                if (failure) throw new SpeechAdapterError(failure);

                return {
                    provider: { ...provider, model: session.model },
                    transport: 'remote',
                    async stop(): Promise<SpeechObservationV1 | null> {
                        if (closed) return null;
                        const endedAtMs = now();
                        stopMicrophone();
                        if (!failure) {
                            try {
                                openChannel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
                                commitSent = true;
                            } catch {
                                fail('disconnected');
                            }
                        }
                        const settled = await waitFor(
                            () => failure !== null || emptyCommit || (committedAfterSend && items.length > 0 && items.every(id => completed.has(id))),
                            subscribe,
                            finalizeTimeoutMs,
                            signal
                        );
                        const code: SpeechErrorCode | null = settled === 'aborted' ? 'aborted' : settled === 'timeout' ? 'timeout' : failure;
                        const transcript = items.map(id => completed.get(id) ?? '').join(' ').replace(/\s+/g, ' ').trim();
                        input.signal.removeEventListener('abort', cancel);
                        teardown();
                        if (code) throw new SpeechAdapterError(code);
                        if (emptyCommit || !transcript) return null;
                        return observe({ transcript, final: true, endedAtMs });
                    },
                    async cancel() {
                        input.signal.removeEventListener('abort', cancel);
                        cancel();
                    }
                };
            } catch (error) {
                input.signal.removeEventListener('abort', cancel);
                teardown();
                throw normalizeSpeechError(error);
            }
        }
    };
}

/**
 * Uses the primary adapter when it is configured, otherwise the fallback.
 * Only `unconfigured` falls back: a refused microphone or a dropped provider is reported, not hidden.
 */
export function fallbackSpeechAdapter(
    primary: SpeechAdapter & { probe?(): Promise<boolean> },
    fallback: SpeechAdapter
): SpeechAdapter {
    let primaryState: 'unknown' | 'configured' | 'unconfigured' = 'unknown';
    return {
        id: `${primary.id}|${fallback.id}`,
        captureKind: primary.captureKind === 'live' || fallback.captureKind === 'live' ? 'live' : 'synthetic',
        async prepare() {
            if (primaryState !== 'unknown' || !primary.probe) return;
            primaryState = (await primary.probe()) ? 'configured' : 'unconfigured';
        },
        async start(input) {
            if (primaryState === 'unconfigured') return fallback.start(input);
            try {
                const capture = await primary.start(input);
                primaryState = 'configured';
                return capture;
            } catch (error) {
                if (!(error instanceof SpeechAdapterError) || error.code !== 'unconfigured') throw error;
                primaryState = 'unconfigured';
                return fallback.start(input);
            }
        }
    };
}
