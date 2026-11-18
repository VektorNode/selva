# Marketing captures

Stills and videos of Selva from the real thing: a live UI Bridge in Rhino 9, the Grasshopper
canvas, Rhino's own window, and the Selva app. Everything lands in `marketing/` at the repo root,
which git ignores.

Needs a dev install (`pnpm install:plugin:dev`), Chrome, and `ffmpeg` on PATH
(`winget install Gyan.FFmpeg`).

| Output                              | From                                                      |
| ----------------------------------- | --------------------------------------------------------- |
| `marketing/plugin/<example>/`       | `plugin.mjs`: builder and preview stills, two videos      |
| `marketing/grasshopper/<example>/`  | `rhino/canvas.cs`: the whole canvas and each titled group |
| `marketing/rhino/`                  | `rhino/window.cs`: Rhino with the panel, Grasshopper      |
| `marketing/app/`                    | `app.mjs`: admin and team pages, light, dark and phone    |
| `packages/website/static/showcase/` | `website.mjs`: the captures the landing page shows        |

## Plugin UI

Open an example in Grasshopper, switch its UI Bridge on, then:

```bash
node scripts/marketing/plugin.mjs --name kitchen-run               # stills and both videos
node scripts/marketing/plugin.mjs --name kitchen-run --only videos --take preview
node scripts/marketing/inventory.mjs                               # the form's labels
```

It drives the newest live session, as a second browser beside the panel. Form edits reach
Grasshopper like a user's, and the builder video saves the schema it read back into the open
document, so close the definition without saving.

The preview video follows the example's entry in [storyboards.mjs](./storyboards.mjs); an example
without one gets a generic tour. Write a storyboard: the generic tour orbits a room onto its
back wall and never opens a dropdown.

The pointer in a video is drawn by the page and moved by `glide` in [lib.mjs](./lib.mjs): eased,
slightly curved, landing off centre. Playwright's own action overlay is never switched on; it
prints the selector of every click into the frame.

## Grasshopper and Rhino

Both scripts run inside Rhino, through `_-ScriptEditor _Run "<path>"`.

- `rhino/canvas.cs` needs only an open definition.
- `rhino/window.cs` shoots Rhino's main window with its floating windows on top. Write the
  output path, without `.png`, to `%TEMP%\selva-shot.txt` first; one ending in `@editor` shoots
  the Grasshopper editor alone. It prints through `PrintWindow`, so a window that is covered still comes out
  right and nothing else on the desktop can get into the picture.

For a viewport worth showing, hide every Grasshopper preview but the Web Display components
(they draw in their material's colour), use Shaded, and turn the grid off. The Grasshopper
editor's tab row lists every installed plugin: check it before publishing a shot.

## Selva app

```bash
node scripts/marketing/serve.mjs     # the app on :5373, data in .selva-data/marketing
node scripts/marketing/app.mjs       # seed a made-up studio, then the stills
```

`serve.mjs` never touches `pnpm dev:local`'s data. Delete `.selva-data/marketing` to start over.

The library is empty until definitions are uploaded, and an upload goes through Rhino.Compute:
start `pnpm compute:local`, register it at `/admin/compute`, and upload from there. Close Rhino
first: two Rhinos on one machine take the licence from each other.

## Website

```bash
node scripts/marketing/website.mjs   # marketing/ → packages/website/static/showcase/
```

Converts the captures the landing page shows to `.webp` and 900p `.mp4`. The list of files is at
the top of the script; the page that uses them is `packages/website/src/routes/+page.svelte`.
