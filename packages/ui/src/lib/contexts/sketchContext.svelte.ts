import { getContext, setContext } from 'svelte';
import type { ThreeViewer } from '@selvajs/visualization/render';
import type { SketchCurve } from '@selvajs/sketch/model';
import type { DrawMode, SketchState } from '@selvajs/sketch/tool';
import type { CurveImport } from '#lib/features/sketch/curve-import.js';

// Reaches CurveInput deep in the form.

/** One input's curves and what its tool is doing, for its control to render. */
export interface SketchInputView {
	readonly curves: readonly SketchCurve[];
	readonly state: SketchState;
}

export interface SketchController {
	/** A viewer is up and the model's units are known, so curves can be drawn into it. */
	readonly canDraw: boolean;
	/** The model's units are known, so a file can be scaled into them. */
	readonly canImport: boolean;
	/** After every length, such as `mm`; empty until the units are known. */
	readonly unitSuffix: string;
	/** Model units between grid snaps; 0 is off. */
	gridStep: number;
	showDimensions: boolean;
	/** What the file picker offers: 3DM only where the host can load rhino3dm. */
	readonly importAccept: string;
	/** False for a Get Geometry input on a host with no rhino3dm loader: nothing could encode it. */
	supports(paramId: string): boolean;
	view(paramId: string): SketchInputView;
	draw(paramId: string, mode: DrawMode): void;
	move(paramId: string): void;
	finish(paramId: string): void;
	/** Back to the definition's own value. */
	reset(paramId: string): void;
	/**
	 * Replaces the input's curves with the file's. `overLimit` counts the curves left out because
	 * the input takes fewer. @throws {CurveImportError}
	 */
	importFile(paramId: string, file: File): Promise<CurveImport & { overLimit: number }>;
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
