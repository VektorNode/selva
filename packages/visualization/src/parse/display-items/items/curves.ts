import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { getLogger, rhinoToThree } from '../../../shared/index.js';
import { materialParams } from './appearance.js';

import type { DisplayCurve } from '../types';
import type { RhinoModule } from 'rhino3dm';

/**
 * Adaptive tessellation parameters. Rather than a fixed segment count, curved spans are recursively
 * split until the midpoint of a span sits within {@link CURVE_CHORD_TOLERANCE_RATIO} of the curve's
 * size from the straight chord — so a span gets points in proportion to how much it actually bends.
 */
/** Initial uniform splits before adaptive refinement kicks in (ensures closed/looping curves aren't collapsed). */
const CURVE_INITIAL_SEGMENTS = 12;
/** Chord-deviation tolerance as a fraction of the curve's bounding-box diagonal. Smaller = smoother. */
const CURVE_CHORD_TOLERANCE_RATIO = 0.0004;
/** Hard recursion-depth cap per initial span, so pathological curves can't explode the vertex count. */
const CURVE_MAX_SUBDIVISION_DEPTH = 12;
/** Max turn angle (radians) allowed across a span before it's split. ~3° keeps arcs visibly smooth. */
const CURVE_MAX_TURN_RADIANS = 0.05;

const DEFAULT_LINE_WIDTH = 2;

/**
 * Decode a curve's Rhino JSON and tessellate it to a fat `Line2`. Returns null if rhino3dm is absent
 * or decoding fails, so one bad curve never aborts the whole batch.
 *
 * Uses `Line2`/`LineMaterial` rather than `THREE.Line` so thickness (`item.width`) is actually
 * honoured — plain `THREE.Line` is hard-capped at 1px on every major GPU backend. `LineMaterial`
 * needs its `resolution` set to the drawing-buffer size, but `Line2.onBeforeRender` does that
 * automatically from the renderer each frame, so the parser needs no renderer reference.
 */
export function buildCurveLine(
	item: DisplayCurve,
	rhino: RhinoModule | undefined,
	applyTransforms: boolean
): Line2 | null {
	if (!rhino) {
		getLogger().warn('No rhino3dm instance provided; skipping curve display item.');
		return null;
	}

	const curve = decodeCurve(item.json, rhino);
	if (!curve) return null;

	let points: THREE.Vector3[];
	try {
		points = tessellate(curve, applyTransforms);
	} catch (error) {
		// WASM calls (pointAt / tryGetPolyline / getBoundingBox) can throw on malformed geometry.
		// Log and skip this curve so one bad item never aborts the whole batch (contract above).
		getLogger().warn('Failed to tessellate curve display item; skipping.', error);
		return null;
	} finally {
		deleteRhinoObject(curve);
	}
	if (points.length < 2) return null;

	const positions: number[] = [];
	for (const p of points) positions.push(p.x, p.y, p.z);

	const geometry = new LineGeometry();
	geometry.setPositions(positions);

	// @types/three's LineMaterial omits `linewidth` (and doesn't surface `transparent`/`opacity`
	// through its chain) though all exist at runtime. Set them via a narrow typed view rather than
	// scattering casts.
	const params = materialParams(item.color, item.opacity);
	const material = new LineMaterial({ color: params.color });
	const styled = material as LineMaterial & {
		linewidth: number;
		transparent: boolean;
		opacity: number;
	};
	styled.linewidth = item.width ?? DEFAULT_LINE_WIDTH; // CSS px (worldUnits defaults false)
	styled.transparent = params.transparent;
	styled.opacity = params.opacity;

	const line = new Line2(geometry, material);
	line.computeLineDistances(); // required for any future dashed styling; cheap
	line.name = item.name;
	line.userData = {
		source: 'compute',
		id: item.id,
		layer: item.layer,
		kind: 'curve',
		metadata: item.metadata
	};
	return line;
}

/**
 * Render a single point as a one-vertex THREE.Points. Returns null (with a warning) when the item's
 * position is missing or non-finite — display items arrive as network JSON, so a malformed point
 * must be skipped rather than throwing or pushing NaN into the buffer (a NaN vertex poisons the
 * bounding sphere and can break camera fit-to-view for the whole scene).
 */
function deleteRhinoObject(obj: unknown): void {
	(obj as { delete?: () => void } | null | undefined)?.delete?.();
}

/** Decode Rhino CommonObject JSON into a rhino3dm Curve (or null on failure). */
function decodeCurve(json: string, rhino: RhinoModule): InstanceType<RhinoModule['Curve']> | null {
	try {
		const parsed = JSON.parse(json);
		const obj = rhino.CommonObject.decode(parsed);
		// decode returns a CommonObject; only curves carry domain/pointAt. Treat anything else as a miss.
		if (obj && typeof (obj as { pointAt?: unknown }).pointAt === 'function') {
			return obj as InstanceType<RhinoModule['Curve']>;
		}
		deleteRhinoObject(obj);
		getLogger().warn('Decoded display-item JSON is not a curve; skipping.');
		return null;
	} catch (error) {
		getLogger().warn('Failed to decode curve display item JSON:', error);
		return null;
	}
}

/**
 * Tessellate a curve to THREE points (passed through the shared — identity — coordinate mapping).
 *
 * Most curves Grasshopper emits are linear — a line is 2 vertices, a polyline is N+1 — yet uniform
 * sampling would inflate every one to {@link CURVE_INITIAL_SEGMENTS}+1 points. So we first ask
 * rhino3dm if the curve *is* a polyline (covers lines, polylines, and degree-1 nurbs/polycurves) and
 * emit its exact vertices when so. Only genuinely curved geometry (arcs, nurbs, polycurves with
 * curved spans) falls through to {@link sampleUniform}.
 */
function tessellate(
	curve: InstanceType<RhinoModule['Curve']>,
	applyTransforms: boolean
): THREE.Vector3[] {
	const exact = tryPolylineVertices(curve, applyTransforms);
	if (exact) return exact;

	return sampleUniform(curve, applyTransforms);
}

/** Minimal shape we use off a rhino3dm Polyline (a Point3dList). */
interface PolylineLike {
	count: number;
	get(index: number): number[];
}

/**
 * If the curve has an exact polyline form, return its vertices; otherwise null. `tryGetPolyline`
 * returns `[ok, Polyline]`; the Polyline is a Point3dList (`count` + `get(i) → [x,y,z]`).
 */
function tryPolylineVertices(
	curve: InstanceType<RhinoModule['Curve']>,
	applyTransforms: boolean
): THREE.Vector3[] | null {
	if (!curve.isPolyline()) return null;

	// rhino3dm's WASM `tryGetPolyline` returns the Polyline directly (not the documented
	// `[ok, Polyline]` tuple). Accept either: unwrap a tuple if we got one, else use it as-is.
	const result = curve.tryGetPolyline() as unknown;
	const polyline = (Array.isArray(result) ? result[1] : result) as PolylineLike | null;
	if (!polyline || typeof polyline.count !== 'number' || polyline.count < 2) {
		deleteRhinoObject(polyline);
		return null;
	}

	const out: THREE.Vector3[] = [];
	for (let i = 0; i < polyline.count; i++) {
		const p = polyline.get(i); // [x, y, z] in Rhino Z-up
		const { x, y, z } = rhinoToThree(p[0], p[1], p[2], applyTransforms);
		out.push(new THREE.Vector3(x, y, z));
	}

	deleteRhinoObject(polyline);
	return out;
}

/**
 * Adaptively sample a curve across its domain via `pointAt`. Robust for any curved type (arc, nurbs,
 * polycurve). Instead of a fixed segment count, we start from {@link CURVE_INITIAL_SEGMENTS} uniform
 * spans and recursively subdivide each only where it actually bends — a span is split when its
 * parameter-midpoint deviates from the straight chord by more than a tolerance derived from the
 * curve's bounding-box diagonal. Result: smooth on tight bends, sparse on near-straight runs, and
 * scale-independent (a tiny fillet and a huge arc both hit the same *visual* smoothness).
 */
function sampleUniform(
	curve: InstanceType<RhinoModule['Curve']>,
	applyTransforms: boolean
): THREE.Vector3[] {
	const domain = curve.domain;
	const t0 = domain[0];
	const t1 = domain[1];
	const span = t1 - t0;

	const evalAt = (t: number): THREE.Vector3 => {
		const p = curve.pointAt(t); // [x, y, z] in Rhino Z-up
		const { x, y, z } = rhinoToThree(p[0], p[1], p[2], applyTransforms);
		return new THREE.Vector3(x, y, z);
	};

	const tolerance = chordTolerance(curve);

	// Evaluate each segment boundary once and carry it forward as the next `pa`,
	// instead of re-evaluating ta/tb (3 pointAt calls per segment → 1).
	let ta = t0;
	let pa = evalAt(t0);
	const out: THREE.Vector3[] = [pa];
	for (let i = 0; i < CURVE_INITIAL_SEGMENTS; i++) {
		const tb = t0 + (span * (i + 1)) / CURVE_INITIAL_SEGMENTS;
		const pb = evalAt(tb);
		subdivide(ta, pa, tb, pb, evalAt, tolerance, CURVE_MAX_SUBDIVISION_DEPTH, out);
		out.push(pb);
		ta = tb;
		pa = pb;
	}

	return out;
}

/**
 * Recursively refine the span [ta, tb]. If the curve point at the parameter-midpoint lies farther
 * than `tolerance` from the chord pa→pb, split and recurse on both halves; otherwise the chord is a
 * good-enough approximation and nothing is added. Pushes interior points (excluding endpoints — the
 * caller owns those) into `out` in parameter order.
 */
function subdivide(
	ta: number,
	pa: THREE.Vector3,
	tb: number,
	pb: THREE.Vector3,
	evalAt: (t: number) => THREE.Vector3,
	tolerance: number,
	depth: number,
	out: THREE.Vector3[]
): void {
	if (depth <= 0) return;

	const tm = (ta + tb) / 2;
	const pm = evalAt(tm);

	// Subdivide on chord deviation OR on the turn angle at the midpoint. A pure deviation test can
	// pass a long, gently-curving span whose endpoints straddle the chord symmetrically; the angle
	// test catches the visible kink at span joints that deviation alone misses.
	const deviation = distanceToSegment(pm, pa, pb);
	const turn = turnAngle(pa, pm, pb);
	if (deviation <= tolerance && turn <= CURVE_MAX_TURN_RADIANS) return;

	subdivide(ta, pa, tm, pm, evalAt, tolerance, depth - 1, out);
	out.push(pm);
	subdivide(tm, pm, tb, pb, evalAt, tolerance, depth - 1, out);
}

/** Tolerance in world units: a fraction of the curve's bounding-box diagonal, with a tiny floor. */
function chordTolerance(curve: InstanceType<RhinoModule['Curve']>): number {
	// rhino3dm WASM's getBoundingBox takes no args at runtime despite the .d.ts signature.
	const box = (
		curve as unknown as { getBoundingBox(): InstanceType<RhinoModule['BoundingBox']> }
	).getBoundingBox();
	const min = box.min;
	const max = box.max;
	deleteRhinoObject(box);
	const diagonal = Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]);
	return Math.max(diagonal * CURVE_CHORD_TOLERANCE_RATIO, 1e-6);
}

/**
 * Angle (radians) of the turn at `b` along the path a→b→c. 0 = straight, π = full reversal.
 *
 * Scalar math on purpose: this runs once per subdivision test inside a recursion that can evaluate
 * ~2^12 spans per curve, so `Vector3.clone()` temporaries here caused measurable GC churn (and
 * module-scope scratch vectors would be unsafe across the recursive calls).
 */
function turnAngle(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const bcx = c.x - b.x;
	const bcy = c.y - b.y;
	const bcz = c.z - b.z;

	const lenAb = Math.sqrt(abx * abx + aby * aby + abz * abz);
	const lenBc = Math.sqrt(bcx * bcx + bcy * bcy + bcz * bcz);
	if (lenAb === 0 || lenBc === 0) return 0;

	const dot = abx * bcx + aby * bcy + abz * bcz;
	const cos = Math.max(-1, Math.min(1, dot / (lenAb * lenBc)));
	return Math.acos(cos);
}

/**
 * Perpendicular distance from point `p` to the segment a→b (clamped to the segment endpoints).
 * Scalar math for the same allocation-churn reason as {@link turnAngle}.
 */
function distanceToSegment(p: THREE.Vector3, a: THREE.Vector3, b: THREE.Vector3): number {
	const abx = b.x - a.x;
	const aby = b.y - a.y;
	const abz = b.z - a.z;
	const lengthSq = abx * abx + aby * aby + abz * abz;
	if (lengthSq === 0) return p.distanceTo(a);

	const apx = p.x - a.x;
	const apy = p.y - a.y;
	const apz = p.z - a.z;
	const t = Math.max(0, Math.min(1, (apx * abx + apy * aby + apz * abz) / lengthSq));

	const dx = apx - abx * t;
	const dy = apy - aby * t;
	const dz = apz - abz * t;
	return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
