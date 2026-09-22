# `core/files/`: file export

Zip, base64 and download helpers for files a definition emits. Generic: nothing here reads a
Grasshopper response (that's `extractFileData` in `grasshopper/io/output/`).

**Requires the Selva plugin and the [VektorNode rhino.compute
fork](https://github.com/VektorNode/compute.rhino3d/blob/1fc5e2c78928cddca249c0d61a7db42fd778bafc/src/compute.geometry/GrasshopperDefinition.cs#L1161).**
Standard rhino.compute drops file outputs entirely.

On the canvas: **Block to File** / **Geometry To File** feed a **Context Bake** component, and the
fork returns the files in the compute response.

## Folders and archive names

Each file component has a `Sub Folder` input. `::` nests, matching Rhino's layer separator:

| `Sub Folder`          | Path in the archive                         |
| --------------------- | ------------------------------------------- |
| _(empty)_             | `model.3dm`                                 |
| `Panels`              | `Panels/model.3dm`                          |
| `ROOT::Panels`        | `Panels/model.3dm`, inside `ROOT.zip`       |
| `ROOT::First::Second` | `First/Second/model.3dm`, inside `ROOT.zip` |

The **first segment is the root**, and it names the archive instead of becoming a folder inside
it. Files sharing a root travel in one archive; distinct roots produce separate ones, so two
components writing `ROOT::Panels` and `OTHERROOT::Panels` into the same Context Bake download as
`ROOT.zip` and `OTHERROOT.zip`. Files with no root fall back to the name the caller passes.

`downloadFileDataByRoot` applies all of this. `groupFilesByRoot` exposes just the grouping, for
consumers that write files themselves rather than zipping them: it needs no DOM, so it works in
Node.
