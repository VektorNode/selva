# Documentation

Docs are grouped by audience. Most of what's here also appears on the
[Selva docs site](https://selva.dev/docs), which builds its nav from the folder
layout plus each file's `published: true` frontmatter
([`packages/website/src/lib/docs.ts`](../packages/website/src/lib/docs.ts)).

## Start here

- [what-is-selva.md](./what-is-selva.md) — the problem Selva solves and the two halves that make it work
- [architecture.md](./architecture.md) — how the plugin, app, Rhino.Compute, and providers fit together

The Selva app carries its own internal specs, kept next to the code they
describe rather than here — they answer "is this route/store/rule correct?",
not "how does Selva work?":

- **[docs/contributing/selva-architecture.md](./contributing/selva-architecture.md)** — entity model, invariants, provider contracts, and what's designed but not yet wired
- **[docs/contributing/permissions.md](./contributing/permissions.md)** — the access-control authority; its permission matrix is parsed by the API conformance test

## [self-hosting/](./self-hosting/) — run the Selva app

For operators deploying `@selvajs/selva`.

- **get-started/** — [overview](./self-hosting/get-started/overview.md), [quick-start](./self-hosting/get-started/quick-start.md), [cli](./self-hosting/get-started/cli.md), [rhino-compute](./self-hosting/get-started/rhino-compute.md)
- **deployment/** — [prerequisites](./self-hosting/deployment/prerequisites.md), [reverse-proxy](./self-hosting/deployment/reverse-proxy.md)
- **providers/** — [overview](./self-hosting/providers/overview.md), [local](./self-hosting/providers/local.md), [supabase](./self-hosting/providers/supabase.md), [header-auth-entra](./self-hosting/providers/header-auth-entra.md), [writing-a-provider](./self-hosting/providers/writing-a-provider.md)
- **concepts/** — [permissions](./self-hosting/concepts/permissions.md), [caching](./self-hosting/concepts/caching.md), [security-and-limits](./self-hosting/concepts/security-and-limits.md), [scaling](./self-hosting/concepts/scaling.md), [admin](./self-hosting/concepts/admin.md)

## [packages/](./packages/) — build on `@selvajs/*`

For developers embedding Selva's pieces rather than deploying the app. Each
package's own README is authoritative for its API.

- [build/overview.md](./packages/build/overview.md) — which packages to reach for, and how they fit

## [contributing/](./contributing/) — work on this repo

Repo-only, never published. No frontmatter — these files are not part of the site
glob, so the `audience/group/doc.md` rule doesn't apply to them.

Workflow:

- [turborepo.md](./contributing/turborepo.md) — how the monorepo builds and caches
- [testing.md](./contributing/testing.md) — test layout and the shared vitest config
- [publishing.md](./contributing/publishing.md) — releasing npm packages and the Grasshopper plugin
- [compute-contributing.md](./contributing/compute-contributing.md) — export-barrel rules and changeset conventions for `@selvajs/compute`

Design references — check code against intent before changing it:

- [selva-architecture.md](./contributing/selva-architecture.md) — entity model, org tenancy, and how a solve is orchestrated
- [permissions.md](./contributing/permissions.md) — the access-control contract; source comments cite it by section number, so section numbering is load-bearing
- [schema-caching.md](./contributing/schema-caching.md) — why the extracted `UISchema` lives on the immutable version row
- [plugin-context.md](./contributing/plugin-context.md) — canvas wiring and schema identity; every rule in it fails silently
- [slva-format.md](./contributing/slva-format.md) — the binary display wire format; the C# encoder and the TS parser must be changed together
- [viewer-apps.md](./contributing/viewer-apps.md) — the `ThreeViewer` seams for drawing your own geometry and tools into the scene

Outstanding work:

- [drawing-backlog.md](./contributing/drawing-backlog.md) — what's still missing in the drawing / SVG / PDF pipeline

Package-local `CONTEXT.md` files ([ui](../packages/ui/CONTEXT.md),
[compute](../packages/compute/CONTEXT.md)) stay next to their code on purpose —
source comments reference them by bare filename.

## [adr/](./adr/) — architecture decision records

Why things are the way they are. Excluded from the website glob.

- [0001: Pre-Step Producers](./adr/0001-pre-step-producers.md)
- [0002: Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)
- [0003: Large File Output Streaming](./adr/0003-large-file-output-streaming.md)
- [0004: Compute Server Identity and LB Affinity](./adr/0004-compute-server-identity-and-lb-affinity.md)
- [0005: UISchema Version and Disposable Schema Cache](./adr/0005-uischema-version-and-disposable-schema-cache.md)
- [0006: Multi-org URL Shape and Reserved Slugs](./adr/0006-multi-org-url-shape-and-reserved-slugs.md)
- [0007: Credential Recovery & Self-Change Belong on `IAuthProvider`](./adr/0007-auth-credential-recovery-and-change-gap.md)

## Conventions

Every doc that can reach the site lives at `audience/group/doc.md` — the folder
decides its sidebar group, so there is no `group:` frontmatter to drift.
`contributing/` and `adr/` are exempt; neither reaches the site.

A published doc's path is its public URL. Moving one after release needs a
`REDIRECTS` entry in `docs.ts`, or the old link breaks.
[`packages/website/tests/docs-structure.test.ts`](../packages/website/tests/docs-structure.test.ts)
enforces the layout and checks every relative link.

## Plans

[plans/README.md](../plans/README.md) is the authoritative status and
implementation order for in-progress and archived work.
