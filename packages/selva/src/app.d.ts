// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			/**
			 * Stable machine-readable error code (e.g. `VALIDATION_FAILED`,
			 * `NOT_FOUND`). Present on every error this app raises via
			 * `api-errors.ts`; consumers (UI + external CLI) can branch on it
			 * without parsing `message`. See `ApiErrorCode` in api-errors.ts.
			 */
			code?: string;
			/**
			 * Per-field validation messages, keyed by dotted field path. Only
			 * present on `VALIDATION_FAILED` errors raised from Zod parsing.
			 */
			fields?: Record<string, string>;
			details?: string;
		}
		interface Locals {
			/** Authenticated user identity, set by hooks.server.ts for protected routes */
			user?: import('@selvajs/platform').AuthUser;
			/**
			 * Profile state (displayName, starred, recentRuns) for `user`. Loaded
			 * by hooks.server.ts alongside `user`; never from an OIDC IdP directly.
			 * Always present when `user` is present — falls back to `emptyProfile`.
			 */
			profile?: import('@selvajs/platform').UserProfile;
			/**
			 * Per-request identity + scope for data provider calls.
			 * Set by hooks.server.ts whenever a user is authenticated.
			 */
			ctx?: import('@selvajs/platform').RequestContext;
			/** Resolved provider instances, attached on every request by hooks.server.ts */
			providers: import('@selvajs/platform').SelvaConfig;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
