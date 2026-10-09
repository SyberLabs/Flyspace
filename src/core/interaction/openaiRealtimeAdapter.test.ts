import { describe, expect, it, vi } from 'vitest';
import { InteractionEngine } from './engine';
import { MemoryCanvas } from './memoryCanvas';
import { fallbackSpeechAdapter, openaiRealtimeAdapter, REALTIME_CALLS_URL } from './openaiRealtimeAdapter';
import { answerCommit, fakeRealtime } from './realtimeFakes';
import { scriptedSpeechAdapter } from './scriptedSpeechAdapter';
import { createPushToTalk } from './pushToTalk';
import type { IntentCompilerResult } from './intentCompiler';
import { createSpeechInput } from './speechInput';
import type { SpeechAdapter, SpeechObservationV1 } from './speechObservation';

function wired(adapter: SpeechAdapter) {
    const canvas = new MemoryCanvas();
    const engine = new InteractionEngine(canvas);
    const hear = vi.fn((observation: SpeechObservationV1, result: IntentCompilerResult) => engine.admitSpeech(observation, result));
    const partials: SpeechObservationV1[] = [];
    const input = createSpeechInput({
        adapter,
        authority: { describeSpeechContext: () => engine.describeSpeechContext(), admitSpeech: hear },
        onPartial: item => partials.push(item)
    });
    return { canvas, engine, hear, partials, input };
}

describe('OpenAI Realtime transcription adapter', () => {
    it('starts explicitly, streams non-final deltas, and resolves one final on stop', async () => {
        const fake = fakeRealtime();
        const adapter = openaiRealtimeAdapter(fake.transport, { now: () => 1000 });
        const partials: SpeechObservationV1[] = [];
        const talk = createPushToTalk(adapter, { newSessionId: () => 'omni-1', onPartial: item => partials.push(item) });

        expect(fake.requests).toHaveLength(0);
        await expect(talk.press()).resolves.toBeUndefined();
        const channel = fake.channel()!;
        expect(channel.label).toBe('oai-events');
        expect(fake.peer().tracks).toHaveLength(1);

        channel.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', content_index: 0, delta: 'add ' });
        channel.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'item_1', content_index: 0, delta: 'hacker' });
        expect(partials.map(item => [item.transcript, item.final])).toEqual([['add', false], ['add hacker', false]]);

        answerCommit(channel, 'item_1', 'Add Hacker News.');
        const heard = await talk.release();
        expect(channel.sent).toEqual([{ type: 'input_audio_buffer.commit' }]);
        expect(heard.transcript).toBe('Add Hacker News.');
        expect(heard.observation).toMatchObject({
            sessionId: 'omni-1',
            final: true,
            provider: { adapterId: 'openai-realtime', providerName: 'OpenAI Realtime', model: 'gpt-live-transcribe' },
            source: 'microphone'
        });
        expect(fake.tracks[0].stopped).toBeGreaterThan(0);
        expect(fake.peer().closed).toBe(true);
    });

    it('keeps the API key on the server: the browser sends only a locale and uses the ephemeral secret', async () => {
        const fake = fakeRealtime();
        const talk = createPushToTalk(openaiRealtimeAdapter(fake.transport));
        await talk.press();
        answerCommit(fake.channel()!, 'item_1', 'undo');
        await talk.release();
        const [mint, call] = fake.requests;
        expect(mint).toMatchObject({ url: '/api/speech/realtime-session', method: 'POST' });
        expect(JSON.parse(mint.body)).toEqual({ locale: 'en-US' });
        expect(mint.headers.Authorization).toBeUndefined();
        expect(call.url).toBe(REALTIME_CALLS_URL);
        expect(call.headers).toMatchObject({ Authorization: 'Bearer ek_fake_ephemeral', 'Content-Type': 'application/sdp' });
        expect(call.body).toBe('v=0 fake-offer');
        expect(fake.peer().remote).toEqual({ type: 'answer', sdp: 'v=0 fake-answer' });
    });

    it('deltas never reach the engine; the final commits once', async () => {
        const fake = fakeRealtime();
        const { canvas, hear, input } = wired(openaiRealtimeAdapter(fake.transport));
        await input.press();
        fake.channel()!.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'create a researcher' });
        expect(hear).not.toHaveBeenCalled();
        expect(canvas.blocks).toHaveLength(0);
        answerCommit(fake.channel()!, 'i', 'create a researcher');
        const outcome = await input.release();
        expect(outcome?.kind).toBe('command');
        expect(hear).toHaveBeenCalledTimes(1);
        expect(canvas.blocks).toHaveLength(1);
    });

    it('a provider disconnect during capture is an Omni error and no command', async () => {
        const fake = fakeRealtime();
        const { canvas, hear, input } = wired(openaiRealtimeAdapter(fake.transport));
        await input.press();
        fake.channel()!.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'delete this' });
        fake.peer().fail();
        const outcome = await input.release();
        expect(outcome).toMatchObject({ kind: 'error', code: 'disconnected', message: 'The speech provider disconnected.' });
        expect(hear).not.toHaveBeenCalled();
        expect(canvas.blocks).toHaveLength(0);
        expect(fake.tracks[0].stopped).toBeGreaterThan(0);
    });

    it('a closed data channel is a disconnect, not a command', async () => {
        const fake = fakeRealtime();
        const { hear, input } = wired(openaiRealtimeAdapter(fake.transport));
        await input.press();
        fake.channel()!.drop();
        expect(await input.release()).toMatchObject({ kind: 'error', code: 'disconnected' });
        expect(hear).not.toHaveBeenCalled();
    });

    it('microphone permission denial normalizes and opens no peer', async () => {
        const fake = fakeRealtime({ microphoneError: { name: 'NotAllowedError' } });
        const { hear, input } = wired(openaiRealtimeAdapter(fake.transport));
        const outcome = await input.press();
        expect(outcome).toMatchObject({ kind: 'error', code: 'permission-denied', message: 'Microphone permission was refused.' });
        expect(fake.peers).toHaveLength(0);
        expect(input.held).toBe(false);
        expect(hear).not.toHaveBeenCalled();
    });

    it('cancel aborts the peer, the microphone, and the AbortSignal, and emits nothing after', async () => {
        const fake = fakeRealtime();
        const partials: SpeechObservationV1[] = [];
        const talk = createPushToTalk(openaiRealtimeAdapter(fake.transport), { onPartial: item => partials.push(item) });
        await talk.press();
        const channel = fake.channel()!;
        talk.cancel();
        await vi.waitFor(() => expect(fake.peer().closed).toBe(true));
        expect(fake.tracks[0].stopped).toBeGreaterThan(0);
        expect(channel.readyState).toBe('closed');
        channel.emit({ type: 'conversation.item.input_audio_transcription.delta', item_id: 'i', delta: 'delete this' });
        expect(partials).toHaveLength(0);
    });

    it('cancel during the session request aborts the fetch and never opens the microphone', async () => {
        const fake = fakeRealtime({ hangSession: true });
        const talk = createPushToTalk(openaiRealtimeAdapter(fake.transport));
        const pressed = talk.press();
        await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
        talk.cancel();
        expect(fake.requests[0].signal?.aborted).toBe(true);
        await expect(pressed).resolves.toBeUndefined();
        expect(fake.tracks).toHaveLength(0);
        expect(fake.peers).toHaveLength(0);
    });

    it('slow finalization times out as an error, not a command', async () => {
        const fake = fakeRealtime();
        const { hear, input } = wired(openaiRealtimeAdapter(fake.transport, { finalizeTimeoutMs: 20 }));
        await input.press();
        expect(await input.release()).toMatchObject({ kind: 'error', code: 'timeout' });
        expect(hear).not.toHaveBeenCalled();
        expect(fake.peer().closed).toBe(true);
    });

    it('an empty commit is silence', async () => {
        const fake = fakeRealtime();
        const { hear, input } = wired(openaiRealtimeAdapter(fake.transport));
        await input.press();
        const channel = fake.channel()!;
        channel.onCommit = () => channel.emit({ type: 'error', error: { code: 'input_audio_buffer_commit_empty' } });
        expect(await input.release()).toEqual({ kind: 'silence' });
        expect(hear).not.toHaveBeenCalled();
    });

    it('a provider error event or a failed transcription creates no command', async () => {
        for (const event of [
            { type: 'error', error: { code: 'server_error' } },
            { type: 'conversation.item.input_audio_transcription.failed', item_id: 'i' }
        ]) {
            const fake = fakeRealtime();
            const { hear, input } = wired(openaiRealtimeAdapter(fake.transport));
            await input.press();
            fake.channel()!.emit(event);
            expect(await input.release()).toMatchObject({ kind: 'error', code: 'provider-error' });
            expect(hear).not.toHaveBeenCalled();
        }
    });

    it('a rejected SDP exchange or a data channel that never opens is an error', async () => {
        const rejected = fakeRealtime({ callsStatus: 401 });
        expect(await wired(openaiRealtimeAdapter(rejected.transport)).input.press()).toMatchObject({ kind: 'error', code: 'provider-error' });
        expect(rejected.peer().closed).toBe(true);

        const silent = fakeRealtime({ autoOpen: false });
        expect(await wired(openaiRealtimeAdapter(silent.transport, { connectTimeoutMs: 20 })).input.press()).toMatchObject({ kind: 'error', code: 'timeout' });
        expect(silent.tracks[0].stopped).toBeGreaterThan(0);
    });
});

describe('browser fallback', () => {
    it('uses the browser adapter when remote transcription is unconfigured, without crashing', async () => {
        const fake = fakeRealtime({ sessionStatus: 503, sessionBody: { error: 'unconfigured' } });
        const fallback = scriptedSpeechAdapter({ final: 'create a researcher' });
        const { canvas, input } = wired(fallbackSpeechAdapter(openaiRealtimeAdapter(fake.transport), fallback));
        await input.press();
        const outcome = await input.release();
        expect(outcome?.kind).toBe('command');
        expect(outcome?.kind === 'command' && outcome.observation.provider.adapterId).toBe('scripted-speech');
        expect(canvas.blocks).toHaveLength(1);
        expect(fake.tracks).toHaveLength(0);

        await input.press();
        await input.release();
        expect(fake.requests.filter(request => request.method === 'POST')).toHaveLength(1);
        expect(fallback.starts).toBe(2);
    });

    it('a probe that says unconfigured skips the remote adapter entirely', async () => {
        const fake = fakeRealtime({ configured: false });
        const fallback = scriptedSpeechAdapter({ final: 'undo' });
        const adapter = fallbackSpeechAdapter(openaiRealtimeAdapter(fake.transport), fallback);
        await adapter.prepare?.();
        const talk = createPushToTalk(adapter);
        await talk.press();
        await talk.release();
        expect(fake.requests.map(request => request.method)).toEqual(['GET']);
        expect(fallback.starts).toBe(1);
    });

    it('does not fall back to hide a refused microphone or a provider failure', async () => {
        const denied = fakeRealtime({ microphoneError: { name: 'NotAllowedError' } });
        const fallback = scriptedSpeechAdapter({ final: 'create a researcher' });
        const talk = createPushToTalk(fallbackSpeechAdapter(openaiRealtimeAdapter(denied.transport), fallback));
        expect((await talk.press())?.error?.code).toBe('permission-denied');
        expect(fallback.starts).toBe(0);

        const broken = fakeRealtime({ sessionStatus: 502 });
        const again = createPushToTalk(fallbackSpeechAdapter(openaiRealtimeAdapter(broken.transport), fallback));
        expect((await again.press())?.error?.code).toBe('provider-error');
        expect(fallback.starts).toBe(0);
    });
});
