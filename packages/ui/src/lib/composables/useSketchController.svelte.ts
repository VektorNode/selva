import { untrack } from 'svelte';
import type { RhinoModule } from 'rhino3dm';
import type { ThreeViewer } from '@selvajs/visualization/render';
import { explodeToLines, isCurve, isPoint, type SketchItem } from '@selvajs/sketch/model';
import { createSketchTool, type SketchState, type SketchTool } from '@selvajs/sketch/tool';
import type { SketchController } from '#lib/contexts/sketchContext.svelte.js';
import { importSketchFile } from '#lib/features/sketch/import-file.js';
import {
	itemsFromValue,
	valueFromItems,
	valueNeedsRhino,
	type SketchParamType
} from '#lib/features/sketch/item-values.js';
import { modelUnits } from '#lib/features/sketch/units.js';
import type { DrawableKind } from '#lib/schema/host-support.js';

// Owns the items of every drawn input for as long as the app is mounted, not for as long as an
// input's control is: a drawn curve stays in the viewer when its tab or group is closed.
//
// The session value is the one copy that solves. Items are decoded from it when it changes
// underneath (a default, a loaded state) and encoded back into it after every edit.

export interface SketchInputRef {
	id: string;
	paramType: SketchParamType;
	/** What the input takes; see `drawableKinds`. */
	kinds: readonly DrawableKind[];
	/** The group's name in the scene outliner. */
	name: string;
	/** The most items the param takes; absent when the schema doesn't say. */
	atMost?: number;
}

export interface SketchControllerDeps {
	inputs: () => readonly SketchInputRef[];
	getValue: (paramId: string) => unknown;
	setValue: (paramId: string, value: unknown) => void;
	/** The input's value in the definition, restored by `reset`. */
	getDefault: (paramId: string) => unknown;
	/** Rhino's name for the model's unit system, from a solve response; absent before the first. */
	modelUnits: () => string | null | undefined;
	/**
	 * Loads rhino3dm, which writes the format a Get Geometry reads. Without it only Get Line and
	 * Get Point inputs work, and only DXF imports. Read once.
	 */
	loadRhino?: () => Promise<object>;
	/** rhino3dm could not be loaded, so the items were not sent. */
	onEncodeError?: () => void;
}

const IDLE: SketchState = {
	mode: null,
	pendingPoints: 0,
	typed: '',
	canUndo: false,
	canRedo: false
};

class Entry {
	items = $state.raw<readonly SketchItem[]>([]);
	state = $state.raw<SketchState>(IDLE);
	tool: SketchTool | null = null;
	/** The session value the items match. Any other value there was put by someone else. */
	synced: unknown = undefined;
	/** Bumped by every load and write, so a slower rhino3dm load cannot overwrite a newer one. */
	revision = 0;
}

/** What an input takes out of a list: a file or a host may hold more kinds than it does. */
function taken(items: readonly SketchItem[], input: SketchInputRef): SketchItem[] {
	if (input.paramType === 'line') return explodeToLines(items);
	return items.filter(
		(item) =>
			(isPoint(item) && input.kinds.includes('point')) ||
			(isCurve(item) && input.kinds.includes('curve'))
	);
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

	function write(input: SketchInputRef, target: Entry) {
		const revision = ++target.revision;
		const commit = (value: unknown) => {
			if (target.revision !== revision) return;
			target.synced = value;
			deps.setValue(input.id, value);
		};
		if (input.paramType !== 'geometry' || target.items.length === 0) {
			commit(valueFromItems(target.items, input.paramType, null));
			return;
		}
		if (!loadRhino) return;
		loadRhino().then(
			(module) => commit(valueFromItems(target.items, input.paramType, module)),
			() => deps.onEncodeError?.()
		);
	}

	function load(target: Entry, value: unknown) {
		target.synced = value;
		const revision = ++target.revision;
		const apply = (items: SketchItem[]) => {
			if (target.revision !== revision) return;
			target.items = items;
			target.tool?.setItems(items);
		};
		if (!loadRhino || !valueNeedsRhino(value)) {
			apply(itemsFromValue(value, null));
			return;
		}
		loadRhino().then(
			(module) => apply(itemsFromValue(value, module)),
			() => apply([])
		);
	}

	function replace(input: SketchInputRef, items: readonly SketchItem[]) {
		const target = entry(input.id);
		target.tool?.cancel();
		target.items = items;
		target.tool?.setItems(items);
		write(input, target);
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
				maxItems: input.atMost,
				settings: { gridStep, showDimensions },
				onChange: (items) => {
					target.items = items;
					write(input, target);
				},
				onStateChange: (state) => {
					target.state = state;
				}
			});
			target.tool.setItems(target.items);
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

	const supports = (paramId: string) => {
		const input = refOf(paramId);
		if (!input || input.kinds.length === 0) return false;
		return input.paramType !== 'geometry' || loadRhino !== null;
	};

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
		get importAccept() {
			return loadRhino ? '.dxf,.3dm' : '.dxf';
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
		supports,
		kinds: (paramId) => refOf(paramId)?.kinds ?? [],
		view: (paramId) => entry(paramId),
		getItems: (paramId) => entry(paramId).items,
		setItems: (paramId, items) => {
			const input = refOf(paramId);
			if (input && supports(paramId)) replace(input, taken(items, input).slice(0, input.atMost));
		},
		draw: (paramId, mode) => {
			// Fetched while the user draws, so the first item doesn't wait for it.
			if (refOf(paramId)?.paramType === 'geometry') loadRhino?.().catch(() => {});
			entry(paramId).tool?.draw(mode);
		},
		move: (paramId) => entry(paramId).tool?.move(),
		finish: (paramId) => entry(paramId).tool?.finish(),
		undo: (paramId) => entry(paramId).tool?.undo(),
		redo: (paramId) => entry(paramId).tool?.redo(),
		reset: (paramId) => {
			entry(paramId).tool?.cancel();
			deps.setValue(paramId, deps.getDefault(paramId) ?? null);
		},
		importFile: async (paramId, file) => {
			const input = refOf(paramId);
			if (!input || !units) throw new Error('The input is not ready for an import.');
			const imported = await importSketchFile(file, units.metersPerUnit, loadRhino);
			const fitting = taken(imported.items, input);
			const kept = fitting.slice(0, input.atMost);
			replace(input, kept);
			return {
				items: [...kept],
				// A line input turns one polyline into several lines, so only whole objects count.
				skipped:
					imported.skipped +
					(input.paramType === 'line' ? 0 : imported.items.length - fitting.length),
				overLimit: fitting.length - kept.length
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
