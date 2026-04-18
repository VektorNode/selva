/**
 * Thrown by provider implementations to signal a known, user-facing error.
 * The API layer forwards the message directly to the client (4xx) instead of
 * swallowing it as a generic 500.
 */
export class ProviderError extends Error {
	readonly statusCode: number;

	constructor(message: string, statusCode: 400 | 403 | 404 | 409 | 501 = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}
