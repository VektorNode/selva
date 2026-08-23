/**
 * The transport-free error type every API handler raises.
 *
 * `apiError` used to throw SvelteKit's `error()` directly, which welded all 151
 * of its call sites to one framework. `ApiError` carries the same envelope as a
 * plain exception; the host adapter converts it to whatever its framework
 * expects (see `toApiResponse`). Call sites are unchanged — only the throw
 * site and the boundary know the difference.
 */

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

export class ApiError extends Error {
	readonly status: number;
	readonly code: ApiErrorCode;
	/** Per-field validation messages, keyed by dotted path. Only on VALIDATION_FAILED. */
	readonly fields?: Record<string, string>;

	constructor(
		status: number,
		code: ApiErrorCode,
		message: string,
		fields?: Record<string, string>
	) {
		super(message);
		this.name = 'ApiError';
		this.status = status;
		this.code = code;
		this.fields = fields;
	}
}

export function isApiError(err: unknown): err is ApiError {
	return err instanceof ApiError;
}

/** Raise a structured API error. The only way handlers should fail. */
export function apiError(
	status: number,
	code: ApiErrorCode,
	message: string,
	fields?: Record<string, string>
): never {
	throw new ApiError(status, code, message, fields);
}

/** Default code for a status, for mapping errors that carry no code of their own. */
export function codeForStatus(status: number): ApiErrorCode {
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
