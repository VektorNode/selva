# Agent Guidance

Read [STRUCTURE.md](./STRUCTURE.md) before adding or moving files, and follow
[CONTRIBUTING.md](./CONTRIBUTING.md) for validation and pull-request requirements.

## Cross-platform plugin UI

Selva's Grasshopper plugin targets Rhino on Windows and macOS. Use `Eto.Forms` for every
Selva-owned window, dialog, table, and interactive control. Do not add WinForms forms or controls
for plugin-owned UI.

Grasshopper APIs still expose a few required WinForms boundary types. Keep them when an override or
event signature requires them, including `ToolStripDropDown` in component menus and `MouseButtons`
in canvas mouse events. Contain those references at the host boundary; never use them as a reason to
build the window they open with WinForms.

For modeless Eto windows:

- set `Owner` with `RhinoEtoApp.MainWindowForDocument(...)` when a Rhino document is available;
- call `UseRhinoStyle()`;
- prevent duplicate instances;
- close and release the window when its owning Grasshopper component is removed;
- verify open, edit, refresh, close, reopen, document switching, and Rhino shutdown behavior.

After changing C# UI, run `dotnet build` and `dotnet test` from `Plugin/`. A Windows build is not
enough to claim macOS verification; keep host-required WinForms signatures separate from the Eto UI
and request an interactive Mac check for new or substantially changed windows.
