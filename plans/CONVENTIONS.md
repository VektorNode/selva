# How plans and issues divide the work

Read this before adding a file to `plans/` or wondering why a plan has no status.

## The split

**Issues are the backlog. Plans are the reasoning.** Nothing is tracked in both.

|           | Issues                                        | Plans                                 |
| --------- | --------------------------------------------- | ------------------------------------- |
| Owns      | what to do, who has it, what's done, priority | why, tradeoffs, rejected alternatives |
| Lives     | GitHub, on the project board                  | `plans/*.md`                          |
| Read when | picking up work                               | you need context on a decision        |

A plan **carries no status and no task list.** Not "Phase 1 ☐ open", not a checkbox, not a
percentage. This is the whole point: a document with no status cannot have a _wrong_ status, and
wrong status is how the old `plans/README.md` came to claim "not started" for two plans that had
shipped. Status lives where it gets updated as a side effect of doing the work — the issue you
close, the PR that closes it.

If you want to know what's left on a plan, read its epic issue.

## Which one do I write?

**Just file an issue.** That's the default and it covers most work.

Write a plan **as well** when the reasoning outlives the task — when someone in six months will ask
"why is it built this way?" and the answer is longer than an issue comment. The archived plans are
the model: the GPU-ownership rules, why the `@selvajs/server/compute` shim was built and then
deliberately removed, why merging the two definition caches was rejected. That reasoning is
load-bearing and would have been lost in a closed issue.

Signals you need a plan: the work spans 3+ packages, or a rejected alternative needs recording so
nobody re-proposes it, or the design took real investigation to arrive at.

Signals you don't: it's a bug, it's one package, the approach is obvious once stated.

## Structure: epics and sub-issues

For anything with more than about three separable tasks, use one **epic** issue with GitHub
[sub-issues](https://docs.github.com/en/issues) under it — real parent/child links, not markdown
checkboxes, so the parent shows progress and the board can filter to parents only.

The rule of thumb: a sub-issue is worth creating when someone could pick it up **without** taking
the rest. Four items that must ship together are one issue, not four.

Don't decompose exhaustively. A long P3 tail belongs in the plan document as prose, promoted to
issues if and when someone commits to it. Twenty sub-issues nobody will touch is the overwhelm
this convention exists to prevent.

**When a plan is only partly filed** — as with the efficiency audit, where 4 of ~25 items became
issues — the plan may keep a list of the unfiled remainder, because that list is the only record
of it. Two rules keep it from becoming a shadow tracker: filed items show their issue link and no
status of their own, and the unfiled remainder is labelled as unfiled, so nobody reads it as work
in flight.

## Linking

Both directions, always:

- The epic issue links to its plan: `Design: plans/fixes/foo.md`
- The plan links to its epic, once, at the top: `**Tracked in #123.**`

That single line is the only status-adjacent thing a plan may contain, because it doesn't go stale
— an issue number is permanent.

## Priority

Priority and Effort are **fields on the [project board](https://github.com/orgs/VektorNode/projects/2)**,
not labels — Priority is Urgent/High/Medium/Low, Effort is High/Medium/Low. Set both at triage.

Note Effort runs the opposite way to intuition: **Effort: Low means quick**. Sorting by Priority
then Effort puts the highest-value, cheapest work on top, which is the list to work from.

Consequence worth knowing: an issue not on the board has no priority. If it matters, add it to the
board.

Issue **Type** (Bug / Feature / Task / Verification) is separate again, and org-level rather than
per-repo. `Verification` is for empirical checks whose output is evidence rather than a code
change — a staging test, a measurement run.

Priority means urgency-to-us, not severity. The old efficiency audit ranked by _cost of fixing
later ÷ cost of fixing now_, which is a better instinct than severity and worth keeping.

## Labels

Unchanged, and orthogonal to priority:

- `area: *` — one per issue, which subsystem
- `ready-for-agent` / `ready-for-human` / `needs-triage` — the triage state machine
- `good first issue` — genuinely small and self-contained

## Archiving

A plan moves to `plans/archive/` when its epic closes. Add a two-line header saying what shipped
and what was decided — that header is what makes the archive worth keeping.

Two rules learned the hard way:

- **Archive, don't delete.** A deleted plan takes its reasoning with it. `solve-engine-facade.md`
  was deleted while still listed in the index; it was an unstarted design, so the deletion lost
  the thinking and left a dangling link.
- **Don't read an archived plan as a map of the tree.** It describes the code as it was. When paths
  in a plan stop resolving, that is the signal the plan has drifted — not that the code is wrong.

## Why this exists

Before 2026-08-16, `plans/` and the issue tracker were both trying to be the backlog. The same work
existed in both with no link either way and no declared owner — PAT auth was `token-plan.md` _and_
#97; the SSRF guard was SEL-3 _and_ #90. Meanwhile the plans index had drifted so far that four
entries were wrong, two of them describing shipped work as "not started".

The failure was structural, not sloppiness. Plans that got worked on stopped being updated, because
nothing in the act of shipping touches a markdown file. Plans nobody touched stayed accurate. So
the documents were least reliable exactly where the activity was — the opposite of what a reader
assumes.

Issues don't have that failure mode: closing one is part of merging the work.
