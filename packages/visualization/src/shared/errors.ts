/**
 * Errors for the visualization package.
 *
 * These used to be `RhinoComputeError` from `@selvajs/compute`, which was wrong on the project's
 * own terms as well as a dependency: in the plugin's WebSocket path a malformed mesh blob never
 * went near Rhino.Compute, so naming that transport in the error named something the failure has
 * nothing to do with.
 *
 * The `code` values are kept identical to compute's so existing catch-sites that match on
 * `error.code` keep working across the change.
 *
 * @module shared/errors
 */

export const ErrorCodes = {
	/** A payload failed a structural check (bad magic bytes, out-of-window index, malformed metadata). */
	VALIDATION_ERROR: 'VALIDATION_ERROR',
	/** An operation was attempted against state that cannot support it. */
	INVALID_STATE: 'INVALID_STATE',
	/** A required runtime capability is missing (no `DecompressionStream`, no WebGL context, ...). */
	ENVIRONMENT_ERROR: 'ENVIRONMENT_ERROR',
	/** A caller-supplied option or dependency has an unusable shape. */
	INVALID_CONFIG: 'INVALID_CONFIG',
	/** Base64 input could not be decoded. */
	ENCODING_ERROR: 'ENCODING_ERROR',
	UNKNOWN_ERROR: 'UNKNOWN_ERROR'
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Error carrying a machine-readable {@link ErrorCode} plus structured context. */
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
