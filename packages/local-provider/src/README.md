# local-provider

Filesystem implementation of `@selva/platform` interfaces. Each subfolder implements one provider (auth, data, storage, organizations, projects, definitions, computeServer).

## fsJson.ts

Shared helpers used by every JSON-backed store in this package.

### `readJsonFile<T>(filePath, fallback)`

Reads and parses a JSON file. Returns `fallback` if the file doesn't exist (`ENOENT`); any other error propagates. Lets stores boot against an empty data directory without pre-seeding files.

```ts
const { users } = await readJsonFile<UsersFile>(path, { users: [] });
```

### `writeJsonFile<T>(filePath, data)`

Atomic write: ensures the parent directory exists, writes to `<path>.tmp`, then renames into place. The rename is atomic on POSIX, so a crash mid-write leaves either the old file or the new one — never a half-written JSON blob.

```ts
await writeJsonFile(path, { users: [...] });
```

### Why this exists

All stores follow a read-modify-write pattern on small JSON files. Centralizing it means:
- One place to get atomicity right (no partial writes on crash)
- One place to handle "file doesn't exist yet" (fallback instead of try/catch everywhere)
- Tab-indented JSON output for readable diffs when data dirs are checked into git

### Caveats

- Not safe across **processes** — no file locking. Fine for a single dev server; don't point two processes at the same data dir.
- In-process concurrent writes on the same file can still race. Stores that need serialization wrap calls in their own mutex.
- Each write rewrites the whole file. Fine for config-scale data (users, orgs, projects); not for high-churn or large datasets.
