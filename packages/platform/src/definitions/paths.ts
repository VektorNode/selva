import { assertSafeKey } from '../storage/safeKey.js';
import type { DefinitionFileExt } from './types.js';

function prefix(guid: string): string {
	assertSafeKey(guid, 'guid');
	return `definitions/${guid}/`;
}

export const definitionPaths = {
	version: (guid: string, versionNumber: number, ext: DefinitionFileExt) => {
		const dir = prefix(guid);
		if (!Number.isInteger(versionNumber) || versionNumber < 1) {
			throw new Error(`Unsafe versionNumber: ${versionNumber}`);
		}
		return `${dir}versions/v${versionNumber}.${ext}`;
	},
	image: (guid: string) => `${prefix(guid)}cover.webp`,
	prefix
} as const;
