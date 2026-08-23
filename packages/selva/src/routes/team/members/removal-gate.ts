import type { OrgRole } from '@selvajs/platform';

/**
 * Why the org-member remove control is unavailable, or `null` when removal may
 * proceed. Mirrors the gates on `DELETE /api/v1/orgs/[orgId]/members/[userId]`,
 * which stays the load-bearing check — this only keeps the UI from offering an
 * action the server would refuse.
 *
 * Removal is the harder-to-reverse half of the owner-only rule in
 * `canChangeOrgRole`: a demoted owner can be re-promoted, but a removed one has
 * lost every project membership to the cascade.
 */
export interface RemovalGateInput {
	target: { userId: string; role: OrgRole };
	actorUserId: string;
	actorRole: OrgRole | null;
	/** Owners currently in the org, including the target. */
	ownerCount: number;
}

export function removalBlockReason(input: RemovalGateInput): string | null {
	const { target, actorUserId, actorRole, ownerCount } = input;
	if (target.userId === actorUserId) return 'You cannot remove yourself from the org.';
	if (target.role === 'owner' && ownerCount === 1) {
		return 'Cannot remove the sole owner. Promote another member to owner first.';
	}
	if (target.role === 'owner' && actorRole !== 'owner') {
		return 'Only the org owner can remove another owner.';
	}
	return null;
}
