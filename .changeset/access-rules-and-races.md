---
'@selvajs/platform': minor
'@selvajs/server': patch
'@selvajs/selva': patch
'@selvajs/local-provider': patch
---

Access-rule fixes and closed races.

- `canCreateDefinition` on a commons project now requires `canView`. With `ALLOW_CROSS_ORG_PUBLIC` off, someone outside the org can't upload to a commons project, or move a definition into one.
- `canView` passes for a project member at any non-`platform` visibility, so an outside `instance_admin` who reclaimed a project can open it.
- `hasPermission` is false for a share-link context, which runs as `system` only to pick the service-role client.
- With `ENABLE_PLATFORM_PROJECTS` off, `instance_admin` can no longer edit or delete a platform project.
- Two admins deleting each other no longer leave the instance with none: the delete revokes first, through the atomic `set`, and restores the permissions if the delete doesn't happen.
- Two project owners demoting or removing each other no longer leave zero owners.
- `PATCH /api/admin/users/[id]` refuses to make a disabled user an instance admin.
- Accepting an invite adds its platform permissions to what the user already holds instead of replacing them.
- A double submit on accept-invite creates one account on local and header-auth, and local `markAccepted` emits once.
