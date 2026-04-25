import type { DefinitionFileExt } from './types.js';

/**
 * Path-segment safety check. Blocks traversal (`..`), absolute markers,
 * separators, NUL, and empty segments. Keep the allowed alphabet tight —
 * GUIDs and sanitized refs both satisfy `[A-Za-z0-9._-]+`.
 *
 * Called by every helper below so a malicious `guid` or `ref` can never
 * escape the `definitions/` prefix regardless of where it originated.
 */
function assertSafeKey(value: string, label: string): void {
	if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
	}
}

export const definitionPaths = {
	/** Per-version immutable blob (spec §6). versionNumber must be a positive int. */
	version: (guid: string, versionNumber: number, ext: DefinitionFileExt) => {
		assertSafeKey(guid, 'guid');
		if (!Number.isInteger(versionNumber) || versionNumber < 1) {
			throw new Error(`Unsafe versionNumber: ${versionNumber}`);
		}
		return `definitions/${guid}/versions/v${versionNumber}.${ext}`;
	},
	image: (guid: string) => {
		assertSafeKey(guid, 'guid');
		return `definitions/${guid}/cover.webp`;
	},
	prefix: (guid: string) => {
		assertSafeKey(guid, 'guid');
		return `definitions/${guid}/`;
	}
} as const;
