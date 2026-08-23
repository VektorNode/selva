export type PlatformProjectGranteeType = 'org' | 'user';

/**
 * Grants view-only or view+solve access to a `platform`-visibility project
 * for an org or an individual user, without creating project membership rows.
 *
 * - `granteeType: 'org'`  → applies to all members of that org
 * - `granteeType: 'user'` → applies to that specific user regardless of org
 */
export interface PlatformProjectGrant {
	id: string;
	projectId: string;
	granteeType: PlatformProjectGranteeType;
	granteeId: string;
	/** false = view/schema only; true = view + solve. */
	canSolve: boolean;
	createdBy: string;
	createdAt: string;
}
