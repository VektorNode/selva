import { error, isHttpError } from '@sveltejs/kit';
import { ProviderError, type ILogger } from '@selvajs/platform';
import { renderThrown } from '@selvajs/server/logging';
import { isApiError } from '@selvajs/server/api';
import { SchemaExtractionError } from '@selvajs/server/definitions';
import { ComputeServerUnconfiguredError } from '@selvajs/server/compute';

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
export function handleApiError(err: unknown, fallback: string, log?: ILogger): never {
	if (isHttpError(err)) throw err;
	// The transport-free parsers in `@selvajs/server/api` raise `ApiError`, not
	// SvelteKit's `error()`. Routes still wrapped in `apiRoute` (admin, and the
	// streaming solve routes) reach this path, so translate rather than letting
	// a validation failure fall through to the 500 branch below.
	if (isApiError(err)) {
		apiError(err.status, err.code, err.message, err.fields);
	}
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
	// Through the logger, never `console.error(…, err)`. Provider adapters stash
	// connection details (host, user, sometimes a DSN) on `cause`, and a raw
	// console call hands the whole object to stdout, where pino's redaction
	// never runs and erasure can't follow. `renderThrown` flattens to a stack
	// string; the logger redacts what remains.
	// `log` is `locals.log` when a request is in scope. The console fallback is
	// for the handful of callers outside one; `renderThrown` has already
	// flattened the error, so no object reaches stdout either way.
	const rendered = renderThrown(err);
	if (log) log.error(`[API] ${fallback}`, { component: 'api', err: rendered });
	else console.error(`[API] ${fallback}:`, rendered);
	apiError(500, ApiErrorCode.INTERNAL, fallback);
}

// `throwZodError` moved to `@selvajs/server/api`, which is where the parsers
// that raise it now live. Keeping a second copy here would let this app's
// validation envelope drift from the package's.
export { throwZodError } from '@selvajs/server/api';
