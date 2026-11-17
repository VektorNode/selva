import { getContext, setContext } from 'svelte';
import type { ThreeViewer } from '@selvajs/visualization/render';
import type { SketchItem } from '@selvajs/sketch/model';
import type { DrawMode, DrawModeSpec, SketchState } from '@selvajs/sketch/tool';
import type { SketchImport } from '#lib/features/sketch/sketch-import.js';
import type { DrawableKind } from '#lib/schema/host-support.js';

// The drawn inputs of one ComputeApp: what the form's own control uses, and the handle a host
// gets from `onReady` (`getSketch`) or, inside the app, from `getSketchContext`.

/** One input's items and what its tool is doing. Reactive: read it in markup or an effect. */
export interface SketchInputView {
	readonly items: readonly SketchItem[];
	readonly state: SketchState;
}

export interface SketchController {
	/** A viewer is up and the model's units are known, so items can be drawn into it. */
	readonly canDraw: boolean;
	/** The model's units are known, so a file can be scaled into them. */
	readonly canImport: boolean;
	/** After every length, such as `mm`; empty until the units are known. */
	readonly unitSuffix: string;
	/** What the file picker offers: 3DM only where the host can load rhino3dm. */
	readonly importAccept: string;
	/** Model units between grid snaps; 0 is off. */
	gridStep: number;
	showDimensions: boolean;

	/**
	 * False for an input nothing can be drawn into here: one that is no drawn input, or a Get
	 * Geometry on a host that gave no rhino3dm loader.
	 */
	supports(paramId: string): boolean;
	/** What the input takes: `line`, `curve` (lines, polylines and free curves), `point`. */
	kinds(paramId: string): readonly DrawableKind[];
	view(paramId: string): SketchInputView;

	getItems(paramId: string): readonly SketchItem[];
	/**
	 * Replaces the input's items and solves with them, as a host's own tool or importer would.
	 * Items keep their `path` (the Grasshopper branch) and `attributes`. Clears the undo history.
	 */
	setItems(paramId: string, items: readonly SketchItem[]): void;

	/** Starts drawing in the viewer: a built-in mode, or the host's own. */
	draw(paramId: string, mode: DrawMode | DrawModeSpec): void;
	move(paramId: string): void;
	finish(paramId: string): void;
	undo(paramId: string): void;
	redo(paramId: string): void;
	/** Back to the definition's own value. */
	reset(paramId: string): void;
	/**
	 * Replaces the input's items with the file's. `overLimit` counts what was left out because the
	 * input takes fewer. @throws {SketchImportError}
	 */
	importFile(paramId: string, file: File): Promise<SketchImport & { overLimit: number }>;

	/** Returns the detach function; call it before the viewer disposes. */
	attachViewer(viewer: ThreeViewer): () => void;
}

const SKETCH_CONTEXT_KEY = Symbol('sketch-context');

export function setSketchContext(controller: SketchController): void {
	setContext(SKETCH_CONTEXT_KEY, controller);
}

/** Absent outside a `ComputeApp`: the plugin's preview picks geometry in Rhino instead. */
export function getSketchContext(): SketchController | undefined {
	return getContext<SketchController | undefined>(SKETCH_CONTEXT_KEY);
}
