/** Alphabet of one storage path segment, as regex source. Covers GUIDs and sanitized refs. */
export const SAFE_SEGMENT = String.raw`[A-Za-z0-9._-]+`;

const SAFE_SEGMENT_ONLY = new RegExp(`^${SAFE_SEGMENT}$`);

/**
 * Blocks traversal, separators, NUL and empty segments, so a malicious id can't
 * escape its prefix. The alphabet admits `.` and `..`, so those need their own check.
 */
export function assertSafeKey(value: string, label: string): void {
	if (!value || !SAFE_SEGMENT_ONLY.test(value) || value === '.' || value === '..') {
		throw new Error(`Unsafe ${label}: ${JSON.stringify(value)}`);
	}
}
