// The public preview runs no registry-intent backend. The deploy gate checks this answers 503.
export function POST(): Response {
    return Response.json({ error: 'Search routing is unavailable.' }, { status: 503 });
}
