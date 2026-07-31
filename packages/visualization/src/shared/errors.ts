/**
 * Errors for the visualization package. Replaces `@selvajs/compute`'s `RhinoComputeError`, which
 * mis-named failures on paths (e.g. the plugin WebSocket) that never touch Rhino.Compute. `code`
 * values match compute's so existing catch-sites keep working.
 */

export const ErrorCodes = {
	/** Structural check failed: bad magic bytes, out-of-window index, malformed metadata. */
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	INVALID_STATE: 'INVALID_STATE',
	/** No `DecompressionStream`, no WebGL context, etc. */
	ENVIRONMENT_ERROR: 'ENVIRONMENT_ERROR',
	INVALID_CONFIG: 'INVALID_CONFIG',
	/** Base64 input could not be decoded. */
	ENCODING_ERROR: 'ENCODING_ERROR',
	UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export class VisualizationError extends Error {
	public readonly code: ErrorCode;
	public readonly context?: Record<string, unknown>;
	public readonly originalError?: Error;

	constructor(
		message: string,
		code: ErrorCode = ErrorCodes.UNKNOWN_ERROR,
		options?: { context?: Record<string, unknown>; originalError?: Error }
	) {
		super(message);
		this.name = 'VisualizationError';
		this.code = code;
		this.context = options?.context;
		this.originalError = options?.originalError;
		if (options?.originalError) {
			(this as { cause?: unknown }).cause = options.originalError;
		}
	}
}
