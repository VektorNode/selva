import { json, type RequestHandler } from '@sveltejs/kit';
import { LocalComputeServerStore, type SecretVerificationReport } from '@selvajs/local-provider';
import { providers } from '$lib/server/providers.server';
import { requirePermission } from '$lib/server/access.server';

/**
 * On-demand admin health check. Unlike `/api/health` (which serves the cached
 * BOOT snapshot for load balancers), this re-runs the integrity checks LIVE so
 * the result reflects the current state — an operator who just re-entered a
 * compute apiKey via /admin/compute sees "ok" immediately, without restarting.
 *
 * Today the only runtime-checkable integrity signal is at-rest secret
 * decryption for the local provider (the compute-key state that otherwise
 * surfaces as opaque 401/403s from Rhino.Compute). Other providers don't
 * encrypt at this layer, so they report `checkable: false` rather than a
 * misleading green.
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

export const GET: RequestHandler = async ({ locals }) => {
	requirePermission(locals, 'instance_admin');

	const checks: HealthCheck[] = [];

	const store = providers.data.computeServer;
	if (store instanceof LocalComputeServerStore) {
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
