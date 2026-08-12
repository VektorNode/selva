// ============================================================================
// Update availability check
// ============================================================================
//
// Queries the npm registry for the published @selvajs/selva version on the
// deployment's channel and compares it to the installed version, so the
// admin System page can show an "update available" badge. The registry fetch
// is injected so it's testable, and every failure path degrades to "no
// update available" rather than throwing — the admin page must never break
// because npm is slow or unreachable.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import { isNewer, satisfiesRange } from '@selvajs/server/ops';
import { channelRegistryUrl, type ReleaseChannel } from './releaseChannel.server';

// Channel-aware comparison lives in `@selvajs/server/ops`; re-exported so
// existing consumers keep importing it from here.
export { isNewer };

/**
 * Whether the host's Node satisfies the target release's `engines.node`.
 *
 * `compatible: null` means we couldn't tell (registry down, no engines field,
 * unparseable range) — the UI must treat that as "proceed", not as a block.
 * npm only enforces engines with `engine-strict=true`, which no deployment
 * sets, so a mismatch installs cleanly and `/api/health` still returns 200
 * (it exercises no Node-version-specific path) — hence this pre-flight.
 */
export interface NodeCompatibility {
	compatible: boolean | null;
	/** The target's `engines.node` range, when the registry reported one. */
	required: string | null;
	/** The Node version this deployment is running. */
	running: string;
}

export interface UpdateAvailability {
	/** The channel this check was run against. */
	channel: ReleaseChannel;
	/** Installed @selvajs/selva version, or null if it couldn't be read. */
	current: string | null;
	/** Latest published version on the channel, or null if the registry was unreachable. */
	latest: string | null;
	/** True when we have both versions and the channel's published one differs (newer, OR a stable revert target). */
	updateAvailable: boolean;
	/** Node engine check against the target release. */
	nodeCompatibility: NodeCompatibility;
}

// Probes cwd upward (and an explicit INSTALL_DIR) the same way the update
// runner detects the deployment dir.
export function readInstalledVersion(): string | null {
	const dirs: string[] = [];
	if (env.INSTALL_DIR) dirs.push(env.INSTALL_DIR);
	let dir = process.cwd();
	for (let i = 0; i < 6; i++) {
		dirs.push(dir);
		const parent = join(dir, '..');
		if (parent === dir) break;
		dir = parent;
	}
	for (const d of dirs) {
		const pkgPath = join(d, 'node_modules', '@selvajs', 'selva', 'package.json');
		if (!existsSync(pkgPath)) continue;
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));
			if (typeof pkg.version === 'string') return pkg.version;
		} catch {
			// fall through to the next candidate
		}
	}
	return null;
}

/**
 * The registry's per-tag manifest carries `engines` alongside `version`, so
 * the Node pre-flight costs no extra request. Uses a short timeout so a slow
 * registry can't hang the caller; returns nulls on any failure.
 */
export interface PublishedManifest {
	version: string | null;
	enginesNode: string | null;
}

export async function fetchLatestManifest(
	fetchImpl: typeof fetch,
	channel: ReleaseChannel = 'stable'
): Promise<PublishedManifest> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 5000);
	try {
		const res = await fetchImpl(channelRegistryUrl(channel), {
			headers: { Accept: 'application/json' },
			signal: ctrl.signal
		});
		if (!res.ok) return { version: null, enginesNode: null };
		const body = (await res.json()) as { version?: unknown; engines?: { node?: unknown } };
		return {
			version: typeof body.version === 'string' ? body.version : null,
			enginesNode: typeof body.engines?.node === 'string' ? body.engines.node : null
		};
	} catch {
		return { version: null, enginesNode: null };
	} finally {
		clearTimeout(timer);
	}
}

export async function fetchLatestVersion(
	fetchImpl: typeof fetch,
	channel: ReleaseChannel = 'stable'
): Promise<string | null> {
	return (await fetchLatestManifest(fetchImpl, channel)).version;
}

export async function checkForUpdate(
	fetchImpl: typeof fetch,
	channel: ReleaseChannel = 'stable',
	runningNode: string = process.versions.node
): Promise<UpdateAvailability> {
	const current = readInstalledVersion();
	const { version: latest, enginesNode } = await fetchLatestManifest(fetchImpl, channel);
	// Any difference between installed and the channel's published version is
	// actionable: a forward update (stable→newer, beta→newer beta) OR a revert
	// (beta→stable lands on an OLDER stable version, but switching channel is
	// exactly what the operator asked for). Same version means nothing to do.
	const updateAvailable = !!(current && latest && latest !== current);
	return {
		channel,
		current,
		latest,
		updateAvailable,
		nodeCompatibility: {
			compatible: enginesNode ? satisfiesRange(runningNode, enginesNode) : null,
			required: enginesNode,
			running: runningNode
		}
	};
}
