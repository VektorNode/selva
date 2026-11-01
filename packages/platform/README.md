# @selvajs/platform

Selva's contract with its backends: the interfaces, plus the logic every adapter shares (access rules, API-token scopes, at-rest secret encryption, Zod request schemas, slugs, the image transcoder) and vitest conformance suites. No dependency on a specific database, storage or auth service. Concrete adapters live in their own packages: `@selvajs/local-provider`, `@selvajs/supabase-provider`, `@selvajs/header-auth-provider`.

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
| `IApiTokenStore`             | API tokens and their revocation.                                                  | Yes — every method.                                                  |
| `IStorageProvider`           | Path-based blob storage. Authorization is the caller's responsibility.            | No — callers pass already-authorized paths.                          |

`IDataProvider` composes every store, plus optional `auditQuery` / `events` hooks, an optional `verifySchemaVersion` handshake (for adapters whose schema migrates out-of-band), and the `ensureUser` / `onUserDeleted` lifecycle methods. An adapter typically implements one class per store and aggregates them.

---

## RequestContext rules

`RequestContext` carries the caller's identity and active scope. Built once per HTTP request in `hooks.server.ts` from the authenticated session.

1. **The query is the security boundary.** Adapters MUST filter reads and writes by `ctx`. An unauthorized caller gets an empty page, `null`, or a `ProviderError` — never someone else's data.
2. **Never trust a caller's pre-flight check.** The predicates in [`access/rules.ts`](src/access/rules.ts) gate the UI and the route layer. A mutating store method must remain safe even if the caller skipped them.
3. **Extend `RequestContext`, not method signatures.** Add a field to the interface for new dimensions (e.g. `tenantId`); don't thread it through every call.
4. **`SYSTEM_CONTEXT` is for trusted server code only.** Bootstrap, scheduled janitors, migrations, test setup. Never derive it from a user session.

---

## Transaction ordering rules

Providers are two-phase: a metadata store (`IDataProvider`) and a blob store (`IStorageProvider`) with no shared transaction. The definition service in [`@selvajs/server/definitions`](../server/src/definitions/definition-service.ts) composes them with fixed ordering so partial failure is recoverable.

**Create — metadata-first, `pending` → `draft`:**

1. Write the record with `status: 'pending'`.
2. Upload the blob.
3. `attachInitialVersion` flips `status` to `'draft'`.

List queries filter `'pending'` and `'archived'` by default (`DefinitionListOptions.includePending` / `includeArchived` opt in). If step 2 fails, the record stays `'pending'` and is invisible to consumers.

**Delete — metadata-first:**

1. `data.delete(guid)`, which hides the record at once.
2. `storage.deletePrefix(prefix)`.

If step 2 fails, the blobs are orphans no reader can reach. The reverse order would leave a live record with its blobs gone.

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

The Selva app normally picks bundled providers from `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`. For an adapter that isn't bundled, export a `defineConfig({ auth, data, storage, … })` result from a `.js` file and point `SELVA_CONFIG_PATH` at it — see [config.ts](src/config.ts) for the full `SelvaConfig` shape (tenancy, flags, branding, event/metric sinks, binding resolver).

---

## Testing your adapter

`@selvajs/platform/testing` ships a conformance suite per store. Adapters import it and run it against their own instance — passing means the adapter honours the contract the bundled providers do.

```ts
import { runDefinitionStoreConformance } from '@selvajs/platform/testing';
import { MyDefinitionStore } from './MyDefinitionStore.js';

runDefinitionStoreConformance({
	name: 'my-adapter',
	createStore: async () => new MyDefinitionStore(/* ... */)
});
```

A suite exists per store, plus auth, email-link auth, storage, event sink and solve-metric sink. `runAuthProviderConformance` wraps `runAuthCoreConformance` and `runPasswordAuthConformance`, so a provider without passwords can run the core alone or pass `passwordless`. New cases go behind an option, so an upgrade doesn't turn a third-party adapter red. The suites cover `ctx` scoping, `pending` filtering, `includePending` opt-in, `ProviderError` shapes, and the races a store exists to prevent, such as the share-link solve cap. They don't cover performance.

`sharp` is an optional peer dependency. An adapter that calls `transcodeImageIfNeeded` has to install it.

---

## Errors

Throw `ProviderError` for user-facing failures (`new ProviderError('...', 404)`). Everything else propagates as a raw `Error` and becomes a 500.

---

## Data privacy

Identity and credentials belong to whichever `IAuthProvider` is configured — for Supabase that's a separate service; for the local provider, Selva itself is the auth provider and holds email addresses and password hashes on disk. This package's own stores hold user IDs, authorization metadata, display names, invite email addresses, and audit payloads. **The operator is the data controller.** See [data privacy](../../docs/self-hosting/concepts/data-privacy.md) for the full inventory and what erasure reaches, plus [providers](../../docs/self-hosting/providers/overview.md) and [security & limits](../../docs/self-hosting/concepts/security-and-limits.md).

---

## What not to put in this package

- No runtime dependencies on databases, ORMs, auth SDKs, or HTTP frameworks.
- No concrete adapters — they live in their own packages.
- No service orchestration. Multi-step workflows composing data + storage live in `@selvajs/server`.
- No HTTP-boundary concerns. Zod request schemas and route gating belong in the app's handlers.
