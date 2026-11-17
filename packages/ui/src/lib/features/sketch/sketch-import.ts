import type { SketchItem } from '@selvajs/sketch/model';

// Each item is one item of the solve request. A drawing exported whole from CAD can hold tens of
// thousands, which is megabytes on every solve.
export const MAX_IMPORTED_ITEMS = 2000;

export interface SketchImport {
	/** In model units. */
	items: SketchItem[];
	/** Objects in the file that the input does not take. */
	skipped: number;
}

export class SketchImportError extends Error {
	constructor(readonly reason: 'unsupported' | 'unreadable' | 'tooMany') {
		super(`Import failed: ${reason}`);
	}
}
