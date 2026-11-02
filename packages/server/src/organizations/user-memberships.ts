import { SYSTEM_CONTEXT, walkPages } from '@selvajs/platform';
import type { IOrgStore, OrgMember, Organization } from '@selvajs/platform';

/**
 * Every org `userId` belongs to, with their membership row. Reads a page of
 * orgs and the user's rows in it at a time, so the cost grows with the number
 * of orgs, not with the number of members.
 */
export async function listUserMemberships(
	orgs: Pick<IOrgStore, 'listOrgs' | 'getOrgMembersFor'>,
	userId: string
): Promise<{ org: Organization; member: OrgMember }[]> {
	const out: { org: Organization; member: OrgMember }[] = [];
	for await (const page of walkPages((p) => orgs.listOrgs(SYSTEM_CONTEXT, p))) {
		const members = await orgs.getOrgMembersFor(
			SYSTEM_CONTEXT,
			page.items.map((o) => o.id),
			userId
		);
		for (const org of page.items) {
			const member = members.get(org.id);
			if (member) out.push({ org, member });
		}
	}
	return out;
}
