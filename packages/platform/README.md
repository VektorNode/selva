# @selvajs/platform

Pure TypeScript interfaces defining Selva's contract with its backends — no runtime dependency on a specific database, storage, or auth service. Concrete adapters (local filesystem, Supabase, Azure, ...) live in their own packages and implement these interfaces.

This README is the contract. Read it before writing an adapter.

---

## Interfaces at a glance

| Interface                    | Purpose                                                                           | Scoped by `RequestContext`?                                          |
| ---------------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| `IAuthProvider`              | Verify tokens, manage users, issue sessions. Optional `passwordAuth?` capability. | No — the auth provider produces the identity that fills the context. |
| `IPlatformPermissionStore`   | Per-user platform permissions; owns the sole-`instance_admin` invariant.          | Yes — every method.                                                  |
| `IUserProfileStore`          | Per-user profile (display name, starred definitions, recent runs).                | Yes — adapters scope by `ctx.userId`.                                |
| `IOrgStore`                  | Orgs and org memberships.                                                         | Yes — every method.                                                  |
| `IProjectStore`              | Projects and project memberships.                                                 | Yes — every method.                                                  |
| `IPlatformProjectGrantStore` | Instance-admin-managed grants onto `platform`-visibility projects.                | Yes — every method.                                                  |
| `IDefinitionStore`           | Definition metadata records + version history.                                    | Yes — every method.                                                  |
| `IShareLinkStore`            | Per-definition anonymous-access tokens.                                           | Yes — every method.                                                  |
| `IInviteStore`               | Pending org-membership invitations.                                               | Yes — every method.                                                  |
| `IComputeServerStore`        | Global + per-org compute-server config.                                           | No — not tenant-scoped.                                              |
| `IStorageProvider`           | Path-based blob storage. Authorization is the caller's responsibility.            | No — callers pass already-authorized paths.                          |

`IDataProvider` composes every store, plus optional `auditQuery` / `events` hooks and lifecycle methods `ensureUser` and `onUserDeleted`. An adapter typically implements one class per store and aggregates them.

---

## RequestContext rules

`RequestContext` carries the caller's identity and active scope. Built once per HTTP request in `hooks.server.ts` from the authenticated session.

1. **The query is the security boundary.** Adapters MUST filter reads and writes by `ctx`. An unauthorized caller gets an empty page, `null`, or a `ProviderError` — never someone else's data.
2. **Never trust a caller's pre-flight check.** `canSolve` / `canEdit` / `canManage` are UI-gating conveniences. A mutating method must remain safe even if the caller skipped them.
3. **Extend `RequestContext`, not method signatures.** Add a field to the interface for new dimensions (e.g. `tenantId`); don't thread it through every call.
4. **`SYSTEM_CONTEXT` is for trusted server code only.** Bootstrap, scheduled janitors, migrations, test setup. Never derive it from a user session.

---

## Transaction ordering rules

Providers are two-phase: a metadata store (`IDataProvider`) and a blob store (`IStorageProvider`) with no shared transaction. `DefinitionService` (`@selvajs/server/definitions`) composes them with fixed ordering so partial failure is recoverable.

**Create — metadata-first, `pending` → `draft`:**

1. Write the record with `status: 'pending'`.
2. Upload the blob.
3. `attachInitialVersion` flips `status` to `'draft'`.

List queries filter `'pending'` and `'archived'` by default (`DefinitionListOptions.includePending` / `includeArchived` opt in). If step 2 fails, the record stays `'pending'` and is invisible to consumers.

**Delete — blob-first:**

1. `storage.deletePrefix(prefix)`.
2. `data.delete(guid)`.

If step 2 fails, a retry re-deletes blobs (no-op) and succeeds.

---

## A minimal adapter

```ts
import type {
	IDefinitionStore,
	DefinitionRecord,
	DefinitionRecordPatch,
	RequestContext,
	DefinitionListOptions,
	Page
} from '@selvajs/platform';

export class MyDefinitionStore implements IDefinitionStore {
	async list(ctx: RequestContext, opts?: DefinitionListOptions): Promise<Page<DefinitionRecord>> {
		// Filter by ctx.actingOrgId; exclude status='pending' unless opts.includePending.
	}
	// ... etc
}
```

Wire it into a `SelvaConfig` via `defineConfig({ auth, data, storage })`. `data` is an `IDataProvider` composing every store.

---

## Testing your adapter

`@selvajs/platform/testing` ships a conformance suite per store. Adapters import it and run it against their own instance — passing means the adapter behaves the same as the in-memory reference.

```ts
import { runDefinitionStoreConformance } from '@selvajs/platform/testing';
import { MyDefinitionStore } from './MyDefinitionStore.js';

runDefinitionStoreConformance({
	name: 'my-adapter',
	createStore: async () => new MyDefinitionStore(/* ... */)
});
```

The suites cover `ctx` scoping, `pending` filtering, `includePending` opt-in, and `ProviderError` shapes. They do not cover performance or concurrency.

---

## Errors

Throw `ProviderError` for user-facing failures (`new ProviderError('...', 404)`). Everything else propagates as a raw `Error` and becomes a 500.

---

## Data privacy

Identity and credentials belong to whichever `IAuthProvider` is configured — for Supabase that's a separate service; for the local provider, Selva itself is the auth provider and holds credentials on disk. This package's own stores hold only opaque session data, user IDs, and authorization metadata. Details: [Providers](https://github.com/VektorNode/selva/blob/main/docs/self-hosting/providers/overview.md) and [Security & Limits](https://github.com/VektorNode/selva/blob/main/docs/self-hosting/concepts/security-and-limits.md).

---

## What not to put in this package

- No runtime dependencies on databases, ORMs, auth SDKs, or HTTP frameworks.
- No concrete adapters. They live in their own packages.
- No service orchestration. Multi-step workflows that compose data + storage live in the consuming app.
- No HTTP-boundary concerns. Zod request schemas and access checks belong in route handlers.
