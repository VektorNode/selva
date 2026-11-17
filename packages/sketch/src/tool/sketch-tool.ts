import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import {
	pickThreshold,
	pointerToNdc,
	raycastVisible,
	snapToVertex,
	type LabelHandle,
	type PointerTool,
	type ThreeViewer
} from '@selvajs/visualization/render';

import {
	distance,
	isValidCurve,
	nurbsFromControlPoints,
	verticesOf,
	withVertex,
	withoutVertex,
	type Point3,
	type SketchCurve
} from '../model/curve.js';
import { segmentsOf, setSegmentLength } from '../model/measure.js';
import { tessellate } from '../model/nurbs.js';
import { TYPED_KEY, constrainPoint, formatLength, parseTypedInput } from './constraints.js';

// ============================================================================
// Drawing curves in the viewer
// ============================================================================
//
// One tool holds the curves of one input. It draws them as host-owned geometry, so they survive
// solves, and while a mode is on it claims canvas clicks ahead of object selection.
//
// Curves are in model units; the scene is in metres. `metersPerUnit` is the only bridge, and the
// axes are the same on both sides.
//
// Points land on the model's XY plane. A vertex of the solved model or of a drawn curve under the
// cursor wins over the plane; with `planar` on it is dropped onto the plane, so a snap in a
// perspective view cannot lift a curve off the ground by accident.

/** `line` takes two points per curve; `polyline` and `nurbs` take points until finished. */
export type DrawMode = 'line' | 'polyline' | 'nurbs';

/** `move` picks up a vertex with one click and puts it down with the next. */
export type SketchMode = DrawMode | 'move';

export interface SketchState {
	mode: SketchMode | null;
	/** Points placed for the curve being drawn. */
	pendingPoints: number;
	/** The length or `length<angle` typed for the next point. */
	typed: string;
}

export interface SketchSettings {
	/** Model units between grid snaps; 0 turns the grid off. */
	gridStep: number;
	/** Drops every point onto the model's XY plane. */
	planar: boolean;
	/** Shows each straight segment's length; a click on one edits it. */
	showDimensions: boolean;
}

export interface SketchToolOptions {
	viewer: ThreeViewer;
	/** Scopes the scene content and the pointer-tool registration: unique per input. */
	id: string;
	/** Scene metres per model unit. */
	metersPerUnit: number;
	/** Shown after every length, such as `mm`. */
	unitSuffix?: string;
	/** The group's name in the scene outliner. */
	name?: string;
	color?: THREE.ColorRepresentation;
	/** Snap to a vertex within this many screen pixels. Default 12. */
	snapPixels?: number;
	/**
	 * The most curves the input takes. Drawing one more drops the oldest, and the mode ends once
	 * the count is reached, so an input that takes one curve is redrawn in one go. Default: no limit.
	 */
	maxCurves?: number;
	settings?: Partial<SketchSettings>;
	/** After the user adds, edits or removes a curve. Not called for {@link SketchTool.setCurves}. */
	onChange?: (curves: SketchCurve[]) => void;
	onStateChange?: (state: SketchState) => void;
}

export interface SketchTool {
	getCurves(): SketchCurve[];
	/** Replaces the curves, as after an import or a loaded value. Drops a vertex being moved. */
	setCurves(curves: readonly SketchCurve[]): void;
	/** Starts drawing. The mode stays on, curve after curve, until `finish` or `cancel`. */
	draw(mode: DrawMode): void;
	/** Starts moving vertices. Delete removes the one picked up. */
	move(): void;
	/** Leaves the mode, keeping the curve being drawn when it has enough points. */
	finish(): void;
	/** Leaves the mode and drops the curve being drawn, or puts a moved vertex back. */
	cancel(): void;
	getState(): SketchState;
	configure(settings: Partial<SketchSettings>): void;
	dispose(): void;
}

const DEFAULT_COLOR = 0x1d6ff2;
const DEFAULT_SNAP_PIXELS = 12;
// Above solve geometry and the measure tool's own overlay, so a sketch is never hidden by it.
const RENDER_ORDER_LINE = 1010;
const RENDER_ORDER_POINT = 1011;
const RENDER_ORDER_HOVER = 1012;
// A label is a DOM node: an imported drawing with thousands of segments would stall the page.
const MAX_DIMENSION_LABELS = 150;

interface Resolved {
	point: Point3;
	snapped: boolean;
}

interface VertexRef {
	curve: number;
	vertex: number;
}

export function createSketchTool(options: SketchToolOptions): SketchTool {
	const { viewer, metersPerUnit, unitSuffix = '' } = options;
	const toolId = `sketch:${options.id}`;
	const snapPixels = options.snapPixels ?? DEFAULT_SNAP_PIXELS;
	const maxCurves = Math.max(1, options.maxCurves ?? Infinity);
	const color = new THREE.Color(options.color ?? DEFAULT_COLOR);
	const canvas = viewer.renderer.domElement;
	const settings: SketchSettings = {
		gridStep: 0,
		planar: true,
		showDimensions: true,
		...options.settings
	};

	let curves: SketchCurve[] = [];
	let mode: SketchMode | null = null;
	let pending: Point3[] = [];
	let typed = '';
	let cursor: Resolved | null = null;
	let grabbed: (VertexRef & { original: SketchCurve }) | null = null;
	let disposed = false;

	// ==========================================================================
	// Scene objects
	// ==========================================================================

	const toScene = (p: Point3) =>
		new THREE.Vector3(p[0] * metersPerUnit, p[1] * metersPerUnit, p[2] * metersPerUnit);
	const fromScene = (v: THREE.Vector3): Point3 => [
		v.x / metersPerUnit,
		v.y / metersPerUnit,
		v.z / metersPerUnit
	];

	const root = new THREE.Group();
	root.name = options.name ?? 'Sketch';
	root.userData.id = toolId;

	const tag = <T extends THREE.Object3D>(object: T, renderOrder: number): T => {
		object.renderOrder = renderOrder;
		object.raycast = () => {}; // own geometry is snapped to by vertex, never ray-picked
		object.frustumCulled = false; // geometry is swapped on every edit; a stale sphere would cull
		return object;
	};

	// depthTest off throughout: a sketch stays visible through the model it is drawn against.
	const makeLines = (opacity: number): LineSegments2 => {
		const material = new LineMaterial({ color, linewidth: 2.5, transparent: opacity < 1, opacity });
		material.depthTest = false;
		return tag(new LineSegments2(new LineSegmentsGeometry(), material), RENDER_ORDER_LINE);
	};
	const makePoints = (size: number, opacity = 1, order = RENDER_ORDER_POINT): THREE.Points =>
		tag(
			new THREE.Points(
				new THREE.BufferGeometry(),
				new THREE.PointsMaterial({
					color,
					size,
					sizeAttenuation: false,
					depthTest: false,
					transparent: opacity < 1,
					opacity
				})
			),
			order
		);

	const curveLines = makeLines(1);
	const curvePoints = makePoints(7);
	const previewLines = makeLines(0.65);
	const previewPoints = makePoints(7);
	const hoverSnapped = makePoints(12, 1, RENDER_ORDER_HOVER);
	const hoverFree = makePoints(7, 0.6, RENDER_ORDER_HOVER);

	// An object with nothing to draw leaves the scene, and the group goes with its last one: an
	// empty one would still count for fit-to-view and show as an empty row in the outliner. So an
	// input nobody has drawn into adds nothing to the viewer.
	const show = (object: THREE.Object3D) => {
		root.add(object);
		if (!root.parent) viewer.addUserGeometry(root, toolId);
	};
	const hide = (object: THREE.Object3D) => {
		object.removeFromParent();
		if (root.children.length === 0) root.removeFromParent();
	};

	const setLines = (lines: LineSegments2, polylines: Point3[][]) => {
		const positions: number[] = [];
		for (const polyline of polylines) {
			for (let i = 1; i < polyline.length; i++) {
				const a = toScene(polyline[i - 1]);
				const b = toScene(polyline[i]);
				positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
			}
		}
		lines.geometry.dispose();
		lines.geometry = new LineSegmentsGeometry();
		if (positions.length === 0) {
			hide(lines);
			return;
		}
		lines.geometry.setPositions(positions);
		show(lines);
	};

	const setPoints = (points: THREE.Points, at: readonly Point3[]) => {
		points.geometry.dispose();
		points.geometry = new THREE.BufferGeometry();
		if (at.length === 0) {
			hide(points);
			return;
		}
		points.geometry.setAttribute(
			'position',
			new THREE.Float32BufferAttribute(
				at.flatMap((p) => toScene(p).toArray()),
				3
			)
		);
		show(points);
	};

	// ==========================================================================
	// Dimension labels
	// ==========================================================================

	let labels: LabelHandle[] = [];
	let previewLabel: LabelHandle | null = null;
	let editingLabel = false;

	const clearLabels = () => {
		labels.forEach((label) => label.remove());
		labels = [];
	};

	const midpoint = (a: Point3, b: Point3): Point3 => [
		(a[0] + b[0]) / 2,
		(a[1] + b[1]) / 2,
		(a[2] + b[2]) / 2
	];

	const editDimension = (element: HTMLElement, curve: number, segment: number, length: number) => {
		editingLabel = true;
		const input = document.createElement('input');
		input.type = 'text';
		input.inputMode = 'decimal';
		input.value = formatLength(length);
		Object.assign(input.style, {
			width: `${Math.max(5, input.value.length + 2)}ch`,
			font: 'inherit',
			color: '#111',
			background: '#fff',
			border: '0',
			borderRadius: '2px',
			padding: '0 2px',
			textAlign: 'center'
		} satisfies Partial<CSSStyleDeclaration>);
		element.textContent = '';
		element.appendChild(input);
		input.focus();
		input.select();

		const close = (commit: boolean) => {
			if (!editingLabel) return;
			editingLabel = false;
			const value = Number(input.value.replace(',', '.'));
			if (commit && value > 0 && Number.isFinite(value) && curves[curve]) {
				const next = setSegmentLength(curves[curve], segment, value);
				if (next !== curves[curve] && isValidCurve(next)) {
					curves = curves.map((c, i) => (i === curve ? next : c));
					options.onChange?.(curves);
				}
			}
			rebuild();
		};
		input.addEventListener('keydown', (event) => {
			// The viewer and the page bind keys of their own; none of them apply while typing here.
			event.stopPropagation();
			if (event.key === 'Enter') close(true);
			else if (event.key === 'Escape') close(false);
		});
		input.addEventListener('blur', () => close(false));
	};

	const rebuildLabels = (shown: readonly SketchCurve[]) => {
		clearLabels();
		if (!settings.showDimensions) return;
		const segments = shown.flatMap((curve, c) =>
			segmentsOf(curve).map((segment, s) => ({ ...segment, curve: c, segment: s }))
		);
		if (segments.length > MAX_DIMENSION_LABELS) return;
		// Editing a length while a point is being placed would fight the typed-length buffer.
		const editable = mode === null || mode === 'move';
		for (const { from, to, length, curve, segment } of segments) {
			if (length === 0) continue;
			const label = viewer.labelLayer.addLabel(
				formatLength(length, unitSuffix),
				toScene(midpoint(from, to))
			);
			if (editable) {
				const element = label.object.element as HTMLElement;
				element.style.pointerEvents = 'auto';
				element.style.cursor = 'text';
				element.addEventListener('click', (event) => {
					event.stopPropagation();
					if (!editingLabel) editDimension(element, curve, segment, length);
				});
			}
			labels.push(label);
		}
	};

	// ==========================================================================
	// Drawing what is there
	// ==========================================================================

	/** The curves as they look right now: a vertex being moved follows the cursor. */
	const shownCurves = (): SketchCurve[] => {
		if (!grabbed || !cursor) return curves;
		const moved = withVertex(grabbed.original, grabbed.vertex, cursor.point);
		return curves.map((curve, i) => (i === grabbed!.curve ? moved : curve));
	};

	const rebuild = () => {
		if (disposed) return;
		const shown = shownCurves();
		setLines(
			curveLines,
			shown.map((curve) => tessellate(curve))
		);
		// A NURBS curve's control points sit off the curve: they show only while they can be moved.
		setPoints(
			curvePoints,
			shown.flatMap((curve) => (curve.kind === 'nurbs' && mode !== 'move' ? [] : verticesOf(curve)))
		);
		if (!editingLabel) rebuildLabels(shown);
		viewer.invalidate();
	};

	const lastPoint = (): Point3 | null => pending[pending.length - 1] ?? null;

	const refreshPreview = () => {
		if (disposed) return;
		const drawing = mode !== null && mode !== 'move';
		const points = drawing && cursor ? [...pending, cursor.point] : pending;

		const preview: Point3[][] = [];
		if (drawing && points.length >= 2) {
			preview.push(mode === 'nurbs' ? tessellate(nurbsFromControlPoints(points)) : points);
		}
		setLines(previewLines, preview);
		setPoints(previewPoints, drawing ? pending : []);
		setPoints(hoverSnapped, mode && cursor?.snapped ? [cursor.point] : []);
		setPoints(hoverFree, mode && cursor && !cursor.snapped ? [cursor.point] : []);

		const last = lastPoint();
		if (drawing && last && cursor && distance(last, cursor.point) > 0) {
			const length = formatLength(distance(last, cursor.point), unitSuffix);
			const text = typed ? `${typed}\n${length}` : length;
			const at = toScene(midpoint(last, cursor.point));
			if (previewLabel) {
				previewLabel.setText(text);
				previewLabel.setPosition(at);
			} else {
				previewLabel = viewer.labelLayer.addLabel(text, at);
			}
		} else {
			previewLabel?.remove();
			previewLabel = null;
		}
		viewer.invalidate();
	};

	const notify = () => options.onStateChange?.(getState());
	const getState = (): SketchState => ({ mode, pendingPoints: pending.length, typed });

	// ==========================================================================
	// Picking
	// ==========================================================================

	const raycaster = new THREE.Raycaster();
	const groundPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);

	const toScreen = (world: THREE.Vector3, camera: THREE.Camera, rect: DOMRect) => {
		const ndc = world.clone().project(camera);
		return {
			x: ((ndc.x + 1) / 2) * rect.width,
			y: ((1 - ndc.y) / 2) * rect.height,
			// Behind the camera a point still projects somewhere on screen.
			visible: ndc.z > -1 && ndc.z < 1
		};
	};

	/** The drawn vertex nearest the cursor within the snap band, skipping the one being moved. */
	const nearestVertex = (
		event: MouseEvent,
		camera: THREE.Camera
	): (VertexRef & { point: Point3 }) | null => {
		const rect = canvas.getBoundingClientRect();
		const x = event.clientX - rect.left;
		const y = event.clientY - rect.top;
		let best: (VertexRef & { point: Point3 }) | null = null;
		let bestPx = snapPixels;
		const consider = (point: Point3, curve: number, vertex: number) => {
			const screen = toScreen(toScene(point), camera, rect);
			const px = Math.hypot(screen.x - x, screen.y - y);
			if (screen.visible && px < bestPx) {
				bestPx = px;
				best = { point, curve, vertex };
			}
		};
		curves.forEach((curve, c) =>
			verticesOf(curve).forEach((point, v) => {
				if (grabbed?.curve === c && grabbed.vertex === v) return;
				consider(point, c, v);
			})
		);
		pending.forEach((point, v) => consider(point, -1, v));
		return best;
	};

	const pickScene = (event: MouseEvent, camera: THREE.Camera): Resolved | null => {
		const rect = canvas.getBoundingClientRect();
		const screen = { width: rect.width, height: rect.height };
		const cursorPx = { x: event.clientX - rect.left, y: event.clientY - rect.top };

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
				if (Math.hypot(at.x - cursorPx.x, at.y - cursorPx.y) > snapPixels) continue;
			}
			const vertex = snapToVertex(hit, camera, screen, snapPixels);
			// A curve or point under the cursor counts as a snap even between its vertices.
			if (!isSurface || !vertex.equals(raw)) return { point: fromScene(vertex), snapped: true };
			return settings.planar ? null : { point: fromScene(raw), snapped: false };
		}
		return null;
	};

	const resolve = (event: MouseEvent): Resolved | null => {
		const camera = viewer.cameraController.getActiveCamera();
		const ndc = pointerToNdc(event, canvas);
		raycaster.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), camera);

		const own = nearestVertex(event, camera);
		let found: Resolved | null = own
			? { point: own.point, snapped: true }
			: pickScene(event, camera);
		if (!found) {
			const onPlane = raycaster.ray.intersectPlane(groundPlane, new THREE.Vector3());
			if (!onPlane) return null;
			found = { point: fromScene(onPlane), snapped: false };
		}
		if (settings.planar) found = { ...found, point: [found.point[0], found.point[1], 0] };

		const moving = mode === 'move';
		return {
			snapped: found.snapped,
			point: constrainPoint(found.point, {
				last: moving
					? grabbed
						? verticesOf(grabbed.original)[grabbed.vertex]
						: null
					: lastPoint(),
				snapped: found.snapped,
				ortho: event.shiftKey,
				gridStep: settings.gridStep,
				typed: moving ? null : parseTypedInput(typed)
			})
		};
	};

	// ==========================================================================
	// Building curves
	// ==========================================================================

	const commit = (curve: SketchCurve) => {
		pending = [];
		typed = '';
		if (!isValidCurve(curve)) return;
		curves = [...curves, curve].slice(-maxCurves);
		options.onChange?.(curves);
		if (curves.length >= maxCurves) leave();
	};

	/** Turns the placed points into a curve. False when there were too few. */
	const commitPending = (closed = false): boolean => {
		const points = pending;
		if (points.length < 2) {
			pending = [];
			typed = '';
			return false;
		}
		if (mode === 'line') commit({ kind: 'line', from: points[0], to: points[1] });
		else if (mode === 'nurbs') {
			commit(nurbsFromControlPoints(closed ? [...points, points[0]] : points));
		} else commit({ kind: 'polyline', points, closed: closed && points.length > 2 });
		return true;
	};

	const samePoint = (a: Point3, b: Point3) => distance(a, b) === 0;

	const placePoint = (point: Point3) => {
		const last = lastPoint();
		// A second click on the last point ends the curve: it is what a double-click sends.
		if (last && samePoint(point, last)) commitPending();
		else if (mode !== 'line' && pending.length >= 3 && samePoint(point, pending[0])) {
			commitPending(true);
		} else {
			pending = [...pending, point];
			typed = '';
			if (mode === 'line' && pending.length === 2) commitPending();
		}
		rebuild();
		refreshPreview();
		notify();
	};

	const releaseGrab = (apply: boolean, point?: Point3) => {
		if (!grabbed) return;
		const { curve, vertex, original } = grabbed;
		grabbed = null;
		if (apply && point) {
			const moved = withVertex(original, vertex, point);
			if (isValidCurve(moved)) {
				curves = curves.map((c, i) => (i === curve ? moved : c));
				options.onChange?.(curves);
			}
		}
	};

	const deleteGrabbed = () => {
		if (!grabbed) return;
		const { curve, vertex, original } = grabbed;
		grabbed = null;
		const shorter = withoutVertex(original, vertex);
		curves =
			shorter && isValidCurve(shorter)
				? curves.map((c, i) => (i === curve ? shorter : c))
				: curves.filter((_, i) => i !== curve);
		options.onChange?.(curves);
	};

	// ==========================================================================
	// Modes
	// ==========================================================================

	const onKeyDown = (event: KeyboardEvent) => {
		if (!mode || event.ctrlKey || event.metaKey || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
			return;
		}
		const moving = mode === 'move';
		let handled = true;

		if (event.key === 'Escape') {
			if (moving && grabbed) releaseGrab(false);
			else if (typed) typed = '';
			else if (pending.length) pending = [];
			else leave();
		} else if (event.key === 'Enter') {
			if (moving) leave();
			else if (typed && cursor && lastPoint()) placePoint(cursor.point);
			else if (!commitPending()) leave();
		} else if (event.key === 'Backspace' || event.key === 'Delete') {
			if (moving) deleteGrabbed();
			else if (typed) typed = typed.slice(0, -1);
			else pending = pending.slice(0, -1);
		} else if (!moving && TYPED_KEY.test(event.key)) {
			typed += event.key === ',' ? '.' : event.key;
		} else {
			handled = false;
		}
		if (!handled) return;

		// Enter would otherwise press the focused Draw button again, and Escape leave fullscreen.
		event.preventDefault();
		event.stopPropagation();
		if (mode) {
			// What was typed changes where the cursor's point lands, without the cursor moving.
			if (lastMove) cursor = resolve(lastMove);
			rebuild();
			refreshPreview();
			notify();
		}
	};

	const enter = (next: SketchMode) => {
		if (disposed) return;
		if (mode) leave();
		mode = next;
		viewer.tools.setActive(toolId);
		window.addEventListener('keydown', onKeyDown, true);
		canvas.style.cursor = 'crosshair';
		rebuild();
		refreshPreview();
		notify();
	};

	const leave = () => {
		if (!mode) return;
		mode = null;
		pending = [];
		typed = '';
		cursor = null;
		lastMove = null;
		grabbed = null;
		if (moveFrame) cancelAnimationFrame(moveFrame);
		moveFrame = 0;
		window.removeEventListener('keydown', onKeyDown, true);
		canvas.style.cursor = '';
		// Clearing the registry calls `setEnabled(false)` back; `mode` is already null by then.
		if (viewer.tools.getActive() === toolId) viewer.tools.setActive(null);
		rebuild();
		refreshPreview();
		notify();
	};

	// One pick per animation frame: only the latest move matters for the preview.
	let lastMove: MouseEvent | null = null;
	let moveFrame = 0;

	const pointerTool: PointerTool = {
		// Another tool taking over ends the mode; this tool never enables itself from here.
		setEnabled: (enabled) => {
			if (!enabled) leave();
		},
		isEnabled: () => mode !== null,
		handleClick: (event) => {
			if (!mode) return false;
			const camera = viewer.cameraController.getActiveCamera();
			if (mode === 'move' && !grabbed) {
				const vertex = nearestVertex(event, camera);
				if (vertex && vertex.curve >= 0) {
					grabbed = { curve: vertex.curve, vertex: vertex.vertex, original: curves[vertex.curve] };
					cursor = { point: vertex.point, snapped: true };
				}
			} else {
				const resolved = resolve(event);
				if (resolved && mode === 'move') releaseGrab(true, resolved.point);
				else if (resolved) {
					placePoint(resolved.point);
					return true;
				}
			}
			rebuild();
			refreshPreview();
			return true;
		},
		handleMove: (event) => {
			if (!mode) return;
			lastMove = event;
			if (moveFrame) return;
			moveFrame = requestAnimationFrame(() => {
				moveFrame = 0;
				if (!mode || !lastMove) return;
				cursor = resolve(lastMove);
				if (grabbed) rebuild();
				refreshPreview();
			});
		}
	};
	const unregister = viewer.tools.register({ id: toolId, tool: pointerTool, priority: 10 });

	return {
		getCurves: () => curves,
		setCurves: (next) => {
			curves = [...next];
			grabbed = null;
			rebuild();
		},
		draw: (next) => enter(next),
		move: () => enter('move'),
		finish: () => {
			if (!mode) return;
			if (mode !== 'move') commitPending();
			leave();
		},
		cancel: () => leave(),
		getState,
		configure: (next) => {
			Object.assign(settings, next);
			rebuild();
		},
		dispose: () => {
			if (disposed) return;
			leave();
			disposed = true;
			unregister();
			clearLabels();
			previewLabel?.remove();
			// Detached objects are not reached by the root's disposal.
			for (const object of [
				curveLines,
				curvePoints,
				previewLines,
				previewPoints,
				hoverSnapped,
				hoverFree
			]) {
				object.removeFromParent();
				object.geometry.dispose();
				(object.material as THREE.Material).dispose();
			}
			viewer.removeUserGeometry(root);
		}
	};
}
