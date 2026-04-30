import type { UISchema } from '@selvajs/schemas';

const LS_HISTORY_PREFIX = 'selva-schema-history:';
const LS_CURRENT_PREFIX = 'selva-schema-current:';

function isValidSchema(value: unknown): value is UISchema {
	if (!value || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return Array.isArray(v.inputs) && Array.isArray(v.outputs) && typeof v.layout === 'object' && v.layout !== null;
}

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
		past.push(schema);
		if (past.length > MAX_HISTORY) past.shift();
		future.length = 0;
		persistToStorage();
	}

	function undo(current: UISchema): UISchema | null {
		if (past.length === 0) return null;
		future.unshift(current);
		const prev = past.pop()!;
		persistToStorage();
		return prev;
	}

	function redo(current: UISchema): UISchema | null {
		if (future.length === 0) return null;
		past.push(current);
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
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!parsed || typeof parsed !== 'object') return null;
			const past = Array.isArray(parsed.past) ? parsed.past.filter(isValidSchema) : [];
			const future = Array.isArray(parsed.future) ? parsed.future.filter(isValidSchema) : [];
			return { past, future };
		} catch {
			return null;
		}
	}

	function loadCurrentSchema(): UISchema | null {
		try {
			const raw = localStorage.getItem(LS_CURRENT_KEY);
			if (!raw) return null;
			const parsed = JSON.parse(raw);
			if (!isValidSchema(parsed)) {
				// Stale/corrupt entry — drop it so we fall back to the server-provided schema
				localStorage.removeItem(LS_CURRENT_KEY);
				return null;
			}
			return parsed;
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
