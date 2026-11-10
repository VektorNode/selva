---
'@selvajs/server': patch
---

A schema extracted from a Compute plugin behind the app (an older format, or none from a plugin
before 2.12.0) is now cached for 24 h instead of re-extracted on every render, which cost a Compute
round trip per load. It is kept in process as well as persisted, so the window holds when the
caller cannot write the row. A warning names the emitted and expected formats once per window:
update the plugin. A plugin upgrade takes effect within a day.
