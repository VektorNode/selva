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
  - plugins the file needs that this Compute server has not loaded, or has at a different version;
  - scripts that look like they hold a secret (key patterns, `password =`, bearer tokens):
    anyone who can download the `.gh` can read them.

**A plugin missing on the server blocks the upload.** Its components would be dropped and every
solve would succeed with outputs missing. An explicit override still uploads: the author ticks
"I understand solves will fail until the plugin is installed", for the case where the plugin goes
on the server second. The override is recorded on the version, and the version list shows it as
"needs plugin X" until a check finds the plugin loaded. A different version of a plugin warns only:
most plugin updates are compatible, and blocking them would train people to tick the override.

- **What changed inside it** against the version it follows:
  - plugins added, removed or at another version;
  - components added and removed, counted by type ("+3 Loft, −1 Boolean Union");
  - scripts edited, as "+12 −3 lines", with the line diff one click away (see Script source);
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
  values[]           id, kind (slider | panel | toggle | valueList | persistent), value text
                     (cut at 500, empty when it looks like a secret), sha256, slider min/max
  scripts[]          id, language, sha256, line count, line hashes, secret findings
                     (rule names only, never the matched text). No source: see Script source.
  wires              count, plus sha256 of the sorted source→target pairs
```

The version row also keeps `inventorySummary` (missing plugins, obsolete count), the part the
version list shows, so the list never loads the inventory.

Identity is the `InstanceGuid`, as in the form diff: Grasshopper keeps it across saves, so a
component that survives an edit matches itself, and copy-pasted ones are new. Parameters are the
exception: a source whose plugin is missing loads as a dangling parameter with a new id every
time. Wire ends are therefore "component/o2" or "component/i0" (Grasshopper binds by index
anyway), "missing" for such a source, and data internalised in an input is keyed the same way.

Library versions come from the archive (`GHALibraries` chunk), not from what the server loaded,
because a missing plugin's components never load and would be invisible to a walk of the
document. The server's loaded version sits beside it, which is what makes "missing" and "different
version" checkable.

Obsolete: `IGH_DocumentObject.Obsolete`. Every `OBSOLETE_*` snapshot, Selva's and other plugins',
returns true there (checked in Rhino 9).

## Where it is built

**The plugin builds it; the fork carries it.** `ExtractSchemaFromArchive` in the fork already
opens the document and calls into the Selva plugin for the schema (`UISchemaGoo.ToComputeJson`,
by reflection, so compute never depends on Selva at compile time). It calls a second entry point,
`InventoryExtractor.ToComputeJson(doc, archive)`, and adds `inventory` beside `schemas` in each
result; `POST grasshopper/scripts` calls `InventoryExtractor.ScriptSourcesJson` for the code diff.
A plugin without them leaves the inventory out; Selva treats that as "not available", never as an
error. One fork change (`FORK_CHANGES` §26, on both `9.x.selva` and `8.x.selva`), one plugin
change.

Script source is read by member name, since Selva cannot reference the script plugins:
RhinoCode's `IScriptComponent.Text` and `LanguageSpec` (Rhino 8+ C#, Python 3, IronPython 2),
the Roslyn C#/VB components' `ScriptSource`, and GhPython's `Code`.

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
- The check, upload and changes responses gain `inventory`: summary, warnings, the diff, and
  `missing: 'base'` when the version compared with has none yet.
- `POST …/versions/{id}/inventory` re-reads a stored version: the lazy path for older versions,
  and how "needs plugin X" clears.
- `GET …/versions/{id}/scripts/{scriptId}?against=` returns both sources and a line diff.

## Who sees it

Component details, internal values and script source reveal how a definition works, which a
viewer who can only run it may not be entitled to. `inside` and script diffs are returned only to
callers with `canEditDefinition`; everyone who can view keeps the form diff. Warnings about
obsolete components and missing plugins are operator-relevant and go to editors too.

## Versions uploaded before this

They have no inventory. The file is stored, so an editor's **Read it now** extracts one, costing
one Compute call per old version. Until then the section says the version predates it.

## Script source

The inventory keeps a fingerprint of each script, never its code. Per-line hashes are enough to
count added and removed lines, so the list can say "+12 −3 lines" with no Compute call. The code
itself is fetched when an editor asks: "Show code changes" reads both versions' stored `.gh`
files and has Compute extract those two scripts, and the diff is returned and not kept.

- **No second copy of the code.** The `.gh` stays the only place it lives, so deleting a version
  deletes it, and erasure has nothing else to reach.
- **Works for versions uploaded before the inventory**, because their files are stored.
- **Costs one Compute call per click**, not per upload.

**Rejected: storing the source in the inventory.** It makes the diff instant, but copies code that
often holds API keys into a database column that backups, exports and logs then carry too.

**Rejected: hash only.** "Edited" without what or how much is not worth showing.

Secret detection runs in the plugin while the scripts are open, on the same pass. It records which
rule matched and in which script, never the text, and warns at upload. It is a hint, not a scanner:
a clean result does not mean a script holds no secret.

## Explored later

**Upgrading obsolete components automatically.** Compute could run the `IGH_UpgradeObject`s and
offer the upgraded file as a new draft. Useful, but it rewrites an author's file without them
seeing the canvas, and an upgrade can change behaviour. It needs its own decision and its own
check that the upgraded version solves the same.
