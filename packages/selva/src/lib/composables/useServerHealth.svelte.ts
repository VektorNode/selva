import { browser } from '$app/environment';

export interface ServerHealthState {
	state: 'idle' | 'checking' | 'loading' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	// True once the plugin inventory loaded, so `selvaInstalled` is
	// authoritative. A cold server is `reachable` (proxy answers) before it's
	// `ready` (a child finished enumerating Grasshopper add-ons).
	ready: boolean;
	rhinoVersion: string | null;
	computeVersion: string | null;
	selvaInstalled: boolean;
	selvaVersion: string | null;
	plugins: Record<string, string>;
	activeChildren: number | null;
	idleSpanSeconds: number | null;
	/**
	 * Why the last probe failed, when the server classified it. Null while
	 * reachable. Shown to the operator instead of a bare "error" pill.
	 */
	failureSummary: string | null;
}

// A manual check retries a cold/booting server for up to this long, so an
// operator who clicks "Check" on a sleeping server sees it come Online
// without re-clicking. Retries until *ready* (plugin inventory loaded), not
// merely reachable — settling for reachable is what made Selva read as "Not
// installed" during boot. Never polls on a background timer: every probe is
// operator-initiated so we don't wake (and bill) idle servers.
const RETRY_WINDOW_MS = 60000;
const RETRY_INTERVAL_MS = 5000;

export function useServerHealth(serverId: () => string) {
	let state = $state<ServerHealthState>({
		state: 'idle',
		reachable: false,
		ready: false,
		rhinoVersion: null,
		computeVersion: null,
		selvaInstalled: false,
		selvaVersion: null,
		plugins: {},
		activeChildren: null,
		idleSpanSeconds: null,
		failureSummary: null
	});

	let timerId: ReturnType<typeof setTimeout> | null = null;
	let deadline = 0;
	let destroyed = false;

	// Set when the server says the failure cannot resolve itself (connection
	// refused, rejected API key). Ends the retry window early — see `attempt`.
	let terminal = false;

	// Return value is the retry loop's stop condition: ready, not merely reachable.
	async function probe(): Promise<boolean> {
		if (!browser || destroyed) return false;
		try {
			const res = await fetch(`/api/admin/compute/status?serverId=${serverId()}`);
			if (destroyed) return false;
			if (!res.ok) {
				state = { ...state, reachable: false, ready: false };
				return false;
			}
			const data = await res.json();
			const reachable: boolean = data.reachable;
			const ready: boolean = data.ready ?? reachable;
			// Absent field (older server) means "keep the old behaviour and retry".
			terminal = !reachable && data.retryable === false;
			state = {
				reachable,
				ready,
				failureSummary: data.failureSummary ?? null,
				rhinoVersion: data.rhinoVersion,
				computeVersion: data.computeVersion,
				selvaInstalled: data.selvaInstalled,
				selvaVersion: data.selvaVersion,
				plugins: data.plugins ?? {},
				activeChildren: data.activeChildren ?? null,
				idleSpanSeconds: data.idleSpanSeconds ?? null,
				// Reachable but not ready = a booting server still loading plugins.
				// Show 'loading' (progress), not 'warning' (misconfiguration), so the
				// operator isn't alarmed while add-ons enumerate. Only once the
				// inventory is loaded do we trust `selvaInstalled` to raise a warning.
				state: !reachable ? 'error' : !ready ? 'loading' : !data.selvaInstalled ? 'warning' : 'ok'
			};
			return ready;
		} catch {
			// A fetch that never reached our own API says nothing about the compute
			// server — keep retrying.
			terminal = false;
			if (!destroyed) state = { ...state, reachable: false, ready: false };
			return false;
		}
	}

	async function attempt() {
		const ready = await probe();
		if (destroyed || ready) return;
		if (terminal) {
			// The server told us waiting cannot help. Settle on the real reason now
			// rather than spinning out the window.
			state = { ...state, state: 'error', reachable: false, ready: false };
			return;
		}
		if (Date.now() < deadline) {
			// Keep the pill in an in-progress state between retries: 'loading' when
			// the server is up and enumerating plugins, 'checking' otherwise. Never
			// flash a terminal 'error'/'warning' while we still intend to retry.
			if (state.state !== 'loading') state = { ...state, state: 'checking' };
			timerId = setTimeout(attempt, RETRY_INTERVAL_MS);
		} else if (!state.reachable) {
			state = { ...state, state: 'error', reachable: false, ready: false };
		} else {
			// Reachable but never became ready within the window: don't leave it
			// stuck on 'loading' — the server is up but Selva couldn't be confirmed.
			state = { ...state, state: 'warning' };
		}
	}

	function check() {
		if (!browser || destroyed) return;
		if (timerId !== null) {
			clearTimeout(timerId);
			timerId = null;
		}
		deadline = Date.now() + RETRY_WINDOW_MS;
		terminal = false;
		state = { ...state, state: 'checking', failureSummary: null };
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
