# Admin: scheduled updates, rollback UX, and Yak plugin management — plan

**Track A tracked in [#217](https://github.com/VektorNode/selva/issues/217).** Track B is unfiled — it needs a Rhino.Compute contract that does not exist.

> **Status: PLANNING (2026-07-27).** Design only — no implementation yet.
>
> **Verified 2026-08-16.** Confirmed: A1, A2, B3, B4, B5 are all unbuilt. The baseline the plan
> describes is real (self-update, channels, automatic rollback-on-failed-healthcheck), and
> `manage_compute` / `manage_updates` already exist as permissions. Two notes for whoever starts:
>
> - **The two tracks share nothing but this document.** Track A (scheduled updates + rollback UX)
>   has no dependencies and can ship alone. Track B (Yak install API) needs both
>   [plugin-compat-gate](./plugin-compat-gate.md) and an endpoint contract from the Rhino.Compute
>   repo that does not exist — `/plugins/gh/install`, `/update` and `/available` are all absent;
>   only `/plugins/gh/installed` is real. Track B is not startable.
> - **A2 is cheaper than the plan assumes.** `buildNpmRunnerScript(npmArgs, …)` already takes
>   caller-supplied install args, so only a target-version seam and the history file are new.
>
> Stale paths: `docs/Publishing.md` → `docs/contributing/publishing.md`; `compute-server-stats.ts`
> is under `packages/compute/src/grasshopper/server/`, not `core/server/`; `update-outcome.ts` is
> in `lib/`, not `lib/server/`. Route paths written as `admin/api/system/*` are now
> `api/admin/system/*`.

Five asks, grouped into two tracks because they touch different systems:

- **Track A** (items 1–2) extends the **existing npm/pm2 self-update system**
  for the `selva` app deployment (`packages/selva/src/lib/server/selfUpdate.server.ts`,
  `releaseChannel.server.ts`, `admin/api/system/update/+server.ts`). This system
  already does update + automatic rollback-on-failed-health-check; items 1–2
  are additive.
- **Track B** (items 3–5) is new: a Yak plugin-management API that lives on
  **Rhino.Compute itself** (separate repo), plus the Selva-side admin surface
  and compatibility logic that consumes it. This is greenfield and should
  follow the `@selvajs/platform` provider pattern and slot into the
  compatibility-verdict machinery already designed in
  [plugin-compat-gate.md](./plugin-compat-gate.md).

---

## Current state (verified 2026-07-27)

**App self-update (Track A) already has:**

- Manual trigger: `admin/api/system/update/+server.ts` — SSE stream, installs
  pinned `@selvajs/{cli,selva}@<channel-tag>`, pm2 stop/start, health probe,
  **automatic rollback** via `npm install --save @selvajs/selva@<prevVersion>`
  on failed health check, 15-min hard timeout, EXIT-trap recovery net.
- Release channel (stable/beta) persisted to `selva-channel.json`, read by
  both the app and the bash update runner (`releaseChannel.server.ts`).
- Update-availability check: `updateCheck.server.ts` (queries npm registry).
- Outcome reconciliation after restart: `update-outcome.ts`.
- UI: `UpdateSection.svelte`, `ChannelSection.svelte` under
  `admin/system`.
- Audit events: `system.update.started` + outcome events.

What's **missing** for items 1–2: no scheduler (updates are manual-trigger
only), and rollback is automatic-on-failure only — there's no operator-invoked
"roll back to a specific prior version" after the fact (the update runner
keeps exactly one `prevVersion`, not a history).

**Plugin distribution (Track B) already has:**

- Yak release pipeline for the `.gha` (`docs/Publishing.md` "Plugin releases");
  version lives in `Plugin/Selva.GH/Selva.GH.csproj`; beta/stable via
  `-beta.N` suffix.
- `ComputeServerStats.getInstalledPlugins()` (`packages/compute/src/core/server/compute-server-stats.ts`)
  already queries Rhino.Compute's `/plugins/gh/installed` — display-only today
  in `admin/api/compute/status/+server.ts`.
- A **fully designed but unimplemented** compatibility contract in
  [plugin-compat-gate.md](./plugin-compat-gate.md): `COMPAT` +
  `PLUGIN_CAPABILITIES` table, `checkServerCompatibility()`, `CompatVerdict`
  union, and three enforcement gates (admin status / upload / solve path).

What's **missing** for items 3–5: Rhino.Compute has no install/update endpoint
today — `yak install` / `yak update` are local CLI operations, not exposed
over HTTP. Nothing in this repo can trigger a remote plugin install. This plan
assumes that endpoint is being added in the compute repo (per the user's own
scoping) and defines the **contract** Selva needs from it, plus what Selva
does with it.

---

## Track A — scheduled updates + rollback UX

### 1. Scheduled automatic updates

**Config** (extends `selva-channel.json` or a sibling `selva-update-schedule.json`
in the deployment dir — same "runner must read it without a DB" constraint as
the channel file):

```ts
interface UpdateSchedule {
	enabled: boolean;
	// Local time-of-day, HH:mm, deployment-server timezone (avoid storing a
	// TZ name here — the bash runner has no reliable TZ database guarantee
	// across containers; document that it uses system local time).
	timeOfDay: string;
	// Optional day restriction; empty/absent = every day.
	daysOfWeek?: Array<0 | 1 | 2 | 3 | 4 | 5 | 6>;
}
```

**Trigger mechanism**: reuse the existing update runner
(`admin/api/system/update/+server.ts` logic), invoked by a cron-like scheduler
rather than an HTTP POST. Two viable approaches — pick one, don't build both:

- **In-process scheduler**: a `node-cron`-style check running inside the
  SvelteKit server process (or a pm2 process alongside it) that wakes once a
  minute, compares against `UpdateSchedule`, and calls the same internal
  function the POST route calls. Simplest, no new infra, but only runs while
  the app process is up (acceptable — if the app is down there's nothing to
  update anyway).
- **System cron** writing to a lock file the runner checks. More moving parts,
  matches "real" ops tooling expectations. Prefer only if operators are
  expected to inspect/override via crontab directly.

Recommend the in-process scheduler — it reuses 100% of the existing update
runner and needs no new deployment-side moving part.

**Guardrails** (all novel — the manual flow has no equivalents to reuse):

- Skip the run if `updateCheck.server.ts` reports no update available for the
  configured channel — don't restart pm2 for a no-op.
- Skip / defer if a manual update is already in flight (reuse whatever
  in-flight guard the SSE route has, or add a simple lock file).
- Record every scheduled attempt as an audit event
  (`system.update.scheduled.triggered`, distinct from the existing
  `system.update.started` so operators can tell manual vs. automatic in the
  audit log).
- Must respect the existing automatic-rollback-on-failed-health-check —
  scheduled runs get the same safety net as manual ones for free, since they
  call the same runner.

**UI**: new fields in `UpdateSection.svelte` — enable toggle, time picker,
optional day-of-week multiselect. Gated by the existing `manage_updates`
permission.

### 2. Rollback to an arbitrary prior version

Today's runner only remembers `prevVersion` (the version just before the
current update) for its own automatic-rollback-on-failure. Item 2 asks for
operator-invoked rollback, potentially to a version further back.

**Version history**: extend the update-outcome log
(`update-outcome.ts` already writes outcomes somewhere — confirm its storage
before designing new storage) into an append-only **version history** file
(`selva-update-history.json` in the deployment dir): each entry
`{ version, installedAt, channel, outcome }`. Written on every successful
install, not just failures. This is the one genuinely new piece of state —
everything else in Track A reuses existing plumbing.

**Rollback endpoint**: `POST admin/api/system/rollback` — body
`{ targetVersion }`, validated against the history file (reject arbitrary
strings; only versions that were actually installed on this deployment are
valid targets — installing an untested version by typo is exactly the failure
mode the health-check rollback already guards against). Internally this is the
existing update runner with the "version to install" parameter overridden from
"latest on channel" to "the requested history entry" — same pm2 stop/start,
same health probe, same automatic-rollback-of-the-rollback if even that fails.

**UI**: `UpdateSection.svelte` gets a version-history list (from the new
history file) with a "Roll back to this version" action per row, confirmation
dialog (this is a restart-the-app action — treat with the same weight as the
existing update button), same SSE progress stream pattern as update.

**Non-goal**: rolling back the **database/data layer**. Both the scheduled
update and rollback in this plan only ever swap `@selvajs/{cli,selva}` npm
packages + restart pm2 — no schema migrations are in scope here. If a future
version introduces a data migration, that's a separate, harder problem
(forward-only migrations typically can't be blindly rolled back) — flag it as
a follow-up, don't silently assume today's rollback covers it.

---

## Track B — Yak plugin install/update API + compatibility enforcement

### 3. Rhino.Compute endpoint for installing/updating Yak plugins (other repo)

Out of scope to implement here (user is building it in the compute repo), but
Selva's admin needs a defined contract to build against. Recommend specifying
now, before that repo's work starts, so both sides agree on shapes:

```
POST /plugins/gh/install   { name: string, version?: string }   // omit version = latest
POST /plugins/gh/update    { name: string, version?: string }   // omit version = latest compatible
GET  /plugins/gh/installed                                       // already exists — reuse, don't duplicate
GET  /plugins/gh/available?name=Selva                            // list installable versions (for item 4/5)
```

Auth: same mechanism already protecting the compute server's admin surface
(whatever `IComputeServerStore`'s `getServerApiKey` secret gates today) — this
is a highly privileged endpoint (arbitrary plugin install on a compute box)
and must not be reachable with the same API key used for solve requests if
that key is ever handed to less-trusted callers. Worth explicitly confirming
in the other repo's design whether solve-key and admin-key are already
separate; if not, that's a prerequisite, not a nice-to-have.

Selva-side consumer: extend `ComputeServerStats`
(`packages/compute/src/core/server/compute-server-stats.ts`) with
`installPlugin()` / `updatePlugin()` methods that call these, mirroring how
`getInstalledPlugins()` already wraps `/plugins/gh/installed`. New admin route
`admin/api/compute/plugins/+server.ts` (follows the existing per-concern route
file pattern under `admin/api/compute/`), gated by `manage_compute`.

### 4. Update-availability check for installed plugins

Once `GET /plugins/gh/available` exists, this is a straightforward extension
of the **already-designed** compat machinery rather than new design:
`checkServerCompatibility()` (plugin-compat-gate.md §2) already fetches
installed plugin version and compares against `PLUGIN_CAPABILITIES`; add a
sibling call to `available` and diff against `installed` to produce
`{ updateAvailable: boolean, latestVersion, latestCompatibleVersion }` — note
these can differ (latest published ≠ latest this app's `COMPAT.meshFormat`/
`schemaVersion` window supports), which is exactly what item 5 needs to guard.

Surface in **Gate A** (admin compute status,
`admin/api/compute/status/+server.ts`) alongside the compat verdict that plan
already specifies — same response payload, one added field, one UI badge.

### 5. Prevent installing an incompatible Selva plugin version via the Yak API

This is the enforcement half of item 4 and folds directly into
plugin-compat-gate's `PLUGIN_CAPABILITIES` table — that table is already
designed to answer "does version X emit a schema/mesh format this app
supports." Item 5 just adds a **pre-install** check using the same table,
rather than only a post-hoc solve-time or status-time verdict:

- Before calling `installPlugin()`/`updatePlugin()` (item 3) with an explicit
  `version`, look it up against `PLUGIN_CAPABILITIES` (extend the table's
  range matching to answer "is this specific version compatible," not just
  "what does the currently-installed version emit").
- `unknown` verdict (version newer than the table covers) — per
  plugin-compat-gate's existing policy, this degrades to a **warning**, not a
  block, so a fresh Yak plugin release doesn't brick installs before the table
  is updated. Surface the warning in the install confirmation UI; require an
  explicit "install anyway" acknowledgment rather than silently blocking or
  silently proceeding.
- Known-incompatible (would emit a mesh/schema version this app's `COMPAT`
  can't parse) — **hard block** at the admin API layer, same
  `ErrorCodes.INCOMPATIBLE_PLUGIN` the solve path (Gate C) already defines, so
  there's exactly one error taxonomy for "plugin/app mismatch" across upload,
  solve, and now install.

This item has a **maintenance dependency**: `PLUGIN_CAPABILITIES` must be
extended (one row) on every plugin release that changes wire format — already
true today per plugin-compat-gate.md, but item 5 raises the stakes since it's
now also a pre-install gate, not just a diagnostic. Worth a CI reminder (e.g.
plugin-release workflow comments on the PR if the released version isn't yet
in the table) — flagging as a follow-up, not blocking this plan.

---

## Suggested sequencing

Track A and Track B are independent — Track A has zero dependency on the
other repo's work and can ship first.

1. **Track A, item 2 (rollback UX)** — smallest new-state footprint (one
   history file), immediately useful standalone, and de-risks the "restart +
   health-check + auto-rollback" path getting exercised more often before
   scheduling makes it fully unattended.
2. **Track A, item 1 (scheduling)** — builds on 2's tested runner path.
3. **plugin-compat-gate.md implementation** (items 1–3 of that plan's own work
   list) — prerequisite for Track B item 4/5; not new scope, just unblocking.
4. **Track B, item 3** — once the other repo's endpoint contract above is
   confirmed and live.
5. **Track B, items 4–5** — thin layer on top of 3 + the now-implemented
   compat module.

## Open questions (need answers before implementation starts)

- Scheduled updates: is "restart pm2 unattended at 3am" acceptable for this
  product's actual deployments, or does it need a "maintenance window /
  concurrent-user warning" concept first? (No such concept exists today.)
- Rollback history retention: unbounded history file, or cap at N entries /
  purge entries older than X? (Mirrors the "no time-based retention" gap
  called out for `audit_events`/`solve_metrics` in CLAUDE.md — don't repeat it
  here without a decision.)
- Track B auth: confirmed separate admin-key vs. solve-key on the compute
  side, or does this plan need to specify that separation as a requirement
  handed to the other repo?
- Is per-org compute server plugin management in scope (orgs can have
  private compute servers per `IComputeServerStore.saveOrgServers`), or is
  Track B platform-servers-only for v1?
  </content>
