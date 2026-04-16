import type { PageServerLoad } from './$types';
import { env } from '$env/dynamic/private';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

interface ComputeServerEntry {
	label: string;
	serverUrl: string;
	apiKey?: string;
	timeoutMs?: number;
	retryCount?: number;
}

interface ComputeConfig {
	servers: ComputeServerEntry[];
	defaultServer?: string;
}

export const load: PageServerLoad = async () => {
	try {
		const base = path.resolve(process.cwd(), env.GH_DEFINITIONS_PATH ?? '');
		//TODO: This sould be handled by a provider and not by the compute-app
		//The privder should have a function get and set config, and the compute-app should call those functions instead of directly reading the file
		//Check if i should store that on the server to avoid having to read the file every time, or if i should read it every time to always have the latest config
		const configPath = path.join(base, 'compute.config.json');
		const raw = await fs.readFile(configPath, 'utf-8');
		const config = JSON.parse(raw) as ComputeConfig;
		return {
			servers: config.servers ?? [],
			defaultServer: config.defaultServer ?? config.servers?.[0]?.label ?? ''
		};
	} catch {
		// No compute.config.json yet — start with empty
		return { servers: [], defaultServer: '' };
	}
};
