---
'@selvajs/server': patch
---

`SentryErrorReporter.create` sets `traceLifecycle: 'static'`. Sentry 11 streams spans by default, and streamed spans skip `beforeSendTransaction`, so the transaction scrubber never ran on them.
