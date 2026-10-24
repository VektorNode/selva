# Rhino player: open a definition from the panel, without Grasshopper

Builds on [rhino-panel](./rhino-panel.md). Its sibling, [host-aware-elements](./host-aware-elements.md),
covers what a UI can do in Rhino that it can't do on Selva yet.

Selva has two audiences inside Rhino. Grasshopper users build a definition and its UI. Rhino users
who never open Grasshopper only want to set values and get a result, the way Grasshopper Player
works. Today both get the same page with the schema builder one click away, and the only way to
load a definition is to open it in Grasshopper and enable its UI Bridge.

## The decision

**The builder is there when the canvas is.** A session's role comes from where it started, not
from where its window sits:

- **Author session:** started from the canvas, by the UI Bridge's Enable or its Open UI item.
  Builder and preview, docked or popped out. This is today's behaviour.
- **Player session:** started from the Selva panel by opening a definition file. Preview only,
  docked or popped out. Grasshopper's editor stays hidden, and nothing is written back to the file.

A Rhino user never opens the canvas, so never sees authoring. A Grasshopper user who opened a file
as a player gets **Edit in Grasshopper**, which shows the editor with that document and turns the
session into an author session.

This separates the two audiences in the UI. It is not a lock: anyone with Rhino can open
Grasshopper. Protecting a definition from edits is a different feature, such as a read-only share
or a flag in the schema.

## The bridge: hosted and role are two flags

A player session needs two things from its UI Bridge, and they change at different times, so they
are separate flags on the component:

- **Hosted** keeps the bridge running whatever its Enable input says: it runs on
  `enable || hosted`. The launcher sets it before the document's first solve, and it lasts until
  the document closes or the user changes the Enable input, whichever comes first. One flag can't
  do both jobs. If Edit in Grasshopper cleared the player flag on a file saved with Enable off,
  that would be a falling edge: `HandleDisablingState` would clear the panel and stop the servers,
  leaving no author page to reload into.
- **Role** (player or author) decides what the session may do. It starts as player and Edit in
  Grasshopper flips it to author.

The transport and its WebSocket server are created inside the first `SolveInstance`, and the
server is rebuilt on every start. So the transport reads the role from the component when it acks
an `authenticate` and when it filters a message, never from a value captured at construction.

**The plugin enforces the role. The page only renders it.**

- In a player session the transport refuses `saveSchema`, `applySyncChanges` and every `selva*`
  message, the same way it already refuses host-file messages from a browser socket. Those are the
  only messages that write the schema; `requestSyncPreview` only reads. Hiding the buttons alone
  would leave the socket writable.
- The `authenticated` reply carries the role. It is a constant today
  (`BridgeAccess.AuthenticatedMessage`), pinned in `packages/schemas/fixtures/bridge-handshake.json`
  and checked by tests on both stacks, so all three change together.
- The session URL carries `mode=player` so the first paint is right. `buildSessionParams` keeps only
  `session`, `wsPort` and `host` today, so `mode` joins that list, or every redirect and `goto`
  drops it. The URL only chooses what to render; the handshake is what the bridge enforces.

What the page changes:

- **The welcome page goes.** The two cards in `packages/plugin-ui/src/routes/+page.svelte` become a
  redirect. An author lands on the builder if the schema has no layout items, otherwise on the
  preview. A player lands on the preview.
- **A player session has no builder.** `/builder` redirects to `/preview`, and `ModeHeader`, which
  is the preview's only link to the builder, drops the mode switch. The header shows the
  definition's name, **Open another…**, **Close** and **Edit in Grasshopper**. Save and Upload to
  Selva live only on the builder page, so they go with it.

## Opening a definition

1. **The idle panel becomes a launcher.** `SelvaPanel`'s idle label becomes an **Open…** button and
   a list of recent definitions. It stays native Eto: an idle panel still starts no browser
   process, and nothing loads Grasshopper until the user picks a file.
2. **The `.rhp` loads Grasshopper if needed.** `RhinoApp.GetPlugInObject("Grasshopper")` returns a
   `GH_RhinoScriptInterface`; its `LoadEditor()` is called by reflection, so the `.rhp` still
   references only RhinoCommon. The panel shows "Loading Grasshopper…" first: the first load blocks
   Rhino's UI thread for seconds, so the label has to paint before the call.
3. **The `.rhp` finds the `.gha`'s open delegate in process-wide data.** When Grasshopper loads
   Selva, `SelvaTabProperties.PriorityLoad` (Selva's `GH_AssemblyPriority`) stores a contract
   dictionary with `AppDomain.CurrentDomain.SetData`, under a key named in `PanelContract`. It
   holds a version and `openDefinition: Func<string path, string? refusal>`. The data slot avoids
   two load-order traps:
   - The `.rhp` may load before or after Grasshopper. It loads at startup only when the panel sits
     in a tabbed dock bar.
   - Calling into the `.rhp` from `PriorityLoad` would need `RhinoApp.GetPlugInObject`, which loads
     the `.rhp`. `RhinoPanelHost.Clear` uses `PlugIn.Find` precisely to avoid that.

   `PriorityLoad` skips this under `HeadlessGuard.IsHeadless`: Rhino.Compute loads Selva too. Only
   BCL types cross, as in [the panel contract](./rhino-panel.md#the-contract-between-gha-and-rhp).
   `LoadEditor()` is synchronous, so if the slot is still empty after it returns, Selva isn't
   installed or its contract version differs, and the launcher says so.

4. **`DefinitionLauncher`, in the `.gha`, opens the file and returns a refusal or null:**
   - **Already open?** If Grasshopper already has the file open, it refuses ("already open in
     Grasshopper: use its UI Bridge"). A second copy would carry the same persisted `DocumentID`,
     and the author bridge's `OnDocumentRemoved` matches by `DocumentID`, so closing the copy would
     unregister the author's events. `OnDocumentRemoved` should compare by reference anyway.
   - **Read without solving:** `GH_DocumentIO.Open(path)`. The document isn't in the document
     server yet, so nothing has solved.
   - **Has a Selva UI?** It needs a UI Bridge with an embedded schema whose Schema output reaches a
     Context Bake nicknamed `Schema`, the same check `BridgeOrchestrator` makes before it serves the
     UI. Otherwise: "This definition has no Selva UI. Open it in Grasshopper to add one."
   - **Pick one bridge.** It marks the first qualifying bridge as hosted with the player role, and
     marks the others suppressed, so a second bridge with Enable on can't cold-start and retarget
     the panel to an author URL. All of this happens before the first solve, or a file saved with
     Enable on would cold-start as an author session.
   - **Show it.** It remembers the canvas's current document, adds the new one to
     `Instances.DocumentServer`, makes it the canvas's document, enables it, and calls
     `ForcePreview(true)` (see below).
5. **The bridge cold-starts and calls `ShowInPanel` as today**, with `mode=player` in the URL.
   Failures after that point would otherwise land as runtime messages on a hidden canvas, so the
   hosted bridge reports them through a `notify(message)` key in the panel contract. The launcher
   leaves "Loading…" for an error state with that message, or after a timeout.

**Closing a player document** has to stop its bridge explicitly. `DocumentServer.RemoveDocument`
reaches none of the paths that stop servers (Enable falling, Lock, `RemovedFromDocument`,
`Dispose`). So the launcher:

1. tears the bridge down (clear the panel, stop the servers, dispose);
2. removes the document;
3. makes the remembered document the canvas's document again and re-enables it.

The panel goes back to the launcher. If the author's own UI was showing before, they bring it back
with Open UI on their component.

**One player document at a time.** Opening another file closes the current one first. Documents the
user opened in Grasshopper are never touched.

**A player document never asks to be saved.** Selva's own post-solve schema sync calls
`document.Modified()` (`DocumentSynchronizationService`), and Grasshopper asks about modified
documents on close and when Rhino quits. The launcher clears `IsModified` whenever `ModifiedChanged`
fires for a player document.

**The header's three actions:**

- **Open another…** is a `selva-panel://open` link. The `.rhp` shows its native Open dialog and
  passes the pick to `openDefinition`, which closes the current player document first. Cancel
  changes nothing. It works the same docked or popped out, so the panel needs no
  launcher-over-a-session state.
- **Close** and **Edit in Grasshopper** are new inbound wire messages to the bridge
  (`closeDefinition`, `editInGrasshopper`). The `.gha` does the work, and its socket is already
  there and authenticated. Inbound messages have parser tests, not wire fixtures: the fixtures are
  one per outbound envelope.
  - **Close** runs the closing steps above.
  - **Edit in Grasshopper** calls `ShowEditor()`, turns the forced preview off, stops clearing
    `IsModified`, flips the role to author, and re-shows the panel with an author URL. The page
    reloads, re-authenticates and gets `role: author`. Hosted stays set, so the session survives a
    file saved with Enable off.

**Three ways in:**

- the launcher in the panel;
- **Open another…** in the player header;
- a `SelvaOpen` Rhino command with a path argument, for toolbars and scripts.

Recent definitions live in the `.rhp`'s plug-in settings: the `.rhp` shows them, and its settings
persist without Grasshopper loaded.

**The solve-event transport becomes per document.** `SolveRuntimes` holds one process-wide local
transport, on the assumption that one Rhino process serves one bridge session. A player session
breaks that: the author's bridge keeps running in the paused document. The player's start
overwrites the transport, and its stop nulls it, leaving the author's bridge without live solve
events. Each `DocumentSolveRuntime` gets its own.

When this lands, two statements in [rhino-panel](./rhino-panel.md) change with it:
"`toggle-window` is the only command", and its description of the idle panel.

## What Grasshopper does with the editor hidden

Checked live on Rhino 8.27 with the editor hidden, through the Rhino MCP tools:

- **No preview by default.** `GH_Document.ShouldDrawPreview()` returns false while the editor is
  hidden. It checks `DocumentEditor.Visible`, unless the document's preview is forced,
  `Properties.KeepOpen` is set, or the remote panel is visible. A probe document holding one circle
  drew nothing until the public `GH_Document.ForcePreview(true)`, then drew it. The docked panel
  never shows the web viewer (`showViewer` is `enableLocal && !isInRhinoPanel()`), so without the
  forced preview a player session shows no geometry at all.
- **Only the canvas's document solves.** Making the probe the canvas's document disabled the one
  that was active, and switching back re-enabled and re-solved it. So opening a player definition
  pauses whatever document an author had active, and that document's bridge sees no solves until it
  is active again.
- **The calls used above exist and behave as described.** `GH_DocumentIO.Open(string)`,
  `DocumentServer.AddDocument` / `RemoveDocument`, a settable `GH_Canvas.Document` and a settable
  `GH_Document.IsModified`. Removing a modified document after clearing `IsModified` raised no
  prompt.
- **`GH_RhinoScriptInterface` has `LoadEditor`, `ShowEditor`, `HideEditor`, `IsEditorLoaded` and
  `OpenDocument`.** `OpenDocument` isn't used; see the rejected alternatives.

## What still has to be proven

1. **Cold load from the `.rhp`.** In a Rhino where Grasshopper hasn't loaded, `LoadEditor()` called
   from the `.rhp` loads `Selva.gha`, the AppDomain slot is filled by the time it returns, and the
   open completes without the editor ever showing. Also with the panel docked at startup, and on
   both the .NET Framework and .NET Core runtimes of Rhino 8 on Windows.
2. **Esc aborts a solve** in a player session, with the editor hidden and focus in the panel.
3. **The author's document comes back intact** after a player session closes:
   - it's the canvas's document again, re-enabled;
   - its bridge is still serving and still receives live solve events;
   - its values are unchanged.
4. **Quitting Rhino** with a player document open doesn't prompt and doesn't hang.
5. **Edit in Grasshopper hands over cleanly**, including on a file saved with Enable off:
   - the editor shows;
   - the preview is no longer forced;
   - the next schema sync marks the document modified;
   - the page reloads as an author.

## Rejected alternatives

- **Docked means player, popped out means builder.** It ties a role to a window position. A player
  who pops out for fullscreen or a second display, which is why pop-out exists, would get the
  builder. An author on a laptop couldn't edit while docked, which throws away the narrow builder
  layout.
- **A launcher written as a web page.** It needs a server that runs without any bridge just to draw
  a file list. Native Eto keeps the idle panel free of a browser process.
- **Flipping the UI Bridge's Enable toggle to start a player session.** It edits the user's
  document, and Enable may be wired to something other than a toggle.
- **Opening through `GH_RhinoScriptInterface.OpenDocument`.** It opens and solves in one call, so a
  file saved with Enable on would start an author session before the launcher could mark it.
- **Registering the launcher through the `.rhp`'s `GetPlugInObject()`.** It returns a new dictionary
  on every call, so the `.gha` can't add a key to it. Reaching it from `PriorityLoad` would also
  load the `.rhp`, and fail when Grasshopper loads before the `.rhp` does.
- **A launcher view over a running session** for Open another…. From the pop-out window the panel
  shows the in-window label, so there's nowhere to put it, and cancelling would need its own state.
  The native Open dialog avoids both.
- **A setting that hides authoring.** Selva runs on the user's own machine and Grasshopper is one
  click away, so a setting would look like a lock without being one.
