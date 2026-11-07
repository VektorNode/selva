---
'@selvajs/platform': patch
---

A `create_projects` API scope is described as "Read and create private projects in …", which is what it grants, and can only be issued for `all` or an org: a stored `create_projects:project:…` scope now grants nothing. `hasPermission` refuses every share-link context. `slugify` folds `ß` and similar letters, and an org name of only invisible characters is refused. `withAdminBypass`, `ProjectAccessInput.orgPermissions` and the `system` field read by `actorFrom`/`actorOf` are deprecated. `DefinitionChannelSchema` and `trimTrailing` are exported.
