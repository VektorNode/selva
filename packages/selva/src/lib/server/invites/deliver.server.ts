import type { ILogger, Invite, RequestContext, UserProfile, AuthUser } from '@selvajs/platform';
import { getBranding, getOrganizationProvider } from '$lib/server/providers.server';
import { renderInviteEmail, sendMail } from '$lib/server/email';

export type InviteDelivery = 'sent' | 'not-configured' | 'failed';

export interface DeliverInviteInput {
	ctx: RequestContext;
	log: ILogger;
	invite: Invite;
	acceptUrl: string;
	/** The admin minting the invite — used only for the "X invited you" line. */
	actor: { profile?: UserProfile; user?: AuthUser };
}

/**
 * Mail an invite's accept link, best-effort.
 *
 * Shared by the mint and resend routes so they cannot disagree about what the
 * invitee receives. Swallows every failure: the invite row is already
 * committed and the caller still holds `acceptUrl` to share by hand, so a dead
 * SMTP host must not report a valid invite as a failure.
 */
export async function deliverInvite(input: DeliverInviteInput): Promise<InviteDelivery> {
	const { ctx, log, invite, acceptUrl, actor } = input;
	try {
		const org = await getOrganizationProvider().getOrg(ctx, invite.orgId);
		const { status } = await sendMail(
			renderInviteEmail({
				to: invite.email,
				acceptUrl,
				orgName: org?.name ?? getBranding().name,
				invitedBy: actor.profile?.displayName || actor.user?.email,
				expiresAt: invite.expiresAt
			}),
			log
		);
		return status;
	} catch (err) {
		log.warn('Invite mail could not be prepared', {
			component: 'Invites',
			inviteId: invite.id,
			reason: err instanceof Error ? err.message : String(err)
		});
		return 'failed';
	}
}
