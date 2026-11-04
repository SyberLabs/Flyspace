// The public preview runs no inference-runs backend. The deploy gate checks this answers 503.
export function GET(): Response {
    return Response.json({ error: 'Inference history is unavailable in the public preview.' }, { status: 503 });
}
