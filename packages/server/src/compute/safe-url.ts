import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

/**
 * SSRF guard for `loadRemoteDefinition`. Without it an authenticated user could
 * submit `http://169.254.169.254/...` (cloud metadata) or any intranet endpoint
 * and the server would fetch it on their behalf.
 *
 * Two layers:
 *
 *   1. `isSafeRemoteDefinitionUrl` — synchronous literal pre-filter. Rejects
 *      protocol, hostname literals, and every IP *encoding* that maps to a
 *      blocked address (dotted-decimal, integer, octal, hex, short-form,
 *      IPv4-mapped IPv6). Fast and DNS-free; safe to call anywhere.
 *
 *   2. `assertSafeRemoteDefinitionUrl` — resolves the hostname via DNS and
 *      re-checks the *resolved* IP. This is the real defense: it catches a
 *      public name that resolves to a private IP, which the literal filter
 *      can't see. Still not bulletproof against rebinding (the IP can change
 *      between this lookup and fetch's own); for that the caller would have to
 *      connect to the resolved IP directly. Connecting by IP is a larger change
 *      — this closes the practical bypasses (literal encodings + a DNS record
 *      that points inward) which is what an attacker actually reaches for.
 */

/**
 * True when `ip` (a normalized IPv4 or IPv6 literal from `isIP`/`dns.lookup`)
 * is loopback, private, link-local, or otherwise must-not-fetch. IPv4-mapped
 * IPv6 (`::ffff:a.b.c.d`) is unwrapped to its embedded IPv4 first so the v4
 * rules apply.
 */
function isBlockedIp(ip: string): boolean {
	let addr = ip.toLowerCase();

	// Unwrap IPv4-mapped IPv6 so the embedded address is judged by the IPv4
	// rules below. `URL` compresses the dotted form to hex (`::ffff:127.0.0.1`
	// → `::ffff:7f00:1`), so handle both spellings.
	const mappedDotted = /^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/.exec(addr);
	if (mappedDotted) {
		addr = mappedDotted[1];
	} else {
		const mappedHex = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(addr);
		if (mappedHex) {
			const hi = parseInt(mappedHex[1], 16);
			const lo = parseInt(mappedHex[2], 16);
			addr = [(hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff].join('.');
		}
	}

	if (isIP(addr) === 4) {
		const octets = addr.split('.').map(Number);
		if (octets.length !== 4 || octets.some((o) => o > 255)) return true; // malformed → block
		const [a, b] = octets;
		if (a === 0) return true; // 0.0.0.0/8 (incl. 0.0.0.0)
		if (a === 127) return true; // loopback
		if (a === 10) return true; // RFC1918
		if (a === 192 && b === 168) return true; // RFC1918
		if (a === 172 && b >= 16 && b <= 31) return true; // RFC1918
		if (a === 169 && b === 254) return true; // link-local + cloud metadata
		return false;
	}

	// IPv6 literals.
	if (addr === '::1' || addr === '::') return true; // loopback / unspecified
	if (/^(fc|fd)[0-9a-f]{0,2}:/.test(addr)) return true; // unique-local fc00::/7
	if (/^fe[89ab][0-9a-f]:/.test(addr)) return true; // link-local fe80::/10
	return false;
}

/**
 * Parse a bare-IPv4 hostname in any encoding browsers/glibc accept — integer
 * (`2130706433`), octal (`0177.0.0.1`), hex (`0x7f000001`), and short forms
 * (`127.1`) — into a canonical dotted-decimal string. Returns null when the
 * host is not a numeric IPv4 literal (i.e. it's a real name or already-valid
 * dotted-quad, which callers handle separately).
 */
function canonicalizeNumericIpv4(host: string): string | null {
	// Already a clean dotted-quad — let isIP handle it directly.
	if (isIP(host) === 4) return host;

	const rawParts = host.split('.');
	if (rawParts.length === 0 || rawParts.length > 4) return null;

	const parseUInt = (s: string): number | null => {
		if (s === '') return null;
		let n: number;
		if (/^0x[0-9a-f]+$/i.test(s)) n = parseInt(s, 16);
		else if (/^0[0-7]+$/.test(s)) n = parseInt(s, 8);
		else if (/^[0-9]+$/.test(s)) n = parseInt(s, 10);
		else return null;
		return Number.isFinite(n) ? n : null;
	};

	const nums = rawParts.map(parseUInt);
	if (nums.some((n) => n === null)) return null;
	const parts = nums as number[];

	// inet_aton semantics: the final part absorbs all remaining low-order bytes.
	// 1 part  → 32-bit value; 2 → a.(24-bit); 3 → a.b.(16-bit); 4 → a.b.c.d.
	let value: number;
	switch (parts.length) {
		case 1:
			value = parts[0];
			break;
		case 2:
			if (parts[0] > 0xff || parts[1] > 0xffffff) return null;
			value = (parts[0] << 24) | parts[1];
			break;
		case 3:
			if (parts[0] > 0xff || parts[1] > 0xff || parts[2] > 0xffff) return null;
			value = (parts[0] << 24) | (parts[1] << 16) | parts[2];
			break;
		default:
			if (parts.some((p) => p > 0xff)) return null;
			value = (parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3];
	}
	value = value >>> 0; // force unsigned 32-bit
	if (value > 0xffffffff) return null;

	return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff].join(
		'.'
	);
}

/**
 * Synchronous literal pre-filter. Rejects bad schemes, loopback hostnames, and
 * any IP literal (in any encoding) that resolves to a blocked address. Does NOT
 * perform DNS — a public *name* that points at a private IP passes here and is
 * caught by `assertSafeRemoteDefinitionUrl`.
 */
export function isSafeRemoteDefinitionUrl(raw: string): boolean {
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return false;
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false;

	let host = parsed.hostname.toLowerCase();
	if (!host) return false;

	// Hostname literals that never reach DNS.
	if (host === 'localhost' || host.endsWith('.localhost')) return false;

	// Strip the brackets URL keeps around IPv6 literals.
	const isBracketed = host.startsWith('[') && host.endsWith(']');
	if (isBracketed) host = host.slice(1, -1);

	if (isIP(host) === 6) return !isBlockedIp(host);

	// Numeric IPv4 in any encoding → canonicalize, then judge.
	const canonical = canonicalizeNumericIpv4(host);
	if (canonical) return !isBlockedIp(canonical);

	// A real hostname — passes the literal filter; DNS resolution is the gate.
	return true;
}

/**
 * Full SSRF check: literal pre-filter, then resolve every A/AAAA record and
 * reject if *any* resolved IP is blocked. Returns the original URL on success
 * so callers can `await assertSafeRemoteDefinitionUrl(url)` inline. Throws on
 * any rejection.
 */
export async function assertSafeRemoteDefinitionUrl(raw: string): Promise<string> {
	if (!isSafeRemoteDefinitionUrl(raw)) {
		throw new Error('Remote definition URL is not allowed');
	}

	const host = new URL(raw).hostname.toLowerCase().replace(/^\[|\]$/g, '');

	// Already an IP literal — isSafeRemoteDefinitionUrl validated it; no DNS.
	if (isIP(host) !== 0 || canonicalizeNumericIpv4(host)) return raw;

	let resolved: { address: string }[];
	try {
		resolved = await lookup(host, { all: true });
	} catch {
		throw new Error('Remote definition URL is not allowed');
	}
	if (resolved.length === 0 || resolved.some((r) => isBlockedIp(r.address))) {
		throw new Error('Remote definition URL is not allowed');
	}
	return raw;
}
