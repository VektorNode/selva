import { browser } from '$app/environment';

export interface ServerHealthState {
	state: 'idle' | 'checking' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	rhinoVersion: string | null;
	computeVersion: string | null;
	selvaInstalled: boolean;
	selvaVersion: string | null;
	plugins: Record<string, string>;
	activeChildren: number | null;
	idleSpanSeconds: number | null;
}

// A manual check keeps retrying a cold/booting server for up to this long before
// giving up, so an operator who clicks "Check" on a sleeping server eventually
// sees it come Online without re-clicking. We never poll on a background timer —
// every probe is operator-initiated so we don't wake (and bill) idle servers.
const RETRY_WINDOW_MS = 60000;
const RETRY_INTERVAL_MS = 5000;

export function useServerHealth(serverId: () => string) {
	let state = $state<ServerHealthState>({
		state: 'idle',
		reachable: false,
		rhinoVersion: null,
		computeVersion: null,
		selvaInstalled: false,
		selvaVersion: null,
		plugins: {},
		activeChildren: null,
		idleSpanSeconds: null
	});

	let timerId: ReturnType<typeof setTimeout> | null = null;
	let deadline = 0;
	let destroyed = false;

	async function probe(): Promise<boolean> {
		if (!browser || destroyed) return false;
		try {
			const res = await fetch(`/admin/api/compute/status?serverId=${serverId()}`);
			if (destroyed) return false;
			if (!res.ok) {
				state = { ...state, reachable: false };
				return false;
			}
			const data = await res.json();
			state = {
				reachable: data.reachable,
				rhinoVersion: data.rhinoVersion,
				computeVersion: data.computeVersion,
				selvaInstalled: data.selvaInstalled,
				selvaVersion: data.selvaVersion,
				plugins: data.plugins ?? {},
				activeChildren: data.activeChildren ?? null,
				idleSpanSeconds: data.idleSpanSeconds ?? null,
				state: !data.reachable ? 'error' : !data.selvaInstalled ? 'warning' : 'ok'
			};
			return data.reachable;
		} catch {
			if (!destroyed) state = { ...state, reachable: false };
			return false;
		}
	}

	async function attempt() {
		const reachable = await probe();
		if (destroyed || reachable) return;
		// Not reachable yet — keep retrying until the window closes, then settle on error.
		if (Date.now() < deadline) {
			state = { ...state, state: 'checking' };
			timerId = setTimeout(attempt, RETRY_INTERVAL_MS);
		} else {
			state = { ...state, state: 'error', reachable: false };
		}
	}

	// Start (or restart) a manual check. Probes immediately, then retries a
	// non-responding server every few seconds until RETRY_WINDOW_MS elapses.
	function check() {
		if (!browser || destroyed) return;
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
		deadline = Date.now() + RETRY_WINDOW_MS;
		state = { ...state, state: 'checking' };
		attempt();
	}

	function stop() {
		destroyed = true;
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
	}

	return {
		get state() {
			return state;
		},
		check,
		stop
	};
}
