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
	file: (guid: string, ext: DefinitionFileExt) => {
		assertSafeKey(guid, 'guid');
		return `definitions/${guid}/definition.${ext}`;
	},
	image: (guid: string) => {
		assertSafeKey(guid, 'guid');
		return `definitions/${guid}/cover.webp`;
	},
	archive: (guid: string, ref: string) => {
		assertSafeKey(guid, 'guid');
		assertSafeKey(ref, 'ref');
		return `definitions/${guid}/archive/${ref}`;
	},
	prefix: (guid: string) => {
		assertSafeKey(guid, 'guid');
		return `definitions/${guid}/`;
	}
} as const;
