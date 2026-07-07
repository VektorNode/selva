import { browser } from '$app/environment';

export interface ServerHealthState {
	state: 'idle' | 'checking' | 'loading' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	// True once the server's plugin inventory has loaded, so `selvaInstalled` is
	// authoritative. A cold server is `reachable` (the proxy answers) before it is
	// `ready` (a child has finished enumerating Grasshopper add-ons).
	ready: boolean;
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
// sees it come Online without re-clicking. We retry until the server is *ready*
// (plugin inventory loaded) — not merely reachable — because the proxy answers
// well before a child finishes loading Grasshopper add-ons, and settling early on
// that partial reading is what made Selva look "Not installed" during boot.
// We never poll on a background timer — every probe is operator-initiated so we
// don't wake (and bill) idle servers.
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
		idleSpanSeconds: null
	});

	let timerId: ReturnType<typeof setTimeout> | null = null;
	let deadline = 0;
	let destroyed = false;

	// Probe once and fold the result into `state`. Returns whether the server is
	// *ready* (reachable AND plugin inventory loaded) — that's the retry loop's
	// stop condition, not mere reachability.
	async function probe(): Promise<boolean> {
		if (!browser || destroyed) return false;
		try {
			const res = await fetch(`/admin/api/compute/status?serverId=${serverId()}`);
			if (destroyed) return false;
			if (!res.ok) {
				state = { ...state, reachable: false, ready: false };
				return false;
			}
			const data = await res.json();
			const reachable: boolean = data.reachable;
			const ready: boolean = data.ready ?? reachable;
			state = {
				reachable,
				ready,
				rhinoVersion: data.rhinoVersion,
				computeVersion: data.computeVersion,
				selvaInstalled: data.selvaInstalled,
				selvaVersion: data.selvaVersion,
				plugins: data.plugins ?? {},
				activeChildren: data.activeChildren ?? null,
				idleSpanSeconds: data.idleSpanSeconds ?? null,
				// Reachable but not ready = a booting server still loading plugins.
				// Show that as 'loading' (progress), not 'warning' (misconfiguration),
				// so the operator isn't alarmed while add-ons enumerate. Only once the
				// inventory is loaded do we trust `selvaInstalled` to raise a warning.
				state: !reachable ? 'error' : !ready ? 'loading' : !data.selvaInstalled ? 'warning' : 'ok'
			};
			return ready;
		} catch {
			if (!destroyed) state = { ...state, reachable: false, ready: false };
			return false;
		}
	}

	async function attempt() {
		const ready = await probe();
		if (destroyed || ready) return;
		// Not ready yet (unreachable, or reachable but still loading plugins) — keep
		// retrying until the window closes. On timeout, settle on whatever the last
		// probe found: 'error' if it never came up, 'warning' if it's reachable but
		// Selva genuinely never appeared. Preserve that last reading instead of
		// forcing 'error', so a reachable-but-Selva-less server reads as a warning.
		if (Date.now() < deadline) {
			// Keep the pill in an in-progress state between retries: 'loading' when the
			// server is up and enumerating plugins, 'checking' when it's not up yet.
			// Never flash a terminal 'error'/'warning' while we still intend to retry.
			if (state.state !== 'loading') state = { ...state, state: 'checking' };
			timerId = setTimeout(attempt, RETRY_INTERVAL_MS);
		} else if (!state.reachable) {
			state = { ...state, state: 'error', reachable: false, ready: false };
		} else {
			// Reachable but never became ready within the window — the inventory never
			// populated (a child that can't finish loading Grasshopper, or a very slow
			// boot). Don't leave it stuck on 'loading'; downgrade to 'warning' so the
			// operator knows the server is up but Selva couldn't be confirmed.
			state = { ...state, state: 'warning' };
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
