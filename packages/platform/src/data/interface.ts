/**
 * Composition root bundling every store an adapter implements. Individual
 * interfaces (`IOrgStore`, `IProjectStore`, …) live next to their types in
 * their own subdirs.
 *
 * Every store method takes a `RequestContext` first. **The query itself is
 * the security boundary** — adapters MUST scope reads/writes by `ctx`. An
 * unauthorized caller sees an empty page, `null`, or a `ProviderError`.
 *
 * Access-control predicates live in `@selvajs/platform/access`, not here.
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
import type { IEventSink } from '../events/interface.js';
import type { RequestContext } from '../context.js';

/**
 * Result of the app↔DB schema handshake. `expected` is the migration head
 * the running app was built against; `actual` is what the database reports
 * (`null` when the database can't even answer — e.g. the handshake function
 * itself was never migrated in).
 */
export interface SchemaVersionReport {
	ok: boolean;
	expected: string;
	actual: string | null;
	/** Operator-facing explanation + recovery hint when not ok. */
	message?: string;
}

/** Extra identifiers {@link IDataProvider.onUserDeleted} needs but can't derive from userId alone. */
export interface UserErasureOptions {
	/** The deleted user's email, for scrubbing invite/audit rows keyed by it. */
	email?: string;
}

/**
 * Written to `solve_metrics.actor_id` when a user is erased, so capacity/billing
 * aggregates survive without identifying the person. Distinct from `'system'`,
 * which marks solves never attributed to a user (share-link / server flows).
 */
export const ERASED_ACTOR_ID = 'deleted';

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
	 * Write-side event sink this provider's stores emit into. Optional — lets app
	 * code with no store mutation to piggyback on (e.g. a self-update route) emit
	 * domain events into the same log. Callers fall back to `NoopEventSink` when absent.
	 */
	events?: IEventSink;

	/**
	 * Optional — only adapters whose schema migrates out-of-band (Supabase:
	 * `supabase db push` is a manual operator step) need this. Boot health calls
	 * it and drives `/api/health` to 503 when the database is behind the app,
	 * so schema skew surfaces as a health check instead of per-request store errors.
	 *
	 * MUST NOT throw: report failure via `ok: false`.
	 */
	verifySchemaVersion?(): Promise<SchemaVersionReport>;

	/**
	 * Idempotently registers a user in the data layer. Called by `hooks.server.ts`
	 * after `verifyToken` succeeds, so the data layer always has a row for the
	 * authenticated user regardless of which auth provider issued the ID.
	 *
	 * Adapters with a DB-side trigger that auto-seeds on auth signup (Supabase)
	 * make this a no-op. Adapters owning a separate user-data table without a
	 * trigger (local-provider) upsert here.
	 *
	 * MUST be safe to call concurrently and on every request. MUST NOT throw on
	 * a duplicate userId.
	 */
	ensureUser(ctx: RequestContext, userId: string): Promise<void>;

	/**
	 * Cascade + erasure hook called after the auth provider deletes a user.
	 * Removes or anonymizes data-layer rows tied to that user.
	 *
	 * Most user-owned rows die via FK cascade / `set null` against `auth.users`
	 * (Supabase) or explicit membership cleanup (local). Some personal data is
	 * NOT reachable by those FKs and MUST be scrubbed here:
	 *  - audit rows keyed by a plain-text `actor_id` (no FK),
	 *  - invites addressed to the user's `email`, and that email embedded in
	 *    `invite.created` audit payloads,
	 *  - `solve_metrics`, deliberately not FK-cascaded — anonymized (actor
	 *    tombstoned), not deleted.
	 *
	 * `opts.email` is the deleted user's email; the CALLER must capture it
	 * BEFORE `deleteUser` runs (the auth user is already gone by the time this
	 * hook fires). When absent, email-keyed scrubs are skipped.
	 *
	 * MUST tolerate a missing user and missing rows (idempotent — caller may retry).
	 */
	onUserDeleted(ctx: RequestContext, userId: string, opts?: UserErasureOptions): Promise<void>;
}
