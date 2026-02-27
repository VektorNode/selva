import type { RequestHandler } from './$types';
import { getServerConfig } from '$lib/server/config.server';
import { json } from '@sveltejs/kit';

const YAK_API = 'https://yak.rhino3d.com/packages';
const SELVA_PACKAGE_NAME = 'selva';

function parseVersion(v: string): number[] {
	return v.split('.').map((n) => parseInt(n, 10) || 0);
}

function isOutdated(installed: string, latest: string): boolean {
	const a = parseVersion(installed);
	const b = parseVersion(latest);
	const len = Math.max(a.length, b.length);
	for (let i = 0; i < len; i++) {
		const ai = a[i] ?? 0;
		const bi = b[i] ?? 0;
		if (bi > ai) return true;
		if (ai > bi) return false;
	}
	return false;
}

export const GET: RequestHandler = async () => {
	const config = getServerConfig();

	// Get installed plugins from compute server to find the installed Selva version
	const installedUrl = new URL('/plugins/gh/installed', config.computeServerUrl).toString();
	const headers: Record<string, string> = {};
	if (config.computeApiKey) {
		headers['RhinoComputeKey'] = config.computeApiKey;
	}

	let installed: Record<string, string>;
	try {
		const response = await fetch(installedUrl, { method: 'GET', headers });
		if (!response.ok) {
			return json({ error: `Compute server returned status ${response.status}` }, { status: 502 });
		}
		installed = await response.json();
	} catch (error) {
		return json(
			{
				error:
					error instanceof Error
						? `Failed to reach compute server: ${error.message}`
						: 'Failed to reach compute server'
			},
			{ status: 502 }
		);
	}

	// Find Selva in the installed list (case-insensitive)
	console.log('Installed plugins:', installed);
	const selvaEntry = Object.entries(installed).find(
		([name]) => name.toLowerCase() === SELVA_PACKAGE_NAME
	);

	if (!selvaEntry) {
		return json({ error: 'Selva not found in installed plugins' }, { status: 404 });
	}

	const [, installedVersion] = selvaEntry;

	// Check Yak for the latest Selva version
	let latestVersion: string;
	try {
		const yakRes = await fetch(`${YAK_API}/${SELVA_PACKAGE_NAME}`);
		if (!yakRes.ok) {
			return json({ error: `Yak returned status ${yakRes.status}` }, { status: 502 });
		}
		const yakData = await yakRes.json();
		latestVersion = yakData.version;
	} catch (error) {
		return json(
			{
				error:
					error instanceof Error
						? `Failed to reach Yak: ${error.message}`
						: 'Failed to reach Yak'
			},
			{ status: 502 }
		);
	}

	return json({
		updateAvailable: isOutdated(installedVersion, latestVersion),
		installedVersion,
		latestVersion
	});
};
