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

An upload with breaking changes needs a confirmation. Only the inputs, outputs and settings are
compared: a version can still solve differently with an identical form, so test the draft before
publishing it.

## Release notes

Notes take Markdown: headings, lists, bold, italic, code and links, up to 10,000 characters.
**Insert detected changes** starts them from the list above. The first line is the version's
title in the list.

## Comparing versions

Each version in the list opens to its notes and its changes against the version before it, or any
other version you pick.

## API

| Request                                                                | Does                                                                          |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| `POST /api/v1/definitions/{guid}/versions/check`                       | The upload's checks and its changes, without saving anything.                 |
| `POST /api/v1/definitions/{guid}/versions`                             | Uploads; the response carries `changes` and the `base` they were measured on. |
| `GET /api/v1/definitions/{guid}/versions/{versionId}/changes?against=` | What a version changed against another one, or the one before it.             |
