import { json, type RequestHandler } from '@sveltejs/kit';
import { execSync } from 'child_process';
import { getBootHealth, isDegraded } from '$lib/server/bootHealth.server';

// Captured once at module load so it reflects the commit of the *running* process,
// not whatever the working tree looks like later (e.g. mid-update).
const STARTUP_COMMIT = (() => {
	try {
		return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
	} catch {
		return null;
	}
})();

/**
 * Health check endpoint for load balancers and orchestration systems.
 * Used by Docker healthchecks, Kubernetes liveness probes, and monitoring tools.
 *
 * The `commit` field acts as a process fingerprint — clients polling after a
 * restart can confirm the *new* process is responding (not the old one about
 * to be killed) by watching for the commit value to change.
 *
 * Returns 503 with `status: "degraded"` when boot-time integrity checks
 * failed (e.g. compute server apiKeys can't be decrypted under the current
 * `SELVA_AT_REST_KEY`). The body lists which servers and why, so an operator
 * curling the endpoint can diagnose without server-log access. The app
 * still serves requests in this state (per-row tolerance) — the 503 is
 * specifically a signal for load balancers / monitoring.
 */
export const GET: RequestHandler = async () => {
	const boot = await getBootHealth();
	const degraded = isDegraded(boot);

	const body = {
		status: degraded ? 'degraded' : 'ok',
		timestamp: new Date().toISOString(),
		commit: STARTUP_COMMIT,
		boot
	};

	return json(body, { status: degraded ? 503 : 200 });
};
