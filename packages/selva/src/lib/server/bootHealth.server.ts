import type { SchemaVersionReport, SecretVerificationReport } from '@selvajs/platform';
import { renderThrown } from '@selvajs/server/logging';
import { getLogger, providers } from './providers.server.js';

/**
 * Boot-time integrity report. Populated once on first import, then cached.
 * Checks at-rest secret decryption (compute server apiKeys) for any provider
 * that exposes `verifySecrets` — both the local (on-disk) and Supabase (in-DB)
 * compute-server stores encrypt apiKeys and implement it.
 *
 * Goals:
 *  - Fail loudly at deploy time when `SELVA_AT_REST_KEY` doesn't match what
 *    `.selva-data/compute.config.json` was encrypted with, so a rotated key
 *    or a misplaced backup doesn't surface as a blank `/projects` page later.
 *  - Drive `/api/health` to non-200 when degraded, so load balancers and
 *    monitoring catch the state without a human reading server logs.
 *
 * Does NOT block request serving — paired with per-row tolerance in
 * `LocalComputeServerStore.decryptApiKeys`, the app keeps rendering and an
 * operator can recover via `/admin/compute`. See docs/Troubleshooting.md.
 */
export interface BootHealth {
	checkedAt: string;
	atRestSecrets: SecretVerificationReport | null;
	/**
	 * App↔DB schema handshake (audit O3) — null when the data provider doesn't
	 * implement it (local provider: schema and app ship together). A not-ok
	 * report degrades `/api/health` to 503, which also makes the self-update
	 * runner's health probe roll back an update whose migrations weren't
	 * applied, instead of leaving a skewed app serving PGRST errors.
	 */
	schemaVersion: SchemaVersionReport | null;
}

let cached: BootHealth | null = null;
let inflight: Promise<BootHealth> | null = null;

async function run(): Promise<BootHealth> {
	let atRestSecrets: SecretVerificationReport | null = null;

	const store = providers.data.computeServer;
	if (typeof store.verifySecrets === 'function') {
		try {
			atRestSecrets = await store.verifySecrets();
		} catch (err) {
			getLogger().error('verifySecrets threw — treating as failure', {
				component: 'boot',
				err: renderThrown(err)
			});
			atRestSecrets = {
				ok: false,
				plaintextFound: false,
				failures: [
					{
						serverId: '(unknown)',
						serverLabel: '(unknown)',
						reason: 'key_mismatch',
						cause: err instanceof Error ? err.message : String(err)
					}
				]
			};
		}
	}

	if (atRestSecrets && !atRestSecrets.ok) {
		for (const f of atRestSecrets.failures) {
			getLogger().error('At-rest secret verification failed for compute server', {
				component: 'boot',
				serverLabel: f.serverLabel,
				serverId: f.serverId,
				reason: f.reason,
				cause: f.cause
			});
		}
		getLogger().error(
			'At-rest secret verification failed. /api/health will return 503. ' +
				'Recover by re-entering the affected apiKeys via /admin/compute, or by ' +
				'restoring the original SELVA_AT_REST_KEY. See docs/Troubleshooting.md.',
			{ component: 'boot' }
		);
	}

	let schemaVersion: SchemaVersionReport | null = null;
	const data = providers.data;
	if (typeof data.verifySchemaVersion === 'function') {
		try {
			schemaVersion = await data.verifySchemaVersion();
		} catch (err) {
			// The contract says it must not throw; treat a throw as a failed check.
			getLogger().error('verifySchemaVersion threw — treating as failure', {
				component: 'boot',
				err: renderThrown(err)
			});
			schemaVersion = {
				ok: false,
				expected: '(unknown)',
				actual: null,
				message: err instanceof Error ? err.message : String(err)
			};
		}
	}

	if (schemaVersion && !schemaVersion.ok) {
		getLogger().error('Database schema handshake failed. /api/health will return 503.', {
			component: 'boot',
			expected: schemaVersion.expected,
			actual: schemaVersion.actual ?? 'unavailable',
			detail: schemaVersion.message
		});
	}

	return {
		checkedAt: new Date().toISOString(),
		atRestSecrets,
		schemaVersion
	};
}

/**
 * Returns the cached boot health report. Runs the underlying checks at most
 * once — subsequent callers receive the same result. Safe to call from many
 * routes concurrently; in-flight callers share a single promise.
 *
 * The report does NOT auto-refresh after an operator fixes the underlying
 * issue. Restart the process to re-run the boot check. (Conscious choice:
 * boot health represents the state at boot, by definition.)
 */
export function getBootHealth(): Promise<BootHealth> {
	if (cached) return Promise.resolve(cached);
	if (inflight) return inflight;
	inflight = run().then((result) => {
		cached = result;
		inflight = null;
		return result;
	});
	return inflight;
}

/**
 * Synchronous accessor — returns null until the first `getBootHealth()` call
 * has resolved. Health endpoint awaits `getBootHealth()` directly; this
 * accessor exists for places where awaiting is awkward.
 */
export function getBootHealthSync(): BootHealth | null {
	return cached;
}

export function isDegraded(report: BootHealth): boolean {
	if (report.atRestSecrets !== null && !report.atRestSecrets.ok) return true;
	if (report.schemaVersion !== null && !report.schemaVersion.ok) return true;
	return false;
}
