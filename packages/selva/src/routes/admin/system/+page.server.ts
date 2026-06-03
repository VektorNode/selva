import { hasPermission } from '@selvajs/platform';
import { flag } from '$lib/server/providers.server';
import { checkForUpdate } from '$lib/server/updateCheck.server';
import pkg from '../../../../package.json';
import type { PageServerLoad } from './$types';

/**
 * System settings host the Update runner (`manage_updates`). Other panels
 * (platform-flag display, build/deploy metadata) are visible to anyone who
 * passed the layout-level `assertAnyPlatformPermission` gate.
 *
 * `version` comes from a build-time JSON import of this package's own
 * package.json — the runtime version IS the version we built with, and
 * after an admin update the new build embeds the new constant. No need to
 * shell out to `npm` or read node_modules at request time.
 */
export const load: PageServerLoad = async ({ locals, fetch }) => {
	const ctx = locals.ctx;
	const canManageUpdates = ctx ? hasPermission(ctx, 'manage_updates') : false;
	// The on-demand health check endpoint is instance_admin-only; gate the UI
	// to match so we don't show a button that 403s.
	const isInstanceAdmin = ctx ? hasPermission(ctx, 'instance_admin') : false;

	const flags = {
		ALLOW_CROSS_ORG_PUBLIC: flag('ALLOW_CROSS_ORG_PUBLIC'),
		ALLOW_ORG_COMPUTE_OVERRIDE: flag('ALLOW_ORG_COMPUTE_OVERRIDE'),
		ALLOW_ORG_CREATION: flag('ALLOW_ORG_CREATION'),
		ENABLE_PLATFORM_PROJECTS: flag('ENABLE_PLATFORM_PROJECTS'),
		ENABLE_SHARING: flag('ENABLE_SHARING')
	};

	// Only operators who can run updates need the registry check — skip the
	// npm round-trip for everyone else.
	const update = canManageUpdates
		? await checkForUpdate(fetch)
		: { current: null, latest: null, updateAvailable: false };

	return { canManageUpdates, isInstanceAdmin, flags, version: pkg.version, update };
};
