import type { DefinitionFileExt } from './types.js';

/**
 * Path-segment safety check. Blocks traversal, separators, NUL, and empty
 * segments. Allowed alphabet `[A-Za-z0-9._-]+` covers GUIDs and sanitized
 * refs. Called by every helper so a malicious `guid` can't escape the
 * `definitions/` prefix.
 */
function assertSafeKey(value: string, label: string): void {
	if (!value || !/^[A-Za-z0-9._-]+$/.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
	}
}

export const definitionPaths = {
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
