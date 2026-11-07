---
'@selvajs/selva': patch
---

Creating a user at `/admin/users` with platform permissions now stores them on the local and header-auth providers. The grant needed a data-layer row that only the user's first sign-in created, so it was silently dropped while the request still answered 201. If the permission store refuses the grant, the request now fails with 500 and says so; the user is still created and added to the org, so the permissions can be granted again from the user list.

`GET`, `PATCH` and `DELETE /api/admin/projects/{id}` answer 404 while `ENABLE_PLATFORM_PROJECTS` is off, like the other platform-project routes. Turning the flag off now hides these projects from instance admins too.
