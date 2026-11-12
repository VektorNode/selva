# Selva app: a definition as its own program

Builds on [rhino-player](../archive/rhino-player.md): the player session it describes is what
runs here, in a Rhino nobody sees.

People who use a definition's Selva UI often never touch Rhino or Grasshopper. They should get
a file that opens like a document, in a window that is only that tool. Rhino still has to be
installed and licensed on the machine: the app explains that when it's missing, but can't
remove it.

## The decision

**Two processes.** `SelvaApp.exe` owns a window with a WebView. It starts a normal Rhino whose
window is hidden, and that Rhino runs the existing player session. The page is the one the
plug-in already serves, so the app has no UI of its own beyond a launcher, progress and errors.

- **The page is in its own process.** In the Rhino panel a solve freezes the page, because the
  WebView shares the UI thread with the solver. Here it stays live.
- **The app doesn't care which Rhino it starts.** It finds Rhino 9 and 8 in the registry and
  prefers the one whose package folder it was installed into. The plug-in already multi-targets.
- **Rhino exits with the app.** The app sends `quit`, waits, then kills. Rhino also exits when
  the pipe breaks. A Rhino nobody can see must not outlive its window: it holds a licence.

**Two ways in, one app.**

- Started without a file: a launcher with recent files. It opens any `.gh` with a Selva UI.
- Started with a Selva app file (`.slvx`): the window is that app. Its name is the title, and
  closing the definition closes the window.

## Starting Rhino without a window

`Process.Start` with `WindowStyle = Hidden`, shell-executed, and
`/nosplash /notemplate /runscript="_-SelvaAppHost <pipe>"`. Rhino's main window is never shown,
and every panel and the Grasshopper editor are owned by it.

Checked live on Rhino 9.1 and 8.36: no visible window for the life of the process, `/runscript`
runs, Grasshopper loads, the player session solves and its servers start. A cold open takes 10
to 20 seconds on a development machine.

**Dialogs are not hidden.** A dialog Rhino opens (a licence prompt, crash recovery, a missing
plug-in) is a visible window of its process, but it has no taskbar button and can sit behind
everything. While an open waits, the app looks for one every two seconds, puts it in front
once, names it on the progress page, and holds its timeouts off while it is up. Checked on
Rhino 9 without a licence: the "Licensing" window is visible 7 seconds after the start.

`SelvaAppHost` hands the pipe's name to `Selva.Panel.rhp`, which then serves the app instead of
its panel: the `show`, `clear` and `notify` the `.gha` sends through the panel contract go over
the pipe. The `.gha` learns only one thing, through `PageHostKey`: the session URL says
`host=app` instead of `host=rhino`. The pipe protocol is the header of
`Plugin/Selva.App/AppHostProtocol.cs`.

## The page in the app is a browser tab

`host=app` is a query parameter only. The page does not declare it when it authenticates, so the
bridge treats it as a browser tab: no native Rhino dialogs, no viewport picks. The app saves
downloads through a Save As dialog and opens links in the default browser.

Two things differ from a tab:

- **The viewer.** Rhino's viewport is hidden, so the page's 3D viewer is the only place
  geometry shows. It is on when the schema has `enableLocal` or `enableRemote`, on both sides
  (`LocalViewer.IsOn` in the plug-in, `showViewer` on the preview page).
- **No Edit in Grasshopper.** The editor would come up with nothing behind it. The page hides
  the item and the launcher ignores the command. An app file opened in the Rhino panel still
  shows the item; there the launcher answers with a message.

## Selva app files

Format: the header of `Plugin/Selva.App/Format/AppFile.cs`. One definition, a name, an optional
icon, and optionally a key.

- **Its own extension**, because Grasshopper owns `.gh`: double-click can only belong to Selva
  for a file type that is Selva's.
- **Loaded from memory.** The plug-in hands the bytes to `GH_Archive` directly, so no `.gh` is
  written to disk. The cost: the document has no path, so a definition that reads files
  relative to its own location breaks.
- **Locked.** A session from an app file is never handed to the Grasshopper editor. Showing the
  editor closes it, where a plain definition becomes an author session.
- **Exported from the builder.** The bridge serializes the open document the way an upload to
  Selva does, and the page saves the reply with `saveBlob`, so it works from the panel and from
  a browser tab.

### What the key does

The author types a key at export. PBKDF2-HMAC-SHA256 derives the file key (per-file salt), and
AES-256-GCM encrypts the definition with the rest of the file as associated data.

The file also stores a **key id**: a second PBKDF2 of the key with a fixed salt, truncated to 8
bytes. The app looks the id up in Windows Credential Manager, so a user who has the key stored
opens every file protected with it without being asked. `SelvaApp.exe --add-key` stores it
ahead of time, for the Windows account that runs it only: a deployment runs it once per user,
for example from a logon script. The fixed salt means one precomputed dictionary works against every
Selva file; the per-guess cost is still one PBKDF2 run, the same as attacking the file itself.

The key keeps a file from people who don't have it. It does not hide the definition from
someone who does: it runs in their own Rhino. A key built into the plug-in would protect
nothing, because the source is public.

## The installer

`SelvaSetup.exe` (`Plugin/Selva.Setup`) is for people who never open Rhino's package manager.
It embeds the two `.yak` files of the same build and unpacks each into
`packages<8.0|9.0>Selva<version>` with the `manifest.txt` the package manager writes, so
Rhino and the package manager see a normal install. A version is swapped in by renaming
folders: Windows refuses the rename while a file in the old one is open, so a reinstall over a
running Selva fails before it has changed anything. It then runs the installed
`SelvaApp.exe --register`, which owns the file type and the Start menu entry, and keeps a copy
of itself as the uninstaller.

- **Per user, no elevation.** Everything it writes is under the user's profile and `HKCU`. Its
  manifest says `asInvoker`: Windows would otherwise ask for administrator rights for any exe
  named like an installer.
- **Written here, not in Inno Setup or WiX.** The job is unpacking two zips and a handful of
  registry values, the build machine and CI then need no extra tool, and the package layout is
  already ours to keep in step with `install-local.js`.

## Rejected alternatives

- **COM automation (`Rhino.Application`).** It starts an invisible Rhino by design, but Rhino
  9.1 registers the class under a malformed CLSID (`{97D1732A-…-DDA0520F1E3Fs}`, with a trailing
  `s`), so creating it fails with `REGDB_E_CLASSNOTREG`. A hidden process start needs no
  registration and has a Mac equivalent.
- **Rhino.Inside.** One process and no stray dialogs, but the host must match Rhino's .NET
  runtime, it has no Grasshopper editor or canvas (the player session and `ScheduleSolution`
  lean on both), and `HeadlessGuard` reads a headless Rhino as Compute and keeps the bridge off.
- **A local Rhino.Compute behind the Selva app.** Mostly built already, but it inherits the
  licence contention between headless Rhinos and solves statelessly.
- **The pop-out window inside a hidden Rhino.** No second process, but the page freezes during a
  solve again.
- **A modern .NET app.** Rhino brings a private runtime, so nothing guarantees a shared one on
  the machine. .NET Framework 4.8 is on every Windows 10 and 11; self-contained would add
  tens of megabytes to the package for each Rhino.

## Not built (unfiled)

- **macOS.** The format, the export, the plug-in side and the pipe (a Unix socket there) are
  portable. Missing: a Mac app (WKWebView, Keychain, a declared file type), starting Rhino hidden
  (`open -gj`, untested), and signing and notarization, which need a Mac.
- **Remembering the icon.** The export dialog keeps a picked icon until the page reloads. The
  page's origin changes with the session's port, so browser storage can't carry it further; the
  definition could.
- **A signed installer.** Unsigned, Windows SmartScreen warns before it runs. That needs a
  code-signing certificate in the release workflow.
- **One Rhino per window.** Two apps open at once are two Rhinos.
