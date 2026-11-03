import { SvelteSet } from 'svelte/reactivity';

// Shift-click collects rows. A selection is either sidebar parameters or placed canvas items,
// never both: the two take different actions (add vs move).
const params = new SvelteSet<string>();
const placed = new SvelteSet<string>();

export type DragKind = 'param' | 'placed';

/** A group on another tab, picked from the tab's drop list. `groupId: null` means a new group. */
export interface TabDropTarget {
	tabId: string;
	groupId: string | null;
}

type TabDropHandler = (target: TabDropTarget, draggedId: string, kind: DragKind) => void;

let dragging = $state(false);
// Rows travelling with the current drag, 0 when no selection is being dragged. The library only
// carries the grabbed row, so the rest of the selection is drawn as riding along.
let carried = $state(0);
let tabDrop = $state<TabDropTarget | null>(null);
let tabDropHandler: TabDropHandler | null = null;

function toggle(set: SvelteSet<string>, other: SvelteSet<string>, id: string) {
	other.clear();
	if (!set.delete(id)) set.add(id);
	// A range left over from before Shift was held would still read as selected text.
	window.getSelection()?.removeAllRanges();
}

const INTERACTIVE = 'button, input, select, textarea, a, [contenteditable]';

/**
 * Shift-mousedown extends the browser's text selection from the last click, painting every label
 * in between. Cancelling the default stops that; the drag library listens on its own handler and
 * still starts drags. Fields keep their own shift-click.
 */
export function preventShiftTextSelect(e: MouseEvent) {
	if (e.shiftKey && !(e.target as HTMLElement).closest(INTERACTIVE)) e.preventDefault();
}

/** How many rows a drag of `id` moves: the whole selection if `id` is in it, else 1. */
function dragSize(id: string): number {
	if (params.has(id)) return params.size;
	if (placed.has(id)) return placed.size;
	return 1;
}

function pruneTo(set: SvelteSet<string>, keep: (id: string) => boolean) {
	for (const id of set) if (!keep(id)) set.delete(id);
}

export const builderSelection = {
	/** Ids of discovered parameters picked in the sidebar. */
	params,
	/** Ids of layout items picked on the canvas. */
	placed,
	toggleParam: (id: string) => toggle(params, placed, id),
	togglePlaced: (id: string) => toggle(placed, params, id),
	clear() {
		params.clear();
		placed.clear();
		carried = 0;
	},
	get count() {
		return params.size + placed.size;
	},

	dragSize,
	/** True while any parameter or placed card is being dragged. */
	get dragging() {
		return dragging;
	},
	get carried() {
		return carried;
	},
	startDrag(id: string) {
		dragging = true;
		const size = dragSize(id);
		carried = size > 1 ? size : 0;
	},
	endDrag() {
		dragging = false;
		carried = 0;
	},

	// The canvas only renders the active tab, and the drag library only watches zones that existed
	// when the drag began, so switching tabs mid-drag can't land a drop. Instead the tab nav lists
	// another tab's groups and records the one under the pointer here; on release the zone the
	// drag started in hands it to the page, and every other zone ignores the drop.
	get tabDrop() {
		return tabDrop;
	},
	setTabDrop(target: TabDropTarget | null) {
		if (tabDrop?.tabId === target?.tabId && tabDrop?.groupId === target?.groupId) return;
		tabDrop = target;
	},
	setTabDropHandler(handler: TabDropHandler | null) {
		tabDropHandler = handler;
	},
	/** Called by the drag's origin zone on release. True when the drop went to another tab. */
	commitTabDrop(draggedId: string, kind: DragKind): boolean {
		const target = tabDrop;
		tabDrop = null;
		if (!target || !tabDropHandler) return false;
		tabDropHandler(target, draggedId, kind);
		return true;
	},

	/** Drops ids whose rows no longer exist, so the count never includes something you can't see. */
	prune(isParamSelectable: (id: string) => boolean, isPlacedItem: (id: string) => boolean) {
		pruneTo(params, isParamSelectable);
		pruneTo(placed, isPlacedItem);
	}
};
