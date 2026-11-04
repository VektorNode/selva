import {
	resolveConfig,
	type ConfigReport,
	type EnvRecord,
	type KeyRotation
} from '@selvajs/platform/config';
import { deploymentManifest } from './settings.js';

/**
 * Plain-language findings for the admin Configuration page: what is wrong with
 * this deployment, what it breaks, and the command that fixes it. Each finding
 * is derived from the env and the request the admin made, so a proxy that was
 * never mentioned in `.env` still shows up.
 */

export type CheckLevel = 'error' | 'warning' | 'info';

export interface ConfigCheck {
	id: string;
	level: CheckLevel;
	title: string;
	detail: string;
	/** Shell commands, run in order on the server. */
	fix?: string[];
	keys: string[];
}

export interface RequestFacts {
	/** A proxy forwarded this request: one of the X-Forwarded-* or Forwarded headers arrived. */
	proxied: boolean;
	/** What the visitor typed, as far as the proxy says: `https://selva.example.com`. */
	seenOrigin: string;
}

export function requestFacts(headers: Headers, url: URL): RequestFacts {
	const forwardedHost = firstValue(headers.get('x-forwarded-host'));
	const forwardedProto = firstValue(headers.get('x-forwarded-proto'));
	const proxied =
		headers.has('x-forwarded-for') ||
		headers.has('forwarded') ||
		forwardedHost !== undefined ||
		forwardedProto !== undefined;
	const proto = forwardedProto ?? url.protocol.replace(/:$/, '');
	const host = forwardedHost ?? url.host;
	return { proxied, seenOrigin: `${proto}://${host}` };
}

function firstValue(header: string | null): string | undefined {
	const v = header?.split(',')[0]?.trim();
	return v ? v : undefined;
}

export interface CheckInput {
	env: EnvRecord;
	report: ConfigReport;
	rotation: KeyRotation[];
	/** Stored compute API keys still sealed under the previous at-rest key; null outside a rotation. */
	atRestOnPreviousKey: number | null;
	request: RequestFacts;
	computeRequestMaxBytes: number;
	/** `vite dev`: development mode is expected, not a finding. */
	dev: boolean;
}

const restart = 'npx selva restart';
const set = (key: string, value: string) => `npx selva config set ${key}=${value}`;

export function configChecks(input: CheckInput): ConfigCheck[] {
	const { env, report, request } = input;
	const values = resolveConfig(deploymentManifest(env), env).values;
	const label = (key: string) => report.rows.find((r) => r.key === key)?.label ?? key;
	const out: ConfigCheck[] = [];

	for (const p of report.problems) {
		out.push({
			id: `invalid:${p.key}`,
			level: p.status === 'error' ? 'error' : 'warning',
			title: `${label(p.key)} has a bad value`,
			detail:
				p.status === 'error'
					? `The value ${p.problem}. The app refuses to start with it.`
					: `The value ${p.problem}, so the app ignores it and uses the default.`,
			keys: [p.key]
		});
	}

	for (const u of report.unknown) {
		out.push({
			id: `unknown:${u.key}`,
			level: 'warning',
			title: `${u.key} does nothing`,
			detail: u.suggestion
				? `Selva doesn't read ${u.key}. It looks like a typo of ${u.suggestion}, which is the one that counts.`
				: `Selva doesn't read ${u.key}. Remove it, or check the name against the settings below.`,
			...(u.suggestion ? { fix: [`npx selva config unset ${u.key}`] } : {}),
			keys: [u.key]
		});
	}

	const renamed = report.rows.filter((r) => r.source === 'alias');
	if (renamed.length > 0) {
		out.push({
			id: 'renamed',
			level: 'info',
			title: 'Some settings use an old name',
			detail: `${renamed.map((r) => `${r.alias} is now ${r.key}`).join('; ')}. They still work; renaming keeps it that way.`,
			fix: ['selva migrate'],
			keys: renamed.map((r) => r.key)
		});
	}

	const origin = values.ORIGIN as string | undefined;
	if (request.proxied && !origin) {
		out.push({
			id: 'origin-missing',
			level: 'error',
			title: 'Public address is not set',
			detail:
				'Requests reach Selva through a proxy, but it doesn’t know its own public address. Form posts fail their security check and invite links point at an internal address.',
			fix: [set('ORIGIN', request.seenOrigin), restart],
			keys: ['ORIGIN']
		});
	} else if (request.proxied && origin && sameOrigin(origin, request.seenOrigin) === false) {
		out.push({
			id: 'origin-mismatch',
			level: 'warning',
			title: 'Public address doesn’t match how you reached this page',
			detail: `You opened Selva at ${request.seenOrigin}, but its public address is ${origin}. Sign-in from ${request.seenOrigin} fails, and invite links point at ${origin}.`,
			fix: [set('ORIGIN', request.seenOrigin), restart],
			keys: ['ORIGIN']
		});
	}

	if (origin && /^http:\/\//i.test(origin) && !isLoopbackUrl(origin)) {
		out.push({
			id: 'origin-http',
			level: 'warning',
			title: 'Sign-ins travel unencrypted',
			detail: `The public address ${origin} uses http, so passwords and session cookies cross the network in plain text. Put a proxy with a certificate in front: selva setup-proxy does it.`,
			fix: ['selva setup-proxy'],
			keys: ['ORIGIN']
		});
	}

	if (request.proxied && !values.ADDRESS_HEADER) {
		out.push({
			id: 'address-header',
			level: 'warning',
			title: 'Every visitor looks like the same person',
			detail:
				'Behind a proxy, Selva sees the proxy’s address instead of each visitor’s. Rate limits are shared by everyone, so five failed logins from anyone lock out the whole instance.',
			fix: [set('ADDRESS_HEADER', 'X-Forwarded-For'), set('XFF_DEPTH', '1'), restart],
			keys: ['ADDRESS_HEADER', 'XFF_DEPTH']
		});
	}

	const host = values.HOST as string;
	if (request.proxied && (host === '0.0.0.0' || host === '::')) {
		const headerAuth = (env.SELVA_AUTH_PROVIDER ?? '').toLowerCase() === 'header';
		out.push({
			id: 'host-open',
			level: headerAuth ? 'error' : 'warning',
			title: 'The app can be reached without going through the proxy',
			detail: headerAuth
				? 'Sign-in comes from headers the proxy sets. Anyone who reaches the app’s port directly can send those headers and sign in as any user.'
				: 'The app accepts connections from any network, not just from the proxy. Skip this if the proxy runs in another container.',
			fix: [set('HOST', '127.0.0.1'), restart],
			keys: ['HOST']
		});
	}

	const bodyLimit = parseBodySize(values.BODY_SIZE_LIMIT as string);
	if (bodyLimit !== null && bodyLimit < input.computeRequestMaxBytes) {
		out.push({
			id: 'body-size',
			level: 'warning',
			title: 'Large solves and uploads will be rejected',
			detail: `The server accepts requests up to ${values.BODY_SIZE_LIMIT}, smaller than the ${formatBytes(input.computeRequestMaxBytes)} a solve may send. Bigger ones fail with "413 Payload Too Large" before Selva sees them.`,
			fix: [
				set('BODY_SIZE_LIMIT', `${Math.ceil(input.computeRequestMaxBytes / 1024 / 1024)}M`),
				restart
			],
			keys: ['BODY_SIZE_LIMIT']
		});
	}

	if (values.ALLOW_INSECURE_COOKIES === true) {
		out.push({
			id: 'insecure-cookies',
			level: 'warning',
			title: 'Sign-in cookies may be sent over http',
			detail:
				'Meant for testing on a local network. Anyone on the same network can copy a session and act as that user.',
			fix: ['npx selva config unset ALLOW_INSECURE_COOKIES', restart],
			keys: ['ALLOW_INSECURE_COOKIES']
		});
	}

	if (!input.dev && env.NODE_ENV !== 'production') {
		out.push({
			id: 'not-production',
			level: 'warning',
			title: 'Running in development mode',
			detail:
				'Error pages show stack traces and cookies aren’t marked Secure. npx selva restart starts it through pm2, which sets NODE_ENV=production.',
			fix: [restart],
			keys: ['NODE_ENV']
		});
	}

	if (values.SELVA_FLAG_COMPUTE_DEBUG === 'verbose') {
		out.push({
			id: 'verbose-debug',
			level: 'warning',
			title: 'Logs may contain what users solved',
			detail:
				'Verbose compute debugging writes Rhino.Compute’s raw error bodies to the log, and deleting a user doesn’t remove them from there. Turn it off once you’re done debugging.',
			fix: ['npx selva config unset SELVA_FLAG_COMPUTE_DEBUG', restart],
			keys: ['SELVA_FLAG_COMPUTE_DEBUG']
		});
	}

	if (values.SMTP_HOST && !values.SMTP_FROM) {
		out.push({
			id: 'smtp-from',
			level: 'warning',
			title: 'Mail has no sender address',
			detail: 'A mail server is set but no sender address, so invite emails can’t be sent.',
			fix: [set('SMTP_FROM', 'selva@your-domain'), restart],
			keys: ['SMTP_FROM']
		});
	}

	for (const r of input.rotation) {
		const name = r.key === 'SELVA_HMAC_KEY' ? 'signing key' : 'encryption key';
		const finish = `npx selva keys rotate ${r.key === 'SELVA_HMAC_KEY' ? 'hmac' : 'at-rest'} --finish`;
		const atRestBusy = r.key === 'SELVA_AT_REST_KEY' && (input.atRestOnPreviousKey ?? 0) > 0;
		if (r.state === 'active') {
			out.push({
				id: `rotation:${r.key}`,
				level: 'info',
				title: `Changing the ${name}`,
				detail: `The old ${name} keeps working for ${r.daysLeft} more ${r.daysLeft === 1 ? 'day' : 'days'}, until ${r.expires?.slice(0, 10)}. Nothing to do: it stops on its own.`,
				keys: [`${r.key}_PREVIOUS`]
			});
		} else if (r.state === 'expired' || r.state === 'no-deadline') {
			out.push({
				id: `rotation:${r.key}`,
				level: 'warning',
				title:
					r.state === 'expired'
						? `The old ${name} has expired but is still in .env`
						: `The old ${name} never expires`,
				detail:
					r.state === 'expired'
						? `It stopped working on ${r.expires?.slice(0, 10)}. Remove it to finish the change.`
						: `It was added without an end date, so a leaked old key stays useful forever. Finish the change to remove it.`,
				...(atRestBusy ? {} : { fix: [finish, restart] }),
				keys: [`${r.key}_PREVIOUS`]
			});
		}
	}

	if (input.atRestOnPreviousKey !== null) {
		const n = input.atRestOnPreviousKey;
		out.push(
			n > 0
				? {
						id: 'at-rest-pending',
						level: 'warning',
						title: `${n} stored compute API ${n === 1 ? 'key is' : 'keys are'} still on the old encryption key`,
						detail:
							'Restart the app to re-encrypt them. Don’t finish the key change before this reaches zero, or they become unreadable.',
						fix: [restart],
						keys: ['SELVA_AT_REST_KEY_PREVIOUS']
					}
				: {
						id: 'at-rest-pending',
						level: 'info',
						title: 'Every stored compute API key is on the new encryption key',
						detail: 'The old encryption key is no longer needed. Finishing removes it.',
						fix: ['npx selva keys rotate at-rest --finish', restart],
						keys: ['SELVA_AT_REST_KEY_PREVIOUS']
					}
		);
	}

	const order: Record<CheckLevel, number> = { error: 0, warning: 1, info: 2 };
	return out.sort((a, b) => order[a.level] - order[b.level]);
}

function sameOrigin(a: string, b: string): boolean | null {
	try {
		return new URL(a).origin === new URL(b).origin;
	} catch {
		return null;
	}
}

function isLoopbackUrl(url: string): boolean {
	try {
		const h = new URL(url).hostname;
		return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
	} catch {
		return false;
	}
}

/** adapter-node's BODY_SIZE_LIMIT: bytes, or a K/M/G suffix, or Infinity. Null when unreadable. */
export function parseBodySize(raw: string | undefined): number | null {
	if (!raw) return null;
	const v = raw.trim();
	if (v.toLowerCase() === 'infinity') return Infinity;
	const m = /^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i.exec(v);
	if (!m) return null;
	const mult = { k: 1024, m: 1024 ** 2, g: 1024 ** 3 }[(m[2] ?? '').toLowerCase()] ?? 1;
	return Number(m[1]) * mult;
}

function formatBytes(bytes: number): string {
	if (bytes >= 1024 ** 3) return `${+(bytes / 1024 ** 3).toFixed(1)} GB`;
	if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`;
	return `${Math.round(bytes / 1024)} KB`;
}
