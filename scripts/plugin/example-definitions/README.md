# Example definitions

Builds the showcase and stress-test `.gh` files from C#, so they can be regenerated when a component changes instead of being rewired by hand. Every step is a stock or Selva component, except the C# Scripts that build the lamp, shelving and kitchen geometry and the solve bench: their sources are the `*.script.cs` files here, which this project doesn't compile.

| File                                                | For        | Shows                                                                                                                                                                                        |
| --------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `examples/definitions/timber-gridshell-pavilion.gh` | Showcase   | Timber lamella shell in three forms: material tiles, Night lamps, quantities and checks, a chart, a two-sheet A2 drawing set (PDF), CSV cut list, 3DM                                        |
| `examples/definitions/perforated-facade.gh`         | Showcase   | Attractor perforation, metal finishes, colour picker, a DXF per panel in a folder, SVG                                                                                                       |
| `examples/definitions/shelving-unit.gh`             | Showcase   | Dynamic value lists: bays from the width, shelves from the height, door patterns from the resolved bays; one solve per change                                                                |
| `examples/definitions/kitchen-run.gh`               | Showcase   | Kitchen configurator on Options Table, Repeat and Set Dynamic Value List: a front and handle per cabinet, colours and worktops that suit each other, picture tiles, a priced order, CSV, 3DM |
| `examples/definitions/dependent-forms-tutorial.gh`  | Tutorial   | Set Dynamic Value List, Repeat and Options Table, one small section each: slices from the pizza size, a topping per guest, pizzas and sizes that exist                                       |
| `examples/definitions/studio-task-lamp.gh`          | Showcase   | Desk lamp configurator: a light-source list computed from the head, Night lighting, checks, two charts, a priced order, a two-sheet A3 PDF, CSV, 3DM                                         |
| `dev/grasshopper/stress-display-throughput.gh`      | Developers | Up to 40,000 objects, mesh density, 64 materials and layers, a text payload up to 20 MB                                                                                                      |
| `dev/grasshopper/stress-every-input-and-output.gh`  | Developers | Every input widget, visibility rules, a dynamic list, every output kind, messages on demand                                                                                                  |
| `dev/grasshopper/bench-solve-transport.gh`          | Developers | One input per re-solve cost: a fixed upstream wait, panels sized in MB on the wire, display branches, a static context, colour, a 3DM on demand                                              |

## Regenerate

Needs Rhino 9 with Selva installed, driven through Rhino MCP (`run_csharp`), and the `grasshopper-definitions` Claude skill: this folder holds only Selva's definitions, and the project compiles the generator engine (the `B` builder, layout, snapshots, typed wrappers, shared helpers, Selva inputs, outputs and drawing sheets) from the skill's `assets/ghgen/`. Pass `-p:GhgenDir=<folder>` to build against another copy.

1. `dotnet build -c Release -o out` here.
2. In Rhino, run the `Grasshopper` command, then:

   ```csharp
   var alc = new System.Runtime.Loader.AssemblyLoadContext("example-definitions", true);
   var asm = alc.LoadFromStream(new System.IO.MemoryStream(System.IO.File.ReadAllBytes(@"<repo>\scripts\example-definitions\out\example-definitions.dll")));
   var defs = asm.GetType("Definitions");
   defs.GetField("Dir").SetValue(null, @"<repo>");
   Console.WriteLine(defs.GetMethod("Run").Invoke(null, new object[] { "*", false }));  // true = save + verify
   alc.Unload();
   ```

   The first argument is a file-name prefix (`"timber"`) or `"*"`. A dry run (`false`) builds and solves each definition and prints its errors, the five slowest components and the probed outputs. A save reopens each file from disk and reports anything that does not solve clean.

`Gh.g.cs` holds typed wrappers for the components used here, so a wrong input name fails the build. After a plugin update, regenerate it in Rhino with the skill's `catalog.cs` and rebuild.

Each definition stores its form (`FormLayout`) in the UI Bridge, so a rebuild keeps it.
