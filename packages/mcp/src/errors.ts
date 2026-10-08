/** A failed `/api/v1` call, with the host's error envelope when it sent one. */
export class ApiCallError extends Error {
	constructor(
		readonly operationId: string,
		/** HTTP status; `0` when no response arrived. */
		readonly status: number,
		/** The envelope's `code`, or `TIMEOUT` / `UNREACHABLE` without a response. */
		readonly code: string,
		message: string,
		readonly fields?: Record<string, string>,
		readonly details?: Record<string, string>,
		readonly retryAfterSeconds?: number
	) {
		super(message);
		this.name = 'ApiCallError';
	}
}

/**
 * Turns an error into a hint for the model: what to do next, given a status.
 * Return `undefined` to fall through to the default.
 */
export type ErrorHint = (err: ApiCallError) => string | undefined;

function defaultHint(err: ApiCallError): string {
	switch (err.status) {
		case 0:
			return err.code === 'TIMEOUT'
				? 'The call timed out. It may still have run; check its result before calling again.'
				: 'The server could not be reached. Tell the user; do not retry right away.';
		case 400:
			return 'Fix the fields named above and call again.';
		case 401:
			return 'The API key is missing, invalid, expired or revoked. Tell the user; retrying will not help.';
		case 403: {
			const scope = err.details?.requiredScope;
			return scope
				? `The API key lacks the \`${scope}\` scope. Tell the user to grant it; retrying will not help.`
				: 'The caller may not do this. Tell the user; retrying will not help.';
		}
		case 404:
			return 'No such resource, or the key cannot see it. Look the id up with a list tool.';
		case 409:
			return 'This conflicts with the current state. Read the resource again before deciding.';
		case 422:
			return 'The request is well-formed but refused. Read the reason above; do not resend it unchanged.';
		case 429:
			return err.retryAfterSeconds !== undefined
				? `Rate limited for ${formatWait(err.retryAfterSeconds)}. Tell the user; do not retry before then.`
				: 'Rate limited. Tell the user; do not retry right away.';
		case 503:
			return 'A server dependency is unavailable. Tell the user and try again later.';
		default:
			return err.status >= 500 ? 'The server failed. Tell the user; retrying may not help.' : '';
	}
}

function formatWait(seconds: number): string {
	if (seconds < 120) return `${Math.ceil(seconds)}s`;
	const minutes = Math.ceil(seconds / 60);
	if (minutes < 120) return `${minutes} min`;
	return `${Math.floor(minutes / 60)}h ${minutes % 60}min`;
}

/** The text a model reads for a failed call: what failed, the field errors, what to do next. */
export function describeError(err: ApiCallError, hint?: ErrorHint): string {
	const status = err.status ? `${err.status} ${err.code}` : err.code;
	const lines = [`${err.operationId} failed: ${status}: ${err.message}`];
	for (const [field, message] of Object.entries(err.fields ?? {})) {
		lines.push(`  ${field}: ${message}`);
	}
	const next = hint?.(err) ?? defaultHint(err);
	if (next) lines.push(next);
	return lines.join('\n');
}
