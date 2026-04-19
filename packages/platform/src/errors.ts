/**
 * Thrown by provider implementations to signal an expected failure that the
 * API layer should forward to the client with a specific status. Unknown /
 * unexpected errors should propagate as plain Error and become generic 500s.
 *
 * 500 is on the allow-list for broken invariants the adapter can describe
 * (e.g. "No projects configured") — routes still render them as server errors
 * but get a useful message instead of "Internal Server Error".
 */
export class ProviderError extends Error {
	readonly statusCode: ProviderErrorStatus;

	constructor(message: string, statusCode: ProviderErrorStatus = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}

export type ProviderErrorStatus = 400 | 403 | 404 | 409 | 500;
