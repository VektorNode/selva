/**
 * Caller identity for transport-free handlers.
 *
 * The `ApiRequest` counterpart to `requireCaller` in `api/http.ts`, which reads
 * SvelteKit `locals`. Both exist while handlers are being moved across; the
 * `locals` one goes away once no route reads `locals` directly.
 */

import { apiError, ApiErrorCode, type ApiRequest } from '@selvajs/server/api';
import type { AuthUser, RequestContext } from '@selvajs/platform';

export function requireCaller(req: ApiRequest): { ctx: RequestContext; user: AuthUser } {
	if (!req.ctx || !req.user) {
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	}
	return { ctx: req.ctx, user: req.user };
}
