import type * as THREE from 'three';
import type { PointerTool, ThreeViewer } from '@selvajs/visualization/render';

import {
	distance,
	isCurve,
	isValidItem,
	nurbsFromControlPoints,
	verticesOf,
	withVertex,
	withoutVertex,
	type Point3,
	type SketchCurve,
	type SketchItem
} from '../model/curve.js';
import { segmentsOf, setSegmentLength } from '../model/measure.js';
import { tessellate } from '../model/nurbs.js';
import { TYPED_KEY, formatLength, parseTypedInput } from './constraints.js';
import { createCurveLayer } from './curve-layer.js';
import { createPointPicker, type PickedPoint } from './point-picker.js';

// ============================================================================
// Drawing curves and points in the viewer
// ============================================================================
//
// One tool holds the items of one input. It is the curve layer (what is shown) and the point
// picker (where a click lands) put together with the rules of drawing: a mode turns placed points
// into items, Enter finishes, Escape steps back, and every change can be undone.
//
// A host with its own kind of element writes a `DrawModeSpec` and passes it to `draw`. One that
// wants different rules altogether builds on the layer and the picker instead.

/** The built-in ways to draw. `line` takes two points, `point` one, the others until finished. */
export type DrawMode = 'point' | 'line' | 'polyline' | 'nurbs';

/** How placed points become items. */
export interface DrawModeSpec {
	/** Reported as the tool's mode while it is on. `move` is taken. */
	id: string;
	/** Points after which the item finishes by itself. Absent: the user finishes it. */
	pointCount?: number;
	/** A click back on the first point finishes with `closed` true. */
	closable?: boolean;
	/**
	 * The items the points make, or null while there are too few. Also called for the preview,
	 * with the cursor as the last point. Items may carry a `path` and `attributes`.
	 */
	build(points: readonly Point3[], closed: boolean): SketchItem[] | null;
}

export const DRAW_MODES: Readonly<Record<DrawMode, DrawModeSpec>> = {
	point: {
		id: 'point',
		pointCount: 1,
		build: (points) => (points.length >= 1 ? [{ kind: 'point', at: points[0] }] : null)
	},
	line: {
		id: 'line',
		pointCount: 2,
		build: (points) =>
			points.length >= 2 ? [{ kind: 'line', from: points[0], to: points[1] }] : null
	},
	polyline: {
		id: 'polyline',
		closable: true,
		build: (points, closed) =>
			points.length >= 2
				? [{ kind: 'polyline', points: [...points], closed: closed && points.length > 2 }]
				: null
	},
	nurbs: {
		id: 'nurbs',
		closable: true,
		build: (points, closed) =>
			points.length >= 2 ? [nurbsFromControlPoints(closed ? [...points, points[0]] : points)] : null
	}
};

/** `move` picks up a vertex with one click and puts it down with the next. */
const MOVE = 'move';

export interface SketchState {
	/** A draw mode's id, `move`, or null while the tool is idle. */
	mode: string | null;
	/** Points placed for the item being drawn. */
	pendingPoints: number;
	/** The length or `length<angle` typed for the next point. */
	typed: string;
	canUndo: boolean;
	canRedo: boolean;
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
	/** A colour per curve, such as by role; undefined falls back to `color`. */
	colorOf?: (curve: SketchCurve) => THREE.ColorRepresentation | undefined;
	/** Snap to a vertex within this many screen pixels. Default 12. */
	snapPixels?: number;
	/**
	 * The most items the input takes. Drawing one more drops the oldest, and the mode ends once
	 * the count is reached, so an input that takes one curve is redrawn in one go. Default: no limit.
	 */
	maxItems?: number;
	settings?: Partial<SketchSettings>;
	/** After the user adds, edits, removes, undoes or redoes. Not called for {@link SketchTool.setItems}. */
	onChange?: (items: SketchItem[]) => void;
	onStateChange?: (state: SketchState) => void;
}

export interface SketchTool {
	getItems(): SketchItem[];
	/** Replaces the items, as after an import or a loaded value. Clears the undo history. */
	setItems(items: readonly SketchItem[]): void;
	/** Starts drawing. The mode stays on, item after item, until `finish` or `cancel`. */
	draw(mode: DrawMode | DrawModeSpec): void;
	/** Starts moving vertices. Delete removes the one picked up. */
	move(): void;
	/** Leaves the mode, keeping the item being drawn when it has enough points. */
	finish(): void;
	/** Leaves the mode and drops the item being drawn, or puts a moved vertex back. */
	cancel(): void;
	undo(): void;
	redo(): void;
	getState(): SketchState;
	configure(settings: Partial<SketchSettings>): void;
	dispose(): void;
}

// A label is a DOM node: an imported drawing with thousands of segments would stall the page.
const MAX_DIMENSION_LABELS = 150;
const MAX_HISTORY = 100;

interface Grab {
	item: number;
	vertex: number;
	original: SketchItem;
}

export function createSketchTool(options: SketchToolOptions): SketchTool {
	const { viewer, unitSuffix = '' } = options;
	const toolId = `sketch:${options.id}`;
	const maxItems = Math.max(1, options.maxItems ?? Infinity);
	const canvas = viewer.renderer.domElement;
	const settings: SketchSettings = {
		gridStep: 0,
		planar: true,
		showDimensions: false,
		...options.settings
	};

	const layer = createCurveLayer(options);
	const picker = createPointPicker(options);

	let items: SketchItem[] = [];
	let past: SketchItem[][] = [];
	let future: SketchItem[][] = [];
	let spec: DrawModeSpec | null = null;
	let mode: string | null = null;
	let pending: Point3[] = [];
	let typed = '';
	let cursor: PickedPoint | null = null;
	let grabbed: Grab | null = null;
	let disposed = false;
	let nextId = 0;

	const getState = (): SketchState => ({
		mode,
		pendingPoints: pending.length,
		typed,
		canUndo: past.length > 0,
		canRedo: future.length > 0
	});
	const notify = () => options.onStateChange?.(getState());

	// ==========================================================================
	// Items and their history
	// ==========================================================================

	/** A user's change: the step before it can be undone to. */
	const apply = (next: SketchItem[]) => {
		past = [...past, items].slice(-MAX_HISTORY);
		future = [];
		items = next;
		options.onChange?.(items);
	};

	const step = (from: SketchItem[][], to: SketchItem[][]): [SketchItem[][], SketchItem[][]] => {
		const target = from[from.length - 1];
		if (!target) return [from, to];
		const moved = [from.slice(0, -1), [...to, items]] as [SketchItem[][], SketchItem[][]];
		items = target;
		grabbed = null;
		options.onChange?.(items);
		return moved;
	};

	const undo = () => {
		[past, future] = step(past, future);
		refresh();
	};
	const redo = () => {
		[future, past] = step(future, past);
		refresh();
	};

	const withId = (item: SketchItem): SketchItem =>
		item.id === undefined
			? { ...item, id: globalThis.crypto?.randomUUID?.() ?? `${toolId}:${++nextId}` }
			: item;

	// ==========================================================================
	// Showing what is there
	// ==========================================================================

	const midpoint = (a: Point3, b: Point3): Point3 => [
		(a[0] + b[0]) / 2,
		(a[1] + b[1]) / 2,
		(a[2] + b[2]) / 2
	];
	const lastPoint = (): Point3 | null => pending[pending.length - 1] ?? null;

	/** The items as they look right now: a vertex being moved follows the cursor. */
	const shownItems = (): SketchItem[] => {
		const grab = grabbed;
		if (!grab || !cursor) return items;
		const moved = withVertex(grab.original, grab.vertex, cursor.point);
		return items.map((item, i) => (i === grab.item ? moved : item));
	};

	const editLength = (item: number, segment: number, text: string) => {
		const length = Number(text.replace(',', '.'));
		const current = items[item];
		if (!current || !(length > 0) || !Number.isFinite(length)) return;
		const next = setSegmentLength(current, segment, length);
		if (next === current || !isValidItem(next)) return;
		apply(items.map((it, i) => (i === item ? next : it)));
		refresh();
	};

	const showItems = () => {
		const shown = shownItems();
		layer.setCurves(
			shown.filter(isCurve),
			// A NURBS curve's control points sit off the curve: they show only while they can be moved.
			shown.flatMap((item) => (item.kind === 'nurbs' && mode !== MOVE ? [] : verticesOf(item)))
		);

		const segments = settings.showDimensions
			? shown.flatMap((item, i) =>
					segmentsOf(item).map((s, segment) => ({ ...s, item: i, segment }))
				)
			: [];
		// Editing a length while a point is being placed would fight the typed-length buffer.
		const editable = mode === null || mode === MOVE;
		layer.setLabels(
			segments.length > MAX_DIMENSION_LABELS
				? []
				: segments
						.filter((s) => s.length > 0)
						.map((s) => ({
							text: formatLength(s.length, unitSuffix),
							at: midpoint(s.from, s.to),
							...(editable && {
								editText: formatLength(s.length),
								onEdit: (text: string) => editLength(s.item, s.segment, text)
							})
						}))
		);
	};

	const showPreview = () => {
		const drawing = spec !== null;
		const points = drawing && cursor ? [...pending, cursor.point] : pending;
		const built = drawing ? spec!.build(points, false) : null;
		layer.setPreview(
			drawing
				? {
						polylines: built
							? built.filter(isCurve).map((curve) => tessellate(curve))
							: points.length >= 2
								? [points]
								: [],
						points: pending
					}
				: null
		);
		layer.setCursor(mode ? cursor : null);

		const last = lastPoint();
		if (drawing && last && cursor && distance(last, cursor.point) > 0) {
			const length = formatLength(distance(last, cursor.point), unitSuffix);
			layer.setPreviewLabel({
				text: typed ? `${typed}\n${length}` : length,
				at: midpoint(last, cursor.point)
			});
		} else {
			layer.setPreviewLabel(null);
		}
	};

	const refresh = () => {
		if (disposed) return;
		showItems();
		showPreview();
		notify();
	};

	// ==========================================================================
	// Picking
	// ==========================================================================

	const resolve = (event: MouseEvent): PickedPoint | null => {
		const grab = grabbed;
		const snapTo = [
			...pending,
			...items.flatMap((item, i) =>
				verticesOf(item).filter((_, v) => !(grab && grab.item === i && grab.vertex === v))
			)
		];
		const moving = mode === MOVE;
		return picker.pick(event, {
			snapTo,
			last: moving ? (grab ? verticesOf(grab.original)[grab.vertex] : null) : lastPoint(),
			planar: settings.planar,
			gridStep: settings.gridStep,
			typed: moving ? null : parseTypedInput(typed)
		});
	};

	/** The vertex under the cursor, as the item and vertex it belongs to. */
	const vertexAt = (event: MouseEvent): Grab | null => {
		const refs = items.flatMap((item, i) =>
			verticesOf(item).map((point, vertex) => ({ point, item: i, vertex }))
		);
		const found =
			refs[
				picker.nearestPoint(
					event,
					refs.map((ref) => ref.point)
				)
			];
		return found ? { item: found.item, vertex: found.vertex, original: items[found.item] } : null;
	};

	// ==========================================================================
	// Building items
	// ==========================================================================

	/** Turns the placed points into items. False when the mode made none of them. */
	const commitPending = (closed = false): boolean => {
		const built = spec?.build(pending, closed)?.filter(isValidItem) ?? [];
		pending = [];
		typed = '';
		if (built.length === 0) return false;
		apply([...items, ...built.map(withId)].slice(-maxItems));
		if (items.length >= maxItems) leave();
		return true;
	};

	const samePoint = (a: Point3, b: Point3) => distance(a, b) === 0;

	const placePoint = (point: Point3) => {
		if (!spec) return;
		const last = lastPoint();
		// A second click on the last point ends the item: it is what a double-click sends.
		if (last && samePoint(point, last)) commitPending();
		else if (spec.closable && pending.length >= 3 && samePoint(point, pending[0])) {
			commitPending(true);
		} else {
			pending = [...pending, point];
			typed = '';
			if (pending.length === spec.pointCount) commitPending();
		}
		refresh();
	};

	const releaseGrab = (point: Point3) => {
		if (!grabbed) return;
		const { item, vertex, original } = grabbed;
		grabbed = null;
		const moved = withVertex(original, vertex, point);
		if (isValidItem(moved)) apply(items.map((it, i) => (i === item ? moved : it)));
	};

	const deleteGrabbed = () => {
		if (!grabbed) return;
		const { item, vertex, original } = grabbed;
		grabbed = null;
		const shorter = withoutVertex(original, vertex);
		apply(
			shorter && isValidItem(shorter)
				? items.map((it, i) => (i === item ? shorter : it))
				: items.filter((_, i) => i !== item)
		);
	};

	// ==========================================================================
	// Modes
	// ==========================================================================

	const onKeyDown = (event: KeyboardEvent) => {
		if (!mode || event.altKey) return;
		const target = event.target as HTMLElement | null;
		if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) {
			return;
		}
		const moving = mode === MOVE;
		const key = event.key.toLowerCase();
		let handled = true;

		if (event.ctrlKey || event.metaKey) {
			if (key === 'y' || (key === 'z' && event.shiftKey)) redo();
			// Undo takes back the last placed point first, then the last change.
			else if (key === 'z' && pending.length) pending = pending.slice(0, -1);
			else if (key === 'z') undo();
			else handled = false;
		} else if (event.key === 'Escape') {
			if (moving && grabbed) grabbed = null;
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
			refresh();
		}
	};

	// One pick per animation frame: only the latest move matters for the preview.
	let lastMove: MouseEvent | null = null;
	let moveFrame = 0;

	const enter = (next: string, nextSpec: DrawModeSpec | null) => {
		if (disposed) return;
		if (mode) leave();
		mode = next;
		spec = nextSpec;
		viewer.tools.setActive(toolId);
		window.addEventListener('keydown', onKeyDown, true);
		canvas.style.cursor = 'crosshair';
		refresh();
	};

	const leave = () => {
		if (!mode) return;
		mode = null;
		spec = null;
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
		refresh();
	};

	const pointerTool: PointerTool = {
		// Another tool taking over ends the mode; this tool never enables itself from here.
		setEnabled: (enabled) => {
			if (!enabled) leave();
		},
		isEnabled: () => mode !== null,
		handleClick: (event) => {
			if (!mode) return false;
			if (mode === MOVE && !grabbed) {
				grabbed = vertexAt(event);
				if (grabbed) {
					cursor = { point: verticesOf(grabbed.original)[grabbed.vertex], snapped: true };
				}
			} else {
				const resolved = resolve(event);
				if (resolved && mode === MOVE) releaseGrab(resolved.point);
				else if (resolved) placePoint(resolved.point);
			}
			refresh();
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
				if (grabbed) showItems();
				showPreview();
			});
		}
	};
	const unregister = viewer.tools.register({ id: toolId, tool: pointerTool, priority: 10 });

	return {
		getItems: () => items,
		setItems: (next) => {
			items = [...next];
			past = [];
			future = [];
			grabbed = null;
			refresh();
		},
		draw: (next) => {
			const nextSpec = typeof next === 'string' ? DRAW_MODES[next] : next;
			enter(nextSpec.id, nextSpec);
		},
		move: () => enter(MOVE, null),
		finish: () => {
			if (!mode) return;
			commitPending();
			leave();
		},
		cancel: () => leave(),
		undo,
		redo,
		getState,
		configure: (next) => {
			Object.assign(settings, next);
			refresh();
		},
		dispose: () => {
			if (disposed) return;
			leave();
			disposed = true;
			unregister();
			layer.dispose();
		}
	};
}
