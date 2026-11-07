/**
 * Stub for `#lib/server/env.js`, wired via `resolve.alias` in
 * vitest.config.ts. Tests can mutate `env` directly to override per-scenario.
 *
 * Built from nothing, never from `process.env`: a variable exported in the
 * developer's shell (an `https://` ORIGIN, a rate limit) would otherwise change
 * what the tests see.
 *
 * `SELVA_HMAC_KEY` must match the secret `freshProviders()` passes to
 * LocalAuthProvider, so share-link and invite tokens verify under test.
 */
export const env: Record<string, string | undefined> = {
	SELVA_HMAC_KEY: 'test-hmac-key-32-chars-min-length'
};
