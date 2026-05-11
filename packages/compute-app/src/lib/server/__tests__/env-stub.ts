/**
 * Stub for SvelteKit's `$env/dynamic/private` virtual module.
 * Wired via `resolve.alias` in vitest.config.ts. Tests can mutate `env`
 * directly to override per-scenario.
 *
 * `SELVA_HMAC_KEY` is defaulted so token.server.ts (share-link HMAC) can run
 * under test without each test setting it explicitly. It matches the secret
 * `freshProviders()` passes to LocalAuthProvider.
 */
export const env: Record<string, string | undefined> = {
	SELVA_HMAC_KEY: 'test-hmac-key-32-chars-min-length',
	...process.env
};
