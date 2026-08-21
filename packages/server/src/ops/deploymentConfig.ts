/**
 * Reverse-proxy and body-limit configuration rules, evaluated against a plain
 * env bag. Pure predicates — no filesystem, no network, no process.
 *
 * These settings are read by adapter-node, not by Selva, so getting them wrong
 * is invisible: nothing throws, nothing logs, and the deployment serves traffic
 * while a whole class of requests fails. `selva doctor` reports them on the
 * host; the admin health panel runs the same rules so an operator who never
 * opens a shell still sees them.
 *
 * `packages/cli/src/checks/config.js` carries a duplicate of every rule here.
 * Duplicated because the CLI is dependency-free by design — it scaffolds the
 * deployment that installs this runtime, so it cannot import from it. A shared
 * fixture table (`ops/__tests__/deployment-config-fixtures.js`) is asserted by
 * both test suites, so a rule changed on one side fails CI on the other.
 */

/** Neutral severity. Callers map it onto their own presentation. */
export type ConfigVerdict = 'ok' | 'warn' | 'fail';

export interface ConfigFinding {
	id: string;
	label: string;
	verdict: ConfigVerdict;
	summary: string;
	/** Concrete next step. Absent when the verdict is `ok`. */
	remediation?: string;
}

/** Just the vars these rules read. Values are raw strings, as they come from `.env`. */
export interface DeploymentEnv {
	ORIGIN?: string;
	ADDRESS_HEADER?: string;
	XFF_DEPTH?: string;
	BODY_SIZE_LIMIT?: string;
	COMPUTE_REQUEST_MAX_BYTES?: string;
}

/**
 * Parse a `BODY_SIZE_LIMIT` the way adapter-node does, so this agrees with the
 * thing that actually rejects the request.
 *
 * The quirk is load-bearing: adapter-node reads only the LAST character as the
 * suffix, so `60mb` parses as the digits `60m` and happens to mean 60 MB, while
 * `60xy` silently becomes NaN. Returns bytes, or null when the value is one
 * adapter-node can't use.
 */
export function parseBodySizeLimit(raw: string | undefined | null): number | null {
	if (raw == null || raw === '') return null;
	const value = String(raw).trim();
	if (value === '') return null;

	const units: Record<string, number> = { K: 1024, M: 1024 * 1024, G: 1024 * 1024 * 1024 };
	const multiplier = units[value.at(-1)!.toUpperCase()] ?? 1;
	const bytes = Number(multiplier !== 1 ? value.slice(0, -1) : value) * multiplier;
	if (!Number.isFinite(bytes) || bytes <= 0) return null;
	return bytes;
}

/** The app's own default for COMPUTE_REQUEST_MAX_BYTES (compute/limits.ts). */
const COMPUTE_REQUEST_DEFAULT_BYTES = 256 * 1024 * 1024;

const asMb = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

/**
 * BODY_SIZE_LIMIT has to clear the compute request cap, or adapter-node's global
 * backstop rejects the upload first — with a non-JSON body the app never sees
 * and cannot log. Unset is the dangerous case, not a neutral one: adapter-node
 * falls back to 512 KB, so every upload 413s on a deployment that looks fine.
 */
export function checkBodySizeLimit(env: DeploymentEnv): ConfigFinding {
	const base = { id: 'body-size-limit', label: 'Upload size limit' };
	const raw = env.BODY_SIZE_LIMIT;
	const requestCap = Number(env.COMPUTE_REQUEST_MAX_BYTES) || COMPUTE_REQUEST_DEFAULT_BYTES;

	if (raw == null || raw === '') {
		return {
			...base,
			verdict: 'fail',
			summary:
				'BODY_SIZE_LIMIT is unset — adapter-node falls back to 512 KB, so uploads over ' +
				'that fail with an opaque 413 no app log records.',
			remediation: `Set BODY_SIZE_LIMIT to at least ${asMb(requestCap)} (the compute request cap) and restart.`
		};
	}

	const bytes = parseBodySizeLimit(raw);
	if (bytes === null) {
		return {
			...base,
			verdict: 'fail',
			summary: `BODY_SIZE_LIMIT="${raw}" — adapter-node cannot parse this and throws on boot.`,
			remediation: 'Use a byte count or a single K/M/G suffix, e.g. "256M".'
		};
	}

	if (bytes < requestCap) {
		return {
			...base,
			verdict: 'warn',
			summary:
				`BODY_SIZE_LIMIT=${raw} (${asMb(bytes)}) is below COMPUTE_REQUEST_MAX_BYTES ` +
				`(${asMb(requestCap)}) — the global cap rejects first, making the compute cap dead config.`,
			remediation: `Raise BODY_SIZE_LIMIT to at least ${asMb(requestCap)} and restart.`
		};
	}

	return {
		...base,
		verdict: 'ok',
		summary: `BODY_SIZE_LIMIT=${raw} clears the compute request cap.`
	};
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
export function checkClientAddress(env: DeploymentEnv): ConfigFinding {
	const base = { id: 'client-address', label: 'Client IP behind proxy' };
	const header = env.ADDRESS_HEADER;
	const depth = env.XFF_DEPTH;

	if (!env.ORIGIN) {
		return {
			...base,
			verdict: 'ok',
			summary: 'ADDRESS_HEADER is not needed — ORIGIN is unset, so no reverse proxy is in play.'
		};
	}

	if (!header) {
		return {
			...base,
			verdict: 'fail',
			summary:
				'ADDRESS_HEADER is unset while ORIGIN is set — every request looks like it came from ' +
				'the proxy, so all users share ONE login rate-limit bucket. Five failed logins from ' +
				'anyone locks out the whole instance for 15 minutes.',
			remediation:
				'Set ADDRESS_HEADER=X-Forwarded-For and XFF_DEPTH=<number of proxies>, then restart.'
		};
	}

	if (header.toLowerCase() === 'x-forwarded-for' && !depth) {
		return {
			...base,
			verdict: 'warn',
			summary:
				`ADDRESS_HEADER=${header} but XFF_DEPTH is unset. X-Forwarded-For is a ` +
				'client-appendable list, so a caller can prepend fake entries — adapter-node needs ' +
				'the proxy count to know which entry is real.',
			remediation:
				'Set XFF_DEPTH=1 for a single reverse proxy, 2 if a CDN or load balancer sits in front of it.'
		};
	}

	if (depth !== undefined && !/^[1-9][0-9]*$/.test(depth)) {
		return {
			...base,
			verdict: 'fail',
			summary: `XFF_DEPTH="${depth}" is not a positive integer.`,
			remediation: 'It counts proxies from the outside in — use 1 for a single reverse proxy.'
		};
	}

	return {
		...base,
		verdict: 'ok',
		summary: `ADDRESS_HEADER=${header}${depth ? ` (XFF_DEPTH=${depth})` : ''}.`
	};
}

/** Every deployment-config rule, in report order. */
export function checkDeploymentConfig(env: DeploymentEnv): ConfigFinding[] {
	return [checkClientAddress(env), checkBodySizeLimit(env)];
}
