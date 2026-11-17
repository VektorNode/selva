import type { RhinoModule } from 'rhino3dm';
import { parseDxf, read3dm } from '@selvajs/sketch/io';
import { scaleItem, type SketchItem } from '@selvajs/sketch/model';
import { MAX_IMPORTED_ITEMS, SketchImportError, type SketchImport } from './sketch-import.js';

interface FileItems {
	items: SketchItem[];
	metersPerUnit: number | null;
	skipped: number;
}

type RhinoLoader = (() => Promise<RhinoModule>) | null;

async function readItems(file: File, loadRhino: RhinoLoader): Promise<FileItems> {
	const extension = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
	const readable = extension === '.dxf' || (extension === '.3dm' && loadRhino !== null);
	if (!readable) throw new SketchImportError('unsupported');
	try {
		if (extension === '.3dm' && loadRhino) {
			return read3dm(await loadRhino(), new Uint8Array(await file.arrayBuffer()));
		}
		const dxf = parseDxf(await file.text());
		return { ...dxf, skipped: Object.values(dxf.skipped).reduce((sum, n) => sum + n, 0) };
	} catch {
		throw new SketchImportError('unreadable');
	}
}

/**
 * Reads the curves and points out of a DXF or 3DM file and scales them from the file's units to
 * the model's. A file that states no units is taken to be in model units already. A 3DM needs
 * `loadRhino`.
 *
 * @throws {SketchImportError}
 */
export async function importSketchFile(
	file: File,
	metersPerModelUnit: number,
	loadRhino: RhinoLoader
): Promise<SketchImport> {
	const { items, metersPerUnit, skipped } = await readItems(file, loadRhino);
	if (items.length > MAX_IMPORTED_ITEMS) throw new SketchImportError('tooMany');
	const factor = metersPerUnit === null ? 1 : metersPerUnit / metersPerModelUnit;
	return { items: items.map((item) => scaleItem(item, factor)), skipped };
}
