// The package.json a deployment directory gets. `create` writes it at scaffold
// time and `migrate` rewrites an existing one onto it, so it lives here rather
// than in either command — two copies drifted once already, and the pm2 pin is
// exactly the field where a silent difference costs the most.

import { readFileSync } from 'node:fs';
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
 */
const DEPENDENCIES = {
	'@selvajs/cli': 'latest',
	'@selvajs/selva': 'latest',
	pm2: PM2_VERSION
};

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
 */
export function buildDeploymentPackageJson({ name, version = '0.1.0', engines }) {
	const pkg = {
		name: sanitizePackageName(name),
		version,
		private: true,
		type: 'module',
		scripts: { ...SCRIPTS },
		dependencies: { ...DEPENDENCIES },
		overrides: { ...OVERRIDES }
	};
	if (engines && typeof engines === 'object') pkg.engines = { ...engines };
	return pkg;
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
