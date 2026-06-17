---
'@selvajs/schemas': patch
---

Allow input source keys to repeat. A value source key (client producer or server fetch) no longer has to be unique across the schema — the same producer/fetch may legitimately fill several inputs. Updated the `source.key` schema description accordingly; the builder no longer flags duplicate keys or blocks save on them.
