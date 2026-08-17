---
'@selvajs/platform': minor
'@selvajs/selva': minor
---

Report projects left without an owner when an org member is removed, instead of orphaning them silently.

`removeOrgMember` cascades every `project_members` row, so removing someone who
was the only owner of a project left that project with nobody able to manage it —
no settings, no roster, no delete — and nothing anywhere said so.

Permissions.md §10 promised the removal would be **blocked** until a new owner was
assigned. That rule is retired rather than implemented. Blocking makes the cost of
offboarding scale with how many projects the departing person owned, which is
backwards: the most prolific people are the ones whose departure most needs to be
clean, and an offboarding that stalls halfway leaves a live account in the org
while someone works through the backlog. Auto-transfer was rejected separately —
it hands someone authority silently, by a heuristic nobody remembers, and six
months later the audit log cannot explain why they own it.

`DELETE /api/v1/orgs/{orgId}/members/{userId}` now emits
`org_member.removed_orphaning_projects` carrying every affected project id in one
event, rather than one event each: an admin reading the log wants "this
offboarding cost three projects", not three rows to correlate. Reclaim already
adopts an ownerless project, so the recovery path predates the problem — what was
missing was any signal that recovery was needed.

The check runs **before** the removal, because the cascade soft-deletes the very
rows it reads. In the other order it finds no owners, concludes nothing was
orphaned, and reports nothing on precisely the case it exists for — so that
ordering has its own test.
