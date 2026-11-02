// The public preview runs no jev-persona backend. The deploy gate checks this answers 503.
export function POST(): Response {
    return Response.json({ error: 'Persona suggestion is unavailable.' }, { status: 503 });
}
