import { NextRequest, NextResponse } from 'next/server';

export const runtime = 'nodejs';

const JEV_API_URL = 'https://openrouter.ai/api/alpha/decisions';
const JEV_MODEL = 'typesafe/jev-1.13';
const MAX_BODY_BYTES = 2048;
const MAX_QUESTION_CHARS = 500;
const PERSONAS = ['analyst', 'strategist', 'oracle', 'devil'] as const;

function json(status: number, body: Record<string, unknown>): NextResponse {
    return NextResponse.json(body, {
        status,
        headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }
    });
}

async function readQuestion(request: NextRequest): Promise<string | null> {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES || !request.body) return null;

    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            total += value.byteLength;
            if (total > MAX_BODY_BYTES) {
                await reader.cancel();
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }

    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
    }
    try {
        const body: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
        if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
        const question = (body as Record<string, unknown>).question;
        if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION_CHARS) return null;
        return question.trim();
    } catch {
        return null;
    }
}

export async function POST(request: NextRequest) {
    const provider = process.env.DECISION_PROVIDER || 'kev';
    if ((provider !== 'kev' && provider !== 'jev')
        || (provider === 'kev' ? process.env.OMNI_KEV_ENABLED !== '1' : process.env.OMNI_JEV_ENABLED !== '1')) {
        return json(503, { error: 'Persona suggestion is unavailable.' });
    }

    const origin = request.headers.get('origin');
    if (!origin || origin !== new URL(request.url).origin) {
        return json(403, { error: 'Request must come from this site.' });
    }
    if (request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
        return json(415, { error: 'Content-Type must be application/json.' });
    }

    let question: string | null;
    try {
        question = await readQuestion(request);
    } catch {
        return json(400, { error: 'Question must be 1–500 characters.' });
    }
    if (!question) return json(400, { error: 'Question must be 1–500 characters.' });

    const apiKey = provider === 'kev' ? process.env.KEV_API_KEY : process.env.OPENROUTER_API_KEY;
    const model = provider === 'kev' ? (process.env.KEV_MODEL || 'kev-latest') : JEV_MODEL;
    const revision = process.env.KEV_REVISION;
    let apiUrl = JEV_API_URL;
    if (provider === 'kev') {
        try {
            const base = new URL(process.env.KEV_BASE_URL || '');
            if (base.protocol !== 'https:'
                || base.pathname !== '/' || base.search || base.hash || base.username || base.password) throw new Error('Invalid Kev URL');
            apiUrl = new URL('/v1/systemone', base).toString();
        } catch {
            return json(503, { error: 'Persona suggestion is unavailable.' });
        }
    }
    if (!apiKey || (provider === 'kev' && (model !== 'kev-latest' || !revision || !/^[a-f0-9]{40}$/.test(revision)))) {
        return json(503, { error: 'Persona suggestion is unavailable.' });
    }

    try {
        const upstream = await fetch(apiUrl, {
            method: 'POST',
            redirect: 'error',
            headers: {
                Authorization: `Bearer ${apiKey}`,
                'Content-Type': 'application/json',
                Accept: 'application/json'
            },
            body: JSON.stringify({
                model,
                state: provider === 'kev' ? question : { question },
                questions: {
                    persona: {
                        type: 'choice',
                        instructions: 'Suggest the perspective that best fits this question. This does not answer the question or select the persona for the user.',
                        criteria: {
                            analyst: 'The question asks for evidence, patterns, or careful analysis of data.',
                            strategist: 'The question asks for a plan, options, or a decision about next steps.',
                            oracle: 'The question asks for a forecast, probability, or future scenario.',
                            devil: 'The question asks to challenge assumptions or stress-test an idea.'
                        }
                    }
                }
            }),
            signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)])
        });
        if (!upstream.ok) return json(502, { error: 'Persona suggestion failed.' });
        if (provider === 'kev' && upstream.headers.get('x-kev-revision') !== revision) {
            return json(502, { error: 'Persona suggestion failed.' });
        }

        const result: unknown = await upstream.json();
        if (!result || typeof result !== 'object') return json(502, { error: 'Persona suggestion failed.' });
        const value = result as Record<string, unknown>;
        const answer = (value.answers as Record<string, unknown> | undefined)?.persona as Record<string, unknown> | undefined;
        if ((provider === 'jev' && value.provider !== 'TypeSafe')
            || (provider === 'kev' ? value.model !== model : (value.model !== JEV_MODEL && !/^typesafe\/jev-1\.13-\d{8}$/.test(String(value.model))))
            || answer?.type !== 'choice'
            || !PERSONAS.includes(answer.choice as typeof PERSONAS[number])) {
            return json(502, { error: 'Persona suggestion failed.' });
        }

        return json(200, { persona: answer.choice, provider, model: value.model, ...(provider === 'kev' ? { revision } : {}) });
    } catch {
        return json(502, { error: 'Persona suggestion failed.' });
    }
}
