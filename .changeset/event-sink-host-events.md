---
'@selvajs/platform': minor
'@selvajs/supabase-provider': minor
---

`IEventSink`, `NoopEventSink`, `SupabaseEventSink`, the audit read types and `SupabaseAuditQuery` take an event type parameter `E extends BaseEvent` (`{ type: string; actorId: string; tokenId?: string }`), defaulting to `DomainEvent`. A host writes its own audit events into the same sink and `audit_events` table through an `IEventSink<DomainEvent | HostEvent>`, which still satisfies Selva's `IEventSink`. `BaseEvent` is exported.
