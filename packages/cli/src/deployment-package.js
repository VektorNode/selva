// The package.json a deployment directory gets. `create` writes it at scaffold
// time and `migrate` rewrites an existing one onto it, so it lives here rather
// than in either command — two copies drifted once already, and the pm2 pin is
// exactly the field where a silent difference costs the most.

/**
 * pm2 is pinned exactly, not caret-ranged.
 *
 * pm2's CLI and its long-running daemon must be the same version. A range lets
 * two deployments installed a week apart resolve differently, and the newer one
 * silently adopts the daemon the older one started — the skew `ensurePm2InSync`
 * has to detect and, in the daemon-is-newer direction, cannot repair (#118).
 */
const PM2_VERSION = '5.4.3';

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
 */
export function buildDeploymentPackageJson({ name, version = '0.1.0' }) {
	return {
		name: sanitizePackageName(name),
		version,
		private: true,
		type: 'module',
		scripts: { ...SCRIPTS },
		dependencies: { ...DEPENDENCIES }
	};
}

export function sanitizePackageName(name) {
	// npm package names: lowercase, no spaces, limited punctuation.
	return (
		String(name ?? '')
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^[-._]+|[-._]+$/g, '') || 'selva-deployment'
	);
}

export { DEPENDENCIES, SCRIPTS, PM2_VERSION };
