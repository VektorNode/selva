---
'@selvajs/server': minor
'@selvajs/selva': minor
---

Admin health check now reports the reverse-proxy and upload-limit settings

`ADDRESS_HEADER`, `XFF_DEPTH` and `BODY_SIZE_LIMIT` are read by adapter-node, not
by Selva, so misconfiguring them fails nothing at boot and logs nothing at
runtime — while every user shares one login rate-limit bucket, or every large
upload 413s. `selva doctor` has always caught these on the host; the admin panel
showed only runtime state, so an operator who never opened a shell read it as
all clear.

The rules move into `@selvajs/server/ops` (`checkDeploymentConfig`) and run in
`/api/admin/system/health`. A `doctor` red maps to `error`, a yellow to
`degraded`, so the panel's overall verdict matches the CLI's exit code.

The CLI keeps its own copy — it is dependency-free by design, since it scaffolds
the deployment that installs the runtime. Both sides now assert one shared
fixture table, so a rule changed on one and not the other fails CI.
