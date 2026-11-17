import * as THREE from 'three';
import {
	pickThreshold,
	pointerToNdc,
	raycastVisible,
	snapToVertex,
	type ThreeViewer
} from '@selvajs/visualization/render';

import type { Point3, SketchCurve } from '../model/curve.js';
import { tessellate } from '../model/nurbs.js';
import { constrainPoint, type TypedInput } from './constraints.js';

// ============================================================================
// From a pointer event to a point in the model: the input half of a drawing tool
// ============================================================================
//
// Points land on the model's XY plane. A vertex under the cursor wins over the plane: first one
// of the caller's own points (`snapTo`), then a vertex of the solved model. With `planar` on it is
// dropped onto the plane, so a snap in a perspective view cannot lift a curve off the ground by
// accident.

export interface PickedPoint {
	/** Model units. */
	point: Point3;
	/** It sits on a vertex, so grid and angle lock left it alone. */
	snapped: boolean;
}

export interface PickOptions {
	/** Points to snap to ahead of the model's own vertices, such as the curves already drawn. */
	snapTo?: readonly Point3[];
	/** The point the new one continues from: what angle lock and typed lengths measure against. */
	last?: Point3 | null;
	/** Drops the point onto the model's XY plane. Default true. */
	planar?: boolean;
	/** Model units between grid snaps; 0 is off. */
	gridStep?: number;
	/** Locks the direction from `last` to 45° steps. Default: the event's Shift key. */
	ortho?: boolean;
	typed?: TypedInput | null;
}

export interface PointPicker {
	/** Null when the event's ray never meets the drawing plane, as when looking along it. */
	pick(event: MouseEvent, options?: PickOptions): PickedPoint | null;
	/** Index of the point nearest the cursor within the snap band, or -1. */
	nearestPoint(event: MouseEvent, points: readonly Point3[]): number;
	/** Index of the curve nearest the cursor within the snap band, or -1: for selecting by click. */
	nearestCurve(event: MouseEvent, curves: readonly SketchCurve[]): number;
}

export interface PointPickerOptions {
	viewer: ThreeViewer;
	/** Scene metres per model unit. */
	metersPerUnit: number;
	/** How close, in screen pixels, the cursor must be to snap or to hit. Default 12. */
	snapPixels?: number;
}

const DEFAULT_SNAP_PIXELS = 12;

interface ScreenPoint {
	x: number;
	y: number;
	/** False behind the camera, where a point still projects somewhere on screen. */
	visible: boolean;
}

export function createPointPicker(options: PointPickerOptions): PointPicker {
	const { viewer, metersPerUnit } = options;
	const snapPixels = options.snapPixels ?? DEFAULT_SNAP_PIXELS;
	const canvas = viewer.renderer.domElement;
	const raycaster = new THREE.Raycaster();
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

	const toScene = (p: Point3) =>
		new THREE.Vector3(p[0] * metersPerUnit, p[1] * metersPerUnit, p[2] * metersPerUnit);
	const fromScene = (v: THREE.Vector3): Point3 => [
		v.x / metersPerUnit,
		v.y / metersPerUnit,
		v.z / metersPerUnit
	];

	const toScreen = (world: THREE.Vector3, camera: THREE.Camera, rect: DOMRect): ScreenPoint => {
		const ndc = world.clone().project(camera);
		return {
			x: ((ndc.x + 1) / 2) * rect.width,
			y: ((1 - ndc.y) / 2) * rect.height,
			visible: ndc.z > -1 && ndc.z < 1
		};
	};

	const cursorOf = (event: MouseEvent, rect: DOMRect) => ({
		x: event.clientX - rect.left,
		y: event.clientY - rect.top
	});

	const nearestPoint = (event: MouseEvent, points: readonly Point3[]): number => {
		const camera = viewer.cameraController.getActiveCamera();
		const rect = canvas.getBoundingClientRect();
		const cursor = cursorOf(event, rect);
		let best = -1;
		let bestPx = snapPixels;
		points.forEach((point, i) => {
			const screen = toScreen(toScene(point), camera, rect);
			const px = Math.hypot(screen.x - cursor.x, screen.y - cursor.y);
			if (screen.visible && px < bestPx) {
				bestPx = px;
				best = i;
			}
		});
		return best;
	};

	const segmentDistance = (p: { x: number; y: number }, a: ScreenPoint, b: ScreenPoint) => {
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const length = dx * dx + dy * dy;
		const t =
			length === 0 ? 0 : Math.min(1, Math.max(0, ((p.x - a.x) * dx + (p.y - a.y) * dy) / length));
		return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
	};

	const nearestCurve = (event: MouseEvent, curves: readonly SketchCurve[]): number => {
		const camera = viewer.cameraController.getActiveCamera();
		const rect = canvas.getBoundingClientRect();
		const cursor = cursorOf(event, rect);
		let best = -1;
		let bestPx = snapPixels;
		curves.forEach((curve, i) => {
			const screen = tessellate(curve).map((point) => toScreen(toScene(point), camera, rect));
			for (let s = 1; s < screen.length; s++) {
				if (!screen[s - 1].visible || !screen[s].visible) continue;
				const px = segmentDistance(cursor, screen[s - 1], screen[s]);
				if (px < bestPx) {
					bestPx = px;
					best = i;
				}
			}
		});
		return best;
	};

	/** A vertex of the solved model under the cursor, or with `planar` off any point on it. */
	const pickModel = (
		event: MouseEvent,
		camera: THREE.Camera,
		planar: boolean
	): PickedPoint | null => {
		const rect = canvas.getBoundingClientRect();
		const cursor = cursorOf(event, rect);

		// Same grab bands as the measure tool, so both feel alike at any zoom.
		const threshold = pickThreshold(camera, viewer.controls.target) * 2;
		raycaster.params.Line.threshold = threshold;
		raycaster.params.Points.threshold = threshold;
		(raycaster.params as { Line2?: { threshold: number } }).Line2 = { threshold: snapPixels / 2 };

		for (const hit of raycastVisible(viewer.scene, raycaster)) {
			const raw =
				(hit as THREE.Intersection & { pointOnLine?: THREE.Vector3 }).pointOnLine ?? hit.point;
			const isSurface = (hit.object as THREE.Mesh).isMesh && hit.face != null;
			if (!isSurface) {
				const at = toScreen(raw, camera, rect);
				if (Math.hypot(at.x - cursor.x, at.y - cursor.y) > snapPixels) continue;
			}
			const vertex = snapToVertex(
				hit,
				camera,
				{ width: rect.width, height: rect.height },
				snapPixels
			);
			// A curve or point under the cursor counts as a snap even between its vertices.
			if (!isSurface || !vertex.equals(raw)) return { point: fromScene(vertex), snapped: true };
			return planar ? null : { point: fromScene(raw), snapped: false };
		}
		return null;
	};

	const pick = (event: MouseEvent, pickOptions: PickOptions = {}): PickedPoint | null => {
		const { snapTo = [], last = null, planar = true, gridStep = 0, typed = null } = pickOptions;
		const camera = viewer.cameraController.getActiveCamera();
		const ndc = pointerToNdc(event, canvas);
		raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

		const own = nearestPoint(event, snapTo);
		let found: PickedPoint | null =
			own >= 0 ? { point: snapTo[own], snapped: true } : pickModel(event, camera, planar);
		if (!found) {
			const onPlane = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
			if (!onPlane) return null;
			found = { point: fromScene(onPlane), snapped: false };
		}
		if (planar) found = { ...found, point: [found.point[0], found.point[1], 0] };

		return {
			snapped: found.snapped,
			point: constrainPoint(found.point, {
				last,
				snapped: found.snapped,
				ortho: pickOptions.ortho ?? event.shiftKey,
				gridStep,
				typed
			})
		};
	};

	return { pick, nearestPoint, nearestCurve };
}
