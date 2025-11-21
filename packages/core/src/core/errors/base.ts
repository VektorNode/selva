/**
 * Simplified error for Rhino Compute operations
 *
 * @public Use this for error handling with error codes and context.
 */
export class RhinoComputeError extends Error {
  public readonly code: string;
  public readonly statusCode?: number;
  public readonly context?: Record<string, unknown>;

  constructor(
    message: string,
    code: string = 'UNKNOWN_ERROR',
    options?: { statusCode?: number; context?: Record<string, unknown> }
  ) {
    super(message);
    this.name = 'RhinoComputeError';
    this.code = code;
    this.statusCode = options?.statusCode;
    this.context = options?.context;
  }
}
