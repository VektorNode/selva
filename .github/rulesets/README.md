# Branch and tag rulesets

The JSON here is the source of truth for what protects `main`, `beta`, and the
release tags. Edit a file, run `./apply.sh`, and the change lands on GitHub.

Rulesets need a public repo or a paid plan. While the repo is private on the
free plan every call 404s or 403s, and nothing stops a direct push to `main`.

## Applying

```bash
gh auth status                  # needs the `repo` scope and repo admin
./.github/rulesets/apply.sh     # creates what's missing, updates the rest
```

Re-running is safe: rulesets are matched by name, so the script updates in
place rather than creating duplicates.

## What's here

| File        | Protects                  | Approvals | Required checks            |
| ----------- | ------------------------- | --------- | -------------------------- |
| `main.json` | `main`                    | 1         | test, dotnet, e2e, analyze |
| `beta.json` | `beta`                    | 0         | test, dotnet               |
| `tags.json` | `plugin-v*`, `@selvajs/*` | —         | —                          |

All three block deletion and force-push. `main` also requires linear history,
conversation resolution, a code-owner review, and squash merges.

`beta` is the pre-release lane: no approval and a smaller check set, so a
changesets pre-release isn't waiting on a human. It still can't be pushed to
directly.

The tag ruleset exists because both release workflows publish off tags — a
deleted or moved `plugin-v0.17.2` would republish a different artifact under a
version users already installed.

## Bypass

`actor_id: 5` is the repository-admin role. It's on every ruleset so a solo
maintainer can merge without a second reviewer; the rules still apply to
everyone else. Drop the `bypass_actors` block once there's a second maintainer
who can approve.

## Required checks are matched by job name

The contexts are job names (`test`, `dotnet`), not workflow names. Renaming a
job in `.github/workflows/` without renaming it here leaves a required check
that never registers, and PRs wait forever.

`analyze` (CodeQL) does run on `beta` PRs; `beta.json` just doesn't gate on it,
so a pre-release isn't held up by a SAST scan. The weekly cron and the `main`
ruleset are what guarantee it's enforced before anything reaches stable.

`website` is in no ruleset on purpose: it only triggers on paths under
`packages/website/**`, so requiring it would hang every PR that doesn't touch
the site.
