// ============================================================================
// Selection: click / ctrl-click / shift-range over a flat list
// ============================================================================
//
// Standard file-explorer selection semantics. Range selection needs the *flattened, currently
// visible* order — what the user actually sees after search filtering and layer collapse — which
// only the caller knows, so it is passed in per click rather than derived here.

/** Modifier state of the click that drove the selection. */
export interface SelectionModifiers {
	shiftKey: boolean;
	/** Ctrl (Windows/Linux) or Meta (macOS) — the caller normalizes the platform difference. */
	toggleKey: boolean;
}

export interface SelectionState {
	readonly selected: Set<string>;
	/** The click that anchors the next shift-range. */
	readonly anchor: string | null;
	isSelected(uuid: string): boolean;
	/**
	 * Apply a click.
	 *
	 * @param flatOrder The uuids currently visible, in display order — the span a shift-range walks.
	 */
	select(uuid: string, modifiers: SelectionModifiers, flatOrder: () => string[]): void;
	clear(): void;
	/**
	 * Observe anchor moves. The anchor is a scalar, so unlike `selected` it cannot be watched by
	 * handing in an observable set — a host that renders it mirrors it through this instead.
	 *
	 * @returns An unsubscribe function.
	 */
	onAnchorChange(listener: (anchor: string | null) => void): () => void;
}

export function createSelectionState(selected: Set<string> = new Set()): SelectionState {
	let anchor: string | null = null;
	const anchorListeners = new Set<(anchor: string | null) => void>();

	const setAnchor = (next: string | null) => {
		anchor = next;
		for (const listener of anchorListeners) listener(next);
	};

	return {
		selected,
		get anchor() {
			return anchor;
		},

		isSelected: (uuid) => selected.has(uuid),

		select(uuid, modifiers, flatOrder) {
			if (modifiers.shiftKey && anchor) {
				const flat = flatOrder();
				const a = flat.indexOf(anchor);
				const b = flat.indexOf(uuid);
				if (a !== -1 && b !== -1) {
					const [lo, hi] = a < b ? [a, b] : [b, a];
					// Ctrl+Shift extends the selection; plain Shift replaces it.
					if (!modifiers.toggleKey) selected.clear();
					for (let i = lo; i <= hi; i++) selected.add(flat[i]);
				}
				// The anchor stays put, so dragging the shift-click around pivots on the same origin.
				return;
			}

			if (modifiers.toggleKey) {
				if (selected.has(uuid)) selected.delete(uuid);
				else selected.add(uuid);
			} else {
				selected.clear();
				selected.add(uuid);
			}
			setAnchor(uuid);
		},

		clear() {
			selected.clear();
			setAnchor(null);
		},

		onAnchorChange(listener) {
			anchorListeners.add(listener);
			return () => anchorListeners.delete(listener);
		}
	};
}
