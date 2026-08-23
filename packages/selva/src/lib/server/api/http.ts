/**
 * The rule this file enforces: **a route handler parses, guards, delegates and
 * serializes — nothing else.** Anything two endpoints must agree on lives here
 * or in `@selvajs/server`, never copied into both.
 *
 * Scope-neutral on purpose: `/api/v1/*` and `/api/admin/*` are siblings over
 * one core, so a rule that lands here reaches both.
 *
 * Request parsers live in `@selvajs/server/api` and are re-exported below —
 * they never depended on SvelteKit, only their throw did. What genuinely
 * belongs to this host stays: `requireCaller` (reads `App.Locals`), the
 * `json`-returning response helpers, and `apiRoute` itself.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { apiError, ApiErrorCode, handleApiError } from '../api-errors.js';

export {
	formText,
	parseBody,
	parseParam,
	requireParams,
	requireUpload,
	throwZodError
} from '@selvajs/server/api';

// ============================================================================
// Caller identity
// ============================================================================

/**
 * The authenticated caller, or 401. Returns the narrowed pair so callers don't
 * need `locals.ctx!` — if you have the result, the context exists.
 *
 * For handlers that need an identity without a permission check — the `/me`
 * routes, and reads whose authorization is a visibility filter. Guards in
 * `access.server.ts` do their own 401 as a side effect of checking a permission.
 */
export function requireCaller(locals: App.Locals): {
	ctx: NonNullable<App.Locals['ctx']>;
	user: NonNullable<App.Locals['user']>;
} {
	if (!locals.ctx || !locals.user) {
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	}
	return { ctx: locals.ctx, user: locals.user };
}

// ============================================================================
// Responses
// ============================================================================

/** A paginated collection. The one envelope every v1 list endpoint returns. */
export function collection<T>(page: { items: T[]; nextCursor?: string }): Response {
	return json({ items: page.items, nextCursor: page.nextCursor });
}

/** A created resource. */
export function created<T>(body: T): Response {
	return json(body, { status: 201 });
}

/** A successful mutation with nothing to say. */
export function noContent(): Response {
	return new Response(null, { status: 204 });
}

/**
 * Serialize a payload through an explicit response schema.
 *
 * Keeps a secret from reaching a client by accident: several responses are
 * store records with a credential removed (`tokenHash` on a share link or
 * invite, `apiKey` on an org compute server). Parsing through a schema means
 * the response carries only what the schema names, so a new field on the
 * stored type is invisible until someone adds it here deliberately.
 */
export function shaped<T>(schema: ZodType<T>, payload: unknown, status = 200): Response {
	// A parse failure here is a bug in this app, not bad caller input — let it
	// surface as a 500 rather than ship a half-valid body.
	return json(schema.parse(payload), { status });
}

/** `shaped`, mapped over a page of records. */
export function shapedCollection<T>(
	schema: ZodType<T>,
	page: { items: unknown[]; nextCursor?: string }
): Response {
	return json({ items: page.items.map((item) => schema.parse(item)), nextCursor: page.nextCursor });
}

// ============================================================================
// The handler wrapper
// ============================================================================

/**
 * Wrap a handler so an unhandled error becomes a structured API error.
 *
 * `fallback` is required: it's the message used when the error carries none of
 * its own, and "something went wrong" tells a caller nothing.
 */
export function apiRoute<E extends RequestEvent>(
	fallback: string,
	handler: (event: E) => Promise<Response>
): (event: E) => Promise<Response> {
	return async (event) => {
		try {
			return await handler(event);
		} catch (err) {
			// Re-throws anything already structured (e.g. a deliberate
			// apiError(404, …)) untouched; the request logger routes the 500
			// branch through pino (redaction, request id) instead of raw stdout.
			handleApiError(err, fallback, event.locals.log);
		}
	};
}
