import * as THREE from 'three';
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

import type { LabelLayer, LabelHandle } from './label-layer';
import { raycastVisible, warmPickIndex } from './scene-pick.js';

/**
 * Point-to-point distance measurement. Click a start point; a rubber band and live readout follow
 * the cursor until the second click commits it. Committed measurements stay until Escape (which
 * first drops an unfinished start point) or until the tool is disabled.
 *
 * Picking snaps to the nearest vertex of the struck triangle, segment or point within
 * {@link MeasureOptions.snapPixels}; the hover marker turns solid when it has snapped. Meshes are
 * picked through a BVH (`scene-pick.ts`), so hovering stays cheap on large models.
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
	/** Preview the next snap point and the rubber band. No-op when disabled; never consumes the event. */
	handleMove(event: MouseEvent): void;
	/** Drops the unfinished start point, or every measurement when there is none. Bound to Escape. */
	cancel(): void;
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
	 * in meters. May return multi-line text; default renders the total, plus the non-zero axis
	 * deltas when more than one axis changes.
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
	/** Repaint after a hover/click change; an on-demand render loop won't notice them otherwise. */
	requestRender?: () => void;
	labelLayer: LabelLayer;
	options?: MeasureOptions;
}

const DEFAULT_SNAP_PIXELS = 12;
const DEFAULT_COLOR = 0xffcc00;
// Fraction of view distance used as the line/point raycast threshold: ~1.5% gives a comfortable
// grab band at typical framing without snapping to far-off geometry.
const LINE_PICK_FRACTION = 0.015;
// Marker renderOrders: above scene content, and committed markers above the line they end.
const RENDER_ORDER_LINE = 998;
const RENDER_ORDER_MARKER = 999;
const RENDER_ORDER_HOVER = 1000;

// Scene geometry loads in meters (webdisplay parser scales when `allowScaling` is on). Keep in
// sync with the webdisplay parser's SCALE_FACTORS.
const UNIT_DISPLAY: Record<string, { metersPerUnit: number; suffix: string }> = {
	Millimeters: { metersPerUnit: 1 / 1000, suffix: 'mm' },
	Centimeters: { metersPerUnit: 1 / 100, suffix: 'cm' },
	Meters: { metersPerUnit: 1, suffix: 'm' },
	Inches: { metersPerUnit: 1 / 39.37, suffix: 'in' },
	Feet: { metersPerUnit: 1 / 3.28084, suffix: 'ft' }
};

/**
 * Three significant figures below 1000, whole units above. `toPrecision(3)` alone switches to
 * exponent notation past 999 ("1.23e+4 mm"), which is unreadable on a building-scale model.
 *
 * @internal exported for tests
 */
export function makeFormatter(displayUnit?: string): (n: number) => string {
	const unit = (displayUnit && UNIT_DISPLAY[displayUnit]) || UNIT_DISPLAY.Meters;
	return (meters: number) => {
		const value = meters / unit.metersPerUnit;
		const abs = Math.abs(value);
		const decimals = abs === 0 ? 0 : Math.min(6, Math.max(0, 2 - Math.floor(Math.log10(abs))));
		return `${value.toFixed(decimals)} ${unit.suffix}`;
	};
}

/** @internal exported for tests */
export function makeDefaultFormat(
	fmt: (n: number) => string
): (distance: number, delta: THREE.Vector3) => string {
	return (distance, delta) => {
		// Relative epsilon: float noise on an axis-aligned measurement isn't a real component.
		const eps = distance * 1e-6;
		const axes = (['x', 'y', 'z'] as const).filter((axis) => delta[axis] > eps);
		if (axes.length < 2) return fmt(distance);
		return `${fmt(distance)}\n${axes.map((axis) => `Δ${axis} ${fmt(delta[axis])}`).join('  ')}`;
	};
}

/**
 * Raycast threshold for picking lines/points, as a fixed fraction of view size so the grab band
 * stays constant on screen while zooming. Perspective uses camera→target distance (see
 * `MeasureDeps.getViewTarget`); orthographic uses frustum height `(top − bottom) / zoom`, since
 * ortho zoom changes `camera.zoom` rather than position.
 *
 * Shared with any tool doing its own picking, so grab bands stay consistent across tools.
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
 * Local-space vertices to consider snapping to, by object type: Mesh → struck triangle's 3
 * vertices; Line/LineSegments and fat Line2/LineSegments2 → struck segment's 2 endpoints; Points →
 * the struck vertex. Null when the hit carries no usable index, so the caller keeps the raw point.
 */
function snapCandidates(hit: THREE.Intersection): THREE.Vector3[] | null {
	const obj = hit.object as THREE.Object3D & {
		geometry?: THREE.BufferGeometry;
		isLineSegments2?: boolean;
	};
	const geometry = obj.geometry;
	if (!geometry) return null;

	// Fat lines store each segment as one instance: `faceIndex` is the segment.
	if (obj.isLineSegments2) {
		const start = geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute | undefined;
		const end = geometry.attributes.instanceEnd as THREE.InterleavedBufferAttribute | undefined;
		const i = hit.faceIndex;
		if (!start || !end || i == null || i >= start.count) return null;
		return [
			new THREE.Vector3().fromBufferAttribute(start, i),
			new THREE.Vector3().fromBufferAttribute(end, i)
		];
	}

	const pos = geometry.attributes.position as THREE.BufferAttribute | undefined;
	if (!pos) return null;
	const at = (indices: number[]) =>
		indices
			.filter((i) => i < pos.count)
			.map((i) => new THREE.Vector3().fromBufferAttribute(pos, i));

	if (obj instanceof THREE.Mesh) {
		return hit.face ? at([hit.face.a, hit.face.b, hit.face.c]) : null;
	}
	if (obj instanceof THREE.Points) {
		// Points.raycast resolves indexed geometry itself: `hit.index` is always a position index.
		return hit.index != null ? at([hit.index]) : null;
	}
	// THREE.Line / LineSegments / LineLoop. For non-indexed geometry `hit.index` is the first
	// vertex of the struck segment. For indexed geometry it's a cursor into the index buffer, not
	// the resolved vertex (three r184 Line.raycast reports the loop counter) — endpoints must be
	// looked up through the index before reading the position attribute.
	if (obj instanceof THREE.Line) {
		if (hit.index == null) return null;
		const index = geometry.index;
		if (index) {
			if (hit.index + 1 >= index.count) return null; // stale/inconsistent hit; keep raw point
			return at([index.getX(hit.index), index.getX(hit.index + 1)]);
		}
		return at([hit.index, hit.index + 1]);
	}
	return null;
}

function toScreen(
	world: THREE.Vector3,
	camera: THREE.Camera,
	screenSize: { width: number; height: number }
): THREE.Vector2 {
	const ndc = world.clone().project(camera);
	return new THREE.Vector2(
		((ndc.x + 1) / 2) * screenSize.width,
		((1 - ndc.y) / 2) * screenSize.height
	);
}

/** Where a hit sits on screen: fat lines report the nearest point on the line separately. */
function hitPoint(hit: THREE.Intersection): THREE.Vector3 {
	return (hit as THREE.Intersection & { pointOnLine?: THREE.Vector3 }).pointOnLine ?? hit.point;
}

interface SnapResult {
	point: THREE.Vector3;
	snapped: boolean;
}

function snapHit(
	hit: THREE.Intersection,
	camera: THREE.Camera,
	screenSize: { width: number; height: number },
	snapPixels: number
): SnapResult {
	const raw = hitPoint(hit).clone();
	const candidates = snapCandidates(hit);
	if (!candidates) return { point: raw, snapped: false };

	const rawScreen = toScreen(raw, camera, screenSize);
	let best: SnapResult = { point: raw, snapped: false };
	let bestPx = snapPixels;
	for (const local of candidates) {
		const world = local.applyMatrix4(hit.object.matrixWorld);
		const px = toScreen(world, camera, screenSize).distanceTo(rawScreen);
		if (px < bestPx) {
			bestPx = px;
			best = { point: world, snapped: true };
		}
	}
	return best;
}

/** Snap a raycast hit to the nearest geometry vertex within `snapPixels` on screen, else the raw hit point. */
export function snapToVertex(
	hit: THREE.Intersection,
	camera: THREE.Camera,
	screenSize: { width: number; height: number },
	snapPixels: number
): THREE.Vector3 {
	return snapHit(hit, camera, screenSize, snapPixels).point;
}

interface Measurement {
	markers: THREE.Points;
	line: Line2;
	label: LabelHandle;
}

export function createMeasureTool(deps: MeasureDeps): MeasureTool {
	const { canvas, scene, getActiveCamera, getViewTarget, labelLayer, options = {} } = deps;
	const requestRender = deps.requestRender ?? (() => {});
	const snapPixels = options.snapPixels ?? DEFAULT_SNAP_PIXELS;
	const color = new THREE.Color(options.color ?? DEFAULT_COLOR);
	const format = options.format ?? makeDefaultFormat(makeFormatter(options.displayUnit));

	const raycaster = new THREE.Raycaster();
	const pointer = new THREE.Vector2();

	let enabled = false;
	let start: { point: THREE.Vector3; marker: THREE.Points } | null = null;
	const measurements: Measurement[] = [];

	// depthTest off throughout: markers and lines stay visible through geometry, like CAD snap dots.
	const markerMaterial = new THREE.PointsMaterial({
		color,
		size: 8,
		sizeAttenuation: false,
		depthTest: false
	});
	// Solid and larger once snapped to a vertex; small and faint on a free surface point, so the
	// user sees whether the next click lands on a vertex before clicking.
	const hoverSnappedMaterial = new THREE.PointsMaterial({
		color,
		size: 12,
		sizeAttenuation: false,
		depthTest: false
	});
	const hoverFreeMaterial = new THREE.PointsMaterial({
		color,
		size: 7,
		sizeAttenuation: false,
		depthTest: false,
		transparent: true,
		opacity: 0.6
	});

	const tag = <T extends THREE.Object3D>(object: T, renderOrder: number): T => {
		object.renderOrder = renderOrder;
		object.userData.id = 'measure';
		object.raycast = () => {}; // never a measure target itself
		object.frustumCulled = false; // positions are rewritten in place; a stale sphere would cull
		return object;
	};

	const makePoints = (...ps: THREE.Vector3[]): THREE.Points => {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(
				ps.flatMap((p) => [p.x, p.y, p.z]),
				3
			)
		);
		const points = tag(new THREE.Points(geometry, markerMaterial), RENDER_ORDER_MARKER);
		scene.add(points);
		return points;
	};

	const makeLine = (a: THREE.Vector3, b: THREE.Vector3, opacity = 1): Line2 => {
		const geometry = new LineGeometry();
		geometry.setPositions([a.x, a.y, a.z, b.x, b.y, b.z]);
		const material = new LineMaterial({ color, transparent: opacity < 1, opacity });
		(material as LineMaterial & { linewidth: number }).linewidth = 2;
		material.depthTest = false;
		const line = tag(new Line2(geometry, material), RENDER_ORDER_LINE);
		scene.add(line);
		return line;
	};

	// Rewrites a two-point Line2 in place. `setPositions` would allocate new GPU buffers per frame.
	const moveLine = (line: Line2, a: THREE.Vector3, b: THREE.Vector3) => {
		const startAttr = line.geometry.attributes.instanceStart as THREE.InterleavedBufferAttribute;
		const buffer = startAttr.data;
		(buffer.array as Float32Array).set([a.x, a.y, a.z, b.x, b.y, b.z]);
		buffer.needsUpdate = true;
	};

	const disposeLine = (line: Line2) => {
		line.geometry.dispose();
		(line.material as LineMaterial).dispose();
		line.removeFromParent();
	};

	const disposePoints = (points: THREE.Points) => {
		points.geometry.dispose();
		points.removeFromParent();
	};

	const labelText = (a: THREE.Vector3, b: THREE.Vector3) => {
		const delta = new THREE.Vector3(Math.abs(b.x - a.x), Math.abs(b.y - a.y), Math.abs(b.z - a.z));
		return format(a.distanceTo(b), delta);
	};
	const midpoint = (a: THREE.Vector3, b: THREE.Vector3) => a.clone().add(b).multiplyScalar(0.5);

	// ==========================================================================
	// Hover preview: snap marker, plus the rubber band while a start point is set
	// ==========================================================================

	let hoverMarker: THREE.Points | null = null;
	let rubberBand: Line2 | null = null;
	let rubberLabel: LabelHandle | null = null;

	const hidePreview = () => {
		if (hoverMarker) hoverMarker.visible = false;
		if (rubberBand) rubberBand.visible = false;
		rubberLabel?.remove();
		rubberLabel = null;
	};

	const showPreview = (snap: SnapResult | null) => {
		if (!snap) {
			hidePreview();
			return;
		}
		if (!hoverMarker) {
			hoverMarker = makePoints(new THREE.Vector3());
			hoverMarker.renderOrder = RENDER_ORDER_HOVER;
		}
		hoverMarker.material = snap.snapped ? hoverSnappedMaterial : hoverFreeMaterial;
		hoverMarker.position.copy(snap.point);
		hoverMarker.visible = true;

		if (!start) {
			if (rubberBand) rubberBand.visible = false;
			rubberLabel?.remove();
			rubberLabel = null;
			return;
		}
		if (!rubberBand) rubberBand = makeLine(start.point, snap.point, 0.7);
		moveLine(rubberBand, start.point, snap.point);
		rubberBand.visible = true;
		const text = labelText(start.point, snap.point);
		const mid = midpoint(start.point, snap.point);
		if (rubberLabel) {
			rubberLabel.setText(text);
			rubberLabel.setPosition(mid);
		} else {
			rubberLabel = labelLayer.addLabel(text, mid, options.labelClassName);
		}
	};

	// ==========================================================================
	// Picking
	// ==========================================================================

	const pick = (event: MouseEvent): SnapResult | null => {
		const rect = canvas.getBoundingClientRect();
		const cursorX = event.clientX - rect.left;
		const cursorY = event.clientY - rect.top;
		pointer.x = (cursorX / rect.width) * 2 - 1;
		pointer.y = -(cursorY / rect.height) * 2 + 1;

		const camera = getActiveCamera();
		raycaster.setFromCamera(pointer, camera);

		// Lines/points have no surface area, so the raycast threshold matters — three's default is
		// nearly unclickable. The world-space band is generous (2x); the screen-space test below is
		// what decides, so it can't grab a line that is far off on screen but near in depth.
		const threshold = pickThreshold(camera, getViewTarget?.()) * 2;
		raycaster.params.Line!.threshold = threshold;
		raycaster.params.Points!.threshold = threshold;
		// Fat lines (Line2) measure their band in pixels on top of the line width.
		(raycaster.params as { Line2?: { threshold: number } }).Line2 = { threshold: snapPixels / 2 };

		const screen = { width: rect.width, height: rect.height };
		const cursor = new THREE.Vector2(cursorX, cursorY);
		for (const hit of raycastVisible(scene, raycaster)) {
			const isSurface = (hit.object as THREE.Mesh).isMesh && hit.face != null;
			if (!isSurface && toScreen(hitPoint(hit), camera, screen).distanceTo(cursor) > snapPixels) {
				continue;
			}
			return snapHit(hit, camera, screen, snapPixels);
		}
		return null;
	};

	// One pick per animation frame, not per mousemove: only the latest event matters for the preview.
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
			showPreview(pick(latest));
			requestRender();
		});
	};

	const handleLeave = () => {
		cancelPendingMove();
		hidePreview();
		requestRender();
	};

	// ==========================================================================
	// Committing and clearing
	// ==========================================================================

	const dropStart = () => {
		if (!start) return;
		disposePoints(start.marker);
		start = null;
	};

	const clear = () => {
		dropStart();
		for (const m of measurements) {
			disposePoints(m.markers);
			disposeLine(m.line);
			m.label.remove();
		}
		measurements.length = 0;
		hidePreview();
		requestRender();
	};

	const cancel = () => {
		if (start) {
			dropStart();
			hidePreview();
			requestRender();
		} else {
			clear();
		}
	};

	const handleClick = (event: MouseEvent): boolean => {
		if (!enabled) return false;
		cancelPendingMove(); // a stale preview frame must not redraw the band after commit

		const snap = pick(event);
		if (!snap) return true; // consumed: a measuring click that missed still isn't a select

		if (!start) {
			start = { point: snap.point, marker: makePoints(snap.point) };
		} else if (!snap.point.equals(start.point)) {
			const a = start.point;
			const b = snap.point;
			dropStart();
			measurements.push({
				markers: makePoints(a, b),
				line: makeLine(a, b),
				label: labelLayer.addLabel(labelText(a, b), midpoint(a, b), options.labelClassName)
			});
		}
		showPreview(snap);
		requestRender();
		return true;
	};

	const handleKey = (event: KeyboardEvent) => {
		if (event.key !== 'Escape') return;
		const target = event.target as HTMLElement | null;
		if (target?.closest?.('input, textarea, select, [contenteditable]')) return;
		cancel();
	};

	// ==========================================================================
	// Enable / dispose
	// ==========================================================================

	let previousCursor = '';
	let cancelWarm: (() => void) | null = null;

	const setEnabled = (value: boolean) => {
		if (value === enabled) return;
		enabled = value;
		if (value) {
			previousCursor = canvas.style.cursor;
			canvas.style.cursor = 'crosshair';
			canvas.addEventListener('mouseleave', handleLeave);
			window.addEventListener('keydown', handleKey);
			cancelWarm = warmPickIndex(scene);
		} else {
			canvas.style.cursor = previousCursor;
			canvas.removeEventListener('mouseleave', handleLeave);
			window.removeEventListener('keydown', handleKey);
			cancelWarm?.();
			cancelWarm = null;
			cancelPendingMove();
			clear();
		}
	};

	return {
		setEnabled,
		isEnabled: () => enabled,
		handleClick,
		handleMove,
		cancel,
		clear,
		dispose: () => {
			setEnabled(false);
			clear();
			if (hoverMarker) disposePoints(hoverMarker);
			if (rubberBand) disposeLine(rubberBand);
			hoverMarker = null;
			rubberBand = null;
			markerMaterial.dispose();
			hoverSnappedMaterial.dispose();
			hoverFreeMaterial.dispose();
		}
	};
}
