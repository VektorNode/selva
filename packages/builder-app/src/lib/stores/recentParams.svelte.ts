const MAX_RECENT = 8;
const STORAGE_KEY_PREFIX = 'builder.recentParams:';

function storageKey(sessionId: string): string {
	return `${STORAGE_KEY_PREFIX}${sessionId}`;
}

function loadFromStorage(sessionId: string): string[] {
	if (typeof localStorage === 'undefined') return [];
	try {
		const raw = localStorage.getItem(storageKey(sessionId));
		if (!raw) return [];
		const parsed = JSON.parse(raw);
		return Array.isArray(parsed) ? parsed.filter((v): v is string => typeof v === 'string') : [];
	} catch {
		return [];
	}
}

function saveToStorage(sessionId: string, ids: string[]) {
	if (typeof localStorage === 'undefined') return;
	try {
		localStorage.setItem(storageKey(sessionId), JSON.stringify(ids));
	} catch {
		// quota exceeded, etc. — ignore
	}
}

class RecentParamsStore {
	private _byId = $state<Record<string, string[]>>({});

	/** Hydrate from localStorage. Safe to call from $effect; idempotent. */
	init(sessionId: string) {
		if (!sessionId) return;
		if (this._byId[sessionId] !== undefined) return;
		this._byId[sessionId] = loadFromStorage(sessionId);
	}

	get(sessionId: string): string[] {
		if (!sessionId) return [];
		return this._byId[sessionId] ?? [];
	}

	track(sessionId: string, id: string) {
		if (!sessionId || !id) return;
		const current = this._byId[sessionId] ?? loadFromStorage(sessionId);
		const next = [id, ...current.filter((existing) => existing !== id)].slice(0, MAX_RECENT);
		this._byId[sessionId] = next;
		saveToStorage(sessionId, next);
	}

	clear(sessionId: string) {
		if (!sessionId) return;
		this._byId[sessionId] = [];
		saveToStorage(sessionId, []);
	}
}

export const recentParamsStore = new RecentParamsStore();
