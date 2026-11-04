---
title: Writing a provider
order: 4
published: true
description: 'Implement the platform interfaces to back Selva with any auth, data, or storage system.'
---

# Writing a provider

## Steps

1. **Implement** the interface(s) you need from `@selvajs/platform`: `IAuthProvider`, `IDataProvider`, `IStorageProvider`.
2. **Scope everything** by `RequestContext`. The query is the security boundary: an unauthorized caller gets empty results or an error, never someone else's data.
3. **Run the conformance suites** from `@selvajs/platform/testing` against your adapter.
4. **Wire it in** with `defineConfig((env) => ({ auth, data, storage }))` in a `.js` file, and point `SELVA_CONFIG_PATH` at it (absolute, or relative to the working directory).

`SELVA_CONFIG_PATH` replaces the env-driven wiring entirely. `SELVA_AUTH_PROVIDER`, `SELVA_DATA_PROVIDER`, `SELVA_STORAGE_PROVIDER`, `SELVA_TENANCY`, `SELVA_FLAG_*` and `SELVA_BRAND_*` are ignored unless your config reads them from `env`. Left out, tenancy is `single`, every flag is off, and `solveMetrics` is a no-op.

## The contract

The [platform README](https://www.npmjs.com/package/@selvajs/platform) is authoritative, including the ordering rules that keep the metadata and blob stores recoverable (they share no transaction).

## Next

- [Providers overview](./overview.md)
