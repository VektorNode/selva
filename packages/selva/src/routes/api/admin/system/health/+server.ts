import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { randomUUID } from 'node:crypto';
import { writeFile, unlink, mkdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { env as privateEnv } from '$env/dynamic/private';
import { LocalComputeServerStore } from '@selvajs/local-provider';
import {
	findServerById,
	type SchemaVersionReport,
	type SecretVerificationReport
} from '@selvajs/platform';
import { providers, getComputeServerConfigStore } from '$lib/server/providers.server';
import { requirePermission } from '$lib/server/access.server';

/**
 * On-demand admin health check. Unlike `/api/health` (which serves the cached
 * BOOT snapshot for load balancers), this re-runs the integrity checks LIVE so
 * the result reflects the current state — an operator who just re-entered a
 * compute apiKey via /admin/compute sees "ok" immediately, without restarting.
 *
 * Checks (each reports `not_applicable` rather than a misleading green when
 * it can't run against the active provider):
 *   1. At-rest secret decryption — stored compute API keys decrypt under the
 *      current SELVA_AT_REST_KEY (local provider only; the compute-key state
 *      that otherwise surfaces as opaque 401/403s from Rhino.Compute).
 *   2. Compute reachability — the default platform server answers
 *      `/healthcheck`. Catches "key decrypts fine but the server is down", a
 *      gap check #1 can't see: a healthy at-rest key with an unreachable
 *      server still fails every solve.
 *   3. Data path writable — for the local provider, a temp file can be
 *      written + deleted under DATA_PATH. Catches disk-full / permission
 *      regressions before they corrupt a JSON store mid-write.
 *
 * `instance_admin` only — this reveals which compute servers failed and why.
 */

type CheckStatus = 'ok' | 'degraded' | 'not_applicable' | 'error';

interface HealthCheck {
	id: string;
	label: string;
	status: CheckStatus;
	/** Operator-facing summary. Always set. */
	summary: string;
	/** Concrete next step when not ok. */
	remediation?: string;
}

function atRestSecretsCheck(report: SecretVerificationReport | null): HealthCheck {
	const base = { id: 'at-rest-secrets', label: 'Compute server secrets' };

	if (report === null) {
		return {
			...base,
			status: 'not_applicable',
			summary:
				'The active data provider does not encrypt secrets at this layer — nothing to verify.'
		};
	}

	if (report.ok) {
		return {
			...base,
			status: 'ok',
			summary: 'All stored compute server API keys decrypt under the current SELVA_AT_REST_KEY.'
		};
	}

	const failed = report.failures
		.map((f) => `"${f.serverLabel}" (${f.reason}${f.cause ? `: ${f.cause}` : ''})`)
		.join(', ');
	const plaintext = report.plaintextFound;
	return {
		...base,
		status: 'degraded',
		summary: `${report.failures.length} compute server key(s) could not be loaded: ${failed}.`,
		remediation: plaintext
			? 'A key is stored in plaintext on disk — re-enter it via /admin/compute so it is encrypted.'
			: 'The stored ciphertext does not match the current SELVA_AT_REST_KEY (rotated key or ' +
				'restored backup). Re-enter the affected keys via /admin/compute, or restore the ' +
				'original SELVA_AT_REST_KEY, then run this check again.'
	};
}

function schemaVersionCheck(report: SchemaVersionReport | null): HealthCheck {
	const base = { id: 'schema-version', label: 'Database schema' };

	if (report === null) {
		return {
			...base,
			status: 'not_applicable',
			summary:
				'The active data provider migrates with the app — there is no separate schema to verify.'
		};
	}

	if (report.ok) {
		return {
			...base,
			status: 'ok',
			summary: `Database migration head ${report.actual} satisfies the app's expected ${report.expected}.`
		};
	}

	return {
		...base,
		status: 'degraded',
		summary:
			report.message ??
			`Database migration head ${report.actual ?? 'unavailable'} is behind the app's expected ${report.expected}.`,
		remediation:
			'Sync the provider migrations into your Supabase project and run `npx supabase db push`, ' +
			'then restart the app. `selva doctor` runs the same check from the CLI.'
	};
}

const COMPUTE_PING_TIMEOUT_MS = 8000;

/**
 * Ping the global default compute server's `/healthcheck`. We probe the
 * default specifically because that's the server every solve falls back to;
 * a degraded default breaks the baseline for all orgs. Org-private and
 * non-default platform servers are out of scope here — they have their own
 * per-server status probe at /api/admin/compute/status.
 */
async function computeReachabilityCheck(locals: App.Locals): Promise<HealthCheck> {
	const base = { id: 'compute-reachable', label: 'Default compute server' };

	let config;
	try {
		config = await getComputeServerConfigStore().getConfig(locals.ctx!);
	} catch (err) {
		return {
			...base,
			status: 'error',
			summary: `Could not read compute config: ${err instanceof Error ? err.message : String(err)}`
		};
	}

	const server = config.defaultServerId
		? findServerById(config, config.defaultServerId)
		: undefined;
	if (!server) {
		return {
			...base,
			status: 'not_applicable',
			summary: 'No default compute server is configured — nothing to reach.',
			remediation: 'Add a server and set it as default in /admin/compute.'
		};
	}

	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), COMPUTE_PING_TIMEOUT_MS);
	try {
		const headers: Record<string, string> = {};
		if (server.hasApiKey) {
			const apiKey = await getComputeServerConfigStore().getServerApiKey(locals.ctx!, server.id);
			if (apiKey) headers['RhinoComputeKey'] = apiKey;
		}
		const res = await fetch(new URL('/healthcheck', server.serverUrl).toString(), {
			signal: controller.signal,
			headers
		});
		if (res.ok) {
			return { ...base, status: 'ok', summary: `"${server.label}" answered /healthcheck (200).` };
		}
		return {
			...base,
			status: 'degraded',
			summary: `"${server.label}" responded ${res.status} to /healthcheck.`,
			remediation:
				res.status === 401 || res.status === 403
					? 'Authentication rejected — verify the API key in /admin/compute.'
					: 'The server is reachable but unhealthy. Check the Rhino.Compute host.'
		};
	} catch (err) {
		const aborted = err instanceof Error && err.name === 'AbortError';
		return {
			...base,
			status: 'degraded',
			summary: aborted
				? `"${server.label}" did not respond within ${COMPUTE_PING_TIMEOUT_MS / 1000}s.`
				: `"${server.label}" is unreachable: ${err instanceof Error ? err.message : String(err)}.`,
			remediation: `Confirm the Rhino.Compute host is running and ${server.serverUrl} is correct.`
		};
	} finally {
		clearTimeout(timer);
	}
}

/**
 * Write + delete a temp file under DATA_PATH to prove the local provider can
 * still persist. The JSON stores read-modify-write without a fallback, so a
 * full disk or a permission change (e.g. ownership drift after a restore)
 * corrupts data on the next write — catch it here while it's still just a
 * failed health check.
 */
async function dataPathWritableCheck(): Promise<HealthCheck> {
	const base = { id: 'data-path-writable', label: 'Data path writable' };

	// Only meaningful when a local store is actually backing the deployment.
	if (!(providers.data.computeServer instanceof LocalComputeServerStore)) {
		return {
			...base,
			status: 'not_applicable',
			summary: 'The active data provider does not persist to a local DATA_PATH.'
		};
	}

	const dataPath = privateEnv.DATA_PATH;
	if (!dataPath) {
		return {
			...base,
			status: 'error',
			summary: 'DATA_PATH is unset but the local provider is active.',
			remediation: 'Set DATA_PATH in .env and restart.'
		};
	}

	const absolute = resolve(dataPath);
	const probe = join(absolute, `.health-probe-${randomUUID()}`);
	try {
		await mkdir(absolute, { recursive: true });
		await writeFile(probe, 'ok');
		await unlink(probe);
		return { ...base, status: 'ok', summary: `DATA_PATH (${dataPath}) is writable.` };
	} catch (err) {
		return {
			...base,
			status: 'degraded',
			summary: `DATA_PATH (${dataPath}) is not writable: ${err instanceof Error ? err.message : String(err)}.`,
			remediation:
				'Check free disk space and that the directory is owned by the user running the app ' +
				'(`df -h`, `ls -la`).'
		};
	}
}

export const GET: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');

	const checks: HealthCheck[] = [];

	const store = providers.data.computeServer;
	if (typeof store.verifySecrets === 'function') {
		try {
			checks.push(atRestSecretsCheck(await store.verifySecrets()));
		} catch (err) {
			checks.push({
				id: 'at-rest-secrets',
				label: 'Compute server secrets',
				status: 'error',
				summary: `Verification threw: ${err instanceof Error ? err.message : String(err)}`,
				remediation: 'Check server logs (`pm2 logs selva-compute`) for the underlying error.'
			});
		}
	} else {
		checks.push(atRestSecretsCheck(null));
	}

	// Live app↔DB schema handshake (audit O3) — unlike boot health this re-runs
	// on every request, so an operator sees green right after `db push` without
	// restarting first (the boot report itself stays stale by design).
	const data = providers.data;
	if (typeof data.verifySchemaVersion === 'function') {
		checks.push(schemaVersionCheck(await data.verifySchemaVersion()));
	} else {
		checks.push(schemaVersionCheck(null));
	}

	// Reachability + writability run in parallel — independent of each other
	// and of the at-rest check above. Each self-contains its error handling.
	checks.push(...(await Promise.all([computeReachabilityCheck(locals), dataPathWritableCheck()])));

	// Worst status wins for the overall verdict. `not_applicable` never
	// degrades the overall result.
	const rank: Record<CheckStatus, number> = {
		ok: 0,
		not_applicable: 0,
		degraded: 2,
		error: 3
	};
	const overall = checks.reduce<CheckStatus>(
		(worst, c) => (rank[c.status] > rank[worst] ? c.status : worst),
		'ok'
	);

	return json({ overall, checkedAt: new Date().toISOString(), checks });
};
