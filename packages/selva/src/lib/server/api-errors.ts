import { error, isHttpError } from '@sveltejs/kit';
import { ProviderError, type ILogger } from '@selvajs/platform';
import { renderThrown } from '@selvajs/server/logging';
import { ApiErrorCode, codeForStatus, isApiError } from '@selvajs/server/api';
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

// One code list for the app and every package handler, so the spec's enum
// can't miss a code a handler raises.
export { ApiErrorCode };

/**
 * Thin wrapper over SvelteKit's `error()` that forces the `{ message, code }`
 * envelope. Use instead of `error(status, 'message string')` so every error
 * carries a code.
 */
export function apiError(
	status: number,
	code: ApiErrorCode,
	message: string,
	fields?: Record<string, string>,
	details?: Record<string, string>
): never {
	throw error(status, { message, code, ...(fields && { fields }), ...(details && { details }) });
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

/** Normalizes any error raised inside an API handler to a structured SvelteKit HTTP error. */
export function handleApiError(err: unknown, fallback: string, log?: ILogger): never {
	if (isHttpError(err)) throw err;
	// The transport-free parsers in `@selvajs/server/api` raise `ApiError`, not
	// SvelteKit's `error()`. Routes still wrapped in `apiRoute` reach this path,
	// so translate rather than letting a validation failure fall through to the
	// 500 branch below.
	if (isApiError(err)) {
		apiError(err.status, err.code, err.message, err.fields, err.details);
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
	// string first, so the console fallback below (for the handful of callers
	// with no `locals.log` in scope) is safe too.
	const rendered = renderThrown(err);
	if (log) log.error(`[API] ${fallback}`, { component: 'api', err: rendered });
	else console.error(`[API] ${fallback}:`, rendered);
	apiError(500, ApiErrorCode.INTERNAL, fallback);
}

export { throwZodError } from '@selvajs/server/api';
