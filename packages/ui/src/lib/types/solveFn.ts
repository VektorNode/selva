/**
 * Result returned from a solve operation.
 *
 * @property outputs - Key-value pairs of computed results
 * @property meshes - Optional array of 3D mesh data generated during computation
 * @property errors - Optional array of error messages that occurred
 * @property warnings - Optional array of warning messages from the computation
 */
export interface SolveResult {
	outputs: Record<string, unknown>;
	meshes?: any[];
	errors?: string[];
	warnings?: string[];
}

/**
 * Function type for running a computation with given input values.
 *
 * Implementations should listen to the abort signal and clean up resources
 * when the signal is triggered (e.g., when the user cancels the operation).
 *
 * @param values - Input parameters for the computation
 * @param signal - AbortSignal to cancel ongoing operations
 * @returns Promise resolving to the computation result
 */
export type SolveFn = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult>;
