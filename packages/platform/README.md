# @selvajs/platform

Selva's contract with its backends: the interfaces, plus the logic every adapter shares (access rules, API-token scopes, at-rest secret encryption, Zod request schemas, slugs, the image transcoder) and vitest conformance suites. No dependency on a specific database, storage or auth service. Concrete adapters live in their own packages: `@selvajs/local-provider`, `@selvajs/supabase-provider`, `@selvajs/header-auth-provider`.

This README is the contract. Read it before writing an adapter.

---

## Interfaces at a glance

| Interface                    | Purpose                                                                                                                                                                                               | Who scopes by `ctx`                                                     |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `IAuthProvider`              | Verify tokens, manage users, issue sessions. Optional `passwordAuth?` capability.                                                                                                                     | Nobody: the auth provider produces the identity that fills the context. |
| `IPlatformPermissionStore`   | Per-user platform permissions; owns the sole-`instance_admin` invariant.                                                                                                                              | The store, through the `assertCan*` guards, in every bundled adapter.   |
| `IUserProfileStore`          | Per-user profile (display name, starred definitions, recent runs).                                                                                                                                    | The store, by `ctx.userId`, through `assertCanAccessProfile`.           |
| `IOrgStore`                  | Orgs and org memberships.                                                                                                                                                                             | Depends on the adapter: see rule 1.                                     |
| `IProjectStore`              | Projects and project memberships.                                                                                                                                                                     | Depends on the adapter: see rule 1.                                     |
| `IPlatformProjectGrantStore` | Instance-admin-managed grants onto `platform`-visibility projects. The Supabase adapter doesn't implement it (its grant store throws 501), so `ENABLE_PLATFORM_PROJECTS` has nothing behind it there. | Depends on the adapter: see rule 1.                                     |
| `IDefinitionStore`           | Definition metadata records + version history.                                                                                                                                                        | Depends on the adapter: see rule 1.                                     |
| `IShareLinkStore`            | Per-definition anonymous-access tokens.                                                                                                                                                               | Depends on the adapter: see rule 1.                                     |
| `IInviteStore`               | Pending org-membership invitations.                                                                                                                                                                   | Depends on the adapter: see rule 1.                                     |
| `IComputeServerStore`        | Global + per-org compute-server config.                                                                                                                                                               | Nobody: not tenant-scoped. Org-facing reads pass `scopeToOrgId`.        |
| `IApiTokenStore`             | API tokens and their revocation.                                                                                                                                                                      | Depends on the adapter: see rule 1.                                     |
| `IStorageProvider`           | Path-based blob storage. Authorization is the caller's responsibility.                                                                                                                                | Nobody: callers pass already-authorized paths.                          |

`IDataProvider` composes every store, plus optional `auditQuery` / `events` hooks, an optional `verifySchemaVersion` handshake (for adapters whose schema migrates out-of-band), and the `ensureUser` / `onUserDeleted` lifecycle methods. An adapter typically implements one class per store and aggregates them.

---

## RequestContext rules

`RequestContext` carries the caller's identity and active scope. Built once per HTTP request in `hooks.server.ts` from the authenticated session.

1. **Know where your adapter enforces scoping.** The Supabase adapter enforces it in the store: RLS runs every query as the user the session token names, so an unauthorized caller gets an empty page, `null` or a `ProviderError`. Its permission and user-profile stores are the exception: they read with the service role and trust `ctx`, through the `assertCan*` guards. The local adapter enforces `ctx` only in its permission and user-profile stores, with the same guards. Its other stores (definitions, orgs, projects, share links, invites, API tokens, grants) ignore `ctx` for scoping and rely on the access guards in [`@selvajs/server`](../server/src/access/guards.ts) running before the call. Both designs are valid. An adapter that scopes in the store should pass `ctxIsolation` to the conformance suites that take it.
2. **A store that scopes by `ctx` doesn't trust the caller's pre-flight check.** The predicates in [`access/rules.ts`](src/access/rules.ts) gate the UI and the route layer. In such a store, a mutating method stays safe even if the caller skipped them. A store that leaves scoping to the server guards is only as safe as its callers: each one must run those guards first.
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
		// Scope by ctx if this store enforces access (rule 1); exclude status='pending' unless opts.includePending.
	}
	// ... etc
}
```

The Selva app normally picks bundled providers from `SELVA_AUTH_PROVIDER` / `SELVA_DATA_PROVIDER` / `SELVA_STORAGE_PROVIDER`. For an adapter that isn't bundled, export a `defineConfig({ auth, data, storage, … })` result from a `.js` file and point `SELVA_CONFIG_PATH` at it — see [selva-config.ts](src/selva-config.ts) for the full `SelvaConfig` shape (tenancy, flags, branding, event/metric sinks, binding resolver).

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

A suite exists per store, plus auth, OAuth, email-link auth, storage, audit query, event sink, solve-metric sink and user erasure. `runAuthProviderConformance` wraps `runAuthCoreConformance` and `runPasswordAuthConformance`, so a provider without passwords can run the core alone or pass `passwordless`. The suites cover `pending` filtering, `includePending` opt-in, `ProviderError` shapes, and the races a store exists to prevent, such as the share-link solve cap. They don't cover performance.

New and stricter cases sit behind options that default off, so an upgrade doesn't turn a third-party adapter red. Each suite's options type documents its own: `ctxIsolation` for scoping in the store, `strictDenials` for exact `ProviderError` statuses, `nonAdminCtx` for a default `ctx` without `instance_admin`, and per-suite cases such as `auditStamps` or `publicListing`. Turn on every option your adapter passes.

`sharp` is an optional peer dependency. An adapter that calls `transcodeImageIfNeeded` has to install it.

---

## Errors

Throw `ProviderError` for user-facing failures (`new ProviderError('...', 404)`). Everything else propagates as a raw `Error` and becomes a 500.

---

## Data privacy

Identity and credentials belong to whichever `IAuthProvider` is configured — for Supabase that's a separate service; for the local provider, Selva itself is the auth provider and holds email addresses and password hashes on disk. This package's own stores hold user IDs, authorization metadata, display names, invite email addresses, and audit payloads. **The operator is the data controller.** See [data privacy](../../docs/self-hosting/concepts/data-privacy.md) for the full inventory and what erasure reaches, plus [providers](../../docs/self-hosting/providers/overview.md) and [security & limits](../../docs/self-hosting/deployment/security-and-limits.md).

---

## What not to put in this package

- No runtime dependencies on databases, ORMs, auth SDKs, or HTTP frameworks.
- No concrete adapters — they live in their own packages.
- No service orchestration. Multi-step workflows composing data + storage live in `@selvajs/server`.
- No HTTP-boundary concerns such as route gating. New request-body schemas belong with the handlers in `@selvajs/server`.
