---
title: Writing a provider
group: Providers
order: 4
published: true
description: 'Implement the platform interfaces to back Selva with any auth, data, or storage system.'
---

# Writing a provider

None of the shipped providers fit? Write an adapter for an in-house identity service, a different database, or an S3-compatible store.

## Steps

1. **Implement** the interface(s) you need from `@selvajs/platform` (`IAuthProvider`, `IDataProvider`, `IStorageProvider`). Adopt just one role and reuse shipped providers for the rest.
2. **Scope everything** by `RequestContext`. The query is the security boundary: an unauthorized caller gets empty results or an error, never someone else's data.
3. **Run the conformance suite** from `@selvajs/platform/testing` against your adapter. Passing means it behaves identically to the reference implementation.
4. **Wire it in** via `defineConfig({ auth, data, storage })`.

## The contract

The [platform README](https://github.com/VektorNode/selva/tree/main/packages/platform) is authoritative, including the transaction-ordering rules that keep the metadata store and blob store recoverable when one fails mid-operation (they share no transaction).

## Next

- [Providers overview](../providers.md)
