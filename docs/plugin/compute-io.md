---
title: Inputs
group: Plugin
order: 5
published: true
description: 'The Get… parameters: how a user choice in the browser becomes a value in the definition.'
---

# Inputs

Everything the user can drive from the web app enters the definition through one of these. They live under **Params → Util** and draw with a purple corner overlay.

## How a contextual param works

An input is a Grasshopper _parameter_, not a component. Left unwired on the canvas it looks inert — but at solve time the web app assigns it a value, and it emits that value downstream like any other param.

That gives you two modes for free:

- **In the web app**, the value comes from the control the user drives.
- **In Rhino**, you can wire an ordinary source into the param and the definition solves normally while you author it.

Ordinary Grasshopper params work as inputs too — a slider or a boolean toggle shows up in the schema designer without any Selva component. The `Get …` params exist for the cases plain Grasshopper can't express: a colour picker, a file upload, a list of options the definition computes.

## The parameters

| Parameter                  | Web control           | Emits                                                                                                                                                           |
| -------------------------- | --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Get Value List**         | Dropdown / checklist  | The selected option's value. Options come from a Grasshopper value list wired into it, which stays the source of truth — edit the options there.                |
| **Get Dynamic Value List** | Dropdown / checklist  | Same, but the options are computed during the solve. Needs a companion **Set Dynamic Value List**; see [Dynamic value lists](../plugin/dynamic-value-lists.md). |
| **Get Color**              | Colour picker         | A Grasshopper colour. Travels over the wire as a hex string.                                                                                                    |
| **Get File**               | File upload           | Imported geometry. Accepts an upload, a URL, or a local path; accepted formats are schema-driven.                                                               |
| **Get Image**              | Image upload          | The raw image as file data — PNG, JPEG, WEBP, or SVG. Deliberately does _no_ Rhino import; feed it to Drawing's **Draw Image**.                                 |
| **Get Server File**        | _(none — author-set)_ | Geometry imported from the compute server's data directory.                                                                                                     |

Set any of the two value-list params to **checklist** in the schema designer and it switches to list access, emitting every selected value instead of one.

### Get Server File is the odd one

It has no web control. The author sets a _relative_ path on the component — `geometry/bracket.3dm` — and the server supplies the base directory at solve time. The same definition therefore resolves on any server, regardless of where its data lives, and on Windows or Linux (separators are normalised either way).

For testing before you deploy, right-click → **Pick local file…** points it at a real file on your machine. That absolute path is a per-machine override and is never written into the `.gh` — otherwise sharing the definition would break it for everyone else. Server-supplied context always wins over the override.

## Environment

One ordinary component rather than a param:

| Component       | Outputs                                                         |
| --------------- | --------------------------------------------------------------- |
| **Environment** | `Is Compute` — true on Rhino.Compute, false in a desktop Rhino. |

Use it to branch on work you only want in one place: heavy canvas preview you'd rather skip on the server, or a debug path you don't want running in production.

## Next

- [Dynamic value lists](../plugin/dynamic-value-lists.md): the computed-options loop.
- [UI Builder](../plugin/ui-builder.md): turning these into controls.
- [Plugin overview](../plugin/overview.md)
