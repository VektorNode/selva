import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { findServerById } from '@selvajs/platform';
import { requireManageCompute } from '$lib/server/access.server';
import { ComputeServerStats } from '@selvajs/compute/grasshopper';
import { classifyProbeFailure } from '@selvajs/compute/core';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireManageCompute(locals);

	const serverId = url.searchParams.get('serverId');
	if (!serverId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'serverId required');

	// Admin route — read the full config; admin can probe any server. Only the
	// probed server's key is decrypted.
	const store = getComputeServerConfigStore();
	const config = await store.getConfig(locals.ctx!);
	const server = findServerById(config, serverId);
	if (!server) apiError(404, ApiErrorCode.NOT_FOUND, 'Server not found');

	const apiKey = server.hasApiKey ? await store.getServerApiKey(locals.ctx!, server.id) : undefined;
	const stats = new ComputeServerStats(server.serverUrl, apiKey);
	try {
		// Probe liveness first; only fan out to version/plugins when reachable.
		const probe = await stats.probeServer();
		if (!probe.online) {
			const failure = classifyProbeFailure(probe);
			return json({
				reachable: false,
				ready: false,
				// `retryable: false` is the client's cue to stop polling: a refused
				// connection or a rejected key cannot resolve itself, and retrying it
				// for the full window leaves the operator staring at a spinner that
				// was never going to turn green.
				retryable: failure?.retryable ?? true,
				failureReason: failure?.verdict ?? null,
				failureSummary: failure?.summary ?? null,
				rhinoVersion: null,
				computeVersion: null,
				selvaInstalled: false,
				selvaVersion: null,
				plugins: {},
				activeChildren: null,
				idleSpanSeconds: null
			});
		}

		// `initialize: false` keeps this a passive read — never spawn children just
		// to count them, or the status probe would wake (and bill) an idle server.
		const [version, plugins, activeChildren, idleSpanSeconds] = await Promise.all([
			stats.getVersion(),
			stats.getInstalledPlugins('gh'),
			stats.getActiveChildren({ initialize: false }),
			stats.getIdleSpan()
		]);

		// The proxy answers `/` (reachable) well before a child finishes loading
		// Grasshopper add-ons, so a fresh boot briefly reports no Selva. Distinguish
		// "still loading" from "genuinely not installed" using the plugin inventory:
		//   - plugins === null  → `/plugins/gh/installed` couldn't be read (no child
		//     up yet, or it errored) → not ready, the client should keep retrying.
		//   - plugins === {}    → same story: a child that has finished enumerating
		//     add-ons always reports at least the ambient ones, so an empty map means
		//     the inventory isn't populated yet → not ready.
		//   - plugins populated → Grasshopper has enumerated its add-ons. Whether or
		//     not Selva is among them is now authoritative → ready.
		const inventoryLoaded = plugins !== null && Object.keys(plugins).length > 0;
		const installed = plugins ?? {};
		const selvaVersion: string | null = installed['Selva'] ?? null;

		return json({
			reachable: true,
			// `ready` gates the client's retry loop: once the inventory has loaded we
			// trust `selvaInstalled` (true or false); until then we're still booting.
			ready: inventoryLoaded,
			// A reachable server is always worth another poll — it may still be
			// enumerating add-ons, and `activeChildren` climbing is the feedback the
			// operator is watching for.
			retryable: true,
			failureReason: null,
			failureSummary: null,
			rhinoVersion: version?.rhino ?? null,
			computeVersion: version?.compute ?? null,
			selvaInstalled: selvaVersion !== null,
			selvaVersion,
			plugins: installed,
			activeChildren,
			idleSpanSeconds
		});
	} catch {
		return json({
			reachable: false,
			ready: false,
			// An unclassified throw is not evidence the server is permanently down.
			retryable: true,
			failureReason: null,
			failureSummary: null,
			rhinoVersion: null,
			computeVersion: null,
			selvaInstalled: false,
			selvaVersion: null,
			plugins: {},
			activeChildren: null,
			idleSpanSeconds: null
		});
	} finally {
		await stats.dispose();
	}
};
