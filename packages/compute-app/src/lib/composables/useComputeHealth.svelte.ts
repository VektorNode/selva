/**
 * Singleton store for Rhino.Compute server health.
 * - Checks on load until healthy, then stops.
 * - Re-checks when notifyFailure() is called (e.g. a solve request fails).
 * - Exponential backoff during recovery.
 */
import { browser } from '$app/environment';

export interface ComputeInfo {
	rhinoVersion: string | null;
	computeVersion: string | null;
	selvaVersion: string | null;
	selvaInstalled: boolean;
}

export type PluginMap = Record<string, string>;

export interface HealthStatus {
	state: 'checking' | 'starting' | 'ok' | 'warning' | 'error';
	reachable: boolean;
	message: string;
}

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

let timeoutId: ReturnType<typeof setTimeout> | null = null;
let infoFetched = false;
let consecutiveFailures = 0;
let isRecovering = false;

const STARTING_THRESHOLD = 3;
const REQUEST_TIMEOUT_MS = 8000;
const BASE_INTERVAL_MS = 5000;
const MAX_INTERVAL_MS = 30000;

function fetchWithTimeout(url: string): Promise<Response> {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
	return fetch(url, { signal: controller.signal }).finally(() => clearTimeout(timer));
}

async function fetchComputeInfo() {
	try {
		const [versionRes, pluginsRes] = await Promise.all([
			fetchWithTimeout('/api/compute/version-compute'),
			fetchWithTimeout('/api/compute/get-all-plugins')
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
	} catch {
		compute = {
			rhinoVersion: null,
			computeVersion: null,
			selvaVersion: null,
			selvaInstalled: false
		};
		plugins = {};
	}
}

function backoffMs(): number {
	return Math.min(BASE_INTERVAL_MS * Math.pow(2, consecutiveFailures - 1), MAX_INTERVAL_MS);
}

function cancelScheduled() {
	if (timeoutId !== null) {
		clearTimeout(timeoutId);
		timeoutId = null;
	}
}

async function checkHealth() {
	try {
		const res = await fetchWithTimeout('/api/compute/health');

		if (!res.ok) {
			consecutiveFailures++;
			health = {
				state: consecutiveFailures <= STARTING_THRESHOLD ? 'starting' : 'error',
				reachable: false,
				message:
					consecutiveFailures <= STARTING_THRESHOLD
						? 'Rhino.Compute is starting up…'
						: `Health endpoint returned ${res.status}`
			};
			scheduleRetry();
			return;
		}

		// Fetch version/plugin info once (or after a reconnect)
		if (!infoFetched || consecutiveFailures > 0) {
			infoFetched = true;
			await fetchComputeInfo();
		}

		consecutiveFailures = 0;
		isRecovering = false;

		if (health.state !== 'warning') {
			health = { state: 'ok', reachable: true, message: 'Rhino.Compute server is running.' };
		} else {
			health = { ...health, reachable: true };
		}

		// Healthy — stop polling until notifyFailure() is called
		cancelScheduled();
	} catch {
		consecutiveFailures++;
		health = {
			state: consecutiveFailures <= STARTING_THRESHOLD ? 'starting' : 'error',
			reachable: false,
			message:
				consecutiveFailures <= STARTING_THRESHOLD
					? 'Rhino.Compute is starting up…'
					: 'Failed to reach Compute server'
		};
		scheduleRetry();
	}
}

function scheduleRetry() {
	cancelScheduled();
	timeoutId = setTimeout(() => {
		timeoutId = null;
		checkHealth();
	}, backoffMs());
}

// --- Public API ---

export function useComputeHealth() {
	function start() {
		if (!browser) return;
		cancelScheduled();
		consecutiveFailures = 0;
		isRecovering = false;
		checkHealth();
	}

	/**
	 * Call this when a compute solve request fails (e.g. 503).
	 * Triggers a health re-check with backoff if not already recovering.
	 */
	function notifyFailure() {
		if (!browser) return;
		if (isRecovering) return; // already re-checking
		isRecovering = true;
		consecutiveFailures++;
		health = { state: 'error', reachable: false, message: 'Failed to reach Compute server' };
		scheduleRetry();
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
		start,
		notifyFailure
	};
}
