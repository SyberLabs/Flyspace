// Mints a short-lived OpenAI Realtime transcription secret for one browser capture.
// The standard API key stays on the server; the browser receives only the ephemeral value.

import 'server-only';

export const REALTIME_CLIENT_SECRETS_URL = 'https://api.openai.com/v1/realtime/client_secrets';
export const REALTIME_TRANSCRIPTION_MODEL = 'gpt-live-transcribe';
const MINT_DEADLINE_MS = 10_000;

type Env = Record<string, string | undefined>;

/** Remote transcription sends microphone audio off the machine, so it needs an explicit opt-in as well as a key. */
export function realtimeSpeechConfigured(env: Env = process.env): boolean {
    return env.OMNI_SPEECH_REALTIME_ENABLED === '1' && !!env.OPENAI_API_KEY?.trim();
}

export function transcriptionLanguage(locale: unknown): string | undefined {
    if (typeof locale !== 'string') return undefined;
    const match = /^([a-z]{2})(?:-[A-Za-z]{2})?$/.exec(locale.trim());
    return match?.[1];
}

export type MintResult =
    | { ok: true; clientSecret: string; model: string; expiresAt?: number }
    | { ok: false; status: number; error: 'unconfigured' | 'provider-error' | 'timeout' };

export async function mintRealtimeTranscriptionSecret(input: {
    env?: Env;
    locale?: unknown;
    fetchImpl?: typeof fetch;
    signal?: AbortSignal;
}): Promise<MintResult> {
    const env = input.env ?? process.env;
    if (!realtimeSpeechConfigured(env)) return { ok: false, status: 503, error: 'unconfigured' };
    const language = transcriptionLanguage(input.locale);
    const transcription: Record<string, unknown> = { model: REALTIME_TRANSCRIPTION_MODEL };
    if (language) transcription.languages = [language];
    const deadline = AbortSignal.timeout(MINT_DEADLINE_MS);
    const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
    let response: Response;
    try {
        response = await (input.fetchImpl ?? fetch)(REALTIME_CLIENT_SECRETS_URL, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${env.OPENAI_API_KEY!.trim()}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                session: {
                    type: 'transcription',
                    audio: { input: { transcription, turn_detection: null } }
                }
            }),
            signal,
            cache: 'no-store'
        });
    } catch {
        return { ok: false, status: 504, error: deadline.aborted ? 'timeout' : 'provider-error' };
    }
    if (!response.ok) return { ok: false, status: 502, error: 'provider-error' };
    let body: unknown;
    try {
        body = await response.json();
    } catch {
        return { ok: false, status: 502, error: 'provider-error' };
    }
    const record = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const value = typeof record.value === 'string' ? record.value : undefined;
    if (!value || value === env.OPENAI_API_KEY?.trim()) return { ok: false, status: 502, error: 'provider-error' };
    const expiresAt = typeof record.expires_at === 'number' ? record.expires_at : undefined;
    return { ok: true, clientSecret: value, model: REALTIME_TRANSCRIPTION_MODEL, ...(expiresAt !== undefined ? { expiresAt } : {}) };
}
