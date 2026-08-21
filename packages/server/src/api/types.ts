/**
 * The transport-free handler contract.
 *
 * A handler receives an `ApiRequest` and returns an `ApiResponse`. Neither type
 * names a web framework, so the same handler mounts under SvelteKit, Next, Hono
 * or an in-process call. What used to arrive as SvelteKit's `RequestEvent` is
 * split into the four things handlers actually read — measured across the v1
 * routes, that was `locals.ctx`, `locals.user`, `locals.log` and
 * `locals.profile`, nothing else.
 */

import type { AuthUser, ILogger, RequestContext, UserProfile } from '@selvajs/platform';
import type { SelvaDeps } from './deps.js';

export interface ApiRequest {
	/** Per-request identity + scope. Present only once authenticated. */
	ctx?: RequestContext;
	user?: AuthUser;
	profile?: UserProfile;
	/** Carries requestId/method/route. Prefer over a root logger. */
	log: ILogger;
	/** Path params, already extracted by the host router. */
	params: Record<string, string | undefined>;
	url: URL;
	/** The raw request, for bodies and headers. */
	request: Request;
	/** Everything the handler talks to. Injected, never module-global. */
	deps: SelvaDeps;
}

/**
 * What a handler returns. `body` is serialized as JSON unless it is already a
 * `Response` (binary endpoints — file downloads, mesh streams) or `undefined`
 * (204). Keeping this a value rather than a `Response` is what lets a host
 * choose its own serialization; a handler that built its own `Response` would
 * force every host to accept web-standard `Response` semantics.
 */
export interface ApiResponse {
	status?: number;
	body?: unknown;
	headers?: Record<string, string>;
}

export type ApiHandler = (req: ApiRequest) => Promise<ApiResponse | Response>;
