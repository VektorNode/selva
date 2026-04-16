import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { getComputeServerProvider } from '$lib/server/providers.server';
import type { ComputeServerConfig } from '@selva/platform/compute';

interface ComputeConfig {
	servers: (ComputeServerConfig & { label: string })[];
	defaultServer?: string;
}

function getConfigPath(): string {
	const base = env.GH_DEFINITIONS_PATH;
	if (!base) throw error(500, 'GH_DEFINITIONS_PATH is not set');
	return path.join(path.resolve(process.cwd(), base), 'compute.config.json');
}

// GET — list configured compute servers
export const GET: RequestHandler = async () => {
	try {
		const servers = await getComputeServerProvider().listServers();

		// Also try to read defaultServer from the raw file
		let defaultServer: string | undefined;
		try {
			const raw = await fs.readFile(getConfigPath(), 'utf-8');
			defaultServer = (JSON.parse(raw) as ComputeConfig).defaultServer;
		} catch {
			// file may not exist yet
		}

		return json({ servers, defaultServer });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Compute GET] Failed:', err);
		throw error(500, 'Failed to load compute server config');
	}
};

// PUT — save compute.config.json
export const PUT: RequestHandler = async ({ request }) => {
	const body = await request.json().catch(() => null);
	if (!body || typeof body !== 'object') throw error(400, 'Invalid request body');

	const config = body as ComputeConfig;

	if (!Array.isArray(config.servers)) throw error(400, 'servers must be an array');
	for (const s of config.servers) {
		if (!s.label || typeof s.label !== 'string') throw error(400, 'Each server needs a label');
		if (!s.serverUrl || typeof s.serverUrl !== 'string') throw error(400, 'Each server needs a serverUrl');
	}

	try {
		const configPath = getConfigPath();
		const tmp = `${configPath}.tmp`;
		await fs.writeFile(tmp, JSON.stringify(config, null, '\t'), 'utf-8');
		await fs.rename(tmp, configPath);
		return json({ success: true });
	} catch (err) {
		if (err && typeof err === 'object' && 'status' in err) throw err;
		console.error('[Compute PUT] Failed:', err);
		throw error(500, 'Failed to save compute config');
	}
};
