import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import { getLogger } from '../../../shared/index.js';
import { materialParams } from './appearance.js';

import type { DisplayCurve } from '../types';
import type { RhinoModule } from 'rhino3dm';

/** Initial uniform splits before adaptive refinement, so closed/looping curves aren't collapsed. */
const CURVE_INITIAL_SEGMENTS = 12;
/** Chord-deviation tolerance as a fraction of the curve's bounding-box diagonal. */
const CURVE_CHORD_TOLERANCE_RATIO = 0.0004;
/** Recursion-depth cap per initial span, so a pathological curve can't explode the vertex count. */
const CURVE_MAX_SUBDIVISION_DEPTH = 12;
/** Max turn angle (radians) allowed across a span before it's split. */
const CURVE_MAX_TURN_RADIANS = 0.05;

const DEFAULT_LINE_WIDTH = 2;

/**
 * Never throws — returns null so one bad curve can't abort the batch.
 *
 * Uses `Line2`/`LineMaterial` instead of `THREE.Line`: plain `THREE.Line` is hard-capped at 1px on
 * every major GPU backend, so `item.width` would go unhonoured. `Line2.onBeforeRender` sets
 * `LineMaterial`'s required `resolution`, so no renderer reference is needed here.
 */
export function buildCurveLine(item: DisplayCurve, rhino: RhinoModule | undefined): Line2 | null {
	if (!rhino) {
		getLogger().warn('No rhino3dm instance provided; skipping curve display item.');
		return null;
	}

	const curve = decodeCurve(item.json, rhino);
	if (!curve) return null;

	let points: THREE.Vector3[];
	try {
		points = tessellate(curve);
	} catch (error) {
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

	// @types/three's LineMaterial omits `linewidth`/`transparent`/`opacity` though all exist at runtime.
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
	line.computeLineDistances();
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

/** emscripten bindings aren't reclaimed by JS GC — free them explicitly. */
function deleteRhinoObject(obj: unknown): void {
	(obj as { delete?: () => void } | null | undefined)?.delete?.();
}

function decodeCurve(json: string, rhino: RhinoModule): InstanceType<RhinoModule['Curve']> | null {
	try {
		const parsed = JSON.parse(json);
		const obj = rhino.CommonObject.decode(parsed);
		// decode() returns a CommonObject; only curves carry pointAt, so use it to detect a miss.
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
 * Most curves Grasshopper emits are linear, so uniform sampling would needlessly inflate them to
 * {@link CURVE_INITIAL_SEGMENTS}+1 points: use exact vertices for anything rhino3dm reports as a
 * polyline, and fall through to {@link sampleUniform} only for genuinely curved geometry.
 */
function tessellate(curve: InstanceType<RhinoModule['Curve']>): THREE.Vector3[] {
	const exact = tryPolylineVertices(curve);
	if (exact) return exact;

	return sampleUniform(curve);
}

interface PolylineLike {
	count: number;
	get(index: number): number[];
}

function tryPolylineVertices(curve: InstanceType<RhinoModule['Curve']>): THREE.Vector3[] | null {
	if (!curve.isPolyline()) return null;

	// rhino3dm's WASM tryGetPolyline returns the Polyline directly, not the documented [ok, Polyline]
	// tuple — accept either shape.
	const result = curve.tryGetPolyline() as unknown;
	const polyline = (Array.isArray(result) ? result[1] : result) as PolylineLike | null;
	if (!polyline || typeof polyline.count !== 'number' || polyline.count < 2) {
		deleteRhinoObject(polyline);
		return null;
	}

	const out: THREE.Vector3[] = [];
	for (let i = 0; i < polyline.count; i++) {
		const p = polyline.get(i);
		out.push(new THREE.Vector3(p[0], p[1], p[2]));
	}

	deleteRhinoObject(polyline);
	return out;
}

/**
 * Adaptively samples any curved type via `pointAt`: starts from {@link CURVE_INITIAL_SEGMENTS} uniform
 * spans and recursively subdivides only where the curve bends. Tolerance is a fraction of the
 * bounding-box diagonal, so a tiny fillet and a huge arc get the same visual smoothness.
 */
function sampleUniform(curve: InstanceType<RhinoModule['Curve']>): THREE.Vector3[] {
	const domain = curve.domain;
	const t0 = domain[0];
	const t1 = domain[1];
	const span = t1 - t0;

	const evalAt = (t: number): THREE.Vector3 => {
		const p = curve.pointAt(t);
		return new THREE.Vector3(p[0], p[1], p[2]);
	};

	const tolerance = chordTolerance(curve);

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
 * Turn angle (radians) at `b` along a→b→c; 0 = straight, π = reversal. Scalar math rather than
 * Vector3 temporaries — this recurses up to ~2^12 times per curve and clone() churn was measurable.
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

/** Perpendicular distance from `p` to segment a→b, clamped to endpoints. */
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
