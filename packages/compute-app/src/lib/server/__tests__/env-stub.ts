/**
 * Stub for SvelteKit's `$env/dynamic/private` virtual module.
 * Wired via `resolve.alias` in vitest.config.ts. Tests can mutate `env`
 * directly to override per-scenario.
 *
 * `SESSION_SECRET` is defaulted so token.server.ts (share-link HMAC) can run
 * under test without each test setting it explicitly. It matches the secret
 * `freshProviders()` passes to LocalAuthProvider.
 */
export const env: Record<string, string | undefined> = {
	SESSION_SECRET: 'test-session-secret-32-chars-min-len',
	...process.env
};
