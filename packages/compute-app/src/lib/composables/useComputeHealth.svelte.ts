/**
 * Composable for checking Rhino.Compute server health
 */

export interface ComputeHealthStatus {
	status: 'ok' | 'error' | 'warning' | 'checking';
	reachable: boolean;
	message: string;
	url: string;
}

export function useComputeHealth() {
	let healthStatus = $state<ComputeHealthStatus>({
		status: 'checking',
		reachable: false,
		message: 'Checking Rhino.Compute server...',
		url: ''
	});

	let intervalId: ReturnType<typeof setInterval> | null = null;

	async function checkHealth() {
		try {
			const response = await fetch('/api/health/compute');
			const data = await response.json();

			if (data.status === 'ok') {
				healthStatus = {
					status: 'ok',
					reachable: true,
					message: 'Connected to Rhino.Compute',
					url: data.computeServer.url
				};
			} else if (data.status === 'warning') {
				healthStatus = {
					status: 'warning',
					reachable: data.computeServer.reachable,
					message: data.warnings.join(', ') || 'Compute server warning',
					url: data.computeServer.url
				};
			} else {
				healthStatus = {
					status: 'error',
					reachable: false,
					message: data.warnings.join(', ') || 'Cannot reach Rhino.Compute server',
					url: data.computeServer.url
				};
			}
		} catch (error) {
			healthStatus = {
				status: 'error',
				reachable: false,
				message: error instanceof Error ? error.message : 'Failed to check compute server',
				url: ''
			};
		}
	}

	function startPeriodicCheck(intervalMs: number = 5000) {
		// Clear any existing interval
		stopPeriodicCheck();

		// Initial check
		checkHealth();

		// Set up periodic checking
		intervalId = setInterval(() => {
			checkHealth();
		}, intervalMs);
	}

	function stopPeriodicCheck() {
		if (intervalId !== null) {
			clearInterval(intervalId);
			intervalId = null;
		}
	}

	return {
		get status() {
			return healthStatus;
		},
		checkHealth,
		startPeriodicCheck,
		stopPeriodicCheck
	};
}
