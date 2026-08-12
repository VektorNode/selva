// The package.json a deployment directory gets. `create` writes it at scaffold
// time and `migrate` rewrites an existing one onto it, so it lives here rather
// than in either command — two copies drifted once already, and the pm2 pin is
// exactly the field where a silent difference costs the most.

import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * pm2 is pinned exactly, not caret-ranged.
 *
 * pm2's CLI and its long-running daemon must be the same version. A range lets
 * two deployments installed a week apart resolve differently, and the newer one
 * silently adopts the daemon the older one started — the skew `ensurePm2InSync`
 * has to detect and, in the daemon-is-newer direction, cannot repair (#118).
 *
 * Read from this package's own devDependencies rather than written here as a
 * literal. Dependabot scans manifests, not source, so a literal is invisible to
 * it — this pin sat on 5.4.3 while upstream reached 7.x, which is precisely the
 * drift operators point at when they argue for distro packages instead.
 * `checkPinIsExact` keeps the manifest entry from being loosened to a range.
 */
const PM2_VERSION = readPinnedPm2Version();

function readPinnedPm2Version() {
	const manifest = JSON.parse(
		readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8')
	);
	const pinned = manifest.devDependencies?.pm2;
	if (!pinned || !/^\d+\.\d+\.\d+$/.test(pinned)) {
		throw new Error(
			`@selvajs/cli devDependencies.pm2 must be an exact version, got ${JSON.stringify(pinned)}. ` +
				`Every deployment this CLI scaffolds inherits it, and a range there lets two ` +
				`installs resolve different pm2s that then fight over one daemon.`
		);
	}
	return pinned;
}

const SCRIPTS = {
	start: 'selva start',
	stop: 'selva stop',
	restart: 'selva restart',
	logs: 'selva logs',
	doctor: 'selva doctor',
	update: 'selva update'
};

/**
 * Packages a deployment carries. Providers are bundled into `@selvajs/selva`;
 * the CLI is a dependency so `npm run start` resolves the `selva` bin locally
 * instead of relying on a global install.
 *
 * The `latest` entries are what `create` resolves at scaffold time, never what
 * gets written: `resolveSelvaPins` turns them into concrete versions. A stored
 * `"latest"` re-resolves on every `npm install`, so the deployment follows the
 * dist-tag forever and can change under the operator with no migrate at all.
 */
const DEPENDENCIES = {
	'@selvajs/cli': 'latest',
	'@selvajs/selva': 'latest',
	pm2: PM2_VERSION
};

/** The `@selvajs/*` packages whose pin belongs to the operator, not the scaffold. */
export const SELVA_PACKAGES = ['@selvajs/cli', '@selvajs/selva'];

/**
 * True for a pin that names no version — a dist-tag (`latest`, `beta`) or the
 * empty-ish values npm also accepts (`*`, `""`). These are the pins that move
 * on their own, which is what makes them unfit to store.
 */
export function isFloatingPin(pin) {
	if (typeof pin !== 'string') return true;
	const trimmed = pin.trim();
	if (trimmed === '' || trimmed === '*' || trimmed === 'x') return true;
	// A range still names versions; only a bare tag has no digits at all.
	return !/\d/.test(trimmed);
}

/**
 * True for a pin on a prerelease line (`^4.8.0-beta.11`).
 *
 * These are preserved across a migration. An operator on a beta channel chose
 * it, and npm's `latest` tag points at the newest *stable* release — so
 * resolving their pin through `latest` is a downgrade that reads as an upgrade
 * in the confirmation diff.
 */
export function isPrereleasePin(pin) {
	return typeof pin === 'string' && /\d+\.\d+\.\d+-/.test(pin);
}

/**
 * npm `overrides` forced onto every deployment — security patches for
 * transitive deps whose direct parent hasn't picked up the fix yet. Each entry
 * is a temporary shim: remove it once the parent ships the fixed version on
 * its own (the override then matches what would install anyway, so removal is
 * cleanup, never urgent).
 *
 * js-yaml: pm2 <= 7.0.3 pins 4.3.0, which carries the quadratic-complexity
 * DoS advisories (GHSA-5p4m-2wfm-xmqj and friends); the fix landed in 4.3.1.
 * Drop when pm2's own js-yaml dependency reaches >= 4.3.1.
 */
export const OVERRIDES = {
	'js-yaml': '^4.3.1'
};

/**
 * Legacy `@selvajs/*` packages that a deployment may still list. Each was
 * either renamed or folded into `@selvajs/selva`; `migrate` drops them and
 * `doctor` reports them as layout drift.
 */
export const LEGACY_DEPENDENCIES = {
	'@selvajs/runtime': 'the old runtime package',
	'@selvajs/create': 'the old CLI package',
	'@selvajs/platform': 'now bundled into @selvajs/selva',
	'@selvajs/local-provider': 'now bundled into @selvajs/selva',
	'@selvajs/supabase-provider': 'now bundled into @selvajs/selva',
	'@selvajs/header-auth-provider': 'now bundled into @selvajs/selva'
};

/**
 * Build the canonical deployment package.json.
 *
 * Dependencies are replaced wholesale rather than merged, so an operator's own
 * additions are dropped. That is deliberate — a deployment directory is
 * generated output, and anyone needing custom dependencies should depend on
 * `@selvajs/selva` from their own project instead of editing this file.
 *
 * `engines` is the one exception, carried over when present: npm only enforces
 * it under `engine-strict`, so an operator who pinned a Node floor did it
 * deliberately, and dropping it removes a guard whose absence shows up only
 * under real traffic (issue #176). Everything else a migration discards is
 * listed by `diffPackageJson` before the operator confirms.
 *
 * `dependencies` is the second exception, for the same reason: a version pin is
 * an operator choice too. `migrate` passes the resolved `@selvajs/*` pins in
 * here; a fresh scaffold passes none and inherits the defaults.
 */
export function buildDeploymentPackageJson({ name, version = '0.1.0', engines, dependencies }) {
	const pkg = {
		name: sanitizePackageName(name),
		version,
		private: true,
		type: 'module',
		scripts: { ...SCRIPTS },
		dependencies: { ...DEPENDENCIES, ...dependencies },
		overrides: { ...OVERRIDES }
	};
	if (engines && typeof engines === 'object') pkg.engines = { ...engines };
	return pkg;
}

/**
 * Ask npm what a dist-tag currently points at. Kept beside the pin logic it
 * serves, and injected rather than called directly so tests never hit the
 * network.
 */
export function npmDistTagVersion(name, tag) {
	const out = execSync(`npm view ${name}@${tag} version`, {
		encoding: 'utf8',
		stdio: ['ignore', 'pipe', 'pipe']
	});
	const version = String(out).trim().split('\n').pop()?.trim();
	if (!version || !/^\d+\.\d+\.\d+/.test(version)) {
		throw new Error(`npm view returned no usable version for ${name}@${tag}`);
	}
	return version;
}

/**
 * Decide the `@selvajs/*` pins a migration should write.
 *
 * Two rules, both aimed at the same failure: a migration silently moving a
 * deployment to a version the operator didn't ask for.
 *
 *   - A prerelease pin is kept as-is. `latest` means newest stable, so
 *     resolving a beta pin through it walks the deployment backwards.
 *   - Anything else resolves to a concrete version via `resolveVersion`, so
 *     `"latest"` never reaches disk and the diff can show what it resolved to.
 *
 * `resolveVersion` hits the network. When it fails — offline, registry down, a
 * package with no such tag — the existing pin is kept and the reason returned,
 * so migrate can report it rather than inventing a version or aborting a
 * migration whose other half (layout, overrides, env renames) is still valid.
 */
export function resolveSelvaPins(currentDeps, resolveVersion) {
	const pins = {};
	const notes = [];

	for (const name of SELVA_PACKAGES) {
		const current = currentDeps?.[name];

		if (isPrereleasePin(current)) {
			pins[name] = current;
			notes.push({ name, kind: 'prerelease', pin: current });
			continue;
		}

		let resolved = null;
		try {
			resolved = resolveVersion(name, 'latest');
		} catch (err) {
			notes.push({ name, kind: 'unresolved', pin: current, reason: err?.message ?? String(err) });
		}

		if (resolved) {
			pins[name] = `^${resolved}`;
			continue;
		}

		// Nothing resolvable and nothing worth keeping — fall back to the tag so
		// the install still succeeds. Rare: offline *and* a floating pin.
		if (isFloatingPin(current)) {
			pins[name] = DEPENDENCIES[name];
			if (!notes.some((n) => n.name === name)) {
				notes.push({ name, kind: 'unresolved', pin: current, reason: 'no version returned' });
			}
		} else {
			pins[name] = current;
		}
	}

	return { pins, notes };
}

/**
 * Top-level keys the canonical package.json defines. Anything outside this set
 * that an operator added is dropped by `migrate` — `diffPackageJson` reports
 * them so the loss is declared rather than discovered later.
 */
export const CANONICAL_FIELDS = new Set([
	'name',
	'version',
	'private',
	'type',
	'scripts',
	'dependencies',
	'overrides',
	'engines'
]);

export function sanitizePackageName(name) {
	return (
		String(name ?? '')
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^[-._]+|[-._]+$/g, '') || 'selva-deployment'
	);
}

export { DEPENDENCIES, SCRIPTS, PM2_VERSION };
