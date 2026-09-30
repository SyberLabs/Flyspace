// Fake WebRTC peer and transport for the OpenAI Realtime adapter.
// Tests drive provider events by hand; nothing here opens a socket or a microphone.

import type { RealtimeTransport } from './openaiRealtimeAdapter';

export class FakeChannel {
    readyState: 'connecting' | 'open' | 'closed' = 'connecting';
    sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    onmessage: ((message: { data: unknown }) => void) | null = null;
    onCommit: (() => void) | null = null;

    constructor(readonly label: string) {}

    send(data: string) {
        if (this.readyState !== 'open') throw new Error('channel not open');
        const event = JSON.parse(data) as { type: string };
        this.sent.push(event);
        if (event.type === 'input_audio_buffer.commit') queueMicrotask(() => this.onCommit?.());
    }
    close() {
        this.readyState = 'closed';
    }
    open() {
        this.readyState = 'open';
        this.onopen?.();
    }
    emit(event: Record<string, unknown>) {
        this.onmessage?.({ data: JSON.stringify(event) });
    }
    drop() {
        this.readyState = 'closed';
        this.onclose?.();
    }
}

export class FakePeer {
    tracks: unknown[] = [];
    channel: FakeChannel | null = null;
    local: unknown = null;
    remote: RTCSessionDescriptionInit | null = null;
    closed = false;
    connectionState: RTCPeerConnectionState = 'new';
    onconnectionstatechange: (() => void) | null = null;

    constructor(private readonly autoOpen: boolean, private readonly onChannel?: (channel: FakeChannel) => void) {}

    addTrack(track: unknown) {
        this.tracks.push(track);
    }
    createDataChannel(label: string) {
        this.channel = new FakeChannel(label);
        this.onChannel?.(this.channel);
        return this.channel;
    }
    async createOffer() {
        return { type: 'offer' as const, sdp: 'v=0 fake-offer' };
    }
    async setLocalDescription(description: unknown) {
        this.local = description;
    }
    async setRemoteDescription(description: RTCSessionDescriptionInit) {
        this.remote = description;
        this.connectionState = 'connected';
        if (this.autoOpen) queueMicrotask(() => this.channel?.open());
    }
    close() {
        this.closed = true;
        this.connectionState = 'closed';
    }
    fail() {
        this.connectionState = 'failed';
        this.onconnectionstatechange?.();
    }
}

export interface FakeRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    body: string;
    signal?: AbortSignal;
}

export interface FakeRealtimeOptions {
    sessionStatus?: number;
    sessionBody?: Record<string, unknown>;
    configured?: boolean;
    callsStatus?: number;
    microphoneError?: { name: string };
    autoOpen?: boolean;
    /** Hold the session mint until the request is aborted. */
    hangSession?: boolean;
    onChannel?: (channel: FakeChannel, peer: FakePeer) => void;
}

export function fakeRealtime(options: FakeRealtimeOptions = {}) {
    const requests: FakeRequest[] = [];
    const peers: FakePeer[] = [];
    const tracks: Array<{ kind: string; stopped: number; stop(): void }> = [];
    const transport: RealtimeTransport = {
        async fetch(url, init) {
            const headers = Object.fromEntries(Object.entries((init.headers ?? {}) as Record<string, string>));
            const request: FakeRequest = {
                url,
                method: init.method ?? 'GET',
                headers,
                body: typeof init.body === 'string' ? init.body : '',
                signal: init.signal ?? undefined
            };
            requests.push(request);
            if (url.startsWith('/api/speech/realtime-session')) {
                if (request.method === 'GET') {
                    return Response.json({ configured: options.configured ?? true });
                }
                if (options.hangSession) {
                    await new Promise((_, reject) => {
                        init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
                    });
                }
                return Response.json(
                    options.sessionBody ?? { clientSecret: 'ek_fake_ephemeral', model: 'gpt-live-transcribe' },
                    { status: options.sessionStatus ?? 200 }
                );
            }
            return new Response('v=0 fake-answer', { status: options.callsStatus ?? 201 });
        },
        async getUserMedia() {
            if (options.microphoneError) throw options.microphoneError;
            const track = { kind: 'audio', stopped: 0, stop() { this.stopped += 1; } };
            tracks.push(track);
            return { getTracks: () => [track] } as unknown as MediaStream;
        },
        createPeer() {
            const peer: FakePeer = new FakePeer(options.autoOpen ?? true, channel => options.onChannel?.(channel, peer));
            peers.push(peer);
            return peer as unknown as RTCPeerConnection;
        }
    };
    return { transport, requests, peers, tracks, peer: () => peers[peers.length - 1], channel: () => peers[peers.length - 1]?.channel ?? null };
}

/** Replies to a commit the way the Realtime API does: committed, then completed. */
export function answerCommit(channel: FakeChannel, itemId: string, transcript: string) {
    channel.onCommit = () => {
        channel.emit({ type: 'input_audio_buffer.committed', item_id: itemId });
        channel.emit({ type: 'conversation.item.input_audio_transcription.completed', item_id: itemId, content_index: 0, transcript });
    };
}
