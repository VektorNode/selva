import { browser } from '$app/environment';

export interface ServerHealthState {
	state: 'checking' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	rhinoVersion: string | null;
	computeVersion: string | null;
	selvaInstalled: boolean;
	selvaVersion: string | null;
	plugins: Record<string, string>;
}

const POLL_INTERVAL_MS = 30000;

export function useServerHealth(serverId: () => string) {
	let state = $state<ServerHealthState>({
		state: 'checking',
		reachable: false,
		rhinoVersion: null,
		computeVersion: null,
		selvaInstalled: false,
		selvaVersion: null,
		plugins: {}
	});

	let timerId: ReturnType<typeof setTimeout> | null = null;
	let destroyed = false;

	async function check() {
		if (!browser || destroyed) return;
		try {
			const res = await fetch(`/admin/api/compute/status?serverId=${serverId()}`);
			if (destroyed) return;
			if (!res.ok) {
				state = { ...state, state: 'error', reachable: false };
				schedule();
				return;
			}
			const data = await res.json();
			state = {
				reachable: data.reachable,
				rhinoVersion: data.rhinoVersion,
				computeVersion: data.computeVersion,
				selvaInstalled: data.selvaInstalled,
				selvaVersion: data.selvaVersion,
				plugins: data.plugins ?? {},
				state: !data.reachable ? 'error' : !data.selvaInstalled ? 'warning' : 'ok'
			};
		} catch {
			if (!destroyed) state = { ...state, state: 'error', reachable: false };
		}
		if (!destroyed) schedule();
	}

	function schedule() {
		timerId = setTimeout(check, POLL_INTERVAL_MS);
	}

	function start() {
		if (!browser) return;
		check();
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
		start,
		stop
	};
}
