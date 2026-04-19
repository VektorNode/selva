import type { DefinitionFileExt } from './types.js';

export const definitionPaths = {
	file: (guid: string, ext: DefinitionFileExt) => `definitions/${guid}/definition.${ext}`,
	image: (guid: string) => `definitions/${guid}/cover.webp`,
	archive: (guid: string, ref: string) => `definitions/${guid}/old_files/${ref}`,
	prefix: (guid: string) => `definitions/${guid}/`
} as const;
