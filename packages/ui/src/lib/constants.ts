export const APP_DEFAULTS = {
	// File upload limits
	// TEMP (dev): raised 150 MB → 300 MB so large dev file-widget inputs aren't
	// blocked client-side. The server request cap (COMPUTE_REQUEST_MAX_BYTES)
	// still defaults to 256 MB, and base64 inflates a raw file by ~4/3, so
	// anything over ~192 MB is rejected with a 413 after the client accepts it.
	// Revert to 150 before release.
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

	// See createSolvingIndicator.
	SOLVING_INDICATOR: {
		/** A solve that ends sooner shows no indicator (ms) */
		SHOW_AFTER_MS: 400,
		/** Once shown, the indicator stays at least this long (ms) */
		MIN_VISIBLE_MS: 500,
		/** Past this a solve counts as slow and the viewer dims its stale result (ms) */
		SLOW_AFTER_MS: 2000
	},

	// File size formatting
	FILE_SIZE: {
		/** Bytes per kilobyte */
		BYTES_PER_KB: 1024
	}
};
