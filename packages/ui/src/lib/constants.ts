export const APP_DEFAULTS = {
	// File upload limits
	// TEMP (dev): raised 150 MB → 300 MB so large dev file-widget inputs aren't
	// blocked client-side. The server request cap (COMPUTE_REQUEST_MAX_BYTES) was
	// bumped to 300 MB to match, but base64 inflates a raw file by ~4/3, so a
	// full 300 MB upload still won't fit the 300 MB request body. Revert to 150
	// before release.
	FILE_UPLOAD: {
		MAX_SIZE_MB: 300,
		MAX_SIZE_BYTES: 300 * 1024 * 1024
	},

	// Timing & performance thresholds
	TIMEOUTS: {
		/** Duration to show solving state (ms) */
		SOLVE_STATE_DURATION: 3500,
		/** Drawer open/close animation duration (ms) — matches the CSS transition. */
		DRAWER_ANIMATION_MS: 350
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
