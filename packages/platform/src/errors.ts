/**
 * Thrown by providers to signal an expected failure the API layer forwards with
 * a specific status. Unknown errors should propagate as plain `Error` and become 500s.
 */
const BRAND = Symbol.for('@selvajs/platform/ProviderError');

export class ProviderError extends Error {
	readonly statusCode: number;
	readonly [BRAND] = true;

	/**
	 * Providers depend on this package, so a version mismatch installs two copies
	 * and plain `instanceof` would turn a 403 from one into a 500 in the other.
	 */
	static [Symbol.hasInstance](value: unknown): boolean {
		if (this !== ProviderError) return Function.prototype[Symbol.hasInstance].call(this, value);
		return typeof value === 'object' && value !== null && BRAND in value;
	}

	constructor(message: string, statusCode: number = 400) {
		super(message);
		this.name = 'ProviderError';
		this.statusCode = statusCode;
	}
}
