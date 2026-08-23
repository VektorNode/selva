/**
 * Validate a user-supplied post-login redirect target (`redirectTo` from form
 * data or a query string) against open redirects. Returns the target when it is
 * a same-origin relative path, the fallback otherwise — never a raw target.
 */
export function safeRedirectTarget(raw: string | null | undefined, fallback: string): string {
	// A valid target is `/` plus at least one more character, so the two guards
	// below always have a real `raw[1]` to inspect.
	if (typeof raw !== 'string' || raw.length < 2) return fallback;
	// Absolute URLs (`https://evil.com`) leave this origin.
	if (raw[0] !== '/') return fallback;
	// `//evil.com` is protocol-relative — a browser treats it as cross-origin —
	// and some browsers normalize `/\evil.com` into the same thing.
	if (raw[1] === '/' || raw[1] === '\\') return fallback;
	return raw;
}
