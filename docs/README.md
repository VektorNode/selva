# Documentation

This is the repo-internal index. Most of what's below also appears on the
[Selva docs site](https://selva.dev/docs), which builds its nav from each file's
`published: true` frontmatter (see
[`packages/website/src/lib/docs.ts`](../packages/website/src/lib/docs.ts)). Check
the site for what's currently public. This index also covers the docs that never
get published: contributor notes, ops notes, and ADRs.

## Published on the site

- **Get Started:** [what-is-selva.md](what-is-selva.md), [getting-started/overview.md](./getting-started/overview.md), [getting-started/build-your-own-app.md](./getting-started/build-your-own-app.md), [QuickStart.md](QuickStart.md), [CLI.md](CLI.md), [RhinoCompute.md](RhinoCompute.md)
- **Concepts:** [architecture.md](architecture.md), [Caching.md](Caching.md), [permissions.md](permissions.md), [admin.md](admin.md), [security-and-limits.md](security-and-limits.md), [providers.md](providers.md)
- **Providers:** [providers/local.md](./providers/local.md), [providers/supabase.md](./providers/supabase.md), [providers/header-auth-entra.md](./providers/header-auth-entra.md), [providers/writing-a-provider.md](./providers/writing-a-provider.md)
- **Deployment:** [deployment/prerequisites.md](./deployment/prerequisites.md), [deployment/reverse-proxy.md](./deployment/reverse-proxy.md)

Package-specific READMEs (e.g. [@selvajs/local-provider](../packages/providers/local/README.md), [@selvajs/supabase-provider](../packages/providers/supabase/README.md), [@selvajs/header-auth-provider](../packages/providers/header-auth/README.md)) stay with their package and aren't part of this glob.

## Repo-only (not published)

Contributor and operator docs. Set up a dev environment, understand how the repo builds and releases, or work on it directly:

- **[Turborepo.md](Turborepo.md)**: Task orchestration across the monorepo
- **[Testing.md](Testing.md)**: Vitest and Playwright
- **[Publishing.md](Publishing.md)**: npm releases (Changesets) and Grasshopper plugin (Yak)
- **[Scaling.md](Scaling.md)**: Current limits of the compute/data path and the staged scaling roadmap
- **[deployment/Caddyfile.example](./deployment/Caddyfile.example)**: Reference Caddy config

## Architecture Decision Records

- **[ADR 0001: Pre-Step Producers](./adr/0001-pre-step-producers.md)**
- **[ADR 0002: Grasshopper Bridge Seam](./adr/0002-grasshopper-bridge-seam.md)**
- **[ADR 0003: Large File Output Streaming](./adr/0003-large-file-output-streaming.md)**
- **[ADR 0004: Compute Server Identity and LB Affinity](./adr/0004-compute-server-identity-and-lb-affinity.md)**
- **[ADR 0005: UISchema Version and Disposable Schema Cache](./adr/0005-uischema-version-and-disposable-schema-cache.md)**
- **[ADR 0006: Multi-org URL Shape and Reserved Slugs](./adr/0006-multi-org-url-shape-and-reserved-slugs.md)**
- **[ADR 0007: Credential Recovery & Self-Change Belong on `IAuthProvider`](./adr/0007-auth-credential-recovery-and-change-gap.md)**

## Plans

See **[plans/README.md](../plans/README.md)**, the authoritative status and implementation order for in-progress and archived work. Not duplicated here since it drifts fast; that file is the source of truth.
