import { hasPermission } from '@selvajs/platform';
import { flag } from '$lib/server/providers.server';
import type { PageServerLoad } from './$types';

/**
 * System settings host the Update runner (`manage_updates`). Other panels
 * (platform-flag display, build/deploy metadata) are visible to anyone who
 * passed the layout-level `assertAnyPlatformPermission` gate.
 */
export const load: PageServerLoad = async ({ locals }) => {
	const ctx = locals.ctx;
	const canManageUpdates = ctx ? hasPermission(ctx, 'manage_updates') : false;

	const flags = {
		ALLOW_CROSS_ORG_PUBLIC: flag('ALLOW_CROSS_ORG_PUBLIC'),
		ALLOW_ORG_COMPUTE_OVERRIDE: flag('ALLOW_ORG_COMPUTE_OVERRIDE'),
		ALLOW_ORG_CREATION: flag('ALLOW_ORG_CREATION'),
		ENABLE_SHARING: flag('ENABLE_SHARING')
	};

	return { canManageUpdates, flags };
};
