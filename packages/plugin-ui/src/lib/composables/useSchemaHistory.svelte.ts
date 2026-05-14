import type { UISchema } from '@selvajs/schemas';

/**
 * In-memory undo/redo stack for the builder draft.
 *
 * Drafts are NOT persisted across sessions. The server-side `_embeddedSchema`
 * (mirrored into the `.gh` archive on save) is the source of truth for layout;
 * an in-flight draft only lives for the lifetime of the tab. The earlier LS-
 * backed restore prompt was removed because in practice it fired for stale
 * post-save drafts more often than for genuine crash recovery, and the prompt
 * couldn't show users what actually differed.
 *
 * Snapshots are cleared on every canonical replacement — they're not safe to
 * replay onto a different canonical, so we drop them rather than try to rebase.
 */
export function useSchemaHistory() {
	const past: UISchema[] = $state([]);
	const future: UISchema[] = $state([]);
	const MAX_HISTORY = 50;

	function clone(schema: UISchema): UISchema {
		return typeof structuredClone === 'function'
			? (structuredClone(schema) as UISchema)
			: (JSON.parse(JSON.stringify(schema)) as UISchema);
	}

	function push(schema: UISchema) {
		past.push(clone(schema));
		if (past.length > MAX_HISTORY) past.shift();
		future.length = 0;
	}

	function undo(current: UISchema): UISchema | null {
		if (past.length === 0) return null;
		future.unshift(current);
		const prev = past.pop()!;
		return prev;
	}

	function redo(current: UISchema): UISchema | null {
		if (future.length === 0) return null;
		past.push(current);
		const next = future.shift()!;
		return next;
	}

	function clearHistory() {
		past.length = 0;
		future.length = 0;
	}

	return {
		push,
		undo,
		redo,
		canUndo: () => past.length > 0,
		canRedo: () => future.length > 0,
		clearHistory
	};
}
