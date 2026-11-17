---
'@selvajs/platform': minor
'@selvajs/supabase-provider': minor
'@selvajs/server': minor
'@selvajs/selva': minor
---

Retention for audit events and solve metrics. `SELVA_AUDIT_RETENTION_DAYS` and `SELVA_SOLVE_METRICS_RETENTION_DAYS` (default 0: kept forever) set how long rows are kept; a janitor purges older ones at start and then daily. `IDataProvider.purgeExpired` is new and optional (`SupabaseDataProvider` implements it); `startRetentionJanitor` and `resolveRetentionPolicy` are exported from `@selvajs/server/ops`.
