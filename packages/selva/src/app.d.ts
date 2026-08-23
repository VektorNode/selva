// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		interface Error {
			message: string;
			/** Machine-readable code, e.g. `VALIDATION_FAILED`, `NOT_FOUND`. See `ApiErrorCode` in api-errors.ts. */
			code?: string;
			/** Per-field validation messages, keyed by dotted field path. Only set on `VALIDATION_FAILED`. */
			fields?: Record<string, string>;
			details?: string;
		}
		interface Locals {
			/** Set by hooks.server.ts for protected routes. */
			user?: import('@selvajs/platform').AuthUser;
			/** Falls back to `emptyProfile` when `user` has none yet. */
			profile?: import('@selvajs/platform').UserProfile;
			/** Per-request identity + scope for data provider calls; set once `user` is authenticated. */
			ctx?: import('@selvajs/platform').RequestContext;
			providers: import('@selvajs/platform').SelvaConfig;
			/** Carries `requestId`/`method`/`route` on every record. Prefer this over the root `getLogger()` in handlers. */
			log: import('@selvajs/platform').ILogger;
			/** The proxy's `X-Request-Id` when sent, else generated. Echoed on the response for log correlation. */
			requestId: string;
		}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}
}

export {};
