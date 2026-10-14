// Builder UI preferences (open sections, active sidebar panel, list filters) that survive a reload.
// Storage can be unavailable (private mode, the plugin's embedded browser) or hold a value from an
// older build, so every read falls back to `initial` when the stored shape doesn't match.
export function usePersisted<T>(key: string, initial: T): { value: T } {
	const state = $state({ value: read(key, initial) });

	$effect(() => {
		const serialized = JSON.stringify(state.value);
		try {
			localStorage.setItem(key, serialized);
		} catch {
			// Unavailable storage just means the preference resets on reload.
		}
	});

	return state;
}

function read<T>(key: string, initial: T): T {
	try {
		const raw = localStorage.getItem(key);
		if (raw === null) return initial;
		const parsed: unknown = JSON.parse(raw);
		const sameShape =
			typeof parsed === typeof initial && Array.isArray(parsed) === Array.isArray(initial);
		return sameShape ? (parsed as T) : initial;
	} catch {
		return initial;
	}
}
