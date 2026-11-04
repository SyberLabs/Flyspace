// The public preview runs no llm backend. The deploy gate checks this answers 503.
export function POST(): Response {
    return Response.json({ error: 'AI answers are unavailable in the public preview.' }, { status: 503 });
}
