import * as THREE from 'three';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';
import { LineSegments2 } from 'three/addons/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'three/addons/lines/LineSegmentsGeometry.js';
import type { LabelHandle, ThreeViewer } from '@selvajs/visualization/render';

import type { Point3, SketchCurve } from '../model/curve.js';
import { tessellate } from '../model/nurbs.js';

// ============================================================================
// Curves in the viewer: the output half of a drawing tool
// ============================================================================
//
// Draws curves, grab points, a preview and labels as host-owned scene content, so they survive
// solves. It takes no input: a tool decides what to show and calls in.
//
// Curves are in model units and the scene in metres; `metersPerUnit` is the only bridge, and the
// axes are the same on both sides.

export interface LayerLabel {
	text: string;
	/** Model units. */
	at: Point3;
	/**
	 * Makes the label a field on click, opened on `editText` (default `text`). Called with what
	 * the user entered on Enter; Escape or a click elsewhere drops the edit.
	 */
	onEdit?: (text: string) => void;
	editText?: string;
}

export interface CurveLayerOptions {
	viewer: ThreeViewer;
	/** Scopes the scene content: unique per layer. */
	id: string;
	/** Scene metres per model unit. */
	metersPerUnit: number;
	/** The group's name in the scene outliner. */
	name?: string;
	color?: THREE.ColorRepresentation;
	/** A colour per curve, such as by role; undefined falls back to `color`. */
	colorOf?: (curve: SketchCurve) => THREE.ColorRepresentation | undefined;
}

export interface CurveLayer {
	/** The curves to show, and the points to mark on them as grabbable. */
	setCurves(curves: readonly SketchCurve[], vertices?: readonly Point3[]): void;
	/** What is being drawn: a line through each polyline and a dot on each point. Null clears it. */
	setPreview(
		preview: { polylines: readonly (readonly Point3[])[]; points: readonly Point3[] } | null
	): void;
	/** The cursor's marker, larger when it sits on a snap. */
	setCursor(cursor: { point: Point3; snapped: boolean } | null): void;
	/** Replaces every label. Held back while one is being edited, and applied when the edit ends. */
	setLabels(labels: readonly LayerLabel[]): void;
	/** One label that follows the curve being drawn; never editable. */
	setPreviewLabel(label: { text: string; at: Point3 } | null): void;
	toScene(point: Point3): THREE.Vector3;
	fromScene(point: THREE.Vector3): Point3;
	dispose(): void;
}

const DEFAULT_COLOR = 0x1d6ff2;
// Above solve geometry and the measure tool's own overlay, so a sketch is never hidden by it.
const RENDER_ORDER_LINE = 1010;
const RENDER_ORDER_POINT = 1011;
const RENDER_ORDER_CURSOR = 1012;

export function createCurveLayer(options: CurveLayerOptions): CurveLayer {
	const { viewer, metersPerUnit, colorOf } = options;
	const sourceId = `sketch:${options.id}`;
	const color = new THREE.Color(options.color ?? DEFAULT_COLOR);
	let disposed = false;

	const toScene = (p: Point3) =>
		new THREE.Vector3(p[0] * metersPerUnit, p[1] * metersPerUnit, p[2] * metersPerUnit);
	const fromScene = (v: THREE.Vector3): Point3 => [
		v.x / metersPerUnit,
		v.y / metersPerUnit,
		v.z / metersPerUnit
	];

	// ==========================================================================
	// Scene objects
	// ==========================================================================

	const root = new THREE.Group();
	root.name = options.name ?? 'Sketch';
	root.userData.id = sourceId;

	const tag = <T extends THREE.Object3D>(object: T, renderOrder: number): T => {
		object.renderOrder = renderOrder;
		object.raycast = () => {}; // own geometry is snapped to by vertex, never ray-picked
		object.frustumCulled = false; // geometry is swapped on every edit; a stale sphere would cull
		return object;
	};

	// depthTest off throughout: a sketch stays visible through the model it is drawn against.
	const makeLines = (opacity: number, perCurveColor: boolean): LineSegments2 => {
		const material = new LineMaterial({
			// Vertex colours multiply the material's, so it has to be white under them.
			color: perCurveColor ? 0xffffff : color,
			linewidth: 2.5,
			transparent: opacity < 1,
			opacity,
			vertexColors: perCurveColor
		});
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

	const curveLines = makeLines(1, colorOf !== undefined);
	const curvePoints = makePoints(7);
	const previewLines = makeLines(0.65, false);
	const previewPoints = makePoints(7);
	const cursorSnapped = makePoints(12, 1, RENDER_ORDER_CURSOR);
	const cursorFree = makePoints(7, 0.6, RENDER_ORDER_CURSOR);

	// An object with nothing to draw leaves the scene, and the group goes with its last one: an
	// empty one would still count for fit-to-view and show as an empty row in the outliner. So a
	// layer nobody has drawn into adds nothing to the viewer.
	const show = (object: THREE.Object3D) => {
		root.add(object);
		if (!root.parent) viewer.addUserGeometry(root, sourceId);
	};
	const hide = (object: THREE.Object3D) => {
		object.removeFromParent();
		if (root.children.length === 0) root.removeFromParent();
	};

	const setLines = (
		lines: LineSegments2,
		polylines: readonly (readonly Point3[])[],
		colors?: readonly THREE.Color[]
	) => {
		const positions: number[] = [];
		const vertexColors: number[] = [];
		polylines.forEach((polyline, p) => {
			for (let i = 1; i < polyline.length; i++) {
				const a = toScene(polyline[i - 1]);
				const b = toScene(polyline[i]);
				positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
				const c = colors?.[p];
				if (c) vertexColors.push(c.r, c.g, c.b, c.r, c.g, c.b);
			}
		});
		lines.geometry.dispose();
		lines.geometry = new LineSegmentsGeometry();
		if (positions.length === 0) {
			hide(lines);
			return;
		}
		lines.geometry.setPositions(positions);
		if (colors) lines.geometry.setColors(vertexColors);
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
	// Labels
	// ==========================================================================

	let shown: LabelHandle[] = [];
	let wanted: readonly LayerLabel[] = [];
	let previewLabel: LabelHandle | null = null;
	let editing = false;

	const renderLabels = () => {
		// Removing a label that holds the edit field blurs it in Chrome, and the blur closes the edit
		// and calls back here. After dispose, labels drawn now would never be removed.
		if (disposed) return;
		shown.forEach((label) => label.remove());
		shown = wanted.map((label) => {
			const handle = viewer.labelLayer.addLabel(label.text, toScene(label.at));
			const { onEdit } = label;
			if (onEdit) {
				const element = handle.object.element as HTMLElement;
				// The label overlay passes pointer events through; an editable label takes them back.
				element.style.pointerEvents = 'auto';
				element.style.cursor = 'text';
				element.addEventListener('click', (event) => {
					event.stopPropagation();
					if (!editing) edit(element, label.editText ?? label.text, onEdit);
				});
			}
			return handle;
		});
	};

	const edit = (element: HTMLElement, text: string, onEdit: (text: string) => void) => {
		editing = true;
		const input = document.createElement('input');
		input.type = 'text';
		input.inputMode = 'decimal';
		input.value = text;
		Object.assign(input.style, {
			width: `${Math.max(5, text.length + 2)}ch`,
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
			if (!editing) return;
			editing = false;
			if (commit) onEdit(input.value);
			// `onEdit` usually replaces the labels; when it did not, this puts the text back.
			renderLabels();
			viewer.invalidate();
		};
		input.addEventListener('keydown', (event) => {
			// The viewer and the page bind keys of their own; none of them apply while typing here.
			event.stopPropagation();
			if (event.key === 'Enter') close(true);
			else if (event.key === 'Escape') close(false);
		});
		input.addEventListener('blur', () => close(false));
	};

	return {
		setCurves: (curves, vertices = []) => {
			if (disposed) return;
			setLines(
				curveLines,
				curves.map((curve) => tessellate(curve)),
				colorOf && curves.map((curve) => new THREE.Color(colorOf(curve) ?? color))
			);
			setPoints(curvePoints, vertices);
			viewer.invalidate();
		},
		setPreview: (preview) => {
			if (disposed) return;
			setLines(previewLines, preview?.polylines ?? []);
			setPoints(previewPoints, preview?.points ?? []);
			viewer.invalidate();
		},
		setCursor: (cursor) => {
			if (disposed) return;
			setPoints(cursorSnapped, cursor?.snapped ? [cursor.point] : []);
			setPoints(cursorFree, cursor && !cursor.snapped ? [cursor.point] : []);
			viewer.invalidate();
		},
		setLabels: (labels) => {
			if (disposed) return;
			wanted = labels;
			if (!editing) renderLabels();
		},
		setPreviewLabel: (label) => {
			if (disposed) return;
			if (!label) {
				previewLabel?.remove();
				previewLabel = null;
			} else if (previewLabel) {
				previewLabel.setText(label.text);
				previewLabel.setPosition(toScene(label.at));
			} else {
				previewLabel = viewer.labelLayer.addLabel(label.text, toScene(label.at));
			}
		},
		toScene,
		fromScene,
		dispose: () => {
			if (disposed) return;
			disposed = true;
			shown.forEach((label) => label.remove());
			previewLabel?.remove();
			// Detached objects are not reached by the root's disposal.
			for (const object of [
				curveLines,
				curvePoints,
				previewLines,
				previewPoints,
				cursorSnapped,
				cursorFree
			]) {
				object.removeFromParent();
				object.geometry.dispose();
				(object.material as THREE.Material).dispose();
			}
			viewer.removeUserGeometry(root);
		}
	};
}
