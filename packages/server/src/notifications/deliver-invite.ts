import type {
	AuthUser,
	IDataProvider,
	ILogger,
	INotificationProvider,
	Invite,
	RequestContext,
	UserProfile
} from '@selvajs/platform';
import { renderInviteEmail, type MailTemplates } from '@selvajs/notifications';

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
	/** Product name the mail says the invitee is joining. Defaults to `Selva`. */
	productName?: string;
	/** Host wording for the mail. Absent: the built-in English template. */
	render?: MailTemplates['invite'];
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
	const render = input.render ?? renderInviteEmail;
	try {
		const org = await orgs.getOrg(ctx, invite.orgId);
		const { status } = await notifications.send(
			await render({
				to: invite.email,
				acceptUrl,
				orgName: org?.name ?? fallbackOrgName,
				invitedBy: actor.profile?.displayName || actor.user?.email,
				expiresAt: invite.expiresAt,
				productName: input.productName
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
