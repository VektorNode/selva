/**
 * Thrown by providers to signal an expected failure that the API layer
 * should forward with a specific status. Unknown errors should propagate as
 * plain `Error` and become 500s.
 *
 * Conventional values: 400, 401, 403, 404, 409, 422, 429, 500.
 */
export class ProviderError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}
