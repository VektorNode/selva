import { assertSafeKey } from '../storage/safeKey.js';
import type { DefinitionFileExt } from './types.js';

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
