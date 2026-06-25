// ============================================================================
// Release channel
// ============================================================================
//
// Which published line of @selvajs/* this deployment tracks: "stable" (npm
// `latest` dist-tag) or "beta" (npm `beta` dist-tag). The choice is persisted
// as a tiny JSON file in the deployment dir (next to package.json /
// ecosystem.config.cjs) — NOT a provider store — because BOTH the SvelteKit
// process AND the bash update runner must read it, and the runner can't reach a
// DB. The file is the single source of truth; absent/invalid ⇒ "stable".
//
// Storage lives beside the deployment the same way the update runner detects it:
// the dir holding node_modules/@selvajs/selva (probed from cwd upward, or pinned
// via INSTALL_DIR). Keeping the file there means it travels with the deployment
// and is reachable from the runner's cwd.

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { env } from '$env/dynamic/private';

export type ReleaseChannel = 'stable' | 'beta';

// Filename of the persisted channel, in the deployment dir.
const CHANNEL_FILE = 'selva-channel.json';

// npm dist-tag each channel resolves to. Stable tracks `latest`; beta tracks
// the `beta` dist-tag (where release.yml publishes x.y.z-beta.N pre-releases).
export function channelTag(channel: ReleaseChannel): string {
	return channel === 'beta' ? 'beta' : 'latest';
}

// Registry endpoint for a channel's currently-published @selvajs/selva version.
export function channelRegistryUrl(channel: ReleaseChannel): string {
	return `https://registry.npmjs.org/@selvajs%2Fselva/${channelTag(channel)}`;
}

function isChannel(v: unknown): v is ReleaseChannel {
	return v === 'stable' || v === 'beta';
}

// Locate the deployment dir: the one containing node_modules/@selvajs/selva.
// Mirrors detectUpdatePlan / readInstalledVersion so the channel file lands in
// the same place all three agree on. Returns null when not in a deployment.
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

// Path to the channel file, even if it doesn't exist yet. Falls back to the
// deployment dir, or — when we're not in a recognizable deployment (dev, tests)
// — to the cwd, so writeChannel never throws for lack of a target.
function channelFilePath(): string {
	return join(deploymentDir() ?? process.cwd(), CHANNEL_FILE);
}

// Read the persisted channel. Any failure (missing file, bad JSON, unknown
// value) degrades to "stable" — the safe default that matches the historic
// behavior before channels existed.
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

// Persist the chosen channel. Validates the input and writes atomically-ish
// (single writeFileSync; the file is a few bytes). Throws only if the directory
// is unwritable — the caller (a form action) surfaces that to the operator.
export function writeChannel(channel: ReleaseChannel): void {
	if (!isChannel(channel)) throw new Error(`Invalid release channel: ${channel}`);
	writeFileSync(channelFilePath(), JSON.stringify({ channel }, null, 2) + '\n', 'utf8');
}
