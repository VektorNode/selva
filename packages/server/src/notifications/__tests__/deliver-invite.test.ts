import { describe, expect, it, vi } from 'vitest';
import type {
	IDataProvider,
	ILogger,
	INotificationProvider,
	Invite,
	OutboundMessage,
	RequestContext
} from '@selvajs/platform';
import type { InviteMailInput } from '@selvajs/notifications';
import { deliverInvite, type DeliverInviteInput } from '../deliver-invite.js';

function setup(overrides: Partial<DeliverInviteInput> = {}) {
	const send = vi.fn(async (_m: OutboundMessage) => ({ status: 'sent' as const }));
	const input: DeliverInviteInput = {
		ctx: {} as RequestContext,
		log: { warn: vi.fn() } as unknown as ILogger,
		invite: {
			id: 'inv_1',
			orgId: 'org_1',
			email: 'new@acme.test',
			expiresAt: '2026-09-01T12:00:00.000Z'
		} as Invite,
		acceptUrl: 'https://host.test/accept?token=t',
		actor: {},
		orgs: { getOrg: async () => ({ name: 'Acme' }) } as unknown as IDataProvider['orgs'],
		notifications: { send } as unknown as INotificationProvider,
		fallbackOrgName: 'Selva',
		...overrides
	};
	return { input, send };
}

describe('deliverInvite', () => {
	it('names the product it is given, not Selva', async () => {
		const { input, send } = setup({ productName: 'Acme Fab' });
		expect(await deliverInvite(input)).toBe('sent');
		const mail = send.mock.calls[0][0];
		expect(mail.subject).toBe('You have been invited to join Acme on Acme Fab');
		expect(mail.html).not.toContain('Selva');
	});

	it('sends what a host renderer returns, given the resolved input', async () => {
		const render = vi.fn((i: InviteMailInput): OutboundMessage => ({
			kind: 'org.invite',
			to: i.to,
			subject: `Einladung zu ${i.orgName} auf ${i.productName}`,
			text: i.acceptUrl,
			html: i.acceptUrl
		}));
		const { input, send } = setup({ productName: 'Acme Fab', render });
		await deliverInvite(input);
		expect(render).toHaveBeenCalledWith(
			expect.objectContaining({ orgName: 'Acme', productName: 'Acme Fab' })
		);
		expect(send.mock.calls[0][0].subject).toBe('Einladung zu Acme auf Acme Fab');
	});

	it('reports a throwing host renderer as failed instead of rejecting', async () => {
		const { input, send } = setup({
			render: async () => {
				throw new Error('missing translation');
			}
		});
		expect(await deliverInvite(input)).toBe('failed');
		expect(send).not.toHaveBeenCalled();
	});
});
