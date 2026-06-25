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
import { channelRegistryUrl, type ReleaseChannel } from './releaseChannel.server';

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

// Parse x.y.z plus an optional -beta.N pre-release counter. The pre-release
// number is returned separately so beta-channel comparisons can order
// successive betas of the same x.y.z core.
function parseSemver(v: string): { core: [number, number, number]; beta: number | null } | null {
	const m = /^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?/.exec(v.trim());
	if (!m) return null;
	return {
		core: [Number(m[1]), Number(m[2]), Number(m[3])],
		beta: m[4] != null ? Number(m[4]) : null
	};
}

// True when `latest` is strictly newer than `current` by semver.
//
// Stable channel (default): pre-release suffixes are ignored — only stable
// core bumps surface, preserving the historic behavior.
//
// Beta channel: pre-releases participate. A higher core wins; on an equal core,
// a higher -beta.N wins, and a stable (no suffix) outranks any -beta of the same
// core (4.6.0 > 4.6.0-beta.9). This lets the System page show "beta.1 → beta.2"
// and "beta → stable promotion of the same line".
export function isNewer(
	latest: string,
	current: string,
	channel: ReleaseChannel = 'stable'
): boolean {
	const a = parseSemver(latest);
	const b = parseSemver(current);
	if (!a || !b) return latest !== current;
	for (let i = 0; i < 3; i++) {
		if (a.core[i] > b.core[i]) return true;
		if (a.core[i] < b.core[i]) return false;
	}
	// Equal core. On the stable channel we don't compare pre-release tails.
	if (channel !== 'beta') return false;
	// Stable (beta == null) ranks above any pre-release of the same core.
	const rank = (beta: number | null) => (beta == null ? Infinity : beta);
	return rank(a.beta) > rank(b.beta);
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
