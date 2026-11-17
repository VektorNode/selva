import type { SketchCurve } from '@selvajs/sketch/model';

// Each curve is one item of the solve request. A drawing exported whole from CAD can hold tens
// of thousands, which is megabytes on every solve.
export const MAX_IMPORTED_CURVES = 2000;

export interface CurveImport {
	/** In model units. */
	curves: SketchCurve[];
	/** Objects in the file that are not curves this reads. */
	skipped: number;
}

export class CurveImportError extends Error {
	constructor(readonly reason: 'unsupported' | 'unreadable' | 'tooMany') {
		super(`Curve import failed: ${reason}`);
	}
}
