// ============================================================================
// Pointer tools: who gets the click first
// ============================================================================
//
// A pointer tool claims canvas input ahead of object selection — measuring a distance or placing
// a vertex must not also select the mesh under the cursor. The registry owns the ordering and the
// single-active rule; `initThree` owns the DOM listeners and forwards to it.

/**
 * A tool that can claim canvas pointer input.
 *
 * `handleClick` returning true means the tool consumed the event and the host stops dispatching —
 * no further tool sees it, and object selection doesn't run. `handleMove` never consumes: it runs
 * on every move regardless of which tool is active, so previews can't block orbit or pan.
 */
export interface PointerTool {
	setEnabled?(enabled: boolean): void;
	isEnabled?(): boolean;
	/** Returns true if this tool consumed the click. */
	handleClick(event: MouseEvent): boolean;
	/** Preview only — must not consume. */
	handleMove?(event: MouseEvent): void;
	clear?(): void;
	dispose?(): void;
}

export interface ToolRegistration {
	/** Unique within the registry; registering the same id twice replaces the earlier tool. */
	id: string;
	tool: PointerTool;
	/**
	 * Higher runs first. The built-ins sit at 0 (measure) and -100 (gizmo); register above 0 to
	 * claim clicks before measuring, below -100 to act only as a fallback.
	 */
	priority?: number;
}

export interface ToolRegistry {
	/** Returns an unregister function. Does not dispose the tool — the registrant still owns it. */
	register(registration: ToolRegistration): () => void;
	unregister(id: string): void;
	get(id: string): PointerTool | null;
	/**
	 * Enables one tool and disables every other registered one. Pass null to disable all.
	 * Tools without `setEnabled` are always live and unaffected.
	 */
	setActive(id: string | null): void;
	/** The id passed to the last `setActive`, or null. */
	getActive(): string | null;
	/** @internal — `initThree` forwards DOM events here. */
	handleClick(event: MouseEvent): boolean;
	/** @internal */
	handleMove(event: MouseEvent): void;
}

export function createToolRegistry(): ToolRegistry {
	const entries: Required<ToolRegistration>[] = [];
	let activeId: string | null = null;

	// Descending priority, and registration order breaks ties — sort() is stable, so a tool
	// registered later never jumps ahead of an equal-priority one already there.
	const sort = () => entries.sort((a, b) => b.priority - a.priority);

	const indexOf = (id: string) => entries.findIndex((entry) => entry.id === id);

	const unregister = (id: string) => {
		const index = indexOf(id);
		if (index === -1) return;
		entries.splice(index, 1);
		if (activeId === id) activeId = null;
	};

	const register = ({ id, tool, priority = 0 }: ToolRegistration) => {
		unregister(id);
		entries.push({ id, tool, priority });
		sort();
		return () => unregister(id);
	};

	const setActive = (id: string | null) => {
		activeId = id;
		for (const entry of entries) {
			entry.tool.setEnabled?.(entry.id === id);
		}
	};

	return {
		register,
		unregister,
		get: (id) => entries[indexOf(id)]?.tool ?? null,
		setActive,
		getActive: () => activeId,
		handleClick: (event) => {
			// Snapshot: a tool's handler may register or unregister during dispatch.
			for (const entry of [...entries]) {
				if (entry.tool.handleClick(event)) return true;
			}
			return false;
		},
		handleMove: (event) => {
			for (const entry of [...entries]) {
				entry.tool.handleMove?.(event);
			}
		}
	};
}

/**
 * Screen-space ray from a canvas mouse event, for tools doing their own picking. Handles the
 * canvas's position and size, so it stays correct under CSS scaling and in fullscreen.
 */
export function pointerToNdc(
	event: MouseEvent,
	canvas: HTMLCanvasElement
): { x: number; y: number } {
	const rect = canvas.getBoundingClientRect();
	return {
		x: ((event.clientX - rect.left) / rect.width) * 2 - 1,
		y: -((event.clientY - rect.top) / rect.height) * 2 + 1
	};
}
