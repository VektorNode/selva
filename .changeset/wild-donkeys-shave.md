---
'@selvajs/compute': patch
---

Fix `extractFileData` dropping every file from a PascalCase compute response

`isFileData` guarded on camelCase keys and a strictly-boolean `isBase64Encoded`,
so files from an mcneel-branch server (`FileName`, `Data`, `IsBase64Encoded`)
failed the shape check and were discarded — silently, with no warning. Because
this runs _before_ the case-insensitive decoder in `handle-files.ts`, the
tolerance added there for the same issue never got a chance to apply, and
`getAndDownloadFiles` produced an empty ZIP while reporting success.

Fields are now read case-insensitively via `readField`, and a string-serialized
flag (`"true"`/`"True"`) is accepted, matching `decodeResponseFiles`. Extracted
items are normalized to the camelCase `FileData` shape, so consumers are
unaffected; genuinely malformed payloads are still rejected.
