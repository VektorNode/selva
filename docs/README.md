# Documentation

Docs are grouped by audience. The [Selva docs site](https://selva.dev/docs) builds its nav from the
folder layout plus each file's `published: true` frontmatter
([`packages/website/src/lib/docs.ts`](../packages/website/src/lib/docs.ts)).

## Start here

- [what-is-selva.md](./what-is-selva.md): your workflow, everyone's tool, the problem Selva solves and the two halves that make it work
- [architecture.md](./architecture.md): how the plugin, app, Rhino.Compute, and providers fit together

## [self-hosting/](./self-hosting/): run the Selva app

For operators deploying `@selvajs/selva`. One folder per sidebar group:

- [get-started/](./self-hosting/get-started/): the path from nothing to a running deployment (overview, quick-start, CLI, Rhino.Compute)
- [deployment/](./self-hosting/deployment/): prerequisites, reverse proxy, security and limits, scaling, admin
- [providers/](./self-hosting/providers/): the auth, data and storage backends (local, Supabase, header-auth) and how to write one
- [concepts/](./self-hosting/concepts/): permissions, caching, data privacy

## [packages/build/](./packages/build/): build on `@selvajs/*`

For developers embedding Selva's pieces rather than deploying the app. Start at
[overview.md](./packages/build/overview.md), which says which packages to reach for. The other
guides cover `@selvajs/compute` (how it works, data trees, errors, common tasks), signing in from
apps, MCP, and the [Night look](./packages/build/night-scenes.md). Each package's own README is
authoritative for its API.

## [contributing/](./contributing/): work on this repo

Repo-only. No frontmatter, so `docs.ts` never publishes these (a link into one lands on a "not
public yet" stub) and the `audience/group/doc.md` rule doesn't apply.

Workflow:

- [turborepo.md](./contributing/turborepo.md): how the monorepo builds and caches
- [testing.md](./contributing/testing.md): test layout and the shared vitest config
- [publishing.md](./contributing/publishing.md): releasing npm packages and the Grasshopper plugin
- [compute-contributing.md](./contributing/compute-contributing.md): export-barrel rules, error handling and adding an input param type for `@selvajs/compute`
- [diagrams.md](./contributing/diagrams.md): mermaid versus hand-drawn SVG, and the shared palette

Design references (check code against intent before changing it):

- [selva-architecture.md](./contributing/selva-architecture.md): entity model, org tenancy, and how a solve is orchestrated
- [permissions.md](./contributing/permissions.md): the access-control contract; source comments cite it by section number and the API conformance test parses its permission matrix, so section numbering is load-bearing
- [schema-caching.md](./contributing/schema-caching.md): why the extracted `UISchema` lives on the immutable version row
- [plugin-context.md](./contributing/plugin-context.md): canvas wiring and schema identity; every rule in it fails silently
- [slva-format.md](./contributing/slva-format.md): the binary display wire format; the C# encoder and the TS parser must be changed together
- [viewer-apps.md](./contributing/viewer-apps.md): the `ThreeViewer` seams for drawing your own geometry and tools into the scene
- [design-system.md](./contributing/design-system.md): surface roles, states, radius and spacing for every Svelte package; the lint enforces part of it
- [materials-plan.md](./contributing/materials-plan.md): mapping, tangents, presets and environment for metal, wood and other viewer materials

Package-local `CONTEXT.md` files ([ui](../packages/ui/CONTEXT.md),
[compute](../packages/compute/CONTEXT.md)) stay next to their code on purpose:
source comments reference them by bare filename.

## [adr/](./adr/): architecture decision records

Why things are the way they are. Excluded from the website glob.

- [0001: Pre-Step Producers](./adr/0001-pre-step-producers.md)
- [0002: Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)
- [0003: Large File Output Streaming](./adr/0003-large-file-output-streaming.md)
- [0004: Compute Server Identity and LB Affinity](./adr/0004-compute-server-identity-and-lb-affinity.md)
- [0005: UISchema Version and Disposable Schema Cache](./adr/0005-uischema-version-and-disposable-schema-cache.md)
- [0006: Multi-org URL Shape and Reserved Slugs](./adr/0006-multi-org-url-shape-and-reserved-slugs.md)
- [0007: Credential Recovery & Self-Change Belong on `IAuthProvider`](./adr/0007-auth-credential-recovery-and-change-gap.md)
- [0008: A Per-Document Solve Runtime Owns the Solve](./adr/0008-solve-runtime-owns-the-solve.md)

## Conventions

Published docs live at `audience/group/doc.md`: the folder decides the sidebar group, so there is
no `group:` frontmatter to drift. `contributing/` and `adr/` are exempt; neither reaches the site.

A published doc's path is its public URL. Moving one after release needs a
`REDIRECTS` entry in `docs.ts`, or the old link breaks.
[`packages/website/tests/docs-structure.test.ts`](../packages/website/tests/docs-structure.test.ts)
enforces the layout and checks every relative link.

## Plans

[plans/README.md](../plans/README.md) maps each in-progress and archived plan to the issue that
tracks it. Status lives on the issue tracker.
