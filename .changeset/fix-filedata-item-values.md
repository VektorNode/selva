---
'@selvajs/compute': patch
---

Normalize `FileData` item values to camelCase when parsing solve responses

`FileData` items carry no System/Rhino type, so `decodeBySystemType` passed the
parsed record through verbatim, leaving the PascalCase wire shape. Consumers
reading `fileName`/`data`/`isBase64Encoded` directly (the `isFileData` guards in
`@selvajs/ui`) saw nothing and rendered an empty widget although the bytes had
arrived intact. `extractItemValue` now runs the same `asFileData` normalization
`extractFileData` already applies on the download path, so both paths agree.
