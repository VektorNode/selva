import type {
	AuthUser,
	IDataProvider,
	ILogger,
	INotificationProvider,
	Invite,
	RequestContext,
	UserProfile
} from '@selvajs/platform';
import { renderInviteEmail } from '@selvajs/notifications';

export type InviteDelivery = 'sent' | 'not-configured' | 'failed';

export interface DeliverInviteInput {
	ctx: RequestContext;
	log: ILogger;
	invite: Invite;
	acceptUrl: string;
	/** The admin minting the invite — used only for the "X invited you" line. */
	actor: { profile?: UserProfile; user?: AuthUser };
	orgs: IDataProvider['orgs'];
	notifications: INotificationProvider;
	/** Falls back into the org-name slot when the org has no name of its own. */
	fallbackOrgName: string;
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
	const { ctx, log, invite, acceptUrl, actor, orgs, notifications, fallbackOrgName } = input;
	try {
		const org = await orgs.getOrg(ctx, invite.orgId);
		const { status } = await notifications.send(
			renderInviteEmail({
				to: invite.email,
				acceptUrl,
				orgName: org?.name ?? fallbackOrgName,
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
