# ADR 0006 — Multi-Org URLs Live Under `/o/{slug}/`; Slugs Are Reserved Now

> **Status: Accepted (2026-07-16).** Resolves audit item
> [D4](../../plans/fixes/data-access-efficiency-audit.md). Reserves the multi-org URL
> namespace and the colliding top-level slugs **before any external link is
> minted**, while deferring the routing itself to when a tenant switcher is
> actually built.

## Problem

The data model is multi-org-ready — `org_members` has a composite PK, and an
`orgs.slug` unique column already exists — but the app collapses to a single
acting org. `buildContext` ([hooks.server.ts](../../packages/selva/src/hooks.server.ts))
resolves one `actingOrgId` from a single `findUserMembership`, with an
instance-admin fallback to `listOrgs(limit: 1)`. There is no org switcher and no
`/o/{slug}/` segment anywhere in the route tree; all app pages live at flat
top-level paths (`/projects`, `/library`, `/team`, …).

Two things about multi-org URLs are decided early or paid for later:

1. **The URL shape is a contract.** The first external link minted against a
   tenant (a shared library URL, an invite deep-link) freezes whatever shape it
   used. Choosing path-vs-subdomain and the exact segment _after_ links exist is
   a redirect-maintenance burden forever.
2. **Slug/route collisions are irreversible in practice.** If a tenant ever
   creates an org whose slug equals a top-level route name (`api`, `team`, …) —
   or the reserved multi-org prefix `o` — that slug can shadow or be shadowed by
   a route. Once such a row exists, you cannot reserve the word without breaking
   it.

Selva is pre-first-release: no external links exist yet, so both decisions are
free to make now and expensive to defer.

## Decision

**Per-org URLs will live under `/o/{slug}/…`** (path-based tenancy, not
subdomain). This is the canonical shape for anything org-scoped once multi-org
ships.

**The routing is NOT built now.** Building `/o/[slug]/` route groups, a
slug-resolution guard, and canonical redirects ahead of a real tenant switcher
would be speculative generality: a second URL surface maintained for a feature
with no switcher and no second-org flow, at risk of being thrown away if the
design shifts. Industry practice (GitHub, Vercel, Linear) is to fix the
tenant-in-path shape early and build the routing alongside the switcher.

**What IS done now — the only irreversible parts:**

- **Reserve the colliding slugs.** `RESERVED_SLUGS` in
  [organizations/schemas.ts](../../packages/platform/src/organizations/schemas.ts)
  lists `o` plus every current top-level route segment (`api`, `admin`, `auth`,
  `login`, `logout`, `setup`, `team`, `library`, `projects`, `accept-invite`).
  `SlugSchema` `.refine()`s against the set, so no org (or, if project slugs ever
  route flat, no project) can take a name that collides. `o` is reserved even
  though `min(3)` already blocks a 1-char slug — belt-and-suspenders, and it
  documents intent for anyone who later relaxes the length rule. Pinned by
  `slug-schema.test.ts`.
- **Fix the shape in this ADR** so the decision is discoverable rather than
  living only in someone's head.

## Consequences

- The URL shape can no longer drift: any future routing work targets
  `/o/{slug}/…` by decision, not by whatever the first PR happened to pick.
- No collision can ever occur: the reserved set is enforced at the single slug
  validator every create path already funnels through.
- `RESERVED_SLUGS` must stay in sync with the top-level route directories — the
  comment on the constant and this ADR both say so. Adding a new top-level route
  means adding its segment to the set (and vice versa).
- When the tenant switcher is built, the remaining work is purely additive:
  introduce the `/o/[slug]/` route group, thread the slug through the layout
  loads, and 301 the flat paths to canonical. None of it is foreclosed here; all
  of it is deferred.

## Alternatives considered

- **Build the thin `/o/[slug]/` route group now** (resolve + validate slug,
  redirect/render flat pages). Rejected: commits to slug-resolution and
  canonical-redirect logic for a feature with no switcher; the reservation
  captures the irreversible value without it.
- **Move the whole app tree under `/o/[slug]/` now.** Rejected: that is the
  multi-org migration itself (~49 internal links, redirects, layout threading),
  done to serve a single org.
- **Subdomain tenancy (`{slug}.selva.app`).** Rejected as the default: path
  tenancy needs no wildcard DNS/TLS and no per-tenant origin, and keeps a
  single-origin deployment (the common case) trivial. Not foreclosed — a
  deployment that wants subdomains can add them — but `/o/{slug}/` is canonical.
