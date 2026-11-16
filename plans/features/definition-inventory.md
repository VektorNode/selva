# Definition inventory: what is inside each version, and what changed

**Unfiled.** Spans the compute fork, the plugin, `wire-schema.json`, `@selvajs/platform`, both data
providers, `@selvajs/schemas`, `@selvajs/server` and the Selva app. Builds on the version check and
form diff (`diffSchemas`, `POST …/versions/check`, `GET …/versions/{id}/changes`).

## Why

The form diff answers "will saved values, share links and API callers break?". It cannot answer
"why does v5 solve differently from v4 when the form is identical?", and that is the question
Grasshopper users have no tool for today: they compare two canvases by eye, or keep
`facade_v3_final_FIX.gh`. Selva already stores every version, so it can answer it.

Three things go wrong silently in a hosted definition, and an inventory catches all three:

- **Hidden logic changes.** A slider deep in the canvas went from `0.01` to `0.1`, a script was
  edited, a component was swapped. The form is identical, the result is not.
- **Plugin drift.** The file needs a plugin, or a version of one, that the Compute server lacks.
  Grasshopper drops components it cannot load, and a headless solve reports success with outputs
  missing.
- **Obsolete components.** [plugin-compat-gate](./plugin-compat-gate.md) found that the drift unit
  is the `.gh` file, not the server: an `OBSOLETE_*` component (Selva's or anyone's) solves forever
  on a headless box, because the upgrade only fires when someone opens and re-saves the file. Nobody
  is told. The inventory is the per-file record that plan's "which definitions are affected?"
  question needs.

## What people see

**Uploading a version.** Beside the form changes, the check shows:

- **Warnings about the file itself**, whatever it is compared with:
  - obsolete components, by name and plugin, with "open and re-save in Grasshopper to upgrade";
  - plugins the file needs that this Compute server has not loaded, or has at a different version.
- **What changed inside it** against the version it follows:
  - plugins added, removed or at another version;
  - components added and removed, counted by type ("+3 Loft, −1 Boolean Union");
  - scripts edited, with a line diff;
  - internal values changed: sliders, panels, toggles, value lists and internalised input data
    that are not form inputs (form inputs are already in the form diff);
  - how many wires were added or removed.

**The version list** shows the same "Inside the definition" section per version and per compare,
and an "obsolete components" badge on any version that has them, so an operator can see which
versions still run old components before a plugin drops them.

**Not shown:** canvas positions, groups, colours, scribbles. They change on every save and would
drown the real changes.

## The inventory

One JSON document per version, produced where the file is already opened for the schema:

```
DocumentInventory
  extractedWith      plugin version that built it (empty = not available)
  libraries[]        from the archive's own library list, as saved by the author:
                     id, name, author, version, loadedOnServer: version | null
  components[]       id (InstanceGuid), type (ComponentGuid), name, nickname, library id,
                     obsolete: bool
  values[]           id, kind (slider | panel | toggle | valueList | persistent), value text,
                     slider min/max
  scripts[]          id, language, sha256, source (see the open decision on storing source)
  wires              count, plus sha256 of the sorted source→target pairs
```

Identity is the `InstanceGuid`, as in the form diff: Grasshopper keeps it across saves, so a
component that survives an edit matches itself, and copy-pasted ones are new.

Library versions come from the archive (`GHALibraries` chunk), not from what the server loaded,
because a missing plugin's components never load and would be invisible to a walk of the
document. The server's loaded version sits beside it, which is what makes "missing" and "different
version" checkable.

Obsolete: `IGH_DocumentObject.Obsolete`. Selva's `OBSOLETE_*` snapshots must return true there;
check each one does, since the warning depends on it.

## Where it is built

**The plugin builds it; the fork carries it.** `ExtractSchemaFromArchive` in the fork already
opens the document and calls into the Selva plugin for the schema (`UISchemaGoo.ToComputeJson`,
by reflection, so compute never depends on Selva at compile time). It calls a second entry point,
`DocumentInventory.ToComputeJson(doc, archive)`, and adds `inventory` beside `schemas` in each
result. A plugin without the entry point leaves it out; Selva treats a missing inventory as
"not available", never as an error. One fork change (a new `FORK_CHANGES` section, on both
`9.x.selva` and `8.x.selva`), one plugin change.

The builder splits as the Grasshopper code in the repo already does: a thin reader that walks the
`GH_Document` and archive into plain records, and Rhino-free code that turns records into the JSON,
linked into `Selva.Tests` (see the GH unit-testing pattern).

**Rejected: building it in the browser or in Node.** A `.gh` is a compressed GH_Archive of
Grasshopper's own chunk format; reading components, values and script source needs Grasshopper's
types. Re-implementing the archive reader would be a second, drifting copy of Grasshopper.

**Rejected: embedding it in the schema at save time on the canvas.** The schema is authored
content saved into the file; the inventory describes the file, and a file uploaded without a
re-save would carry a stale one.

## Storage and API

- `DocumentInventory` lives in `wire-schema.json` (runtime data, never saved into a `.gh`), so
  TS and C# are generated from one definition.
- `DefinitionVersion.inventory?`, stored like `schema`: written at upload, left out of list
  projections. Supabase: a nullable `inventory jsonb` column. Local: a field on the version row.
  The store conformance suite covers both.
- `diffInventories(before, after)` and `inventoryWarnings(inventory)` in `@selvajs/schemas`, pure
  and tested like `diffSchemas`.
- The check, upload and changes responses gain `inside` (the inventory diff) and `warnings`.

## Who sees it

Component details, internal values and script source reveal how a definition works, which a
viewer who can only run it may not be entitled to. `inside` and script diffs are returned only to
callers with `canEditDefinition`; everyone who can view keeps the form diff. Warnings about
obsolete components and missing plugins are operator-relevant and go to editors too.

## Versions uploaded before this

They have no inventory. The file is stored, so a compare can extract one lazily on first need
(the same bridge the schema used), costing one Compute call per old version. Until then the
section reads "not available for this version".

## Open decisions

1. **Script source: store it or only its hash.** Storing makes a line diff possible. Hash-only
   says "edited" and nothing more, but keeps code that may hold API keys out of the database. The
   source is already in the stored `.gh`, so storing it adds no new exposure for whoever can read
   that; the editor-only gate above covers the API.
2. **A missing plugin: warn or block.** A version whose plugin the server lacks will solve with
   components dropped. Blocking the upload is safest, but an author may upload first and install
   the plugin second. Proposed: block publishing, not uploading.
3. **Upgrading obsolete components automatically.** Compute could run the `IGH_UpgradeObject`s and
   offer the upgraded file as a new draft. Useful, but it rewrites an author's file without their
   canvas; out of scope here, worth its own decision.
