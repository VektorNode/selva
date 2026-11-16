---
'@selvajs/schemas': minor
'@selvajs/compute': minor
'@selvajs/platform': minor
'@selvajs/local-provider': minor
'@selvajs/supabase-provider': minor
'@selvajs/server': minor
'@selvajs/selva': minor
---

Definition versions show what is inside the file, not only its form. Checking or uploading a version lists the plugins it was saved with and which the Compute server lacks or runs at another version, obsolete components, and scripts or panels that look like they hold a secret. A plugin the server lacks blocks the upload, because its components would be dropped and solves would succeed with outputs missing; the uploader can override it, and the version list then shows "needs <plugin>" until the version is read again with the plugin installed. Comparing two versions shows, to editors only, plugins added or updated, components added and removed by type, scripts edited with lines added and removed and their code diff on request, values set on the canvas that changed, and rewiring. Script code is never stored: the inventory keeps per-line fingerprints and the diff reads both stored files through Compute.

- `@selvajs/schemas`: `DocumentInventory` and its parts in `wire-schema.json`; `inventoryWarnings`, `inventoryWarningText`, `summarizeInventory`, `diffInventories`, `inventoryDiffToMarkdown`, `countLineChanges` and `diffLines`.
- `@selvajs/compute`: `readSchemaResults` passes `inventory` through.
- `@selvajs/platform`: `DefinitionVersion.inventory` and `inventorySummary`, and `IDefinitionStore.setVersionInventory`. Lists carry the summary, never the inventory.
- `@selvajs/supabase-provider`: migration `20261116120000_selva_definition_version_inventory` adds `definition_versions.inventory` and `inventory_summary`.
- `@selvajs/server`: `extractSchemaForUpload` returns `{ schema, inventory }`; `fetchExtraction`, `fetchScriptSources`; handlers `refreshVersionInventory` and `getVersionScriptDiff`. Check, upload and changes responses carry `inventory`.
- `@selvajs/selva`: `POST /api/v1/definitions/{guid}/versions/{versionId}/inventory`, `GET /api/v1/definitions/{guid}/versions/{versionId}/scripts/{scriptId}`, and `acceptMissingPlugins` on definition and version uploads.

Needs the VektorNode Compute fork with FORK_CHANGES §26 and a Selva plugin that has `InventoryExtractor`. Older servers keep working without the inventory.
