export const APP_DEFAULTS = {
	// File upload limits
	FILE_UPLOAD: {
		MAX_SIZE_MB: 150,
		MAX_SIZE_BYTES: 150 * 1024 * 1024
	},

	// Timing & performance thresholds
	TIMEOUTS: {
		/** Duration to show solving state (ms) */
		SOLVE_STATE_DURATION: 3500,
		/**
		 * Default per-solve abort timeout (ms). Used as the fallback when a
		 * caller doesn't supply one. The compute-app overrides this with
		 * MAX_SOLVE_DURATION_MS from `computeLimits.ts`, plumbed through page
		 * data so the client's AbortController matches the server's deadline.
		 */
		COMPUTE_TIMEOUT: 60000,
		/** Parameter export callback delay (ms) */
		PARAM_EXPORT_DELAY: 100,
		/** Viewer initialization delay (ms) */
		VIEWER_INIT_DELAY: 350
	},

	// Solving indicator adaptive thresholds
	SOLVING_INDICATOR: {
		/** If solve is faster than this, don't show indicator (ms) */
		FAST_THRESHOLD_MS: 200,
		/** If solve is slower than this, show indicator immediately (ms) */
		SLOW_THRESHOLD_MS: 600,
		/** Animation delay for solve indicator (ms) */
		ANIMATION_DELAY: 300,
		/** Number of solve durations to keep in history for averaging */
		HISTORY_SIZE: 3
	},

	// File size formatting
	FILE_SIZE: {
		/** Bytes per kilobyte */
		BYTES_PER_KB: 1024
	}
};
