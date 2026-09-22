export const APP_DEFAULTS = {
	// TEMP (dev): raised 150 MB → 300 MB so large dev file-widget inputs aren't
	// blocked client-side. The server request cap (COMPUTE_REQUEST_MAX_BYTES)
	// still defaults to 256 MB, and base64 inflates a raw file by ~4/3, so
	// anything over ~192 MB is rejected with a 413 after the client accepts it.
	// Revert to 150 before release.
	FILE_UPLOAD: {
		MAX_SIZE_MB: 300,
		MAX_SIZE_BYTES: 300 * 1024 * 1024
	},

	TIMEOUTS: {
		SOLVE_STATE_DURATION: 3500,
		/** Matches the CSS transition. */
		DRAWER_ANIMATION_MS: 350
	},

	SOLVING_INDICATOR: {
		FAST_THRESHOLD_MS: 200,
		SLOW_THRESHOLD_MS: 600,
		ANIMATION_DELAY: 300,
		HISTORY_SIZE: 3
	},

	FILE_SIZE: {
		BYTES_PER_KB: 1024
	}
};
