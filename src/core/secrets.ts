// ============================================
// PROJECT OMNI: SECRET ENV VARS
//
// The one list of environment variables whose VALUES must never leave the
// server. Deliberately dependency-free — no `server-only`, no imports — so
// that both the server modules and the build-time bundle scanner can read
// the same list rather than each keeping their own copy that drifts.
//
// Two consumers, one truth:
//   - inference.ledger.ts scrubs these out of anything it stores, because
//     rows are served back to the browser by /api/inference-runs.
//   - scripts/scan-client-bundle.ts builds with canary values for each of
//     these and fails CI if any of them reaches .next/static.
//
// A new keyed provider belongs here the same day its env var is added.
// ============================================

export const SECRET_ENV_VARS = [
    // LLM providers
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY',
    'KEV_API_KEY',
    // TypeSafe System One (JEV), direct: registry search routing
    'TYPESAFE_API_KEY',
    // Keyed data providers (proxied through /api/data)
    'NEWSAPI_KEY',
    'FRED_API_KEY',
    'BLS_API_KEY',
    'ALPHA_VANTAGE_API_KEY',
    'METACULUS_API_KEY',
    // The inference ledger's connection string, which rides along on pg errors
    'DATABASE_URL',
    // Test-only scratch database. Never set in production, but it is still a
    // connection string with a password in it.
    'OMNI_TEST_DATABASE_URL'
] as const;

/**
 * Below this length a "secret" would match ordinary text and the scrubber
 * would corrupt more than it protects. A real key is far longer.
 */
export const MIN_SECRET_LENGTH = 8;

/**
 * Env vars that are public BY DESIGN. Listed so the distinction is explicit
 * rather than implied by absence: `NEXT_PUBLIC_*` is inlined into the client
 * bundle by Next, which is the whole point of the prefix.
 */
export const PUBLIC_ENV_VARS = [
    'NEXT_PUBLIC_OMNI_DEBUG',
    // Not a credential: a localhost URL the user configures.
    'OLLAMA_BASE_URL'
] as const;
