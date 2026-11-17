import { untrack } from 'svelte';
import type { RhinoModule } from 'rhino3dm';
import type { ThreeViewer } from '@selvajs/visualization/render';
import { explodeToLines, type SketchCurve } from '@selvajs/sketch/model';
import { createSketchTool, type SketchState, type SketchTool } from '@selvajs/sketch/tool';
import type { SketchController } from '#lib/contexts/sketchContext.svelte.js';
import {
	curvesFromValue,
	valueFromCurves,
	valueNeedsRhino
} from '#lib/features/sketch/curve-values.js';
import { importCurveFile } from '#lib/features/sketch/import-file.js';
import { modelUnits } from '#lib/features/sketch/units.js';

// Owns the curves of every curve input for as long as the app is mounted, not for as long as an
// input's control is: a drawn curve stays in the viewer when its tab or group is closed.
//
// The session value is the one copy that solves. Curves are decoded from it when it changes
// underneath (a default, a loaded state) and encoded back into it after every edit.

export interface CurveInputRef {
	id: string;
	paramType: 'line' | 'geometry';
	/** The group's name in the scene outliner. */
	name: string;
	/** The most curves the param takes; absent when the schema doesn't say. */
	atMost?: number;
}

export interface SketchControllerDeps {
	inputs: () => readonly CurveInputRef[];
	getValue: (paramId: string) => unknown;
	setValue: (paramId: string, value: unknown) => void;
	/** The input's value in the definition, restored by `reset`. */
	getDefault: (paramId: string) => unknown;
	/** Rhino's name for the model's unit system, from a solve response; absent before the first. */
	modelUnits: () => string | null | undefined;
	/**
	 * Loads rhino3dm, which writes the format a Get Geometry reads. Without it only Get Line
	 * inputs work, and only DXF imports. Read once.
	 */
	loadRhino?: () => Promise<object>;
	/** rhino3dm could not be loaded, so a curve was not sent. */
	onEncodeError?: () => void;
}

const IDLE: SketchState = { mode: null, pendingPoints: 0, typed: '' };

class Entry {
	curves = $state.raw<readonly SketchCurve[]>([]);
	state = $state.raw<SketchState>(IDLE);
	tool: SketchTool | null = null;
	/** The session value the curves match. Any other value there was put by someone else. */
	synced: unknown = undefined;
	/** Bumped by every load and write, so a slower rhino3dm load cannot overwrite a newer one. */
	revision = 0;
}

/** Call during component initialisation: it registers effects. */
export function useSketchController(deps: SketchControllerDeps): SketchController {
	let viewer = $state.raw<ThreeViewer | null>(null);
	let gridStep = $state(0);
	let showDimensions = $state(true);
	// Two steps: every solve hands over a new result, and deriving the scale straight from it would
	// make a new object each time and rebuild the tools mid-drawing. The name only changes with the model.
	const unitName = $derived(deps.modelUnits());
	const units = $derived(modelUnits(unitName));

	// Nothing renders from the map itself: an entry's own fields are the reactive part.
	// eslint-disable-next-line svelte/prefer-svelte-reactivity
	const entries = new Map<string, Entry>();
	const entry = (id: string): Entry => {
		let found = entries.get(id);
		if (!found) entries.set(id, (found = new Entry()));
		return found;
	};
	const refOf = (id: string) => deps.inputs().find((input) => input.id === id);

	// One load for the page, retried after a failure.
	const hostLoader = deps.loadRhino;
	let rhino: Promise<RhinoModule> | null = null;
	const loadRhino = hostLoader
		? (): Promise<RhinoModule> => {
				rhino ??= hostLoader() as Promise<RhinoModule>;
				rhino.catch(() => {
					rhino = null;
				});
				return rhino;
			}
		: null;

	function write(input: CurveInputRef, target: Entry) {
		const revision = ++target.revision;
		const commit = (value: unknown) => {
			if (target.revision !== revision) return;
			target.synced = value;
			deps.setValue(input.id, value);
		};
		if (input.paramType === 'line' || target.curves.length === 0) {
			commit(valueFromCurves(target.curves, input.paramType, null));
			return;
		}
		if (!loadRhino) return;
		loadRhino().then(
			(rhino) => commit(valueFromCurves(target.curves, input.paramType, rhino)),
			() => deps.onEncodeError?.()
		);
	}

	function load(target: Entry, value: unknown) {
		target.synced = value;
		const revision = ++target.revision;
		const apply = (curves: SketchCurve[]) => {
			if (target.revision !== revision) return;
			target.curves = curves;
			target.tool?.setCurves(curves);
		};
		if (!loadRhino || !valueNeedsRhino(value)) {
			apply(curvesFromValue(value, null));
			return;
		}
		loadRhino().then(
			(rhino) => apply(curvesFromValue(value, rhino)),
			() => apply([])
		);
	}

	function disposeTools() {
		for (const target of entries.values()) {
			target.tool?.dispose();
			target.tool = null;
			target.state = IDLE;
		}
	}

	function buildTools() {
		disposeTools();
		if (!viewer || !units) return;
		for (const input of deps.inputs()) {
			const target = entry(input.id);
			target.tool = createSketchTool({
				viewer,
				id: input.id,
				metersPerUnit: units.metersPerUnit,
				unitSuffix: units.suffix,
				name: input.name,
				maxCurves: input.atMost,
				settings: { gridStep, showDimensions },
				onChange: (curves) => {
					target.curves = curves;
					write(input, target);
				},
				onStateChange: (state) => {
					target.state = state;
				}
			});
			target.tool.setCurves(target.curves);
		}
	}

	// Tools depend on the unit scale and the input list. The viewer is handled in `attachViewer`
	// instead: it must be let go of before it disposes, and an effect would run after.
	// Untracked, or every edit and setting change would rebuild the tools mid-drawing.
	$effect(() => {
		void units;
		void deps.inputs();
		untrack(buildTools);
		return disposeTools;
	});

	$effect(() => {
		const settings = { gridStep, showDimensions };
		for (const target of entries.values()) target.tool?.configure(settings);
	});

	$effect(() => {
		for (const input of deps.inputs()) {
			const target = entry(input.id);
			const value = deps.getValue(input.id);
			if (value !== target.synced) untrack(() => load(target, value));
		}
	});

	return {
		get canDraw() {
			return viewer !== null && units !== null;
		},
		get canImport() {
			return units !== null;
		},
		get unitSuffix() {
			return units?.suffix ?? '';
		},
		get gridStep() {
			return gridStep;
		},
		set gridStep(value) {
			gridStep = Number.isFinite(value) && value > 0 ? value : 0;
		},
		get showDimensions() {
			return showDimensions;
		},
		set showDimensions(value) {
			showDimensions = value;
		},
		get importAccept() {
			return loadRhino ? '.dxf,.3dm' : '.dxf';
		},
		supports: (paramId) => {
			const paramType = refOf(paramId)?.paramType;
			return paramType === 'line' || (paramType === 'geometry' && loadRhino !== null);
		},
		view: (paramId) => entry(paramId),
		draw: (paramId, mode) => {
			// Fetched while the user draws, so the first curve doesn't wait for it.
			if (refOf(paramId)?.paramType === 'geometry') loadRhino?.().catch(() => {});
			entry(paramId).tool?.draw(mode);
		},
		move: (paramId) => entry(paramId).tool?.move(),
		finish: (paramId) => entry(paramId).tool?.finish(),
		reset: (paramId) => {
			entry(paramId).tool?.cancel();
			deps.setValue(paramId, deps.getDefault(paramId) ?? null);
		},
		importFile: async (paramId, file) => {
			const input = refOf(paramId);
			if (!input || !units) throw new Error('Curve input is not ready for an import.');
			const imported = await importCurveFile(file, units.metersPerUnit, loadRhino);
			const target = entry(paramId);
			target.tool?.cancel();
			// A line input can only send straight lines, so that is what it shows.
			const curves = input.paramType === 'line' ? explodeToLines(imported.curves) : imported.curves;
			target.curves = curves.slice(0, input.atMost);
			target.tool?.setCurves(target.curves);
			write(input, target);
			return {
				curves: [...target.curves],
				skipped: imported.skipped,
				overLimit: curves.length - target.curves.length
			};
		},
		attachViewer: (next) => {
			viewer = next;
			buildTools();
			return () => {
				if (viewer !== next) return;
				disposeTools();
				viewer = null;
			};
		}
	};
}
