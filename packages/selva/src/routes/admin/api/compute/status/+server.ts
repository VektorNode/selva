import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { apiError, ApiErrorCode } from '$lib/server/api-errors';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { findServerById } from '@selvajs/platform';
import { requireManageCompute } from '$lib/server/access.server';
import { ComputeServerStats } from '@selvajs/compute/core';

export const GET: RequestHandler = async ({ url, locals }) => {
	requireManageCompute(locals);

	const serverId = url.searchParams.get('serverId');
	if (!serverId) apiError(400, ApiErrorCode.VALIDATION_FAILED, 'serverId required');

	// Admin route — read the full config; admin can probe any server.
	const config = await getComputeServerConfigStore().getConfig(locals.ctx!);
	const server = findServerById(config, serverId);
	if (!server) apiError(404, ApiErrorCode.NOT_FOUND, 'Server not found');

	const stats = new ComputeServerStats(server.serverUrl, server.apiKey);
	try {
		// Probe liveness first; only fan out to version/plugins when reachable.
		const reachable = await stats.isServerOnline();
		if (!reachable) {
			return json({
				reachable: false,
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

		const installed = plugins ?? {};
		const selvaVersion: string | null = installed['Selva'] ?? null;

		return json({
			reachable: true,
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
