// The public preview runs no capability-broker backend. The deploy gate checks this answers 503.
export function POST(): Response {
    return Response.json({ error: 'The capability broker is unavailable in the public preview.' }, { status: 503 });
}
