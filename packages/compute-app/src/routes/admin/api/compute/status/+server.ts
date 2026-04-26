import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { getComputeServerConfigStore } from '$lib/server/providers.server';
import { resolveServerById } from '@selvajs/platform';
import { requireManageCompute } from '$lib/server/access.server';

const TIMEOUT_MS = 8000;

function fetchFromServer(serverUrl: string, apiKey: string | undefined, path: string) {
	const controller = new AbortController();
	const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
	const headers: Record<string, string> = {};
	if (apiKey) headers['RhinoComputeKey'] = apiKey;
	return fetch(new URL(path, serverUrl).toString(), { signal: controller.signal, headers }).finally(
		() => clearTimeout(timer)
	);
}

export const GET: RequestHandler = async ({ url, locals }) => {
	requireManageCompute(locals);

	const serverId = url.searchParams.get('serverId');
	if (!serverId) throw error(400, 'serverId required');

	// Admin compute route manages the instance pool — strip actingOrgId so
	// status lookups match what /admin/api/compute writes. See Permissions.md §3.
	const ctx = { ...locals.ctx!, actingOrgId: undefined, orgPermissions: [] };
	const config = await getComputeServerConfigStore().getConfig(ctx);
	const server = resolveServerById(config, serverId);
	if (!server) throw error(404, 'Server not found');

	try {
		const [healthRes, versionRes, pluginsRes] = await Promise.all([
			fetchFromServer(server.serverUrl, server.apiKey, '/healthcheck'),
			fetchFromServer(server.serverUrl, server.apiKey, '/version'),
			fetchFromServer(server.serverUrl, server.apiKey, '/plugins/gh/installed')
		]);

		const reachable = healthRes.ok;
		const version = versionRes.ok ? await versionRes.json() : null;
		const plugins: Record<string, string> = pluginsRes.ok ? await pluginsRes.json() : {};

		const selvaVersion: string | null = plugins['Selva'] ?? null;

		return json({
			reachable,
			rhinoVersion: version?.rhino ?? null,
			computeVersion: version?.compute ?? null,
			selvaInstalled: selvaVersion !== null,
			selvaVersion,
			plugins
		});
	} catch {
		return json({
			reachable: false,
			rhinoVersion: null,
			computeVersion: null,
			selvaInstalled: false,
			selvaVersion: null,
			plugins: {}
		});
	}
};
