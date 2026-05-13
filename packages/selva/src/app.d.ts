// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
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

	const __GIT_HASH__: string;
	const __GIT_SHORT_HASH__: string;
	const __GIT_MESSAGE__: string;
	const __GIT_DATE__: string;
}

export {};
