import type { RhinoModule } from 'rhino3dm';
import { parseDxf, read3dm } from '@selvajs/sketch/io';
import { scaleCurve, type SketchCurve } from '@selvajs/sketch/model';
import { CurveImportError, MAX_IMPORTED_CURVES, type CurveImport } from './curve-import.js';

interface FileCurves {
	curves: SketchCurve[];
	metersPerUnit: number | null;
	skipped: number;
}

type RhinoLoader = (() => Promise<RhinoModule>) | null;

async function readCurves(file: File, loadRhino: RhinoLoader): Promise<FileCurves> {
	const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	const readable = extension === '.dxf' || (extension === '.3dm' && loadRhino !== null);
	if (!readable) throw new CurveImportError('unsupported');
	try {
		if (extension === '.3dm' && loadRhino) {
			return read3dm(await loadRhino(), new Uint8Array(await file.arrayBuffer()));
		}
		const dxf = parseDxf(await file.text());
		return { ...dxf, skipped: Object.values(dxf.skipped).reduce((sum, n) => sum + n, 0) };
	} catch {
		throw new CurveImportError('unreadable');
	}
}

/**
 * Reads the curves out of a DXF or 3DM file and scales them from the file's units to the model's.
 * A file that states no units is taken to be in model units already. A 3DM needs `loadRhino`.
 *
 * @throws {CurveImportError}
 */
export async function importCurveFile(
	file: File,
	metersPerModelUnit: number,
	loadRhino: RhinoLoader
): Promise<CurveImport> {
	const { curves, metersPerUnit, skipped } = await readCurves(file, loadRhino);
	if (curves.length > MAX_IMPORTED_CURVES) throw new CurveImportError('tooMany');
	const factor = metersPerUnit === null ? 1 : metersPerUnit / metersPerModelUnit;
	return { curves: curves.map((curve) => scaleCurve(curve, factor)), skipped };
}
