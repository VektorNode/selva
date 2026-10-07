import type {
	AuthUser,
	IOrgStore,
	OrgMember,
	PlatformPermission,
	RequestContext
} from '@selvajs/platform';
import { SYSTEM_CONTEXT } from '@selvajs/platform';

export interface BuildRequestContextInput {
	user: AuthUser;
	platformPermissions: PlatformPermission[];
	/** The membership the request acts through, or null for none. */
	membership: Pick<OrgMember, 'orgId' | 'permissions'> | null;
	/** Forwarded as `adapterContext.sessionToken`; Supabase scopes row security by it. */
	sessionToken?: string;
	/**
	 * Act in `membership`'s org or nowhere. Turns off the instance-admin
	 * first-org fallback: an API token is bound to one org.
	 */
	pinOrg?: boolean;
}

/**
 * One request's identity: the acting org and the permissions held there.
 *
 * Every sign-in path builds through here (cookie, forward-auth, API token, and
 * any host app's own hook), so they can't drift on what a context contains.
 */
export async function buildRequestContext(
	input: BuildRequestContextInput,
	deps: { orgs: Pick<IOrgStore, 'listOrgs'> }
): Promise<RequestContext> {
	const { user, platformPermissions, membership, sessionToken, pinOrg } = input;
	let actingOrgId = membership?.orgId;
	const orgPermissions = membership ? [...membership.permissions] : [];

	if (!actingOrgId && !pinOrg && platformPermissions.includes('instance_admin')) {
		// Instance admins without a membership fall back to the first org, so admin
		// tooling stays usable before an org switcher exists.
		const firstOrg = (await deps.orgs.listOrgs(SYSTEM_CONTEXT, { limit: 1 })).items[0];
		if (firstOrg) actingOrgId = firstOrg.id;
	}

	return {
		userId: user.id,
		actingOrgId,
		platformPermissions,
		orgPermissions,
		adapterContext: sessionToken ? { sessionToken } : undefined
	};
}
