---
'@selvajs/selva': patch
---

Skip the header-auth bootstrap-wiring (and its stale-provider warning) when the configured auth provider doesn't expose `proxyAuth`. Previously, deployments using `LocalAuthProvider` or `SupabaseAuthProvider` that also set `BOOTSTRAP_INSTANCE_ADMIN_EMAIL` would see a misleading `[selva] BOOTSTRAP_INSTANCE_ADMIN_EMAIL is set but the installed @selvajs/header-auth-provider does not expose setBootstrapAllowlistPolicy…` warning on boot, even though the env var is correctly consumed by the OAuth/password bootstrap path. The warning is now only emitted when the active provider is actually a proxy-style auth provider that's out of date.
