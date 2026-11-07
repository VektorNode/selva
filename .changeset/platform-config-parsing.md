---
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/selva': patch
'@selvajs/cli': patch
---

Env settings parse by one set of rules, so the config report and the running server agree. A whitespace-only value counts as unset; ints must be plain digits (`0x10`, `1e3` and `0.5` are refused); `url` settings must be `http:` or `https:`, and `ORIGIN` and `SELVA_EVENT_CALLBACK_ORIGIN` refuse a path, query or credentials. The compute and API rate limits and `SIGN_IN_MAX_AGE_DAYS` now read the manifest through the new `readSetting`, so an invalid tunable falls back to its default instead of being floored. `<KEY>_PREVIOUS_EXPIRES` accepts only an ISO date that exists, at most 90 days out. A malformed config snapshot no longer stops the server booting, and the snapshot stores a marker instead of a guessable hash for secrets Selva did not generate: each such secret reports "changed" once after upgrading. `readPositiveInt` and `readNonNegativeInt` in `@selvajs/server` are deprecated.
