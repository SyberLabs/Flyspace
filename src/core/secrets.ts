// ============================================
// PROJECT OMNI: SECRET ENV VARS
//
// Environment variables whose VALUES must never reach a browser.
// scripts/scan-client-bundle.ts builds with canary values for each of these and
// fails CI if any of them reaches dist/client. Nothing in the preview reads
// them, and the list stays broad so a key that returns is covered from day one.
// ============================================

export const SECRET_ENV_VARS = [
    // LLM providers
    'ANTHROPIC_API_KEY',
    'GOOGLE_API_KEY',
    'OPENROUTER_API_KEY',
    'KEV_API_KEY',
    // TypeSafe System One (JEV), direct: registry search routing
    'TYPESAFE_API_KEY',
    // Remote speech transcription 
    'OPENAI_API_KEY',
    // Keyed data providers
    'NEWSAPI_KEY',
    'FRED_API_KEY',
    'BLS_API_KEY',
    'ALPHA_VANTAGE_API_KEY',
    'METACULUS_API_KEY',
    // Connect: the OAuth client secret (oauthConnect.ts)
    'OMNI_GOOGLE_CLIENT_SECRET',
    // The inference ledger's connection string, which rides along on pg errors
    'DATABASE_URL',
    // Test-only scratch database. Never set in production, but it is still a
    // connection string with a password in it.
    'OMNI_TEST_DATABASE_URL'
] as const;
