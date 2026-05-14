/**
 * Reject URLs whose host is private/loopback/link-local — without this an
 * authenticated user could submit `http://169.254.169.254/...` (cloud metadata)
 * or any intranet endpoint and the server would fetch it on their behalf.
 *
 * Hostname-based check; not a defense against DNS rebinding (a malicious DNS
 * response that resolves a public name to a private IP between checks). For
 * full protection a follow-up would resolve once via `dns.lookup` and pass
 * the IP to fetch directly. Acceptable first line of defense.
 */
export function isSafeRemoteDefinitionUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;
	const host = parsed.hostname.toLowerCase();
	if (!host) return false;
	if (host === 'localhost' || host === '0.0.0.0' || host.endsWith('.localhost')) return false;
	if (host === '::1' || host === '[::1]') return false;
	// IPv4 loopback / private / link-local / cloud metadata.
	if (/^127\./.test(host)) return false;
	if (/^10\./.test(host)) return false;
	if (/^192\.168\./.test(host)) return false;
	if (/^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)) return false;
	if (/^169\.254\./.test(host)) return false;
	// IPv6 unique-local (fc00::/7) and link-local (fe80::/10).
	if (/^\[?(fc|fd)[0-9a-f]{2}:/i.test(host)) return false;
	if (/^\[?fe[89ab][0-9a-f]:/i.test(host)) return false;
	return true;
}
