import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import type { LabelLayer, LabelHandle } from './label-layer';

/**
 * Two-click distance measurement. Click a point, click a second, read the distance off a label on
 * the connecting line; a third click starts fresh.
 *
 * Picking snaps to the nearest vertex of the struck triangle within {@link MeasureOptions.snapPixels}
 * so measurements land exactly on vertices rather than wherever the ray happened to hit — a cheap
 * local snap (three candidate vertices, no spatial index).
 *
 * Dormant until {@link MeasureTool.setEnabled}(true). While enabled it intercepts clicks (caller
 * forwards them and swallows the event when {@link MeasureTool.handleClick} returns true) so
 * measuring doesn't also select objects.
 */

export interface MeasureTool {
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
	/** Returns true if the tool consumed the click (caller should not also select). */
	handleClick(event: MouseEvent): boolean;
	/** Preview the next snap point via a ghost marker. No-op when disabled; never consumes the event. */
	handleMove(event: MouseEvent): void;
	clear(): void;
	dispose(): void;
}

export interface MeasureOptions {
	/** Snap to a vertex when the cursor is within this many screen pixels of it. Default 12. */
	snapPixels?: number;
	/** Marker + line color. Default yellow. */
	color?: THREE.ColorRepresentation;
	labelClassName?: string;
	/**
	 * Pass `data.modelunits`. Scene is in meters; default formatter converts and labels in this unit
	 * (e.g. "25.0 mm" not "0.025 m"). Defaults to meters. Ignored if `format` is given.
	 */
	displayUnit?: string;
	/**
	 * Format the measurement → label text. Receives `distance` and per-axis `delta` (|b − a|), both
	 * in meters. May return multi-line text/HTML; default renders total + Δx/Δy/Δz in `displayUnit`.
	 */
	format?: (distance: number, delta: THREE.Vector3) => string;
}

interface MeasureDeps {
	canvas: HTMLCanvasElement;
	scene: THREE.Scene;
	getActiveCamera: () => THREE.Camera;
	/**
	 * The current orbit target (e.g. `controls.target`). Scales the line/point pick threshold as a
	 * fraction of camera→target distance so it stays constant on screen regardless of framing.
	 * Without it, the fallback is distance-to-origin, which misjudges off-origin content.
	 */
	getViewTarget?: () => THREE.Vector3;
	labelLayer: LabelLayer;
	options?: MeasureOptions;
}

const DEFAULT_SNAP_PIXELS = 12;
const DEFAULT_COLOR = 0xffcc00;
// Line/Points raycast threshold as a fraction of the view distance (camera→target). ~1.5% gives a
// comfortable few-pixel grab band at typical framing without snapping to far-off geometry.
const LINE_PICK_FRACTION = 0.015;

// Scene geometry loads in meters (webdisplay parser scales when `allowScaling` is on). Keep in
// sync with the webdisplay parser's SCALE_FACTORS.
const UNIT_DISPLAY: Record<string, { metersPerUnit: number; suffix: string }> = {
	Millimeters: { metersPerUnit: 1 / 1000, suffix: 'mm' },
	Centimeters: { metersPerUnit: 1 / 100, suffix: 'cm' },
	Meters: { metersPerUnit: 1, suffix: 'm' },
	Inches: { metersPerUnit: 1 / 39.37, suffix: 'in' },
	Feet: { metersPerUnit: 1 / 3.28084, suffix: 'ft' }
};

/** @internal exported for tests */
export function makeFormatter(displayUnit?: string): (n: number) => string {
	const unit = (displayUnit && UNIT_DISPLAY[displayUnit]) || UNIT_DISPLAY.Meters;
	return (meters: number) => `${(meters / unit.metersPerUnit).toPrecision(3)} ${unit.suffix}`;
}

/**
 * Raycast threshold for picking lines/points, as a fixed fraction of view size so the grab band
 * stays roughly constant on screen while zooming. Perspective: fraction of camera→target distance
 * (see `MeasureDeps.getViewTarget`). Orthographic: fraction of frustum height `(top − bottom) /
 * zoom`, since ortho zoom changes `camera.zoom` rather than position.
 * @internal exported for tests
 */
export function pickThreshold(camera: THREE.Camera, viewTarget?: THREE.Vector3): number {
	if ((camera as THREE.OrthographicCamera).isOrthographicCamera) {
		const ortho = camera as THREE.OrthographicCamera;
		const visibleHeight = Math.abs(ortho.top - ortho.bottom) / (ortho.zoom || 1);
		return visibleHeight * LINE_PICK_FRACTION;
	}
	const viewScale = viewTarget ? camera.position.distanceTo(viewTarget) : camera.position.length();
	return (viewScale || 1) * LINE_PICK_FRACTION;
}

/**
 * Vertex indices to consider snapping to, by object type: Mesh → struck triangle's 3 vertices;
 * Line/LineSegments → struck segment's 2 endpoints; Points → the struck vertex. Null when the hit
 * carries no usable index (e.g. a fat `Line2`), so the caller keeps the raw hit point.
 */
function snapCandidateIndices(hit: THREE.Intersection): number[] | null {
	const obj = hit.object;
	if (obj instanceof THREE.Mesh) {
		return hit.face ? [hit.face.a, hit.face.b, hit.face.c] : null;
	}
	if (obj instanceof THREE.Points) {
		// Points.raycast resolves indexed geometry itself: `hit.index` is always a position index.
		return hit.index != null ? [hit.index] : null;
	}
	// THREE.Line / LineSegments / LineLoop. For non-indexed geometry `hit.index` is the first
	// vertex of the struck segment; for INDEXED geometry it is a cursor into the index buffer
	// (three r184 Line.raycast reports the loop counter, not the resolved vertex), so the segment's
	// endpoints must be looked up through the index before reading the position attribute.
	if (obj instanceof THREE.Line) {
		if (hit.index == null) return null;
		const index = obj.geometry.index;
		if (index) {
			if (hit.index + 1 >= index.count) return null; // stale/inconsistent hit; keep raw point
			return [index.getX(hit.index), index.getX(hit.index + 1)];
		}
		return [hit.index, hit.index + 1];
	}
	return null;
}

/** Snap a raycast hit to the nearest geometry vertex within `snapPixels` on screen, else the raw hit point. */
export function snapToVertex(
	hit: THREE.Intersection,
	camera: THREE.Camera,
	screenSize: { width: number; height: number },
	snapPixels: number
): THREE.Vector3 {
	const raw = hit.point.clone();
	const obj = hit.object as THREE.Object3D & { geometry?: THREE.BufferGeometry };
	const indices = snapCandidateIndices(hit);
	if (!indices || !obj.geometry) return raw;

	const pos = obj.geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!pos) return raw;

	const toScreen = (worldP: THREE.Vector3): THREE.Vector2 => {
		const ndc = worldP.clone().project(camera);
		return new THREE.Vector2(
			((ndc.x + 1) / 2) * screenSize.width,
			((1 - ndc.y) / 2) * screenSize.height
		);
	};
	const rawScreen = toScreen(raw);

	let best = raw;
	let bestPx = snapPixels;
	for (const idx of indices) {
		if (idx >= pos.count) continue; // guard the line `index + 1` against the geometry end
		const local = new THREE.Vector3().fromBufferAttribute(pos, idx);
		const world = local.applyMatrix4(obj.matrixWorld);
		const px = toScreen(world).distanceTo(rawScreen);
		if (px < bestPx) {
			bestPx = px;
			best = world;
		}
	}
	return best;
}

export function createMeasureTool(deps: MeasureDeps): MeasureTool {
	const { canvas, scene, getActiveCamera, getViewTarget, labelLayer, options = {} } = deps;
	const snapPixels = options.snapPixels ?? DEFAULT_SNAP_PIXELS;
	const color = new THREE.Color(options.color ?? DEFAULT_COLOR);
	const fmt = makeFormatter(options.displayUnit);
	const defaultFormat = (d: number, delta: THREE.Vector3) =>
		`${fmt(d)}\nΔx ${fmt(delta.x)}  Δy ${fmt(delta.y)}  Δz ${fmt(delta.z)}`;
	const format = options.format ?? defaultFormat;

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();

	let enabled = false;
	const points: THREE.Vector3[] = [];

	const markers: THREE.Points[] = [];
	let line: Line2 | null = null;
	let label: LabelHandle | null = null;

	const markerMaterial = new THREE.PointsMaterial({
		color,
		size: 8,
		sizeAttenuation: false,
		depthTest: false // markers stay visible through geometry, like CAD snap dots
	});

	// Dimmer + bigger than a committed marker so the next click's snap target is obvious before clicking.
	const hoverMaterial = new THREE.PointsMaterial({
		color,
		size: 11,
		sizeAttenuation: false,
		depthTest: false,
		transparent: true,
		opacity: 0.5
	});
	let hoverMarker: THREE.Points | null = null;

	const showHover = (p: THREE.Vector3 | null) => {
		if (!p) {
			if (hoverMarker) hoverMarker.visible = false;
			return;
		}
		if (!hoverMarker) {
			const geometry = new THREE.BufferGeometry();
			geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3));
			hoverMarker = new THREE.Points(geometry, hoverMaterial);
			hoverMarker.renderOrder = 1000;
			hoverMarker.userData.id = 'measure';
			hoverMarker.raycast = () => {};
			scene.add(hoverMarker);
		}
		hoverMarker.position.copy(p);
		hoverMarker.visible = true;
	};

	const makeMarker = (p: THREE.Vector3): THREE.Points => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.Float32BufferAttribute([p.x, p.y, p.z], 3));
		const marker = new THREE.Points(geometry, markerMaterial);
		marker.renderOrder = 999;
		marker.userData.id = 'measure';
		marker.raycast = () => {}; // don't let markers be measure targets themselves
		scene.add(marker);
		return marker;
	};

	const clear = () => {
		points.length = 0;
		markers.forEach((m) => {
			m.geometry.dispose();
			m.removeFromParent();
		});
		markers.length = 0;
		if (line) {
			line.geometry.dispose();
			(line.material as LineMaterial).dispose();
			line.removeFromParent();
			line = null;
		}
		label?.remove();
		label = null;
	};

	const drawMeasurement = () => {
		if (points.length !== 2) return;
		const [a, b] = points;

		const geometry = new LineGeometry();
		geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
		const material = new LineMaterial({ color });
		(material as LineMaterial & { linewidth: number; depthTest: boolean }).linewidth = 2;
		material.depthTest = false;

		line = new Line2(geometry, material);
		line.renderOrder = 998;
		line.userData.id = 'measure';
		line.raycast = () => {};
		scene.add(line);

		const mid = a.clone().add(b).multiplyScalar(0.5);
		const delta = new THREE.Vector3(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
		label = labelLayer.addLabel(format(a.distanceTo(b), delta), mid, options.labelClassName);
	};

	const pickPoint = (event: MouseEvent): THREE.Vector3 | null => {
		const rect = canvas.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		const camera = getActiveCamera();
		raycaster.setFromCamera(pointer, camera);

		// Lines/points have no surface area, so raycast threshold matters — the default ~1 unit is
		// nearly unclickable. pickThreshold scales it with the view so it stays constant on screen.
		const threshold = pickThreshold(camera, getViewTarget?.());
		raycaster.params.Line!.threshold = threshold;
		raycaster.params.Points!.threshold = threshold;

		const hits = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => i.object.userData.id !== 'measure' && i.object.userData.id !== 'grid');

		if (hits.length === 0) return null;
		return snapToVertex(hits[0], camera, { width: rect.width, height: rect.height }, snapPixels);
	};

	// Coalesce hover raycasts to one per animation frame: a full-scene recursive raycast per
	// mousemove event hitches on large models, and only the latest event matters for the preview.
	let pendingMove: MouseEvent | null = null;
	let moveRaf = 0;

	const cancelPendingMove = () => {
		if (moveRaf) {
			cancelAnimationFrame(moveRaf);
			moveRaf = 0;
		}
		pendingMove = null;
	};

	const handleMove = (event: MouseEvent): void => {
		if (!enabled) return;
		pendingMove = event;
		if (moveRaf) return;
		moveRaf = requestAnimationFrame(() => {
			moveRaf = 0;
			const latest = pendingMove;
			pendingMove = null;
			if (!enabled || !latest) return;
			showHover(pickPoint(latest));
		});
	};

	const handleClick = (event: MouseEvent): boolean => {
		if (!enabled) return false;

		// A third click after a completed measurement starts fresh.
		if (points.length === 2) clear();

		const point = pickPoint(event);
		if (point === null) return true; // consumed: a measuring click that missed still isn't a select

		points.push(point);
		markers.push(makeMarker(point));

		if (points.length === 2) drawMeasurement();
		return true;
	};

	return {
		setEnabled: (value) => {
			enabled = value;
			if (!value) {
				cancelPendingMove();
				clear();
				showHover(null);
			}
		},
		isEnabled: () => enabled,
		handleClick,
		handleMove,
		clear,
		dispose: () => {
			cancelPendingMove();
			clear();
			if (hoverMarker) {
				hoverMarker.geometry.dispose();
				hoverMarker.removeFromParent();
				hoverMarker = null;
			}
			markerMaterial.dispose();
			hoverMaterial.dispose();
		}
	};
}
