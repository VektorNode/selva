import { json, type RequestHandler } from '@sveltejs/kit';
import { randomUUID } from 'crypto';
import { createRequire } from 'module';
import { getBootHealth, isDegraded } from '$lib/server/bootHealth.server';

// Per-process fingerprint generated fresh on every boot, so a client polling
// after a restart can confirm the *new* process is answering by watching for
// instanceId to change — even when the new build is the same version (rollback
// / reinstall). This is the reliable signal the update poller keys on; version
// is informational.
const INSTANCE_ID = randomUUID();

// Installed @selvajs/selva version, for display ("updated X → Y"). Resolved
// from the package's own package.json at module load. Best-effort: null if it
// can't be located (shouldn't happen in a real deployment).
const RUNTIME_VERSION = (() => {
	try {
		const require = createRequire(import.meta.url);
		return require('@selvajs/selva/package.json').version as string;
	} catch {
		return null;
	}
})();

/**
 * Health check endpoint for load balancers and orchestration systems.
 * Used by Docker healthchecks, Kubernetes liveness probes, and monitoring tools.
 *
 * The `instanceId` field is a per-boot fingerprint — clients polling after a
 * restart confirm the *new* process is responding (not the old one about to be
 * killed) by watching for the value to change.
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
		instanceId: INSTANCE_ID,
		version: RUNTIME_VERSION,
		boot
	};

	return json(body, { status: degraded ? 503 : 200 });
};
