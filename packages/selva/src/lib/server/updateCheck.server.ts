// ============================================================================
// Update availability check
// ============================================================================
//
// Queries the npm registry for the published "latest" @selvajs/selva and
// compares it to the version installed in the deployment, so the admin System
// page can show an "update available" badge. Pure-ish: the registry fetch is
// injected so it's testable, and every failure path degrades to "no update
// available" rather than throwing — the admin page must never break because
// npm is slow or unreachable.

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { env } from '$env/dynamic/private';
import { isNewer } from '@selvajs/server/ops';
import { channelRegistryUrl, type ReleaseChannel } from './releaseChannel.server';

// Channel-aware comparison lives in `@selvajs/server/ops`; re-exported so
// existing consumers keep importing it from here.
export { isNewer };

export interface UpdateAvailability {
	/** The channel this check was run against. */
	channel: ReleaseChannel;
	/** Installed @selvajs/selva version, or null if it couldn't be read. */
	current: string | null;
	/** Latest published version on the channel, or null if the registry was unreachable. */
	latest: string | null;
	/** True when we have both versions and the channel's published one differs (newer, OR a stable revert target). */
	updateAvailable: boolean;
}

// Read the installed @selvajs/selva version from the deployment's
// node_modules. Probes cwd upward (and an explicit INSTALL_DIR) the same way
// the update runner detects the deployment dir.
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

// Ask the npm registry for the published @selvajs/selva version on a channel's
// dist-tag (defaults to `latest` / stable). Uses the lightweight per-tag
// endpoint and a short timeout so a slow registry can't hang the caller.
// Returns null on any failure.
export async function fetchLatestVersion(
	fetchImpl: typeof fetch,
	channel: ReleaseChannel = 'stable'
): Promise<string | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 5000);
	try {
		const res = await fetchImpl(channelRegistryUrl(channel), {
			headers: { Accept: 'application/json' },
			signal: ctrl.signal
		});
		if (!res.ok) return null;
		const body = (await res.json()) as { version?: unknown };
		return typeof body.version === 'string' ? body.version : null;
	} catch {
		return null;
	} finally {
		clearTimeout(timer);
	}
}

export async function checkForUpdate(
	fetchImpl: typeof fetch,
	channel: ReleaseChannel = 'stable'
): Promise<UpdateAvailability> {
	const current = readInstalledVersion();
	const latest = await fetchLatestVersion(fetchImpl, channel);
	// Any difference between installed and the channel's published version is an
	// actionable change: a forward update (stable→newer, beta→newer beta) OR a
	// revert (beta→stable lands on an OLDER stable version, but switching channel
	// is exactly what the operator asked for). Same version ⇒ nothing to do.
	const updateAvailable = !!(current && latest && latest !== current);
	return { channel, current, latest, updateAvailable };
}
