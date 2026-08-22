/**
 * Stub for SvelteKit's `$env/dynamic/private`, wired via `resolve.alias` in
 * vitest.config.ts. Tests can mutate `env` directly to override per-scenario.
 *
 * `SELVA_HMAC_KEY` defaults here so token.server.ts (share-link HMAC) runs
 * under test without each test setting it — must match the secret
 * `freshProviders()` passes to LocalAuthProvider.
 */
export const env: Record<string, string | undefined> = {
	SELVA_HMAC_KEY: 'test-hmac-key-32-chars-min-length',
	...process.env
};
