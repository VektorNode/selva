---
'@selvajs/selva': patch
'@selvajs/server': minor
---

A definition page waiting for Rhino.Compute to read the file's saved values now keeps checking for as long as the read runs, instead of giving up after two minutes. A large definition could finish reading just after the page gave up, which left its inputs at 0 until a reload. `createDefinitionLoader`'s result gains `defaultsReading`: true while a Compute read of the saved values is running.
