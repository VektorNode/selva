## File Handling Requirements & Workflow

This feature depends on:

- The **Selva plugin** for Grasshopper
- The **custom branch of rhino.compute** from VektorNode ([see implementation reference](https://github.com/VektorNode/compute.rhino3d/blob/1fc5e2c78928cddca249c0d61a7db42fd778bafc/src/compute.geometry/GrasshopperDefinition.cs#L1161))

### How File Export Works

1. In Grasshopper, use the components **Block to File** and **Geometry To File** to generate files.
2. Plug these components into a **Context Bake** component.
3. The custom VektorNode rhino.compute server will properly process and return the files in the compute response.

> **Note:** Standard rhino.compute does not support this workflow. The custom branch is required for file export integration.

### Folders and archive names

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
consumers that write files themselves rather than zipping them — it needs no DOM, so it works in
Node.
