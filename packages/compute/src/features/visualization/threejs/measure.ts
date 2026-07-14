import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import type { LabelLayer, LabelHandle } from './label-layer';

/**
 * A two-click distance measurement tool — the CAD verb users expect. Click a point, click a second,
 * read the distance off a label on the connecting line; a third click starts a new measurement.
 *
 * Picking snaps to geometry so measurements are exact, not "wherever the ray happened to land":
 * on a mesh hit we snap to the nearest vertex of the struck triangle if it's within
 * {@link MeasureOptions.snapPixels} on screen, else use the raw hit point. This is a cheap local
 * snap (three candidate vertices), no spatial index — enough for clean vertex-to-vertex measurement
 * without the cost/complexity of full edge/midpoint snapping (a later refinement).
 *
 * The tool is dormant until {@link MeasureTool.setEnabled}(true). While enabled it intercepts clicks
 * (the caller forwards them and swallows the event when {@link MeasureTool.handleClick} returns
 * true) so measuring doesn't also select objects.
 */

export interface MeasureTool {
	setEnabled(enabled: boolean): void;
	isEnabled(): boolean;
	/** Process a click. Returns true if the tool consumed it (caller should not also select). */
	handleClick(event: MouseEvent): boolean;
	/**
	 * Process pointer movement to preview the next snap point — a ghost marker tracks the cursor and
	 * jumps to the vertex a click would snap to, so users can aim before committing. No-op when the
	 * tool is disabled. The caller forwards mousemove; nothing is consumed.
	 */
	handleMove(event: MouseEvent): void;
	/** Clear the current measurement (markers, line, label). */
	clear(): void;
	dispose(): void;
}

export interface MeasureOptions {
	/** Snap to a vertex when the cursor is within this many screen pixels of it. Default 12. */
	snapPixels?: number;
	/** Marker + line color. Default yellow. */
	color?: THREE.ColorRepresentation;
	/** CSS class applied to the distance label, for styling. */
	labelClassName?: string;
	/**
	 * The model's unit (pass `data.modelunits`). The scene is in meters, so the default formatter
	 * converts and labels in this unit — e.g. a mm model reads "25.0 mm", not "0.025 m". Defaults
	 * to meters. Ignored when a custom `format` is supplied.
	 */
	displayUnit?: string;
	/**
	 * Format the measurement → label text. Receives the straight-line `distance` and the per-axis
	 * `delta` (|b − a| on each axis), both in **meters**. May return multi-line text or HTML; the
	 * default renders the total plus a Δx/Δy/Δz breakdown in `displayUnit`. Overrides `displayUnit`.
	 */
	format?: (distance: number, delta: THREE.Vector3) => string;
}

interface MeasureDeps {
	canvas: HTMLCanvasElement;
	scene: THREE.Scene;
	getActiveCamera: () => THREE.Camera;
	/**
	 * The current orbit target (e.g. `controls.target`). Used to scale the line/point pick
	 * threshold with the view: the tolerance is a fraction of the camera→target distance, so it
	 * stays roughly constant on screen wherever the user has framed the model. Optional for
	 * backward compatibility — without it the perspective fallback is the camera's distance to the
	 * world origin, which misjudges the threshold for off-origin content. Thread it in when you can.
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

/**
 * Scene geometry is loaded in meters (the webdisplay parser scales to meters when
 * `allowScaling` is on), so distances come out in meters. To label in the model's
 * own unit, convert with `metersPerUnit` and append `suffix`. Keep this in sync
 * with the webdisplay parser's SCALE_FACTORS.
 */
const UNIT_DISPLAY: Record<string, { metersPerUnit: number; suffix: string }> = {
	Millimeters: { metersPerUnit: 1 / 1000, suffix: 'mm' },
	Centimeters: { metersPerUnit: 1 / 100, suffix: 'cm' },
	Meters: { metersPerUnit: 1, suffix: 'm' },
	Inches: { metersPerUnit: 1 / 39.37, suffix: 'in' },
	Feet: { metersPerUnit: 1 / 3.28084, suffix: 'ft' }
};

/**
 * Build a `meters → label` formatter for the given display unit (defaults to meters).
 * @internal exported for tests
 */
export function makeFormatter(displayUnit?: string): (n: number) => string {
	const unit = (displayUnit && UNIT_DISPLAY[displayUnit]) || UNIT_DISPLAY.Meters;
	return (meters: number) => `${(meters / unit.metersPerUnit).toPrecision(3)} ${unit.suffix}`;
}

/**
 * World-space raycast threshold for picking lines/points (which have no surface area and are only
 * "hit" when the ray passes within this distance of them). A fixed fraction of the view size keeps
 * the grab band roughly constant on screen as the user zooms:
 * - perspective: fraction of the camera→target distance (the framed view size). Falls back to the
 *   camera's distance to the world origin when no target is supplied — see `MeasureDeps.getViewTarget`.
 * - orthographic: fraction of the visible frustum height, `(top − bottom) / zoom`. Ortho zoom
 *   changes `camera.zoom`, not the camera position, so distance-based scaling would never react.
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
 * The vertex indices to consider snapping to for a given hit, by object type:
 * - Mesh: the three vertices of the struck triangle (`hit.face`).
 * - Line / LineSegments: the two endpoints of the struck segment (`hit.index`, `hit.index + 1`).
 * - Points: the struck vertex (`hit.index`).
 * Returns null when the hit carries no usable index info (e.g. a fat `Line2`), so the caller keeps
 * the raw hit point.
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

/**
 * Snap a raycast hit to the nearest geometry vertex within `snapPixels` on screen; otherwise return
 * the raw hit point. Works for meshes (triangle vertices), lines (segment endpoints), and points
 * (the vertex itself). Pure (no DOM) so it's unit-testable: it takes the screen size explicitly
 * rather than reading the canvas. Exported for that reason.
 *
 * Falls back to the raw point for hits without usable vertex indices or positions.
 */
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

	// Visuals, created lazily and reused. Markers are small always-on-top points; the line connects
	// them; the label rides the line's midpoint.
	const markers: THREE.Points[] = [];
	let line: Line2 | null = null;
	let label: LabelHandle | null = null;

	const markerMaterial = new THREE.PointsMaterial({
		color,
		size: 8,
		sizeAttenuation: false,
		depthTest: false // markers stay visible through geometry, like CAD snap dots
	});

	// A hollow-feeling preview dot: dimmer + bigger than a committed marker so the snap target the
	// next click will lock onto is obvious before clicking. Shown only while hovering geometry.
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
		marker.userData.id = 'measure'; // excluded from pick/fit
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

	/** Raycast the cursor and return the snapped pick point, or null if it hit no measurable geometry. */
	const pickPoint = (event: MouseEvent): THREE.Vector3 | null => {
		const rect = canvas.getBoundingClientRect();
		pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
		pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

		const camera = getActiveCamera();
		raycaster.setFromCamera(pointer, camera);

		// Lines and points have no surface area, so they're only "hit" when the ray passes within a
		// world-space threshold of them — left at the default ~1 unit they're nearly impossible to
		// click. Scale the threshold with the view (camera→target distance, or the ortho frustum
		// height under zoom) so the pick tolerance stays roughly constant on screen — see pickThreshold.
		const threshold = pickThreshold(camera, getViewTarget?.());
		raycaster.params.Line!.threshold = threshold;
		raycaster.params.Points!.threshold = threshold;

		const hits = raycaster
			.intersectObjects(scene.children, true)
			.filter((i) => i.object.userData.id !== 'measure' && i.object.userData.id !== 'grid');

		if (hits.length === 0) return null;
		return snapToVertex(hits[0], camera, { width: rect.width, height: rect.height }, snapPixels);
	};

	// Coalesce hover raycasts to one per animation frame: mousemove can fire far more often than
	// the display refreshes, and a full-scene recursive raycast per event hitches on large models.
	// Only the latest event matters for the preview, so intermediate ones are simply dropped.
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
