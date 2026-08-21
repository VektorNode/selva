// Checks that read only `.env` values — no filesystem, no network, no
// subprocesses. These decide whether a deployment is validly configured, so
// they run on every `selva doctor` regardless of which providers are in play.

import { RENAMED_ENV_VARS, REPLACED_ENV_VARS } from '../env.js';
import { green, red, yellow } from './result.js';

const HEX_64 = /^[0-9a-f]{64}$/i;
const PLACEHOLDER = 'replace-this-with-a-random-32-byte-hex-key';

const VALID_AUTH = ['local', 'supabase', 'header'];
// Header-auth is an auth provider only — it has no data or storage layer.
const VALID_DATA = ['local', 'supabase'];

/**
 * Guards SELVA_HMAC_KEY and SELVA_AT_REST_KEY. A placeholder or short key
 * starts and serves traffic — the damage (forgeable sessions, weak at-rest
 * encryption) is invisible until someone looks for it.
 */
export function checkSecret(value, label) {
	if (!value) return red(`${label} — unset`);
	if (value === PLACEHOLDER) return red(`${label} — still the placeholder`);
	if (!HEX_64.test(value)) return red(`${label} — not 64 hex chars`);
	return green(label);
}

// Lowercased and defaulted the same way create-selva-providers.ts defaults them.
export function resolveProviders(env) {
	return {
		auth: (env.SELVA_AUTH_PROVIDER ?? 'local').toLowerCase(),
		data: (env.SELVA_DATA_PROVIDER ?? 'local').toLowerCase(),
		storage: (env.SELVA_STORAGE_PROVIDER ?? 'local').toLowerCase()
	};
}

export function checkProviders(providers) {
	const checks = [];
	if (!VALID_AUTH.includes(providers.auth)) {
		checks.push(red(`SELVA_AUTH_PROVIDER="${providers.auth}" — expected local|supabase|header`));
	}
	if (!VALID_DATA.includes(providers.data)) {
		checks.push(red(`SELVA_DATA_PROVIDER="${providers.data}" — expected local|supabase`));
	}
	if (!VALID_DATA.includes(providers.storage)) {
		checks.push(red(`SELVA_STORAGE_PROVIDER="${providers.storage}" — expected local|supabase`));
	}
	return checks;
}

export function checkTenancy(env) {
	const tenancy = (env.SELVA_TENANCY ?? 'single').toLowerCase();
	if (tenancy !== 'single' && tenancy !== 'multi') {
		return red(`SELVA_TENANCY="${tenancy}" — expected single|multi`);
	}
	return green(`SELVA_TENANCY=${tenancy}`);
}

export function checkOrigin(env) {
	if (!env.ORIGIN) return yellow('ORIGIN unset — required behind a reverse proxy');
	try {
		new URL(env.ORIGIN);
	} catch {
		return red(`ORIGIN="${env.ORIGIN}" is not a valid URL`);
	}
	return green(`ORIGIN=${env.ORIGIN}`);
}

// Duplicated from HeaderAuthProvider.DEFAULT_HEADERS to avoid loading the runtime here.
// A test in providers/header-auth pins both sides, so drift surfaces in CI.
export const DEFAULT_HEADER_NAMES = {
	upn: 'SELVA-UserPrincipalName',
	email: 'SELVA-Email',
	displayName: 'SELVA-DisplayName'
};

// oauth2-proxy's `set_xauthrequest` names. Two proxy styles are documented and
// both are correct, but they need opposite env config:
//
//   rewrite      — Caddy maps X-Auth-Request-* onto SELVA-* before proxying.
//                  Selva sees SELVA-*, so the overrides must be UNSET.
//   copy-through — Caddy forwards X-Auth-Request-* unchanged.
//                  Selva sees those names, so all three must be overridden.
//
// Mixing them is the failure this check exists to catch: a name Selva reads but
// the proxy never sends yields `null` from identifyFromHeaders (for the UPN, a
// total login failure) with nothing in the logs pointing at the env var.
const OAUTH2_PROXY_HEADERS = new Set([
	'x-auth-request-user',
	'x-auth-request-email',
	'x-auth-request-preferred-username'
]);

/**
 * Reports the header names the provider will actually read, and flags the
 * combinations that can't match any documented proxy config.
 *
 * Deliberately not a "did you override all three" count: with the rewrite
 * style, zero overrides is the correct answer, so counting alone would push
 * operators toward breaking a working deployment.
 */
export function checkHeaderNames(env) {
	const resolved = {
		upn: env.HEADER_AUTH_UPN_HEADER || DEFAULT_HEADER_NAMES.upn,
		email: env.HEADER_AUTH_EMAIL_HEADER || DEFAULT_HEADER_NAMES.email,
		displayName: env.HEADER_AUTH_DISPLAY_NAME_HEADER || DEFAULT_HEADER_NAMES.displayName
	};
	const list = `UPN=${resolved.upn}, Email=${resolved.email}, DisplayName=${resolved.displayName}`;

	const oauth2 = Object.values(resolved).filter((h) =>
		OAUTH2_PROXY_HEADERS.has(h.toLowerCase())
	).length;
	const defaults = Object.entries(resolved).filter(
		([slot, name]) => name === DEFAULT_HEADER_NAMES[slot]
	).length;

	if (oauth2 === 0) {
		return defaults === 3
			? green(`header names (bundled defaults): ${list}`)
			: green(`header names (custom): ${list}`);
	}

	// Some X-Auth-Request-*, some SELVA-* defaults — neither proxy style emits
	// that mix, so whichever slots are still on a default are being read from a
	// header nothing sets.
	if (defaults > 0) {
		const stale = Object.entries(resolved)
			.filter(([slot, name]) => name === DEFAULT_HEADER_NAMES[slot])
			.map(([slot, name]) => `${slot}=${name}`)
			.join(', ');
		return yellow(
			`header names mix oauth2-proxy and bundled-default names: ${list} — ` +
				`${stale} will never arrive if your proxy forwards X-Auth-Request-* unchanged. ` +
				`Either override all three with the X-Auth-Request-* names, or map them to SELVA-* ` +
				`in the proxy and unset all three overrides.`
		);
	}

	return green(`header names (oauth2-proxy pass-through): ${list}`);
}

// Below this, an annotated .env is just a slightly chatty config file; above it
// the operator is scrolling past screens of prose that no command can correct.
const COMMENT_LINE_BUDGET = 40;

/**
 * Flags a `.env` still carrying the shipped documentation block.
 *
 * The block is a snapshot of the release the deployment was installed at.
 * `migrate` rewrites keys but never prose, so those comments keep describing
 * vars the code has since renamed or retired — confidently wrong instructions
 * sitting in the file an operator reaches for first. Nothing breaks, which is
 * why this is yellow, and why it needs saying at all.
 */
export function checkEnvDocumentation(commentLines, fix) {
	if (commentLines <= COMMENT_LINE_BUDGET) {
		return green('.env is values-only');
	}
	return yellow(
		`.env carries ~${commentLines} lines of shipped documentation. Comments are ` +
			`never updated by \`selva migrate\`, so they still describe the release this ` +
			`deployment was installed at — including variables the code no longer reads. ` +
			`Strip them (values and your own inline notes are kept, .env.bak written):\n     ` +
			`npx selva doctor --fix`,
		fix
	);
}

/**
 * Parse a `BODY_SIZE_LIMIT` the way adapter-node does, so this check agrees with
 * the thing that actually rejects the request.
 *
 * The quirk is load-bearing: adapter-node reads only the LAST character as the
 * suffix, so `60mb` parses as the digits `60m` and happens to mean 60 MB, while
 * `60xy` silently becomes NaN. Returns bytes, or `null` when the value is one
 * adapter-node can't use.
 */
export function parseBodySizeLimit(raw) {
	if (raw == null || raw === '') return null;
	const value = String(raw).trim();
	if (value === '') return null;

	// Mirrors adapter-node's parse_as_bytes (files/utils.js): only K/M/G count as
	// units, and the rest goes through `Number`, which is strict — "256mb" leaves
	// a trailing "m" and yields NaN, so adapter-node throws on boot.
	const units = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
	const multiplier = units[value.at(-1).toUpperCase()] ?? 1;
	const bytes = Number(multiplier !== 1 ? value.slice(0, -1) : value) * multiplier;
	if (!Number.isFinite(bytes) || bytes <= 0) return null;
	return bytes;
}

// The app's own default for COMPUTE_REQUEST_MAX_BYTES (packages/server
// compute/limits.ts). Duplicated rather than imported: the CLI installs the
// runtime and cannot import from it.
const COMPUTE_REQUEST_DEFAULT_BYTES = 256 * 1024 * 1024;

/**
 * BODY_SIZE_LIMIT has to clear the compute request cap, or adapter-node's global
 * backstop rejects the upload first — with a non-JSON body the app never sees
 * and cannot log. Unset is the dangerous case, not a neutral one: adapter-node
 * falls back to 512 KB, so every upload 413s on a deployment that looks fine.
 */
export function checkBodySizeLimit(env) {
	const raw = env.BODY_SIZE_LIMIT;
	const requestCap = Number(env.COMPUTE_REQUEST_MAX_BYTES) || COMPUTE_REQUEST_DEFAULT_BYTES;
	const asMb = (bytes) => `${Math.round(bytes / (1024 * 1024))} MB`;

	if (raw == null || raw === '') {
		return red(
			`BODY_SIZE_LIMIT unset — adapter-node falls back to 512 KB, so uploads over ` +
				`that fail with an opaque 413 no app log records. Set it to at least ` +
				`${asMb(requestCap)} (the compute request cap).`
		);
	}

	const bytes = parseBodySizeLimit(raw);
	if (bytes === null) {
		return red(
			`BODY_SIZE_LIMIT="${raw}" — adapter-node cannot parse this and throws on boot. ` +
				`Use a byte count or a single K/M/G suffix, e.g. "256M".`
		);
	}

	if (bytes < requestCap) {
		return yellow(
			`BODY_SIZE_LIMIT=${raw} (${asMb(bytes)}) is below COMPUTE_REQUEST_MAX_BYTES ` +
				`(${asMb(requestCap)}) — the global cap rejects first, making the compute cap ` +
				`dead config. Raise it to at least ${asMb(requestCap)}.`
		);
	}

	return green(`BODY_SIZE_LIMIT=${raw}`);
}

/**
 * `ADDRESS_HEADER` / `XFF_DEPTH` are read by adapter-node, not by Selva, and
 * unset they are invisible: nothing fails, nothing logs, and the deployment
 * looks healthy.
 *
 * What actually happens is that `getClientAddress()` returns the socket peer,
 * which behind a reverse proxy is the proxy — `127.0.0.1` for every request
 * from every user. Login rate limiting keys on that, so the whole instance
 * shares one bucket: five failed logins from anywhere return 429 to everyone,
 * and only a *successful* login clears a bucket, which nobody can then reach.
 *
 * `ORIGIN` is the proxy tell. It is only needed when the app is served under a
 * public URL it can't derive from its own socket, so its presence means a proxy
 * is terminating requests. Without it we say nothing: on a directly-reachable
 * app these settings are a footgun, since `X-Forwarded-For` is client-supplied
 * and anyone could then pick their own rate-limit bucket.
 */
export function checkClientAddress(env) {
	const header = env.ADDRESS_HEADER;
	const depth = env.XFF_DEPTH;

	if (!env.ORIGIN) {
		// No proxy signal — nothing to advise either way.
		return green('ADDRESS_HEADER not needed (no ORIGIN, so no reverse proxy)');
	}

	if (!header) {
		return red(
			`ADDRESS_HEADER unset while ORIGIN is set — every request looks like it came from ` +
				`the proxy, so all users share ONE login rate-limit bucket. Five failed logins ` +
				`from anyone locks out the whole instance for 15 minutes. ` +
				`Set ADDRESS_HEADER=X-Forwarded-For and XFF_DEPTH=<number of proxies>.`
		);
	}

	if (header.toLowerCase() === 'x-forwarded-for' && !depth) {
		return yellow(
			`ADDRESS_HEADER=${header} but XFF_DEPTH is unset. X-Forwarded-For is a ` +
				`client-appendable list, so a caller can prepend fake entries — adapter-node ` +
				`needs the proxy count to know which entry is real. Set XFF_DEPTH=1 for a ` +
				`single reverse proxy, 2 if a CDN or load balancer sits in front of it.`
		);
	}

	if (depth !== undefined && !/^[1-9][0-9]*$/.test(depth)) {
		return red(
			`XFF_DEPTH="${depth}" is not a positive integer — it counts proxies from the ` +
				`outside in. Use 1 for a single reverse proxy.`
		);
	}

	return green(`ADDRESS_HEADER=${header}${depth ? ` (XFF_DEPTH=${depth})` : ''}`);
}

// A rename is auto-fixable (`selva migrate` rewrites the key). A replacement
// encodes a value in the new name, so migrate leaves it alone rather than
// guessing — it's reported here and nowhere else.
export function checkDeprecatedEnv(env) {
	const checks = [];

	for (const [oldName, newName] of Object.entries(RENAMED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(
			env[newName] === undefined
				? yellow(`${oldName} is deprecated — \`selva migrate\` renames it to ${newName}`)
				: yellow(`${oldName} is deprecated and ignored — ${newName} is set and wins`)
		);
	}

	for (const [oldName, replacement] of Object.entries(REPLACED_ENV_VARS)) {
		if (env[oldName] === undefined) continue;
		checks.push(yellow(`${oldName} is deprecated — replace it with ${replacement}`));
	}

	return checks;
}
