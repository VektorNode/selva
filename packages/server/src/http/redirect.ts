/**
 * Validate a user-supplied post-login redirect target. Accepts only same-origin
 * relative paths starting with `/` followed by a non-`/` character, so
 * `//evil.com/path` (protocol-relative URL — browser treats as cross-origin)
 * and `/\evil.com` (back-slash variants some browsers normalize) are rejected.
 *
 * Always returns a safe path: the validated target on success, the fallback
 * otherwise. Routes call this with `redirectTo` from form data or query string.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback: string): string {
	if (typeof raw !== 'string' || raw.length < 2) return fallback;
	if (raw[0] !== '/') return fallback;
	// Reject protocol-relative (`//host`) and back-slash bypass (`/\host`).
	if (raw[1] === '/' || raw[1] === '\\') return fallback;
	return raw;
}
