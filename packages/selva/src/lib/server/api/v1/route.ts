/**
 * The shared shape of a v1 route handler.
 *
 * Every handler in this tree does the same four things — validate the path,
 * parse the body, do the work, serialize — and before these helpers existed
 * each one spelled all four out. That is 2000 lines across 27 files in which
 * the interesting part is a few lines deep, and where the boilerplate had
 * already drifted: path params were validated two different ways, and four
 * list endpoints hand-rolled a pagination clamp that disagreed with the shared
 * one they were documented as using.
 *
 * The rule these helpers exist to enforce: **a route handler parses, guards,
 * delegates and serializes — nothing else.** Anything two endpoints must agree
 * on lives here or in `@selvajs/server`, never copied into both.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { apiError, ApiErrorCode, handleApiError, throwZodError } from '../../api-errors.js';

// ============================================================================
// Caller identity
// ============================================================================

/**
 * The authenticated caller, or 401.
 *
 * Routes used to write `if (!locals.ctx) apiError(401, …)` and then reach for
 * `locals.ctx!` further down — thirteen checks and eleven non-null assertions
 * for one fact. Returning the narrowed pair means the assertion disappears: if
 * you have the result, the context exists.
 *
 * Guards in `access.server.ts` do their own 401 as a side effect of checking a
 * permission. This is for the handlers that need an identity without one — the
 * `/me` routes, and reads whose authorization is a visibility filter.
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
// Path params
// ============================================================================

/**
 * Read required path params, 400ing on any that is missing or blank.
 *
 * SvelteKit types every param as `string`, but a route can be reached with an
 * empty segment, so the non-null assertion handlers used to write was a lie the
 * type system endorsed. Returning a narrowed record means the caller gets real
 * strings without asserting.
 *
 * This does **not** validate format — a guid-shaped param still goes through
 * `GuidSchema` where the route cares. It replaces the `if (!id) apiError(...)`
 * preamble, not the schema check.
 */
export function requireParams<K extends string>(
	params: Partial<Record<string, string>>,
	...names: K[]
): Record<K, string> {
	const out = {} as Record<K, string>;
	const missing: string[] = [];

	for (const name of names) {
		const value = params[name];
		if (!value) {
			missing.push(name);
			continue;
		}
		out[name] = value;
	}

	if (missing.length) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`Missing path parameter${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`
		);
	}
	return out;
}

/**
 * Read a path param through a Zod schema, 400ing on a bad value.
 *
 * The format-checking counterpart to `requireParams` — for guids, enum-shaped
 * segments, and anything else where "present" is not the same as "valid".
 */
export function parseParam<T>(value: string | undefined, schema: ZodType<T>, name: string): T {
	const parsed = schema.safeParse(value);
	if (!parsed.success) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, `Invalid or missing ${name}`);
	}
	return parsed.data;
}

// ============================================================================
// Request bodies
// ============================================================================

/**
 * Parse and validate a JSON body.
 *
 * A malformed body becomes `null` rather than throwing, so it fails the schema
 * and reports as a validation error — a client sending broken JSON should see
 * a 400 naming the problem, not a 500 from `request.json()`.
 *
 * `missingAs` covers the endpoints whose fields are all optional: passing `{}`
 * lets an empty request body mean "no changes" instead of a validation failure.
 */
export async function parseBody<T>(
	request: Request,
	schema: ZodType<T>,
	{ missingAs }: { missingAs?: unknown } = {}
): Promise<T> {
	const raw = await request.json().catch(() => null);
	const parsed = schema.safeParse(raw ?? missingAs ?? null);
	if (!parsed.success) throwZodError(parsed.error);
	return parsed.data;
}

// ============================================================================
// Uploads
// ============================================================================

/**
 * Pull a required file out of a multipart body and check its size and, where
 * given, its extension.
 *
 * The extension allowlist and the size cap were written out at five call sites,
 * each formatting the same "Max size: N MB" message — one of the places where
 * two endpoints must agree and nothing made them. The caps themselves stay in
 * `admin-config`; this only applies them.
 *
 * The size check is a second line of defence, not the first: `requireMaxBodySize`
 * rejects an oversized request before it is buffered. This catches a file that
 * is individually too large inside a request that is not.
 */
export function requireUpload(
	form: FormData,
	field: string,
	{
		maxBytes,
		extensions,
		contentTypes,
		label = 'File'
	}: {
		maxBytes: number;
		extensions?: readonly string[];
		contentTypes?: { allowed: ReadonlySet<string>; message: string };
		label?: string;
	}
): { file: File; extension: string } {
	const file = form.get(field);
	if (!(file instanceof File) || file.size === 0) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, `A ${label.toLowerCase()} is required`);
	}

	const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	if (extensions && !extensions.includes(extension)) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`File type not allowed. Allowed: ${extensions.join(', ')}`
		);
	}

	if (contentTypes && !contentTypes.allowed.has(file.type)) {
		apiError(400, ApiErrorCode.VALIDATION_FAILED, contentTypes.message);
	}

	if (file.size > maxBytes) {
		apiError(
			400,
			ApiErrorCode.VALIDATION_FAILED,
			`${label} too large. Max size: ${maxBytes / (1024 * 1024)} MB`
		);
	}

	return { file, extension };
}

/** A multipart text field, trimmed and length-capped. Absent stays `undefined`. */
export function formText(
	form: FormData,
	field: string,
	{ maxLength }: { maxLength?: number } = {}
): string | undefined {
	const raw = form.get(field);
	if (typeof raw !== 'string') return undefined;
	const trimmed = raw.trim();
	if (!trimmed) return undefined;
	return maxLength ? trimmed.slice(0, maxLength) : trimmed;
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
 * **This is what keeps a secret from reaching a client by accident.** Several
 * responses are store records with a credential removed — `tokenHash` on a
 * share link or invite, `apiKey` on an org compute server — and until now the
 * removal was a destructuring line a future edit could drop. Adding a field to
 * the store type would then publish it, silently, with nothing failing.
 *
 * Parsing through a schema inverts that: the response carries what the schema
 * names and nothing else, so a new field on the stored type is invisible until
 * someone adds it here deliberately.
 */
export function shaped<T>(schema: ZodType<T>, payload: unknown, status = 200): Response {
	// A response that fails its own schema is a bug in this app, not bad input
	// from a caller — let it surface as a 500 rather than shipping a half-valid
	// body a client would have to guess at.
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
 * Every route used to end in the same `try { … } catch (err) { handleApiError(
 * err, '…') }` — 59 of them. The wrapper hoists it, which is not only less to
 * read: a handler that forgot the try/catch surfaced a raw 500 with a provider
 * message in it, and nothing flagged the omission.
 *
 * `fallback` is the message used when the error carries none of its own; it is
 * required because "something went wrong" tells a caller nothing.
 */
export function apiRoute<E extends RequestEvent>(
	fallback: string,
	handler: (event: E) => Promise<Response>
): (event: E) => Promise<Response> {
	return async (event) => {
		try {
			return await handler(event);
		} catch (err) {
			// `handleApiError` re-throws anything already structured, so a
			// deliberate `apiError(404, …)` passes through untouched.
			handleApiError(err, fallback);
		}
	};
}
