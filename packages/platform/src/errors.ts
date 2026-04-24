/**
 * Thrown by provider implementations to signal an expected failure that the
 * API layer should forward to the client with a specific status. Unknown /
 * unexpected errors should propagate as plain Error and become generic 500s.
 *
 * Conventional values: 400 (bad input), 401 (unauthenticated), 403 (forbidden),
 * 404 (not found), 409 (conflict), 422 (unprocessable), 429 (rate limited),
 * 500 (broken invariant the adapter can describe). Other HTTP status numbers
 * are accepted but discouraged.
 */
export class ProviderError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}

