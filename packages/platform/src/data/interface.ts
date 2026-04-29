/**
 * `IDataProvider` is the composition root that bundles every store an adapter
 * implements. Individual interfaces (`IOrgStore`, `IProjectStore`, …) live
 * next to their types in their respective subdirs — only the composition
 * lives here.
 *
 * Every store method takes a `RequestContext` first. **The query itself is
 * the security boundary** — adapters MUST scope reads/writes by `ctx`. An
 * unauthorized caller sees an empty page, `null`, or a `ProviderError`.
 *
 * Access-control predicates live in `@selvajs/platform/access` (pure rules).
 * Stores do storage; rules do rules.
 */

import type { IOrgStore } from '../organizations/interface.js';
import type { IProjectStore } from '../projects/interface.js';
import type { IDefinitionStore } from '../definitions/interface.js';
import type { IComputeServerStore } from '../computeServer/interface.js';
import type { IShareLinkStore } from '../shareLinks/interface.js';
import type { IPlatformProjectGrantStore } from '../platformProjects/interface.js';
import type { IInviteStore } from '../invites/interface.js';
import type { IUserProfileStore } from '../userProfile/interface.js';
import type { IPlatformPermissionStore } from '../permissions/interface.js';
import type { IAuditQuery } from '../events/audit.js';
import type { RequestContext } from '../context.js';

export interface IDataProvider {
	orgs: IOrgStore;
	projects: IProjectStore;
	definitions: IDefinitionStore;
	computeServer: IComputeServerStore;
	invites: IInviteStore;
	shareLinks: IShareLinkStore;
	userProfile: IUserProfileStore;
	permissions: IPlatformPermissionStore;
	platformProjectGrants: IPlatformProjectGrantStore;
	/**
	 * Read-side for the persisted event log. Optional — providers whose event
	 * sink is a noop (local-provider) leave this undefined and the
	 * `/admin/audit` UI degrades to its "no backend wired" state.
	 */
	auditQuery?: IAuditQuery;

	/**
	 * Idempotently register a user in the data layer. Called by `hooks.server.ts`
	 * after `verifyToken` succeeds, so the data layer always has a row for the
	 * authenticated user regardless of which auth provider issued the ID.
	 *
	 * Adapters with a DB-side trigger that auto-seeds on auth signup (Supabase)
	 * make this a no-op. Adapters that own a separate user-data table without a
	 * trigger (local-provider) upsert here.
	 *
	 * MUST be safe to call concurrently and on every request. MUST NOT throw on
	 * a duplicate userId.
	 */
	ensureUser(ctx: RequestContext, userId: string): Promise<void>;

	/**
	 * Cascade hook called after the auth provider deletes a user. Removes any
	 * data-layer rows tied to that user (the user-data row, anything else
	 * keyed by `userId` that should die with the identity).
	 *
	 * Adapters whose data-layer FKs cascade on delete (Supabase via
	 * `on delete cascade` against `auth.users`) no-op. Adapters that own
	 * separate tables (local-provider) clean up here.
	 *
	 * MUST tolerate a missing user (idempotent — caller may retry).
	 */
	onUserDeleted(ctx: RequestContext, userId: string): Promise<void>;
}
