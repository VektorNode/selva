---
title: Versions
order: 7
published: false
description: 'Every upload of a definition is a version: checked before it is saved, compared with the one before, released with notes.'
---

# Versions

Every upload of a definition is a new version. Versions never change once uploaded. Two pointers
choose which one runs:

- **live**: what everyone who uses the definition, its share links and the API get.
- **draft**: the newest upload, for testing. Uploading moves the draft; only **Publish** or
  **Make live** moves live, so a rollback is making an older version live again.

## Uploading a version

Picking a file runs the same checks the upload will, through Compute, before anything is saved.
The dialog then shows whether the file is valid, how many inputs and outputs it has, and what it
changes against the version it follows (the draft, else the live one).

Inputs and outputs are matched by their Grasshopper parameter, not their name. Renaming a slider
is a change to the same input; deleting it and placing a new one with the same name is a removal
and an addition, because saved values, presets, share links and API callers refer to the
parameter.

| Impact   | Means                                                    | Examples                                                                                        |
| -------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Breaking | Something that worked before can fail or change meaning. | An input or output removed, a type changed, a dropdown option removed, a number range narrowed. |
| Changes  | It behaves differently, but old values still apply.      | A new input, a new default, a wider range, a new option, a setting such as preview solves.      |
| Cosmetic | Wording and layout only.                                 | A label, help text, an input moved to another group, tabs renamed.                              |

An upload with breaking changes needs a confirmation.

## Inside the definition

The form is not the whole file. The check also reads what the file holds, on the Compute server
the definition solves on, and warns about:

- **Plugins the server lacks.** Grasshopper drops components it cannot load, so solves succeed
  with outputs missing. This blocks the upload. Tick "Upload anyway" when the plugin goes on the
  server next; the version list then shows **needs <plugin>** until the version is read again.
- **Plugins at another version** than the file was saved with.
- **Obsolete components.** They run forever on a server; only opening and re-saving the file in
  Grasshopper upgrades them.
- **Scripts and panels that look like they hold a secret** (API keys, tokens, passwords). Anyone
  who can download the file can read them. A hint, not a scan: no warning does not mean no secret.

Against the version it follows, it lists plugins added or updated, components added and removed
by type, scripts edited with lines added and removed, values set on the canvas that changed
(sliders, panels, toggles, value lists, internalised data), and rewiring. Positions, groups and
colours are left out.

Editors see this; people who can only run the definition see the form changes. Script code is not
stored: **Show code changes** reads both versions' files through Compute each time.

Versions uploaded before this have nothing to compare with. **Read it now** reads a stored version
through Compute, which also clears **needs <plugin>** once the plugin is installed. It needs the
VektorNode Compute fork and Selva plugin from the same release; an older server leaves the section
out.

## Release notes

Notes take Markdown: headings, lists, bold, italic, code and links, up to 10,000 characters.
**Insert detected changes** starts them from the list above. The first line is the version's
title in the list.

## Comparing versions

Each version in the list opens to its notes and its changes against the version before it, or any
other version you pick.

## API

| Request                                                                           | Does                                                                          |
| --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/v1/definitions/{guid}/versions/check`                                  | The upload's checks and its changes, without saving anything.                 |
| `POST /api/v1/definitions/{guid}/versions`                                        | Uploads; the response carries `changes` and the `base` they were measured on. |
| `GET /api/v1/definitions/{guid}/versions/{versionId}/changes?against=`            | What a version changed against another one, or the one before it.             |
| `POST /api/v1/definitions/{guid}/versions/{versionId}/inventory`                  | Reads a stored version's inventory again through Compute.                     |
| `GET /api/v1/definitions/{guid}/versions/{versionId}/scripts/{scriptId}?against=` | One script's code in both versions, with a line diff.                         |

An upload that needs a plugin the server lacks answers 422 unless the form carries
`acceptMissingPlugins=true`.
