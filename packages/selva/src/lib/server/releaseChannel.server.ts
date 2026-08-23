// ============================================================================
// Release channel
// ============================================================================
//
// Which published line of @selvajs/* this deployment tracks: "stable" (npm
// `latest` dist-tag) or "beta" (npm `beta` dist-tag). Persisted as a tiny
// JSON file in the deployment dir (next to package.json / ecosystem.config.cjs)
// — not a provider store — because both the SvelteKit process and the bash
// update runner must read it, and the runner can't reach a DB. The file is
// the single source of truth; absent/invalid resolves to "stable".
//
// The deployment dir is found the same way the update runner detects it: the
// dir holding node_modules/@selvajs/selva (probed from cwd upward, or pinned
// via INSTALL_DIR), so the channel file travels with the deployment and is
// reachable from the runner's cwd.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import type { ReleaseChannel } from '@selvajs/server/ops';

export type { ReleaseChannel };

const CHANNEL_FILE = 'selva-channel.json';

export function channelTag(channel: ReleaseChannel): string {
	return channel === 'beta' ? 'beta' : 'latest';
}

export function channelRegistryUrl(channel: ReleaseChannel): string {
	return `https://registry.npmjs.org/@selvajs%2Fselva/${channelTag(channel)}`;
}

function isChannel(v: unknown): v is ReleaseChannel {
	return v === 'stable' || v === 'beta';
}

// Mirrors detectUpdatePlan / readInstalledVersion so the channel file lands
// where all three agree.
function deploymentDir(): string | null {
	const candidates: string[] = [];
	if (env.INSTALL_DIR) candidates.push(env.INSTALL_DIR);
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		candidates.push(dir);
		const parent = join(dir, '..');
		if (parent === dir) break;
		dir = parent;
	}
	for (const d of candidates) {
		if (existsSync(join(d, 'node_modules', '@selvajs', 'selva', 'package.json'))) return d;
	}
	return null;
}

// Falls back to cwd outside a recognizable deployment (dev, tests) so
// writeChannel never throws for lack of a target.
function channelFilePath(): string {
	return join(deploymentDir() ?? process.cwd(), CHANNEL_FILE);
}

export function readChannel(): ReleaseChannel {
	const path = channelFilePath();
	if (!existsSync(path)) return 'stable';
	try {
		const parsed = JSON.parse(readFileSync(path, 'utf8')) as { channel?: unknown };
		return isChannel(parsed.channel) ? parsed.channel : 'stable';
	} catch {
		return 'stable';
	}
}

export function writeChannel(channel: ReleaseChannel): void {
	if (!isChannel(channel)) throw new Error(`Invalid release channel: ${channel}`);
	writeFileSync(channelFilePath(), JSON.stringify({ channel }, null, 2) + '\n', 'utf8');
}
