/**
 * Composable for checking Rhino.Compute server health
 * Usage: const compute = useComputeHealth();
 */
import { browser } from '$app/environment';

// --- Types ---

export interface ComputeInfo {
	rhinoVersion: string | null;
	computeVersion: string | null;
	selvaVersion: string | null;
	selvaInstalled: boolean;
}

export type PluginMap = Record<string, string>;

export interface UpdateInfo {
	checked: boolean;
	updateAvailable: boolean;
	installedVersion: string | null;
	latestVersion: string | null;
}

export interface HealthStatus {
	state: 'checking' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	message: string;
}

// --- Composable ---

export function useComputeHealth() {
	let health = $state<HealthStatus>({
		state: 'checking',
		reachable: false,
		message: 'Checking Rhino.Compute server…'
	});

	let compute = $state<ComputeInfo>({
		rhinoVersion: null,
		computeVersion: null,
		selvaVersion: null,
		selvaInstalled: false
	});

	let plugins = $state<PluginMap>({});

	let intervalId: ReturnType<typeof setInterval> | null = null;
	let initialFetchDone = false;
	let wasOffline = false;

	// --- One-time: fetch versions + plugins ---

	async function fetchComputeInfo() {
		try {
			const [versionRes, pluginsRes] = await Promise.all([
				fetch('/api/compute/version-compute'),
				fetch('/api/compute/get-all-plugins')
			]);

			if (!versionRes.ok) throw new Error(`Version endpoint returned ${versionRes.status}`);

			const versionData = await versionRes.json();
			const pluginData: PluginMap = pluginsRes.ok ? await pluginsRes.json() : {};

			plugins = pluginData;

			const selvaVersion: string | null = pluginData['Selva'] ?? null;

			compute = {
				rhinoVersion: versionData.rhino ?? null,
				computeVersion: versionData.compute ?? null,
				selvaVersion,
				selvaInstalled: selvaVersion !== null
			};

			if (!compute.selvaInstalled) {
				health = {
					state: 'warning',
					reachable: true,
					message: 'Selva plugin is not installed on the Compute server.'
				};
			}
		} catch (error) {
			console.error('Failed to fetch compute info:', error);
			compute = {
				rhinoVersion: null,
				computeVersion: null,
				selvaVersion: null,
				selvaInstalled: false
			};
			plugins = {};
		}
	}

	// --- Repeated: health poll ---

	async function checkHealth() {
		// Run the one-time fetches on the first health tick
		if (!initialFetchDone) {
			initialFetchDone = true;
			await fetchComputeInfo();
		}

		try {
			const res = await fetch('/api/compute/health');

			if (!res.ok) {
				health = {
					state: 'error',
					reachable: false,
					message: `Health endpoint returned ${res.status}`
				};
				wasOffline = true;
				return;
			}

			// Server came back online - refetch all info
			if (wasOffline) {
				wasOffline = false;
				await fetchComputeInfo();
			}

			// If we already flagged a warning (e.g. missing plugin), keep it
			if (health.state !== 'warning') {
				health = {
					state: 'ok',
					reachable: true,
					message: 'Rhino.Compute server is running.'
				};
			} else {
				// Server is reachable but warning persists
				health = { ...health, reachable: true };
			}
		} catch (error) {
			health = {
				state: 'error',
				reachable: false,
				message: error instanceof Error ? error.message : 'Failed to reach Compute server'
			};
			wasOffline = true;
		}
	}

	// --- Lifecycle ---

	function startPeriodicCheck(intervalMs: number = 5000) {
		if (!browser) return;
		stopPeriodicCheck();
		checkHealth();
		intervalId = setInterval(checkHealth, intervalMs);
	}

	function stopPeriodicCheck() {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	return {
		get health() {
			return health;
		},
		get compute() {
			return compute;
		},
		get plugins() {
			return plugins;
		},
		startPeriodicCheck,
		stopPeriodicCheck
	};
}
