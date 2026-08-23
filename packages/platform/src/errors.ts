/**
 * Thrown by providers to signal an expected failure the API layer forwards with
 * a specific status. Unknown errors should propagate as plain `Error` and become 500s.
 */
export class ProviderError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: number = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}
