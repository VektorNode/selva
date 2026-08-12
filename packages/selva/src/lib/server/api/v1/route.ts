/**
 * The shared shape of a v1 route handler: validate the path, parse the body,
 * do the work, serialize. Before these helpers existed, every handler spelled
 * all four out, and the boilerplate had already drifted — path params were
 * validated two different ways, and list endpoints hand-rolled pagination
 * clamps that disagreed with each other.
 *
 * The rule these helpers enforce: **a route handler parses, guards, delegates
 * and serializes — nothing else.** Anything two endpoints must agree on lives
 * here or in `@selvajs/server`, never copied into both.
 */

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import type { ZodType } from 'zod';
import { apiError, ApiErrorCode, handleApiError, throwZodError } from '../../api-errors.js';

// ============================================================================
// Caller identity
// ============================================================================

/**
 * The authenticated caller, or 401. Returns the narrowed pair so callers don't
 * need `locals.ctx!` — if you have the result, the context exists.
 *
 * Guards in `access.server.ts` do their own 401 as a side effect of checking a
 * permission. This is for handlers that need an identity without a permission
 * check — the `/me` routes, and reads whose authorization is a visibility filter.
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
 * empty segment — this catches that instead of letting a stale non-null
 * assertion paper over it.
 *
 * Does **not** validate format — a guid-shaped param still goes through
 * `GuidSchema` where the route cares. Replaces the `if (!id) apiError(...)`
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
 * segments, anything where "present" isn't the same as "valid".
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
 * Parse and validate a JSON body. A malformed body becomes `null` rather than
 * throwing, so it fails the schema as a validation error — broken JSON gets a
 * 400 naming the problem, not a 500 from `request.json()`.
 *
 * `missingAs` covers endpoints whose fields are all optional: passing `{}` lets
 * an empty body mean "no changes" instead of a validation failure.
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
 * given, its extension. Caps themselves stay in `admin-config`; this only
 * applies them.
 *
 * A second line of defence, not the first: `requireMaxBodySize` rejects an
 * oversized request before it's buffered. This catches a file that's
 * individually too large inside a request that isn't.
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
 * share link or invite, `apiKey` on an org compute server. Parsing through a
 * schema means the response carries only what the schema names, so a new field
 * on the stored type is invisible until someone adds it here deliberately. See
 * `responses.ts`.
 */
export function shaped<T>(schema: ZodType<T>, payload: unknown, status = 200): Response {
	// A response failing its own schema is a bug in this app, not bad caller
	// input — let it surface as a 500 rather than ship a half-valid body.
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
 * err, '…') }`. A handler that forgot it surfaced a raw 500 with a provider
 * message in it, with nothing flagging the omission.
 *
 * `fallback` is required — the message used when the error carries none of its
 * own, and "something went wrong" tells a caller nothing.
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
