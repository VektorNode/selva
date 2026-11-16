---
'@selvajs/schemas': minor
'@selvajs/platform': minor
'@selvajs/server': minor
'@selvajs/selva': minor
---

Definition versions show what they change. Uploading a new version checks the file through Compute before anything is saved and lists its changes against the version it follows: inputs and outputs added, removed or changed, sorted into breaking, notable and cosmetic. Breaking changes (a removed input, a changed type, a removed option or a narrower range) need a confirmation before the upload. Release notes take Markdown up to 10,000 characters, with a preview and a one-click insert of the detected changes, and every version in the list opens to its notes and its changes against the version before, or any other version.

- `@selvajs/schemas`: `diffSchemas(before, after)` and `schemaDiffToMarkdown(diff)`. Inputs and outputs match by parameter id, so a rename is a change and a recreated parameter is a removal plus an addition.
- `@selvajs/platform`: `MAX_CHANGE_NOTE_LENGTH`.
- `@selvajs/server`: `checkVersion` and `getVersionChanges` handlers. `uploadVersion` returns `base` and `changes` beside `version`, refuses a note over the limit instead of cutting it at 1,000 characters, and stores notes with LF line endings.
- `@selvajs/selva`: `POST /api/v1/definitions/{guid}/versions/check` and `GET /api/v1/definitions/{guid}/versions/{versionId}/changes?against=`.
