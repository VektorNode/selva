# Webhooks

**Status: designed, not built.**

An integration polling `/api/v1` for "what changed" is slow and burns its rate limit. Webhooks push
org events to a URL the org registers. The hard requirement comes from host apps: the events an ERP
cares about (a job released or withdrawn) are the **host's** domain, so the engine must deliver
event types it has never heard of.

## What exists

- `IEventSink.emit(event: DomainEvent)`: stores call it after a committed mutation; it must not
  throw. `DomainEvent` is a closed union of engine types.
- `SupabaseEventSink` writes every event to `selva.audit_events` (`type text`, `actor_id`,
  `occurred_at`, `data jsonb`, `token_id`). The column types already accept any event name.

## Decisions

### Host apps emit their own events through the same sink

- **Widen the sink, keep the engine union closed:**

  ```ts
  /** A host-defined event. The type must start with the host's own prefix, e.g. `parafa.`. */
  export interface HostEvent {
  	type: `${string}.${string}`;
  	orgId: string;
  	actorId: string;
  	tokenId?: string;
  	[field: string]: unknown;
  }
  export type AnyEvent = DomainEvent | HostEvent;
  interface IEventSink {
  	emit(event: AnyEvent): Promise<void>;
  }
  ```

  A host declares its own union (`{ type: 'parafa.job.released'; jobId; releaseId; ... }`) and
  emits it with `deps.events.emit({ ...event, ...actorOf(ctx) })`. The engine never imports it.

- **Engine names stay unprefixed and reserved.** A host type must carry a prefix the host owns; a
  sink rejects (logs, drops) a host event whose type collides with a `DomainEventType`.
- **Every deliverable event carries `orgId`.** Webhooks are per org. Engine events that lack it
  (`project.deleted`, `definition.*`, `share_link.*`) gain it additively before they become
  deliverable.

### `audit_events` is the outbox

- **The dispatcher reads `audit_events`, it doesn't get its own queue.** The audit row is written
  after the mutation commits and is already durable and ordered. A second write to a separate
  outbox would add a second place for the event to be lost.
- **Add `org_id` to `audit_events`** (nullable, indexed `(org_id, occurred_at, id)`), filled from
  the event. Ids are random uuids, so the cursor is `(occurred_at, id)`.
- **Payloads are ids only,** the same rule the audit log follows. A consumer that needs the record
  fetches it through `/api/v1` with its own token, which keeps authorization in one place. This
  also keeps `invite.created`'s email out of the payload.

### Data model

```sql
create table selva.webhook_endpoints (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid not null references selva.orgs(id) on delete cascade,
  url           text not null,
  event_types   text[] not null,      -- exact names; no wildcards in v1
  secret_enc    bytea not null,       -- the signing secret, encrypted; it must be readable to sign
  created_by    uuid references auth.users(id) on delete set null,
  created_at    timestamptz not null default now(),
  disabled_at   timestamptz,
  disabled_reason text                -- 'manual' | 'failing'
);

create table selva.webhook_deliveries (
  id              uuid primary key default gen_random_uuid(),
  endpoint_id     uuid not null references selva.webhook_endpoints(id) on delete cascade,
  event_id        uuid not null references selva.audit_events(id) on delete cascade,
  attempt         int not null default 0,
  status          text not null,      -- 'pending' | 'delivered' | 'failed'
  next_attempt_at timestamptz not null,
  last_status     int,
  last_error      text,
  unique (endpoint_id, event_id)
);
```

### Delivery

- **At least once, unordered.** Consumers dedupe on `Webhook-Id` (the audit event id).
- **Signed per the Standard Webhooks spec:** `Webhook-Id`, `Webhook-Timestamp`, and
  `Webhook-Signature: v1,<base64 HMAC-SHA256(secret, "{id}.{timestamp}.{body}")>`. Consumers
  reject timestamps older than 5 minutes. Using the published spec means ERP vendors' existing
  verifiers work.
- **Body:** `{ id, type, occurredAt, orgId, data }`, where `data` is the event minus `actorId`
  and `tokenId`.
- **Retries:** exponential backoff (1 m, 5 m, 30 m, 2 h, 6 h, 12 h, 24 h), then `failed`. Any 2xx
  is success; everything else, including a timeout (10 s), retries. An endpoint failing every
  delivery for 3 days is disabled with reason `failing` and the org admins get an email.
- **SSRF:** reuse `assertSafeRemoteDefinitionUrl`; https only outside dev; no redirects; the
  response body is read up to a small cap and discarded.
- **Rotation:** two secrets may be live during a rotation window; the signature header carries
  both, which the spec allows.

### Who runs the dispatcher

- **The engine ships `createWebhookDispatcher({ store, fetch, now })` with a `tick()`;** the host
  decides when to call it. The engine has no scheduler, and a module-level timer would give every
  importer a lifecycle. The Selva app calls `tick()` from an unref'd interval in the hook.
- **Multi-instance safe on Supabase:** `tick()` claims due rows through an RPC using
  `for update skip locked`. The local provider is single-process and claims in memory.
- **Fan-out from events to deliveries happens in `tick()`:** it reads `audit_events` past a
  per-endpoint cursor and inserts `webhook_deliveries` for matching types. No work in the request.

### Who manages it

- **New org permission `manage_webhooks`,** admin role default. Endpoints are session-only like
  the token endpoints: `GET/POST /api/v1/orgs/{orgId}/webhooks`,
  `PATCH/DELETE /api/v1/orgs/{orgId}/webhooks/{id}`, `POST .../{id}/rotate-secret`,
  `GET .../{id}/deliveries`, `POST .../{id}/deliveries/{deliveryId}/retry`. The secret is shown
  once.
- **Events:** `webhook.created`, `webhook.deleted`, `webhook.disabled`, ids only.

## Open questions

- **Private projects.** An org-level endpoint receives ids from projects its creator cannot see.
  Ids only limits the leak, but a project-private event still reveals activity. Options: deliver
  only org-visible events, or record the creator and check their live sight per event.
- **Host event types in the UI.** The endpoint form needs the list of subscribable types. The host
  registers them (`registerWebhookEventTypes([...])`) or the form takes free text.
- **Retention.** Audit rows are kept indefinitely; delivery rows could be pruned after 30 days.
- **Payload versioning.** `AUDIT_EVENT_VERSION` covers engine events; a host event needs its own
  version field, or the host bumps its type name.
