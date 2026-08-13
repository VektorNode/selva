import { error, isHttpError } from '@sveltejs/kit';
import { ProviderError } from '@selvajs/platform';
import type { ZodError } from 'zod';
import { SchemaExtractionError } from './definitions/schemaExtraction.server';
import { ComputeServerUnconfiguredError } from './compute/resolve.server';

// ============================================================================
// Error envelope
// ============================================================================
//
// Every error this app raises is a SvelteKit `error(status, body)` whose body
// is the typed `App.Error`: `{ message, code, fields? }`. `code` is a stable,
// machine-readable string so consumers (the web UI, any external CLI/SDK) can
// branch on the failure class without parsing the human message.

/** Stable, machine-readable error codes. Append-only — never renumber/rename. */
export const ApiErrorCode = {
	VALIDATION_FAILED: 'VALIDATION_FAILED',
	UNAUTHORIZED: 'UNAUTHORIZED',
	FORBIDDEN: 'FORBIDDEN',
	NOT_FOUND: 'NOT_FOUND',
	CONFLICT: 'CONFLICT',
	UNPROCESSABLE: 'UNPROCESSABLE',
	COMPUTE_UNAVAILABLE: 'COMPUTE_UNAVAILABLE',
	SETUP_REQUIRED: 'SETUP_REQUIRED',
	INTERNAL: 'INTERNAL'
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

/**
 * Thin wrapper over SvelteKit's `error()` that forces the `{ message, code }`
 * envelope. Use instead of `error(status, 'message string')` so every error
 * carries a code.
 */
export function apiError(
	status: number,
	code: ApiErrorCode,
	message: string,
	fields?: Record<string, string>
): never {
	throw error(status, fields ? { message, code, fields } : { message, code });
}

/** Default code for a given HTTP status, used when mapping opaque errors. */
function codeForStatus(status: number): ApiErrorCode {
	switch (status) {
		case 400:
			return ApiErrorCode.VALIDATION_FAILED;
		case 401:
			return ApiErrorCode.UNAUTHORIZED;
		case 403:
			return ApiErrorCode.FORBIDDEN;
		case 404:
			return ApiErrorCode.NOT_FOUND;
		case 409:
			return ApiErrorCode.CONFLICT;
		case 422:
			return ApiErrorCode.UNPROCESSABLE;
		case 503:
			return ApiErrorCode.COMPUTE_UNAVAILABLE;
		default:
			return ApiErrorCode.INTERNAL;
	}
}

// Postgres unique-constraint names → friendly explanations. Postgrest surfaces
// the constraint name verbatim ("duplicate key value violates unique
// constraint \"foo_key\""), which is useless to end users.
const UNIQUE_CONSTRAINT_MESSAGES: Record<string, string> = {
	projects_org_name_unique: 'A project with that name already exists in this organization.',
	projects_org_id_slug_key: 'A project with that name already exists in this organization.',
	orgs_slug_key: 'An organization with that slug already exists.',
	definitions_pkey: 'A definition with that ID already exists.'
};

function friendlyConstraintMessage(raw: string): string | null {
	for (const [name, msg] of Object.entries(UNIQUE_CONSTRAINT_MESSAGES)) {
		if (raw.includes(name)) return msg;
	}
	return null;
}

/**
 * Normalizes any error raised inside an API handler to a structured SvelteKit
 * HTTP error. Re-throws errors already raised via `apiError`/`error`, maps
 * ProviderError to its statusCode, and falls back to a 500 INTERNAL with the
 * provided message.
 */
export function handleApiError(err: unknown, fallback: string): never {
	if (isHttpError(err)) throw err;
	// Compute unreachable, or serving a schema shape the app cannot read → 503
	// (both are operator-side); invalid/newer-than-supported schema → 422.
	if (err instanceof SchemaExtractionError) {
		if (err.kind === 'unreachable' || err.kind === 'malformed') {
			apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
		}
		apiError(422, ApiErrorCode.UNPROCESSABLE, err.message);
	}
	// No compute server configured/visible — an operator action, not a bug.
	if (err instanceof ComputeServerUnconfiguredError) {
		apiError(503, ApiErrorCode.COMPUTE_UNAVAILABLE, err.message);
	}
	if (err instanceof ProviderError) {
		const friendly = friendlyConstraintMessage(err.message);
		apiError(err.statusCode, codeForStatus(err.statusCode), friendly ?? err.message);
	}
	console.error(`[API] ${fallback}:`, err);
	apiError(500, ApiErrorCode.INTERNAL, fallback);
}

/**
 * Throws a 400 VALIDATION_FAILED from a Zod error. The top-level `message` is
 * the first issue (human-friendly); `fields` maps every issue's dotted path
 * to its message for machine consumption.
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
