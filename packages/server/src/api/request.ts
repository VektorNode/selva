/**
 * Reading a request: path params, JSON bodies, multipart uploads.
 *
 * Every helper here fails by throwing `ApiError`, so a handler using them names
 * no web framework. They were written against SvelteKit's `error()` and moved
 * once the handlers themselves became transport-free — the logic never depended
 * on the framework, only the throw did.
 *
 * `requireCaller` reads identity off `ApiRequest`, never off a host's `locals`
 * — a host maps its own session shape onto `ctx`/`user` when it builds the
 * request, and nothing below this line knows how it did that.
 */

import type { AuthUser, RequestContext } from '@selvajs/platform';
import type { ZodError, ZodType } from 'zod';
import { apiError, ApiErrorCode } from './errors.js';
import type { ApiRequest } from './types.js';

/**
 * The authenticated caller, or a 401.
 *
 * `ctx` and `user` are optional on `ApiRequest` because a host builds one for
 * anonymous requests too (share-token solves reach handlers with a `ctx` and no
 * `user`). Every handler that needs an identity narrows it here rather than
 * asserting the fields non-null, so the unauthenticated path fails as a denial
 * instead of a crash.
 */
export function requireCaller(req: ApiRequest): { ctx: RequestContext; user: AuthUser } {
	if (!req.ctx || !req.user) {
		apiError(401, ApiErrorCode.UNAUTHORIZED, 'Unauthorized');
	}
	return { ctx: req.ctx, user: req.user };
}

/**
 * Fail with a Zod error's messages, one per field.
 *
 * The top-level `message` names the first problem so a human reading the
 * response learns something without parsing `fields`.
 */
export function throwZodError(err: ZodError): never {
	const fields: Record<string, string> = {};
	for (const issue of err.issues) {
		const key = issue.path.length ? issue.path.join('.') : '_';
		// First message per field wins; later issues on the same path are
		// usually redundant refinements.
		if (!(key in fields)) fields[key] = issue.message;
	}
	const first = err.issues[0];
	const path = first.path.length ? `${first.path.join('.')}: ` : '';
	apiError(400, ApiErrorCode.VALIDATION_FAILED, `${path}${first.message}`, fields);
}

// ============================================================================
// Path params
// ============================================================================

/**
 * Read required path params, 400ing on any that is missing or blank.
 *
 * A router types every param as `string`, but a route can be reached with an
 * empty segment — this catches that instead of letting a stale non-null
 * assertion paper over it.
 *
 * Does **not** validate format — a guid-shaped param still goes through a
 * schema where the route cares. Replaces the `if (!id) apiError(...)` preamble,
 * not the schema check.
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
 * given, its extension.
 *
 * A second line of defence, not the first: a host's body-size guard should
 * reject an oversized request before it is buffered. This catches a file that
 * is individually too large inside a request that isn't.
 *
 * Caps are passed in rather than read here — they are deployment config, and a
 * package that resolved them would pin every host to one source of truth.
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
