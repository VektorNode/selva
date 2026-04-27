import type { UISchema } from '@selvajs/schemas';

const LS_HISTORY_PREFIX = 'selva-schema-history:';
const LS_CURRENT_PREFIX = 'selva-schema-current:';

function purgeStaleSessions(keepSessionId: string) {
	try {
		const stale: string[] = [];
		for (let i = 0; i < localStorage.length; i++) {
			const key = localStorage.key(i);
			if (!key) continue;
			if (key === `${LS_HISTORY_PREFIX}${keepSessionId}`) continue;
			if (key === `${LS_CURRENT_PREFIX}${keepSessionId}`) continue;
			if (key.startsWith(LS_HISTORY_PREFIX) || key.startsWith(LS_CURRENT_PREFIX)) {
				stale.push(key);
			}
		}
		for (const key of stale) localStorage.removeItem(key);
	} catch {
		// Silently ignore (e.g. localStorage unavailable)
	}
}

export function useSchemaHistory(sessionId: string) {
	const past: UISchema[] = $state([]);
	const future: UISchema[] = $state([]);
	const MAX_HISTORY = 50;
	const LS_KEY = `${LS_HISTORY_PREFIX}${sessionId}`;
	const LS_CURRENT_KEY = `${LS_CURRENT_PREFIX}${sessionId}`;

	// Drop entries from any other session so localStorage doesn't accumulate
	// one pair of keys per definition ever opened.
	if (typeof localStorage !== 'undefined') purgeStaleSessions(sessionId);

	function push(schema: UISchema) {
		// Deep clone using JSON round-trip for compatibility
		past.push(JSON.parse(JSON.stringify(schema)));
		if (past.length > MAX_HISTORY) past.shift();
		future.length = 0; // Clear redo stack on new action
		persistToStorage();
	}

	function undo(current: UISchema): UISchema | null {
		if (past.length === 0) return null;

		// Save current state to redo stack
		future.unshift(JSON.parse(JSON.stringify(current)));
		const prev = past.pop()!;
		persistToStorage();
		return prev;
	}

	function redo(current: UISchema): UISchema | null {
		if (future.length === 0) return null;

		// Save current state to undo stack
		past.push(JSON.parse(JSON.stringify(current)));
		const next = future.shift()!;
		persistToStorage();
		return next;
	}

	function persistToStorage() {
		try {
			localStorage.setItem(LS_KEY, JSON.stringify({ past, future }));
		} catch {
			// Silently ignore quota exceeded errors
		}
	}

	function persistCurrentSchema(schema: UISchema) {
		try {
			localStorage.setItem(LS_CURRENT_KEY, JSON.stringify(schema));
		} catch {
			// Silently ignore quota exceeded errors
		}
	}

	function loadFromStorage(): { past: UISchema[]; future: UISchema[] } | null {
		try {
			const raw = localStorage.getItem(LS_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	function loadCurrentSchema(): UISchema | null {
		try {
			const raw = localStorage.getItem(LS_CURRENT_KEY);
			return raw ? JSON.parse(raw) : null;
		} catch {
			return null;
		}
	}

	function restoreFromStorage() {
		const saved = loadFromStorage();
		if (saved) {
			past.length = 0;
			past.push(...saved.past);
			future.length = 0;
			future.push(...saved.future);
		}
	}

	function clearStorage() {
		try {
			localStorage.removeItem(LS_KEY);
			localStorage.removeItem(LS_CURRENT_KEY);
		} catch {
			// Silently ignore
		}
		past.length = 0;
		future.length = 0;
	}

	return {
		push,
		undo,
		redo,
		canUndo: () => past.length > 0,
		canRedo: () => future.length > 0,
		restoreFromStorage,
		loadCurrentSchema,
		persistCurrentSchema,
		clearStorage
	};
}
