---
title: Preview Solves
order: 6
published: false
description: 'Make files only when someone downloads them, so editing a form does not pay for exports nobody asked for.'
---

# Preview Solves

Every solve makes every output. A definition that exports files pays for them on each edit, though
most edits end without a download. With preview solves on, edits skip the files and a click on
Download makes them.

## Turn it on

In the builder, open the app settings and turn on **Make files on download**. It is off by default,
so existing definitions behave as before.

## What changes

| Solve   | Runs when                           | Makes files               |
| ------- | ----------------------------------- | ------------------------- |
| Preview | someone changes an input            | only those the page shows |
| Full    | someone clicks Download             | all of them               |
| Full    | the API is called without `mode`    | all of them               |
| Full    | you solve on the Grasshopper canvas | all of them               |

The 3D view, numbers, text, charts and images update on every edit, as before. A Download button
says the file is made on click. The click solves once with the inputs on screen, then downloads.
Every other Download button is ready at once, until an input changes.

## Which files are skipped

A Selva file component skips in a preview only when everything it feeds ends in a Download button.
It is made on every solve if anything else reads it:

- an image widget showing the same file
- a component reading its size or name
- a Merge or another file component
- nothing at all

A file component that cannot skip carries a remark on the canvas saying why.

## Solve Mode: skip the work above the files

Skipping a file does not skip the work that feeds it. An unroll or a nesting above the file
component still runs on every edit unless you gate it.

**Solve Mode** (Selva › Utilities) has one output, `Preview`. It is true in a preview and false in a
full solve. Wire it into a Stream Filter, or into a component's own on/off input.

It is always false on the canvas, so files and gated work appear there as usual.

Two rules:

- **Gate only what files use.** A preview must show the same model as a full solve. If you gate
  something the page shows, the page and the download disagree, and nothing warns you.
- **Errors in gated work first appear on download.** The gated branch does not run while someone
  edits, so its errors show at the Download button, not in the form.

## For operators

- A download is a real solve and counts against the rate limiter.
- The download is cheap when it reaches the Rhino.Compute child that ran the preview: only the
  skipped components rerun. That needs session ids, so set `SELVA_HMAC_KEY`
  ([`.env.example`](../../../packages/selva/.env.example)).
- Share links and remote URLs carry no session id. Their download is one cold full solve.
- A reply over the server's size limit fails with `too_large`.
- An older plugin or Rhino.Compute ignores the mode and makes every file on every solve.

## From the API

`POST /api/v1/compute` takes `mode: 'preview' | 'full'`. Absent means `full`, so existing callers
get every file. A preview lists the outputs it skipped as `deferred` in the solve outcome.
