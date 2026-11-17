/**
 * `model/`: curves as plain data, and the math on them. No three, no rhino3dm.
 *
 * @module model
 */

export type {
	ItemTags,
	Point3,
	SketchCurve,
	SketchItem,
	SketchLine,
	SketchPoint,
	SketchPolyline,
	SketchNurbs
} from './curve.js';
export {
	clampedKnots,
	distance,
	explodeToLines,
	groupByPath,
	isCurve,
	isPoint,
	isValidCurve,
	isValidItem,
	mapPoints,
	nurbsFromControlPoints,
	parsePath,
	pathKey,
	tagsOf,
	scaleItem,
	verticesOf,
	withVertex,
	withoutVertex
} from './curve.js';

export type { QuadraticSpan } from './nurbs.js';
export {
	arcNurbs,
	arcSpans,
	bulgeSpans,
	evaluateNurbs,
	lineSpan,
	nurbsDomain,
	nurbsFromQuadraticSpans,
	tessellate
} from './nurbs.js';

export type { Segment } from './measure.js';
export { curveLength, segmentsOf, setSegmentLength } from './measure.js';
