// ============================================
// PROJECT OMNI: DEBUG LOGGER
// Opt-in diagnostic logging. No-op unless NEXT_PUBLIC_OMNI_DEBUG is set,
// so verbose gateway/block tracing doesn't flood the console in normal use.
// Enable with NEXT_PUBLIC_OMNI_DEBUG=1 in .env.
// ============================================

const DEBUG_ENABLED =
    typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_OMNI_DEBUG === '1';

/** Verbose, opt-in log. Replaces ad-hoc console.log in hot paths. */
export const debug = DEBUG_ENABLED
    ? (...args: unknown[]) => console.log(...args)
    : () => {};
