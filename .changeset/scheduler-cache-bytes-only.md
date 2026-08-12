---
'@selvajs/compute': major
'@selvajs/solve': patch
---

Bound the scheduler's solve cache by bytes only. `CacheOptions.maxEntries` is
removed and `maxBytes` is now required, so `cache: true` is no longer valid —
enabling a cache always states a budget. A budget of `0` disables caching, the
same as `cache: false`.

Two bounds meant every caller had to reason about which one would bind first,
and omitting `maxEntries` silently fell back to a default of 50 that could cap
the cache far below its byte budget. Responses range from KB to hundreds of MB,
so memory is the constraint that actually matters.

Migration: `cache: true` → `cache: { maxBytes: <budget> }`; drop `maxEntries`.
