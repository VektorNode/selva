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

export interface UpdateAvailability {
	/** Installed @selvajs/selva version, or null if it couldn't be read. */
	current: string | null;
	/** Latest published version, or null if the registry was unreachable. */
	latest: string | null;
	/** True only when we have both versions and latest is strictly newer. */
	updateAvailable: boolean;
}

function parseSemver(v: string): [number, number, number] | null {
	const m = /^(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
	return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// True when `latest` is strictly newer than `current` by semver. Pre-release
// suffixes are ignored — we only surface stable bumps.
export function isNewer(latest: string, current: string): boolean {
	const a = parseSemver(latest);
	const b = parseSemver(current);
	if (!a || !b) return latest !== current;
	for (let i = 0; i < 3; i++) {
		if (a[i] > b[i]) return true;
		if (a[i] < b[i]) return false;
	}
	return false;
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

// Ask the npm registry for the "latest" dist-tag of @selvajs/selva. Uses the
// lightweight per-version endpoint and a short timeout so a slow registry
// can't hang the caller. Returns null on any failure.
export async function fetchLatestVersion(fetchImpl: typeof fetch): Promise<string | null> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), 5000);
	try {
		const res = await fetchImpl('https://registry.npmjs.org/@selvajs%2Fselva/latest', {
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

export async function checkForUpdate(fetchImpl: typeof fetch): Promise<UpdateAvailability> {
	const current = readInstalledVersion();
	const latest = await fetchLatestVersion(fetchImpl);
	return {
		current,
		latest,
		updateAvailable: !!(current && latest && isNewer(latest, current))
	};
}
