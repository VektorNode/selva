/**
 * `io/`: curves in and out. DXF needs nothing; the Rhino functions take a loaded rhino3dm module.
 *
 * @module io
 */

export { parseDxf } from './dxf.js';
export type { DxfImport } from './dxf.js';

export {
	decodeCurve,
	encodeCurve,
	isRhinoArchive,
	lineFromRhinoJson,
	lineToRhinoJson,
	read3dm
} from './rhino.js';
export type { File3dmImport, RhinoArchive, RhinoLineJson } from './rhino.js';
