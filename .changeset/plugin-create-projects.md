---
'@selvajs/server': minor
'@selvajs/selva': minor
'@selvajs/platform': minor
'@selvajs/mcp': patch
'@selvajs/schemas': minor
---

A new API scope action, `create_projects`: create private projects that nobody joins on upload, org-wide only. `write` includes it. `POST /projects` now asks for it, so a 403 there names `create_projects:org:<id>` instead of `write:`. The built-in Grasshopper OAuth client may request it; registered clients can't. A key holding it may be held by anyone who may create a project in the org, so an org admin with no projects can sign in the plugin.

Creating a project checks the same visibility rules as `PATCH`: only org owners and admins create public projects. Project creation through API keys has a per-owner limit (20 an hour by default, `projectCreateLimiter` in deps). `GET /me` returns `capabilities.createProjects`. `DELETE /me/token` works for a key whose owner no longer qualifies to hold it.

Upload to Selva in the plugin: the connection moves to its own dialog, Upload shows only for a key Selva accepted in this Rhino session, the first connection to an instance is confirmed in Rhino, a pasted key is refused as an address, and an upload can go into a new private project.
