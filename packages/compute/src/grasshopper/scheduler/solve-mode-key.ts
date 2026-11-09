import type { SolveMode } from '../types';

/**
 * Appends the mode to a solve key. A preview response has no deferred files, so it must never
 * share a cache or single-flight entry with a full solve of the same inputs.
 */
export function withSolveMode(key: string, mode: SolveMode | undefined): string {
	return mode === 'preview' ? `${key}:preview` : key;
}
