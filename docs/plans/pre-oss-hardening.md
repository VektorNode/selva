# Pre-open-source hardening — consolidated audit findings

Status: 2026-07-14. Repo ~2 months from open-sourcing. Findings from a three-way audit
(CI/CD, npm publishing, OSS/docs). Ordered by launch impact. Checkboxes = not yet done.

## Already fixed this session

- [x] `.gitignore` — added `coverage/` and `*.tsbuildinfo`.
- [x] lint-staged — compute `.ts`/`.svelte` files now lint via compute's own eslint config
      (they're ignored by the root config, so the pre-commit hook was formatting-but-not-linting them).

---

## P0 — correctness / security (do before launch, some before next release)

- [ ] **CI runs almost no tests.** `test.yml` runs only local-provider + supabase-provider +
      selva; `release.yml` gates publish on local-provider **alone**. `@selvajs/compute` (~803
      tests), `@selvajs/server` (incl. `token-codec`, `safe-url`, `rate-limit`, `security-headers`
      security tests), `ui`, `plugin-ui` **never run in CI**. A regression in compute/server can ship
      to npm green. Fix: run `turbo run test` (all no-infra suites) in both workflows, or explicitly
      enumerate exclusions with reasons. **Highest-leverage single fix in this doc.**
- [ ] **Publishing ships test files.** `server`, `local-provider`, `supabase-provider` have
      `files: ["dist","src"]` with no test exclusion in tsconfig `include`, so `**/__tests__/*.test.*`
      ship in the tarball (compiled + raw). `local-provider/dist` also has **stale** test dirs with no
      matching src. Fix: exclude `**/__tests__/**`/`*.test.*` from tsconfig + `files` (copy the
      `@selvajs/ui` pattern), clean stale dist. `compute` and `ui` are already clean.
- [ ] **Missing LICENSE files in published packages.** All declare `"license":"MIT"` but only
      `packages/ui/LICENSE` exists. `compute` even lists a `LICENSE.md` in `files` that doesn't exist
      (npm warns, ships none). Add LICENSE to every published package (or a root-copy step).

## P1 — OSS launch blockers (community/legal/first-impression)

- [x] **Add `SECURITY.md`** (vulnerability disclosure path) — an auth-holding self-hostable web app
      without one is a red flag for the IT/enterprise adopters in the sponsorship strategy. Points at
      GitHub Security Advisories private reporting; note enabling that feature in repo settings is a
      separate manual step.
- [x] **Add `CODE_OF_CONDUCT.md`** (NLnet and similar grant bodies expect it). Contributor Covenant
      2.1, enforcement contact via GitHub Security Advisories.
- [x] **Delete `UNVALIDATED_CHANGE.md`** (root) — stale, self-contradictory internal note
      (claims "not committed" but is committed; points at a test file that has since moved).
- [x] **No CodeQL / dependency-review / SAST.** Added `codeql.yml` (JS/TS + C#, `build-mode: none`,
      `security-and-quality` queries, PR + push + weekly) and `dependency-review.yml` (PR-scoped, fails
      on moderate+ vulns, denies GPL/AGPL/LGPL-3 copyleft). `pnpm audit --prod` remains as the full-tree gate.
- [x] **Dependabot auto-merge + weak test gate.** With P0 now running the full suite on every PR,
      `dependabot-auto-merge.yml` gained a "Wait for CI checks to pass" step: it polls the head SHA's
      check runs (excluding its own `pull_request_target` run to avoid a self-wait deadlock) and refuses
      to approve/merge unless every check concludes non-failing. The gate lives in the workflow, so it
      holds even if branch-protection required-checks aren't configured.

## P1 — publishing metadata (before packages go public)

- [x] **`@selvajs/server` has no README.** Added — short overview + subpath export table.
- [x] **Missing `repository`/`author` on** `ui`, `schemas`, `cli`, `selva`. Added `repository`
      (matching the `server`/`platform`/providers convention; no `author` field, same as those).
- [x] **`compute` `repository` still points at `VektorNode/selva-compute`** (the archived repo) —
      updated to the monorepo (`VektorNode/selva.git`, `directory: packages/compute`). Its
      `packageManager` bumped to `pnpm@10.33.0` to match root.
- [x] **`workspace:*` on runtime `dependencies`** (server→platform/schemas, providers→platform)
      publishes as an **exact-version pin** — forces lockstep republishing. Switched to `workspace:^`
      in `platform`, `server`, `local-provider`, `supabase-provider` (compute already did).
- [x] **`publint --strict` prepack gate** added to compute/schemas/platform/server/local/supabase
      (via shared `scripts/prepack.js`) and `ui`'s existing `publint` bumped to `--strict`. Caught a
      **real** bug: `compute`'s dual ESM+CJS exports pointed every `require` condition at an ESM `.d.ts`,
      so CJS consumers got broken types — fixed by splitting per-condition `types` and referencing the
      `.d.cts` files tsup already emits. Also cleared publint's `repository.url` suggestion (added the
      `git+` prefix) across all nine package.jsons. `attw` was evaluated and **skipped**: these packages
      are ESM-only, so attw's only findings (`NoResolution` node10, `CJSResolvesToESM`) are inherent to
      that posture, not drift — gating on it means suppressing its only two rules, leaving no signal.
- [x] **`source` export condition stripped from published tarballs.** Kept in the committed
      package.json (the dev inner-loop — vitest `resolve.conditions:['source']` reading raw TS with no
      rebuild — is untouched; verified via the header-auth suite, 41/41), but `scripts/prepack.js`
      removes every `source` condition and drops the now-orphaned `src/` from `files` at pack time, with
      a paired `postpack` restoring the tree (self-healing on a crashed run). Verified against real
      `pnpm pack` tarballs: 0 `source` conditions, `files: ["dist"]`, no `src/`. `ui` is intentionally
      exempt (it ships `src/lib` for its `./styles/*.css` + Svelte source).

## P2 — consistency / hygiene

- [x] **Node version drift.** Unified every workflow to Node **22** — bumped `e2e.yml` +
      `plugin-release.yml` from 20. Also raised the three packages that floored at `>=20`
      (cli/selva `>=20.6.0`, compute `>=20.0.0`) to `>=22.0.0` and fixed `CLAUDE.md` Requirements
      (was "Node.js >= 18.0.0"). Node 22 is now the single version everywhere.
- [x] **`engines.node` added** to ui/schemas/platform/server/local/supabase/header-auth
      (`>=22.0.0`), matching root — all 10 published/private packages now declare a Node 22 floor.
- [x] **`docs/README.md` "Plans" section refreshed** — dropped the 3 dead links and linked the
      live plans (pre-oss-hardening, data-access-efficiency-audit, api-redesign, token-plan,
      presolve-bundle); note that completed plans live under `plans/archive/`.
- [x] **`STRUCTURE.md`** repo-layout tree now lists `packages/compute`, `packages/server`,
      `packages/website`.
- [x] **`CLAUDE.md`** — removed the stale "@selvajs/compute external package" commented block
      (replaced with real per-package test commands for compute + server), and the Core Package
      Architecture section now states compute is in-repo at `packages/compute`.
- [x] **`pnpm/action-setup@v3` → v4** in all four workflows (test, e2e, release, plugin-release).
- [x] **Dependabot now covers NuGet** — added a `nuget` ecosystem scoped to `/Plugin`; `Grasshopper`
      is on the ignore list (its version pins the Rhino 8/9 SDK line — a deliberate call, not a chore).
- [x] **CI re-validates `main`** — `test.yml` now also triggers on `push: [main]` and a weekly cron
      (Mon 06:00 UTC), so admin/direct merges and post-auto-merge `main` no longer skip validation.
      Concurrency group keyed on workflow + ref so the push and PR runs don't cancel each other.

## P2 — repo weight

- [ ] **17.5 MB `Plugin/Selva.GH/Resources/Selva_Icons.ai`** (Adobe Illustrator source) tracked
      directly in git — bloats every clone, likely not needed at runtime. Remove / LFS / move out of repo.
- [x] **`baseHDR.hdr` duplication.** Original claim of "4× byte-identical" didn't hold on
      inspection — `plugin-ui/static` and `ui/static` were identical (true duplicate), but
      `selva/static/baseHDR.hdr` and `packages/compute/examples/baseHDR.hdr` are genuinely different
      files (different HDR environments; `compute/examples` is a standalone demo, not shared), and
      `packages/ui/src/static/baseHDR.hdr` was dead weight (unreferenced by any build config, predates
      the `@selvajs/shared`→`@selvajs/ui` rename). Fix: added `assets/shared/` as the canonical home
      for cross-package binary assets (see `assets/shared/README.md`), with
      `scripts/sync-shared-assets.js` copying into each consumer's `static/` via `predev`/`prebuild`
      hooks (SvelteKit/Vite only serve files physically under `static/`, so no symlinks). Removed the
      `plugin-ui`/`ui` tracked duplicates (now gitignored, regenerated) and deleted the dead
      `ui/src/static/baseHDR.hdr`. Net: −1 duplicate + −1 dead file, ~3 MB off the working tree (history
      rewrite to purge from git history is still a separate, deliberate call). `selva`'s distinct HDR
      copy was intentionally left alone.

## P3 — cosmetic

- [x] Rename SCREAMING_SNAKE docs to kebab-case per STRUCTURE.md's own rule: `PRESOLVE-BUNDLE.md` →
      `docs/plans/presolve-bundle.md`, `Plugin/Selva.Drawing/SVG_REVIEW.md` → `svg-review.md`
      (`UNVALIDATED_CHANGE.md` deleted, already P1).
- [x] Archive `compute-monorepo-import.md` (import complete) — moved to `docs/plans/archive/`.
- [x] `label-critical-issues.yml` matches issue-template body strings literally — brittle to template
      edits. Fixed to parse the rendered `### <Label>\n\n<value>` section instead of matching a combined
      literal string; also added the missing `Severity` dropdown to `bug_report.yml` (the old check
      referenced a field the template never had, so it was dead code).
- [x] LICENSE copyright line → the Swiss AG entity (raised earlier; matters for grants/sponsors).
      Root `LICENSE` already said "Selva VektorNode AG"; `packages/ui/LICENSE` had a stray
      "Selva FelixBrunold VektorNode" — aligned to match.

---

## Green (audited, no action)

- No hardcoded personal paths (`d:\Coding`, `C:\Users`), no personal-email leakage in tracked files.
- TODO/FIXME density: 2 TODO, 0 FIXME/HACK/XXX across all source.
- All GH actions tag-pinned to current majors (except action-setup); concurrency guards present;
  workflow permissions minimal (no `write-all`); fork PRs run without secrets (safe).
- All internal deps use `workspace:` protocol (no hardcoded version pins).
- `.tsbuildinfo` correctly placed in `node_modules/.cache/` (won't ship).
- README (root) is strong and current; per-package CHANGELOGs via changesets.
