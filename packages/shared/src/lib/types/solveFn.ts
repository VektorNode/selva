export interface SolveResult {
	outputs: Record<string, unknown>;
	meshes?: any[];
	errors?: string[];
	warnings?: string[];
}

export type SolveFn = (
	values: Record<string, unknown>,
	signal: AbortSignal
) => Promise<SolveResult>;
