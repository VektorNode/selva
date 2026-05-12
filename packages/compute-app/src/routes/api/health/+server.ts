import { json, type RequestHandler } from '@sveltejs/kit';
import { execSync } from 'child_process';

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
 */
export const GET: RequestHandler = async () => {
	return json({
		status: 'ok',
		timestamp: new Date().toISOString(),
		commit: STARTUP_COMMIT
	});
};
