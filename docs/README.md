# Documentation

Docs are grouped by who reads them. Pick the folder that matches what you're
doing; each one is a complete path through its own subject.

Most of what's here also appears on the [Selva docs site](https://selva.dev/docs),
which builds its nav from the folder layout plus each file's `published: true`
frontmatter (see [`packages/website/src/lib/docs.ts`](../packages/website/src/lib/docs.ts)).
Check the site for what's currently public.

## Start here

- **[what-is-selva.md](./what-is-selva.md)** — the problem Selva solves and the two halves that make it work
- **[architecture.md](./architecture.md)** — how the plugin, app, Rhino.Compute, and providers fit together

Both are audience-neutral; read one, then branch.

## [self-hosting/](./self-hosting/) — run the Selva app

For operators deploying and running `@selvajs/selva`. Covers getting a first
deployment live (`get-started/`), putting it on a server behind a proxy
(`deployment/`), choosing an auth/data/storage backend (`providers/`), and the
behaviour you need to understand to run it well — permissions, caching, limits,
scaling (`concepts/`).

## [packages/](./packages/) — build on `@selvajs/*`

For developers embedding Selva's pieces in their own product rather than
deploying the standalone app. Each package's own README is authoritative for its
API; these pages cover how the packages fit together. The
[packages page](https://selva.dev/packages) on the site lists every package with
links to its README and npm entry.

## [contributing/](./contributing/) — work on this repo

Repo-only notes, never published: how the monorepo builds and caches
(`turborepo.md`), how tests are laid out (`testing.md`), and how npm packages and
the Grasshopper plugin get released (`publishing.md`).

## [adr/](./adr/) — architecture decision records

Why things are the way they are. Excluded from the website glob — internal
records, not pages.

- [0001: Pre-Step Producers](./adr/0001-pre-step-producers.md)
- [0002: Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)
- [0003: Large File Output Streaming](./adr/0003-large-file-output-streaming.md)
- [0004: Compute Server Identity and LB Affinity](./adr/0004-compute-server-identity-and-lb-affinity.md)
- [0005: UISchema Version and Disposable Schema Cache](./adr/0005-uischema-version-and-disposable-schema-cache.md)
- [0006: Multi-org URL Shape and Reserved Slugs](./adr/0006-multi-org-url-shape-and-reserved-slugs.md)
- [0007: Credential Recovery & Self-Change Belong on `IAuthProvider`](./adr/0007-auth-credential-recovery-and-change-gap.md)

## Conventions

Every doc that can reach the site lives at `audience/group/doc.md` — the folder
decides its sidebar group, so there is no `group:` frontmatter to drift out of
sync with the path. `contributing/` is exempt: it never reaches the site.

A published doc's path is its public URL. Moving one after release needs a
`REDIRECTS` entry in `docs.ts`, or the old link breaks.
`packages/website/tests/docs-structure.test.ts` enforces the layout and checks
every relative link, so both failures show up as a red test rather than a wrong
sidebar or a dead link.

## Plans

See **[plans/README.md](../plans/README.md)**, the authoritative status and
implementation order for in-progress and archived work. Not duplicated here since
it drifts fast; that file is the source of truth.
