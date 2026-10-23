# Rhino panel: the plugin UI inside Rhino

The plugin UI (`@selvajs/plugin-ui`) opens in the system browser today. This plan puts it in a
Rhino panel instead: one window that floats or docks, on Windows and macOS, with the same
behaviour on both. The panel is the way in, and the UI is designed for it. The browser stays
reachable as an escape hatch, not as a second front door.

## The decision

**One Rhino panel, registered by a small companion `.rhp` that ships in the same Yak package as
`Selva.gha`.** A Rhino panel already floats or docks, and Rhino remembers where the user put it.
No second floating-window host is needed.

The `.rhp` exists for one reason: every `Rhino.UI.Panels.RegisterPanel` overload takes a
`Rhino.PlugIns.PlugIn`, and a `.gha` has none. That holds in Rhino 8 and in the Rhino 9 beta
(checked by inspecting both RhinoCommon assemblies; the internal `PanelSystem.Register` is not
reachable). Registering against Grasshopper's own `PlugIn` was tried in the spike and works, but it
is unsanctioned. It also breaks on restart: Rhino restores a docked panel at startup, before
Grasshopper has loaded and registered the type.

The UI stays the Svelte app in a WebView, not a native Eto UI. The cloud app shares its
components, the viewer is three.js, and native Eto controls freeze during a solve exactly like the
WebView does (same thread). Eto is only the shell: the panel, the pop-out window, the idle label.

The panel is the only visible entry:

- **The panel opens itself** when a bridge's server cold-starts (Enable goes true, or a file
  opens with it true). Right-click → **Open UI** brings it back.
- **"Open UI in Browser" appears only with Shift held** while opening the component menu. The
  browser stays live during a solve, so it's the tool for definitions that solve for seconds,
  and the fallback for a Rhino where the panel misbehaves or sits below the version floor.
- **No web viewer by default.** Rhino's own viewport shows the geometry. The schema's
  `viewerOptions.enableLocal` ("Local render") already gates both the preview's 3D viewer and
  whether the plugin streams display meshes at all, and it defaults to off. It stays as an opt-in
  for checking web materials or hotspots.
- **Pop out** moves the UI into its own window (see below), for a second display or fullscreen.

## What the panel cannot do: stay live during a solve

Grasshopper solves on Rhino's UI thread. A WebView inside Rhino depends on that thread for
painting and input, so **the panel is frozen for the length of every solve.** No setting changes
this, and it is the one place the panel is worse than the browser.

Measured in the spike (Rhino 8.27 for Mac, Eto WKWebView, `live_solve_showcase.ghx`, 5 s solve):

| During the solve                  | Result                                             |
| --------------------------------- | -------------------------------------------------- |
| `requestAnimationFrame` callbacks | 0. One 5019 ms gap, exactly the solve              |
| `setInterval` ticks (50 ms)       | 96: JS keeps running in the web process            |
| DOM updates from WebSocket events | 5: messages arrive and apply, unseen               |
| Mouse and keyboard                | None: AppKit delivers all input on the main thread |

When the solve ends, the page paints its already-current state at once.

On Windows (from documentation, not yet measured): WebView2's accelerator keys are routed
synchronously through the host's UI thread, and its cross-process child window shares the host's
input queue. So input stalls there too. Painting may continue. Either way, neither platform can
take a click during a solve.

`ScheduleSolution` does not help. It moves the start of a solve; the solve itself still holds the
thread. The bridge already schedules every solve (`AppConfig.ComponentLifecycle.ScheduleSolutionDelayMs`),
and the spike triggered its solve through `ScheduleSolution` too.

So the panel is designed for **frozen-during-solve on both platforms**:

- **Paint "Solving… Esc aborts" before the solve takes the thread.** The page shows a pending state
  the moment it sends a value update. Today `isSolving` flips on the plugin's state message, which
  arrives after the solve has started: too late to paint. While a panel client is connected, the
  plugin uses a longer schedule delay, enough for one frame to reach the screen.
- **Esc in Rhino is the abort.** The page's Abort button can't be clicked mid-solve, so in panel
  mode it becomes the Esc hint. `cancelSolve` over the socket stays for browser clients.
- **Rapid updates already coalesce.** The page holds back value updates while a solve runs and
  keeps only the latest, and input that queues during a freeze arrives as one burst.

## Architecture

### `Selva.Panel` (the `.rhp`)

A thin host with no Selva logic of its own:

- the `PlugIn` subclass, with `PlugInLoadTime.WhenNeededOrTabbedDockBar` so a panel restored at
  startup can find its type;
- one `PanelType.System` panel (`PerDoc` is the default and would create one panel per document
  window on Mac);
- a `SelvaPanel` command that opens the panel, so users can put it on a toolbar;
- a `SelvaWebHost`, held by the plug-in, that owns the one WebView and the current target (URL,
  session id). On Mac, Rhino may create and destroy a panel more than once, so the panel only
  displays what the host holds.

States:

- **No target:** the panel shows a native Eto label telling the user to enable a UI Bridge. No
  WebView is created, so an idle panel doesn't start a browser process.
- **Docked:** the panel shows the WebView. A new target navigates the same WebView.
- **In its own window:** the WebView sits in a normal Eto `Form` and the panel shows a label
  saying so.
- **Target cleared:** the window closes, and the panel goes back to the idle label.

The WebView is created once and kept for the life of the plug-in. Disposing it while WebView2 is
still initialising throws an unhandled `E_ABORT` in Eto builds before the Rhino 9 beta.

**Pop out.** Rhino's floating panel window can't go fullscreen on Mac. It's a utility `NSPanel`
that never becomes the main window, Rhino hides its zoom button, and Rhino draws its tab strip
where the traffic lights would be. So the host moves the WebView itself into a normal window,
which gets the full title bar, native fullscreen with its own Space, and a second display.
Moving an Eto control between parents keeps the page and its socket alive: the spike checked that
a value set in the page survives both moves. Closing the window docks the UI back into the panel.
The page's footer shows **Pop out** or **Dock**. After every move, and on every page load, the
host tells the page which container it's in, through `ExecuteScriptAsync`. The synchronous
`ExecuteScript` pumps the message loop while it waits, so it's never used.

**The page reaches the host by navigation.** A `selva-panel://<command>` link is cancelled and
run by the host. That works on every Eto build; `WebView.MessageReceived` only exists from Rhino
8.18. `toggle-window` is the only command. Anything with a payload goes over the WebSocket.

**First float size.** Rhino for Mac first floats a panel at 200×200. When the panel finds itself
in a floating window that small, it grows the window to 460×780.

WebView settings:

- **Navigation policy.** Only the target's own origin loads in the panel. `https` links, and `http`
  on loopback, open in the system browser, the same rule `SelvaUploadCoordinator.OpenInBrowser`
  enforces. `blob:` and `data:` navigations are cancelled. The spike showed a blob download
  navigates the whole WKWebView to the blob and replaces the app with the file's contents.
  Cancelling is a backstop: the page should never trigger one in panel mode (see file saves below).
- **Mac:** `Inspectable = true` on the native `WKWebView` (via `ControlObject`, by reflection, so
  the project needs no `Microsoft.macOS` reference). The spike confirmed this enables Safari's Web
  Inspector. Element fullscreen stays off.
- **Windows:** WebView2 defaults (right-click → Inspect already works).

The navigation policy is a pure function of (target URL, requested URL) and lives in a
Rhino-free class so `Selva.Tests` can cover it.

### The contract between `.gha` and `.rhp`

The `.rhp` overrides `GetPlugInObject()` and returns an object built **only from BCL types**:
a contract version (`int`), `Show(url, sessionId)` and `Clear(sessionId)` as delegates.
No shared interface assembly. The `.gha` ILRepacks and internalizes its dependencies, and the two
plug-ins may sit in different load contexts. BCL delegates cross both boundaries; a shared type
might not.

`Selva.gha` shows a session through `RhinoApp.GetPlugInObject(<Selva.Panel guid>)`, which loads
the `.rhp` if it isn't loaded yet:

1. If the `.rhp` isn't installed (someone copied only the `.gha`), or its contract version
   differs, say why in a runtime message. From the **Open UI** menu item it also opens the
   browser; on auto-open it doesn't.
2. `Show(url, sessionId)` with the URL from `TryBuildSessionUrl()` plus `host=rhino`. The host
   opens the panel, or brings the pop-out window to the front.

`Clear(sessionId)` fires when that bridge's Enable goes false, the component is removed, its
document closes, or Grasshopper unloads. `Clear` only acts if that session is still the current
target. Opening another bridge's UI retargets the panel.

### Page host mode

`host=rhino` in the session URL switches the page into panel mode. `buildSessionParams` carries it
through in-app navigation with `session` and `wsPort`, so it survives every route change and a
reload. The page also declares it in its `authenticate` message, so the plugin can tell the
panel's socket from a browser's.

**Esc stays in the panel.** On Mac, when the page leaves an Esc unhandled, it travels up AppKit's
responder chain and Rhino moves focus out of the panel. The spike saw the next keys typed go to
Rhino. In panel mode the page marks every Esc handled. Whether Grasshopper's solve abort still
sees the key is test 2 below.

**File saves go through one seam.** Five places build an `<a download>` today:

- `packages/ui/src/lib/utils/file-download.ts` (single output file)
- `packages/compute/src/core/files/handle-files.ts` (zipped multi-file outputs)
- `packages/plugin-ui/src/lib/utils/schema-exporter.ts`
- `packages/ui/src/lib/schema/param-exporter.ts` (`.slvp` presets)
- `packages/ui/src/lib/components/viewer/Viewer.svelte` (screenshot)

They route through one `saveBlob(blob, fileName)` in `@selvajs/ui`, which resolves false when the
user cancels. The default implementation is today's anchor click, which can't tell and always
resolves true. In panel mode, plugin-ui installs another with `setBlobSaver`: it sends the bytes to
the plugin, and the plugin shows the native Save dialog. `@selvajs/compute`'s
`downloadFileData` and `downloadFileDataByRoot` take an optional `{ saveBlob }`: additive, because
compute has external consumers.

**File picks go through one seam too.** `pickFile({ accept })` takes the `<input accept>` string
and returns one `File`, or null when cancelled; no caller picks several at once. The default is today's hidden `<input type=file>`. In
panel mode, plugin-ui installs another with `setFilePicker`: the plugin shows a native Open dialog
with filters built from `accept` and returns the bytes, and the page builds a `File`, so code
downstream doesn't change. Three reasons:

- Cancelling a WKWebView file picker aborts Rhino on Eto builds before the fix
  ([picoe/Eto#2882](https://github.com/picoe/Eto/issues/2882), present at least through Rhino 8.27,
  fixed by 8.36).
- Eto's Mac picker ignores `accept`.
- Both platforms get the same dialog.

Dropping a file onto the page involves no picker and keeps working natively.

**Fullscreen** buttons on image and chart outputs show only when `document.fullscreenEnabled` is
true. WKWebView has no Fullscreen API, so the unguarded calls in `ImageOutput.svelte` and
`ChartOutput.svelte` threw before their `.catch`. That is a bug in any browser without the API.

### Wire messages

| Message              | Direction     | Frame  | Fields                                                            |
| -------------------- | ------------- | ------ | ----------------------------------------------------------------- |
| `hostSaveFile`       | page → plugin | binary | `requestId`, `fileName`, then the file's bytes                    |
| `hostSaveFileResult` | plugin → page | text   | `requestId`, `outcome`: `saved` / `cancelled` / `failed`, `error` |
| `hostPickFile`       | page → plugin | text   | `requestId`, `accept[]`                                           |
| `hostPickedFile`     | plugin → page | binary | `requestId`, `name`, then the file's bytes                        |
| `hostPickFileResult` | plugin → page | text   | `requestId`, `outcome`: `cancelled` / `failed`, `error`           |

Every request gets exactly one reply, sent only to the socket that asked: a pick answers with
either `hostPickedFile` or `hostPickFileResult`. The envelopes are hand-written on both stacks
(`OutboundEnvelopes`, `messageSchemas.ts`) like the bridge's other messages, and
`packages/schemas/fixtures/wire/` pins them, including a binary frame
(`host-picked-file.slhf`), so the two sides can't drift.

File bytes travel raw in binary frames, not base64 in JSON. Base64 makes every file a third larger
and costs an encode on one side and a decode on the other.

A binary host frame carries everything it needs:

| Bytes      | Field                                                                  |
| ---------- | ---------------------------------------------------------------------- |
| 0–3        | magic `SLHF`                                                           |
| 4–7        | header length `N`, uint32 little-endian                                |
| 8 to 8+N   | header: UTF-8 JSON, an ordinary envelope (`type`, `sessionId`, fields) |
| 8+N to end | file bytes                                                             |

The mesh pattern (a JSON envelope, then bare binary frames in order) doesn't work here, for two
reasons:

- `handleBinaryFrame` in `websocket-solve-driver.ts` takes every bare binary frame it sees as a
  mesh blob.
- A reply to one socket isn't serialized against broadcasts, so a file frame could land between an
  `outputs` envelope and its mesh frames.

The magic lets the page route `SLHF` frames to the host handler before anything reaches the mesh
collector, and `requestId` in the header ties each frame to its request without relying on order.

- **Size:** a file may be up to `AppConfig.ValueLimits.MaxFileSizeBytes`, pinned for the page as
  `maxHostFileBytes` in `fixtures/bridge-handshake.json`. The page refuses a bigger save before
  sending, because an oversized frame would close the socket. The plugin answers `failed` for a
  bigger save body or picked file.
- **Access:** the page declares `"host": "rhino"` in its `authenticate` message. Host messages
  from any other socket are refused, binary frames included, so a browser client can't pop a
  dialog inside Rhino. Every read and write goes through a dialog the user drives.
- **Plugin:** `HostFileCoordinator` runs one dialog at a time, because a second would open inside
  the first one's modal loop. A request that arrives while one is open gets `failed`. Dialogs (`EtoHostFileDialogs`, parented to `RhinoEtoApp.MainWindow`)
  open via `RhinoApp.InvokeOnUiThread`, so the socket's dispatch chain never blocks on one, and
  file IO runs off the UI thread.

`window.eto.postMessage` was considered as the channel and rejected. Eto only gained
`WebView.MessageReceived` in the build that shipped with Rhino 8.18. Selva supports Rhino 8.0, and
the WebSocket is already there and authenticated.

## Rhino version floor

| Rhino    | Eto     | What matters here                                                                   |
| -------- | ------- | ----------------------------------------------------------------------------------- |
| 8.0–8.17 | 2.7–2.9 | No `MessageReceived` (not needed; see above)                                        |
| 8.27     | 2.11    | Mac file-picker cancel crash (avoided: picks go through the plugin)                 |
| 8.36     | 2.11    | Picker crash fixed. WebView2 `E_ABORT` and browser-process-crash fixes not included |
| 9 beta   | 2.13    | All of the above fixed                                                              |

These came from research, not this repo. The test branch measures the floor rather than trusting
the table. Below the floor, **Open UI** opens the browser and the runtime message says
why.

## Packaging

- **`Plugin/Selva.Panel/`**: same TFMs as `Selva.GH`, references `RhinoCommon` only (Eto comes
  with it), no ILRepack, no third-party packages.
- **`scripts/build-production.js`** stages `Selva.Panel.rhp` beside `Selva.gha` in each TFM
  folder. Yak supports a `.rhp` and a `.gha` side by side in one multi-target package; the manifest
  doesn't change.
- **`Selva.PluginVerifier`** loads the `.rhp` as well as the `.gha`.
- **Docs to update in the same change:** the project table in `STRUCTURE.md` gains the new
  project, and the project overview in `CLAUDE.md` mentions the panel.

## What the test branch has to prove

Each item has a pass condition. On Mac, the measurements can be driven through the Rhino MCP tools
the same way the spike was (see `.claude/skills/rhino-mcp/`). Keyboard items need a person.

1. **Keyboard reaches the page**, Mac and Windows. Typing, Backspace, arrows, Tab, Enter and
   Cmd/Ctrl + C/V/X/Z/A act on a focused text input in the panel. Nothing reaches Rhino's command
   line, and no Rhino shortcut fires. McNeel staff say Rhino on Mac takes alphanumeric keys before a
   focused Eto control. On Mac (8.27) letters, digits, space and Backspace reach a focused textarea
   and nothing reaches Rhino's command line. `RhinoApp.KeyboardEvent` still observes every key,
   but Rhino doesn't act on them. macOS autocorrect applies, as it does in Safari. Still to check:
   arrows, Tab, Enter, the Cmd shortcuts, and all of it on Windows.
2. **Esc aborts a solve with focus in the panel**, Mac and Windows. Start a long solve from the
   panel; Esc ends it within the normal Grasshopper abort latency.
3. **Windows behaviour during a solve, measured** the same way as the Mac table above: inject
   `requestAnimationFrame`, `setInterval` and `MutationObserver` recorders, run the showcase with
   a stage delay, read the gaps back. Only valid while `document.visibilityState` is `visible`. A
   window behind other windows is throttled to 1 Hz and gives a false result.
4. **The pending state paints before the solve.** With the panel-mode schedule delay, "Solving…"
   is on screen during the solve on both platforms. Pick the smallest delay that works on both.
5. **Saves and picks round-trip** on both platforms: single file, zipped outputs, schema export,
   `.slvp`, screenshot, and a pick that is cancelled. Nothing navigates the panel away.
6. **Panel lifecycle.** Dock, float, re-dock, switch tabs. Restarting Rhino with the panel docked
   restores the placement and shows the label, with no stale session; on Mac this holds, and the
   `.rhp` loads at startup to do it. Quitting Rhino with the panel open, docked or popped out,
   doesn't hang. Closing the panel straight after opening it doesn't crash (the WebView2 `E_ABORT`
   case). On Mac, two open documents still share one panel.
7. **Pop out and dock**, Mac and Windows. The page keeps its state and its socket through both
   moves, the window goes fullscreen from its green button, and closing it docks the UI back. On
   Mac this holds. On Windows, WebView2 has to survive being re-hosted between windows.
8. **Retargeting.** Two bridges in two documents. **Open UI** on each switches the panel.
   Turning one bridge off clears the panel only if it was showing that one.
9. **Viewer performance.** Orbiting the showcase scene in the panel feels the same as in the
   browser on the same machine.
10. **Install.** A clean Yak install on Windows and on Mac loads the `.rhp` without a prompt. A
    `.gha`-only install falls back to the browser with a runtime message.
11. **Version floor.** Repeat 1, 5, 6 and 7 on the oldest Rhino 8 the plan should support. That
    result sets the floor.

## Rejected alternatives

- **A floating Eto window owned by the `.gha` as the only host.** Can't dock. The pop-out window is
  different: the `.rhp` owns it, and it shows the same WebView the panel shows.
- **The UI rewritten in native Eto.** Two UIs to keep in sync with the cloud app, no three.js
  viewer, and no gain during a solve: Eto controls paint on the same thread.
- **Fill screen by zooming Rhino's floating panel window.** Setting Eto's `Maximizable` brings its
  green button back, and zoom works. But Rhino draws its tab strip, with the panel icon, where the
  button sits. A button moved elsewhere is put back by AppKit on the next layout.
- **Registering the panel under Grasshopper's `PlugIn`.** Unsanctioned, and breaks when Rhino
  restores the docked panel before Grasshopper loads.
- **A helper process whose window sits on top of an empty panel.** It would stay live during
  solves, but:
  - on Mac, clicking it activates another app and Rhino's menu bar disappears;
  - on both platforms, it fights Rhino's menus, tooltips and floating windows over z-order.
- **Pumping the event loop mid-solve** (for example from a component between stages). A click or
  value update arriving mid-solve would re-enter Grasshopper while it is solving.
- **WebView2 Window-to-Visual hosting** to avoid the shared input queue. It's process-wide, so it
  would change every WebView in Rhino, including McNeel's own.
- **Reading blob downloads from the host** (cancel the `blob:` navigation, then fetch the blob
  through script). It depends on navigation timing. The page-side seam is explicit and testable.

## Sources

- RhinoCommon `Panels`: <https://developer.rhino3d.com/api/rhinocommon/rhino.ui.panels>
- `PanelType.System` over the `PerDoc` default: <https://discourse.mcneel.com/t/dockable-interface-panel-problem/158129>
- Rhino on Mac taking keys before Eto controls: <https://discourse.mcneel.com/t/keydown-keyup-from-an-eto-panel/216757>
- Eto WKWebView handler: <https://github.com/picoe/Eto/blob/develop/src/Eto.Mac/Forms/Controls/WKWebViewHandler.cs>
- Eto WebView2 handler: <https://github.com/picoe/Eto/blob/develop/src/Eto.Wpf/Forms/Controls/WebView2Handler.cs>
- Eto `MessageReceived`: <https://github.com/picoe/Eto/pull/2752>
- Mac file-picker cancel crash: <https://github.com/picoe/Eto/issues/2882>
- WebView2 accelerator keys block the browser process: <https://learn.microsoft.com/dotnet/api/microsoft.web.webview2.core.corewebview2controller.acceleratorkeypressed>
- WebView2 attached input queues: <https://github.com/MicrosoftEdge/WebView2Feedback/issues/2707#issuecomment-1233407267>
- WebView2 hosting modes: <https://learn.microsoft.com/microsoft-edge/webview2/concepts/windowed-vs-visual-hosting>
- Yak package layout: <https://developer.rhino3d.com/guides/yak/the-anatomy-of-a-package/>
- `PlugInLoadTime`: <https://developer.rhino3d.com/api/rhinocommon/rhino.plugins.pluginloadtime>
