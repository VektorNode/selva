/**
 * `io/`: curves and points in and out. DXF needs nothing; the Rhino functions take a loaded rhino3dm module.
 *
 * @module io
 */

export { parseDxf } from './dxf.js';
export type { DxfImport } from './dxf.js';

export {
	decodeItem,
	encodeItem,
	isRhinoArchive,
	lineFromRhinoJson,
	lineToRhinoJson,
	pointFromRhinoJson,
	pointToRhinoJson,
	read3dm
} from './rhino.js';
export type { File3dmImport, RhinoArchive, RhinoLineJson, RhinoPointJson } from './rhino.js';
