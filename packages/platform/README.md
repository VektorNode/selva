# @selva/platform

Pure TypeScript interfaces that define the Selva platform's contract with its backends. No runtime dependencies on a specific database, storage, or auth service — every concrete adapter (local filesystem, Supabase, Azure, ...) lives in its own package and implements these interfaces.

This README is the contract. Read it before writing an adapter.

---

## Interfaces at a glance

| Interface | Purpose | Scoped by `RequestContext`? |
| --- | --- | --- |
| `IAuthProvider` | Verify tokens, manage users, issue sessions. | No — the auth provider *produces* the identity that fills the context. |
| `IOrgStore` | Orgs, projects, memberships, access checks. | Yes — every method. |
| `IDefinitionStore` | Definition metadata records + history entries. | Yes — every method. |
| `IComputeServerStore` | Global compute-server config. Platform-admin only. | No — not tenant-scoped. |
| `IStorageProvider` | Path-based blob storage (files, cover images, archives). | No — callers pass already-scoped paths. |

`IDataProvider` is the composition: `{ orgs, definitions, computeServer }`. An adapter typically implements one class per store and aggregates them.

---

## RequestContext rules

`RequestContext` carries the caller's identity and active scope. It is built once per HTTP request in `hooks.server.ts` from the authenticated session.

**Rules:**

1. **The query is the security boundary.** Adapters MUST filter reads and writes by `ctx`. An unauthorized caller gets an empty page, `null`, or a `ProviderError` — never someone else's data.
2. **Never trust a caller's pre-flight check.** `canSolve` / `canEdit` / `canManage` are UI-gating conveniences. A mutating method must remain safe even if the caller skipped them.
3. **Extend `RequestContext`, not method signatures.** When you need a new dimension (e.g. `tenantId`, `impersonatedBy`), add a field to the interface. Do not thread it through every call.
4. **`SYSTEM_CONTEXT` is for trusted server code only.** Bootstrap, scheduled janitors, migrations, test setup. Never derive it from a user session.

---

## Transaction ordering rules

Providers are two-phase: a metadata store (`IDataProvider`) and a blob store (`IStorageProvider`). They have no shared transaction. Services in this package (`DefinitionService`) compose them using a fixed ordering so that a partial failure is recoverable.

**Create — metadata-first with `pending` → `ready`:**

1. Write the record with `status: 'pending'`.
2. Upload the blob.
3. Flip `status` to `'ready'`.

List queries filter `'pending'` by default (`ListOptions.includePending` opts in). If step 2 fails, the record is invisible to consumers. `DefinitionService.gcStalePending` sweeps records older than `PENDING_GC_AGE_MS` (30 min).

**Delete — blob-first:**

1. `storage.deletePrefix(prefix)`.
2. `data.delete(guid)`.

If step 2 fails, a retry re-deletes blobs (no-op) and succeeds. The record never points at live blobs it shouldn't.

**Update-file — best-effort, retry-safe:**

Archive current → append history → write new → prune history. Not fully atomic; retrying the same file converges. Documented limitation (see `DefinitionService.updateFile`).

---

## A minimal adapter (30 lines)

```ts
import type {
  IDefinitionStore, DefinitionRecord, DefinitionRecordPatch,
  HistoryEntry, RequestContext, ListOptions, Page
} from '@selva/platform';

export class MyDefinitionStore implements IDefinitionStore {
  async list(ctx: RequestContext, opts?: ListOptions): Promise<Page<DefinitionRecord>> {
    // Filter by ctx.orgId; exclude status='pending' unless opts.includePending.
    // Return { items, nextCursor } honoring opts.limit / opts.cursor.
  }
  async listByProject(ctx, projectId, opts) { /* ... */ }
  async listPublic(ctx, opts) { /* ... */ }
  async get(ctx, guid) { /* ... */ }
  async create(ctx, record) { /* ... */ }
  async update(ctx, guid, patch) { /* ... */ }
  async addHistoryEntry(ctx, guid, entry) { /* ... */ }
  async removeHistoryEntry(ctx, guid, ref) { /* ... */ }
  async delete(ctx, guid) { /* ... */ }
  async listStalePending(ctx, olderThanIso) {
    // SYSTEM_CONTEXT only. Return records with status='pending' and createdAt <= cutoff.
  }
}
```

Wire it into a `SelvaConfig` via `defineConfig({ auth, data, storage })`.

---

## Testing your adapter

This package ships a conformance suite at `@selva/platform/testing`. Every adapter imports it and runs it against its own instance. If your adapter passes, it behaves the same as the in-memory reference and will drop into the compute-app without surprises.

```ts
import { runDefinitionStoreConformance } from '@selva/platform/testing';
import { MyDefinitionStore } from './MyDefinitionStore.js';

runDefinitionStoreConformance({
  name: 'my-adapter',
  createStore: async () => new MyDefinitionStore(/* ... */)
});
```

The suite covers: `ctx` scoping, `pending` filtering, `includePending` opt-in, `listStalePending` cutoff behavior, history pruning, and `ProviderError` shapes on missing records. It does not cover performance or concurrency — those are the adapter's responsibility.

---

## Data Privacy & Security

**User data isolation is by design.** All authentication, credentials, and personally identifiable information (PII) are owned exclusively by the auth provider. Selva stores only:

- Opaque session tokens (in cookies)
- User ID and permissions (minimal authorization data)
- Optional provider-specific metadata (non-sensitive only)

**Selva has zero exposure to:**
- EU GDPR, CCPA, or other data residency regulations (provider's responsibility)
- User credentials, passwords, or OAuth tokens (provider manages these)
- Company user records or sensitive employee data (provider owns this)

### Auth Provider Contract

`IAuthProvider` is the trust boundary. The provider is responsible for:

1. **Token generation & validation** — Format is provider-specific (HMAC, JWT, OAuth, OIDC, etc.)
2. **Credential management** — Passwords, OAuth tokens, MFA secrets
3. **User lifecycle** — Creation, password resets, account deletion
4. **Data residency & retention** — Where user data lives, how long it's kept, GDPR compliance
5. **Password reset flows** — Email tokens, validation, expiration (via `requestPasswordReset` / `completePasswordReset`)

Selva never stores, logs, or processes raw credentials. For password resets:
- OAuth providers return `'not_supported'` (reset handled by OAuth platform)
- Local/email-based providers implement token generation, email delivery, and validation
- Selva only receives the final `AuthUser` object after reset completes

### RequestContext Security

Every data store method receives a `RequestContext` containing the authenticated user and their active scope. The adapter MUST enforce access control:

```ts
async list(ctx: RequestContext, opts?: ListOptions): Promise<Page<DefinitionRecord>> {
  // Filter by ctx.orgId — never leak data from other orgs
  // Respect ctx.permissions for visibility rules
  // Return empty page for unauthorized callers
}
```

See [RequestContext rules](#requestcontext-rules) for the full contract.

---

## Errors

Throw `ProviderError` for user-facing failures (`new ProviderError('...', 404)`). Everything else should propagate as a raw `Error` — the compute-app will render it as a 500.

---

## What not to put in this package

- No runtime dependencies on databases, ORMs, auth SDKs, or HTTP frameworks.
- No concrete adapters. They live in their own packages (`selva-local-provider`, future `selva-supabase-provider`, ...).
- No business logic beyond the service composition in `DefinitionService`. Access checks, multi-step workflows, and rendering concerns belong in the consuming app.
