import { getBranding, flag, getAuthProvider } from '$lib/server/providers.server';
import { offeredTokenPresets } from '$lib/server/apiTokens/presets.server';
import type { LayoutServerLoad } from './$types';

// Expose the authenticated user to every route in the app.
export const load: LayoutServerLoad = async (event) => {
	const { locals } = event;
	return {
		branding: getBranding(),
		// Forward-auth providers identify on every request via proxy headers;
		// there's no Selva session to destroy, so the UI hides the logout button.
		hasProxyAuth: Boolean(getAuthProvider().proxyAuth),
		user: locals.user
			? {
					id: locals.user.id,
					email: locals.user.email,
					// Platform permissions live on `ctx`, not on the AuthUser identity.
					platformPermissions: locals.ctx?.platformPermissions ?? []
				}
			: null,
		profile: locals.profile
			? {
					userId: locals.profile.userId,
					displayName: locals.profile.displayName,
					starredDefinitions: locals.profile.starredDefinitions,
					recentRuns: locals.profile.recentRuns
				}
			: null,
		ctx: locals.ctx
			? {
					orgId: locals.ctx.actingOrgId,
					platformPermissions: locals.ctx.platformPermissions,
					orgPermissions: locals.ctx.orgPermissions,
					mayHoldApiTokens: (await offeredTokenPresets(event)).length > 0
				}
			: null,
		flags: {
			enableSharing: flag('ENABLE_SHARING')
		}
	};
};
